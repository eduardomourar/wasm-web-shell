use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_vaults {
    use super::*;
    use crate::glacier::list_vaults::{ListVaults, list_vaults};

    #[test]
    fn args_default() {
        let args = ListVaults {
            account_id: "test".to_string(),
            limit: None,
            marker: None,
        };
        assert_eq!(args.account_id, "test");
        assert!(args.marker.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"VaultList":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_glacier::Client::new(&config);
        let result = list_vaults(
            &client,
            ListVaults {
                account_id: "test".to_string(),
                limit: None,
                marker: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["vaultList"].as_array().unwrap().len(), 0);
    }
}
