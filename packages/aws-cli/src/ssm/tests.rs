use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, mock_ssm_list_parameters_response, replay_event,
    replay_event_with_protocol,
};

mod get_parameters_by_path {
    use super::*;
    use crate::ssm::get_parameters_by_path::{GetParametersByPath, get_parameters_by_path};

    #[test]
    fn args_default() {
        let args = GetParametersByPath {
            path: "test".to_string(),
            max_results: None,
            next_token: None,
            recursive: None,
            with_decryption: None,
        };
        assert_eq!(args.path, "test");
        assert!(args.with_decryption.is_none());
    }

    #[async_test]
    async fn list_empty() {
        let mock_response = mock_ssm_list_parameters_response(&[]);
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                mock_response,
                SmithyProtocol::AwsJson1_0,
            ))
            .build()
            .await;
        let client = aws_sdk_ssm::Client::new(&config);
        let result = get_parameters_by_path(
            &client,
            GetParametersByPath {
                path: "test".to_string(),
                max_results: None,
                next_token: None,
                recursive: None,
                with_decryption: None,
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["parameters"].as_array().unwrap().len(), 0);
    }

    #[async_test]
    async fn list_success() {
        // Create mock HTTP response with SSM JSON
        let mock_response = mock_ssm_list_parameters_response(&[
            ("/parent-name/some-key-1", "some-value-1"),
            ("/parent-name/some-key-2", "some-value-2"),
        ]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_ssm::Client::new(&config);

        let result = get_parameters_by_path(
            &client,
            GetParametersByPath {
                path: "/parent-name".to_string(),
                max_results: Some(2),
                next_token: None,
                recursive: None,
                with_decryption: None,
            },
        )
        .await
        .unwrap();

        // Verify response contains expected parameters
        let result_str = result.to_string();
        assert!(result_str.contains("parent-name"));
        assert!(result_str.contains("some-value-1") || result_str.contains("some-value-2"));
    }
}

mod list_public_parameters {
    use super::*;
    use crate::ssm::list_public_parameters::{ListPublicParameters, list_public_parameters};

    #[async_test]
    async fn list_empty() {
        // Empty parameters response
        let mock_response = mock_ssm_list_parameters_response(&[]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_ssm::Client::new(&config);

        let result = list_public_parameters(
            &client,
            ListPublicParameters {
                max_items: Some(10),
            },
        )
        .await
        .unwrap();

        // Should return valid JSON even if empty
        let result_str = result.to_string();
        assert!(result_str.contains("[]") || result_str.contains("parameters"));
    }

    #[async_test]
    async fn list_success() {
        // Create mock HTTP response with SSM JSON
        let mock_response = mock_ssm_list_parameters_response(&[
            (
                "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2",
                "ami-12345678",
            ),
            (
                "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-arm64-gp2",
                "ami-87654321",
            ),
        ]);

        let config = TestConfigBuilder::new()
            .replay_event(replay_event(200, mock_response))
            .build()
            .await;

        let client = aws_sdk_ssm::Client::new(&config);

        let result = list_public_parameters(&client, ListPublicParameters { max_items: Some(2) })
            .await
            .unwrap();

        // Verify response contains expected parameters
        let result_str = result.to_string();
        assert!(result_str.contains("ami-amazon-linux-latest"));
        assert!(result_str.contains("ami-12345678") || result_str.contains("ami-87654321"));
    }
}
