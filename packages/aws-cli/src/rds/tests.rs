use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_db_instances {
    use super::*;
    use crate::rds::describe_db_instances::{DescribeDbInstances, describe_db_instances};

    #[test]
    fn args_default() {
        let args = DescribeDbInstances {
            db_instance_identifier: None,
            marker: None,
            max_records: None,
        };
        assert!(args.db_instance_identifier.is_none());
        assert!(args.max_records.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeDBInstancesResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/">
    <DescribeDBInstancesResult>
        <DBInstances></DBInstances>
    </DescribeDBInstancesResult>
    <ResponseMetadata>
        <RequestId>298f362b-e14a-4ee0-9840-4546c276014a</RequestId>
    </ResponseMetadata>
</DescribeDBInstancesResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_rds::Client::new(&config);
        let result = describe_db_instances(
            &client,
            DescribeDbInstances {
                db_instance_identifier: None,
                marker: None,
                max_records: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["dbInstances"].as_array().unwrap().len(), 0);
    }
}
