use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;
use std::fs::{self, File, create_dir_all};
use std::io::Write;
use std::path::Path;

use super::{is_s3_uri, parse_s3_uri};

#[derive(Debug, Clone, Args)]
pub struct Cp {
    /// Source path (LocalPath or S3Uri).
    source: String,

    /// Destination path (LocalPath or S3Uri).
    destination: String,

    /// Recursively copy all objects under the prefix.
    #[arg(long, default_value_t = false)]
    recursive: bool,

    /// Show what would be done without actually performing the copy.
    #[arg(long, default_value_t = false)]
    dryrun: bool,

    /// Suppress output.
    #[arg(long, default_value_t = false)]
    quiet: bool,

    /// Storage class for the destination object.
    #[arg(long)]
    storage_class: Option<String>,

    /// ACL for the destination object.
    #[arg(long)]
    acl: Option<String>,
}

pub(crate) async fn cp(client: &Client, args: Cp) -> Result<(), Error> {
    let src_is_s3 = is_s3_uri(&args.source);
    let dst_is_s3 = is_s3_uri(&args.destination);

    match (src_is_s3, dst_is_s3) {
        (true, false) => download(client, &args).await,
        (false, true) => upload(client, &args).await,
        (true, true) => copy_s3_to_s3(client, &args).await,
        (false, false) => Err(anyhow::anyhow!(
            "At least one path must be an S3 URI (s3://...)"
        )),
    }
}

/// Download: S3 → Local
async fn download(client: &Client, args: &Cp) -> Result<(), Error> {
    let (bucket, key) = parse_s3_uri(&args.source)
        .ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", args.source))?;

    if args.recursive && (key.is_empty() || key.ends_with('/')) {
        return download_recursive(client, &bucket, &key, &args.destination, args).await;
    }

    let dest_path = resolve_download_path(&args.destination, &key);

    if args.dryrun {
        println!(
            "(dryrun) download: s3://{}/{} to {}",
            bucket, key, dest_path
        );
        return Ok(());
    }

    let mut resp = client.get_object().bucket(&bucket).key(&key).send().await?;

    if let Some(parent) = Path::new(&dest_path).parent() {
        create_dir_all(parent)?;
    }

    let mut file = File::create(&dest_path)?;
    while let Some(chunk) = resp.body.next().await {
        let data = chunk?;
        file.write_all(&data)?;
    }

    if !args.quiet {
        println!("download: s3://{}/{} to {}", bucket, key, dest_path);
    }
    Ok(())
}

/// Download all objects under a prefix recursively.
async fn download_recursive(
    client: &Client,
    bucket: &str,
    prefix: &str,
    dest_dir: &str,
    args: &Cp,
) -> Result<(), Error> {
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client.list_objects_v2().bucket(bucket).prefix(prefix);

        if let Some(token) = &continuation_token {
            request = request.continuation_token(token);
        }

        let resp = request.send().await?;

        for object in resp.contents() {
            let key = object.key().unwrap_or_default();
            // Strip the prefix to get relative path
            let relative = key.strip_prefix(prefix).unwrap_or(key);
            let dest_path = format!("{}/{}", dest_dir.trim_end_matches('/'), relative);

            if args.dryrun {
                println!(
                    "(dryrun) download: s3://{}/{} to {}",
                    bucket, key, dest_path
                );
                continue;
            }

            if let Some(parent) = Path::new(&dest_path).parent() {
                create_dir_all(parent)?;
            }

            let mut resp = client.get_object().bucket(bucket).key(key).send().await?;
            let mut file = File::create(&dest_path)?;
            while let Some(chunk) = resp.body.next().await {
                let data = chunk?;
                file.write_all(&data)?;
            }

            if !args.quiet {
                println!("download: s3://{}/{} to {}", bucket, key, dest_path);
            }
        }

        if resp.is_truncated() == Some(true) {
            continuation_token = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    Ok(())
}

/// Upload: Local → S3
async fn upload(client: &Client, args: &Cp) -> Result<(), Error> {
    let (bucket, key) = parse_s3_uri(&args.destination)
        .ok_or_else(|| anyhow::anyhow!("Invalid S3 URI: {}", args.destination))?;

    let source_path = Path::new(&args.source);

    if args.recursive && source_path.is_dir() {
        return upload_recursive(client, source_path, &bucket, &key, args).await;
    }

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
            "(dryrun) upload: {} to s3://{}/{}",
            args.source, bucket, final_key
        );
        return Ok(());
    }

    let body = fs::read(source_path)?;
    let mut req = client
        .put_object()
        .bucket(&bucket)
        .key(&final_key)
        .body(body.into());

    if let Some(sc) = &args.storage_class {
        req = req.storage_class(sc.as_str().into());
    }

    req.send().await?;

    if !args.quiet {
        println!("upload: {} to s3://{}/{}", args.source, bucket, final_key);
    }
    Ok(())
}

