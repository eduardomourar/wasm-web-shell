use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store,
};
use wasmtime_wasi::preview2::{
    command::Command, DirPerms, FilePerms, Table, WasiCtx, WasiCtxBuilder, WasiView,
};
use wasmtime_wasi::{ambient_authority, Dir};
use wasmtime_wasi_http::{WasiHttpCtx, WasiHttpView};

pub struct Ctx {
    table: Table,
    wasi: WasiCtx,
    http: WasiHttpCtx,
}

impl WasiView for Ctx {
    fn table(&self) -> &Table {
        &self.table
    }
    fn table_mut(&mut self) -> &mut Table {
        &mut self.table
    }
    fn ctx(&self) -> &WasiCtx {
        &self.wasi
    }
    fn ctx_mut(&mut self) -> &mut WasiCtx {
        &mut self.wasi
    }
}

impl WasiHttpView for Ctx {
    fn http_ctx(&self) -> &WasiHttpCtx {
        &self.http
    }
    fn http_ctx_mut(&mut self) -> &mut WasiHttpCtx {
        &mut self.http
    }
}

#[tokio::main]
async fn main() {
    run().await.unwrap();
}

async fn run() -> anyhow::Result<()> {
    let mut table = Table::new();
    let http = WasiHttpCtx::new();
    let wasi = WasiCtxBuilder::new()
        .inherit_stdio()
        .env("RUST_BACKTRACE", "full")
        .args(&[
            "s3",
            "get-object",
            "-vvv",
            "--region",
            "us-east-1",
            // "--help"
            "--bucket",
            "pan-ukb-us-east-1",
            "--key",
            "sumstats_release/results_full.mt/README.txt",
            "/tmp/readme.txt",
        ])
        .preopened_dir(
            Dir::open_ambient_dir("/tmp", ambient_authority())?,
            DirPerms::all(),
            FilePerms::all(),
            "/tmp",
        )
        .build(&mut table)?;
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    config.wasm_component_model(true);
    config.wasm_multi_memory(true);
    config.async_support(true);

    let engine = Engine::new(&config)?;
    let profile = if std::env::var("PROFILE") == Ok("debug".to_owned()) {
        "debug"
    } else {
        "release"
    };
    let component_path = std::env::current_dir()?
        .join("../../target")
        .join("wasm32-wasi")
        .join(profile)
        .join("aws-cli.component.wasm");
    let component = Component::from_file(&engine, component_path)?;
    let mut store = Store::new(&engine, Ctx { table, wasi, http });
    let mut linker = Linker::<Ctx>::new(&engine);

    wasmtime_wasi::preview2::command::add_to_linker(&mut linker)?;
    wasmtime_wasi_http::proxy::add_to_linker(&mut linker)?;

    let (command, _instance) = Command::instantiate_async(&mut store, &component, &linker).await?;
    command
        .wasi_cli_run()
        .call_run(&mut store)
        .await
        .map_err(|e| anyhow::anyhow!("wasm failed with {e:?}"))?
        .map_err(|e| anyhow::anyhow!("command returned with failing exit status {e:?}"))?;

    Ok(())
}
