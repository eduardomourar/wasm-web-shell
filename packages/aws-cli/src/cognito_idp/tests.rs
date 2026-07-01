use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_user_pools {
    use super::*;
    use crate::cognito_idp::list_user_pools::{ListUserPools, list_user_pools};

    #[test]
    fn args_default() {
        let args = ListUserPools {
            max_results: 20,
            next_token: None,
        };
        assert_eq!(args.max_results, 20);
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"UserPools":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_cognitoidentityprovider::Client::new(&config);
        let result = list_user_pools(
            &client,
            ListUserPools {
                max_results: 1,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["userPools"].as_array().unwrap().len(), 0);
    }
}
