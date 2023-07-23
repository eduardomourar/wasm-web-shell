mod adapter;
mod http_client;
mod list_objects;
mod wasi_sleep;

pub use list_objects::_start;

struct Component;

impl bindings::CommandExtended for Component {
    fn run() -> Result<(), ()> {
        Ok(_start())
    }
}

bindings::export!(Component);
