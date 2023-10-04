import { cookieStore } from "cookie-store";
import { STSClient, GetSessionTokenCommand, STSServiceException } from "@aws-sdk/client-sts";

const DEFAULT_EXPIRATION = 3600;

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAfter?: bigint;
}

const EXAMPLE_CREDENTIALS: AwsCredentials = {
  accessKeyId: "access_key_id",
  secretAccessKey: "secret_access_key",
  sessionToken: "session_token",
};

const credentialsFromCookie =
  () =>
  async () => {
    const { accessKeyId, secretAccessKey, sessionToken } = await retrieveCredentialsFromCookie();
    const credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken && { sessionToken }),
    };
    return credentials;
  };

const client = new STSClient({
  credentials: credentialsFromCookie(),
  region: "us-east-1",
});

export const provideCredentials = async () => {
  let { accessKeyId, secretAccessKey, sessionToken } = await retrieveCredentialsFromCookie().catch(err => {
    console.debug({ err });
    return Promise.reject({ tag: "credentials-not-loaded" });
  });
  let expiresAfter;
  try {
    if (!sessionToken) {
      const command = new GetSessionTokenCommand({
        DurationSeconds: DEFAULT_EXPIRATION,
      });
      const { Credentials } = await client.send(command);
      accessKeyId = Credentials!.AccessKeyId as string;
      secretAccessKey = Credentials!.SecretAccessKey as string;
      sessionToken = Credentials!.SessionToken;
      if (Credentials?.Expiration) {
        expiresAfter = BigInt(Credentials.Expiration.valueOf());
      }
    }
  } catch(err) {
    console.debug({ err });
    if (err instanceof STSServiceException && ["InvalidClientTokenId", "SignatureDoesNotMatch"].includes(err.name)) {
      throw { tag: "provider-error" };
    }
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAfter,
  };
};

const retrieveCredentialsFromCookie = async (): Promise<AwsCredentials> => {
  const cookie = await cookieStore.get("credentials_aws");
  const credentials = JSON.parse(cookie?.value ?? "{}") as Record<string, string>;
  if (credentials["accessKeyId"] && credentials["secretAccessKey"]) {
    return {
      ...credentials,
      expiresAfter: BigInt(credentials["expiresAfter"]),
    } as unknown as AwsCredentials;
  }
  throw new Error("Credentials not present in cookies");
};

export const setCredentials = async (value: AwsCredentials = EXAMPLE_CREDENTIALS) => {
  const expiresAfter = Date.now() + DEFAULT_EXPIRATION;
  const credentials = JSON.stringify({
    ...value,
    expiresAfter,
  });
  await cookieStore.set({
    domain: null,
    name: "credentials_aws",
    value: credentials,
    expires: expiresAfter,
  });
};
