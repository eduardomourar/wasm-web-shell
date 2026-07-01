use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod list_hosted_zones {
    use super::*;
    use crate::route53::list_hosted_zones::{ListHostedZones, list_hosted_zones};

    #[test]
    fn args_default() {
        let args = ListHostedZones {
            delegation_set_id: None,
            hosted_zone_type: None,
            marker: None,
            max_items: None,
        };
        assert!(args.delegation_set_id.is_none());
        assert!(args.hosted_zone_type.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListHostedZonesResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
    <IsTruncated>false</IsTruncated>
    <HostedZones></HostedZones>
</ListHostedZonesResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::RestXml,
            ))
            .build()
            .await;
        let client = aws_sdk_route53::Client::new(&config);
        let result = list_hosted_zones(
            &client,
            ListHostedZones {
                delegation_set_id: None,
                hosted_zone_type: None,
                marker: None,
                max_items: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["hostedZones"].as_array().unwrap().len(), 0);
    }
}
