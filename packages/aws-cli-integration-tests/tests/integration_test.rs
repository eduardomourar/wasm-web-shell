//! Integration tests that run the composed AWS CLI against the AWS emulator.
//!
//! See <https://xsavikx.github.io/aws-emulator-docker/>. The emulator environment comes from
//! `AWS_ENDPOINT_URL`, `AWS_CA_BUNDLE` and `AWS_SHARED_CREDENTIALS_FILE`. Run `make test-integration`
//! locally. CI uses `xSAVIKx/run-aws-emulator`. The host `aws` CLI creates the test resources,
//! because the composed CLI has no create commands.
mod common;

use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

struct Emulator {
    envs: Vec<(String, String)>,
}

fn required_var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        panic!("{name} is not set. Start the AWS emulator and export its environment first.")
    })
}

fn credential(contents: &str, key: &str) -> String {
    contents
        .lines()
        .filter_map(|line| line.split_once('='))
        .find(|(name, _)| name.trim() == key)
        .map(|(_, value)| value.trim().to_string())
        .unwrap_or_else(|| panic!("{key} not found in the emulator credentials file"))
}

fn emulator() -> &'static Emulator {
    static EMULATOR: OnceLock<Emulator> = OnceLock::new();
    EMULATOR.get_or_init(|| {
        let credentials_path = PathBuf::from(required_var("AWS_SHARED_CREDENTIALS_FILE"));
        let credentials = std::fs::read_to_string(&credentials_path)
            .unwrap_or_else(|e| panic!("Cannot read {}: {e}", credentials_path.display()));
        let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string());
        let envs = vec![
            ("AWS_ENDPOINT_URL".into(), required_var("AWS_ENDPOINT_URL")),
            ("AWS_CA_BUNDLE".into(), required_var("AWS_CA_BUNDLE")),
            (
                "AWS_ACCESS_KEY_ID".into(),
                credential(&credentials, "aws_access_key_id"),
            ),
            (
                "AWS_SECRET_ACCESS_KEY".into(),
                credential(&credentials, "aws_secret_access_key"),
            ),
            ("AWS_REGION".into(), region.clone()),
            ("AWS_DEFAULT_REGION".into(), region),
            ("AWS_DISABLE_HOST_PREFIX_INJECTION".into(), "true".into()),
            ("AWS_EC2_METADATA_DISABLED".into(), "true".into()),
            ("WASI_ENGINE_FORWARD_AWS_ENV".into(), "1".into()),
        ];
        Emulator { envs }
    })
}

/// Runs the composed AWS CLI against the emulator.
fn cli(args: &[&str]) -> Output {
    common::wasi_engine_run(args, &emulator().envs)
}

/// Runs the host AWS CLI against the emulator to create and delete test resources.
fn host_aws(args: &[&str]) -> Output {
    Command::new("aws")
        .args(args)
        .env_remove("AWS_PROFILE")
        .env_remove("AWS_SESSION_TOKEN")
        .envs(emulator().envs.iter().map(|(k, v)| (k, v)))
        .output()
        .expect("The host `aws` CLI is required to prepare emulator resources")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "Command failed.\nstdout: {}\nstderr: {}",
        stdout(output),
        stderr(output)
    );
}

fn unique_name(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{prefix}-{}-{}", std::process::id(), nanos % 1_000_000_000)
}

/// A resource created with the host CLI that is removed when the test ends.
struct Resource {
    cleanup: Vec<String>,
}

impl Resource {
    fn create(create: &[&str], cleanup: &[&str]) -> Self {
        assert_success(&host_aws(create));
        Self {
            cleanup: cleanup.iter().map(|s| s.to_string()).collect(),
        }
    }
}

impl Drop for Resource {
    fn drop(&mut self) {
        let args: Vec<&str> = self.cleanup.iter().map(String::as_str).collect();
        host_aws(&args);
    }
}

#[test]
fn emulator_sts_get_caller_identity() {
    let output = cli(&["sts", "get-caller-identity"]);
    assert_success(&output);
    assert!(
        stdout(&output).contains("\"account\": \"000000000000\""),
        "Unexpected stdout: {}",
        stdout(&output)
    );
}

