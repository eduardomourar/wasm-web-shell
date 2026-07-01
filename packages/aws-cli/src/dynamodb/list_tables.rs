use anyhow::{Error, Result};
use aws_sdk_dynamodb::Client;
use clap::Args;

/// Arguments for `dynamodb list-tables`.
#[derive(Debug, Clone, Args)]
pub struct ListTables {
    /// The first table name that this operation will evaluate. Use the value that was
    #[arg(long)]
    pub exclusive_start_table_name: Option<String>,
    /// A maximum number of table names to return. If this parameter is not specified...
    #[arg(long)]
    pub limit: Option<i32>,
}

/// Execute `dynamodb list-tables`.
pub(crate) async fn list_tables(
    client: &Client,
    args: ListTables,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListTables` operation to AWS SDK");
    let mut req = client.list_tables();
    if let Some(ref val) = args.exclusive_start_table_name {
        req = req.exclusive_start_table_name(val);
    }
    if let Some(val) = args.limit {
        req = req.limit(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "lastEvaluatedTableName": resp.last_evaluated_table_name(),
    "tableNames": resp.table_names(),
    }))
}
