use crate::adapter::default_connector;
use anyhow::{Error, Result};
use aws_config::meta::region::RegionProviderChain;
use aws_sdk_s3::{
    config::Region, meta::PKG_VERSION, operation::list_objects_v2::ListObjectsV2Output, Client,
};
use aws_smithy_types::{retry::RetryConfig, timeout::TimeoutConfig};
use std::time;
use structopt::StructOpt;

#[derive(Debug, Clone, StructOpt)]
enum Subcommands {
    ListObjects(ListObjects),
}

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "list-objects")]
struct ListObjects {
    #[structopt(long)]
    bucket: Option<String>,
    #[structopt(long)]
    delimiter: Option<String>,
    #[structopt(long)]
    prefix: Option<String>,
    #[structopt(long)]
    max_keys: Option<i32>,

    #[structopt(flatten)]
    base_opts: BaseOpts,
}

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "s3")]
struct Opt {
    #[structopt(subcommand)]
    sub: Subcommands,
}

#[derive(Debug, Clone, StructOpt)]
struct BaseOpts {
    /// The AWS Region.
    #[structopt(long)]
    region: Option<String>,

    /// Whether to display additional information.
    #[structopt(short, long, parse(from_occurrences))]
    verbose: usize,
}

// Displays the S3 objects.
// snippet-start:[s3.rust.list_objects]
async fn list_objects(
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

// snippet-end:[s3.rust.list_objects]

/// Displays information about the S3 objects.
///
/// # Arguments
///
/// * `[-r REGION]` - The Region in which the client is created.
///   If the environment variable is not set, defaults to **us**.
/// * `[-v]` - Whether to display information.
pub(crate) async fn run() {
    let options = Opt::from_args();

    let res: Result<(), Error> = match options.sub.clone() {
        Subcommands::ListObjects(cfg) => {
            if cfg.base_opts.verbose > 0 {
                crate::logger::set_level(cfg.base_opts.verbose).unwrap();
            }

            tracing::trace!("Running list objects");
            let client = build_client(cfg.base_opts.clone())
                .await
                .expect("building client");

            match list_objects(&client, cfg).await {
                Ok(value) => {
                    tracing::debug!("Parsing response contents");
                    println!("{:#?}", value.contents().unwrap());
                }
                Err(err) => eprintln!("{:?}", err),
            }

            Ok(())
        }
    };

    match res {
        Ok(_) => {
            tracing::debug!("Success");
        }
        Err(err) => {
            panic!("Error: {}", err);
        }
    }
}

async fn build_client(BaseOpts { region, .. }: BaseOpts) -> Result<Client, Error> {
    tracing::trace!("Building default client");

    let region_provider =
        RegionProviderChain::first_try(region.map(Region::new)).or_else(Region::new("us-east-2"));
    tracing::debug!("S3 client version: {}", PKG_VERSION);

    let region = region_provider.region().await.unwrap();
    let shared_config = aws_config::from_env()
        .timeout_config(TimeoutConfig::disabled())
        .retry_config(RetryConfig::disabled())
        .http_connector(default_connector())
        .no_credentials()
        .region(region_provider)
        .load()
        .await;

    let client = Client::new(&shared_config);

    let now = time::SystemTime::now()
        .duration_since(time::UNIX_EPOCH)
        .expect("post epoch");
    tracing::trace!("Current date in unix timestamp: {}", now.as_secs());
    tracing::debug!("S3 client region: {:?}", region);
    tracing::debug!("S3 client config: {:?}", shared_config);

    Ok(client)
}

#[cfg(test)]
mod test {
    use super::{build_client, list_objects, BaseOpts, ListObjects};

    #[tokio::test]
    pub async fn test_default_config() {
        let client = build_client(BaseOpts {
            region: Some("us-east-2".to_string()),
            verbose: 0,
        })
        .await
        .unwrap();
        assert_eq!(client.config().region().unwrap().to_string(), "us-east-2")
    }

    #[tokio::test]
    pub async fn test_s3_list_objects() {
        let base_opts = BaseOpts {
            region: None,
            verbose: 5,
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
