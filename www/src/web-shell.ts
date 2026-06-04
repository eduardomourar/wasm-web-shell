import WasmTerminal from "wasm-terminal";
import type { WasmFile } from "wasm-terminal";
import {
  getOriginPrivateDirectory,
  FileSystemDirectoryHandle,
} from "native-file-system-adapter";
import { provideCredentials, setCredentials } from "./credentials";
import { main as awsCommand } from "./aws-command";

export const webShell = (wasmBinaryPath: string) => {
  let preOpened = new Map<string, FileSystemDirectoryHandle>();
  let wasmTerminal = new WasmTerminal(wasmBinaryPath);
  const wasmFiles: WasmFile[] = wasmTerminal._wasmFsFiles;

  wasmTerminal.onActivated = async () => {
    preOpened.set(
      "/sandbox",
      await getOriginPrivateDirectory(
        // @ts-ignore
        import("native-file-system-adapter/src/adapters/indexeddb.js")
      )
    );
    upsertFile(wasmFiles, {
      name: "/sandbox/.",
      timestamp: Date.now(),
      bytes: new Uint8Array(),
    });

    wasmTerminal.registerJsCommand("help", async (argsv: string[]) => {
      return `
Currently available commands:

    aws

Example usage:
    aws s3 list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 2 --no-sign-request
      `;
    });

    wasmTerminal.registerJsCommand(
      "aws",
      async (argsv: string[], stdinPreset: string | null) => {
        // await setCredentials();
        const envVars = {};
        let output = "";
        await awsCommand(
          argsv,
          envVars,
          (_message: any) => {},
          (message: any) => (output += message),
          (message: any) => (output += message),
          Array.from(preOpened.keys()).reduce((acc, v) => {
            acc[v] = v;
            return acc;
          }, {} as Record<string, string>),
          {
            provideCredentials,
          }
        ).catch(console.warn);
        await wasmTerminal._waitForOutputPause();

        return output;
      }
    );
  };

  wasmTerminal.onFileSystemUpdate = async (files: WasmFile[]) => {
    await Promise.all(
      files
        .filter((file) => {
          return !file.name.endsWith("/.") && file.name.indexOf("/", 1) > 0;
        })
        .map((file) =>
          writeToFileSystem(file, preOpened).catch((err) => {
            console.error(err);
            return Promise.resolve(null);
          })
        )
    );
  };

  wasmTerminal.printWelcomeMessage = () => {
    let intro = `\x1b[38;2;101;79;240m
  **************VMNNNNNNMV***************\r
  ****************IVVVVI*****************\r
  ***************************************\r
  ***************************************\r
  ***************************************\r
  ***************************************\r
  ***************************************\r
  ********::*****::*****::****::::*******\r
  ********:..***:...***..:***..::.:******\r
  *********:.:*:.::.:*..:***..:**:.:*****\r
  **********:...:**:...:***..::::::..****\r
  ***********:::****:::***:::******:::***\r
  ***************************************\r
\r
\x1b[37m\r`;

    intro += "WebAssembly Web Shell\r\n";
    intro += "Interact directly with AWS services in your browser.\r\n";
    intro +=
      "Source code at: https://github.com/eduardomourar/wasm-web-shell/\r\n\r\n";

    intro +=
      "Commands: " +
      Array.from(wasmTerminal.jsCommands.keys())
        .sort()
        .join(", ") +
      ".\r\n\r\n" +
      `Example usage:\r
\r
    # To list object from Amazon S3 Bucket\r
    aws s3 list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 2 --no-sign-request\r

    # To save object from Amazon S3 Bucket to in-browser temporary file system (IndexDB)\r
    aws s3 get-object --region us-east-1 --no-sign-request --bucket pan-ukb-us-east-1 --key sumstats_release/results_full.mt/README.txt | tee /sandbox/readme.txt\r
\r
A complete list of public S3 Buckets can be found at:\r
    https://registry.opendata.aws/\r
      `;
    return Promise.resolve(intro);
  };

  return wasmTerminal;
};

const upsertFile = (files: WasmFile[], file: WasmFile) => {
  const index = files.findIndex((value) => value.name === file.name);
  if (index >= 0) {
    files[index] = file;
  } else {
    files.push(file);
  }
};

const writeToFileSystem = async (
  { name, bytes }: WasmFile,
  preOpened: Map<string, FileSystemDirectoryHandle>
) => {
  let position = name.indexOf("/", 1);
  let driveName = name.substring(0, position);
  let drive = preOpened.get(driveName);
  if (!drive) {
    throw new Error(`Unable to find drive ("${driveName}") for file "${name}"`);
  }
  let fileName = name.substring(position + 1);
  const fileHandle = await drive.getFileHandle(fileName, { create: true });
  const writer = await fileHandle.createWritable();
  try {
    await writer.truncate(0);
    await writer.write(bytes);
  } finally {
    await writer.close();
  }
};
