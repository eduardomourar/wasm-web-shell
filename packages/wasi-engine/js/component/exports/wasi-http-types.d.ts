export namespace WasiHttpTypes {
  export function dropFields(fields: Fields): void;
  export function newFields(entries: [string, string][]): Fields;
  export function fieldsEntries(fields: Fields): [string, Uint8Array][];
  export function dropOutgoingRequest(request: OutgoingRequest): void;
  export function newOutgoingRequest(method: Method, pathWithQuery: string | null, scheme: Scheme | null, authority: string | null, headers: Headers): OutgoingRequest;
  export function outgoingRequestWrite(request: OutgoingRequest): OutgoingStream;
  export function dropIncomingResponse(response: IncomingResponse): void;
  export function incomingResponseStatus(response: IncomingResponse): StatusCode;
  export function incomingResponseHeaders(response: IncomingResponse): Headers;
  export function incomingResponseConsume(response: IncomingResponse): IncomingStream;
  export function dropFutureIncomingResponse(f: FutureIncomingResponse): void;
  export function futureIncomingResponseGet(f: FutureIncomingResponse): Result<IncomingResponse, Error> | null;
  export function listenToFutureIncomingResponse(f: FutureIncomingResponse): Pollable;
}
export type Fields = number;
export type OutgoingRequest = number;
export type Method = MethodGet | MethodHead | MethodPost | MethodPut | MethodDelete | MethodConnect | MethodOptions | MethodTrace | MethodPatch | MethodOther;
export interface MethodGet {
  tag: 'get',
}
export interface MethodHead {
  tag: 'head',
}
export interface MethodPost {
  tag: 'post',
}
export interface MethodPut {
  tag: 'put',
}
export interface MethodDelete {
  tag: 'delete',
}
export interface MethodConnect {
  tag: 'connect',
}
export interface MethodOptions {
  tag: 'options',
}
export interface MethodTrace {
  tag: 'trace',
}
export interface MethodPatch {
  tag: 'patch',
}
export interface MethodOther {
  tag: 'other',
  val: string,
}
export type Scheme = SchemeHttp | SchemeHttps | SchemeOther;
export interface SchemeHttp {
  tag: 'HTTP',
}
export interface SchemeHttps {
  tag: 'HTTPS',
}
export interface SchemeOther {
  tag: 'other',
  val: string,
}
export type Headers = Fields;
import type { OutputStream } from '../exports/wasi-io-streams';
export { OutputStream };
export type OutgoingStream = OutputStream;
export type IncomingResponse = number;
export type StatusCode = number;
import type { InputStream } from '../exports/wasi-io-streams';
export { InputStream };
export type IncomingStream = InputStream;
export type FutureIncomingResponse = number;
export type Error = ErrorInvalidUrl | ErrorTimeoutError | ErrorProtocolError | ErrorUnexpectedError;
export interface ErrorInvalidUrl {
  tag: 'invalid-url',
  val: string,
}
export interface ErrorTimeoutError {
  tag: 'timeout-error',
  val: string,
}
export interface ErrorProtocolError {
  tag: 'protocol-error',
  val: string,
}
export interface ErrorUnexpectedError {
  tag: 'unexpected-error',
  val: string,
}
import type { Pollable } from '../exports/wasi-poll-poll';
export { Pollable };
export interface RequestOptions {
  connectTimeoutMs?: number,
  firstByteTimeoutMs?: number,
  betweenBytesTimeoutMs?: number,
}
export type Result<T, E> = { tag: 'ok', val: T } | { tag: 'err', val: E };
