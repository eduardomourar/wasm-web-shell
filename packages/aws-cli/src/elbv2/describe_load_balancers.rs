use anyhow::{Error, Result};
use aws_sdk_elasticloadbalancingv2::Client;
use clap::Args;

/// Arguments for `elbv2 describe-load-balancers`.
#[derive(Debug, Clone, Args)]
pub struct DescribeLoadBalancers {
    /// The Amazon Resource Names (ARN) of the load balancers. You can specify up to ...
    #[arg(long)]
    pub load_balancer_arns: Option<Vec<String>>,
    /// The marker for the next set of results. (You received this marker from a prev...
    #[arg(long)]
    pub marker: Option<String>,
    /// The names of the load balancers.
    #[arg(long)]
    pub names: Option<Vec<String>>,
    /// The maximum number of results to return with this call.
    #[arg(long)]
    pub page_size: Option<i32>,
}

/// Execute `elbv2 describe-load-balancers`.
pub(crate) async fn describe_load_balancers(
    client: &Client,
    args: DescribeLoadBalancers,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeLoadBalancers` operation to AWS SDK");
    let mut req = client.describe_load_balancers();
    if let Some(val) = args.load_balancer_arns {
        req = req.set_load_balancer_arns(Some(val));
    }
    if let Some(ref val) = args.marker {
        req = req.marker(val);
    }
    if let Some(val) = args.names {
        req = req.set_names(Some(val));
    }
    if let Some(val) = args.page_size {
        req = req.page_size(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "loadBalancers": resp.load_balancers().iter().map(|v| serde_json::json!({
    "availabilityZones": v.availability_zones().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "canonicalHostedZoneId": v.canonical_hosted_zone_id(),
    "createdTime": v.created_time().map(|t| t.to_string()),
    "customerOwnedIpv4Pool": v.customer_owned_ipv4_pool(),
    "dnsName": v.dns_name(),
    "enablePrefixForIpv6SourceNat": v.enable_prefix_for_ipv6_source_nat().map(|e| e.as_str()),
    "enforceSecurityGroupInboundRulesOnPrivateLinkTraffic": v.enforce_security_group_inbound_rules_on_private_link_traffic(),
    "ipAddressType": v.ip_address_type().map(|e| e.as_str()),
    "loadBalancerArn": v.load_balancer_arn(),
    "loadBalancerName": v.load_balancer_name(),
    "scheme": v.scheme().map(|e| e.as_str()),
    "securityGroups": v.security_groups().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "type": v.r#type().map(|e| e.as_str()),
    "vpcId": v.vpc_id(),
    })).collect::<Vec<_>>(),
    "nextMarker": resp.next_marker(),
    }))
}
