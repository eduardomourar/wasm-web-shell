use anyhow::{Error, Result};
use aws_sdk_sts::Client;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub struct GetCallerIdentity {
    #[arg(long, default_value_t = false)]
    pub only_user_id: bool,
}

pub(crate) async fn get_caller_identity(
    client: &Client,
    GetCallerIdentity { only_user_id, .. }: GetCallerIdentity,
) -> Result<serde_json::Value, Error> {
    tracing::trace!("Preparing GetCallerIdentity operation to AWS SDK");
    let operation = client.get_caller_identity();

    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    Ok(if only_user_id {
        serde_json::json!({
            "userId": resp.user_id(),
        })
    } else {
        serde_json::json!({
            "account": resp.account(),
            "arn": resp.arn(),
            "userId": resp.user_id(),
        })
    })
}
