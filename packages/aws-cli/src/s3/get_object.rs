use crate::commands::BaseOpts;
use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use structopt::StructOpt;

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "get-object")]
pub struct GetObject {
    #[structopt(long)]
    bucket: String,
    #[structopt(long)]
    key: String,

    #[structopt(parse(from_os_str))]
    outfile: std::path::PathBuf,

    #[structopt(flatten)]
    pub base_opts: BaseOpts,
}

pub(crate) async fn get_object(
    client: &Client,
    GetObject {
        bucket,
        key,
        outfile,
        ..
    }: GetObject,
) -> Result<(), Error> {
    tracing::trace!("Preparing GetObject operation to AWS SDK");
    let operation = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .customize()
        .await?;
    let resp = operation.send().await.map_err(anyhow::Error::from)?;
    tracing::trace!("Operation response {:?}", resp);
    let content_length = resp.content_length() as usize;
    let inner = resp.body.into_inner();
    let body = inner.bytes().unwrap(); //.collect().await.unwrap().to_vec();
    std::fs::write(&outfile, body).unwrap(); //.map_err(anyhow::Error::from)?;
    assert_eq!(content_length, body.len());
    Ok(())
}

#[cfg(test)]
mod test {
    use std::path::PathBuf;

    use super::{get_object, GetObject};
    use crate::commands::{build_client, BaseOpts};

    #[tokio::test]
    pub async fn test_s3_get_object() {
        let base_opts = BaseOpts {
            region: Some("us-east-1".to_string()),
            verbose: 0,
        };
        let output = PathBuf::from("/tmp/test-s3-get-object.html");
        get_object(
            &build_client(base_opts.clone()).await.unwrap(),
            GetObject {
                bucket: "genome-browser".to_string(),
                key: "htdocs/index.html".to_string(),
                outfile: output.clone(),
                base_opts,
            },
        )
        .await
        .unwrap();
        assert!(output.exists());
    }
}
