use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_clusters {
    use super::*;
    use crate::redshift::describe_clusters::{DescribeClusters, describe_clusters};

    #[test]
    fn args_default() {
        let args = DescribeClusters {
            cluster_identifier: None,
            marker: None,
            max_records: None,
            tag_keys: None,
            tag_values: None,
        };
        assert!(args.cluster_identifier.is_none());
        assert!(args.tag_keys.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeClustersResponse xmlns="http://redshift.amazonaws.com/doc/2012-12-01/">
    <DescribeClustersResult>
        <Clusters></Clusters>
    </DescribeClustersResult>
    <ResponseMetadata>
        <RequestId>e47f901c-283e-11ea-8397-219d1980588b</RequestId>
    </ResponseMetadata>
</DescribeClustersResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_redshift::Client::new(&config);
        let result = describe_clusters(
            &client,
            DescribeClusters {
                cluster_identifier: None,
                marker: None,
                max_records: None,
                tag_keys: None,
                tag_values: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["clusters"].as_array().unwrap().len(), 0);
    }
}
