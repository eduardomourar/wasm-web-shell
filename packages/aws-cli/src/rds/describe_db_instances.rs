use anyhow::{Error, Result};
use aws_sdk_rds::Client;
use clap::Args;

/// Arguments for `rds describe-db-instances`.
#[derive(Debug, Clone, Args)]
pub struct DescribeDbInstances {
    /// The user-supplied instance identifier or the Amazon Resource Name (ARN) of th...
    #[arg(long)]
    pub db_instance_identifier: Option<String>,
    /// An optional pagination token provided by a previous <code>DescribeDBInstances...
    #[arg(long)]
    pub marker: Option<String>,
    /// The maximum number of records to include in the response. If more records exi...
    #[arg(long)]
    pub max_records: Option<i32>,
}

/// Execute `rds describe-db-instances`.
pub(crate) async fn describe_db_instances(
    client: &Client,
    args: DescribeDbInstances,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeDbInstances` operation to AWS SDK");
    let mut req = client.describe_db_instances();
    if let Some(ref val) = args.db_instance_identifier {
        req = req.db_instance_identifier(val);
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.max_records {
        req = req.max_records(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "dbInstances": resp.db_instances().iter().map(|v| serde_json::json!({
    "activityStreamEngineNativeAuditFieldsIncluded": v.activity_stream_engine_native_audit_fields_included(),
    "activityStreamKinesisStreamName": v.activity_stream_kinesis_stream_name(),
    "activityStreamKmsKeyId": v.activity_stream_kms_key_id(),
    "activityStreamMode": v.activity_stream_mode().map(|e| e.as_str()),
    "activityStreamPolicyStatus": v.activity_stream_policy_status().map(|e| e.as_str()),
    "activityStreamStatus": v.activity_stream_status().map(|e| e.as_str()),
    "additionalStorageVolumes": v.additional_storage_volumes().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "allocatedStorage": v.allocated_storage(),
    "associatedRoles": v.associated_roles().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "autoMinorVersionUpgrade": v.auto_minor_version_upgrade(),
    "automaticRestartTime": v.automatic_restart_time().map(|t| t.to_string()),
    "automationMode": v.automation_mode().map(|e| e.as_str()),
    "availabilityZone": v.availability_zone(),
    "awsBackupRecoveryPointArn": v.aws_backup_recovery_point_arn(),
    "backupRetentionPeriod": v.backup_retention_period(),
    "backupTarget": v.backup_target(),
    "caCertificateIdentifier": v.ca_certificate_identifier(),
    "characterSetName": v.character_set_name(),
    "copyTagsToSnapshot": v.copy_tags_to_snapshot(),
    "customIamInstanceProfile": v.custom_iam_instance_profile(),
    "customerOwnedIpEnabled": v.customer_owned_ip_enabled(),
    "dbClusterIdentifier": v.db_cluster_identifier(),
    "dbInstanceArn": v.db_instance_arn(),
    "dbInstanceAutomatedBackupsReplications": v.db_instance_automated_backups_replications().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "dbInstanceClass": v.db_instance_class(),
    "dbInstanceIdentifier": v.db_instance_identifier(),
    "dbInstanceStatus": v.db_instance_status(),
    "dbName": v.db_name(),
    "dbParameterGroups": v.db_parameter_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "dbSecurityGroups": v.db_security_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "dbSystemId": v.db_system_id(),
    "databaseInsightsMode": v.database_insights_mode().map(|e| e.as_str()),
    "dbInstancePort": v.db_instance_port(),
    "dbiResourceId": v.dbi_resource_id(),
    })).collect::<Vec<_>>(),
    "marker": resp.marker(),
    }))
}
