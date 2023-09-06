import * as Comlink from "comlink";
import { initialize, wasiImport } from "aws-cli-wasm";

const main = async (args, envVars, stdIn, stdOut, stdErr, getDirectories) => {
  const command = await initialize({
    "filesystem": {
      ...wasiImport["filesystem"],
      "preopens": {
        getDirectories,
      },
    },
    "io": {
      "streams": {
        ...wasiImport["io"]["streams"],
        blockingRead: (s, len) => {
          switch (s) {
            case 0: {
              const bytes = stdIn();
              return [bytes, 'ended']
            }
            default:
              return wasiImport["io"]["streams"]["blockingRead"](s, len);
          }
        },
        blockingWrite: (s, buf) => {
          switch (s) {
            case 1: {
              const decoder = new TextDecoder();
              const output = decoder.decode(buf);
              stdOut(output);
              return [BigInt(buf.byteLength), 'ended'];
            }
            case 2: {
              const decoder = new TextDecoder();
              const output = decoder.decode(buf);
              stdErr(output);
              return [BigInt(buf.byteLength), 'ended'];
            }
            default:
              return wasiImport["io"]["streams"]["blockingWrite"](s, buf);
          }
        },
      },
    },
    "cli": {
      ...wasiImport["cli"],
      "environment": {
        getEnvironment: () => envVars,
        getArguments: () => args,
      },
    }
  });
  command["wasi:cli/run"].run();
};

Comlink.expose(main);
