import type {
  Descriptor as IDescriptor,
  DescriptorFlags,
  DescriptorStat,
  DirectoryEntryStream as IDirectoryEntryStream,
  Filesize,
  OpenFlags,
  PathFlags,
  DescriptorType,
  DirectoryEntry,
  Error as IoError,
  ErrorCode,
} from "@bytecodealliance/preview2-shim/interfaces/wasi-filesystem-types";
import { inputStreamCreate, outputStreamCreate } from "@bytecodealliance/preview2-shim/io";

/**
 * WASI Filesystem implementation using native File System API with smart caching
 * Provides wasi:filesystem/preopens interface backed by browser FileSystemHandles
 */

const timeZero = {
  seconds: BigInt(0),
  nanoseconds: 0,
};

class FsError extends Error {
  fsError = true;
  payload: ErrorCode;

  constructor(payload: ErrorCode) {
    super(payload);
    this.payload = payload;
  }
}

/**
 * Configuration for cache management
 */
const CACHE_CONFIG = {
  maxTotalSize: 100 * 1024 * 1024, // 100MB total cache size
  maxFileSize: 10 * 1024 * 1024,   // 10MB per file before chunking
  chunkSize: 1024 * 1024,          // 1MB chunks for large files
  streamingThreshold: 5 * 1024 * 1024, // 5MB - files above this use streaming
};

/**
 * Cache entry for file data
 */
interface CacheEntry {
  data: Uint8Array;
  lastModified: number;
  lastAccessed: number;
  size: number;
}

/**
 * Cache entry for file chunks (for large files)
 */
interface ChunkCacheEntry {
  chunks: Map<number, Uint8Array>; // chunk index -> data
  fileSize: number;
  lastModified: number;
  lastAccessed: number;
}

/**
 * Smart cache with LRU eviction
 */
class FileCache {
  private fullFileCache = new Map<string, CacheEntry>();
  private chunkedFileCache = new Map<string, ChunkCacheEntry>();
  private currentSize = 0;

  /**
   * Get full file from cache
   */
  get(path: string): Uint8Array | null {
    const entry = this.fullFileCache.get(path);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.data;
    }
    return null;
  }

  /**
   * Set full file in cache
   */
  set(path: string, data: Uint8Array, lastModified: number): void {
    const size = data.byteLength;

    // Remove old entry if exists
    this.delete(path);

    // Evict entries if needed
    while (this.currentSize + size > CACHE_CONFIG.maxTotalSize && this.fullFileCache.size > 0) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry = {
      data,
      lastModified,
      lastAccessed: Date.now(),
      size,
    };
    this.fullFileCache.set(path, entry);
    this.currentSize += size;

    // console.debug(`[wasi:filesystem Cache] Added file "${path}" (${(size / 1024).toFixed(2)}KB), total: ${(this.currentSize / 1024 / 1024).toFixed(2)}MB`);
  }

  /**
   * Get chunk from cache
   */
  getChunk(path: string, chunkIndex: number): Uint8Array | null {
    const entry = this.chunkedFileCache.get(path);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.chunks.get(chunkIndex) || null;
    }
    return null;
  }

  /**
   * Set chunk in cache
   */
  setChunk(path: string, chunkIndex: number, data: Uint8Array, fileSize: number, lastModified: number): void {
    let entry = this.chunkedFileCache.get(path);
    if (!entry) {
      entry = {
        chunks: new Map(),
        fileSize,
        lastModified,
        lastAccessed: Date.now(),
      };
      this.chunkedFileCache.set(path, entry);
    }

    // Evict if needed
    while (this.currentSize + data.byteLength > CACHE_CONFIG.maxTotalSize && this.hasEvictableEntries()) {
      this.evictLRU();
    }

    entry.chunks.set(chunkIndex, data);
    entry.lastAccessed = Date.now();
    this.currentSize += data.byteLength;
  }

  /**
   * Delete entry from cache
   */
  delete(path: string): void {
    const fullEntry = this.fullFileCache.get(path);
    if (fullEntry) {
      this.currentSize -= fullEntry.size;
      this.fullFileCache.delete(path);
      // console.debug(`[wasi:filesystem Cache] Evicted file "${path}" (${(fullEntry.size / 1024).toFixed(2)}KB)`);
      return;
    }

    const chunkedEntry = this.chunkedFileCache.get(path);
    if (chunkedEntry) {
      for (const chunk of chunkedEntry.chunks.values()) {
        this.currentSize -= chunk.byteLength;
      }
      this.chunkedFileCache.delete(path);
      // console.debug(`[wasi:filesystem Cache] Evicted chunked file "${path}"`);
    }
  }

  /**
   * Check if cache has evictable entries
   */
  private hasEvictableEntries(): boolean {
    return this.fullFileCache.size > 0 || this.chunkedFileCache.size > 0;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestPath: string | null = null;
    let oldestTime = Date.now();

    // Check full file cache
    for (const [path, entry] of this.fullFileCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestPath = path;
      }
    }

    // Check chunked file cache
    for (const [path, entry] of this.chunkedFileCache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestPath = path;
      }
    }

    if (oldestPath) {
      this.delete(oldestPath);
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.fullFileCache.clear();
    this.chunkedFileCache.clear();
    this.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      totalSize: this.currentSize,
      fullFileCount: this.fullFileCache.size,
      chunkedFileCount: this.chunkedFileCache.size,
      maxSize: CACHE_CONFIG.maxTotalSize,
      utilizationPercent: (this.currentSize / CACHE_CONFIG.maxTotalSize) * 100,
    };
  }
}

const fileCache = new FileCache();

// Track active write streams for debugging
const activeWriteStreams = new Set<string>();

/**
 * Symbolic link storage (in-memory emulation)
 * Maps symlink path -> target path
 */
const symlinks = new Map<string, string>();

/**
 * File locking system using Web Locks API (navigator.locks)
 * Supports both exclusive and shared locks
 * Maps file path -> lock metadata
 */
interface FileLock {
  mode: "exclusive" | "shared";
  timestamp: number;
  path: string;
  release: () => void;
}
const fileLocks = new Map<string, FileLock>();

/**
 * Metadata storage for timestamps (in-memory)
 * Maps file path -> custom metadata
 */
