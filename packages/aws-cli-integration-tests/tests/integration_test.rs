//! Integration tests for the composed AWS CLI WASM component
//!
//! These tests run the actual WASM component composed with the providers-adapter
//! on the wasip2 target using wasi-engine (under the hood wasmtime).
//!
//! Note: The wasi-engine binary deadlocks when multiple instances run concurrently
//! (due to wasmtime's internal compilation/cache locking on the large WASM component).
//! We use a file lock to serialize access so tests pass with any --test-threads value.

use fs2::FileExt;
use std::fs::OpenOptions;
use std::process::Command;

/// Acquire an exclusive file lock to prevent concurrent wasi-engine executions,
/// run the command, then release the lock when the guard is dropped.
fn aws_cli_run(args: &[&str]) -> std::process::Output {
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let command_path = std::env::current_dir()
        .unwrap()
        .join("../../target")
        .join(profile)
        .join("wasi-engine");

    // Use a lock file to serialize wasi-engine invocations across threads/processes
    let lock_path = std::env::temp_dir().join("wasi-engine-integration-test.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&lock_path)
        .expect("Failed to open lock file");
    lock_file
        .lock_exclusive()
        .expect("Failed to acquire exclusive lock");

    let mut cmd = Command::new(command_path);
    for arg in args {
        cmd.arg(arg);
    }

    let output = cmd.output().expect("Failed to execute aws cli");

    lock_file.unlock().expect("Failed to release lock");

    output
}

#[test]
fn test_cli_help() {
    let output = aws_cli_run(&["help"]);

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Commands:"));
    assert!(stdout.contains("s3"));
    assert!(stdout.contains("s3api"));
    assert!(stdout.contains("sts"));
    assert!(stdout.contains("ssm"));
}

#[test]
fn test_s3_get_object() {
    let output = aws_cli_run(&[
        "s3api",
        "get-object",
        "--bucket",
        "pan-ukb-us-east-1",
        "--key",
        "sumstats_release/results_full.mt/README.txt",
        "--no-sign-request",
    ]);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Network-dependent test: may fail with connection timeout in restricted environments
    if !stderr.is_empty() && stderr.contains("dispatch failure") {
        // Accept connection failures in environments without internet access
        return;
    }

    assert!(output.status.success(), "Command failed. stderr: {stderr}");
    assert!(
        stdout.eq(
            r###"This folder comprises a Hail (www.hail.is) native Table or MatrixTable.
  Written with version 0.2.130-bea04d9c79b5
  Created at 2024/06/12 19:25:57
"###
        ),
        "Unexpected stdout: {stdout}\nstderr: {stderr}"
    );
}

#[test]
fn test_s3_list_objects() {
    let output = aws_cli_run(&[
        "s3api",
        "list-objects",
        "--region",
        "us-east-2",
        "--bucket",
        "nara-national-archives-catalog",
        "--delimiter",
        "/",
        "--prefix",
        "authority-records/organization/",
        "--max-keys",
        "2",
        "--no-sign-request",
    ]);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Network-dependent test: may fail with connection timeout in restricted environments
    if !stderr.is_empty() && stderr.contains("dispatch failure") {
        return;
    }

    assert!(output.status.success(), "Command failed. stderr: {stderr}");
    assert!(
        stdout.eq(r###"{
  "commonPrefixes": [],
  "contents": [
    {
      "checksumAlgorithm": [
        "CRC64NVME"
      ],
      "checksumType": "FULL_OBJECT",
      "eTag": "\"f81bca79c43b72b879572af1c07af093\"",
      "key": "authority-records/organization/organization-1.jsonl",
      "lastModified": "2026-04-06T17:55:21Z",
      "size": 392792,
      "storageClass": "INTELLIGENT_TIERING"
    },
    {
      "checksumAlgorithm": [
        "CRC64NVME"
      ],
      "checksumType": "FULL_OBJECT",
      "eTag": "\"bf7b32f1a52e4cbdc7d87afa45d32209\"",
      "key": "authority-records/organization/organization-10.jsonl",
      "lastModified": "2026-04-06T17:55:21Z",
      "size": 412097,
      "storageClass": "INTELLIGENT_TIERING"
    }
  ],
  "delimiter": "/",
  "encodingType": null,
  "isTruncated": true,
  "marker": "",
  "maxKeys": 2,
  "name": "nara-national-archives-catalog",
  "nextMarker": "authority-records/organization/organization-10.jsonl",
  "prefix": "authority-records/organization/",
  "requestCharged": null
}
"###),
        "Unexpected stdout: {stdout}\nstderr: {stderr}"
    );
}

#[test]
fn test_ssm_list_public_parameters() {
    let output = aws_cli_run(&["ssm", "list-public-parameters", "--no-sign-request"]);

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Should fail with AWS error prior to make HTTP request
    assert!(stderr.contains("dispatch failure"));
    assert!(stderr.contains("failed to select an auth scheme to sign the request with"));
}

#[test]
fn test_sts_get_caller_identity() {
    let output = aws_cli_run(&["sts", "get-caller-identity"]);

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Should fail with either:
    // - AWS service error (InvalidClientTokenId) when the endpoint is reachable
    // - dispatch failure (ConnectionTimeout) when the endpoint is unreachable
    assert!(
        (stderr.contains("service error") && stderr.contains("InvalidClientTokenId"))
            || stderr.contains("dispatch failure"),
        "Expected either a service error or dispatch failure, got: {stderr}"
    );
}

#[test]
fn test_s3_ls_public_bucket() {
    let output = aws_cli_run(&[
        "s3",
        "ls",
        "s3://nara-national-archives-catalog/authority-records/",
        "--region",
        "us-east-2",
        "--no-sign-request",
    ]);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Network-dependent test
    if !stderr.is_empty() && stderr.contains("dispatch failure") {
        return;
    }

    assert!(output.status.success(), "Command failed. stderr: {stderr}");
    // Should list common prefixes (directories) under this path
    assert!(
        stdout.contains("PRE") || stdout.contains("organization"),
        "Expected directory listing output, got: {stdout}"
    );
}

#[test]
fn test_s3_cp_download() {
    let dest = "/tmp/test-s3-cp-integration.txt";
    // Clean up from previous runs
    std::fs::remove_file(dest).ok();

    let output = aws_cli_run(&[
        "s3",
        "cp",
        "s3://pan-ukb-us-east-1/sumstats_release/results_full.mt/README.txt",
        dest,
        "--no-sign-request",
    ]);

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Network-dependent test
    if !stderr.is_empty() && stderr.contains("dispatch failure") {
        return;
    }

    assert!(output.status.success(), "Command failed. stderr: {stderr}");

    // Verify file was downloaded
    let content = std::fs::read_to_string(dest).unwrap_or_default();
    assert!(
        content.contains("Hail"),
        "Expected file content from S3, got: {content}"
    );

    // Clean up
    std::fs::remove_file(dest).ok();
}

#[test]
fn test_s3_cp_dryrun() {
    let output = aws_cli_run(&[
        "s3",
        "cp",
        "s3://pan-ukb-us-east-1/sumstats_release/results_full.mt/README.txt",
        "/tmp/should-not-exist-dryrun.txt",
        "--no-sign-request",
        "--dryrun",
    ]);

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("(dryrun)"),
        "Expected dryrun output, got: {stdout}"
    );
    assert!(!std::path::Path::new("/tmp/should-not-exist-dryrun.txt").exists());
}

#[test]
fn test_s3_rm_dryrun() {
    let output = aws_cli_run(&[
        "s3",
        "rm",
        "s3://some-bucket/some-key.txt",
        "--no-sign-request",
        "--dryrun",
    ]);

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("(dryrun)"),
        "Expected dryrun output, got: {stdout}"
    );
}
