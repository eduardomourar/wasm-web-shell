use anyhow::{Error, Result};
use aws_sdk_iam::Client;
use clap::Args;

/// Arguments for `iam list-users`.
#[derive(Debug, Clone, Args)]
pub struct ListUsers {
    /// Use this parameter only when paginating results and only after
    #[arg(long)]
    pub marker: Option<String>,
    /// Use this only when paginating results to indicate the
    #[arg(long)]
    pub max_items: Option<i32>,
    ///  The path prefix for filtering the results. For example:
    #[arg(long)]
    pub path_prefix: Option<String>,
}

/// Execute `iam list-users`.
pub(crate) async fn list_users(
    client: &Client,
    args: ListUsers,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListUsers` operation to AWS SDK");
    let mut req = client.list_users();
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
    "users": resp.users().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "createDate": v.create_date().to_string(),
    "passwordLastUsed": v.password_last_used().map(|t| t.to_string()),
    "path": v.path(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "userId": v.user_id(),
    "userName": v.user_name(),
    })).collect::<Vec<_>>(),
    "isTruncated": resp.is_truncated(),
    "marker": resp.marker(),
    }))
}
