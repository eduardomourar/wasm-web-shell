use anyhow::{Error, Result};
use aws_sdk_iam::Client;
use clap::Args;

/// Arguments for `iam list-policies`.
#[derive(Debug, Clone, Args)]
pub struct ListPolicies {
    /// Use this parameter only when paginating results and only after
    #[arg(long)]
    pub marker: Option<String>,
    /// Use this only when paginating results to indicate the
    #[arg(long)]
    pub max_items: Option<i32>,
    /// A flag to filter the results to only the attached policies.
    #[arg(long)]
    pub only_attached: Option<bool>,
    /// The path prefix for filtering the results. This parameter is optional. If it ...
    #[arg(long)]
    pub path_prefix: Option<String>,
    /// The policy usage method to use for filtering the results.
    #[arg(long)]
    pub policy_usage_filter: Option<String>,
    /// The scope to use for filtering the results.
    #[arg(long)]
    pub scope: Option<String>,
}

/// Execute `iam list-policies`.
pub(crate) async fn list_policies(
    client: &Client,
    args: ListPolicies,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListPolicies` operation to AWS SDK");
    let mut req = client.list_policies();
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    if let Some(val) = args.only_attached {
        req = req.only_attached(val);
    }
    if let Some(ref val) = args.path_prefix {
        req = req.path_prefix(val);
    }
    if let Some(ref val) = args.policy_usage_filter {
        req = req.policy_usage_filter(val.as_str().into());
    }
    if let Some(ref val) = args.scope {
        req = req.scope(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "isTruncated": resp.is_truncated(),
    "marker": resp.marker(),
    "policies": resp.policies().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "attachmentCount": v.attachment_count(),
    "createDate": v.create_date().map(|t| t.to_string()),
    "defaultVersionId": v.default_version_id(),
    "description": v.description(),
    "isAttachable": v.is_attachable(),
    "path": v.path(),
    "permissionsBoundaryUsageCount": v.permissions_boundary_usage_count(),
    "policyId": v.policy_id(),
    "policyName": v.policy_name(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "updateDate": v.update_date().map(|t| t.to_string()),
    })).collect::<Vec<_>>(),
    }))
}
