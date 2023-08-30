import { importObject, WasiHttp } from "@bytecodealliance/preview2-shim";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiate } from "../component/aws.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type { Parameters<typeof import("../component/aws").instantiate>[0] } */
async function compileCore(url) {
  const fullPath = path.resolve(dirname, "../component", url);
  const bytes = await fs.readFile(fullPath);
  return WebAssembly.compile(bytes);
}

function getEnvironment() {
  return Object.entries({
    // AWS_ACCESS_KEY_ID: process.env["AWS_ACCESS_KEY_ID"],
    // AWS_SECRET_ACCESS_KEY: process.env["AWS_SECRET_ACCESS_KEY"],
    // AWS_SESSION_TOKEN: process.env["AWS_SESSION_TOKEN"],
  });
}

function getArguments() {
  return [
    "s3",
    "list-objects",
    "-vvvvv",
    "--region",
    "us-east-2",
    // "--help"
    "--bucket",
    "nara-national-archives-catalog",
    "--delimiter",
    "/",
    "--prefix",
    "authority-records/organization/",
    "--max-keys",
    "5",
  ];
}

const wasiHttp = new WasiHttp();
importObject["http"] = {
  ...importObject["http"],
  outgoingHandler: wasiHttp,
  types: wasiHttp,
};
importObject["io"] = {
  ...importObject["io"],
  streams: {
    ...importObject["io"]["streams"],
    ...wasiHttp,
  },
};
importObject["cli"] = {
  ...importObject["cli"],
  environment: {
    getEnvironment,
    getArguments,
  },
};

async function initialize(imports = {}) {
  return await instantiate(compileCore, {
    ...importObject,
    ...imports,
  });
}

export {
  importObject as wasiImport,
  initialize,
}

const command = await initialize();
command["wasi:cli/run"].run();
