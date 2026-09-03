import { WASIShim } from "@bytecodealliance/preview2-shim/instantiation";
import { instantiate, type ImportObject, type Root } from "../component/aws.js";

type WASIShimConfig = NonNullable<ConstructorParameters<typeof WASIShim>[0]>;

const compileCore: Parameters<typeof instantiate>[0] = async (url) => {
  return fetch(url).then(WebAssembly.compileStreaming);
};

export const initialize = async (
  providers: ImportObject["component:aws-cli/providers"],
  config: Partial<WASIShimConfig> = {}
): Promise<Root> => {
  const limitedShim = new WASIShim(config);
  const importObject = limitedShim.getImportObject();
  return await instantiate(compileCore, {
    ...importObject,
    ["component:aws-cli/providers"]: providers,
  } as any);
};
