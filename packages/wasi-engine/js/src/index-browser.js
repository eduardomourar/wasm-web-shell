import { importObject, WasiHttp } from "@bytecodealliance/preview2-shim";
import { instantiate } from "../component/aws.js";

/** @type { Parameters<typeof import("../component/aws").instantiate>[0] } */
async function compileCore(url, _imports) {
  return fetch(url).then(WebAssembly.compileStreaming);
}

function getEnvironment() {
  return Object.entries({
    AWS_API_KEY: "",
  });
}

function getArguments() {
  return [
    "--verbose",
    "--region",
    "us-east-2"
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
