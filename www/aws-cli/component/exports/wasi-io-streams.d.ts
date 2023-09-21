export namespace WasiIoStreams {
  export function read(this_: InputStream, len: bigint): [Uint8Array, StreamStatus];
  export function blockingRead(this_: InputStream, len: bigint): [Uint8Array, StreamStatus];
  export function subscribeToInputStream(this_: InputStream): Pollable;
  export function dropInputStream(this_: InputStream): void;
  export function checkWrite(this_: OutputStream): bigint;
  export function write(this_: OutputStream, contents: Uint8Array | ArrayBuffer): void;
  export function blockingWriteAndFlush(this_: OutputStream, contents: Uint8Array | ArrayBuffer): void;
  export function flush(this_: OutputStream): void;
  export function blockingFlush(this_: OutputStream): void;
  export function subscribeToOutputStream(this_: OutputStream): Pollable;
  export function dropOutputStream(this_: OutputStream): void;
}
export type InputStream = number;
/**
 * # Variants
 * 
 * ## `"open"`
 * 
 * ## `"ended"`
 */
export type StreamStatus = 'open' | 'ended';
import type { Pollable } from '../exports/wasi-poll-poll';
export { Pollable };
export type OutputStream = number;
/**
 * # Variants
 * 
 * ## `"last-operation-failed"`
 * 
 * ## `"closed"`
 */
export type WriteError = 'last-operation-failed' | 'closed';
