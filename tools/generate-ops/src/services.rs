/// Map CSV service name → Rust SDK crate identifier.
pub fn sdk_crate(service: &str) -> Option<String> {
    Some(match service {
        "cognito-idp" => "aws_sdk_cognitoidentityprovider".to_string(),
        "configservice" => "aws_sdk_config".to_string(),
        "elb" => "aws_sdk_elasticloadbalancing".to_string(),
        "elbv2" => "aws_sdk_elasticloadbalancingv2".to_string(),
        "events" => "aws_sdk_eventbridge".to_string(),
        "logs" => "aws_sdk_cloudwatchlogs".to_string(),
        "s3api" => "aws_sdk_s3".to_string(),
        _ => format!("aws_sdk_{}", service),
    })
}

/// Map CSV service name → Smithy model filename (without .json).
pub fn smithy_model_name(service: &str) -> String {
    match service {
        "cognito-idp" => "cognito-identity-provider".into(),
        "configservice" => "config-service".into(),
        "elb" => "elastic-load-balancing".into(),
        "elbv2" => "elastic-load-balancing-v2".into(),
        "events" => "eventbridge".into(),
        "logs" => "cloudwatch-logs".into(),
        "route53" => "route-53".into(),
        "s3api" => "s3".into(),
        "secretsmanager" => "secrets-manager".into(),
        _ => service.into(),
    }
}

pub fn service_dir(service: &str) -> String {
    match service {
        "cognito-idp" => "cognito_idp".into(),
        other => other.replace('-', "_"),
    }
}

pub fn is_skip_service(service: &str) -> bool {
    service == "s3"
}

pub fn is_existing_op(service: &str, op: &str) -> bool {
    matches!(
        (service, op),
        ("s3api", "get-object")
            | ("ssm", "list-public-parameters")
            | ("sts", "get-caller-identity")
    )
}
