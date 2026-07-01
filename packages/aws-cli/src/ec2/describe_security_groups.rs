use anyhow::{Error, Result};
use aws_sdk_ec2::Client;
use clap::Args;

/// Arguments for `ec2 describe-security-groups`.
#[derive(Debug, Clone, Args)]
pub struct DescribeSecurityGroups {
    /// Checks whether you have the required permissions for the action, without actu...
    #[arg(long)]
    pub dry_run: Option<bool>,
    /// The IDs of the security groups. Required for security groups in a nondefault ...
    #[arg(long)]
    pub group_ids: Option<Vec<String>>,
    /// [Default VPC] The names of the security groups. You can specify either
    #[arg(long)]
    pub group_names: Option<Vec<String>>,
    /// The maximum number of items to return for this request. To get the next page ...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The token returned from a previous paginated request.
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `ec2 describe-security-groups`.
pub(crate) async fn describe_security_groups(
    client: &Client,
    args: DescribeSecurityGroups,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeSecurityGroups` operation to AWS SDK");
    let mut req = client.describe_security_groups();
    if let Some(val) = args.dry_run {
        req = req.dry_run(val);
    }
    if let Some(val) = args.group_ids {
        req = req.set_group_ids(Some(val));
    }
    if let Some(val) = args.group_names {
        req = req.set_group_names(Some(val));
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "securityGroups": resp.security_groups().iter().map(|v| serde_json::json!({
    "description": v.description(),
    "groupId": v.group_id(),
    "groupName": v.group_name(),
    "ipPermissions": v.ip_permissions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ipPermissionsEgress": v.ip_permissions_egress().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ownerId": v.owner_id(),
    "securityGroupArn": v.security_group_arn(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "vpcId": v.vpc_id(),
    })).collect::<Vec<_>>(),
    }))
}
