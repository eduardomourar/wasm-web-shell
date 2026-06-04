import { WASIShim, type WASIShimConfig } from "@bytecodealliance/preview2-shim/instantiation";
import { instantiate, type ImportObject, type Root } from "../component/aws.js";

const compileCore: Parameters<typeof instantiate>[0] = async (url) => {
  return fetch(url).then(WebAssembly.compileStreaming);
};

export const initialize = async (
  credentialsProvider: ImportObject["component:aws-cli/credentials-provider"],
  config: Partial<WASIShimConfig> = {}
): Promise<Root> => {
  const limitedShim = new WASIShim(config);
  const importObject = limitedShim.getImportObject();
  return await instantiate(compileCore, {
    ...importObject,
    ["component:aws-cli/credentials-provider"]: credentialsProvider,
  } as any);
};

export * as cli from "@bytecodealliance/preview2-shim/cli";
export * as io from "@bytecodealliance/preview2-shim/io";
export * as filesystem from "@bytecodealliance/preview2-shim/filesystem";
export * as random from "@bytecodealliance/preview2-shim/random";
export * as clocks from "@bytecodealliance/preview2-shim/clocks";
export * as sockets from "@bytecodealliance/preview2-shim/sockets";
export * as http from "@bytecodealliance/preview2-shim/http";
