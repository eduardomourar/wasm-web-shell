use crate::commands::BaseOpts;
use anyhow::{Error, Result};
use aws_sdk_s3::Client;
use aws_smithy_http::body;
use structopt::StructOpt;

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "get-object")]
pub struct GetObject {
    #[structopt(long)]
    bucket: String,
    #[structopt(long)]
    key: String,

    #[structopt(parse(from_os_str))]
    outfile: Option<std::path::PathBuf>,

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
) -> Result<Option<Vec<u8>>, Error> {
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
    let inner = resp.body.collect().await;
    let body = inner.map_err(anyhow::Error::from)?.to_vec();
    Ok(match outfile {
        Some(value) => {
            std::fs::write(&value, &body).map_err(anyhow::Error::from)?;
            assert_eq!(content_length, body.len());
            None
        }
        None => Some(body.to_vec()),
    })
}

#[cfg(test)]
mod test {
    use std::path::PathBuf;

    use super::{get_object, GetObject};
    use crate::commands::{build_client, BaseOpts};

    #[tokio::test]
    pub async fn s3_get_object_to_file() {
        let base_opts = BaseOpts {
            region: Some("us-east-1".to_string()),
            verbose: 0,
        };
        let output = PathBuf::from("/tmp/readme.txt");
        let client = build_client(base_opts.clone()).await.unwrap();
        let result = get_object(
            &client,
            GetObject {
                bucket: "pan-ukb-us-east-1".to_string(),
                key: "sumstats_release/results_full.mt/README.txt".to_string(),
                outfile: Some(output.clone()),
                base_opts,
            },
        )
        .await
        .unwrap();
        assert!(output.exists());
        assert!(result.is_none());
    }

    #[tokio::test]
    pub async fn s3_get_object_to_stdout() {
        let base_opts = BaseOpts {
            region: Some("us-east-1".to_string()),
            verbose: 0,
        };
        let client = build_client(base_opts.clone()).await.unwrap();
        let result = get_object(
            &client,
            GetObject {
                bucket: "genome-browser".to_string(),
                key: "htdocs/index.html".to_string(),
                outfile: None,
                base_opts,
            },
        )
        .await
        .unwrap()
        .unwrap();
        assert!(result.len() > 1);
    }
}
