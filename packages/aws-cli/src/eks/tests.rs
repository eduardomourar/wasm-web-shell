use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_clusters {
    use super::*;
    use crate::eks::list_clusters::{ListClusters, list_clusters};

    #[test]
    fn args_default() {
        let args = ListClusters {
            include: None,
            max_results: None,
            next_token: None,
        };
        assert!(args.include.is_none());
        assert!(args.max_results.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"clusters":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RestJson1,
            ))
            .build()
            .await;
        let client = aws_sdk_eks::Client::new(&config);
        let result = list_clusters(
            &client,
            ListClusters {
                include: None,
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["clusters"].as_array().unwrap().len(), 0);
    }
}
