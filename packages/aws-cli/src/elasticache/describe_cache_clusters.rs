use anyhow::{Error, Result};
use aws_sdk_elasticache::Client;
use clap::Args;

/// Arguments for `elasticache describe-cache-clusters`.
#[derive(Debug, Clone, Args)]
pub struct DescribeCacheClusters {
    /// The user-supplied cluster identifier. If this parameter is specified, only in...
    #[arg(long)]
    pub cache_cluster_id: Option<String>,
    /// An optional marker returned from a prior request. Use this marker for paginat...
    #[arg(long)]
    pub marker: Option<String>,
    /// The maximum number of records to include in the response. If more records exi...
    #[arg(long)]
    pub max_records: Option<i32>,
    /// An optional flag that can be included in the <code>DescribeCacheCluster</code...
    #[arg(long)]
    pub show_cache_clusters_not_in_replication_groups: Option<bool>,
    /// An optional flag that can be included in the <code>DescribeCacheCluster</code...
    #[arg(long)]
    pub show_cache_node_info: Option<bool>,
}

/// Execute `elasticache describe-cache-clusters`.
pub(crate) async fn describe_cache_clusters(
    client: &Client,
    args: DescribeCacheClusters,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeCacheClusters` operation to AWS SDK");
    let mut req = client.describe_cache_clusters();
    if let Some(ref val) = args.cache_cluster_id {
        req = req.cache_cluster_id(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_records {
        req = req.max_records(val);
    }
    if let Some(val) = args.show_cache_clusters_not_in_replication_groups {
        req = req.show_cache_clusters_not_in_replication_groups(val);
    }
    if let Some(val) = args.show_cache_node_info {
        req = req.show_cache_node_info(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "cacheClusters": resp.cache_clusters().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "atRestEncryptionEnabled": v.at_rest_encryption_enabled(),
    "authTokenEnabled": v.auth_token_enabled(),
    "authTokenLastModifiedDate": v.auth_token_last_modified_date().map(|t| t.to_string()),
    "autoMinorVersionUpgrade": v.auto_minor_version_upgrade(),
    "cacheClusterCreateTime": v.cache_cluster_create_time().map(|t| t.to_string()),
    "cacheClusterId": v.cache_cluster_id(),
    "cacheClusterStatus": v.cache_cluster_status(),
    "cacheNodeType": v.cache_node_type(),
    "cacheNodes": v.cache_nodes().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "cacheSecurityGroups": v.cache_security_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "cacheSubnetGroupName": v.cache_subnet_group_name(),
    "clientDownloadLandingPage": v.client_download_landing_page(),
    "engine": v.engine(),
    "engineVersion": v.engine_version(),
    "ipDiscovery": v.ip_discovery().map(|e| e.as_str()),
    "logDeliveryConfigurations": v.log_delivery_configurations().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "networkType": v.network_type().map(|e| e.as_str()),
    "numCacheNodes": v.num_cache_nodes(),
    "preferredAvailabilityZone": v.preferred_availability_zone(),
    "preferredMaintenanceWindow": v.preferred_maintenance_window(),
    "preferredOutpostArn": v.preferred_outpost_arn(),
    "replicationGroupId": v.replication_group_id(),
    "replicationGroupLogDeliveryEnabled": v.replication_group_log_delivery_enabled(),
    "securityGroups": v.security_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "snapshotRetentionLimit": v.snapshot_retention_limit(),
    "snapshotWindow": v.snapshot_window(),
    "transitEncryptionEnabled": v.transit_encryption_enabled(),
    "transitEncryptionMode": v.transit_encryption_mode().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "marker": resp.marker(),
    }))
}
