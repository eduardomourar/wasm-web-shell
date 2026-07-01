import { cli, io } from "@bytecodealliance/preview2-shim";
import { Result } from "@bytecodealliance/preview2-shim/interfaces/wasi-cli-exit";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// Create custom I/O shim with stdout/stderr handlers
const { InputStream, OutputStream } = io.streams;

// Create a complete OutputStream handler that won't block
const createStreamHandler = (outputFn: (message: string) => void) => ({
  write(contents: Uint8Array) {
    // console.debug(`[wasi:cli createStreamHandler write] Writing content with ${contents.length} bytes`);
    outputFn(textDecoder.decode(contents));
  },
});

// Create an InputStream handler for stdin
const createInputStreamHandler = (stdinData: string | null) => {
  const data = stdinData ? textEncoder.encode(stdinData) : new Uint8Array(0);
  let offset = 0;

  return {
    blockingRead(len: bigint): Uint8Array {
      // console.debug(`[wasi:cli createInputStreamHandler blockingRead] Reading ${len} bytes at offset ${offset}`);
      const bytesToRead = Math.min(Number(len), data.length - offset);
      if (bytesToRead <= 0) {
        throw { tag: "closed" };
      }
      const chunk = data.slice(offset, offset + bytesToRead);
      offset += bytesToRead;
      return chunk;
    },
    read(len: bigint): Uint8Array {
      // console.debug(`[wasi:cli createInputStreamHandler read] Reading ${len} bytes at offset ${offset}`);
      return this.blockingRead(len);
    },
  };
};

/**
 * Create WASI CLI implementation.
 * Returns interface backed by xterm standard io.
 */
export const createWasiCli = async (
  stdIn: string | null,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preopens: Record<string, string>,
): Promise<typeof cli> => {
  // Set current working directory to first preopen path
  const keys = Object.keys(preopens);
  if (keys.length > 0) {
    const firstPath = keys[0];
    if (firstPath) {
      // console.debug(`[wasi:cli createWasiCli] Setting cwd to "${firstPath}"`);
      cli._setCwd(firstPath);
    }
  }

  // Create custom CLI shim by merging with defaults
  const customCli = {
    ...cli,
    exit: {
      exit(status: Result<void, void>) {
        // console.debug(`[wasi:cli exit] exit with ${status}`);
        if (status.tag === "err") {
          console.error(status);
        }
      },
    },
    stdin: {
      InputStream,
      getStdin: () => io.inputStreamCreate(createInputStreamHandler(stdIn)),
    },
    stdout: {
      OutputStream,
      getStdout: () => io.outputStreamCreate(createStreamHandler(stdOut)),
    },
    stderr: {
      OutputStream,
      getStderr: () => io.outputStreamCreate(createStreamHandler(stdErr)),
    },
  };

  return customCli;
};
