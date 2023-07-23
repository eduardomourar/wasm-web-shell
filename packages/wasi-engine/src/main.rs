use std::{any::Any, env, pin::Pin};
use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store,
};
use wasmtime_wasi::preview2::{wasi::command::Command, Table, WasiCtx, WasiCtxBuilder, WasiView};
use wasmtime_wasi_http::WasiHttp;

pub struct Ctx {
    table: Table,
    wasi: WasiCtx,
    http: WasiHttp,
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

pub fn add_to_linker<T: WasiView>(l: &mut wasmtime::component::Linker<T>) -> anyhow::Result<()> {
    wasmtime_wasi::preview2::wasi::clocks::wall_clock::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::clocks::monotonic_clock::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::clocks::timezone::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::filesystem::filesystem::add_to_linker(l, |t| t)?;
    // wasmtime_wasi::preview2::wasi::poll::poll::add_to_linker(l, |t| t)?;
    // wasmtime_wasi::preview2::wasi::io::streams::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::random::random::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::exit::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::environment::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::preopens::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::stdin::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::stdout::add_to_linker(l, |t| t)?;
    wasmtime_wasi::preview2::wasi::cli_base::stderr::add_to_linker(l, |t| t)?;
    Ok(())
}

// struct WritePipe(wasi_common::pipe::WritePipe<std::io::Sink>);

// impl common::OutputStream for WritePipe {
//     fn as_any(&self) -> &dyn Any {
//         self
//     }

//     fn write(&mut self, buf: &[u8]) -> Result<u64, common::Error> {
//         println!("{}", String::from_utf8_lossy(buf).into_owned());
//         Ok(buf.len().try_into()?)
//         // futures::executor::block_on(async move {
//         //     self.0
//         //         .write(buf)
//         //         .await
//         //         .map_err(|err| common::Error::trap(err.into()))
//         // })
//     }

//     fn write_zeroes(&mut self, nelem: u64) -> Result<u64, common::Error> {
//         Ok(nelem)
//         // futures::executor::block_on(async move {
//         //     self.0
//         //         .write_zeroes(nelem)
//         //         .await
//         //         .map_err(|err| common::Error::trap(err.into()))
//         // })
//     }
//     fn readable(&self) -> Result<(), common::Error> {
//         Ok(())
//     }
//     fn writable(&self) -> Result<(), common::Error> {
//         Ok(())
//     }
// }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut table = Table::new();
    let mut wasi = WasiCtxBuilder::new()
        .inherit_stdio()
        .push_env(
            "AWS_API_KEY",
            &env::var("AWS_API_KEY").expect("AWS_API_KEY is not set"),
        )
        .set_args(&["--verbose", "--region", "us-west-2"])
        .build(&mut table)?;
    let mut http = WasiHttp::new();
    // http.set_stdout(Box::new(WritePipe(wasi_common::pipe::WritePipe::new(
    //     std::io::sink(),
    // ))));
    // http.set_stderr(Box::new(WritePipe(wasi_common::pipe::WritePipe::new(
    //     std::io::sink(),
    // ))));
    let mut config = Config::new();
    config.wasm_backtrace_details(wasmtime::WasmBacktraceDetails::Enable);
    config.wasm_component_model(true);
    config.wasm_multi_memory(true);
    config.async_support(true);

    let engine = Engine::new(&config)?;
    let component = Component::from_file(&engine, "../../target/wasm32-wasi/debug/aws_cli.wasm")?;
    let mut store = Store::new(&engine, Ctx { table, wasi, http });
    let mut linker = Linker::<Ctx>::new(&engine);

    add_to_linker(&mut linker)?;
    wasmtime_wasi_http::add_to_component_linker(&mut linker, |ctx: &mut Ctx| &mut ctx.http)?;

    let (wasi, _instance) = Command::instantiate_async(&mut store, &component, &linker).await?;
    let result = wasi
        .call_run(&mut store)
        .await
        .map_err(anyhow::Error::from)?;

    if result.is_err() {
        anyhow::bail!(
            "command returned with failing exit status: {:?}",
            result.err().unwrap()
        );
    }

    Ok(())
}
