# WASI Filesystem Implementation

This module provides a WASI filesystem implementation backed by the browser's native FileSystem API.

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
│   Custom Descriptor implementation  │
│   wrapping FileSystemHandles        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   FileSystem API                    │
│   navigator.storage.getDirectory()  │
│   (Origin-Private Filesystem)       │
└─────────────────────────────────────┘
```

**Note:** This is a hybrid implementation that combines lazy loading with in-memory caching. Files are loaded on-demand when first accessed and cached for subsequent synchronous reads. All writes go directly to persistent storage.

## Interface

### `createFilesystemPreopens(preopens: Map<string, FileSystemDirectoryHandle>)`

Creates WASI filesystem preopens backed by browser FileSystemDirectoryHandles.

**Parameters:**
- `preopens: Map<string, FileSystemDirectoryHandle>` - Map of virtual paths to browser FileSystemDirectoryHandles

**Returns:** Object with:
- `getDirectories()` - Returns array of [Descriptor, path] tuples for WASI preopens

**Behavior:**
- Each FileSystemDirectoryHandle is wrapped in a custom Descriptor class
- Descriptors implement full WASI filesystem interface
- All file operations go directly to the FileSystem API

**Persistence:**
- All changes are immediately persisted to browser's origin-private filesystem
- No sync required - writes go directly through FileSystem API
- Files persist across browser sessions automatically

## Usage Example

### Setup in web-shell.ts

```typescript
// Use native FileSystem API (Chromium-based browsers)
const preOpened = new Map<string, FileSystemDirectoryHandle>();

preOpened.set(
  "/sandbox",
  await navigator.storage.getDirectory()
);
```

### Integration in aws-command.ts

```typescript
import { filesystem } from "@bytecodealliance/preview2-shim";
import { createFilesystemPreopens } from "./wasi-filesystem";

// Convert browser FileSystemHandles to preview2-shim fileData structure
const filesystemPreopens = await createFilesystemPreopens(preopens);

// Extend default filesystem with browser-backed preopens
const customFilesystem = {
  ...filesystem,
  preopens: {
    getDirectories: () => filesystemPreopens.getDirectories(),
  },
};

await initialize(credentialsProvider, {
  filesystem: customFilesystem,
  // ... other config
});
```

### Using from AWS CLI

The AWS CLI WASM component can now access files in the origin-private filesystem:

```bash
# Single preopen example - files at root level
ls                    # Lists files from origin-private filesystem
cat file.txt          # Reads file

# Save from S3 to filesystem
aws s3 get-object --bucket my-bucket --key data.json --output /data.json

# The file is persisted in the browser's origin-private filesystem
```

## Key Features

1. **Browser-native API** - Uses FileSystem API, no polyfills or adapters
2. **Persistent storage** - Files persist in origin-private filesystem across sessions
3. **Standard WASI interface** - Works with any WASI Preview2 component
4. **Type-safe** - Full TypeScript support
5. **Component Model compliant** - Uses preview2-shim's resource management

## Limitations

1. **Browser compatibility** - Requires Chromium-based browsers (Chrome, Edge, Opera, Brave)
   - Safari: Limited FileSystem API support
   - Firefox: No FileSystem API support
2. **Memory usage** - Accessed files cached in memory for synchronous reads
   - Cache persists for session duration
   - Large files consume memory once accessed
3. **Storage quotas** - Subject to browser storage limits (typically 10-50% of free disk space)
4. **Security restrictions** - Subject to same-origin policy and browser permissions
5. **Cache coherency** - External changes to files not automatically detected
   - lastModified checks on re-access only

## Async Stream Operations

The implementation leverages async operations for both read and write streams, even though the WASI interface specifies synchronous methods. The preview2-shim supports async handlers:

**Async Reads (`blockingRead`):**
- On-demand loading: Files loaded from storage only when first read
- Smart caching: Small files (< 5MB) cached entirely, large files chunked (1MB chunks)
- No upfront loading: `openAt` no longer pre-loads files, improving open performance
- Progressive streaming: Large files stream chunk-by-chunk as they're read

**Async Writes (`blockingFlush`):**
- Explicit flush: WASI components call `blockingFlush()` when ready to persist
- Buffered writes: Multiple writes batched before flush
- Merge strategy: Existing content + new writes + trailing content merged efficiently
- Immediate persistence: All flushes write directly to FileSystem API

**Stream Tracking:**
- All active write streams tracked with unique IDs (`${path}@${timestamp}`)
- Streams marked as closed after successful flush
- Use `getActiveWriteStreams()` to detect leaked streams
- Use `checkForLeakedStreams()` to warn about unclosed streams

## Advanced Features

### Symbolic Links

The implementation emulates symbolic links in memory (FileSystem API doesn't support symlinks natively):

**Creating symlinks:**
```typescript
// Create a symlink
descriptor.symlinkAt("target/path.txt", "link-name.txt");
```

**Reading symlinks:**
```typescript
// Read symlink target
const target = descriptor.readlinkAt("link-name.txt");
console.log(`Points to: ${target}`);
```

**Symlink following:**
- `openAt` automatically follows symlinks unless `pathFlags.symlinkFollow === false`
- `statAt` can stat symlink itself or its target based on flags

**Diagnostics:**
```typescript
import { getSymlinks, clearSymlinks, getSymlink } from './wasi-filesystem';

