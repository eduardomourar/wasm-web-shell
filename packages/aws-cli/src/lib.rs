#![cfg(all(target_family = "wasm", target_os = "wasi"))]

cargo_component_bindings::generate!();

use bindings::exports::wasi::cli::run::Guest;

mod adapter;
mod list_objects;
mod logger;

use list_objects::run;

struct Component;

impl Guest for Component {
    fn run() -> Result<(), ()> {
        crate::logger::init();
        std::panic::set_hook(Box::new(move |panic_info| {
            eprintln!("Internal unhandled panic:\n{:?}!", panic_info);
            std::process::exit(1);
        }));
        futures::executor::block_on(run());
        Ok(())
    }
}
