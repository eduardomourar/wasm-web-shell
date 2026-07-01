import { initialize } from "aws-cli-wasm";
import { createWasiCli } from "./wasi-cli";
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
  const filesystem = {
    preopens,
    types,
  };

  // Create custom WASI CLI
  const cli = await createWasiCli(stdIn, stdOut, stdErr, preOpened);

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
  await command.run.run();
};
