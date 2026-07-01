use anyhow::{Error, Result};
use aws_sdk_ssm::Client;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct ListPublicParameters {
    #[arg(long)]
    pub max_items: Option<i32>,
}

pub(crate) async fn list_public_parameters(
    client: &Client,
    ListPublicParameters { max_items, .. }: ListPublicParameters,
) -> Result<serde_json::Value, Error> {
    tracing::trace!("Preparing GetParametersByPath operation to AWS SDK");
    let operation = client
        .get_parameters_by_path()
        .path("/aws/service/list")
        .set_max_results(max_items);

    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let parameters = resp
        .parameters()
        .iter()
        .map(|v| {
            serde_json::json!({
                "arn": v.arn(),
                "dataType": v.data_type(),
                "lastModifiedDate": v.last_modified_date().map(|v| v.to_string()),
                "name": v.name(),
                "value": v.value(),
                "version": v.version(),
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({"parameters": parameters}))
}
