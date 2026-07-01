use anyhow::{Error, Result};
use aws_sdk_sns::Client;
use clap::Args;

/// Arguments for `sns list-subscriptions`.
#[derive(Debug, Clone, Args)]
pub struct ListSubscriptions {
    /// Token returned by the previous <code>ListSubscriptions</code> request.
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `sns list-subscriptions`.
pub(crate) async fn list_subscriptions(
    client: &Client,
    args: ListSubscriptions,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListSubscriptions` operation to AWS SDK");
    let mut req = client.list_subscriptions();
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "subscriptions": resp.subscriptions().iter().map(|v| serde_json::json!({
    "endpoint": v.endpoint(),
    "owner": v.owner(),
    "protocol": v.protocol(),
    "subscriptionArn": v.subscription_arn(),
    "topicArn": v.topic_arn(),
    })).collect::<Vec<_>>(),
    }))
}
