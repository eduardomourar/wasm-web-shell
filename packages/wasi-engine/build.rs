use std::{collections::HashMap, fs, io::Write, path::PathBuf};

fn main() {
    let current_dir = std::env::current_dir().unwrap();
    let target_dir = current_dir.join("../../target");
    let component_path = target_dir.join("wasm32-wasi/release/aws_cli.wasm");
    let component = fs::read(&component_path).unwrap();

    let import_map = HashMap::from([
        ("wasi:cli/*".into(), "cli#*".into()),
        ("wasi:clocks/*".into(), "clocks#*".into()),
        ("wasi:filesystem/*".into(), "filesystem#*".into()),
        ("wasi:http/*".into(), "http#*".into()),
        ("wasi:logging/*".into(), "logging#*".into()),
        ("wasi:io/*".into(), "io#*".into()),
        ("wasi:poll/*".into(), "poll#*".into()),
        ("wasi:random/*".into(), "random#*".into()),
        ("wasi:sockets/*".into(), "sockets#*".into()),
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
        let outfile = PathBuf::from("../../www/aws-cli/component").join(filename);
        fs::create_dir_all(outfile.parent().unwrap()).unwrap();
        let mut file = fs::File::create(outfile).unwrap();
        file.write_all(contents).unwrap();
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={:?}", component_path);
}