interface FileMetadata {
  accessTime?: number;
  modificationTime?: number;
  changeTime?: number;
}
const fileMetadata = new Map<string, FileMetadata>();

type FileSystemHandleType = FileSystemDirectoryHandle | FileSystemFileHandle;

/**
 * Directory entry stream for iterating directory contents
 */
class DirectoryEntryStream implements IDirectoryEntryStream {
  private readonly entries: DirectoryEntry[];
  private idx = 0;

  constructor(entries: DirectoryEntry[]) {
    this.entries = entries;
  }

  readDirectoryEntry(): DirectoryEntry | undefined {
    if (this.idx === this.entries.length) {
      return undefined;
    }
    const entry = this.entries[this.idx];
    this.idx += 1;
    return entry;
  }
}

/**
 * Custom Descriptor implementation backed by File System API
 * Uses smart caching with LRU eviction and chunked streaming for large files
 */
class Descriptor implements IDescriptor {
  #handle!: FileSystemHandleType;
  #kind!: "file" | "directory";
  #path!: string;

  static _create(handle: FileSystemHandleType, path: string) {
    const descriptor = new Descriptor();
    descriptor.#handle = handle;
    descriptor.#kind = handle.kind;
    descriptor.#path = path;
    return descriptor;
  }

  get handle() {
    return this.#handle;
  }

