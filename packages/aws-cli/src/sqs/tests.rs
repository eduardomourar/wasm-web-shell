use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_queues {
    use super::*;
    use crate::sqs::list_queues::{ListQueues, list_queues};

    #[test]
    fn args_default() {
        let args = ListQueues {
            max_results: None,
            next_token: None,
            queue_name_prefix: None,
        };
        assert!(args.max_results.is_none());
        assert!(args.queue_name_prefix.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"QueueUrls":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_0,
            ))
            .build()
            .await;
        let client = aws_sdk_sqs::Client::new(&config);
        let result = list_queues(
            &client,
            ListQueues {
                max_results: None,
                next_token: None,
                queue_name_prefix: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["queueUrls"].as_array().unwrap().len(), 0);
    }
}
