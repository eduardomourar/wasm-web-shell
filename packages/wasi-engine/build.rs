use js_component_bindgen::{AsyncMode, InstantiationMode, TranspileOpts, transpile};
use std::{fs, io::Write, path::PathBuf};
use wac_graph::{CompositionGraph, EncodeOptions, types::Package};

const BASE_WASI_IMPORTS: [&str; 22] = [
    "wasi:clocks/monotonic-clock#subscribe-duration",
    "wasi:clocks/monotonic-clock#subscribe-instant",
    "wasi:filesystem/types#[method]descriptor.advise",
    "wasi:filesystem/types#[method]descriptor.append-via-stream",
    "wasi:filesystem/types#[method]descriptor.create-directory-at",
    "wasi:filesystem/types#[method]descriptor.open-at",
    "wasi:filesystem/types#[method]descriptor.read-directory",
    "wasi:filesystem/types#[method]descriptor.read-directory-at",
    "wasi:filesystem/types#[method]descriptor.remove-directory-at",
    "wasi:filesystem/types#[method]descriptor.rename-at",
    "wasi:filesystem/types#[method]descriptor.set-size",
    "wasi:filesystem/types#[method]descriptor.stat",
    "wasi:filesystem/types#[method]descriptor.stat-at",
    "wasi:filesystem/types#[method]descriptor.unlink-file-at",
    "wasi:io/poll#poll",
    "wasi:io/poll#[method]pollable.block",
    "wasi:io/streams#[method]input-stream.blocking-read",
    "wasi:io/streams#[method]input-stream.blocking-skip",
    "wasi:io/streams#[method]output-stream.blocking-flush",
    "wasi:io/streams#[method]output-stream.blocking-write-and-flush",
    "wasi:io/streams#[method]output-stream.blocking-write-zeroes-and-flush",
    "wasi:io/streams#[method]output-stream.blocking-splice",
];

fn is_running_in_github_actions() -> bool {
    std::env::var("GITHUB_ACTIONS").map_or(false, |val| val == "true")
}

fn main() {
    let target_dir = std::env::var("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target")
        });
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };

    let mut graph = CompositionGraph::new();

    let adapter_path = target_dir
        .join("wasm32-wasip2")
        .join(profile)
        .join("providers_adapter.wasm");
    let package =
        Package::from_file("providers-adapter", None, &adapter_path, graph.types_mut()).unwrap();
    let adapter_pkg = graph.register_package(package).unwrap();
    let target_path = target_dir
        .join("wasm32-wasip2")
        .join(profile)
        .join("aws_cli.wasm");
    let package = Package::from_file("aws-cli", None, &target_path, graph.types_mut()).unwrap();
    let target_pkg = graph.register_package(package).unwrap();

    let adapter = graph.instantiate(adapter_pkg);
    let target = graph.instantiate(target_pkg);

    let providers_export = graph
        .alias_instance_export(adapter, "component:aws-cli/providers")
        .unwrap();
    graph
        .set_instantiation_argument(target, "component:aws-cli/providers", providers_export)
        .unwrap();

    let run_export = graph
        .alias_instance_export(target, "wasi:cli/run@0.2.12")
        .unwrap();
    graph.export(run_export, "wasi:cli/run@0.2.12").unwrap();

    let composed = graph.encode(EncodeOptions::default()).unwrap();
    let composed_path = target_dir
        .join("composed")
        .join("wasm32-wasip2")
        .join(profile)
        .join("aws_cli_composed.wasm");
    fs::create_dir_all(composed_path.parent().unwrap()).unwrap();
    fs::write(composed_path, &composed).unwrap();

    let mut imports = BASE_WASI_IMPORTS.map(|f| f.to_string()).to_vec();
    imports.insert(
        imports.len(),
        "component:aws-cli/providers#provide-credentials".to_string(),
    );
    imports.insert(
        imports.len(),
        "component:aws-cli/providers#provide-region".to_string(),
    );

    let opts = TranspileOpts {
        name: "aws".to_string(),
        no_typescript: false,
        instantiation_mode: Some(InstantiationMode::Async),
        async_mode: Some(AsyncMode::JavaScriptPromiseIntegration {
            imports,
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
    println!("cargo:rerun-if-changed={:?}", target_path);

    let target_path = target_dir
        .join("wasm32-wasip2")
        .join(if is_running_in_github_actions() {
            "release"
        } else {
            profile
        })
        .join("coreutils.wasm");
    let imports = BASE_WASI_IMPORTS.map(|f| f.to_string()).to_vec();

    let opts = TranspileOpts {
        name: "coreutils".to_string(),
        no_typescript: false,
        instantiation_mode: Some(InstantiationMode::Async),
        async_mode: Some(AsyncMode::JavaScriptPromiseIntegration {
            imports,
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
        let outfile = PathBuf::from("../../www/coreutils/component").join(filename);
        fs::create_dir_all(outfile.parent().unwrap()).unwrap();
        let mut file = fs::File::create(outfile).unwrap();
        file.write_all(contents).unwrap();
    }
    println!("cargo:rerun-if-changed={:?}", target_path);

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={:?}", adapter_path);
}
