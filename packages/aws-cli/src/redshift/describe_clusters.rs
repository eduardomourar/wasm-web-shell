use anyhow::{Error, Result};
use aws_sdk_redshift::Client;
use clap::Args;

/// Arguments for `redshift describe-clusters`.
#[derive(Debug, Clone, Args)]
pub struct DescribeClusters {
    /// The unique identifier of a cluster whose properties you are requesting. This
    #[arg(long)]
    pub cluster_identifier: Option<String>,
    /// An optional parameter that specifies the starting point to return a set of re...
    #[arg(long)]
    pub marker: Option<String>,
    /// The maximum number of response records to return in each call. If the number of
    #[arg(long)]
    pub max_records: Option<i32>,
    /// A tag key or keys for which you want to return all matching clusters that are
    #[arg(long)]
    pub tag_keys: Option<Vec<String>>,
    /// A tag value or values for which you want to return all matching clusters that...
    #[arg(long)]
    pub tag_values: Option<Vec<String>>,
}

/// Execute `redshift describe-clusters`.
pub(crate) async fn describe_clusters(
    client: &Client,
    args: DescribeClusters,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeClusters` operation to AWS SDK");
    let mut req = client.describe_clusters();
    if let Some(ref val) = args.cluster_identifier {
        req = req.cluster_identifier(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_records {
        req = req.max_records(val);
    }
    if let Some(val) = args.tag_keys {
        req = req.set_tag_keys(Some(val));
    }
    if let Some(val) = args.tag_values {
        req = req.set_tag_values(Some(val));
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "clusters": resp.clusters().iter().map(|v| serde_json::json!({
    "allowVersionUpgrade": v.allow_version_upgrade(),
    "automatedSnapshotRetentionPeriod": v.automated_snapshot_retention_period(),
    "availabilityZone": v.availability_zone(),
    "availabilityZoneRelocationStatus": v.availability_zone_relocation_status(),
    "catalogArn": v.catalog_arn(),
    "clusterAvailabilityStatus": v.cluster_availability_status(),
    "clusterCreateTime": v.cluster_create_time().map(|t| t.to_string()),
    "clusterIdentifier": v.cluster_identifier(),
    "clusterNamespaceArn": v.cluster_namespace_arn(),
    "clusterNodes": v.cluster_nodes().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "clusterParameterGroups": v.cluster_parameter_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "clusterPublicKey": v.cluster_public_key(),
    "clusterRevisionNumber": v.cluster_revision_number(),
    "clusterSecurityGroups": v.cluster_security_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "clusterStatus": v.cluster_status(),
    "clusterSubnetGroupName": v.cluster_subnet_group_name(),
    "clusterVersion": v.cluster_version(),
    "customDomainCertificateArn": v.custom_domain_certificate_arn(),
    "customDomainCertificateExpiryDate": v.custom_domain_certificate_expiry_date().map(|t| t.to_string()),
    "customDomainName": v.custom_domain_name(),
    "dbName": v.db_name(),
    "defaultIamRoleArn": v.default_iam_role_arn(),
    "deferredMaintenanceWindows": v.deferred_maintenance_windows().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "elasticResizeNumberOfNodeOptions": v.elastic_resize_number_of_node_options(),
    "encrypted": v.encrypted(),
    "enhancedVpcRouting": v.enhanced_vpc_routing(),
    "expectedNextSnapshotScheduleTime": v.expected_next_snapshot_schedule_time().map(|t| t.to_string()),
    "expectedNextSnapshotScheduleTimeStatus": v.expected_next_snapshot_schedule_time_status(),
    "extraComputeForAutomaticOptimization": v.extra_compute_for_automatic_optimization(),
    "iamRoles": v.iam_roles().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ipAddressType": v.ip_address_type(),
    "kmsKeyId": v.kms_key_id(),
    "lakehouseRegistrationStatus": v.lakehouse_registration_status(),
    "maintenanceTrackName": v.maintenance_track_name(),
    })).collect::<Vec<_>>(),
    "marker": resp.marker(),
    }))
}