  /**
   * Pre-warm cache for small files (optional optimization)
   * With async blockingRead, this is no longer required but improves first-read performance
   */
  private async prewarmCache(): Promise<void> {
    if (this.#kind !== "file") {
      return;
    }

    const fileHandle = this.#handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();

    // Check if already cached
    const cached = fileCache.get(this.#path);
    if (cached) {
      // console.debug(`[wasi:filesystem Descriptor] File "${this.#path}" already in cache`);
      return;
    }

    // Only pre-cache small files
    if (file.size < CACHE_CONFIG.streamingThreshold) {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      fileCache.set(this.#path, data, file.lastModified);
      // console.debug(`[wasi:filesystem Descriptor] Pre-cached file "${this.#path}" (${(file.size / 1024).toFixed(2)}KB)`);
    } else {
      // console.debug(`[wasi:filesystem Descriptor] Skipping pre-cache for large file "${this.#path}" (${(file.size / 1024 / 1024).toFixed(2)}MB) - will stream on-demand`);
    }
  }

  readViaStream(offset: Filesize): any {
    if (this.#kind !== "file") {
      throw new FsError("bad-descriptor");
    }

    const path = this.#path;
    const fileHandle = this.#handle as FileSystemFileHandle;
    let currentOffset = Number(offset);
    let fileSize: number | null = null;

    return inputStreamCreate({
      // @ts-expect-error WASI interface expects sync Uint8Array, but preview2-shim supports async Promise<Uint8Array>
      async blockingRead(len: bigint): Promise<Uint8Array> {
        // console.debug(`[wasi:filesystem blockingRead] Reading ${len} bytes from "${path}" at offset ${currentOffset}`);

        // Try full file cache first (for small files)
        const cached = fileCache.get(path);
        if (cached) {
          if (currentOffset >= cached.byteLength) {
            // console.debug(`[wasi:filesystem blockingRead] EOF reached (cached), offset=${currentOffset}, size=${cached.byteLength}`);
            throw { tag: "closed" };
          }
          const endOffset = Math.min(currentOffset + Number(len), cached.byteLength);
          const bytes = new Uint8Array(cached.buffer, cached.byteOffset + currentOffset, endOffset - currentOffset);
          // console.debug(`[wasi:filesystem blockingRead] Read ${bytes.byteLength} bytes from cache`);
          currentOffset = endOffset;
          return bytes;
        }

        // File not in cache - load on demand
        // console.debug(`[wasi:filesystem blockingRead] File not in cache, loading from storage`);

        // Get file metadata if we don't have it yet
        if (fileSize === null) {
          const file = await fileHandle.getFile();
          fileSize = file.size;
          // console.debug(`[wasi:filesystem blockingRead] File size: ${fileSize} bytes`);
        }

        // Check if we're past EOF
        if (currentOffset >= fileSize) {
          // console.debug(`[wasi:filesystem blockingRead] EOF reached, offset=${currentOffset}, size=${fileSize}`);
          throw { tag: "closed" };
        }

        // Determine if we should load the whole file or just a chunk
        if (fileSize < CACHE_CONFIG.streamingThreshold) {
          // Small file - load entirely and cache
          // console.debug(`[wasi:filesystem blockingRead] Loading entire small file (${(fileSize / 1024).toFixed(2)}KB)`);
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();
          const data = new Uint8Array(buffer);
          fileCache.set(path, data, file.lastModified);

          // Now serve from cache
          const endOffset = Math.min(currentOffset + Number(len), data.byteLength);
          const bytes = new Uint8Array(data.buffer, data.byteOffset + currentOffset, endOffset - currentOffset);
          // console.debug(`[wasi:filesystem blockingRead] Read ${bytes.byteLength} bytes from newly cached file`);
          currentOffset = endOffset;
          return bytes;
        } else {
          // Large file - use chunked reading
          const chunkIndex = Math.floor(currentOffset / CACHE_CONFIG.chunkSize);
          // console.debug(`[wasi:filesystem blockingRead] Large file, loading chunk ${chunkIndex}`);

          // Check if chunk is cached
          let chunk = fileCache.getChunk(path, chunkIndex);
          if (!chunk) {
            // Load chunk from storage
            const file = await fileHandle.getFile();
            const chunkStart = chunkIndex * CACHE_CONFIG.chunkSize;
            const chunkEnd = Math.min(chunkStart + CACHE_CONFIG.chunkSize, file.size);
            const blob = file.slice(chunkStart, chunkEnd);
            const buffer = await blob.arrayBuffer();
            chunk = new Uint8Array(buffer);
            fileCache.setChunk(path, chunkIndex, chunk, file.size, file.lastModified);
            // console.debug(`[wasi:filesystem blockingRead] Loaded chunk ${chunkIndex} (${(chunk.byteLength / 1024).toFixed(2)}KB)`);
          }

          // Calculate offset within chunk
          const chunkStart = chunkIndex * CACHE_CONFIG.chunkSize;
          const offsetInChunk = currentOffset - chunkStart;
          const availableInChunk = chunk.byteLength - offsetInChunk;
          const bytesToRead = Math.min(Number(len), availableInChunk, fileSize - currentOffset);

          const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset + offsetInChunk, bytesToRead);
          // console.debug(`[wasi:filesystem blockingRead] Read ${bytes.byteLength} bytes from chunk ${chunkIndex}`);
          currentOffset += bytesToRead;
          return bytes;
        }
      },
    });
  }

  writeViaStream(offset: Filesize): any {
    if (this.#kind === "directory") {
      throw new FsError("is-directory");
    } else if (this.#kind !== "file") {
      throw new FsError("bad-descriptor");
    }

    const fileHandle = this.#handle as FileSystemFileHandle;
    const path = this.#path;
    let pendingWrites: Uint8Array[] = [];
    const writeOffset = Number(offset);
    let isFlushPending = false;
    const streamId = `${path}@${Date.now()}`;

    activeWriteStreams.add(streamId);
    // console.debug(`[wasi:filesystem writeViaStream] Starting write to "${path}" at offset=${writeOffset}, streamId=${streamId}`);

    const handler = {
      write(buf: Uint8Array): void {
        // console.debug(`[wasi:filesystem writeViaStream.write] Writing ${buf.byteLength} bytes to buffer`);
        pendingWrites.push(new Uint8Array(buf));
      },

      checkWrite(_len?: bigint): bigint {
        return BigInt(1_000_000);
      },

      async blockingFlush(): Promise<void> {
        if (pendingWrites.length === 0) {
          // console.debug(`[wasi:filesystem writeViaStream.flush] No pending writes`);
          return;
        }

        if (isFlushPending) {
          // console.debug(`[wasi:filesystem writeViaStream.flush] Flush already pending, skipping`);
          return;
        }

        isFlushPending = true;
        // console.debug(`[wasi:filesystem writeViaStream.flush] Flushing ${pendingWrites.length} buffered writes to "${path}"`);

        try {
          // Calculate total write size
          const totalWriteSize = pendingWrites.reduce((sum, buf) => sum + buf.byteLength, 0);
          // console.debug(`[wasi:filesystem writeViaStream.flush] Total write size: ${totalWriteSize} bytes at offset ${writeOffset}`);

          // Load current file content if needed
          let currentContent = new Uint8Array(0);

          // Check cache first
          const cached = fileCache.get(path);
          if (cached) {
            // console.debug(`[wasi:filesystem writeViaStream.flush] Using cached content (${cached.byteLength} bytes)`);
            currentContent = new Uint8Array(cached);
          } else {
            // Try to load from filesystem
            try {
              const file = await fileHandle.getFile();
              const buffer = await file.arrayBuffer();
              currentContent = new Uint8Array(buffer);
              // console.debug(`[wasi:filesystem writeViaStream.flush] Loaded existing file content (${currentContent.byteLength} bytes)`);
            } catch (err: any) {
              // console.debug(`[wasi:filesystem writeViaStream.flush] No existing file, creating new (${err.message})`);
            }
          }

          // Determine final file size
          const finalSize = Math.max(currentContent.byteLength, writeOffset + totalWriteSize);
          const newContent = new Uint8Array(finalSize);

          // Copy existing content up to write offset
          if (currentContent.byteLength > 0) {
            const copySize = Math.min(currentContent.byteLength, writeOffset);
            newContent.set(currentContent.slice(0, copySize), 0);
            // console.debug(`[wasi:filesystem writeViaStream.flush] Copied ${copySize} bytes of existing content`);
          }

          // Write new data at offset
          let offset = writeOffset;
          for (const buf of pendingWrites) {
            newContent.set(buf, offset);
            offset += buf.byteLength;
          }
          // console.debug(`[wasi:filesystem writeViaStream.flush] Wrote ${totalWriteSize} bytes at offset ${writeOffset}`);

          // Copy any remaining content after the write
          if (writeOffset + totalWriteSize < currentContent.byteLength) {
            const remainingSize = currentContent.byteLength - (writeOffset + totalWriteSize);
            newContent.set(
              currentContent.slice(writeOffset + totalWriteSize),
              writeOffset + totalWriteSize
            );
            // console.debug(`[wasi:filesystem writeViaStream.flush] Copied ${remainingSize} bytes of trailing content`);
          }

          // Write to filesystem
          // console.debug(`[wasi:filesystem writeViaStream.flush] Writing ${newContent.byteLength} bytes to filesystem`);
          const writable = await fileHandle.createWritable();
          await writable.write(newContent);
          await writable.close();
          // console.debug(`[wasi:filesystem writeViaStream.flush] Write complete`);

          // Update cache
          fileCache.set(path, newContent, Date.now());
          // console.debug(`[wasi:filesystem writeViaStream.flush] Cache updated`);

          pendingWrites = [];
          isFlushPending = false;

          // Mark stream as successfully flushed
          activeWriteStreams.delete(streamId);
          // console.debug(`[wasi:filesystem writeViaStream.flush] Stream ${streamId} completed and closed`);
        } catch (err: any) {
          // console.debug(`[wasi:filesystem writeViaStream.flush] Error writing file:`, err);
          isFlushPending = false;
          throw new FsError("io");
        }
      },

      async blockingWriteAndFlush(buf: Uint8Array): Promise<void> {
        // console.debug(`[wasi:filesystem writeViaStream.blockingWriteAndFlush] Writing and flushing ${buf.byteLength} bytes`);
        handler.write(buf);
        await handler.blockingFlush();
      },
    };

    return outputStreamCreate(handler);
  }

  // @ts-expect-error Needs to be asynchronous
  async appendViaStream(): Promise<any> {
    const stat = await this.stat();
    return this.writeViaStream(stat.size);
  }

  getFlags(): DescriptorFlags {
    return {
      read: true,
      write: true,
      fileIntegritySync: false,
      dataIntegritySync: false,
      requestedWriteSync: false,
      mutateDirectory: this.#kind === "directory",
    };
  }

  getType(): DescriptorType {
    return this.#kind === "directory" ? "directory" : "regular-file";
  }

  async createDirectoryAt(path: string): Promise<void> {
    // console.debug(`[wasi:filesystem Descriptor.createDirectoryAt] path="${path}", descriptorPath="${this.#path}"`);

    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const parts = path.split("/").filter((p) => p && p !== ".");

    if (parts.length === 0) {
      throw new FsError("invalid");
    }

    let currentHandle = dirHandle;
    for (const part of parts) {
      if (part === "..") {
        throw new FsError("invalid");
      }
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
      } catch (err: any) {
        // console.debug(`[wasi:filesystem createDirectoryAt] Error creating directory "${part}":`, err);
        throw new FsError("io");
      }
    }
    // console.debug(`[wasi:filesystem Descriptor.createDirectoryAt] Created directory "${path}"`);
  }

