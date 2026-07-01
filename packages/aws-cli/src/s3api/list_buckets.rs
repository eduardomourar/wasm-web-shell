use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;

/// Arguments for `s3api list-buckets`.
#[derive(Debug, Clone, Args)]
pub struct ListBuckets {
    /// Limits the response to buckets that are located in the specified Amazon Web S...
    #[arg(long)]
    pub bucket_region: Option<String>,
    /// ContinuationToken
    #[arg(long)]
    pub continuation_token: Option<String>,
    /// Maximum number of buckets to be returned in response. When the number is more...
    #[arg(long)]
    pub max_buckets: Option<i32>,
    /// Limits the response to bucket names that begin with the specified bucket name...
    #[arg(long)]
    pub prefix: Option<String>,
}

/// Execute `s3api list-buckets`.
pub(crate) async fn list_buckets(
    client: &Client,
    args: ListBuckets,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListBuckets` operation to AWS SDK");
    let mut req = client.list_buckets();
    if let Some(ref val) = args.bucket_region {
        req = req.bucket_region(val);
    }
    if let Some(ref val) = args.continuation_token {
        req = req.continuation_token(val);
    }
    if let Some(val) = args.max_buckets {
        req = req.max_buckets(val);
    }
    if let Some(ref val) = args.prefix {
        req = req.prefix(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "buckets": resp.buckets().iter().map(|v| serde_json::json!({
    "bucketArn": v.bucket_arn(),
    "bucketRegion": v.bucket_region(),
    "creationDate": v.creation_date().map(|t| t.to_string()),
    "name": v.name(),
    })).collect::<Vec<_>>(),
    "continuationToken": resp.continuation_token(),
    "owner": format!("{:#?}", resp.owner()),
    "prefix": resp.prefix(),
    }))
}
