use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;

/// Arguments for `s3api list-objects`.
#[derive(Debug, Clone, Args)]
pub struct ListObjects {
    /// The name of the bucket containing the objects.
    #[arg(long)]
    pub bucket: String,
    /// A delimiter is a character that you use to group keys.
    #[arg(long)]
    pub delimiter: Option<String>,
    /// EncodingType
    #[arg(long)]
    pub encoding_type: Option<String>,
    /// The account ID of the expected bucket owner. If the account ID that you provi...
    #[arg(long)]
    pub expected_bucket_owner: Option<String>,
    /// Marker is where you want Amazon S3 to start listing from. Amazon S3 starts li...
    #[arg(long)]
    pub marker: Option<String>,
    /// Sets the maximum number of keys returned in the response. By default, the act...
    #[arg(long)]
    pub max_keys: Option<i32>,
    /// Specifies the optional fields that you want returned in the response. Fields ...
    #[arg(long)]
    pub optional_object_attributes: Option<Vec<String>>,
    /// Limits the response to keys that begin with the specified prefix.
    #[arg(long)]
    pub prefix: Option<String>,
    /// Confirms that the requester knows that she or he will be charged for the list...
    #[arg(long)]
    pub request_payer: Option<String>,
}

/// Execute `s3api list-objects`.
pub(crate) async fn list_objects(
    client: &Client,
    args: ListObjects,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListObjects` operation to AWS SDK");
    let mut req = client.list_objects();
    req = req.bucket(&args.bucket);
    if let Some(ref val) = args.delimiter {
        req = req.delimiter(val);
    }
    if let Some(ref val) = args.encoding_type {
        req = req.encoding_type(val.as_str().into());
    }
    if let Some(ref val) = args.expected_bucket_owner {
        req = req.expected_bucket_owner(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_keys {
        req = req.max_keys(val);
    }
    if let Some(val) = args.optional_object_attributes {
        req = req.set_optional_object_attributes(Some(
            val.into_iter().map(|s| s.as_str().into()).collect(),
        ));
    }
    if let Some(ref val) = args.prefix {
        req = req.prefix(val);
    }
    if let Some(ref val) = args.request_payer {
        req = req.request_payer(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "commonPrefixes": resp.common_prefixes().iter().map(|v| serde_json::json!({
    "prefix": v.prefix(),
    })).collect::<Vec<_>>(),
    "contents": resp.contents().iter().map(|v| serde_json::json!({
    "checksumAlgorithm": v.checksum_algorithm().iter().map(|e| e.as_str()).collect::<Vec<_>>(),
    "checksumType": v.checksum_type().map(|e| e.as_str()),
    "eTag": v.e_tag(),
    "key": v.key(),
    "lastModified": v.last_modified().map(|t| t.to_string()),
    "size": v.size(),
    "storageClass": v.storage_class().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "delimiter": resp.delimiter(),
    "encodingType": resp.encoding_type().map(|v| v.as_str()),
    "isTruncated": resp.is_truncated(),
    "marker": resp.marker(),
    "maxKeys": resp.max_keys(),
    "name": resp.name(),
    "nextMarker": resp.next_marker(),
    "prefix": resp.prefix(),
    "requestCharged": resp.request_charged().map(|v| v.as_str()),
    }))
}
