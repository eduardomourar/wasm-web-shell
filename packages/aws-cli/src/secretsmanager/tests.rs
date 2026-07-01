use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_secrets {
    use super::*;
    use crate::secretsmanager::list_secrets::{ListSecrets, list_secrets};

    #[test]
    fn args_default() {
        let args = ListSecrets {
            include_planned_deletion: None,
            max_results: None,
            next_token: None,
            sort_by: None,
            sort_order: None,
        };
        assert!(args.include_planned_deletion.is_none());
        assert!(args.sort_by.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"SecretList":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_secretsmanager::Client::new(&config);
        let result = list_secrets(
            &client,
            ListSecrets {
                include_planned_deletion: None,
                max_results: None,
                next_token: None,
                sort_by: None,
                sort_order: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["secretList"].as_array().unwrap().len(), 0);
    }
}
