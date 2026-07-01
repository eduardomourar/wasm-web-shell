/**
 * Extension background service worker.
 *
 * This runs in a privileged extension context where:
 * - fetch() is NOT subject to CORS (can call any AWS Console regional endpoint)
 * - chrome.cookies API provides direct access to Console session cookies
 * - No DOM access (service workers have no document)
 *
 * Communication flow:
 *   iframe (shell app) → postMessage → content script → chrome.runtime.sendMessage → HERE
 *
 * Handles two message types:
 * - "fetch-credentials": Fetches temporary AWS credentials from TangerineBox
 * - "fetch-region": Reads the noflush_Region cookie to determine the active region
 */

import { DOMParser } from "linkedom";
import { extractCsrfToken } from "./utils";
import tbServices from "./aws-tb-services.json";

const HEADER_CSRF_TOKEN = "x-csrf-token";

const COOKIE_CONSOLE_INFO = "aws-consoleInfo";
const COOKIE_CREDS = "aws-creds";
const COOKIE_D2C_TOKEN = "awsd2c-token";
const COOKIE_USER_INFO = "aws-userInfo";
const COOKIE_USER_INFO_SIGNED = "aws-userInfo-signed";
const COOKIE_REGION = "noflush_Region";

/**
 * Map an AWS SDK service identifier to the TangerineBox console service identifier.
 */
const tangerineBoxServiceId = (sdkId: string): string => {
  const parent = sdkId.split("/")[0];
  const map = tbServices as unknown as Record<string, { tbId: string }>;
  console.debug(`[background:tangerineBoxServiceId] sdkId=${sdkId}, parent=${parent}, tbServicesKeys=`, Object.keys(map));
  return map[sdkId]?.tbId ?? map[parent]?.tbId ?? parent;
};

/**
 * Check if input is a valid TangerineBox service identifier
 */
const isValidServiceId = (serviceId: string): boolean => {
  for (const [sdkId, service] of Object.entries(tbServices)) {
    if (service.tbId === serviceId) {
      console.debug(`[background:isValidServiceId] sdkId=${sdkId}, serviceId=${serviceId}, label=${service.label}`);
      return true;
    }
  }
  return false;
};

/**
 * Parse the the URL to extract region and serviceId.
 * Pattern: https://{region}.console.aws.amazon.com/{serviceId}/home
 */
const parseConsoleUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    // Host: "{region}.console.aws.amazon.com"
    const hostParts = parsed.hostname.split(".console.aws.amazon.com");
    const region = hostParts[0]; // e.g. "us-east-1"

    // Pathname: "/{serviceId}/home"
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    // pathSegments = [serviceId, "home"]
    let serviceId = pathSegments[0];
    if (pathSegments.length >= 3) {
      const service = pathSegments.slice(0, 2).join("/").replace("/home", "");
      if (isValidServiceId(service)) {
        serviceId = service;
      }
    }
    return { region, serviceId };
  } catch (e) {
    console.error("[parseCredsUrl] Failed to parse URL:", url, e);
    return { region: null, serviceId: null };
  }
};

/**
 * Check if a cookie is valid: exists, has a value, and is not expired.
 */
function isCookieValid(cookie: chrome.cookies.Cookie | null) {
  if (!cookie?.value) {
    console.debug(`[background:isCookieValid] Cookie missing or empty value`);
    return false;
  }
  // Session cookies (no expirationDate) are valid as long as they exist
  if (cookie.expirationDate === undefined || cookie.expirationDate === null) {
    console.debug(`[background:isCookieValid] ${cookie.name}: session cookie (no expiration), valid`);
    return true;
  }
  // Check expiration (expirationDate is in seconds since epoch)
  const nowSeconds = Date.now() / 1000;
  const isValid = cookie.expirationDate > nowSeconds;
  const remainingSec = Math.round(cookie.expirationDate - nowSeconds);
  console.debug(`[background:isCookieValid] ${cookie.name}: expires in ${remainingSec}s, valid=${isValid}`);
  return isValid;
}

/**
 * Fetch temporary AWS credentials from TangerineBox.
 *
 * TangerineBox is the AWS Console's internal credential vending service.
 * Each Console service has its own endpoint:
 *   POST https://{region}.console.aws.amazon.com/{serviceId}/tb/creds
 *
 * The request requires:
 * - Valid Console session cookies (aws-consoleInfo, aws-creds, etc.)
 * - A CSRF token in the x-csrf-token header
 *
 * If cookies are stale or the CSRF token doesn't match the target region/service,
 * we first navigate to the service's home page to refresh them.
 */
