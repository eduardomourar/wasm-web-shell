use crate::{
    config::{BaseOpts, build_config},
    s3::{
        get_object::{GetObject, get_object},
        list_objects::{ListObjects, list_objects},
    },
    ssm::list_public_parameters::{ListPublicParameters, list_public_parameters},
    sts::get_caller_identity::{GetCallerIdentity, get_caller_identity},
};
use anyhow::{Error, Result};
use clap::{Parser, Subcommand};

#[derive(Debug, Clone, Subcommand)]
#[command(name = "s3")]
enum S3Commands {
    GetObject(GetObject),
    ListObjects(ListObjects),
}

#[derive(Debug, Clone, Subcommand)]
#[command(name = "ssm")]
enum SsmCommands {
    ListPublicParameters(ListPublicParameters),
}

#[derive(Debug, Clone, Subcommand)]
#[command(name = "sts")]
enum StsCommands {
    GetCallerIdentity(GetCallerIdentity),
}

#[derive(Debug, Clone, Subcommand)]
enum Commands {
    S3 {
        #[command(subcommand)]
        command: S3Commands,
    },
    Ssm {
        #[command(subcommand)]
        command: SsmCommands,
    },
    Sts {
        #[command(subcommand)]
        command: StsCommands,
    },
}
#[derive(Debug, Parser)]
#[command(version, about, long_about = None)]
struct Cli {
    #[command(flatten)]
    base_opts: BaseOpts,

    #[command(subcommand)]
    command: Commands,
}

pub(crate) async fn run() -> Result<(), Error> {
    match Cli::try_parse() {
        Ok(options) => {
            let base_opts = options.base_opts;
            crate::logger::set_level(base_opts.verbose)?;
            let shared_config = build_config(base_opts.clone()).await?;

            match options.command.clone() {
                Commands::S3 { command } => match command {
                    S3Commands::GetObject(cfg) => {
                        tracing::debug!("AWS client version: {}", aws_sdk_s3::meta::PKG_VERSION);
                        let client = aws_sdk_s3::Client::new(&shared_config);
                        tracing::debug!("Running s3 get-object");
                        match get_object(&client, cfg).await {
                            Ok(value) => {
                                if let Some(parsed) = value {
                                    tracing::debug!("Parsing response");
                                    println!("{}", std::str::from_utf8(&parsed[..])?);
                                }
                            }
                            Err(err) => eprintln!("{:?}", err),
                        }
                    }
                    S3Commands::ListObjects(cfg) => {
                        tracing::debug!("AWS client version: {}", aws_sdk_s3::meta::PKG_VERSION);
                        let client = aws_sdk_s3::Client::new(&shared_config);
                        tracing::debug!("Running s3 list-objects");
                        match list_objects(&client, cfg).await {
                            Ok(value) => {
                                tracing::debug!("Parsing response contents");
                                println!("{}", serde_json::to_string_pretty(&value)?);
                            }
                            Err(err) => eprintln!("{:?}", err),
                        }
                    }
                },
                Commands::Ssm { command } => match command {
                    SsmCommands::ListPublicParameters(cfg) => {
                        tracing::debug!("AWS client version: {}", aws_sdk_ssm::meta::PKG_VERSION);
                        let client = aws_sdk_ssm::Client::new(&shared_config);
                        tracing::debug!("Running ssm list-public-parameters");
                        match list_public_parameters(&client, cfg).await {
                            Ok(value) => {
                                tracing::debug!("Parsing response");
                                println!("{}", serde_json::to_string_pretty(&value)?);
                            }
                            Err(err) => eprintln!("{:?}", err),
                        }
                    }
                },
                Commands::Sts { command } => match command {
                    StsCommands::GetCallerIdentity(cfg) => {
                        tracing::debug!("AWS client version: {}", aws_sdk_sts::meta::PKG_VERSION);
                        let client = aws_sdk_sts::Client::new(&shared_config);
                        tracing::debug!("Running sts get-caller-identity");
                        match get_caller_identity(&client, cfg).await {
                            Ok(value) => {
                                tracing::debug!("Parsing response");
                                println!("{}", serde_json::to_string_pretty(&value)?);
                            }
                            Err(err) => eprintln!("{:?}", err),
                        }
                    }
                },
            };
        }
        Err(err) => {
            err.print().unwrap();
        }
    };
    Ok(())
}
