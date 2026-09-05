use anyhow::{Error, Result};
use aws_sdk_elasticloadbalancingv2::Client;
use clap::Args;

/// Arguments for `elbv2 describe-target-groups`.
#[derive(Debug, Clone, Args)]
pub struct DescribeTargetGroups {
    /// The Amazon Resource Name (ARN) of the load balancer.
    #[arg(long)]
    pub load_balancer_arn: Option<String>,
    /// The marker for the next set of results. (You received this marker from a prev...
    #[arg(long)]
    pub marker: Option<String>,
    /// The names of the target groups.
    #[arg(long)]
    pub names: Option<Vec<String>>,
    /// The maximum number of results to return with this call.
    #[arg(long)]
    pub page_size: Option<i32>,
    /// The Amazon Resource Names (ARN) of the target groups.
    #[arg(long)]
    pub target_group_arns: Option<Vec<String>>,
}

/// Execute `elbv2 describe-target-groups`.
pub(crate) async fn describe_target_groups(
    client: &Client,
    args: DescribeTargetGroups,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeTargetGroups` operation to AWS SDK");
    let mut req = client.describe_target_groups();
    if let Some(ref val) = args.load_balancer_arn {
        req = req.load_balancer_arn(val);
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
    if let Some(val) = args.target_group_arns {
        req = req.set_target_group_arns(Some(val));
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextMarker": resp.next_marker(),
    "targetGroups": resp.target_groups().iter().map(|v| serde_json::json!({
    "healthCheckEnabled": v.health_check_enabled(),
    "healthCheckIntervalSeconds": v.health_check_interval_seconds(),
    "healthCheckPath": v.health_check_path(),
    "healthCheckPort": v.health_check_port(),
    "healthCheckProtocol": v.health_check_protocol().map(|e| e.as_str()),
    "healthCheckTimeoutSeconds": v.health_check_timeout_seconds(),
    "healthyThresholdCount": v.healthy_threshold_count(),
    "ipAddressType": v.ip_address_type().map(|e| e.as_str()),
    "loadBalancerArns": v.load_balancer_arns().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "port": v.port(),
    "protocol": v.protocol().map(|e| e.as_str()),
    "protocolVersion": v.protocol_version(),
    "targetControlPort": v.target_control_port(),
    "targetGroupArn": v.target_group_arn(),
    "targetGroupName": v.target_group_name(),
    "targetType": v.target_type().map(|e| e.as_str()),
    "unhealthyThresholdCount": v.unhealthy_threshold_count(),
    "vpcId": v.vpc_id(),
    })).collect::<Vec<_>>(),
    }))
}
