use anyhow::{Error, Result};
use aws_sdk_cloudtrail::Client;
use clap::Args;

/// Arguments for `cloudtrail lookup-events`.
#[derive(Debug, Clone, Args)]
pub struct LookupEvents {
    /// Specifies the event category. If you do not specify an event category, events...
    #[arg(long)]
    pub event_category: Option<String>,
    /// The number of events to return. Possible values are 1 through 50. The default is
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The token to use to get the next page of results after a previous API call. T...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `cloudtrail lookup-events`.
pub(crate) async fn lookup_events(
    client: &Client,
    args: LookupEvents,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `LookupEvents` operation to AWS SDK");
    let mut req = client.lookup_events();
    if let Some(ref val) = args.event_category {
        req = req.event_category(val.as_str().into());
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "events": resp.events().iter().map(|v| serde_json::json!({
    "accessKeyId": v.access_key_id(),
    "cloudTrailEvent": v.cloud_trail_event(),
    "eventId": v.event_id(),
    "eventName": v.event_name(),
    "eventSource": v.event_source(),
    "eventTime": v.event_time().map(|t| t.to_string()),
    "readOnly": v.read_only(),
    "resources": v.resources().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "username": v.username(),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    }))
}
