use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_subscriptions {
    use super::*;
    use crate::sns::list_subscriptions::{ListSubscriptions, list_subscriptions};

    #[test]
    fn args_default() {
        let args = ListSubscriptions { next_token: None };
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListSubscriptionsResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
    <ListSubscriptionsResult>
        <Subscriptions></Subscriptions>
    </ListSubscriptionsResult>
    <ResponseMetadata>
        <RequestId>11223344-5566-7788-9900-aabbccddeeff</RequestId>
    </ResponseMetadata>
</ListSubscriptionsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_sns::Client::new(&config);
        let result = list_subscriptions(&client, ListSubscriptions { next_token: None }).await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["subscriptions"].as_array().unwrap().len(), 0);
    }
}

mod list_topics {
    use super::*;
    use crate::sns::list_topics::{ListTopics, list_topics};

    #[test]
    fn args_default() {
        let args = ListTopics { next_token: None };
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListTopicsResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
    <ListTopicsResult>
        <Topics></Topics>
    </ListTopicsResult>
    <ResponseMetadata>
        <RequestId>11223344-5566-7788-9900-aabbccddeeff</RequestId>
    </ResponseMetadata>
</ListTopicsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_sns::Client::new(&config);
        let result = list_topics(&client, ListTopics { next_token: None }).await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["topics"].as_array().unwrap().len(), 0);
    }
}
