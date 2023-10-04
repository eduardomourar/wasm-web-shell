//! Integration tests for the composed AWS CLI WASM component
//!
//! These tests run the actual WASM component composed with the credentials-adapter
//! on the wasip2 target using wasi-engine (under the hood wasmtime).

use std::process::Command;

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
    let mut cmd = Command::new(command_path);

    for arg in args {
        cmd.arg(arg);
    }

    cmd.output().expect("Failed to execute aws cli")
}

#[test]
fn test_cli_help() {
    let output = aws_cli_run(&["help"]);

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Commands:"));
    assert!(stdout.contains("s3"));
    assert!(stdout.contains("sts"));
    assert!(stdout.contains("ssm"));
}

#[test]
fn test_s3_get_object() {
    let output = aws_cli_run(&[
        "s3",
        "get-object",
        "--region",
        "us-east-1",
        "--bucket",
        "pan-ukb-us-east-1",
        "--key",
        "sumstats_release/results_full.mt/README.txt",
        "--no-sign-request",
    ]);

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.eq(
        r###"This folder comprises a Hail (www.hail.is) native Table or MatrixTable.
  Written with version 0.2.130-bea04d9c79b5
  Created at 2024/06/12 19:25:57
"###
    ));
}

#[test]
fn test_s3_list_objects() {
    let output = aws_cli_run(&[
        "s3",
        "list-objects",
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

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.eq(r###"{
  "contents": [
    {
      "eTag": "\"f81bca79c43b72b879572af1c07af093\"",
      "key": "authority-records/organization/organization-1.jsonl",
      "lastModified": "2026-04-06T17:55:21Z",
      "size": 392792
    },
    {
      "eTag": "\"bf7b32f1a52e4cbdc7d87afa45d32209\"",
      "key": "authority-records/organization/organization-10.jsonl",
      "lastModified": "2026-04-06T17:55:21Z",
      "size": 412097
    }
  ]
}
"###));
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

    // Should fail with AWS error received from STS service
    assert!(stderr.contains("service error"));
    assert!(stderr.contains("InvalidClientTokenId"));
}
