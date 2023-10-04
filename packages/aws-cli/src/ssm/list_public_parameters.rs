use anyhow::{Error, Result};
use aws_sdk_ssm::Client;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct ListPublicParameters {
    #[arg(long)]
    max_results: Option<i32>,
}

pub(crate) async fn list_public_parameters(
    client: &Client,
    ListPublicParameters { max_results, .. }: ListPublicParameters,
) -> Result<serde_json::Value, Error> {
    tracing::trace!("Preparing GetParametersByPath operation to AWS SDK");
    let operation = client
        .get_parameters_by_path()
        .path("/aws/service/list")
        .set_max_results(max_results);

    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let parameters = resp
        .parameters()
        .iter()
        .map(|v| {
            serde_json::json!({
                "arn": v.arn(),
                "dataType": v.data_type(),
                "lastModifiedDate": v.last_modified_date().map(|v| v.to_string()),
                "name": v.name(),
                "value": v.value(),
                "version": v.version(),
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({"parameters": parameters}))
}

#[cfg(test)]
mod test {
    use super::{ListPublicParameters, list_public_parameters};
    use crate::test_utils::{
        TestConfigBuilder, async_test, mock_ssm_list_parameters_response, replay_event,
    };

    #[async_test]
    async fn test_list_public_parameters_success() {
        // Create mock HTTP response with SSM JSON
        let mock_response = mock_ssm_list_parameters_response(&[
            (
                "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2",
                "ami-12345678",
            ),
            (
                "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-arm64-gp2",
                "ami-87654321",
            ),
        ]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_ssm::Client::new(&config);

        let result = list_public_parameters(
            &client,
            ListPublicParameters {
                max_results: Some(2),
            },
        )
        .await
        .unwrap();

        // Verify response contains expected parameters
        let result_str = result.to_string();
        assert!(result_str.contains("ami-amazon-linux-latest"));
        assert!(result_str.contains("ami-12345678") || result_str.contains("ami-87654321"));
    }

    #[async_test]
    async fn test_list_public_parameters_empty() {
        // Empty parameters response
        let mock_response = mock_ssm_list_parameters_response(&[]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_ssm::Client::new(&config);

        let result = list_public_parameters(
            &client,
            ListPublicParameters {
                max_results: Some(10),
            },
        )
        .await
        .unwrap();

        // Should return valid JSON even if empty
        let result_str = result.to_string();
        assert!(result_str.contains("[]") || result_str.contains("parameters"));
    }
}
