use anyhow::{Error, Result};
use aws_sdk_sts::Client;
use clap::Args;

/// Arguments for `sts decode-authorization-message`.
#[derive(Debug, Clone, Args)]
pub struct DecodeAuthorizationMessage {
    /// The encoded message that was returned with the response.
    #[arg(long)]
    pub encoded_message: String,
}

/// Execute `sts decode-authorization-message`.
pub(crate) async fn decode_authorization_message(
    client: &Client,
    args: DecodeAuthorizationMessage,
) -> Result<serde_json::Value, Error> {
    tracing::debug!("Preparing `DecodeAuthorizationMessage` operation to AWS SDK");
    let mut req = client.decode_authorization_message();
    req = req.encoded_message(&args.encoded_message);
    let resp = req.send().await?;
    Ok(serde_json::json!({
    "decodedMessage": resp.decoded_message(),
    }))
}
