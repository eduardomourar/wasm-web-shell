import { STSClient, GetSessionTokenCommand } from "@aws-sdk/client-sts";
import { WASIShim } from "@bytecodealliance/preview2-shim/instantiation";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiate, type ImportObject, type Root } from "../component/aws.js";

type WASIShimConfig = NonNullable<ConstructorParameters<typeof WASIShim>[0]>;

const dirname = path.dirname(fileURLToPath(import.meta.url));

const compileCore: Parameters<typeof instantiate>[0] = async (url) => {
  const fullPath = path.resolve(dirname, "../component", url);
  const bytes = await fs.readFile(fullPath);
  return WebAssembly.compile(bytes);
};

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const credentialsFromEnv =
  () =>
  async (): Promise<AWSCredentials> => {
    const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
    const sessionToken = process.env["AWS_SESSION_TOKEN"];
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Credentials not available");
    }
    const credentials: AWSCredentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken && { sessionToken }),
    };
    return credentials;
  };

const defaultCredentialsProvider = credentialsFromEnv();

const client = new STSClient({
  credentials: defaultCredentialsProvider,
  region: "us-east-1",
  useGlobalEndpoint: true,
});

const provideRegion = async (region: string | undefined) => {
  if (region) {
    return region;
  }
  return process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "us-east-1";
};

const provideCredentials = async () => {
  let { accessKeyId, secretAccessKey, sessionToken } = await defaultCredentialsProvider().catch((err) => {
    // console.debug(`[node provideCredentials defaultCredentialsProvider] ${err}`);
    return Promise.reject({ tag: "credentials-not-loaded" });
  });
  let expiryAfter: bigint | undefined;
  if (!sessionToken) {
    try {
      const command = new GetSessionTokenCommand({
        DurationSeconds: 3600,
      });
      const { Credentials } = await client.send(command);
      accessKeyId = Credentials!.AccessKeyId!;
      secretAccessKey = Credentials!.SecretAccessKey!;
      sessionToken = Credentials!.SessionToken!;
      if (Credentials?.Expiration) {
        expiryAfter = BigInt(Credentials.Expiration.valueOf());
      }
    } catch (err) {
      // console.debug(`[node provideCredentials getSessionToken] ${err}`);
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        ["InvalidClientTokenId", "SignatureDoesNotMatch"].includes(err.name as string)
      ) {
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

export const initialize = async (
  providers: ImportObject["component:aws-cli/providers"],
  config: Partial<WASIShimConfig> = {}
): Promise<Root> => {
  config.sandbox = {
    preopens: {
      "/tmp": "/tmp",
    },
    env: {},
    args: [
      "aws",
      "s3api",
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
    ["component:aws-cli/providers"]: providers,
  } as any);
};

const command = await initialize({
  provideCredentials,
  provideRegion,
});
await command.run.run();
