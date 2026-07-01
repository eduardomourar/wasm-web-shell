import { WASIShim, type WASIShimConfig } from "@bytecodealliance/preview2-shim/instantiation";
import { instantiate, type Root } from "../component/coreutils.js";

const compileCore: Parameters<typeof instantiate>[0] = async (url) => {
  return fetch(url).then(WebAssembly.compileStreaming);
};

export const initialize = async (
  config: Partial<WASIShimConfig> = {}
): Promise<Root> => {
  const shim = new WASIShim(config);
  const importObject = shim.getImportObject();
  // The shim provides WASI 0.2.x interfaces which are compatible with 0.2.9
  // We cast to 'any' to bypass version mismatch type checks
  return await instantiate(compileCore, importObject as any);
};
