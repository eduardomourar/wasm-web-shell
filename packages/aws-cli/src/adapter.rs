use aws_smithy_client::erase::DynConnector;
use aws_smithy_client::http_connector::HttpConnector;
use aws_smithy_http::result::ConnectorError;
use aws_smithy_http::{body::SdkBody, byte_stream::ByteStream};
use bytes::Bytes;
use std::task::{Context, Poll};
use tower::Service;

use wasi_preview2_prototype::http_client::DefaultClient;

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

    fn call(&mut self, mut req: http::Request<SdkBody>) -> Self::Future {
        tracing::debug!("Adapter: sending request");
        tracing::trace!("Request details {:?}", req);
        let client = DefaultClient::new(None);
        let fut = async move {
            let body = std::mem::replace(req.body_mut(), SdkBody::taken());
            let loaded_body = if body.content_length().unwrap_or(0) > 0 {
                ByteStream::new(body).collect().await.unwrap().into_bytes()
            } else {
                Bytes::new()
            };
            tracing::trace!("Loaded request body {:?}", loaded_body);
            client.handle(req.map(|_| loaded_body))
        };
        Box::pin(async move {
            let res = fut
                .await
                .map_err(|err| ConnectorError::other(err.into(), None))
                .expect("response from adapter");
            tracing::debug!("Adapter: response received");
            tracing::trace!("Response details {:?}", res);

            let (parts, body) = res.into_parts();
            let loaded_body = if body.is_empty() {
                SdkBody::empty()
            } else {
                tracing::trace!(
                    "Loaded response body {:?}",
                    std::str::from_utf8(&body[..]).unwrap()
                );
                SdkBody::try_from(body).unwrap()
            };
            Ok(http::Response::from_parts(parts, loaded_body))
            // Ok(res.map(|_| {
            //     let buf = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Name>nara-national-archives-catalog</Name><Prefix>authority-records/organization/</Prefix><NextContinuationToken>1/f11TDBC+bRsjo5BNPZ/HqmMy5uSjuhZDT7aVR4wQ2S5HXTMWQzQibruGthjrrP80g5nZjK5bYaSw2Wx8TMSlzUc+sMXT4ZFCvjEUCI3pxRjW/OLSeogRDdQnhUrxvCW</NextContinuationToken><KeyCount>5</KeyCount><MaxKeys>5</MaxKeys><Delimiter>/</Delimiter><IsTruncated>true</IsTruncated><Contents><Key>authority-records/organization/organization-0.json</Key><LastModified>2022-12-21T20:16:43.000Z</LastModified><ETag>&quot;15e89e7f6ab13d6d0d22574f67b25eba-16&quot;</ETag><Size>132539810</Size><StorageClass>INTELLIGENT_TIERING</StorageClass></Contents><Contents><Key>authority-records/organization/organization-1.json</Key><LastModified>2022-12-21T20:16:43.000Z</LastModified><ETag>&quot;ebfc45fdd0f53f6441934e24b7892680-13&quot;</ETag><Size>102910555</Size><StorageClass>INTELLIGENT_TIERING</StorageClass></Contents><Contents><Key>authority-records/organization/organization-10.json</Key><LastModified>2022-12-21T20:16:44.000Z</LastModified><ETag>&quot;6799c7524db7e1d4949433985525e073&quot;</ETag><Size>7333734</Size><StorageClass>INTELLIGENT_TIERING</StorageClass></Contents><Contents><Key>authority-records/organization/organization-2.json</Key><LastModified>2022-12-21T20:16:43.000Z</LastModified><ETag>&quot;581677059147048e2afbcd8518466a8a-9&quot;</ETag><Size>72349231</Size><StorageClass>INTELLIGENT_TIERING</StorageClass></Contents><Contents><Key>authority-records/organization/organization-3.json</Key><LastModified>2022-12-21T20:16:43.000Z</LastModified><ETag>&quot;62acc6066e14067d2ec9518fb971b452-10&quot;</ETag><Size>79980362</Size><StorageClass>INTELLIGENT_TIERING</StorageClass></Contents></ListBucketResult>".as_bytes();
            //     SdkBody::from(buf)
            // }))
        })
    }
}
