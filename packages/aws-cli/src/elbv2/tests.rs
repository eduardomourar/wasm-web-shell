use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_load_balancers {
    use super::*;
    use crate::elbv2::describe_load_balancers::{DescribeLoadBalancers, describe_load_balancers};

    #[test]
    fn args_default() {
        let args = DescribeLoadBalancers {
            load_balancer_arns: None,
            marker: None,
            names: None,
            page_size: None,
        };
        assert!(args.load_balancer_arns.is_none());
        assert!(args.names.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeLoadBalancersResponse xmlns="http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/">
    <DescribeLoadBalancersResult>
        <LoadBalancers></LoadBalancers>
    </DescribeLoadBalancersResult>
</DescribeLoadBalancersResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_elasticloadbalancingv2::Client::new(&config);
        let result = describe_load_balancers(
            &client,
            DescribeLoadBalancers {
                load_balancer_arns: None,
                marker: None,
                names: None,
                page_size: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["loadBalancers"].as_array().unwrap().len(), 0);
    }
}

mod describe_target_groups {
    use super::*;
    use crate::elbv2::describe_target_groups::{DescribeTargetGroups, describe_target_groups};

    #[test]
    fn args_default() {
        let args = DescribeTargetGroups {
            load_balancer_arn: None,
            marker: None,
            names: None,
            page_size: None,
            target_group_arns: None,
        };
        assert!(args.page_size.is_none());
        assert!(args.target_group_arns.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DescribeTargetGroupsResponse xmlns="http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/">
    <DescribeTargetGroupsResult>
        <TargetGroups></TargetGroups>
    </DescribeTargetGroupsResult>
</DescribeTargetGroupsResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_elasticloadbalancingv2::Client::new(&config);
        let result = describe_target_groups(
            &client,
            DescribeTargetGroups {
                load_balancer_arn: None,
                marker: None,
                names: None,
                page_size: None,
                target_group_arns: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["targetGroups"].as_array().unwrap().len(), 0);
    }
}
