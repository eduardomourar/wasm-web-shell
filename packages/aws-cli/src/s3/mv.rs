use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;
use std::fs;
use std::path::Path;

use super::{is_s3_uri, parse_s3_uri};

#[derive(Debug, Clone, Args)]
pub struct Mv {
    /// Source path (LocalPath or S3Uri).
    source: String,
    /// Destination path (LocalPath or S3Uri).
    destination: String,
    /// Recursively move all objects under the prefix.
    #[arg(long, default_value_t = false)]
    recursive: bool,
    /// Show what would be done without performing the move.
    #[arg(long, default_value_t = false)]
    dryrun: bool,
    /// Suppress output.
    #[arg(long, default_value_t = false)]
    quiet: bool,
    /// Storage class for the destination object.
    #[arg(long)]
    storage_class: Option<String>,
}

pub(crate) async fn mv(client: &Client, args: Mv) -> Result<(), Error> {
    let src_is_s3 = is_s3_uri(&args.source);
    let dst_is_s3 = is_s3_uri(&args.destination);

    match (src_is_s3, dst_is_s3) {
        (true, false) => move_s3_to_local(client, &args).await,
        (false, true) => move_local_to_s3(client, &args).await,
        (true, true) => move_s3_to_s3(client, &args).await,
        (false, false) => Err(anyhow::anyhow!(
            "At least one path must be an S3 URI (s3://...)"
        )),
    }
}

async fn move_s3_to_local(client: &Client, args: &Mv) -> Result<(), Error> {
    let (bucket, key) = parse_s3_uri(&args.source)
        .ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", args.source))?;

    if args.dryrun {
        println!(
            "(dryrun) move: s3://{}/{} to {}",
            bucket, key, args.destination
        );
        return Ok(());
    }

    let dest_path = resolve_dest_path(&args.destination, &key);
    if let Some(parent) = Path::new(&dest_path).parent() {
        fs::create_dir_all(parent)?;
    }

    let mut resp = client.get_object().bucket(&bucket).key(&key).send().await?;
    let mut file = fs::File::create(&dest_path)?;
    while let Some(chunk) = resp.body.next().await {
        let data = chunk?;
        std::io::Write::write_all(&mut file, &data)?;
    }

    client
        .delete_object()
        .bucket(&bucket)
        .key(&key)
        .send()
        .await?;

    if !args.quiet {
        println!("move: s3://{}/{} to {}", bucket, key, dest_path);
    }
    Ok(())
}

async fn move_local_to_s3(client: &Client, args: &Mv) -> Result<(), Error> {
    let (bucket, key) = parse_s3_uri(&args.destination)
        .ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", args.destination))?;
    let source_path = Path::new(&args.source);

    let final_key = if key.is_empty() || key.ends_with('/') {
        let filename = source_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        format!("{}{}", key, filename)
    } else {
        key
    };

    if args.dryrun {
        println!(
            "(dryrun) move: {} to s3://{}/{}",
            args.source, bucket, final_key
        );
        return Ok(());
    }

    let body = fs::read(source_path)?;
    client
        .put_object()
        .bucket(&bucket)
        .key(&final_key)
        .body(body.into())
        .send()
        .await?;
    fs::remove_file(source_path)?;

    if !args.quiet {
        println!("move: {} to s3://{}/{}", args.source, bucket, final_key);
    }
    Ok(())
}

async fn move_s3_to_s3(client: &Client, args: &Mv) -> Result<(), Error> {
    let (src_bucket, src_key) = parse_s3_uri(&args.source)
        .ok_or_else(|| anyhow::anyhow!("Invalid source S3 URI: {}", args.source))?;
    let (dst_bucket, dst_key) = parse_s3_uri(&args.destination)
        .ok_or_else(|| anyhow::anyhow!("Invalid destination S3 URI: {}", args.destination))?;

    let final_dst_key = if dst_key.is_empty() || dst_key.ends_with('/') {
        let filename = src_key.rsplit('/').next().unwrap_or(&src_key);
        format!("{}{}", dst_key, filename)
    } else {
        dst_key
    };
    let copy_source = format!("{}/{}", src_bucket, src_key);

    if args.dryrun {
        println!(
            "(dryrun) move: s3://{}/{} to s3://{}/{}",
            src_bucket, src_key, dst_bucket, final_dst_key
        );
        return Ok(());
    }

    client
        .copy_object()
        .bucket(&dst_bucket)
        .key(&final_dst_key)
        .copy_source(&copy_source)
        .send()
        .await?;
    client
        .delete_object()
        .bucket(&src_bucket)
        .key(&src_key)
        .send()
        .await?;

    if !args.quiet {
        println!(
            "move: s3://{}/{} to s3://{}/{}",
            src_bucket, src_key, dst_bucket, final_dst_key
        );
    }
    Ok(())
}

fn resolve_dest_path(dest: &str, key: &str) -> String {
    let dest_path = Path::new(dest);
    if dest_path.is_dir() || dest.ends_with('/') {
        let filename = key.rsplit('/').next().unwrap_or(key);
        format!("{}/{}", dest.trim_end_matches('/'), filename)
    } else {
        dest.to_string()
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_resolve_dest_path_dir() {
        assert_eq!(
            resolve_dest_path("/tmp/", "prefix/file.txt"),
            "/tmp/file.txt"
        );
    }

    #[test]
    fn test_resolve_dest_path_file() {
        assert_eq!(
            resolve_dest_path("/tmp/out.txt", "prefix/file.txt"),
            "/tmp/out.txt"
        );
    }

    #[test]
    fn test_requires_s3_uri() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let config = crate::test_utils::TestConfigBuilder::new()
                .replay_event(crate::test_utils::replay_event(200, ""))
                .build()
                .await;
            let client = aws_sdk_s3::Client::new(&config);
            let result = mv(
                &client,
                Mv {
                    source: "/a".to_string(),
                    destination: "/b".to_string(),
                    recursive: false,
                    dryrun: false,
                    quiet: true,
                    storage_class: None,
                },
            )
            .await;
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("S3 URI"));
        });
    }
}
