# WASI Filesystem Implementation

This module wires `wasi:filesystem` preopens to `@bytecodealliance/preview2-shim`'s
`OpfsFilesystemAdapter`, which backs the guest-facing filesystem with the
browser's Origin Private File System (OPFS).

## Architecture

```
┌─────────────────────────────────────┐
│   WASI Preview2 Component (AWS CLI) │
│   Expects: wasi:filesystem/preopens │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   wasi-filesystem.ts                │
│   Loads each preopen's OPFS         │
│   directory into the shared adapter │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   OpfsFilesystemAdapter             │
│   (preview2-shim)                   │
│   In-memory tree, synchronous       │
│   Descriptor ops, debounced flush   │
│   back to OPFS                      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   navigator.storage.getDirectory()  │
│   (Origin-Private Filesystem)       │
└─────────────────────────────────────┘
```

Every preopen is loaded once into an in-memory tree (`loadOpfsCapability`),
so guest-facing `Descriptor` operations (read, write, stat, symlink, advisory
locking, ...) stay fully synchronous. Mutations are flushed back to OPFS
automatically, debounced to a microtask.

## Interface

- `_setPreopens(preopensConfig: Record<string, string>)` - replace all
  preopens, loading each host path (relative to OPFS root) into the shared
  `OpfsFilesystemAdapter`.
- `preopens` / `types` - re-exported directly from
  `@bytecodealliance/preview2-shim/filesystem`, passed straight through to
  `initialize()`'s `filesystem` option.
- `writeFile(virtualPath, path, data, append)` - write bytes into a preopen's
  descriptor tree without going through a WASI guest. Used for shell
  redirection (`>`, `>>`) where the output is produced on the JS side.

## Usage

```typescript
import { _setPreopens, preopens, types } from "./wasi-filesystem";

await _setPreopens({ "/": "/" });
const filesystem = { preopens, types };
await initialize(providers, { filesystem, /* ... */ });
```

## Limitations

Everything not natively supported by OPFS (symlinks, advisory locking) comes
from `OpfsFilesystemAdapter` itself - see
`@bytecodealliance/preview2-shim/src/browser/opfs-filesystem.ts` for details.

OPFS itself (`navigator.storage.getDirectory()`) is broadly supported (Chrome/Edge
86+, Firefox 111+, Safari 15.2+) and is not the browser-support blocker for this
project. The actual blocker is that the generated component bindings require the
WebAssembly JS Promise Integration (JSPI) proposal (`WebAssembly.Suspending`/
`WebAssembly.promising`) to invoke async host imports without blocking - see
`web-shell.ts`'s `isJspiSupported` check. Chromium and Firefox 155+ support JSPI;
Safari does not yet (Safari Technology Preview 238+ does, behind an experimental
flag).
