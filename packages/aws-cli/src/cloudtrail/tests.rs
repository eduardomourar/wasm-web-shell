use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod lookup_events {
    use super::*;
    use crate::cloudtrail::lookup_events::{LookupEvents, lookup_events};

    #[test]
    fn args_default() {
        let args = LookupEvents {
            event_category: None,
            max_results: None,
            next_token: None,
        };
        assert!(args.event_category.is_none());
        assert!(args.max_results.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"Events":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_cloudtrail::Client::new(&config);
        let result = lookup_events(
            &client,
            LookupEvents {
                event_category: None,
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["events"].as_array().unwrap().len(), 0);
    }
}
