use anyhow::{Error, Result};
use aws_sdk_ecs::Client;
use clap::Args;

/// Arguments for `ecs list-services`.
#[derive(Debug, Clone, Args)]
pub struct ListServices {
    /// The short name or full Amazon Resource Name (ARN) of the cluster to use when ...
    #[arg(long)]
    pub cluster: Option<String>,
    /// The launch type to use when filtering the <code>ListServices</code> results.
    #[arg(long)]
    pub launch_type: Option<String>,
    /// The maximum number of service results that <code>ListServices</code> returned...
    #[arg(long)]
    pub max_results: Option<i32>,
    /// The <code>nextToken</code> value returned from a <code>ListServices</code> re...
    #[arg(long)]
    pub next_token: Option<String>,
    /// The resourceManagementType type to use when filtering the <code>ListServices<...
    #[arg(long)]
    pub resource_management_type: Option<String>,
    /// The scheduling strategy to use when filtering the <code>ListServices</code> r...
    #[arg(long)]
    pub scheduling_strategy: Option<String>,
}

/// Execute `ecs list-services`.
pub(crate) async fn list_services(
    client: &Client,
    args: ListServices,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListServices` operation to AWS SDK");
    let mut req = client.list_services();
    if let Some(ref val) = args.cluster {
        req = req.cluster(val);
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
    if let Some(ref val) = args.resource_management_type {
        req = req.resource_management_type(val.as_str().into());
    }
    if let Some(ref val) = args.scheduling_strategy {
        req = req.scheduling_strategy(val.as_str().into());
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "serviceArns": resp.service_arns(),
    }))
}