  // @ts-expect-error Needs to be asynchronous
  async stat(): Promise<DescriptorStat> {
    if (this.#kind === "file") {
      const fileHandle = this.#handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();

      // Get custom metadata if available
      const metadata = fileMetadata.get(this.#path);

      // Use custom timestamps if available, otherwise fall back to File.lastModified
      const accessTime = metadata?.accessTime ?? file.lastModified;
      const modificationTime = metadata?.modificationTime ?? file.lastModified;
      const changeTime = metadata?.changeTime ?? file.lastModified;

      return {
        type: "regular-file",
        linkCount: BigInt(1),
        size: BigInt(file.size),
        dataAccessTimestamp: {
          seconds: BigInt(Math.floor(accessTime / 1000)),
          nanoseconds: (accessTime % 1000) * 1_000_000,
        },
        dataModificationTimestamp: {
          seconds: BigInt(Math.floor(modificationTime / 1000)),
          nanoseconds: (modificationTime % 1000) * 1_000_000,
        },
        statusChangeTimestamp: {
          seconds: BigInt(Math.floor(changeTime / 1000)),
          nanoseconds: (changeTime % 1000) * 1_000_000,
        },
      };
    } else {
      return {
        type: "directory",
        linkCount: BigInt(1),
        size: BigInt(0),
        dataAccessTimestamp: timeZero,
        dataModificationTimestamp: timeZero,
        statusChangeTimestamp: timeZero,
      };
    }
  }

  // @ts-expect-error Needs to be asynchronous
  async statAt(pathFlags: PathFlags, path: string): Promise<DescriptorStat> {
    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    // Check if this is a symlink
    const fullPath = this.#path + "/" + path;
    const symlinkTarget = symlinks.get(fullPath);

    if (symlinkTarget) {
      if (pathFlags && pathFlags.symlinkFollow === false) {
        // Return symlink stats (not the target)
        // console.debug(`[wasi:filesystem statAt] Returning symlink stats for "${path}"`);
        return {
          type: "symbolic-link",
          linkCount: BigInt(1),
          size: BigInt(symlinkTarget.length),
          dataAccessTimestamp: timeZero,
          dataModificationTimestamp: timeZero,
          statusChangeTimestamp: timeZero,
        };
      } else {
        // Follow symlink and stat the target
        // console.debug(`[wasi:filesystem statAt] Following symlink "${path}" -> "${symlinkTarget}"`);
        return this.statAt(pathFlags, symlinkTarget);
      }
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const parts = path.split("/").filter((p) => p && p !== ".");

    if (parts.length === 0) {
      return this.stat();
    }

    let currentHandle: FileSystemDirectoryHandle = dirHandle;
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    for (const part of dirParts) {
      if (part === "..") {
        throw new FsError("invalid");
      }
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      } catch {
        throw new FsError("no-entry");
      }
    }

    try {
      const fileHandle = await currentHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();

      return {
        type: "regular-file",
        linkCount: BigInt(1),
        size: BigInt(file.size),
        dataAccessTimestamp: {
          seconds: BigInt(Math.floor(file.lastModified / 1000)),
          nanoseconds: (file.lastModified % 1000) * 1_000_000,
        },
        dataModificationTimestamp: {
          seconds: BigInt(Math.floor(file.lastModified / 1000)),
          nanoseconds: (file.lastModified % 1000) * 1_000_000,
        },
        statusChangeTimestamp: timeZero,
      };
    } catch {
      try {
        await currentHandle.getDirectoryHandle(fileName);
        return {
          type: "directory",
          linkCount: BigInt(1),
          size: BigInt(0),
          dataAccessTimestamp: timeZero,
          dataModificationTimestamp: timeZero,
          statusChangeTimestamp: timeZero,
        };
      } catch {
        throw new FsError("no-entry");
      }
    }
  }

  // @ts-expect-error Needs to be asynchronous
  async openAt(
    pathFlags: PathFlags,
    path: string,
    openFlags: OpenFlags,
    _flags: DescriptorFlags
  ): Promise<Descriptor> {
    // console.debug(`[wasi:filesystem Descriptor.openAt] path="${path}", openFlags=`, openFlags, `descriptorPath="${this.#path}"`);

    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    // Check if this is a symlink and should be followed
    const fullPath = this.#path + "/" + path;
    const symlinkTarget = symlinks.get(fullPath);
    if (symlinkTarget && (!pathFlags || pathFlags.symlinkFollow !== false)) {
      // console.debug(`[wasi:filesystem Descriptor.openAt] Following symlink "${path}" -> "${symlinkTarget}"`);
      // Recursively open the target
      return this.openAt(pathFlags, symlinkTarget, openFlags, _flags);
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const parts = path.split("/").filter((p) => p && p !== ".");

    if (parts.length === 0 || (parts.length === 1 && parts[0] === ".")) {
      // console.debug(`[wasi:filesystem Descriptor.openAt] returning self for path="${path}"`);
      return this;
    }

    let currentHandle: FileSystemDirectoryHandle = dirHandle;
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    // Navigate to parent directory
    for (const part of dirParts) {
      if (part === "..") {
        throw new FsError("invalid");
      }
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: false });
      } catch (err) {
        throw new FsError("no-entry");
      }
    }

    // Determine if we should try directory or file based on flags
    const tryDirectory = openFlags.directory === true ||
                         (openFlags.directory === undefined && !openFlags.create);

