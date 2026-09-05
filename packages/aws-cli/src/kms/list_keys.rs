use anyhow::{Error, Result};
use aws_sdk_kms::Client;
use clap::Args;

/// Arguments for `kms list-keys`.
#[derive(Debug, Clone, Args)]
pub struct ListKeys {
    /// Use this parameter to specify the maximum number of items to return. When this
    #[arg(long)]
    pub limit: Option<i32>,
    /// Use this parameter in a subsequent request after you receive a response with
    #[arg(long)]
    pub marker: Option<String>,
}

/// Execute `kms list-keys`.
pub(crate) async fn list_keys(client: &Client, args: ListKeys) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListKeys` operation to AWS SDK");
    let mut req = client.list_keys();
    if let Some(val) = args.limit {
        req = req.limit(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "keys": resp.keys().iter().map(|v| serde_json::json!({
    "keyArn": v.key_arn(),
    "keyId": v.key_id(),
    })).collect::<Vec<_>>(),
    "nextMarker": resp.next_marker(),
    "truncated": resp.truncated(),
    }))
}
