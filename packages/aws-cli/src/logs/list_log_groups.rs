use anyhow::{Error, Result};
use aws_sdk_cloudwatchlogs::Client;
use clap::Args;

/// Arguments for `logs list-log-groups`.
#[derive(Debug, Clone, Args)]
pub struct ListLogGroups {
    /// When <code>includeLinkedAccounts</code> is set to <code>true</code>, use this...
    #[arg(long)]
    pub account_identifiers: Option<Vec<String>>,
    /// An array of field index names to filter log groups that have specific field i...
    #[arg(long)]
    pub field_index_names: Option<Vec<String>>,
    /// If you are using a monitoring account, set this to <code>true</code> to have ...
    #[arg(long)]
    pub include_linked_accounts: Option<bool>,
    /// The maximum number of log groups to return. If you omit this parameter, the d...
    #[arg(long)]
    pub limit: Option<i32>,
    /// Use this parameter to limit the results to only those log groups in the speci...
    #[arg(long)]
    pub log_group_class: Option<String>,
    /// Use this parameter to limit the returned log groups to only those with names ...
    #[arg(long)]
    pub log_group_name_pattern: Option<String>,
    /// nextToken
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `logs list-log-groups`.
pub(crate) async fn list_log_groups(
    client: &Client,
    args: ListLogGroups,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListLogGroups` operation to AWS SDK");
    let mut req = client.list_log_groups();
    if let Some(val) = args.account_identifiers {
        req = req.set_account_identifiers(Some(val));
    }
    if let Some(val) = args.field_index_names {
        req = req.set_field_index_names(Some(val));
    }
    if let Some(val) = args.include_linked_accounts {
        req = req.include_linked_accounts(val);
    }
    if let Some(val) = args.limit {
        req = req.limit(val);
    }
    if let Some(ref val) = args.log_group_class {
        req = req.log_group_class(val.as_str().into());
    }
    if let Some(ref val) = args.log_group_name_pattern {
        req = req.log_group_name_pattern(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "logGroups": resp.log_groups().iter().map(|v| serde_json::json!({
    "logGroupArn": v.log_group_arn(),
    "logGroupClass": v.log_group_class().map(|e| e.as_str()),
    "logGroupName": v.log_group_name(),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    }))
}
