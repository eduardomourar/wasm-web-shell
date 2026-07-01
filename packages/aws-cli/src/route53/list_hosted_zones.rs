use anyhow::{Error, Result};
use aws_sdk_route53::Client;
use clap::Args;

/// Arguments for `route53 list-hosted-zones`.
#[derive(Debug, Clone, Args)]
pub struct ListHostedZones {
    /// If you're using reusable delegation sets and you want to list all of the host...
    #[arg(long)]
    pub delegation_set_id: Option<String>,
    /// HostedZoneType
    #[arg(long)]
    pub hosted_zone_type: Option<String>,
    /// If the value of <code>IsTruncated</code> in the previous response was
    #[arg(long)]
    pub marker: Option<String>,
    /// (Optional) The maximum number of hosted zones that you want Amazon Route 53 t...
    #[arg(long)]
    pub max_items: Option<i32>,
}

/// Execute `route53 list-hosted-zones`.
pub(crate) async fn list_hosted_zones(
    client: &Client,
    args: ListHostedZones,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListHostedZones` operation to AWS SDK");
    let mut req = client.list_hosted_zones();
    if let Some(ref val) = args.delegation_set_id {
        req = req.delegation_set_id(val);
    }
    if let Some(ref val) = args.hosted_zone_type {
        req = req.hosted_zone_type(val.as_str().into());
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "hostedZones": resp.hosted_zones().iter().map(|v| serde_json::json!({
    "callerReference": v.caller_reference(),
    "id": v.id(),
    "name": v.name(),
    "resourceRecordSetCount": v.resource_record_set_count(),
    })).collect::<Vec<_>>(),
    "isTruncated": resp.is_truncated(),
    "marker": resp.marker(),
    "maxItems": resp.max_items(),
    "nextMarker": resp.next_marker(),
    }))
}
