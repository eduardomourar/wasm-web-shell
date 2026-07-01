use anyhow::{Error, Result};
use aws_sdk_eventbridge::Client;
use clap::Args;

/// Arguments for `events list-rules`.
#[derive(Debug, Clone, Args)]
pub struct ListRules {
    /// The name or ARN of the event bus to list the rules for. If you omit this, the...
    #[arg(long)]
    pub event_bus_name: Option<String>,
    /// The maximum number of results to return.
    #[arg(long)]
    pub limit: Option<i32>,
    /// The prefix matching the rule name.
    #[arg(long)]
    pub name_prefix: Option<String>,
    /// The token returned by a previous call, which you can use to retrieve the next...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `events list-rules`.
pub(crate) async fn list_rules(
    client: &Client,
    args: ListRules,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListRules` operation to AWS SDK");
    let mut req = client.list_rules();
    if let Some(ref val) = args.event_bus_name {
        req = req.event_bus_name(val);
    }
    if let Some(val) = args.limit {
        req = req.limit(val);
    }
    if let Some(ref val) = args.name_prefix {
        req = req.name_prefix(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "rules": resp.rules().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "description": v.description(),
    "eventBusName": v.event_bus_name(),
    "eventPattern": v.event_pattern(),
    "managedBy": v.managed_by(),
    "name": v.name(),
    "roleArn": v.role_arn(),
    "scheduleExpression": v.schedule_expression(),
    "state": v.state().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    }))
}