    // Try to open as directory if indicated
    if (tryDirectory) {
      try {
        const subDirHandle = await currentHandle.getDirectoryHandle(fileName, {
          create: false, // Never create directories via openAt, use createDirectoryAt
        });
        const newPath = this.#path + "/" + path;
        // console.debug(`[wasi:filesystem Descriptor.openAt] opened as directory: "${path}"`);
        return descriptorCreate(subDirHandle, newPath);
      } catch (err: any) {
        // If explicitly asked for directory and it fails, throw
        if (openFlags.directory === true) {
          if (err.name === "NotFoundError") {
            throw new FsError("no-entry");
          }
          throw new FsError("io");
        }
        // Otherwise fall through to try as file
      }
    }

    // Try to open as file
    try {
      const fileHandle = await currentHandle.getFileHandle(fileName, {
        create: openFlags.create || false,
      });

      // Handle truncate flag
      if (openFlags.truncate) {
        const writable = await fileHandle.createWritable();
        await writable.truncate(0);
        await writable.close();

        // Update cache
        const newPath = this.#path + "/" + path;
        fileCache.set(newPath, new Uint8Array(0), Date.now());
      }

      const newPath = this.#path + "/" + path;
      const descriptor = descriptorCreate(fileHandle, newPath);

      // Optionally pre-warm cache for better first-read performance
      await descriptor.prewarmCache();

      // console.debug(`[wasi:filesystem Descriptor.openAt] opened as file: "${path}"`);
      return descriptor;
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        // If file doesn't exist and we're not creating, check if it's a directory
        try {
          const subDirHandle = await currentHandle.getDirectoryHandle(fileName, { create: false });
          const newPath = this.#path + "/" + path;
          return descriptorCreate(subDirHandle, newPath);
        } catch {
          throw new FsError("no-entry");
        }
      }
      throw new FsError("io");
    }
  }

  // @ts-expect-error Needs to be asynchronous
  async readDirectory(): Promise<DirectoryEntryStream> {
    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const entries: DirectoryEntry[] = [];

    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({
        name,
        type: handle.kind === "directory" ? "directory" : "regular-file",
      });
    }

    // Sort entries alphabetically
    entries.sort((a, b) => (a.name > b.name ? 1 : -1));

    return new DirectoryEntryStream(entries);
  }

  async removeDirectoryAt(path: string): Promise<void> {
    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const parts = path.split("/").filter((p) => p && p !== ".");

    if (parts.length === 0) {
      throw new FsError("invalid");
    }

    let currentHandle = dirHandle;
    const dirName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);

    for (const part of parentParts) {
      if (part === "..") {
        throw new FsError("invalid");
      }
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      } catch {
        throw new FsError("no-entry");
      }
    }

    try {
      await currentHandle.removeEntry(dirName, { recursive: false });

      // Clear from cache
      const fullPath = this.#path + "/" + path;
      fileCache.delete(fullPath);
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        throw new FsError("no-entry");
      }
      throw new FsError("io");
    }
  }

  async unlinkFileAt(path: string): Promise<void> {
    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    const dirHandle = this.#handle as FileSystemDirectoryHandle;
    const parts = path.split("/").filter((p) => p && p !== ".");

    if (parts.length === 0) {
      throw new FsError("invalid");
    }

    let currentHandle = dirHandle;
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    for (const part of dirParts) {
      if (part === "..") {
        throw new FsError("invalid");
      }
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      } catch {
        throw new FsError("no-entry");
      }
    }

    try {
      await currentHandle.removeEntry(fileName);

      // Clear from cache
      const fullPath = this.#path + "/" + path;
      fileCache.delete(fullPath);
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        throw new FsError("no-entry");
      }
      throw new FsError("io");
    }
  }

  metadataHash(): { lower: bigint; upper: bigint } {
    return { lower: BigInt(0), upper: BigInt(0) };
  }

  metadataHashAt(_pathFlags: PathFlags, _path: string): { lower: bigint; upper: bigint } {
    return this.metadataHash();
  }

  isSameObject(other: IDescriptor): boolean {
    return other instanceof Descriptor && this.handle === other.handle;
  }

  /**
   * Advisory file locking using Web Locks API (navigator.locks)
   */
  async advise(offset: Filesize, length: Filesize, advice: string): Promise<void> {
    if (this.#kind !== "file") {
      return;
    }

    const path = this.#path;
    // console.debug(`[wasi:filesystem advise] File "${path}" offset=${offset} length=${length} advice=${advice}`);

    // Implement locking using Web Locks API
    if (advice === "exclusive" || advice === "will-need") {
      // Request exclusive lock
      const existing = fileLocks.get(path);
      if (existing) {
        console.warn(`[advise] File "${path}" already has ${existing.mode} lock`);
        return;
      }

      // Create a promise that we can resolve manually to release the lock
      let releaseLock: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      // Request lock - this will hold until lockPromise resolves
      navigator.locks.request(path, { mode: "exclusive" }, async () => {
        fileLocks.set(path, {
          mode: "exclusive",
          timestamp: Date.now(),
          path,
          release: releaseLock!,
        });
        // console.debug(`[wasi:filesystem advise] Acquired exclusive lock on "${path}"`);

        // Wait for manual release
        await lockPromise;

        // console.debug(`[wasi:filesystem advise] Lock released on "${path}"`);
      }).catch((err: any) => {
        console.error(`[wasi:filesystem advise] Failed to acquire lock on "${path}":`, err);
      });
    } else if (advice === "shared" || advice === "sequential") {
      // Request shared lock
      const existing = fileLocks.get(path);
      if (existing && existing.mode === "exclusive") {
        console.warn(`[advise] File "${path}" already has exclusive lock`);
        return;
      }

      // Create a promise that we can resolve manually to release the lock
      let releaseLock: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      // Request shared lock
      navigator.locks.request(path, { mode: "shared" }, async () => {
        // For shared locks, we can have multiple, so use path+timestamp as key
        const lockKey = `${path}@${Date.now()}`;
        fileLocks.set(lockKey, {
          mode: "shared",
          timestamp: Date.now(),
          path,
          release: releaseLock!,
        });
        // console.debug(`[wasi:filesystem advise] Acquired shared lock on "${path}"`);

        // Wait for manual release
        await lockPromise;

        // console.debug(`[wasi:filesystem advise] Shared lock released on "${path}"`);
      }).catch((err: any) => {
        console.error(`[wasi:filesystem advise] Failed to acquire shared lock on "${path}":`, err);
      });
    } else if (advice === "dontneed" || advice === "noreuse") {
      // Release all locks for this path
      const locksToRelease = Array.from(fileLocks.entries())
        .filter(([key, lock]) => lock.path === path || key === path);

      for (const [key, lock] of locksToRelease) {
        lock.release();
        fileLocks.delete(key);
      }

      if (locksToRelease.length > 0) {
        // console.debug(`[wasi:filesystem advise] Released ${locksToRelease.length} lock(s) on "${path}"`);
      }
    }
  }

  /**
   * Set file size (truncate/extend)
   */
  async setSize(size: Filesize): Promise<void> {
    if (this.#kind !== "file") {
      throw new FsError("bad-descriptor");
    }

    const fileHandle = this.#handle as FileSystemFileHandle;
    const targetSize = Number(size);
    const path = this.#path;

    // console.debug(`[wasi:filesystem setSize] Setting file "${path}" to ${targetSize} bytes`);
    try {
      // Check for any locks on this file
      const lockInfo = isFileLocked(path);
      if (lockInfo.locked) {
        console.warn(`[setSize] File "${path}" is locked (${lockInfo.mode || 'unknown'})`);
        return; // Don't resize locked file
      }

      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.truncate(targetSize);
      await writable.close();

      // Update cache
      const cached = fileCache.get(path);
      if (cached) {
        if (targetSize < cached.byteLength) {
          // Truncate
          fileCache.set(path, cached.slice(0, targetSize), Date.now());
        } else if (targetSize > cached.byteLength) {
          // Extend with zeros
          const extended = new Uint8Array(targetSize);
          extended.set(cached);
          fileCache.set(path, extended, Date.now());
        }
      }

      // console.debug(`[wasi:filesystem setSize] File "${path}" resized to ${targetSize} bytes`);
    } catch (err: any) {
      console.error(`[wasi:filesystem setSize] Error resizing file:`, err);
    }
  }

  /**
   * Set file timestamps
   * Note: File System API doesn't support setting timestamps natively,
   * so we store them in memory
   */
  setTimes(dataAccessTimestamp: any, dataModificationTimestamp: any): void {
    const path = this.#path;
    // console.debug(`[wasi:filesystem setTimes] Setting timestamps for "${path}"`, { access: dataAccessTimestamp, modification: dataModificationTimestamp });

    let metadata = fileMetadata.get(path);
    if (!metadata) {
      metadata = {};
      fileMetadata.set(path, metadata);
    }

    // Convert WASI timestamp to milliseconds
    if (dataAccessTimestamp && dataAccessTimestamp.tag !== "now") {
      const seconds = Number(dataAccessTimestamp.val.seconds);
      const nanos = dataAccessTimestamp.val.nanoseconds;
      metadata.accessTime = seconds * 1000 + Math.floor(nanos / 1_000_000);
    } else if (dataAccessTimestamp?.tag === "now") {
      metadata.accessTime = Date.now();
    }

    if (dataModificationTimestamp && dataModificationTimestamp.tag !== "now") {
      const seconds = Number(dataModificationTimestamp.val.seconds);
      const nanos = dataModificationTimestamp.val.nanoseconds;
      metadata.modificationTime = seconds * 1000 + Math.floor(nanos / 1_000_000);
    } else if (dataModificationTimestamp && dataModificationTimestamp.tag === "now") {
      metadata.modificationTime = Date.now();
    }

    // Update change time
    metadata.changeTime = Date.now();

    // console.debug(`[wasi:filesystem setTimes] Updated timestamps for "${path}"`);
  }

  /**
   * Set timestamps for a path
   */
  setTimesAt(pathFlags: PathFlags, path: string, dataAccessTimestamp: any, dataModificationTimestamp: any): void {
    const fullPath = this.#path + "/" + path;

    // Check if it's a symlink and should be followed
    const symlinkTarget = symlinks.get(fullPath);
    if (symlinkTarget && (!pathFlags || pathFlags.symlinkFollow !== false)) {
      // console.debug(`[wasi:filesystem setTimesAt] Following symlink "${path}" -> "${symlinkTarget}"`);
      return this.setTimesAt(pathFlags, symlinkTarget, dataAccessTimestamp, dataModificationTimestamp);
    }

    // console.debug(`[wasi:filesystem setTimesAt] Setting timestamps for "${path}"`, { access: dataAccessTimestamp, modification: dataModificationTimestamp });

    let metadata = fileMetadata.get(fullPath);
    if (!metadata) {
      metadata = {};
      fileMetadata.set(fullPath, metadata);
    }

    // Convert WASI timestamp to milliseconds
    if (dataAccessTimestamp && dataAccessTimestamp.tag !== "now") {
      const seconds = Number(dataAccessTimestamp.val.seconds);
      const nanos = dataAccessTimestamp.val.nanoseconds;
      metadata.accessTime = seconds * 1000 + Math.floor(nanos / 1_000_000);
    } else if (dataAccessTimestamp && dataAccessTimestamp.tag === "now") {
      metadata.accessTime = Date.now();
    }

    if (dataModificationTimestamp && dataModificationTimestamp.tag !== "now") {
      const seconds = Number(dataModificationTimestamp.val.seconds);
      const nanos = dataModificationTimestamp.val.nanoseconds;
      metadata.modificationTime = seconds * 1000 + Math.floor(nanos / 1_000_000);
    } else if (dataModificationTimestamp && dataModificationTimestamp.tag === "now") {
      metadata.modificationTime = Date.now();
    }

    // Update change time
    metadata.changeTime = Date.now();

    // console.debug(`[wasi:filesystem setTimesAt] Updated timestamps for "${path}"`);
  }

  /**
   * Create hard link (not supported by FileSystem API)
   */
  linkAt(_oldPathFlags: PathFlags, _oldPath: string, _newDescriptor: IDescriptor, _newPath: string): void {
    console.warn(`[linkAt] Hard links not supported by FileSystem API`);
    throw new FsError("unsupported");
  }

  /**
   * Read symbolic link target
   */
  readlinkAt(path: string): string {
    const fullPath = this.#path + "/" + path;
    const target = symlinks.get(fullPath);

    if (!target) {
      // console.debug(`[wasi:filesystem readlinkAt] No symlink at "${fullPath}"`);
      throw new FsError("invalid");
    }

    // console.debug(`[wasi:filesystem readlinkAt] Symlink "${fullPath}" -> "${target}"`);
    return target;
  }

  /**
   * Rename/move file or directory
   */
  async renameAt(oldPath: string, newDescriptor: IDescriptor, newPath: string): Promise<void> {
    if (this.#kind !== "directory") {
      throw new FsError("not-directory");
    }

    const oldDirHandle = this.#handle as FileSystemDirectoryHandle;
    const descriptorPath = this.#path;

    // console.debug(`[wasi:filesystem renameAt] Renaming "${oldPath}" to "${newPath}"`);
    
    try {
      const oldParts = oldPath.split("/").filter((p) => p && p !== ".");

      if (oldParts.length === 0) {
        throw new FsError("invalid");
      }

      // Navigate to old file's parent directory
      let oldParentHandle = oldDirHandle;
      const oldFileName = oldParts[oldParts.length - 1];
      const oldDirParts = oldParts.slice(0, -1);

      for (const part of oldDirParts) {
        if (part === "..") {
          throw new FsError("invalid");
        }
        try {
          oldParentHandle = await oldParentHandle.getDirectoryHandle(part);
        } catch {
          throw new FsError("no-entry");
        }
      }

      // Get new descriptor's directory handle
      if (!(newDescriptor instanceof Descriptor)) {
        throw new FsError("invalid");
      }

      const newDirHandle = (newDescriptor as Descriptor).#handle as FileSystemDirectoryHandle;
      const newParts = newPath.split("/").filter((p) => p && p !== ".");

      if (newParts.length === 0) {
        throw new FsError("invalid");
      }

      // Navigate to new file's parent directory
      let newParentHandle = newDirHandle;
      const newFileName = newParts[newParts.length - 1];
      const newDirParts = newParts.slice(0, -1);

      for (const part of newDirParts) {
        if (part === "..") {
          throw new FsError("invalid");
        }
        try {
          newParentHandle = await newParentHandle.getDirectoryHandle(part, { create: true });
        } catch {
          throw new FsError("io");
        }
      }

      // Check if source is a file or directory
      let isDirectory = false;
      let sourceHandle: FileSystemFileHandle | FileSystemDirectoryHandle;

      try {
        sourceHandle = await oldParentHandle.getFileHandle(oldFileName);
      } catch {
        sourceHandle = await oldParentHandle.getDirectoryHandle(oldFileName);
        isDirectory = true;
      }

      // Use native move if available (Chrome 108+)
      if ('move' in sourceHandle && typeof (sourceHandle as any).move === 'function') {
        // console.debug(`[wasi:filesystem renameAt] Using native move API`);
        await (sourceHandle as any).move(newParentHandle, newFileName);
      } else {
        // Fallback: copy and delete
        // console.debug(`[wasi:filesystem renameAt] Using copy+delete fallback`);

        if (isDirectory) {
          // Recursive directory copy
          await this.copyDirectory(
            sourceHandle as FileSystemDirectoryHandle,
            newParentHandle,
            newFileName
          );
        } else {
          // File copy
          const fileHandle = sourceHandle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();

          const newFileHandle = await newParentHandle.getFileHandle(newFileName, { create: true });
          const writable = await newFileHandle.createWritable();
          await writable.write(buffer);
          await writable.close();
        }

        // Delete source
        await oldParentHandle.removeEntry(oldFileName, { recursive: isDirectory });
      }

      // Update cache
      const oldFullPath = descriptorPath + "/" + oldPath;
      const newFullPath = (newDescriptor as Descriptor).#path + "/" + newPath;

      const cachedData = fileCache.get(oldFullPath);
      if (cachedData) {
        fileCache.delete(oldFullPath);
        fileCache.set(newFullPath, cachedData, Date.now());
      }

      // Update symlinks
      const symlinkTarget = symlinks.get(oldFullPath);
      if (symlinkTarget) {
        symlinks.delete(oldFullPath);
        symlinks.set(newFullPath, symlinkTarget);
      }

      // console.debug(`[wasi:filesystem renameAt] Renamed "${oldPath}" to "${newPath}"`);
    } catch (err: any) {
      console.error(`[wasi:filesystem renameAt] Error renaming:`, err);
    }
  }

  /**
   * Helper: Recursively copy directory
   */
  private async copyDirectory(
    sourceDir: FileSystemDirectoryHandle,
    targetParent: FileSystemDirectoryHandle,
    targetName: string
  ): Promise<void> {
    const targetDir = await targetParent.getDirectoryHandle(targetName, { create: true });

    for await (const [name, handle] of sourceDir.entries()) {
      if (handle.kind === "file") {
        const sourceFile = handle as FileSystemFileHandle;
        const file = await sourceFile.getFile();
        const buffer = await file.arrayBuffer();

        const targetFile = await targetDir.getFileHandle(name, { create: true });
        const writable = await targetFile.createWritable();
        await writable.write(buffer);
        await writable.close();
      } else {
        await this.copyDirectory(handle as FileSystemDirectoryHandle, targetDir, name);
      }
    }
  }

  /**
   * Create symbolic link
   */
  symlinkAt(oldPath: string, newPath: string): void {
    const fullNewPath = this.#path + "/" + newPath;

    // console.debug(`[wasi:filesystem symlinkAt] Creating symlink "${fullNewPath}" -> "${oldPath}"`);

    // Store symlink in memory (FileSystem API doesn't support symlinks natively)
    symlinks.set(fullNewPath, oldPath);

    // console.debug(`[wasi:filesystem symlinkAt] Created symlink "${fullNewPath}" -> "${oldPath}"`);
  }
}

