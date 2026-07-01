use anyhow::{Error, Result};
use aws_sdk_ec2::Client;
use clap::Args;

/// Arguments for `ec2 describe-vpcs`.
#[derive(Debug, Clone, Args)]
pub struct DescribeVpcs {
    /// Checks whether you have the required permissions for the action, without actu...
    #[arg(long)]
    pub dry_run: Option<bool>,
    /// The maximum number of items to return for this request.
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The token returned from a previous paginated request. Pagination continues fr...
    #[arg(long)]
    pub next_token: Option<String>,
    /// The IDs of the VPCs.
    #[arg(long)]
    pub vpc_ids: Option<Vec<String>>,
}

/// Execute `ec2 describe-vpcs`.
pub(crate) async fn describe_vpcs(
    client: &Client,
    args: DescribeVpcs,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeVpcs` operation to AWS SDK");
    let mut req = client.describe_vpcs();
    if let Some(val) = args.dry_run {
        req = req.dry_run(val);
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(val) = args.vpc_ids {
        req = req.set_vpc_ids(Some(val));
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "vpcs": resp.vpcs().iter().map(|v| serde_json::json!({
    "cidrBlock": v.cidr_block(),
    "cidrBlockAssociationSet": v.cidr_block_association_set().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "dhcpOptionsId": v.dhcp_options_id(),
    "instanceTenancy": v.instance_tenancy().map(|e| e.as_str()),
    "ipv6CidrBlockAssociationSet": v.ipv6_cidr_block_association_set().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "isDefault": v.is_default(),
    "ownerId": v.owner_id(),
    "state": v.state().map(|e| e.as_str()),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "vpcId": v.vpc_id(),
    })).collect::<Vec<_>>(),
    }))
}
