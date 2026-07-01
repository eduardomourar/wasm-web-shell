/**
 * Extension content script.
 *
 * Runs in Chrome's "isolated world" on AWS Console pages. This means:
 * - It shares the DOM with the page (can read meta tags, inject elements)
 * - It has its own JS context (page scripts can't access its variables)
 * - It can use chrome.* APIs (runtime.sendMessage, runtime.getURL, etc.)
 * - fetch() from here is subject to the PAGE's CORS policy (hence why
 *   credential fetching is delegated to the background worker)
 *
 * Responsibilities:
 * 1. Extract CSRF token from <meta name="tb-data"> on the Console page
 * 2. Inject an iframe (chrome-extension:// origin) with the WASM shell app
 * 3. Relay postMessage from the iframe to the background service worker
 *    and forward responses back to the iframe
 *
 * Message flow:
 *   iframe → postMessage("get-credentials") → content script
 *     → chrome.runtime.sendMessage("fetch-credentials") → background worker
 *     → response → content script → postMessage("get-credentials-response") → iframe
 */

import { extractCsrfToken } from "./utils";

let csrfToken: string | null = extractCsrfToken(document);

const handleGetCredentials = async (
  data: { serviceId: string, region: string, _requestId: string },
  csrfToken: string,
) => {
  const { serviceId, region } = data;
  const base = {
    action: "get-credentials-response",
    _requestId: data._requestId,
  };

  // Relay to background service worker (not subject to CORS)
  try {
    const response = await chrome.runtime.sendMessage({
      action: "fetch-credentials",
      serviceId,
      region,
      csrfToken,
      sourceUrl: window.location.href,
    });

    if (response?.error) {
      return { ...base, error: response.error };
    }
    return { ...base, ...response };
  } catch (err: any) {
    return { ...base, error: err.message || String(err) };
  }
};

const handleGetRegion = async (
  data: { _requestId: string },
  defaultRegion: string | null
) => {
  const base = {
    action: "get-region-response",
    _requestId: data._requestId,
    region: defaultRegion,
  };

  try {
    const response = await chrome.runtime.sendMessage({
      action: "fetch-region",
      origin: window.location.origin,
    });

    if (response?.error) {
      console.debug(response.error);
      return base;
    }
    return { ...base, region: response.value };
  } catch (err: any) {
    console.debug(err.message || String(err));
    return base;
  }
};

/**
 * Initialize the extension UI and message relay.
 *
 * Creates a fixed-position container at the bottom of the page containing:
 * - A thin divider bar (click to collapse/expand)
 * - An iframe loading shell/index.html from the extension's own origin
 *
 * Why an iframe and not Shadow DOM or direct injection?
 * - The AWS Console's CSP blocks WebAssembly in the page context
 * - Extension pages (chrome-extension:// origin) have their own CSP
 *   that includes 'wasm-unsafe-eval', allowing WASM compilation
 * - The iframe also provides full CSS isolation for xterm.js
 */
const init = (csrfToken: string) => {
  // Region from hostname: us-east-1.console.aws.amazon.com
  const regionMatch = window.location.hostname.match(
    /^([a-z0-9-]+)\.console\.aws\.amazon\.com$/
  );
  const defaultRegion = regionMatch?.[1] ?? null;

  // --- UI: container + divider + iframe ---

  const shellUrl = chrome.runtime.getURL("shell/index.html");

  const container = document.createElement("div");
  container.id = "wasm-shell-container";
  Object.assign(container.style, {
    position: "fixed",
    bottom: "0",
    left: "0",
    width: "100%",
    height: "33.33vh",
    zIndex: "999999",
    display: "flex",
    flexDirection: "column",
    transition: "height 0.2s ease",
  });

  // Divider bar
  const divider = document.createElement("div");
  Object.assign(divider.style, {
    height: "1px",
    minHeight: "1px",
    background: "#333",
    cursor: "pointer",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingLeft: "6px",
    overflow: "visible",
    userSelect: "none",
    borderTop: "1px solid #555",
  });

  const chevron = document.createElement("span");
  chevron.textContent = "\u25BC";
  Object.assign(chevron.style, {
    color: "rgba(85,85,85,0.9)",
    fontSize: "16px",
    lineHeight: "1.2",
    background: "rgba(208,208,208,0.8)",
    padding: "0px 6px",
    borderRadius: "6px",
    position: "relative",
    left: "12px",
    top: "-8px",
    transition: "transform 0.2s ease",
  });
  divider.appendChild(chevron);

  // Iframe — runs in extension origin where wasm-unsafe-eval is allowed
  const iframe = document.createElement("iframe");
  iframe.id = "wasm-shell-iframe";
  iframe.src = shellUrl;
  Object.assign(iframe.style, {
    flex: "1",
    width: "100%",
    border: "none",
    background: "#000",
  });

  container.appendChild(divider);
  container.appendChild(iframe);

  // Collapse / expand
  let collapsed = false;
  divider.addEventListener("click", () => {
    collapsed = !collapsed;
    if (collapsed) {
      container.style.height = "6px";
      iframe.style.display = "none";
      chevron.textContent = "\u25B2";
      document.body.style.paddingBottom = "6px";
    } else {
      container.style.height = "33.33vh";
      iframe.style.display = "block";
      chevron.textContent = "\u25BC";
      document.body.style.paddingBottom = "33.33vh";
    }
  });

  divider.addEventListener("mouseenter", () => {
    divider.style.background = "#555";
  });
  divider.addEventListener("mouseleave", () => {
    divider.style.background = "#333";
  });

  // Inject into page
  document.body.style.paddingBottom = "33.33vh";
  document.documentElement.appendChild(container);

  // --- Message relay: iframe <-> content script ---

  const extensionOrigin = chrome.runtime.getURL("").slice(0, -1); // e.g. "chrome-extension://abc123"

  window.addEventListener("message", (event: MessageEvent) => {
    console.debug(`[content] event details: origin=${event.origin}, extensionOrigin=${extensionOrigin}`);
    // Accept messages from the iframe we injected.
    const isFromOurIframe =
      event.source === iframe.contentWindow ||
      (event.origin === extensionOrigin && event.source !== window);

    if (!isFromOurIframe) return;

    const data = event.data;
    if (!data?.action) return;

    console.debug("[content] Received message from iframe:", data.action);

    // Reply back using event.source (the actual sender window reference)
    const reply = (msg: object) => {
      const result = {
        ...msg,
        _requestId: data._requestId,
      };
      console.debug("[content] Reply to iframe: result=", result);
      (event.source as WindowProxy).postMessage(result, event.origin ?? "*");
    };

    switch (data.action) {
      case "get-credentials":
        handleGetCredentials(data, csrfToken)
          .then(reply)
          .catch(reply);
        break;

      case "get-region":
        handleGetRegion(data, defaultRegion)
          .then(reply)
          .catch(reply);
        break;
    }
  });
};

if (!csrfToken) {
  console.debug("[content] No CSRF token found — skipping injection.");
} else if (document.getElementById("wasm-shell-container")) {
  console.debug("[content] Already injected.");
} else {
  init(csrfToken);
}