// List all symlinks
console.log(getSymlinks());
// [{ path: "/link.txt", target: "/file.txt" }]

// Get specific symlink
console.log(getSymlink("/link.txt"));
// "/file.txt"
```

### File Locking

File locking system using Web Locks API (`navigator.locks`):

**Implementation:**
- Uses Web Locks API for proper resource locking
- Supports both exclusive and shared locks natively
- Main thread compatible
- Locks held until explicitly released via `advise(..., "dontneed")`
- Standard browser API with wide support (Chrome 69+, Edge 79+, Safari 15.4+)

**Request locks:**
```typescript
// Exclusive lock
descriptor.advise(0n, 1000n, "exclusive");

// Shared lock (allows multiple readers)
descriptor.advise(0n, 1000n, "shared");

// Release lock
descriptor.advise(0n, 1000n, "dontneed");
```

**Lock types:**
- `exclusive` / `will-need` - Exclusive lock (only one holder, blocks all others)
- `shared` / `sequential` - Shared lock (multiple readers allowed, blocks exclusive)
- `dontneed` / `noreuse` - Release locks

**Diagnostics:**
```typescript
import { getFileLocks, isFileLocked, clearFileLocks } from './wasi-filesystem';

// List all locked files
console.log(getFileLocks());
// [{ key: "/file.txt", path: "/file.txt", mode: "exclusive", timestamp: 1234567890 }]

// Check if file is locked
console.log(isFileLocked("/file.txt"));
// { locked: true, mode: "exclusive", timestamp: 1234567890 }
// or for shared locks:
// { locked: true, mode: "shared", count: 2, timestamps: [1234567890, 1234567891] }
```

### Rename/Move Operations

Move or rename files and directories:

**Usage:**
```typescript
// Rename file in same directory
oldDir.renameAt("oldname.txt", oldDir, "newname.txt");

// Move to different directory
oldDir.renameAt("file.txt", newDir, "moved-file.txt");

// Move directory
oldDir.renameAt("old-dir", newDir, "new-dir");
```

**Implementation:**
- Uses native `move()` API when available (Chrome 108+)
- Falls back to copy+delete for older browsers
- Recursively copies directories
- Updates cache and symlink references

### File Size Operations

Truncate or extend files:

**Usage:**
```typescript
// Truncate file to 100 bytes
descriptor.setSize(100n);

// Extend file to 1000 bytes (zero-filled)
descriptor.setSize(1000n);
```

## Debugging

The filesystem implementation includes comprehensive logging for debugging:

**Write Operations:**
All write operations are logged with `console.debug`:
- Stream creation with unique ID
- Buffer writes to pending queue
- Auto-flush trigger events
- Manual flush operations with byte counts
- Content merging (existing + new + trailing)
- Filesystem write status
- Cache updates
- Stream closure

**Enable Logging:**
Open browser console and filter for `[writeViaStream]`, `[Descriptor]`, or `[Cache]` to see detailed operation logs.

**Diagnostic Functions:**
```typescript
import {
  getCacheStats,
  clearCache,
  getActiveWriteStreams,
  checkForLeakedStreams,
  getSymlinks,
  clearSymlinks,
  getSymlink,
  getFileLocks,
  isFileLocked,
  clearFileLocks,
} from './wasi-filesystem';

