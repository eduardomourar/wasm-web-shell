use anyhow::{Error, Result};
use aws_sdk_cloudfront::Client;
use clap::Args;

/// Arguments for `cloudfront list-distributions`.
#[derive(Debug, Clone, Args)]
pub struct ListDistributions {
    /// Use this when paginating results to indicate where to begin in your list of d...
    #[arg(long)]
    pub marker: Option<String>,
    /// The maximum number of distributions you want in the response body.
    #[arg(long)]
    pub max_items: Option<i32>,
}

/// Execute `cloudfront list-distributions`.
pub(crate) async fn list_distributions(
    client: &Client,
    args: ListDistributions,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListDistributions` operation to AWS SDK");
    let mut req = client.list_distributions();
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
        "distributionList": resp.distribution_list().map(|v| serde_json::json!({
                "isTruncated": v.is_truncated(),
                "marker": v.marker(),
                "maxItems": v.max_items(),
                "nextMarker": v.next_marker(),
                "quantity": v.quantity(),
                "items": v.items().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
            })),
    }))
}
