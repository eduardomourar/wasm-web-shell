use anyhow::{anyhow, Context};
use bytes::{BufMut, Bytes, BytesMut};
use core::ops::Deref;
use http::header::{HeaderName, HeaderValue};

use bindings::wasi::http::{outgoing_handler, types as http_types};
use bindings::wasi::io::streams;

pub struct DefaultClient {
    options: Option<outgoing_handler::RequestOptions>,
}

impl DefaultClient {
    pub fn new(options: Option<outgoing_handler::RequestOptions>) -> Self {
        Self { options }
    }

    pub fn handle(&self, req: http::Request<Bytes>) -> anyhow::Result<http::Response<Bytes>> {
        let req = Request::try_from(req)
            .context("converting http request")?
            .to_owned();

        let res = outgoing_handler::handle(req, self.options);
        http_types::drop_outgoing_request(req);

        let response =
            http::Response::try_from(Response(res)).context("converting http response")?;
        http_types::drop_incoming_response(res);

        Ok(response)
    }
}

pub struct Request(outgoing_handler::OutgoingRequest);

impl Deref for Request {
    type Target = outgoing_handler::OutgoingRequest;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<http::Request<Bytes>> for Request {
    type Error = anyhow::Error;

    fn try_from(value: http::Request<Bytes>) -> Result<Self, Self::Error> {
        let (parts, body) = value.into_parts();
        let method = Method::try_from(parts.method)?;
        let path_with_query = parts.uri.path_and_query();
        let headers = Headers::from(&parts.headers);
        let scheme = match parts.uri.scheme_str().unwrap_or("") {
            "http" => Some(&http_types::Scheme::Http),
            "https" => Some(&http_types::Scheme::Https),
            _ => None,
        };
        let request = http_types::new_outgoing_request(
            &method,
            path_with_query.map(|q| q.as_str()),
            scheme,
            parts.uri.authority().map(|a| a.as_str()),
            headers.to_owned(),
        );

        let request_body = http_types::outgoing_request_write(request)
            .map_err(|_| anyhow!("outgoing request write failed"))?;

        let mut body_cursor = 0;
        if body.is_empty() {
            streams::write(request_body, &[]).map_err(|_| anyhow!("writing request body"))?;
        } else {
            while body_cursor < body.len() {
                let written = streams::write(request_body, &body[body_cursor..])
                    .map_err(|_| anyhow!("writing request body"))?;
                body_cursor += written as usize;
            }
        }

        Ok(Request(request))
    }
}

pub struct Method(http_types::Method);

impl Deref for Method {
    type Target = http_types::Method;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<http::Method> for Method {
    type Error = anyhow::Error;

    fn try_from(method: http::Method) -> Result<Self, Self::Error> {
        Ok(Self(match method {
            http::Method::GET => http_types::Method::Get,
            http::Method::POST => http_types::Method::Post,
            http::Method::PUT => http_types::Method::Put,
            http::Method::DELETE => http_types::Method::Delete,
            http::Method::PATCH => http_types::Method::Patch,
            http::Method::CONNECT => http_types::Method::Connect,
            http::Method::TRACE => http_types::Method::Trace,
            http::Method::HEAD => http_types::Method::Head,
            http::Method::OPTIONS => http_types::Method::Options,
            _ => return Err(anyhow!("failed due to unsupported method, currently supported methods are: GET, POST, PUT, DELETE, PATCH, CONNECT, TRACE, HEAD, and OPTIONS")),
        }))
    }
}

pub struct Response(http_types::IncomingResponse);

impl Deref for Response {
    type Target = http_types::IncomingResponse;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<Response> for http::Response<Bytes> {
    type Error = anyhow::Error;

    fn try_from(value: Response) -> Result<Self, Self::Error> {
        let future_response = value.to_owned();
        // TODO: we could create a pollable from the future_response and
        // poll on it here to test that its available immediately
        // poll::drop_pollable(future_response);

        let incoming_response = http_types::future_incoming_response_get(future_response)
            .ok_or_else(|| anyhow!("incoming response is available immediately"))?
            .map_err(|e| anyhow!("incoming response error: {e:?}"))?;
        http_types::drop_future_incoming_response(future_response);

        let status = http_types::incoming_response_status(incoming_response);
        let headers_handle = http_types::incoming_response_headers(incoming_response);

        let body_stream = http_types::incoming_response_consume(incoming_response)
            .map_err(|_| anyhow!("consuming incoming response"))?;

        let mut body = BytesMut::new();
        let mut eof = false;
        while !eof {
            let (body_chunk, stream_ended) = streams::read(body_stream, u64::MAX)
                .map_err(|_| anyhow!("reading response body"))?;
            eof = stream_ended;
            body.put(body_chunk.as_slice());
        }
        let mut res = http::Response::builder()
            .status(status)
            .body(body.freeze())
            .map_err(|_| anyhow!("building http response"))?;

        if headers_handle > 0 {
            let headers_map = res.headers_mut();
            for (name, value) in http_types::fields_entries(headers_handle) {
                headers_map.insert(
                    HeaderName::from_bytes(name.as_bytes())
                        .map_err(|_| anyhow!("converting response header name"))?,
                    HeaderValue::from_bytes(value.as_slice())
                        .map_err(|_| anyhow!("converting response header value"))?,
                );
            }
        }

        Ok(res)
    }
}

pub struct Headers(http_types::Fields);

impl Deref for Headers {
    type Target = http_types::Fields;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'a> From<&'a http::HeaderMap> for Headers {
    fn from(headers: &'a http::HeaderMap) -> Self {
        Self(http_types::new_fields(
            headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_str().unwrap().to_string()))
                .collect::<Vec<(String, String)>>()
                .as_slice(),
        ))
    }
}
