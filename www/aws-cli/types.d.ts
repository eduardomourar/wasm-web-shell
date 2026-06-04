// Module augmentation to fix type-only exports in @bytecodealliance/preview2-shim/io
// The runtime exports actual values, but the type definitions mark them as type-only
declare module "@bytecodealliance/preview2-shim/io" {
  export namespace streams {
    export interface OutputStreamHandler {
      write: (buf: Uint8Array) => void;
      blockingWriteAndFlush?: (buf: Uint8Array) => void;
      blockingFlush?: () => void;
      checkWrite?: (len: bigint) => bigint;
      flush?: () => void;
      subscribe?: () => poll.Pollable;
      [Symbol.dispose]?: () => void;
    }

    export interface InputStreamHandler {
      blockingRead: (len: bigint) => Uint8Array;
      subscribe: () => poll.Pollable;
      [Symbol.dispose]?: () => void;
    }

    export class InputStream {
      constructor(handler: InputStreamHandler);
      read(len: bigint): Uint8Array;
      blockingRead(len: bigint): Uint8Array;
      skip(len: bigint): bigint;
      blockingSkip(len: bigint): bigint;
      subscribe(): poll.Pollable;
      [Symbol.dispose](): void;
    }

    export class OutputStream {
      constructor(handler: OutputStreamHandler);
      checkWrite(len?: bigint): bigint;
      write(buf: Uint8Array): void;
      blockingWriteAndFlush(buf: Uint8Array): void;
      flush(): void;
      blockingFlush(): void;
      writeZeroes(len: bigint): void;
      blockingWriteZeroesAndFlush(len: bigint): void;
      splice(src: InputStream, len: bigint): number;
      blockingSplice(src: InputStream, len: bigint): void;
      subscribe(): poll.Pollable;
      [Symbol.dispose](): void;
    }
  }

  export namespace error {
    export class Error {
      constructor(payload: string);
      toDebugString(): string;
    }
  }

  export namespace poll {
    export class Pollable {
      ready(): boolean;
      block(): void;
      [Symbol.dispose](): void;
    }
    export function poll(list: Pollable[]): Uint32Array;
  }
}
