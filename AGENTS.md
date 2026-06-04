# Overall Instructions

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

This is a WebAssembly-based web shell that runs AWS CLI commands directly in the browser. The AWS CLI is written in Rust, compiled to WebAssembly components using the WASI Preview2 standard, and executed both in the browser and via wasmtime for testing.

**Key Architecture:**

- **Rust WASM Components**: AWS CLI compiled to `wasm32-wasip2` target (WASI Preview2)
- **Browser Execution**: Custom `wasm-terminal` addon for xterm.js v6 with WASI Preview2 support
- **Native Testing**: wasmtime engine for running and testing components locally
- **Build Pipeline**: JS bindings auto-generated from WASM components via `js-component-bindgen`
- **Terminal**: TypeScript-based terminal addon focused on WASI Preview2 components

## Build Commands

### Rust/WASM Development

```bash
# Build all Rust packages (including WASM components)
cargo build

# Build only WASM components (excluding wasi-engine)
cargo component build --workspace --exclude wasi-engine

# Run tests for WASM components
cargo component test --workspace --exclude wasi-engine

# Run the wasi-engine locally (native wasmtime execution)
cd packages/wasi-engine
cargo run

# Format code
cargo fmt --all

# Run clippy linter
cargo clippy --all-targets --all-features --no-deps
```

### Web Development

```bash
# Install dependencies and start dev server
cd www
npm ci
npm start
# Access at http://localhost:8080

# Production build
cd www
npm run build
```

## Project Structure

### Rust Workspace

- **`packages/aws-cli/`**: Main AWS CLI implementation
  - Compiled to WASM component targeting `wasm32-wasip2`
  - Uses AWS SDK for Rust (S3, SSM, STS services currently implemented)
  - Entry point: `src/main.rs` with `#[wstd::main]` for WASI async runtime
  - Command structure: `src/commands.rs` using clap for CLI parsing
  - Service implementations in `src/s3/`, `src/ssm/`, `src/sts/`
  - Config: `.cargo/config.toml` sets default target to `wasm32-wasip2`

- **`packages/wasi-engine/`**: Native wasmtime runner for testing
  - Loads and executes WASM components via wasmtime
  - **Critical**: `build.rs` transpiles WASM to JavaScript bindings using `js-component-bindgen`
  - Generated JS/TS bindings output to `www/aws-cli/component/`
  - This is how the WASM component becomes usable in the browser

### Web Application (`www/`)

- **Main entry**: `src/index.tsx` - React application with xterm.js integration
- **Terminal UI**: `src/web-shell.ts` - integrates wasm-terminal with WASM execution
- **AWS Commands**: `src/aws-command.ts` - bridges terminal to WASM component
- **Terminal Package**: `wasm-terminal/` - Local TypeScript terminal addon
  - `src/index.ts` - Main WasmTerminal class (WASI Preview2 focus)
  - `src/LineBuffer.ts` - Line buffering for stdout/stderr
  - `src/History.ts` - Command history management
  - **Key Fix**: Resolved circular dependency causing stack overflow
- **Component Package**: `aws-cli/` - npm package wrapping WASM component
  - `component/` - auto-generated JS bindings from `wasi-engine/build.rs`
  - `src/index-browser.ts` - browser-specific initialization (TypeScript)
  - `src/index.ts` - Node.js compatibility (TypeScript)

## Development Workflow

### Adding New AWS Service Commands

1. Add AWS SDK dependency to `packages/aws-cli/Cargo.toml`
2. Create service module in `packages/aws-cli/src/<service>/`
3. Define command struct with clap attributes
4. Add command to enum in `src/commands.rs`
5. Implement service logic using AWS SDK
6. Add tests with `#[wstd::test]` attribute
7. Build WASM: `cargo component build -p aws-cli`
8. Build transpiler: `cd packages/wasi-engine && cargo build` (triggers `build.rs`)

### Testing WASM Components

Tests use `#[wstd::test]` attribute (not standard `#[tokio::test]`) for WASI compatibility.

```bash
# Run all component tests
cargo component test --workspace --exclude wasi-engine

# Run with verbose logging
RUST_LOG=trace RUST_BACKTRACE=1 WASMTIME_BACKTRACE_DETAILS=1 \
  cargo component test --workspace --exclude wasi-engine

# Run a specific test
cargo component test -p aws-cli -- default_config
```

The test runner is configured in `.cargo/config.toml` to use wasmtime with WASI CLI and HTTP support enabled.

### Build System Details

The **critical build dependency** is `packages/wasi-engine/build.rs`:

- Reads the compiled `aws-cli.wasm` from `target/wasm32-wasip2/{profile}/`
- Transpiles it to JavaScript using `js-component-bindgen`
- Outputs TypeScript definitions and JS modules to `www/aws-cli/component/`
- This must run after `cargo component build` for browser integration

