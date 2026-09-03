import WasmTerminal from "wasm-terminal";
import type { WasmFile } from "wasm-terminal";
import { providers, setCredentials } from "./aws-providers";
import { main as awsCommand } from "./aws-command";
import { executeCoreutilsCommand } from "./coreutils-command";
import { writeFile } from "./wasi-filesystem";

export const webShell = (wasmBinaryPath: string) => {
  const preOpened: Record<string, string> = {
    "/": "/"
  };
  const wasmTerminal = new WasmTerminal(wasmBinaryPath);

  wasmTerminal.onRedirectOutput = async (path: string, data: string, append: boolean) => {
    try {
      await writeFile(preOpened["/"] ?? "/", path, new TextEncoder().encode(data), append);
    } catch (error) {
      wasmTerminal.stderr(`\x1b[1m[\x1b[31mERROR\x1b[39m]\x1b[0m Unable to write to "${path}": ${error}\n`);
    }
  };

  wasmTerminal.onActivated = async () => {

    wasmTerminal.registerJsCommand("help", async (argsv: string[]) => {
      return `
Currently available commands:

    aws        - AWS CLI (S3, SSM, STS, etc)
    coreutils  - Unix utilities (cat, ls, echo, etc.)
    help       - Show this help message

Example usage:
    # AWS S3 operations
    aws s3api list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 2 --no-sign-request

    # Save file to filesystem
    aws s3api get-object --region us-east-1 --no-sign-request --bucket pan-ukb-us-east-1 --key sumstats_release/results_full.mt/README.txt readme.txt

    # List files
    ls

    # Read a file
    cat readme.txt

A complete list of public S3 Buckets can be found at:
    https://registry.opendata.aws/
      `;
    });

    // await setCredentials();

    wasmTerminal.registerJsCommand(
      "aws",
      async (argsv: string[], stdinPreset: string | null) => {
        const envVars = {};

        try {
          await awsCommand(
            ["aws", ...argsv],
            envVars,
            stdinPreset,
            (msg: string) => wasmTerminal.stdout(msg),
            (msg: string) => wasmTerminal.stderr(msg),
            preOpened,
            providers,
          )
        } catch (error: any) {
          if ("code" in error && error.code !== 0) {
            console.debug(error);
          }
        }
        await wasmTerminal._waitForOutputPause();

        return "";
      }
    );

    // Register coreutils commands
    const createCoreutilsCommand = (commandName: string) => {
      return async (argsv: string[], stdinPreset: string | null) => {
        try {
          await executeCoreutilsCommand(
            [commandName, ...argsv],
            {},
            stdinPreset,
            (msg: string) => wasmTerminal.stdout(msg),
            (msg: string) => wasmTerminal.stderr(msg),
            preOpened,
          );
        } catch (error: any) {
          if ("code" in error && error.code !== 0) {
            console.debug(error);
          }
        }
        await wasmTerminal._waitForOutputPause();

        return "";
      };
    };

    // Register common coreutils commands
    const coreutilsCommands = [
      "arch",
      "base32",
      "base64",
      "basename",
      "basenc",
      "cat",
      "comm",
      "cp",
      "csplit",
      "cut",
      "date",
      "dd",
      "dir",
      "dircolors",
      "dirname",
      "echo",
      "expand",
      "factor",
      "false",
      "fmt",
      "fold",
      "head",
      "join",
      "link",
      "ln",
      "ls",
      "mkdir",
      "mv",
      "nl",
      "nproc",
      "numfmt",
      "od",
      "paste",
      "pathchk",
      "pr",
      "printenv",
      "printf",
      "ptx",
      "pwd",
      "readlink",
      "realpath",
      "rm",
      "rmdir",
      "seq",
      "shred",
      "shuf",
      "sleep",
      "sort",
      "split",
      "sum",
      "tail",
      "tee",
      "touch",
      "tr",
      "true",
      "truncate",
      "tsort",
      "tty",
      "uname",
      "unexpand",
      "uniq",
      "unlink",
      "vdir",
      "wc",
      "yes",
    ];

    for (const cmd of coreutilsCommands) {
      wasmTerminal.registerJsCommand(cmd, createCoreutilsCommand(cmd));
    }
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
    # List objects from Amazon S3 Bucket\r
    aws s3 ls --region us-east-2 --no-sign-request s3://nara-national-archives-catalog/authority-records/organization/\r
\r
    # Save object from S3 to in-browser filesystem\r
    aws s3 cp --region us-east-1 --no-sign-request s3://pan-ukb-us-east-1/sumstats_release/results_full.mt/README.txt readme.txt\r
      `;
    return Promise.resolve(intro);
  };

  return wasmTerminal;
};
