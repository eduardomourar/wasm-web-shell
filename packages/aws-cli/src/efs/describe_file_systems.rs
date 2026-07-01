use anyhow::{Error, Result};
use aws_sdk_efs::Client;
use clap::Args;

/// Arguments for `efs describe-file-systems`.
#[derive(Debug, Clone, Args)]
pub struct DescribeFileSystems {
    /// (Optional) Restricts the list to the file system with this creation token (St...
    #[arg(long)]
    pub creation_token: Option<String>,
    /// (Optional) ID of the file system whose description you want to retrieve
    #[arg(long)]
    pub file_system_id: Option<String>,
    /// (Optional) Opaque pagination token returned from a previous
    #[arg(long)]
    pub marker: Option<String>,
    /// (Optional) Specifies the maximum number of file systems to return in the resp...
    #[arg(long)]
    pub max_items: Option<i32>,
}

/// Execute `efs describe-file-systems`.
pub(crate) async fn describe_file_systems(
    client: &Client,
    args: DescribeFileSystems,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeFileSystems` operation to AWS SDK");
    let mut req = client.describe_file_systems();
    if let Some(ref val) = args.creation_token {
        req = req.creation_token(val);
    }
    if let Some(ref val) = args.file_system_id {
        req = req.file_system_id(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_items {
        req = req.max_items(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "fileSystems": resp.file_systems().iter().map(|v| serde_json::json!({
    "availabilityZoneId": v.availability_zone_id(),
    "availabilityZoneName": v.availability_zone_name(),
    "creationTime": v.creation_time().to_string(),
    "creationToken": v.creation_token(),
    "encrypted": v.encrypted(),
    "fileSystemArn": v.file_system_arn(),
    "fileSystemId": v.file_system_id(),
    "kmsKeyId": v.kms_key_id(),
    "name": v.name(),
    "numberOfMountTargets": v.number_of_mount_targets(),
    "ownerId": v.owner_id(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "throughputMode": v.throughput_mode().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "marker": resp.marker(),
    "nextMarker": resp.next_marker(),
    }))
}
