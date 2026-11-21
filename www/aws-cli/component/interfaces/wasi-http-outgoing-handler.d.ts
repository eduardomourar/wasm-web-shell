/** @module Interface wasi:http/outgoing-handler@0.2.12 **/
/**
 * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
 */
export function handle(request: OutgoingRequest, options: RequestOptions | undefined): FutureIncomingResponse;
export type OutgoingRequest = import('./wasi-http-types.js').OutgoingRequest;
export type RequestOptions = import('./wasi-http-types.js').RequestOptions;
export type FutureIncomingResponse = import('./wasi-http-types.js').FutureIncomingResponse;
export type ErrorCode = import('./wasi-http-types.js').ErrorCode;
