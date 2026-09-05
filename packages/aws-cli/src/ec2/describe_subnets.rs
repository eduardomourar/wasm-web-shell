use anyhow::{Error, Result};
use aws_sdk_ec2::Client;
use clap::Args;

/// Arguments for `ec2 describe-subnets`.
#[derive(Debug, Clone, Args)]
pub struct DescribeSubnets {
    /// Checks whether you have the required permissions for the action, without actu...
    #[arg(long)]
    pub dry_run: Option<bool>,
    /// The maximum number of items to return for this request.
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The token returned from a previous paginated request. Pagination continues fr...
    #[arg(long)]
    pub next_token: Option<String>,
    /// The IDs of the subnets.
    #[arg(long)]
    pub subnet_ids: Option<Vec<String>>,
}

/// Execute `ec2 describe-subnets`.
pub(crate) async fn describe_subnets(
    client: &Client,
    args: DescribeSubnets,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeSubnets` operation to AWS SDK");
    let mut req = client.describe_subnets();
    if let Some(val) = args.dry_run {
        req = req.dry_run(val);
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(val) = args.subnet_ids {
        req = req.set_subnet_ids(Some(val));
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "subnets": resp.subnets().iter().map(|v| serde_json::json!({
    "assignIpv6AddressOnCreation": v.assign_ipv6_address_on_creation(),
    "availabilityZone": v.availability_zone(),
    "availabilityZoneId": v.availability_zone_id(),
    "availableIpAddressCount": v.available_ip_address_count(),
    "cidrBlock": v.cidr_block(),
    "customerOwnedIpv4Pool": v.customer_owned_ipv4_pool(),
    "defaultForAz": v.default_for_az(),
    "enableDns64": v.enable_dns64(),
    "enableLniAtDeviceIndex": v.enable_lni_at_device_index(),
    "ipv6CidrBlockAssociationSet": v.ipv6_cidr_block_association_set().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ipv6Native": v.ipv6_native(),
    "mapCustomerOwnedIpOnLaunch": v.map_customer_owned_ip_on_launch(),
    "mapPublicIpOnLaunch": v.map_public_ip_on_launch(),
    "outpostArn": v.outpost_arn(),
    "ownerId": v.owner_id(),
    "state": v.state().map(|e| e.as_str()),
    "subnetArn": v.subnet_arn(),
    "subnetId": v.subnet_id(),
    "tags": v.tags().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "type": v.r#type(),
    "vpcId": v.vpc_id(),
    })).collect::<Vec<_>>(),
    }))
}
