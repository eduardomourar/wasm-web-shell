use anyhow::{Error, Result};
use aws_sdk_ec2::Client;
use clap::Args;

/// Arguments for `ec2 describe-instances`.
#[derive(Debug, Clone, Args)]
pub struct DescribeInstances {
    /// Checks whether you have the required permissions for the operation, without a...
    #[arg(long)]
    pub dry_run: Option<bool>,
    /// Indicates whether to include managed resources in the output. If this paramet...
    #[arg(long)]
    pub include_managed_resources: Option<bool>,
    /// The instance IDs.
    #[arg(long)]
    pub instance_ids: Option<Vec<String>>,
    /// The maximum number of items to return for this request.
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The token returned from a previous paginated request. Pagination continues fr...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `ec2 describe-instances`.
pub(crate) async fn describe_instances(
    client: &Client,
    args: DescribeInstances,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeInstances` operation to AWS SDK");
    let mut req = client.describe_instances();
    if let Some(val) = args.dry_run {
        req = req.dry_run(val);
    }
    if let Some(val) = args.include_managed_resources {
        req = req.include_managed_resources(val);
    }
    if let Some(val) = args.instance_ids {
        req = req.set_instance_ids(Some(val));
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "reservations": resp.reservations().iter().map(|v| serde_json::json!({
    "groups": v.groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "instances": v.instances().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ownerId": v.owner_id(),
    "requesterId": v.requester_id(),
    "reservationId": v.reservation_id(),
    })).collect::<Vec<_>>(),
    }))
}
