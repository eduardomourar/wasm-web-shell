#[allow(warnings)]
#[rustfmt::skip]
mod bindings;
mod commands;
mod config;
mod logger;

// Service modules
mod apigatewayv2;
mod athena;
mod cloudfront;
mod cloudtrail;
mod cloudwatch;
mod cognito_idp;
mod configservice;
mod dynamodb;
mod ec2;
mod ecs;
mod efs;
mod eks;
mod elasticache;
mod elbv2;
mod events;
mod glacier;
mod iam;
mod kms;
mod lambda;
mod logs;
mod rds;
mod redshift;
mod route53;
mod s3;
mod s3api;
mod secretsmanager;
mod sns;
mod sqs;
mod ssm;
mod sts;

#[cfg(test)]
mod test_utils;

use bindings::exports::wasi::cli::run::Guest;

struct Component;

impl Guest for Component {
    fn run() -> std::result::Result<(), ()> {
        logger::init();
        std::panic::set_hook(Box::new(move |panic_info| {
            eprintln!("Internal unhandled panic:\n{:?}!", panic_info);
            std::process::exit(1);
        }));
        match wstd::runtime::block_on(commands::run()) {
            Ok(_) => {
                tracing::debug!("Success");
            }
            Err(err) => {
                tracing::debug!("Failure");
                eprintln!("{:?}", err);
            }
        };
        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
