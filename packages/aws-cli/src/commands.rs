use crate::{
    adapter::default_connector,
    s3::{
        get_object::{get_object, GetObject},
        list_objects::{list_objects, ListObjects},
    },
};
use anyhow::{Error, Result};
use aws_config::meta::region::RegionProviderChain;
use aws_sdk_s3::{config::Region, meta::PKG_VERSION, Client};
use aws_smithy_types::{retry::RetryConfig, timeout::TimeoutConfig};
use std::time;
use structopt::StructOpt;

#[derive(Debug, Clone, StructOpt)]
enum Subcommands {
    GetObject(GetObject),
    ListObjects(ListObjects),
}

#[derive(Debug, Clone, StructOpt)]
#[structopt(name = "s3")]
struct Opt {
    #[structopt(subcommand)]
    sub: Subcommands,
}

#[derive(Debug, Clone, StructOpt)]
pub struct BaseOpts {
    /// The AWS Region.
    #[structopt(long)]
    pub region: Option<String>,

    /// Whether to display additional information.
    #[structopt(short, long, parse(from_occurrences))]
    pub verbose: usize,
}

pub(crate) async fn run() {
    let options = Opt::from_args();

    let res: Result<(), Error> = match options.sub.clone() {
        Subcommands::ListObjects(cfg) => {
            if cfg.base_opts.verbose > 0 {
                crate::logger::set_level(cfg.base_opts.verbose).unwrap();
            }

            tracing::debug!("Running list objects");
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
        Subcommands::GetObject(cfg) => {
            if cfg.base_opts.verbose > 0 {
                crate::logger::set_level(cfg.base_opts.verbose).unwrap();
            }

            tracing::debug!("Running get object");
            let client = build_client(cfg.base_opts.clone())
                .await
                .expect("building client");

            get_object(&client, cfg).await.unwrap();

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

pub(crate) async fn build_client(BaseOpts { region, .. }: BaseOpts) -> Result<Client, Error> {
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
    use super::{build_client, BaseOpts};

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
}
