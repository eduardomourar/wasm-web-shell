"use components";
export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
  
  const emptyFunc = () => {};
  
  let dv = new DataView(new ArrayBuffer());
  const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
  
  function toUint64(val) {
    const converted = BigInt(val)
    
    return BigInt.asUintN(64, converted);
  }
  
  
  function toUint16(val) {
    
    val >>>= 0;
    val %= 2 ** 16;
    return val;
  }
  
  
  function toUint32(val) {
    
    return val >>> 0;
  }
  
  
  function toUint8(val) {
    
    val >>>= 0;
    val %= 2 ** 8;
    return val;
  }
  
  
  function _isValidNumericPrimitive(ty, v) {
    if (v === undefined || v === null) { return false; }
    switch (ty) {
      case 'bool':
      return v === 0 || v === 1;
      break;
      case 'u8':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
      break;
      case 's8':
      return typeof v === 'number' && Number.isInteger(v) && v >= -128 && v <= 127;
      break;
      case 'u16':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535;
      break;
      case 's16':
      return typeof v === 'number' && Number.isInteger(v) && v >= -32768 && v <= 32767;
      case 'u32':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4_294_967_295;
      case 's32':
      return typeof v === 'number' && Number.isInteger(v) && v >= -2_147_483_648 && v <= 2_147_483_647;
      case 'u64':
      return typeof v === 'bigint' && v >= 0 && v <= 18_446_744_073_709_551_615n;
      case 's64':
      return typeof v === 'bigint' && v >= -9223372036854775808n && v <= 9223372036854775807n;
      break;
      case 'f32':
      case 'f64': return typeof v === 'number';
      default:
      return false;
    }
    return true;
  }
  
  function _requireValidNumericPrimitive(ty, v) {
    if (v === undefined  || v === null || !_isValidNumericPrimitive(ty, v)) {
      throw new TypeError(`invalid ${ty} value [${v}]`);
    }
    return true;
  }
  const utf16Decoder = new TextDecoder('utf-16');
  
  const isLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  
  function _utf16AllocateAndEncode(str, realloc, memory) {
    const len = str.length;
    const ptr = realloc(0, 0, 2, len * 2);
    const out = new Uint16Array(memory.buffer, ptr, len);
    let i = 0;
    if (isLE) {
      while (i < len) { out[i] = str.charCodeAt(i++); }
    } else {
      while (i < len) {
        const ch = str.charCodeAt(i);
        out[i++] = (ch & 0xff) << 8 | ch >>> 8;
      }
    }
    return { ptr, len, codepoints: [...str].length };
  }
  
  const TEXT_DECODER_UTF8 = new TextDecoder();
  const TEXT_ENCODER_UTF8 = new TextEncoder();
  
  function _utf8AllocateAndEncode(s, realloc, memory) {
    if (typeof s !== 'string') {
      throw new TypeError('expected a string, received [' + typeof s + ']');
    }
    if (s.length === 0) { return { ptr: 1, len: 0 }; }
    // Compute the exact allocation size up front. Some older preview1
    // adapters only support an initial allocation, not a subsequent shrink.
    let len = 0;
    let codepoints = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      codepoints++;
      if (ch < 0x80) { len += 1; }
      else if (ch < 0x800) { len += 2; }
      else if (ch >= 0xd800 && ch <= 0xdbff &&
      i + 1 < s.length &&
      (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        len += 4;
        i++;
      } else { len += 3; }
    }
    const ptr = realloc(0, 0, 1, len);
    const { read, written } = TEXT_ENCODER_UTF8.encodeInto(
    s,
    new Uint8Array(memory.buffer, ptr, len),
    );
    if (read !== s.length || written !== len) {
      throw new Error('failed to encode whole string');
    }
    const res = { ptr, len, codepoints };
    return res;
  }
  
  const T_FLAG = 1 << 30;
  
  function rscTableCreateOwn(table, rep) {
    const free = table[0] & ~T_FLAG;
    table._createdReps.add(rep);
    if (free === 0) {
      table.push(0);
      table.push(rep | T_FLAG);
      return (table.length >> 1) - 1;
    }
    table[0] = table[free << 1];
    table[free << 1] = 0;
    table[(free << 1) + 1] = rep | T_FLAG;
    return free;
  }
  
  
  function rscTableRemove(table, handle) {
    const scope = table[handle << 1];
    const val = table[(handle << 1) + 1];
    const own = (val & T_FLAG) !== 0;
    const rep = val & ~T_FLAG;
    if (val === 0 || (scope & T_FLAG) !== 0) {
      throw new TypeError("Invalid handle");
    }
    table[handle << 1] = table[0] | T_FLAG;
    table[0] = handle | T_FLAG;
    return { rep, scope, own };
  }
  
  
  let curResourceBorrows = [];
  const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
  const ASYNC_CURRENT_COMPONENT_IDXS = [];
  
  function getCurrentTask(componentIdx, taskID) {
    let usedGlobal = false;
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing component idx'); // TODO(fix)
      // componentIdx = ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
      // usedGlobal = true;
    }
    
    const taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (taskMetas === undefined || taskMetas.length === 0) { return undefined; }
    
    if (taskID) {
      return taskMetas.find(meta => meta.task.id() === taskID);
    }
    
    const taskMeta = taskMetas[taskMetas.length - 1];
    if (!taskMeta || !taskMeta.task) { return undefined; }
    
    return taskMeta;
  }
  const ASYNC_CURRENT_TASK_IDS = [];
  
  const _debugLog = (...args) => {
    if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
    console.debug(...args);
  };
  
  function clearCurrentTask(componentIdx, taskID) {
    _debugLog('[clearCurrentTask()] args', { componentIdx, taskID });
    
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while ending current task');
    }
    
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('missing/invalid tasks for component instance while ending task');
    }
    if (tasks.length == 0) {
      throw new Error(`no current tasks for component instance [${componentIdx}] while ending task`);
    }
    
    if (taskID !== undefined) {
      const last = tasks[tasks.length - 1];
      if (last.id !== taskID) {
        // throw new Error('current task does not match expected task ID');
        return;
      }
    }
    
    ASYNC_CURRENT_TASK_IDS.pop();
    ASYNC_CURRENT_COMPONENT_IDXS.pop();
    
    const taskMeta = tasks.pop();
    return taskMeta.task;
  }
  const ASYNC_STATE = new Map();
  
  function promiseWithResolvers() {
    if (Promise.withResolvers) {
      return Promise.withResolvers();
    } else {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
  }
  
  class Waitable {
    #componentIdx;
    
    #pendingEventFn = null;
    
    #promise;
    #resolve;
    #reject;
    
    #waitableSet = null;
    
    #hasSyncWaiter = false;
    
    #idx = null; // to component-global waitables
    
    target;
    
    constructor(args) {
      const { componentIdx, target } = args;
      this.#componentIdx = componentIdx;
      this.target = args.target;
      this.#resetPromise();
    }
    
    componentIdx() { return this.#componentIdx; }
    isInSet() { return this.#waitableSet !== null; }
    
    idx() { return this.#idx; }
    setIdx(idx) {
      if (idx === 0) { throw new Error("waitable idx cannot be zero"); }
      this.#idx = idx;
    }
    
    setTarget(tgt) { this.target = tgt; }
    
    #resetPromise() {
      const { promise, resolve, reject } = promiseWithResolvers()
      this.#promise = promise;
      this.#resolve = resolve;
      this.#reject = reject;
    }
    
    resolve() { this.#resolve(); }
    reject(err) { this.#reject(err); }
    promise() { return this.#promise; }
    
    hasPendingEvent() {
      // _debugLog('[Waitable#hasPendingEvent()]', {
        //     componentIdx: this.#componentIdx,
        //     waitable: this,
        //     waitableSet: this.#waitableSet,
        //     hasPendingEvent: this.#pendingEventFn !== null,
        // });
        return this.#pendingEventFn !== null;
      }
      
      setPendingEvent(fn) {
        _debugLog('[Waitable#setPendingEvent()] args', {
          waitable: this,
          inSet: this.#waitableSet,
        });
        this.#pendingEventFn = fn;
      }
      
      getPendingEvent() {
        _debugLog('[Waitable#getPendingEvent()] args', {
          waitable: this,
          inSet: this.#waitableSet,
          hasPendingEvent: this.#pendingEventFn !== null,
        });
        if (this.#pendingEventFn === null) { return null; }
        const eventFn = this.#pendingEventFn;
        this.#pendingEventFn = null;
        const e = eventFn();
        this.#resetPromise();
        return e;
      }
      
      join(waitableSet) {
        _debugLog('[Waitable#join()] args', {
          waitable: this,
          waitableSet: waitableSet,
          isRemoval: waitableSet === null,
        });
        
        if (this.#waitableSet === undefined) {
          throw new TypeError('waitable set must be not be undefined');
        }
        
        if (this.#waitableSet) {
          this.#waitableSet.removeWaitable(this);
        }
        
        this.#waitableSet = waitableSet;
        
        if (waitableSet) {
          this.#waitableSet.addWaitable(this);
        }
      }
      
      drop() {
        _debugLog('[Waitable#drop()] args', {
          componentIdx: this.#componentIdx,
          waitable: this,
        });
        if (this.hasPendingEvent()) {
          throw new Error('waitables with pending events cannot be dropped');
        }
        this.join(null);
      }
      
      async waitForPendingEvent(args) {
        const { cstate } = args;
        if (!cstate) { throw new TypeError('missing component state'); }
        
        if (this.#waitableSet !== null || this.#hasSyncWaiter) {
          throw new Error("waitable is already in a set/has a sync waiter");
        }
        this.#hasSyncWaiter = true;
        await cstate.waitUntil({
          cancellable: false,
          readyFn: () => this.hasPendingEvent(),
        });
        this.#hasSyncWaiter = false;
      }
      
    }
    const INSTANCE_FLAGS = new Map();
    const STORE_TRAP = { error: null };
    const WebAssemblyRuntimeError = WebAssembly.RuntimeError;
    
    class RepTable {
      // Sentinel marking a freed slot; the freelist link for a freed slot
      // lives in the odd cell. This keeps get()/contains()/remove() on freed
      // reps well-defined (previously they returned/corrupted freelist links).
      static FREE = Symbol('RepTable.free');
      
      #data = [0, null];
      #size = 0;
      #target;
      
      constructor(args) {
        this.target = args?.target;
      }
      
      data() { return this.#data; }
      
      insert(val) {
        _debugLog('[RepTable#insert()] args', { val, target: this.target });
        const freeIdx = this.#data[0];
        if (freeIdx === 0) {
          this.#data.push(val);
          this.#data.push(null);
          const rep = (this.#data.length >> 1) - 1;
          _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep });
          this.#size += 1;
          return rep;
        }
        const placementIdx = freeIdx << 1;
        if (this.#data[placementIdx] !== RepTable.FREE) {
          throw new Error('corrupt rep table freelist: head does not point at a freed slot');
        }
        this.#data[0] = this.#data[placementIdx + 1];
        this.#data[placementIdx] = val;
        this.#data[placementIdx + 1] = null;
        _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep: freeIdx });
        this.#size += 1;
        return freeIdx;
      }
      
      get(rep) {
        _debugLog('[RepTable#get()] args', { rep, target: this.target });
        if (rep === 0) { throw new Error('invalid resource rep during get, (cannot be 0)'); }
        
        const baseIdx = rep << 1;
        const val = this.#data[baseIdx];
        if (val === RepTable.FREE) { return undefined; }
        return val;
      }
      
      contains(rep) {
        _debugLog('[RepTable#contains()] args', { rep, target: this.target });
        if (rep === 0) { throw new Error('invalid resource rep during contains, (cannot be 0)'); }
        
        const baseIdx = rep << 1;
        const val = this.#data[baseIdx];
        return val !== RepTable.FREE && !!val;
      }
      
      remove(rep) {
        _debugLog('[RepTable#remove()] args', { rep, target: this.target });
        if (rep === 0) { throw new Error('invalid resource rep during remove, (cannot be 0)'); }
        if (this.#data.length === 2) { throw new Error('invalid'); }
        
        const baseIdx = rep << 1;
        if (baseIdx >= this.#data.length) {
          throw new Error(`invalid rep [${rep}] during remove, out of range`);
        }
        const val = this.#data[baseIdx];
        if (val === RepTable.FREE) {
          throw new Error(`double removal of rep [${rep}] (already freed)`);
        }
        
        this.#data[baseIdx] = RepTable.FREE;
        this.#data[baseIdx + 1] = this.#data[0];
        this.#data[0] = rep;
        this.#size -= 1;
        
        return val;
      }
      
      size() { return this.#size; }
      
      clear() {
        _debugLog('[RepTable#clear()] args', { rep, target: this.target });
        this.#data = [0, null];
      }
    }
    
    class ComponentAsyncState {
      static EVENT_HANDLER_EVENTS = [ 'backpressure-change' ];
      
      static TickResult = {
        // no suspended tasks remain
        DONE: 'done',
        // a suspended task was resumed (more may be ready)
        RESUMED: 'resumed',
        // suspended tasks remain but none were ready
        IDLE: 'idle',
      };
      
      #componentIdx;
      #callingAsyncImport = false;
      #syncImportWait = promiseWithResolvers();
      #lockHolderTaskID = null;
      #lockWaiters = [];
      #lockHandoffScheduled = false;
      #parkedTasks = new Map();
      #suspendedTasksByTaskID = new Map();
      #suspendedTaskIDs = [];
      #errored = null;
      #backpressure = 0;
      #backpressureWaiters = 0n;
      
      #handlerMap = new Map();
      #nextHandlerID = 0n;
      
      #tickLoop = null;
      #tickLoopInterval = null;
      
      #onExclusiveReleaseHandlers = [];
      
      #mayLeave = true;
      
      handles;
      subtasks;
      
      constructor(args) {
        this.#componentIdx = args.componentIdx;
        this.handles = new RepTable({ target: `component [${this.#componentIdx}] handles (waitable objects)` });
        this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
      };
      
      componentIdx() { return this.#componentIdx; }
      
      get mayLeave() {
        const flags = INSTANCE_FLAGS.get(this.#componentIdx);
        return flags === undefined ? this.#mayLeave : flags.value === 1;
      }
      set mayLeave(value) {
        if (typeof value !== 'boolean') { throw new TypeError('mayLeave must be a boolean'); }
        this.#mayLeave = value;
        const flags = INSTANCE_FLAGS.get(this.#componentIdx);
        if (flags !== undefined) { flags.value = value ? 1 : 0; }
      }
      
      errored() { return this.#errored !== null; }
      setErrored(err) {
        _debugLog('[ComponentAsyncState#setErrored()] component errored', { err, componentIdx: this.#componentIdx });
        if (this.#errored) { return; }
        if (!err) {
          err = new Error('error elswehere (see other component instance error)')
          err.componentIdx = this.#componentIdx;
        }
        this.#errored = err;
      }
      
      markTrapped(err) {
        if (!(err instanceof WebAssemblyRuntimeError)) {
          return false;
        }
        _debugLog('[ComponentAsyncState#markTrapped()] component trapped', { err, componentIdx: this.#componentIdx });
        if (STORE_TRAP.error === null) { STORE_TRAP.error = err; }
        return true;
      }
      
      throwIfTrapped() {
        if (STORE_TRAP.error !== null) { throw STORE_TRAP.error; }
      }
      
      callingSyncImport(val) {
        if (val === undefined) { return this.#callingAsyncImport; }
        if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
        const prev = this.#callingAsyncImport;
        this.#callingAsyncImport = val;
        if (prev === true && this.#callingAsyncImport === false) {
          this.#notifySyncImportEnd();
        }
      }
      
      #notifySyncImportEnd() {
        const existing = this.#syncImportWait;
        this.#syncImportWait = promiseWithResolvers();
        existing.resolve();
      }
      
      async waitForSyncImportCallEnd() {
        await this.#syncImportWait.promise;
      }
      
      setBackpressure(v) {
        this.#backpressure = v;
        return this.#backpressure
      }
      getBackpressure() { return this.#backpressure; }
      
      incrementBackpressure() {
        const current = this.#backpressure;
        if (current < 0 || current > 2**16) {
          throw new Error(`invalid current backpressure value [${current}]`);
        }
        const newValue = this.getBackpressure() + 1;
        if (newValue >= 2**16) {
          throw new Error(`invalid new backpressure value [${newValue}], overflow`);
        }
        return this.setBackpressure(newValue);
      }
      
      decrementBackpressure() {
        const current = this.#backpressure;
        if (current < 0 || current > 2**16) {
          throw new Error(`invalid current backpressure value [${current}]`);
        }
        const newValue = Math.max(0, current - 1);
        if (newValue < 0) {
          throw new Error(`invalid new backpressure value [${newValue}], underflow`);
        }
        return this.setBackpressure(newValue);
      }
      hasBackpressure() { return this.#backpressure > 0; }
      
      waitForBackpressure() {
        let backpressureCleared = false;
        const cstate = this;
        cstate.addBackpressureWaiter();
        const handlerID = this.registerHandler({
          event: 'backpressure-change',
          fn: (bp) => {
            if (bp === 0) {
              cstate.removeHandler(handlerID);
              backpressureCleared = true;
            }
          }
        });
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            if (backpressureCleared) { return; }
            clearInterval(interval);
            cstate.removeBackpressureWaiter();
            resolve(null);
          }, 0);
        });
      }
      
      registerHandler(args) {
        const { event, fn } = args;
        if (!event) { throw new Error("missing handler event"); }
        if (!fn) { throw new Error("missing handler fn"); }
        
        if (!ComponentAsyncState.EVENT_HANDLER_EVENTS.includes(event)) {
          throw new Error(`unrecognized event handler [${event}]`);
        }
        
        const handlerID = this.#nextHandlerID++;
        let handlers = this.#handlerMap.get(event);
        if (!handlers) {
          handlers = [];
          this.#handlerMap.set(event, handlers)
        }
        
        handlers.push({ id: handlerID, fn, event });
        return handlerID;
      }
      
      removeHandler(args) {
        const { event, handlerID } = args;
        const registeredHandlers = this.#handlerMap.get(event);
        if (!registeredHandlers) { return; }
        const found = registeredHandlers.find(h => h.id === handlerID);
        if (!found) { return; }
        this.#handlerMap.set(event, this.#handlerMap.get(event).filter(h => h.id !== handlerID));
      }
      
      getBackpressureWaiters() { return this.#backpressureWaiters; }
      addBackpressureWaiter() { this.#backpressureWaiters++; }
      removeBackpressureWaiter() {
        this.#backpressureWaiters--;
        if (this.#backpressureWaiters < 0) {
          throw new Error("unexepctedly negative number of backpressure waiters");
        }
      }
      
      // The per-slice mutual-exclusion lock for guest execution in this
      // component instance. Guest slices (callback invocations and
      // sync-lifted bodies) must be atomic per component even across the
      // JSPI suspensions jco introduces for host imports: wit-bindgen's
      // executors publish per-task state in single linear-memory cells
      // (the wasip3-task pointer, context-local storage discipline) that
      // an interleaved slice of the same component corrupts
      //
      // The lock is *owned*: acquisition records the holder task and
      // release is a no-op for anyone else, so a task exiting can no
      // longer drop a hold it does not own (blind acquire/release-any
      // was the previous discipline). Contended acquisition queues
      // FIFO; release hands the lock to the next waiter directly.
      isExclusivelyLocked() { return this.#lockHolderTaskID !== null; }
      exclusivelyLockedBy(taskID) { return this.#lockHolderTaskID === taskID; }
      
      exclusiveLock(taskID) {
        _debugLog('[ComponentAsyncState#exclusiveLock()]', {
          holder: this.#lockHolderTaskID,
          requester: taskID,
          componentIdx: this.#componentIdx,
        });
        if (taskID === undefined || taskID === null) {
          throw new Error('exclusive lock requires the acquiring task id');
        }
        if (this.#lockHolderTaskID !== null) {
          throw new Error(`component [${this.#componentIdx}] exclusive lock held by task [${this.#lockHolderTaskID}], requested by [${taskID}]`);
        }
        this.#lockHolderTaskID = taskID;
      }
      
      // Awaitable acquisition: takes the lock immediately when free,
      // otherwise queues FIFO behind the current holder and earlier
      // waiters. The resolved promise implies ownership.
      async acquireExclusiveLock(taskID) {
        if (taskID === undefined || taskID === null) {
          throw new Error('exclusive lock requires the acquiring task id');
        }
        if (this.#lockHolderTaskID === null) {
          this.#lockHolderTaskID = taskID;
          _debugLog('[ComponentAsyncState#acquireExclusiveLock()] acquired', {
            holder: taskID,
            componentIdx: this.#componentIdx,
          });
          return;
        }
        if (this.#lockHolderTaskID === taskID) {
          throw new Error(`task [${taskID}] already holds the lock for component [${this.#componentIdx}]`);
        }
        _debugLog('[ComponentAsyncState#acquireExclusiveLock()] waiting', {
          holder: this.#lockHolderTaskID,
          requester: taskID,
          componentIdx: this.#componentIdx,
          queued: this.#lockWaiters.length,
        });
        await new Promise((resolve) => {
          this.#lockWaiters.push({ taskID, resolve });
        });
      }
      
      exclusiveRelease(taskID) {
        _debugLog('[ComponentAsyncState#exclusiveRelease()] args', {
          holder: this.#lockHolderTaskID,
          releaser: taskID,
          componentIdx: this.#componentIdx,
        });
        if (this.#lockHolderTaskID !== taskID) {
          // Ownerless releases were the historical behavior; a foreign
          // release now leaves the hold intact
          _debugLog('[ComponentAsyncState#exclusiveRelease()] ignoring foreign release', {
            holder: this.#lockHolderTaskID,
            releaser: taskID,
            componentIdx: this.#componentIdx,
          });
          return false;
        }
        
        // Make the release observable before handing the lock to the next
        // asynchronous guest slice.
        //
        // Release handlers may expose a lifted value whose consumer immediately
        // performs a synchronous call on the same component; that call must run
        // while the instance is genuinely unlocked, not via enterSync's
        // lock-free fallback code.
        this.#lockHolderTaskID = null;
        
        this.#onExclusiveReleaseHandlers = this.#onExclusiveReleaseHandlers.filter(v => !!v);
        for (const [idx, f] of this.#onExclusiveReleaseHandlers.entries()) {
          try {
            this.#onExclusiveReleaseHandlers[idx] = null;
            f();
          } catch (err) {
            _debugLog("error while executing handler for next exclusive release", err);
            throw err;
          }
        }
        this.#scheduleLockHandoff();
        return true;
      }
      
      #scheduleLockHandoff() {
        if (this.#lockHandoffScheduled || this.#lockWaiters.length === 0) { return; }
        this.#lockHandoffScheduled = true;
        queueMicrotask(() => {
          this.#lockHandoffScheduled = false;
          // A synchronous call triggered by a release handler gets the
          // first opportunity to use the unlocked component.
          //
          // Its release will leave this queued handoff in place.
          if (this.#lockHolderTaskID !== null) {
            this.#scheduleLockHandoff();
            return;
          }
          const next = this.#lockWaiters.shift();
          if (!next) { return; }
          this.#lockHolderTaskID = next.taskID;
          next.resolve();
        });
      }
      
      onNextExclusiveRelease(fn) {
        _debugLog('[ComponentAsyncState#()onNextExclusiveRelease] registering');
        this.#onExclusiveReleaseHandlers.push(fn);
      }
      
      async waitForExclusiveRelease() {
        while (this.isExclusivelyLocked()) {
          await new Promise(resolve => this.onNextExclusiveRelease(resolve));
        }
      }
      
      #getSuspendedTaskMeta(taskID) {
        return this.#suspendedTasksByTaskID.get(taskID);
      }
      
      #removeSuspendedTaskMeta(taskID) {
        _debugLog('[ComponentAsyncState#removeSuspendedTaskMeta()] removing suspended task', {
          taskID,
          componentIdx: this.#componentIdx,
        });
        const idx = this.#suspendedTaskIDs.findIndex(t => t === taskID);
        const meta = this.#suspendedTasksByTaskID.get(taskID);
        this.#suspendedTaskIDs[idx] = null;
        this.#suspendedTasksByTaskID.delete(taskID);
        return meta;
      }
      
      #addSuspendedTaskMeta(meta) {
        if (!meta) { throw new Error('missing task meta'); }
        const taskID = meta.taskID;
        this.#suspendedTasksByTaskID.set(taskID, meta);
        this.#suspendedTaskIDs.push(taskID);
        if (this.#suspendedTasksByTaskID.size < this.#suspendedTaskIDs.length - 10) {
          this.#suspendedTaskIDs = this.#suspendedTaskIDs.filter(t => t !== null);
        }
      }
      
      // TODO(threads): readyFn is normally on the thread
      suspendTask(args) {
        const { task, readyFn } = args;
        const taskID = task.id();
        const componentIdx = task.componentIdx();
        _debugLog('[ComponentAsyncState#suspendTask()]', {
          taskID,
          componentIdx: this.#componentIdx,
          taskEntryFnName: task.entryFnName(),
          subtask: task.getParentSubtask(),
        });
        
        if (componentIdx !== this.#componentIdx) {
          throw new Error('assert: task component idx should match async state');
        }
        
        if (this.#getSuspendedTaskMeta(taskID)) {
          throw new Error(`task [${taskID}] already suspended`);
        }
        
        const { promise, resolve, reject } = promiseWithResolvers();
        this.#addSuspendedTaskMeta({
          task,
          taskID,
          readyFn,
          resume: () => {
            _debugLog('[ComponentAsyncState] resuming suspended task', {
              taskID,
              componentIdx: this.#componentIdx,
            });
            // TODO(threads): it's thread cancellation we should be checking for below, not task
            resolve(!task.isCancelled());
          },
        });
        
        this.runTickLoop();
        
        return promise;
      }
      
      resumeTaskByID(taskID) {
        const meta = this.#removeSuspendedTaskMeta(taskID);
        if (!meta) { return; }
        if (meta.taskID !== taskID) { throw new Error('task ID does not match'); }
        meta.resume();
      }
      
      async runTickLoop() {
        if (this.#tickLoop !== null) { return; }
        this.#tickLoop = 1;
        setTimeout(async () => {
          let result = this.tick();
          while (result !== ComponentAsyncState.TickResult.DONE) {
            // After resuming a task, re-tick as soon as the resumed
            // slice's microtask continuations have drained (timeout 0)
            // so queued sibling resumptions aren't charged the idle
            // polling interval; otherwise poll at the idle cadence.
            const delay = result === ComponentAsyncState.TickResult.RESUMED ? 0 : 10;
            await new Promise((resolve) => setTimeout(resolve, delay));
            result = this.tick();
          }
          this.#tickLoop = null;
        }, 10);
      }
      
      tick() {
        // _debugLog('[ComponentAsyncState#tick()]', { suspendedTaskIDs: this.#suspendedTaskIDs });
        
        const resumableTasks = this.#suspendedTaskIDs.filter(t => t !== null);
        for (const taskID of resumableTasks) {
          const meta = this.#suspendedTasksByTaskID.get(taskID);
          if (!meta || !meta.readyFn) {
            throw new Error(`missing/invalid task despite ID [${taskID}] being present`);
          }
          
          // If the task failed via any means, allow the task to resume because
          // it's been cancelled -- the callback should immediately exit as well
          if (meta.task.isRejected()) {
            _debugLog('[ComponentAsyncState#tick()] detected task rejection, leaving early', { meta });
            this.resumeTaskByID(taskID);
            return ComponentAsyncState.TickResult.RESUMED;
          }
          
          const isReady = meta.readyFn();
          if (!isReady) { continue; }
          
          _debugLog('[ComponentAsyncState#tick()] resuming task via tick', {
            taskID,
            componentIdx: this.#componentIdx,
          });
          this.resumeTaskByID(taskID);
          
          // NOTE: during single-flight resumption, we should resume at most one task per
          // tick so that the resumed slice (a microtask continuation)
          // runs -- and its current-task register window opens and
          // closes -- before any sibling task of this component is
          // resumed.
          //
          // Resuming multiple suspended tasks in one synchronous
          // cascade interleaves their register save/restore windows
          // ([restoreA, restoreB, resumeA, resumeB]), re-entering wasm
          // with the register naming the wrong task, and the
          // 'known residual' of the JSPI current-task register
          // fix); with concurrent task lifetimes per component this
          // corrupts guest context-local storage.
          return ComponentAsyncState.TickResult.RESUMED;
        }
        
        const idle = this.#suspendedTaskIDs.filter(t => t !== null).length > 0;
        return idle
        ? ComponentAsyncState.TickResult.IDLE
        : ComponentAsyncState.TickResult.DONE;
      }
      
      createWaitable(args) {
        return new Waitable({ target: args?.target, });
      }
    }
    
    function getOrCreateAsyncState(componentIdx, init) {
      if (!ASYNC_STATE.has(componentIdx)) {
        const newState = new ComponentAsyncState({ componentIdx });
        ASYNC_STATE.set(componentIdx, newState);
      }
      return ASYNC_STATE.get(componentIdx);
    }
    const GLOBAL_COMPONENT_MEMORY_MAP = new Map();
    
    function lookupMemoriesForComponent(args) {
      const { componentIdx } = args ?? {};
      if (args.componentIdx === undefined) { throw new TypeError("missing component idx"); }
      
      const metas = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx);
      if (!metas) { return []; }
      
      if (args.memoryIdx === undefined) {
        return Object.values(metas);
      }
      
      const meta = metas[args.memoryIdx];
      return meta?.memory;
    }
    
    class AsyncSubtask {
      static _ID = 0n;
      
      static State = {
        STARTING: 0,
        STARTED: 1,
        RETURNED: 2,
        CANCELLED_BEFORE_STARTED: 3,
        CANCELLED_BEFORE_RETURNED: 4,
      };
      
      #id;
      #state = AsyncSubtask.State.STARTING;
      #componentIdx;
      
      #parentTask;
      #childTask = null;
      
      #dropped = false;
      #cancelRequested = false;
      
      #memoryIdx = null;
      #lenders = null;
      
      #waitable = null;
      
      #callbackFn = null;
      #callbackFnName = null;
      
      #postReturnFn = null;
      #onProgressFn = null;
      #pendingEventFn = null;
      
      #callMetadata = {};
      
      #resolved = false;
      
      #onResolveHandlers = [];
      #onStartHandlers = [];
      
      #result = null;
      #resultSet = false;
      
      fnName;
      target;
      isAsync;
      isManualAsync;
      
      constructor(args) {
        if (typeof args.componentIdx !== 'number') {
          throw new Error('invalid componentIdx for subtask creation');
        }
        this.#componentIdx = args.componentIdx;
        
        this.#id = ++AsyncSubtask._ID;
        this.fnName = args.fnName;
        
        if (!args.parentTask) { throw new Error('missing parent task during subtask creation'); }
        this.#parentTask = args.parentTask;
        
        if (args.childTask) { this.#childTask = args.childTask; }
        
        if (args.memoryIdx) { this.#memoryIdx = args.memoryIdx; }
        
        if (!args.waitable) { throw new Error("missing/invalid waitable"); }
        this.#waitable = args.waitable;
        
        if (args.callMetadata) { this.#callMetadata = args.callMetadata; }
        
        this.#lenders = [];
        this.target = args.target;
        this.isAsync = args.isAsync;
        this.isManualAsync = args.isManualAsync;
      }
      
      id() { return this.#id; }
      parentTaskID() { return this.#parentTask?.id(); }
      childTaskID() { return this.#childTask?.id(); }
      state() { return this.#state; }
      
      waitable() { return this.#waitable; }
      waitableRep() { return this.#waitable.idx(); }
      
      join() { return this.#waitable.join(...arguments); }
      getPendingEvent() { return this.#waitable.getPendingEvent(...arguments); }
      hasPendingEvent() { return this.#waitable.hasPendingEvent(...arguments); }
      setPendingEvent() { return this.#waitable.setPendingEvent(...arguments); }
      
      setTarget(tgt) { this.target = tgt; }
      
      getResult() {
        if (!this.#resultSet) { throw new Error("subtask result has not been set") }
        return this.#result;
      }
      setResult(v) {
        if (this.#resultSet) { throw new Error("subtask result has already been set"); }
        this.#result = v;
        this.#resultSet = true;
      }
      
      componentIdx() { return this.#componentIdx; }
      
      setChildTask(t) {
        if (!t) { throw new Error('cannot set missing/invalid child task on subtask'); }
        if (this.#childTask) { throw new Error('child task is already set on subtask'); }
        if (this.#parentTask === t) { throw new Error("parent cannot be child"); }
        this.#childTask = t;
      }
      getChildTask(t) { return this.#childTask; }
      
      getParentTask() { return this.#parentTask; }
      
      setCallbackFn(f, name) {
        if (!f) { return; }
        if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
        this.#callbackFn = f;
        this.#callbackFnName = name;
      }
      
      getCallbackFnName() {
        if (!this.#callbackFn) { return undefined; }
        return this.#callbackFn.name;
      }
      
      setPostReturnFn(f) {
        if (!f) { return; }
        if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
        this.#postReturnFn = f;
      }
      
      setOnProgressFn(f) {
        if (this.#onProgressFn) { throw new Error('on progress fn can only be set once'); }
        this.#onProgressFn = f;
      }
      
      isNotStarted() {
        return this.#state == AsyncSubtask.State.STARTING;
      }
      
      cancellationRequested() { return this.#cancelRequested; }
      
      // Request cooperative cancellation of this subtask, on behalf of the
      // supertask (i.e. `canon subtask.cancel`).
      //
      // If the callee is another guest task, the request is delivered to it and
      // the callee confirms via `task.cancel` (or still resolves via `task.return`).
      //
      // If the callee is a host function there is (currently) no host-side
      // cancellation hook, so the pending call is treated as immediately
      // cancelled -- consistent with hosts being expected to resolve
      // cancellation promptly -- and any later host resolution is discarded
      // (see `AsyncTask#onResolve`).
      requestCancellation() {
        _debugLog('[AsyncSubtask#requestCancellation()] args', {
          componentIdx: this.#componentIdx,
          subtaskID: this.#id,
          state: this.#state,
          childTaskID: this.childTaskID(),
          fnName: this.fnName,
        });
        if (this.#cancelRequested) {
          throw new Error('cancellation has already been requested for this subtask');
        }
        this.#cancelRequested = true;
        
        if (this.#resolved) { return; }
        
        if (this.#childTask) {
          this.#childTask.requestCancellation();
          return;
        }
        
        this.onResolve(null);
      }
      
      registerOnStartHandler(f) {
        this.#onStartHandlers.push(f);
      }
      
      onStart(args) {
        _debugLog('[AsyncSubtask#onStart()] args', {
          componentIdx: this.#componentIdx,
          subtaskID: this.#id,
          parentTaskID: this.parentTaskID(),
          fnName: this.fnName,
          args,
        });
        
        if (this.#onProgressFn) { this.#onProgressFn(); }
        
        this.#state = AsyncSubtask.State.STARTED;
        
        let result;
        
        // If we have been provided a helper start function as a result of
        // component fusion performed by wasmtime tooling, then we can call that helper and lifts/lowers will
        // be performed for us.
        //
        // See also documentation on `HostIntrinsic::PrepareCall`
        //
        if (this.#callMetadata.startFn) {
          result = this.#callMetadata.startFn.apply(null, args?.startFnParams ?? []);
        }
        
        return result;
      }
      
      
      registerOnResolveHandler(f) {
        this.#onResolveHandlers.push(f);
      }
      
      reject(subtaskErr) {
        if (this.#resolved) { return; }
        
        if (this.#onProgressFn) { this.#onProgressFn(); }
        
        if (this.#state === AsyncSubtask.State.STARTING) {
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
        } else if (this.#state === AsyncSubtask.State.STARTED) {
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
        } else {
          throw new Error('cannot reject a completed subtask');
        }
        
        this.#resolved = true;
        this.#parentTask.removeSubtask(this);
        this.#parentTask.reject(subtaskErr);
      }
      
      onResolve(subtaskValue) {
        _debugLog('[AsyncSubtask#onResolve()] args', {
          componentIdx: this.#componentIdx,
          subtaskID: this.#id,
          isAsync: this.isAsync,
          childTaskID: this.childTaskID(),
          parentTaskID: this.parentTaskID(),
          parentTaskFnName: this.#parentTask?.entryFnName(),
          fnName: this.fnName,
        });
        
        if (this.#resolved) {
          throw new Error('subtask has already been resolved');
        }
        
        if (this.#onProgressFn) { this.#onProgressFn(); }
        
        if (subtaskValue === null && this.#cancelRequested) {
          if (this.#state === AsyncSubtask.State.STARTING) {
            this.#state = AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
          } else {
            if (this.#state !== AsyncSubtask.State.STARTED) {
              throw new Error('resolved subtask must have been started before cancellation');
            }
            this.#state = AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
          }
        } else {
          if (this.#state !== AsyncSubtask.State.STARTED) {
            throw new Error('resolved subtask must have been started before completion');
          }
          this.#state = AsyncSubtask.State.RETURNED;
        }
        
        this.setResult(subtaskValue);
        
        for (const f of this.#onResolveHandlers) {
          try {
            f(subtaskValue);
          } catch (err) {
            console.error("error during subtask resolve handler", err);
            throw err;
          }
        }
        
        const callMetadata = this.getCallMetadata();
        
        // TODO(fix): we should be able to easily have the caller's meomry
        // to lower into here, but it's not present in PrepareCall
        const memory = callMetadata.memory ?? this.#parentTask?.getReturnMemory() ?? lookupMemoriesForComponent({ componentIdx: this.#parentTask?.componentIdx() })[0];
        // NOTE: cancelled resolutions carry no value, so nothing is lowered
        const returned = this.#state === AsyncSubtask.State.RETURNED;
        if (returned && callMetadata && !callMetadata.returnFn && this.isAsync && callMetadata.resultPtr && memory) {
          const { resultPtr, realloc } = callMetadata;
          const lowers = callMetadata.lowers; // may have been updated in task.return of the child
          if (lowers && lowers.length > 0) {
            lowers[0]({
              componentIdx: this.#componentIdx,
              memory,
              realloc,
              vals: [subtaskValue],
              storagePtr: resultPtr,
              stringEncoding: callMetadata.stringEncoding,
            });
          }
        }
        
        this.#resolved = true;
        this.#parentTask.removeSubtask(this);
        
        if (!this.isAsync) {
          this.deliverResolve();
          const rep = this.waitableRep();
          if (rep) {
            try {
              const removed = this.#getComponentState().handles.remove(rep);
              if (removed !== this) {
                throw new Error("unexpectedly received non-self Subtask from handle removal");
              }
              this.drop();
            } catch (err) {
              _debugLog('[AsyncSubtask#onResolve()] failed to remove subtask after sync subtask completion', err);
            }
          }
        }
      }
      
      getStateNumber() { return this.#state; }
      isReturned() { return this.#state === AsyncSubtask.State.RETURNED; }
      
      getCallMetadata() { return this.#callMetadata; }
      
      isResolved() {
        if (this.#state === AsyncSubtask.State.STARTING
        || this.#state === AsyncSubtask.State.STARTED) {
          return false;
        }
        if (this.#state === AsyncSubtask.State.RETURNED
        || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_STARTED
        || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_RETURNED) {
          return true;
        }
        throw new Error('unrecognized internal Subtask state [' + this.#state + ']');
      }
      
      addLender(handle) {
        _debugLog('[AsyncSubtask#addLender()] args', { handle });
        if (!Number.isNumber(handle)) { throw new Error('missing/invalid lender handle [' + handle + ']'); }
        
        if (this.#lenders.length === 0 || this.isResolved()) {
          throw new Error('subtask has no lendors or has already been resolved');
        }
        
        handle.lends++;
        this.#lenders.push(handle);
      }
      
      deliverResolve() {
        _debugLog('[AsyncSubtask#deliverResolve()] args', {
          lenders: this.#lenders,
          parentTaskID: this.parentTaskID(),
          subtaskID: this.#id,
          childTaskID: this.childTaskID(),
          resolved: this.isResolved(),
          resolveDelivered: this.resolveDelivered(),
        });
        
        const cannotDeliverResolve = this.resolveDelivered() || !this.isResolved();
        if (cannotDeliverResolve) {
          throw new Error('subtask cannot deliver resolution twice, and the subtask must be resolved');
        }
        
        for (const lender of this.#lenders) {
          lender.lends--;
        }
        
        this.#lenders = null;
      }
      
      resolveDelivered() {
        _debugLog('[AsyncSubtask#resolveDelivered()] args', { });
        if (this.#lenders === null && !this.isResolved()) {
          throw new Error('invalid subtask state, lenders missing and subtask has not been resolved');
        }
        return this.#lenders === null;
      }
      
      drop() {
        _debugLog('[AsyncSubtask#drop()] args', {
          componentIdx: this.#componentIdx,
          parentTaskID: this.#parentTask?.id(),
          parentTaskFnName: this.#parentTask?.entryFnName(),
          childTaskID: this.#childTask?.id(),
          childTaskFnName: this.#childTask?.entryFnName(),
          subtaskFnName: this.fnName,
        });
        if (!this.#waitable) { throw new Error('missing/invalid inner waitable'); }
        if (!this.resolveDelivered()) {
          throw new Error('cannot drop subtask before resolve is delivered');
        }
        if (this.#waitable) { this.#waitable.drop() }
        this.#dropped = true;
      }
      
      #getComponentState() {
        const state = getOrCreateAsyncState(this.#componentIdx);
        if (!state) {
          throw new Error('invalid/missing async state for component [' + componentIdx + ']');
        }
        return state;
      }
      
      getWaitableHandleIdx() {
        _debugLog('[AsyncSubtask#getWaitableHandleIdx()] args', { });
        if (!this.#waitable) { throw new Error('missing/invalid waitable'); }
        return this.waitableRep();
      }
    }
    
    class FutureValue {
      #start;
      #settled;
      #hideThen = 0;
      #thenFn;
      
      constructor(start) {
        if (typeof start !== 'function') {
          throw new TypeError('future start operation must be a function');
        }
        this.#start = start;
        this.#thenFn = this.#then.bind(this);
      }
      
      get then() {
        return this.#hideThen === 0 ? this.#thenFn : undefined;
      }
      
      #read() {
        if (!this.#settled) {
          // The start operation resolves to a non-thenable box so a
          // future-valued payload cannot be assimilated by this Promise.
          this.#settled = Promise.resolve().then(this.#start);
        }
        return this.#settled;
      }
      
      resolveAsValue(resolve) {
        this.#hideThen++;
        try {
          resolve(this);
        } finally {
          this.#hideThen--;
        }
      }
      
      #deliver(resolve, value) {
        if (value instanceof FutureValue) {
          // Promise resolution reads `then` synchronously. Hide it only
          // for that lookup so resolving this layer yields the inner
          // FutureValue instead of recursively awaiting it.
          value.resolveAsValue(resolve);
          return;
        }
        resolve(value);
      }
      
      #then(resolve, reject) {
        return this.#read().then(
        box => this.#deliver(resolve, box.value),
        reject,
        );
      }
    }
    const ASYNC_DETERMINISM = 'random';
    const _coinFlip = () => { return Math.random() > 0.5; };
    
    const ASYNC_EVENT_CODE = {
      NONE: 0,
      SUBTASK: 1,
      STREAM_READ: 2,
      STREAM_WRITE: 3,
      FUTURE_READ: 4,
      FUTURE_WRITE: 5,
      TASK_CANCELLED: 6,
    };
    const CURRENT_TASK_META = {};
    
    function _withGlobalCurrentTaskMeta(args) {
      _debugLog('[_withGlobalCurrentTaskMeta()] args', args);
      if (!args) { throw new TypeError('args missing'); }
      if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
      if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
      if (!args.fn) { throw new TypeError('missing fn'); }
      const { taskID, componentIdx, fn } = args;
      const previous = CURRENT_TASK_META[componentIdx] ?? null;
      
      try {
        CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
        return fn();
      } catch (err) {
        _debugLog("error while executing sync callee/callback", {
          ...args,
          err,
        });
        throw err;
      } finally {
        // Synchronous wrappers can nest without any intervening JS
        // scheduling. Restore the caller rather than clearing it so
        // helper core exports (for example fused return adapters) can
        // temporarily run under a different task of the same component.
        CURRENT_TASK_META[componentIdx] = previous;
      }
    }
    
    async function _withGlobalCurrentTaskMetaAsync(args) {
      _debugLog('[_withGlobalCurrentTaskMetaAsync()] args', args);
      if (!args) { throw new TypeError('args missing'); }
      if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
      if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
      if (!args.fn) { throw new TypeError('missing fn'); }
      
      const { taskID, componentIdx, fn } = args;
      
      try {
        CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
        return await fn();
      } catch (err) {
        _debugLog("error while executing async callee/callback", {
          ...args,
          err,
        });
        throw err;
      } finally {
        CURRENT_TASK_META[componentIdx] = null;
      }
    }
    
    class AsyncTask {
      static _ID = 0n;
      
      static State = {
        INITIAL: 'initial',
        CANCELLED: 'cancelled',
        CANCEL_PENDING: 'cancel-pending',
        CANCEL_DELIVERED: 'cancel-delivered',
        RESOLVED: 'resolved',
      }
      
      static BlockResult = {
        CANCELLED: 'block.cancelled',
        NOT_CANCELLED: 'block.not-cancelled',
      }
      
      #id;
      #componentIdx;
      #state;
      #isAsync;
      #isManualAsync;
      #callingWasmExport = true;
      #lockFreeEntry = false;
      #preserveFutureResult;
      #entryFnName = null;
      
      #onResolveHandlers = [];
      #completionPromise = null;
      #rejected = false;
      
      #exitPromise = null;
      #onExitHandlers = [];
      
      #memoryIdx = null;
      #memory = null;
      
      #callbackFn = null;
      #callbackFnName = null;
      
      #postReturnFn = null;
      
      #getCalleeParamsFn = null;
      
      #stringEncoding = null;
      
      #parentSubtask = null;
      
      #errHandling;
      
      #backpressurePromise;
      #backpressureWaiters = 0n;
      
      #returnLowerFns = null;
      
      #subtasks = [];
      
      #entered = false;
      #exited = false;
      #errored = null;
      
      cancelled = false;
      cancelRequested = false;
      alwaysTaskReturn = false;
      
      returnCalls =  0;
      storage = [0, 0];
      borrowedHandles = {};
      
      tmpRetI64HighBits = 0|0;
      
      constructor(opts) {
        this.#id = ++AsyncTask._ID;
        
        if (opts?.componentIdx === undefined) {
          throw new TypeError('missing component id during task creation');
        }
        this.#componentIdx = opts.componentIdx;
        
        this.#state = AsyncTask.State.INITIAL;
        this.#isAsync = opts?.isAsync ?? false;
        this.#isManualAsync = opts?.isManualAsync ?? false;
        this.#preserveFutureResult = opts?.preserveFutureResult ?? false;
        this.#entryFnName = opts.entryFnName;
        // Tasks that execute guest slices (export calls, fused
        // callees) default to true; import-handler tasks pass false
        // explicitly (they run host code nested inside the caller's
        // already-locked slice).
        this.#callingWasmExport = opts?.callingWasmExport !== false;
        
        const {
          promise: completionPromise,
          resolve: resolveCompletionPromise,
          reject: rejectCompletionPromise,
        } = promiseWithResolvers();
        this.#completionPromise = completionPromise;
        // A nested rejection can reach the root task while its Wasm
        // entrypoint is still suspended, before the export wrapper awaits
        // this promise. Mark it handled immediately while preserving the
        // original rejected promise for the eventual caller.
        completionPromise.catch(() => {});
        
        this.#onResolveHandlers.push((results) => {
          if (this.#parentSubtask !== null) { return; }
          if (!this.#isAsync) { return; }
          
          if (this.#errored !== null) {
            rejectCompletionPromise(this.#errored);
            return;
          } else if (this.#rejected) {
            rejectCompletionPromise(results);
            return;
          }
          
          if (this.#preserveFutureResult && results instanceof FutureValue) {
            results.resolveAsValue(resolveCompletionPromise);
          } else {
            resolveCompletionPromise(results);
          }
        });
        
        const {
          promise: exitPromise,
          resolve: resolveExitPromise,
          reject: rejectExitPromise,
        } = promiseWithResolvers();
        this.#exitPromise = exitPromise;
        
        this.#onExitHandlers.push(() => {
          resolveExitPromise();
        });
        
        if (opts.callbackFn) { this.#callbackFn = opts.callbackFn; }
        if (opts.callbackFnName) { this.#callbackFnName = opts.callbackFnName; }
        
        if (opts.getCalleeParamsFn) { this.#getCalleeParamsFn = opts.getCalleeParamsFn; }
        
        if (opts.stringEncoding) { this.#stringEncoding = opts.stringEncoding; }
        
        if (opts.parentSubtask) { this.#parentSubtask = opts.parentSubtask; }
        
        
        if (opts.errHandling) { this.#errHandling = opts.errHandling; }
      }
      
      taskState() { return this.#state; }
      id() { return this.#id; }
      componentIdx() { return this.#componentIdx; }
      entryFnName() { return this.#entryFnName; }
      
      completionPromise() { return this.#completionPromise; }
      exitPromise() { return this.#exitPromise; }
      
      isAsync() { return this.#isAsync; }
      isSync() { return !this.isAsync(); }
      
      getErrHandling() { return this.#errHandling; }
      
      hasCallback() { return this.#callbackFn !== null; }
      
      getReturnMemoryIdx() { return this.#memoryIdx; }
      setReturnMemoryIdx(idx) {
        if (idx === null) { return; }
        this.#memoryIdx = idx;
      }
      
      getReturnMemory() { return this.#memory; }
      setReturnMemory(m) {
        if (m === null) { return; }
        this.#memory = m;
      }
      
      setReturnLowerFns(fns) { this.#returnLowerFns = fns; }
      getReturnLowerFns() { return this.#returnLowerFns; }
      
      setParentSubtask(subtask) {
        if (!subtask || !(subtask instanceof AsyncSubtask)) { return }
        if (this.#parentSubtask) { throw new Error('parent subtask can only be set once'); }
        this.#parentSubtask = subtask;
      }
      
      getParentSubtask() { return this.#parentSubtask; }
      
      // TODO(threads): this is very inefficient, we can pass along a root task,
      // and ideally do not need this once thread support is in place
      getRootTask() {
        let currentSubtask = this.getParentSubtask();
        let task = this;
        while (currentSubtask) {
          task = currentSubtask.getParentTask();
          currentSubtask = task.getParentSubtask();
        }
        return task;
      }
      
      setPostReturnFn(f) {
        if (!f) { return; }
        if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
        this.#postReturnFn = f;
      }
      
      setCallbackFn(f, name) {
        if (!f) { return; }
        if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
        this.#callbackFn = f;
        this.#callbackFnName = name;
      }
      
      getCallbackFnName() {
        if (!this.#callbackFnName) { return undefined; }
        return this.#callbackFnName;
      }
      
      async runCallbackFn(...args) {
        if (!this.#callbackFn) { throw new Error('no callback function has been set for task'); }
        return _withGlobalCurrentTaskMetaAsync({
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          fn: () => { return this.#callbackFn.apply(null, args); }
        });
      }
      
      getCalleeParams() {
        if (!this.#getCalleeParamsFn) { throw new Error('missing/invalid getCalleeParamsFn'); }
        return this.#getCalleeParamsFn();
      }
      
      mayBlock() { return this.isAsync() || this.isResolvedState() }
      
      mayEnter(task) {
        const cstate = getOrCreateAsyncState(this.#componentIdx);
        if (cstate.hasBackpressure()) {
          _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
          return false;
        }
        if (!cstate.callingSyncImport()) {
          _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
          return false;
        }
        const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
        if (!callingSyncExportWithSyncPending) {
          _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
          return false;
        }
        return true;
      }
      
      enterSync() {
        if (this.needsExclusiveLock()) {
          const cstate = getOrCreateAsyncState(this.#componentIdx);
          if (!cstate.isExclusivelyLocked()) {
            cstate.exclusiveLock(this.#id);
          } else {
            // A host-called sync export arriving while another
            // task's slice holds the lock: synchronous entry
            // cannot wait, and historically this entry silently
            // stole the hold. Run without the lock instead --
            // the holder's bookkeeping stays intact and its
            // release still pairs
            this.#lockFreeEntry = true;
            _debugLog('[AsyncTask#enterSync()] entering without exclusive lock', {
              taskID: this.#id,
              componentIdx: this.#componentIdx,
            });
          }
        }
        return true;
      }
      
      async enter(opts) {
        _debugLog('[AsyncTask#enter()] args', {
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          subtaskID: this.getParentSubtask()?.id(),
          args: opts,
          entryFnName: this.#entryFnName,
        });
        
        if (this.#entered) {
          throw new Error(`task with ID [${this.#id}] should not be entered twice`);
        }
        
        // If cancellation was requested before the task was entered, resolve
        // as cancelled without ever running guest code
        if (this.deliverPendingCancel({ cancellable: true })) {
          this.cancel();
          return false;
        }
        
        const cstate = getOrCreateAsyncState(this.#componentIdx);
        
        if (opts?.isHost) {
          this.#entered = true;
          return this.#entered;
        }
        
        // NOTE: concurrent task lifetimes within one component instance are
        // permitted by the Component Model: entry is governed by the
        // backpressure and exclusive-lock checks below (the lock is held per
        // execution slice, not for the task's lifetime).
        //
        // Serializing entire task lifetimes here (the former "execution slot" queue)
        // deadlocks pipelines where a parked long-lived task's progress depends on a
        // later entry into the same component.
        
        // If a task is synchronous then we can avoid component-relevant
        // tracking and immediately enter.
        if (this.isSync()) {
          this.#entered = true;
          
          // TODO(breaking): remove once manually-specifying async fns is removed
          // It is currently possible for an actually sync export to be specified
          // as async via JSPI
          if (this.#isManualAsync) {
            if (this.needsExclusiveLock()) { await cstate.acquireExclusiveLock(this.#id); }
          }
          
          return this.#entered;
        }
        
        // Perform intial backpressure check
        if (cstate.hasBackpressure()) {
          cstate.addBackpressureWaiter();
          
          const result = await this.waitUntil({
            readyFn: () => {
              return !cstate.hasBackpressure();
            },
            cancellable: true,
          });
          
          cstate.removeBackpressureWaiter();
          
          if (result === AsyncTask.BlockResult.CANCELLED) {
            this.cancel();
            return false;
          }
        }
        
        // Acquire the per-slice exclusive lock (FIFO-queued when
        // contended); the first slice runs under this hold and the
        // driver loop releases/re-acquires it per slice thereafter.
        if (this.needsExclusiveLock()) {
          await cstate.acquireExclusiveLock(this.#id);
        }
        
        this.#entered = true;
        return this.#entered;
      }
      
      isRunningState() { return this.#state !== AsyncTask.State.RESOLVED; }
      isResolvedState() { return this.#state === AsyncTask.State.RESOLVED; }
      isResolved() { return this.#state === AsyncTask.State.RESOLVED; }
      isExited() { return this.#exited; }
      
      async waitUntil(opts) {
        const { readyFn, cancellable } = opts;
        _debugLog('[AsyncTask#waitUntil()] args', { taskID: this.#id, args: { cancellable } });
        
        // TODO(fix): check for cancel
        // TODO(fix): determinism
        // TODO(threads): add this thread to waiting list
        
        const keepGoing = await this.suspendUntil({
          readyFn,
          cancellable,
        });
        
        return keepGoing;
      }
      
      async yieldUntil(opts) {
        const { readyFn, cancellable } = opts;
        _debugLog('[AsyncTask#yieldUntil()]', {
          taskID: this.#id,
          args: {
            cancellable,
          },
          componentIdx: this.#componentIdx,
        });
        
        const keepGoing = await this.suspendUntil({ readyFn, cancellable });
        if (keepGoing) {
          return {
            code: ASYNC_EVENT_CODE.NONE,
            payload0: 0,
            payload1: 0,
          };
        }
        
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          payload0: 0,
          payload1: 0,
        };
      }
      
      async suspendUntil(opts) {
        const { cancellable, readyFn } = opts;
        _debugLog('[AsyncTask#suspendUntil()] args', {
          taskID: this.#id,
          args: {
            cancellable,
          },
          componentIdx: this.#componentIdx,
        });
        
        const pendingCancelled = this.deliverPendingCancel({ cancellable });
        if (pendingCancelled) { return false; }
        
        const completed = await this.immediateSuspendUntil({ readyFn, cancellable });
        return completed;
      }
      
      // TODO(threads): equivalent to thread.suspend_until()
      async immediateSuspendUntil(opts) {
        const { cancellable, readyFn } = opts;
        _debugLog('[AsyncTask#immediateSuspendUntil()] args', {
          args: {
            cancellable,
            readyFn,
          },
          taskID: this.#id,
          componentIdx: this.#componentIdx,
        });
        
        const ready = readyFn();
        if (ready && ASYNC_DETERMINISM === 'random') {
          const coinFlip = _coinFlip();
          if (coinFlip) { return true }
        }
        
        const keepGoing = await this.immediateSuspend({ cancellable, readyFn });
        return keepGoing;
      }
      
      async immediateSuspend(opts) { // NOTE: equivalent to thread.suspend()
      // TODO(threads): store readyFn on the thread
      const { cancellable, readyFn } = opts;
      _debugLog('[AsyncTask#immediateSuspend()] args', { cancellable, readyFn });
      
      const pendingCancelled = this.deliverPendingCancel({ cancellable });
      if (pendingCancelled) { return false; }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      const keepGoing = await cstate.suspendTask({
        task: this,
        readyFn: () => {
          // A pending cancellation request wakes cancellable waits
          if (cancellable && this.#state === AsyncTask.State.CANCEL_PENDING) {
            return true;
          }
          return readyFn();
        },
      });
      if (keepGoing && this.deliverPendingCancel({ cancellable })) { return false; }
      return keepGoing;
    }
    
    deliverPendingCancel(opts) {
      const { cancellable } = opts;
      _debugLog('[AsyncTask#deliverPendingCancel()]', {
        args: { cancellable },
        taskID: this.#id,
        componentIdx: this.#componentIdx,
      });
      
      if (cancellable && this.#state === AsyncTask.State.CANCEL_PENDING) {
        this.#state = AsyncTask.State.CANCEL_DELIVERED;
        return true;
      }
      
      return false;
    }
    
    isCancelled() { return this.cancelled }
    
    // Request cooperative cancellation of this task, called on behalf of a
    // supertask performing `subtask.cancel` on the subtask this task backs.
    //
    // The request is delivered at this task's next cancellable wait
    // (see suspendUntil/immediateSuspend), at which point the task is
    // expected to acknowledge via `task.cancel` or still resolve via
    // `task.return`.
    requestCancellation() {
      _debugLog('[AsyncTask#requestCancellation()] args', {
        taskID: this.#id,
        componentIdx: this.#componentIdx,
        state: this.#state,
      });
      if (this.isResolvedState() || this.cancelRequested) { return; }
      this.cancelRequested = true;
      if (this.#state === AsyncTask.State.INITIAL) {
        this.#state = AsyncTask.State.CANCEL_PENDING;
      }
      // Nudge the component's tick loop so that any suspended cancellable
      // wait observes the pending cancellation promptly
      getOrCreateAsyncState(this.#componentIdx).runTickLoop();
    }
    
    cancel(args) {
      _debugLog('[AsyncTask#cancel()] args', { });
      if (this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state [${this.taskState()}] for cancellation`);
      }
      if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
      this.cancelled = true;
      // Cancelled tasks resolve with no value (spec: `Task.cancel` calls
      // `on_resolve(None)`); an explicit error is only present on the
      // host-driven rejection path (see `reject()`).
      this.onResolve(args?.error ?? null);
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    onResolve(taskValue) {
      const handlers = this.#onResolveHandlers;
      this.#onResolveHandlers = [];
      for (const f of handlers) {
        try {
          f(taskValue);
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      // Rejections are control-flow failures, not canonical ABI results.
      // Propagate them through the subtask chain without running return
      // lowering or post-return hooks for a successful result.
      if (this.#rejected) {
        this.#parentSubtask?.reject(taskValue);
        return;
      }
      
      // NOTE: if the parent subtask has already been resolved (e.g. it was
      // cancelled via `subtask.cancel` while this task was still pending),
      // this task's resolution must be discarded rather than delivered.
      const parentSubtaskPending = this.#parentSubtask && !this.#parentSubtask.isResolved();
      
      if (parentSubtaskPending) {
        const meta = this.#parentSubtask.getCallMetadata();
        // Run the rturn fn if it has not already been called -- this *should* have happened in
        // `task.return`, but some paths do not go through task.return (e.g. async lower of sync fn
        // which goes through prepare + async-start-call)
        if (meta.returnFn && !meta.returnFnCalled) {
          _debugLog('[AsyncTask#onResolve()] running returnFn', {
            componentIdx: this.#componentIdx,
            taskID: this.#id,
            subtaskID: this.#parentSubtask.id(),
          });
          const callerTask = this.#parentSubtask.getParentTask();
          _withGlobalCurrentTaskMeta({
            taskID: callerTask.id(),
            componentIdx: callerTask.componentIdx(),
            fn: () => meta.returnFn.apply(null, [taskValue, meta.resultPtr]),
          });
          meta.returnFnCalled = true;
        }
      }
      
      if (this.#postReturnFn) {
        _debugLog('[AsyncTask#onResolve()] running post return ', {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
        });
        try {
          _withGlobalCurrentTaskMeta({
            taskID: this.#id,
            componentIdx: this.#componentIdx,
            fn: () => this.#postReturnFn(taskValue),
          });
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      if (parentSubtaskPending) {
        this.#parentSubtask.onResolve(taskValue);
      }
    }
    
    registerOnResolveHandler(f) {
      this.#onResolveHandlers.push(f);
    }
    
    isRejected() { return this.#rejected; }
    
    isErrored() { return this.#errored; }
    setErrored(err) { this.#errored = err; }
    
    reject(taskErr) {
      _debugLog('[AsyncTask#reject()] args', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
        parentSubtask: this.#parentSubtask,
        parentSubtaskID: this.#parentSubtask?.id(),
        entryFnName: this.entryFnName(),
        callbackFnName: this.#callbackFnName,
        errMsg: taskErr.message,
      });
      
      if (this.isResolvedState() || this.#rejected) { return; }
      
      this.#rejected = true;
      this.cancelRequested = true;
      this.#state = AsyncTask.State.CANCEL_PENDING;
      const cancelled = this.deliverPendingCancel({ cancellable: true });
      
      // TODO: do cleanup here to reset the machinery so we can run again?
      
      this.cancel({ error: taskErr });
    }
    
    resolve(results) {
      _debugLog('[AsyncTask#resolve()] args', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
        entryFnName: this.entryFnName(),
        callbackFnName: this.#callbackFnName,
      });
      
      if (this.#state === AsyncTask.State.RESOLVED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}]  is already resolved (did you forget to wait for an import?)`);
      }
      
      if (this.borrowedHandles.length > 0) {
        throw new Error('task still has borrow handles');
      }
      
      this.#state = AsyncTask.State.RESOLVED;
      
      switch (results.length) {
        case 0:
        this.onResolve(undefined);
        break;
        case 1:
        this.onResolve(results[0]);
        break;
        default:
        _debugLog('[AsyncTask#resolve()] unexpected number of results', {
          componentIdx: this.#componentIdx,
          results,
          taskID: this.#id,
          subtaskID: this.#parentSubtask?.id(),
          entryFnName: this.#entryFnName,
          callbackFnName: this.#callbackFnName,
        });
        throw new Error('unexpected number of results');
      }
    }
    
    exit(args) {
      _debugLog('[AsyncTask#exit()]', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
      });
      
      if (this.#exited)  { throw new Error("task has already exited"); }
      
      if (this.#state !== AsyncTask.State.RESOLVED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] exited without resolution`);
      }
      
      if (this.borrowedHandles > 0) {
        throw new Error('task [${this.#id}] exited without clearing borrowed handles');
      }
      
      const state = getOrCreateAsyncState(this.#componentIdx);
      if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
      
      // Exempt the host from exclusive lock check
      if (this.#componentIdx !== -1 && !args?.skipExclusiveLockCheck && !this.#lockFreeEntry) {
        if (this.needsExclusiveLock() && !state.exclusivelyLockedBy(this.#id)) {
          throw new Error(`task [${this.#id}] exit: component [${this.#componentIdx}] should have been exclusively locked by it`);
        }
      }
      
      // Ownership-checked: releases only this task's own hold (a
      // task exiting while another task's slice holds the lock no
      // longer clears the foreign hold).
      state.exclusiveRelease(this.#id);
      
      for (const f of this.#onExitHandlers) {
        try {
          f();
        } catch (err) {
          console.error("error during task exit handler", err);
          throw err;
        }
      }
      
      this.#exited = true;
      clearCurrentTask(this.#componentIdx, this.id());
    }
    
    needsExclusiveLock() {
      // Host (-1) tasks model host-side import handling: there is no
      // guest linear memory or executor state to protect, and host
      // calls from unrelated guest components would contend spuriously.
      if (this.#componentIdx === -1) { return false; }
      // Import-handler tasks (CallInterface) run host code nested
      // inside the calling guest slice, which already holds the
      // lock; only tasks that execute guest slices need it.
      if (!this.#callingWasmExport) { return false; }
      return !this.#isAsync || this.hasCallback();
    }
    
    createSubtask(args) {
      _debugLog('[AsyncTask#createSubtask()] args', args);
      const { componentIdx, childTask, callMetadata, fnName, isAsync, isManualAsync } = args;
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (!cstate) {
        throw new Error(`invalid/missing async state for component idx [${componentIdx}]`);
      }
      
      const waitable = new Waitable({
        componentIdx: this.#componentIdx,
        target: `subtask (internal ID [${this.#id}])`,
      });
      
      const newSubtask = new AsyncSubtask({
        componentIdx,
        childTask,
        parentTask: this,
        callMetadata,
        isAsync,
        isManualAsync,
        fnName,
        waitable,
      });
      this.#subtasks.push(newSubtask);
      newSubtask.setTarget(`subtask (internal ID [${newSubtask.id()}], waitable [${waitable.idx()}], component [${componentIdx}])`);
      waitable.setIdx(cstate.handles.insert(newSubtask));
      waitable.setTarget(`waitable for subtask (waitable id [${waitable.idx()}], subtask internal ID [${newSubtask.id()}])`);
      return newSubtask;
    }
    
    getLatestSubtask() {
      return this.#subtasks.at(-1);
    }
    
    getSubtaskByWaitableRep(rep) {
      if (rep === undefined) { throw new TypeError('missing rep'); }
      return this.#subtasks.find(s => s.waitableRep() === rep);
    }
    
    currentSubtask() {
      _debugLog('[AsyncTask#currentSubtask()]');
      if (this.#subtasks.length === 0) { return undefined; }
      return this.#subtasks.at(-1);
    }
    
    removeSubtask(subtask) {
      if (this.#subtasks.length === 0) {
        throw new Error('cannot end current subtask: no current subtask');
      }
      this.#subtasks = this.#subtasks.filter(t => t !== subtask);
      return subtask;
    }
  }
  
  function createNewCurrentTask(args) {
    _debugLog('[createNewCurrentTask()] args', args);
    const {
      componentIdx,
      isAsync,
      isManualAsync,
      preserveFutureResult,
      entryFnName,
      parentSubtaskID,
      callbackFnName,
      getCallbackFn,
      getParamsFn,
      stringEncoding,
      errHandling,
      getCalleeParamsFn,
      resultPtr,
      callingWasmExport,
    } = args;
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while starting task');
    }
    let taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    const callbackFn = getCallbackFn ? getCallbackFn() : null;
    
    const newTask = new AsyncTask({
      componentIdx,
      isAsync,
      isManualAsync,
      preserveFutureResult,
      entryFnName,
      callbackFn,
      callbackFnName,
      stringEncoding,
      getCalleeParamsFn,
      resultPtr,
      errHandling,
      callingWasmExport,
    });
    
    const newTaskID = newTask.id();
    const newTaskMeta = { id: newTaskID, componentIdx, task: newTask };
    
    // NOTE: do not track host tasks
    ASYNC_CURRENT_TASK_IDS.push(newTaskID);
    ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
    
    if (!taskMetas) {
      taskMetas = [newTaskMeta];
      ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
    } else {
      taskMetas.push(newTaskMeta);
    }
    
    return [newTask, newTaskID];
  }
  
  function _checkMayLeave(componentIdx) {
    if (INSTANCE_FLAGS.get(componentIdx)?.value !== 1) {
      throw new WebAssemblyRuntimeError('cannot leave component instance');
    }
  }
  
  function _getGlobalCurrentTaskMeta(componentIdx) {
    if (componentIdx === null || componentIdx === undefined) {
      throw new Error("missing/invalid component idx");
    }
    const v = CURRENT_TASK_META[componentIdx];
    if (v === undefined || v === null) {
      return undefined;
    }
    return { ...v };
  }
  
  
  function _setGlobalCurrentTaskMeta(args) {
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    return CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
  }
  
  
  async function _clearCurrentTask(args) {
    _debugLog('[_clearCurrentTask()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    
    const meta = CURRENT_TASK_META[componentIdx];
    if (!meta) { throw new Error(`missing current task meta for component idx [${componentIdx}]`); }
    
    if (meta.taskID !== taskID) {
      throw new Error(`task ID [${meta.taskID}] != requested ID [${taskID}]`);
    }
    if (meta.componentIdx !== componentIdx) {
      throw new Error(`component idx [${meta.componentIdx}] != requested idx [${componentIdx}]`);
    }
    
    CURRENT_TASK_META[componentIdx] = null;
  }
  
  function _lowerImportBackwardsCompat(args) {
    const params = [...arguments].slice(1);
    _debugLog('[_lowerImportBackwardsCompat()] args', { args, params });
    const {
      functionIdx,
      componentIdx,
      isAsync,
      isManualAsync,
      paramLiftFns,
      resultLowerFns,
      hasResultPointer,
      funcTypeIsAsync,
      metadata,
      memoryIdx,
      getMemoryFn,
      getReallocFn,
      importFn,
      stringEncoding,
    } = args;
    
    _checkMayLeave(componentIdx);
    
    let meta = _getGlobalCurrentTaskMeta(componentIdx);
    let createdTask;
    
    // Some components depend on initialization logic (i.e. `_initialize` or some such
    // core wasm export) that is embedded in the component, but is not executed or wizer'd
    // away before the transpiled component is attempted to be used.
    //
    // These components execut their initialization logic *when they are imported* in the
    // transpiled context -- so we may get a call to an export that is lowered without going
    // through `CallWasm` or `CallInterface`.
    //
    if (!meta) {
      if (funcTypeIsAsync || (isAsync && !isManualAsync)) {
        throw new Error('p3 async wasm exports cannot use backwards compat auto-task init');
      }
      
      const [newTask, newTaskID] = createNewCurrentTask({
        componentIdx,
        isAsync,
        isManualAsync,
        callingWasmExport: false,
      });
      createdTask = newTask;
      
      // Since we're managing the task creation ourselves we must clear ourselves
      createdTask.registerOnResolveHandler(() => {
        _clearCurrentTask({
          taskID: task.id(),
          componentIdx: task.componentIdx(),
        });
      });
      
      _setGlobalCurrentTaskMeta({
        componentIdx,
        taskID: newTaskID,
      });
      
      meta = _getGlobalCurrentTaskMeta(componentIdx);
    }
    
    const { taskID } = meta;
    
    const taskMeta = getCurrentTask(componentIdx, taskID);
    if (!taskMeta) {
      throw new Error('invalid/missing async task meta');
    }
    
    const task = taskMeta.task;
    if (!task) { throw new Error('invalid/missing async task'); }
    
    const cstate = getOrCreateAsyncState(componentIdx);
    
    if (!task.mayBlock() && funcTypeIsAsync && !isAsync) {
      throw new Error("non async exports cannot synchronously call async functions");
    }
    
    // If there is an existing task, this should be part of a subtask
    const memory = getMemoryFn();
    // Canonical ABI lower appends result storage as a trailing
    // param when async lower has any flat result, or sync lower
    // has more than one flat result.
    const resultPtr = hasResultPointer ? params[params.length - 1] : undefined;
    const subtask = task.createSubtask({
      componentIdx,
      parentTask: task,
      fnName: importFn.fnName,
      isAsync,
      isManualAsync,
      callMetadata: {
        memoryIdx,
        memory,
        realloc: getReallocFn?.(),
        getReallocFn,
        resultPtr,
        lowers: resultLowerFns,
        stringEncoding,
      }
    });
    task.setReturnMemoryIdx(memoryIdx);
    task.setReturnMemory(getMemoryFn());
    
    subtask.onStart();
    
    // If dealing with a sync lowered sync function, we can directly return results
    //
    // TODO(breaking): remove once we get rid of manual async import specification,
    // as func types cannot be detected in that case only (and we don't need that w/ p3)
    if (!isManualAsync && !isAsync && !funcTypeIsAsync) {
      if (createdTask) { createdTask.enterSync(); }
      
      const res = importFn(...params);
      
      // TODO(breaking): remove once we get rid of manual async import specification,
      // as func types cannot be detected in that case only (and we don't need that w/ p3)
      if (!funcTypeIsAsync && !subtask.isReturned()) {
        throw new Error('post-execution subtasks must either be async or returned');
      }
      
      const syncRes = subtask.getResult();
      if (createdTask) { createdTask.resolve([syncRes]); }
      
      return syncRes;
    }
    
    // Sync-lowered async functions requires async behavior because the callee *can* block,
    // but this call must *act* synchronously and return immediately with the result
    // (i.e. not returning until the work is done)
    //
    // TODO(breaking): remove checking for manual async specification here, once we can go p3-only
    //
    if (!isManualAsync && !isAsync && funcTypeIsAsync) {
      const { promise, resolve, reject } = promiseWithResolvers();
      queueMicrotask(async () => {
        try {
          await importFn(...params);
          if (!subtask.isResolved()) {
            await task.suspendUntil({ readyFn: () => subtask.isResolved() });
          }
          resolve(subtask.getResult());
        } catch (err) {
          reject(err);
        }
      });
      return promise;
    }
    
    // NOTE: at this point we know that we are working with an async lowered import
    
    const subtaskState = subtask.getStateNumber();
    if (subtaskState < 0 || subtaskState >= 2**4) {
      throw new Error('invalid subtask state, out of valid range');
    }
    
    subtask.setOnProgressFn(() => {
      subtask.setPendingEvent(() => {
        if (subtask.isResolved()) { subtask.deliverResolve(); }
        const event = {
          code: ASYNC_EVENT_CODE.SUBTASK,
          payload0: subtask.waitableRep(),
          payload1: subtask.getStateNumber(),
        }
        return event;
      });
    });
    
    // This is a hack to maintain backwards compatibility with
    // manually-specified async imports, used in wasm exports that are
    // not actually async (but are specified as so).
    //
    // This is not normal p3 sync behavior but instead anticipating that
    // the caller that is doing manual async will be waiting for a promise that
    // resolves to the *actual* result.
    //
    // TODO(breaking): remove once manually specified async is removed
    //
    // There are a few cases:
    // 1. sync function with async types (e.g. `f: func() -> stream<u32>`)
    // 2. async function with async types (e.g. `f: async func() -> stream<u32>`)
    // 3. async function with sync types (e.g. `f: async func() -> list<u32>`)
    // 4. sync function with non-async types (e.g. `f: func() -> list<u32>`)
    //
    // This hack *only* applies to 4 -- the case where an async JS host function
    // is supplied to a Wasm export which does *not* need to do any async abi
    // lifting/lowering (async ABI did not exist when JSPI integratiton was
    // initially merged to enable asynchronously returning values from the host)
    //
    const requiresManualAsyncResult = !isAsync && !funcTypeIsAsync && isManualAsync;
    let manualAsyncResult;
    if (requiresManualAsyncResult) {
      manualAsyncResult = promiseWithResolvers();
    }
    
    queueMicrotask(async () => {
      try {
        _debugLog('[_lowerImportBackwardsCompat()] calling lowered import', { importFn, params });
        if (createdTask) { await createdTask.enter(); }
        
        const asyncRes = await importFn(...params);
        if (requiresManualAsyncResult) {
          manualAsyncResult.resolve(subtask.getResult());
        }
        
        if (createdTask) { createdTask.resolve([asyncRes]); }
        
        
      } catch (err) {
        _debugLog("[_lowerImportBackwardsCompat()] import fn error:", err);
        if (requiresManualAsyncResult) {
          manualAsyncResult.reject(err);
          return;
        }
        task.setErrored(err);
        task.reject(err);
      }
    });
    
    if (requiresManualAsyncResult) { return manualAsyncResult.promise; }
    
    _debugLog('[_lowerImportBackwardsCompat()] async-lowered import return', {
      fnName: importFn.fnName,
      componentIdx,
      subtaskID: subtask.id(),
      waitableRep: subtask.waitableRep(),
      subtaskState,
      packedResult: Number(subtask.waitableRep()) << 4 | subtaskState,
    });
    
    return Number(subtask.waitableRep()) << 4 | subtaskState;
  }
  
  function _liftFlatU8(ctx) {
    _debugLog('[_liftFlatU8()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length === 0) { throw new Error('expected at least a single i32 argument'); }
      val = ctx.params[0];
      ctx.params = ctx.params.slice(1);
      return [val, ctx];
    }
    
    if (ctx.storageLen !== undefined && ctx.storageLen < 1) {
      throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u8 requires 1 byte)`);
    }
    
    val = new DataView(ctx.memory.buffer).getUint8(ctx.storagePtr, true);
    
    ctx.storagePtr += 1;
    if (ctx.storageLen !== undefined) { ctx.storageLen -= 1; }
    
    return [val, ctx];
  }
  
  
  function _liftFlatU16(ctx) {
    _debugLog('[_liftFlatU16()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length === 0) { throw new Error('expected at least a single i32 argument'); }
      val = ctx.params[0];
      ctx.params = ctx.params.slice(1);
      return [val, ctx];
    }
    
    if (ctx.storageLen !== undefined && ctx.storageLen < 2) {
      throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u16 requires 2 bytes)`);
    }
    
    val = new DataView(ctx.memory.buffer).getUint16(ctx.storagePtr, true);
    
    ctx.storagePtr += 2;
    if (ctx.storageLen !== undefined) { ctx.storageLen -= 2; }
    
    const rem = ctx.storagePtr % 2;
    if (rem !== 0) { ctx.storagePtr += (2 - rem); }
    
    return [val, ctx];
  }
  
  
  function _liftFlatU32(ctx) {
    _debugLog('[_liftFlatU32()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length === 0) { throw new Error('expected at least a single i34 argument'); }
      // core i32 values arrive as signed numbers
      val = ctx.params[0] >>> 0;
      ctx.params = ctx.params.slice(1);
      return [val, ctx];
    }
    
    if (ctx.storageLen !== undefined && ctx.storageLen < 4) {
      throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u32 requires 4 bytes)`);
    }
    val = new DataView(ctx.memory.buffer).getUint32(ctx.storagePtr, true);
    ctx.storagePtr += 4;
    if (ctx.storageLen !== undefined) { ctx.storageLen -= 4; }
    
    return [val, ctx];
  }
  
  
  function _liftFlatU64(ctx) {
    _debugLog('[_liftFlatU64()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length === 0) { throw new Error('expected at least one single i64 argument'); }
      if (typeof ctx.params[0] !== 'bigint') { throw new Error('expected bigint'); }
      // core i64 values arrive as signed BigInts
      val = BigInt.asUintN(64, ctx.params[0]);
      ctx.params = ctx.params.slice(1);
      return [val, ctx];
    }
    
    if (ctx.storageLen !== undefined && ctx.storageLen < 8) {
      throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u64 requires 8 bytes)`);
    }
    
    val = new DataView(ctx.memory.buffer).getBigUint64(ctx.storagePtr, true);
    ctx.storagePtr += 8;
    if (ctx.storageLen !== undefined) { ctx.storageLen -= 8; }
    
    return [val, ctx];
  }
  
  
  function _liftFlatStringUTF8(ctx) {
    _debugLog('[_liftFlatStringUTF8()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length < 2) { throw new Error('expected at least two u32 arguments'); }
      let offset = ctx.params[0];
      if (typeof offset === 'bigint') { offset = Number(offset); }
      if (!Number.isSafeInteger(offset)) { throw new Error('invalid offset'); }
      const len = ctx.params[1];
      if (!Number.isSafeInteger(len)) {  throw new Error('invalid len'); }
      val = TEXT_DECODER_UTF8.decode(new DataView(ctx.memory.buffer, offset, len));
      ctx.params = ctx.params.slice(2);
      return [val, ctx];
    }
    
    const rem = ctx.storagePtr % 4;
    if (rem !== 0) { ctx.storagePtr += (4 - rem); }
    
    const dv = new DataView(ctx.memory.buffer);
    const start = dv.getUint32(ctx.storagePtr, true);
    const codeUnits = dv.getUint32(ctx.storagePtr + 4, true);
    
    val = TEXT_DECODER_UTF8.decode(new Uint8Array(ctx.memory.buffer, start, codeUnits));
    
    ctx.storagePtr += 8;
    if (ctx.storageLen !== undefined) { ctx.storagelen -= 8; }
    
    return [val, ctx];
  }
  
  function _liftFlatStringUTF16(ctx) {
    _debugLog('[_liftFlatStringUTF16()] args', { ctx });
    let val;
    
    if (ctx.useDirectParams) {
      if (ctx.params.length < 2) { throw new Error('expected at least two u32 arguments'); }
      let offset = ctx.params[0];
      if (typeof offset === 'bigint') { offset = Number(offset); }
      if (!Number.isSafeInteger(offset)) {  throw new Error('invalid offset'); }
      const len = ctx.params[1];
      if (!Number.isSafeInteger(len)) {  throw new Error('invalid len'); }
      val = utf16Decoder.decode(new DataView(ctx.memory.buffer, offset, len));
      ctx.params = ctx.params.slice(2);
      return [val, ctx];
    }
    
    const data = new DataView(ctx.memory.buffer)
    const start = data.getUint32(ctx.storagePtr, vals[0], true);
    const codeUnits = data.getUint32(ctx.storagePtr, vals[0] + 4, true);
    val = utf16Decoder.decode(new Uint16Array(ctx.memory.buffer, start, codeUnits));
    ctx.storagePtr = ctx.storagePtr + 2 * codeUnits;
    if (ctx.storageLen !== undefined) { ctx.storageLen = ctx.storageLen - 2 * codeUnits }
    
    return [val, ctx];
  }
  
  function _liftFlatStringAny(ctx) {
    switch (ctx.stringEncoding) {
      case 'utf8':
      return _liftFlatStringUTF8(ctx);
      case 'utf16':
      return _liftFlatStringUTF16(ctx);
      default:
      throw new Error(`missing/unrecognized/unsupported string encoding [${ctx.stringEncoding}]`);
    }
  }
  
  const _liftFlatVariantScratch = new DataView(new ArrayBuffer(8));
  
  function _liftFlatVariant(meta) {
    const {
      caseMetas,
      variantSize32,
      variantAlign32,
      variantPayloadOffset32,
      variantFlatCount,
      variantPayloadFlatTypes,
      isEnum,
    } = meta;
    
    return function _liftFlatVariantInner(ctx) {
      _debugLog('[_liftFlatVariant()] args', { ctx });
      const origUseParams = ctx.useDirectParams;
      
      let caseIdx;
      let liftRes;
      const originalPtr = ctx.storagePtr;
      const numCases =  caseMetas.length;
      if (caseMetas.length < 256) {
        liftRes = _liftFlatU8(ctx);
      } else if (numCases >= 256 && numCases < 65536) {
        liftRes = _liftFlatU16(ctx);
      } else if (numCases >= 65536 && numCases < 4_294_967_296) {
        liftRes = _liftFlatU32(ctx);
      } else {
        throw new Error(`unsupported number of variant cases [${numCases}]`);
      }
      caseIdx = liftRes[0];
      ctx = liftRes[1];
      
      const [
      tag,
      liftFn,
      caseSize32,
      caseAlign32,
      caseFlatCount,
      caseFlatTypes,
      ] = caseMetas[caseIdx];
      
      if (variantPayloadOffset32 === undefined) {
        throw new Error('unexpectedly missing payload offset');
      }
      
      if (originalPtr !== undefined) {
        ctx.storagePtr = originalPtr + variantPayloadOffset32;
      }
      
      let val;
      if (liftFn === null) {
        val = { tag };
        // NOTE: here we need to move past the entire object in memory
        // despite moving to the payload which we now know is missing/unnecessary
        if (originalPtr !== undefined) {
          ctx.storagePtr = originalPtr + variantSize32;
        }
      } else {
        // When lifting from direct params, the payload arrives as the
        // *join* of all case flat representations: each slot whose
        // joined core type differs from the selected case's core type
        // must be reinterpreted before the payload lift
        // (see CanonicalABI `lift_flat_variant`)
        if (ctx.useDirectParams) {
          if (!variantPayloadFlatTypes || !caseFlatTypes) {
            throw new Error('missing variant flat type metadata during direct-param lift');
          }
          const scratch = _liftFlatVariantScratch;
          for (let i = 0; i < caseFlatTypes.length; i++) {
            const have = variantPayloadFlatTypes[i];
            const want = caseFlatTypes[i];
            if (have === want) { continue; }
            const val = ctx.params[i];
            if (have === 'i64' && want === 'i32') {
              ctx.params[i] = Number(BigInt.asIntN(32, val));
            } else if (have === 'i64' && want === 'f32') {
              scratch.setInt32(0, Number(BigInt.asIntN(32, val)), true);
              ctx.params[i] = scratch.getFloat32(0, true);
            } else if (have === 'i64' && want === 'f64') {
              scratch.setBigInt64(0, val, true);
              ctx.params[i] = scratch.getFloat64(0, true);
            } else if (have === 'i32' && want === 'f32') {
              scratch.setInt32(0, val, true);
              ctx.params[i] = scratch.getFloat32(0, true);
            } else {
              throw new Error(`invalid variant payload coercion [${have}] -> [${want}]`);
            }
          }
        }
        
        const [newVal, newCtx] = liftFn(ctx);
        val = { tag, val: newVal };
        ctx = newCtx;
      }
      
      if (origUseParams) {
        if (variantFlatCount === undefined || variantFlatCount === null) {
          _debugLog('[_liftFlatVariant()] variant with unknown flat count', { ctx, meta });
          throw new Error('cannot lift variant with unknown flat count');
        }
        if (caseFlatCount === undefined || caseFlatCount === null) {
          _debugLog('[_liftFlatVariant()] case with unknown flat count', { ctx, meta, case: meta.caseMetas[caseIdx] });
          throw new Error('cannot lift case with unknown flat count');
        }
        // NOTE: enums can be tightly packed and do not have a descriminant
        const remainingPayloadParams = variantFlatCount - caseFlatCount - (isEnum ? 0 : 1);
        if (remainingPayloadParams < 0) {
          throw new Error(`invalid variant flat count metadata`);
        }
        if (ctx.params.length < remainingPayloadParams) {
          throw new Error(`expected at least [${remainingPayloadParams}] remaining variant payload params, but got [${ctx.params.length}]`);
        }
        ctx.params = ctx.params.slice(remainingPayloadParams);
      }
      
      if (ctx.storagePtr !== undefined) {
        const rem = ctx.storagePtr % variantAlign32;
        if (rem !== 0) { ctx.storagePtr += variantAlign32 - rem; }
      }
      
      return [val, ctx];
    }
  }
  
  function _liftFlatList(meta) {
    const { elemLiftFn, elemSize32, elemAlign32, knownLen, typedArray } = meta;
    
    const listValue =
    typedArray === undefined
    ? values => values
    : values => new typedArray(values);
    
    const readValuesAndReset = (ctx, originalPtr, originalLen, dataPtr, len) => {
      if (dataPtr % elemAlign32 !== 0) {
        throw new TypeError(`list pointer [${dataPtr}] is not aligned to ${elemAlign32}`);
      }
      ctx.storagePtr = dataPtr;
      const val = [];
      for (var i = 0; i < len; i++) {
        const elemPtr = dataPtr + i * elemSize32;
        ctx.storagePtr = elemPtr;
        const [res, nextCtx] = elemLiftFn(ctx);
        val.push(res);
        ctx = nextCtx;
        
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
      }
      if (originalPtr !== null) { ctx.storagePtr = originalPtr; }
      if (originalLen !== null) { ctx.storageLen = originalLen; }
      return [listValue(val), ctx];
    };
    
    return function _liftFlatListInner(ctx) {
      _debugLog('[_liftFlatList()] args', { ctx });
      
      let liftResults;
      if (knownLen !== undefined) { // list with known length
      if (ctx.useDirectParams) {
        _debugLog('memory unexpectedly missing while lifting unknown length list', { ctx });
        liftResults = [listValue(ctx.params.slice(0, knownLen)), ctx];
        ctx.params = ctx.params.slice(knownLen);
      } else { // indirect params
      if (ctx.memory === null) {
        _debugLog('memory unexpectedly missing while lifting known length list', { knownLen, ctx });
        throw new Error(`memory missing while lifting known length (${knownLen}) list`);
      }
      
      const originalLen = ctx.storageLen;
      const originalPtr = ctx.storagePtr;
      
      ctx.storageLen = knownLen * elemSize32;
      liftResults = readValuesAndReset(ctx, null, originalLen, ctx.storagePtr, knownLen);
    }
    
  } else { // unknown length list
  
  if (ctx.useDirectParams) {
    // unknown length list ptr w/ direct params
    const dataPtr = ctx.params[0];
    const len = ctx.params[1];
    ctx.params = ctx.params.slice(2);
    
    ctx.useDirectParams = false;
    const originalPtr = ctx.storagePtr;
    const originalLen = ctx.storageLen;
    ctx.storageLen = len * elemSize32;
    
    liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
    
    ctx.useDirectParams = true;
  } else {
    // unknown length list ptr w/ in-memory params
    const originalLen = ctx.storageLen;
    ctx.storageLen = 8;
    
    const dataPtrLiftRes = _liftFlatU32(ctx);
    const dataPtr = dataPtrLiftRes[0];
    ctx = dataPtrLiftRes[1];
    
    const lenLiftRes = _liftFlatU32(ctx);
    const len = lenLiftRes[0];
    ctx = lenLiftRes[1];
    
    const originalPtr = ctx.storagePtr;
    ctx.storagePtr = dataPtr;
    
    ctx.storageLen = len * elemSize32;
    liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
  }
}

return liftResults;
}
}

function _liftFlatFlags(meta) {
  const { names, size32, align32, intSizeBytes } = meta;
  
  return function _liftFlatFlagsInner(ctx) {
    _debugLog('[_liftFlatFlags()] args', { ctx });
    
    let val = {};
    
    let liftRes;
    let align;
    switch (intSizeBytes) {
      case 1:
      liftRes = _liftFlatU8(ctx);
      break;
      case 2:
      liftRes = _liftFlatU16(ctx);
      break;
      case 4:
      liftRes = _liftFlatU32(ctx);
      break;
      default:
      throw new Error('invalid flags size');
    }
    let bits = liftRes[0];
    ctx = liftRes[1];
    
    
    for (const name of names) {
      val[name] = (bits & 1) === 1;
      bits >>>= 1;
    }
    
    
    const rem = ctx.storagePtr % align32;
    if (rem !== 0) { ctx.storagePtr += align32 - rem; }
    
    return [val, ctx];
  }
}

function _liftFlatOption(meta) {
  const f = _liftFlatVariant(meta);
  return function _liftFlatOptionInner(ctx) {
    _debugLog('[_liftFlatOption()] args', { ctx });
    return f(ctx);
  }
}

function _liftFlatResult(meta) {
  const f = _liftFlatVariant(meta);
  return function _liftFlatResultInner(ctx) {
    _debugLog('[_liftFlatResult()] args', { ctx });
    return f(ctx);
  }
}

function _liftFlatOwn(meta) {
  const { classNameFn, createResourceFn, componentIdx } = meta;
  
  return function _liftFlatOwnInner(ctx) {
    _debugLog('[_liftFlatOwn()] args', { ctx, className: classNameFn() });
    
    if (ctx.componentIdx !== componentIdx) {
      throw new Error('invalid component for resource lift');
    }
    
    const [handle, newCtx] = _liftFlatU32(ctx);
    const resource = createResourceFn(handle);
    
    return [resource, newCtx];
  }
}

function _liftFlatBorrow(componentTableIdx, size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_liftFlatBorrow()] args', { size, memory, vals, storagePtr, storageLen });
  throw new Error('flat lift for borrowed resources is not supported!');
}


function _lowerFlatBool(ctx) {
  _debugLog('[_lowerFlatBool()] args', { ctx });
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  _requireValidNumericPrimitive.bind('bool', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint8(ctx.storagePtr, ctx.vals[0] ? 1 : 0);
  
  ctx.storagePtr += 1;
}

function _lowerFlatU8(ctx) {
  _debugLog('[_lowerFlatU8()] args', ctx);
  
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  _requireValidNumericPrimitive.bind('u8', ctx.vals[0]);
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  new DataView(ctx.memory.buffer).setUint8(ctx.storagePtr, ctx.vals[0]);
  
  ctx.storagePtr += 1;
}

function _lowerFlatU16(ctx) {
  _debugLog('[_lowerFlatU16()] args', { ctx });
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  const rem = ctx.storagePtr % 2;
  if (rem !== 0) { ctx.storagePtr += (2 - rem); }
  
  _requireValidNumericPrimitive.bind('u16', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint16(ctx.storagePtr, ctx.vals[0], true);
  
  ctx.storagePtr += 2;
}

function _lowerFlatU32(ctx) {
  _debugLog('[_lowerFlatU32()] args', { ctx });
  
  if (ctx.vals.length !== 1) {
    throw new Error(`expected single value to lower, got [${ctx.vals.length}]`);
  }
  
  const rem = ctx.storagePtr % 4;
  if (rem !== 0) { ctx.storagePtr += (4 - rem); }
  
  _requireValidNumericPrimitive.bind('u32', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
  
  ctx.storagePtr += 4;
}

function _lowerFlatU64(ctx) {
  _debugLog('[_lowerFlatU64()] args', { ctx });
  
  if (ctx.vals.length !== 1) { throw new Error('unexpected number of vals'); }
  
  const rem = ctx.storagePtr % 8;
  if (rem !== 0) { ctx.storagePtr += (8 - rem); }
  
  _requireValidNumericPrimitive.bind('u64', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setBigUint64(ctx.storagePtr, ctx.vals[0], true);
  
  ctx.storagePtr += 8;
}

function _lowerFlatStringUTF8(ctx) {
  _debugLog('[_lowerFlatStringUTF8()] args', ctx);
  if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
  
  const { ptr, len } = _utf8AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, len, true);
  
  ctx.storagePtr += 8;
}

function _lowerFlatStringUTF16(ctx) {
  _debugLog('[_lowerFlatStringUTF16()] args', { ctx });
  if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
  
  const { ptr, len } = _utf16AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, len, true);
  
  ctx.storagePtr += 8;
}

function _lowerFlatStringAny(ctx) {
  switch (ctx.stringEncoding) {
    case 'utf8':
    return _lowerFlatStringUTF8(ctx);
    case 'utf16':
    return _lowerFlatStringUTF16(ctx);
    default:
    throw new Error(`missing/unrecognized/unsupported string encoding [${ctx.stringEncoding}]`);
  }
}

function _lowerFlatRecord(meta) {
  const { fieldMetas, size32: recordSize32, align32: recordAlign32 } = meta;
  return function _lowerFlatRecordInner(ctx) {
    _debugLog('[_lowerFlatRecord()] args', { ctx });
    
    const originalPtr = ctx.storagePtr;
    const r = ctx.vals[0];
    for (const [tag, lowerFn, size32, align32 ] of fieldMetas) {
      const rem = ctx.storagePtr % align32;
      if (rem !== 0) { ctx.storagePtr += align32 - rem; }
      
      const fieldPtr = ctx.storagePtr;
      ctx.vals = [r[tag]];
      lowerFn(ctx);
      
      ctx.storagePtr = Math.max(ctx.storagePtr, fieldPtr + size32);
    }
    
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + recordSize32);
    
    const rem = ctx.storagePtr % recordAlign32;
    if (rem !== 0) {
      ctx.storagePtr += recordAlign32 - rem;
    }
  }
}

function _lowerFlatVariant(meta) {
  const { variantSize32, variantAlign32, variantPayloadOffset32, caseMetas } = meta;
  
  let caseLookup = {};
  for (const [idx, meta] of caseMetas.entries()) {
    let tag = meta[0];
    caseLookup[tag] = { discriminant: idx, meta };
  }
  
  return function _lowerFlatVariantInner(ctx) {
    _debugLog('[_lowerFlatVariant()] args', { ctx });
    
    const { tag, val } = ctx.vals[0];
    const variantCase = caseLookup[tag];
    if (!variantCase) {
      throw new Error(`missing tag [${tag}] (valid tags: ${Object.keys(caseLookup)})`);
    }
    
    const [ _tag, lowerFn, caseSize32, caseAlign32, caseFlatCount ] = variantCase.meta;
    
    const originalPtr = ctx.storagePtr;
    ctx.vals = [variantCase.discriminant];
    let discLowerRes;
    if (caseMetas.length < 256) {
      discLowerRes = _lowerFlatU8(ctx);
    } else if (caseMetas.length >= 256 && caseMetas.length < 65536) {
      discLowerRes = _lowerFlatU16(ctx);
    } else if (caseMetas.length >= 65536 && caseMetas.length < 4_294_967_296) {
      discLowerRes = _lowerFlatU32(ctx);
    } else {
      throw new Error(`unsupported number of cases [${caseMetas.length}]`);
    }
    
    const payloadOffsetPtr = originalPtr + variantPayloadOffset32;
    ctx.storagePtr = payloadOffsetPtr;
    ctx.vals = [val];
    if (lowerFn) { lowerFn(ctx); }
    
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + variantSize32);
    
    const rem = ctx.storagePtr % variantAlign32;
    if (rem !== 0) { ctx.storagePtr += variantAlign32 - rem; }
  }
}

function _lowerFlatList(meta) {
  const {
    elemLowerFn,
    knownLen,
    size32,
    align32,
    elemSize32,
    elemAlign32,
  } = meta;
  
  if (!elemLowerFn) { throw new TypeError("missing/invalid element lower fn for list"); }
  
  return function _lowerFlatListInner(ctx) {
    _debugLog('[_lowerFlatList()] args', { ctx });
    
    if (ctx.useDirectParams) {
      if (ctx.params.length < 2) { throw new Error('insufficient params left to lower list'); }
      const storagePtr = ctx.params[0];
      const elemCount = ctx.params[1];
      ctx.params = ctx.params.slice(2);
      
      const list = ctx.vals[0];
      if (!list) { throw new Error("missing direct param value"); }
      
      const lowerCtx = {
        storagePtr,
        memory: ctx.memory,
        stringEncoding: ctx.stringEncoding,
      };
      for (let idx = 0; idx < list.length; idx++) {
        const elemPtr = storagePtr + idx * elemSize32;
        lowerCtx.storagePtr = elemPtr;
        lowerCtx.vals = list.slice(idx, idx+1);
        elemLowerFn(lowerCtx);
        lowerCtx.storagePtr = Math.max(lowerCtx.storagePtr, elemPtr + elemSize32);
      }
      ctx.storagePtr = lowerCtx.storagePtr;
      
      // TODO: implement parma-only known-length processing
      
      return;
    }
    
    // TODO(fix): is it possible to get a vals that are a addr and length here from
    // a component lower?
    
    const elems = ctx.vals[0];
    if (knownLen === undefined) {
      // unknown length
      if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
      const dataPtr = ctx.realloc(0, 0, elemAlign32, elemSize32 * elems.length);
      
      ctx.vals[0] = dataPtr;
      _lowerFlatU32(ctx);
      
      ctx.vals[0] = elems.length;
      _lowerFlatU32(ctx);
      
      const origPtr = ctx.storagePtr;
      ctx.storagePtr = dataPtr;
      
      for (const [idx, elem] of elems.entries()) {
        const elemPtr = dataPtr + idx * elemSize32;
        ctx.storagePtr = elemPtr;
        ctx.vals = [elem];
        elemLowerFn(ctx);
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
      }
      
      ctx.storagePtr = origPtr;
      
    } else {
      // known length
      
      if (elems.length !== knownLen) {
        throw new TypeError(`invalid list input of length [${elems.length}], must be length [${knownLen}]`);
      }
      
      const originalPtr = ctx.storagePtr;
      for (const [idx, elem] of elems.entries()) {
        const elemPtr = originalPtr + idx * elemSize32;
        ctx.storagePtr = elemPtr;
        ctx.vals = [elem];
        elemLowerFn(ctx);
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
      }
    }
    
    // TODO(fix): special case for u8/u16/etc, we can do a direct copy
    
    const totalSizeBytes = elems.length * size32;
    if (ctx.storageLen !== undefined && totalSizeBytes > ctx.storageLen) {
      throw new Error('not enough storage remaining for list flat lower');
    }
  }
}

function _lowerFlatTuple(meta) {
  const { elemLowerMetas, size32: tupleSize32, align32: tupleAlign32 } = meta;
  return function _lowerFlatTupleInner(ctx) {
    _debugLog('[_lowerFlatTuple()] args', { ctx });
    const originalPtr = ctx.storagePtr;
    const tuple = ctx.vals[0];
    for (const [idx, [ lowerFn, size32, align32 ]]  of elemLowerMetas.entries()) {
      const rem = ctx.storagePtr % align32;
      if (rem !== 0) { ctx.storagePtr += align32 - rem; }
      
      const elemPtr = ctx.storagePtr;
      ctx.vals = [tuple[idx]];
      lowerFn(ctx);
      ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + size32);
    }
    
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + tupleSize32);
    
    const rem = ctx.storagePtr % tupleAlign32;
    if (rem !== 0) {
      ctx.storagePtr += tupleAlign32 - rem;
    }
  }
}

function _lowerFlatFlags(meta) {
  const { names, size32, align32, intSizeBytes } = meta;
  
  return function _lowerFlatFlagsInner(ctx) {
    _debugLog('[_lowerFlatFlags()] args', { ctx });
    if (ctx.vals.length !== 1) { throw new Error('unexpected number of vals'); }
    
    
    const flagObj = ctx.vals[0];
    let flagValue = 0;
    if (typeof flagObj === 'object' && flagObj !== null) {
      for (const [idx, name] of names.entries()) {
        if (flagObj[name] === true) {
          flagValue |= 1 << idx;
        }
      }
    } else if (flagObj !== null && flagObj !== undefined) {
      throw new TypeError('only an object, undefined or null can be converted to flags');
    }
    
    
    const rem = ctx.storagePtr % align32;
    if (rem !== 0) { ctx.storagePtr += (align32 - rem); }
    
    const dv = new DataView(ctx.memory.buffer);
    if (intSizeBytes === 1) {
      dv.setUint8(ctx.storagePtr, flagValue);
    } else if (intSizeBytes === 2) {
      dv.setUint16(ctx.storagePtr, flagValue, true);
    } else if (intSizeBytes === 4) {
      dv.setUint32(ctx.storagePtr, flagValue, true);
    } else {
      throw new Error(`unrecognized flag size [${intSizeBytes} bytes]`);
    }
    
    ctx.storagePtr += intSizeBytes;
  }
}

function _lowerFlatEnum(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatEnumInner(ctx) {
    _debugLog('[_lowerFlatEnum()] args', { ctx });
    
    const v = ctx.vals[0];
    const isNotEnumObject = typeof v !== 'object'
    || Object.keys(v).length !== 2
    || !('tag' in v);
    if (isNotEnumObject) {
      ctx.vals[0] = { tag: v };
    }
    
    f(ctx);
  }
}

function _lowerFlatOption(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatOptionInner(ctx) {
    _debugLog('[_lowerFlatOption()] args', { ctx });
    
    const v = ctx.vals[0];
    if (v === null || v === undefined) {
      ctx.vals[0] = { tag: 'none' };
    } else {
      const isNotOptionObject = typeof v !== 'object'
      || Object.keys(v).length !== 2
      || !('tag' in v)
      || !(v.tag === 'some' || v.tag === 'none')
      || !('val' in v);
      if (isNotOptionObject) {
        ctx.vals[0] = { tag: 'some', val: v };
      }
    }
    
    f(ctx);
  }
}

function _lowerFlatResult(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatResultInner(ctx) {
    _debugLog('[_lowerFlatResult()] args', { ctx });
    
    const v = ctx.vals[0];
    const isNotResultObject = typeof v !== 'object'
    || Object.keys(v).length !== 2
    || !('tag' in v)
    || !('ok' === v.tag || 'err' === v.tag)
    || !('val' in v);
    if (isNotResultObject) {
      ctx.vals[0] = { tag: 'ok', val: v };
    }
    
    f(ctx);
  };
}

function _lowerFlatOwn(meta) {
  const { lowerFn, componentIdx } = meta;
  
  return function _lowerFlatOwnInner(ctx) {
    _debugLog('[_lowerFlatOwn()] args', { ctx });
    const { createFn } = ctx;
    
    if (ctx.componentIdx !== componentIdx) {
      throw new Error(`component index mismatch (expected [${componentIdx}], lift called from [${ctx.componentIdx}])`);
    }
    
    const obj = ctx.vals[0];
    if (obj === undefined || obj === null) { throw new Error('missing resource'); }
    const handle = lowerFn(obj);
    
    ctx.vals[0] = handle;
    _lowerFlatU32(ctx);
  };
}

function _guardMayLeave(componentIdx, fn) {
  return function (...args) {
    _checkMayLeave(componentIdx);
    return fn.apply(this, args);
  };
}

const fetchCompile = url => fetch(url).then(WebAssembly.compileStreaming);

const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');
const symbolDispose = Symbol.dispose || Symbol.for('dispose');

const HANDLE_TABLES= [];


class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

function _suspendingImport(componentIdx, fn) {
  return async function (...args) {
    _checkMayLeave(componentIdx);
    const saved = CURRENT_TASK_META[componentIdx] ?? null;
    try {
      return await fn.apply(null, args);
    } finally {
      CURRENT_TASK_META[componentIdx] = saved;
    }
  };
}


if (!getCoreModule) getCoreModule = (name) => fetchCompile(new URL(`./${name}`, import.meta.url));
const module0 = getCoreModule('aws.core.wasm');
const module1 = getCoreModule('aws.core2.wasm');
const module2 = getCoreModule('aws.core3.wasm');

const { provideCredentials, provideRegion } = imports['component:aws-cli/providers'];

if (provideCredentials=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'provideCredentials', was 'provideCredentials' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (provideRegion=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'provideRegion', was 'provideRegion' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getArguments, getEnvironment } = imports['wasi:cli/environment'];

if (getArguments=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getArguments', was 'getArguments' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (getEnvironment=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getEnvironment', was 'getEnvironment' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { exit } = imports['wasi:cli/exit'];

if (exit=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'exit', was 'exit' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStderr } = imports['wasi:cli/stderr'];

if (getStderr=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStderr', was 'getStderr' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStdin } = imports['wasi:cli/stdin'];

if (getStdin=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStdin', was 'getStdin' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getStdout } = imports['wasi:cli/stdout'];

if (getStdout=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getStdout', was 'getStdout' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { TerminalInput } = imports['wasi:cli/terminal-input'];

if (TerminalInput=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'TerminalInput', was 'TerminalInput' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { TerminalOutput } = imports['wasi:cli/terminal-output'];

if (TerminalOutput=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'TerminalOutput', was 'TerminalOutput' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getTerminalStderr } = imports['wasi:cli/terminal-stderr'];

if (getTerminalStderr=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getTerminalStderr', was 'getTerminalStderr' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getTerminalStdin } = imports['wasi:cli/terminal-stdin'];

if (getTerminalStdin=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getTerminalStdin', was 'getTerminalStdin' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getTerminalStdout } = imports['wasi:cli/terminal-stdout'];

if (getTerminalStdout=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getTerminalStdout', was 'getTerminalStdout' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { now, subscribeDuration } = imports['wasi:clocks/monotonic-clock'];

if (now=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'now', was 'now' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (subscribeDuration=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'subscribeDuration', was 'subscribeDuration' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { now: now$1 } = imports['wasi:clocks/wall-clock'];

if (now$1=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'now$1', was 'now' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { getDirectories } = imports['wasi:filesystem/preopens'];

if (getDirectories=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'getDirectories', was 'getDirectories' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Descriptor, DirectoryEntryStream } = imports['wasi:filesystem/types'];

if (Descriptor=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Descriptor', was 'Descriptor' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (DirectoryEntryStream=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'DirectoryEntryStream', was 'DirectoryEntryStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { handle } = imports['wasi:http/outgoing-handler'];

if (handle=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'handle', was 'handle' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Fields, FutureIncomingResponse, FutureTrailers, IncomingBody, IncomingResponse, OutgoingBody, OutgoingRequest, RequestOptions } = imports['wasi:http/types'];

if (Fields=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Fields', was 'Fields' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (FutureIncomingResponse=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'FutureIncomingResponse', was 'FutureIncomingResponse' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (FutureTrailers=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'FutureTrailers', was 'FutureTrailers' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (IncomingBody=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'IncomingBody', was 'IncomingBody' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (IncomingResponse=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'IncomingResponse', was 'IncomingResponse' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (OutgoingBody=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'OutgoingBody', was 'OutgoingBody' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (OutgoingRequest=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'OutgoingRequest', was 'OutgoingRequest' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (RequestOptions=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'RequestOptions', was 'RequestOptions' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Error: Error$1 } = imports['wasi:io/error'];

if (Error$1=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Error$1', was 'Error' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Pollable, poll } = imports['wasi:io/poll'];

if (Pollable=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Pollable', was 'Pollable' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (poll=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'poll', was 'poll' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { InputStream, OutputStream } = imports['wasi:io/streams'];

if (InputStream=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'InputStream', was 'InputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


if (OutputStream=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'OutputStream', was 'OutputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { insecureSeed } = imports['wasi:random/insecure-seed'];

if (insecureSeed=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'insecureSeed', was 'insecureSeed' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

let gen = (function* _initGenerator () {
  const instanceFlags0 = new WebAssembly.Global({ value: "i32", mutable: true }, 1);
  INSTANCE_FLAGS.set(0, instanceFlags0);
  let exports0;
  
  const handleTable5 = [T_FLAG, 0];
  handleTable5._createdReps = new Set();
  
  
  const captureTable5= new Map();
  let captureCnt5= 0;
  
  HANDLE_TABLES[5] = handleTable5;
  
  const handleTable6 = [T_FLAG, 0];
  handleTable6._createdReps = new Set();
  
  
  const captureTable6= new Map();
  let captureCnt6= 0;
  
  HANDLE_TABLES[6] = handleTable6;
  
  const _trampoline2 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable5[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable5.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(IncomingBody.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    else {
      captureTable5.delete(rep2);
    }
    rscTableRemove(handleTable5, handle1);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[static]incoming-body.finish"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'IncomingBody.finish',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => IncomingBody.finish(rsc0),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof FutureTrailers)) {
      throw new TypeError('Resource error: Not a valid \"FutureTrailers\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt6;
      captureTable6.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable6, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[static]incoming-body.finish"][Instruction::Return]', {
      funcName: '[static]incoming-body.finish',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline2.fnName = 'wasi:http/types@0.2.12#IncomingBody.finish';
  
  const handleTable0 = [T_FLAG, 0];
  handleTable0._createdReps = new Set();
  
  
  const captureTable0= new Map();
  let captureCnt0= 0;
  
  HANDLE_TABLES[0] = handleTable0;
  
  const _trampoline4 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(FutureTrailers.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-trailers.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'subscribe',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.subscribe(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable0, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-trailers.subscribe"][Instruction::Return]', {
      funcName: '[method]future-trailers.subscribe',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline4.fnName = 'wasi:http/types@0.2.12#subscribe';
  
  const handleTable8 = [T_FLAG, 0];
  handleTable8._createdReps = new Set();
  
  
  const captureTable8= new Map();
  let captureCnt8= 0;
  
  HANDLE_TABLES[8] = handleTable8;
  
  const _trampoline8 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable8[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable8.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(FutureIncomingResponse.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-incoming-response.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'subscribe',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.subscribe(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable0, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-incoming-response.subscribe"][Instruction::Return]', {
      funcName: '[method]future-incoming-response.subscribe',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline8.fnName = 'wasi:http/types@0.2.12#subscribe';
  
  const handleTable9 = [T_FLAG, 0];
  handleTable9._createdReps = new Set();
  
  
  const captureTable9= new Map();
  let captureCnt9= 0;
  
  HANDLE_TABLES[9] = handleTable9;
  
  const handleTable7 = [T_FLAG, 0];
  handleTable7._createdReps = new Set();
  
  
  const captureTable7= new Map();
  let captureCnt7= 0;
  
  HANDLE_TABLES[7] = handleTable7;
  
  const _trampoline10 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable9.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(IncomingResponse.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.headers"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'headers',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.headers(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    if (!(ret instanceof Fields)) {
      throw new TypeError('Resource error: Not a valid \"Headers\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt7;
      captureTable7.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable7, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.headers"][Instruction::Return]', {
      funcName: '[method]incoming-response.headers',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline10.fnName = 'wasi:http/types@0.2.12#headers';
  
  const _trampoline11 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable9.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(IncomingResponse.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.status"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'status',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.status(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.status"][Instruction::Return]', {
      funcName: '[method]incoming-response.status',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([toUint16(ret)]);
    task.exit();
    return toUint16(ret);
  }
  _trampoline11.fnName = 'wasi:http/types@0.2.12#status';
  
  const _trampoline14 = async function(arg0) {
    _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.12", function="subscribe-duration"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'subscribeDuration',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    
    try {
      ret = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => subscribeDuration(BigInt.asUintN(64, BigInt(arg0))),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during async call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      return task.completionPromise();
      
    }
    
    
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable0, rep);
    }
    
    _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.12", function="subscribe-duration"][Instruction::Return]', {
      funcName: 'subscribe-duration',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline14.fnName = 'wasi:clocks/monotonic-clock@0.2.12#subscribeDuration';
  _trampoline14.manuallyAsync = true;
  
  const _trampoline15 = function() {
    _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.12", function="now"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'now',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => now(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.12", function="now"][Instruction::Return]', {
      funcName: 'now',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([toUint64(ret)]);
    task.exit();
    return toUint64(ret);
  }
  _trampoline15.fnName = 'wasi:clocks/monotonic-clock@0.2.12#now';
  
  const handleTable10 = [T_FLAG, 0];
  handleTable10._createdReps = new Set();
  
  
  const captureTable10= new Map();
  let captureCnt10= 0;
  
  HANDLE_TABLES[10] = handleTable10;
  
  const _trampoline16 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable7.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Fields.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    else {
      captureTable7.delete(rep2);
    }
    rscTableRemove(handleTable7, handle1);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]outgoing-request"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'new OutgoingRequest',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => new OutgoingRequest(rsc0),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof OutgoingRequest)) {
      throw new TypeError('Resource error: Not a valid \"OutgoingRequest\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt10;
      captureTable10.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable10, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]outgoing-request"][Instruction::Return]', {
      funcName: '[constructor]outgoing-request',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline16.fnName = 'wasi:http/types@0.2.12#new OutgoingRequest';
  
  const handleTable11 = [T_FLAG, 0];
  handleTable11._createdReps = new Set();
  
  
  const captureTable11= new Map();
  let captureCnt11= 0;
  
  HANDLE_TABLES[11] = handleTable11;
  
  const _trampoline18 = function() {
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]request-options"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'new RequestOptions',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => new RequestOptions(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof RequestOptions)) {
      throw new TypeError('Resource error: Not a valid \"RequestOptions\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt11;
      captureTable11.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable11, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]request-options"][Instruction::Return]', {
      funcName: '[constructor]request-options',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline18.fnName = 'wasi:http/types@0.2.12#new RequestOptions';
  
  const _trampoline19 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable11[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable11.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(RequestOptions.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant3;
    switch (arg1) {
      case 0: {
        variant3 = undefined;
        break;
      }
      case 1: {
        variant3 = BigInt.asUintN(64, BigInt(arg2));
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-connect-timeout"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setConnectTimeout',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet4 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setConnectTimeout(variant3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    let variant5_0;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        variant5_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        variant5_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-connect-timeout"][Instruction::Return]', {
      funcName: '[method]request-options.set-connect-timeout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant5_0]);
    task.exit();
    return variant5_0;
  }
  _trampoline19.fnName = 'wasi:http/types@0.2.12#setConnectTimeout';
  
  const _trampoline20 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable11[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable11.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(RequestOptions.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant3;
    switch (arg1) {
      case 0: {
        variant3 = undefined;
        break;
      }
      case 1: {
        variant3 = BigInt.asUintN(64, BigInt(arg2));
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-first-byte-timeout"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setFirstByteTimeout',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet4 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setFirstByteTimeout(variant3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    let variant5_0;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        variant5_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        variant5_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-first-byte-timeout"][Instruction::Return]', {
      funcName: '[method]request-options.set-first-byte-timeout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant5_0]);
    task.exit();
    return variant5_0;
  }
  _trampoline20.fnName = 'wasi:http/types@0.2.12#setFirstByteTimeout';
  
  const _trampoline21 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable11[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable11.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(RequestOptions.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant3;
    switch (arg1) {
      case 0: {
        variant3 = undefined;
        break;
      }
      case 1: {
        variant3 = BigInt.asUintN(64, BigInt(arg2));
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-between-bytes-timeout"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setBetweenBytesTimeout',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet4 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setBetweenBytesTimeout(variant3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    let variant5_0;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        variant5_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        variant5_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]request-options.set-between-bytes-timeout"][Instruction::Return]', {
      funcName: '[method]request-options.set-between-bytes-timeout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant5_0]);
    task.exit();
    return variant5_0;
  }
  _trampoline21.fnName = 'wasi:http/types@0.2.12#setBetweenBytesTimeout';
  
  const handleTable2 = [T_FLAG, 0];
  handleTable2._createdReps = new Set();
  
  
  const captureTable2= new Map();
  let captureCnt2= 0;
  
  HANDLE_TABLES[2] = handleTable2;
  
  const _trampoline23 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable2.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'subscribe',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.subscribe(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable0, rep);
    }
    
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.subscribe"][Instruction::Return]', {
      funcName: '[method]output-stream.subscribe',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline23.fnName = 'wasi:io/streams@0.2.12#subscribe';
  
  const handleTable3 = [T_FLAG, 0];
  handleTable3._createdReps = new Set();
  
  
  const captureTable3= new Map();
  let captureCnt3= 0;
  
  HANDLE_TABLES[3] = handleTable3;
  
  const _trampoline24 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(InputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]input-stream.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'subscribe',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.subscribe(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable0, rep);
    }
    
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]input-stream.subscribe"][Instruction::Return]', {
      funcName: '[method]input-stream.subscribe',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle3]);
    task.exit();
    return handle3;
  }
  _trampoline24.fnName = 'wasi:io/streams@0.2.12#subscribe';
  
  const _trampoline26 = function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable0.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Pollable.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/poll@0.2.12", function="[method]pollable.ready"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'ready',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.ready(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    _debugLog('[iface="wasi:io/poll@0.2.12", function="[method]pollable.ready"][Instruction::Return]', {
      funcName: '[method]pollable.ready',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([ret ? 1 : 0]);
    task.exit();
    return ret ? 1 : 0;
  }
  _trampoline26.fnName = 'wasi:io/poll@0.2.12#ready';
  
  const _trampoline27 = function() {
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]fields"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'new Fields',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => new Fields(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof Fields)) {
      throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt7;
      captureTable7.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable7, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.12", function="[constructor]fields"][Instruction::Return]', {
      funcName: '[constructor]fields',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline27.fnName = 'wasi:http/types@0.2.12#new Fields';
  
  const _trampoline32 = function(arg0) {
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
    _debugLog('[iface="wasi:cli/exit@0.2.12", function="exit"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'exit',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => exit(variant0),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    _debugLog('[iface="wasi:cli/exit@0.2.12", function="exit"][Instruction::Return]', {
      funcName: 'exit',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline32.fnName = 'wasi:cli/exit@0.2.12#exit';
  
  const _trampoline33 = async function(arg0) {
    var handle1 = arg0;
    
    var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable0.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Pollable.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/poll@0.2.12", function="[method]pollable.block"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'block',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    
    try {
      ret = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.block(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during async call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      return task.completionPromise();
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    _debugLog('[iface="wasi:io/poll@0.2.12", function="[method]pollable.block"][Instruction::Return]', {
      funcName: '[method]pollable.block',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline33.fnName = 'wasi:io/poll@0.2.12#block';
  _trampoline33.manuallyAsync = true;
  
  const _trampoline34 = function() {
    _debugLog('[iface="wasi:cli/stdin@0.2.12", function="get-stdin"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getStdin',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getStdin(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof InputStream)) {
      throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable3, rep);
    }
    
    _debugLog('[iface="wasi:cli/stdin@0.2.12", function="get-stdin"][Instruction::Return]', {
      funcName: 'get-stdin',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline34.fnName = 'wasi:cli/stdin@0.2.12#getStdin';
  
  const _trampoline35 = function() {
    _debugLog('[iface="wasi:cli/stdout@0.2.12", function="get-stdout"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getStdout',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getStdout(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable2, rep);
    }
    
    _debugLog('[iface="wasi:cli/stdout@0.2.12", function="get-stdout"][Instruction::Return]', {
      funcName: 'get-stdout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline35.fnName = 'wasi:cli/stdout@0.2.12#getStdout';
  
  const _trampoline36 = function() {
    _debugLog('[iface="wasi:cli/stderr@0.2.12", function="get-stderr"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getStderr',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getStderr(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable2, rep);
    }
    
    _debugLog('[iface="wasi:cli/stderr@0.2.12", function="get-stderr"][Instruction::Return]', {
      funcName: 'get-stderr',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline36.fnName = 'wasi:cli/stderr@0.2.12#getStderr';
  let exports1;
  let memory0;
  let realloc0;
  let realloc0Async;
  
  const _trampoline37 = async function(arg0, arg1, arg2, arg3) {
    let variant1;
    switch (arg0) {
      case 0: {
        variant1 = undefined;
        break;
      }
      case 1: {
        var ptr0 = arg1;
        var len0 = arg2;
        var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
        variant1 = result0;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="component:aws-cli/providers", function="provide-region"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'provideRegion',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    
    try {
      ret = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => provideRegion(variant1),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during async call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      return task.completionPromise();
      
    }
    
    var variant3 = ret;
    if (variant3 === null || variant3=== undefined) {
      dataView(memory0).setInt8(arg3 + 0, 0, true);
    } else {
      const e = variant3;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      
      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
      var ptr2= encodeRes.ptr;
      var len2 = encodeRes.len;
      
      dataView(memory0).setUint32(arg3 + 8, len2, true);
      dataView(memory0).setUint32(arg3 + 4, ptr2, true);
    }
    _debugLog('[iface="component:aws-cli/providers", function="provide-region"][Instruction::Return]', {
      funcName: 'provide-region',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline37.fnName = 'component:aws-cli/providers#provideRegion';
  _trampoline37.manuallyAsync = true;
  
  const _trampoline38 = async function(arg0, arg1, arg2, arg3) {
    let variant1;
    switch (arg0) {
      case 0: {
        variant1 = undefined;
        break;
      }
      case 1: {
        var ptr0 = arg1;
        var len0 = arg2;
        var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
        variant1 = result0;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="component:aws-cli/providers", function="provide-credentials"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'provideCredentials',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet2 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => provideCredentials(variant1),
      })
      ;
      ret = hostRet2 !== null && typeof hostRet2 === 'object' && (hostRet2.tag === 'ok' || hostRet2.tag === 'err')
      ? hostRet2
      : { tag: 'ok', val: hostRet2};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    var variant13 = ret;
    switch (variant13.tag) {
      case 'ok': {
        const e = variant13.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        var {accessKeyId: v3_0, secretAccessKey: v3_1, sessionToken: v3_2, expiresAfter: v3_3, accountId: v3_4 } = e;
        
        var encodeRes = _utf8AllocateAndEncode(v3_0, realloc0, memory0);
        var ptr4= encodeRes.ptr;
        var len4 = encodeRes.len;
        
        dataView(memory0).setUint32(arg3 + 12, len4, true);
        dataView(memory0).setUint32(arg3 + 8, ptr4, true);
        
        var encodeRes = _utf8AllocateAndEncode(v3_1, realloc0, memory0);
        var ptr5= encodeRes.ptr;
        var len5 = encodeRes.len;
        
        dataView(memory0).setUint32(arg3 + 20, len5, true);
        dataView(memory0).setUint32(arg3 + 16, ptr5, true);
        var variant7 = v3_2;
        if (variant7 === null || variant7=== undefined) {
          dataView(memory0).setInt8(arg3 + 24, 0, true);
        } else {
          const e = variant7;
          dataView(memory0).setInt8(arg3 + 24, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr6= encodeRes.ptr;
          var len6 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 32, len6, true);
          dataView(memory0).setUint32(arg3 + 28, ptr6, true);
        }
        var variant8 = v3_3;
        if (variant8 === null || variant8=== undefined) {
          dataView(memory0).setInt8(arg3 + 40, 0, true);
        } else {
          const e = variant8;
          dataView(memory0).setInt8(arg3 + 40, 1, true);
          dataView(memory0).setBigInt64(arg3 + 48, toUint64(e), true);
        }
        var variant10 = v3_4;
        if (variant10 === null || variant10=== undefined) {
          dataView(memory0).setInt8(arg3 + 56, 0, true);
        } else {
          const e = variant10;
          dataView(memory0).setInt8(arg3 + 56, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr9= encodeRes.ptr;
          var len9 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 64, len9, true);
          dataView(memory0).setUint32(arg3 + 60, ptr9, true);
        }
        
        break;
      }
      case 'err': {
        const e = variant13.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant12 = e;
        switch (variant12.tag) {
          case 'credentials-not-loaded': {
            dataView(memory0).setInt8(arg3 + 8, 0, true);
            break;
          }
          case 'provider-timed-out': {
            const e = variant12.val;
            dataView(memory0).setInt8(arg3 + 8, 1, true);
            var {duration: v11_0 } = e;
            dataView(memory0).setBigInt64(arg3 + 16, toUint64(v11_0), true);
            break;
          }
          case 'invalid-configuration': {
            dataView(memory0).setInt8(arg3 + 8, 2, true);
            break;
          }
          case 'provider-error': {
            dataView(memory0).setInt8(arg3 + 8, 3, true);
            break;
          }
          case 'unhandled': {
            dataView(memory0).setInt8(arg3 + 8, 4, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant12.tag)}\` (received \`${variant12}\`) specified for \`CredentialsError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant13, valueType: typeof variant13});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="component:aws-cli/providers", function="provide-credentials"][Instruction::Return]', {
      funcName: 'provide-credentials',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline38.fnName = 'component:aws-cli/providers#provideCredentials';
  _trampoline38.manuallyAsync = true;
  
  const _trampoline39 = function(arg0) {
    _debugLog('[iface="wasi:cli/environment@0.2.12", function="get-arguments"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getArguments',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getArguments(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var vec1 = ret;
    var len1 = vec1.length;
    var result1 = realloc0(0, 0, 4, len1 * 8);
    for (let i = 0; i < vec1.length; i++) {
      const e = vec1[i];
      const base = result1 + i * 8;
      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
      var ptr0= encodeRes.ptr;
      var len0 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 4, len0, true);
      dataView(memory0).setUint32(base + 0, ptr0, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len1, true);
    dataView(memory0).setUint32(arg0 + 0, result1, true);
    _debugLog('[iface="wasi:cli/environment@0.2.12", function="get-arguments"][Instruction::Return]', {
      funcName: 'get-arguments',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline39.fnName = 'wasi:cli/environment@0.2.12#getArguments';
  
  const _trampoline40 = function(arg0) {
    _debugLog('[iface="wasi:random/insecure-seed@0.2.12", function="insecure-seed"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'insecureSeed',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => insecureSeed(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var [tuple0_0, tuple0_1] = ret;
    dataView(memory0).setBigInt64(arg0 + 0, toUint64(tuple0_0), true);
    dataView(memory0).setBigInt64(arg0 + 8, toUint64(tuple0_1), true);
    _debugLog('[iface="wasi:random/insecure-seed@0.2.12", function="insecure-seed"][Instruction::Return]', {
      funcName: 'insecure-seed',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline40.fnName = 'wasi:random/insecure-seed@0.2.12#insecureSeed';
  
  const handleTable4 = [T_FLAG, 0];
  handleTable4._createdReps = new Set();
  
  
  const captureTable4= new Map();
  let captureCnt4= 0;
  
  HANDLE_TABLES[4] = handleTable4;
  
  const _trampoline41 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable4.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingBody.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-body.write"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'write',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.write(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable2, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-body.write"][Instruction::Return]', {
      funcName: '[method]outgoing-body.write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline41.fnName = 'wasi:http/types@0.2.12#write';
  
  const _trampoline42 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable5[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable5.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(IncomingBody.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-body.stream"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'stream',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.stream(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof InputStream)) {
          throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable3, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-body.stream"][Instruction::Return]', {
      funcName: '[method]incoming-body.stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline42.fnName = 'wasi:http/types@0.2.12#stream';
  
  const _trampoline43 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable8[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable8.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(FutureIncomingResponse.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-incoming-response.get"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'get',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.get(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant44 = ret;
    if (variant44 === null || variant44=== undefined) {
      dataView(memory0).setInt8(arg1 + 0, 0, true);
    } else {
      const e = variant44;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var variant43 = e;
      switch (variant43.tag) {
        case 'ok': {
          const e = variant43.val;
          dataView(memory0).setInt8(arg1 + 8, 0, true);
          var variant42 = e;
          switch (variant42.tag) {
            case 'ok': {
              const e = variant42.val;
              dataView(memory0).setInt8(arg1 + 16, 0, true);
              
              if (!(e instanceof IncomingResponse)) {
                throw new TypeError('Resource error: Not a valid \"IncomingResponse\" resource.');
              }
              var handle3 = e[symbolRscHandle];
              if (!handle3) {
                const rep = e[symbolRscRep] || ++captureCnt9;
                captureTable9.set(rep, e);
                handle3 = rscTableCreateOwn(handleTable9, rep);
              }
              
              dataView(memory0).setInt32(arg1 + 24, handle3, true);
              
              break;
            }
            case 'err': {
              const e = variant42.val;
              dataView(memory0).setInt8(arg1 + 16, 1, true);
              var variant41 = e;
              switch (variant41.tag) {
                case 'DNS-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 0, true);
                  break;
                }
                case 'DNS-error': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 1, true);
                  var {rcode: v4_0, infoCode: v4_1 } = e;
                  var variant6 = v4_0;
                  if (variant6 === null || variant6=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant6;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr5= encodeRes.ptr;
                    var len5 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len5, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr5, true);
                  }
                  var variant7 = v4_1;
                  if (variant7 === null || variant7=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant7;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt16(arg1 + 46, toUint16(e), true);
                  }
                  break;
                }
                case 'destination-not-found': {
                  dataView(memory0).setInt8(arg1 + 24, 2, true);
                  break;
                }
                case 'destination-unavailable': {
                  dataView(memory0).setInt8(arg1 + 24, 3, true);
                  break;
                }
                case 'destination-IP-prohibited': {
                  dataView(memory0).setInt8(arg1 + 24, 4, true);
                  break;
                }
                case 'destination-IP-unroutable': {
                  dataView(memory0).setInt8(arg1 + 24, 5, true);
                  break;
                }
                case 'connection-refused': {
                  dataView(memory0).setInt8(arg1 + 24, 6, true);
                  break;
                }
                case 'connection-terminated': {
                  dataView(memory0).setInt8(arg1 + 24, 7, true);
                  break;
                }
                case 'connection-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 8, true);
                  break;
                }
                case 'connection-read-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 9, true);
                  break;
                }
                case 'connection-write-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 10, true);
                  break;
                }
                case 'connection-limit-reached': {
                  dataView(memory0).setInt8(arg1 + 24, 11, true);
                  break;
                }
                case 'TLS-protocol-error': {
                  dataView(memory0).setInt8(arg1 + 24, 12, true);
                  break;
                }
                case 'TLS-certificate-error': {
                  dataView(memory0).setInt8(arg1 + 24, 13, true);
                  break;
                }
                case 'TLS-alert-received': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 14, true);
                  var {alertId: v8_0, alertMessage: v8_1 } = e;
                  var variant9 = v8_0;
                  if (variant9 === null || variant9=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant9;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt8(arg1 + 33, toUint8(e), true);
                  }
                  var variant11 = v8_1;
                  if (variant11 === null || variant11=== undefined) {
                    dataView(memory0).setInt8(arg1 + 36, 0, true);
                  } else {
                    const e = variant11;
                    dataView(memory0).setInt8(arg1 + 36, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr10= encodeRes.ptr;
                    var len10 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 44, len10, true);
                    dataView(memory0).setUint32(arg1 + 40, ptr10, true);
                  }
                  break;
                }
                case 'HTTP-request-denied': {
                  dataView(memory0).setInt8(arg1 + 24, 15, true);
                  break;
                }
                case 'HTTP-request-length-required': {
                  dataView(memory0).setInt8(arg1 + 24, 16, true);
                  break;
                }
                case 'HTTP-request-body-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 17, true);
                  var variant12 = e;
                  if (variant12 === null || variant12=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant12;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setBigInt64(arg1 + 40, toUint64(e), true);
                  }
                  break;
                }
                case 'HTTP-request-method-invalid': {
                  dataView(memory0).setInt8(arg1 + 24, 18, true);
                  break;
                }
                case 'HTTP-request-URI-invalid': {
                  dataView(memory0).setInt8(arg1 + 24, 19, true);
                  break;
                }
                case 'HTTP-request-URI-too-long': {
                  dataView(memory0).setInt8(arg1 + 24, 20, true);
                  break;
                }
                case 'HTTP-request-header-section-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 21, true);
                  var variant13 = e;
                  if (variant13 === null || variant13=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant13;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-request-header-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 22, true);
                  var variant18 = e;
                  if (variant18 === null || variant18=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant18;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    var {fieldName: v14_0, fieldSize: v14_1 } = e;
                    var variant16 = v14_0;
                    if (variant16 === null || variant16=== undefined) {
                      dataView(memory0).setInt8(arg1 + 36, 0, true);
                    } else {
                      const e = variant16;
                      dataView(memory0).setInt8(arg1 + 36, 1, true);
                      
                      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                      var ptr15= encodeRes.ptr;
                      var len15 = encodeRes.len;
                      
                      dataView(memory0).setUint32(arg1 + 44, len15, true);
                      dataView(memory0).setUint32(arg1 + 40, ptr15, true);
                    }
                    var variant17 = v14_1;
                    if (variant17 === null || variant17=== undefined) {
                      dataView(memory0).setInt8(arg1 + 48, 0, true);
                    } else {
                      const e = variant17;
                      dataView(memory0).setInt8(arg1 + 48, 1, true);
                      dataView(memory0).setInt32(arg1 + 52, toUint32(e), true);
                    }
                  }
                  break;
                }
                case 'HTTP-request-trailer-section-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 23, true);
                  var variant19 = e;
                  if (variant19 === null || variant19=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant19;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-request-trailer-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 24, true);
                  var {fieldName: v20_0, fieldSize: v20_1 } = e;
                  var variant22 = v20_0;
                  if (variant22 === null || variant22=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant22;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr21= encodeRes.ptr;
                    var len21 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len21, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr21, true);
                  }
                  var variant23 = v20_1;
                  if (variant23 === null || variant23=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant23;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-incomplete': {
                  dataView(memory0).setInt8(arg1 + 24, 25, true);
                  break;
                }
                case 'HTTP-response-header-section-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 26, true);
                  var variant24 = e;
                  if (variant24 === null || variant24=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant24;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-header-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 27, true);
                  var {fieldName: v25_0, fieldSize: v25_1 } = e;
                  var variant27 = v25_0;
                  if (variant27 === null || variant27=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant27;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr26= encodeRes.ptr;
                    var len26 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len26, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr26, true);
                  }
                  var variant28 = v25_1;
                  if (variant28 === null || variant28=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant28;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-body-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 28, true);
                  var variant29 = e;
                  if (variant29 === null || variant29=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant29;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setBigInt64(arg1 + 40, toUint64(e), true);
                  }
                  break;
                }
                case 'HTTP-response-trailer-section-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 29, true);
                  var variant30 = e;
                  if (variant30 === null || variant30=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant30;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-trailer-size': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 30, true);
                  var {fieldName: v31_0, fieldSize: v31_1 } = e;
                  var variant33 = v31_0;
                  if (variant33 === null || variant33=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant33;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr32= encodeRes.ptr;
                    var len32 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len32, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr32, true);
                  }
                  var variant34 = v31_1;
                  if (variant34 === null || variant34=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant34;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-transfer-coding': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 31, true);
                  var variant36 = e;
                  if (variant36 === null || variant36=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant36;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr35= encodeRes.ptr;
                    var len35 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len35, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr35, true);
                  }
                  break;
                }
                case 'HTTP-response-content-coding': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 32, true);
                  var variant38 = e;
                  if (variant38 === null || variant38=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant38;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr37= encodeRes.ptr;
                    var len37 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len37, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr37, true);
                  }
                  break;
                }
                case 'HTTP-response-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 33, true);
                  break;
                }
                case 'HTTP-upgrade-failed': {
                  dataView(memory0).setInt8(arg1 + 24, 34, true);
                  break;
                }
                case 'HTTP-protocol-error': {
                  dataView(memory0).setInt8(arg1 + 24, 35, true);
                  break;
                }
                case 'loop-detected': {
                  dataView(memory0).setInt8(arg1 + 24, 36, true);
                  break;
                }
                case 'configuration-error': {
                  dataView(memory0).setInt8(arg1 + 24, 37, true);
                  break;
                }
                case 'internal-error': {
                  const e = variant41.val;
                  dataView(memory0).setInt8(arg1 + 24, 38, true);
                  var variant40 = e;
                  if (variant40 === null || variant40=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant40;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr39= encodeRes.ptr;
                    var len39 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len39, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr39, true);
                  }
                  break;
                }
                default: {
                  throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant41.tag)}\` (received \`${variant41}\`) specified for \`ErrorCode\``);
                }
              }
              
              break;
            }
            default: {
              _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant42, valueType: typeof variant42});
              throw new TypeError('invalid variant specified for result');
            }
          }
          
          break;
        }
        case 'err': {
          const e = variant43.val;
          dataView(memory0).setInt8(arg1 + 8, 1, true);
          
          break;
        }
        default: {
          _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant43, valueType: typeof variant43});
          throw new TypeError('invalid variant specified for result');
        }
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-incoming-response.get"][Instruction::Return]', {
      funcName: '[method]future-incoming-response.get',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline43.fnName = 'wasi:http/types@0.2.12#get';
  
  const _trampoline44 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable9.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(IncomingResponse.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.consume"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'consume',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.consume(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof IncomingBody)) {
          throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt5;
          captureTable5.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable5, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]incoming-response.consume"][Instruction::Return]', {
      funcName: '[method]incoming-response.consume',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline44.fnName = 'wasi:http/types@0.2.12#consume';
  
  const _trampoline45 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant4;
    switch (arg1) {
      case 0: {
        variant4= {
          tag: 'get',
        };
        break;
      }
      case 1: {
        variant4= {
          tag: 'head',
        };
        break;
      }
      case 2: {
        variant4= {
          tag: 'post',
        };
        break;
      }
      case 3: {
        variant4= {
          tag: 'put',
        };
        break;
      }
      case 4: {
        variant4= {
          tag: 'delete',
        };
        break;
      }
      case 5: {
        variant4= {
          tag: 'connect',
        };
        break;
      }
      case 6: {
        variant4= {
          tag: 'options',
        };
        break;
      }
      case 7: {
        variant4= {
          tag: 'trace',
        };
        break;
      }
      case 8: {
        variant4= {
          tag: 'patch',
        };
        break;
      }
      case 9: {
        var ptr3 = arg2;
        var len3 = arg3;
        var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
        variant4= {
          tag: 'other',
          val: result3
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for Method');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-method"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setMethod',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet5 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setMethod(variant4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    let variant6_0;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        variant6_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        variant6_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-method"][Instruction::Return]', {
      funcName: '[method]outgoing-request.set-method',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant6_0]);
    task.exit();
    return variant6_0;
  }
  _trampoline45.fnName = 'wasi:http/types@0.2.12#setMethod';
  
  const _trampoline46 = function(arg0, arg1, arg2, arg3, arg4) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant5;
    switch (arg1) {
      case 0: {
        variant5 = undefined;
        break;
      }
      case 1: {
        let variant4;
        switch (arg2) {
          case 0: {
            variant4= {
              tag: 'HTTP',
            };
            break;
          }
          case 1: {
            variant4= {
              tag: 'HTTPS',
            };
            break;
          }
          case 2: {
            var ptr3 = arg3;
            var len3 = arg4;
            var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            variant4= {
              tag: 'other',
              val: result3
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for Scheme');
          }
        }
        variant5 = variant4;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-scheme"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setScheme',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet6 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setScheme(variant5),
      })
      ;
      ret = hostRet6 !== null && typeof hostRet6 === 'object' && (hostRet6.tag === 'ok' || hostRet6.tag === 'err')
      ? hostRet6
      : { tag: 'ok', val: hostRet6};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant7 = ret;
    let variant7_0;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        variant7_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant7.val;
        variant7_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-scheme"][Instruction::Return]', {
      funcName: '[method]outgoing-request.set-scheme',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant7_0]);
    task.exit();
    return variant7_0;
  }
  _trampoline46.fnName = 'wasi:http/types@0.2.12#setScheme';
  
  const _trampoline47 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant4;
    switch (arg1) {
      case 0: {
        variant4 = undefined;
        break;
      }
      case 1: {
        var ptr3 = arg2;
        var len3 = arg3;
        var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
        variant4 = result3;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-authority"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setAuthority',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet5 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setAuthority(variant4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    let variant6_0;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        variant6_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        variant6_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-authority"][Instruction::Return]', {
      funcName: '[method]outgoing-request.set-authority',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant6_0]);
    task.exit();
    return variant6_0;
  }
  _trampoline47.fnName = 'wasi:http/types@0.2.12#setAuthority';
  
  const _trampoline48 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    let variant4;
    switch (arg1) {
      case 0: {
        variant4 = undefined;
        break;
      }
      case 1: {
        var ptr3 = arg2;
        var len3 = arg3;
        var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
        variant4 = result3;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-path-with-query"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'setPathWithQuery',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet5 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setPathWithQuery(variant4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    let variant6_0;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        variant6_0 = 0;
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        variant6_0 = 1;
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.set-path-with-query"][Instruction::Return]', {
      funcName: '[method]outgoing-request.set-path-with-query',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([variant6_0]);
    task.exit();
    return variant6_0;
  }
  _trampoline48.fnName = 'wasi:http/types@0.2.12#setPathWithQuery';
  
  const _trampoline49 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.body"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'body',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.body(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof OutgoingBody)) {
          throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt4;
          captureTable4.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable4, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]outgoing-request.body"][Instruction::Return]', {
      funcName: '[method]outgoing-request.body',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline49.fnName = 'wasi:http/types@0.2.12#body';
  
  const _trampoline50 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(FutureTrailers.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-trailers.get"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'get',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.get(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant45 = ret;
    if (variant45 === null || variant45=== undefined) {
      dataView(memory0).setInt8(arg1 + 0, 0, true);
    } else {
      const e = variant45;
      dataView(memory0).setInt8(arg1 + 0, 1, true);
      var variant44 = e;
      switch (variant44.tag) {
        case 'ok': {
          const e = variant44.val;
          dataView(memory0).setInt8(arg1 + 8, 0, true);
          var variant43 = e;
          switch (variant43.tag) {
            case 'ok': {
              const e = variant43.val;
              dataView(memory0).setInt8(arg1 + 16, 0, true);
              var variant4 = e;
              if (variant4 === null || variant4=== undefined) {
                dataView(memory0).setInt8(arg1 + 24, 0, true);
              } else {
                const e = variant4;
                dataView(memory0).setInt8(arg1 + 24, 1, true);
                
                if (!(e instanceof Fields)) {
                  throw new TypeError('Resource error: Not a valid \"Trailers\" resource.');
                }
                var handle3 = e[symbolRscHandle];
                if (!handle3) {
                  const rep = e[symbolRscRep] || ++captureCnt7;
                  captureTable7.set(rep, e);
                  handle3 = rscTableCreateOwn(handleTable7, rep);
                }
                
                dataView(memory0).setInt32(arg1 + 28, handle3, true);
              }
              
              break;
            }
            case 'err': {
              const e = variant43.val;
              dataView(memory0).setInt8(arg1 + 16, 1, true);
              var variant42 = e;
              switch (variant42.tag) {
                case 'DNS-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 0, true);
                  break;
                }
                case 'DNS-error': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 1, true);
                  var {rcode: v5_0, infoCode: v5_1 } = e;
                  var variant7 = v5_0;
                  if (variant7 === null || variant7=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant7;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr6= encodeRes.ptr;
                    var len6 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len6, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr6, true);
                  }
                  var variant8 = v5_1;
                  if (variant8 === null || variant8=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant8;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt16(arg1 + 46, toUint16(e), true);
                  }
                  break;
                }
                case 'destination-not-found': {
                  dataView(memory0).setInt8(arg1 + 24, 2, true);
                  break;
                }
                case 'destination-unavailable': {
                  dataView(memory0).setInt8(arg1 + 24, 3, true);
                  break;
                }
                case 'destination-IP-prohibited': {
                  dataView(memory0).setInt8(arg1 + 24, 4, true);
                  break;
                }
                case 'destination-IP-unroutable': {
                  dataView(memory0).setInt8(arg1 + 24, 5, true);
                  break;
                }
                case 'connection-refused': {
                  dataView(memory0).setInt8(arg1 + 24, 6, true);
                  break;
                }
                case 'connection-terminated': {
                  dataView(memory0).setInt8(arg1 + 24, 7, true);
                  break;
                }
                case 'connection-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 8, true);
                  break;
                }
                case 'connection-read-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 9, true);
                  break;
                }
                case 'connection-write-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 10, true);
                  break;
                }
                case 'connection-limit-reached': {
                  dataView(memory0).setInt8(arg1 + 24, 11, true);
                  break;
                }
                case 'TLS-protocol-error': {
                  dataView(memory0).setInt8(arg1 + 24, 12, true);
                  break;
                }
                case 'TLS-certificate-error': {
                  dataView(memory0).setInt8(arg1 + 24, 13, true);
                  break;
                }
                case 'TLS-alert-received': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 14, true);
                  var {alertId: v9_0, alertMessage: v9_1 } = e;
                  var variant10 = v9_0;
                  if (variant10 === null || variant10=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant10;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt8(arg1 + 33, toUint8(e), true);
                  }
                  var variant12 = v9_1;
                  if (variant12 === null || variant12=== undefined) {
                    dataView(memory0).setInt8(arg1 + 36, 0, true);
                  } else {
                    const e = variant12;
                    dataView(memory0).setInt8(arg1 + 36, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr11= encodeRes.ptr;
                    var len11 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 44, len11, true);
                    dataView(memory0).setUint32(arg1 + 40, ptr11, true);
                  }
                  break;
                }
                case 'HTTP-request-denied': {
                  dataView(memory0).setInt8(arg1 + 24, 15, true);
                  break;
                }
                case 'HTTP-request-length-required': {
                  dataView(memory0).setInt8(arg1 + 24, 16, true);
                  break;
                }
                case 'HTTP-request-body-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 17, true);
                  var variant13 = e;
                  if (variant13 === null || variant13=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant13;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setBigInt64(arg1 + 40, toUint64(e), true);
                  }
                  break;
                }
                case 'HTTP-request-method-invalid': {
                  dataView(memory0).setInt8(arg1 + 24, 18, true);
                  break;
                }
                case 'HTTP-request-URI-invalid': {
                  dataView(memory0).setInt8(arg1 + 24, 19, true);
                  break;
                }
                case 'HTTP-request-URI-too-long': {
                  dataView(memory0).setInt8(arg1 + 24, 20, true);
                  break;
                }
                case 'HTTP-request-header-section-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 21, true);
                  var variant14 = e;
                  if (variant14 === null || variant14=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant14;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-request-header-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 22, true);
                  var variant19 = e;
                  if (variant19 === null || variant19=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant19;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    var {fieldName: v15_0, fieldSize: v15_1 } = e;
                    var variant17 = v15_0;
                    if (variant17 === null || variant17=== undefined) {
                      dataView(memory0).setInt8(arg1 + 36, 0, true);
                    } else {
                      const e = variant17;
                      dataView(memory0).setInt8(arg1 + 36, 1, true);
                      
                      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                      var ptr16= encodeRes.ptr;
                      var len16 = encodeRes.len;
                      
                      dataView(memory0).setUint32(arg1 + 44, len16, true);
                      dataView(memory0).setUint32(arg1 + 40, ptr16, true);
                    }
                    var variant18 = v15_1;
                    if (variant18 === null || variant18=== undefined) {
                      dataView(memory0).setInt8(arg1 + 48, 0, true);
                    } else {
                      const e = variant18;
                      dataView(memory0).setInt8(arg1 + 48, 1, true);
                      dataView(memory0).setInt32(arg1 + 52, toUint32(e), true);
                    }
                  }
                  break;
                }
                case 'HTTP-request-trailer-section-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 23, true);
                  var variant20 = e;
                  if (variant20 === null || variant20=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant20;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-request-trailer-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 24, true);
                  var {fieldName: v21_0, fieldSize: v21_1 } = e;
                  var variant23 = v21_0;
                  if (variant23 === null || variant23=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant23;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr22= encodeRes.ptr;
                    var len22 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len22, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr22, true);
                  }
                  var variant24 = v21_1;
                  if (variant24 === null || variant24=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant24;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-incomplete': {
                  dataView(memory0).setInt8(arg1 + 24, 25, true);
                  break;
                }
                case 'HTTP-response-header-section-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 26, true);
                  var variant25 = e;
                  if (variant25 === null || variant25=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant25;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-header-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 27, true);
                  var {fieldName: v26_0, fieldSize: v26_1 } = e;
                  var variant28 = v26_0;
                  if (variant28 === null || variant28=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant28;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr27= encodeRes.ptr;
                    var len27 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len27, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr27, true);
                  }
                  var variant29 = v26_1;
                  if (variant29 === null || variant29=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant29;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-body-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 28, true);
                  var variant30 = e;
                  if (variant30 === null || variant30=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant30;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setBigInt64(arg1 + 40, toUint64(e), true);
                  }
                  break;
                }
                case 'HTTP-response-trailer-section-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 29, true);
                  var variant31 = e;
                  if (variant31 === null || variant31=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant31;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    dataView(memory0).setInt32(arg1 + 36, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-trailer-size': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 30, true);
                  var {fieldName: v32_0, fieldSize: v32_1 } = e;
                  var variant34 = v32_0;
                  if (variant34 === null || variant34=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant34;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr33= encodeRes.ptr;
                    var len33 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len33, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr33, true);
                  }
                  var variant35 = v32_1;
                  if (variant35 === null || variant35=== undefined) {
                    dataView(memory0).setInt8(arg1 + 44, 0, true);
                  } else {
                    const e = variant35;
                    dataView(memory0).setInt8(arg1 + 44, 1, true);
                    dataView(memory0).setInt32(arg1 + 48, toUint32(e), true);
                  }
                  break;
                }
                case 'HTTP-response-transfer-coding': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 31, true);
                  var variant37 = e;
                  if (variant37 === null || variant37=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant37;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr36= encodeRes.ptr;
                    var len36 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len36, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr36, true);
                  }
                  break;
                }
                case 'HTTP-response-content-coding': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 32, true);
                  var variant39 = e;
                  if (variant39 === null || variant39=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant39;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr38= encodeRes.ptr;
                    var len38 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len38, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr38, true);
                  }
                  break;
                }
                case 'HTTP-response-timeout': {
                  dataView(memory0).setInt8(arg1 + 24, 33, true);
                  break;
                }
                case 'HTTP-upgrade-failed': {
                  dataView(memory0).setInt8(arg1 + 24, 34, true);
                  break;
                }
                case 'HTTP-protocol-error': {
                  dataView(memory0).setInt8(arg1 + 24, 35, true);
                  break;
                }
                case 'loop-detected': {
                  dataView(memory0).setInt8(arg1 + 24, 36, true);
                  break;
                }
                case 'configuration-error': {
                  dataView(memory0).setInt8(arg1 + 24, 37, true);
                  break;
                }
                case 'internal-error': {
                  const e = variant42.val;
                  dataView(memory0).setInt8(arg1 + 24, 38, true);
                  var variant41 = e;
                  if (variant41 === null || variant41=== undefined) {
                    dataView(memory0).setInt8(arg1 + 32, 0, true);
                  } else {
                    const e = variant41;
                    dataView(memory0).setInt8(arg1 + 32, 1, true);
                    
                    var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                    var ptr40= encodeRes.ptr;
                    var len40 = encodeRes.len;
                    
                    dataView(memory0).setUint32(arg1 + 40, len40, true);
                    dataView(memory0).setUint32(arg1 + 36, ptr40, true);
                  }
                  break;
                }
                default: {
                  throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant42.tag)}\` (received \`${variant42}\`) specified for \`ErrorCode\``);
                }
              }
              
              break;
            }
            default: {
              _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant43, valueType: typeof variant43});
              throw new TypeError('invalid variant specified for result');
            }
          }
          
          break;
        }
        case 'err': {
          const e = variant44.val;
          dataView(memory0).setInt8(arg1 + 8, 1, true);
          
          break;
        }
        default: {
          _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant44, valueType: typeof variant44});
          throw new TypeError('invalid variant specified for result');
        }
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]future-trailers.get"][Instruction::Return]', {
      funcName: '[method]future-trailers.get',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline50.fnName = 'wasi:http/types@0.2.12#get';
  
  const _trampoline51 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable4.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingBody.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    else {
      captureTable4.delete(rep2);
    }
    rscTableRemove(handleTable4, handle1);
    let variant6;
    switch (arg1) {
      case 0: {
        variant6 = undefined;
        break;
      }
      case 1: {
        var handle4 = arg2;
        
        var rep5 = handleTable7[(handle4 << 1) + 1] & ~T_FLAG;
        var rsc3 = captureTable7.get(rep5);
        if (!rsc3) {
          rsc3 = Object.create(Fields.prototype);
          Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
          Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
        }
        
        else {
          captureTable7.delete(rep5);
        }
        rscTableRemove(handleTable7, handle4);
        variant6 = rsc3;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[static]outgoing-body.finish"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'OutgoingBody.finish',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet7 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => OutgoingBody.finish(rsc0, variant6),
      })
      ;
      ret = hostRet7 !== null && typeof hostRet7 === 'object' && (hostRet7.tag === 'ok' || hostRet7.tag === 'err')
      ? hostRet7
      : { tag: 'ok', val: hostRet7};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    var variant46 = ret;
    switch (variant46.tag) {
      case 'ok': {
        const e = variant46.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant46.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant45 = e;
        switch (variant45.tag) {
          case 'DNS-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 0, true);
            break;
          }
          case 'DNS-error': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 1, true);
            var {rcode: v8_0, infoCode: v8_1 } = e;
            var variant10 = v8_0;
            if (variant10 === null || variant10=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant10;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr9= encodeRes.ptr;
              var len9 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len9, true);
              dataView(memory0).setUint32(arg3 + 20, ptr9, true);
            }
            var variant11 = v8_1;
            if (variant11 === null || variant11=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant11;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt16(arg3 + 30, toUint16(e), true);
            }
            break;
          }
          case 'destination-not-found': {
            dataView(memory0).setInt8(arg3 + 8, 2, true);
            break;
          }
          case 'destination-unavailable': {
            dataView(memory0).setInt8(arg3 + 8, 3, true);
            break;
          }
          case 'destination-IP-prohibited': {
            dataView(memory0).setInt8(arg3 + 8, 4, true);
            break;
          }
          case 'destination-IP-unroutable': {
            dataView(memory0).setInt8(arg3 + 8, 5, true);
            break;
          }
          case 'connection-refused': {
            dataView(memory0).setInt8(arg3 + 8, 6, true);
            break;
          }
          case 'connection-terminated': {
            dataView(memory0).setInt8(arg3 + 8, 7, true);
            break;
          }
          case 'connection-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 8, true);
            break;
          }
          case 'connection-read-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 9, true);
            break;
          }
          case 'connection-write-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 10, true);
            break;
          }
          case 'connection-limit-reached': {
            dataView(memory0).setInt8(arg3 + 8, 11, true);
            break;
          }
          case 'TLS-protocol-error': {
            dataView(memory0).setInt8(arg3 + 8, 12, true);
            break;
          }
          case 'TLS-certificate-error': {
            dataView(memory0).setInt8(arg3 + 8, 13, true);
            break;
          }
          case 'TLS-alert-received': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 14, true);
            var {alertId: v12_0, alertMessage: v12_1 } = e;
            var variant13 = v12_0;
            if (variant13 === null || variant13=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant13;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt8(arg3 + 17, toUint8(e), true);
            }
            var variant15 = v12_1;
            if (variant15 === null || variant15=== undefined) {
              dataView(memory0).setInt8(arg3 + 20, 0, true);
            } else {
              const e = variant15;
              dataView(memory0).setInt8(arg3 + 20, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr14= encodeRes.ptr;
              var len14 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 28, len14, true);
              dataView(memory0).setUint32(arg3 + 24, ptr14, true);
            }
            break;
          }
          case 'HTTP-request-denied': {
            dataView(memory0).setInt8(arg3 + 8, 15, true);
            break;
          }
          case 'HTTP-request-length-required': {
            dataView(memory0).setInt8(arg3 + 8, 16, true);
            break;
          }
          case 'HTTP-request-body-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 17, true);
            var variant16 = e;
            if (variant16 === null || variant16=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant16;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setBigInt64(arg3 + 24, toUint64(e), true);
            }
            break;
          }
          case 'HTTP-request-method-invalid': {
            dataView(memory0).setInt8(arg3 + 8, 18, true);
            break;
          }
          case 'HTTP-request-URI-invalid': {
            dataView(memory0).setInt8(arg3 + 8, 19, true);
            break;
          }
          case 'HTTP-request-URI-too-long': {
            dataView(memory0).setInt8(arg3 + 8, 20, true);
            break;
          }
          case 'HTTP-request-header-section-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 21, true);
            var variant17 = e;
            if (variant17 === null || variant17=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant17;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-request-header-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 22, true);
            var variant22 = e;
            if (variant22 === null || variant22=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant22;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              var {fieldName: v18_0, fieldSize: v18_1 } = e;
              var variant20 = v18_0;
              if (variant20 === null || variant20=== undefined) {
                dataView(memory0).setInt8(arg3 + 20, 0, true);
              } else {
                const e = variant20;
                dataView(memory0).setInt8(arg3 + 20, 1, true);
                
                var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                var ptr19= encodeRes.ptr;
                var len19 = encodeRes.len;
                
                dataView(memory0).setUint32(arg3 + 28, len19, true);
                dataView(memory0).setUint32(arg3 + 24, ptr19, true);
              }
              var variant21 = v18_1;
              if (variant21 === null || variant21=== undefined) {
                dataView(memory0).setInt8(arg3 + 32, 0, true);
              } else {
                const e = variant21;
                dataView(memory0).setInt8(arg3 + 32, 1, true);
                dataView(memory0).setInt32(arg3 + 36, toUint32(e), true);
              }
            }
            break;
          }
          case 'HTTP-request-trailer-section-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 23, true);
            var variant23 = e;
            if (variant23 === null || variant23=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant23;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-request-trailer-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 24, true);
            var {fieldName: v24_0, fieldSize: v24_1 } = e;
            var variant26 = v24_0;
            if (variant26 === null || variant26=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant26;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr25= encodeRes.ptr;
              var len25 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len25, true);
              dataView(memory0).setUint32(arg3 + 20, ptr25, true);
            }
            var variant27 = v24_1;
            if (variant27 === null || variant27=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant27;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-incomplete': {
            dataView(memory0).setInt8(arg3 + 8, 25, true);
            break;
          }
          case 'HTTP-response-header-section-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 26, true);
            var variant28 = e;
            if (variant28 === null || variant28=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant28;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-header-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 27, true);
            var {fieldName: v29_0, fieldSize: v29_1 } = e;
            var variant31 = v29_0;
            if (variant31 === null || variant31=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant31;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr30= encodeRes.ptr;
              var len30 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len30, true);
              dataView(memory0).setUint32(arg3 + 20, ptr30, true);
            }
            var variant32 = v29_1;
            if (variant32 === null || variant32=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant32;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-body-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 28, true);
            var variant33 = e;
            if (variant33 === null || variant33=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant33;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setBigInt64(arg3 + 24, toUint64(e), true);
            }
            break;
          }
          case 'HTTP-response-trailer-section-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 29, true);
            var variant34 = e;
            if (variant34 === null || variant34=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant34;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-trailer-size': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 30, true);
            var {fieldName: v35_0, fieldSize: v35_1 } = e;
            var variant37 = v35_0;
            if (variant37 === null || variant37=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant37;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr36= encodeRes.ptr;
              var len36 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len36, true);
              dataView(memory0).setUint32(arg3 + 20, ptr36, true);
            }
            var variant38 = v35_1;
            if (variant38 === null || variant38=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant38;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-transfer-coding': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 31, true);
            var variant40 = e;
            if (variant40 === null || variant40=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant40;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr39= encodeRes.ptr;
              var len39 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len39, true);
              dataView(memory0).setUint32(arg3 + 20, ptr39, true);
            }
            break;
          }
          case 'HTTP-response-content-coding': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 32, true);
            var variant42 = e;
            if (variant42 === null || variant42=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant42;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr41= encodeRes.ptr;
              var len41 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len41, true);
              dataView(memory0).setUint32(arg3 + 20, ptr41, true);
            }
            break;
          }
          case 'HTTP-response-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 33, true);
            break;
          }
          case 'HTTP-upgrade-failed': {
            dataView(memory0).setInt8(arg3 + 8, 34, true);
            break;
          }
          case 'HTTP-protocol-error': {
            dataView(memory0).setInt8(arg3 + 8, 35, true);
            break;
          }
          case 'loop-detected': {
            dataView(memory0).setInt8(arg3 + 8, 36, true);
            break;
          }
          case 'configuration-error': {
            dataView(memory0).setInt8(arg3 + 8, 37, true);
            break;
          }
          case 'internal-error': {
            const e = variant45.val;
            dataView(memory0).setInt8(arg3 + 8, 38, true);
            var variant44 = e;
            if (variant44 === null || variant44=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant44;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr43= encodeRes.ptr;
              var len43 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len43, true);
              dataView(memory0).setUint32(arg3 + 20, ptr43, true);
            }
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant45.tag)}\` (received \`${variant45}\`) specified for \`ErrorCode\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant46, valueType: typeof variant46});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[static]outgoing-body.finish"][Instruction::Return]', {
      funcName: '[static]outgoing-body.finish',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline51.fnName = 'wasi:http/types@0.2.12#OutgoingBody.finish';
  
  const _trampoline52 = function(arg0, arg1, arg2, arg3, arg4, arg5) {
    var handle1 = arg0;
    
    var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable7.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Fields.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
    var ptr4 = arg3;
    var len4 = arg4;
    if (ptr4 % 1 !== 0) throw new TypeError(`list pointer [${ptr4}] is not aligned to 1`);
    var result4 = new Uint8Array(memory0.buffer.slice(ptr4, ptr4 + len4 * 1));
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]fields.append"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'append',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet5 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.append(result3, result4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant7 = ret;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg5 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg5 + 0, 1, true);
        var variant6 = e;
        switch (variant6.tag) {
          case 'invalid-syntax': {
            dataView(memory0).setInt8(arg5 + 1, 0, true);
            break;
          }
          case 'forbidden': {
            dataView(memory0).setInt8(arg5 + 1, 1, true);
            break;
          }
          case 'immutable': {
            dataView(memory0).setInt8(arg5 + 1, 2, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`HeaderError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]fields.append"][Instruction::Return]', {
      funcName: '[method]fields.append',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline52.fnName = 'wasi:http/types@0.2.12#append';
  
  const _trampoline53 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable7.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Fields.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]fields.entries"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'entries',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.entries(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var vec6 = ret;
    var len6 = vec6.length;
    var result6 = realloc0(0, 0, 4, len6 * 16);
    for (let i = 0; i < vec6.length; i++) {
      const e = vec6[i];
      const base = result6 + i * 16;var [tuple3_0, tuple3_1] = e;
      
      var encodeRes = _utf8AllocateAndEncode(tuple3_0, realloc0, memory0);
      var ptr4= encodeRes.ptr;
      var len4 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 4, len4, true);
      dataView(memory0).setUint32(base + 0, ptr4, true);
      var val5 = tuple3_1;
      var len5 = Array.isArray(val5) ? val5.length : val5.byteLength;
      var ptr5 = realloc0(0, 0, 1, len5 * 1);
      
      let valData5;
      const valLenBytes5 = len5 * 1;
      if (Array.isArray(val5)) {
        // Regular array likely containing numbers, write values to memory
        let offset = 0;
        const dv5 = new DataView(memory0.buffer);
        for (const v of val5) {
          _requireValidNumericPrimitive.bind(null, 'u8')(v);
          dv5.setUint8(ptr5+ offset, v, true);
          offset += 1;
        }
      } else {
        // TypedArray / ArrayBuffer-like, direct copy
        valData5 = new Uint8Array(val5.buffer || val5, val5.byteOffset, valLenBytes5);
        const out5 = new Uint8Array(memory0.buffer, ptr5, valLenBytes5);
        out5.set(valData5);
      }
      
      dataView(memory0).setUint32(base + 12, len5, true);
      dataView(memory0).setUint32(base + 8, ptr5, true);
    }
    dataView(memory0).setUint32(arg1 + 4, len6, true);
    dataView(memory0).setUint32(arg1 + 0, result6, true);
    _debugLog('[iface="wasi:http/types@0.2.12", function="[method]fields.entries"][Instruction::Return]', {
      funcName: '[method]fields.entries',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline53.fnName = 'wasi:http/types@0.2.12#entries';
  
  const handleTable1 = [T_FLAG, 0];
  handleTable1._createdReps = new Set();
  
  
  const captureTable1= new Map();
  let captureCnt1= 0;
  
  HANDLE_TABLES[1] = handleTable1;
  
  const _trampoline54 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable2.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    var handle4 = arg1;
    
    var rep5 = handleTable3[(handle4 << 1) + 1] & ~T_FLAG;
    var rsc3 = captureTable3.get(rep5);
    if (!rsc3) {
      rsc3 = Object.create(InputStream.prototype);
      Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
      Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
    }
    
    curResourceBorrows.push(rsc3);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.splice"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'splice',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet6 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.splice(rsc3, BigInt.asUintN(64, BigInt(arg2))),
      })
      ;
      ret = hostRet6 !== null && typeof hostRet6 === 'object' && (hostRet6.tag === 'ok' || hostRet6.tag === 'err')
      ? hostRet6
      : { tag: 'ok', val: hostRet6};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant9 = ret;
    switch (variant9.tag) {
      case 'ok': {
        const e = variant9.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        dataView(memory0).setBigInt64(arg3 + 8, toUint64(e), true);
        
        break;
      }
      case 'err': {
        const e = variant9.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant8 = e;
        switch (variant8.tag) {
          case 'last-operation-failed': {
            const e = variant8.val;
            dataView(memory0).setInt8(arg3 + 8, 0, true);
            
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error\" resource.');
            }
            var handle7 = e[symbolRscHandle];
            if (!handle7) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle7 = rscTableCreateOwn(handleTable1, rep);
            }
            
            dataView(memory0).setInt32(arg3 + 12, handle7, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg3 + 8, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant8.tag)}\` (received \`${variant8}\`) specified for \`StreamError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant9, valueType: typeof variant9});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.splice"][Instruction::Return]', {
      funcName: '[method]output-stream.splice',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline54.fnName = 'wasi:io/streams@0.2.12#splice';
  
  const _trampoline55 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable2.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.check-write"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'checkWrite',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.checkWrite(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant5 = e;
        switch (variant5.tag) {
          case 'last-operation-failed': {
            const e = variant5.val;
            dataView(memory0).setInt8(arg1 + 8, 0, true);
            
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error\" resource.');
            }
            var handle4 = e[symbolRscHandle];
            if (!handle4) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle4 = rscTableCreateOwn(handleTable1, rep);
            }
            
            dataView(memory0).setInt32(arg1 + 12, handle4, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 8, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.check-write"][Instruction::Return]', {
      funcName: '[method]output-stream.check-write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline55.fnName = 'wasi:io/streams@0.2.12#checkWrite';
  
  const _trampoline56 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable2.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    if (ptr3 % 1 !== 0) throw new TypeError(`list pointer [${ptr3}] is not aligned to 1`);
    var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.write"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'write',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet4 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.write(result3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant7 = ret;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant6 = e;
        switch (variant6.tag) {
          case 'last-operation-failed': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg3 + 4, 0, true);
            
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error\" resource.');
            }
            var handle5 = e[symbolRscHandle];
            if (!handle5) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle5 = rscTableCreateOwn(handleTable1, rep);
            }
            
            dataView(memory0).setInt32(arg3 + 8, handle5, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg3 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`StreamError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.write"][Instruction::Return]', {
      funcName: '[method]output-stream.write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline56.fnName = 'wasi:io/streams@0.2.12#write';
  
  const _trampoline57 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(InputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]input-stream.read"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'read',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.read(BigInt.asUintN(64, BigInt(arg1))),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant7 = ret;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        var val4 = e;
        var len4 = Array.isArray(val4) ? val4.length : val4.byteLength;
        var ptr4 = realloc0(0, 0, 1, len4 * 1);
        
        let valData4;
        const valLenBytes4 = len4 * 1;
        if (Array.isArray(val4)) {
          // Regular array likely containing numbers, write values to memory
          let offset = 0;
          const dv4 = new DataView(memory0.buffer);
          for (const v of val4) {
            _requireValidNumericPrimitive.bind(null, 'u8')(v);
            dv4.setUint8(ptr4+ offset, v, true);
            offset += 1;
          }
        } else {
          // TypedArray / ArrayBuffer-like, direct copy
          valData4 = new Uint8Array(val4.buffer || val4, val4.byteOffset, valLenBytes4);
          const out4 = new Uint8Array(memory0.buffer, ptr4, valLenBytes4);
          out4.set(valData4);
        }
        
        dataView(memory0).setUint32(arg2 + 8, len4, true);
        dataView(memory0).setUint32(arg2 + 4, ptr4, true);
        
        break;
      }
      case 'err': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var variant6 = e;
        switch (variant6.tag) {
          case 'last-operation-failed': {
            const e = variant6.val;
            dataView(memory0).setInt8(arg2 + 4, 0, true);
            
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error\" resource.');
            }
            var handle5 = e[symbolRscHandle];
            if (!handle5) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle5 = rscTableCreateOwn(handleTable1, rep);
            }
            
            dataView(memory0).setInt32(arg2 + 8, handle5, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg2 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`StreamError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]input-stream.read"][Instruction::Return]', {
      funcName: '[method]input-stream.read',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline57.fnName = 'wasi:io/streams@0.2.12#read';
  
  const _trampoline58 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable1.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Error$1.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/error@0.2.12", function="[method]error.to-debug-string"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'toDebugString',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.toDebugString(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    
    var encodeRes = _utf8AllocateAndEncode(ret, realloc0, memory0);
    var ptr3= encodeRes.ptr;
    var len3 = encodeRes.len;
    
    dataView(memory0).setUint32(arg1 + 4, len3, true);
    dataView(memory0).setUint32(arg1 + 0, ptr3, true);
    _debugLog('[iface="wasi:io/error@0.2.12", function="[method]error.to-debug-string"][Instruction::Return]', {
      funcName: '[method]error.to-debug-string',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline58.fnName = 'wasi:io/error@0.2.12#toDebugString';
  
  const _trampoline59 = function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable10.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutgoingRequest.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    else {
      captureTable10.delete(rep2);
    }
    rscTableRemove(handleTable10, handle1);
    let variant6;
    switch (arg1) {
      case 0: {
        variant6 = undefined;
        break;
      }
      case 1: {
        var handle4 = arg2;
        
        var rep5 = handleTable11[(handle4 << 1) + 1] & ~T_FLAG;
        var rsc3 = captureTable11.get(rep5);
        if (!rsc3) {
          rsc3 = Object.create(RequestOptions.prototype);
          Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
          Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
        }
        
        else {
          captureTable11.delete(rep5);
        }
        rscTableRemove(handleTable11, handle4);
        variant6 = rsc3;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="wasi:http/outgoing-handler@0.2.12", function="handle"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'handle',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet7 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => handle(rsc0, variant6),
      })
      ;
      ret = hostRet7 !== null && typeof hostRet7 === 'object' && (hostRet7.tag === 'ok' || hostRet7.tag === 'err')
      ? hostRet7
      : { tag: 'ok', val: hostRet7};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    var variant47 = ret;
    switch (variant47.tag) {
      case 'ok': {
        const e = variant47.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        
        if (!(e instanceof FutureIncomingResponse)) {
          throw new TypeError('Resource error: Not a valid \"FutureIncomingResponse\" resource.');
        }
        var handle8 = e[symbolRscHandle];
        if (!handle8) {
          const rep = e[symbolRscRep] || ++captureCnt8;
          captureTable8.set(rep, e);
          handle8 = rscTableCreateOwn(handleTable8, rep);
        }
        
        dataView(memory0).setInt32(arg3 + 8, handle8, true);
        
        break;
      }
      case 'err': {
        const e = variant47.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant46 = e;
        switch (variant46.tag) {
          case 'DNS-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 0, true);
            break;
          }
          case 'DNS-error': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 1, true);
            var {rcode: v9_0, infoCode: v9_1 } = e;
            var variant11 = v9_0;
            if (variant11 === null || variant11=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant11;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr10= encodeRes.ptr;
              var len10 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len10, true);
              dataView(memory0).setUint32(arg3 + 20, ptr10, true);
            }
            var variant12 = v9_1;
            if (variant12 === null || variant12=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant12;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt16(arg3 + 30, toUint16(e), true);
            }
            break;
          }
          case 'destination-not-found': {
            dataView(memory0).setInt8(arg3 + 8, 2, true);
            break;
          }
          case 'destination-unavailable': {
            dataView(memory0).setInt8(arg3 + 8, 3, true);
            break;
          }
          case 'destination-IP-prohibited': {
            dataView(memory0).setInt8(arg3 + 8, 4, true);
            break;
          }
          case 'destination-IP-unroutable': {
            dataView(memory0).setInt8(arg3 + 8, 5, true);
            break;
          }
          case 'connection-refused': {
            dataView(memory0).setInt8(arg3 + 8, 6, true);
            break;
          }
          case 'connection-terminated': {
            dataView(memory0).setInt8(arg3 + 8, 7, true);
            break;
          }
          case 'connection-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 8, true);
            break;
          }
          case 'connection-read-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 9, true);
            break;
          }
          case 'connection-write-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 10, true);
            break;
          }
          case 'connection-limit-reached': {
            dataView(memory0).setInt8(arg3 + 8, 11, true);
            break;
          }
          case 'TLS-protocol-error': {
            dataView(memory0).setInt8(arg3 + 8, 12, true);
            break;
          }
          case 'TLS-certificate-error': {
            dataView(memory0).setInt8(arg3 + 8, 13, true);
            break;
          }
          case 'TLS-alert-received': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 14, true);
            var {alertId: v13_0, alertMessage: v13_1 } = e;
            var variant14 = v13_0;
            if (variant14 === null || variant14=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant14;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt8(arg3 + 17, toUint8(e), true);
            }
            var variant16 = v13_1;
            if (variant16 === null || variant16=== undefined) {
              dataView(memory0).setInt8(arg3 + 20, 0, true);
            } else {
              const e = variant16;
              dataView(memory0).setInt8(arg3 + 20, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr15= encodeRes.ptr;
              var len15 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 28, len15, true);
              dataView(memory0).setUint32(arg3 + 24, ptr15, true);
            }
            break;
          }
          case 'HTTP-request-denied': {
            dataView(memory0).setInt8(arg3 + 8, 15, true);
            break;
          }
          case 'HTTP-request-length-required': {
            dataView(memory0).setInt8(arg3 + 8, 16, true);
            break;
          }
          case 'HTTP-request-body-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 17, true);
            var variant17 = e;
            if (variant17 === null || variant17=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant17;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setBigInt64(arg3 + 24, toUint64(e), true);
            }
            break;
          }
          case 'HTTP-request-method-invalid': {
            dataView(memory0).setInt8(arg3 + 8, 18, true);
            break;
          }
          case 'HTTP-request-URI-invalid': {
            dataView(memory0).setInt8(arg3 + 8, 19, true);
            break;
          }
          case 'HTTP-request-URI-too-long': {
            dataView(memory0).setInt8(arg3 + 8, 20, true);
            break;
          }
          case 'HTTP-request-header-section-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 21, true);
            var variant18 = e;
            if (variant18 === null || variant18=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant18;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-request-header-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 22, true);
            var variant23 = e;
            if (variant23 === null || variant23=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant23;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              var {fieldName: v19_0, fieldSize: v19_1 } = e;
              var variant21 = v19_0;
              if (variant21 === null || variant21=== undefined) {
                dataView(memory0).setInt8(arg3 + 20, 0, true);
              } else {
                const e = variant21;
                dataView(memory0).setInt8(arg3 + 20, 1, true);
                
                var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
                var ptr20= encodeRes.ptr;
                var len20 = encodeRes.len;
                
                dataView(memory0).setUint32(arg3 + 28, len20, true);
                dataView(memory0).setUint32(arg3 + 24, ptr20, true);
              }
              var variant22 = v19_1;
              if (variant22 === null || variant22=== undefined) {
                dataView(memory0).setInt8(arg3 + 32, 0, true);
              } else {
                const e = variant22;
                dataView(memory0).setInt8(arg3 + 32, 1, true);
                dataView(memory0).setInt32(arg3 + 36, toUint32(e), true);
              }
            }
            break;
          }
          case 'HTTP-request-trailer-section-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 23, true);
            var variant24 = e;
            if (variant24 === null || variant24=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant24;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-request-trailer-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 24, true);
            var {fieldName: v25_0, fieldSize: v25_1 } = e;
            var variant27 = v25_0;
            if (variant27 === null || variant27=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant27;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr26= encodeRes.ptr;
              var len26 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len26, true);
              dataView(memory0).setUint32(arg3 + 20, ptr26, true);
            }
            var variant28 = v25_1;
            if (variant28 === null || variant28=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant28;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-incomplete': {
            dataView(memory0).setInt8(arg3 + 8, 25, true);
            break;
          }
          case 'HTTP-response-header-section-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 26, true);
            var variant29 = e;
            if (variant29 === null || variant29=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant29;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-header-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 27, true);
            var {fieldName: v30_0, fieldSize: v30_1 } = e;
            var variant32 = v30_0;
            if (variant32 === null || variant32=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant32;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr31= encodeRes.ptr;
              var len31 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len31, true);
              dataView(memory0).setUint32(arg3 + 20, ptr31, true);
            }
            var variant33 = v30_1;
            if (variant33 === null || variant33=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant33;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-body-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 28, true);
            var variant34 = e;
            if (variant34 === null || variant34=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant34;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setBigInt64(arg3 + 24, toUint64(e), true);
            }
            break;
          }
          case 'HTTP-response-trailer-section-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 29, true);
            var variant35 = e;
            if (variant35 === null || variant35=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant35;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-trailer-size': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 30, true);
            var {fieldName: v36_0, fieldSize: v36_1 } = e;
            var variant38 = v36_0;
            if (variant38 === null || variant38=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant38;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr37= encodeRes.ptr;
              var len37 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len37, true);
              dataView(memory0).setUint32(arg3 + 20, ptr37, true);
            }
            var variant39 = v36_1;
            if (variant39 === null || variant39=== undefined) {
              dataView(memory0).setInt8(arg3 + 28, 0, true);
            } else {
              const e = variant39;
              dataView(memory0).setInt8(arg3 + 28, 1, true);
              dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
            }
            break;
          }
          case 'HTTP-response-transfer-coding': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 31, true);
            var variant41 = e;
            if (variant41 === null || variant41=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant41;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr40= encodeRes.ptr;
              var len40 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len40, true);
              dataView(memory0).setUint32(arg3 + 20, ptr40, true);
            }
            break;
          }
          case 'HTTP-response-content-coding': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 32, true);
            var variant43 = e;
            if (variant43 === null || variant43=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant43;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr42= encodeRes.ptr;
              var len42 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len42, true);
              dataView(memory0).setUint32(arg3 + 20, ptr42, true);
            }
            break;
          }
          case 'HTTP-response-timeout': {
            dataView(memory0).setInt8(arg3 + 8, 33, true);
            break;
          }
          case 'HTTP-upgrade-failed': {
            dataView(memory0).setInt8(arg3 + 8, 34, true);
            break;
          }
          case 'HTTP-protocol-error': {
            dataView(memory0).setInt8(arg3 + 8, 35, true);
            break;
          }
          case 'loop-detected': {
            dataView(memory0).setInt8(arg3 + 8, 36, true);
            break;
          }
          case 'configuration-error': {
            dataView(memory0).setInt8(arg3 + 8, 37, true);
            break;
          }
          case 'internal-error': {
            const e = variant46.val;
            dataView(memory0).setInt8(arg3 + 8, 38, true);
            var variant45 = e;
            if (variant45 === null || variant45=== undefined) {
              dataView(memory0).setInt8(arg3 + 16, 0, true);
            } else {
              const e = variant45;
              dataView(memory0).setInt8(arg3 + 16, 1, true);
              
              var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
              var ptr44= encodeRes.ptr;
              var len44 = encodeRes.len;
              
              dataView(memory0).setUint32(arg3 + 24, len44, true);
              dataView(memory0).setUint32(arg3 + 20, ptr44, true);
            }
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant46.tag)}\` (received \`${variant46}\`) specified for \`ErrorCode\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant47, valueType: typeof variant47});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:http/outgoing-handler@0.2.12", function="handle"][Instruction::Return]', {
      funcName: 'handle',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline59.fnName = 'wasi:http/outgoing-handler@0.2.12#handle';
  
  const _trampoline60 = async function(arg0, arg1, arg2) {
    var len3 = arg1;
    var base3 = arg0;
    if (base3 % 4 !== 0) throw new TypeError(`list pointer [${base3}] is not aligned to 4`);
    var result3 = [];
    for (let i = 0; i < len3; i++) {
      const base = base3 + i * 4;
      var handle1 = dataView(memory0).getInt32(base + 0, true);
      
      var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
      var rsc0 = captureTable0.get(rep2);
      if (!rsc0) {
        rsc0 = Object.create(Pollable.prototype);
        Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
        Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
      }
      
      curResourceBorrows.push(rsc0);
      result3.push(rsc0);
    }
    _debugLog('[iface="wasi:io/poll@0.2.12", function="poll"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'poll',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    
    try {
      ret = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => poll(result3),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during async call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      return task.completionPromise();
      
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var val4 = ret;
    var len4 = val4.length;
    var ptr4 = realloc0(0, 0, 4, len4 * 4);
    
    let valData4;
    const valLenBytes4 = len4 * 4;
    if (Array.isArray(val4)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv4 = new DataView(memory0.buffer);
      for (const v of val4) {
        _requireValidNumericPrimitive.bind(null, 'u32')(v);
        dv4.setUint32(ptr4+ offset, v, true);
        offset += 4;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData4 = new Uint8Array(val4.buffer || val4, val4.byteOffset, valLenBytes4);
      const out4 = new Uint8Array(memory0.buffer, ptr4, valLenBytes4);
      out4.set(valData4);
    }
    
    dataView(memory0).setUint32(arg2 + 4, len4, true);
    dataView(memory0).setUint32(arg2 + 0, ptr4, true);
    _debugLog('[iface="wasi:io/poll@0.2.12", function="poll"][Instruction::Return]', {
      funcName: 'poll',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline60.fnName = 'wasi:io/poll@0.2.12#poll';
  _trampoline60.manuallyAsync = true;
  
  const _trampoline61 = async function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable2.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'blockingFlush',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet3 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.blockingFlush(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant5 = e;
        switch (variant5.tag) {
          case 'last-operation-failed': {
            const e = variant5.val;
            dataView(memory0).setInt8(arg1 + 4, 0, true);
            
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error\" resource.');
            }
            var handle4 = e[symbolRscHandle];
            if (!handle4) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle4 = rscTableCreateOwn(handleTable1, rep);
            }
            
            dataView(memory0).setInt32(arg1 + 8, handle4, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
          }
        }
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.blocking-flush"][Instruction::Return]', {
      funcName: '[method]output-stream.blocking-flush',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline61.fnName = 'wasi:io/streams@0.2.12#blockingFlush';
  _trampoline61.manuallyAsync = true;
  
  const handleTable14 = [T_FLAG, 0];
  handleTable14._createdReps = new Set();
  
  
  const captureTable14= new Map();
  let captureCnt14= 0;
  
  HANDLE_TABLES[14] = handleTable14;
  
  const _trampoline62 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.read-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'readViaStream',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.readViaStream(BigInt.asUintN(64, BigInt(arg1))),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        
        if (!(e instanceof InputStream)) {
          throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable3, rep);
        }
        
        dataView(memory0).setInt32(arg2 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg2 + 4, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.read-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.read-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline62.fnName = 'wasi:filesystem/types@0.2.12#readViaStream';
  
  const _trampoline63 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'writeViaStream',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.writeViaStream(BigInt.asUintN(64, BigInt(arg1))),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable2, rep);
        }
        
        dataView(memory0).setInt32(arg2 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg2 + 4, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.write-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.write-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline63.fnName = 'wasi:filesystem/types@0.2.12#writeViaStream';
  
  const _trampoline64 = async function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'appendViaStream',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet3 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.appendViaStream(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable2, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg1 + 4, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.append-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.append-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline64.fnName = 'wasi:filesystem/types@0.2.12#appendViaStream';
  _trampoline64.manuallyAsync = true;
  
  const _trampoline65 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.get-flags"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getFlags',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.getFlags(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        let flags4 = 0;
        if (typeof e === 'object' && e !== null) {
          flags4 = Boolean(e.read) << 0 | Boolean(e.write) << 1 | Boolean(e.fileIntegritySync) << 2 | Boolean(e.dataIntegritySync) << 3 | Boolean(e.requestedWriteSync) << 4 | Boolean(e.mutateDirectory) << 5;
        } else if (e !== null && e!== undefined) {
          throw new TypeError('only an object, undefined or null can be converted to flags');
        }
        dataView(memory0).setInt8(arg1 + 1, flags4, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg1 + 1, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.get-flags"][Instruction::Return]', {
      funcName: '[method]descriptor.get-flags',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline65.fnName = 'wasi:filesystem/types@0.2.12#getFlags';
  
  const handleTable15 = [T_FLAG, 0];
  handleTable15._createdReps = new Set();
  
  
  const captureTable15= new Map();
  let captureCnt15= 0;
  
  HANDLE_TABLES[15] = handleTable15;
  
  const _trampoline66 = async function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.read-directory"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'readDirectory',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet3 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.readDirectory(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        
        if (!(e instanceof DirectoryEntryStream)) {
          throw new TypeError('Resource error: Not a valid \"DirectoryEntryStream\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt15;
          captureTable15.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable15, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 4, handle4, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg1 + 4, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.read-directory"][Instruction::Return]', {
      funcName: '[method]descriptor.read-directory',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline66.fnName = 'wasi:filesystem/types@0.2.12#readDirectory';
  _trampoline66.manuallyAsync = true;
  
  const _trampoline67 = async function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.create-directory-at"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'createDirectoryAt',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet4 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.createDirectoryAt(result3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg3 + 1, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.create-directory-at"][Instruction::Return]', {
      funcName: '[method]descriptor.create-directory-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline67.fnName = 'wasi:filesystem/types@0.2.12#createDirectoryAt';
  _trampoline67.manuallyAsync = true;
  
  const _trampoline68 = async function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.stat"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'stat',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet3 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.stat(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant13 = ret;
    switch (variant13.tag) {
      case 'ok': {
        const e = variant13.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var {type: v4_0, linkCount: v4_1, size: v4_2, dataAccessTimestamp: v4_3, dataModificationTimestamp: v4_4, statusChangeTimestamp: v4_5 } = e;
        var val5 = v4_0;
        let enum5;
        switch (val5) {
          case 'unknown': {
            enum5 = 0;
            break;
          }
          case 'block-device': {
            enum5 = 1;
            break;
          }
          case 'character-device': {
            enum5 = 2;
            break;
          }
          case 'directory': {
            enum5 = 3;
            break;
          }
          case 'fifo': {
            enum5 = 4;
            break;
          }
          case 'symbolic-link': {
            enum5 = 5;
            break;
          }
          case 'regular-file': {
            enum5 = 6;
            break;
          }
          case 'socket': {
            enum5 = 7;
            break;
          }
          default: {
            if ((v4_0) instanceof Error) {
              console.error(v4_0);
            }
            
            throw new TypeError(`"${val5}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum5, true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v4_1), true);
        dataView(memory0).setBigInt64(arg1 + 24, toUint64(v4_2), true);
        var variant7 = v4_3;
        if (variant7 === null || variant7=== undefined) {
          dataView(memory0).setInt8(arg1 + 32, 0, true);
        } else {
          const e = variant7;
          dataView(memory0).setInt8(arg1 + 32, 1, true);
          var {seconds: v6_0, nanoseconds: v6_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 40, toUint64(v6_0), true);
          dataView(memory0).setInt32(arg1 + 48, toUint32(v6_1), true);
        }
        var variant9 = v4_4;
        if (variant9 === null || variant9=== undefined) {
          dataView(memory0).setInt8(arg1 + 56, 0, true);
        } else {
          const e = variant9;
          dataView(memory0).setInt8(arg1 + 56, 1, true);
          var {seconds: v8_0, nanoseconds: v8_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 64, toUint64(v8_0), true);
          dataView(memory0).setInt32(arg1 + 72, toUint32(v8_1), true);
        }
        var variant11 = v4_5;
        if (variant11 === null || variant11=== undefined) {
          dataView(memory0).setInt8(arg1 + 80, 0, true);
        } else {
          const e = variant11;
          dataView(memory0).setInt8(arg1 + 80, 1, true);
          var {seconds: v10_0, nanoseconds: v10_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 88, toUint64(v10_0), true);
          dataView(memory0).setInt32(arg1 + 96, toUint32(v10_1), true);
        }
        
        break;
      }
      case 'err': {
        const e = variant13.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val12 = e;
        let enum12;
        switch (val12) {
          case 'access': {
            enum12 = 0;
            break;
          }
          case 'would-block': {
            enum12 = 1;
            break;
          }
          case 'already': {
            enum12 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum12 = 3;
            break;
          }
          case 'busy': {
            enum12 = 4;
            break;
          }
          case 'deadlock': {
            enum12 = 5;
            break;
          }
          case 'quota': {
            enum12 = 6;
            break;
          }
          case 'exist': {
            enum12 = 7;
            break;
          }
          case 'file-too-large': {
            enum12 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum12 = 9;
            break;
          }
          case 'in-progress': {
            enum12 = 10;
            break;
          }
          case 'interrupted': {
            enum12 = 11;
            break;
          }
          case 'invalid': {
            enum12 = 12;
            break;
          }
          case 'io': {
            enum12 = 13;
            break;
          }
          case 'is-directory': {
            enum12 = 14;
            break;
          }
          case 'loop': {
            enum12 = 15;
            break;
          }
          case 'too-many-links': {
            enum12 = 16;
            break;
          }
          case 'message-size': {
            enum12 = 17;
            break;
          }
          case 'name-too-long': {
            enum12 = 18;
            break;
          }
          case 'no-device': {
            enum12 = 19;
            break;
          }
          case 'no-entry': {
            enum12 = 20;
            break;
          }
          case 'no-lock': {
            enum12 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum12 = 22;
            break;
          }
          case 'insufficient-space': {
            enum12 = 23;
            break;
          }
          case 'not-directory': {
            enum12 = 24;
            break;
          }
          case 'not-empty': {
            enum12 = 25;
            break;
          }
          case 'not-recoverable': {
            enum12 = 26;
            break;
          }
          case 'unsupported': {
            enum12 = 27;
            break;
          }
          case 'no-tty': {
            enum12 = 28;
            break;
          }
          case 'no-such-device': {
            enum12 = 29;
            break;
          }
          case 'overflow': {
            enum12 = 30;
            break;
          }
          case 'not-permitted': {
            enum12 = 31;
            break;
          }
          case 'pipe': {
            enum12 = 32;
            break;
          }
          case 'read-only': {
            enum12 = 33;
            break;
          }
          case 'invalid-seek': {
            enum12 = 34;
            break;
          }
          case 'text-file-busy': {
            enum12 = 35;
            break;
          }
          case 'cross-device': {
            enum12 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val12}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum12, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant13, valueType: typeof variant13});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.stat"][Instruction::Return]', {
      funcName: '[method]descriptor.stat',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline68.fnName = 'wasi:filesystem/types@0.2.12#stat';
  _trampoline68.manuallyAsync = true;
  
  const _trampoline69 = async function(arg0, arg1, arg2, arg3, arg4) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags3 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    var ptr4 = arg2;
    var len4 = arg3;
    var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.stat-at"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'statAt',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet5 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.statAt(flags3, result4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant15 = ret;
    switch (variant15.tag) {
      case 'ok': {
        const e = variant15.val;
        dataView(memory0).setInt8(arg4 + 0, 0, true);
        var {type: v6_0, linkCount: v6_1, size: v6_2, dataAccessTimestamp: v6_3, dataModificationTimestamp: v6_4, statusChangeTimestamp: v6_5 } = e;
        var val7 = v6_0;
        let enum7;
        switch (val7) {
          case 'unknown': {
            enum7 = 0;
            break;
          }
          case 'block-device': {
            enum7 = 1;
            break;
          }
          case 'character-device': {
            enum7 = 2;
            break;
          }
          case 'directory': {
            enum7 = 3;
            break;
          }
          case 'fifo': {
            enum7 = 4;
            break;
          }
          case 'symbolic-link': {
            enum7 = 5;
            break;
          }
          case 'regular-file': {
            enum7 = 6;
            break;
          }
          case 'socket': {
            enum7 = 7;
            break;
          }
          default: {
            if ((v6_0) instanceof Error) {
              console.error(v6_0);
            }
            
            throw new TypeError(`"${val7}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum7, true);
        dataView(memory0).setBigInt64(arg4 + 16, toUint64(v6_1), true);
        dataView(memory0).setBigInt64(arg4 + 24, toUint64(v6_2), true);
        var variant9 = v6_3;
        if (variant9 === null || variant9=== undefined) {
          dataView(memory0).setInt8(arg4 + 32, 0, true);
        } else {
          const e = variant9;
          dataView(memory0).setInt8(arg4 + 32, 1, true);
          var {seconds: v8_0, nanoseconds: v8_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 40, toUint64(v8_0), true);
          dataView(memory0).setInt32(arg4 + 48, toUint32(v8_1), true);
        }
        var variant11 = v6_4;
        if (variant11 === null || variant11=== undefined) {
          dataView(memory0).setInt8(arg4 + 56, 0, true);
        } else {
          const e = variant11;
          dataView(memory0).setInt8(arg4 + 56, 1, true);
          var {seconds: v10_0, nanoseconds: v10_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 64, toUint64(v10_0), true);
          dataView(memory0).setInt32(arg4 + 72, toUint32(v10_1), true);
        }
        var variant13 = v6_5;
        if (variant13 === null || variant13=== undefined) {
          dataView(memory0).setInt8(arg4 + 80, 0, true);
        } else {
          const e = variant13;
          dataView(memory0).setInt8(arg4 + 80, 1, true);
          var {seconds: v12_0, nanoseconds: v12_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 88, toUint64(v12_0), true);
          dataView(memory0).setInt32(arg4 + 96, toUint32(v12_1), true);
        }
        
        break;
      }
      case 'err': {
        const e = variant15.val;
        dataView(memory0).setInt8(arg4 + 0, 1, true);
        var val14 = e;
        let enum14;
        switch (val14) {
          case 'access': {
            enum14 = 0;
            break;
          }
          case 'would-block': {
            enum14 = 1;
            break;
          }
          case 'already': {
            enum14 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum14 = 3;
            break;
          }
          case 'busy': {
            enum14 = 4;
            break;
          }
          case 'deadlock': {
            enum14 = 5;
            break;
          }
          case 'quota': {
            enum14 = 6;
            break;
          }
          case 'exist': {
            enum14 = 7;
            break;
          }
          case 'file-too-large': {
            enum14 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum14 = 9;
            break;
          }
          case 'in-progress': {
            enum14 = 10;
            break;
          }
          case 'interrupted': {
            enum14 = 11;
            break;
          }
          case 'invalid': {
            enum14 = 12;
            break;
          }
          case 'io': {
            enum14 = 13;
            break;
          }
          case 'is-directory': {
            enum14 = 14;
            break;
          }
          case 'loop': {
            enum14 = 15;
            break;
          }
          case 'too-many-links': {
            enum14 = 16;
            break;
          }
          case 'message-size': {
            enum14 = 17;
            break;
          }
          case 'name-too-long': {
            enum14 = 18;
            break;
          }
          case 'no-device': {
            enum14 = 19;
            break;
          }
          case 'no-entry': {
            enum14 = 20;
            break;
          }
          case 'no-lock': {
            enum14 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum14 = 22;
            break;
          }
          case 'insufficient-space': {
            enum14 = 23;
            break;
          }
          case 'not-directory': {
            enum14 = 24;
            break;
          }
          case 'not-empty': {
            enum14 = 25;
            break;
          }
          case 'not-recoverable': {
            enum14 = 26;
            break;
          }
          case 'unsupported': {
            enum14 = 27;
            break;
          }
          case 'no-tty': {
            enum14 = 28;
            break;
          }
          case 'no-such-device': {
            enum14 = 29;
            break;
          }
          case 'overflow': {
            enum14 = 30;
            break;
          }
          case 'not-permitted': {
            enum14 = 31;
            break;
          }
          case 'pipe': {
            enum14 = 32;
            break;
          }
          case 'read-only': {
            enum14 = 33;
            break;
          }
          case 'invalid-seek': {
            enum14 = 34;
            break;
          }
          case 'text-file-busy': {
            enum14 = 35;
            break;
          }
          case 'cross-device': {
            enum14 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val14}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum14, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant15, valueType: typeof variant15});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.stat-at"][Instruction::Return]', {
      funcName: '[method]descriptor.stat-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline69.fnName = 'wasi:filesystem/types@0.2.12#statAt';
  _trampoline69.manuallyAsync = true;
  
  const _trampoline70 = async function(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags3 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    var ptr4 = arg2;
    var len4 = arg3;
    var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
    if ((arg4 & 4294967280) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags5 = {
      create: Boolean(arg4 & 1),
      directory: Boolean(arg4 & 2),
      exclusive: Boolean(arg4 & 4),
      truncate: Boolean(arg4 & 8),
    };
    if ((arg5 & 4294967232) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags6 = {
      read: Boolean(arg5 & 1),
      write: Boolean(arg5 & 2),
      fileIntegritySync: Boolean(arg5 & 4),
      dataIntegritySync: Boolean(arg5 & 8),
      requestedWriteSync: Boolean(arg5 & 16),
      mutateDirectory: Boolean(arg5 & 32),
    };
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.open-at"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'openAt',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet7 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.openAt(flags3, result4, flags5, flags6),
      })
      ;
      ret = hostRet7 !== null && typeof hostRet7 === 'object' && (hostRet7.tag === 'ok' || hostRet7.tag === 'err')
      ? hostRet7
      : { tag: 'ok', val: hostRet7};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant10 = ret;
    switch (variant10.tag) {
      case 'ok': {
        const e = variant10.val;
        dataView(memory0).setInt8(arg6 + 0, 0, true);
        
        if (!(e instanceof Descriptor)) {
          throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
        }
        var handle8 = e[symbolRscHandle];
        if (!handle8) {
          const rep = e[symbolRscRep] || ++captureCnt14;
          captureTable14.set(rep, e);
          handle8 = rscTableCreateOwn(handleTable14, rep);
        }
        
        dataView(memory0).setInt32(arg6 + 4, handle8, true);
        
        break;
      }
      case 'err': {
        const e = variant10.val;
        dataView(memory0).setInt8(arg6 + 0, 1, true);
        var val9 = e;
        let enum9;
        switch (val9) {
          case 'access': {
            enum9 = 0;
            break;
          }
          case 'would-block': {
            enum9 = 1;
            break;
          }
          case 'already': {
            enum9 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum9 = 3;
            break;
          }
          case 'busy': {
            enum9 = 4;
            break;
          }
          case 'deadlock': {
            enum9 = 5;
            break;
          }
          case 'quota': {
            enum9 = 6;
            break;
          }
          case 'exist': {
            enum9 = 7;
            break;
          }
          case 'file-too-large': {
            enum9 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum9 = 9;
            break;
          }
          case 'in-progress': {
            enum9 = 10;
            break;
          }
          case 'interrupted': {
            enum9 = 11;
            break;
          }
          case 'invalid': {
            enum9 = 12;
            break;
          }
          case 'io': {
            enum9 = 13;
            break;
          }
          case 'is-directory': {
            enum9 = 14;
            break;
          }
          case 'loop': {
            enum9 = 15;
            break;
          }
          case 'too-many-links': {
            enum9 = 16;
            break;
          }
          case 'message-size': {
            enum9 = 17;
            break;
          }
          case 'name-too-long': {
            enum9 = 18;
            break;
          }
          case 'no-device': {
            enum9 = 19;
            break;
          }
          case 'no-entry': {
            enum9 = 20;
            break;
          }
          case 'no-lock': {
            enum9 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum9 = 22;
            break;
          }
          case 'insufficient-space': {
            enum9 = 23;
            break;
          }
          case 'not-directory': {
            enum9 = 24;
            break;
          }
          case 'not-empty': {
            enum9 = 25;
            break;
          }
          case 'not-recoverable': {
            enum9 = 26;
            break;
          }
          case 'unsupported': {
            enum9 = 27;
            break;
          }
          case 'no-tty': {
            enum9 = 28;
            break;
          }
          case 'no-such-device': {
            enum9 = 29;
            break;
          }
          case 'overflow': {
            enum9 = 30;
            break;
          }
          case 'not-permitted': {
            enum9 = 31;
            break;
          }
          case 'pipe': {
            enum9 = 32;
            break;
          }
          case 'read-only': {
            enum9 = 33;
            break;
          }
          case 'invalid-seek': {
            enum9 = 34;
            break;
          }
          case 'text-file-busy': {
            enum9 = 35;
            break;
          }
          case 'cross-device': {
            enum9 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val9}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg6 + 4, enum9, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant10, valueType: typeof variant10});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.open-at"][Instruction::Return]', {
      funcName: '[method]descriptor.open-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline70.fnName = 'wasi:filesystem/types@0.2.12#openAt';
  _trampoline70.manuallyAsync = true;
  
  const _trampoline71 = async function(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.unlink-file-at"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'unlinkFileAt',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    
    const started = await task.enter({ isHost: hostProvided });
    if (!started) {
      _debugLog('[Instruction::CallInterface] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    let ret;
    try {
      const hostRet4 = await  _withGlobalCurrentTaskMetaAsync({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.unlinkFileAt(result3),
      })
      ;
      ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
      ? hostRet4
      : { tag: 'ok', val: hostRet4};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var val5 = e;
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
        dataView(memory0).setInt8(arg3 + 1, enum5, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.unlink-file-at"][Instruction::Return]', {
      funcName: '[method]descriptor.unlink-file-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline71.fnName = 'wasi:filesystem/types@0.2.12#unlinkFileAt';
  _trampoline71.manuallyAsync = true;
  
  const _trampoline72 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.metadata-hash"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'metadataHash',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.metadataHash(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var {lower: v4_0, upper: v4_1 } = e;
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(v4_0), true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v4_1), true);
        
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val5 = e;
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
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant6, valueType: typeof variant6});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.metadata-hash"][Instruction::Return]', {
      funcName: '[method]descriptor.metadata-hash',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline72.fnName = 'wasi:filesystem/types@0.2.12#metadataHash';
  
  const _trampoline73 = function(arg0, arg1, arg2, arg3, arg4) {
    var handle1 = arg0;
    
    var rep2 = handleTable14[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable14.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags3 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    var ptr4 = arg2;
    var len4 = arg3;
    var result4 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr4, len4));
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.metadata-hash-at"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'metadataHashAt',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet5 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.metadataHashAt(flags3, result4),
      })
      ;
      ret = hostRet5 !== null && typeof hostRet5 === 'object' && (hostRet5.tag === 'ok' || hostRet5.tag === 'err')
      ? hostRet5
      : { tag: 'ok', val: hostRet5};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant8 = ret;
    switch (variant8.tag) {
      case 'ok': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg4 + 0, 0, true);
        var {lower: v6_0, upper: v6_1 } = e;
        dataView(memory0).setBigInt64(arg4 + 8, toUint64(v6_0), true);
        dataView(memory0).setBigInt64(arg4 + 16, toUint64(v6_1), true);
        
        break;
      }
      case 'err': {
        const e = variant8.val;
        dataView(memory0).setInt8(arg4 + 0, 1, true);
        var val7 = e;
        let enum7;
        switch (val7) {
          case 'access': {
            enum7 = 0;
            break;
          }
          case 'would-block': {
            enum7 = 1;
            break;
          }
          case 'already': {
            enum7 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum7 = 3;
            break;
          }
          case 'busy': {
            enum7 = 4;
            break;
          }
          case 'deadlock': {
            enum7 = 5;
            break;
          }
          case 'quota': {
            enum7 = 6;
            break;
          }
          case 'exist': {
            enum7 = 7;
            break;
          }
          case 'file-too-large': {
            enum7 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum7 = 9;
            break;
          }
          case 'in-progress': {
            enum7 = 10;
            break;
          }
          case 'interrupted': {
            enum7 = 11;
            break;
          }
          case 'invalid': {
            enum7 = 12;
            break;
          }
          case 'io': {
            enum7 = 13;
            break;
          }
          case 'is-directory': {
            enum7 = 14;
            break;
          }
          case 'loop': {
            enum7 = 15;
            break;
          }
          case 'too-many-links': {
            enum7 = 16;
            break;
          }
          case 'message-size': {
            enum7 = 17;
            break;
          }
          case 'name-too-long': {
            enum7 = 18;
            break;
          }
          case 'no-device': {
            enum7 = 19;
            break;
          }
          case 'no-entry': {
            enum7 = 20;
            break;
          }
          case 'no-lock': {
            enum7 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum7 = 22;
            break;
          }
          case 'insufficient-space': {
            enum7 = 23;
            break;
          }
          case 'not-directory': {
            enum7 = 24;
            break;
          }
          case 'not-empty': {
            enum7 = 25;
            break;
          }
          case 'not-recoverable': {
            enum7 = 26;
            break;
          }
          case 'unsupported': {
            enum7 = 27;
            break;
          }
          case 'no-tty': {
            enum7 = 28;
            break;
          }
          case 'no-such-device': {
            enum7 = 29;
            break;
          }
          case 'overflow': {
            enum7 = 30;
            break;
          }
          case 'not-permitted': {
            enum7 = 31;
            break;
          }
          case 'pipe': {
            enum7 = 32;
            break;
          }
          case 'read-only': {
            enum7 = 33;
            break;
          }
          case 'invalid-seek': {
            enum7 = 34;
            break;
          }
          case 'text-file-busy': {
            enum7 = 35;
            break;
          }
          case 'cross-device': {
            enum7 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val7}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum7, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant8, valueType: typeof variant8});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]descriptor.metadata-hash-at"][Instruction::Return]', {
      funcName: '[method]descriptor.metadata-hash-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline73.fnName = 'wasi:filesystem/types@0.2.12#metadataHashAt';
  
  const _trampoline74 = function(arg0, arg1) {
    var handle1 = arg0;
    
    var rep2 = handleTable15[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable15.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(DirectoryEntryStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]directory-entry-stream.read-directory-entry"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'readDirectoryEntry',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'result-catch-handler',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    try {
      const hostRet3 = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.readDirectoryEntry(),
      })
      ;
      ret = hostRet3 !== null && typeof hostRet3 === 'object' && (hostRet3.tag === 'ok' || hostRet3.tag === 'err')
      ? hostRet3
      : { tag: 'ok', val: hostRet3};
    } catch (e) {
      if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    
    for (const entry of curResourceBorrows) {
      const rsc = entry.rsc ?? entry;
      if (entry.drop) {
        if (rsc[symbolRscHandle]) {
          entry.drop(rsc[symbolRscHandle]);
        }
      }
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    var variant9 = ret;
    switch (variant9.tag) {
      case 'ok': {
        const e = variant9.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var variant7 = e;
        if (variant7 === null || variant7=== undefined) {
          dataView(memory0).setInt8(arg1 + 4, 0, true);
        } else {
          const e = variant7;
          dataView(memory0).setInt8(arg1 + 4, 1, true);
          var {type: v4_0, name: v4_1 } = e;
          var val5 = v4_0;
          let enum5;
          switch (val5) {
            case 'unknown': {
              enum5 = 0;
              break;
            }
            case 'block-device': {
              enum5 = 1;
              break;
            }
            case 'character-device': {
              enum5 = 2;
              break;
            }
            case 'directory': {
              enum5 = 3;
              break;
            }
            case 'fifo': {
              enum5 = 4;
              break;
            }
            case 'symbolic-link': {
              enum5 = 5;
              break;
            }
            case 'regular-file': {
              enum5 = 6;
              break;
            }
            case 'socket': {
              enum5 = 7;
              break;
            }
            default: {
              if ((v4_0) instanceof Error) {
                console.error(v4_0);
              }
              
              throw new TypeError(`"${val5}" is not one of the cases of descriptor-type`);
            }
          }
          dataView(memory0).setInt8(arg1 + 8, enum5, true);
          
          var encodeRes = _utf8AllocateAndEncode(v4_1, realloc0, memory0);
          var ptr6= encodeRes.ptr;
          var len6 = encodeRes.len;
          
          dataView(memory0).setUint32(arg1 + 16, len6, true);
          dataView(memory0).setUint32(arg1 + 12, ptr6, true);
        }
        
        break;
      }
      case 'err': {
        const e = variant9.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val8 = e;
        let enum8;
        switch (val8) {
          case 'access': {
            enum8 = 0;
            break;
          }
          case 'would-block': {
            enum8 = 1;
            break;
          }
          case 'already': {
            enum8 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum8 = 3;
            break;
          }
          case 'busy': {
            enum8 = 4;
            break;
          }
          case 'deadlock': {
            enum8 = 5;
            break;
          }
          case 'quota': {
            enum8 = 6;
            break;
          }
          case 'exist': {
            enum8 = 7;
            break;
          }
          case 'file-too-large': {
            enum8 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum8 = 9;
            break;
          }
          case 'in-progress': {
            enum8 = 10;
            break;
          }
          case 'interrupted': {
            enum8 = 11;
            break;
          }
          case 'invalid': {
            enum8 = 12;
            break;
          }
          case 'io': {
            enum8 = 13;
            break;
          }
          case 'is-directory': {
            enum8 = 14;
            break;
          }
          case 'loop': {
            enum8 = 15;
            break;
          }
          case 'too-many-links': {
            enum8 = 16;
            break;
          }
          case 'message-size': {
            enum8 = 17;
            break;
          }
          case 'name-too-long': {
            enum8 = 18;
            break;
          }
          case 'no-device': {
            enum8 = 19;
            break;
          }
          case 'no-entry': {
            enum8 = 20;
            break;
          }
          case 'no-lock': {
            enum8 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum8 = 22;
            break;
          }
          case 'insufficient-space': {
            enum8 = 23;
            break;
          }
          case 'not-directory': {
            enum8 = 24;
            break;
          }
          case 'not-empty': {
            enum8 = 25;
            break;
          }
          case 'not-recoverable': {
            enum8 = 26;
            break;
          }
          case 'unsupported': {
            enum8 = 27;
            break;
          }
          case 'no-tty': {
            enum8 = 28;
            break;
          }
          case 'no-such-device': {
            enum8 = 29;
            break;
          }
          case 'overflow': {
            enum8 = 30;
            break;
          }
          case 'not-permitted': {
            enum8 = 31;
            break;
          }
          case 'pipe': {
            enum8 = 32;
            break;
          }
          case 'read-only': {
            enum8 = 33;
            break;
          }
          case 'invalid-seek': {
            enum8 = 34;
            break;
          }
          case 'text-file-busy': {
            enum8 = 35;
            break;
          }
          case 'cross-device': {
            enum8 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val8}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 4, enum8, true);
        
        break;
      }
      default: {
        _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant9, valueType: typeof variant9});
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.12", function="[method]directory-entry-stream.read-directory-entry"][Instruction::Return]', {
      funcName: '[method]directory-entry-stream.read-directory-entry',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline74.fnName = 'wasi:filesystem/types@0.2.12#readDirectoryEntry';
  
  const _trampoline75 = function(arg0) {
    _debugLog('[iface="wasi:cli/environment@0.2.12", function="get-environment"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getEnvironment',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getEnvironment(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 16);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 16;var [tuple0_0, tuple0_1] = e;
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_0, realloc0, memory0);
      var ptr1= encodeRes.ptr;
      var len1 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 4, len1, true);
      dataView(memory0).setUint32(base + 0, ptr1, true);
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
      var ptr2= encodeRes.ptr;
      var len2 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 12, len2, true);
      dataView(memory0).setUint32(base + 8, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:cli/environment@0.2.12", function="get-environment"][Instruction::Return]', {
      funcName: 'get-environment',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline75.fnName = 'wasi:cli/environment@0.2.12#getEnvironment';
  
  const handleTable12 = [T_FLAG, 0];
  handleTable12._createdReps = new Set();
  
  
  const captureTable12= new Map();
  let captureCnt12= 0;
  
  HANDLE_TABLES[12] = handleTable12;
  
  const _trampoline76 = function(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stdin@0.2.12", function="get-terminal-stdin"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getTerminalStdin',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getTerminalStdin(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      
      if (!(e instanceof TerminalInput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalInput\" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt12;
        captureTable12.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable12, rep);
      }
      
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stdin@0.2.12", function="get-terminal-stdin"][Instruction::Return]', {
      funcName: 'get-terminal-stdin',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline76.fnName = 'wasi:cli/terminal-stdin@0.2.12#getTerminalStdin';
  
  const handleTable13 = [T_FLAG, 0];
  handleTable13._createdReps = new Set();
  
  
  const captureTable13= new Map();
  let captureCnt13= 0;
  
  HANDLE_TABLES[13] = handleTable13;
  
  const _trampoline77 = function(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stdout@0.2.12", function="get-terminal-stdout"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getTerminalStdout',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getTerminalStdout(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      
      if (!(e instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt13;
        captureTable13.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable13, rep);
      }
      
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stdout@0.2.12", function="get-terminal-stdout"][Instruction::Return]', {
      funcName: 'get-terminal-stdout',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline77.fnName = 'wasi:cli/terminal-stdout@0.2.12#getTerminalStdout';
  
  const _trampoline78 = function(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stderr@0.2.12", function="get-terminal-stderr"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getTerminalStderr',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getTerminalStderr(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      
      if (!(e instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt13;
        captureTable13.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable13, rep);
      }
      
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stderr@0.2.12", function="get-terminal-stderr"][Instruction::Return]', {
      funcName: 'get-terminal-stderr',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline78.fnName = 'wasi:cli/terminal-stderr@0.2.12#getTerminalStderr';
  
  const _trampoline79 = function(arg0) {
    _debugLog('[iface="wasi:clocks/wall-clock@0.2.12", function="now"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'now$1',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => now$1(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var {seconds: v0_0, nanoseconds: v0_1 } = ret;
    dataView(memory0).setBigInt64(arg0 + 0, toUint64(v0_0), true);
    dataView(memory0).setInt32(arg0 + 8, toUint32(v0_1), true);
    _debugLog('[iface="wasi:clocks/wall-clock@0.2.12", function="now"][Instruction::Return]', {
      funcName: 'now',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline79.fnName = 'wasi:clocks/wall-clock@0.2.12#now$1';
  
  const _trampoline80 = function(arg0) {
    _debugLog('[iface="wasi:filesystem/preopens@0.2.12", function="get-directories"] [Instruction::CallInterface] (sync, @ enter)');
    const hostProvided = true;
    
    let parentTask;
    let task;
    let subtask;
    
    const createTask = () => {
      const results = createNewCurrentTask({
        componentIdx: -1,
        isAsync: false,
        entryFnName: 'getDirectories',
        getCallbackFn: () => null,
        callbackFnName: null,
        errHandling: 'none',
        callingWasmExport: false,
      });
      task = results[0];
    };
    
    taskCreation: {
      parentTask = getCurrentTask(
      0,
      _getGlobalCurrentTaskMeta(0)?.taskID,
      )?.task;
      
      if (!parentTask) {
        createTask();
        break taskCreation;
      }
      
      createTask();
      
      if (hostProvided) {
        subtask = parentTask.getLatestSubtask();
        if (!subtask) {
          throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
        }
        task.setParentSubtask(subtask);
      }
    }
    
    const started = task.enterSync();
    
    let ret;
    
    try {
      ret = _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => getDirectories(),
      })
      ;
    } catch (err) {
      
      _debugLog('[Instruction::CallInterface] error during sync call', {
        taskID: task.id(),
        subtaskID: task.getParentSubtask()?.id(),
        err,
      });
      getOrCreateAsyncState(0).markTrapped(err);
      task.setErrored(err);
      task.reject(err);
      task.exit();
      throw err;
      
    }
    
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 12);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 12;var [tuple0_0, tuple0_1] = e;
      
      if (!(tuple0_0 instanceof Descriptor)) {
        throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
      }
      var handle1 = tuple0_0[symbolRscHandle];
      if (!handle1) {
        const rep = tuple0_0[symbolRscRep] || ++captureCnt14;
        captureTable14.set(rep, tuple0_0);
        handle1 = rscTableCreateOwn(handleTable14, rep);
      }
      
      dataView(memory0).setInt32(base + 0, handle1, true);
      
      var encodeRes = _utf8AllocateAndEncode(tuple0_1, realloc0, memory0);
      var ptr2= encodeRes.ptr;
      var len2 = encodeRes.len;
      
      dataView(memory0).setUint32(base + 8, len2, true);
      dataView(memory0).setUint32(base + 4, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:filesystem/preopens@0.2.12", function="get-directories"][Instruction::Return]', {
      funcName: 'get-directories',
      paramCount: 0,
      async: false,
      postReturn: false
    });
    task.resolve([ret]);
    task.exit();
  }
  _trampoline80.fnName = 'wasi:filesystem/preopens@0.2.12#getDirectories';
  let exports2;
  let run0212Run;
  
  async function run() {
    
    const hostProvided = false;
    getOrCreateAsyncState(0).throwIfTrapped();
    
    const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
      componentIdx: 0,
      isAsync: false,
      isManualAsync: true,
      preserveFutureResult: false,
      entryFnName: 'run0212Run',
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: 'throw-result-err',
      callingWasmExport: true,
    });
    
    
    const started = await task.enter();
    if (!started) {
      _debugLog('[Instruction::AsyncTaskReturn] failed to enter task', {
        taskID: task.id(),
        subtaskID: task.currentSubtask()?.id(),
      });
      throw new Error("failed to enter task");
    }
    
    
    if (null!== null) {
      task.setReturnMemoryIdx(null);
      task.setReturnMemory(() => null());
    }
    
    
    return await _withGlobalCurrentTaskMetaAsync({
      taskID: task.id(),
      componentIdx: task.componentIdx(),
      fn: async () => {
        try {
          
          _debugLog('[iface="wasi:cli/run@0.2.12", function="run"][Instruction::CallWasm] enter', {
            funcName: 'run',
            paramCount: 0,
            async: false,
            postReturn: false,
          });
          
          let ret;
          
          try {
            ret =  await run0212Run();
          } catch (err) {
            
            _debugLog('[Instruction::CallWasm] error during async call', {
              taskID: task.id(),
              err,
            });
            getOrCreateAsyncState(0).markTrapped(err);
            task.setErrored(err);
            task.reject(err);
            task.exit();
            return task.completionPromise();
            
          }
          
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
          _debugLog('[iface="wasi:cli/run@0.2.12", function="run"][Instruction::Return]', {
            funcName: 'run',
            paramCount: 1,
            async: false,
            postReturn: false
          });
          const retCopy = variant0;
          task.resolve([retCopy.val]);
          task.exit();
          
          if (typeof retCopy === 'object' && retCopy.tag === 'err') {
            throw new ComponentError(retCopy.val);
          }
          return retCopy.val;
          
          
        } catch (err) {
          if (!task.isResolvedState()) {
            task.setErrored(err);
            task.reject(err);
          }
          if (!task.isExited()) { task.exit({ skipExclusiveLockCheck: true }); }
          throw err;
        }
      },
    });
    
  }
  function trampoline0(handle) {
    const handleEntry = rscTableRemove(handleTable2, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable2.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable2.delete(handleEntry.rep);
      } else if (OutputStream[symbolCabiDispose]) {
        OutputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline1(handle) {
    const handleEntry = rscTableRemove(handleTable1, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable1.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable1.delete(handleEntry.rep);
      } else if (Error$1[symbolCabiDispose]) {
        Error$1[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline2 = _trampoline2.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 2,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline2.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => IncomingBody,
      createResourceFn: 
      (handle) => {
        const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable5.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(IncomingBody.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable5.delete(rep);
        }
        rscTableRemove(handleTable5, handle);
        return resourceObj;
      }
      ,
    })
    ],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_FutureTrailers(obj) {
        if (!(obj instanceof FutureTrailers)) {
          throw new TypeError('Resource error: Not a valid \"FutureTrailers\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt6;
          captureTable6.set(rep, obj);
          handle = rscTableCreateOwn(handleTable6, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline2,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 2,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline2.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => IncomingBody,
      createResourceFn: 
      (handle) => {
        const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable5.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(IncomingBody.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable5.delete(rep);
        }
        rscTableRemove(handleTable5, handle);
        return resourceObj;
      }
      ,
    })
    ],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_FutureTrailers(obj) {
        if (!(obj instanceof FutureTrailers)) {
          throw new TypeError('Resource error: Not a valid \"FutureTrailers\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt6;
          captureTable6.set(rep, obj);
          handle = rscTableCreateOwn(handleTable6, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline2,
  },
  );
  function trampoline3(handle) {
    const handleEntry = rscTableRemove(handleTable5, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable5.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable5.delete(handleEntry.rep);
      } else if (IncomingBody[symbolCabiDispose]) {
        IncomingBody[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline4 = _trampoline4.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 4,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline4.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline4,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 4,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline4.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline4,
  },
  );
  function trampoline5(handle) {
    const handleEntry = rscTableRemove(handleTable7, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable7.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable7.delete(handleEntry.rep);
      } else if (Fields[symbolCabiDispose]) {
        Fields[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline6(handle) {
    const handleEntry = rscTableRemove(handleTable4, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable4.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable4.delete(handleEntry.rep);
      } else if (OutgoingBody[symbolCabiDispose]) {
        OutgoingBody[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline7(handle) {
    const handleEntry = rscTableRemove(handleTable6, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable6.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable6.delete(handleEntry.rep);
      } else if (FutureTrailers[symbolCabiDispose]) {
        FutureTrailers[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline8 = _trampoline8.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 8,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline8.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline8,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 8,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline8.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline8,
  },
  );
  function trampoline9(handle) {
    const handleEntry = rscTableRemove(handleTable8, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable8.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable8.delete(handleEntry.rep);
      } else if (FutureIncomingResponse[symbolCabiDispose]) {
        FutureIncomingResponse[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline10 = _trampoline10.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 10,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline10.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Fields(obj) {
        if (!(obj instanceof Fields)) {
          throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt7;
          captureTable7.set(rep, obj);
          handle = rscTableCreateOwn(handleTable7, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline10,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 10,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline10.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Fields(obj) {
        if (!(obj instanceof Fields)) {
          throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt7;
          captureTable7.set(rep, obj);
          handle = rscTableCreateOwn(handleTable7, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline10,
  },
  );
  let trampoline11 = _trampoline11.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 11,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline11.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [_lowerFlatU16],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline11,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 11,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline11.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [_lowerFlatU16],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline11,
  },
  );
  function trampoline12(handle) {
    const handleEntry = rscTableRemove(handleTable9, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable9.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable9.delete(handleEntry.rep);
      } else if (IncomingResponse[symbolCabiDispose]) {
        IncomingResponse[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline13(handle) {
    const handleEntry = rscTableRemove(handleTable3, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable3.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable3.delete(handleEntry.rep);
      } else if (InputStream[symbolCabiDispose]) {
        InputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline14 = _trampoline14.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 14,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline14.manuallyAsync,
    paramLiftFns: [_liftFlatU64],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline14,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 14,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline14.manuallyAsync,
    paramLiftFns: [_liftFlatU64],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline14,
  },
  );
  let trampoline15 = _trampoline15.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 15,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline15.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatU64],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline15,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 15,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline15.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatU64],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline15,
  },
  );
  let trampoline16 = _trampoline16.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 16,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline16.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => Fields,
      createResourceFn: 
      (handle) => {
        const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable7.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(Fields.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable7.delete(rep);
        }
        rscTableRemove(handleTable7, handle);
        return resourceObj;
      }
      ,
    })
    ],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutgoingRequest(obj) {
        if (!(obj instanceof OutgoingRequest)) {
          throw new TypeError('Resource error: Not a valid \"OutgoingRequest\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt10;
          captureTable10.set(rep, obj);
          handle = rscTableCreateOwn(handleTable10, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline16,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 16,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline16.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => Fields,
      createResourceFn: 
      (handle) => {
        const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable7.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(Fields.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable7.delete(rep);
        }
        rscTableRemove(handleTable7, handle);
        return resourceObj;
      }
      ,
    })
    ],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutgoingRequest(obj) {
        if (!(obj instanceof OutgoingRequest)) {
          throw new TypeError('Resource error: Not a valid \"OutgoingRequest\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt10;
          captureTable10.set(rep, obj);
          handle = rscTableCreateOwn(handleTable10, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline16,
  },
  );
  function trampoline17(handle) {
    const handleEntry = rscTableRemove(handleTable10, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable10.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable10.delete(handleEntry.rep);
      } else if (OutgoingRequest[symbolCabiDispose]) {
        OutgoingRequest[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline18 = _trampoline18.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 18,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline18.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_RequestOptions(obj) {
        if (!(obj instanceof RequestOptions)) {
          throw new TypeError('Resource error: Not a valid \"RequestOptions\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt11;
          captureTable11.set(rep, obj);
          handle = rscTableCreateOwn(handleTable11, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline18,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 18,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline18.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_RequestOptions(obj) {
        if (!(obj instanceof RequestOptions)) {
          throw new TypeError('Resource error: Not a valid \"RequestOptions\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt11;
          captureTable11.set(rep, obj);
          handle = rscTableCreateOwn(handleTable11, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline18,
  },
  );
  let trampoline19 = _trampoline19.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 19,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline19.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline19,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 19,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline19.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline19,
  },
  );
  let trampoline20 = _trampoline20.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 20,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline20.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline20,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 20,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline20.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline20,
  },
  );
  let trampoline21 = _trampoline21.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 21,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline21.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline21,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 21,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline21.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 11),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatU64, 8, 8, 1, ['i64'] ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i64'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline21,
  },
  );
  function trampoline22(handle) {
    const handleEntry = rscTableRemove(handleTable11, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable11.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable11.delete(handleEntry.rep);
      } else if (RequestOptions[symbolCabiDispose]) {
        RequestOptions[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline23 = _trampoline23.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 23,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline23.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline23,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 23,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline23.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline23,
  },
  );
  let trampoline24 = _trampoline24.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 24,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline24.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline24,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 24,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline24.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3)],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Pollable(obj) {
        if (!(obj instanceof Pollable)) {
          throw new TypeError('Resource error: Not a valid \"Pollable\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt0;
          captureTable0.set(rep, obj);
          handle = rscTableCreateOwn(handleTable0, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline24,
  },
  );
  function trampoline25(handle) {
    const handleEntry = rscTableRemove(handleTable0, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable0.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable0.delete(handleEntry.rep);
      } else if (Pollable[symbolCabiDispose]) {
        Pollable[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline26 = _trampoline26.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 26,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline26.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [_lowerFlatBool],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline26,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 26,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline26.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [_lowerFlatBool],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline26,
  },
  );
  let trampoline27 = _trampoline27.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 27,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline27.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Fields(obj) {
        if (!(obj instanceof Fields)) {
          throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt7;
          captureTable7.set(rep, obj);
          handle = rscTableCreateOwn(handleTable7, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline27,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 27,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline27.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_Fields(obj) {
        if (!(obj instanceof Fields)) {
          throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt7;
          captureTable7.set(rep, obj);
          handle = rscTableCreateOwn(handleTable7, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline27,
  },
  );
  function trampoline28(handle) {
    const handleEntry = rscTableRemove(handleTable12, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable12.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable12.delete(handleEntry.rep);
      } else if (TerminalInput[symbolCabiDispose]) {
        TerminalInput[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline29(handle) {
    const handleEntry = rscTableRemove(handleTable13, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable13.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable13.delete(handleEntry.rep);
      } else if (TerminalOutput[symbolCabiDispose]) {
        TerminalOutput[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline30(handle) {
    const handleEntry = rscTableRemove(handleTable14, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable14.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable14.delete(handleEntry.rep);
      } else if (Descriptor[symbolCabiDispose]) {
        Descriptor[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline31(handle) {
    const handleEntry = rscTableRemove(handleTable15, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable15.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable15.delete(handleEntry.rep);
      } else if (DirectoryEntryStream[symbolCabiDispose]) {
        DirectoryEntryStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  let trampoline32 = _trampoline32.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 32,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline32.manuallyAsync,
    paramLiftFns: [
    _liftFlatResult({
      caseMetas: [['ok', null, 0, 0, 0, []],['err', null, 0, 0, 0, []],],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
      variantPayloadFlatTypes: [],
    })
    ],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline32,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 32,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline32.manuallyAsync,
    paramLiftFns: [
    _liftFlatResult({
      caseMetas: [['ok', null, 0, 0, 0, []],['err', null, 0, 0, 0, []],],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
      variantPayloadFlatTypes: [],
    })
    ],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline32,
  },
  );
  let trampoline33 = _trampoline33.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 33,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline33.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline33,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 33,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline33.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 0)],
    resultLowerFns: [],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline33,
  },
  );
  let trampoline34 = _trampoline34.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 34,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline34.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_InputStream(obj) {
        if (!(obj instanceof InputStream)) {
          throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, obj);
          handle = rscTableCreateOwn(handleTable3, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline34,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 34,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline34.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_InputStream(obj) {
        if (!(obj instanceof InputStream)) {
          throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, obj);
          handle = rscTableCreateOwn(handleTable3, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline34,
  },
  );
  let trampoline35 = _trampoline35.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 35,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline35.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutputStream(obj) {
        if (!(obj instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, obj);
          handle = rscTableCreateOwn(handleTable2, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline35,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 35,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline35.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutputStream(obj) {
        if (!(obj instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, obj);
          handle = rscTableCreateOwn(handleTable2, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline35,
  },
  );
  let trampoline36 = _trampoline36.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 36,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline36.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutputStream(obj) {
        if (!(obj instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, obj);
          handle = rscTableCreateOwn(handleTable2, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline36,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 36,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline36.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatOwn({
      componentIdx: 0,
      lowerFn: 
      function lowerImportedOwnedHost_OutputStream(obj) {
        if (!(obj instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
        }
        let handle = obj[symbolRscHandle];
        if (!handle) {
          const rep = obj[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, obj);
          handle = rscTableCreateOwn(handleTable2, rep);
        }
        return handle;
      }
      ,
    })],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: null,
    stringEncoding: 'utf8',
    getMemoryFn: () => null,
    getReallocFn: undefined,
    importFn: _trampoline36,
  },
  );
  let trampoline37 = _trampoline37.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 37,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline37.manuallyAsync,
    paramLiftFns: [
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatStringAny, 8, 4, 2],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline37,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 37,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline37.manuallyAsync,
    paramLiftFns: [
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatStringAny, 8, 4, 2],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline37,
  },
  );
  let trampoline38 = _trampoline38.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 38,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline38.manuallyAsync,
    paramLiftFns: [
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['accessKeyId', _lowerFlatStringAny, 8, 4 ],['secretAccessKey', _lowerFlatStringAny, 8, 4 ],['sessionToken', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatStringAny, 8, 4, 2],
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
      })
      , 12, 4 ],['expiresAfter', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatU64, 8, 8, 1],
        ],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 2,
      })
      , 16, 8 ],['accountId', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatStringAny, 8, 4, 2],
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
      })
      , 12, 4 ],], size32: 64, align32: 8 }), 72, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'credentials-not-loaded', null, 0, 0, 0 ],[ 'provider-timed-out', _lowerFlatRecord({ fieldMetas: [['duration', _lowerFlatU64, 8, 8 ],], size32: 8, align32: 8 }), 8, 8, 1 ],[ 'invalid-configuration', null, 0, 0, 0 ],[ 'provider-error', null, 0, 0, 0 ],[ 'unhandled', null, 0, 0, 0 ],],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 2,
      } ), 72, 8, 8 ],
      ],
      variantSize32: 72,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline38,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 38,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline38.manuallyAsync,
    paramLiftFns: [
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['accessKeyId', _lowerFlatStringAny, 8, 4 ],['secretAccessKey', _lowerFlatStringAny, 8, 4 ],['sessionToken', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatStringAny, 8, 4, 2],
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
      })
      , 12, 4 ],['expiresAfter', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatU64, 8, 8, 1],
        ],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 2,
      })
      , 16, 8 ],['accountId', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatStringAny, 8, 4, 2],
        ],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
      })
      , 12, 4 ],], size32: 64, align32: 8 }), 72, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'credentials-not-loaded', null, 0, 0, 0 ],[ 'provider-timed-out', _lowerFlatRecord({ fieldMetas: [['duration', _lowerFlatU64, 8, 8 ],], size32: 8, align32: 8 }), 8, 8, 1 ],[ 'invalid-configuration', null, 0, 0, 0 ],[ 'provider-error', null, 0, 0, 0 ],[ 'unhandled', null, 0, 0, 0 ],],
        variantSize32: 16,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 2,
      } ), 72, 8, 8 ],
      ],
      variantSize32: 72,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline38,
  },
  );
  let trampoline39 = _trampoline39.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 39,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline39.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatStringAny,
      elemSize32: 8,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline39,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 39,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline39.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatStringAny,
      elemSize32: 8,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline39,
  },
  );
  let trampoline40 = _trampoline40.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 40,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline40.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatTuple({ elemLowerMetas: [[_lowerFlatU64, 8, 8],[_lowerFlatU64, 8, 8],], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline40,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 40,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline40.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatTuple({ elemLowerMetas: [[_lowerFlatU64, 8, 8],[_lowerFlatU64, 8, 8],], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline40,
  },
  );
  let trampoline41 = _trampoline41.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 41,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline41.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline41,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 41,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline41.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline41,
  },
  );
  let trampoline42 = _trampoline42.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 42,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline42.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 5)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_InputStream(obj) {
          if (!(obj instanceof InputStream)) {
            throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep, obj);
            handle = rscTableCreateOwn(handleTable3, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline42,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 42,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline42.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 5)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_InputStream(obj) {
          if (!(obj instanceof InputStream)) {
            throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep, obj);
            handle = rscTableCreateOwn(handleTable3, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline42,
  },
  );
  let trampoline43 = _trampoline43.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 43,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline43.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', 
      _lowerFlatResult({
        caseMetas: [
        [ 'ok', 
        _lowerFlatResult({
          caseMetas: [
          [ 'ok', _lowerFlatOwn({
            componentIdx: 0,
            lowerFn: 
            function lowerImportedOwnedHost_IncomingResponse(obj) {
              if (!(obj instanceof IncomingResponse)) {
                throw new TypeError('Resource error: Not a valid \"IncomingResponse\" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep = obj[symbolRscRep] || ++captureCnt9;
                captureTable9.set(rep, obj);
                handle = rscTableCreateOwn(handleTable9, rep);
              }
              return handle;
            }
            ,
          }), 40, 8, 8 ],
          [ 'err', _lowerFlatVariant({
            caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['infoCode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU16, 2, 2, 1],
              ],
              variantSize32: 4,
              variantAlign32: 2,
              variantPayloadOffset32: 2,
              variantFlatCount: 2,
            })
            , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU8, 1, 1, 1],
              ],
              variantSize32: 2,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 2,
            })
            , 2, 1 ],['alertMessage', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-header-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatStringAny, 8, 4, 2],
                ],
                variantSize32: 12,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 3,
              })
              , 12, 4 ],['fieldSize', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatU32, 4, 4, 1],
                ],
                variantSize32: 8,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 2,
              })
              , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
              ],
              variantSize32: 24,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 6,
            })
            , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],],
            variantSize32: 32,
            variantAlign32: 8,
            variantPayloadOffset32: 8,
            variantFlatCount: 7,
          } ), 40, 8, 8 ],
          ],
          variantSize32: 40,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 8,
        })
        , 48, 8, 8 ],
        [ 'err', null, 48, 8, 8 ],
        ],
        variantSize32: 48,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 9,
      })
      , 48, 8, 9],
      ],
      variantSize32: 56,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 10,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline43,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 43,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline43.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', 
      _lowerFlatResult({
        caseMetas: [
        [ 'ok', 
        _lowerFlatResult({
          caseMetas: [
          [ 'ok', _lowerFlatOwn({
            componentIdx: 0,
            lowerFn: 
            function lowerImportedOwnedHost_IncomingResponse(obj) {
              if (!(obj instanceof IncomingResponse)) {
                throw new TypeError('Resource error: Not a valid \"IncomingResponse\" resource.');
              }
              let handle = obj[symbolRscHandle];
              if (!handle) {
                const rep = obj[symbolRscRep] || ++captureCnt9;
                captureTable9.set(rep, obj);
                handle = rscTableCreateOwn(handleTable9, rep);
              }
              return handle;
            }
            ,
          }), 40, 8, 8 ],
          [ 'err', _lowerFlatVariant({
            caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['infoCode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU16, 2, 2, 1],
              ],
              variantSize32: 4,
              variantAlign32: 2,
              variantPayloadOffset32: 2,
              variantFlatCount: 2,
            })
            , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU8, 1, 1, 1],
              ],
              variantSize32: 2,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 2,
            })
            , 2, 1 ],['alertMessage', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-header-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatStringAny, 8, 4, 2],
                ],
                variantSize32: 12,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 3,
              })
              , 12, 4 ],['fieldSize', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatU32, 4, 4, 1],
                ],
                variantSize32: 8,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 2,
              })
              , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
              ],
              variantSize32: 24,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 6,
            })
            , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],],
            variantSize32: 32,
            variantAlign32: 8,
            variantPayloadOffset32: 8,
            variantFlatCount: 7,
          } ), 40, 8, 8 ],
          ],
          variantSize32: 40,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 8,
        })
        , 48, 8, 8 ],
        [ 'err', null, 48, 8, 8 ],
        ],
        variantSize32: 48,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 9,
      })
      , 48, 8, 9],
      ],
      variantSize32: 56,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 10,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline43,
  },
  );
  let trampoline44 = _trampoline44.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 44,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline44.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_IncomingBody(obj) {
          if (!(obj instanceof IncomingBody)) {
            throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt5;
            captureTable5.set(rep, obj);
            handle = rscTableCreateOwn(handleTable5, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline44,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 44,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline44.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_IncomingBody(obj) {
          if (!(obj instanceof IncomingBody)) {
            throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt5;
            captureTable5.set(rep, obj);
            handle = rscTableCreateOwn(handleTable5, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline44,
  },
  );
  let trampoline45 = _trampoline45.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 45,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline45.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),_liftFlatVariant({
      caseMetas: [['get', null, 0, 0, 0, []],['head', null, 0, 0, 0, []],['post', null, 0, 0, 0, []],['put', null, 0, 0, 0, []],['delete', null, 0, 0, 0, []],['connect', null, 0, 0, 0, []],['options', null, 0, 0, 0, []],['trace', null, 0, 0, 0, []],['patch', null, 0, 0, 0, []],['other', _liftFlatStringAny, 8, 4, 2, ['i32','i32']],],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    } )],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline45,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 45,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline45.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),_liftFlatVariant({
      caseMetas: [['get', null, 0, 0, 0, []],['head', null, 0, 0, 0, []],['post', null, 0, 0, 0, []],['put', null, 0, 0, 0, []],['delete', null, 0, 0, 0, []],['connect', null, 0, 0, 0, []],['options', null, 0, 0, 0, []],['trace', null, 0, 0, 0, []],['patch', null, 0, 0, 0, []],['other', _liftFlatStringAny, 8, 4, 2, ['i32','i32']],],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    } )],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline45,
  },
  );
  let trampoline46 = _trampoline46.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 46,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline46.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatVariant({
        caseMetas: [['HTTP', null, 0, 0, 0, []],['HTTPS', null, 0, 0, 0, []],['other', _liftFlatStringAny, 8, 4, 2, ['i32','i32']],],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
        variantPayloadFlatTypes: ['i32','i32'],
      } ), 12, 4, 3, ['i32','i32','i32'] ],
      ],
      variantSize32: 16,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 4,
      variantPayloadFlatTypes: ['i32','i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline46,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 46,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline46.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatVariant({
        caseMetas: [['HTTP', null, 0, 0, 0, []],['HTTPS', null, 0, 0, 0, []],['other', _liftFlatStringAny, 8, 4, 2, ['i32','i32']],],
        variantSize32: 12,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 3,
        variantPayloadFlatTypes: ['i32','i32'],
      } ), 12, 4, 3, ['i32','i32','i32'] ],
      ],
      variantSize32: 16,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 4,
      variantPayloadFlatTypes: ['i32','i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline46,
  },
  );
  let trampoline47 = _trampoline47.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 47,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline47.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline47,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 47,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline47.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline47,
  },
  );
  let trampoline48 = _trampoline48.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 48,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline48.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline48,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 48,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline48.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10),
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatStringAny, 8, 4, 2, ['i32','i32'] ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
      variantPayloadFlatTypes: ['i32','i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 1, 1, 1 ],
      [ 'err', null, 1, 1, 1 ],
      ],
      variantSize32: 1,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 1,
    })
    ],
    hasResultPointer: false,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline48,
  },
  );
  let trampoline49 = _trampoline49.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 49,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline49.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutgoingBody(obj) {
          if (!(obj instanceof OutgoingBody)) {
            throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt4;
            captureTable4.set(rep, obj);
            handle = rscTableCreateOwn(handleTable4, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline49,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 49,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline49.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 10)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutgoingBody(obj) {
          if (!(obj instanceof OutgoingBody)) {
            throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt4;
            captureTable4.set(rep, obj);
            handle = rscTableCreateOwn(handleTable4, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', null, 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline49,
  },
  );
  let trampoline50 = _trampoline50.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 50,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline50.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', 
      _lowerFlatResult({
        caseMetas: [
        [ 'ok', 
        _lowerFlatResult({
          caseMetas: [
          [ 'ok', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatOwn({
              componentIdx: 0,
              lowerFn: 
              function lowerImportedOwnedHost_Fields(obj) {
                if (!(obj instanceof Fields)) {
                  throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep = obj[symbolRscRep] || ++captureCnt7;
                  captureTable7.set(rep, obj);
                  handle = rscTableCreateOwn(handleTable7, rep);
                }
                return handle;
              }
              ,
            }), 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 40, 8, 8 ],
          [ 'err', _lowerFlatVariant({
            caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['infoCode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU16, 2, 2, 1],
              ],
              variantSize32: 4,
              variantAlign32: 2,
              variantPayloadOffset32: 2,
              variantFlatCount: 2,
            })
            , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU8, 1, 1, 1],
              ],
              variantSize32: 2,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 2,
            })
            , 2, 1 ],['alertMessage', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-header-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatStringAny, 8, 4, 2],
                ],
                variantSize32: 12,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 3,
              })
              , 12, 4 ],['fieldSize', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatU32, 4, 4, 1],
                ],
                variantSize32: 8,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 2,
              })
              , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
              ],
              variantSize32: 24,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 6,
            })
            , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],],
            variantSize32: 32,
            variantAlign32: 8,
            variantPayloadOffset32: 8,
            variantFlatCount: 7,
          } ), 40, 8, 8 ],
          ],
          variantSize32: 40,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 8,
        })
        , 48, 8, 8 ],
        [ 'err', null, 48, 8, 8 ],
        ],
        variantSize32: 48,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 9,
      })
      , 48, 8, 9],
      ],
      variantSize32: 56,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 10,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline50,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 50,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline50.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', 
      _lowerFlatResult({
        caseMetas: [
        [ 'ok', 
        _lowerFlatResult({
          caseMetas: [
          [ 'ok', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatOwn({
              componentIdx: 0,
              lowerFn: 
              function lowerImportedOwnedHost_Fields(obj) {
                if (!(obj instanceof Fields)) {
                  throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
                }
                let handle = obj[symbolRscHandle];
                if (!handle) {
                  const rep = obj[symbolRscRep] || ++captureCnt7;
                  captureTable7.set(rep, obj);
                  handle = rscTableCreateOwn(handleTable7, rep);
                }
                return handle;
              }
              ,
            }), 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 40, 8, 8 ],
          [ 'err', _lowerFlatVariant({
            caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['infoCode', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU16, 2, 2, 1],
              ],
              variantSize32: 4,
              variantAlign32: 2,
              variantPayloadOffset32: 2,
              variantFlatCount: 2,
            })
            , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU8, 1, 1, 1],
              ],
              variantSize32: 2,
              variantAlign32: 1,
              variantPayloadOffset32: 1,
              variantFlatCount: 2,
            })
            , 2, 1 ],['alertMessage', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-header-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatStringAny, 8, 4, 2],
                ],
                variantSize32: 12,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 3,
              })
              , 12, 4 ],['fieldSize', 
              _lowerFlatOption({
                caseMetas: [
                [ 'none', null, 0, 0, 0 ],
                [ 'some', _lowerFlatU32, 4, 4, 1],
                ],
                variantSize32: 8,
                variantAlign32: 4,
                variantPayloadOffset32: 4,
                variantFlatCount: 2,
              })
              , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
              ],
              variantSize32: 24,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 6,
            })
            , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU64, 8, 8, 1],
              ],
              variantSize32: 16,
              variantAlign32: 8,
              variantPayloadOffset32: 8,
              variantFlatCount: 2,
            })
            , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4 ],['fieldSize', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatU32, 4, 4, 1],
              ],
              variantSize32: 8,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 2,
            })
            , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
            _lowerFlatOption({
              caseMetas: [
              [ 'none', null, 0, 0, 0 ],
              [ 'some', _lowerFlatStringAny, 8, 4, 2],
              ],
              variantSize32: 12,
              variantAlign32: 4,
              variantPayloadOffset32: 4,
              variantFlatCount: 3,
            })
            , 12, 4, 3 ],],
            variantSize32: 32,
            variantAlign32: 8,
            variantPayloadOffset32: 8,
            variantFlatCount: 7,
          } ), 40, 8, 8 ],
          ],
          variantSize32: 40,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 8,
        })
        , 48, 8, 8 ],
        [ 'err', null, 48, 8, 8 ],
        ],
        variantSize32: 48,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 9,
      })
      , 48, 8, 9],
      ],
      variantSize32: 56,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 10,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline50,
  },
  );
  let trampoline51 = _trampoline51.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 51,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline51.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => OutgoingBody,
      createResourceFn: 
      (handle) => {
        const rep = handleTable4[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable4.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(OutgoingBody.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable4.delete(rep);
        }
        rscTableRemove(handleTable4, handle);
        return resourceObj;
      }
      ,
    })
    ,
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatOwn({
        componentIdx: 0,
        classNameFn: () => Fields,
        createResourceFn: 
        (handle) => {
          const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
          let resourceObj = captureTable7.get(rep);
          if (!resourceObj) {
            resourceObj = Object.create(Fields.prototype);
            Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
            Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
          } else {
            captureTable7.delete(rep);
          }
          rscTableRemove(handleTable7, handle);
          return resourceObj;
        }
        ,
      })
      , 4, 4, 1, ['i32'] ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 40, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['infoCode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU16, 2, 2, 1],
          ],
          variantSize32: 4,
          variantAlign32: 2,
          variantPayloadOffset32: 2,
          variantFlatCount: 2,
        })
        , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU8, 1, 1, 1],
          ],
          variantSize32: 2,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 2,
        })
        , 2, 1 ],['alertMessage', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-header-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatStringAny, 8, 4, 2],
            ],
            variantSize32: 12,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 3,
          })
          , 12, 4 ],['fieldSize', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatU32, 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
          ],
          variantSize32: 24,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 6,
        })
        , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],],
        variantSize32: 32,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 7,
      } ), 40, 8, 8 ],
      ],
      variantSize32: 40,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 8,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline51,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 51,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline51.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => OutgoingBody,
      createResourceFn: 
      (handle) => {
        const rep = handleTable4[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable4.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(OutgoingBody.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable4.delete(rep);
        }
        rscTableRemove(handleTable4, handle);
        return resourceObj;
      }
      ,
    })
    ,
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatOwn({
        componentIdx: 0,
        classNameFn: () => Fields,
        createResourceFn: 
        (handle) => {
          const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
          let resourceObj = captureTable7.get(rep);
          if (!resourceObj) {
            resourceObj = Object.create(Fields.prototype);
            Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
            Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
          } else {
            captureTable7.delete(rep);
          }
          rscTableRemove(handleTable7, handle);
          return resourceObj;
        }
        ,
      })
      , 4, 4, 1, ['i32'] ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 40, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['infoCode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU16, 2, 2, 1],
          ],
          variantSize32: 4,
          variantAlign32: 2,
          variantPayloadOffset32: 2,
          variantFlatCount: 2,
        })
        , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU8, 1, 1, 1],
          ],
          variantSize32: 2,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 2,
        })
        , 2, 1 ],['alertMessage', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-header-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatStringAny, 8, 4, 2],
            ],
            variantSize32: 12,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 3,
          })
          , 12, 4 ],['fieldSize', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatU32, 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
          ],
          variantSize32: 24,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 6,
        })
        , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],],
        variantSize32: 32,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 7,
      } ), 40, 8, 8 ],
      ],
      variantSize32: 40,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 8,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline51,
  },
  );
  let trampoline52 = _trampoline52.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 52,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline52.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 7),_liftFlatStringAny,_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'invalid-syntax', null, 0, 0, 0 ],[ 'forbidden', null, 0, 0, 0 ],[ 'immutable', null, 0, 0, 0 ],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      } ), 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline52,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 52,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline52.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 7),_liftFlatStringAny,_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'invalid-syntax', null, 0, 0, 0 ],[ 'forbidden', null, 0, 0, 0 ],[ 'immutable', null, 0, 0, 0 ],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      } ), 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline52,
  },
  );
  let trampoline53 = _trampoline53.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 53,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline53.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 7)],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4],[_lowerFlatList({
        elemLowerFn: _lowerFlatU8,
        elemSize32: 1,
        elemAlign32: 1,
      }), 8, 4],], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline53,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 53,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline53.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 7)],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4],[_lowerFlatList({
        elemLowerFn: _lowerFlatU8,
        elemSize32: 1,
        elemAlign32: 1,
      }), 8, 4],], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline53,
  },
  );
  let trampoline54 = _trampoline54.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 54,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline54.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatBorrow.bind(null, 3),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatU64, 16, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 16, 8, 8 ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline54,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 54,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline54.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatBorrow.bind(null, 3),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatU64, 16, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 16, 8, 8 ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline54,
  },
  );
  let trampoline55 = _trampoline55.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 55,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline55.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatU64, 16, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 16, 8, 8 ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline55,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 55,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline55.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatU64, 16, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 16, 8, 8 ],
      ],
      variantSize32: 16,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline55,
  },
  );
  let trampoline56 = _trampoline56.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 56,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline56.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline56,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 56,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline56.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline56,
  },
  );
  let trampoline57 = _trampoline57.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 57,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline57.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatList({
        elemLowerFn: _lowerFlatU8,
        elemSize32: 1,
        elemAlign32: 1,
      }), 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline57,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 57,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline57.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 3),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatList({
        elemLowerFn: _lowerFlatU8,
        elemSize32: 1,
        elemAlign32: 1,
      }), 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline57,
  },
  );
  let trampoline58 = _trampoline58.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 58,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline58.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [_lowerFlatStringAny],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline58,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 58,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline58.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 1)],
    resultLowerFns: [_lowerFlatStringAny],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline58,
  },
  );
  let trampoline59 = _trampoline59.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 59,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline59.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => OutgoingRequest,
      createResourceFn: 
      (handle) => {
        const rep = handleTable10[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable10.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(OutgoingRequest.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable10.delete(rep);
        }
        rscTableRemove(handleTable10, handle);
        return resourceObj;
      }
      ,
    })
    ,
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatOwn({
        componentIdx: 0,
        classNameFn: () => RequestOptions,
        createResourceFn: 
        (handle) => {
          const rep = handleTable11[(handle << 1) + 1] & ~T_FLAG;
          let resourceObj = captureTable11.get(rep);
          if (!resourceObj) {
            resourceObj = Object.create(RequestOptions.prototype);
            Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
            Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
          } else {
            captureTable11.delete(rep);
          }
          rscTableRemove(handleTable11, handle);
          return resourceObj;
        }
        ,
      })
      , 4, 4, 1, ['i32'] ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_FutureIncomingResponse(obj) {
          if (!(obj instanceof FutureIncomingResponse)) {
            throw new TypeError('Resource error: Not a valid \"FutureIncomingResponse\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt8;
            captureTable8.set(rep, obj);
            handle = rscTableCreateOwn(handleTable8, rep);
          }
          return handle;
        }
        ,
      }), 40, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['infoCode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU16, 2, 2, 1],
          ],
          variantSize32: 4,
          variantAlign32: 2,
          variantPayloadOffset32: 2,
          variantFlatCount: 2,
        })
        , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU8, 1, 1, 1],
          ],
          variantSize32: 2,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 2,
        })
        , 2, 1 ],['alertMessage', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-header-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatStringAny, 8, 4, 2],
            ],
            variantSize32: 12,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 3,
          })
          , 12, 4 ],['fieldSize', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatU32, 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
          ],
          variantSize32: 24,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 6,
        })
        , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],],
        variantSize32: 32,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 7,
      } ), 40, 8, 8 ],
      ],
      variantSize32: 40,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 8,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline59,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 59,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline59.manuallyAsync,
    paramLiftFns: [_liftFlatOwn({
      componentIdx: 0,
      classNameFn: () => OutgoingRequest,
      createResourceFn: 
      (handle) => {
        const rep = handleTable10[(handle << 1) + 1] & ~T_FLAG;
        let resourceObj = captureTable10.get(rep);
        if (!resourceObj) {
          resourceObj = Object.create(OutgoingRequest.prototype);
          Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
          Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
        } else {
          captureTable10.delete(rep);
        }
        rscTableRemove(handleTable10, handle);
        return resourceObj;
      }
      ,
    })
    ,
    _liftFlatOption({
      caseMetas: [
      ['none', null, 0, 0, 0, [] ],
      ['some', _liftFlatOwn({
        componentIdx: 0,
        classNameFn: () => RequestOptions,
        createResourceFn: 
        (handle) => {
          const rep = handleTable11[(handle << 1) + 1] & ~T_FLAG;
          let resourceObj = captureTable11.get(rep);
          if (!resourceObj) {
            resourceObj = Object.create(RequestOptions.prototype);
            Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
            Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
          } else {
            captureTable11.delete(rep);
          }
          rscTableRemove(handleTable11, handle);
          return resourceObj;
        }
        ,
      })
      , 4, 4, 1, ['i32'] ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
      variantPayloadFlatTypes: ['i32'],
    })
    ],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_FutureIncomingResponse(obj) {
          if (!(obj instanceof FutureIncomingResponse)) {
            throw new TypeError('Resource error: Not a valid \"FutureIncomingResponse\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt8;
            captureTable8.set(rep, obj);
            handle = rscTableCreateOwn(handleTable8, rep);
          }
          return handle;
        }
        ,
      }), 40, 8, 8 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'DNS-timeout', null, 0, 0, 0 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['infoCode', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU16, 2, 2, 1],
          ],
          variantSize32: 4,
          variantAlign32: 2,
          variantPayloadOffset32: 2,
          variantFlatCount: 2,
        })
        , 4, 2 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'destination-not-found', null, 0, 0, 0 ],[ 'destination-unavailable', null, 0, 0, 0 ],[ 'destination-IP-prohibited', null, 0, 0, 0 ],[ 'destination-IP-unroutable', null, 0, 0, 0 ],[ 'connection-refused', null, 0, 0, 0 ],[ 'connection-terminated', null, 0, 0, 0 ],[ 'connection-timeout', null, 0, 0, 0 ],[ 'connection-read-timeout', null, 0, 0, 0 ],[ 'connection-write-timeout', null, 0, 0, 0 ],[ 'connection-limit-reached', null, 0, 0, 0 ],[ 'TLS-protocol-error', null, 0, 0, 0 ],[ 'TLS-certificate-error', null, 0, 0, 0 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU8, 1, 1, 1],
          ],
          variantSize32: 2,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 2,
        })
        , 2, 1 ],['alertMessage', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],], size32: 16, align32: 4 }), 16, 4, 5 ],[ 'HTTP-request-denied', null, 0, 0, 0 ],[ 'HTTP-request-length-required', null, 0, 0, 0 ],[ 'HTTP-request-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-request-method-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-invalid', null, 0, 0, 0 ],[ 'HTTP-request-URI-too-long', null, 0, 0, 0 ],[ 'HTTP-request-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-header-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatStringAny, 8, 4, 2],
            ],
            variantSize32: 12,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 3,
          })
          , 12, 4 ],['fieldSize', 
          _lowerFlatOption({
            caseMetas: [
            [ 'none', null, 0, 0, 0 ],
            [ 'some', _lowerFlatU32, 4, 4, 1],
            ],
            variantSize32: 8,
            variantAlign32: 4,
            variantPayloadOffset32: 4,
            variantFlatCount: 2,
          })
          , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5],
          ],
          variantSize32: 24,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 6,
        })
        , 24, 4, 6 ],[ 'HTTP-request-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-incomplete', null, 0, 0, 0 ],[ 'HTTP-response-header-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-body-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU64, 8, 8, 1],
          ],
          variantSize32: 16,
          variantAlign32: 8,
          variantPayloadOffset32: 8,
          variantFlatCount: 2,
        })
        , 16, 8, 2 ],[ 'HTTP-response-trailer-section-size', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4, 2 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4 ],['fieldSize', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatU32, 4, 4, 1],
          ],
          variantSize32: 8,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 2,
        })
        , 8, 4 ],], size32: 20, align32: 4 }), 20, 4, 5 ],[ 'HTTP-response-transfer-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-content-coding', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],[ 'HTTP-response-timeout', null, 0, 0, 0 ],[ 'HTTP-upgrade-failed', null, 0, 0, 0 ],[ 'HTTP-protocol-error', null, 0, 0, 0 ],[ 'loop-detected', null, 0, 0, 0 ],[ 'configuration-error', null, 0, 0, 0 ],[ 'internal-error', 
        _lowerFlatOption({
          caseMetas: [
          [ 'none', null, 0, 0, 0 ],
          [ 'some', _lowerFlatStringAny, 8, 4, 2],
          ],
          variantSize32: 12,
          variantAlign32: 4,
          variantPayloadOffset32: 4,
          variantFlatCount: 3,
        })
        , 12, 4, 3 ],],
        variantSize32: 32,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 7,
      } ), 40, 8, 8 ],
      ],
      variantSize32: 40,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 8,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline59,
  },
  );
  let trampoline60 = _trampoline60.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 60,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline60.manuallyAsync,
    paramLiftFns: [_liftFlatList({
      elemLiftFn: _liftFlatBorrow.bind(null, 0),
      elemAlign32: 4,
      elemSize32: 4,
      typedArray: undefined,
    })],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatU32,
      elemSize32: 4,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline60,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 60,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline60.manuallyAsync,
    paramLiftFns: [_liftFlatList({
      elemLiftFn: _liftFlatBorrow.bind(null, 0),
      elemAlign32: 4,
      elemSize32: 4,
      typedArray: undefined,
    })],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatU32,
      elemSize32: 4,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline60,
  },
  );
  let trampoline61 = _trampoline61.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 61,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline61.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline61,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 61,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline61.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 12, 4, 4 ],
      [ 'err', _lowerFlatVariant({
        caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
          componentIdx: 0,
          lowerFn: 
          function lowerImportedOwnedHost_Error$1(obj) {
            if (!(obj instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
            }
            let handle = obj[symbolRscHandle];
            if (!handle) {
              const rep = obj[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, obj);
              handle = rscTableCreateOwn(handleTable1, rep);
            }
            return handle;
          }
          ,
        }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
        variantSize32: 8,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 2,
      } ), 12, 4, 4 ],
      ],
      variantSize32: 12,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline61,
  },
  );
  let trampoline62 = _trampoline62.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 62,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline62.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_InputStream(obj) {
          if (!(obj instanceof InputStream)) {
            throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep, obj);
            handle = rscTableCreateOwn(handleTable3, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline62,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 62,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline62.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_InputStream(obj) {
          if (!(obj instanceof InputStream)) {
            throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt3;
            captureTable3.set(rep, obj);
            handle = rscTableCreateOwn(handleTable3, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline62,
  },
  );
  let trampoline63 = _trampoline63.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 63,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline63.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline63,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 63,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline63.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatU64],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline63,
  },
  );
  let trampoline64 = _trampoline64.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 64,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline64.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline64,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 64,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline64.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_OutputStream(obj) {
          if (!(obj instanceof OutputStream)) {
            throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt2;
            captureTable2.set(rep, obj);
            handle = rscTableCreateOwn(handleTable2, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline64,
  },
  );
  let trampoline65 = _trampoline65.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 65,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline65.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatFlags({ names: ['read','write','fileIntegritySync','dataIntegritySync','requestedWriteSync','mutateDirectory'], size32: 1, align32: 1, intSizeBytes: 1 }), 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline65,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 65,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline65.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatFlags({ names: ['read','write','fileIntegritySync','dataIntegritySync','requestedWriteSync','mutateDirectory'], size32: 1, align32: 1, intSizeBytes: 1 }), 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline65,
  },
  );
  let trampoline66 = _trampoline66.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 66,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline66.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_DirectoryEntryStream(obj) {
          if (!(obj instanceof DirectoryEntryStream)) {
            throw new TypeError('Resource error: Not a valid \"DirectoryEntryStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt15;
            captureTable15.set(rep, obj);
            handle = rscTableCreateOwn(handleTable15, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline66,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 66,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline66.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_DirectoryEntryStream(obj) {
          if (!(obj instanceof DirectoryEntryStream)) {
            throw new TypeError('Resource error: Not a valid \"DirectoryEntryStream\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt15;
            captureTable15.set(rep, obj);
            handle = rscTableCreateOwn(handleTable15, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline66,
  },
  );
  let trampoline67 = _trampoline67.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 67,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline67.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline67,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 67,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline67.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline67,
  },
  );
  let trampoline68 = _trampoline68.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 68,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline68.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', 
      _lowerFlatEnum({
        caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['dataModificationTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['statusChangeTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 104, 8, 8 ],
      ],
      variantSize32: 104,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline68,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 68,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline68.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', 
      _lowerFlatEnum({
        caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['dataModificationTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['statusChangeTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 104, 8, 8 ],
      ],
      variantSize32: 104,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline68,
  },
  );
  let trampoline69 = _trampoline69.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 69,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline69.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', 
      _lowerFlatEnum({
        caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['dataModificationTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['statusChangeTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 104, 8, 8 ],
      ],
      variantSize32: 104,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline69,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 69,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline69.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', 
      _lowerFlatEnum({
        caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['dataModificationTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],['statusChangeTimestamp', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 16, 8, 2],
        ],
        variantSize32: 24,
        variantAlign32: 8,
        variantPayloadOffset32: 8,
        variantFlatCount: 3,
      })
      , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 104, 8, 8 ],
      ],
      variantSize32: 104,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 13,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline69,
  },
  );
  let trampoline70 = _trampoline70.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 70,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline70.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny,_liftFlatFlags({ names: ['create','directory','exclusive','truncate'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatFlags({ names: ['read','write','fileIntegritySync','dataIntegritySync','requestedWriteSync','mutateDirectory'], size32: 1, align32: 1, intSizeBytes: 1 })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Descriptor(obj) {
          if (!(obj instanceof Descriptor)) {
            throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt14;
            captureTable14.set(rep, obj);
            handle = rscTableCreateOwn(handleTable14, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline70,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 70,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline70.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny,_liftFlatFlags({ names: ['create','directory','exclusive','truncate'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatFlags({ names: ['read','write','fileIntegritySync','dataIntegritySync','requestedWriteSync','mutateDirectory'], size32: 1, align32: 1, intSizeBytes: 1 })],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Descriptor(obj) {
          if (!(obj instanceof Descriptor)) {
            throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt14;
            captureTable14.set(rep, obj);
            handle = rscTableCreateOwn(handleTable14, rep);
          }
          return handle;
        }
        ,
      }), 8, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 8, 4, 4 ],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline70,
  },
  );
  let trampoline71 = _trampoline71.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 71,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline71.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline71,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 71,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline71.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', null, 2, 1, 1 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 2, 1, 1 ],
      ],
      variantSize32: 2,
      variantAlign32: 1,
      variantPayloadOffset32: 1,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline71,
  },
  );
  let trampoline72 = _trampoline72.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 72,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline72.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 24, 8, 8 ],
      ],
      variantSize32: 24,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline72,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 72,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline72.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 24, 8, 8 ],
      ],
      variantSize32: 24,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline72,
  },
  );
  let trampoline73 = _trampoline73.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 73,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline73.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 24, 8, 8 ],
      ],
      variantSize32: 24,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline73,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 73,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline73.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 14),_liftFlatFlags({ names: ['symlinkFollow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 24, 8, 8 ],
      ],
      variantSize32: 24,
      variantAlign32: 8,
      variantPayloadOffset32: 8,
      variantFlatCount: 3,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline73,
  },
  );
  let trampoline74 = _trampoline74.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 74,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline74.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 15)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['type', 
        _lowerFlatEnum({
          caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
          variantSize32: 1,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 1,
        })
        , 1, 1 ],['name', _lowerFlatStringAny, 8, 4 ],], size32: 12, align32: 4 }), 12, 4, 3],
        ],
        variantSize32: 16,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 4,
      })
      , 20, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 20, 4, 4 ],
      ],
      variantSize32: 20,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 5,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline74,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 74,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline74.manuallyAsync,
    paramLiftFns: [_liftFlatBorrow.bind(null, 15)],
    resultLowerFns: [
    _lowerFlatResult({
      caseMetas: [
      [ 'ok', 
      _lowerFlatOption({
        caseMetas: [
        [ 'none', null, 0, 0, 0 ],
        [ 'some', _lowerFlatRecord({ fieldMetas: [['type', 
        _lowerFlatEnum({
          caseMetas: [['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],],
          variantSize32: 1,
          variantAlign32: 1,
          variantPayloadOffset32: 1,
          variantFlatCount: 1,
        })
        , 1, 1 ],['name', _lowerFlatStringAny, 8, 4 ],], size32: 12, align32: 4 }), 12, 4, 3],
        ],
        variantSize32: 16,
        variantAlign32: 4,
        variantPayloadOffset32: 4,
        variantFlatCount: 4,
      })
      , 20, 4, 4 ],
      [ 'err', 
      _lowerFlatEnum({
        caseMetas: [['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],],
        variantSize32: 1,
        variantAlign32: 1,
        variantPayloadOffset32: 1,
        variantFlatCount: 1,
      })
      , 20, 4, 4 ],
      ],
      variantSize32: 20,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 5,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline74,
  },
  );
  let trampoline75 = _trampoline75.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 75,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline75.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4],[_lowerFlatStringAny, 8, 4],], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline75,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 75,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline75.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatStringAny, 8, 4],[_lowerFlatStringAny, 8, 4],], size32: 16, align32: 4 }),
      elemSize32: 16,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline75,
  },
  );
  let trampoline76 = _trampoline76.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 76,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline76.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalInput(obj) {
          if (!(obj instanceof TerminalInput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalInput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt12;
            captureTable12.set(rep, obj);
            handle = rscTableCreateOwn(handleTable12, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline76,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 76,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline76.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalInput(obj) {
          if (!(obj instanceof TerminalInput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalInput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt12;
            captureTable12.set(rep, obj);
            handle = rscTableCreateOwn(handleTable12, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline76,
  },
  );
  let trampoline77 = _trampoline77.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 77,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline77.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalOutput(obj) {
          if (!(obj instanceof TerminalOutput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt13;
            captureTable13.set(rep, obj);
            handle = rscTableCreateOwn(handleTable13, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline77,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 77,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline77.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalOutput(obj) {
          if (!(obj instanceof TerminalOutput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt13;
            captureTable13.set(rep, obj);
            handle = rscTableCreateOwn(handleTable13, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline77,
  },
  );
  let trampoline78 = _trampoline78.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 78,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline78.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalOutput(obj) {
          if (!(obj instanceof TerminalOutput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt13;
            captureTable13.set(rep, obj);
            handle = rscTableCreateOwn(handleTable13, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline78,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 78,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline78.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [
    _lowerFlatOption({
      caseMetas: [
      [ 'none', null, 0, 0, 0 ],
      [ 'some', _lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_TerminalOutput(obj) {
          if (!(obj instanceof TerminalOutput)) {
            throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt13;
            captureTable13.set(rep, obj);
            handle = rscTableCreateOwn(handleTable13, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1],
      ],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    })
    ],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline78,
  },
  );
  let trampoline79 = _trampoline79.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 79,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline79.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline79,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 79,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline79.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: undefined,
    importFn: _trampoline79,
  },
  );
  let trampoline80 = _trampoline80.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 80,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline80.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Descriptor(obj) {
          if (!(obj instanceof Descriptor)) {
            throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt14;
            captureTable14.set(rep, obj);
            handle = rscTableCreateOwn(handleTable14, rep);
          }
          return handle;
        }
        ,
      }), 4, 4],[_lowerFlatStringAny, 8, 4],], size32: 12, align32: 4 }),
      elemSize32: 12,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline80,
  },
  ))) : _lowerImportBackwardsCompat.bind(
  null,
  {
    trampolineIdx: 80,
    componentIdx: 0,
    isAsync: false,
    isManualAsync: _trampoline80.manuallyAsync,
    paramLiftFns: [],
    resultLowerFns: [_lowerFlatList({
      elemLowerFn: _lowerFlatTuple({ elemLowerMetas: [[_lowerFlatOwn({
        componentIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Descriptor(obj) {
          if (!(obj instanceof Descriptor)) {
            throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt14;
            captureTable14.set(rep, obj);
            handle = rscTableCreateOwn(handleTable14, rep);
          }
          return handle;
        }
        ,
      }), 4, 4],[_lowerFlatStringAny, 8, 4],], size32: 12, align32: 4 }),
      elemSize32: 12,
      elemAlign32: 4,
    })],
    hasResultPointer: true,
    funcTypeIsAsync: false,
    getCallbackFn: () => null,
    getPostReturnFn: () => null,
    isCancellable: false,
    memoryIdx: 0,
    stringEncoding: 'utf8',
    getMemoryFn: () => memory0,
    getReallocFn: () => realloc0,
    importFn: _trampoline80,
  },
  );
  Promise.all([module0, module1, module2]).catch(() => {});
  ({ exports: exports0 } = yield instantiateCore(yield module1));
  ({ exports: exports1 } = yield instantiateCore(yield module0, {
    'component:aws-cli/providers': {
      'provide-credentials': exports0['1'],
      'provide-region': exports0['0'],
    },
    'wasi:cli/environment@0.2.0': {
      'get-environment': exports0['38'],
    },
    'wasi:cli/environment@0.2.9': {
      'get-arguments': exports0['2'],
    },
    'wasi:cli/exit@0.2.0': {
      exit: trampoline32,
    },
    'wasi:cli/stderr@0.2.0': {
      'get-stderr': trampoline36,
    },
    'wasi:cli/stdin@0.2.0': {
      'get-stdin': trampoline34,
    },
    'wasi:cli/stdout@0.2.0': {
      'get-stdout': trampoline35,
    },
    'wasi:cli/terminal-input@0.2.0': {
      '[resource-drop]terminal-input': _guardMayLeave(0, trampoline28),
    },
    'wasi:cli/terminal-output@0.2.0': {
      '[resource-drop]terminal-output': _guardMayLeave(0, trampoline29),
    },
    'wasi:cli/terminal-stderr@0.2.0': {
      'get-terminal-stderr': exports0['41'],
    },
    'wasi:cli/terminal-stdin@0.2.0': {
      'get-terminal-stdin': exports0['39'],
    },
    'wasi:cli/terminal-stdout@0.2.0': {
      'get-terminal-stdout': exports0['40'],
    },
    'wasi:clocks/monotonic-clock@0.2.0': {
      now: trampoline15,
      'subscribe-duration': trampoline14,
    },
    'wasi:clocks/monotonic-clock@0.2.12': {
      now: trampoline15,
      'subscribe-duration': trampoline14,
    },
    'wasi:clocks/wall-clock@0.2.0': {
      now: exports0['42'],
    },
    'wasi:filesystem/preopens@0.2.0': {
      'get-directories': exports0['43'],
    },
    'wasi:filesystem/types@0.2.0': {
      '[method]descriptor.append-via-stream': exports0['27'],
      '[method]descriptor.create-directory-at': exports0['30'],
      '[method]descriptor.get-flags': exports0['28'],
      '[method]descriptor.metadata-hash': exports0['35'],
      '[method]descriptor.metadata-hash-at': exports0['36'],
      '[method]descriptor.open-at': exports0['33'],
      '[method]descriptor.read-directory': exports0['29'],
      '[method]descriptor.read-via-stream': exports0['25'],
      '[method]descriptor.stat': exports0['31'],
      '[method]descriptor.stat-at': exports0['32'],
      '[method]descriptor.unlink-file-at': exports0['34'],
      '[method]descriptor.write-via-stream': exports0['26'],
      '[method]directory-entry-stream.read-directory-entry': exports0['37'],
      '[resource-drop]descriptor': _guardMayLeave(0, trampoline30),
      '[resource-drop]directory-entry-stream': _guardMayLeave(0, trampoline31),
    },
    'wasi:http/outgoing-handler@0.2.12': {
      handle: exports0['22'],
    },
    'wasi:http/types@0.2.12': {
      '[constructor]fields': trampoline27,
      '[constructor]outgoing-request': trampoline16,
      '[constructor]request-options': trampoline18,
      '[method]fields.append': exports0['15'],
      '[method]fields.entries': exports0['16'],
      '[method]future-incoming-response.get': exports0['6'],
      '[method]future-incoming-response.subscribe': trampoline8,
      '[method]future-trailers.get': exports0['13'],
      '[method]future-trailers.subscribe': trampoline4,
      '[method]incoming-body.stream': exports0['5'],
      '[method]incoming-response.consume': exports0['7'],
      '[method]incoming-response.headers': trampoline10,
      '[method]incoming-response.status': trampoline11,
      '[method]outgoing-body.write': exports0['4'],
      '[method]outgoing-request.body': exports0['12'],
      '[method]outgoing-request.set-authority': exports0['10'],
      '[method]outgoing-request.set-method': exports0['8'],
      '[method]outgoing-request.set-path-with-query': exports0['11'],
      '[method]outgoing-request.set-scheme': exports0['9'],
      '[method]request-options.set-between-bytes-timeout': trampoline21,
      '[method]request-options.set-connect-timeout': trampoline19,
      '[method]request-options.set-first-byte-timeout': trampoline20,
      '[resource-drop]fields': _guardMayLeave(0, trampoline5),
      '[resource-drop]future-incoming-response': _guardMayLeave(0, trampoline9),
      '[resource-drop]future-trailers': _guardMayLeave(0, trampoline7),
      '[resource-drop]incoming-body': _guardMayLeave(0, trampoline3),
      '[resource-drop]incoming-response': _guardMayLeave(0, trampoline12),
      '[resource-drop]outgoing-body': _guardMayLeave(0, trampoline6),
      '[resource-drop]outgoing-request': _guardMayLeave(0, trampoline17),
      '[resource-drop]request-options': _guardMayLeave(0, trampoline22),
      '[static]incoming-body.finish': trampoline2,
      '[static]outgoing-body.finish': exports0['14'],
    },
    'wasi:io/error@0.2.0': {
      '[resource-drop]error': _guardMayLeave(0, trampoline1),
    },
    'wasi:io/error@0.2.12': {
      '[method]error.to-debug-string': exports0['21'],
      '[resource-drop]error': _guardMayLeave(0, trampoline1),
    },
    'wasi:io/poll@0.2.0': {
      '[method]pollable.block': trampoline33,
      '[resource-drop]pollable': _guardMayLeave(0, trampoline25),
      poll: exports0['23'],
    },
    'wasi:io/poll@0.2.12': {
      '[method]pollable.ready': trampoline26,
      '[resource-drop]pollable': _guardMayLeave(0, trampoline25),
      poll: exports0['23'],
    },
    'wasi:io/streams@0.2.0': {
      '[method]input-stream.read': exports0['20'],
      '[method]input-stream.subscribe': trampoline24,
      '[method]output-stream.blocking-flush': exports0['24'],
      '[method]output-stream.check-write': exports0['18'],
      '[method]output-stream.subscribe': trampoline23,
      '[method]output-stream.write': exports0['19'],
      '[resource-drop]input-stream': _guardMayLeave(0, trampoline13),
      '[resource-drop]output-stream': _guardMayLeave(0, trampoline0),
    },
    'wasi:io/streams@0.2.12': {
      '[method]input-stream.read': exports0['20'],
      '[method]input-stream.subscribe': trampoline24,
      '[method]output-stream.check-write': exports0['18'],
      '[method]output-stream.splice': exports0['17'],
      '[method]output-stream.subscribe': trampoline23,
      '[method]output-stream.write': exports0['19'],
      '[resource-drop]input-stream': _guardMayLeave(0, trampoline13),
      '[resource-drop]output-stream': _guardMayLeave(0, trampoline0),
    },
    'wasi:random/insecure-seed@0.2.9': {
      'insecure-seed': exports0['3'],
    },
  }));
  memory0 = exports1.memory;
  realloc0 = exports1.cabi_realloc;
  
  try {
    realloc0Async = WebAssembly.promising(exports1.cabi_realloc);
  } catch(err) {
    realloc0Async = exports1.cabi_realloc;
  }
  
  ({ exports: exports2 } = yield instantiateCore(yield module2, {
    '': {
      $imports: exports0.$imports,
      '0': trampoline37,
      '1': trampoline38,
      '10': trampoline47,
      '11': trampoline48,
      '12': trampoline49,
      '13': trampoline50,
      '14': trampoline51,
      '15': trampoline52,
      '16': trampoline53,
      '17': trampoline54,
      '18': trampoline55,
      '19': trampoline56,
      '2': trampoline39,
      '20': trampoline57,
      '21': trampoline58,
      '22': trampoline59,
      '23': trampoline60,
      '24': trampoline61,
      '25': trampoline62,
      '26': trampoline63,
      '27': trampoline64,
      '28': trampoline65,
      '29': trampoline66,
      '3': trampoline40,
      '30': trampoline67,
      '31': trampoline68,
      '32': trampoline69,
      '33': trampoline70,
      '34': trampoline71,
      '35': trampoline72,
      '36': trampoline73,
      '37': trampoline74,
      '38': trampoline75,
      '39': trampoline76,
      '4': trampoline41,
      '40': trampoline77,
      '41': trampoline78,
      '42': trampoline79,
      '43': trampoline80,
      '5': trampoline42,
      '6': trampoline43,
      '7': trampoline44,
      '8': trampoline45,
      '9': trampoline46,
    },
  }));
  run0212Run = WebAssembly.promising(exports1['wasi:cli/run@0.2.12#run']);
  const run0212 = {
    run: run,
    
  };
  
  return { run: run0212, 'wasi:cli/run@0.2.12': run0212,  };
})();
let promise, resolve, reject;
function runNext (value) {
  try {
    let done;
    do {
      ({ value, done } = gen.next(value));
    } while (!(value instanceof Promise) && !done);
    if (done) {
      if (resolve) return resolve(value);
      else return value;
    }
    if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
    value.then(nextVal => done ? resolve() : runNext(nextVal), reject);
  }
  catch (e) {
    if (reject) reject(e);
    else throw e;
  }
}
const maybeSyncReturn = runNext(null);
return promise || maybeSyncReturn;
};

export const _util = {
  
}

