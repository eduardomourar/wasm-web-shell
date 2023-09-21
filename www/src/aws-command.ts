import { initialize, wasiImport } from "aws-cli-wasm";
import { ImportObject } from "aws-cli/component/aws";

export const main = async (args: string[], envVars: [string, string][], stdIn: any, stdOut: any, stdErr: any, getDirectories: any) => {
  const wasi = wasiImport as any;
  const ioWrite = (s: number, buf: Uint8Array) => {
    switch (s) {
      case 1: {
        const decoder = new TextDecoder();
        const output = decoder.decode(buf);
        stdOut(output);
        break;
      }
      case 2: {
        const decoder = new TextDecoder();
        const output = decoder.decode(buf);
        stdErr(output);
        break;
      }
      default:
        return wasi["io"]["streams"]["write"](s, buf);
    }
  };
  const command = await initialize({
    "filesystem": {
      ...wasi["filesystem"],
      "preopens": {
        getDirectories,
      },
    },
    "io": {
      "streams": {
        ...wasi["io"]["streams"],
        blockingRead: (s: number, len: bigint) => {
          switch (s) {
            case 0: {
              const bytes = stdIn();
              return [bytes, 'ended']
            }
            default:
              return wasi["io"]["streams"]["blockingRead"](s, len);
          }
        },
        // TODO: investigate further issue on dropOutputStream
        dropOutputStream: (s: number) => {},
        write: ioWrite,
        blockingWriteAndFlush: ioWrite,
      },
    },
    "cli": {
      ...wasi["cli"],
      "environment": {
        getEnvironment: () => envVars,
        getArguments: () => args,
      },
    }
  } as Partial<ImportObject>);
  command["wasi:cli/run"].run();
};
