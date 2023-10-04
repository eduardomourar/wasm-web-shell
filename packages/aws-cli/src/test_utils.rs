#![cfg(test)]
//! Test utilities for mocking AWS SDK operations
//!
//! This module provides:
//! - Test-only credentials provider that doesn't rely on the WASM adapter
//! - HTTP client mocking using aws-smithy-http-client test-util
//! - Helper functions for building test configurations
//!
//! Tests run on native target for fast iteration with mocked HTTP.

use aws_config::{BehaviorVersion, Region, SdkConfig};
use aws_credential_types::{
    Credentials,
    provider::{ProvideCredentials as ProvideCredentialsTrait, future::ProvideCredentials},
};
use aws_smithy_async::rt::sleep::TokioSleep;
use aws_smithy_http_client::test_util::{ReplayEvent, StaticReplayClient};
use aws_smithy_runtime_api::client::http::{HttpClient, SharedHttpClient};
use aws_smithy_types::body::SdkBody;

// Re-export tokio::test
pub use tokio::test as async_test;

/// Test-only credentials provider
///
/// Returns fixed test credentials without requiring the credentials-adapter component.
/// This allows unit tests to run without WASM component composition.
#[derive(Debug, Clone)]
pub struct TestCredentialsProvider {
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

impl Default for TestCredentialsProvider {
    fn default() -> Self {
        Self {
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
            session_token: None,
        }
    }
}

impl TestCredentialsProvider {
    pub fn with_session_token(mut self, token: String) -> Self {
        self.session_token = Some(token);
        self
    }
}

impl ProvideCredentialsTrait for TestCredentialsProvider {
    fn provide_credentials<'a>(&'a self) -> ProvideCredentials<'a>
    where
        Self: 'a,
    {
        ProvideCredentials::ready(Ok(Credentials::new(
            &self.access_key_id,
            &self.secret_access_key,
            self.session_token.clone(),
            None,
            "test-credentials",
        )))
    }
}

/// Builder for creating test SDK configurations with mocked HTTP clients
pub struct TestConfigBuilder {
    region: Region,
    http_client: Option<SharedHttpClient>,
    credentials_provider: Option<TestCredentialsProvider>,
}

impl Default for TestConfigBuilder {
    fn default() -> Self {
        Self {
            region: Region::new("us-east-2"),
            http_client: None,
            credentials_provider: Some(TestCredentialsProvider::default()),
        }
    }
}

impl TestConfigBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn region(mut self, region: impl Into<String>) -> Self {
        self.region = Region::new(region.into());
        self
    }

    pub fn http_client(mut self, client: impl HttpClient + 'static) -> Self {
        self.http_client = Some(SharedHttpClient::new(client));
        self
    }

    pub fn replay_client(self, events: Vec<ReplayEvent>) -> Self {
        let client = StaticReplayClient::new(events);
        self.http_client(client)
    }

    pub fn replay_event(self, event: ReplayEvent) -> Self {
        self.replay_client(vec![event])
    }

    pub fn no_credentials(mut self) -> Self {
        self.credentials_provider = None;
        self
    }

    pub async fn build(self) -> SdkConfig {
        let mut config_builder = aws_config::defaults(BehaviorVersion::latest())
            .region(self.region)
            .sleep_impl(TokioSleep::new());

        if let Some(http_client) = self.http_client {
            config_builder = config_builder.http_client(http_client);
        }

        if let Some(creds_provider) = self.credentials_provider {
            config_builder = config_builder.credentials_provider(creds_provider);
        } else {
            config_builder = config_builder.no_credentials();
        }

        config_builder.load().await
    }
}

/// Helper to create a ReplayEvent for mocking HTTP requests
///
/// Creates a simple ReplayEvent with an empty request and the given response.
/// The request details don't matter for the replay client - it will return
/// the response regardless of the request.
pub fn replay_event(status_code: u16, body: impl Into<String>) -> ReplayEvent {
    let request = http::Request::builder()
        .uri("https://aws.amazon.com/")
        .body(SdkBody::empty())
        .unwrap();

    let body_str = body.into();
    let content_length = body_str.len();
    let response = http::Response::builder()
        .status(status_code)
        .header("content-length", content_length.to_string())
        .body(SdkBody::from(body_str))
        .unwrap();

    ReplayEvent::new(request, response)
}

