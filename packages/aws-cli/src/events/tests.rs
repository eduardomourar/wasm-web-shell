use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_rules {
    use super::*;
    use crate::events::list_rules::{ListRules, list_rules};

    #[test]
    fn args_default() {
        let args = ListRules {
            event_bus_name: None,
            limit: None,
            name_prefix: None,
            next_token: None,
        };
        assert!(args.event_bus_name.is_none());
        assert!(args.name_prefix.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"Rules":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_eventbridge::Client::new(&config);
        let result = list_rules(
            &client,
            ListRules {
                event_bus_name: None,
                limit: None,
                name_prefix: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["rules"].as_array().unwrap().len(), 0);
    }
}
