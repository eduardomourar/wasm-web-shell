import { WASIShim, type WASIShimConfig } from "@bytecodealliance/preview2-shim/instantiation";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiate, type Root } from "../component/coreutils.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const compileCore: Parameters<typeof instantiate>[0] = async (url) => {
  const fullPath = path.resolve(dirname, "../component", url);
  const bytes = await fs.readFile(fullPath);
  return WebAssembly.compile(bytes);
};

export const initialize = async (
  config: Partial<WASIShimConfig> = {}
): Promise<Root> => {
  config.sandbox = {
    preopens: {
      "/tmp": "/tmp",
    },
    env: {},
    args: [
      "ls",
      "-la",
      "/tmp"
    ],
    enableNetwork: false,
    ...config.sandbox,
  };

  const wasiShim = new WASIShim(config);
  const importObject = wasiShim.getImportObject();
  return await instantiate(compileCore, importObject as any);
};

const command = await initialize();
await command.run.run();
