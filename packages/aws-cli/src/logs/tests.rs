use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_log_groups {
    use super::*;
    use crate::logs::list_log_groups::{ListLogGroups, list_log_groups};

    #[test]
    fn args_default() {
        let args = ListLogGroups {
            account_identifiers: None,
            field_index_names: None,
            include_linked_accounts: None,
            limit: None,
            log_group_class: None,
            log_group_name_pattern: None,
            next_token: None,
        };
        assert!(args.log_group_class.is_none());
        assert!(args.log_group_name_pattern.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"logGroups":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RestJson1,
            ))
            .build()
            .await;
        let client = aws_sdk_cloudwatchlogs::Client::new(&config);
        let result = list_log_groups(
            &client,
            ListLogGroups {
                account_identifiers: None,
                field_index_names: None,
                include_linked_accounts: None,
                limit: None,
                log_group_class: None,
                log_group_name_pattern: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["logGroups"].as_array().unwrap().len(), 0);
    }
}
