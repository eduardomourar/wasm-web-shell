export namespace WasiFilesystemPreopens {
  export function getDirectories(): [Descriptor, string][];
}
import type { Descriptor } from '../exports/wasi-filesystem-types';
export { Descriptor };
