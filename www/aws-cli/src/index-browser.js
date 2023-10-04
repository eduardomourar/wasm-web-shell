import { WASIShim } from "@bytecodealliance/preview2-shim/instantiation";
import { instantiate } from "../component/aws.js";

/** @type { Parameters<typeof import("../component/aws").instantiate>[0] } */
const compileCore = async(url, _imports) => {
  return fetch(url).then(WebAssembly.compileStreaming);
};

const initialize = async (credentialsProvider, config = {}) => {
  const limitedShim = new WASIShim(config);
  const importObject = limitedShim.getImportObject();
  return await instantiate(compileCore, {
    ...importObject,
    ["component:aws-cli/credentials-provider"]: credentialsProvider,
  });
};

export { initialize };

export * as cli from "@bytecodealliance/preview2-shim/cli";
export * as filesystem from "@bytecodealliance/preview2-shim/filesystem";
export * as io from "@bytecodealliance/preview2-shim/io";
export * as random from "@bytecodealliance/preview2-shim/random";
export * as clocks from "@bytecodealliance/preview2-shim/clocks";
export * as sockets from "@bytecodealliance/preview2-shim/sockets";
export * as http from "@bytecodealliance/preview2-shim/http";