const descriptorCreate = Descriptor._create;
// @ts-expect-error - Deleting static method
delete Descriptor._create;

// Store preopen entries
let preopenEntries: Array<[Descriptor, string]> = [];

export const preopens = {
  getDirectories(): Array<[Descriptor, string]> {
    // console.debug(`[wasi:filesystem preopens.getDirectories] Returning ${preopenEntries.length} preopens`);
    return preopenEntries;
  },
};

export const types = {
  Descriptor,
  DirectoryEntryStream,
  filesystemErrorCode: (err: IoError) => {
    // console.debug(`[wasi:filesystem filesystemErrorCode] ${err}`);
    // If it's our FsError, return the payload directly (it's already an ErrorCode)
    if ("payload" in err && typeof err.payload === "string") {
      return err.payload as ErrorCode;
    }
    return err.toDebugString();
  },
};

/**
 * Replace all preopens with the given set.
 * @param preopens - Map of virtual paths to host paths
 */
export const _setPreopens = async (preopens: Record<string, string>) => {
  preopenEntries = [];
  for (const [virtualPath, hostPreopen] of Object.entries(preopens)) {
    await _addPreopen(virtualPath, hostPreopen);
  }
  // console.debug(`[wasi:filesystem _setPreopens] Total preopens: ${preopenEntries.length}`);
};

