use anyhow::{Error, Result};
use aws_sdk_iam::Client;
use clap::Args;

/// Arguments for `iam list-roles`.
#[derive(Debug, Clone, Args)]
pub struct ListRoles {
    /// Use this parameter only when paginating results and only after
    #[arg(long)]
    pub marker: Option<String>,
    /// Use this only when paginating results to indicate the
    #[arg(long)]
    pub max_items: Option<i32>,
    ///  The path prefix for filtering the results. For example, the prefix
    #[arg(long)]
    pub path_prefix: Option<String>,
}

/// Execute `iam list-roles`.
pub(crate) async fn list_roles(
    client: &Client,
    args: ListRoles,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListRoles` operation to AWS SDK");
    let mut req = client.list_roles();
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    if let Some(ref val) = args.path_prefix {
        req = req.path_prefix(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "roles": resp.roles().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "assumeRolePolicyDocument": v.assume_role_policy_document(),
    "createDate": v.create_date().to_string(),
    "description": v.description(),
    "maxSessionDuration": v.max_session_duration(),
    "path": v.path(),
    "roleId": v.role_id(),
    "roleName": v.role_name(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    })).collect::<Vec<_>>(),
    "isTruncated": resp.is_truncated(),
    "marker": resp.marker(),
    }))
}
