/** @module Interface wasi:filesystem/types@0.2.12 **/
export type Filesize = bigint;
export type InputStream = import('./wasi-io-streams.js').InputStream;
/**
 * # Variants
 * 
 * ## `"access"`
 * 
 * ## `"would-block"`
 * 
 * ## `"already"`
 * 
 * ## `"bad-descriptor"`
 * 
 * ## `"busy"`
 * 
 * ## `"deadlock"`
 * 
 * ## `"quota"`
 * 
 * ## `"exist"`
 * 
 * ## `"file-too-large"`
 * 
 * ## `"illegal-byte-sequence"`
 * 
 * ## `"in-progress"`
 * 
 * ## `"interrupted"`
 * 
 * ## `"invalid"`
 * 
 * ## `"io"`
 * 
 * ## `"is-directory"`
 * 
 * ## `"loop"`
 * 
 * ## `"too-many-links"`
 * 
 * ## `"message-size"`
 * 
 * ## `"name-too-long"`
 * 
 * ## `"no-device"`
 * 
 * ## `"no-entry"`
 * 
 * ## `"no-lock"`
 * 
 * ## `"insufficient-memory"`
 * 
 * ## `"insufficient-space"`
 * 
 * ## `"not-directory"`
 * 
 * ## `"not-empty"`
 * 
 * ## `"not-recoverable"`
 * 
 * ## `"unsupported"`
 * 
 * ## `"no-tty"`
 * 
 * ## `"no-such-device"`
 * 
 * ## `"overflow"`
 * 
 * ## `"not-permitted"`
 * 
 * ## `"pipe"`
 * 
 * ## `"read-only"`
 * 
 * ## `"invalid-seek"`
 * 
 * ## `"text-file-busy"`
 * 
 * ## `"cross-device"`
 */
export type ErrorCode = "access" | "would-block" | "already" | "bad-descriptor" | "busy" | "deadlock" | "quota" | "exist" | "file-too-large" | "illegal-byte-sequence" | "in-progress" | "interrupted" | "invalid" | "io" | "is-directory" | "loop" | "too-many-links" | "message-size" | "name-too-long" | "no-device" | "no-entry" | "no-lock" | "insufficient-memory" | "insufficient-space" | "not-directory" | "not-empty" | "not-recoverable" | "unsupported" | "no-tty" | "no-such-device" | "overflow" | "not-permitted" | "pipe" | "read-only" | "invalid-seek" | "text-file-busy" | "cross-device";
export type OutputStream = import('./wasi-io-streams.js').OutputStream;
export interface DescriptorFlags {
  read?: boolean,
  write?: boolean,
  fileIntegritySync?: boolean,
  dataIntegritySync?: boolean,
  requestedWriteSync?: boolean,
  mutateDirectory?: boolean,
}
/**
 * # Variants
 * 
 * ## `"unknown"`
 * 
 * ## `"block-device"`
 * 
 * ## `"character-device"`
 * 
 * ## `"directory"`
 * 
 * ## `"fifo"`
 * 
 * ## `"symbolic-link"`
 * 
 * ## `"regular-file"`
 * 
 * ## `"socket"`
 */
export type DescriptorType = "unknown" | "block-device" | "character-device" | "directory" | "fifo" | "symbolic-link" | "regular-file" | "socket";
export type LinkCount = bigint;
export type Datetime = import('./wasi-clocks-wall-clock.js').Datetime;
export interface DescriptorStat {
  type: DescriptorType,
  linkCount: LinkCount,
  size: Filesize,
  dataAccessTimestamp?: Datetime,
  dataModificationTimestamp?: Datetime,
  statusChangeTimestamp?: Datetime,
}
export interface PathFlags {
  symlinkFollow?: boolean,
}
export interface OpenFlags {
  create?: boolean,
  directory?: boolean,
  exclusive?: boolean,
  truncate?: boolean,
}
export interface MetadataHashValue {
  lower: bigint,
  upper: bigint,
}
export interface DirectoryEntry {
  type: DescriptorType,
  name: string,
}

export class Descriptor {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  readViaStream(offset: Filesize): InputStream;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  writeViaStream(offset: Filesize): OutputStream;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  appendViaStream(): OutputStream;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  getFlags(): DescriptorFlags;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  readDirectory(): DirectoryEntryStream;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  createDirectoryAt(path: string): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  stat(): DescriptorStat;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  statAt(pathFlags: PathFlags, path: string): DescriptorStat;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  openAt(pathFlags: PathFlags, path: string, openFlags: OpenFlags, flags: DescriptorFlags): Descriptor;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  unlinkFileAt(path: string): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  metadataHash(): MetadataHashValue;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  metadataHashAt(pathFlags: PathFlags, path: string): MetadataHashValue;
}

export class DirectoryEntryStream {
  /**
   * This type does not have a public constructor.
   */
  private constructor();
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  readDirectoryEntry(): DirectoryEntry | undefined;
}
