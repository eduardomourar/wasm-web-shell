use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_instances {
    use super::*;
    use crate::ec2::describe_instances::{DescribeInstances, describe_instances};

    #[test]
    fn args_default() {
        let args = DescribeInstances {
            dry_run: None,
            include_managed_resources: None,
            instance_ids: None,
            max_results: None,
            next_token: None,
        };
        assert!(args.dry_run.is_none());
        assert!(args.include_managed_resources.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>8f7724cf-496f-496e-8fe3-example</requestId>
    <reservationSet></reservationSet>
</DescribeInstancesResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::Ec2Query,
            ))
            .build()
            .await;
        let client = aws_sdk_ec2::Client::new(&config);
        let result = describe_instances(
            &client,
            DescribeInstances {
                dry_run: None,
                include_managed_resources: None,
                instance_ids: None,
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["reservations"].as_array().unwrap().len(), 0);
    }
}

mod describe_security_groups {
    use super::*;
    use crate::ec2::describe_security_groups::{DescribeSecurityGroups, describe_security_groups};

    #[test]
    fn args_default() {
        let args = DescribeSecurityGroups {
            dry_run: None,
            group_ids: None,
            group_names: None,
            max_results: None,
            next_token: None,
        };
        assert!(args.dry_run.is_none());
        assert!(args.group_ids.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeSecurityGroupsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>edb7c570-be05-4192-bd1b-example</requestId>
    <securityGroupInfo></securityGroupInfo>
</DescribeSecurityGroupsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::Ec2Query,
            ))
            .build()
            .await;
        let client = aws_sdk_ec2::Client::new(&config);
        let result = describe_security_groups(
            &client,
            DescribeSecurityGroups {
                dry_run: None,
                group_ids: None,
                group_names: None,
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["securityGroups"].as_array().unwrap().len(), 0);
    }
}

mod describe_subnets {
    use super::*;
    use crate::ec2::describe_subnets::{DescribeSubnets, describe_subnets};

    #[test]
    fn args_default() {
        let args = DescribeSubnets {
            dry_run: None,
            max_results: None,
            next_token: None,
            subnet_ids: None,
        };
        assert!(args.dry_run.is_none());
        assert!(args.subnet_ids.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeSubnetsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>1927e20c-0ed0-4a02-a6d7-d955fbd2d13c</requestId>
    <subnetSet></subnetSet>
</DescribeSubnetsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::Ec2Query,
            ))
            .build()
            .await;
        let client = aws_sdk_ec2::Client::new(&config);
        let result = describe_subnets(
            &client,
            DescribeSubnets {
                dry_run: None,
                max_results: None,
                next_token: None,
                subnet_ids: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["subnets"].as_array().unwrap().len(), 0);
    }
}

mod describe_vpcs {
    use super::*;
    use crate::ec2::describe_vpcs::{DescribeVpcs, describe_vpcs};

    #[test]
    fn args_default() {
        let args = DescribeVpcs {
            dry_run: None,
            max_results: None,
            next_token: None,
            vpc_ids: None,
        };
        assert!(args.dry_run.is_none());
        assert!(args.vpc_ids.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeVpcsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
    <requestId>8b67ac77-886c-4027-8f0e-d351f7fc9971</requestId>
    <vpcSet></vpcSet>
</DescribeVpcsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::Ec2Query,
            ))
            .build()
            .await;
        let client = aws_sdk_ec2::Client::new(&config);
        let result = describe_vpcs(
            &client,
            DescribeVpcs {
                dry_run: None,
                max_results: None,
                next_token: None,
                vpc_ids: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["vpcs"].as_array().unwrap().len(), 0);
    }
}
