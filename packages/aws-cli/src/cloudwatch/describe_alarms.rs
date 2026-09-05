use anyhow::{Error, Result};
use aws_sdk_cloudwatch::Client;
use clap::Args;

/// Arguments for `cloudwatch describe-alarms`.
#[derive(Debug, Clone, Args)]
pub struct DescribeAlarms {
    /// Use this parameter to filter the results of the operation to only those alarm...
    #[arg(long)]
    pub action_prefix: Option<String>,
    /// An alarm name prefix. If you specify this parameter, you receive information ...
    #[arg(long)]
    pub alarm_name_prefix: Option<String>,
    /// The names of the alarms to retrieve information about.
    #[arg(long)]
    pub alarm_names: Option<Vec<String>>,
    /// Use this parameter to specify whether you want the operation to return metric...
    #[arg(long)]
    pub alarm_types: Option<Vec<String>>,
    /// If you use this parameter and specify the name of a composite alarm, the oper...
    #[arg(long)]
    pub children_of_alarm_name: Option<String>,
    /// The maximum number of alarm descriptions to retrieve.
    #[arg(long)]
    pub max_records: Option<i32>,
    /// The token returned by a previous call to indicate that there is more data
    #[arg(long)]
    pub next_token: Option<String>,
    /// If you use this parameter and specify the name of a metric or composite alarm...
    #[arg(long)]
    pub parents_of_alarm_name: Option<String>,
    /// Specify this parameter to receive information only about alarms that are curr...
    #[arg(long)]
    pub state_value: Option<String>,
}

/// Execute `cloudwatch describe-alarms`.
pub(crate) async fn describe_alarms(
    client: &Client,
    args: DescribeAlarms,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DescribeAlarms` operation to AWS SDK");
    let mut req = client.describe_alarms();
    if let Some(ref val) = args.action_prefix {
        req = req.action_prefix(val);
    }
    if let Some(ref val) = args.alarm_name_prefix {
        req = req.alarm_name_prefix(val);
    }
    if let Some(val) = args.alarm_names {
        req = req.set_alarm_names(Some(val));
    }
    if let Some(val) = args.alarm_types {
        req = req.set_alarm_types(Some(val.into_iter().map(|s| s.as_str().into()).collect()));
    }
    if let Some(ref val) = args.children_of_alarm_name {
        req = req.children_of_alarm_name(val);
    }
    if let Some(val) = args.max_records {
        req = req.max_records(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(ref val) = args.parents_of_alarm_name {
        req = req.parents_of_alarm_name(val);
    }
    if let Some(ref val) = args.state_value {
        req = req.state_value(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "compositeAlarms": resp.composite_alarms().iter().map(|v| serde_json::json!({
    "actionsEnabled": v.actions_enabled(),
    "actionsSuppressedBy": v.actions_suppressed_by().map(|e| e.as_str()),
    "actionsSuppressedReason": v.actions_suppressed_reason(),
    "actionsSuppressor": v.actions_suppressor(),
    "actionsSuppressorExtensionPeriod": v.actions_suppressor_extension_period(),
    "actionsSuppressorWaitPeriod": v.actions_suppressor_wait_period(),
    "alarmActions": v.alarm_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "alarmArn": v.alarm_arn(),
    "alarmConfigurationUpdatedTimestamp": v.alarm_configuration_updated_timestamp().map(|t| t.to_string()),
    "alarmDescription": v.alarm_description(),
    "alarmName": v.alarm_name(),
    "alarmRule": v.alarm_rule(),
    "insufficientDataActions": v.insufficient_data_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "okActions": v.ok_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "stateReason": v.state_reason(),
    "stateReasonData": v.state_reason_data(),
    "stateTransitionedTimestamp": v.state_transitioned_timestamp().map(|t| t.to_string()),
    "stateUpdatedTimestamp": v.state_updated_timestamp().map(|t| t.to_string()),
    "stateValue": v.state_value().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "logAlarms": resp.log_alarms().iter().map(|v| serde_json::json!({
    "actionLogLineCount": v.action_log_line_count(),
    "actionLogLineRoleArn": v.action_log_line_role_arn(),
    "actionsEnabled": v.actions_enabled(),
    "alarmActions": v.alarm_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "alarmArn": v.alarm_arn(),
    "alarmConfigurationUpdatedTimestamp": v.alarm_configuration_updated_timestamp().map(|t| t.to_string()),
    "alarmDescription": v.alarm_description(),
    "alarmName": v.alarm_name(),
    "comparisonOperator": v.comparison_operator().map(|e| e.as_str()),
    "evaluationState": v.evaluation_state().map(|e| e.as_str()),
    "insufficientDataActions": v.insufficient_data_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "okActions": v.ok_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "queryResultsToAlarm": v.query_results_to_alarm(),
    "queryResultsToEvaluate": v.query_results_to_evaluate(),
    "stateReason": v.state_reason(),
    "stateReasonData": v.state_reason_data(),
    "stateTransitionedTimestamp": v.state_transitioned_timestamp().map(|t| t.to_string()),
    "stateUpdatedTimestamp": v.state_updated_timestamp().map(|t| t.to_string()),
    "stateValue": v.state_value().map(|e| e.as_str()),
    "treatMissingData": v.treat_missing_data(),
    })).collect::<Vec<_>>(),
    "metricAlarms": resp.metric_alarms().iter().map(|v| serde_json::json!({
    "actionsEnabled": v.actions_enabled(),
    "alarmActions": v.alarm_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "alarmArn": v.alarm_arn(),
    "alarmConfigurationUpdatedTimestamp": v.alarm_configuration_updated_timestamp().map(|t| t.to_string()),
    "alarmDescription": v.alarm_description(),
    "alarmName": v.alarm_name(),
    "comparisonOperator": v.comparison_operator().map(|e| e.as_str()),
    "datapointsToAlarm": v.datapoints_to_alarm(),
    "dimensions": v.dimensions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "evaluateLowSampleCountPercentile": v.evaluate_low_sample_count_percentile(),
    "evaluationInterval": v.evaluation_interval(),
    "evaluationPeriods": v.evaluation_periods(),
    "evaluationState": v.evaluation_state().map(|e| e.as_str()),
    "extendedStatistic": v.extended_statistic(),
    "insufficientDataActions": v.insufficient_data_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "metricName": v.metric_name(),
    "metrics": v.metrics().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "namespace": v.namespace(),
    "okActions": v.ok_actions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "period": v.period(),
    "stateReason": v.state_reason(),
    "stateReasonData": v.state_reason_data(),
    "stateTransitionedTimestamp": v.state_transitioned_timestamp().map(|t| t.to_string()),
    "stateUpdatedTimestamp": v.state_updated_timestamp().map(|t| t.to_string()),
    "stateValue": v.state_value().map(|e| e.as_str()),
    "statistic": v.statistic().map(|e| e.as_str()),
    "thresholdMetricId": v.threshold_metric_id(),
    "treatMissingData": v.treat_missing_data(),
    "unit": v.unit().map(|e| e.as_str()),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    }))
}
