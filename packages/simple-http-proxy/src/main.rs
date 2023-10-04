use anyhow::Result;
mod http;

use futures_util::stream::StreamExt;
use wstd::http::BodyExt;
use wstd::io::AsyncWrite;

#[wstd::main]
async fn main() -> Result<()> {
    std::panic::set_hook(Box::new(move |panic_info| {
        eprintln!("Internal unhandled panic:\n{:?}!", panic_info);
        std::process::exit(1);
    }));
    let response = crate::http::run().await?;

    // Print the response.
    eprintln!("< {:?} {}", response.version(), response.status());
    for (key, value) in response.headers().iter() {
        let value = String::from_utf8_lossy(value.as_bytes());
        eprintln!("< {key}: {value}");
    }

    let body = response.into_body().into_boxed_body();
    let mut stream = body.into_data_stream();

    let mut stdout = wstd::io::stdout();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result?;
        stdout.write_all(&chunk).await?;
    }
    stdout.flush().await?;

    Ok(())
}
