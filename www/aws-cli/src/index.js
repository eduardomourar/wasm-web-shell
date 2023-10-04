import { STSClient, GetSessionTokenCommand } from "@aws-sdk/client-sts";
import { WASIShim } from "@bytecodealliance/preview2-shim/instantiation";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiate } from "../component/aws.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type { Parameters<typeof import("../component/aws").instantiate>[0] } */
const compileCore = async (url) => {
  const fullPath = path.resolve(dirname, "../component", url);
  const bytes = await fs.readFile(fullPath);
  return WebAssembly.compile(bytes);
};

const credentialsFromEnv =
  () =>
  async () => {
    const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
    const sessionToken = process.env["AWS_SESSION_TOKEN"];
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Credentials not available");
    }
    const credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken && { sessionToken }),
    };
    return credentials;
  };

const defaultCredentialsProvider = credentialsFromEnv();

const client = new STSClient({
  credentials: defaultCredentialsProvider,
  region: process.env["AWS_REGION"] ?? "us-east-1",
});

const provideCredentials = async () => {
  let { accessKeyId, secretAccessKey, sessionToken} = await defaultCredentialsProvider().catch(err => {
    console.debug({ err });
    return Promise.reject({ tag: "credentials-not-loaded" });
  });;
  let expiryAfter;
  if (!sessionToken) {
    try {
      const command = new GetSessionTokenCommand({
        DurationSeconds: 3600,
      });
      const { Credentials } = await client.send(command);
      accessKeyId = Credentials.AccessKeyId;
      secretAccessKey = Credentials.SecretAccessKey;
      sessionToken = Credentials.SessionToken;
      if (Credentials?.Expiration) {
        expiryAfter = BigInt(Credentials.Expiration.valueOf());
      }
    } catch(err) {
      console.debug({ err });
      if (err instanceof STSServiceException && ["InvalidClientTokenId", "SignatureDoesNotMatch"].includes(err.name)) {
        throw { tag: "provider-error" };
      }
    }
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiryAfter,
  };
};

const initialize = async (credentialsProvider, config = {}) => {
  config.sandbox = {
    preopens: {
      "/tmp": "/tmp",
    },
    env: {},
    args: [
      "aws",
      "s3",
      "list-objects",
      "-vvv",
      "--region",
      "us-east-2",
      "--bucket",
      "nara-national-archives-catalog",
      "--delimiter",
      "/",
      "--prefix",
      "authority-records/organization/",
      "--max-keys",
      "5",
      "--no-sign-request",
    ],
    enableNetwork: true,
    ...config.sandbox,
  };

  const wasiShim = new WASIShim(config);
  const importObject = wasiShim.getImportObject();
  return await instantiate(compileCore, {
    ...importObject,
    ["component:aws-cli/credentials-provider"]: credentialsProvider,
  });
};

export { initialize };

export * as cli from "@bytecodealliance/preview2-shim/cli";
export * as filesystem from "@bytecodealliance/preview2-shim/filesystem";
export * as io from "@bytecodealliance/preview2-shim/io";
export * as random from "@bytecodealliance/preview2-shim/random";
export * as clocks from "@bytecodealliance/preview2-shim/clocks";
export * as sockets from "@bytecodealliance/preview2-shim/sockets";
export * as http from "@bytecodealliance/preview2-shim/http";

const command = await initialize({
  provideCredentials,
});
await command.run.run();
