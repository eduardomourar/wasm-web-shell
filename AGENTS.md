# Overall Instructions

This file provides guidance to AI Agents when working with code in this repository.

## Project Overview

This is a WebAssembly-based web shell that runs AWS CLI commands directly in the browser. The AWS CLI is written in Rust, compiled to WebAssembly components using the WASI P2 standard, and executed both in the browser and via wasmtime for testing.

**Key Architecture:**

- **Rust WASM Components**: AWS CLI compiled to `wasm32-wasip2` target
- **Browser Execution**: Web terminal using xterm.js with WASM execution in Web Workers
- **Native Testing**: wasmtime engine for running and testing components locally
- **Build Pipeline**: JS bindings auto-generated from WASM components via `js-component-bindgen`

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

- **Main entry**: `src/index.ts`
- **Terminal UI**: `src/web-shell.ts` - integrates xterm.js with WASM execution
- **AWS Commands**: `src/aws-command.ts` - bridges terminal to WASM component
- **Component Package**: `aws-cli/` - npm package wrapping WASM component
  - `component/` - auto-generated JS bindings from `wasi-engine/build.rs`
  - `src/index-browser.js` - browser-specific initialization
  - `src/index.js` - Node.js compatibility

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

## Key Technical Constraints

### WASI P2 and HTTP

- Target: `wasm32-wasip2` (WASI Preview 2)
- HTTP requests use `wasi:http` interface via `aws-smithy-wasm` crate
- wasmtime runner configured with `-S http` to enable HTTP support
- Browser execution uses `@bytecodealliance/preview2-shim`

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

The web shell registers AWS commands via `wasmWebTerm.registerJsCommand("aws", handler)`:

- Commands execute in a Web Worker for non-blocking execution
- Uses Comlink for Worker communication
- File system backed by IndexedDB via `native-file-system-adapter`
- Pre-opened directories available at `/sandbox`

## CI/CD

GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`): Build, format check, clippy, test
- **Deploy** (`.github/workflows/deploy.yml`): Build web app and deploy to GitHub Pages

Caching strategy includes cargo registry, target directory, and cargo-run-bin tools.
