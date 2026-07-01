use anyhow::{Error, Result};
use aws_sdk_ssm::Client;
use clap::Args;

/// Arguments for `ssm get-parameters-by-path`.
#[derive(Debug, Clone, Args)]
pub struct GetParametersByPath {
    /// The hierarchy for the parameter. Hierarchies start with a forward slash (/). ...
    #[arg(long)]
    pub path: String,
    /// The maximum number of items to return for this call. The call also returns a ...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// A token to start the list. Use this token to get the next set of results.
    #[arg(long)]
    pub next_token: Option<String>,
    /// Retrieve all parameters within a hierarchy.
    #[arg(long)]
    pub recursive: Option<bool>,
    /// Retrieve all parameters in a hierarchy with their value decrypted.
    #[arg(long)]
    pub with_decryption: Option<bool>,
}

/// Execute `ssm get-parameters-by-path`.
pub(crate) async fn get_parameters_by_path(
    client: &Client,
    args: GetParametersByPath,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `GetParametersByPath` operation to AWS SDK");
    let mut req = client.get_parameters_by_path();
    req = req.path(&args.path);
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(val) = args.recursive {
        req = req.recursive(val);
    }
    if let Some(val) = args.with_decryption {
        req = req.with_decryption(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "parameters": resp.parameters().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "dataType": v.data_type(),
    "lastModifiedDate": v.last_modified_date().map(|t| t.to_string()),
    "name": v.name(),
    "selector": v.selector(),
    "sourceResult": v.source_result(),
    "type": v.r#type().map(|e| e.as_str()),
    "value": v.value(),
    "version": v.version(),
    })).collect::<Vec<_>>(),
    }))
}
