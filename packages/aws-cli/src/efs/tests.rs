use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, replay_event_with_protocol,
};

mod describe_file_systems {
    use super::*;
    use crate::efs::describe_file_systems::{DescribeFileSystems, describe_file_systems};

    #[test]
    fn args_default() {
        let args = DescribeFileSystems {
            creation_token: None,
            file_system_id: None,
            marker: None,
            max_items: None,
        };
        assert!(args.creation_token.is_none());
        assert!(args.file_system_id.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let json_resp = r#"{"FileSystems":[]}"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                json_resp,
                SmithyProtocol::RestJson1,
            ))
            .build()
            .await;
        let client = aws_sdk_efs::Client::new(&config);
        let result = describe_file_systems(
            &client,
            DescribeFileSystems {
                creation_token: None,
                file_system_id: None,
                marker: None,
                max_items: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["fileSystems"].as_array().unwrap().len(), 0);
    }
}
