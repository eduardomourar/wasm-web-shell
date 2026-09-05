use anyhow::{Error, Result};
use wstd::http::{Body, Client, HeaderValue, Request, Response};
use wstd::time::Duration;

pub(crate) async fn run() -> Result<Response<Body>, Error> {
    let mut client = Client::new();
    client.set_connect_timeout(Duration::from_secs(60));
    let request = Request::get("https://jsonplaceholder.typicode.com/users")
        .header("Accept", HeaderValue::from_static("application/json"))
        .body(Body::empty())?;

    client.send(request).await
}

#[cfg(test)]
mod test {
    use super::run;

    #[wstd::test]
    async fn test_run_successfully() {
        let result = run().await.unwrap();
        assert_eq!(result.status().as_str(), "200");
    }
}
