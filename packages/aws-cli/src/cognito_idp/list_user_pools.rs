use anyhow::{Error, Result};
use aws_sdk_cognitoidentityprovider::Client;
use clap::Args;

/// Arguments for `cognito-idp list-user-pools`.
#[derive(Debug, Clone, Args)]
pub struct ListUserPools {
    /// The maximum number of user pools that you want Amazon Cognito to return in th...
    #[arg(long)]
    pub max_results: i32,
    /// This API operation returns a limited number of results. The pagination token is
    #[arg(long)]
    pub next_token: Option<String>,
}

/// Execute `cognito-idp list-user-pools`.
pub(crate) async fn list_user_pools(
    client: &Client,
    args: ListUserPools,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `ListUserPools` operation to AWS SDK");
    let mut req = client.list_user_pools();
    req = req.max_results(args.max_results);
    if let Some(ref val) = args.next_token {
        req = req.next_token(val);
    }
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "nextToken": resp.next_token(),
    "userPools": resp.user_pools().iter().map(|v| serde_json::json!({
    "creationDate": v.creation_date().map(|t| t.to_string()),
    "id": v.id(),
    "lastModifiedDate": v.last_modified_date().map(|t| t.to_string()),
    "name": v.name(),
    "replicaRegions": v.replica_regions().iter().map(|e| format!("{:?}", e)).collect::<Vec<_>>(),
    })).collect::<Vec<_>>(),
    }))
}
