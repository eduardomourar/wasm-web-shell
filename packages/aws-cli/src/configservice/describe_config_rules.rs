use anyhow::{Error, Result};
use aws_sdk_config::Client;
use clap::Args;

/// Arguments for `configservice describe-config-rules`.
#[derive(Debug, Clone, Args)]
pub struct DescribeConfigRules {
    /// The names of the Config rules for which you want details.
    #[arg(long)]
    pub config_rule_names: Option<Vec<String>>,
    /// The <code>nextToken</code> string returned on a previous page
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `configservice describe-config-rules`.
pub(crate) async fn describe_config_rules(
    client: &Client,
    args: DescribeConfigRules,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeConfigRules` operation to AWS SDK");
    let mut req = client.describe_config_rules();
    if let Some(val) = args.config_rule_names {
        req = req.set_config_rule_names(Some(val));
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "configRules": resp.config_rules().iter().map(|v| serde_json::json!({
    "configRuleArn": v.config_rule_arn(),
    "configRuleId": v.config_rule_id(),
    "configRuleName": v.config_rule_name(),
    "configRuleState": v.config_rule_state().map(|e| e.as_str()),
    "createdBy": v.created_by(),
    "description": v.description(),
    "evaluationModes": v.evaluation_modes().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "inputParameters": v.input_parameters(),
    "maximumExecutionFrequency": v.maximum_execution_frequency().map(|e| e.as_str()),
    "ruleEvaluationVisibility": v.rule_evaluation_visibility().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    }))
}