/// Upload a directory recursively.
async fn upload_recursive(
    client: &Client,
    source_dir: &Path,
    bucket: &str,
    prefix: &str,
    args: &Cp,
) -> Result<(), Error> {
    let entries = walkdir(source_dir)?;

    for entry in entries {
        let relative = entry
            .strip_prefix(source_dir)
            .unwrap_or(&entry)
            .to_string_lossy()
            .to_string();
        let key = format!("{}{}", prefix, relative);

        if args.dryrun {
            println!(
                "(dryrun) upload: {} to s3://{}/{}",
                entry.display(),
                bucket,
                key
            );
            continue;
        }

        let body = fs::read(&entry)?;
        let mut req = client
            .put_object()
            .bucket(bucket)
            .key(&key)
            .body(body.into());

        if let Some(sc) = &args.storage_class {
            req = req.storage_class(sc.as_str().into());
        }

        req.send().await?;

        if !args.quiet {
            println!("upload: {} to s3://{}/{}", entry.display(), bucket, key);
        }
    }

    Ok(())
}

/// Copy: S3 → S3
async fn copy_s3_to_s3(client: &Client, args: &Cp) -> Result<(), Error> {
    let (src_bucket, src_key) = parse_s3_uri(&args.source)
        .ok_or_else(|| anyhow::anyhow!("Invalid source S3 URI: {}", args.source))?;
    let (dst_bucket, dst_key) = parse_s3_uri(&args.destination)
        .ok_or_else(|| anyhow::anyhow!("Invalid destination S3 URI: {}", args.destination))?;

    if args.recursive && (src_key.is_empty() || src_key.ends_with('/')) {
        return copy_s3_recursive(client, &src_bucket, &src_key, &dst_bucket, &dst_key, args).await;
    }

    let final_dst_key = if dst_key.is_empty() || dst_key.ends_with('/') {
        let filename = src_key.rsplit('/').next().unwrap_or(&src_key);
        format!("{}{}", dst_key, filename)
    } else {
        dst_key
    };

    let copy_source = format!("{}/{}", src_bucket, src_key);

    if args.dryrun {
        println!(
            "(dryrun) copy: s3://{}/{} to s3://{}/{}",
            src_bucket, src_key, dst_bucket, final_dst_key
        );
        return Ok(());
    }

    let mut req = client
        .copy_object()
        .bucket(&dst_bucket)
        .key(&final_dst_key)
        .copy_source(&copy_source);

    if let Some(sc) = &args.storage_class {
        req = req.storage_class(sc.as_str().into());
    }

    req.send().await?;

    if !args.quiet {
        println!(
            "copy: s3://{}/{} to s3://{}/{}",
            src_bucket, src_key, dst_bucket, final_dst_key
        );
    }
    Ok(())
}

