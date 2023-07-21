struct Component;

impl bindings::Example for Component {
    fn run() -> Result<(), ()> {
        // let input = bindings::wasi::cli::environment::get_arguments();
        let output = "Hello, World!".to_string();
        // println!("input: {}", args.join(","));
        println!("output: {}", output);
        Ok(())
    }
}

bindings::export!(Component);
