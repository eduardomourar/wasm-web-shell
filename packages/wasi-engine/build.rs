use std::{collections::HashMap, fs, io::Write, path::PathBuf};
use wit_component::ComponentEncoder;

fn main() {
    let current_dir = std::env::current_dir().unwrap();
    let target_dir = current_dir.join("../../target");
    // we first read the bytes of the wasm module.
    // let module_path = target_dir.join("wasm32-wasi/release/aws_cli.wasi.wasm");
    // "/Users/admin/projects/public/smithy-rs/target/wasm32-wasi/release/webassembly.wasi.wasm";
    // let module = fs::read(&module_path).unwrap();
    // let adapter_path = "./wasi_snapshot_preview1.wasm";
    // let wasi_adapter = fs::read(adapter_path).unwrap();
    // // then we transform module to component.
    // // remember to get wasi_snapshot_preview1.wasm first.
    // let component = ComponentEncoder::default()
    //     .module(module.as_slice())
    //     .unwrap()
    //     .validate(true)
    //     .adapter("wasi_snapshot_preview1", &wasi_adapter)
    //     .unwrap()
    //     .encode()
    //     .unwrap();
    let component_path = target_dir.join("wasm32-wasi/debug/aws_cli.wasm");
    let component = fs::read(&component_path).unwrap();
    // fs::write(&component_path, &component).unwrap();

    let import_map = HashMap::from([
        ("wasi:cli/*".into(), "cliBase#*".into()),
        ("wasi:cli-base/*".into(), "cliBase#*".into()),
        ("wasi:clocks/*".into(), "clocks#*".into()),
        ("wasi:filesystem/*".into(), "filesystem#*".into()),
        ("wasi:http/*".into(), "http#*".into()),
        ("wasi:io/*".into(), "io#*".into()),
        ("wasi:poll/*".into(), "poll#*".into()),
        ("wasi:random/*".into(), "random#*".into()),
        // ("wasi:sockets/*".into(), "sockets#*".into()),
    ]);
    let opts = js_component_bindgen::TranspileOpts {
        name: "aws".to_string(),
        no_typescript: false,
        instantiation: true,
        map: Some(import_map),
        no_nodejs_compat: false,
        base64_cutoff: 5000_usize,
        tla_compat: false,
        valid_lifting_optimization: false,
    };

    let transpiled = js_component_bindgen::transpile(&component, opts)
        .map_err(|e| format!("{:?}", e))
        .unwrap();

    for (filename, contents) in transpiled.files.iter() {
        let outfile = PathBuf::from("./js/component").join(filename);
        fs::create_dir_all(outfile.parent().unwrap()).unwrap();
        let mut file = fs::File::create(outfile).unwrap();
        file.write_all(contents).unwrap();
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={:?}", component_path);
}