/// Copy all objects under a prefix from one S3 location to another.
async fn copy_s3_recursive(
    client: &Client,
    src_bucket: &str,
    src_prefix: &str,
    dst_bucket: &str,
    dst_prefix: &str,
    args: &Cp,
) -> Result<(), Error> {
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client
            .list_objects_v2()
            .bucket(src_bucket)
            .prefix(src_prefix);

        if let Some(token) = &continuation_token {
            request = request.continuation_token(token);
        }

        let resp = request.send().await?;

        for object in resp.contents() {
            let src_key = object.key().unwrap_or_default();
            let relative = src_key.strip_prefix(src_prefix).unwrap_or(src_key);
            let dst_key = format!("{}{}", dst_prefix, relative);
            let copy_source = format!("{}/{}", src_bucket, src_key);

            if args.dryrun {
                println!(
                    "(dryrun) copy: s3://{}/{} to s3://{}/{}",
                    src_bucket, src_key, dst_bucket, dst_key
                );
                continue;
            }

            let mut req = client
                .copy_object()
                .bucket(dst_bucket)
                .key(&dst_key)
                .copy_source(&copy_source);

            if let Some(sc) = &args.storage_class {
                req = req.storage_class(sc.as_str().into());
            }

            req.send().await?;

            if !args.quiet {
                println!(
                    "copy: s3://{}/{} to s3://{}/{}",
                    src_bucket, src_key, dst_bucket, dst_key
                );
            }
        }

        if resp.is_truncated() == Some(true) {
            continuation_token = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    Ok(())
}

/// Resolve the local destination path for a download.
/// If dest is a directory (or ends with /), append the filename from the key.
fn resolve_download_path(dest: &str, key: &str) -> String {
    let dest_path = Path::new(dest);
    if dest_path.is_dir() || dest.ends_with('/') {
        let filename = key.rsplit('/').next().unwrap_or(key);
        format!("{}/{}", dest.trim_end_matches('/'), filename)
    } else {
        dest.to_string()
    }
}

/// Recursively walk a directory and return all file paths.
fn walkdir(dir: &Path) -> Result<Vec<std::path::PathBuf>, Error> {
    let mut files = Vec::new();
    if dir.is_file() {
        files.push(dir.to_path_buf());
        return Ok(files);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(walkdir(&path)?);
        } else {
            files.push(path);
        }
    }
    Ok(files)
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::test_utils::{TestConfigBuilder, async_test, replay_event};

    #[test]
    fn test_resolve_download_path_to_dir() {
        // Trailing slash → treat as directory, append filename from key
        assert_eq!(
            resolve_download_path("/tmp/", "prefix/file.txt"),
            "/tmp/file.txt"
        );
        // /tmp exists as a directory on disk → appends filename
        assert_eq!(resolve_download_path("/tmp", "file.txt"), "/tmp/file.txt");
    }

    #[test]
    fn test_resolve_download_path_to_file() {
        // Non-existent path without trailing slash → treated as file destination
        assert_eq!(
            resolve_download_path("/tmp/my-output.txt", "prefix/file.txt"),
            "/tmp/my-output.txt"
        );
    }

    #[async_test]
    async fn test_cp_download_single_file() {
        let test_content = "hello from s3";

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, test_content))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let dest = "/tmp/test-s3-cp-download.txt";
        let result = cp(
            &client,
            Cp {
                source: "s3://test-bucket/path/to/file.txt".to_string(),
                destination: dest.to_string(),
                recursive: false,
                dryrun: false,
                quiet: true,
                storage_class: None,
                acl: None,
            },
        )
        .await;

        assert!(result.is_ok());
        let content = std::fs::read_to_string(dest).unwrap();
        assert_eq!(content, test_content);
        std::fs::remove_file(dest).ok();
    }

    #[async_test]
    async fn test_cp_dryrun_does_not_write() {
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, "should not be written"))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let dest = "/tmp/test-s3-cp-dryrun-should-not-exist.txt";
        let result = cp(
            &client,
            Cp {
                source: "s3://bucket/key.txt".to_string(),
                destination: dest.to_string(),
                recursive: false,
                dryrun: true,
                quiet: false,
                storage_class: None,
                acl: None,
            },
        )
        .await;

        assert!(result.is_ok());
        assert!(!std::path::Path::new(dest).exists());
    }

    #[test]
    fn test_cp_requires_s3_uri() {
        // Both local paths should fail immediately (no async needed)
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async {
            let config = TestConfigBuilder::new()
                .replay_event(replay_event(200, ""))
                .build()
                .await;
            let client = aws_sdk_s3::Client::new(&config);

            let result = cp(
                &client,
                Cp {
                    source: "/local/a".to_string(),
                    destination: "/local/b".to_string(),
                    recursive: false,
                    dryrun: false,
                    quiet: true,
                    storage_class: None,
                    acl: None,
                },
            )
            .await;

            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("S3 URI"));
        });
    }
}
