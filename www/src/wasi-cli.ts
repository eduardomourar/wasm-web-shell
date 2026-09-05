import { cli } from "@bytecodealliance/preview2-shim";
import { Result } from "@bytecodealliance/preview2-shim/interfaces/wasi-cli-exit";

/**
 * Thrown by the `wasi:cli/exit#exit` shim below to unwind out of the guest
 * module, since exit is specified as never returning to the caller.
 */
export class ComponentExit extends Error {
  code: number;
  constructor(code: number) {
    super(`Component exited with code ${code}`);
    this.code = code;
  }
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export interface WasiCliResult {
  cli: typeof cli;
  /**
   * Resolves with the exit code once the guest calls `wasi:cli/exit#exit`.
   * Never resolves otherwise.
   *
   * The generated component bindings (js-component-bindgen) leave the
   * top-level `run()` completion promise unsettled whenever a host import
   * throws mid-call (its "manually async"/JSPI task path never rejects or
   * resolves the completion promise on error). Since `exit.exit()` must
   * throw to unwind out of the guest, `await command.run.run()` hangs
   * forever after an explicit exit call. Callers should race this promise
   * against `command.run.run()` to detect completion.
   */
  exitPromise: Promise<number>;
}

/**
 * Create WASI CLI implementation.
 * Returns interface backed by xterm standard io.
 */
export const createWasiCli = async (
  stdIn: string | null,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preopens: Record<string, string>,
): Promise<WasiCliResult> => {
  // Set current working directory to first preopen path
  const keys = Object.keys(preopens);
  if (keys.length > 0) {
    const firstPath = keys[0];
    if (firstPath) {
      // console.debug(`[wasi:cli createWasiCli] Setting cwd to "${firstPath}"`);
      cli._setCwd(firstPath);
    }
  }

  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  // Wire the default cli shim's stdio streams to the terminal
  const stdinData = stdIn ? textEncoder.encode(stdIn) : new Uint8Array(0);
  let stdinOffset = 0;
  cli._setStdin({
    blockingRead(len: bigint): Uint8Array {
      const bytesToRead = Math.min(Number(len), stdinData.length - stdinOffset);
      if (bytesToRead <= 0) {
        throw { tag: "closed" };
      }
      const chunk = stdinData.slice(stdinOffset, stdinOffset + bytesToRead);
      stdinOffset += bytesToRead;
      return chunk;
    },
  });
  cli._setStdout({ write: (contents) => stdOut(textDecoder.decode(contents)) });
  cli._setStderr({ write: (contents) => stdErr(textDecoder.decode(contents)) });

  // Create custom CLI shim by merging with defaults, overriding `exit` so we
  // can observe the exit code (see `exitPromise` above).
  const customCli = {
    ...cli,
    exit: {
      exit(status: Result<void, void>) {
        const code = status.tag === "err" ? 1 : 0;
        resolveExit(code);
        throw new ComponentExit(code);
      },
    },
  };

  return { cli: customCli, exitPromise };
};
