use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod get_apis {
    use super::*;
    use crate::apigatewayv2::get_apis::{GetApis, get_apis};

    #[test]
    fn args_default() {
        let args = GetApis {
            max_results: None,
            next_token: None,
        };
        assert!(args.max_results.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"items":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RestJson1,
            ))
            .build()
            .await;
        let client = aws_sdk_apigatewayv2::Client::new(&config);
        let result = get_apis(
            &client,
            GetApis {
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["items"].as_array().unwrap().len(), 0);
    }
}