// Cache diagnostics
console.log(getCacheStats());
// { totalSize: 12345, fullFileCount: 3, chunkedFileCount: 0, maxSize: 104857600, utilizationPercent: 0.01 }
clearCache(); // Clear all cached data

// Stream diagnostics
console.log(getActiveWriteStreams());
// ["/test.txt@1234567890"]
checkForLeakedStreams();
// Logs warning if any streams are still active

// Symlink diagnostics
console.log(getSymlinks());
// [{ path: "/link.txt", target: "/target.txt" }]
console.log(getSymlink("/link.txt"));
// "/target.txt"
clearSymlinks(); // Remove all symlinks

// Lock diagnostics
console.log(getFileLocks());
// [{ path: "/file.txt", exclusive: true, count: 1, timestamp: 1234567890 }]
console.log(isFileLocked("/file.txt"));
// { locked: true, exclusive: true, count: 1, timestamp: 1234567890 }
clearFileLocks(); // Release all locks
```

**Common Issues:**
1. **Files not saving** - Check console for:
   - `[writeViaStream.autoFlush]` - Auto-flush should trigger after 50ms
   - `[writeViaStream.flush]` - Manual flush events
   - Stream ID closure messages
2. **Content corruption** - Look for merge operation logs showing offset calculations
3. **Cache misses** - Check `[Cache]` logs for eviction messages
4. **Leaked streams** - Run `checkForLeakedStreams()` to detect streams that never flushed

## Implementation Details

### Custom Descriptor Class

The `FileSystemDescriptor` class wraps browser `FileSystemFileHandle` and `FileSystemDirectoryHandle` objects and implements the full WASI filesystem interface:

**Key Methods:**
- `readViaStream(offset)` - Creates input stream for reading files
- `writeViaStream(offset)` - Creates output stream for writing files
- `appendViaStream()` - Creates output stream for appending
- `stat()` / `statAt(path)` - Get file/directory metadata
- `openAt(path, openFlags, flags)` - Open files/directories at path
- `readDirectory()` - List directory contents
- `createDirectoryAt(path)` - Create directories
- `unlinkFileAt(path)` / `removeDirectoryAt(path)` - Delete files/directories

**Stream Implementation:**
- Input streams use `FileSystemFileHandle.getFile()` + `Blob.slice()` for reading
- Output streams use `FileSystemFileHandle.createWritable()` for writing
- Streams created via `inputStreamCreate()` and `outputStreamCreate()` from preview2-shim

### Hybrid Approach: Lazy Loading + Caching

The implementation uses a hybrid approach to bridge the async FileSystem API with WASI's synchronous interface:

**On Read:**
1. File accessed → Check cache
2. Cache miss → Load file from storage via `getFile()` + `arrayBuffer()`
3. Store in memory cache with lastModified timestamp
4. Subsequent reads use cached data (synchronous)

**On Write:**
1. Writes buffered in memory
2. On flush → Merge with existing content
3. Write complete file to storage via `createWritable()`
4. Update cache with new content

**Benefits:**
- Lazy loading - files only loaded when accessed
- Synchronous reads after initial load (required by WASI)
- All writes persisted immediately to storage
- Cache invalidation via lastModified checks

## Cache Management

The implementation includes a smart caching system with LRU (Least Recently Used) eviction:

**Configuration:**
```typescript
const CACHE_CONFIG = {
  maxTotalSize: 100 * 1024 * 1024,     // 100MB total cache size
  maxFileSize: 10 * 1024 * 1024,       // 10MB per file before chunking
  chunkSize: 1024 * 1024,              // 1MB chunks for large files
  streamingThreshold: 5 * 1024 * 1024, // 5MB - files above this use streaming
};
```

**Cache Types:**
- **Full File Cache** - Files smaller than streamingThreshold (5MB) are cached completely
- **Chunked File Cache** - Large files prepared for chunked access (foundation for future streaming)

**Eviction Strategy:**
- When cache exceeds `maxTotalSize` (100MB), least recently used entries are evicted
- Tracks `lastAccessed` timestamp for each entry
- Evicts across both full and chunked caches

**Cache Statistics:**
```typescript
import { getCacheStats, clearCache } from "./wasi-filesystem";