/**
 * Add a single preopen mapping.
 * @param virtualPath - The virtual path visible to the guest
 * @param hostPreopen - The host filesystem path
 */
export const _addPreopen = async(virtualPath: string, hostPreopen: string): Promise<void> => {
  // console.debug(`[wasi:filesystem _addPreopen] virtualPath="${virtualPath}"`);

  // Get the origin-private filesystem root
  const root = await navigator.storage.getDirectory();
  let handle = root;
  if (hostPreopen !== "/") {
    handle = await root.getDirectoryHandle(hostPreopen.replace("/", ""), {create: true});
  } 
  const descriptor = descriptorCreate(handle, hostPreopen);
  preopenEntries.push([descriptor, virtualPath]);
  // console.debug(`[wasi:filesystem _addPreopen] Added preopen: "${virtualPath}"`);
}

/**
 * Clear all preopens, giving the guest no filesystem access.
 * Call this immediately after import to disable default full filesystem access.
 */
export const _clearPreopens = () => {
  preopenEntries = [];
};

/**
 * Get current preopens configuration.
 * @returns Array of [descriptor, virtualPath] pairs
 */
export const _getPreopens = (): Array<[Descriptor, string]> => {
  return [...preopenEntries];
};


// Export cache and stream diagnostics for debugging
export const getCacheStats = () => fileCache.getStats();
export const clearCache = () => fileCache.clear();
export const getActiveWriteStreams = () => Array.from(activeWriteStreams);
export const checkForLeakedStreams = () => {
  if (activeWriteStreams.size > 0) {
    console.warn(`[wasi-filesystem] Warning: ${activeWriteStreams.size} write streams may be leaked:`, Array.from(activeWriteStreams));
    return true;
  }
  return false;
};

