use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct ListObjects {
    #[arg(long)]
    bucket: Option<String>,
    #[arg(long)]
    delimiter: Option<String>,
    #[arg(long)]
    prefix: Option<String>,
    #[arg(long)]
    max_keys: Option<i32>,
}

pub(crate) async fn list_objects(
    client: &Client,
    ListObjects {
        bucket,
        delimiter,
        prefix,
        max_keys,
        ..
    }: ListObjects,
) -> Result<serde_json::Value, Error> {
    tracing::trace!("Preparing ListObjects operation to AWS SDK");
    let operation = client
        .list_objects_v2()
        .bucket(bucket.unwrap_or("nara-national-archives-catalog".to_string()))
        .delimiter(delimiter.unwrap_or("/".to_string()))
        .set_prefix(prefix)
        .set_max_keys(max_keys);

    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let contents = resp
        .contents()
        .iter()
        .map(|v| {
            serde_json::json!({
                "eTag": v.e_tag(),
                "lastModified": v.last_modified().map(|v| v.to_string()),
                "key": v.key(),
                "size": v.size(),
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({"contents": contents}))
}

#[cfg(test)]
mod test {
    use super::{ListObjects, list_objects};
    use crate::test_utils::{
        TestConfigBuilder, async_test, mock_s3_list_objects_response, replay_event,
    };

    #[async_test]
    async fn test_list_objects_success() {
        // Create mock HTTP response with S3 XML
        let mock_response = mock_s3_list_objects_response(&[
            "authority-records/organization/file1.xml",
            "authority-records/organization/file2.xml",
        ]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = list_objects(
            &client,
            ListObjects {
                bucket: Some("test-bucket".to_string()),
                delimiter: Some("/".to_string()),
                prefix: Some("authority-records/organization/".to_string()),
                max_keys: Some(2),
            },
        )
        .await
        .unwrap();

        // Verify response contains expected keys
        let result_str = result.to_string();
        assert!(result_str.contains("file1.xml"));
        assert!(result_str.contains("file2.xml"));
    }

    #[async_test]
    async fn test_list_objects_empty() {
        // Empty bucket response
        let mock_response = mock_s3_list_objects_response(&[]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_s3::Client::new(&config);

        let result = list_objects(
            &client,
            ListObjects {
                bucket: Some("empty-bucket".to_string()),
                delimiter: None,
                prefix: None,
                max_keys: Some(10),
            },
        )
        .await
        .unwrap();

        // Should return valid JSON even if empty
        let result_str = result.to_string();
        assert!(result_str.contains("[]") || result_str.contains("objects"));
    }
}
