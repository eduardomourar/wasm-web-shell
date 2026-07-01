use anyhow::{Error, Result};
use aws_sdk_glacier::Client;
use clap::Args;

/// Arguments for `glacier list-vaults`.
#[derive(Debug, Clone, Args)]
pub struct ListVaults {
    /// The <code>AccountId</code> value is the AWS account ID. This value must match...
    #[arg(long)]
    pub account_id: String,
    /// The maximum number of vaults to be returned. The default limit is 10. The num...
    #[arg(long)]
    pub limit: Option<i32>,
    /// A string used for pagination. The marker specifies the vault ARN after which the
    #[arg(long)]
    pub marker: Option<String>,
}

/// Execute `glacier list-vaults`.
pub(crate) async fn list_vaults(
    client: &Client,
    args: ListVaults,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListVaults` operation to AWS SDK");
    let mut req = client.list_vaults();
    req = req.account_id(&args.account_id);
    if let Some(val) = args.limit {
        req = req.limit(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "marker": resp.marker(),
    "vaultList": resp.vault_list().iter().map(|v| serde_json::json!({
    "creationDate": v.creation_date(),
    "lastInventoryDate": v.last_inventory_date(),
    "numberOfArchives": v.number_of_archives(),
    "sizeInBytes": v.size_in_bytes(),
    "vaultArn": v.vault_arn(),
    "vaultName": v.vault_name(),
    })).collect::<Vec<_>>(),
    }))
}
