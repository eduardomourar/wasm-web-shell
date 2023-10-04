#[allow(warnings)]
mod bindings;
mod commands;
mod config;
mod logger;
mod s3;
mod ssm;
mod sts;

#[cfg(test)]
mod test_utils;

use bindings::exports::wasi::cli::run::Guest;

struct Component;

impl Guest for Component {
    fn run() -> std::result::Result<(), ()> {
        logger::init();
        std::panic::set_hook(Box::new(move |panic_info| {
            eprintln!("Internal unhandled panic:\n{:?}!", panic_info);
            std::process::exit(1);
        }));
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("Failed to generate runtime");
        match rt.block_on(commands::run()) {
            Ok(_) => {
                tracing::debug!("Success");
            }
            Err(err) => {
                tracing::debug!("Failure");
                eprintln!("{:?}", err);
            }
        };
        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
