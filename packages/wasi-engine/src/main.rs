mod custom_ca;
use custom_ca::CustomCaHooks;
use std::env;

use wasmtime::{
    Cache, Config, Engine, Store,
    component::{Component, Linker, ResourceTable},
};
use wasmtime_wasi::{
    FsPerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView, p2::bindings::Command,
};
use wasmtime_wasi_http::{WasiHttpCtx, WasiHttpCtxView, WasiHttpView};

pub struct Host {
    table: ResourceTable,

    ctx: WasiCtx,
    http: WasiHttpCtx,
    hooks: Option<CustomCaHooks>,
}

/// Host variables passed to the guest when `WASI_ENGINE_FORWARD_AWS_ENV` is set.
const FORWARDED_AWS_ENV: [&str; 8] = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_ENDPOINT_URL",
    "AWS_DISABLE_HOST_PREFIX_INJECTION",
    "AWS_EC2_METADATA_DISABLED",
];

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.ctx,
            table: &mut self.table,
        }
    }
}

impl WasiHttpView for Host {
    fn http(&mut self) -> WasiHttpCtxView<'_> {
        WasiHttpCtxView {
            ctx: &mut self.http,
            table: &mut self.table,
            hooks: match self.hooks.as_mut() {
                Some(hooks) => hooks,
                None => Default::default(),
            },
        }
    }
}

#[tokio::main]
async fn main() {
    match run().await {
        Ok(_) => {}
        Err(err) => {
            eprintln!("{:?}", err);
            std::process::exit(1);
        }
    };
}

async fn run() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let wasi_args = [["aws".to_string()].as_slice(), &args[1..]].concat();

    let table = ResourceTable::new();
    let http = WasiHttpCtx::new();
    let forward_env = env::var_os("WASI_ENGINE_FORWARD_AWS_ENV").is_some();
    let mut builder = WasiCtxBuilder::new();
    builder.inherit_stdio().env("RUST_BACKTRACE", "full");
    if forward_env {
        for name in FORWARDED_AWS_ENV {
            if let Ok(value) = env::var(name) {
                builder.env(name, &value);
            }
        }
    } else {
        builder
            .env("AWS_ACCESS_KEY_ID", "access_key_id")
            .env("AWS_SECRET_ACCESS_KEY", "secret_access_key");
    }
    let ctx = builder
        .args(&wasi_args)
        .preopened_dir("/tmp", "/tmp", FsPerms::ReadWrite)?
        .build();
    let hooks = match env::var_os("AWS_CA_BUNDLE").filter(|_| forward_env) {
        Some(path) => Some(CustomCaHooks::from_pem_file(path.as_ref())?),
        None => None,
    };
    let host = Host {
        table,
        ctx,
        http,
        hooks,
    };
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    // Each CLI invocation is a fresh process, and the composed component (28 AWS SDK
    // services) is expensive to compile with Cranelift. Without an on-disk compilation
    // cache, every single invocation recompiles it from scratch.
    config.cache(Some(Cache::from_file(None)?));

    let engine = Engine::new(&config)?;
    let mut linker = Linker::<Host>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;

    let mut store = Store::new(&engine, host);

    let profile = if option_env!("CARGO_PROFILE").is_none() {
        "debug"
    } else {
        "release"
    };
    let target_dir = std::env::var("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target")
        });
    let component_path = target_dir
        .join("composed")
        .join("wasm32-wasip2")
        .join(profile)
        .join("aws_cli_composed.wasm");
    let component = Component::from_file(&engine, component_path)?;

    let command = Command::instantiate_async(&mut store, &component, &linker).await?;
    command
        .wasi_cli_run()
        .call_run(&mut store)
        .await?
        .map_err(|e| anyhow::anyhow!("command returned with failing exit status {e:?}"))
}
