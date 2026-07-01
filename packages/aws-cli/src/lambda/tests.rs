use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_functions {
    use super::*;
    use crate::lambda::list_functions::{ListFunctions, list_functions};

    #[test]
    fn args_default() {
        let args = ListFunctions {
            function_version: None,
            marker: None,
            master_region: None,
            max_items: None,
        };
        assert!(args.function_version.is_none());
        assert!(args.master_region.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"Functions":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RestJson1,
            ))
            .build()
            .await;
        let client = aws_sdk_lambda::Client::new(&config);
        let result = list_functions(
            &client,
            ListFunctions {
                function_version: None,
                marker: None,
                master_region: None,
                max_items: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["functions"].as_array().unwrap().len(), 0);
    }
}
