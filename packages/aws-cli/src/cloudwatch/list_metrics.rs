use anyhow::{Error, Result};
use aws_sdk_cloudwatch::Client;
use clap::Args;

/// Arguments for `cloudwatch list-metrics`.
#[derive(Debug, Clone, Args)]
pub struct ListMetrics {
    /// If you are using this operation in a monitoring account, specify <code>true</...
    #[arg(long)]
    pub include_linked_accounts: Option<bool>,
    /// The name of the metric to filter against. Only the metrics with names that match
    #[arg(long)]
    pub metric_name: Option<String>,
    /// The metric namespace to filter against. Only the namespace that matches exactly
    #[arg(long)]
    pub namespace: Option<String>,
    /// The token returned by a previous call to indicate that there is more data
    #[arg(long)]
    pub next_token: Option<String>,
    /// When you use this operation in a monitoring account, use this field to return...
    #[arg(long)]
    pub owning_account: Option<String>,
    /// To filter the results to show only metrics that have had data points publishe...
    #[arg(long)]
    pub recently_active: Option<String>,
}

/// Execute `cloudwatch list-metrics`.
pub(crate) async fn list_metrics(
    client: &Client,
    args: ListMetrics,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListMetrics` operation to AWS SDK");
    let mut req = client.list_metrics();
    if let Some(val) = args.include_linked_accounts {
        req = req.include_linked_accounts(val);
    }
    if let Some(ref val) = args.metric_name {
        req = req.metric_name(val);
    }
    if let Some(ref val) = args.namespace {
        req = req.namespace(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(ref val) = args.owning_account {
        req = req.owning_account(val);
    }
    if let Some(ref val) = args.recently_active {
        req = req.recently_active(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "metrics": resp.metrics().iter().map(|v| serde_json::json!({
    "dimensions": v.dimensions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "metricName": v.metric_name(),
    "namespace": v.namespace(),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    "owningAccounts": resp.owning_accounts(),
    }))
}
