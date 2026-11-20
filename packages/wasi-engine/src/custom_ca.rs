//! HTTP hooks that trust a caller-supplied CA bundle.

use std::{path::Path, sync::Arc, time::Duration};

use http_body_util::BodyExt;
use rustls::{
    ClientConfig, RootCertStore,
    pki_types::{CertificateDer, ServerName, pem::PemObject},
};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use wasmtime_wasi_http::{Error, RequestOptions, WasiBody, WasiHttpHooks, io::TokioIo};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

/// Sends outgoing HTTPS requests with a TLS trust store built from a PEM bundle.
///
/// Used to reach local emulators that serve a self-signed certificate.
pub struct CustomCaHooks {
    connector: TlsConnector,
}

impl CustomCaHooks {
    pub fn from_pem_file(path: &Path) -> anyhow::Result<Self> {
        let mut roots = RootCertStore::empty();
        for cert in CertificateDer::pem_file_iter(path)? {
            roots.add(cert?)?;
        }
        let config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        Ok(Self {
            connector: TlsConnector::from(Arc::new(config)),
        })
    }
}

fn server_name(authority: &str) -> Result<ServerName<'static>, Error> {
    if let Ok(addr) = authority.parse::<std::net::SocketAddr>() {
        return Ok(ServerName::from(addr.ip()));
    }
    let host = authority
        .split_once(':')
        .map_or(authority, |(host, _)| host);
    Ok(ServerName::try_from(host)?.to_owned())
}

impl WasiHttpHooks for CustomCaHooks {
    fn send_request(
        &mut self,
        mut request: http::Request<WasiBody>,
        options: Option<RequestOptions>,
        _fut: Box<dyn Future<Output = Result<(), Error>> + Send>,
    ) -> Box<
        dyn Future<
                Output = Result<
                    (
                        http::Response<WasiBody>,
                        Box<dyn Future<Output = Result<(), Error>> + Send>,
                    ),
                    Error,
                >,
            > + Send,
    > {
        let connector = self.connector.clone();
        Box::new(async move {
            let uri = request.uri();
            let use_tls = uri.scheme() == Some(&http::uri::Scheme::HTTPS);
            let authority = uri
                .authority()
                .ok_or(Error::HttpRequestUriInvalid)?
                .to_string();
            let address = if authority.contains(':') {
                authority.clone()
            } else {
                format!("{authority}:{}", if use_tls { 443 } else { 80 })
            };
            let connect_timeout = options
                .and_then(|o| o.connect_timeout)
                .unwrap_or(DEFAULT_TIMEOUT);
            let first_byte_timeout = options
                .and_then(|o| o.first_byte_timeout)
                .unwrap_or(DEFAULT_TIMEOUT);

            let tcp = tokio::time::timeout(connect_timeout, TcpStream::connect(&address))
                .await
                .map_err(|_| Error::ConnectionTimeout)?
                .map_err(Error::Connect)?;

            let mut sender = if use_tls {
                let tls = connector
                    .connect(server_name(&address)?, tcp)
                    .await
                    .map_err(Error::Tls)?;
                handshake(TokioIo::new(tls), connect_timeout).await?
            } else {
                handshake(TokioIo::new(tcp), connect_timeout).await?
            };

            *request.uri_mut() = http::Uri::builder()
                .path_and_query(request.uri().path_and_query().map_or("/", |p| p.as_str()))
                .build()
                .expect("derived from a valid request");

            let response = tokio::time::timeout(first_byte_timeout, sender.send_request(request))
                .await
                .map_err(|_| Error::ConnectionReadTimeout)?
                .map_err(Error::from)?;
            let response = response.map(|body| body.map_err(Error::from).boxed_unsync());
            let done: Box<dyn Future<Output = Result<(), Error>> + Send> =
                Box::new(async { Ok(()) });
            Ok((response, done))
        })
    }
}

async fn handshake<T>(
    io: TokioIo<T>,
    timeout: Duration,
) -> Result<hyper::client::conn::http1::SendRequest<WasiBody>, Error>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (sender, connection) = tokio::time::timeout(
        timeout,
        hyper::client::conn::http1::Builder::new().handshake(io),
    )
    .await
    .map_err(|_| Error::ConnectionTimeout)??;
    tokio::spawn(connection);
    Ok(sender)
}
