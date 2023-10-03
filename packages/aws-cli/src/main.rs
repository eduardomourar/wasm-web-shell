cargo_component_bindings::generate!();

mod adapter;
mod commands;
mod logger;
mod s3;

fn main() {
    crate::logger::init();
    std::panic::set_hook(Box::new(move |panic_info| {
        eprintln!("Internal unhandled panic:\n{:?}!", panic_info);
        std::process::exit(1);
    }));
    futures::executor::block_on(crate::commands::run());
}