#[test]
fn emulator_s3_round_trip() {
    let bucket = unique_name("wws-s3");
    let _bucket = Resource::create(
        &["s3api", "create-bucket", "--bucket", &bucket],
        &["s3", "rb", &format!("s3://{bucket}"), "--force"],
    );
    let upload_source = format!("/tmp/{bucket}-upload.txt");
    let download_target = format!("/tmp/{bucket}-download.txt");
    std::fs::write(&upload_source, "emulator round trip\n").unwrap();
    let object_uri = format!("s3://{bucket}/dir/object.txt");

    let upload = cli(&["s3", "cp", &upload_source, &object_uri]);
    assert_success(&upload);
    assert!(stdout(&upload).contains("upload:"), "{}", stdout(&upload));

    let listing = cli(&["s3", "ls", &format!("s3://{bucket}/dir/")]);
    assert_success(&listing);
    assert!(
        stdout(&listing).contains("object.txt"),
        "{}",
        stdout(&listing)
    );

    let objects = cli(&["s3api", "list-objects", "--bucket", &bucket]);
    assert_success(&objects);
    assert!(
        stdout(&objects).contains("\"key\": \"dir/object.txt\""),
        "{}",
        stdout(&objects)
    );

    let download = cli(&["s3", "cp", &object_uri, &download_target]);
    assert_success(&download);
    assert_eq!(
        std::fs::read_to_string(&download_target).unwrap(),
        "emulator round trip\n"
    );

    let remove = cli(&["s3", "rm", &object_uri]);
    assert_success(&remove);
    let after = cli(&["s3api", "list-objects", "--bucket", &bucket]);
    assert_success(&after);
    assert!(!stdout(&after).contains("object.txt"), "{}", stdout(&after));

    std::fs::remove_file(&upload_source).ok();
    std::fs::remove_file(&download_target).ok();
}

#[test]
fn emulator_s3api_list_buckets() {
    let bucket = unique_name("wws-buckets");
    let _bucket = Resource::create(
        &["s3api", "create-bucket", "--bucket", &bucket],
        &["s3api", "delete-bucket", "--bucket", &bucket],
    );
    let output = cli(&["s3api", "list-buckets"]);
    assert_success(&output);
    assert!(
        stdout(&output).contains(&format!("\"name\": \"{bucket}\"")),
        "{}",
        stdout(&output)
    );
}

#[test]
fn emulator_dynamodb_list_tables() {
    let table = unique_name("wws-table");
    let _table = Resource::create(
        &[
            "dynamodb",
            "create-table",
            "--table-name",
            &table,
            "--attribute-definitions",
            "AttributeName=id,AttributeType=S",
            "--key-schema",
            "AttributeName=id,KeyType=HASH",
            "--billing-mode",
            "PAY_PER_REQUEST",
        ],
        &["dynamodb", "delete-table", "--table-name", &table],
    );
    let output = cli(&["dynamodb", "list-tables"]);
    assert_success(&output);
    assert!(stdout(&output).contains(&table), "{}", stdout(&output));
}

#[test]
fn emulator_sqs_list_queues() {
    let queue = unique_name("wws-queue");
    let queue_url = {
        let output = host_aws(&["sqs", "create-queue", "--queue-name", &queue]);
        assert_success(&output);
        stdout(&output)
            .split('"')
            .find(|part| part.starts_with("http"))
            .expect("queue URL in create-queue output")
            .to_string()
    };
    let _queue = Resource {
        cleanup: vec![
            "sqs".into(),
            "delete-queue".into(),
            "--queue-url".into(),
            queue_url,
        ],
    };
    let output = cli(&["sqs", "list-queues"]);
    assert_success(&output);
    assert!(stdout(&output).contains(&queue), "{}", stdout(&output));
}

#[test]
fn emulator_sns_list_topics() {
    let topic = unique_name("wws-topic");
    let output = host_aws(&["sns", "create-topic", "--name", &topic]);
    assert_success(&output);
    let topic_arn = stdout(&output)
        .split('"')
        .find(|part| part.starts_with("arn:"))
        .expect("topic ARN in create-topic output")
        .to_string();
    let _topic = Resource {
        cleanup: vec![
            "sns".into(),
            "delete-topic".into(),
            "--topic-arn".into(),
            topic_arn,
        ],
    };
    let listing = cli(&["sns", "list-topics"]);
    assert_success(&listing);
    assert!(stdout(&listing).contains(&topic), "{}", stdout(&listing));
}

#[test]
fn emulator_secretsmanager_list_secrets() {
    let secret = unique_name("wws-secret");
    let _secret = Resource::create(
        &[
            "secretsmanager",
            "create-secret",
            "--name",
            &secret,
            "--secret-string",
            "value",
        ],
        &[
            "secretsmanager",
            "delete-secret",
            "--secret-id",
            &secret,
            "--force-delete-without-recovery",
        ],
    );
    let output = cli(&["secretsmanager", "list-secrets"]);
    assert_success(&output);
    assert!(stdout(&output).contains(&secret), "{}", stdout(&output));
}

