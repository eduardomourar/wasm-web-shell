import { preopens, types, _clearPreopens, _addPreopenWithAdapter } from "@bytecodealliance/preview2-shim/filesystem";
import { OpfsFilesystemAdapter, loadOpfsCapability } from "@bytecodealliance/preview2-shim/opfs-filesystem";

/**
 * WASI Filesystem preopens wired to a single, shared `OpfsFilesystemAdapter`.
 *
 * The adapter keeps every guest-facing `Descriptor` operation synchronous by
 * mirroring each preopened OPFS directory into an in-memory tree on load, and
 * automatically flushing mutations back to OPFS in the background. See
 * `@bytecodealliance/preview2-shim/opfs-filesystem` for the implementation.
 */
export { preopens, types };

const adapter = new OpfsFilesystemAdapter({ lockManager: navigator.locks });

/**
 * Replace all preopens with the given set, loading each host directory from
 * the origin-private filesystem into the shared OPFS-backed adapter.
 * @param preopensConfig - Map of virtual paths to host paths
 */
export async function _setPreopens(preopensConfig: Record<string, string>): Promise<void> {
  _clearPreopens();
  const root = await navigator.storage.getDirectory();
  for (const [virtualPath, hostPreopen] of Object.entries(preopensConfig)) {
    const handle =
      hostPreopen === "/"
        ? root
        : await root.getDirectoryHandle(hostPreopen.replace(/^\//, ""), { create: true });
    const capability = await loadOpfsCapability(handle);
    _addPreopenWithAdapter(virtualPath, adapter, capability);
  }
}
