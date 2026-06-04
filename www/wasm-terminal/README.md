# wasm-terminal

A simplified TypeScript terminal addon for xterm.js that executes WebAssembly components in the browser, with a focus on WASI Preview2.

## Features

- **xterm.js v6 support** - Built for the latest xterm.js v6
- **TypeScript-first** - Written entirely in TypeScript for type safety
- **WASI Preview2 focus** - Designed for WASI Preview2 WebAssembly components
- **No Wasmer dependencies** - Removed Wasmer-specific code for a lighter package
- **Command registration** - Easy JavaScript command registration API
- **REPL interface** - Read-Eval-Print-Loop for interactive command execution
- **Pipe support** - Basic pipe (`|`) operator support
- **History** - Command history with arrow key navigation
- **Line buffering** - Proper stdout/stderr line buffering with no circular dependencies

## Origin

This package is a TypeScript rewrite and simplification of [wasm-webterm](https://github.com/cryptool-org/wasm-webterm), removing Wasmer dependencies and focusing on WASI Preview2 WebAssembly components.

## API

### Basic Usage

```typescript
import WasmTerminal from "wasm-terminal";
import { Terminal } from "@xterm/xterm";

const terminal = new Terminal();
const wasmTerminal = new WasmTerminal("/path/to/wasm/binaries");

// Activate the addon
wasmTerminal.activate(terminal);
```

### Register JavaScript Commands

```typescript
wasmTerminal.registerJsCommand("hello", async (argv) => {
  return `Hello, ${argv[0] || "World"}!\n`;
});
```

### Lifecycle Hooks

```typescript
wasmTerminal.onActivated = async () => {
  console.log("Terminal activated");
};

wasmTerminal.onBeforeCommandRun = async () => {
  console.log("Command starting...");
};

wasmTerminal.onCommandRunFinish = async () => {
  console.log("Command finished!");
};
```

## Differences from wasm-webterm

### Removed

- ❌ Wasmer WASI runtime support
- ❌ WAPM package fetching
- ❌ Web Worker execution (simplified to main thread)
- ❌ Drag-and-drop module loading
- ❌ Complex WASM module caching
- ❌ Emscripten-specific code

### Changed

- ✅ Focus on WASI Preview2 components
- ✅ Fixed circular dependency in LineBuffer
- ✅ Simplified command execution model
- ✅ TypeScript with full type safety
- ✅ Direct integration with component model

## License

Apache-2.0
