use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use clap::Args;
use std::fs::{File, create_dir_all};
use std::io::Write;

#[derive(Debug, Clone, Args)]
pub struct GetObject {
    #[arg(long)]
    pub bucket: String,
    #[arg(long)]
    pub key: String,

    pub outfile: Option<std::path::PathBuf>,
}

pub(crate) async fn get_object(
    client: &Client,
    GetObject {
        bucket,
        key,
        outfile,
        ..
    }: GetObject,
) -> Result<Option<Vec<u8>>, Error> {
    tracing::trace!("Preparing GetObject operation to AWS SDK");
    let operation = client.get_object().bucket(bucket).key(key);
    let mut resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let content_length = resp.content_length().unwrap_or_default() as usize;
    Ok(match outfile {
        Some(value) => {
            if let Some(parent) = value.parent() {
                create_dir_all(parent).map_err(anyhow::Error::from)?;
            };
            let mut file = File::create(value)?;

            // iterate over the stream and write to the file
            let mut bytes_len = 0;
            while let Some(v) = resp.body.next().await {
                let chunk = v.map_err(anyhow::Error::from)?;
                bytes_len += chunk.len();
                file.write_all(&chunk).map_err(anyhow::Error::from)?;
            }
            if cfg!(debug_assertions) {
                assert_eq!(content_length, bytes_len);
            }
            None
        }
        None => {
            // let inner = resp.body.collect().await;
            let mut body: Vec<u8> = Vec::new();
            // iterate over the stream and write to the file
            let mut bytes_len = 0;
            while let Some(v) = resp.body.next().await {
                let chunk = v.map_err(anyhow::Error::from)?;
                bytes_len += chunk.len();
                body.extend_from_slice(&chunk);
            }
            if cfg!(debug_assertions) {
                assert_eq!(content_length, bytes_len);
            }
            Some(body)
        }
    })
}
