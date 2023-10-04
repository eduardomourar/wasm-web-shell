import { initialize, io, cli } from "aws-cli-wasm";

const textDecoder = new TextDecoder();
// Create custom I/O shim with stdout/stderr handlers
const { OutputStream } = io.streams;

export const main = async (
  args: string[],
  envVars: Record<string, string> | undefined,
  _stdIn: any,
  stdOut: (message: string) => void,
  stdErr: (message: string) => void,
  preopens: Record<string, string>,
  credentialsProvider: any,
) => {
  // Create a complete OutputStream handler that won't block
  const createStreamHandler = (outputFn: (message: string) => void) => ({
    write(contents: Uint8Array) {
      outputFn(textDecoder.decode(contents));
    },
    // Return a large number to indicate the stream can accept data
    checkWrite(_len?: bigint) {
      return BigInt(1_000_000);
    },
  });

  // Create custom CLI shim by merging with defaults
  const customCli = {
    ...cli,
    stdout: {
      OutputStream,
      getStdout: () => new OutputStream(createStreamHandler(stdOut)),
    },
    stderr: {
      OutputStream,
      getStderr: () => new OutputStream(createStreamHandler(stdErr)),
    },
  };

  // Create WASIShim with custom CLI and sandbox config
  const command = await initialize(credentialsProvider, {
    cli: customCli,
    sandbox: {
      preopens,
      env: envVars,
      args: ["aws"].concat(args),
      enableNetwork: true,
    },
  });
  await command.run.run();
};
