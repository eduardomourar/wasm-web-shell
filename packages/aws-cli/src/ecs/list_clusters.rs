use anyhow::{Error, Result};
use aws_sdk_ecs::Client;
use clap::Args;

/// Arguments for `ecs list-clusters`.
#[derive(Debug, Clone, Args)]
pub struct ListClusters {
    /// The maximum number of cluster results that <code>ListClusters</code> returned...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The <code>nextToken</code> value returned from a <code>ListClusters</code> re...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `ecs list-clusters`.
pub(crate) async fn list_clusters(
    client: &Client,
    args: ListClusters,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListClusters` operation to AWS SDK");
    let mut req = client.list_clusters();
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "clusterArns": resp.cluster_arns(),
    "nextToken": resp.next_token(),
    }))
}
