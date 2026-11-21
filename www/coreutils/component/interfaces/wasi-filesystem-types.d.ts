/** @module Interface wasi:filesystem/types@0.2.3 **/
export function filesystemErrorCode(err: Error): ErrorCode | undefined;
export type Filesize = bigint;
/**
 * # Variants
 * 
 * ## `"normal"`
 * 
 * ## `"sequential"`
 * 
 * ## `"random"`
 * 
 * ## `"will-need"`
 * 
 * ## `"dont-need"`
 * 
 * ## `"no-reuse"`
 */
export type Advice = "normal" | "sequential" | "random" | "will-need" | "dont-need" | "no-reuse";
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
export interface DescriptorFlags {
  read?: boolean,
  write?: boolean,
  fileIntegritySync?: boolean,
  dataIntegritySync?: boolean,
  requestedWriteSync?: boolean,
  mutateDirectory?: boolean,
}
export type Datetime = import('./wasi-clocks-wall-clock.js').Datetime;
export type NewTimestamp = NewTimestampNoChange | NewTimestampNow | NewTimestampTimestamp;
export interface NewTimestampNoChange {
  tag: 'no-change',
}
export interface NewTimestampNow {
  tag: 'now',
}
export interface NewTimestampTimestamp {
  tag: 'timestamp',
  val: Datetime,
}
export type Error = import('./wasi-io-streams.js').Error;
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
export interface DirectoryEntry {
  type: DescriptorType,
  name: string,
}
export interface PathFlags {
  symlinkFollow?: boolean,
}
export type LinkCount = bigint;
export interface DescriptorStat {
  type: DescriptorType,
  linkCount: LinkCount,
  size: Filesize,
  dataAccessTimestamp?: Datetime,
  dataModificationTimestamp?: Datetime,
  statusChangeTimestamp?: Datetime,
}
export interface OpenFlags {
  create?: boolean,
  directory?: boolean,
  exclusive?: boolean,
  truncate?: boolean,
}
export type InputStream = import('./wasi-io-streams.js').InputStream;
export type OutputStream = import('./wasi-io-streams.js').OutputStream;
export interface MetadataHashValue {
  lower: bigint,
  upper: bigint,
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
  advise(offset: Filesize, length: Filesize, advice: Advice): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  syncData(): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  getFlags(): DescriptorFlags;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  getType(): DescriptorType;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  setSize(size: Filesize): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  setTimes(dataAccessTimestamp: NewTimestamp, dataModificationTimestamp: NewTimestamp): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  readDirectory(): DirectoryEntryStream;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  sync(): void;
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
  setTimesAt(pathFlags: PathFlags, path: string, dataAccessTimestamp: NewTimestamp, dataModificationTimestamp: NewTimestamp): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  linkAt(oldPathFlags: PathFlags, oldPath: string, newDescriptor: Descriptor, newPath: string): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  openAt(pathFlags: PathFlags, path: string, openFlags: OpenFlags, flags: DescriptorFlags): Descriptor;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  readlinkAt(path: string): string;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  removeDirectoryAt(path: string): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  renameAt(oldPath: string, newDescriptor: Descriptor, newPath: string): void;
  /**
  * @throws {ErrorCode} To return the error of the result, throw it, or an `Error` that has it as its `payload`.
  */
  symlinkAt(oldPath: string, newPath: string): void;
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
