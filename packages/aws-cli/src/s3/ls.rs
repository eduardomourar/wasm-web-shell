use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;

use super::parse_s3_uri;

#[derive(Debug, Clone, Args)]
pub struct Ls {
    /// S3 URI to list (s3://bucket/prefix). If omitted, lists all buckets.
    s3_uri: Option<String>,

    /// Recursively list all objects under the prefix.
    #[arg(long, default_value_t = false)]
    recursive: bool,

    /// Display file sizes in human-readable format (e.g., 1.2 GiB).
    #[arg(long, default_value_t = false)]
    human_readable: bool,

    /// Display summary information (total number of objects and total size).
    #[arg(long, default_value_t = false)]
    summarize: bool,

    /// Number of results to return per page.
    #[arg(long)]
    page_size: Option<i32>,
}

/// Format byte size into human-readable string.
fn human_size(bytes: i64) -> String {
    const UNITS: &[&str] = &["Bytes", "KiB", "MiB", "GiB", "TiB"];
    if bytes == 0 {
        return "0 Bytes".to_string();
    }
    let mut size = bytes as f64;
    for unit in UNITS {
        if size.abs() < 1024.0 {
            return format!("{:.1} {}", size, unit);
        }
        size /= 1024.0;
    }
    format!("{:.1} PiB", size)
}

pub(crate) async fn ls(client: &Client, args: Ls) -> Result<(), Error> {
    match &args.s3_uri {
        None => list_buckets(client).await,
        Some(uri) => {
            let (bucket, prefix) =
                parse_s3_uri(uri).ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", uri))?;
            list_objects(client, &bucket, &prefix, &args).await
        }
    }
}

/// List all S3 buckets.
async fn list_buckets(client: &Client) -> Result<(), Error> {
    let resp = client.list_buckets().send().await?;
    for bucket in resp.buckets() {
        let name = bucket.name().unwrap_or_default();
        let created = bucket
            .creation_date()
            .map(|d| d.to_string())
            .unwrap_or_default();
        println!("{} {}", created, name);
    }
    Ok(())
}

/// List objects in a bucket under a prefix.
async fn list_objects(client: &Client, bucket: &str, prefix: &str, args: &Ls) -> Result<(), Error> {
    let delimiter = if args.recursive {
        None
    } else {
        Some("/".to_string())
    };

    let mut total_objects: u64 = 0;
    let mut total_size: i64 = 0;
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .set_delimiter(delimiter.clone())
            .set_max_keys(args.page_size);

        if let Some(token) = &continuation_token {
            request = request.continuation_token(token);
        }

        let resp = request.send().await?;

        // Print common prefixes (directories)
        for prefix_obj in resp.common_prefixes() {
            if let Some(p) = prefix_obj.prefix() {
                println!("{:>30} {}", "PRE", p);
            }
        }

        // Print objects
        for object in resp.contents() {
            let key = object.key().unwrap_or_default();
            let size = object.size().unwrap_or_default();
            let last_modified = object
                .last_modified()
                .map(|d| d.to_string())
                .unwrap_or_default();

            total_objects += 1;
            total_size += size;

            let size_str = if args.human_readable {
                format!("{:>10}", human_size(size))
            } else {
                format!("{:>10}", size)
            };

            println!("{} {} {}", last_modified, size_str, key);
        }

        // Check for more pages
        if resp.is_truncated() == Some(true) {
            continuation_token = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    if args.summarize {
        println!();
        println!("Total Objects: {}", total_objects);
        if args.human_readable {
            println!("   Total Size: {}", human_size(total_size));
        } else {
            println!("   Total Size: {}", total_size);
        }
    }

    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::test_utils::{
        TestConfigBuilder, async_test, mock_s3_list_objects_response, replay_event,
    };

    #[test]
    fn test_human_size() {
        assert_eq!(human_size(0), "0 Bytes");
        assert_eq!(human_size(512), "512.0 Bytes");
        assert_eq!(human_size(1024), "1.0 KiB");
        assert_eq!(human_size(1048576), "1.0 MiB");
        assert_eq!(human_size(1073741824), "1.0 GiB");
    }

    #[async_test]
    async fn test_ls_objects() {
        let mock_response =
            mock_s3_list_objects_response(&["docs/readme.txt", "docs/changelog.md"]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = ls(
            &client,
            Ls {
                s3_uri: Some("s3://test-bucket/docs/".to_string()),
                recursive: false,
                human_readable: false,
                summarize: false,
                page_size: None,
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[async_test]
    async fn test_ls_objects_recursive() {
        let mock_response = mock_s3_list_objects_response(&["prefix/a.txt", "prefix/sub/b.txt"]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = ls(
            &client,
            Ls {
                s3_uri: Some("s3://test-bucket/prefix/".to_string()),
                recursive: true,
                human_readable: true,
                summarize: true,
                page_size: Some(10),
            },
        )
        .await;

        assert!(result.is_ok());
    }
}
