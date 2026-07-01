use anyhow::{Error, Result};
use aws_sdk_apigatewayv2::Client;
use clap::Args;

/// Arguments for `apigatewayv2 get-apis`.
#[derive(Debug, Clone, Args)]
pub struct GetApis {
    /// The maximum number of elements to be returned for this resource.
    #[arg(long)]
    pub max_results: Option<String>,
    /// The next page of elements from this collection. Not valid for the last elemen...
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `apigatewayv2 get-apis`.
pub(crate) async fn get_apis(client: &Client, args: GetApis) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `GetApis` operation to AWS SDK");
    let mut req = client.get_apis();
    if let Some(ref val) = args.max_results {
        req = req.max_results(val);
    }
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "items": resp.items().iter().map(|v| serde_json::json!({
    "apiEndpoint": v.api_endpoint(),
    "apiGatewayManaged": v.api_gateway_managed(),
    "apiId": v.api_id(),
    "apiKeySelectionExpression": v.api_key_selection_expression(),
    "createdDate": v.created_date().map(|t| t.to_string()),
    "description": v.description(),
    "disableExecuteApiEndpoint": v.disable_execute_api_endpoint(),
    "disableSchemaValidation": v.disable_schema_validation(),
    "importInfo": v.import_info().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    "ipAddressType": v.ip_address_type().map(|e| e.as_str()),
    "name": v.name(),
    "routeSelectionExpression": v.route_selection_expression(),
    "version": v.version(),
    "warnings": v.warnings().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    })).collect::<Vec<_>>(),
    "nextToken": resp.next_token(),
    }))
}
