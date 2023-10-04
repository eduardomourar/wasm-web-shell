"use components";
export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
  
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
  const symbolDispose = Symbol.dispose || Symbol.for('dispose');
  const symbolAsyncIterator = Symbol.asyncIterator;
  const symbolIterator = Symbol.iterator;
  
  const _debugLog = (...args) => {
    if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
    console.debug(...args);
  };
  const ASYNC_DETERMINISM = 'random';
  const GLOBAL_COMPONENT_MEMORY_MAP = new Map();
  const CURRENT_TASK_META = {};
  
  function _getGlobalCurrentTaskMeta(componentIdx) {
    const v = CURRENT_TASK_META[componentIdx];
    if (v === undefined || v === null) { return undefined; }
    return { ...v };
  }
  
  
  function _setGlobalCurrentTaskMeta(args) {
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    return CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
  }
  
  
  function _withGlobalCurrentTaskMeta(args) {
    _debugLog('[_withGlobalCurrentTaskMeta()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    const { taskID, componentIdx, fn } = args;
    
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
      CURRENT_TASK_META[componentIdx] = null;
    }
  }
  
  async function _withGlobalCurrentTaskMetaAsync(args) {
    _debugLog('[_withGlobalCurrentTaskMetaAsync()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    const { taskID, componentIdx, fn } = args;
    
    // If there is already an async task executing, we must wait for it
    // to complete before we can can run the closure we were given
    //
    let current = CURRENT_TASK_META[componentIdx];
    let cstate;
    if (current && current.taskID !== taskID) {
      cstate = getOrCreateAsyncState(componentIdx);
      while (current && current.taskID !== taskID) {
        const { promise, resolve } = Promise.withResolvers();
        cstate.onNextExclusiveRelease(resolve);
        await promise;
        current = CURRENT_TASK_META[componentIdx];
      }
      
      // Since we've just waited for the component to not be locked, re-lock
      // exclusivity so we can run the fn below (likely a callee/callback)
      cstate.exclusiveLock();
    }
    
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
  
  async function _clearCurrentTask(args) {
    _debugLog('[_clearCurrentTask()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    const { taskID, componentIdx } = args;
    
    const meta = CURRENT_TASK_META[componentIdx];
    if (!meta) { throw new Error(`missing current task meta for component idx [${componentIdx}]n`); }
    
    if (meta.taskID !== taskID) {
      throw new Error(`task ID [${meta.taskID}] != requested ID [${taskID}]`);
    }
    if (meta.componentIdx !== componentIdx) {
      throw new Error(`component idx [${meta.componentIdx}] != requested idx [${componentIdx}]`);
    }
    
    CURRENT_TASK_META[componentIdx] = null;
  }
  
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
  
  function registerGlobalMemoryForComponent(args) {
    const { componentIdx, memory, memoryIdx } = args ?? {};
    if (componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (memory === undefined && memoryIdx === undefined) { throw new TypeError('missing both memory & memory idx'); }
    let inner = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx);
    if (!inner) {
      inner = {};
      GLOBAL_COMPONENT_MEMORY_MAP.set(componentIdx, inner);
    }
    
    inner[memoryIdx] = { memory, memoryIdx, componentIdx };
  }
  
  class RepTable {
    #data = [0, null];
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
        return rep;
      }
      this.#data[0] = this.#data[freeIdx << 1];
      const placementIdx = freeIdx << 1;
      this.#data[placementIdx] = val;
      this.#data[placementIdx + 1] = null;
      _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep: freeIdx });
      return freeIdx;
    }
    
    get(rep) {
      _debugLog('[RepTable#get()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during get, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      return val;
    }
    
    contains(rep) {
      _debugLog('[RepTable#contains()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during contains, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      return !!this.#data[baseIdx];
    }
    
    remove(rep) {
      _debugLog('[RepTable#remove()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during remove, (cannot be 0)'); }
      if (this.#data.length === 2) { throw new Error('invalid'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      
      this.#data[baseIdx] = this.#data[0];
      this.#data[0] = rep;
      
      return val;
    }
    
    clear() {
      _debugLog('[RepTable#clear()] args', { rep, target: this.target });
      this.#data = [0, null];
    }
  }
  const _coinFlip = () => { return Math.random() > 0.5; };
  let SCOPE_ID = 0;
  const I32_MIN = -2_147_483_648;
  
  const I32_MAX= 2_147_483_647;
  
  
  function _isValidNumericPrimitive(ty, v) {
    if (v === undefined || v === null) { return false; }
    switch (ty) {
      case 'bool':
      return v === 0 || v === 1;
      break;
      case 'u8':
      return v >= 0 && v <= 255;
      break;
      case 's8':
      return v >= -128 && v <= 127;
      break;
      case 'u16':
      return v >= 0 && v <= 65535;
      break;
      case 's16':
      return v >= -32768 && v <= 32767;
      case 'u32':
      return v >= 0 && v <= 4_294_967_295;
      case 's32':
      return v >= -2_147_483_648 && v <= 2_147_483_647;
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
  
  const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;
  
  
  const _typeCheckAsyncFn= (f) => {
    return f instanceof ASYNC_FN_CTOR;
  };
  
  let RESOURCE_CALL_BORROWS = [];const ASYNC_FN_CTOR = (async () => {}).constructor;
  
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
  
  const CURRENT_TASK_MAY_BLOCK= globalThis.WebAssembly ? new globalThis.WebAssembly.Global({ value: 'i32', mutable: true }, 0) : false;
  
  const ASYNC_CURRENT_TASK_IDS = [];
  const ASYNC_CURRENT_COMPONENT_IDXS = [];
  
  function unpackCallbackResult(result) {
    if (!(_typeCheckValidI32(result))) { throw new Error('invalid callback return value [' + result + '], not a valid i32'); }
    const eventCode = result & 0xF;
    if (eventCode < 0 || eventCode > 3) {
      throw new Error('invalid async return value [' + eventCode + '], outside callback code range');
    }
    if (result < 0 || result >= 2**32) { throw new Error('invalid callback result'); }
    // TODO: table max length check?
    const waitableSetRep = result >> 4;
    return [eventCode, waitableSetRep];
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
    
    registerOnStartHandler(f) {
      this.#onStartHandlers.push(f);
    }
    
    onStart(args) {
      _debugLog('[AsyncSubtask#onStart()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        parentTaskID: this.parentTaskID(),
        fnName: this.fnName,
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
      this.#childTask?.reject(subtaskErr);
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
      if (callMetadata && !callMetadata.returnFn && this.isAsync && callMetadata.resultPtr && memory) {
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
  
  function _prepareCall(
  memoryIdx,
  getMemoryFn,
  startFn,
  returnFn,
  callerComponentIdx,
  calleeComponentIdx,
  taskReturnTypeIdx,
  calleeIsAsyncInt,
  stringEncoding,
  resultCountOrAsync,
  ) {
    _debugLog('[_prepareCall()]', {
      memoryIdx,
      callerComponentIdx,
      calleeComponentIdx,
      taskReturnTypeIdx,
      calleeIsAsyncInt,
      stringEncoding,
      resultCountOrAsync,
    });
    const argArray = [...arguments];
    
    // value passed in *may* be as large as u32::MAX which may be mangled into -2
    resultCountOrAsync >>>= 0;
    
    let isAsync = false;
    let hasResultPointer = false;
    if (resultCountOrAsync === 2**32 - 1) {
      // prepare async with no result (u32::MAX)
      isAsync = true;
      hasResultPointer = false;
    } else if (resultCountOrAsync === 2**32 - 2) {
      // prepare async with result (u32::MAX - 1)
      isAsync = true;
      hasResultPointer = true;
    }
    
    const currentCallerTaskMeta = getCurrentTask(callerComponentIdx);
    if (!currentCallerTaskMeta) {
      throw new Error('invalid/missing current task for caller during prepare call');
    }
    
    const currentCallerTask = currentCallerTaskMeta.task;
    if (!currentCallerTask) {
      throw new Error('unexpectedly missing task in meta for caller during prepare call');
    }
    
    if (currentCallerTask.componentIdx() !== callerComponentIdx) {
      throw new Error(`task component idx [${ currentCallerTask.componentIdx() }] !== [${ callerComponentIdx }] (callee ${ calleeComponentIdx })`);
    }
    
    let getCalleeParamsFn;
    let resultPtr = null;
    let directParamsArr;
    if (hasResultPointer) {
      directParamsArr = argArray.slice(10, argArray.length - 1);
      getCalleeParamsFn = () => directParamsArr;
      resultPtr = argArray[argArray.length - 1];
    } else {
      directParamsArr = argArray.slice(10);
      getCalleeParamsFn = () => directParamsArr;
    }
    
    let encoding;
    switch (stringEncoding) {
      case 0:
      encoding = 'utf8';
      break;
      case 1:
      encoding = 'utf16';
      break;
      case 2:
      encoding = 'compact-utf16';
      break;
      default:
      throw new Error(`unrecognized string encoding enum [${stringEncoding}]`);
    }
    
    const subtask = currentCallerTask.createSubtask({
      componentIdx: callerComponentIdx,
      parentTask: currentCallerTask,
      isAsync,
      callMetadata: {
        getMemoryFn,
        memoryIdx,
        resultPtr,
        returnFn,
        startFn,
        stringEncoding,
      }
    });
    
    const [newTask, newTaskID] = createNewCurrentTask({
      componentIdx: calleeComponentIdx,
      isAsync,
      getCalleeParamsFn,
      entryFnName: [
      'task',
      subtask.getParentTask().id(),
      'subtask',
      subtask.id(),
      'new-prepared-async-task'
      ].join('/'),
      stringEncoding,
    });
    newTask.setParentSubtask(subtask);
    newTask.setReturnMemoryIdx(memoryIdx);
    newTask.setReturnMemory(getMemoryFn);
    subtask.setChildTask(newTask);
    
    newTask.subtaskMeta = {
      subtask,
      calleeComponentIdx,
      callerComponentIdx,
      getCalleeParamsFn,
      stringEncoding,
      isAsync,
    };
    
    _setGlobalCurrentTaskMeta({
      taskID: newTask.id(),
      componentIdx: newTask.componentIdx(),
    });
  }
  
  function _asyncStartCall(args, callee, paramCount, resultCount, flags) {
    const componentIdx = ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
    
    const globalTaskMeta = _getGlobalCurrentTaskMeta(componentIdx);
    if (!globalTaskMeta) { throw new Error('missing global current task globalTaskMeta'); }
    const taskID = globalTaskMeta.taskID;
    
    _debugLog('[_asyncStartCall()] args', { args, componentIdx });
    const { getCallbackFn, callbackIdx, getPostReturnFn, postReturnIdx } = args;
    
    const preparedTaskMeta = getCurrentTask(componentIdx, taskID);
    if (!preparedTaskMeta) { throw new Error('unexpectedly missing current task'); }
    
    const preparedTask = preparedTaskMeta.task;
    if (!preparedTask) { throw new Error('unexpectedly missing current task'); }
    if (!preparedTask.subtaskMeta) { throw new Error('missing subtask meta from prepare'); }
    
    const {
      subtask,
      returnMemoryIdx,
      getReturnMemoryFn,
      callerComponentIdx,
      calleeComponentIdx,
      getCalleeParamsFn,
      isAsync,
      stringEncoding,
    } = preparedTask.subtaskMeta;
    if (!subtask) { throw new Error("missing subtask from cstate during async start call"); }
    if (calleeComponentIdx !== preparedTask.componentIdx()) {
      throw new Error(`meta callee idx [${calleeComponentIdx}] != current task idx [${preparedTask.componentIdx()}] during async start call`);
    }
    if (calleeComponentIdx !== componentIdx) {
      throw new Error("mismatched componentIdx for async start call (does not match prepare)");
    }
    
    const argArray = [...arguments];
    
    if (resultCount < 0 || resultCount > 1) { throw new Error('invalid/unsupported result count'); }
    
    const callbackFnName = 'callback_' + callbackIdx;
    const callbackFn = getCallbackFn();
    preparedTask.setCallbackFn(callbackFn, callbackFnName);
    preparedTask.setPostReturnFn(getPostReturnFn());
    
    if (resultCount < 0 || resultCount > 1) {
      throw new Error(`unsupported result count [${ resultCount }]`);
    }
    
    const params = preparedTask.getCalleeParams();
    if (paramCount !== params.length) {
      throw new Error(`unexpected callee param count [${ params.length }], _asyncStartCall invocation expected [${ paramCount }]`);
    }
    
    const callerComponentState = getOrCreateAsyncState(subtask.componentIdx());
    
    const calleeComponentState = getOrCreateAsyncState(preparedTask.componentIdx());
    const calleeBackpressure = calleeComponentState.hasBackpressure();
    
    // Set up a handler on subtask completion to lower results from the call into the caller's memory region.
    //
    // NOTE: during fused guest->guest calls this handler is triggered, but does not actually perform
    // lowering manually, as fused modules provider helper functions that can
    subtask.registerOnResolveHandler((res) => {
      _debugLog('[_asyncStartCall()] handling subtask result', { res, subtaskID: subtask.id() });
      
      let subtaskCallMeta = subtask.getCallMetadata();
      
      // NOTE: in the case of guest -> guest async calls, there may be no memory/realloc present,
      // as the host will intermediate the value storage/movement between calls.
      //
      // We can simply take the value and lower it as a parameter
      if (subtaskCallMeta.memory || subtaskCallMeta.realloc) {
        throw new Error("call metadata unexpectedly contains memory/realloc for guest->guest call");
      }
      
      const callerTask = subtask.getParentTask();
      const calleeTask = preparedTask;
      const callerMemoryIdx = callerTask.getReturnMemoryIdx();
      const callerComponentIdx = callerTask.componentIdx();
      
      // If a helper function was provided we are likely in a fused guest->guest call,
      // and the result will be delivered (lift/lowered) via helper function
      if (subtaskCallMeta && subtaskCallMeta.returnFn) {
        _debugLog('[_asyncStartCall()] return function present while handling subtask result, returning early (skipping lower)');
        
        // TODO: centralize calling of returnFn to *one place* (if possible)
        if (subtaskCallMeta.returnFnCalled) { return; }
        
        subtaskCallMeta.returnFn.apply(null, [subtaskCallMeta.resultPtr]);
        return;
      }
      
      // If there is no where to lower the results, exit early
      if (!subtaskCallMeta.resultPtr) {
        _debugLog('[_asyncStartCall()] no result ptr during subtask result handling, returning early (skipping lower)');
        return;
      }
      
      let callerMemory;
      if (callerMemoryIdx !== null && callerMemoryIdx !== undefined) {
        callerMemory = lookupMemoriesForComponent({ componentIdx: callerComponentIdx, memoryIdx: callerMemoryIdx });
      } else {
        const callerMemories = lookupMemoriesForComponent({ componentIdx: callerComponentIdx });
        if (callerMemories.length !== 1) { throw new Error(`unsupported amount of caller memories`); }
        callerMemory = callerMemories[0];
      }
      
      if (!callerMemory) {
        _debugLog('[_asyncStartCall()] missing memory', { subtaskID: subtask.id(), res });
        throw new Error(`missing memory for to guest->guest call result (subtask [${subtask.id()}])`);
      }
      
      const lowerFns = calleeTask.getReturnLowerFns();
      if (!lowerFns || lowerFns.length === 0) {
        _debugLog('[_asyncStartCall()] missing result lower metadata for guest->guest call', { subtaskID: subtask.id() });
        throw new Error(`missing result lower metadata for guest->guest call (subtask [${subtask.id()}])`);
      }
      
      if (lowerFns.length !== 1) {
        _debugLog('[_asyncStartCall()] only single result reportetd for guest->guest call', { subtaskID: subtask.id() });
        throw new Error(`only single result supported for guest->guest calls (subtask [${subtask.id()}])`);
      }
      
      _debugLog('[_asyncStartCall()] lowering results', { subtaskID: subtask.id() });
      lowerFns[0]({
        realloc: undefined,
        memory: callerMemory,
        vals: [res],
        storagePtr: subtaskCallMeta.resultPtr,
        componentIdx: callerComponentIdx,
        stringEncoding: subtaskCallMeta.stringEncoding,
      });
      
    });
    
    subtask.setOnProgressFn(() => {
      subtask.setPendingEvent(() => {
        if (subtask.isResolved()) { subtask.deliverResolve(); }
        const event = {
          code: ASYNC_EVENT_CODE.SUBTASK,
          payload0: subtask.waitableRep(),
          payload1: subtask.getStateNumber(),
        };
        return event;
      });
    });
    
    // Start the (event) driver loop that will resolve the task
    queueMicrotask(async () => {
      let startRes = subtask.onStart({ startFnParams: params });
      startRes = Array.isArray(startRes) ? startRes : [startRes];
      
      await calleeComponentState.suspendTask({
        task: preparedTask,
        readyFn: () => !calleeComponentState.isExclusivelyLocked(),
      });
      
      const started = await preparedTask.enter();
      if (!started) {
        _debugLog('[_asyncStartCall()] task failed early', {
          taskID: preparedTask.id(),
          subtaskID: subtask.id(),
        });
        throw new Error("task failed to start");
        return;
      }
      
      let callbackResult;
      try {
        let jspiCallee = WebAssembly.promising(callee);
        callbackResult = await _withGlobalCurrentTaskMetaAsync({
          taskID: preparedTask.id(),
          componentIdx: preparedTask.componentIdx(),
          fn: () => {
            return jspiCallee.apply(null, startRes);
          }
        });
      } catch(err) {
        _debugLog("[_asyncStartCall()] initial subtask callee run failed", err);
        // NOTE: a good place to rejectt the parent task, if rejection API is enabled
        // subtask.reject(err);
        // subtask.getParentTask().reject(err);
        
        subtask.getParentTask().setErrored(err);
        
        return;
      }
      
      // If there was no callback function, we're dealing with a sync function
      // that was lifted as async without one, there is only the callee.
      if (!callbackFn) {
        _debugLog("[_asyncStartCall()] no callback, resolving w/ callee result", {
          taskID: preparedTask.id(),
          componentIdx: preparedTask.componentIdx(),
          preparedTask,
          stateNumber: preparedTask.taskState(),
          isResolved: preparedTask.isResolved(),
          callbackFn,
        });
        preparedTask.resolve([callbackResult]);
        return;
      }
      
      let fnName = callbackFn.fnName;
      if (!fnName) {
        fnName = [
        '<task ',
        subtask.parentTaskID(),
        '/subtask ',
        subtask.id(),
        '/task ',
        preparedTask.id(),
        '>',
        ].join("");
      }
      
      try {
        _debugLog("[_asyncStartCall()] starting driver loop", {
          fnName,
          componentIdx: preparedTask.componentIdx(),
          subtaskID: subtask.id(),
          childTaskID: subtask.childTaskID(),
          parentTaskID: subtask.parentTaskID(),
        });
        
        await _driverLoop({
          componentState: calleeComponentState,
          task: preparedTask,
          fnName,
          isAsync: true,
          callbackResult,
          resolve,
          reject
        });
      } catch (err) {
        _debugLog("[AsyncStartCall] drive loop call failure", { err });
      }
      
    });
    
    const subtaskState = subtask.getStateNumber();
    if (subtaskState < 0 || subtaskState > 2**5) {
      throw new Error('invalid subtask state, out of valid range');
    }
    
    _debugLog('[_asyncStartCall()] returning subtask rep & state', {
      subtask: {
        rep: subtask.waitableRep(),
        state: subtaskState,
      }
    });
    
    return Number(subtask.waitableRep()) << 4 | subtaskState;
  }
  
  function _syncStartCall(callbackIdx) {
    _debugLog('[_syncStartCall()] args', { callbackIdx });
    throw new Error('synchronous start call not implemented!');
  }
  
  class Waitable {
    #componentIdx;
    
    #pendingEventFn = null;
    
    #promise;
    #resolve;
    #reject;
    
    #waitableSet = null;
    
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
        });
        if (this.#waitableSet) { this.#waitableSet.removeWaitable(this); }
        if (!waitableSet) {
          this.#waitableSet = null;
          return;
        }
        waitableSet.addWaitable(this);
        this.#waitableSet = waitableSet;
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
      
    }
    
    const ERR_CTX_TABLES = {};
    
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
    
    const utf16Decoder = new TextDecoder('utf-16');
    const TEXT_DECODER_UTF8 = new TextDecoder();
    const TEXT_ENCODER_UTF8 = new TextEncoder();
    
    function _utf8AllocateAndEncode(s, realloc, memory) {
      if (typeof s !== 'string') {
        throw new TypeError('expected a string, received [' + typeof s + ']');
      }
      if (s.length === 0) { return { ptr: 1, len: 0 }; }
      let buf = TEXT_ENCODER_UTF8.encode(s);
      let ptr = realloc(0, 0, 1, buf.length);
      new Uint8Array(memory.buffer).set(buf, ptr);
      const res = { ptr, len: buf.length, codepoints: [...s].length };
      return res;
    }
    
    
    const T_FLAG = 1 << 30;
    
    function rscTableCreateOwn(table, rep) {
      const free = table[0] & ~T_FLAG;
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
    
    function createNewCurrentTask(args) {
      _debugLog('[createNewCurrentTask()] args', args);
      const {
        componentIdx,
        isAsync,
        isManualAsync,
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
        entryFnName,
        callbackFn,
        callbackFnName,
        stringEncoding,
        getCalleeParamsFn,
        resultPtr,
        errHandling,
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
    const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
    
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
        this.#entryFnName = opts.entryFnName;
        
        const {
          promise: completionPromise,
          resolve: resolveCompletionPromise,
          reject: rejectCompletionPromise,
        } = promiseWithResolvers();
        this.#completionPromise = completionPromise;
        
        this.#onResolveHandlers.push((results) => {
          if (this.#errored !== null) {
            rejectCompletionPromise(this.#errored);
            return;
          } else if (this.#rejected) {
            rejectCompletionPromise(results);
            return;
          }
          resolveCompletionPromise(results);
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
          // TODO(???): it is *very possible* for a the line below to fail if
          // an async function is already running (and holding the exclusive lock)
          //
          // It's not really possible to fix this unless we turn every sync export into
          // an async export that will use the regular async enabled `enter()`.
          cstate.exclusiveLock();
        }
        return true;
      }
      
      async enter(opts) {
        _debugLog('[AsyncTask#enter()] args', {
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          subtaskID: this.getParentSubtask()?.id(),
          entryFnName: this.#entryFnName,
        });
        
        if (this.#entered) {
          throw new Error(`task with ID [${this.#id}] should not be entered twice`);
        }
        
        const cstate = getOrCreateAsyncState(this.#componentIdx);
        
        await cstate.nextTaskExecutionSlot({ task: this });
        
        // If a task is either synchronous or host-provided (e.g. a host import, whether sync or async)
        // then we can avoid component-relevant tracking and immediately enter
        if (this.isSync() || opts?.isHost) {
          this.#entered = true;
          
          // TODO(breaking): remove once manually-specifying async fns is removed
          // It is currently possible for an actually sync export to be specified
          // as async via JSPI
          if (this.#isManualAsync) {
            if (this.needsExclusiveLock()) { cstate.exclusiveLock(); }
          }
          
          return this.#entered;
        }
        
        // Perform intial backpressure check
        if (cstate.hasBackpressure() || this.needsExclusiveLock() && cstate.isExclusivelyLocked()) {
          cstate.addBackpressureWaiter();
          
          const result = await this.waitUntil({
            readyFn: () => {
              return !(cstate.hasBackpressure()
              || this.needsExclusiveLock() && cstate.isExclusivelyLocked());
            },
            cancellable: true,
          });
          
          cstate.removeBackpressureWaiter();
          
          if (result === AsyncTask.BlockResult.CANCELLED) {
            this.cancel();
            return false;
          }
        }
        
        // Lock the component state or keep trying until we can/do
        try {
          if (this.needsExclusiveLock()) { cstate.exclusiveLock(); }
        } catch {
          // Continuously attempt to lock until we can
          while (cstate.hasBackpressure() || this.needsExclusiveLock() && cstate.isExclusivelyLocked()) {
            try {
              if (this.needsExclusiveLock()) { cstate.exclusiveLock(); }
              break;
            } catch(err) {
              cstate.addBackpressureWaiter();
              const result = await this.waitUntil({
                readyFn: () => {
                  return !(cstate.hasBackpressure()
                  || this.needsExclusiveLock() && cstate.isExclusivelyLocked());
                },
                cancellable: true,
              });
              cstate.removeBackpressureWaiter();
              if (result === AsyncTask.BlockResult.CANCELLED) {
                this.cancel();
                return false;
              }
            }
          }
        }
        
        this.#entered = true;
        return this.#entered;
      }
      
      isRunningState() { return this.#state !== AsyncTask.State.RESOLVED; }
      isResolvedState() { return this.#state === AsyncTask.State.RESOLVED; }
      isResolved() { return this.#state === AsyncTask.State.RESOLVED; }
      
      async waitUntil(opts) {
        const { readyFn, cancellable } = opts;
        _debugLog('[AsyncTask#waitUntil()] args', { taskID: this.#id, cancellable });
        
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
        _debugLog('[AsyncTask#yieldUntil()] args', { taskID: this.#id, cancellable });
        
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
        _debugLog('[AsyncTask#suspendUntil()] args', { cancellable });
        
        const pendingCancelled = this.deliverPendingCancel({ cancellable });
        if (pendingCancelled) { return false; }
        
        const completed = await this.immediateSuspendUntil({ readyFn, cancellable });
        return completed;
      }
      
      // TODO(threads): equivalent to thread.suspend_until()
      async immediateSuspendUntil(opts) {
        const { cancellable, readyFn } = opts;
        _debugLog('[AsyncTask#immediateSuspendUntil()] args', { cancellable, readyFn });
        
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
      const keepGoing = await cstate.suspendTask({ task: this, readyFn });
      return keepGoing;
    }
    
    deliverPendingCancel(opts) {
      const { cancellable } = opts;
      _debugLog('[AsyncTask#deliverPendingCancel()] args', { cancellable });
      
      if (cancellable && this.#state === AsyncTask.State.PENDING_CANCEL) {
        this.#state = AsyncTask.State.CANCEL_DELIVERED;
        return true;
      }
      
      return false;
    }
    
    isCancelled() { return this.cancelled }
    
    cancel(args) {
      _debugLog('[AsyncTask#cancel()] args', { });
      if (this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
        throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state [${this.taskState()}] for cancellation`);
      }
      if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
      this.cancelled = true;
      this.onResolve(args?.error ?? new Error('task cancelled'));
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    onResolve(taskValue) {
      const handlers = this.#onResolveHandlers;
      this.#onResolveHandlers = [];
      for (const f of handlers) {
        try {
          // TODO(fix): resolve handlers getting called a ton?
          f(taskValue);
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      if (this.#parentSubtask) {
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
          const memory = meta.getMemoryFn();
          meta.returnFn.apply(null, [taskValue, meta.resultPtr]);
          meta.returnFnCalled = true;
        }
      }
      
      if (this.#postReturnFn) {
        _debugLog('[AsyncTask#onResolve()] running post return ', {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
        });
        try {
          this.#postReturnFn(taskValue);
        } catch (err) {
          _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
          throw err;
        }
      }
      
      if (this.#parentSubtask) {
        this.#parentSubtask.onResolve(taskValue);
      }
    }
    
    registerOnResolveHandler(f) {
      this.#onResolveHandlers.push(f);
    }
    
    isRejected() { return this.#rejected; }
    
    setErrored(err) {
      this.#errored = err;
    }
    
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
      
      for (const subtask of this.#subtasks) {
        subtask.reject(taskErr);
      }
      
      this.#rejected = true;
      this.cancelRequested = true;
      this.#state = AsyncTask.State.PENDING_CANCEL;
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
        // TODO(fix): only fused, manually specified post returns seem to break this invariant,
        // as the TaskReturn trampoline is not activated it seems.
        //
        // see: test/p3/ported/wasmtime/component-async/post-return.js
        //
        // We *should* be able to upgrade this to be more strict and throw at some point,
        // which may involve rewriting the upstream test to surface task return manually somehow.
        //
        //throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] exited without resolution`);
        _debugLog('[AsyncTask#exit()] task exited without resolution', {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
          subtask: this.getParentSubtask(),
          subtaskID: this.getParentSubtask()?.id(),
        });
        this.#state = AsyncTask.State.RESOLVED;
      }
      
      if (this.borrowedHandles > 0) {
        throw new Error('task [${this.#id}] exited without clearing borrowed handles');
      }
      
      const state = getOrCreateAsyncState(this.#componentIdx);
      if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
      
      // Exempt the host from exclusive lock check
      if (this.#componentIdx !== -1 && !args?.skipExclusiveLockCheck) {
        if (this.needsExclusiveLock() && !state.isExclusivelyLocked()) {
          throw new Error(`task [${this.#id}] exit: component [${this.#componentIdx}] should have been exclusively locked`);
        }
      }
      
      state.exclusiveRelease();
      
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
      if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
      this.#subtasks = this.#subtasks.filter(t => t !== subtask);
      return subtask;
    }
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
    
    // TODO: re-enable this check -- postReturn can call imports though,
    // and that breaks things.
    //
    // if (!cstate.mayLeave) {
      //     throw new Error(`cannot leave instance [${componentIdx}]`);
      // }
      
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
        const { promise, resolve } = new Promise();
        queueMicrotask(async () => {
          if (!subtask.isResolvedState()) {
            await task.suspendUntil({ readyFn: () => task.isResolvedState() });
          }
          resolve(subtask.getResult());
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
          }
          throw err;
        }
      });
      
      if (requiresManualAsyncResult) { return manualAsyncResult.promise; }
      
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
        val = ctx.params[0];
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
        val = ctx.params[0];
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
    
    function _liftFlatStringUTF8(ctx) {
      _debugLog('[_liftFlatStringUTF8()] args', { ctx });
      let val;
      
      if (ctx.useDirectParams) {
        if (ctx.params.length < 2) { throw new Error('expected at least two u32 arguments'); }
        const offset = ctx.params[0];
        if (!Number.isSafeInteger(offset)) {  throw new Error('invalid offset'); }
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
        const offset = ctx.params[0];
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
    
    function _liftFlatVariant(casesAndLiftFns) {
      return function _liftFlatVariantInner(ctx) {
        _debugLog('[_liftFlatVariant()] args', { ctx });
        
        const origUseParams = ctx.useDirectParams;
        
        let caseIdx;
        let liftRes;
        const originalPtr = ctx.storagePtr;
        const numCases =  casesAndLiftFns.length;
        if (casesAndLiftFns.length < 256) {
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
        
        const [ tag, liftFn, size32, align32, payloadOffset32, caseFlatCount, variantFlatCount ] = casesAndLiftFns[caseIdx];
        if (payloadOffset32 === undefined) { throw new Error('unexpectedly missing payload offset'); }
        
        if (originalPtr !== undefined) {
          ctx.storagePtr = originalPtr + payloadOffset32;
        }
        
        let val;
        if (liftFn === null) {
          val = { tag };
          // NOTE: here we need to move past the entire object in memory
          // despite moving to the payload which we now know is missing/unnecessary
          if (originalPtr !== undefined) {
            ctx.storagePtr = originalPtr + size32;
          }
        } else {
          const [newVal, newCtx] = liftFn(ctx);
          val = { tag, val: newVal };
          ctx = newCtx;
          
          // NOTE: Padding can be left over after doing the lift if it was less than
          // space left for the payload normally.
          if (originalPtr !== undefined) {
            ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + size32);
          }
        }
        
        if (origUseParams) {
          if (caseFlatCount === undefined || variantFlatCount === undefined) {
            throw new Error('variant flat count metadata is missing');
          }
          if (caseFlatCount === null || variantFlatCount === null) {
            throw new Error('cannot lift variant with unknown flat count');
          }
          const remainingPayloadParams = variantFlatCount - 1 - caseFlatCount;
          if (remainingPayloadParams < 0) {
            throw new Error(`invalid variant flat count metadata`);
          }
          if (ctx.params.length < remainingPayloadParams) {
            throw new Error(`expected at least [${remainingPayloadParams}] remaining variant payload params, but got [${ctx.params.length}]`);
          }
          ctx.params = ctx.params.slice(remainingPayloadParams);
        }
        
        if (ctx.storagePtr !== undefined) {
          const rem = ctx.storagePtr % align32;
          if (rem !== 0) { ctx.storagePtr += align32 - rem; }
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
      
      const readValuesAndReset = (ctx, originalPtr, dataPtr, len) => {
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
        return [listValue(val), ctx];
      };
      
      return function _liftFlatListInner(ctx) {
        _debugLog('[_liftFlatList()] args', { ctx });
        
        let liftResults;
        if (knownLen !== undefined) { // list with known length
        if (ctx.useDirectParams) {
          if (ctx.memory === null) {
            // If this lift should be using direct params,
            // and the memory is missing, we are in the case where
            // a fixed length list (or other value) is being passed only
            // via parameters to the function.
            //
            // Normally, we would expect to use the direct parameters as a
            // memory location + size, but in this case, *all* values are being passed directly,
            // via params.
            //
            _debugLog('memory unexpectedly missing while lifting unknown length list', { ctx });
            liftResults = [listValue(ctx.params.slice(0, knownLen)), ctx];
            ctx.params = ctx.params.slice(knownLen);
          } else {
            // in-memory list with unknown length w/ direct params
            const dataPtr = ctx.params[0];
            ctx.params = ctx.params.slice(1);
            
            ctx.useDirectParams = false;
            const originalPtr = ctx.storagePtr;
            ctx.storageLen = knownLen * elemSize32;
            
            liftResults = readValuesAndReset(ctx, originalPtr, dataPtr, knownLen);
            
            ctx.useDirectParams = true;
            ctx.storagePtr = undefined;
            ctx.storageLen = undefined;
          }
        } else { // indirect params
        if (ctx.memory === null) {
          _debugLog('memory unexpectedly missing while lifting known length list', { knownLen, ctx });
          throw new Error(`memory missing while lifting known length (${knownLen}) list`);
        }
        
        ctx.storageLen = knownLen * elemSize32;
        liftResults = readValuesAndReset(ctx, null, ctx.storagePtr, knownLen);
      }
      
    } else { // unknown length list
    
    if (ctx.useDirectParams) {
      // unknown length list ptr w/ direct params
      const dataPtr = ctx.params[0];
      const len = ctx.params[1];
      ctx.params = ctx.params.slice(2);
      
      ctx.useDirectParams = false;
      const originalPtr = ctx.storagePtr;
      ctx.storageLen = len * elemSize32;
      
      liftResults = readValuesAndReset(ctx, originalPtr, dataPtr, len);
      
      ctx.useDirectParams = true;
      ctx.storagePtr = undefined;
      ctx.storageLen = undefined;
      
    } else {
      // unknown length list ptr w/ in-memory params
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
      liftResults = readValuesAndReset(ctx, originalPtr, dataPtr, len);
    }
  }
  
  return liftResults;
}
}

function _liftFlatTuple(meta) {
  const { elemLiftFns, size32: tupleSize32, align32: tupleAlign32 } = meta;
  return function _liftFlatTupleInner(ctx) {
    _debugLog('[_liftFlatTuple()] args', { ctx });
    
    const originalPtr = ctx.storagePtr;
    const val = [];
    for (const [ liftFn, size32, align32 ]  of elemLiftFns) {
      let elemPtr;
      if (ctx.storagePtr !== undefined) {
        const rem = ctx.storagePtr % align32;
        if (rem !== 0) { ctx.storagePtr += align32 - rem; }
        elemPtr = ctx.storagePtr;
      }
      
      const [newValue, newCtx] = liftFn(ctx);
      val.push(newValue);
      ctx = newCtx;
      
      if (elemPtr !== undefined) {
        ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + size32);
      }
    }
    
    if (originalPtr !== undefined) {
      ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + tupleSize32);
    }
    
    if (ctx.storagePtr !== undefined) {
      const rem = ctx.storagePtr % tupleAlign32;
      if (rem !== 0) { ctx.storagePtr += tupleAlign32 - rem; }
    }
    
    return [val, ctx];
  }
}

function _liftFlatFlags(meta) {
  const { names, size32, align32, intSizeBytes } = meta;
  
  return function _liftFlatFlagsInner(ctx) {
    _debugLog('[_liftFlatFlags()] args', { ctx });
    
    const val = {};
    
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

function _liftFlatOption(casesAndLiftFns) {
  return function _liftFlatOptionInner(ctx) {
    _debugLog('[_liftFlatOption()] args', { ctx });
    return _liftFlatVariant(casesAndLiftFns)(ctx);
  }
}

function _liftFlatResult(casesAndLiftFns) {
  return function _liftFlatResultInner(ctx) {
    _debugLog('[_liftFlatResult()] args', { ctx });
    return _liftFlatVariant(casesAndLiftFns)(ctx);
  }
}

function _liftFlatOwn(meta) {
  const { className, createResourceFn, componentIdx } = meta;
  
  return function _liftFlatOwnInner(ctx) {
    _debugLog('[_liftFlatOwn()] args', { ctx, className });
    
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


function _lowerFlatU8(ctx) {
  _debugLog('[_lowerFlatU8()] args', ctx);
  
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  _requireValidNumericPrimitive.bind('u8', ctx.vals[0]);
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
  
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

function _lowerFlatStringUTF8(ctx) {
  _debugLog('[_lowerFlatStringUTF8()] args', ctx);
  if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
  
  const s = ctx.vals[0];
  const { ptr, codepoints } = _utf8AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, codepoints, true);
  
  ctx.storagePtr += 8;
}

function _lowerFlatStringUTF16(ctx) {
  _debugLog('[_lowerFlatStringUTF16()] args', { ctx });
  if (!ctx.realloc) { throw new Error('missing realloc during flat string lower'); }
  
  const s = ctx.vals[0];
  const { ptr, len, codepoints } = _utf16AllocateAndEncode(ctx.vals[0], ctx.realloc, ctx.memory);
  
  const view = new DataView(ctx.memory.buffer);
  view.setUint32(ctx.storagePtr, ptr, true);
  view.setUint32(ctx.storagePtr + 4, codepoints, true);
  
  const bytes = new Uint16Array(ctx.memory.buffer, start, codeUnits);
  if (ctx.memory.buffer.byteLength < start + bytes.byteLength) {
    throw new Error('memory out of bounds');
  }
  if (ctx.storageLen !== undefined && ctx.storageLen !== bytes.byteLength) {
    throw new Error(`storage length [${ctx.storageLen}] != [${bytes.byteLength}])`);
  }
  new Uint16Array(ctx.memory.buffer, ctx.storagePtr).set(bytes);
  
  ctx.storagePtr += len;
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

function _lowerFlatVariant(lowerMetas) {
  let caseLookup = {};
  for (const [idx, meta] of lowerMetas.entries()) {
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
    
    const [ _tag, lowerFn, size32, align32, payloadOffset32 ] = variantCase.meta;
    
    const originalPtr = ctx.storagePtr;
    ctx.vals = [variantCase.discriminant];
    let discLowerRes;
    if (lowerMetas.length < 256) {
      discLowerRes = _lowerFlatU8(ctx);
    } else if (lowerMetas.length >= 256 && lowerMetas.length < 65536) {
      discLowerRes = _lowerFlatU16(ctx);
    } else if (lowerMetas.length >= 65536 && lowerMetas.length < 4_294_967_296) {
      discLowerRes = _lowerFlatU32(ctx);
    } else {
      throw new Error(`unsupported number of cases [${lowerMetas.length}]`);
    }
    
    const payloadOffsetPtr = originalPtr + payloadOffset32;
    ctx.storagePtr = payloadOffsetPtr;
    ctx.vals = [val];
    if (lowerFn) { lowerFn(ctx); }
    
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + size32);
    
    const rem = ctx.storagePtr % align32;
    if (rem !== 0) { ctx.storagePtr += align32 - rem; }
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
    
    let flagObj = ctx.vals[0];
    let flagValue = 0;
    for (const [idx, name] of names.entries()) {
      if (flagObj[name] === true) {
        flagValue |= 1 << idx;
      }
    }
    
    const rem = ctx.storagePtr % align32;
    if (rem !== 0) { ctx.storagePtr += (align32 - rem); }
    
    const dv = new DataView(ctx.memory.buffer);
    if (intSizeBytes === 1) {
      dv.setUint8(ctx.storagePtr, flagValue);
    } else if (intSizeBytes === 2) {
      dv.setUint16(ctx.storagePtr, flagValue);
    } else if (intSizeBytes === 4) {
      dv.setUint32(ctx.storagePtr, flagValue);
    } else {
      throw new Error(`unrecognized flag size [${intSizeBytes} bytes]`);
    }
    
    ctx.storagePtr += intSizeBytes;
  }
}

function _lowerFlatEnum(lowerMetas) {
  return function _lowerFlatEnumInner(ctx) {
    _debugLog('[_lowerFlatEnum()] args', { ctx });
    
    const v = ctx.vals[0];
    const isNotEnumObject = typeof v !== 'object'
    || Object.keys(v).length !== 2
    || !('tag' in v);
    if (isNotEnumObject) {
      ctx.vals[0] = { tag: v };
    }
    
    _lowerFlatVariant(lowerMetas)(ctx);
  }
}

function _lowerFlatOption(lowerMetas) {
  return function _lowerFlatOptionInner(ctx) {
    _debugLog('[_lowerFlatOption()] args', { ctx });
    
    const v = ctx.vals[0];
    if (v === null) {
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
    
    _lowerFlatVariant(lowerMetas)(ctx);
  }
}

function _lowerFlatResult(lowerMetas) {
  return function _lowerFlatResultInner(ctx) {
    _debugLog('[_lowerFlatResult()] args', { lowerMetas });
    
    const v = ctx.vals[0];
    const isNotResultObject = typeof v !== 'object'
    || Object.keys(v).length !== 2
    || !('tag' in v)
    || !('ok' === v.tag || 'err' === v.tag)
    || !('val' in v);
    if (isNotResultObject) {
      ctx.vals[0] = { tag: 'ok', val: v };
    }
    
    _lowerFlatVariant(lowerMetas)(ctx);
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

const STREAMS = new RepTable({ target: 'global stream map' });
const ASYNC_STATE = new Map();

function getOrCreateAsyncState(componentIdx, init) {
  if (!ASYNC_STATE.has(componentIdx)) {
    const newState = new ComponentAsyncState({ componentIdx });
    ASYNC_STATE.set(componentIdx, newState);
  }
  return ASYNC_STATE.get(componentIdx);
}

class ComponentAsyncState {
  static EVENT_HANDLER_EVENTS = [ 'backpressure-change' ];
  
  #componentIdx;
  #callingAsyncImport = false;
  #syncImportWait = promiseWithResolvers();
  #locked = false;
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
  
  mayLeave = true;
  
  handles;
  subtasks;
  
  constructor(args) {
    this.#componentIdx = args.componentIdx;
    this.handles = new RepTable({ target: `component [${this.#componentIdx}] handles (waitable objects)` });
    this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
  };
  
  componentIdx() { return this.#componentIdx; }
  
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
  
  isExclusivelyLocked() { return this.#locked === true; }
  setLocked(locked) {
    this.#locked = locked;
  }
  
  exclusiveLock() {
    _debugLog('[ComponentAsyncState#exclusiveLock()]', {
      locked: this.#locked,
      componentIdx: this.#componentIdx,
    });
    this.setLocked(true);
  }
  
  exclusiveRelease() {
    _debugLog('[ComponentAsyncState#exclusiveRelease()] args', {
      locked: this.#locked,
      componentIdx: this.#componentIdx,
    });
    this.setLocked(false);
    
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
  }
  
  onNextExclusiveRelease(fn) {
    _debugLog('[ComponentAsyncState#()onNextExclusiveRelease] registering');
    this.#onExclusiveReleaseHandlers.push(fn);
  }
  
  // nextTaskPromise & nextTaskQueue are used to await current task completion and queues
  // any tasks attempting to enter() and complete.
  //
  // see: nextTaskExecutionSlot()
  //
  // TODO(threads): this should be unnecessary once threads are properly implemented,
  // as the task.enter() logic should suffice (it should be guaranteed that we cannot re-enter
  // unless the task in question is the current task in the thread execution, and only one can
  // run at a time)
  #nextTaskPromise = Promise.resolve(true);
  #nextTaskQueue = [];
  
  async nextTaskExecutionSlot(args) {
    const { task } = args;
    
    const placeholder = {
      completed: false,
      task,
      promise: task.exitPromise().then(() => {
        placeholder.completed = true;
      }),
    };
    this.#nextTaskQueue.push(placeholder);
    
    let next;
    while (true) {
      await this.#nextTaskPromise;
      
      next = this.#nextTaskQueue.find(placeholder => !placeholder.completed);
      
      // This task is next in the queue, we can continue
      if (next === undefined || next === placeholder) {
        this.#nextTaskPromise = next.promise;
        if (this.#nextTaskQueue.length > 1000) {
          this.#nextTaskQueue = this.#nextTaskQueue.filter(p => !p.completed);
          if (this.#nextTaskQueue.length > 1000) {
            _debugLog('[ComponentAsyncState#()nextTaskExecutionSlot] next task queue length > 1000 even after cleanup, tasks may be leaking');
          }
        }
        break;
      }
      
      // If we get here, this task was *not* next in the queue, continue waiting
      // (at this point the task that *is* next will likely have already set itself
      // as this.#nextTaskPromise)
    }
  }
  
  #getSuspendedTaskMeta(taskID) {
    return this.#suspendedTasksByTaskID.get(taskID);
  }
  
  #removeSuspendedTaskMeta(taskID) {
    _debugLog('[ComponentAsyncState#removeSuspendedTaskMeta()] removing suspended task', { taskID });
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
    _debugLog('[ComponentAsyncState#suspendTask()]', {
      taskID,
      componentIdx: this.#componentIdx,
      taskEntryFnName: task.entryFnName(),
      subtask: task.getParentSubtask(),
    });
    
    if (this.#getSuspendedTaskMeta(taskID)) {
      throw new Error(`task [${taskID}] already suspended`);
    }
    
    const { promise, resolve, reject } = promiseWithResolvers();
    this.#addSuspendedTaskMeta({
      task,
      taskID,
      readyFn,
      resume: () => {
        _debugLog('[ComponentAsyncState#suspendTask()] resuming suspended task', { taskID });
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
      let done = this.tick();
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        done = this.tick();
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
        _debugLog('[ComponentAsyncState#suspendTask()] detected task rejection, leaving early', { meta });
        this.resumeTaskByID(taskID);
        return;
      }
      
      const isReady = meta.readyFn();
      if (!isReady) { continue; }
      
      this.resumeTaskByID(taskID);
    }
    
    return this.#suspendedTaskIDs.filter(t => t !== null).length === 0;
  }
  
  addStreamEndToTable(args) {
    _debugLog('[ComponentAsyncState#addStreamEnd()] args', args);
    const { tableIdx, streamEnd } = args;
    if (typeof streamEnd === 'number') { throw new Error("INSERTING BAD STREAMEND"); }
    
    let { table, componentIdx } = STREAM_TABLES[tableIdx];
    if (componentIdx === undefined || !table) {
      throw new Error(`invalid global stream table state for table [${tableIdx}]`);
    }
    
    const handle = table.insert(streamEnd);
    streamEnd.setHandle(handle);
    streamEnd.setStreamTableIdx(tableIdx);
    
    const cstate = getOrCreateAsyncState(componentIdx);
    const waitableIdx = cstate.handles.insert(streamEnd);
    streamEnd.setWaitableIdx(waitableIdx);
    
    _debugLog('[ComponentAsyncState#addStreamEnd()] added stream end', {
      tableIdx,
      table,
      handle,
      streamEnd,
      destComponentIdx: componentIdx,
    });
    
    return { handle, waitableIdx };
  }
  
  createWaitable(args) {
    return new Waitable({ target: args?.target, });
  }
  
  createReadableStreamEnd(args) {
    _debugLog('[ComponentAsyncState#createStreamEnd()] args', args);
    const { tableIdx, elemMeta, hostInjectFn } = args;
    
    const { table: localStreamTable, componentIdx } = STREAM_TABLES[tableIdx];
    if (!localStreamTable) {
      throw new Error(`missing global stream table lookup for table [${tableIdx}] while creating stream`);
    }
    if (componentIdx !== this.#componentIdx) {
      throw new Error('component idx mismatch while creating stream');
    }
    
    const waitable = this.createWaitable();
    const streamEnd = new StreamReadableEnd({
      tableIdx,
      elemMeta,
      hostInjectFn,
      pendingBufferMeta: {},
      target: `stream read end (lowered, @init)`,
      waitable,
    });
    
    streamEnd.setWaitableIdx(this.handles.insert(streamEnd));
    streamEnd.setHandle(localStreamTable.insert(streamEnd));
    if (streamEnd.streamTableIdx() !== tableIdx) {
      throw new Error("unexpectedly mismatched stream table");
    }
    const streamEndWaitableIdx = streamEnd.waitableIdx();
    const streamEndHandle = streamEnd.handle();
    waitable.setTarget(`waitable for stream read end (lowered, waitable [${streamEndWaitableIdx}])`);
    streamEnd.setTarget(`stream read end (lowered, waitable [${streamEndWaitableIdx}])`);
    
    return {
      waitableIdx: streamEndWaitableIdx,
      handle: streamEndHandle,
      streamEnd,
    };
  }
  
  createStream(args) {
    _debugLog('[ComponentAsyncState#createStream()] args', args);
    const { tableIdx, elemMeta, hostInjectFn } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while adding stream"); }
    if (elemMeta === undefined) { throw new Error("missing element metadata while adding stream"); }
    
    const { table: localStreamTable, componentIdx } = STREAM_TABLES[tableIdx];
    if (!localStreamTable) {
      throw new Error(`missing global stream table lookup for table [${tableIdx}] while creating stream`);
    }
    if (componentIdx !== this.#componentIdx) {
      throw new Error('component idx mismatch while creating stream');
    }
    
    const readWaitable = this.createWaitable();
    const writeWaitable = this.createWaitable();
    
    const stream = new InternalStream({
      tableIdx,
      elemMeta,
      readWaitable,
      writeWaitable,
      hostInjectFn,
    });
    stream.setGlobalStreamMapRep(STREAMS.insert(stream));
    
    const writeEnd = stream.writeEnd();
    writeEnd.setWaitableIdx(this.handles.insert(writeEnd));
    writeEnd.setHandle(localStreamTable.insert(writeEnd));
    if (writeEnd.streamTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched stream table"); }
    
    const writeEndWaitableIdx = writeEnd.waitableIdx();
    const writeEndHandle = writeEnd.handle();
    writeWaitable.setTarget(`waitable for stream write end (waitable [${writeEndWaitableIdx}])`);
    writeEnd.setTarget(`stream write end (waitable [${writeEndWaitableIdx}])`);
    
    const readEnd = stream.readEnd();
    readEnd.setWaitableIdx(this.handles.insert(readEnd));
    readEnd.setHandle(localStreamTable.insert(readEnd));
    if (readEnd.streamTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched stream table"); }
    
    const readEndWaitableIdx = readEnd.waitableIdx();
    const readEndHandle = readEnd.handle();
    readWaitable.setTarget(`waitable for read end (waitable [${readEndWaitableIdx}])`);
    readEnd.setTarget(`stream read end (waitable [${readEndWaitableIdx}])`);
    
    return {
      writeEnd,
      writeEndWaitableIdx,
      writeEndHandle,
      readEndWaitableIdx,
      readEndHandle,
      readEnd,
    };
  }
  
  getStreamEnd(args) {
    _debugLog('[ComponentAsyncState#getStreamEnd()] args', args);
    const { tableIdx, streamEndHandle, streamEndWaitableIdx } = args;
    if (tableIdx === undefined) {
      throw new Error('missing table idx while getting stream end');
    }
    
    const { table, componentIdx } = STREAM_TABLES[tableIdx];
    const cstate = getOrCreateAsyncState(componentIdx);
    
    let streamEnd;
    if (streamEndWaitableIdx !== undefined) {
      streamEnd = cstate.handles.get(streamEndWaitableIdx);
    } else if (streamEndHandle !== undefined) {
      if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while getting stream end`); }
      streamEnd = table.get(streamEndHandle);
    } else {
      throw new TypeError("must specify either waitable idx or handle to retrieve stream");
    }
    
    if (!streamEnd) {
      throw new Error(`missing stream end (tableIdx [${tableIdx}], handle [${streamEndHandle}], waitableIdx [${streamEndWaitableIdx}])`);
    }
    if (tableIdx && streamEnd.streamTableIdx() !== tableIdx) {
      throw new Error(`stream end table idx [${streamEnd.streamTableIdx()}] does not match [${tableIdx}]`);
    }
    
    return streamEnd;
  }
  
  deleteStreamEnd(args) {
    _debugLog('[ComponentAsyncState#deleteStreamEnd()] args', args);
    const { tableIdx, streamEndWaitableIdx } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while removing stream end"); }
    if (streamEndWaitableIdx === undefined) { throw new Error("missing stream idx while removing stream end"); }
    
    const { table, componentIdx } = STREAM_TABLES[tableIdx];
    const cstate = getOrCreateAsyncState(componentIdx);
    
    const streamEnd = cstate.handles.get(streamEndWaitableIdx);
    if (!streamEnd) {
      throw new Error(`missing stream end [${streamEndWaitableIdx}] in component handles while deleting stream`);
    }
    if (streamEnd.streamTableIdx() !== tableIdx) {
      throw new Error(`stream end table idx [${streamEnd.streamTableIdx()}] does not match [${tableIdx}]`);
    }
    
    let removed = cstate.handles.remove(streamEnd.waitableIdx());
    if (!removed) {
      throw new Error(`failed to remove stream end [${streamEndWaitableIdx}] waitable obj in component [${componentIdx}]`);
    }
    
    removed = table.remove(streamEnd.handle());
    if (!removed) {
      throw new Error(`failed to remove stream end with handle [${streamEnd.handle()}] from stream table [${tableIdx}] in component [${componentIdx}]`);
    }
    
    return streamEnd;
  }
  
  removeStreamEndFromTable(args) {
    _debugLog('[ComponentAsyncState#removeStreamEndFromTable()] args', args);
    
    const { tableIdx, streamWaitableIdx } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while removing stream end"); }
    if (streamWaitableIdx === undefined) {
      throw new Error("missing stream end waitable idx while removing stream end");
    }
    
    const { table, componentIdx } = STREAM_TABLES[tableIdx];
    if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while removing stream end`); }
    
    const cstate = getOrCreateAsyncState(componentIdx);
    
    const streamEnd = cstate.handles.get(streamWaitableIdx);
    if (!streamEnd) {
      throw new Error(`missing stream end (handle [${streamWaitableIdx}], table [${tableIdx}])`);
    }
    const handle = streamEnd.handle();
    
    let removed = cstate.handles.remove(streamWaitableIdx);
    if (!removed) {
      throw new Error(`failed to remove streamEnd from handles (waitable idx [${streamWaitableIdx}]), component [${componentIdx}])`);
    }
    
    removed = table.remove(handle);
    if (!removed) {
      throw new Error(`failed to remove streamEnd from table (handle [${handle}]), table [${tableIdx}], component [${componentIdx}])`);
    }
    
    return streamEnd;
  }
  
  createFuture(args) {
    _debugLog('[ComponentAsyncState#createFuture()] args', args);
    const { tableIdx, elemMeta, hostInjectFn } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while adding future"); }
    if (elemMeta === undefined) { throw new Error("missing element metadata while adding future"); }
    
    const { table: futureTable, componentIdx } = FUTURE_TABLES[tableIdx];
    if (!futureTable) {
      throw new Error(`missing global future table lookup for table [${tableIdx}] while creating future`);
    }
    if (componentIdx !== this.#componentIdx) {
      throw new Error('component idx mismatch while creating future');
    }
    
    const readWaitable = this.createWaitable();
    const writeWaitable = this.createWaitable();
    
    const future = new InternalFuture({
      tableIdx,
      componentIdx: this.#componentIdx,
      elemMeta,
      readWaitable,
      writeWaitable,
      hostInjectFn,
    });
    future.setGlobalFutureMapRep(FUTURES.insert(future));
    
    const writeEnd = future.writeEnd();
    writeEnd.setWaitableIdx(this.handles.insert(writeEnd));
    writeEnd.setHandle(futureTable.insert(writeEnd));
    if (writeEnd.futureTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched future table"); }
    
    const writeEndWaitableIdx = writeEnd.waitableIdx();
    const writeEndHandle = writeEnd.handle();
    writeWaitable.setTarget(`waitable for future write end (waitable [${writeEndWaitableIdx}])`);
    writeEnd.setTarget(`future write end (waitable [${writeEndWaitableIdx}])`);
    
    const readEnd = future.readEnd();
    readEnd.setWaitableIdx(this.handles.insert(readEnd));
    readEnd.setHandle(futureTable.insert(readEnd));
    if (readEnd.futureTableIdx() !== tableIdx) { throw new Error("unexpectedly mismatched future table"); }
    
    const readEndWaitableIdx = readEnd.waitableIdx();
    const readEndHandle = readEnd.handle();
    readWaitable.setTarget(`waitable for read end (waitable [${readEndWaitableIdx}])`);
    readEnd.setTarget(`future read end (waitable [${readEndWaitableIdx}])`);
    
    return {
      writeEnd,
      writeEndWaitableIdx,
      writeEndHandle,
      readEndWaitableIdx,
      readEndHandle,
      readEnd,
    };
  }
  
  getFutureEnd(args) {
    _debugLog('[ComponentAsyncState#getFutureEnd()] args', args);
    const { tableIdx, futureEndHandle, futureEndWaitableIdx } = args;
    if (tableIdx === undefined) {
      throw new Error('missing table idx while getting future end');
    }
    
    const { table, componentIdx } = FUTURE_TABLES[tableIdx];
    const cstate = getOrCreateAsyncState(componentIdx);
    
    let futureEnd;
    if (futureEndWaitableIdx !== undefined) {
      futureEnd = cstate.handles.get(futureEndWaitableIdx);
    } else if (futureEndHandle !== undefined) {
      if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while getting future end`); }
      futureEnd = table.get(futureEndHandle);
    } else {
      throw new TypeError("must specify either waitable idx or handle to retrieve future");
    }
    
    if (!futureEnd) {
      throw new Error(`missing future end (tableIdx [${tableIdx}], handle [${futureEndHandle}], waitableIdx [${futureEndWaitableIdx}])`);
    }
    if (tableIdx && futureEnd.futureTableIdx() !== tableIdx) {
      throw new Error(`future end table idx [${futureEnd.futureTableIdx()}] does not match [${tableIdx}]`);
    }
    
    return futureEnd;
  }
  
  removeFutureEndFromTable(args) {
    _debugLog('[ComponentAsyncState#removeFutureEndFromTable()] args', args);
    
    const { tableIdx, futureWaitableIdx } = args;
    if (tableIdx === undefined) { throw new Error("missing table idx while removing future end"); }
    if (futureWaitableIdx === undefined) {
      throw new Error("missing future end waitable idx while removing future end");
    }
    
    const { table, componentIdx } = FUTURE_TABLES[tableIdx];
    if (!table) { throw new Error(`missing/invalid table [${tableIdx}] while removing future end`); }
    
    const cstate = getOrCreateAsyncState(componentIdx);
    
    const futureEnd = cstate.handles.get(futureWaitableIdx);
    if (!futureEnd) {
      throw new Error(`missing future end (handle [${futureWaitableIdx}], table [${tableIdx}])`);
    }
    const handle = futureEnd.handle();
    
    let removed = cstate.handles.remove(futureWaitableIdx);
    if (!removed) {
      throw new Error(`failed to remove futureEnd from handles (waitable idx [${futureWaitableIdx}]), component [${componentIdx}])`);
    }
    
    removed = table.remove(handle);
    if (!removed) {
      throw new Error(`failed to remove futureEnd from table (handle [${handle}]), table [${tableIdx}], component [${componentIdx}])`);
    }
    
    return futureEnd;
  }
  
}

const fetchCompile = url => fetch(url).then(WebAssembly.compileStreaming);

const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');

const handleTables = [];

class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

const isLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const hasOwnProperty = Object.prototype.hasOwnProperty;


if (!getCoreModule) getCoreModule = (name) => fetchCompile(new URL(`./${name}`, import.meta.url));
const module0 = getCoreModule('aws.core.wasm');
const module1 = getCoreModule('aws.core2.wasm');
const module2 = getCoreModule('aws.core3.wasm');

const { provideCredentials } = imports['component:aws-cli/credentials-provider'];

if (provideCredentials=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'provideCredentials', was 'provideCredentials' available at instantiation?");
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

const { now, subscribeDuration, subscribeInstant } = imports['wasi:clocks/monotonic-clock'];

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


if (subscribeInstant=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'subscribeInstant', was 'subscribeInstant' available at instantiation?");
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

const { Descriptor } = imports['wasi:filesystem/types'];

if (Descriptor=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Descriptor', was 'Descriptor' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { handle } = imports['wasi:http/outgoing-handler'];

if (handle=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'handle', was 'handle' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Fields, FutureIncomingResponse, IncomingBody, IncomingResponse, OutgoingBody, OutgoingRequest, RequestOptions } = imports['wasi:http/types'];

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

const { Pollable } = imports['wasi:io/poll'];

if (Pollable=== undefined) {
  const err = new Error("unexpectedly undefined instance import 'Pollable', was 'Pollable' available at instantiation?");
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
  let exports0;
  const handleTable4 = [T_FLAG, 0];
  const captureTable4= new Map();
  let captureCnt4 = 0;
  handleTables[4] = handleTable4;
  
  const _trampoline0 = function() {
    _debugLog('[iface="wasi:http/types@0.2.11", function="[constructor]request-options"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = true;
    
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
      const rep = ret[symbolRscRep] || ++captureCnt4;
      captureTable4.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable4, rep);
    }
    
    _debugLog('[iface="wasi:http/types@0.2.11", function="[constructor]request-options"][Instruction::Return]', {
      funcName: '[constructor]request-options',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    task.resolve([handle0]);
    task.exit();
    return handle0;
  }
  _trampoline0.fnName = 'wasi:http/types@0.2.11#new RequestOptions';
  
  const _trampoline1 = function(arg0, arg1, arg2) {
    var handle1 = arg0;
    
    var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable4.get(rep2);
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
    _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-connect-timeout"] [Instruction::CallInterface] (sync, @ enter)');
    let hostProvided = true;
    
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
      ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
        componentIdx: task.componentIdx(),
        taskID: task.id(),
        fn: () => rsc0.setConnectTimeout(variant3),
      })
    };
  } catch (e) {
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  var variant4 = ret;
  let variant4_0;
  switch (variant4.tag) {
    case 'ok': {
      const e = variant4.val;
      variant4_0 = 0;
      
      break;
    }
    case 'err': {
      const e = variant4.val;
      variant4_0 = 1;
      
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-connect-timeout"][Instruction::Return]', {
    funcName: '[method]request-options.set-connect-timeout',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([variant4_0]);
  task.exit();
  return variant4_0;
}
_trampoline1.fnName = 'wasi:http/types@0.2.11#setConnectTimeout';

const _trampoline2 = function(arg0, arg1, arg2) {
  var handle1 = arg0;
  
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-first-byte-timeout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setFirstByteTimeout(variant3),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
let variant4_0;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    variant4_0 = 0;
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    variant4_0 = 1;
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-first-byte-timeout"][Instruction::Return]', {
  funcName: '[method]request-options.set-first-byte-timeout',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant4_0]);
task.exit();
return variant4_0;
}
_trampoline2.fnName = 'wasi:http/types@0.2.11#setFirstByteTimeout';
const handleTable5 = [T_FLAG, 0];
const captureTable5= new Map();
let captureCnt5 = 0;
handleTables[5] = handleTable5;
const handleTable6 = [T_FLAG, 0];
const captureTable6= new Map();
let captureCnt6 = 0;
handleTables[6] = handleTable6;

const _trampoline3 = function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable5[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable5.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Fields.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  else {
    captureTable5.delete(rep2);
  }
  rscTableRemove(handleTable5, handle1);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[constructor]outgoing-request"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    const rep = ret[symbolRscRep] || ++captureCnt6;
    captureTable6.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable6, rep);
  }
  
  _debugLog('[iface="wasi:http/types@0.2.11", function="[constructor]outgoing-request"][Instruction::Return]', {
    funcName: '[constructor]outgoing-request',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle3]);
  task.exit();
  return handle3;
}
_trampoline3.fnName = 'wasi:http/types@0.2.11#new OutgoingRequest';
const handleTable8 = [T_FLAG, 0];
const captureTable8= new Map();
let captureCnt8 = 0;
handleTables[8] = handleTable8;
const handleTable0 = [T_FLAG, 0];
const captureTable0= new Map();
let captureCnt0 = 0;
handleTables[0] = handleTable0;

const _trampoline10 = function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable8[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable8.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(FutureIncomingResponse.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]future-incoming-response.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
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
  
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]future-incoming-response.subscribe"][Instruction::Return]', {
    funcName: '[method]future-incoming-response.subscribe',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle3]);
  task.exit();
  return handle3;
}
_trampoline10.fnName = 'wasi:http/types@0.2.11#subscribe';

const _trampoline11 = async function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable0.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Pollable.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/poll@0.2.11", function="[method]pollable.block"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      subtaskID: currentSubtask?.id(),
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    return task.completionPromise();
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  _debugLog('[iface="wasi:io/poll@0.2.11", function="[method]pollable.block"][Instruction::Return]', {
    funcName: '[method]pollable.block',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline11.fnName = 'wasi:io/poll@0.2.11#block';
_trampoline11.manuallyAsync = true;
const handleTable9 = [T_FLAG, 0];
const captureTable9= new Map();
let captureCnt9 = 0;
handleTables[9] = handleTable9;

const _trampoline12 = function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable9.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(IncomingResponse.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.status"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.status"][Instruction::Return]', {
    funcName: '[method]incoming-response.status',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([toUint16(ret)]);
  task.exit();
  return toUint16(ret);
}
_trampoline12.fnName = 'wasi:http/types@0.2.11#status';

const _trampoline13 = function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable9.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(IncomingResponse.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.headers"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  
  if (!(ret instanceof Fields)) {
    throw new TypeError('Resource error: Not a valid \"Headers\" resource.');
  }
  var handle3 = ret[symbolRscHandle];
  if (!handle3) {
    const rep = ret[symbolRscRep] || ++captureCnt5;
    captureTable5.set(rep, ret);
    handle3 = rscTableCreateOwn(handleTable5, rep);
  }
  
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.headers"][Instruction::Return]', {
    funcName: '[method]incoming-response.headers',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle3]);
  task.exit();
  return handle3;
}
_trampoline13.fnName = 'wasi:http/types@0.2.11#headers';

const _trampoline19 = function(arg0, arg1, arg2) {
  var handle1 = arg0;
  
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-between-bytes-timeout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setBetweenBytesTimeout(variant3),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
let variant4_0;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    variant4_0 = 0;
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    variant4_0 = 1;
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.set-between-bytes-timeout"][Instruction::Return]', {
  funcName: '[method]request-options.set-between-bytes-timeout',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant4_0]);
task.exit();
return variant4_0;
}
_trampoline19.fnName = 'wasi:http/types@0.2.11#setBetweenBytesTimeout';

const _trampoline23 = function(arg0) {
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
  _debugLog('[iface="wasi:cli/exit@0.2.11", function="exit"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  _debugLog('[iface="wasi:cli/exit@0.2.11", function="exit"][Instruction::Return]', {
    funcName: 'exit',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline23.fnName = 'wasi:cli/exit@0.2.11#exit';
const handleTable3 = [T_FLAG, 0];
const captureTable3= new Map();
let captureCnt3 = 0;
handleTables[3] = handleTable3;

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
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]input-stream.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
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
  
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]input-stream.subscribe"][Instruction::Return]', {
    funcName: '[method]input-stream.subscribe',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle3]);
  task.exit();
  return handle3;
}
_trampoline24.fnName = 'wasi:io/streams@0.2.11#subscribe';
const handleTable2 = [T_FLAG, 0];
const captureTable2= new Map();
let captureCnt2 = 0;
handleTables[2] = handleTable2;

const _trampoline25 = function(arg0) {
  var handle1 = arg0;
  
  var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable2.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.subscribe"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
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
  
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.subscribe"][Instruction::Return]', {
    funcName: '[method]output-stream.subscribe',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle3]);
  task.exit();
  return handle3;
}
_trampoline25.fnName = 'wasi:io/streams@0.2.11#subscribe';

const _trampoline26 = function() {
  _debugLog('[iface="wasi:cli/stdin@0.2.11", function="get-stdin"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  _debugLog('[iface="wasi:cli/stdin@0.2.11", function="get-stdin"][Instruction::Return]', {
    funcName: 'get-stdin',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline26.fnName = 'wasi:cli/stdin@0.2.11#getStdin';

const _trampoline27 = function() {
  _debugLog('[iface="wasi:cli/stdout@0.2.11", function="get-stdout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  _debugLog('[iface="wasi:cli/stdout@0.2.11", function="get-stdout"][Instruction::Return]', {
    funcName: 'get-stdout',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline27.fnName = 'wasi:cli/stdout@0.2.11#getStdout';

const _trampoline28 = function() {
  _debugLog('[iface="wasi:cli/stderr@0.2.11", function="get-stderr"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  _debugLog('[iface="wasi:cli/stderr@0.2.11", function="get-stderr"][Instruction::Return]', {
    funcName: 'get-stderr',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline28.fnName = 'wasi:cli/stderr@0.2.11#getStderr';

const _trampoline29 = function() {
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="now"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="now"][Instruction::Return]', {
    funcName: 'now',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([toUint64(ret)]);
  task.exit();
  return toUint64(ret);
}
_trampoline29.fnName = 'wasi:clocks/monotonic-clock@0.2.11#now';

const _trampoline30 = async function(arg0) {
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="subscribe-instant"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'subscribeInstant',
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
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  let ret;
  
  try {
    ret = await  _withGlobalCurrentTaskMetaAsync({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => subscribeInstant(BigInt.asUintN(64, BigInt(arg0))),
    })
    ;
  } catch (err) {
    
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
  
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="subscribe-instant"][Instruction::Return]', {
    funcName: 'subscribe-instant',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline30.fnName = 'wasi:clocks/monotonic-clock@0.2.11#subscribeInstant';
_trampoline30.manuallyAsync = true;

const _trampoline31 = async function(arg0) {
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="subscribe-duration"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      subtaskID: currentSubtask?.id(),
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
  
  _debugLog('[iface="wasi:clocks/monotonic-clock@0.2.11", function="subscribe-duration"][Instruction::Return]', {
    funcName: 'subscribe-duration',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline31.fnName = 'wasi:clocks/monotonic-clock@0.2.11#subscribeDuration';
_trampoline31.manuallyAsync = true;
let exports1;
let memory0;
let realloc0;
let realloc0Async;

const _trampoline32 = async function(arg0) {
  _debugLog('[iface="component:aws-cli/credentials-provider", function="provide-credentials"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  let ret;
  try {
    ret = { tag: 'ok', val: await  _withGlobalCurrentTaskMetaAsync({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => provideCredentials(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant10 = ret;
switch (variant10.tag) {
  case 'ok': {
    const e = variant10.val;
    dataView(memory0).setInt8(arg0 + 0, 0, true);
    var {accessKeyId: v0_0, secretAccessKey: v0_1, sessionToken: v0_2, expiresAfter: v0_3, accountId: v0_4 } = e;
    
    var encodeRes = _utf8AllocateAndEncode(v0_0, realloc0, memory0);
    var ptr1= encodeRes.ptr;
    var len1 = encodeRes.len;
    
    dataView(memory0).setUint32(arg0 + 12, len1, true);
    dataView(memory0).setUint32(arg0 + 8, ptr1, true);
    
    var encodeRes = _utf8AllocateAndEncode(v0_1, realloc0, memory0);
    var ptr2= encodeRes.ptr;
    var len2 = encodeRes.len;
    
    dataView(memory0).setUint32(arg0 + 20, len2, true);
    dataView(memory0).setUint32(arg0 + 16, ptr2, true);
    var variant4 = v0_2;
    if (variant4 === null || variant4=== undefined) {
      dataView(memory0).setInt8(arg0 + 24, 0, true);
    } else {
      const e = variant4;
      dataView(memory0).setInt8(arg0 + 24, 1, true);
      
      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
      var ptr3= encodeRes.ptr;
      var len3 = encodeRes.len;
      
      dataView(memory0).setUint32(arg0 + 32, len3, true);
      dataView(memory0).setUint32(arg0 + 28, ptr3, true);
    }
    var variant5 = v0_3;
    if (variant5 === null || variant5=== undefined) {
      dataView(memory0).setInt8(arg0 + 40, 0, true);
    } else {
      const e = variant5;
      dataView(memory0).setInt8(arg0 + 40, 1, true);
      dataView(memory0).setBigInt64(arg0 + 48, toUint64(e), true);
    }
    var variant7 = v0_4;
    if (variant7 === null || variant7=== undefined) {
      dataView(memory0).setInt8(arg0 + 56, 0, true);
    } else {
      const e = variant7;
      dataView(memory0).setInt8(arg0 + 56, 1, true);
      
      var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
      var ptr6= encodeRes.ptr;
      var len6 = encodeRes.len;
      
      dataView(memory0).setUint32(arg0 + 64, len6, true);
      dataView(memory0).setUint32(arg0 + 60, ptr6, true);
    }
    
    break;
  }
  case 'err': {
    const e = variant10.val;
    dataView(memory0).setInt8(arg0 + 0, 1, true);
    var variant9 = e;
    switch (variant9.tag) {
      case 'credentials-not-loaded': {
        dataView(memory0).setInt8(arg0 + 8, 0, true);
        break;
      }
      case 'provider-timed-out': {
        const e = variant9.val;
        dataView(memory0).setInt8(arg0 + 8, 1, true);
        var {duration: v8_0 } = e;
        dataView(memory0).setBigInt64(arg0 + 16, toUint64(v8_0), true);
        break;
      }
      case 'invalid-configuration': {
        dataView(memory0).setInt8(arg0 + 8, 2, true);
        break;
      }
      case 'provider-error': {
        dataView(memory0).setInt8(arg0 + 8, 3, true);
        break;
      }
      case 'unhandled': {
        dataView(memory0).setInt8(arg0 + 8, 4, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant9.tag)}\` (received \`${variant9}\`) specified for \`CredentialsError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant10, valueType: typeof variant10});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="component:aws-cli/credentials-provider", function="provide-credentials"][Instruction::Return]', {
  funcName: 'provide-credentials',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline32.fnName = 'component:aws-cli/credentials-provider#provideCredentials';
_trampoline32.manuallyAsync = true;

const _trampoline33 = function(arg0) {
  _debugLog('[iface="wasi:random/insecure-seed@0.2.11", function="insecure-seed"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  var [tuple0_0, tuple0_1] = ret;
  dataView(memory0).setBigInt64(arg0 + 0, toUint64(tuple0_0), true);
  dataView(memory0).setBigInt64(arg0 + 8, toUint64(tuple0_1), true);
  _debugLog('[iface="wasi:random/insecure-seed@0.2.11", function="insecure-seed"][Instruction::Return]', {
    funcName: 'insecure-seed',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline33.fnName = 'wasi:random/insecure-seed@0.2.11#insecureSeed';

const _trampoline34 = function(arg0, arg1, arg2) {
  var len2 = arg1;
  var base2 = arg0;
  var result2 = [];
  for (let i = 0; i < len2; i++) {
    const base = base2 + i * 16;
    var ptr0 = dataView(memory0).getUint32(base + 0, true);
    var len0 = dataView(memory0).getUint32(base + 4, true);
    var result0 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr0, len0));
    var ptr1 = dataView(memory0).getUint32(base + 8, true);
    var len1 = dataView(memory0).getUint32(base + 12, true);
    var result1 = new Uint8Array(memory0.buffer.slice(ptr1, ptr1 + len1 * 1));
    result2.push([result0, result1]);
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[static]fields.from-list"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'Fields.fromList',
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => Fields.fromList(result2),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 0, true);
    
    if (!(e instanceof Fields)) {
      throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt5;
      captureTable5.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable5, rep);
    }
    
    dataView(memory0).setInt32(arg2 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 1, true);
    var variant4 = e;
    switch (variant4.tag) {
      case 'invalid-syntax': {
        dataView(memory0).setInt8(arg2 + 4, 0, true);
        break;
      }
      case 'forbidden': {
        dataView(memory0).setInt8(arg2 + 4, 1, true);
        break;
      }
      case 'immutable': {
        dataView(memory0).setInt8(arg2 + 4, 2, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`HeaderError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[static]fields.from-list"][Instruction::Return]', {
  funcName: '[static]fields.from-list',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline34.fnName = 'wasi:http/types@0.2.11#Fields.fromList';

const _trampoline35 = function(arg0, arg1, arg2, arg3, arg4) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-scheme"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setScheme(variant5),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-scheme"][Instruction::Return]', {
  funcName: '[method]outgoing-request.set-scheme',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant6_0]);
task.exit();
return variant6_0;
}
_trampoline35.fnName = 'wasi:http/types@0.2.11#setScheme';

const _trampoline36 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-method"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setMethod(variant4),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-method"][Instruction::Return]', {
  funcName: '[method]outgoing-request.set-method',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant5_0]);
task.exit();
return variant5_0;
}
_trampoline36.fnName = 'wasi:http/types@0.2.11#setMethod';

const _trampoline37 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-path-with-query"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setPathWithQuery(variant4),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-path-with-query"][Instruction::Return]', {
  funcName: '[method]outgoing-request.set-path-with-query',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant5_0]);
task.exit();
return variant5_0;
}
_trampoline37.fnName = 'wasi:http/types@0.2.11#setPathWithQuery';

const _trampoline38 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-authority"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.setAuthority(variant4),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.set-authority"][Instruction::Return]', {
  funcName: '[method]outgoing-request.set-authority',
  paramCount: 1,
  async: false,
  postReturn: false
});
task.resolve([variant5_0]);
task.exit();
return variant5_0;
}
_trampoline38.fnName = 'wasi:http/types@0.2.11#setAuthority';
const handleTable7 = [T_FLAG, 0];
const captureTable7= new Map();
let captureCnt7 = 0;
handleTables[7] = handleTable7;

const _trampoline39 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutgoingRequest.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.body"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.body(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    
    if (!(e instanceof OutgoingBody)) {
      throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt7;
      captureTable7.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable7, rep);
    }
    
    dataView(memory0).setInt32(arg1 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-request.body"][Instruction::Return]', {
  funcName: '[method]outgoing-request.body',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline39.fnName = 'wasi:http/types@0.2.11#body';

const _trampoline40 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable7.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutgoingBody.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-body.write"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.write(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    
    if (!(e instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable2, rep);
    }
    
    dataView(memory0).setInt32(arg1 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]outgoing-body.write"][Instruction::Return]', {
  funcName: '[method]outgoing-body.write',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline40.fnName = 'wasi:http/types@0.2.11#write';

const _trampoline41 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable8[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable8.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(FutureIncomingResponse.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]future-incoming-response.get"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]future-incoming-response.get"][Instruction::Return]', {
    funcName: '[method]future-incoming-response.get',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline41.fnName = 'wasi:http/types@0.2.11#get';

const _trampoline42 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable5[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable5.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Fields.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]fields.entries"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
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
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]fields.entries"][Instruction::Return]', {
    funcName: '[method]fields.entries',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline42.fnName = 'wasi:http/types@0.2.11#entries';
const handleTable10 = [T_FLAG, 0];
const captureTable10= new Map();
let captureCnt10 = 0;
handleTables[10] = handleTable10;

const _trampoline43 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable9[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable9.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(IncomingResponse.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.consume"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.consume(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    
    if (!(e instanceof IncomingBody)) {
      throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt10;
      captureTable10.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable10, rep);
    }
    
    dataView(memory0).setInt32(arg1 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-response.consume"][Instruction::Return]', {
  funcName: '[method]incoming-response.consume',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline43.fnName = 'wasi:http/types@0.2.11#consume';

const _trampoline44 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable10[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable10.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(IncomingBody.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-body.stream"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.stream(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant4 = ret;
switch (variant4.tag) {
  case 'ok': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    
    if (!(e instanceof InputStream)) {
      throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable3, rep);
    }
    
    dataView(memory0).setInt32(arg1 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant4.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant4, valueType: typeof variant4});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[method]incoming-body.stream"][Instruction::Return]', {
  funcName: '[method]incoming-body.stream',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline44.fnName = 'wasi:http/types@0.2.11#stream';

const _trampoline45 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(RequestOptions.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.between-bytes-timeout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'betweenBytesTimeout',
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
      fn: () => rsc0.betweenBytesTimeout(),
    })
    ;
  } catch (err) {
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  var variant3 = ret;
  if (variant3 === null || variant3=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant3;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.between-bytes-timeout"][Instruction::Return]', {
    funcName: '[method]request-options.between-bytes-timeout',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline45.fnName = 'wasi:http/types@0.2.11#betweenBytesTimeout';

const _trampoline46 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(RequestOptions.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.connect-timeout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'connectTimeout',
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
      fn: () => rsc0.connectTimeout(),
    })
    ;
  } catch (err) {
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  var variant3 = ret;
  if (variant3 === null || variant3=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant3;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.connect-timeout"][Instruction::Return]', {
    funcName: '[method]request-options.connect-timeout',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline46.fnName = 'wasi:http/types@0.2.11#connectTimeout';

const _trampoline47 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable4[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable4.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(RequestOptions.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.first-byte-timeout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'firstByteTimeout',
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
      fn: () => rsc0.firstByteTimeout(),
    })
    ;
  } catch (err) {
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  for (const rsc of curResourceBorrows) {
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  var variant3 = ret;
  if (variant3 === null || variant3=== undefined) {
    dataView(memory0).setInt8(arg1 + 0, 0, true);
  } else {
    const e = variant3;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[method]request-options.first-byte-timeout"][Instruction::Return]', {
    funcName: '[method]request-options.first-byte-timeout',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline47.fnName = 'wasi:http/types@0.2.11#firstByteTimeout';

const _trampoline48 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable7[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable7.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutgoingBody.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  else {
    captureTable7.delete(rep2);
  }
  rscTableRemove(handleTable7, handle1);
  let variant6;
  switch (arg1) {
    case 0: {
      variant6 = undefined;
      break;
    }
    case 1: {
      var handle4 = arg2;
      
      var rep5 = handleTable5[(handle4 << 1) + 1] & ~T_FLAG;
      var rsc3 = captureTable5.get(rep5);
      if (!rsc3) {
        rsc3 = Object.create(Fields.prototype);
        Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
        Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
      }
      
      else {
        captureTable5.delete(rep5);
      }
      rscTableRemove(handleTable5, handle4);
      variant6 = rsc3;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:http/types@0.2.11", function="[static]outgoing-body.finish"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => OutgoingBody.finish(rsc0, variant6),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant45 = ret;
switch (variant45.tag) {
  case 'ok': {
    const e = variant45.val;
    dataView(memory0).setInt8(arg3 + 0, 0, true);
    
    break;
  }
  case 'err': {
    const e = variant45.val;
    dataView(memory0).setInt8(arg3 + 0, 1, true);
    var variant44 = e;
    switch (variant44.tag) {
      case 'DNS-timeout': {
        dataView(memory0).setInt8(arg3 + 8, 0, true);
        break;
      }
      case 'DNS-error': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 1, true);
        var {rcode: v7_0, infoCode: v7_1 } = e;
        var variant9 = v7_0;
        if (variant9 === null || variant9=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant9;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr8= encodeRes.ptr;
          var len8 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 24, len8, true);
          dataView(memory0).setUint32(arg3 + 20, ptr8, true);
        }
        var variant10 = v7_1;
        if (variant10 === null || variant10=== undefined) {
          dataView(memory0).setInt8(arg3 + 28, 0, true);
        } else {
          const e = variant10;
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
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 14, true);
        var {alertId: v11_0, alertMessage: v11_1 } = e;
        var variant12 = v11_0;
        if (variant12 === null || variant12=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant12;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setInt8(arg3 + 17, toUint8(e), true);
        }
        var variant14 = v11_1;
        if (variant14 === null || variant14=== undefined) {
          dataView(memory0).setInt8(arg3 + 20, 0, true);
        } else {
          const e = variant14;
          dataView(memory0).setInt8(arg3 + 20, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr13= encodeRes.ptr;
          var len13 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 28, len13, true);
          dataView(memory0).setUint32(arg3 + 24, ptr13, true);
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
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 17, true);
        var variant15 = e;
        if (variant15 === null || variant15=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant15;
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
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 21, true);
        var variant16 = e;
        if (variant16 === null || variant16=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant16;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-request-header-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 22, true);
        var variant21 = e;
        if (variant21 === null || variant21=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant21;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          var {fieldName: v17_0, fieldSize: v17_1 } = e;
          var variant19 = v17_0;
          if (variant19 === null || variant19=== undefined) {
            dataView(memory0).setInt8(arg3 + 20, 0, true);
          } else {
            const e = variant19;
            dataView(memory0).setInt8(arg3 + 20, 1, true);
            
            var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
            var ptr18= encodeRes.ptr;
            var len18 = encodeRes.len;
            
            dataView(memory0).setUint32(arg3 + 28, len18, true);
            dataView(memory0).setUint32(arg3 + 24, ptr18, true);
          }
          var variant20 = v17_1;
          if (variant20 === null || variant20=== undefined) {
            dataView(memory0).setInt8(arg3 + 32, 0, true);
          } else {
            const e = variant20;
            dataView(memory0).setInt8(arg3 + 32, 1, true);
            dataView(memory0).setInt32(arg3 + 36, toUint32(e), true);
          }
        }
        break;
      }
      case 'HTTP-request-trailer-section-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 23, true);
        var variant22 = e;
        if (variant22 === null || variant22=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant22;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-request-trailer-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 24, true);
        var {fieldName: v23_0, fieldSize: v23_1 } = e;
        var variant25 = v23_0;
        if (variant25 === null || variant25=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant25;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr24= encodeRes.ptr;
          var len24 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 24, len24, true);
          dataView(memory0).setUint32(arg3 + 20, ptr24, true);
        }
        var variant26 = v23_1;
        if (variant26 === null || variant26=== undefined) {
          dataView(memory0).setInt8(arg3 + 28, 0, true);
        } else {
          const e = variant26;
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
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 26, true);
        var variant27 = e;
        if (variant27 === null || variant27=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant27;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-response-header-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 27, true);
        var {fieldName: v28_0, fieldSize: v28_1 } = e;
        var variant30 = v28_0;
        if (variant30 === null || variant30=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant30;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr29= encodeRes.ptr;
          var len29 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 24, len29, true);
          dataView(memory0).setUint32(arg3 + 20, ptr29, true);
        }
        var variant31 = v28_1;
        if (variant31 === null || variant31=== undefined) {
          dataView(memory0).setInt8(arg3 + 28, 0, true);
        } else {
          const e = variant31;
          dataView(memory0).setInt8(arg3 + 28, 1, true);
          dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-response-body-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 28, true);
        var variant32 = e;
        if (variant32 === null || variant32=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant32;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setBigInt64(arg3 + 24, toUint64(e), true);
        }
        break;
      }
      case 'HTTP-response-trailer-section-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 29, true);
        var variant33 = e;
        if (variant33 === null || variant33=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant33;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          dataView(memory0).setInt32(arg3 + 20, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-response-trailer-size': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 30, true);
        var {fieldName: v34_0, fieldSize: v34_1 } = e;
        var variant36 = v34_0;
        if (variant36 === null || variant36=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant36;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr35= encodeRes.ptr;
          var len35 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 24, len35, true);
          dataView(memory0).setUint32(arg3 + 20, ptr35, true);
        }
        var variant37 = v34_1;
        if (variant37 === null || variant37=== undefined) {
          dataView(memory0).setInt8(arg3 + 28, 0, true);
        } else {
          const e = variant37;
          dataView(memory0).setInt8(arg3 + 28, 1, true);
          dataView(memory0).setInt32(arg3 + 32, toUint32(e), true);
        }
        break;
      }
      case 'HTTP-response-transfer-coding': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 31, true);
        var variant39 = e;
        if (variant39 === null || variant39=== undefined) {
          dataView(memory0).setInt8(arg3 + 16, 0, true);
        } else {
          const e = variant39;
          dataView(memory0).setInt8(arg3 + 16, 1, true);
          
          var encodeRes = _utf8AllocateAndEncode(e, realloc0, memory0);
          var ptr38= encodeRes.ptr;
          var len38 = encodeRes.len;
          
          dataView(memory0).setUint32(arg3 + 24, len38, true);
          dataView(memory0).setUint32(arg3 + 20, ptr38, true);
        }
        break;
      }
      case 'HTTP-response-content-coding': {
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 32, true);
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
        const e = variant44.val;
        dataView(memory0).setInt8(arg3 + 8, 38, true);
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
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant44.tag)}\` (received \`${variant44}\`) specified for \`ErrorCode\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant45, valueType: typeof variant45});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:http/types@0.2.11", function="[static]outgoing-body.finish"][Instruction::Return]', {
  funcName: '[static]outgoing-body.finish',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline48.fnName = 'wasi:http/types@0.2.11#OutgoingBody.finish';
const handleTable1 = [T_FLAG, 0];
const captureTable1= new Map();
let captureCnt1 = 0;
handleTables[1] = handleTable1;

const _trampoline49 = async function(arg0, arg1, arg2, arg3) {
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
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'blockingWriteAndFlush',
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
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  let ret;
  try {
    ret = { tag: 'ok', val: await  _withGlobalCurrentTaskMetaAsync({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.blockingWriteAndFlush(result3),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
    var variant5 = e;
    switch (variant5.tag) {
      case 'last-operation-failed': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg3 + 4, 0, true);
        
        if (!(e instanceof Error$1)) {
          throw new TypeError('Resource error: Not a valid \"Error\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable1, rep);
        }
        
        dataView(memory0).setInt32(arg3 + 8, handle4, true);
        break;
      }
      case 'closed': {
        dataView(memory0).setInt8(arg3 + 4, 1, true);
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
_debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.blocking-write-and-flush"][Instruction::Return]', {
  funcName: '[method]output-stream.blocking-write-and-flush',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline49.fnName = 'wasi:io/streams@0.2.11#blockingWriteAndFlush';
_trampoline49.manuallyAsync = true;

const _trampoline50 = async function(arg0, arg1, arg2) {
  var handle1 = arg0;
  
  var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable3.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(InputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]input-stream.blocking-read"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'blockingRead',
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
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  let ret;
  try {
    ret = { tag: 'ok', val: await  _withGlobalCurrentTaskMetaAsync({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.blockingRead(BigInt.asUintN(64, BigInt(arg1))),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant6 = ret;
switch (variant6.tag) {
  case 'ok': {
    const e = variant6.val;
    dataView(memory0).setInt8(arg2 + 0, 0, true);
    var val3 = e;
    var len3 = Array.isArray(val3) ? val3.length : val3.byteLength;
    var ptr3 = realloc0(0, 0, 1, len3 * 1);
    
    let valData3;
    const valLenBytes3 = len3 * 1;
    if (Array.isArray(val3)) {
      // Regular array likely containing numbers, write values to memory
      let offset = 0;
      const dv3 = new DataView(memory0.buffer);
      for (const v of val3) {
        _requireValidNumericPrimitive.bind(null, 'u8')(v);
        dv3.setUint8(ptr3+ offset, v, true);
        offset += 1;
      }
    } else {
      // TypedArray / ArrayBuffer-like, direct copy
      valData3 = new Uint8Array(val3.buffer || val3, val3.byteOffset, valLenBytes3);
      const out3 = new Uint8Array(memory0.buffer, ptr3, valLenBytes3);
      out3.set(valData3);
    }
    
    dataView(memory0).setUint32(arg2 + 8, len3, true);
    dataView(memory0).setUint32(arg2 + 4, ptr3, true);
    
    break;
  }
  case 'err': {
    const e = variant6.val;
    dataView(memory0).setInt8(arg2 + 0, 1, true);
    var variant5 = e;
    switch (variant5.tag) {
      case 'last-operation-failed': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 4, 0, true);
        
        if (!(e instanceof Error$1)) {
          throw new TypeError('Resource error: Not a valid \"Error\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable1, rep);
        }
        
        dataView(memory0).setInt32(arg2 + 8, handle4, true);
        break;
      }
      case 'closed': {
        dataView(memory0).setInt8(arg2 + 4, 1, true);
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
_debugLog('[iface="wasi:io/streams@0.2.11", function="[method]input-stream.blocking-read"][Instruction::Return]', {
  funcName: '[method]input-stream.blocking-read',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline50.fnName = 'wasi:io/streams@0.2.11#blockingRead';
_trampoline50.manuallyAsync = true;

const _trampoline51 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable2.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.check-write"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.checkWrite(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var variant4 = e;
    switch (variant4.tag) {
      case 'last-operation-failed': {
        const e = variant4.val;
        dataView(memory0).setInt8(arg1 + 8, 0, true);
        
        if (!(e instanceof Error$1)) {
          throw new TypeError('Resource error: Not a valid \"Error\" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable1, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 12, handle3, true);
        break;
      }
      case 'closed': {
        dataView(memory0).setInt8(arg1 + 8, 1, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.check-write"][Instruction::Return]', {
  funcName: '[method]output-stream.check-write',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline51.fnName = 'wasi:io/streams@0.2.11#checkWrite';

const _trampoline52 = function(arg0, arg1, arg2, arg3) {
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
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.write"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.write(result3),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
    var variant5 = e;
    switch (variant5.tag) {
      case 'last-operation-failed': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg3 + 4, 0, true);
        
        if (!(e instanceof Error$1)) {
          throw new TypeError('Resource error: Not a valid \"Error\" resource.');
        }
        var handle4 = e[symbolRscHandle];
        if (!handle4) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle4 = rscTableCreateOwn(handleTable1, rep);
        }
        
        dataView(memory0).setInt32(arg3 + 8, handle4, true);
        break;
      }
      case 'closed': {
        dataView(memory0).setInt8(arg3 + 4, 1, true);
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
_debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.write"][Instruction::Return]', {
  funcName: '[method]output-stream.write',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline52.fnName = 'wasi:io/streams@0.2.11#write';

const _trampoline53 = async function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable2[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable2.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  let ret;
  try {
    ret = { tag: 'ok', val: await  _withGlobalCurrentTaskMetaAsync({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.blockingFlush(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var variant4 = e;
    switch (variant4.tag) {
      case 'last-operation-failed': {
        const e = variant4.val;
        dataView(memory0).setInt8(arg1 + 4, 0, true);
        
        if (!(e instanceof Error$1)) {
          throw new TypeError('Resource error: Not a valid \"Error\" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt1;
          captureTable1.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable1, rep);
        }
        
        dataView(memory0).setInt32(arg1 + 8, handle3, true);
        break;
      }
      case 'closed': {
        dataView(memory0).setInt8(arg1 + 4, 1, true);
        break;
      }
      default: {
        throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
      }
    }
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:io/streams@0.2.11", function="[method]output-stream.blocking-flush"][Instruction::Return]', {
  funcName: '[method]output-stream.blocking-flush',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline53.fnName = 'wasi:io/streams@0.2.11#blockingFlush';
_trampoline53.manuallyAsync = true;

const _trampoline54 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable6.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutgoingRequest.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  else {
    captureTable6.delete(rep2);
  }
  rscTableRemove(handleTable6, handle1);
  let variant6;
  switch (arg1) {
    case 0: {
      variant6 = undefined;
      break;
    }
    case 1: {
      var handle4 = arg2;
      
      var rep5 = handleTable4[(handle4 << 1) + 1] & ~T_FLAG;
      var rsc3 = captureTable4.get(rep5);
      if (!rsc3) {
        rsc3 = Object.create(RequestOptions.prototype);
        Object.defineProperty(rsc3, symbolRscHandle, { writable: true, value: handle4});
        Object.defineProperty(rsc3, symbolRscRep, { writable: true, value: rep5});
      }
      
      else {
        captureTable4.delete(rep5);
      }
      rscTableRemove(handleTable4, handle4);
      variant6 = rsc3;
      break;
    }
    default: {
      throw new TypeError('invalid variant discriminant for option');
    }
  }
  _debugLog('[iface="wasi:http/outgoing-handler@0.2.11", function="handle"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => handle(rsc0, variant6),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

var variant46 = ret;
switch (variant46.tag) {
  case 'ok': {
    const e = variant46.val;
    dataView(memory0).setInt8(arg3 + 0, 0, true);
    
    if (!(e instanceof FutureIncomingResponse)) {
      throw new TypeError('Resource error: Not a valid \"FutureIncomingResponse\" resource.');
    }
    var handle7 = e[symbolRscHandle];
    if (!handle7) {
      const rep = e[symbolRscRep] || ++captureCnt8;
      captureTable8.set(rep, e);
      handle7 = rscTableCreateOwn(handleTable8, rep);
    }
    
    dataView(memory0).setInt32(arg3 + 8, handle7, true);
    
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
_debugLog('[iface="wasi:http/outgoing-handler@0.2.11", function="handle"][Instruction::Return]', {
  funcName: 'handle',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline54.fnName = 'wasi:http/outgoing-handler@0.2.11#handle';

const _trampoline55 = function(arg0) {
  _debugLog('[iface="wasi:cli/environment@0.2.11", function="get-arguments"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  _debugLog('[iface="wasi:cli/environment@0.2.11", function="get-arguments"][Instruction::Return]', {
    funcName: 'get-arguments',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline55.fnName = 'wasi:cli/environment@0.2.11#getArguments';
const handleTable13 = [T_FLAG, 0];
const captureTable13= new Map();
let captureCnt13 = 0;
handleTables[13] = handleTable13;

const _trampoline56 = function(arg0, arg1, arg2) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.read-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.readViaStream(BigInt.asUintN(64, BigInt(arg1))),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 0, true);
    
    if (!(e instanceof InputStream)) {
      throw new TypeError('Resource error: Not a valid \"InputStream\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable3, rep);
    }
    
    dataView(memory0).setInt32(arg2 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg2 + 4, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.read-via-stream"][Instruction::Return]', {
  funcName: '[method]descriptor.read-via-stream',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline56.fnName = 'wasi:filesystem/types@0.2.11#readViaStream';

const _trampoline57 = function(arg0, arg1, arg2) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.writeViaStream(BigInt.asUintN(64, BigInt(arg1))),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 0, true);
    
    if (!(e instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
    }
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable2, rep);
    }
    
    dataView(memory0).setInt32(arg2 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg2 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg2 + 4, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.write-via-stream"][Instruction::Return]', {
  funcName: '[method]descriptor.write-via-stream',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline57.fnName = 'wasi:filesystem/types@0.2.11#writeViaStream';

const _trampoline58 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.appendViaStream(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
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
    var handle3 = e[symbolRscHandle];
    if (!handle3) {
      const rep = e[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, e);
      handle3 = rscTableCreateOwn(handleTable2, rep);
    }
    
    dataView(memory0).setInt32(arg1 + 4, handle3, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg1 + 4, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.append-via-stream"][Instruction::Return]', {
  funcName: '[method]descriptor.append-via-stream',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline58.fnName = 'wasi:filesystem/types@0.2.11#appendViaStream';

const _trampoline59 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.get-flags"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.getFlags(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    let flags3 = 0;
    if (typeof e === 'object' && e !== null) {
      flags3 = Boolean(e.read) << 0 | Boolean(e.write) << 1 | Boolean(e.fileIntegritySync) << 2 | Boolean(e.dataIntegritySync) << 3 | Boolean(e.requestedWriteSync) << 4 | Boolean(e.mutateDirectory) << 5;
    } else if (e !== null && e!== undefined) {
      throw new TypeError('only an object, undefined or null can be converted to flags');
    }
    dataView(memory0).setInt8(arg1 + 1, flags3, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg1 + 1, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.get-flags"][Instruction::Return]', {
  funcName: '[method]descriptor.get-flags',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline59.fnName = 'wasi:filesystem/types@0.2.11#getFlags';

const _trampoline60 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  var result3 = TEXT_DECODER_UTF8.decode(new Uint8Array(memory0.buffer, ptr3, len3));
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.create-directory-at"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.createDirectoryAt(result3),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg3 + 0, 0, true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg3 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg3 + 1, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.create-directory-at"][Instruction::Return]', {
  funcName: '[method]descriptor.create-directory-at',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline60.fnName = 'wasi:filesystem/types@0.2.11#createDirectoryAt';

const _trampoline61 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.stat"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.stat(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant12 = ret;
switch (variant12.tag) {
  case 'ok': {
    const e = variant12.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    var {type: v3_0, linkCount: v3_1, size: v3_2, dataAccessTimestamp: v3_3, dataModificationTimestamp: v3_4, statusChangeTimestamp: v3_5 } = e;
    var val4 = v3_0;
    let enum4;
    switch (val4) {
      case 'unknown': {
        enum4 = 0;
        break;
      }
      case 'block-device': {
        enum4 = 1;
        break;
      }
      case 'character-device': {
        enum4 = 2;
        break;
      }
      case 'directory': {
        enum4 = 3;
        break;
      }
      case 'fifo': {
        enum4 = 4;
        break;
      }
      case 'symbolic-link': {
        enum4 = 5;
        break;
      }
      case 'regular-file': {
        enum4 = 6;
        break;
      }
      case 'socket': {
        enum4 = 7;
        break;
      }
      default: {
        if ((v3_0) instanceof Error) {
          console.error(v3_0);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of descriptor-type`);
      }
    }
    dataView(memory0).setInt8(arg1 + 8, enum4, true);
    dataView(memory0).setBigInt64(arg1 + 16, toUint64(v3_1), true);
    dataView(memory0).setBigInt64(arg1 + 24, toUint64(v3_2), true);
    var variant6 = v3_3;
    if (variant6 === null || variant6=== undefined) {
      dataView(memory0).setInt8(arg1 + 32, 0, true);
    } else {
      const e = variant6;
      dataView(memory0).setInt8(arg1 + 32, 1, true);
      var {seconds: v5_0, nanoseconds: v5_1 } = e;
      dataView(memory0).setBigInt64(arg1 + 40, toUint64(v5_0), true);
      dataView(memory0).setInt32(arg1 + 48, toUint32(v5_1), true);
    }
    var variant8 = v3_4;
    if (variant8 === null || variant8=== undefined) {
      dataView(memory0).setInt8(arg1 + 56, 0, true);
    } else {
      const e = variant8;
      dataView(memory0).setInt8(arg1 + 56, 1, true);
      var {seconds: v7_0, nanoseconds: v7_1 } = e;
      dataView(memory0).setBigInt64(arg1 + 64, toUint64(v7_0), true);
      dataView(memory0).setInt32(arg1 + 72, toUint32(v7_1), true);
    }
    var variant10 = v3_5;
    if (variant10 === null || variant10=== undefined) {
      dataView(memory0).setInt8(arg1 + 80, 0, true);
    } else {
      const e = variant10;
      dataView(memory0).setInt8(arg1 + 80, 1, true);
      var {seconds: v9_0, nanoseconds: v9_1 } = e;
      dataView(memory0).setBigInt64(arg1 + 88, toUint64(v9_0), true);
      dataView(memory0).setInt32(arg1 + 96, toUint32(v9_1), true);
    }
    
    break;
  }
  case 'err': {
    const e = variant12.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var val11 = e;
    let enum11;
    switch (val11) {
      case 'access': {
        enum11 = 0;
        break;
      }
      case 'would-block': {
        enum11 = 1;
        break;
      }
      case 'already': {
        enum11 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum11 = 3;
        break;
      }
      case 'busy': {
        enum11 = 4;
        break;
      }
      case 'deadlock': {
        enum11 = 5;
        break;
      }
      case 'quota': {
        enum11 = 6;
        break;
      }
      case 'exist': {
        enum11 = 7;
        break;
      }
      case 'file-too-large': {
        enum11 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum11 = 9;
        break;
      }
      case 'in-progress': {
        enum11 = 10;
        break;
      }
      case 'interrupted': {
        enum11 = 11;
        break;
      }
      case 'invalid': {
        enum11 = 12;
        break;
      }
      case 'io': {
        enum11 = 13;
        break;
      }
      case 'is-directory': {
        enum11 = 14;
        break;
      }
      case 'loop': {
        enum11 = 15;
        break;
      }
      case 'too-many-links': {
        enum11 = 16;
        break;
      }
      case 'message-size': {
        enum11 = 17;
        break;
      }
      case 'name-too-long': {
        enum11 = 18;
        break;
      }
      case 'no-device': {
        enum11 = 19;
        break;
      }
      case 'no-entry': {
        enum11 = 20;
        break;
      }
      case 'no-lock': {
        enum11 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum11 = 22;
        break;
      }
      case 'insufficient-space': {
        enum11 = 23;
        break;
      }
      case 'not-directory': {
        enum11 = 24;
        break;
      }
      case 'not-empty': {
        enum11 = 25;
        break;
      }
      case 'not-recoverable': {
        enum11 = 26;
        break;
      }
      case 'unsupported': {
        enum11 = 27;
        break;
      }
      case 'no-tty': {
        enum11 = 28;
        break;
      }
      case 'no-such-device': {
        enum11 = 29;
        break;
      }
      case 'overflow': {
        enum11 = 30;
        break;
      }
      case 'not-permitted': {
        enum11 = 31;
        break;
      }
      case 'pipe': {
        enum11 = 32;
        break;
      }
      case 'read-only': {
        enum11 = 33;
        break;
      }
      case 'invalid-seek': {
        enum11 = 34;
        break;
      }
      case 'text-file-busy': {
        enum11 = 35;
        break;
      }
      case 'cross-device': {
        enum11 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val11}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg1 + 8, enum11, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant12, valueType: typeof variant12});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.stat"][Instruction::Return]', {
  funcName: '[method]descriptor.stat',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline61.fnName = 'wasi:filesystem/types@0.2.11#stat';

const _trampoline62 = function(arg0, arg1, arg2, arg3, arg4) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
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
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.stat-at"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.statAt(flags3, result4),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant14 = ret;
switch (variant14.tag) {
  case 'ok': {
    const e = variant14.val;
    dataView(memory0).setInt8(arg4 + 0, 0, true);
    var {type: v5_0, linkCount: v5_1, size: v5_2, dataAccessTimestamp: v5_3, dataModificationTimestamp: v5_4, statusChangeTimestamp: v5_5 } = e;
    var val6 = v5_0;
    let enum6;
    switch (val6) {
      case 'unknown': {
        enum6 = 0;
        break;
      }
      case 'block-device': {
        enum6 = 1;
        break;
      }
      case 'character-device': {
        enum6 = 2;
        break;
      }
      case 'directory': {
        enum6 = 3;
        break;
      }
      case 'fifo': {
        enum6 = 4;
        break;
      }
      case 'symbolic-link': {
        enum6 = 5;
        break;
      }
      case 'regular-file': {
        enum6 = 6;
        break;
      }
      case 'socket': {
        enum6 = 7;
        break;
      }
      default: {
        if ((v5_0) instanceof Error) {
          console.error(v5_0);
        }
        
        throw new TypeError(`"${val6}" is not one of the cases of descriptor-type`);
      }
    }
    dataView(memory0).setInt8(arg4 + 8, enum6, true);
    dataView(memory0).setBigInt64(arg4 + 16, toUint64(v5_1), true);
    dataView(memory0).setBigInt64(arg4 + 24, toUint64(v5_2), true);
    var variant8 = v5_3;
    if (variant8 === null || variant8=== undefined) {
      dataView(memory0).setInt8(arg4 + 32, 0, true);
    } else {
      const e = variant8;
      dataView(memory0).setInt8(arg4 + 32, 1, true);
      var {seconds: v7_0, nanoseconds: v7_1 } = e;
      dataView(memory0).setBigInt64(arg4 + 40, toUint64(v7_0), true);
      dataView(memory0).setInt32(arg4 + 48, toUint32(v7_1), true);
    }
    var variant10 = v5_4;
    if (variant10 === null || variant10=== undefined) {
      dataView(memory0).setInt8(arg4 + 56, 0, true);
    } else {
      const e = variant10;
      dataView(memory0).setInt8(arg4 + 56, 1, true);
      var {seconds: v9_0, nanoseconds: v9_1 } = e;
      dataView(memory0).setBigInt64(arg4 + 64, toUint64(v9_0), true);
      dataView(memory0).setInt32(arg4 + 72, toUint32(v9_1), true);
    }
    var variant12 = v5_5;
    if (variant12 === null || variant12=== undefined) {
      dataView(memory0).setInt8(arg4 + 80, 0, true);
    } else {
      const e = variant12;
      dataView(memory0).setInt8(arg4 + 80, 1, true);
      var {seconds: v11_0, nanoseconds: v11_1 } = e;
      dataView(memory0).setBigInt64(arg4 + 88, toUint64(v11_0), true);
      dataView(memory0).setInt32(arg4 + 96, toUint32(v11_1), true);
    }
    
    break;
  }
  case 'err': {
    const e = variant14.val;
    dataView(memory0).setInt8(arg4 + 0, 1, true);
    var val13 = e;
    let enum13;
    switch (val13) {
      case 'access': {
        enum13 = 0;
        break;
      }
      case 'would-block': {
        enum13 = 1;
        break;
      }
      case 'already': {
        enum13 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum13 = 3;
        break;
      }
      case 'busy': {
        enum13 = 4;
        break;
      }
      case 'deadlock': {
        enum13 = 5;
        break;
      }
      case 'quota': {
        enum13 = 6;
        break;
      }
      case 'exist': {
        enum13 = 7;
        break;
      }
      case 'file-too-large': {
        enum13 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum13 = 9;
        break;
      }
      case 'in-progress': {
        enum13 = 10;
        break;
      }
      case 'interrupted': {
        enum13 = 11;
        break;
      }
      case 'invalid': {
        enum13 = 12;
        break;
      }
      case 'io': {
        enum13 = 13;
        break;
      }
      case 'is-directory': {
        enum13 = 14;
        break;
      }
      case 'loop': {
        enum13 = 15;
        break;
      }
      case 'too-many-links': {
        enum13 = 16;
        break;
      }
      case 'message-size': {
        enum13 = 17;
        break;
      }
      case 'name-too-long': {
        enum13 = 18;
        break;
      }
      case 'no-device': {
        enum13 = 19;
        break;
      }
      case 'no-entry': {
        enum13 = 20;
        break;
      }
      case 'no-lock': {
        enum13 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum13 = 22;
        break;
      }
      case 'insufficient-space': {
        enum13 = 23;
        break;
      }
      case 'not-directory': {
        enum13 = 24;
        break;
      }
      case 'not-empty': {
        enum13 = 25;
        break;
      }
      case 'not-recoverable': {
        enum13 = 26;
        break;
      }
      case 'unsupported': {
        enum13 = 27;
        break;
      }
      case 'no-tty': {
        enum13 = 28;
        break;
      }
      case 'no-such-device': {
        enum13 = 29;
        break;
      }
      case 'overflow': {
        enum13 = 30;
        break;
      }
      case 'not-permitted': {
        enum13 = 31;
        break;
      }
      case 'pipe': {
        enum13 = 32;
        break;
      }
      case 'read-only': {
        enum13 = 33;
        break;
      }
      case 'invalid-seek': {
        enum13 = 34;
        break;
      }
      case 'text-file-busy': {
        enum13 = 35;
        break;
      }
      case 'cross-device': {
        enum13 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val13}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg4 + 8, enum13, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant14, valueType: typeof variant14});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.stat-at"][Instruction::Return]', {
  funcName: '[method]descriptor.stat-at',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline62.fnName = 'wasi:filesystem/types@0.2.11#statAt';

const _trampoline63 = function(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
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
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.open-at"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  
  const started = task.enterSync();
  
  let ret;
  try {
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.openAt(flags3, result4, flags5, flags6),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant9 = ret;
switch (variant9.tag) {
  case 'ok': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg6 + 0, 0, true);
    
    if (!(e instanceof Descriptor)) {
      throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
    }
    var handle7 = e[symbolRscHandle];
    if (!handle7) {
      const rep = e[symbolRscRep] || ++captureCnt13;
      captureTable13.set(rep, e);
      handle7 = rscTableCreateOwn(handleTable13, rep);
    }
    
    dataView(memory0).setInt32(arg6 + 4, handle7, true);
    
    break;
  }
  case 'err': {
    const e = variant9.val;
    dataView(memory0).setInt8(arg6 + 0, 1, true);
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
    dataView(memory0).setInt8(arg6 + 4, enum8, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant9, valueType: typeof variant9});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.open-at"][Instruction::Return]', {
  funcName: '[method]descriptor.open-at',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline63.fnName = 'wasi:filesystem/types@0.2.11#openAt';

const _trampoline64 = function(arg0, arg1) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(Descriptor.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.metadata-hash"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.metadataHash(),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant5 = ret;
switch (variant5.tag) {
  case 'ok': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 0, true);
    var {lower: v3_0, upper: v3_1 } = e;
    dataView(memory0).setBigInt64(arg1 + 8, toUint64(v3_0), true);
    dataView(memory0).setBigInt64(arg1 + 16, toUint64(v3_1), true);
    
    break;
  }
  case 'err': {
    const e = variant5.val;
    dataView(memory0).setInt8(arg1 + 0, 1, true);
    var val4 = e;
    let enum4;
    switch (val4) {
      case 'access': {
        enum4 = 0;
        break;
      }
      case 'would-block': {
        enum4 = 1;
        break;
      }
      case 'already': {
        enum4 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum4 = 3;
        break;
      }
      case 'busy': {
        enum4 = 4;
        break;
      }
      case 'deadlock': {
        enum4 = 5;
        break;
      }
      case 'quota': {
        enum4 = 6;
        break;
      }
      case 'exist': {
        enum4 = 7;
        break;
      }
      case 'file-too-large': {
        enum4 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum4 = 9;
        break;
      }
      case 'in-progress': {
        enum4 = 10;
        break;
      }
      case 'interrupted': {
        enum4 = 11;
        break;
      }
      case 'invalid': {
        enum4 = 12;
        break;
      }
      case 'io': {
        enum4 = 13;
        break;
      }
      case 'is-directory': {
        enum4 = 14;
        break;
      }
      case 'loop': {
        enum4 = 15;
        break;
      }
      case 'too-many-links': {
        enum4 = 16;
        break;
      }
      case 'message-size': {
        enum4 = 17;
        break;
      }
      case 'name-too-long': {
        enum4 = 18;
        break;
      }
      case 'no-device': {
        enum4 = 19;
        break;
      }
      case 'no-entry': {
        enum4 = 20;
        break;
      }
      case 'no-lock': {
        enum4 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum4 = 22;
        break;
      }
      case 'insufficient-space': {
        enum4 = 23;
        break;
      }
      case 'not-directory': {
        enum4 = 24;
        break;
      }
      case 'not-empty': {
        enum4 = 25;
        break;
      }
      case 'not-recoverable': {
        enum4 = 26;
        break;
      }
      case 'unsupported': {
        enum4 = 27;
        break;
      }
      case 'no-tty': {
        enum4 = 28;
        break;
      }
      case 'no-such-device': {
        enum4 = 29;
        break;
      }
      case 'overflow': {
        enum4 = 30;
        break;
      }
      case 'not-permitted': {
        enum4 = 31;
        break;
      }
      case 'pipe': {
        enum4 = 32;
        break;
      }
      case 'read-only': {
        enum4 = 33;
        break;
      }
      case 'invalid-seek': {
        enum4 = 34;
        break;
      }
      case 'text-file-busy': {
        enum4 = 35;
        break;
      }
      case 'cross-device': {
        enum4 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val4}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg1 + 8, enum4, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant5, valueType: typeof variant5});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.metadata-hash"][Instruction::Return]', {
  funcName: '[method]descriptor.metadata-hash',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline64.fnName = 'wasi:filesystem/types@0.2.11#metadataHash';

const _trampoline65 = function(arg0, arg1, arg2, arg3, arg4) {
  var handle1 = arg0;
  
  var rep2 = handleTable13[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable13.get(rep2);
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
  _debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.metadata-hash-at"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    ret = { tag: 'ok', val: _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => rsc0.metadataHashAt(flags3, result4),
    })
  };
} catch (e) {
  ret = { tag: 'err', val: getErrorPayload(e) };
}

for (const rsc of curResourceBorrows) {
  rsc[symbolRscHandle] = undefined;
}
curResourceBorrows = [];
var variant7 = ret;
switch (variant7.tag) {
  case 'ok': {
    const e = variant7.val;
    dataView(memory0).setInt8(arg4 + 0, 0, true);
    var {lower: v5_0, upper: v5_1 } = e;
    dataView(memory0).setBigInt64(arg4 + 8, toUint64(v5_0), true);
    dataView(memory0).setBigInt64(arg4 + 16, toUint64(v5_1), true);
    
    break;
  }
  case 'err': {
    const e = variant7.val;
    dataView(memory0).setInt8(arg4 + 0, 1, true);
    var val6 = e;
    let enum6;
    switch (val6) {
      case 'access': {
        enum6 = 0;
        break;
      }
      case 'would-block': {
        enum6 = 1;
        break;
      }
      case 'already': {
        enum6 = 2;
        break;
      }
      case 'bad-descriptor': {
        enum6 = 3;
        break;
      }
      case 'busy': {
        enum6 = 4;
        break;
      }
      case 'deadlock': {
        enum6 = 5;
        break;
      }
      case 'quota': {
        enum6 = 6;
        break;
      }
      case 'exist': {
        enum6 = 7;
        break;
      }
      case 'file-too-large': {
        enum6 = 8;
        break;
      }
      case 'illegal-byte-sequence': {
        enum6 = 9;
        break;
      }
      case 'in-progress': {
        enum6 = 10;
        break;
      }
      case 'interrupted': {
        enum6 = 11;
        break;
      }
      case 'invalid': {
        enum6 = 12;
        break;
      }
      case 'io': {
        enum6 = 13;
        break;
      }
      case 'is-directory': {
        enum6 = 14;
        break;
      }
      case 'loop': {
        enum6 = 15;
        break;
      }
      case 'too-many-links': {
        enum6 = 16;
        break;
      }
      case 'message-size': {
        enum6 = 17;
        break;
      }
      case 'name-too-long': {
        enum6 = 18;
        break;
      }
      case 'no-device': {
        enum6 = 19;
        break;
      }
      case 'no-entry': {
        enum6 = 20;
        break;
      }
      case 'no-lock': {
        enum6 = 21;
        break;
      }
      case 'insufficient-memory': {
        enum6 = 22;
        break;
      }
      case 'insufficient-space': {
        enum6 = 23;
        break;
      }
      case 'not-directory': {
        enum6 = 24;
        break;
      }
      case 'not-empty': {
        enum6 = 25;
        break;
      }
      case 'not-recoverable': {
        enum6 = 26;
        break;
      }
      case 'unsupported': {
        enum6 = 27;
        break;
      }
      case 'no-tty': {
        enum6 = 28;
        break;
      }
      case 'no-such-device': {
        enum6 = 29;
        break;
      }
      case 'overflow': {
        enum6 = 30;
        break;
      }
      case 'not-permitted': {
        enum6 = 31;
        break;
      }
      case 'pipe': {
        enum6 = 32;
        break;
      }
      case 'read-only': {
        enum6 = 33;
        break;
      }
      case 'invalid-seek': {
        enum6 = 34;
        break;
      }
      case 'text-file-busy': {
        enum6 = 35;
        break;
      }
      case 'cross-device': {
        enum6 = 36;
        break;
      }
      default: {
        if ((e) instanceof Error) {
          console.error(e);
        }
        
        throw new TypeError(`"${val6}" is not one of the cases of error-code`);
      }
    }
    dataView(memory0).setInt8(arg4 + 8, enum6, true);
    
    break;
  }
  default: {
    _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
    throw new TypeError('invalid variant specified for result');
  }
}
_debugLog('[iface="wasi:filesystem/types@0.2.11", function="[method]descriptor.metadata-hash-at"][Instruction::Return]', {
  funcName: '[method]descriptor.metadata-hash-at',
  paramCount: 0,
  async: false,
  postReturn: false
});
task.resolve([ret]);
task.exit();
}
_trampoline65.fnName = 'wasi:filesystem/types@0.2.11#metadataHashAt';

const _trampoline66 = function(arg0) {
  _debugLog('[iface="wasi:cli/environment@0.2.11", function="get-environment"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
  _debugLog('[iface="wasi:cli/environment@0.2.11", function="get-environment"][Instruction::Return]', {
    funcName: 'get-environment',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline66.fnName = 'wasi:cli/environment@0.2.11#getEnvironment';
const handleTable11 = [T_FLAG, 0];
const captureTable11= new Map();
let captureCnt11 = 0;
handleTables[11] = handleTable11;

const _trampoline67 = function(arg0) {
  _debugLog('[iface="wasi:cli/terminal-stdin@0.2.11", function="get-terminal-stdin"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      const rep = e[symbolRscRep] || ++captureCnt11;
      captureTable11.set(rep, e);
      handle0 = rscTableCreateOwn(handleTable11, rep);
    }
    
    dataView(memory0).setInt32(arg0 + 4, handle0, true);
  }
  _debugLog('[iface="wasi:cli/terminal-stdin@0.2.11", function="get-terminal-stdin"][Instruction::Return]', {
    funcName: 'get-terminal-stdin',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline67.fnName = 'wasi:cli/terminal-stdin@0.2.11#getTerminalStdin';
const handleTable12 = [T_FLAG, 0];
const captureTable12= new Map();
let captureCnt12 = 0;
handleTables[12] = handleTable12;

const _trampoline68 = function(arg0) {
  _debugLog('[iface="wasi:cli/terminal-stdout@0.2.11", function="get-terminal-stdout"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      const rep = e[symbolRscRep] || ++captureCnt12;
      captureTable12.set(rep, e);
      handle0 = rscTableCreateOwn(handleTable12, rep);
    }
    
    dataView(memory0).setInt32(arg0 + 4, handle0, true);
  }
  _debugLog('[iface="wasi:cli/terminal-stdout@0.2.11", function="get-terminal-stdout"][Instruction::Return]', {
    funcName: 'get-terminal-stdout',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline68.fnName = 'wasi:cli/terminal-stdout@0.2.11#getTerminalStdout';

const _trampoline69 = function(arg0) {
  _debugLog('[iface="wasi:cli/terminal-stderr@0.2.11", function="get-terminal-stderr"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      const rep = e[symbolRscRep] || ++captureCnt12;
      captureTable12.set(rep, e);
      handle0 = rscTableCreateOwn(handleTable12, rep);
    }
    
    dataView(memory0).setInt32(arg0 + 4, handle0, true);
  }
  _debugLog('[iface="wasi:cli/terminal-stderr@0.2.11", function="get-terminal-stderr"][Instruction::Return]', {
    funcName: 'get-terminal-stderr',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline69.fnName = 'wasi:cli/terminal-stderr@0.2.11#getTerminalStderr';

const _trampoline70 = function(arg0) {
  _debugLog('[iface="wasi:clocks/wall-clock@0.2.11", function="now"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
    
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  var {seconds: v0_0, nanoseconds: v0_1 } = ret;
  dataView(memory0).setBigInt64(arg0 + 0, toUint64(v0_0), true);
  dataView(memory0).setInt32(arg0 + 8, toUint32(v0_1), true);
  _debugLog('[iface="wasi:clocks/wall-clock@0.2.11", function="now"][Instruction::Return]', {
    funcName: 'now',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline70.fnName = 'wasi:clocks/wall-clock@0.2.11#now$1';

const _trampoline71 = function(arg0) {
  _debugLog('[iface="wasi:filesystem/preopens@0.2.11", function="get-directories"] [Instruction::CallInterface] (sync, @ enter)');
  let hostProvided = true;
  
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
      const rep = tuple0_0[symbolRscRep] || ++captureCnt13;
      captureTable13.set(rep, tuple0_0);
      handle1 = rscTableCreateOwn(handleTable13, rep);
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
  _debugLog('[iface="wasi:filesystem/preopens@0.2.11", function="get-directories"][Instruction::Return]', {
    funcName: 'get-directories',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline71.fnName = 'wasi:filesystem/preopens@0.2.11#getDirectories';
let exports2;
let run0211Run;

async function run() {
  _debugLog('[iface="wasi:cli/run@0.2.11", function="run"][Instruction::CallWasm] enter', {
    funcName: 'run',
    paramCount: 0,
    async: false,
    postReturn: false,
  });
  const hostProvided = false;
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: true,
    entryFnName: 'run0211Run',
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: 'throw-result-err',
    callingWasmExport: true,
  });
  
  
  const started = await task.enter();
  if (!started) {
    _debugLog('[Instruction::AsyncTaskReturn] failed to enter task', {
      taskID: task.id(),
      subtaskID: currentSubtask?.id(),
    });
    throw new Error("failed to enter task");
  }
  
  
  if (null!== null) {
    task.setReturnMemoryIdx(null);
    task.setReturnMemory(() => null());
  }
  
  
  let ret;
  
  try {
    ret =  await  _withGlobalCurrentTaskMetaAsync({
      taskID: task.id(),
      componentIdx: task.componentIdx(),
      fn: () => run0211Run(),
    });
  } catch (err) {
    
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
  _debugLog('[iface="wasi:cli/run@0.2.11", function="run"][Instruction::Return]', {
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
  
}
let trampoline0 = _trampoline0.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
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
        const rep = obj[symbolRscRep] || ++captureCnt4;
        captureTable4.set(rep, obj);
        handle = rscTableCreateOwn(handleTable4, rep);
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
  importFn: _trampoline0,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
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
        const rep = obj[symbolRscRep] || ++captureCnt4;
        captureTable4.set(rep, obj);
        handle = rscTableCreateOwn(handleTable4, rep);
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
  importFn: _trampoline0,
},
);
let trampoline1 = _trampoline1.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 1,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline1.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline1,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 1,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline1.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline1,
},
);
let trampoline2 = _trampoline2.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline2,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline2,
},
);
let trampoline3 = _trampoline3.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 3,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline3.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: Fields,
    createResourceFn: 
    (handle) => {
      const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable5.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(Fields.prototype);
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
    function lowerImportedOwnedHost_OutgoingRequest(obj) {
      if (!(obj instanceof OutgoingRequest)) {
        throw new TypeError('Resource error: Not a valid \"OutgoingRequest\" resource.');
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
  importFn: _trampoline3,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 3,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline3.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: Fields,
    createResourceFn: 
    (handle) => {
      const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable5.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(Fields.prototype);
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
    function lowerImportedOwnedHost_OutgoingRequest(obj) {
      if (!(obj instanceof OutgoingRequest)) {
        throw new TypeError('Resource error: Not a valid \"OutgoingRequest\" resource.');
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
  importFn: _trampoline3,
},
);
function trampoline4(handle) {
  const handleEntry = rscTableRemove(handleTable5, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable5.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable5.delete(handleEntry.rep);
    } else if (Fields[symbolCabiDispose]) {
      Fields[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline5(handle) {
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
function trampoline6(handle) {
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
function trampoline7(handle) {
  const handleEntry = rscTableRemove(handleTable7, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable7.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable7.delete(handleEntry.rep);
    } else if (OutgoingBody[symbolCabiDispose]) {
      OutgoingBody[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline8(handle) {
  const handleEntry = rscTableRemove(handleTable6, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable6.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable6.delete(handleEntry.rep);
    } else if (OutgoingRequest[symbolCabiDispose]) {
      OutgoingRequest[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline9(handle) {
  const handleEntry = rscTableRemove(handleTable4, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable4.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable4.delete(handleEntry.rep);
    } else if (RequestOptions[symbolCabiDispose]) {
      RequestOptions[symbolCabiDispose](handleEntry.rep);
    }
  }
}
let trampoline10 = _trampoline10.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 10,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline10.manuallyAsync,
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
  importFn: _trampoline10,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 10,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline10.manuallyAsync,
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
  importFn: _trampoline10,
},
);
let trampoline11 = _trampoline11.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 11,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline11.manuallyAsync,
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
  importFn: _trampoline11,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 11,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline11.manuallyAsync,
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
  importFn: _trampoline11,
},
);
let trampoline12 = _trampoline12.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 12,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline12.manuallyAsync,
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
  importFn: _trampoline12,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 12,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline12.manuallyAsync,
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
  importFn: _trampoline12,
},
);
let trampoline13 = _trampoline13.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 13,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline13.manuallyAsync,
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
        const rep = obj[symbolRscRep] || ++captureCnt5;
        captureTable5.set(rep, obj);
        handle = rscTableCreateOwn(handleTable5, rep);
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
  importFn: _trampoline13,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 13,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline13.manuallyAsync,
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
        const rep = obj[symbolRscRep] || ++captureCnt5;
        captureTable5.set(rep, obj);
        handle = rscTableCreateOwn(handleTable5, rep);
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
  importFn: _trampoline13,
},
);
function trampoline14(handle) {
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
function trampoline15(handle) {
  const handleEntry = rscTableRemove(handleTable10, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable10.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable10.delete(handleEntry.rep);
    } else if (IncomingBody[symbolCabiDispose]) {
      IncomingBody[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline16(handle) {
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
function trampoline17(handle) {
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
function trampoline18(handle) {
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
let trampoline19 = _trampoline19.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 19,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline19.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 19,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline19.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4),_liftFlatOption([
  ['none', null, 16, 8, 8, 0, 2 ],
  ['some', _liftFlatU64, 16, 8, 8, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
function trampoline20(handle) {
  const handleEntry = rscTableRemove(handleTable11, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable11.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable11.delete(handleEntry.rep);
    } else if (TerminalInput[symbolCabiDispose]) {
      TerminalInput[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline21(handle) {
  const handleEntry = rscTableRemove(handleTable12, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable12.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable12.delete(handleEntry.rep);
    } else if (TerminalOutput[symbolCabiDispose]) {
      TerminalOutput[symbolCabiDispose](handleEntry.rep);
    }
  }
}
function trampoline22(handle) {
  const handleEntry = rscTableRemove(handleTable13, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable13.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable13.delete(handleEntry.rep);
    } else if (Descriptor[symbolCabiDispose]) {
      Descriptor[symbolCabiDispose](handleEntry.rep);
    }
  }
}
let trampoline23 = _trampoline23.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 23,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline23.manuallyAsync,
  paramLiftFns: [_liftFlatResult([['ok', null, 1, 1, 1, 0, 1],['err', null, 1, 1, 1, 0, 1],])],
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
  importFn: _trampoline23,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 23,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline23.manuallyAsync,
  paramLiftFns: [_liftFlatResult([['ok', null, 1, 1, 1, 0, 1],['err', null, 1, 1, 1, 0, 1],])],
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
  importFn: _trampoline23,
},
);
let trampoline24 = _trampoline24.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
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
)) : _lowerImportBackwardsCompat.bind(
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
let trampoline25 = _trampoline25.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 25,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline25.manuallyAsync,
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
  importFn: _trampoline25,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 25,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline25.manuallyAsync,
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
  importFn: _trampoline25,
},
);
let trampoline26 = _trampoline26.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 26,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline26.manuallyAsync,
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
  importFn: _trampoline26,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 26,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline26.manuallyAsync,
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
  importFn: _trampoline26,
},
);
let trampoline27 = _trampoline27.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
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
  importFn: _trampoline27,
},
)) : _lowerImportBackwardsCompat.bind(
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
  importFn: _trampoline27,
},
);
let trampoline28 = _trampoline28.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 28,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline28.manuallyAsync,
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
  importFn: _trampoline28,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 28,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline28.manuallyAsync,
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
  importFn: _trampoline28,
},
);
let trampoline29 = _trampoline29.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 29,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline29.manuallyAsync,
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
  importFn: _trampoline29,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 29,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline29.manuallyAsync,
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
  importFn: _trampoline29,
},
);
let trampoline30 = _trampoline30.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 30,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline30.manuallyAsync,
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
  importFn: _trampoline30,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 30,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline30.manuallyAsync,
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
  importFn: _trampoline30,
},
);
let trampoline31 = _trampoline31.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 31,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline31.manuallyAsync,
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
  importFn: _trampoline31,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 31,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline31.manuallyAsync,
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
  importFn: _trampoline31,
},
);
let trampoline32 = _trampoline32.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 32,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline32.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['accessKeyId', _lowerFlatStringAny, 8, 4 ],['secretAccessKey', _lowerFlatStringAny, 8, 4 ],['sessionToken', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['expiresAfter', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 16, 8 ],['accountId', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 64, align32: 8 }), 72, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'credentials-not-loaded', null, 16, 8, 8 ],[ 'provider-timed-out', _lowerFlatRecord({ fieldMetas: [['duration', _lowerFlatU64, 8, 8 ],], size32: 8, align32: 8 }), 16, 8, 8 ],[ 'invalid-configuration', null, 16, 8, 8 ],[ 'provider-error', null, 16, 8, 8 ],[ 'unhandled', null, 16, 8, 8 ],]), 72, 8, 8 ],
  ])
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
  importFn: _trampoline32,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 32,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline32.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['accessKeyId', _lowerFlatStringAny, 8, 4 ],['secretAccessKey', _lowerFlatStringAny, 8, 4 ],['sessionToken', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['expiresAfter', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 16, 8 ],['accountId', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 64, align32: 8 }), 72, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'credentials-not-loaded', null, 16, 8, 8 ],[ 'provider-timed-out', _lowerFlatRecord({ fieldMetas: [['duration', _lowerFlatU64, 8, 8 ],], size32: 8, align32: 8 }), 16, 8, 8 ],[ 'invalid-configuration', null, 16, 8, 8 ],[ 'provider-error', null, 16, 8, 8 ],[ 'unhandled', null, 16, 8, 8 ],]), 72, 8, 8 ],
  ])
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
  importFn: _trampoline32,
},
);
let trampoline33 = _trampoline33.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 33,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline33.manuallyAsync,
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
  importFn: _trampoline33,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 33,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline33.manuallyAsync,
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
  importFn: _trampoline33,
},
);
let trampoline34 = _trampoline34.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 34,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline34.manuallyAsync,
  paramLiftFns: [_liftFlatList({
    elemLiftFn: _liftFlatTuple({ elemLiftFns: [[_liftFlatStringAny, 8, 4],[_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    }), 8, 4],], size32: 16, align32: 4 }),
    elemAlign32: 4,
    elemSize32: 16,
    typedArray: undefined,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_Fields(obj) {
      if (!(obj instanceof Fields)) {
        throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
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
  [ 'err', _lowerFlatVariant([[ 'invalid-syntax', null, 1, 1, 1 ],[ 'forbidden', null, 1, 1, 1 ],[ 'immutable', null, 1, 1, 1 ],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline34,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 34,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline34.manuallyAsync,
  paramLiftFns: [_liftFlatList({
    elemLiftFn: _liftFlatTuple({ elemLiftFns: [[_liftFlatStringAny, 8, 4],[_liftFlatList({
      elemLiftFn: _liftFlatU8,
      elemAlign32: 1,
      elemSize32: 1,
      typedArray: Uint8Array,
    }), 8, 4],], size32: 16, align32: 4 }),
    elemAlign32: 4,
    elemSize32: 16,
    typedArray: undefined,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_Fields(obj) {
      if (!(obj instanceof Fields)) {
        throw new TypeError('Resource error: Not a valid \"Fields\" resource.');
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
  [ 'err', _lowerFlatVariant([[ 'invalid-syntax', null, 1, 1, 1 ],[ 'forbidden', null, 1, 1, 1 ],[ 'immutable', null, 1, 1, 1 ],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline34,
},
);
let trampoline35 = _trampoline35.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 35,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline35.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 16, 4, 4, 0, 4 ],
  ['some', _liftFlatVariant([['HTTP', null, 12, 4, 4, 0, 3],['HTTPS', null, 12, 4, 4, 0, 3],['other', _liftFlatStringAny, 12, 4, 4, 2, 3],]), 16, 4, 4, 3, 4 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline35,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 35,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline35.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 16, 4, 4, 0, 4 ],
  ['some', _liftFlatVariant([['HTTP', null, 12, 4, 4, 0, 3],['HTTPS', null, 12, 4, 4, 0, 3],['other', _liftFlatStringAny, 12, 4, 4, 2, 3],]), 16, 4, 4, 3, 4 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline35,
},
);
let trampoline36 = _trampoline36.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 36,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline36.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatVariant([['get', null, 12, 4, 4, 0, 3],['head', null, 12, 4, 4, 0, 3],['post', null, 12, 4, 4, 0, 3],['put', null, 12, 4, 4, 0, 3],['delete', null, 12, 4, 4, 0, 3],['connect', null, 12, 4, 4, 0, 3],['options', null, 12, 4, 4, 0, 3],['trace', null, 12, 4, 4, 0, 3],['patch', null, 12, 4, 4, 0, 3],['other', _liftFlatStringAny, 12, 4, 4, 2, 3],])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline36,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 36,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline36.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatVariant([['get', null, 12, 4, 4, 0, 3],['head', null, 12, 4, 4, 0, 3],['post', null, 12, 4, 4, 0, 3],['put', null, 12, 4, 4, 0, 3],['delete', null, 12, 4, 4, 0, 3],['connect', null, 12, 4, 4, 0, 3],['options', null, 12, 4, 4, 0, 3],['trace', null, 12, 4, 4, 0, 3],['patch', null, 12, 4, 4, 0, 3],['other', _liftFlatStringAny, 12, 4, 4, 2, 3],])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline36,
},
);
let trampoline37 = _trampoline37.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 37,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline37.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 12, 4, 4, 0, 3 ],
  ['some', _liftFlatStringAny, 12, 4, 4, 2, 3 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline37,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 37,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline37.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 12, 4, 4, 0, 3 ],
  ['some', _liftFlatStringAny, 12, 4, 4, 2, 3 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline37,
},
);
let trampoline38 = _trampoline38.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 38,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline38.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 12, 4, 4, 0, 3 ],
  ['some', _liftFlatStringAny, 12, 4, 4, 2, 3 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline38,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 38,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline38.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6),_liftFlatOption([
  ['none', null, 12, 4, 4, 0, 3 ],
  ['some', _liftFlatStringAny, 12, 4, 4, 2, 3 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 1, 1, 1 ],
  [ 'err', null, 1, 1, 1 ],
  ])
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
  importFn: _trampoline38,
},
);
let trampoline39 = _trampoline39.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 39,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline39.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_OutgoingBody(obj) {
      if (!(obj instanceof OutgoingBody)) {
        throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', null, 8, 4, 4 ],
  ])
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
  importFn: _trampoline39,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 39,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline39.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 6)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_OutgoingBody(obj) {
      if (!(obj instanceof OutgoingBody)) {
        throw new TypeError('Resource error: Not a valid \"OutgoingBody\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', null, 8, 4, 4 ],
  ])
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
  importFn: _trampoline39,
},
);
let trampoline40 = _trampoline40.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 40,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline40.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 7)],
  resultLowerFns: [_lowerFlatResult([
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
  ])
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
  importFn: _trampoline40,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 40,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline40.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 7)],
  resultLowerFns: [_lowerFlatResult([
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
  ])
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
  importFn: _trampoline40,
},
);
let trampoline41 = _trampoline41.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 41,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline41.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 56, 8, 8 ],
  [ 'some', _lowerFlatResult([
  [ 'ok', _lowerFlatResult([
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
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
  , 48, 8, 8 ],
  [ 'err', null, 48, 8, 8 ],
  ])
  , 56, 8, 8 ],
  ])
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
  importFn: _trampoline41,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 41,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline41.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 8)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 56, 8, 8 ],
  [ 'some', _lowerFlatResult([
  [ 'ok', _lowerFlatResult([
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
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
  , 48, 8, 8 ],
  [ 'err', null, 48, 8, 8 ],
  ])
  , 56, 8, 8 ],
  ])
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
  importFn: _trampoline41,
},
);
let trampoline42 = _trampoline42.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 42,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline42.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 5)],
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
  importFn: _trampoline42,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 42,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline42.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 5)],
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
  importFn: _trampoline42,
},
);
let trampoline43 = _trampoline43.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 43,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline43.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_IncomingBody(obj) {
      if (!(obj instanceof IncomingBody)) {
        throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', null, 8, 4, 4 ],
  ])
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
  importFn: _trampoline43,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 43,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline43.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 9)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_IncomingBody(obj) {
      if (!(obj instanceof IncomingBody)) {
        throw new TypeError('Resource error: Not a valid \"IncomingBody\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', null, 8, 4, 4 ],
  ])
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
  importFn: _trampoline43,
},
);
let trampoline44 = _trampoline44.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 44,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline44.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 10)],
  resultLowerFns: [_lowerFlatResult([
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
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 44,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline44.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 10)],
  resultLowerFns: [_lowerFlatResult([
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
  ])
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
let trampoline45 = _trampoline45.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 45,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline45.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline45,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 45,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline45.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline45,
},
);
let trampoline46 = _trampoline46.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 46,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline46.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline46,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 46,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline46.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline46,
},
);
let trampoline47 = _trampoline47.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 47,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline47.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline47,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 47,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline47.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 4)],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
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
  importFn: _trampoline47,
},
);
let trampoline48 = _trampoline48.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 48,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline48.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: OutgoingBody,
    createResourceFn: 
    (handle) => {
      const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable7.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(OutgoingBody.prototype);
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
  ,_liftFlatOption([
  ['none', null, 8, 4, 4, 0, 2 ],
  ['some', _liftFlatOwn({
    componentIdx: 0,
    className: Fields,
    createResourceFn: 
    (handle) => {
      const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable5.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(Fields.prototype);
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
  , 8, 4, 4, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 40, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
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
  importFn: _trampoline48,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 48,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline48.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: OutgoingBody,
    createResourceFn: 
    (handle) => {
      const rep = handleTable7[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable7.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(OutgoingBody.prototype);
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
  ,_liftFlatOption([
  ['none', null, 8, 4, 4, 0, 2 ],
  ['some', _liftFlatOwn({
    componentIdx: 0,
    className: Fields,
    createResourceFn: 
    (handle) => {
      const rep = handleTable5[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable5.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(Fields.prototype);
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
  , 8, 4, 4, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 40, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
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
  importFn: _trampoline48,
},
);
let trampoline49 = _trampoline49.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 49,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline49.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 49,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline49.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
let trampoline50 = _trampoline50.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 50,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline50.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 3),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatList({
    elemLowerFn: _lowerFlatU8,
    elemSize32: 1,
    elemAlign32: 1,
  }), 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 50,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline50.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 3),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatList({
    elemLowerFn: _lowerFlatU8,
    elemSize32: 1,
    elemAlign32: 1,
  }), 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
let trampoline51 = _trampoline51.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 51,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline51.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatU64, 16, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 16, 8, 8 ],
  ])
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
  importFn: _trampoline51,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 51,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline51.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatU64, 16, 8, 8 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 16, 8, 8 ],
  ])
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
  importFn: _trampoline51,
},
);
let trampoline52 = _trampoline52.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 52,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline52.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 52,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline52.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
let trampoline53 = _trampoline53.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 53,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline53.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
  importFn: _trampoline53,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 53,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline53.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 2)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 12, 4, 4 ],
  [ 'err', _lowerFlatVariant([[ 'last-operation-failed', _lowerFlatOwn({
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
  }), 8, 4, 4 ],[ 'closed', null, 8, 4, 4 ],]), 12, 4, 4 ],
  ])
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
  importFn: _trampoline53,
},
);
let trampoline54 = _trampoline54.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 54,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline54.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: OutgoingRequest,
    createResourceFn: 
    (handle) => {
      const rep = handleTable6[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable6.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(OutgoingRequest.prototype);
        Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
        Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
      } else {
        captureTable6.delete(rep);
      }
      rscTableRemove(handleTable6, handle);
      return resourceObj;
    }
    ,
  })
  ,_liftFlatOption([
  ['none', null, 8, 4, 4, 0, 2 ],
  ['some', _liftFlatOwn({
    componentIdx: 0,
    className: RequestOptions,
    createResourceFn: 
    (handle) => {
      const rep = handleTable4[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable4.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(RequestOptions.prototype);
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
  , 8, 4, 4, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
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
  importFn: _trampoline54,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 54,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline54.manuallyAsync,
  paramLiftFns: [_liftFlatOwn({
    componentIdx: 0,
    className: OutgoingRequest,
    createResourceFn: 
    (handle) => {
      const rep = handleTable6[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable6.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(OutgoingRequest.prototype);
        Object.defineProperty(resourceObj, symbolRscHandle, { writable: true, value: handle });
        Object.defineProperty(resourceObj, symbolRscRep, { writable: true, value: rep });
      } else {
        captureTable6.delete(rep);
      }
      rscTableRemove(handleTable6, handle);
      return resourceObj;
    }
    ,
  })
  ,_liftFlatOption([
  ['none', null, 8, 4, 4, 0, 2 ],
  ['some', _liftFlatOwn({
    componentIdx: 0,
    className: RequestOptions,
    createResourceFn: 
    (handle) => {
      const rep = handleTable4[(handle << 1) + 1] & ~T_FLAG;
      let resourceObj = captureTable4.get(rep);
      if (!resourceObj) {
        resourceObj = Object.create(RequestOptions.prototype);
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
  , 8, 4, 4, 1, 2 ],
  ])],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatVariant([[ 'DNS-timeout', null, 32, 8, 8 ],[ 'DNS-error', _lowerFlatRecord({ fieldMetas: [['rcode', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['infoCode', _lowerFlatOption([
  [ 'none', null, 4, 2, 2 ],
  [ 'some', _lowerFlatU16, 4, 2, 2 ],
  ])
  , 4, 2 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'destination-not-found', null, 32, 8, 8 ],[ 'destination-unavailable', null, 32, 8, 8 ],[ 'destination-IP-prohibited', null, 32, 8, 8 ],[ 'destination-IP-unroutable', null, 32, 8, 8 ],[ 'connection-refused', null, 32, 8, 8 ],[ 'connection-terminated', null, 32, 8, 8 ],[ 'connection-timeout', null, 32, 8, 8 ],[ 'connection-read-timeout', null, 32, 8, 8 ],[ 'connection-write-timeout', null, 32, 8, 8 ],[ 'connection-limit-reached', null, 32, 8, 8 ],[ 'TLS-protocol-error', null, 32, 8, 8 ],[ 'TLS-certificate-error', null, 32, 8, 8 ],[ 'TLS-alert-received', _lowerFlatRecord({ fieldMetas: [['alertId', _lowerFlatOption([
  [ 'none', null, 2, 1, 1 ],
  [ 'some', _lowerFlatU8, 2, 1, 1 ],
  ])
  , 2, 1 ],['alertMessage', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],], size32: 16, align32: 4 }), 32, 8, 8 ],[ 'HTTP-request-denied', null, 32, 8, 8 ],[ 'HTTP-request-length-required', null, 32, 8, 8 ],[ 'HTTP-request-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-method-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-invalid', null, 32, 8, 8 ],[ 'HTTP-request-URI-too-long', null, 32, 8, 8 ],[ 'HTTP-request-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-header-size', _lowerFlatOption([
  [ 'none', null, 24, 4, 4 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 24, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-request-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-incomplete', null, 32, 8, 8 ],[ 'HTTP-response-header-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-header-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-body-size', _lowerFlatOption([
  [ 'none', null, 16, 8, 8 ],
  [ 'some', _lowerFlatU64, 16, 8, 8 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-section-size', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-trailer-size', _lowerFlatRecord({ fieldMetas: [['fieldName', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 12, 4 ],['fieldSize', _lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatU32, 8, 4, 4 ],
  ])
  , 8, 4 ],], size32: 20, align32: 4 }), 32, 8, 8 ],[ 'HTTP-response-transfer-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-content-coding', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],[ 'HTTP-response-timeout', null, 32, 8, 8 ],[ 'HTTP-upgrade-failed', null, 32, 8, 8 ],[ 'HTTP-protocol-error', null, 32, 8, 8 ],[ 'loop-detected', null, 32, 8, 8 ],[ 'configuration-error', null, 32, 8, 8 ],[ 'internal-error', _lowerFlatOption([
  [ 'none', null, 12, 4, 4 ],
  [ 'some', _lowerFlatStringAny, 12, 4, 4 ],
  ])
  , 32, 8, 8 ],]), 40, 8, 8 ],
  ])
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
  importFn: _trampoline54,
},
);
let trampoline55 = _trampoline55.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 55,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline55.manuallyAsync,
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
  importFn: _trampoline55,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 55,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline55.manuallyAsync,
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
  importFn: _trampoline55,
},
);
let trampoline56 = _trampoline56.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 56,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline56.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 56,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline56.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
let trampoline57 = _trampoline57.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 57,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline57.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline57,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 57,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline57.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatU64],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline57,
},
);
let trampoline58 = _trampoline58.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 58,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline58.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline58,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 58,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline58.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
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
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
  importFn: _trampoline58,
},
);
let trampoline59 = _trampoline59.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 59,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline59.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatFlags({ names: ['read','write','file-integrity-sync','data-integrity-sync','requested-write-sync','mutate-directory'], size32: 1, align32: 1, intSizeBytes: 1 }), 2, 1, 1 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 2, 1, 1 ],
  ])
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
  importFn: _trampoline59,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 59,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline59.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatFlags({ names: ['read','write','file-integrity-sync','data-integrity-sync','requested-write-sync','mutate-directory'], size32: 1, align32: 1, intSizeBytes: 1 }), 2, 1, 1 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 2, 1, 1 ],
  ])
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
  importFn: _trampoline59,
},
);
let trampoline60 = _trampoline60.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 60,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline60.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 2, 1, 1 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 2, 1, 1 ],
  ])
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
  importFn: _trampoline60,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 60,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline60.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', null, 2, 1, 1 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 2, 1, 1 ],
  ])
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
  importFn: _trampoline60,
},
);
let trampoline61 = _trampoline61.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 61,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline61.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', _lowerFlatEnum([['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],]), 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['dataModificationTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['statusChangeTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 104, 8, 8 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 61,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline61.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', _lowerFlatEnum([['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],]), 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['dataModificationTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['statusChangeTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 104, 8, 8 ],
  ])
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
let trampoline62 = _trampoline62.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 62,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline62.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', _lowerFlatEnum([['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],]), 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['dataModificationTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['statusChangeTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 104, 8, 8 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 62,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline62.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['type', _lowerFlatEnum([['unknown', null, 1, 1, 1],['block-device', null, 1, 1, 1],['character-device', null, 1, 1, 1],['directory', null, 1, 1, 1],['fifo', null, 1, 1, 1],['symbolic-link', null, 1, 1, 1],['regular-file', null, 1, 1, 1],['socket', null, 1, 1, 1],]), 1, 1 ],['linkCount', _lowerFlatU64, 8, 8 ],['size', _lowerFlatU64, 8, 8 ],['dataAccessTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['dataModificationTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],['statusChangeTimestamp', _lowerFlatOption([
  [ 'none', null, 24, 8, 8 ],
  [ 'some', _lowerFlatRecord({ fieldMetas: [['seconds', _lowerFlatU64, 8, 8 ],['nanoseconds', _lowerFlatU32, 4, 4 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  ])
  , 24, 8 ],], size32: 96, align32: 8 }), 104, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 104, 8, 8 ],
  ])
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
let trampoline63 = _trampoline63.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 63,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline63.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny,_liftFlatFlags({ names: ['create','directory','exclusive','truncate'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatFlags({ names: ['read','write','file-integrity-sync','data-integrity-sync','requested-write-sync','mutate-directory'], size32: 1, align32: 1, intSizeBytes: 1 })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_Descriptor(obj) {
      if (!(obj instanceof Descriptor)) {
        throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 63,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline63.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny,_liftFlatFlags({ names: ['create','directory','exclusive','truncate'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatFlags({ names: ['read','write','file-integrity-sync','data-integrity-sync','requested-write-sync','mutate-directory'], size32: 1, align32: 1, intSizeBytes: 1 })],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_Descriptor(obj) {
      if (!(obj instanceof Descriptor)) {
        throw new TypeError('Resource error: Not a valid \"Descriptor\" resource.');
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
  }), 8, 4, 4 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 8, 4, 4 ],
  ])
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
let trampoline64 = _trampoline64.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 64,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline64.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 24, 8, 8 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 64,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline64.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13)],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 24, 8, 8 ],
  ])
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
let trampoline65 = _trampoline65.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 65,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline65.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 24, 8, 8 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 65,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline65.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 13),_liftFlatFlags({ names: ['symlink-follow'], size32: 1, align32: 1, intSizeBytes: 1 }),_liftFlatStringAny],
  resultLowerFns: [_lowerFlatResult([
  [ 'ok', _lowerFlatRecord({ fieldMetas: [['lower', _lowerFlatU64, 8, 8 ],['upper', _lowerFlatU64, 8, 8 ],], size32: 16, align32: 8 }), 24, 8, 8 ],
  [ 'err', _lowerFlatEnum([['access', null, 1, 1, 1],['would-block', null, 1, 1, 1],['already', null, 1, 1, 1],['bad-descriptor', null, 1, 1, 1],['busy', null, 1, 1, 1],['deadlock', null, 1, 1, 1],['quota', null, 1, 1, 1],['exist', null, 1, 1, 1],['file-too-large', null, 1, 1, 1],['illegal-byte-sequence', null, 1, 1, 1],['in-progress', null, 1, 1, 1],['interrupted', null, 1, 1, 1],['invalid', null, 1, 1, 1],['io', null, 1, 1, 1],['is-directory', null, 1, 1, 1],['loop', null, 1, 1, 1],['too-many-links', null, 1, 1, 1],['message-size', null, 1, 1, 1],['name-too-long', null, 1, 1, 1],['no-device', null, 1, 1, 1],['no-entry', null, 1, 1, 1],['no-lock', null, 1, 1, 1],['insufficient-memory', null, 1, 1, 1],['insufficient-space', null, 1, 1, 1],['not-directory', null, 1, 1, 1],['not-empty', null, 1, 1, 1],['not-recoverable', null, 1, 1, 1],['unsupported', null, 1, 1, 1],['no-tty', null, 1, 1, 1],['no-such-device', null, 1, 1, 1],['overflow', null, 1, 1, 1],['not-permitted', null, 1, 1, 1],['pipe', null, 1, 1, 1],['read-only', null, 1, 1, 1],['invalid-seek', null, 1, 1, 1],['text-file-busy', null, 1, 1, 1],['cross-device', null, 1, 1, 1],]), 24, 8, 8 ],
  ])
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
let trampoline66 = _trampoline66.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 66,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline66.manuallyAsync,
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
  importFn: _trampoline66,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 66,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline66.manuallyAsync,
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
  importFn: _trampoline66,
},
);
let trampoline67 = _trampoline67.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 67,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline67.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalInput(obj) {
      if (!(obj instanceof TerminalInput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalInput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 67,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline67.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalInput(obj) {
      if (!(obj instanceof TerminalInput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalInput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
let trampoline68 = _trampoline68.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 68,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline68.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalOutput(obj) {
      if (!(obj instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 68,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline68.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalOutput(obj) {
      if (!(obj instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
let trampoline69 = _trampoline69.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 69,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline69.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalOutput(obj) {
      if (!(obj instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 69,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline69.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOption([
  [ 'none', null, 8, 4, 4 ],
  [ 'some', _lowerFlatOwn({
    componentIdx: 0,
    lowerFn: 
    function lowerImportedOwnedHost_TerminalOutput(obj) {
      if (!(obj instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid \"TerminalOutput\" resource.');
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
  }), 8, 4, 4 ],
  ])
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
let trampoline70 = _trampoline70.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 70,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline70.manuallyAsync,
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
  importFn: _trampoline70,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 70,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline70.manuallyAsync,
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
  importFn: _trampoline70,
},
);
let trampoline71 = _trampoline71.manuallyAsync ? new WebAssembly.Suspending(_lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 71,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline71.manuallyAsync,
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
          const rep = obj[symbolRscRep] || ++captureCnt13;
          captureTable13.set(rep, obj);
          handle = rscTableCreateOwn(handleTable13, rep);
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
  importFn: _trampoline71,
},
)) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 71,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline71.manuallyAsync,
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
          const rep = obj[symbolRscRep] || ++captureCnt13;
          captureTable13.set(rep, obj);
          handle = rscTableCreateOwn(handleTable13, rep);
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
  importFn: _trampoline71,
},
);
Promise.all([module0, module1, module2]).catch(() => {});
({ exports: exports0 } = yield instantiateCore(yield module1));
({ exports: exports1 } = yield instantiateCore(yield module0, {
  'component:aws-cli/credentials-provider': {
    'provide-credentials': exports0['0'],
  },
  'wasi:cli/environment@0.2.0': {
    'get-environment': exports0['34'],
  },
  'wasi:cli/environment@0.2.4': {
    'get-arguments': exports0['23'],
  },
  'wasi:cli/exit@0.2.0': {
    exit: trampoline23,
  },
  'wasi:cli/stderr@0.2.0': {
    'get-stderr': trampoline28,
  },
  'wasi:cli/stdin@0.2.0': {
    'get-stdin': trampoline26,
  },
  'wasi:cli/stdout@0.2.0': {
    'get-stdout': trampoline27,
  },
  'wasi:cli/terminal-input@0.2.0': {
    '[resource-drop]terminal-input': trampoline20,
  },
  'wasi:cli/terminal-output@0.2.0': {
    '[resource-drop]terminal-output': trampoline21,
  },
  'wasi:cli/terminal-stderr@0.2.0': {
    'get-terminal-stderr': exports0['37'],
  },
  'wasi:cli/terminal-stdin@0.2.0': {
    'get-terminal-stdin': exports0['35'],
  },
  'wasi:cli/terminal-stdout@0.2.0': {
    'get-terminal-stdout': exports0['36'],
  },
  'wasi:clocks/monotonic-clock@0.2.0': {
    now: trampoline29,
    'subscribe-duration': trampoline31,
    'subscribe-instant': trampoline30,
  },
  'wasi:clocks/wall-clock@0.2.0': {
    now: exports0['38'],
  },
  'wasi:filesystem/preopens@0.2.0': {
    'get-directories': exports0['39'],
  },
  'wasi:filesystem/types@0.2.0': {
    '[method]descriptor.append-via-stream': exports0['26'],
    '[method]descriptor.create-directory-at': exports0['28'],
    '[method]descriptor.get-flags': exports0['27'],
    '[method]descriptor.metadata-hash': exports0['32'],
    '[method]descriptor.metadata-hash-at': exports0['33'],
    '[method]descriptor.open-at': exports0['31'],
    '[method]descriptor.read-via-stream': exports0['24'],
    '[method]descriptor.stat': exports0['29'],
    '[method]descriptor.stat-at': exports0['30'],
    '[method]descriptor.write-via-stream': exports0['25'],
    '[resource-drop]descriptor': trampoline22,
  },
  'wasi:http/outgoing-handler@0.2.0': {
    handle: exports0['22'],
  },
  'wasi:http/types@0.2.0': {
    '[constructor]outgoing-request': trampoline3,
    '[constructor]request-options': trampoline0,
    '[method]fields.entries': exports0['10'],
    '[method]future-incoming-response.get': exports0['9'],
    '[method]future-incoming-response.subscribe': trampoline10,
    '[method]incoming-body.stream': exports0['12'],
    '[method]incoming-response.consume': exports0['11'],
    '[method]incoming-response.headers': trampoline13,
    '[method]incoming-response.status': trampoline12,
    '[method]outgoing-body.write': exports0['8'],
    '[method]outgoing-request.body': exports0['7'],
    '[method]outgoing-request.set-authority': exports0['6'],
    '[method]outgoing-request.set-method': exports0['4'],
    '[method]outgoing-request.set-path-with-query': exports0['5'],
    '[method]outgoing-request.set-scheme': exports0['3'],
    '[method]request-options.between-bytes-timeout': exports0['13'],
    '[method]request-options.connect-timeout': exports0['14'],
    '[method]request-options.first-byte-timeout': exports0['15'],
    '[method]request-options.set-between-bytes-timeout': trampoline19,
    '[method]request-options.set-connect-timeout': trampoline1,
    '[method]request-options.set-first-byte-timeout': trampoline2,
    '[resource-drop]fields': trampoline4,
    '[resource-drop]future-incoming-response': trampoline18,
    '[resource-drop]incoming-body': trampoline15,
    '[resource-drop]incoming-response': trampoline16,
    '[resource-drop]outgoing-body': trampoline7,
    '[resource-drop]outgoing-request': trampoline8,
    '[resource-drop]request-options': trampoline9,
    '[static]fields.from-list': exports0['2'],
    '[static]outgoing-body.finish': exports0['16'],
  },
  'wasi:io/error@0.2.0': {
    '[resource-drop]error': trampoline5,
  },
  'wasi:io/poll@0.2.0': {
    '[method]pollable.block': trampoline11,
    '[resource-drop]pollable': trampoline17,
  },
  'wasi:io/streams@0.2.0': {
    '[method]input-stream.blocking-read': exports0['18'],
    '[method]input-stream.subscribe': trampoline24,
    '[method]output-stream.blocking-flush': exports0['21'],
    '[method]output-stream.blocking-write-and-flush': exports0['17'],
    '[method]output-stream.check-write': exports0['19'],
    '[method]output-stream.subscribe': trampoline25,
    '[method]output-stream.write': exports0['20'],
    '[resource-drop]input-stream': trampoline14,
    '[resource-drop]output-stream': trampoline6,
  },
  'wasi:random/insecure-seed@0.2.4': {
    'insecure-seed': exports0['1'],
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
    '0': trampoline32,
    '1': trampoline33,
    '10': trampoline42,
    '11': trampoline43,
    '12': trampoline44,
    '13': trampoline45,
    '14': trampoline46,
    '15': trampoline47,
    '16': trampoline48,
    '17': trampoline49,
    '18': trampoline50,
    '19': trampoline51,
    '2': trampoline34,
    '20': trampoline52,
    '21': trampoline53,
    '22': trampoline54,
    '23': trampoline55,
    '24': trampoline56,
    '25': trampoline57,
    '26': trampoline58,
    '27': trampoline59,
    '28': trampoline60,
    '29': trampoline61,
    '3': trampoline35,
    '30': trampoline62,
    '31': trampoline63,
    '32': trampoline64,
    '33': trampoline65,
    '34': trampoline66,
    '35': trampoline67,
    '36': trampoline68,
    '37': trampoline69,
    '38': trampoline70,
    '39': trampoline71,
    '4': trampoline36,
    '5': trampoline37,
    '6': trampoline38,
    '7': trampoline39,
    '8': trampoline40,
    '9': trampoline41,
  },
}));
run0211Run = WebAssembly.promising(exports1['wasi:cli/run@0.2.11#run']);
const run0211 = {
  run: run,
  
};

return { run: run0211, 'wasi:cli/run@0.2.11': run0211,  };
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
