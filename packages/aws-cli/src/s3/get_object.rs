use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;
use std::fs::{File, create_dir_all};
use std::io::Write;

#[derive(Debug, Clone, Args)]
pub struct GetObject {
    #[arg(long)]
    bucket: String,
    #[arg(long)]
    key: String,

    outfile: Option<std::path::PathBuf>,
}

pub(crate) async fn get_object(
    client: &Client,
    GetObject {
        bucket,
        key,
        outfile,
        ..
    }: GetObject,
) -> Result<Option<Vec<u8>>, Error> {
    tracing::trace!("Preparing GetObject operation to AWS SDK");
    let operation = client.get_object().bucket(bucket).key(key);
    let mut resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let content_length = resp.content_length().unwrap_or_default() as usize;
    Ok(match outfile {
        Some(value) => {
            if let Some(parent) = value.parent() {
                create_dir_all(parent).map_err(anyhow::Error::from)?;
            };
            let mut file = File::create(value)?;

            // iterate over the stream and write to the file
            let mut bytes_len = 0;
            while let Some(v) = resp.body.next().await {
                let chunk = v.map_err(anyhow::Error::from)?;
                bytes_len += chunk.len();
                file.write_all(&chunk).map_err(anyhow::Error::from)?;
            }
            if cfg!(debug_assertions) {
                assert_eq!(content_length, bytes_len);
            }
            None
        }
        None => {
            // let inner = resp.body.collect().await;
            let mut body: Vec<u8> = Vec::new();
            // iterate over the stream and write to the file
            let mut bytes_len = 0;
            while let Some(v) = resp.body.next().await {
                let chunk = v.map_err(anyhow::Error::from)?;
                bytes_len += chunk.len();
                body.extend_from_slice(&chunk);
            }
            if cfg!(debug_assertions) {
                assert_eq!(content_length, bytes_len);
            }
            Some(body)
        }
    })
}

#[cfg(test)]
mod test {
    use std::path::PathBuf;

    use super::{GetObject, get_object};
    use crate::test_utils::{TestConfigBuilder, async_test, replay_event};

    #[async_test]
    async fn test_get_object_to_file() {
        let test_content = "This is test README content.\nLine 2 of the file.\n";

        let config = TestConfigBuilder::new()
            .region("us-east-1")
            .replay_event(replay_event(200, test_content))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let output = PathBuf::from("/tmp/test-readme.txt");

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "test-file.txt".to_string(),
                outfile: Some(output.clone()),
            },
        )
        .await
        .unwrap();

        // When writing to file, result should be None
        assert!(result.is_none());

        // Verify file was created
        assert!(output.exists());

        // Verify content
        let content = std::fs::read_to_string(&output).unwrap();
        assert_eq!(content, test_content);

        // Clean up
        std::fs::remove_file(output).ok();
    }

    #[async_test]
    async fn test_get_object_to_stdout() {
        let test_content = "{\"test\":\"data\"}\n";

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, test_content))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "test.jsonl".to_string(),
                outfile: None,
            },
        )
        .await
        .unwrap()
        .unwrap();

        // Verify content returned (get_object returns Vec<u8>)
        let result_str = String::from_utf8_lossy(&result);
        assert_eq!(result_str, test_content);
        assert!(result_str.contains("test"));
        assert!(result_str.contains("data"));
    }

    #[async_test]
    async fn test_get_object_empty() {
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, ""))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = get_object(
            &client,
            GetObject {
                bucket: "test-bucket".to_string(),
                key: "empty.txt".to_string(),
                outfile: None,
            },
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(result, Vec::<u8>::new());
    }
}
