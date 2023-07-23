use aws_smithy_client::erase::DynConnector;
use aws_smithy_client::http_connector::HttpConnector;
use aws_smithy_http::body::SdkBody;
use aws_smithy_http::result::ConnectorError;
use bytes::Bytes;
use std::task::{Context, Poll};
use tower::Service;

use crate::http_client::DefaultClient;

pub(crate) fn default_connector() -> impl Into<HttpConnector> {
    DynConnector::new(Adapter::default())
}

#[derive(Default, Debug, Clone)]
struct Adapter {}

impl Service<http::Request<SdkBody>> for Adapter {
    type Response = http::Response<SdkBody>;

    type Error = ConnectorError;

    #[allow(clippy::type_complexity)]
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send + 'static>,
    >;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: http::Request<SdkBody>) -> Self::Future {
        println!("Adapter: sending request...");
        let (parts, body) = req.into_parts();
        let req = http::Request::<SdkBody>::from_parts(parts, body);
        let client = DefaultClient::new(None);
        let fut = client.handle(req.map(|body| match body.bytes() {
            Some(value) => Bytes::copy_from_slice(value),
            None => Bytes::new(),
        }));
        Box::pin(async move {
            Ok(fut
                .map_err(|err| ConnectorError::other(err.into(), None))?
                .map(SdkBody::from))
        })
    }
}
