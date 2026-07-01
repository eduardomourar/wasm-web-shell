/**
 * AWS credential and region providers for the WASM shell app.
 *
 * When running inside the Chrome extension iframe:
 * - Communicates with the content script (parent window) via postMessage
 * - Content script relays to background worker which fetches credentials
 * - No direct access to Console cookies or APIs from here
 *
 * When running standalone (localhost dev server):
 * - Falls back to localStorage-based credentials (set via setCredentials())
 *
 * Message protocol with content script:
 * - Request:  { action: "get-credentials", serviceId, region, _requestId }
 * - Response: { action: "get-credentials-response", accessKeyId, ..., _requestId }
 * - Request:  { action: "get-region", _requestId }
 * - Response: { action: "get-region-response", region, _requestId }
 *
 * The _requestId field correlates responses to requests when multiple
 * concurrent requests are in flight.
 */

const REQUEST_TIMEOUT_MS = 15000;

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

class CredentialsNotLoaded extends Error {
  tag = "credentials-not-loaded";
}

class ProviderError extends Error {
  tag = "provider-error" ;
}

// Cached region to be used by credentials provider
let cachedRegion: string | undefined;

// A global incrementing counter to keep requests distinct
let messageCounter = 0;

/**
 * Send a message to the parent window (content script) and wait for a typed response.
 * The iframe posts to the content script which runs in the Console page context
 * and can make same-origin requests with cookies.
 */
const sendToContentScript = <T>(message: Record<string, unknown>): Promise<T> => {
  console.debug("[sendToContentScript] message=", message);
  return new Promise((resolve, reject) => {
    // When running standalone (not in extension iframe), skip
    if (window.parent === window) {
      reject(new Error("Not running inside the extension iframe"));
      return;
    }
    const requestId = ++messageCounter;
    const responseAction = message["action"] + "-response";

    // Attach the tracking ID to the outgoing payload
    const outboundPayload = { ...message, _requestId: requestId };

    let timer: NodeJS.Timeout;

    const handler = (event: MessageEvent) => {
      console.debug("[sendToContentScript:handler] eventData=", event.data);
      if (event.data?.action === responseAction && event.data?._requestId === requestId) {
        window.removeEventListener("message", handler);
        clearTimeout(timer);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data as T);
        }
      }
    };
    window.addEventListener("message", handler);

    timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error(`Extension message timed out: ${message["action"]}`));
    }, REQUEST_TIMEOUT_MS);

    window.parent.postMessage(outboundPayload, "*");
  });
};

/**
 * Provide the AWS region.
 * When called with a region (from --region flag), caches it.
 * When called without, asks the content script for the Console page's region.
 */
const provideRegion = async (region: string | undefined): Promise<string | undefined> => {
  if (region) {
    cachedRegion = region;
    return region;
  }
  if (cachedRegion) {
    return cachedRegion;
  }
  try {
    const response = await sendToContentScript<{ region: string | null }>({
      action: "get-region",
    });
    cachedRegion = response.region ?? undefined;
    return cachedRegion;
  } catch (err) {
    console.debug("[provideRegion] Failed to get region:", err);
    return undefined;
  }
};

/**
 * Provide AWS credentials for a given service.
 * The content script fetches from TangerineBox in the Console page context
 * (same-origin, cookies included automatically by the browser).
 */
const provideCredentials = async (serviceId: string | undefined): Promise<AwsCredentials> => {
  try {
    // Running standalone, use plain-text credentials in localstorage for backwards compatibility
    if (window.parent === window) {
      const raw = localStorage.getItem("aws-secret");
      const { accessKeyId, secretAccessKey, sessionToken, expiresAfter } = JSON.parse(raw ?? "{}") as Record<string, string>;
      if (accessKeyId && secretAccessKey) {
        console.debug('[provideCredentials] Using plain-text aws-secret cookie');
        return {
          accessKeyId,
          secretAccessKey,
          sessionToken,
          expiresAfter: expiresAfter ? BigInt(expiresAfter) : undefined,
        };
      }
      throw new CredentialsNotLoaded("Unable to load aws-secret cookie")
    }

    if (!serviceId || serviceId.startsWith("sts")) {
      throw new ProviderError(`Service not supported: ${serviceId}`)
    }

    const region = await provideRegion(undefined);

    if (!region) {
      throw new ProviderError("No region available")
    }

    const { accessKeyId, secretAccessKey, sessionToken, expiration } = await sendToContentScript<{
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiration?: string;
    }>({
      action: "get-credentials",
      serviceId,
      region,
    }).catch((err: any) => {
      return Promise.reject(new CredentialsNotLoaded(`Failed for ${serviceId}: ${err?.message || String(err)}`));
    });

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiresAfter: expiration
        ? BigInt(new Date(expiration).valueOf())
        : undefined,
    };
  } catch (err: any) {
    console.debug("[provideCredentials]:", err);
    throw err;
  } finally {
    cachedRegion = undefined;
  }
};

export const setCredentials = async (value: AwsCredentials = EXAMPLE_CREDENTIALS) => {
  const credentials = JSON.stringify(value);
  localStorage.setItem("aws-secret", credentials);
};

export const providers = {
  provideCredentials,
  provideRegion,
};
