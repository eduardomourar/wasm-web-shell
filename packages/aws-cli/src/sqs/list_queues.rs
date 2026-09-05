use anyhow::{Error, Result};
use aws_sdk_sqs::Client;
use clap::Args;

/// Arguments for `sqs list-queues`.
#[derive(Debug, Clone, Args)]
pub struct ListQueues {
    /// Maximum number of results to include in the response. Value range is 1 to 100...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// Pagination token to request the next set of results.
    #[arg(long)]
    pub next_token: Option<String>,
    /// A string to use for filtering the list results. Only those queues whose name ...
    #[arg(long)]
    pub queue_name_prefix: Option<String>,
}

/// Execute `sqs list-queues`.
pub(crate) async fn list_queues(
    client: &Client,
    args: ListQueues,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListQueues` operation to AWS SDK");
    let mut req = client.list_queues();
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(ref val) = args.queue_name_prefix {
        req = req.queue_name_prefix(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "queueUrls": resp.queue_urls(),
    }))
}
