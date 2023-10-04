use anyhow::{Error, Result};
use aws_sdk_sts::Client;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct GetCallerIdentity {
    #[arg(long, default_value_t = false)]
    pub only_user_id: bool,
}

pub(crate) async fn get_caller_identity(
    client: &Client,
    GetCallerIdentity { only_user_id, .. }: GetCallerIdentity,
) -> Result<serde_json::Value, Error> {
    tracing::trace!("Preparing GetCallerIdentity operation to AWS SDK");
    let operation = client.get_caller_identity();

    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    Ok(if only_user_id {
        serde_json::json!({
            "userId": resp.user_id(),
        })
    } else {
        serde_json::json!({
            "account": resp.account(),
            "arn": resp.arn(),
            "userId": resp.user_id(),
        })
    })
}

#[cfg(test)]
mod test {
    use super::{GetCallerIdentity, get_caller_identity};
    use crate::test_utils::{
        TestConfigBuilder, async_test, mock_sts_get_caller_identity_response, replay_event,
    };

    #[async_test]
    async fn test_get_caller_identity_success() {
        // Create mock HTTP response
        let mock_response = mock_sts_get_caller_identity_response(
            "123456789012",
            "arn:aws:iam::123456789012:user/test-user",
            "AIDAI123456789EXAMPLE",
        );

        // Build config with mocked HTTP client
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_sts::Client::new(&config);

        // Execute the operation
        let result = get_caller_identity(
            &client,
            GetCallerIdentity {
                only_user_id: false,
            },
        )
        .await
        .unwrap();

        // Verify the response
        assert_eq!(result["account"], "123456789012");
        assert_eq!(result["arn"], "arn:aws:iam::123456789012:user/test-user");
        assert_eq!(result["userId"], "AIDAI123456789EXAMPLE");
    }

    #[async_test]
    async fn test_get_caller_identity_only_user_id() {
        let mock_response = mock_sts_get_caller_identity_response(
            "123456789012",
            "arn:aws:iam::123456789012:user/test-user",
            "AIDAI123456789EXAMPLE",
        );

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_sts::Client::new(&config);

        let result = get_caller_identity(&client, GetCallerIdentity { only_user_id: true })
            .await
            .unwrap();

        // Should only contain userId
        assert_eq!(result["userId"], "AIDAI123456789EXAMPLE");
        assert!(result.get("account").is_none());
        assert!(result.get("arn").is_none());
    }
}
