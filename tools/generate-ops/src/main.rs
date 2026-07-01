//! Code generator for AWS CLI operations using Smithy models.
//!
//! 1. Reads aws-cli-operations.csv
//! 2. Downloads Smithy JSON models from github.com/awslabs/aws-sdk-rust
//! 3. Parses input/output shapes for each operation
//! 4. Generates proper Rust source with correct args and response fields
//!
//! Usage: cargo run --manifest-path tools/generate-ops/Cargo.toml

use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

mod codegen;
mod model;
mod services;

use codegen::{generate_mod, generate_operation, generate_tests};
use model::SmithyModel;
use services::{is_existing_op, is_skip_service, sdk_crate, service_dir};

fn main() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent().unwrap().parent().unwrap();
    let csv_path = manifest_dir.join("aws-cli-operations.csv");
    let src_dir = project_root.join("packages/aws-cli/src");
    let models_dir = project_root.join("target/aws-models");

    fs::create_dir_all(&models_dir).ok();

    // Parse CSV
    let raw = fs::read_to_string(&csv_path).expect("Cannot read CSV");
    let content = raw.strip_prefix('\u{feff}').unwrap_or(&raw);

    let mut services: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in content.lines().skip(1) {
        let line = line.trim().trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        // Support both ; and , as delimiter
        let delim = if line.contains(';') { ';' } else { ',' };
        let parts: Vec<&str> = line.splitn(2, delim).collect();
        if parts.len() == 2 {
            services
                .entry(parts[0].trim().to_string())
                .or_default()
                .push(parts[1].trim().to_string());
        }
    }

    let mut generated = 0u32;
    let mut skipped = 0u32;

    for (service, operations) in &services {
        if is_skip_service(service) {
            skipped += operations.len() as u32;
            continue;
        }
        let sdk = match sdk_crate(service) {
            Some(s) => s,
            None => {
                eprintln!("  SKIP {service} (no SDK mapping)");
                skipped += operations.len() as u32;
                continue;
            }
        };

        // Download and parse Smithy model
        let model = download_and_parse_model(service, &models_dir);

        let dir = src_dir.join(service_dir(service));
        fs::create_dir_all(&dir).ok();

        let mut new_ops: Vec<String> = Vec::new();

        for op in operations {
            if is_existing_op(service, op) {
                continue;
            }

            let file = dir.join(format!("{}.rs", to_snake(op)));
            // if file.exists() {
            //     new_ops.push(op.clone());
            //     continue;
            // }

            let code = generate_operation(&sdk, service, op, model.as_ref());
            fs::write(&file, code).unwrap();
            new_ops.push(op.clone());
            generated += 1;
        }

        // Generate tests.rs
        if !new_ops.is_empty() {
            let tests = generate_tests(service, &new_ops, model.as_ref());
            fs::write(dir.join("tests.rs"), tests).unwrap();
        }

        // Generate mod.rs
        let mod_content = generate_mod(operations, !new_ops.is_empty());
        fs::write(dir.join("mod.rs"), mod_content).unwrap();
    }

    println!("Generated: {generated} new operation files");
    println!("Skipped:   {skipped} (hand-written or unmapped)");
    println!("\nRun `cargo check -p aws-cli --lib` to verify.");
}

fn to_snake(s: &str) -> String {
    s.replace('-', "_")
}

/// Download or use cached Smithy model for a service.
fn download_and_parse_model(service: &str, cache_dir: &PathBuf) -> Option<SmithyModel> {
    let model_name = services::smithy_model_name(service);
    let cache_file = cache_dir.join(format!("{model_name}.json"));

    // Use cached version if available
    if !cache_file.exists() {
        let url = format!(
            "https://raw.githubusercontent.com/awslabs/aws-sdk-rust/main/aws-models/{model_name}.json"
        );
        eprintln!("  Downloading model: {url}");
        match ureq::get(&url).call() {
            Ok(resp) => {
                let body = resp.into_body().read_to_string().unwrap_or_default();
                fs::write(&cache_file, &body).ok();
            }
            Err(e) => {
                eprintln!("  WARN: Failed to download model for {service}: {e}");
                return None;
            }
        }
    }

    let json_str = fs::read_to_string(&cache_file).ok()?;
    let json: Value = serde_json::from_str(&json_str).ok()?;
    Some(SmithyModel::new(json))
}
