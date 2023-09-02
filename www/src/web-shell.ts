import * as Comlink from "comlink";
// @ts-ignore
import WasmWebTerm from "wasm-webterm";
import { ITerminalAddon, Terminal } from "xterm";
import { retrieveCredentials } from "./credentials";

export const webShell = (wasmBinaryPath: string) => {
  let wasmWebTerm = new WasmWebTerm(wasmBinaryPath);

  wasmWebTerm.registerJsCommand("aws", async (argsv: any[], stdinPreset: any) => {
    const credentials = retrieveCredentials();
    const worker = new Worker(new URL('./worker.mjs', import.meta.url));
    const awsCommand = Comlink.wrap(worker) as unknown as (...input: any[]) => Promise<any>;

    await awsCommand(
      argsv,
      Object.entries({
        AWS_API_KEY: credentials.apiKey,
      }),
      Comlink.proxy((_message: any) => stdinPreset),
      Comlink.proxy((message: any) => wasmWebTerm._stdout(message)),
      Comlink.proxy((message: any) => wasmWebTerm._stderr(message)),
    );

    await wasmWebTerm._waitForOutputPause();
  });

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
      "Commands: " +
      Array.from<[string]>(wasmWebTerm.jsCommands)
        .map((commandObj) => commandObj[0])
        .sort()
        .join(", ") +
      ".\r\n\r\n" +
`Example usage:\r
    aws s3 list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 5 \r
\r
A complete list of public S3 Buckets can be found here:\r
    https://registry.opendata.aws/\r
      `;
    return Promise.resolve(intro);
  };

  return wasmWebTerm;
};
