use aws_smithy_async::rt::sleep::{AsyncSleep, Sleep};

/// Implementation of [`AsyncSleep`] for WASI.
#[non_exhaustive]
#[derive(Debug, Default)]
pub struct WasiSleep;

impl AsyncSleep for WasiSleep {
    fn sleep(&self, duration: std::time::Duration) -> Sleep {
        Sleep::new(Box::pin(async move {
            std::thread::sleep(duration);
        }))
    }
}
