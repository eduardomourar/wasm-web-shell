use anyhow::{Error, Result};
use aws_sdk_sns::Client;
use clap::Args;

/// Arguments for `sns list-topics`.
#[derive(Debug, Clone, Args)]
pub struct ListTopics {
    /// Token returned by the previous <code>ListTopics</code> request.
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `sns list-topics`.
pub(crate) async fn list_topics(
    client: &Client,
    args: ListTopics,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListTopics` operation to AWS SDK");
    let mut req = client.list_topics();
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "topics": resp.topics().iter().map(|v| serde_json::json!({
    "topicArn": v.topic_arn(),
    })).collect::<Vec<_>>(),
    }))
}
