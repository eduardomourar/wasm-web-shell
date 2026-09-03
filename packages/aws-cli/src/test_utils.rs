#![cfg(test)]
//! Test utilities for mocking AWS SDK operations
//!
//! This module provides:
//! - Test-only credentials provider that doesn't rely on the WASM adapter
//! - HTTP client mocking using aws-smithy-http-client test-util
//! - Helper functions for building test configurations
//!
//! Tests run on native target for fast iteration with mocked HTTP.
//! `wstd`/WASI primitives (used by production code) cannot run outside a
//! real WASI host, so these tests use tokio instead.

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
/// Returns fixed test credentials without requiring the providers-adapter component.
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
        let _ = tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .with_test_writer() // IMPORTANT: Routes logs to cargo test's output
            .try_init();
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

/// AWS Smithy protocol variants used by different services.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SmithyProtocol {
    /// Smithy RPCv2 with CBOR encoding (newer services)
    RpcV2Cbor,
    /// Smithy RPCv2 with JSON encoding
    RpcV2Json,
    /// AWS JSON 1.0 (DynamoDB, SQS, etc.)
    AwsJson1_0,
    /// AWS JSON 1.1 (Lambda, ECS, EKS, CloudTrail, etc.)
    AwsJson1_1,
    /// AWS Query/XML (EC2, STS, IAM, CloudWatch, SNS, ELB, etc.)
    AwsQuery,
    /// EC2 Query (EC2-specific variant of awsQuery)
    Ec2Query,
    /// REST JSON 1 (API Gateway, S3 control, Glacier, etc.)
    RestJson1,
    /// REST XML (S3, CloudFront, Route53)
    RestXml,
}

impl SmithyProtocol {
    /// Returns the Content-Type header value for this protocol.
    pub fn content_type(&self) -> &'static str {
        match self {
            SmithyProtocol::RpcV2Cbor => "application/cbor",
            SmithyProtocol::RpcV2Json => "application/json",
            SmithyProtocol::AwsJson1_0 => "application/x-amz-json-1.0",
            SmithyProtocol::AwsJson1_1 => "application/x-amz-json-1.1",
            SmithyProtocol::AwsQuery => "text/xml",
            SmithyProtocol::Ec2Query => "text/xml",
            SmithyProtocol::RestJson1 => "application/json",
            SmithyProtocol::RestXml => "application/xml",
        }
    }

    /// Returns additional response headers needed for this protocol.
    pub fn response_headers(&self) -> Vec<(&'static str, &'static str)> {
        match self {
            SmithyProtocol::RpcV2Cbor => vec![("smithy-protocol", "rpc-v2-cbor")],
            SmithyProtocol::RpcV2Json => vec![("smithy-protocol", "rpc-v2-json")],
            SmithyProtocol::AwsJson1_0 => vec![],
            SmithyProtocol::AwsJson1_1 => vec![],
            SmithyProtocol::AwsQuery => vec![],
            SmithyProtocol::Ec2Query => vec![],
            SmithyProtocol::RestJson1 => vec![],
            SmithyProtocol::RestXml => vec![],
        }
    }
}

/// Helper to create a ReplayEvent for mocking HTTP requests.
///
/// Creates a simple ReplayEvent with an empty request and the given response.
/// The request details don't matter for the replay client — it will return
/// the response regardless of the request.
pub fn replay_event(status_code: u16, body: impl Into<String>) -> ReplayEvent {
    replay_event_with_protocol(status_code, body, SmithyProtocol::RestJson1)
}

/// Helper to create a ReplayEvent with a specific Smithy protocol.
///
/// Sets the correct Content-Type and protocol headers so the SDK
/// can deserialize the response body correctly.
///
/// # Protocol guide:
/// - `AwsQuery` / `Ec2Query`: use XML body (EC2, IAM, STS, CloudWatch, SNS, ELB, RDS)
/// - `AwsJson10`: use JSON body (DynamoDB, SQS)
/// - `AwsJson11`: use JSON body (Lambda, ECS, EKS, CloudTrail, KMS, Events, Athena)
/// - `RestJson1`: use JSON body (API Gateway, EFS, Glacier, Secrets Manager, Cognito)
/// - `RestXml`: use XML body (S3, CloudFront, Route53)
/// - `RpcV2Cbor`: use CBOR bytes (newer services — pass JSON and it will be converted)
pub fn replay_event_with_protocol(
    status_code: u16,
    body: impl Into<String>,
    protocol: SmithyProtocol,
) -> ReplayEvent {
    let request = http::Request::builder()
        .uri("https://aws.amazon.com/")
        .body(SdkBody::empty())
        .unwrap();

    let body_str = body.into();

    let response = if protocol == SmithyProtocol::RpcV2Cbor {
        // For RPC v2 CBOR: convert JSON input to CBOR bytes
        let cbor_bytes = json_to_cbor(&body_str);
        let content_length = cbor_bytes.len();
        let mut builder = http::Response::builder()
            .status(status_code)
            .header("content-type", protocol.content_type())
            .header("content-length", content_length.to_string());
        for (key, value) in protocol.response_headers() {
            builder = builder.header(key, value);
        }
        builder.body(SdkBody::from(cbor_bytes)).unwrap()
    } else {
        let content_length = body_str.len();
        let mut builder = http::Response::builder()
            .status(status_code)
            .header("content-type", protocol.content_type())
            .header("content-length", content_length.to_string());
        for (key, value) in protocol.response_headers() {
            builder = builder.header(key, value);
        }
        builder.body(SdkBody::from(body_str)).unwrap()
    };

    ReplayEvent::new(request, response)
}