/// Helper to create a mock XML response for S3
pub fn mock_s3_list_objects_response(keys: &[&str]) -> String {
    let objects = keys
        .iter()
        .map(|key| {
            format!(
                r#"<Contents>
                    <Key>{}</Key>
                    <Size>1024</Size>
                    <LastModified>2024-01-01T00:00:00.000Z</LastModified>
                </Contents>"#,
                key
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
            <Name>test-bucket</Name>
            <Prefix></Prefix>
            <MaxKeys>1000</MaxKeys>
            <IsTruncated>false</IsTruncated>
            {}
        </ListBucketResult>"#,
        objects
    )
}

/// Helper to create a mock XML response for STS GetCallerIdentity
pub fn mock_sts_get_caller_identity_response(account: &str, arn: &str, user_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
        <GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
            <GetCallerIdentityResult>
                <Account>{}</Account>
                <Arn>{}</Arn>
                <UserId>{}</UserId>
            </GetCallerIdentityResult>
            <ResponseMetadata>
                <RequestId>test-request-id</RequestId>
            </ResponseMetadata>
        </GetCallerIdentityResponse>"#,
        account, arn, user_id
    )
}

/// Helper to create a mock JSON response for SSM
pub fn mock_ssm_list_parameters_response(parameters: &[(&str, &str)]) -> String {
    let params = parameters
        .iter()
        .map(|(name, value)| {
            serde_json::json!({
                "Name": name,
                "Type": "String",
                "Value": value,
                "Version": 1,
                "LastModifiedDate": 1640000000.0,
                "ARN": format!("arn:aws:ssm:us-east-2:123456789012:parameter{}", name)
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "Parameters": params
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[async_test]
    async fn test_credentials_provider_default() {
        let provider = TestCredentialsProvider::default();
        let creds = provider
            .provide_credentials()
            .await
            .expect("should provide credentials");

        assert_eq!(creds.access_key_id(), "AKIAIOSFODNN7EXAMPLE");
        assert_eq!(
            creds.secret_access_key(),
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
        );
        assert_eq!(creds.session_token(), None);
    }

    #[async_test]
    async fn test_credentials_provider_with_session_token() {
        let provider =
            TestCredentialsProvider::default().with_session_token("test-session-token".to_string());

        let creds = provider
            .provide_credentials()
            .await
            .expect("should provide credentials");

        assert_eq!(creds.session_token(), Some("test-session-token"));
    }

    #[async_test]
    async fn test_config_builder_default() {
        let config = TestConfigBuilder::new().build().await;

        assert_eq!(config.region().unwrap().as_ref(), "us-east-2");
    }

    #[async_test]
    async fn test_config_builder_custom_region() {
        let config = TestConfigBuilder::new().region("us-west-2").build().await;

        assert_eq!(config.region().unwrap().as_ref(), "us-west-2");
    }

    #[async_test]
    async fn test_mock_responses() {
        let s3_xml = mock_s3_list_objects_response(&["file1.txt", "file2.txt"]);
        assert!(s3_xml.contains("file1.txt"));
        assert!(s3_xml.contains("file2.txt"));

        let sts_xml = mock_sts_get_caller_identity_response(
            "123456789012",
            "arn:aws:iam::123456789012:user/test",
            "AIDAI123456789EXAMPLE",
        );
        assert!(sts_xml.contains("123456789012"));
        assert!(sts_xml.contains("arn:aws:iam::123456789012:user/test"));

        let ssm_json = mock_ssm_list_parameters_response(&[
            ("/test/param1", "value1"),
            ("/test/param2", "value2"),
        ]);
        assert!(ssm_json.contains("/test/param1"));
        assert!(ssm_json.contains("value1"));
    }
}
