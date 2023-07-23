use crate::{adapter::default_connector, wasi_sleep::WasiSleep};
use anyhow::{Error, Result};
use aws_config::{
    environment::EnvironmentVariableCredentialsProvider, meta::region::RegionProviderChain,
};
use aws_credential_types::{cache::CredentialsCache, provider::ProvideCredentials, Credentials};
use aws_sdk_s3::{config::Region, meta::PKG_VERSION, Client};
use aws_smithy_types::{retry::RetryConfig, timeout::TimeoutConfig};
use std::{env, process, time};
use structopt::StructOpt;

#[derive(Debug, StructOpt)]
pub struct Opt {
    /// The AWS Region.
    #[structopt(short, long)]
    region: Option<String>,

    /// Whether to display additional information.
    #[structopt(short, long)]
    verbose: bool,
}

// Displays the S3 objects.
// snippet-start:[s3.rust.list_objects]
async fn list_objects(client: &Client) -> Result<(), Error> {
    let mut operation = client
        .list_objects_v2()
        .bucket("common-screens")
        .delimiter("/")
        .prefix("metadata/")
        .max_keys(10)
        .customize()
        .await?;
    let resp = operation.map_operation(make_unsigned)?.send().await?;

    for object in resp.contents().unwrap_or_default() {
        println!("Key:          {}", object.key().unwrap_or_default());
        println!();
    }

    Ok(())
}

fn make_unsigned<O, Retry>(
    mut operation: aws_smithy_http::operation::Operation<O, Retry>,
) -> Result<aws_smithy_http::operation::Operation<O, Retry>, std::convert::Infallible> {
    {
        let mut props = operation.properties_mut();
        let mut signing_config = props
            .get_mut::<aws_sig_auth::signer::OperationSigningConfig>()
            .expect("has signing_config");
        signing_config.signing_requirements = aws_sig_auth::signer::SigningRequirements::Disabled;
    }
    Ok(operation)
}

// snippet-end:[s3.rust.list_objects]

/// Displays information about the S3 objects.
///
/// # Arguments
///
/// * `[-r REGION]` - The Region in which the client is created.
///   If the environment variable is not set, defaults to **us**.
/// * `[-v]` - Whether to display information.
// #[wasi_tokio::main()]
#[no_mangle]
pub extern "C" fn _start() {
    std::panic::set_hook(Box::new(move |panic_info| {
        println!("Internal unhandled panic:\n{:?}!", panic_info);
        process::exit(1);
    }));
    tracing_subscriber::fmt::init();

    let options = Opt::from_args();
    println!("{:?}", options);

    let res: Result<(), Error> =
        futures::executor::block_on(async move { run_example(options).await });

    match res {
        Ok(_) => {
            println!("Success");
        }
        Err(err) => {
            eprintln!("Error: {}", err);
            process::exit(1);
        }
    }
}

fn credentials_cache() -> CredentialsCache {
    CredentialsCache::lazy_builder()
        .sleep(std::sync::Arc::new(WasiSleep::default()))
        .into_credentials_cache()
}

pub async fn run_example(Opt { region, verbose }: Opt) -> Result<(), Error> {
    let region_provider =
        RegionProviderChain::first_try(region.map(Region::new)).or_else(Region::new("us-east-2"));
    println!();
    let verbose = true;

    if verbose {
        println!("S3 client version: {}", PKG_VERSION);
        println!();
    }

    let region = region_provider.region().await.unwrap();
    let shared_config = aws_config::from_env()
        .region(region_provider)
        .timeout_config(TimeoutConfig::disabled())
        .retry_config(RetryConfig::disabled())
        .sleep_impl(WasiSleep::default())
        .credentials_cache(credentials_cache())
        .credentials_provider(EnvironmentVariableCredentialsProvider::default())
        .http_connector(default_connector())
        .load()
        .await;

    let client = Client::new(&shared_config);

    if verbose {
        let now = time::SystemTime::now()
            .duration_since(time::UNIX_EPOCH)
            .expect("post epoch");
        println!("Current date in unix timestamp: {}", now.as_secs());
        println!("S3 client region: {:?}", region);
        println!("S3 client config: {:?}", shared_config);
        println!();
    }
    list_objects(&client).await
}