Build profile detection: `debug` vs `release` based on `cfg!(debug_assertions)`.

## wasm-terminal Package

### Structure

```
www/wasm-terminal/
├── package.json          # TypeScript package for WASI Preview2
├── README.md            # Usage documentation
├── MIGRATION.md         # Migration guide from wasm-webterm
└── src/
    ├── index.ts         # Main WasmTerminal class
    ├── LineBuffer.ts    # Line buffering (fixed circular dependency)
    ├── History.ts       # Command history
    └── types.d.ts       # Type definitions for dependencies
```

### Key Implementation Details

**LineBuffer Fix:**
The LineBuffer had a critical circular dependency bug causing stack overflow:

```typescript
// WRONG - Causes infinite recursion
this._stdoutBuffer = new LineBuffer((data) => this._stdout(data));
private _stdout(data: string) {
  this._stdoutBuffer?.write(data); // ← Calls back to _stdout infinitely
}

// CORRECT - Direct output
this._stdoutBuffer = new LineBuffer((data) => {
  this._xterm?.write(data.replace(/\n/g, "\r\n")); // ← Direct to terminal
});
private _stdout(data: string) {
  this._stdoutBuffer?.write(data); // ← No circular call
}
```

**WASI Preview2 Component Loading:**
```typescript
async _getOrFetchWasmModule(programName: string): Promise<WasmModule> {
  const response = await fetch(`${this.wasmBinaryPath}/${programName}.wasm`);
  const wasmBinary = await response.arrayBuffer();
  const module = await WebAssembly.compile(wasmBinary);
  return { name: programName, type: "wasi-preview2", module };
}
```

### Troubleshooting

**Stack Overflow Error:**
```
RangeError: Maximum call stack size exceeded at LineBuffer
```
- **Cause**: Circular dependency in output functions
- **Solution**: Already fixed in current implementation
- **Prevention**: Never call `_stdout`/`_stderr` from within the LineBuffer callback

**Module Not Found:**
```
Unable to find WASI component for command X
```
- Check that `.wasm` file exists in binaries directory
- Verify WASM is valid with `wasm-tools validate`
- Ensure it's a WASI Preview2 component: `wasm-tools component wit`

## Key Technical Constraints

### WASI Preview2 and HTTP

- Target: `wasm32-wasip2` (WASI Preview 2, not WASI Preview 1)
- HTTP requests use `wasi:http` interface via `aws-smithy-wasm` crate
- wasmtime runner configured with `-S http` to enable HTTP support
- Browser execution uses `@bytecodealliance/preview2-shim`
- **Important**: This project does NOT support Emscripten-compiled modules

### Async Runtime

- Uses `wstd` crate for WASI-compatible async runtime (not tokio directly)
- Main function: `#[wstd::main] async fn main()`
- Tests: `#[wstd::test] async fn test_name()`

### Cargo Tooling

- Requires `cargo-component` (installed via `cargo-run-bin`)
- Rust toolchain: stable with `wasm32-wasip2` target (see `rust-toolchain.toml`)
- Uses `cargo bin` to manage binary tools (see `Cargo.toml` workspace.metadata.bin)

### Size Optimization

Release profile for `aws-cli` uses:

- `opt-level = "s"` (optimize for size)
- `codegen-units = 1`
- `lto = true`
- `strip = "debuginfo"`

## Browser Integration

### Terminal System (wasm-terminal)

The project uses a custom TypeScript terminal addon (`wasm-terminal`) built on xterm.js v6:

**Key Features:**
- WASI Preview2 component focus
- Fixed circular dependency in LineBuffer (no more stack overflow)
- Command registration via `wasmTerminal.registerJsCommand("aws", handler)`
- Line buffering for proper stdout/stderr handling
- Command history with arrow key navigation
- Pipe support (`|` operator)

**Integration:**
```typescript
const wasmTerminal = new WasmTerminal("./binaries");
wasmTerminal.registerJsCommand("aws", async (argv) => {
  // Execute WASI Preview2 component
  await awsCommand(argv, ...);
});
```

**File System:**
- File system backed by IndexedDB via `native-file-system-adapter`
- Pre-opened directories available at `/sandbox`
- WASI filesystem interface compatible

### Migration from wasm-webterm

The project migrated from `wasm-webterm` (Wasmer + Emscripten) to `wasm-terminal` (WASI Preview2 only):

**Removed:**
- Wasmer WASI runtime (~500KB)
- Emscripten-specific code
- Web Worker complexity
- WAPM package fetching

**Benefits:**
- Smaller bundle size (999KB vs 1.56MB)
- Better type safety (full TypeScript)
- Standard WASI Preview2 interface
- No stack overflow bugs

## CI/CD

GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`): Build, format check, clippy, test
- **Deploy** (`.github/workflows/deploy.yml`): Build web app and deploy to GitHub Pages

Caching strategy includes cargo registry, target directory, and cargo-run-bin tools.
