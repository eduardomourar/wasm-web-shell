use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_alarms {
    use super::*;
    use crate::cloudwatch::describe_alarms::{DescribeAlarms, describe_alarms};

    #[test]
    fn args_default() {
        let args = DescribeAlarms {
            action_prefix: None,
            alarm_name_prefix: None,
            alarm_names: None,
            alarm_types: None,
            children_of_alarm_name: None,
            max_records: None,
            next_token: None,
            parents_of_alarm_name: None,
            state_value: None,
        };
        assert!(args.action_prefix.is_none());
        assert!(args.max_records.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"CompositeAlarms":[],"MetricAlarms":[],"LogAlarms":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RpcV2Cbor,
            ))
            .build()
            .await;
        let client = aws_sdk_cloudwatch::Client::new(&config);
        let result = describe_alarms(
            &client,
            DescribeAlarms {
                action_prefix: None,
                alarm_name_prefix: None,
                alarm_names: None,
                alarm_types: None,
                children_of_alarm_name: None,
                max_records: None,
                next_token: None,
                parents_of_alarm_name: None,
                state_value: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["compositeAlarms"].as_array().unwrap().len(), 0);
        assert_eq!(val["metricAlarms"].as_array().unwrap().len(), 0);
        assert_eq!(val["logAlarms"].as_array().unwrap().len(), 0);
    }
}

mod list_metrics {
    use super::*;
    use crate::cloudwatch::list_metrics::{ListMetrics, list_metrics};

    #[test]
    fn args_default() {
        let args = ListMetrics {
            include_linked_accounts: None,
            metric_name: None,
            namespace: None,
            next_token: None,
            owning_account: None,
            recently_active: None,
        };
        assert!(args.metric_name.is_none());
        assert!(args.namespace.is_none());
        assert!(args.next_token.is_none());
    }

    #[test]
    fn args_with_values() {
        let args = ListMetrics {
            include_linked_accounts: None,
            metric_name: Some("CPUUtilization".to_string()),
            namespace: Some("AWS/EC2".to_string()),
            next_token: None,
            owning_account: None,
            recently_active: None,
        };
        assert_eq!(args.namespace.unwrap(), "AWS/EC2");
        assert_eq!(args.metric_name.unwrap(), "CPUUtilization");
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"Metrics":[],"OwningAccounts":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RpcV2Cbor,
            ))
            .build()
            .await;
        let client = aws_sdk_cloudwatch::Client::new(&config);
        let result = list_metrics(
            &client,
            ListMetrics {
                include_linked_accounts: None,
                metric_name: None,
                namespace: None,
                next_token: None,
                owning_account: None,
                recently_active: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["metrics"].as_array().unwrap().len(), 0);
    }
}