/// Every list or describe command that works without prior resources, with the top-level
/// JSON key that its output must contain.
const LIST_COMMANDS: &[(&[&str], &str)] = &[
    (&["apigatewayv2", "get-apis"], "items"),
    (&["athena", "list-work-groups"], "workGroups"),
    (&["cloudfront", "list-distributions"], "distributionList"),
    (&["cloudtrail", "lookup-events"], "events"),
    (&["cloudwatch", "list-metrics"], "metrics"),
    (&["cloudwatch", "describe-alarms"], "metricAlarms"),
    (
        &["cognito-idp", "list-user-pools", "--max-results", "10"],
        "userPools",
    ),
    (&["configservice", "describe-config-rules"], "configRules"),
    (&["dynamodb", "list-tables"], "tableNames"),
    (&["ec2", "describe-instances"], "reservations"),
    (&["ec2", "describe-vpcs"], "vpcs"),
    (&["ec2", "describe-subnets"], "subnets"),
    (&["ec2", "describe-security-groups"], "securityGroups"),
    (&["ecs", "list-clusters"], "clusterArns"),
    (&["efs", "describe-file-systems"], "fileSystems"),
    (&["eks", "list-clusters"], "clusters"),
    (&["elasticache", "describe-cache-clusters"], "cacheClusters"),
    (&["elbv2", "describe-load-balancers"], "loadBalancers"),
    (&["elbv2", "describe-target-groups"], "targetGroups"),
    (&["events", "list-rules"], "rules"),
    (
        &["glacier", "list-vaults", "--account-id", "-"],
        "vaultList",
    ),
    (&["iam", "list-users"], "users"),
    (&["iam", "list-roles"], "roles"),
    (&["iam", "list-policies"], "policies"),
    (&["kms", "list-keys"], "keys"),
    (&["lambda", "list-functions"], "functions"),
    (&["logs", "list-log-groups"], "logGroups"),
    (&["rds", "describe-db-instances"], "dbInstances"),
    (&["redshift", "describe-clusters"], "clusters"),
    (&["route53", "list-hosted-zones"], "hostedZones"),
    (&["s3api", "list-buckets"], "buckets"),
    (&["secretsmanager", "list-secrets"], "secretList"),
    (&["sns", "list-subscriptions"], "subscriptions"),
    (&["sns", "list-topics"], "topics"),
    (&["sqs", "list-queues"], "queueUrls"),
    (
        &["ssm", "get-parameters-by-path", "--path", "/"],
        "parameters",
    ),
];

#[test]
fn emulator_list_commands() {
    let workers = std::thread::available_parallelism().map_or(2, |n| n.get().min(8));
    let next = AtomicUsize::new(0);
    let failures: Mutex<Vec<String>> = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                while let Some((args, key)) = LIST_COMMANDS.get(next.fetch_add(1, Ordering::SeqCst))
                {
                    let output = cli(args);
                    let out = stdout(&output);
                    if !output.status.success() || !out.contains(&format!("\"{key}\":")) {
                        failures.lock().unwrap().push(format!(
                            "`{}` expected key {key:?}\n  stdout: {out}\n  stderr: {}",
                            args.join(" "),
                            stderr(&output)
                        ));
                    }
                }
            });
        }
    });
    let failures = failures.into_inner().unwrap();
    assert!(
        failures.is_empty(),
        "{} list command(s) failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn emulator_ecs_list_services_and_tasks() {
    let cluster = unique_name("wws-cluster");
    let _cluster = Resource::create(
        &["ecs", "create-cluster", "--cluster-name", &cluster],
        &["ecs", "delete-cluster", "--cluster", &cluster],
    );
    let clusters = cli(&["ecs", "list-clusters"]);
    assert_success(&clusters);
    assert!(
        stdout(&clusters).contains(&cluster),
        "{}",
        stdout(&clusters)
    );
    for (command, key) in [("list-services", "serviceArns"), ("list-tasks", "taskArns")] {
        let output = cli(&["ecs", command, "--cluster", &cluster]);
        assert_success(&output);
        assert!(
            stdout(&output).contains(&format!("\"{key}\":")),
            "{}",
            stdout(&output)
        );
    }
}
