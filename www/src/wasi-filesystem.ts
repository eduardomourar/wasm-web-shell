import {
  preopens,
  types,
  _clearPreopens,
  _addPreopenWithAdapter,
  _getPreopens,
} from "@bytecodealliance/preview2-shim/filesystem";
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

/**
 * Write data directly into a preopened directory's descriptor tree, bypassing
 * the WASI guest entirely. Used to implement shell redirection (`>`, `>>`)
 * for output that is captured on the JS side rather than written by a guest
 * through a WASI file descriptor. Writes land in the same in-memory tree the
 * guest sees and are flushed back to OPFS automatically by the adapter.
 *
 * @param virtualPath - The preopen's guest-visible path (as passed to `_setPreopens`)
 * @param path - Path relative to `virtualPath`
 * @param data - Bytes to write
 * @param append - When true, append to the end of the file instead of truncating it
 */
export function writeFile(virtualPath: string, path: string, data: Uint8Array, append: boolean): void {
  const entry = _getPreopens().find(([, guestPath]) => guestPath === virtualPath);
  if (!entry) {
    throw new Error(`No preopen for "${virtualPath}"`);
  }
  const [root] = entry;

  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  const fileName = segments.pop();
  if (!fileName) {
    throw new Error(`Invalid redirect path: "${path}"`);
  }

  let dir = root;
  for (const segment of segments) {
    try {
      dir.createDirectoryAt(segment);
    } catch (error) {
      if (error !== "exist") {
        throw error;
      }
    }
    dir = dir.openAt({ symlinkFollow: true }, segment, { directory: true }, {});
  }

  const file = dir.openAt({ symlinkFollow: true }, fileName, { create: true, truncate: !append }, {});
  const offset = append ? file.stat().size : BigInt(0);
  file.write(data, offset);
}