/// Helper to create a ReplayEvent for RPC v2 CBOR protocol using raw bytes.
///
/// Use this when you already have pre-encoded CBOR bytes (e.g. from a captured response).
pub fn replay_event_cbor(status_code: u16, cbor_bytes: Vec<u8>) -> ReplayEvent {
    let request = http::Request::builder()
        .uri("https://aws.amazon.com/")
        .body(SdkBody::empty())
        .unwrap();

    let content_length = cbor_bytes.len();
    let response = http::Response::builder()
        .status(status_code)
        .header("content-type", "application/cbor")
        .header("smithy-protocol", "rpc-v2-cbor")
        .header("content-length", content_length.to_string())
        .body(SdkBody::from(cbor_bytes))
        .unwrap();

    ReplayEvent::new(request, response)
}

/// Convert a JSON string to CBOR bytes.
///
/// This is a minimal conversion for test purposes — handles the subset of
/// JSON structures typically found in AWS responses (objects, arrays, strings,
/// numbers, booleans, null).
fn json_to_cbor(json_str: &str) -> Vec<u8> {
    let value: serde_json::Value = serde_json::from_str(json_str).unwrap_or(serde_json::json!({}));
    encode_cbor_value(&value)
}

/// Encode a serde_json::Value as CBOR bytes (RFC 7049).
fn encode_cbor_value(value: &serde_json::Value) -> Vec<u8> {
    let mut buf = Vec::new();
    match value {
        serde_json::Value::Null => buf.push(0xf6), // CBOR null
        serde_json::Value::Bool(true) => buf.push(0xf5),
        serde_json::Value::Bool(false) => buf.push(0xf4),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= 0 {
                    encode_cbor_uint(&mut buf, 0, i as u64);
                } else {
                    encode_cbor_uint(&mut buf, 1, (-1 - i) as u64);
                }
            } else if let Some(f) = n.as_f64() {
                // Encode as 64-bit float
                buf.push(0xfb);
                buf.extend_from_slice(&f.to_be_bytes());
            }
        }
        serde_json::Value::String(s) => {
            let bytes = s.as_bytes();
            encode_cbor_uint(&mut buf, 3, bytes.len() as u64);
            buf.extend_from_slice(bytes);
        }
        serde_json::Value::Array(arr) => {
            encode_cbor_uint(&mut buf, 4, arr.len() as u64);
            for item in arr {
                buf.extend(encode_cbor_value(item));
            }
        }
        serde_json::Value::Object(map) => {
            encode_cbor_uint(&mut buf, 5, map.len() as u64);
            for (key, val) in map {
                // Encode key as text string
                let key_bytes = key.as_bytes();
                encode_cbor_uint(&mut buf, 3, key_bytes.len() as u64);
                buf.extend_from_slice(key_bytes);
                // Encode value
                buf.extend(encode_cbor_value(val));
            }
        }
    }
    buf
}

/// Encode a CBOR unsigned integer with the given major type (0-7).
fn encode_cbor_uint(buf: &mut Vec<u8>, major_type: u8, value: u64) {
    let mt = major_type << 5;
    if value < 24 {
        buf.push(mt | value as u8);
    } else if value <= 0xff {
        buf.push(mt | 24);
        buf.push(value as u8);
    } else if value <= 0xffff {
        buf.push(mt | 25);
        buf.extend_from_slice(&(value as u16).to_be_bytes());
    } else if value <= 0xffff_ffff {
        buf.push(mt | 26);
        buf.extend_from_slice(&(value as u32).to_be_bytes());
    } else {
        buf.push(mt | 27);
        buf.extend_from_slice(&value.to_be_bytes());
    }
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
