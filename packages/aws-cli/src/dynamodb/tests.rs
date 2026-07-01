use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event, replay_event_with_protocol,
};

mod list_tables {
    use super::*;
    use crate::dynamodb::list_tables::{ListTables, list_tables};

    #[test]
    fn args_default() {
        let args = ListTables {
            exclusive_start_table_name: None,
            limit: None,
        };
        assert!(args.exclusive_start_table_name.is_none());
        assert!(args.limit.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"TableNames":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_0,
            ))
            .build()
            .await;
        let client = aws_sdk_dynamodb::Client::new(&config);
        let result = list_tables(
            &client,
            ListTables {
                exclusive_start_table_name: None,
                limit: Some(5),
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["tableNames"].as_array().unwrap().len(), 0);
    }

    #[async_test]
    async fn list_with_results() {
        let json_resp = r#"{"TableNames":["users","orders","products"]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, json_resp))
            .build()
            .await;
        let client = aws_sdk_dynamodb::Client::new(&config);
        let result = list_tables(
            &client,
            ListTables {
                exclusive_start_table_name: None,
                limit: Some(5),
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["tableNames"].as_array().unwrap().len(), 3);
    }
}
