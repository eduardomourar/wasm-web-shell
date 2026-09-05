use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;

use super::parse_s3_uri;

#[derive(Debug, Clone, Args)]
pub struct Rm {
    /// S3 URI of the object(s) to delete (s3://bucket/key).
    s3_uri: String,
    /// Recursively delete all objects under the prefix.
    #[arg(long, default_value_t = false)]
    recursive: bool,
    /// Show what would be done without deleting.
    #[arg(long, default_value_t = false)]
    dryrun: bool,
    /// Suppress output.
    #[arg(long, default_value_t = false)]
    quiet: bool,
    /// Don't exclude files matching the pattern.
    #[arg(long)]
    include: Option<String>,
    /// Exclude files matching the pattern.
    #[arg(long)]
    exclude: Option<String>,
    /// Number of results to return per page.
    #[arg(long)]
    page_size: Option<i32>,
}

pub(crate) async fn rm(client: &Client, args: Rm) -> Result<(), Error> {
    let (bucket, key) = parse_s3_uri(&args.s3_uri)
        .ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", args.s3_uri))?;

    if args.recursive {
        delete_recursive(client, &bucket, &key, &args).await
    } else {
        delete_single(client, &bucket, &key, &args).await
    }
}

async fn delete_single(client: &Client, bucket: &str, key: &str, args: &Rm) -> Result<(), Error> {
    if args.dryrun {
        println!("(dryrun) delete: s3://{}/{}", bucket, key);
        return Ok(());
    }

    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await?;

    if !args.quiet {
        println!("delete: s3://{}/{}", bucket, key);
    }
    Ok(())
}

async fn delete_recursive(
    client: &Client,
    bucket: &str,
    prefix: &str,
    args: &Rm,
) -> Result<(), Error> {
    let mut continuation_token: Option<String> = None;
    let mut total_deleted: u64 = 0;

    loop {
        let mut request = client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .set_max_keys(args.page_size);

        if let Some(token) = &continuation_token {
            request = request.continuation_token(token);
        }

        let resp = request.send().await?;

        for object in resp.contents() {
            let key = object.key().unwrap_or_default();

            if let Some(exclude) = &args.exclude
                && key.contains(exclude.as_str()) {
                    continue;
                }
            if let Some(include) = &args.include
                && !key.contains(include.as_str()) {
                    continue;
                }

            if args.dryrun {
                println!("(dryrun) delete: s3://{}/{}", bucket, key);
            } else {
                client
                    .delete_object()
                    .bucket(bucket)
                    .key(key)
                    .send()
                    .await?;
                if !args.quiet {
                    println!("delete: s3://{}/{}", bucket, key);
                }
            }
            total_deleted += 1;
        }

        if resp.is_truncated() == Some(true) {
            continuation_token = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    if !args.quiet && total_deleted == 0 {
        println!("No objects found under s3://{}/{}", bucket, prefix);
    }
    Ok(())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::test_utils::{TestConfigBuilder, async_test, replay_event};

    #[async_test]
    async fn test_rm_dryrun() {
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(204, ""))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = rm(
            &client,
            Rm {
                s3_uri: "s3://bucket/key.txt".to_string(),
                recursive: false,
                dryrun: true,
                quiet: false,
                include: None,
                exclude: None,
                page_size: None,
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[async_test]
    async fn test_rm_single_object() {
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(204, ""))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = rm(
            &client,
            Rm {
                s3_uri: "s3://bucket/file.txt".to_string(),
                recursive: false,
                dryrun: false,
                quiet: true,
                include: None,
                exclude: None,
                page_size: None,
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[test]
    fn test_rm_invalid_uri() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async {
            let config = TestConfigBuilder::new()
                .replay_event(replay_event(204, ""))
                .build()
                .await;
            let client = aws_sdk_s3::Client::new(&config);

            let result = rm(
                &client,
                Rm {
                    s3_uri: "/local/path".to_string(),
                    recursive: false,
                    dryrun: false,
                    quiet: true,
                    include: None,
                    exclude: None,
                    page_size: None,
                },
            )
            .await;

            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("Invalid S3 URI"));
        });
    }
}
