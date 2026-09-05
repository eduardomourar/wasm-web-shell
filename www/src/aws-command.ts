import { initialize } from "aws-cli-wasm";
import { ComponentExit, createWasiCli } from "./wasi-cli";
import { _setPreopens, preopens, types,  } from "./wasi-filesystem";

export const main = async (
  args: string[],
  envVars: Record<string, string> | undefined,
  stdIn: string | null,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preOpened: Record<string, string>,
  providers: Parameters<typeof initialize>[0],
) => {
  // Create custom WASI FileSystem
  await _setPreopens(preOpened);
  // TEMPORARY: cast around overly strict types shipped in the WIP
  // preview2-shim build pinned in package.json for the would-block fix
  // (https://github.com/bytecodealliance/jco/issues/2042). Remove once a
  // stable, published fix lands and this pin is removed.
  const filesystem = {
    preopens,
    types,
  } as any;

  // Create custom WASI CLI
  const { cli, exitPromise } = await createWasiCli(stdIn, stdOut, stdErr, preOpened);

  // Create WASIShim with custom CLI, filesystem, and sandbox config
  const command = await initialize(providers, {
    cli,
    filesystem,
    sandbox: {
      env: envVars,
      args,
      enableNetwork: true,
    },
  });

  // Run the command. If the guest calls `exit()`, the generated bindings
  // never settle `run.run()`'s promise, so race against `exitPromise` too.
  try {
    await Promise.race([command.run.run(), exitPromise]);
  } catch (err) {
    if (!(err instanceof ComponentExit)) {
      throw err;
    }
  }
};