const fetchCredentials = async (
  service: string,
  region: string,
  token: string,
  sourceUrl: string,
): Promise<object> => {
  let csrfToken = null;

  try {
    const serviceId = tangerineBoxServiceId(service);
    const origin = `https://${region}.console.aws.amazon.com`;
    const serviceOrigin = `${origin}/${serviceId}`;
    const url = `${serviceOrigin}/tb/creds`;
    const parsedDefault = parseConsoleUrl(sourceUrl);
    const forceRefresh = serviceId !== parsedDefault.serviceId || region !== parsedDefault.region || !sourceUrl.startsWith(`${serviceOrigin}/home`);
    console.debug(`[background:fetchCredentials] parsedDefault=${JSON.stringify(parsedDefault)}, forceRefresh=${forceRefresh}`);

    console.debug(`[background:fetchCredentials] Fetching cookies for origin: ${origin}`);
    const [consoleInfo, creds, d2cToken, userInfo, userInfoSigned] = await Promise.all([
      chrome.cookies.get({ url: serviceOrigin, name: COOKIE_CONSOLE_INFO }),
      chrome.cookies.get({ url: serviceOrigin, name: COOKIE_CREDS }),
      chrome.cookies.get({ url: "https://aws.amazon.com", name: COOKIE_D2C_TOKEN }),
      chrome.cookies.get({ url: "https://amazon.com", name: COOKIE_USER_INFO }),
      chrome.cookies.get({ url: "https://amazon.com", name: COOKIE_USER_INFO_SIGNED }),
    ]);
    console.debug("[background:fetchCredentials] Cookies fetched:", {
      consoleInfo: consoleInfo ? { name: consoleInfo.name, domain: consoleInfo.domain, path: consoleInfo.path, hasValue: !!consoleInfo.value, expirationDate: consoleInfo.expirationDate } : null,
      creds: creds ? { name: creds.name, domain: creds.domain, path: creds.path, hasValue: !!creds.value, expirationDate: creds.expirationDate } : null,
      d2cToken: d2cToken ? { name: d2cToken.name, domain: d2cToken.domain, path: d2cToken.path, hasValue: !!d2cToken.value, expirationDate: d2cToken.expirationDate } : null,
      userInfo: userInfo ? { name: userInfo.name, domain: userInfo.domain, path: userInfo.path, hasValue: !!userInfo.value, expirationDate: userInfo.expirationDate } : null,
      userInfoSigned: userInfoSigned ? { name: userInfoSigned.name, domain: userInfoSigned.domain, path: userInfoSigned.path, hasValue: !!userInfoSigned.value, expirationDate: userInfoSigned.expirationDate } : null,
    });

    // STRICT CHECK: Verify ALL cookies exist, have values, and are not expired
    if (token && !forceRefresh && isCookieValid(consoleInfo) && isCookieValid(creds) && isCookieValid(d2cToken) && isCookieValid(userInfo) && isCookieValid(userInfoSigned)) {
      console.log(`✅ All cookies valid for service [${serviceId}] and region [${region}]`);
    } else {
      if (token && !forceRefresh) {
        console.warn(
          `⚠️ One or more cookies were missing or expired.\n` +
          `   [${COOKIE_CONSOLE_INFO}]: ${isCookieValid(consoleInfo) ? "Valid" : "INVALID/MISSING"}\n` +
          `   [${COOKIE_CREDS}]: ${isCookieValid(creds) ? "Valid" : "INVALID/MISSING"}\n` +
          `   [${COOKIE_D2C_TOKEN}]: ${isCookieValid(d2cToken) ? "Valid" : "INVALID/MISSING"}\n` +
          `   [${COOKIE_USER_INFO}]: ${isCookieValid(userInfo) ? "Valid" : "INVALID/MISSING"}\n` +
          `   [${COOKIE_USER_INFO_SIGNED}]: ${isCookieValid(userInfoSigned) ? "Valid" : "INVALID/MISSING"}`
        );
      }

      const refreshUrl = `${origin}/${serviceId}/home?region=${region}&hashArgs=#`;
      console.debug(`[background:fetchCredentials] Refreshing cookies: ${refreshUrl}`);

      const serviceResponse = await fetch(refreshUrl, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
      });

      console.debug(`[background:fetchCredentials] Service response: ok=${serviceResponse.ok}, status=${serviceResponse.status}`);

      // Parse the response body to extract the fresh CSRF token
      try {
        const html = await serviceResponse.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        csrfToken = extractCsrfToken(doc);
      } catch (e) {
        console.warn("Failed to parse response for CSRF token:", e);
      }
    }

    // Fallback: try the current page's meta tag
    if (!csrfToken) {
      console.debug("[background:fetchCredentials] Using CSRF token from current page");
      csrfToken = token;
    }

    console.debug(`[background:fetchCredentials] Fetching credentials from ${url} while injecting header: [${HEADER_CSRF_TOKEN}]`);
    console.debug(`[background:fetchCredentials] CSRF token used in request: ${csrfToken ? "..." + csrfToken.substring(csrfToken.length - 30, csrfToken.length) : "NULL"}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        [HEADER_CSRF_TOKEN]: csrfToken,
      },
      credentials: "include",
    });
    console.debug(`[background:fetchCredentials] Fetch credentials response: ok=${response.ok}, status=${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`TangerineBox error:`, errorText);
      return { error: `${response.status}: ${errorText}` };
    }

    const credentials = await response.json();
    console.debug("[background:fetchCredentials] Credentials fetched successfully");
    return credentials;
  } catch (err: any) {
    console.error("Fetch failed:", err);
    return { error: err.message };
  }
};

const getCookie = async (url: string, name: string) => {
  console.debug(`[background:getCookie] url ${url}, name ${name}`);
  const output = await chrome.cookies.get({ url, name });
  console.debug("[background:getCookie] output:", output);
  if (output && output.value !== "") {
    return { value: output.value };
  }
  return { error: `Cookie ${name} not found or empty.` };
};

/**
 * Message listener — the single entry point for all requests from the content script.
 *
 * Returns `true` to indicate an async response (sendResponse will be called later).
 * Returns `false` for unrecognized messages (Chrome will close the channel).
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "fetch-credentials") {
    const { serviceId, region, csrfToken, sourceUrl } = message;
    fetchCredentials(serviceId, region, csrfToken, sourceUrl)
      .then(sendResponse)
      .catch(sendResponse);
    return true; // async response
  } else if (message.action === "fetch-region") {
    const { origin } = message;
    getCookie(origin, COOKIE_REGION)
      .then(sendResponse)
      .catch(sendResponse);
    return true; // async response
  }
  return false;
});
