import { initialize } from "coreutils-wasm";
import { createWasiCli } from "./wasi-cli";
import { _setPreopens, preopens, types} from "./wasi-filesystem";

/**
 * Execute a coreutils command (ls, cat, echo, etc.)
 */
export const executeCoreutilsCommand = async (
  args: string[],
  envVars: Record<string, string> | undefined,
  stdIn: string | null,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preOpened: Record<string, string>,
) => {
  // Create custom WASI FileSystem
  await _setPreopens(preOpened);
  const filesystem = {
    preopens,
    types,
  };

  // Create custom WASI CLI
  const cli = await createWasiCli(stdIn, stdOut, stdErr, preOpened);

  // Initialize the coreutils component
  const command = await initialize({
    cli,
    filesystem,
    sandbox: {
      env: envVars,
      args,
      enableNetwork: false,
    },
  });

  // Run the command
  await command.run.run();
};
