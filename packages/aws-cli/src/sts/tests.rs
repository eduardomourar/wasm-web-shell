use crate::test_utils::{
    SmithyProtocol, TestConfigBuilder, async_test, mock_sts_get_caller_identity_response,
    replay_event_with_protocol,
};

mod get_parameters_by_path {
    use super::*;
    use crate::sts::get_caller_identity::{GetCallerIdentity, get_caller_identity};

    #[test]
    fn args_default() {
        let args = GetCallerIdentity { only_user_id: true };
        assert!(args.only_user_id);
    }

    #[async_test]
    async fn read_success() {
        // Create mock HTTP response
        let mock_response = mock_sts_get_caller_identity_response(
            "123456789012",
            "arn:aws:iam::123456789012:user/test-user",
            "AIDAI123456789EXAMPLE",
        );

        // Build config with mocked HTTP client
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                mock_response,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;

        let client = aws_sdk_sts::Client::new(&config);

        // Execute the operation
        let result = get_caller_identity(
            &client,
            GetCallerIdentity {
                only_user_id: false,
            },
        )
        .await
        .unwrap();

        // Verify the response
        assert_eq!(result["account"], "123456789012");
        assert_eq!(result["arn"], "arn:aws:iam::123456789012:user/test-user");
        assert_eq!(result["userId"], "AIDAI123456789EXAMPLE");
    }

    #[async_test]
    async fn read_only_user_id() {
        let mock_response = mock_sts_get_caller_identity_response(
            "123456789012",
            "arn:aws:iam::123456789012:user/test-user",
            "AIDAI123456789EXAMPLE",
        );

        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                mock_response,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;

        let client = aws_sdk_sts::Client::new(&config);

        let result = get_caller_identity(&client, GetCallerIdentity { only_user_id: true })
            .await
            .unwrap();

        // Should only contain userId
        assert_eq!(result["userId"], "AIDAI123456789EXAMPLE");
        assert!(result.get("account").is_none());
        assert!(result.get("arn").is_none());
    }
}

mod decode_authorization_message {
    use super::*;
    use crate::sts::decode_authorization_message::{
        DecodeAuthorizationMessage, decode_authorization_message,
    };

    #[test]
    fn args_default() {
        let args = DecodeAuthorizationMessage {
            encoded_message: "test".to_string(),
        };
        assert_eq!(args.encoded_message, "test");
    }

    #[async_test]
    async fn create_success() {
        let xml_resp = r#"<?xml version="1.0" encoding="UTF-8"?>
<DecodeAuthorizationMessageResponse xmlns="http://sts.amazonaws.com/doc/2011-06-15/">
    <DecodeAuthorizationMessageResult>
        <RequestId>6624a9ca-cd25-4f50-b2a5-7ba65bf07453</RequestId>
        <DecodedMessage>{"key":"value"}</DecodedMessage>
    </DecodeAuthorizationMessageResult>
</DecodeAuthorizationMessageResponse>"#;
        let config = TestConfigBuilder::new()
            .replay_event(replay_event_with_protocol(
                200,
                xml_resp,
                SmithyProtocol::AwsQuery,
            ))
            .build()
            .await;
        let client = aws_sdk_sts::Client::new(&config);
        let result = decode_authorization_message(
            &client,
            DecodeAuthorizationMessage {
                encoded_message: "test".to_string(),
            },
        )
        .await;
        assert!(result.is_ok());
        let val = result.unwrap();
        assert_eq!(val["decodedMessage"], "{\"key\":\"value\"}");
    }
}
