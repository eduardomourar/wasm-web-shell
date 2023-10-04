#[allow(warnings)]
mod bindings;

use bindings::exports::component::aws_cli::credentials_provider::{
    Credentials, CredentialsError, Guest,
};
use bindings::wasi::cli::environment;

struct Component;

impl Guest for Component {
    fn provide_credentials() -> Result<Credentials, CredentialsError> {
        // Read environment variables
        let env_vars = environment::get_environment();

        // Find AWS credentials in environment
        let mut access_key_id: Option<String> = None;
        let mut secret_access_key: Option<String> = None;
        let mut session_token: Option<String> = None;
        let mut account_id: Option<String> = None;

        for (key, value) in env_vars {
            match key.as_str() {
                "AWS_ACCESS_KEY_ID" => access_key_id = Some(value),
                "AWS_SECRET_ACCESS_KEY" => secret_access_key = Some(value),
                "AWS_SESSION_TOKEN" => session_token = Some(value),
                "AWS_ACCOUNT_ID" => account_id = Some(value),
                _ => {}
            }
        }

        Ok(Credentials {
            access_key_id: access_key_id.ok_or(CredentialsError::CredentialsNotLoaded)?,
            secret_access_key: secret_access_key.ok_or(CredentialsError::CredentialsNotLoaded)?,
            session_token,
            expires_after: None,
            account_id,
        })
    }
}

bindings::export!(Component with_types_in bindings);
