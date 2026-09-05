use crate::{
    apigatewayv2::get_apis::{GetApis, get_apis},
    athena::list_work_groups::{ListWorkGroups, list_work_groups},
    cloudfront::list_distributions::{ListDistributions, list_distributions},
    cloudtrail::lookup_events::{LookupEvents, lookup_events},
    cloudwatch::{
        describe_alarms::{DescribeAlarms, describe_alarms},
        list_metrics::{ListMetrics, list_metrics},
    },
    cognito_idp::list_user_pools::{ListUserPools, list_user_pools},
    config::{BaseOpts, build_config},
    configservice::describe_config_rules::{DescribeConfigRules, describe_config_rules},
    dynamodb::list_tables::{ListTables, list_tables},
    ec2::{
        describe_instances::{DescribeInstances, describe_instances},
        describe_security_groups::{DescribeSecurityGroups, describe_security_groups},
        describe_subnets::{DescribeSubnets, describe_subnets},
        describe_vpcs::{DescribeVpcs, describe_vpcs},
    },
    ecs::{
        list_clusters::{self as ecs_list_clusters, ListClusters as EcsListClusters},
        list_services::{ListServices, list_services},
        list_tasks::{ListTasks, list_tasks},
    },
    efs::describe_file_systems::{DescribeFileSystems, describe_file_systems},
    eks::list_clusters::{self as eks_list_clusters, ListClusters as EksListClusters},
    elasticache::describe_cache_clusters::{DescribeCacheClusters, describe_cache_clusters},
    elbv2::{
        describe_load_balancers::{DescribeLoadBalancers, describe_load_balancers},
        describe_target_groups::{DescribeTargetGroups, describe_target_groups},
    },
    events::list_rules::{ListRules, list_rules},
    glacier::list_vaults::{ListVaults, list_vaults},
    iam::{
        list_policies::{ListPolicies, list_policies},
        list_roles::{ListRoles, list_roles},
        list_users::{ListUsers, list_users},
    },
    kms::list_keys::{ListKeys, list_keys},
    lambda::list_functions::{ListFunctions, list_functions},
    logs::list_log_groups::{ListLogGroups, list_log_groups},
    rds::describe_db_instances::{DescribeDbInstances, describe_db_instances},
    redshift::describe_clusters::{DescribeClusters, describe_clusters},
    route53::list_hosted_zones::{ListHostedZones, list_hosted_zones},
    s3::{
        cp::{Cp, cp},
        ls::{Ls, ls},
        mv::{Mv, mv},
        rm::{Rm, rm},
    },
    s3api::{
        get_object::{GetObject, get_object},
        list_buckets::{ListBuckets, list_buckets},
        list_objects::{ListObjects, list_objects},
    },
    secretsmanager::list_secrets::{ListSecrets, list_secrets},
    sns::{
        list_subscriptions::{ListSubscriptions, list_subscriptions},
        list_topics::{ListTopics, list_topics},
    },
    sqs::list_queues::{ListQueues, list_queues},
    ssm::{
        get_parameters_by_path::{GetParametersByPath, get_parameters_by_path},
        list_public_parameters::{ListPublicParameters, list_public_parameters},
    },
    sts::{
        decode_authorization_message::{DecodeAuthorizationMessage, decode_authorization_message},
        get_caller_identity::{GetCallerIdentity, get_caller_identity},
    },
};
use anyhow::{Error, Result};
use clap::{Parser, Subcommand};

// --- Subcommand enums ---

#[derive(Debug, Clone, Subcommand)]
enum Apigatewayv2Commands {
    GetApis(GetApis),
}

#[derive(Debug, Clone, Subcommand)]
enum AthenaCommands {
    ListWorkGroups(ListWorkGroups),
}

#[derive(Debug, Clone, Subcommand)]
enum CloudfrontCommands {
    ListDistributions(ListDistributions),
}

#[derive(Debug, Clone, Subcommand)]
enum CloudtrailCommands {
    LookupEvents(LookupEvents),
}

#[derive(Debug, Clone, Subcommand)]
enum CloudwatchCommands {
    ListMetrics(ListMetrics),
    DescribeAlarms(DescribeAlarms),
}

#[derive(Debug, Clone, Subcommand)]
enum CognitoIdpCommands {
    ListUserPools(ListUserPools),
}

#[derive(Debug, Clone, Subcommand)]
enum ConfigserviceCommands {
    DescribeConfigRules(DescribeConfigRules),
}

#[derive(Debug, Clone, Subcommand)]
enum DynamodbCommands {
    ListTables(ListTables),
}

