import { cli } from "@bytecodealliance/preview2-shim";
import { bufferedInputStream } from "@bytecodealliance/preview2-shim/browser/helpers/cli";

export const ComponentExit = cli.ComponentExit;

const textDecoder = new TextDecoder();

export interface WasiCliResult {
  cli: ReturnType<typeof cli.createCli>;
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
 * Create an isolated WASI CLI implementation backed by xterm standard io.
 */
export const createWasiCli = async (
  stdIn: string | null,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preopens: Record<string, string>,
): Promise<WasiCliResult> => {
  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const wasiCli = cli.createCli({
    initialCwd: Object.keys(preopens)[0],
    stdin: stdIn ? bufferedInputStream(stdIn) : undefined,
    stdout: { write: (contents) => stdOut(textDecoder.decode(contents)) },
    stderr: { write: (contents) => stdErr(textDecoder.decode(contents)) },
    onExit: (code) => resolveExit(code),
  });

  return { cli: wasiCli, exitPromise };
};
