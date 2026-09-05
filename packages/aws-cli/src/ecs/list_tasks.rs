use anyhow::{Error, Result};
use aws_sdk_ecs::Client;
use clap::Args;

/// Arguments for `ecs list-tasks`.
#[derive(Debug, Clone, Args)]
pub struct ListTasks {
    /// The short name or full Amazon Resource Name (ARN) of the cluster to use when ...
    #[arg(long)]
    pub cluster: Option<String>,
    /// The container instance ID or full ARN of the container instance to use when f...
    #[arg(long)]
    pub container_instance: Option<String>,
    /// The name of the daemon to use when filtering the <code>ListTasks</code> resul...
    #[arg(long)]
    pub daemon_name: Option<String>,
    /// The task desired status to use when filtering the <code>ListTasks</code> resu...
    #[arg(long)]
    pub desired_status: Option<String>,
    /// The name of the task definition family to use when filtering the <code>ListTa...
    #[arg(long)]
    pub family: Option<String>,
    /// The launch type to use when filtering the <code>ListTasks</code> results.
    #[arg(long)]
    pub launch_type: Option<String>,
    /// The maximum number of task results that <code>ListTasks</code> returned in pa...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The <code>nextToken</code> value returned from a <code>ListTasks</code> reque...
    #[arg(long)]
    pub next_token: Option<String>,
    /// The name of the service to use when filtering the <code>ListTasks</code> resu...
    #[arg(long)]
    pub service_name: Option<String>,
    /// The <code>startedBy</code> value to filter the task results with. Specifying ...
    #[arg(long)]
    pub started_by: Option<String>,
}

/// Execute `ecs list-tasks`.
pub(crate) async fn list_tasks(
    client: &Client,
    args: ListTasks,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListTasks` operation to AWS SDK");
    let mut req = client.list_tasks();
    if let Some(ref val) = args.cluster {
        req = req.cluster(val);
    }
    if let Some(ref val) = args.container_instance {
        req = req.container_instance(val);
    }
    if let Some(ref val) = args.daemon_name {
        req = req.daemon_name(val);
    }
    if let Some(ref val) = args.desired_status {
        req = req.desired_status(val.as_str().into());
    }
    if let Some(ref val) = args.family {
        req = req.family(val);
    }
    if let Some(ref val) = args.launch_type {
        req = req.launch_type(val.as_str().into());
    }
    if let Some(val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    if let Some(ref val) = args.service_name {
        req = req.service_name(val);
    }
    if let Some(ref val) = args.started_by {
        req = req.started_by(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "taskArns": resp.task_arns(),
    }))
}
