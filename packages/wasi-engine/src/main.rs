use std::env;

use wasmtime::{
    Config, Engine, Store,
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
}

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
            hooks: Default::default(),
        }
    }
}

#[tokio::main]
async fn main() {
    match run().await {
        Ok(_) => {}
        Err(err) => {
            eprintln!("{:?}", err);
        }
    };
}

async fn run() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let wasi_args = [["aws".to_string()].as_slice(), &args[1..]].concat();

    let table = ResourceTable::new();
    let http = WasiHttpCtx::new();
    let ctx = WasiCtxBuilder::new()
        .inherit_stdio()
        .env("RUST_BACKTRACE", "full")
        .env("AWS_ACCESS_KEY_ID", "access_key_id")
        .env("AWS_SECRET_ACCESS_KEY", "secret_access_key")
        .args(&wasi_args)
        .preopened_dir("/tmp", "/tmp", FsPerms::ReadWrite)?
        .build();
    let host = Host { table, ctx, http };
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);

    let engine = Engine::new(&config)?;
    let mut linker = Linker::<Host>::new(&engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;

    let mut store = Store::new(&engine, host);

    let profile = if cfg!(debug_assertions) {
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