#[derive(Debug, Clone, Subcommand)]
enum Ec2Commands {
    DescribeInstances(DescribeInstances),
    DescribeVpcs(DescribeVpcs),
    DescribeSubnets(DescribeSubnets),
    DescribeSecurityGroups(DescribeSecurityGroups),
}

#[derive(Debug, Clone, Subcommand)]
enum EcsCommands {
    ListClusters(EcsListClusters),
    ListServices(ListServices),
    ListTasks(ListTasks),
}

#[derive(Debug, Clone, Subcommand)]
enum EfsCommands {
    DescribeFileSystems(DescribeFileSystems),
}

#[derive(Debug, Clone, Subcommand)]
enum EksCommands {
    ListClusters(EksListClusters),
}

#[derive(Debug, Clone, Subcommand)]
enum ElasticacheCommands {
    DescribeCacheClusters(DescribeCacheClusters),
}

#[derive(Debug, Clone, Subcommand)]
enum Elbv2Commands {
    DescribeLoadBalancers(DescribeLoadBalancers),
    DescribeTargetGroups(DescribeTargetGroups),
}

#[derive(Debug, Clone, Subcommand)]
enum EventsCommands {
    ListRules(ListRules),
}

#[derive(Debug, Clone, Subcommand)]
enum GlacierCommands {
    ListVaults(ListVaults),
}

#[derive(Debug, Clone, Subcommand)]
enum IamCommands {
    ListUsers(ListUsers),
    ListRoles(ListRoles),
    ListPolicies(ListPolicies),
}

#[derive(Debug, Clone, Subcommand)]
enum KmsCommands {
    ListKeys(ListKeys),
}

#[derive(Debug, Clone, Subcommand)]
enum LambdaCommands {
    ListFunctions(ListFunctions),
}

#[derive(Debug, Clone, Subcommand)]
enum LogsCommands {
    ListLogGroups(ListLogGroups),
}

#[derive(Debug, Clone, Subcommand)]
enum RdsCommands {
    DescribeDbInstances(DescribeDbInstances),
}

#[derive(Debug, Clone, Subcommand)]
enum RedshiftCommands {
    DescribeClusters(DescribeClusters),
}

#[derive(Debug, Clone, Subcommand)]
enum Route53Commands {
    ListHostedZones(ListHostedZones),
}

#[derive(Debug, Clone, Subcommand)]
enum S3Commands {
    Cp(Cp),
    Ls(Ls),
    Mv(Mv),
    Rm(Rm),
}

#[derive(Debug, Clone, Subcommand)]
enum S3apiCommands {
    GetObject(GetObject),
    ListBuckets(ListBuckets),
    ListObjects(ListObjects),
}

#[derive(Debug, Clone, Subcommand)]
enum SecretsmanagerCommands {
    ListSecrets(ListSecrets),
}

#[derive(Debug, Clone, Subcommand)]
enum SnsCommands {
    ListTopics(ListTopics),
    ListSubscriptions(ListSubscriptions),
}

#[derive(Debug, Clone, Subcommand)]
enum SqsCommands {
    ListQueues(ListQueues),
}

#[derive(Debug, Clone, Subcommand)]
enum SsmCommands {
    GetParametersByPath(GetParametersByPath),
    ListPublicParameters(ListPublicParameters),
}

#[derive(Debug, Clone, Subcommand)]
enum StsCommands {
    DecodeAuthorizationMessage(DecodeAuthorizationMessage),
    GetCallerIdentity(GetCallerIdentity),
}

// --- Top-level command routing ---

