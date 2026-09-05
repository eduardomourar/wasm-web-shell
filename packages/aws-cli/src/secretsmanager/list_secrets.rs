use anyhow::{Error, Result};
use aws_sdk_secretsmanager::Client;
use clap::Args;

/// Arguments for `secretsmanager list-secrets`.
#[derive(Debug, Clone, Args)]
pub struct ListSecrets {
    /// Specifies whether to include secrets scheduled for deletion. By default, secrets
    #[arg(long)]
    pub include_planned_deletion: Option<bool>,
    /// The number of results to include in the response.
    #[arg(long)]
    pub max_results: Option<i32>,
    /// A token that indicates where the output should continue from, if a previous c...
    #[arg(long)]
    pub next_token: Option<String>,
    /// If not specified, secrets are listed by <code>CreatedDate</code>.
    #[arg(long)]
    pub sort_by: Option<String>,
    /// Secrets are listed by <code>CreatedDate</code>.
    #[arg(long)]
    pub sort_order: Option<String>,
}

/// Execute `secretsmanager list-secrets`.
pub(crate) async fn list_secrets(
    client: &Client,
    args: ListSecrets,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListSecrets` operation to AWS SDK");
    let mut req = client.list_secrets();
    if let Some(val) = args.include_planned_deletion {
        req = req.include_planned_deletion(val);
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(ref val) = args.sort_by {
        req = req.sort_by(val.as_str().into());
    }
    if let Some(ref val) = args.sort_order {
        req = req.sort_order(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "secretList": resp.secret_list().iter().map(|v| serde_json::json!({
    "arn": v.arn(),
    "createdDate": v.created_date().map(|t| t.to_string()),
    "deletedDate": v.deleted_date().map(|t| t.to_string()),
    "description": v.description(),
    "externalSecretRotationMetadata": v.external_secret_rotation_metadata().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "externalSecretRotationRoleArn": v.external_secret_rotation_role_arn(),
    "kmsKeyId": v.kms_key_id(),
    "lastAccessedDate": v.last_accessed_date().map(|t| t.to_string()),
    "lastChangedDate": v.last_changed_date().map(|t| t.to_string()),
    "lastRotatedDate": v.last_rotated_date().map(|t| t.to_string()),
    "name": v.name(),
    "nextRotationDate": v.next_rotation_date().map(|t| t.to_string()),
    "owningService": v.owning_service(),
    "primaryRegion": v.primary_region(),
    "rotationEnabled": v.rotation_enabled(),
    "rotationLambdaArn": v.rotation_lambda_arn(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "type": v.r#type(),
    })).collect::<Vec<_>>(),
    }))
}
