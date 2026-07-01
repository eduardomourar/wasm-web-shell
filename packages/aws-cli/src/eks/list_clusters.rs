use anyhow::{Error, Result};
use aws_sdk_eks::Client;
use clap::Args;

/// Arguments for `eks list-clusters`.
#[derive(Debug, Clone, Args)]
pub struct ListClusters {
    /// Indicates whether external clusters are included in the returned list. Use
    #[arg(long)]
    pub include: Option<Vec<String>>,
    /// The maximum number of results, returned in paginated output. You receive
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The <code>nextToken</code> value returned from a previous paginated request, ...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `eks list-clusters`.
pub(crate) async fn list_clusters(
    client: &Client,
    args: ListClusters,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListClusters` operation to AWS SDK");
    let mut req = client.list_clusters();
    if let Some(val) = args.include {
        req = req.set_include(Some(val));
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "clusters": resp.clusters(),
    "nextToken": resp.next_token(),
    }))
}
