use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::Once;

fn wasi_engine_path() -> PathBuf {
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    std::env::current_dir()
        .unwrap()
        .join("../../target")
        .join(profile)
        .join("wasi-engine")
}

/// Compiles the composed component into the wasmtime cache before concurrent runs start.
///
/// Instances that compile the large component at the same time deadlock on the cache lock.
fn warm_up_cache() {
    static WARM_UP: Once = Once::new();
    WARM_UP.call_once(|| {
        Command::new(wasi_engine_path())
            .arg("help")
            .output()
            .expect("Failed to execute aws cli");
    });
}

/// Runs the wasi-engine binary with the given arguments and extra environment.
pub fn wasi_engine_run(args: &[&str], envs: &[(String, String)]) -> Output {
    warm_up_cache();
    Command::new(wasi_engine_path())
        .args(args)
        .envs(envs.iter().map(|(k, v)| (k, v)))
        .output()
        .expect("Failed to execute aws cli")
}