#[derive(Debug, Clone, Subcommand)]
enum Commands {
    Apigatewayv2 {
        #[command(subcommand)]
        command: Apigatewayv2Commands,
    },
    Athena {
        #[command(subcommand)]
        command: AthenaCommands,
    },
    Cloudfront {
        #[command(subcommand)]
        command: CloudfrontCommands,
    },
    Cloudtrail {
        #[command(subcommand)]
        command: CloudtrailCommands,
    },
    Cloudwatch {
        #[command(subcommand)]
        command: CloudwatchCommands,
    },
    CognitoIdp {
        #[command(subcommand)]
        command: CognitoIdpCommands,
    },
    Configservice {
        #[command(subcommand)]
        command: ConfigserviceCommands,
    },
    Dynamodb {
        #[command(subcommand)]
        command: DynamodbCommands,
    },
    Ec2 {
        #[command(subcommand)]
        command: Ec2Commands,
    },
    Ecs {
        #[command(subcommand)]
        command: EcsCommands,
    },
    Efs {
        #[command(subcommand)]
        command: EfsCommands,
    },
    Eks {
        #[command(subcommand)]
        command: EksCommands,
    },
    Elasticache {
        #[command(subcommand)]
        command: ElasticacheCommands,
    },
    Elbv2 {
        #[command(subcommand)]
        command: Elbv2Commands,
    },
    Events {
        #[command(subcommand)]
        command: EventsCommands,
    },
    Glacier {
        #[command(subcommand)]
        command: GlacierCommands,
    },
    Iam {
        #[command(subcommand)]
        command: IamCommands,
    },
    Kms {
        #[command(subcommand)]
        command: KmsCommands,
    },
    Lambda {
        #[command(subcommand)]
        command: LambdaCommands,
    },
    Logs {
        #[command(subcommand)]
        command: LogsCommands,
    },
    Rds {
        #[command(subcommand)]
        command: RdsCommands,
    },
    Redshift {
        #[command(subcommand)]
        command: RedshiftCommands,
    },
    Route53 {
        #[command(subcommand)]
        command: Route53Commands,
    },
    S3 {
        #[command(subcommand)]
        command: S3Commands,
    },
    S3api {
        #[command(subcommand)]
        command: S3apiCommands,
    },
    Secretsmanager {
        #[command(subcommand)]
        command: SecretsmanagerCommands,
    },
    Sns {
        #[command(subcommand)]
        command: SnsCommands,
    },
    Sqs {
        #[command(subcommand)]
        command: SqsCommands,
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

/// Helper: build config, create client, run operation, print JSON result.
macro_rules! run_json_command {
    ($service_id:expr, $base_opts:expr, $client_type:ty, $cfg:expr, $handler:expr) => {{
        let config = build_config(Some($service_id.to_string()), $base_opts.clone()).await?;
        let client = <$client_type>::new(&config);
        match $handler(&client, $cfg).await {
            Ok(value) => println!("{}", serde_json::to_string_pretty(&value)?),
            Err(err) => eprintln!("{:?}", err),
        }
    }};
}

pub(crate) async fn run() -> Result<(), Error> {
    match Cli::try_parse() {
        Ok(options) => {
            let base_opts = options.base_opts;
            crate::logger::set_level(base_opts.verbose)?;
            match options.command.clone() {
                Commands::Apigatewayv2 { command } => match command {
                    Apigatewayv2Commands::GetApis(cfg) => run_json_command!(
                        "apigatewayv2",
                        base_opts,
                        aws_sdk_apigatewayv2::Client,
                        cfg,
                        get_apis
                    ),
                },
                Commands::Athena { command } => match command {
                    AthenaCommands::ListWorkGroups(cfg) => run_json_command!(
                        "athena",
                        base_opts,
                        aws_sdk_athena::Client,
                        cfg,
                        list_work_groups
                    ),
                },
                Commands::Cloudfront { command } => match command {
                    CloudfrontCommands::ListDistributions(cfg) => run_json_command!(
                        "cloudfront",
                        base_opts,
                        aws_sdk_cloudfront::Client,
                        cfg,
                        list_distributions
                    ),
                },
                Commands::Cloudtrail { command } => match command {
                    CloudtrailCommands::LookupEvents(cfg) => run_json_command!(
                        "cloudtrail",
                        base_opts,
                        aws_sdk_cloudtrail::Client,
                        cfg,
                        lookup_events
                    ),
                },
                Commands::Cloudwatch { command } => match command {
                    CloudwatchCommands::ListMetrics(cfg) => run_json_command!(
                        "cloudwatch",
                        base_opts,
                        aws_sdk_cloudwatch::Client,
                        cfg,
                        list_metrics
                    ),
                    CloudwatchCommands::DescribeAlarms(cfg) => run_json_command!(
                        "cloudwatch",
                        base_opts,
                        aws_sdk_cloudwatch::Client,
                        cfg,
                        describe_alarms
                    ),
                },
                Commands::CognitoIdp { command } => match command {
                    CognitoIdpCommands::ListUserPools(cfg) => run_json_command!(
                        "cognito-idp",
                        base_opts,
                        aws_sdk_cognitoidentityprovider::Client,
                        cfg,
                        list_user_pools
                    ),
                },
                Commands::Configservice { command } => match command {
                    ConfigserviceCommands::DescribeConfigRules(cfg) => run_json_command!(
                        "config",
                        base_opts,
                        aws_sdk_config::Client,
                        cfg,
                        describe_config_rules
                    ),
                },
                Commands::Dynamodb { command } => match command {
                    DynamodbCommands::ListTables(cfg) => run_json_command!(
                        "dynamodb",
                        base_opts,
                        aws_sdk_dynamodb::Client,
                        cfg,
                        list_tables
                    ),
                },
                Commands::Ec2 { command } => match command {
                    Ec2Commands::DescribeInstances(cfg) => run_json_command!(
                        "ec2",
                        base_opts,
                        aws_sdk_ec2::Client,
                        cfg,
                        describe_instances
                    ),
                    Ec2Commands::DescribeVpcs(cfg) => {
                        run_json_command!("ec2", base_opts, aws_sdk_ec2::Client, cfg, describe_vpcs)
                    }
                    Ec2Commands::DescribeSubnets(cfg) => run_json_command!(
                        "ec2",
                        base_opts,
                        aws_sdk_ec2::Client,
                        cfg,
                        describe_subnets
                    ),
                    Ec2Commands::DescribeSecurityGroups(cfg) => run_json_command!(
                        "ec2",
                        base_opts,
                        aws_sdk_ec2::Client,
                        cfg,
                        describe_security_groups
                    ),
                },
                Commands::Ecs { command } => match command {
                    EcsCommands::ListClusters(cfg) => run_json_command!(
                        "ecs",
                        base_opts,
                        aws_sdk_ecs::Client,
                        cfg,
                        ecs_list_clusters::list_clusters
                    ),
                    EcsCommands::ListServices(cfg) => {
                        run_json_command!("ecs", base_opts, aws_sdk_ecs::Client, cfg, list_services)
                    }
                    EcsCommands::ListTasks(cfg) => {
                        run_json_command!("ecs", base_opts, aws_sdk_ecs::Client, cfg, list_tasks)
                    }
                },
                Commands::Eks { command } => match command {
                    EksCommands::ListClusters(cfg) => run_json_command!(
                        "eks",
                        base_opts,
                        aws_sdk_eks::Client,
                        cfg,
                        eks_list_clusters::list_clusters
                    ),
                },

                Commands::Efs { command } => match command {
                    EfsCommands::DescribeFileSystems(cfg) => run_json_command!(
                        "elasticfilesystem",
                        base_opts,
                        aws_sdk_efs::Client,
                        cfg,
                        describe_file_systems
                    ),
                },
                Commands::Elasticache { command } => match command {
                    ElasticacheCommands::DescribeCacheClusters(cfg) => run_json_command!(
                        "elasticache",
                        base_opts,
                        aws_sdk_elasticache::Client,
                        cfg,
                        describe_cache_clusters
                    ),
                },
                Commands::Elbv2 { command } => match command {
                    Elbv2Commands::DescribeLoadBalancers(cfg) => run_json_command!(
                        "elasticloadbalancing",
                        base_opts,
                        aws_sdk_elasticloadbalancingv2::Client,
                        cfg,
                        describe_load_balancers
                    ),
                    Elbv2Commands::DescribeTargetGroups(cfg) => run_json_command!(
                        "elasticloadbalancing",
                        base_opts,
                        aws_sdk_elasticloadbalancingv2::Client,
                        cfg,
                        describe_target_groups
                    ),
                },
                Commands::Events { command } => match command {
                    EventsCommands::ListRules(cfg) => run_json_command!(
                        "events",
                        base_opts,
                        aws_sdk_eventbridge::Client,
                        cfg,
                        list_rules
                    ),
                },
                Commands::Glacier { command } => match command {
                    GlacierCommands::ListVaults(cfg) => run_json_command!(
                        "glacier",
                        base_opts,
                        aws_sdk_glacier::Client,
                        cfg,
                        list_vaults
                    ),
                },
                Commands::Iam { command } => match command {
                    IamCommands::ListUsers(cfg) => {
                        run_json_command!("iam", base_opts, aws_sdk_iam::Client, cfg, list_users)
                    }
                    IamCommands::ListRoles(cfg) => {
                        run_json_command!("iam", base_opts, aws_sdk_iam::Client, cfg, list_roles)
                    }
                    IamCommands::ListPolicies(cfg) => {
                        run_json_command!("iam", base_opts, aws_sdk_iam::Client, cfg, list_policies)
                    }
                },
                Commands::Kms { command } => match command {
                    KmsCommands::ListKeys(cfg) => {
                        run_json_command!("kms", base_opts, aws_sdk_kms::Client, cfg, list_keys)
                    }
                },
                Commands::Lambda { command } => match command {
                    LambdaCommands::ListFunctions(cfg) => run_json_command!(
                        "lambda",
                        base_opts,
                        aws_sdk_lambda::Client,
                        cfg,
                        list_functions
                    ),
                },
                Commands::Logs { command } => match command {
                    LogsCommands::ListLogGroups(cfg) => run_json_command!(
                        "logs",
                        base_opts,
                        aws_sdk_cloudwatchlogs::Client,
                        cfg,
                        list_log_groups
                    ),
                },
                Commands::Rds { command } => match command {
                    RdsCommands::DescribeDbInstances(cfg) => run_json_command!(
                        "rds",
                        base_opts,
                        aws_sdk_rds::Client,
                        cfg,
                        describe_db_instances
                    ),
                },
                Commands::Redshift { command } => match command {
                    RedshiftCommands::DescribeClusters(cfg) => run_json_command!(
                        "redshift",
                        base_opts,
                        aws_sdk_redshift::Client,
                        cfg,
                        describe_clusters
                    ),
                },
                Commands::Route53 { command } => match command {
                    Route53Commands::ListHostedZones(cfg) => run_json_command!(
                        "route53",
                        base_opts,
                        aws_sdk_route53::Client,
                        cfg,
                        list_hosted_zones
                    ),
                },
                Commands::S3 { command } => {
                    let config = build_config(Some("s3".to_string()), base_opts.clone()).await?;
                    let client = aws_sdk_s3::Client::new(&config);
                    match command {
                        S3Commands::Cp(cfg) => {
                            if let Err(e) = cp(&client, cfg).await {
                                eprintln!("{:?}", e);
                            }
                        }
                        S3Commands::Ls(cfg) => {
                            if let Err(e) = ls(&client, cfg).await {
                                eprintln!("{:?}", e);
                            }
                        }
                        S3Commands::Mv(cfg) => {
                            if let Err(e) = mv(&client, cfg).await {
                                eprintln!("{:?}", e);
                            }
                        }
                        S3Commands::Rm(cfg) => {
                            if let Err(e) = rm(&client, cfg).await {
                                eprintln!("{:?}", e);
                            }
                        }
                    }
                }
                Commands::S3api { command } => {
                    let config = build_config(Some("s3".to_string()), base_opts.clone()).await?;
                    let client = aws_sdk_s3::Client::new(&config);
                    match command {
                        S3apiCommands::GetObject(cfg) => match get_object(&client, cfg).await {
                            Ok(Some(data)) => println!("{}", std::str::from_utf8(&data)?),
                            Ok(None) => {}
                            Err(e) => eprintln!("{:?}", e),
                        },
                        S3apiCommands::ListBuckets(cfg) => run_json_command!(
                            "s3",
                            base_opts,
                            aws_sdk_s3::Client,
                            cfg,
                            list_buckets
                        ),
                        S3apiCommands::ListObjects(cfg) => run_json_command!(
                            "s3",
                            base_opts,
                            aws_sdk_s3::Client,
                            cfg,
                            list_objects
                        ),
                    }
                }
                Commands::Secretsmanager { command } => match command {
                    SecretsmanagerCommands::ListSecrets(cfg) => run_json_command!(
                        "secretsmanager",
                        base_opts,
                        aws_sdk_secretsmanager::Client,
                        cfg,
                        list_secrets
                    ),
                },
                Commands::Sqs { command } => match command {
                    SqsCommands::ListQueues(cfg) => {
                        run_json_command!("sqs", base_opts, aws_sdk_sqs::Client, cfg, list_queues)
                    }
                },
                Commands::Sns { command } => match command {
                    SnsCommands::ListTopics(cfg) => {
                        run_json_command!("sns", base_opts, aws_sdk_sns::Client, cfg, list_topics)
                    }
                    SnsCommands::ListSubscriptions(cfg) => run_json_command!(
                        "sns",
                        base_opts,
                        aws_sdk_sns::Client,
                        cfg,
                        list_subscriptions
                    ),
                },
                Commands::Ssm { command } => match command {
                    SsmCommands::ListPublicParameters(cfg) => run_json_command!(
                        "ssm",
                        base_opts,
                        aws_sdk_ssm::Client,
                        cfg,
                        list_public_parameters
                    ),
                    SsmCommands::GetParametersByPath(cfg) => run_json_command!(
                        "ssm",
                        base_opts,
                        aws_sdk_ssm::Client,
                        cfg,
                        get_parameters_by_path
                    ),
                },
                Commands::Sts { command } => match command {
                    StsCommands::DecodeAuthorizationMessage(cfg) => run_json_command!(
                        "sts",
                        base_opts,
                        aws_sdk_sts::Client,
                        cfg,
                        decode_authorization_message
                    ),
                    StsCommands::GetCallerIdentity(cfg) => run_json_command!(
                        "sts",
                        base_opts,
                        aws_sdk_sts::Client,
                        cfg,
                        get_caller_identity
                    ),
                },
            };
        }
        Err(err) => {
            err.print().unwrap();
        }
    };
    Ok(())
}
