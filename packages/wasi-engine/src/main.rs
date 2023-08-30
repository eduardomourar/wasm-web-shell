use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store,
};
use wasmtime_wasi::preview2::{command::Command, Table, WasiCtx, WasiCtxBuilder, WasiView};
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
            "list-objects",
            "-vvv",
            "--region",
            "us-east-2",
            // "--help"
            "--bucket",
            "nara-national-archives-catalog",
            "--delimiter",
            "/",
            "--prefix",
            "authority-records/organization/",
            "--max-keys",
            "5",
        ])
        .build(&mut table)?;
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    config.wasm_component_model(true);
    config.wasm_multi_memory(true);
    config.async_support(true);

    let engine = Engine::new(&config)?;
    let component = Component::from_file(&engine, "../../target/wasm32-wasi/release/aws_cli.wasm")?;
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
