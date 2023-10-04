import type { WASIShimConfig } from "@bytecodealliance/preview2-shim/instantiation";
import type { Root, ImportObject } from "../component/aws";

export function initialize(credentialsProvider: ImportObject["component:aws-cli/credentials-provider"], config?: Partial<WASIShimConfig>): Promise<Root>;

// Type definitions that match the runtime implementation
export namespace io {
  export namespace streams {
    export interface OutputStreamHandler {
      write: (buf: Uint8Array) => void;
      blockingWriteAndFlush?: (buf: Uint8Array) => void;
      blockingFlush?: () => void;
      checkWrite?: (len: bigint) => bigint;
      flush?: () => void;
      subscribe?: () => io.poll.Pollable;
      [Symbol.dispose]?: () => void;
    }

    export interface InputStreamHandler {
      blockingRead: (len: bigint) => Uint8Array;
      subscribe: () => io.poll.Pollable,
      [Symbol.dispose]?: () => void;
    }

    export class OutputStream {
      constructor(handler: OutputStreamHandler);
      checkWrite(len?: bigint): bigint;
      write(buf: Uint8Array): void;
      blockingWriteAndFlush(buf: Uint8Array): void;
      flush(): void;
      blockingFlush(): void;
      writeZeroes(len: bigint): void;
      blockingWriteZeroes(len: bigint): void;
      blockingWriteZeroesAndFlush(len: bigint): void;
      splice(src: any, len: bigint): number;
      blockingSplice(src: any, len: bigint): void;
      forward(src: any): void;
      subscribe(): io.poll.Pollable;
    }

    export class InputStream {
      constructor(handler: InputStreamHandler);
      read(len: bigint): Uint8Array;
      blockingRead(len: bigint): Uint8Array;
      skip(len: bigint): bigint;
      blockingSkip(len: bigint): bigint;
      subscribe: () => io.poll.Pollable;
    }
  }

  export namespace error {
    export class Error {
      constructor(msg: string);
      toDebugString(): string;
    }
  }

  export namespace poll {
    export class Pollable {
      constructor(promise?: Promise<any>);
      ready(): boolean;
      block(): void;
    }
  }
}

import type * as CliModule from "@bytecodealliance/preview2-shim/cli";
export const cli: typeof CliModule;

import type * as FilesystemModule from "@bytecodealliance/preview2-shim/filesystem";
export const filesystem: typeof FilesystemModule;

import type * as RandomModule from "@bytecodealliance/preview2-shim/random";
export const random: typeof RandomModule;

import type * as ClocksModule from "@bytecodealliance/preview2-shim/clocks";
export const clocks: typeof ClocksModule;

import type * as SocketsModule from "@bytecodealliance/preview2-shim/sockets";
export const sockets: typeof SocketsModule;

import type * as HttpModule from "@bytecodealliance/preview2-shim/http";
export const http: typeof HttpModule;
