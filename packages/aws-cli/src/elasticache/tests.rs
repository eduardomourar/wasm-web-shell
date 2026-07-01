use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_cache_clusters {
    use super::*;
    use crate::elasticache::describe_cache_clusters::{
        DescribeCacheClusters, describe_cache_clusters,
    };

    #[test]
    fn args_default() {
        let args = DescribeCacheClusters {
            cache_cluster_id: None,
            marker: None,
            max_records: None,
            show_cache_clusters_not_in_replication_groups: None,
            show_cache_node_info: None,
        };
        assert!(args.cache_cluster_id.is_none());
        assert!(args.show_cache_node_info.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeCacheClustersResponse xmlns="http://elasticache.amazonaws.com/doc/2015-02-02/">
    <DescribeCacheClustersResult>
        <CacheClusters></CacheClusters>
    </DescribeCacheClustersResult>
</DescribeCacheClustersResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_elasticache::Client::new(&config);
        let result = describe_cache_clusters(
            &client,
            DescribeCacheClusters {
                cache_cluster_id: None,
                marker: None,
                max_records: None,
                show_cache_clusters_not_in_replication_groups: None,
                show_cache_node_info: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["cacheClusters"].as_array().unwrap().len(), 0);
    }
}
