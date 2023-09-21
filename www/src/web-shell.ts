import * as Comlink from "comlink";
// @ts-ignore
import WasmWebTerm from "wasm-webterm";
import {
  getOriginPrivateDirectory,
  FileSystemDirectoryHandle,
} from "native-file-system-adapter";
import { ITerminalAddon, Terminal } from "xterm";
import { retrieveCredentials } from "./credentials";
import type { main } from "./aws-command";
import { Descriptor } from "aws-cli/component/imports/wasi-filesystem-types";

interface WasmFile {
  name: string;
  timestamp: number;
  bytes: Uint8Array;
}

interface WasmModule {
  name: string;
  type: "emscripten" | "wasmer";
  module?: WebAssembly.Module;
  runtime?: Blob;
}

export const webShell = (wasmBinaryPath: string) => {
  let preOpened = new Map<string, FileSystemDirectoryHandle>();
  let wasmWebTerm = new WasmWebTerm(wasmBinaryPath);
  const wasmFiles: WasmFile[] = wasmWebTerm._wasmFsFiles;

  wasmWebTerm.onActivated = async () => {
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

    wasmWebTerm.registerJsCommand("help", (argsv: any[], stdinPreset: any) => {
      return Promise.resolve(`
  Currently available commands:
  
      aws, cat, cp, coreutils, dirname, echo, env, ls, mkdir,
      mv, printenv, printf, pwd, rm, tee, touch
      `);
    });

    wasmWebTerm.registerJsCommand(
      "aws",
      async (argsv: any[], stdinPreset: any) => {
        const credentials = retrieveCredentials();
        const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
        const awsCommand = Comlink.wrap(worker) as unknown as typeof main;

        let output = "";
        await awsCommand(
          argsv,
          Object.entries({
            AWS_API_KEY: credentials.apiKey,
          }),
          Comlink.proxy((_message: any) => {}),
          Comlink.proxy((message: any) => (output += message + "\n")),
          Comlink.proxy((message: any) => (output += message + "\n")),
          Comlink.proxy(() => {
            let directories: [Descriptor, string][] = [];
            let index = 1;
            for (const file of wasmFiles) {
              directories.push([index, file.name]);
              index++;
            }
            return directories;
          })
        );

        await wasmWebTerm._waitForOutputPause();

        worker.terminate();

        return output;
      }
    );
  };

  wasmWebTerm.onFileSystemUpdate = async (files: WasmFile[]) => {
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

  wasmWebTerm._getOrFetchWasmModule = (programName: string) => {
    return new Promise(async (resolve, reject) => {
      let wasmModule: WasmModule | undefined;
      let wasmBinary: BufferSource | undefined;
      let localBinaryFound = false;

      // check if there is an initialized module already
      wasmWebTerm._wasmModules.forEach((moduleObj: WasmModule) => {
        if (moduleObj.name == programName) wasmModule = moduleObj;
      });

      // if a module was found -> resolve
      if (wasmModule?.module instanceof WebAssembly.Module) resolve(wasmModule);
      else
        try {
          // if none is found -> initialize a new one

          // create wasm module object (to resolve and to store)
          wasmModule = { name: programName, type: "wasmer", module: undefined };

          // explanation: .lnk files can contain a different module/runtime name.
          // this enables `echo` and `ls` to both use `coreutils.wasm`, for example.

          // try to fetch .lnk file
          const linkResponse = await fetch(
            wasmWebTerm.wasmBinaryPath + "/" + programName + ".lnk"
          );
          if (linkResponse?.ok) {
            // read new program name from .lnk file
            const linkedProgramName = await linkResponse.text();
            const linkDestination =
              wasmWebTerm.wasmBinaryPath + "/" + linkedProgramName + ".wasm";

            // try to fetch the new binary
            const linkedBinaryResponse = await fetch(linkDestination);
            if (linkedBinaryResponse?.ok) {
              // read binary from response
              wasmBinary = await linkedBinaryResponse.arrayBuffer();

              // validate if linkedBinaryResponse contains a wasm binary
              if (WebAssembly.validate(wasmBinary)) {
                // local binary was found -> do not fetch wapm
                localBinaryFound = true;
              }
            }
          }

          // if none was found or it was invalid -> try for a .wasm file
          else {
            // try to fetch local wasm binaries first
            const localBinaryResponse = await fetch(
              wasmWebTerm.wasmBinaryPath + "/" + programName + ".wasm"
            );

            if (localBinaryResponse?.ok) {
              // read binary from response
              wasmBinary = await localBinaryResponse.arrayBuffer();

              // validate if linkedBinaryResponse contains a wasm binary
              if (WebAssembly.validate(wasmBinary)) {
                // local binary was found -> do not fetch wapm
                localBinaryFound = true;
              }
            }
          }

          if (!localBinaryFound || !wasmBinary) {
            return reject(
              new Error(`unable to find wasm module for command ${programName}`)
            );
          }

          // compile fetched bytes into wasm module
          wasmModule.module = await WebAssembly.compile(wasmBinary);

          // store compiled module
          wasmWebTerm._wasmModules.push(wasmModule);

          // continue execution
          resolve(wasmModule);
        } catch (e) {
          reject(e);
        }
    });
  };

  wasmWebTerm.printWelcomeMessage = () => {
    // Converted with: https://cloudapps.herokuapp.com/imagetoascii/
    let intro = `\x1b[38;2;101;79;240m
  ****************VMNNNNNNMV****************\r
  ******************IVVVVI******************\r
  ******************************************\r
  ******************************************\r
  ******************************************\r
  ******************************************\r
  **********::*****::*****::****::::********\r
  **********:..***:...***..:***..::.:*******\r
  ***********:.:*:.::.:*..:***..:**:.:******\r
  ************:...:**:...:***..::::::..*****\r
  *************:::****:::***:::******:::****\r
  ******************************************\r
\r
\x1b[37m\r`;

    intro += "WebAssembly Web Shell\r\n";
    intro += "Interact directly with AWS services in your browser.\r\n";
    intro +=
      "Source code at: https://github.com/eduardomourar/wasm-web-shell/\r\n\r\n";

    intro +=
      "Commands: " +
      Array.from<[string]>(wasmWebTerm.jsCommands)
        .map((commandObj) => commandObj[0])
        .sort()
        .join(", ") +
      ".\r\n\r\n" +
      `Example usage:\r
\r
    # To list object from Amazon S3 Bucket\r
    aws s3 list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 5\r

    # To save object from Amazon S3 Bucket to in-browser temporary file system (IndexDB)\r
    aws s3 get-object --region us-east-1 --bucket pan-ukb-us-east-1 --key sumstats_release/results_full.mt/README.txt | tee /sandbox/readme.txt\r
\r
A complete list of public S3 Buckets can be found at:\r
    https://registry.opendata.aws/\r
      `;
    return Promise.resolve(intro);
  };

  return wasmWebTerm;
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
