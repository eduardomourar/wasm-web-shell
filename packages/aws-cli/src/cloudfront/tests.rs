use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_distributions {
    use super::*;
    use crate::cloudfront::list_distributions::{ListDistributions, list_distributions};

    #[test]
    fn args_default() {
        let args = ListDistributions {
            marker: None,
            max_items: None,
        };
        assert!(args.marker.is_none());
        assert!(args.max_items.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DistributionList xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/">
    <IsTruncated>false</IsTruncated>
    <Items></Items>
    <Marker/>
    <MaxItems>100</MaxItems>
    <Quantity>0</Quantity>
</DistributionList>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::RestXml,
            ))
            .build()
            .await;
        let client = aws_sdk_cloudfront::Client::new(&config);
        let result = list_distributions(
            &client,
            ListDistributions {
                marker: None,
                max_items: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(
            val["distributionList"]["items"].as_array().unwrap().len(),
            0
        );
    }
}
