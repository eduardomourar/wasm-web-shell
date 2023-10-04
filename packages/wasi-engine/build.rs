use js_component_bindgen::{AsyncMode, InstantiationMode, TranspileOpts, transpile};
use std::{fs, io::Write, path::PathBuf};
use wac_graph::{CompositionGraph, EncodeOptions, types::Package};

fn main() {
    let current_dir = std::env::current_dir().unwrap();
    let target_dir = current_dir.join("../../target");
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };

    let mut graph = CompositionGraph::new();

    let adapter_path = target_dir
        .join("wasm32-wasip2")
        .join(profile)
        .join("credentials_adapter.wasm");
    let package = Package::from_file(
        "credentials-adapter",
        None,
        &adapter_path,
        graph.types_mut(),
    )
    .unwrap();
    let adapter_pkg = graph.register_package(package).unwrap();
    let target_path = target_dir
        .join("wasm32-wasip2")
        .join(profile)
        .join("aws_cli.wasm");
    let package = Package::from_file("aws-cli", None, &target_path, graph.types_mut()).unwrap();
    let target_pkg = graph.register_package(package).unwrap();

    let adapter = graph.instantiate(adapter_pkg);
    let target = graph.instantiate(target_pkg);

    let credentials_provider_export = graph
        .alias_instance_export(adapter, "component:aws-cli/credentials-provider")
        .unwrap();
    graph
        .set_instantiation_argument(
            target,
            "component:aws-cli/credentials-provider",
            credentials_provider_export,
        )
        .unwrap();

    let run_export = graph
        .alias_instance_export(target, "wasi:cli/run@0.2.11")
        .unwrap();
    graph.export(run_export, "wasi:cli/run@0.2.6").unwrap();

    let composed = graph.encode(EncodeOptions::default()).unwrap();
    let composed_path = target_dir
        .join("composed")
        .join("wasm32-wasip2")
        .join(profile)
        .join("aws_cli_composed.wasm");
    fs::create_dir_all(composed_path.parent().unwrap()).unwrap();
    fs::write(composed_path, &composed).unwrap();

    let opts = TranspileOpts {
        name: "aws".to_string(),
        no_typescript: false,
        instantiation_mode: Some(InstantiationMode::Async),
        async_mode: Some(AsyncMode::JavaScriptPromiseIntegration {
            imports: vec![
                "component:aws-cli/credentials-provider#provide-credentials".to_string(),
                "wasi:clocks/monotonic-clock#subscribe-duration".to_string(),
                "wasi:clocks/monotonic-clock#subscribe-instant".to_string(),
                "wasi:io/poll#poll".to_string(),
                "wasi:io/poll#[method]pollable.block".to_string(),
                "wasi:io/streams#[method]input-stream.blocking-read".to_string(),
                "wasi:io/streams#[method]input-stream.blocking-skip".to_string(),
                "wasi:io/streams#[method]output-stream.blocking-flush".to_string(),
                "wasi:io/streams#[method]output-stream.blocking-write-and-flush".to_string(),
                "wasi:io/streams#[method]output-stream.blocking-write-zeroes-and-flush".to_string(),
                "wasi:io/streams#[method]output-stream.blocking-splice".to_string(),
            ],
            exports: vec!["wasi:cli/run#run".to_string()],
        }),
        nodejs_compat_disabled: true,
        base64_cutoff: 5000_usize,
        tla_compat: false,
        valid_lifting_optimization: false,
        tracing: profile == "debug",
        multi_memory: true,
        ..TranspileOpts::default()
    };

    let component = fs::read(&target_path).unwrap();
    let transpiled = transpile(&component, opts)
        .map_err(|e| format!("{:?}", e))
        .unwrap();

    for (filename, contents) in transpiled.files.iter() {
        let outfile = PathBuf::from("../../www/aws-cli/component").join(filename);
        fs::create_dir_all(outfile.parent().unwrap()).unwrap();
        let mut file = fs::File::create(outfile).unwrap();
        file.write_all(contents).unwrap();
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={:?}", target_path);
    println!("cargo:rerun-if-changed={:?}", adapter_path);
}