const stats = getCacheStats();
// Returns: { totalSize, fullFileCount, chunkedFileCount, maxSize, utilizationPercent }

clearCache(); // Clear entire cache
```

## Performance Considerations

**Read Performance:**
- **On-demand loading** - Files loaded from storage only when first read (not at `openAt`)
- **First read latency** - Async load from storage (small files: ~10-50ms, chunks: ~5-20ms)
- **Subsequent reads** - Fast cache access (<1ms)
- **Memory efficiency** - Only accessed portions of large files cached
- **Progressive streaming** - Large files don't block on full load

**Write Performance:**
- **Buffered writes** - Multiple writes batched in memory
- **Flush latency** - Single flush writes entire file (~20-100ms depending on size)
- **Merge overhead** - Existing + new + trailing content merged in memory
- **Immediate persistence** - All flushes write directly to storage

**Cache Management:**
- **LRU eviction** - Automatic eviction when cache exceeds 100MB
- **Smart thresholds** - Files < 5MB cached fully, larger files chunked
- **Memory bounds** - Total cache never exceeds 100MB
- **Chunk granularity** - 1MB chunks balance memory and read performance

**Initialization:**
- **Fast opens** - `openAt` only creates descriptors (no I/O)
- **Optional pre-warming** - Can pre-cache small files for first-read performance
- **Directory listing** - Lists entries without loading file contents

## Future Enhancements

Possible improvements:

- [x] **Hybrid lazy loading** - Files loaded on-demand, cached for synchronous access
  - ✅ Implemented with cache invalidation via lastModified
  - ✅ Balances memory efficiency with WASI synchronous requirements
- [x] **Immediate persistence** - All writes flushed to storage
  - ✅ Implemented via FileSystemWritableFileStream
- [x] **Cache management** - Smart cache eviction for large files
  - ✅ LRU eviction when cache size exceeds threshold (100MB default)
  - ✅ Configurable cache size limits via CACHE_CONFIG
  - ✅ Cache statistics tracking (size, file count, utilization)
  - ✅ Separate full file and chunked file caches
- [x] **Enhanced write debugging** - Comprehensive logging for write operations
  - ✅ Detailed console.debug logging at each step
  - ✅ Buffer tracking and flush monitoring
  - ✅ Cache update verification
  - ✅ Stream lifecycle tracking with unique IDs
  - ✅ Leaked stream detection
- [x] **Async blockingFlush** - Direct flush calls from WASI components
  - ✅ Explicit flush properly invoked by preview2-shim
  - ✅ No auto-flush fallback needed
  - ✅ Proper async/await for FileSystem API operations
- [x] **Streaming reads with async blockingRead** - True on-demand loading
  - ✅ Files loaded from storage only when first read
  - ✅ Small files (< 5MB) cached entirely on first read
  - ✅ Large files streamed in 1MB chunks
  - ✅ No upfront loading - lazy loading for all files
  - ✅ Chunk-level caching with LRU eviction
  - ✅ Proper EOF handling for both cached and streaming files
- [x] **Symbolic links** - In-memory symlink emulation
  - ✅ `symlinkAt` - Create symbolic links
  - ✅ `readlinkAt` - Read symlink targets
  - ✅ Symlink following in `openAt` and `statAt`
  - ✅ PathFlags support for `symlinkFollow` flag
  - ✅ Symlink diagnostics and management functions
- [x] **File locking** - Web Locks API implementation
  - ✅ `advise` - Request exclusive/shared locks via `navigator.locks`
  - ✅ Native support for both exclusive and shared locks
  - ✅ Main thread compatible
  - ✅ Lock tracking per file path
  - ✅ Lock diagnostics and management
  - ✅ Lock enforcement in `setSize`
  - ✅ Standard browser API (Chrome 69+, Edge 79+, Safari 15.4+)
- [x] **Rename/move operations** - Full file and directory moves
  - ✅ `renameAt` - Rename or move files/directories
  - ✅ Native `move()` API when available (Chrome 108+)
  - ✅ Fallback copy+delete for older browsers
  - ✅ Recursive directory copy support
  - ✅ Cache and symlink updates on rename
- [x] **File size operations** - Truncate and extend files
  - ✅ `setSize` - Set file size (truncate/extend)
  - ✅ Cache updates on resize
  - ✅ Zero-fill when extending files
