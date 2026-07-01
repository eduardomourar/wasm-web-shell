use anyhow::{Error, Result};
use aws_config::{BehaviorVersion, Region, SdkConfig, meta::region::RegionProviderChain};
use aws_credential_types::{attributes::AccountId, provider::ProvideCredentials};
use aws_smithy_async::rt::sleep::TokioSleep;
use aws_smithy_wasm::wasi::WasiHttpClientBuilder;
use clap::{ArgAction, Args};
use std::time::{Duration, UNIX_EPOCH};

use crate::bindings::component::aws_cli::providers::{
    Credentials, CredentialsError, provide_credentials, provide_region,
};

const HOST_CREDENTIALS: &str = "Host";

impl From<Credentials> for aws_credential_types::Credentials {
    fn from(val: Credentials) -> Self {
        let mut builder = aws_credential_types::Credentials::builder()
            .access_key_id(&val.access_key_id)
            .secret_access_key(&val.secret_access_key)
            .provider_name(HOST_CREDENTIALS);
        builder.set_session_token(val.session_token);
        builder.set_expiry(
            val.expires_after
                .map(|v| UNIX_EPOCH + Duration::from_secs(v)),
        );
        builder.set_account_id(val.account_id.map(AccountId::from));
        builder.build()
    }
}

impl From<CredentialsError> for aws_credential_types::provider::error::CredentialsError {
    fn from(val: CredentialsError) -> Self {
        match val {
            CredentialsError::CredentialsNotLoaded => {
                aws_credential_types::provider::error::CredentialsError::not_loaded(val)
            }
            CredentialsError::ProviderTimedOut(timeout) => {
                aws_credential_types::provider::error::CredentialsError::provider_timed_out(
                    Duration::from_secs(timeout.duration),
                )
            }
            CredentialsError::InvalidConfiguration => {
                aws_credential_types::provider::error::CredentialsError::invalid_configuration(val)
            }
            CredentialsError::ProviderError => {
                aws_credential_types::provider::error::CredentialsError::provider_error(val)
            }
            CredentialsError::Unhandled => {
                aws_credential_types::provider::error::CredentialsError::unhandled(val)
            }
        }
    }
}

#[derive(Debug, Default)]
struct DefaultCredentialsProvider {
    // Identifier for the AWS service to request credentials
    service_id: Option<String>,
}

impl ProvideCredentials for DefaultCredentialsProvider {
    fn provide_credentials<'a>(
        &'a self,
    ) -> aws_credential_types::provider::future::ProvideCredentials<'a>
    where
        Self: 'a,
    {
        aws_credential_types::provider::future::ProvideCredentials::ready(
            provide_credentials(self.service_id.as_deref())
                .map(aws_credential_types::Credentials::from)
                .map_err(aws_credential_types::provider::error::CredentialsError::from),
        )
    }

    fn fallback_on_interrupt(&self) -> Option<aws_credential_types::Credentials> {
        None
    }
}

#[derive(Debug, Clone, Args)]
pub struct BaseOpts {
    /// The region to use. Overrides config/env settings.
    #[arg(long, global = true)]
    pub region: Option<String>,

    /// Do not sign requests. Credentials will not be loaded if this argument is provided.
    #[arg(long, global = true, default_value_t = false)]
    pub no_sign_request: bool,

    /// Whether to display additional information.
    #[arg(short = 'v', action = ArgAction::Count, global = true, default_value_t = 0)]
    pub verbose: u8,
}

pub(crate) async fn build_config(
    service_id: Option<String>,
    BaseOpts {
        region,
        no_sign_request,
        ..
    }: BaseOpts,
) -> Result<SdkConfig, Error> {
    tracing::trace!("Building default client");

    let http_client = WasiHttpClientBuilder::new().build();

    let region_provider = RegionProviderChain::first_try(Region::new(
        provide_region(region.as_deref()).unwrap_or("us-east-1".to_string()),
    ));
    tracing::debug!("AWS client region: {:?}", region_provider.region().await);

    let mut base_config = aws_config::defaults(BehaviorVersion::latest())
        .http_client(http_client)
        .sleep_impl(TokioSleep::new())
        .timeout_config(
            aws_config::timeout::TimeoutConfig::builder()
                .connect_timeout(Duration::from_secs(30))
                .read_timeout(Duration::from_secs(60))
                .operation_timeout(Duration::from_secs(120))
                .operation_attempt_timeout(Duration::from_secs(90))
                .build(),
        )
        .stalled_stream_protection(
            aws_config::stalled_stream_protection::StalledStreamProtectionConfig::disabled(),
        )
        .region(region_provider);
    base_config = if no_sign_request {
        base_config.no_credentials()
    } else {
        base_config.credentials_provider(DefaultCredentialsProvider { service_id })
    };
    let shared_config = base_config.load().await;

    tracing::debug!("AWS client config: {:?}", shared_config);

    Ok(shared_config)
}

#[cfg(test)]
mod test {
    use super::BaseOpts;
    use crate::test_utils::{TestConfigBuilder, async_test};
    use anyhow::{Error, Result};
    use aws_config::SdkConfig;

    impl Default for BaseOpts {
        fn default() -> Self {
            Self {
                region: Some("us-east-2".to_string()),
                no_sign_request: false,
                verbose: 0,
            }
        }
    }

    async fn build_config(
        BaseOpts {
            region,
            no_sign_request,
            ..
        }: BaseOpts,
    ) -> Result<SdkConfig, Error> {
        let mut base_config = TestConfigBuilder::new().region(region.unwrap());
        if no_sign_request {
            base_config = base_config.no_credentials();
        }
        let shared_config = base_config.build().await;
        Ok(shared_config)
    }

    #[async_test]
    async fn test_default_config() {
        let config = build_config(BaseOpts::default()).await.unwrap();
        assert_eq!(config.region().unwrap().as_ref(), "us-east-2");
    }

    #[async_test]
    async fn test_custom_region() {
        let config = build_config(BaseOpts {
            region: Some("us-west-1".to_string()),
            ..BaseOpts::default()
        })
        .await
        .unwrap();

        assert_eq!(config.region().unwrap().as_ref(), "us-west-1");
    }

    #[async_test]
    async fn test_no_credentials() {
        let config = build_config(BaseOpts {
            no_sign_request: true,
            ..BaseOpts::default()
        })
        .await
        .unwrap();
        // Config should be created successfully even without credentials
        assert!(config.region().is_some());
    }
}
