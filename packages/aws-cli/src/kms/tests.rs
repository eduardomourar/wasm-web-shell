use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_keys {
    use super::*;
    use crate::kms::list_keys::{ListKeys, list_keys};

    #[test]
    fn args_default() {
        let args = ListKeys {
            limit: None,
            marker: None,
        };
        assert!(args.limit.is_none());
        assert!(args.marker.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"Keys":[],"Truncated":false}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_kms::Client::new(&config);
        let result = list_keys(
            &client,
            ListKeys {
                limit: None,
                marker: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["keys"].as_array().unwrap().len(), 0);
    }
}
