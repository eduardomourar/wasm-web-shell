export namespace WasiIoStreams {
  export function read(this_: InputStream, len: bigint): [Uint8Array | ArrayBuffer, StreamStatus];
  export function blockingRead(this_: InputStream, len: bigint): [Uint8Array | ArrayBuffer, StreamStatus];
  export function subscribeToInputStream(this_: InputStream): Pollable;
  export function dropInputStream(this_: InputStream): void;
  export function write(this_: OutputStream, buf: Uint8Array): [bigint, StreamStatus];
  export function blockingWrite(this_: OutputStream, buf: Uint8Array): [bigint, StreamStatus];
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
import type { Pollable } from '../imports/wasi-poll-poll';
export { Pollable };
export type OutputStream = number;
