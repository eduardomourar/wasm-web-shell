class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

let dv = new DataView(new ArrayBuffer());
const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  return e;
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

const toUint64 = val => BigInt.asUintN(64, val);

function toUint16(val) {
  val >>>= 0;
  val %= 2 ** 16;
  return val;
}

function toUint32(val) {
  return val >>> 0;
}

const utf8Decoder = new TextDecoder();

const utf8Encoder = new TextEncoder();

let utf8EncodedLen = 0;
function utf8Encode(s, realloc, memory) {
  if (typeof s !== 'string') throw new TypeError('expected a string');
  if (s.length === 0) {
    utf8EncodedLen = 0;
    return 1;
  }
  let allocLen = 0;
  let ptr = 0;
  let writtenTotal = 0;
  while (s.length > 0) {
    ptr = realloc(ptr, allocLen, 1, allocLen + s.length);
    allocLen += s.length;
    const { read, written } = utf8Encoder.encodeInto(
    s,
    new Uint8Array(memory.buffer, ptr + writtenTotal, allocLen - writtenTotal),
    );
    writtenTotal += written;
    s = s.slice(read);
  }
  if (allocLen > writtenTotal)
  ptr = realloc(ptr, allocLen, 1, writtenTotal);
  utf8EncodedLen = writtenTotal;
  return ptr;
}

