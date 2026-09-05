use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event, replay_event_with_protocol,
};

mod list_clusters {
    use super::*;
    use crate::ecs::list_clusters::{ListClusters, list_clusters};

    #[test]
    fn args_default() {
        let args = ListClusters {
            max_results: None,
            next_token: None,
        };
        assert!(args.max_results.is_none());
        assert!(args.next_token.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"clusterArns":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_ecs::Client::new(&config);
        let result = list_clusters(
            &client,
            ListClusters {
                max_results: None,
                next_token: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["clusterArns"].as_array().unwrap().len(), 0);
    }
}

mod list_services {
    use super::*;
    use crate::ecs::list_services::{ListServices, list_services};

    #[test]
    fn args_default() {
        let args = ListServices {
            cluster: None,
            launch_type: None,
            max_results: None,
            next_token: None,
            resource_management_type: None,
            scheduling_strategy: None,
        };
        assert!(args.resource_management_type.is_none());
        assert!(args.scheduling_strategy.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"serviceArns":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::AwsJson1_1,
            ))
            .build()
            .await;
        let client = aws_sdk_ecs::Client::new(&config);
        let result = list_services(
            &client,
            ListServices {
                cluster: None,
                launch_type: None,
                max_results: None,
                next_token: None,
                resource_management_type: None,
                scheduling_strategy: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["serviceArns"].as_array().unwrap().len(), 0);
    }
}

mod list_tasks {
    use super::*;
    use crate::ecs::list_tasks::{ListTasks, list_tasks};

    #[test]
    fn args_default() {
        let args = ListTasks {
            cluster: None,
            container_instance: None,
            daemon_name: None,
            desired_status: None,
            family: None,
            launch_type: None,
            max_results: None,
            next_token: None,
            service_name: None,
            started_by: None,
        };
        assert!(args.cluster.is_none());
        assert!(args.service_name.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"taskArns":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, json_resp))
            .build()
            .await;
        let client = aws_sdk_ecs::Client::new(&config);
        let result = list_tasks(
            &client,
            ListTasks {
                cluster: None,
                container_instance: None,
                daemon_name: None,
                desired_status: None,
                family: None,
                launch_type: None,
                max_results: None,
                next_token: None,
                service_name: None,
                started_by: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["taskArns"].as_array().unwrap().len(), 0);
    }
}
