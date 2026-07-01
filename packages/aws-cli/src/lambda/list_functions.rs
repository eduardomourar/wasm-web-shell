use anyhow::{Error, Result};
use aws_sdk_lambda::Client;
use clap::Args;

/// Arguments for `lambda list-functions`.
#[derive(Debug, Clone, Args)]
pub struct ListFunctions {
    /// Set to <code>ALL</code> to include entries for all published versions of each...
    #[arg(long)]
    pub function_version: Option<String>,
    /// Specify the pagination token that's returned by a previous request to retriev...
    #[arg(long)]
    pub marker: Option<String>,
    /// For Lambda@Edge functions, the Amazon Web Services Region of the master funct...
    #[arg(long)]
    pub master_region: Option<String>,
    /// The maximum number of functions to return in the response. Note that <code>Li...
    #[arg(long)]
    pub max_items: Option<i32>,
}

/// Execute `lambda list-functions`.
pub(crate) async fn list_functions(
    client: &Client,
    args: ListFunctions,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListFunctions` operation to AWS SDK");
    let mut req = client.list_functions();
    if let Some(ref val) = args.function_version {
        req = req.function_version(val.as_str().into());
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(ref val) = args.master_region {
        req = req.master_region(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "functions": resp.functions().iter().map(|v| serde_json::json!({
    "architectures": v.architectures().iter().map(|e| e.as_str()).collect::<Vec<_>>(),
    "codeSha256": v.code_sha256(),
    "codeSize": v.code_size(),
    "configSha256": v.config_sha256(),
    "description": v.description(),
    "fileSystemConfigs": v.file_system_configs().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "functionArn": v.function_arn(),
    "functionName": v.function_name(),
    "handler": v.handler(),
    "kmsKeyArn": v.kms_key_arn(),
    "lastModified": v.last_modified(),
    "lastUpdateStatus": v.last_update_status().map(|e| e.as_str()),
    "lastUpdateStatusReason": v.last_update_status_reason(),
    "lastUpdateStatusReasonCode": v.last_update_status_reason_code().map(|e| e.as_str()),
    "layers": v.layers().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "masterArn": v.master_arn(),
    "memorySize": v.memory_size(),
    "packageType": v.package_type().map(|e| e.as_str()),
    "revisionId": v.revision_id(),
    "role": v.role(),
    "runtime": v.runtime().map(|e| e.as_str()),
    "signingJobArn": v.signing_job_arn(),
    "signingProfileVersionArn": v.signing_profile_version_arn(),
    "state": v.state().map(|e| e.as_str()),
    "stateReason": v.state_reason(),
    "stateReasonCode": v.state_reason_code().map(|e| e.as_str()),
    "timeout": v.timeout(),
    "version": v.version(),
    })).collect::<Vec<_>>(),
    "nextMarker": resp.next_marker(),
    }))
}
