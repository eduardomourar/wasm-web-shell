use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_work_groups {
    use super::*;
    use crate::athena::list_work_groups::{ListWorkGroups, list_work_groups};

    #[test]
    fn args_default() {
        let args = ListWorkGroups {
            max_results: None,
            next_token: None,
        };
        assert!(args.max_results.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"WorkGroups":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_athena::Client::new(&config);
        let result = list_work_groups(
            &client,
            ListWorkGroups {
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["workGroups"].as_array().unwrap().len(), 0);
    }
}
