use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_config_rules {
    use super::*;
    use crate::configservice::describe_config_rules::{DescribeConfigRules, describe_config_rules};

    #[test]
    fn args_default() {
        let args = DescribeConfigRules {
            config_rule_names: None,
            next_token: None,
        };
        assert!(args.config_rule_names.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"ConfigRules":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_config::Client::new(&config);
        let result = describe_config_rules(
            &client,
            DescribeConfigRules {
                config_rule_names: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["configRules"].as_array().unwrap().len(), 0);
    }
}