// Export symlink management
export const getSymlinks = () => Array.from(symlinks.entries()).map(([path, target]) => ({ path, target }));
export const clearSymlinks = () => symlinks.clear();
export const getSymlink = (path: string) => symlinks.get(path);

// Export file lock management (Web Locks API)
export const getFileLocks = () => Array.from(fileLocks.entries()).map(([key, lock]) => ({
  key,
  path: lock.path,
  mode: lock.mode,
  timestamp: lock.timestamp,
}));

export const clearFileLocks = () => {
  // Release all locks
  for (const lock of fileLocks.values()) {
    try {
      lock.release();
      // console.debug(`[wasi:filesystem clearFileLocks] Released ${lock.mode} lock on "${lock.path}"`);
    } catch (err: any) {
      console.error(`[wasi:filesystem clearFileLocks] Error releasing lock on "${lock.path}":`, err);
    }
  }
  fileLocks.clear();
};

export const isFileLocked = (path: string) => {
  // Check for exact path match (exclusive lock) or path prefix match (shared locks)
  const exactLock = fileLocks.get(path);
  if (exactLock) {
    return { locked: true, mode: exactLock.mode, timestamp: exactLock.timestamp };
  }

  // Check for shared locks (which have keys like "path@timestamp")
  const sharedLocks = Array.from(fileLocks.values()).filter(lock => lock.path === path);
  if (sharedLocks.length > 0) {
    return {
      locked: true,
      mode: "shared" as const,
      count: sharedLocks.length,
      timestamps: sharedLocks.map(l => l.timestamp),
    };
  }

  return { locked: false };
};

// Export metadata management
export const getFileMetadata = (path: string) => fileMetadata.get(path);
export const getAllFileMetadata = () => Array.from(fileMetadata.entries()).map(([path, meta]) => ({ path, ...meta }));
export const clearFileMetadata = () => fileMetadata.clear();

/**
 * Write data directly to a file in the origin-private filesystem, bypassing
 * the WASI guest entirely. Used to implement shell redirection (`>`, `>>`)
 * for output that is captured on the JS side rather than written by a guest
 * through a WASI file descriptor.
 *
 * @param hostPreopen - The host filesystem root the path is relative to (matches the value used in `_setPreopens`)
 * @param path - Path relative to `hostPreopen`
 * @param data - Bytes to write
 * @param append - When true, append to the end of the file instead of truncating it
 */
export const writeFile = async (
  hostPreopen: string,
  path: string,
  data: Uint8Array,
  append: boolean,
): Promise<void> => {
  const root = await navigator.storage.getDirectory();
  let dir = root;
  if (hostPreopen !== "/") {
    dir = await root.getDirectoryHandle(hostPreopen.replace("/", ""), { create: true });
  }

  const parts = path.split("/").filter((p) => p && p !== ".");
  const fileName = parts.pop();
  if (!fileName || parts.some((p) => p === "..")) {
    throw new Error(`Invalid redirect path: "${path}"`);
  }
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }

  const fileHandle = await dir.getFileHandle(fileName, { create: true });

  let position = 0;
  if (append) {
    const file = await fileHandle.getFile();
    position = file.size;
  }

  const writable = await fileHandle.createWritable({ keepExistingData: append });
  await writable.write({ type: "write", position, data: new Uint8Array(data) });
  await writable.close();

  // Invalidate any cached read of this path so subsequent reads see the new content
  fileCache.delete(`${hostPreopen}/${path}`);
};