export async function instantiate(compileCore, imports, instantiateCore = WebAssembly.instantiate) {
  const module0 = compileCore('aws.core.wasm');
  const module1 = compileCore('aws.core2.wasm');
  const module2 = compileCore('aws.core3.wasm');
  const module3 = compileCore('aws.core4.wasm');
  
  const { environment, exit: exit$1, stderr, stdin, stdout, terminalInput, terminalOutput, terminalStderr, terminalStdin, terminalStdout } = imports.cli;
  const { monotonicClock, wallClock } = imports.clocks;
  const { preopens, types } = imports.filesystem;
  const { outgoingHandler, types: types$1 } = imports.http;
  const { streams } = imports.io;
  const { poll } = imports.poll;
  const { random } = imports.random;
  const { getArguments,
    getEnvironment } = environment;
  const { exit } = exit$1;
  const { getStderr } = stderr;
  const { getStdin } = stdin;
  const { getStdout } = stdout;
  const { dropTerminalInput } = terminalInput;
  const { dropTerminalOutput } = terminalOutput;
  const { getTerminalStderr } = terminalStderr;
  const { getTerminalStdin } = terminalStdin;
  const { getTerminalStdout } = terminalStdout;
  const { now } = monotonicClock;
  const { now: now$1 } = wallClock;
  const { getDirectories } = preopens;
  const { appendViaStream,
    dropDescriptor,
    dropDirectoryEntryStream,
    getType,
    metadataHash,
    openAt,
    readViaStream,
    stat,
    writeViaStream } = types;
  const { handle } = outgoingHandler;
  const { dropFields,
    dropFutureIncomingResponse,
    dropIncomingResponse,
    dropOutgoingRequest,
    fieldsEntries,
    futureIncomingResponseGet,
    incomingResponseConsume,
    incomingResponseHeaders,
    incomingResponseStatus,
    listenToFutureIncomingResponse,
    newFields,
    newOutgoingRequest,
    outgoingRequestWrite } = types$1;
  const { blockingRead,
    blockingWrite,
    dropInputStream,
    dropOutputStream,
    read,
    subscribeToInputStream,
    subscribeToOutputStream,
    write } = streams;
  const { dropPollable,
    pollOneoff } = poll;
  const { getRandomBytes } = random;
  let exports0;
  
  function trampoline0(arg0) {
    const ret = subscribeToOutputStream(arg0 >>> 0);
    return toUint32(ret);
  }
  
  function trampoline1(arg0) {
    dropPollable(arg0 >>> 0);
  }
  
  function trampoline2(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
    let variant3;
    switch (arg1) {
      case 0: {
        variant3 = null;
        break;
      }
      case 1: {
        let variant0;
        switch (arg2) {
          case 0: {
            variant0 = null;
            break;
          }
          case 1: {
            variant0 = arg3 >>> 0;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant1;
        switch (arg4) {
          case 0: {
            variant1 = null;
            break;
          }
          case 1: {
            variant1 = arg5 >>> 0;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant2;
        switch (arg6) {
          case 0: {
            variant2 = null;
            break;
          }
          case 1: {
            variant2 = arg7 >>> 0;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        variant3 = {
          connectTimeoutMs: variant0,
          firstByteTimeoutMs: variant1,
          betweenBytesTimeoutMs: variant2,
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    const ret = handle(arg0 >>> 0, variant3);
    return toUint32(ret);
  }
  
  function trampoline3(arg0) {
    const ret = listenToFutureIncomingResponse(arg0 >>> 0);
    return toUint32(ret);
  }
  
  function trampoline4(arg0) {
    dropFutureIncomingResponse(arg0 >>> 0);
  }
  
  function trampoline5(arg0) {
    const ret = incomingResponseStatus(arg0 >>> 0);
    return toUint16(ret);
  }
  
  function trampoline6(arg0) {
    const ret = subscribeToInputStream(arg0 >>> 0);
    return toUint32(ret);
  }
  
  function trampoline7(arg0) {
    dropInputStream(arg0 >>> 0);
  }
  
  function trampoline8(arg0) {
    const ret = incomingResponseHeaders(arg0 >>> 0);
    return toUint32(ret);
  }
  
  function trampoline9(arg0) {
    dropFields(arg0 >>> 0);
  }
  
  function trampoline10(arg0) {
    dropIncomingResponse(arg0 >>> 0);
  }
  
  function trampoline11(arg0) {
    dropOutputStream(arg0 >>> 0);
  }
  
  function trampoline12(arg0) {
    dropOutgoingRequest(arg0 >>> 0);
  }
  let exports1;
  
  function trampoline13() {
    const ret = now();
    return toUint64(ret);
  }
  
  function trampoline14(arg0) {
    dropDirectoryEntryStream(arg0 >>> 0);
  }
  
  function trampoline15(arg0) {
    dropDescriptor(arg0 >>> 0);
  }
  
  function trampoline16() {
    const ret = getStdin();
    return toUint32(ret);
  }
  
  function trampoline17(arg0) {
    dropTerminalInput(arg0 >>> 0);
  }
  
  function trampoline18() {
    const ret = getStdout();
    return toUint32(ret);
  }
  
  function trampoline19(arg0) {
    dropTerminalOutput(arg0 >>> 0);
  }
  
  function trampoline20() {
    const ret = getStderr();
    return toUint32(ret);
  }
  
  function trampoline21(arg0) {
    let variant0;
    switch (arg0) {
      case 0: {
        variant0= {
          tag: 'ok',
          val: undefined
        };
        break;
      }
      case 1: {
        variant0= {
          tag: 'err',
          val: undefined
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    exit(variant0);
  }
  let exports2;
  
  function trampoline22(arg0, arg1) {
    const len2 = arg1;
    const base2 = arg0;
    const result2 = [];
    for (let i = 0; i < len2; i++) {
      const base = base2 + i * 16;
      const ptr0 = dataView(memory0).getInt32(base + 0, true);
      const len0 = dataView(memory0).getInt32(base + 4, true);
      const result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
      const ptr1 = dataView(memory0).getInt32(base + 8, true);
      const len1 = dataView(memory0).getInt32(base + 12, true);
      const result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
      result2.push([result0, result1]);
    }
    const ret = newFields(result2);
    return toUint32(ret);
  }
  let memory0;
  
  function trampoline23(arg0, arg1) {
    const ret = fieldsEntries(arg0 >>> 0);
    const vec3 = ret;
    const len3 = vec3.length;
    const result3 = realloc0(0, 0, 4, len3 * 16);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 16;const [tuple0_0, tuple0_1] = e;
      const ptr1 = utf8Encode(tuple0_0, realloc0, memory0);
      const len1 = utf8EncodedLen;
      dataView(memory0).setInt32(base + 4, len1, true);
      dataView(memory0).setInt32(base + 0, ptr1, true);
      const val2 = tuple0_1;
      const len2 = val2.byteLength;
      const ptr2 = realloc0(0, 0, 1, len2 * 1);
      const src2 = new Uint8Array(val2.buffer || val2, val2.byteOffset, len2 * 1);
      (new Uint8Array(memory0.buffer, ptr2, len2 * 1)).set(src2);
      dataView(memory0).setInt32(base + 12, len2, true);
      dataView(memory0).setInt32(base + 8, ptr2, true);
    }
    dataView(memory0).setInt32(arg1 + 4, len3, true);
    dataView(memory0).setInt32(arg1 + 0, result3, true);
  }
  let realloc0;
  
  function trampoline24(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12, arg13) {
    let variant1;
    switch (arg0) {
      case 0: {
        variant1= {
          tag: 'get',
        };
        break;
      }
      case 1: {
        variant1= {
          tag: 'head',
        };
        break;
      }
      case 2: {
        variant1= {
          tag: 'post',
        };
        break;
      }
      case 3: {
        variant1= {
          tag: 'put',
        };
        break;
      }
      case 4: {
        variant1= {
          tag: 'delete',
        };
        break;
      }
      case 5: {
        variant1= {
          tag: 'connect',
        };
        break;
      }
      case 6: {
        variant1= {
          tag: 'options',
        };
        break;
      }
      case 7: {
        variant1= {
          tag: 'trace',
        };
        break;
      }
      case 8: {
        variant1= {
          tag: 'patch',
        };
        break;
      }
      case 9: {
        const ptr0 = arg1;
        const len0 = arg2;
        const result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
        variant1= {
          tag: 'other',
          val: result0
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for Method');
      }
    }
    let variant3;
    switch (arg3) {
      case 0: {
        variant3 = null;
        break;
      }
      case 1: {
        const ptr2 = arg4;
        const len2 = arg5;
        const result2 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr2, len2));
        variant3 = result2;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    let variant6;
    switch (arg6) {
      case 0: {
        variant6 = null;
        break;
      }
      case 1: {
        let variant5;
        switch (arg7) {
          case 0: {
            variant5= {
              tag: 'HTTP',
            };
            break;
          }
          case 1: {
            variant5= {
              tag: 'HTTPS',
            };
            break;
          }
          case 2: {
            const ptr4 = arg8;
            const len4 = arg9;
            const result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
            variant5= {
              tag: 'other',
              val: result4
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for Scheme');
          }
        }
        variant6 = variant5;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    let variant8;
    switch (arg10) {
      case 0: {
        variant8 = null;
        break;
      }
      case 1: {
        const ptr7 = arg11;
        const len7 = arg12;
        const result7 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr7, len7));
        variant8 = result7;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    const ret = newOutgoingRequest(variant1, variant3, variant6, variant8, arg13 >>> 0);
    return toUint32(ret);
  }
  
  function trampoline25(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: outgoingRequestWrite(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant0 = ret;
    switch (variant0.tag) {
      case 'ok': {
        const e = variant0.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setInt32(arg1 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant0.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline26(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: incomingResponseConsume(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant0 = ret;
    switch (variant0.tag) {
      case 'ok': {
        const e = variant0.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setInt32(arg1 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant0.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline27(arg0, arg1) {
    const ret = futureIncomingResponseGet(arg0 >>> 0);
    const variant6 = ret;
    if (variant6 === null || variant6=== undefined) {
      dataView(memory0).setInt8(arg1 + 0, 0, true);
    } else {
      const e = variant6;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      const variant5 = e;
      switch (variant5.tag) {
        case 'ok': {
          const e = variant5.val;
          dataView(memory0).setInt8(arg1 + 4, 0, true);
          dataView(memory0).setInt32(arg1 + 8, toUint32(e), true);
          break;
        }
        case 'err': {
          const e = variant5.val;
          dataView(memory0).setInt8(arg1 + 4, 1, true);
          const variant4 = e;
          switch (variant4.tag) {
            case 'invalid-url': {
              const e = variant4.val;
              dataView(memory0).setInt8(arg1 + 8, 0, true);
              const ptr0 = utf8Encode(e, realloc0, memory0);
              const len0 = utf8EncodedLen;
              dataView(memory0).setInt32(arg1 + 16, len0, true);
              dataView(memory0).setInt32(arg1 + 12, ptr0, true);
              break;
            }
            case 'timeout-error': {
              const e = variant4.val;
              dataView(memory0).setInt8(arg1 + 8, 1, true);
              const ptr1 = utf8Encode(e, realloc0, memory0);
              const len1 = utf8EncodedLen;
              dataView(memory0).setInt32(arg1 + 16, len1, true);
              dataView(memory0).setInt32(arg1 + 12, ptr1, true);
              break;
            }
            case 'protocol-error': {
              const e = variant4.val;
              dataView(memory0).setInt8(arg1 + 8, 2, true);
              const ptr2 = utf8Encode(e, realloc0, memory0);
              const len2 = utf8EncodedLen;
              dataView(memory0).setInt32(arg1 + 16, len2, true);
              dataView(memory0).setInt32(arg1 + 12, ptr2, true);
              break;
            }
            case 'unexpected-error': {
              const e = variant4.val;
              dataView(memory0).setInt8(arg1 + 8, 3, true);
              const ptr3 = utf8Encode(e, realloc0, memory0);
              const len3 = utf8EncodedLen;
              dataView(memory0).setInt32(arg1 + 16, len3, true);
              dataView(memory0).setInt32(arg1 + 12, ptr3, true);
              break;
            }
            default: {
              throw new TypeError('invalid variant specified for Error');
            }
          }
          break;
        }
        default: {
          throw new TypeError('invalid variant specified for result');
        }
      }
    }
  }
  
  function trampoline28(arg0, arg1, arg2) {
    let ret;
    try {
      ret = { tag: 'ok', val: read(arg0 >>> 0, BigInt.asUintN(64, arg1)) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        const [tuple0_0, tuple0_1] = e;
        const val1 = tuple0_0;
        const len1 = val1.byteLength;
        const ptr1 = realloc0(0, 0, 1, len1 * 1);
        const src1 = new Uint8Array(val1.buffer || val1, val1.byteOffset, len1 * 1);
        (new Uint8Array(memory0.buffer, ptr1, len1 * 1)).set(src1);
        dataView(memory0).setInt32(arg2 + 8, len1, true);
        dataView(memory0).setInt32(arg2 + 4, ptr1, true);
        const val2 = tuple0_1;
        let enum2;
        switch (val2) {
          case 'open': {
            enum2 = 0;
            break;
          }
          case 'ended': {
            enum2 = 1;
            break;
          }
          default: {
            if ((tuple0_1) instanceof Error) {
              console.error(tuple0_1);
            }
            
            throw new TypeError(`"${val2}" is not one of the cases of stream-status`);
          }
        }
        dataView(memory0).setInt8(arg2 + 12, enum2, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline29(arg0, arg1, arg2, arg3) {
    const ptr0 = arg1;
    const len0 = arg2;
    const result0 = new Uint8Array(memory0.buffer.slice(ptr0, ptr0 + len0 * 1));
    let ret;
    try {
      ret = { tag: 'ok', val: write(arg0 >>> 0, result0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        const [tuple1_0, tuple1_1] = e;
        dataView(memory0).setBigInt64(arg3 + 8, toUint64(tuple1_0), true);
        const val2 = tuple1_1;
        let enum2;
        switch (val2) {
          case 'open': {
            enum2 = 0;
            break;
          }
          case 'ended': {
            enum2 = 1;
            break;
          }
          default: {
            if ((tuple1_1) instanceof Error) {
              console.error(tuple1_1);
            }
            
            throw new TypeError(`"${val2}" is not one of the cases of stream-status`);
          }
        }
        dataView(memory0).setInt8(arg3 + 16, enum2, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline30(arg0, arg1, arg2) {
    const ptr0 = arg0;
    const len0 = arg1;
    const result0 = new Uint32Array(memory0.buffer.slice(ptr0, ptr0 + len0 * 4));
    const ret = pollOneoff(result0);
    const vec1 = ret;
    const len1 = vec1.length;
    const result1 = realloc0(0, 0, 1, len1 * 1);
    for (let i = 0; i < vec1.length; i++) {
      const e = vec1[i];
      const base = result1 + i * 1;dataView(memory0).setInt8(base + 0, e ? 1 : 0, true);
    }
    dataView(memory0).setInt32(arg2 + 4, len1, true);
    dataView(memory0).setInt32(arg2 + 0, result1, true);
  }
  
  function trampoline31(arg0) {
    const ret = getDirectories();
    const vec2 = ret;
    const len2 = vec2.length;
    const result2 = realloc1(0, 0, 4, len2 * 12);
    for (let i = 0; i < vec2.length; i++) {
      const e = vec2[i];
      const base = result2 + i * 12;const [tuple0_0, tuple0_1] = e;
      dataView(memory0).setInt32(base + 0, toUint32(tuple0_0), true);
      const ptr1 = utf8Encode(tuple0_1, realloc1, memory0);
      const len1 = utf8EncodedLen;
      dataView(memory0).setInt32(base + 8, len1, true);
      dataView(memory0).setInt32(base + 4, ptr1, true);
    }
    dataView(memory0).setInt32(arg0 + 4, len2, true);
    dataView(memory0).setInt32(arg0 + 0, result2, true);
  }
  let realloc1;
  
  function trampoline32(arg0) {
    const ret = now$1();
    const {seconds: v0_0, nanoseconds: v0_1 } = ret;
    dataView(memory0).setBigInt64(arg0 + 0, toUint64(v0_0), true);
    dataView(memory0).setInt32(arg0 + 8, toUint32(v0_1), true);
  }
  
  function trampoline33(arg0, arg1, arg2) {
    let ret;
    try {
      ret = { tag: 'ok', val: readViaStream(arg0 >>> 0, BigInt.asUintN(64, arg1)) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant1 = ret;
    switch (variant1.tag) {
      case 'ok': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        dataView(memory0).setInt32(arg2 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        const val0 = e;
        let enum0;
        switch (val0) {
          case 'access': {
            enum0 = 0;
            break;
          }
          case 'would-block': {
            enum0 = 1;
            break;
          }
          case 'already': {
            enum0 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum0 = 3;
            break;
          }
          case 'busy': {
            enum0 = 4;
            break;
          }
          case 'deadlock': {
            enum0 = 5;
            break;
          }
          case 'quota': {
            enum0 = 6;
            break;
          }
          case 'exist': {
            enum0 = 7;
            break;
          }
          case 'file-too-large': {
            enum0 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum0 = 9;
            break;
          }
          case 'in-progress': {
            enum0 = 10;
            break;
          }
          case 'interrupted': {
            enum0 = 11;
            break;
          }
          case 'invalid': {
            enum0 = 12;
            break;
          }
          case 'io': {
            enum0 = 13;
            break;
          }
          case 'is-directory': {
            enum0 = 14;
            break;
          }
          case 'loop': {
            enum0 = 15;
            break;
          }
          case 'too-many-links': {
            enum0 = 16;
            break;
          }
          case 'message-size': {
            enum0 = 17;
            break;
          }
          case 'name-too-long': {
            enum0 = 18;
            break;
          }
          case 'no-device': {
            enum0 = 19;
            break;
          }
          case 'no-entry': {
            enum0 = 20;
            break;
          }
          case 'no-lock': {
            enum0 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum0 = 22;
            break;
          }
          case 'insufficient-space': {
            enum0 = 23;
            break;
          }
          case 'not-directory': {
            enum0 = 24;
            break;
          }
          case 'not-empty': {
            enum0 = 25;
            break;
          }
          case 'not-recoverable': {
            enum0 = 26;
            break;
          }
          case 'unsupported': {
            enum0 = 27;
            break;
          }
          case 'no-tty': {
            enum0 = 28;
            break;
          }
          case 'no-such-device': {
            enum0 = 29;
            break;
          }
          case 'overflow': {
            enum0 = 30;
            break;
          }
          case 'not-permitted': {
            enum0 = 31;
            break;
          }
          case 'pipe': {
            enum0 = 32;
            break;
          }
          case 'read-only': {
            enum0 = 33;
            break;
          }
          case 'invalid-seek': {
            enum0 = 34;
            break;
          }
          case 'text-file-busy': {
            enum0 = 35;
            break;
          }
          case 'cross-device': {
            enum0 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val0}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg2 + 4, enum0, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline34(arg0, arg1, arg2) {
    let ret;
    try {
      ret = { tag: 'ok', val: writeViaStream(arg0 >>> 0, BigInt.asUintN(64, arg1)) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant1 = ret;
    switch (variant1.tag) {
      case 'ok': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        dataView(memory0).setInt32(arg2 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        const val0 = e;
        let enum0;
        switch (val0) {
          case 'access': {
            enum0 = 0;
            break;
          }
          case 'would-block': {
            enum0 = 1;
            break;
          }
          case 'already': {
            enum0 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum0 = 3;
            break;
          }
          case 'busy': {
            enum0 = 4;
            break;
          }
          case 'deadlock': {
            enum0 = 5;
            break;
          }
          case 'quota': {
            enum0 = 6;
            break;
          }
          case 'exist': {
            enum0 = 7;
            break;
          }
          case 'file-too-large': {
            enum0 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum0 = 9;
            break;
          }
          case 'in-progress': {
            enum0 = 10;
            break;
          }
          case 'interrupted': {
            enum0 = 11;
            break;
          }
          case 'invalid': {
            enum0 = 12;
            break;
          }
          case 'io': {
            enum0 = 13;
            break;
          }
          case 'is-directory': {
            enum0 = 14;
            break;
          }
          case 'loop': {
            enum0 = 15;
            break;
          }
          case 'too-many-links': {
            enum0 = 16;
            break;
          }
          case 'message-size': {
            enum0 = 17;
            break;
          }
          case 'name-too-long': {
            enum0 = 18;
            break;
          }
          case 'no-device': {
            enum0 = 19;
            break;
          }
          case 'no-entry': {
            enum0 = 20;
            break;
          }
          case 'no-lock': {
            enum0 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum0 = 22;
            break;
          }
          case 'insufficient-space': {
            enum0 = 23;
            break;
          }
          case 'not-directory': {
            enum0 = 24;
            break;
          }
          case 'not-empty': {
            enum0 = 25;
            break;
          }
          case 'not-recoverable': {
            enum0 = 26;
            break;
          }
          case 'unsupported': {
            enum0 = 27;
            break;
          }
          case 'no-tty': {
            enum0 = 28;
            break;
          }
          case 'no-such-device': {
            enum0 = 29;
            break;
          }
          case 'overflow': {
            enum0 = 30;
            break;
          }
          case 'not-permitted': {
            enum0 = 31;
            break;
          }
          case 'pipe': {
            enum0 = 32;
            break;
          }
          case 'read-only': {
            enum0 = 33;
            break;
          }
          case 'invalid-seek': {
            enum0 = 34;
            break;
          }
          case 'text-file-busy': {
            enum0 = 35;
            break;
          }
          case 'cross-device': {
            enum0 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val0}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg2 + 4, enum0, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline35(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: appendViaStream(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant1 = ret;
    switch (variant1.tag) {
      case 'ok': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setInt32(arg1 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant1.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        const val0 = e;
        let enum0;
        switch (val0) {
          case 'access': {
            enum0 = 0;
            break;
          }
          case 'would-block': {
            enum0 = 1;
            break;
          }
          case 'already': {
            enum0 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum0 = 3;
            break;
          }
          case 'busy': {
            enum0 = 4;
            break;
          }
          case 'deadlock': {
            enum0 = 5;
            break;
          }
          case 'quota': {
            enum0 = 6;
            break;
          }
          case 'exist': {
            enum0 = 7;
            break;
          }
          case 'file-too-large': {
            enum0 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum0 = 9;
            break;
          }
          case 'in-progress': {
            enum0 = 10;
            break;
          }
          case 'interrupted': {
            enum0 = 11;
            break;
          }
          case 'invalid': {
            enum0 = 12;
            break;
          }
          case 'io': {
            enum0 = 13;
            break;
          }
          case 'is-directory': {
            enum0 = 14;
            break;
          }
          case 'loop': {
            enum0 = 15;
            break;
          }
          case 'too-many-links': {
            enum0 = 16;
            break;
          }
          case 'message-size': {
            enum0 = 17;
            break;
          }
          case 'name-too-long': {
            enum0 = 18;
            break;
          }
          case 'no-device': {
            enum0 = 19;
            break;
          }
          case 'no-entry': {
            enum0 = 20;
            break;
          }
          case 'no-lock': {
            enum0 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum0 = 22;
            break;
          }
          case 'insufficient-space': {
            enum0 = 23;
            break;
          }
          case 'not-directory': {
            enum0 = 24;
            break;
          }
          case 'not-empty': {
            enum0 = 25;
            break;
          }
          case 'not-recoverable': {
            enum0 = 26;
            break;
          }
          case 'unsupported': {
            enum0 = 27;
            break;
          }
          case 'no-tty': {
            enum0 = 28;
            break;
          }
          case 'no-such-device': {
            enum0 = 29;
            break;
          }
          case 'overflow': {
            enum0 = 30;
            break;
          }
          case 'not-permitted': {
            enum0 = 31;
            break;
          }
          case 'pipe': {
            enum0 = 32;
            break;
          }
          case 'read-only': {
            enum0 = 33;
            break;
          }
          case 'invalid-seek': {
            enum0 = 34;
            break;
          }
          case 'text-file-busy': {
            enum0 = 35;
            break;
          }
          case 'cross-device': {
            enum0 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val0}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 4, enum0, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline36(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: getType(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant2 = ret;
    switch (variant2.tag) {
      case 'ok': {
        const e = variant2.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        const val0 = e;
        let enum0;
        switch (val0) {
          case 'unknown': {
            enum0 = 0;
            break;
          }
          case 'block-device': {
            enum0 = 1;
            break;
          }
          case 'character-device': {
            enum0 = 2;
            break;
          }
          case 'directory': {
            enum0 = 3;
            break;
          }
          case 'fifo': {
            enum0 = 4;
            break;
          }
          case 'symbolic-link': {
            enum0 = 5;
            break;
          }
          case 'regular-file': {
            enum0 = 6;
            break;
          }
          case 'socket': {
            enum0 = 7;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val0}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 1, enum0, true);
        break;
      }
      case 'err': {
        const e = variant2.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        const val1 = e;
        let enum1;
        switch (val1) {
          case 'access': {
            enum1 = 0;
            break;
          }
          case 'would-block': {
            enum1 = 1;
            break;
          }
          case 'already': {
            enum1 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum1 = 3;
            break;
          }
          case 'busy': {
            enum1 = 4;
            break;
          }
          case 'deadlock': {
            enum1 = 5;
            break;
          }
          case 'quota': {
            enum1 = 6;
            break;
          }
          case 'exist': {
            enum1 = 7;
            break;
          }
          case 'file-too-large': {
            enum1 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum1 = 9;
            break;
          }
          case 'in-progress': {
            enum1 = 10;
            break;
          }
          case 'interrupted': {
            enum1 = 11;
            break;
          }
          case 'invalid': {
            enum1 = 12;
            break;
          }
          case 'io': {
            enum1 = 13;
            break;
          }
          case 'is-directory': {
            enum1 = 14;
            break;
          }
          case 'loop': {
            enum1 = 15;
            break;
          }
          case 'too-many-links': {
            enum1 = 16;
            break;
          }
          case 'message-size': {
            enum1 = 17;
            break;
          }
          case 'name-too-long': {
            enum1 = 18;
            break;
          }
          case 'no-device': {
            enum1 = 19;
            break;
          }
          case 'no-entry': {
            enum1 = 20;
            break;
          }
          case 'no-lock': {
            enum1 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum1 = 22;
            break;
          }
          case 'insufficient-space': {
            enum1 = 23;
            break;
          }
          case 'not-directory': {
            enum1 = 24;
            break;
          }
          case 'not-empty': {
            enum1 = 25;
            break;
          }
          case 'not-recoverable': {
            enum1 = 26;
            break;
          }
          case 'unsupported': {
            enum1 = 27;
            break;
          }
          case 'no-tty': {
            enum1 = 28;
            break;
          }
          case 'no-such-device': {
            enum1 = 29;
            break;
          }
          case 'overflow': {
            enum1 = 30;
            break;
          }
          case 'not-permitted': {
            enum1 = 31;
            break;
          }
          case 'pipe': {
            enum1 = 32;
            break;
          }
          case 'read-only': {
            enum1 = 33;
            break;
          }
          case 'invalid-seek': {
            enum1 = 34;
            break;
          }
          case 'text-file-busy': {
            enum1 = 35;
            break;
          }
          case 'cross-device': {
            enum1 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val1}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 1, enum1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline37(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: stat(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        const {type: v0_0, linkCount: v0_1, size: v0_2, dataAccessTimestamp: v0_3, dataModificationTimestamp: v0_4, statusChangeTimestamp: v0_5 } = e;
        const val1 = v0_0;
        let enum1;
        switch (val1) {
          case 'unknown': {
            enum1 = 0;
            break;
          }
          case 'block-device': {
            enum1 = 1;
            break;
          }
          case 'character-device': {
            enum1 = 2;
            break;
          }
          case 'directory': {
            enum1 = 3;
            break;
          }
          case 'fifo': {
            enum1 = 4;
            break;
          }
          case 'symbolic-link': {
            enum1 = 5;
            break;
          }
          case 'regular-file': {
            enum1 = 6;
            break;
          }
          case 'socket': {
            enum1 = 7;
            break;
          }
          default: {
            if ((v0_0) instanceof Error) {
              console.error(v0_0);
            }
            
            throw new TypeError(`"${val1}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum1, true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v0_1), true);
        dataView(memory0).setBigInt64(arg1 + 24, toUint64(v0_2), true);
        const {seconds: v2_0, nanoseconds: v2_1 } = v0_3;
        dataView(memory0).setBigInt64(arg1 + 32, toUint64(v2_0), true);
        dataView(memory0).setInt32(arg1 + 40, toUint32(v2_1), true);
        const {seconds: v3_0, nanoseconds: v3_1 } = v0_4;
        dataView(memory0).setBigInt64(arg1 + 48, toUint64(v3_0), true);
        dataView(memory0).setInt32(arg1 + 56, toUint32(v3_1), true);
        const {seconds: v4_0, nanoseconds: v4_1 } = v0_5;
        dataView(memory0).setBigInt64(arg1 + 64, toUint64(v4_0), true);
        dataView(memory0).setInt32(arg1 + 72, toUint32(v4_1), true);
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        const val5 = e;
        let enum5;
        switch (val5) {
          case 'access': {
            enum5 = 0;
            break;
          }
          case 'would-block': {
            enum5 = 1;
            break;
          }
          case 'already': {
            enum5 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum5 = 3;
            break;
          }
          case 'busy': {
            enum5 = 4;
            break;
          }
          case 'deadlock': {
            enum5 = 5;
            break;
          }
          case 'quota': {
            enum5 = 6;
            break;
          }
          case 'exist': {
            enum5 = 7;
            break;
          }
          case 'file-too-large': {
            enum5 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum5 = 9;
            break;
          }
          case 'in-progress': {
            enum5 = 10;
            break;
          }
          case 'interrupted': {
            enum5 = 11;
            break;
          }
          case 'invalid': {
            enum5 = 12;
            break;
          }
          case 'io': {
            enum5 = 13;
            break;
          }
          case 'is-directory': {
            enum5 = 14;
            break;
          }
          case 'loop': {
            enum5 = 15;
            break;
          }
          case 'too-many-links': {
            enum5 = 16;
            break;
          }
          case 'message-size': {
            enum5 = 17;
            break;
          }
          case 'name-too-long': {
            enum5 = 18;
            break;
          }
          case 'no-device': {
            enum5 = 19;
            break;
          }
          case 'no-entry': {
            enum5 = 20;
            break;
          }
          case 'no-lock': {
            enum5 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum5 = 22;
            break;
          }
          case 'insufficient-space': {
            enum5 = 23;
            break;
          }
          case 'not-directory': {
            enum5 = 24;
            break;
          }
          case 'not-empty': {
            enum5 = 25;
            break;
          }
          case 'not-recoverable': {
            enum5 = 26;
            break;
          }
          case 'unsupported': {
            enum5 = 27;
            break;
          }
          case 'no-tty': {
            enum5 = 28;
            break;
          }
          case 'no-such-device': {
            enum5 = 29;
            break;
          }
          case 'overflow': {
            enum5 = 30;
            break;
          }
          case 'not-permitted': {
            enum5 = 31;
            break;
          }
          case 'pipe': {
            enum5 = 32;
            break;
          }
          case 'read-only': {
            enum5 = 33;
            break;
          }
          case 'invalid-seek': {
            enum5 = 34;
            break;
          }
          case 'text-file-busy': {
            enum5 = 35;
            break;
          }
          case 'cross-device': {
            enum5 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val5}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum5, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline38(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    const flags0 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    const ptr1 = arg2;
    const len1 = arg3;
    const result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
    if ((arg4 & 4294967280) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    const flags2 = {
      create: Boolean(arg4 & 1),
      directory: Boolean(arg4 & 2),
      exclusive: Boolean(arg4 & 4),
      truncate: Boolean(arg4 & 8),
    };
    if ((arg5 & 4294967232) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    const flags3 = {
      read: Boolean(arg5 & 1),
      write: Boolean(arg5 & 2),
      fileIntegritySync: Boolean(arg5 & 4),
      dataIntegritySync: Boolean(arg5 & 8),
      requestedWriteSync: Boolean(arg5 & 16),
      mutateDirectory: Boolean(arg5 & 32),
    };
    if ((arg6 & 4294967288) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    const flags4 = {
      readable: Boolean(arg6 & 1),
      writable: Boolean(arg6 & 2),
      executable: Boolean(arg6 & 4),
    };
    let ret;
    try {
      ret = { tag: 'ok', val: openAt(arg0 >>> 0, flags0, result1, flags2, flags3, flags4) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg7 + 0, 0, true);
        dataView(memory0).setInt32(arg7 + 4, toUint32(e), true);
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg7 + 0, 1, true);
        const val5 = e;
        let enum5;
        switch (val5) {
          case 'access': {
            enum5 = 0;
            break;
          }
          case 'would-block': {
            enum5 = 1;
            break;
          }
          case 'already': {
            enum5 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum5 = 3;
            break;
          }
          case 'busy': {
            enum5 = 4;
            break;
          }
          case 'deadlock': {
            enum5 = 5;
            break;
          }
          case 'quota': {
            enum5 = 6;
            break;
          }
          case 'exist': {
            enum5 = 7;
            break;
          }
          case 'file-too-large': {
            enum5 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum5 = 9;
            break;
          }
          case 'in-progress': {
            enum5 = 10;
            break;
          }
          case 'interrupted': {
            enum5 = 11;
            break;
          }
          case 'invalid': {
            enum5 = 12;
            break;
          }
          case 'io': {
            enum5 = 13;
            break;
          }
          case 'is-directory': {
            enum5 = 14;
            break;
          }
          case 'loop': {
            enum5 = 15;
            break;
          }
          case 'too-many-links': {
            enum5 = 16;
            break;
          }
          case 'message-size': {
            enum5 = 17;
            break;
          }
          case 'name-too-long': {
            enum5 = 18;
            break;
          }
          case 'no-device': {
            enum5 = 19;
            break;
          }
          case 'no-entry': {
            enum5 = 20;
            break;
          }
          case 'no-lock': {
            enum5 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum5 = 22;
            break;
          }
          case 'insufficient-space': {
            enum5 = 23;
            break;
          }
          case 'not-directory': {
            enum5 = 24;
            break;
          }
          case 'not-empty': {
            enum5 = 25;
            break;
          }
          case 'not-recoverable': {
            enum5 = 26;
            break;
          }
          case 'unsupported': {
            enum5 = 27;
            break;
          }
          case 'no-tty': {
            enum5 = 28;
            break;
          }
          case 'no-such-device': {
            enum5 = 29;
            break;
          }
          case 'overflow': {
            enum5 = 30;
            break;
          }
          case 'not-permitted': {
            enum5 = 31;
            break;
          }
          case 'pipe': {
            enum5 = 32;
            break;
          }
          case 'read-only': {
            enum5 = 33;
            break;
          }
          case 'invalid-seek': {
            enum5 = 34;
            break;
          }
          case 'text-file-busy': {
            enum5 = 35;
            break;
          }
          case 'cross-device': {
            enum5 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val5}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg7 + 4, enum5, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline39(arg0, arg1) {
    let ret;
    try {
      ret = { tag: 'ok', val: metadataHash(arg0 >>> 0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant2 = ret;
    switch (variant2.tag) {
      case 'ok': {
        const e = variant2.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        const {lower: v0_0, upper: v0_1 } = e;
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(v0_0), true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v0_1), true);
        break;
      }
      case 'err': {
        const e = variant2.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        const val1 = e;
        let enum1;
        switch (val1) {
          case 'access': {
            enum1 = 0;
            break;
          }
          case 'would-block': {
            enum1 = 1;
            break;
          }
          case 'already': {
            enum1 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum1 = 3;
            break;
          }
          case 'busy': {
            enum1 = 4;
            break;
          }
          case 'deadlock': {
            enum1 = 5;
            break;
          }
          case 'quota': {
            enum1 = 6;
            break;
          }
          case 'exist': {
            enum1 = 7;
            break;
          }
          case 'file-too-large': {
            enum1 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum1 = 9;
            break;
          }
          case 'in-progress': {
            enum1 = 10;
            break;
          }
          case 'interrupted': {
            enum1 = 11;
            break;
          }
          case 'invalid': {
            enum1 = 12;
            break;
          }
          case 'io': {
            enum1 = 13;
            break;
          }
          case 'is-directory': {
            enum1 = 14;
            break;
          }
          case 'loop': {
            enum1 = 15;
            break;
          }
          case 'too-many-links': {
            enum1 = 16;
            break;
          }
          case 'message-size': {
            enum1 = 17;
            break;
          }
          case 'name-too-long': {
            enum1 = 18;
            break;
          }
          case 'no-device': {
            enum1 = 19;
            break;
          }
          case 'no-entry': {
            enum1 = 20;
            break;
          }
          case 'no-lock': {
            enum1 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum1 = 22;
            break;
          }
          case 'insufficient-space': {
            enum1 = 23;
            break;
          }
          case 'not-directory': {
            enum1 = 24;
            break;
          }
          case 'not-empty': {
            enum1 = 25;
            break;
          }
          case 'not-recoverable': {
            enum1 = 26;
            break;
          }
          case 'unsupported': {
            enum1 = 27;
            break;
          }
          case 'no-tty': {
            enum1 = 28;
            break;
          }
          case 'no-such-device': {
            enum1 = 29;
            break;
          }
          case 'overflow': {
            enum1 = 30;
            break;
          }
          case 'not-permitted': {
            enum1 = 31;
            break;
          }
          case 'pipe': {
            enum1 = 32;
            break;
          }
          case 'read-only': {
            enum1 = 33;
            break;
          }
          case 'invalid-seek': {
            enum1 = 34;
            break;
          }
          case 'text-file-busy': {
            enum1 = 35;
            break;
          }
          case 'cross-device': {
            enum1 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val1}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline40(arg0, arg1) {
    const ret = getRandomBytes(BigInt.asUintN(64, arg0));
    const val0 = ret;
    const len0 = val0.byteLength;
    const ptr0 = realloc1(0, 0, 1, len0 * 1);
    const src0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, len0 * 1);
    (new Uint8Array(memory0.buffer, ptr0, len0 * 1)).set(src0);
    dataView(memory0).setInt32(arg1 + 4, len0, true);
    dataView(memory0).setInt32(arg1 + 0, ptr0, true);
  }
  
  function trampoline41(arg0) {
    const ret = getEnvironment();
    const vec3 = ret;
    const len3 = vec3.length;
    const result3 = realloc1(0, 0, 4, len3 * 16);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 16;const [tuple0_0, tuple0_1] = e;
      const ptr1 = utf8Encode(tuple0_0, realloc1, memory0);
      const len1 = utf8EncodedLen;
      dataView(memory0).setInt32(base + 4, len1, true);
      dataView(memory0).setInt32(base + 0, ptr1, true);
      const ptr2 = utf8Encode(tuple0_1, realloc1, memory0);
      const len2 = utf8EncodedLen;
      dataView(memory0).setInt32(base + 12, len2, true);
      dataView(memory0).setInt32(base + 8, ptr2, true);
    }
    dataView(memory0).setInt32(arg0 + 4, len3, true);
    dataView(memory0).setInt32(arg0 + 0, result3, true);
  }
  
  function trampoline42(arg0) {
    const ret = getArguments();
    const vec1 = ret;
    const len1 = vec1.length;
    const result1 = realloc1(0, 0, 4, len1 * 8);
    for (let i = 0; i < vec1.length; i++) {
      const e = vec1[i];
      const base = result1 + i * 8;const ptr0 = utf8Encode(e, realloc1, memory0);
      const len0 = utf8EncodedLen;
      dataView(memory0).setInt32(base + 4, len0, true);
      dataView(memory0).setInt32(base + 0, ptr0, true);
    }
    dataView(memory0).setInt32(arg0 + 4, len1, true);
    dataView(memory0).setInt32(arg0 + 0, result1, true);
  }
  
  function trampoline43(arg0, arg1, arg2) {
    let ret;
    try {
      ret = { tag: 'ok', val: read(arg0 >>> 0, BigInt.asUintN(64, arg1)) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        const [tuple0_0, tuple0_1] = e;
        const val1 = tuple0_0;
        const len1 = val1.byteLength;
        const ptr1 = realloc1(0, 0, 1, len1 * 1);
        const src1 = new Uint8Array(val1.buffer || val1, val1.byteOffset, len1 * 1);
        (new Uint8Array(memory0.buffer, ptr1, len1 * 1)).set(src1);
        dataView(memory0).setInt32(arg2 + 8, len1, true);
        dataView(memory0).setInt32(arg2 + 4, ptr1, true);
        const val2 = tuple0_1;
        let enum2;
        switch (val2) {
          case 'open': {
            enum2 = 0;
            break;
          }
          case 'ended': {
            enum2 = 1;
            break;
          }
          default: {
            if ((tuple0_1) instanceof Error) {
              console.error(tuple0_1);
            }
            
            throw new TypeError(`"${val2}" is not one of the cases of stream-status`);
          }
        }
        dataView(memory0).setInt8(arg2 + 12, enum2, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline44(arg0, arg1, arg2) {
    let ret;
    try {
      ret = { tag: 'ok', val: blockingRead(arg0 >>> 0, BigInt.asUintN(64, arg1)) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        const [tuple0_0, tuple0_1] = e;
        const val1 = tuple0_0;
        const len1 = val1.byteLength;
        const ptr1 = realloc1(0, 0, 1, len1 * 1);
        const src1 = new Uint8Array(val1.buffer || val1, val1.byteOffset, len1 * 1);
        (new Uint8Array(memory0.buffer, ptr1, len1 * 1)).set(src1);
        dataView(memory0).setInt32(arg2 + 8, len1, true);
        dataView(memory0).setInt32(arg2 + 4, ptr1, true);
        const val2 = tuple0_1;
        let enum2;
        switch (val2) {
          case 'open': {
            enum2 = 0;
            break;
          }
          case 'ended': {
            enum2 = 1;
            break;
          }
          default: {
            if ((tuple0_1) instanceof Error) {
              console.error(tuple0_1);
            }
            
            throw new TypeError(`"${val2}" is not one of the cases of stream-status`);
          }
        }
        dataView(memory0).setInt8(arg2 + 12, enum2, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline45(arg0, arg1, arg2, arg3) {
    const ptr0 = arg1;
    const len0 = arg2;
    const result0 = new Uint8Array(memory0.buffer.slice(ptr0, ptr0 + len0 * 1));
    let ret;
    try {
      ret = { tag: 'ok', val: blockingWrite(arg0 >>> 0, result0) };
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    const variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        const [tuple1_0, tuple1_1] = e;
        dataView(memory0).setBigInt64(arg3 + 8, toUint64(tuple1_0), true);
        const val2 = tuple1_1;
        let enum2;
        switch (val2) {
          case 'open': {
            enum2 = 0;
            break;
          }
          case 'ended': {
            enum2 = 1;
            break;
          }
          default: {
            if ((tuple1_1) instanceof Error) {
              console.error(tuple1_1);
            }
            
            throw new TypeError(`"${val2}" is not one of the cases of stream-status`);
          }
        }
        dataView(memory0).setInt8(arg3 + 16, enum2, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
  }
  
  function trampoline46(arg0) {
    const ret = getTerminalStdin();
    const variant0 = ret;
    if (variant0 === null || variant0=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant0;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      dataView(memory0).setInt32(arg0 + 4, toUint32(e), true);
    }
  }
  
  function trampoline47(arg0) {
    const ret = getTerminalStdout();
    const variant0 = ret;
    if (variant0 === null || variant0=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant0;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      dataView(memory0).setInt32(arg0 + 4, toUint32(e), true);
    }
  }
  
  function trampoline48(arg0) {
    const ret = getTerminalStderr();
    const variant0 = ret;
    if (variant0 === null || variant0=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant0;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      dataView(memory0).setInt32(arg0 + 4, toUint32(e), true);
    }
  }
  let exports3;
  const instanceFlags0 = new WebAssembly.Global({ value: "i32", mutable: true }, 3);
  const instanceFlags1 = new WebAssembly.Global({ value: "i32", mutable: true }, 3);
  Promise.all([module0, module1, module2, module3]).catch(() => {});
  ({ exports: exports0 } = await instantiateCore(await module2));
  ({ exports: exports1 } = await instantiateCore(await module0, {
    'wasi:http/outgoing-handler': {
      handle: trampoline2,
    },
    'wasi:http/types': {
      'drop-fields': trampoline9,
      'drop-future-incoming-response': trampoline4,
      'drop-incoming-response': trampoline10,
      'drop-outgoing-request': trampoline12,
      'fields-entries': exports0['1'],
      'future-incoming-response-get': exports0['5'],
      'incoming-response-consume': exports0['4'],
      'incoming-response-headers': trampoline8,
      'incoming-response-status': trampoline5,
      'listen-to-future-incoming-response': trampoline3,
      'new-fields': exports0['0'],
      'new-outgoing-request': exports0['2'],
      'outgoing-request-write': exports0['3'],
    },
    'wasi:io/streams': {
      'drop-input-stream': trampoline7,
      'drop-output-stream': trampoline11,
      read: exports0['6'],
      'subscribe-to-input-stream': trampoline6,
      'subscribe-to-output-stream': trampoline0,
      write: exports0['7'],
    },
    'wasi:poll/poll': {
      'drop-pollable': trampoline1,
      'poll-oneoff': exports0['8'],
    },
    wasi_snapshot_preview1: {
      args_get: exports0['29'],
      args_sizes_get: exports0['28'],
      clock_time_get: exports0['35'],
      environ_get: exports0['37'],
      environ_sizes_get: exports0['38'],
      fd_close: exports0['39'],
      fd_filestat_get: exports0['33'],
      fd_prestat_dir_name: exports0['41'],
      fd_prestat_get: exports0['40'],
      fd_read: exports0['34'],
      fd_write: exports0['31'],
      path_open: exports0['32'],
      proc_exit: exports0['42'],
      random_get: exports0['36'],
      sched_yield: exports0['30'],
    },
  }));
  ({ exports: exports2 } = await instantiateCore(await module1, {
    __main_module__: {
      cabi_realloc: exports1.cabi_realloc,
    },
    env: {
      memory: exports1.memory,
    },
    'wasi:cli/environment': {
      'get-arguments': exports0['20'],
      'get-environment': exports0['19'],
    },
    'wasi:cli/exit': {
      exit: trampoline21,
    },
    'wasi:cli/stderr': {
      'get-stderr': trampoline20,
    },
    'wasi:cli/stdin': {
      'get-stdin': trampoline16,
    },
    'wasi:cli/stdout': {
      'get-stdout': trampoline18,
    },
    'wasi:cli/terminal-input': {
      'drop-terminal-input': trampoline17,
    },
    'wasi:cli/terminal-output': {
      'drop-terminal-output': trampoline19,
    },
    'wasi:cli/terminal-stderr': {
      'get-terminal-stderr': exports0['27'],
    },
    'wasi:cli/terminal-stdin': {
      'get-terminal-stdin': exports0['25'],
    },
    'wasi:cli/terminal-stdout': {
      'get-terminal-stdout': exports0['26'],
    },
    'wasi:clocks/monotonic-clock': {
      now: trampoline13,
    },
    'wasi:clocks/wall-clock': {
      now: exports0['10'],
    },
    'wasi:filesystem/preopens': {
      'get-directories': exports0['9'],
    },
    'wasi:filesystem/types': {
      'append-via-stream': exports0['13'],
      'drop-descriptor': trampoline15,
      'drop-directory-entry-stream': trampoline14,
      'get-type': exports0['14'],
      'metadata-hash': exports0['17'],
      'open-at': exports0['16'],
      'read-via-stream': exports0['11'],
      stat: exports0['15'],
      'write-via-stream': exports0['12'],
    },
    'wasi:io/streams': {
      'blocking-read': exports0['22'],
      'blocking-write': exports0['24'],
      'drop-input-stream': trampoline7,
      'drop-output-stream': trampoline11,
      read: exports0['21'],
      write: exports0['23'],
    },
    'wasi:random/random': {
      'get-random-bytes': exports0['18'],
    },
  }));
  memory0 = exports1.memory;
  realloc0 = exports1.cabi_realloc;
  realloc1 = exports2.cabi_import_realloc;
  ({ exports: exports3 } = await instantiateCore(await module3, {
    '': {
      $imports: exports0.$imports,
      '0': trampoline22,
      '1': trampoline23,
      '10': trampoline32,
      '11': trampoline33,
      '12': trampoline34,
      '13': trampoline35,
      '14': trampoline36,
      '15': trampoline37,
      '16': trampoline38,
      '17': trampoline39,
      '18': trampoline40,
      '19': trampoline41,
      '2': trampoline24,
      '20': trampoline42,
      '21': trampoline43,
      '22': trampoline44,
      '23': trampoline29,
      '24': trampoline45,
      '25': trampoline46,
      '26': trampoline47,
      '27': trampoline48,
      '28': exports2.args_sizes_get,
      '29': exports2.args_get,
      '3': trampoline25,
      '30': exports2.sched_yield,
      '31': exports2.fd_write,
      '32': exports2.path_open,
      '33': exports2.fd_filestat_get,
      '34': exports2.fd_read,
      '35': exports2.clock_time_get,
      '36': exports2.random_get,
      '37': exports2.environ_get,
      '38': exports2.environ_sizes_get,
      '39': exports2.fd_close,
      '4': trampoline26,
      '40': exports2.fd_prestat_get,
      '41': exports2.fd_prestat_dir_name,
      '42': exports2.proc_exit,
      '5': trampoline27,
      '6': trampoline28,
      '7': trampoline29,
      '8': trampoline30,
      '9': trampoline31,
    },
  }));
  
  function run() {
    const ret = exports1['wasi:cli/run#run']();
    let variant0;
    switch (ret) {
      case 0: {
        variant0= {
          tag: 'ok',
          val: undefined
        };
        break;
      }
      case 1: {
        variant0= {
          tag: 'err',
          val: undefined
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    if (variant0.tag === 'err') {
      throw new ComponentError(variant0.val);
    }
    return variant0.val;
  }
  const run$1 = {
    run: run,
    
  };
  
  return { run: run$1, 'wasi:cli/run': run$1 };
}
