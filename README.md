# wasm-web-shell

## Prerequisite

- [Rust](https://www.rust-lang.org/tools/install)
- [Cargo Component](https://github.com/bytecodealliance/cargo-component)
- [Node.js](https://nodejs.org/en/download)

## Run locally

Install all Rust dependencies from root and build:

```shell
cargo build
```

From within the [www](./www) directory, run the following command to install JavaScript project and start serving webpage.

```shell
npm ci
npm start
```

From the browser, access your page for the WebAssembly Web Shell at `http://localhost:8080`.
