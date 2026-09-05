# wasm-web-shell

A WebAssembly-based AWS CLI that runs directly in the browser. The CLI is written in Rust, compiled to WASI Preview 2 components, and executed via a custom xterm.js terminal addon. A Chrome extension embeds the shell into any AWS Console page with automatic credential integration.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable, with `wasm32-wasip2` target)
- [cargo-component](https://github.com/bytecodealliance/cargo-component) (via `cargo bin`)
- [Node.js](https://nodejs.org/) >= 24

## Quick Start

```bash
# Build WASM components
make build-wasi-engine

# Start dev server (http://localhost:8080)
cd www && npm ci && npm start
```

## Project Structure

```
packages/
  aws-cli/          Rust AWS CLI → wasm32-wasip2 component
  providers-adapter/ Credential adapter component
  wasi-engine/       Native wasmtime runner + JS bindgen (build.rs)

www/
  src/              React app + xterm.js terminal
  wasm-terminal/    Custom xterm addon (WASI Preview 2)
  local-echo/       Local echo controller for xterm
  aws-cli/          NPM package wrapping the WASM component
  coreutils/        Unix utilities (cat, ls, echo, etc.)

extension/          Chrome MV3 extension with embed shell
```

## Build Commands

```bash
# Run unit tests
make test-native

# Build + run integration tests
make test-integration
```

## Running Environments

**Browser (standalone):**
```bash
cd www && npm start
# → http://localhost:8080
```

**Chrome Extension:**
```bash
make build-extension
# Load extension/ as unpacked extension in chrome://extensions
# Navigate to any AWS Console page — shell appears at the bottom
```

**Node.js:**
```bash
cd www/aws-cli/component && npm start
```

**wasmtime (native):**
```bash
cd packages/wasi-engine && cargo run -- s3 ls --region us-east-2 --no-sign-request s3://nara-national-archives-catalog/authority-records/organization/
```

## Chrome Extension

The extension embeds the shell into AWS Console pages. It extracts the session's credentials — no API keys or manual login required.

See [extension/README.md](extension/README.md) for architecture details and troubleshooting.

## License

[MIT](LICENSE)
