use crate::commands::BaseOpts;
use anyhow::{Error, Result};
use aws_sdk_s3::{operation::list_objects_v2::ListObjectsV2Output, Client};
use structopt::StructOpt;

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "list-objects")]
pub struct ListObjects {
    #[structopt(long)]
    bucket: Option<String>,
    #[structopt(long)]
    delimiter: Option<String>,
    #[structopt(long)]
    prefix: Option<String>,
    #[structopt(long)]
    max_keys: Option<i32>,

    #[structopt(flatten)]
    pub base_opts: BaseOpts,
}

pub(crate) async fn list_objects(
    client: &Client,
    ListObjects {
        bucket,
        delimiter,
        prefix,
        max_keys,
        ..
    }: ListObjects,
) -> Result<ListObjectsV2Output, Error> {
    tracing::trace!("Preparing ListObjects operation to AWS SDK");
    let operation = client
        .list_objects_v2()
        .bucket(bucket.unwrap_or("nara-national-archives-catalog".to_string()))
        .delimiter(delimiter.unwrap_or("/".to_string()))
        .set_prefix(prefix)
        .set_max_keys(max_keys)
        .customize()
        .await?;

    let resp = operation.send().await.map_err(anyhow::Error::from);
    tracing::trace!("Operation response {:?}", resp);
    resp
}

#[cfg(test)]
mod test {
    use super::{list_objects, ListObjects};
    use crate::commands::{build_client, BaseOpts};

    #[tokio::test]
    pub async fn s3_list_objects() {
        let base_opts = BaseOpts {
            region: Some("us-east-2".to_string()),
            verbose: 0,
        };
        let result = list_objects(
            &build_client(base_opts.clone()).await.unwrap(),
            ListObjects {
                bucket: Some("nara-national-archives-catalog".to_string()),
                delimiter: Some("/".to_string()),
                prefix: Some("authority-records/organization/".to_string()),
                max_keys: Some(2),
                base_opts,
            },
        )
        .await
        .unwrap();
        let objects = result.contents().unwrap();
        assert!(objects.len() > 1);
    }
}
