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
 *
 * Also relays generic HTTP requests ("fetch-http") the same way, so the
 * background worker's CORS-exempt fetch can be used for cross-origin AWS
 * API calls (e.g. S3) that a bucket's CORS policy would otherwise block.
 *
 * Also listens for a "toggle-shell" message from the background worker,
 * sent when the user clicks the extension's toolbar icon, and toggles the
 * panel the same way the divider click/keydown handlers do.
 *
 * The collapsed/expanded state and panel height are persisted in
 * chrome.storage.local so they survive page reloads and navigations instead
 * of always starting collapsed at a fixed height. The divider bar doubles
 * as a drag handle to resize the panel while expanded.
 *
 * "Always start collapsed" and "default region override" are set on the
 * options page (options.ts) and also read from chrome.storage.local here.
 */

import { extractCsrfToken } from "./utils";

const DEFAULT_FOOTER_HEIGHT = 34;
// AWS's own reservation for its footer is consistently ~2px larger than what
// getBoundingClientRect() reports for #awsc-nav-footer-content (likely a
// border/margin on an ancestor not included in that element's own rect).
// Subtracting this from our own EXTRA reserved padding closes the leftover
// hairline gap. Empirically determined — adjust if AWS changes that markup.
const FOOTER_RESERVE_CORRECTION = 2;
const STORAGE_KEY_COLLAPSED = "wasmShellCollapsed";
const STORAGE_KEY_HEIGHT = "wasmShellHeightPx";
const STORAGE_KEY_ALWAYS_COLLAPSED = "wasmShellAlwaysCollapsed";
const STORAGE_KEY_REGION_OVERRIDE = "wasmShellRegionOverride";
const MIN_EXPANDED_HEIGHT = 120;
const MAX_EXPANDED_HEIGHT_RATIO = 0.9;
const DRAG_THRESHOLD_PX = 3;

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

const handleFetchHttp = async (
  data: {
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    _requestId: string,
  },
) => {
  const base = {
    action: "fetch-http-response",
    _requestId: data._requestId,
  };

  // Relay to background service worker (not subject to CORS)
  try {
    const response = await chrome.runtime.sendMessage({
      action: "fetch-http",
      url: data.url,
      method: data.method,
      headers: data.headers,
      body: data.body,
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
  regionOverride: string | null,
  defaultRegion: string | null,
) => {
  const base = {
    action: "get-region-response",
    _requestId: data._requestId,
    region: regionOverride ?? defaultRegion,
  };

  // The options-page override is an explicit user preference — it should
  // win over the region cookie, not just serve as a last-resort fallback.
  if (regionOverride) {
    return base;
  }

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

// AWS's Console already reserves body space for its own fixed footer bar
// — roughly the distance from the viewport bottom to the footer's top.
// Our fixed panel sits above/over that footer, so we only need to reserve
// whatever EXTRA space it needs beyond what AWS already reserves; adding
// the full footer height again on top of that leaves a blank strip once
// scrolled to the very bottom (in both collapsed and expanded states).
const getFooterOffset = () => {
  const awsNavFooter = document.getElementById("awsc-nav-footer-content");
  return awsNavFooter
    ? window.innerHeight - awsNavFooter.getBoundingClientRect().top
    : DEFAULT_FOOTER_HEIGHT;
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
const init = async (csrfToken: string) => {
  // Region from hostname: us-east-1.console.aws.amazon.com
  const regionMatch = window.location.hostname.match(
    /^([a-z0-9-]+)\.console\.aws\.amazon\.com$/
  );
  const defaultRegion = regionMatch?.[1] ?? null;
  let regionOverride: string | null = null;

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
    transition: "height 0.2s ease, bottom 0.2s ease",
  });

  // Divider bar
  const divider = document.createElement("div");
  divider.title = "AWS CLI Web Shell (click to expand)";
  divider.tabIndex = 0;
  divider.setAttribute("role", "button");
  divider.setAttribute("aria-expanded", "false");
  Object.assign(divider.style, {
    height: "6px",
    minHeight: "6px",
    background: "#ec7211",
    cursor: "row-resize",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingLeft: "6px",
    overflow: "visible",
    userSelect: "none",
    borderTop: "1px solid #ec7211",
  });

  const chevron = document.createElement("span");
  chevron.textContent = "\u25BC";
  Object.assign(chevron.style, {
    color: "rgba(85,85,85,0.9)",
    fontSize: "16px",
    lineHeight: "1.2",
    background: "rgba(208,208,208,0.8)",
    padding: "2px 8px",
    borderRadius: "6px",
    position: "relative",
    left: "12px",
    top: "-10px",
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
  let collapsed = true;
  let expandedHeight = Math.round(window.innerHeight / 3);

  const maxExpandedHeight = () => window.innerHeight * MAX_EXPANDED_HEIGHT_RATIO;

  const applyState = () => {
    const footerOffset = getFooterOffset();
    if (collapsed) {
      const dividerHeight = 6;
      container.style.bottom = `${footerOffset}px`;
      container.style.height = `${dividerHeight}px`;
      iframe.style.display = "none";
      chevron.textContent = "\u25B2";
      divider.title = "AWS CLI Web Shell (click to expand)";
      divider.setAttribute("aria-expanded", "false");
      document.body.style.paddingBottom = `${Math.max(0, dividerHeight - FOOTER_RESERVE_CORRECTION)}px`;
    } else {
      expandedHeight = Math.min(maxExpandedHeight(), Math.max(MIN_EXPANDED_HEIGHT, expandedHeight));
      container.style.bottom = "0";
      container.style.height = `${expandedHeight}px`;
      iframe.style.display = "block";
      chevron.textContent = "\u25BC";
      divider.title = "AWS CLI Web Shell (click to collapse, drag to resize)";
      divider.setAttribute("aria-expanded", "true");
      document.body.style.paddingBottom = `${Math.max(0, expandedHeight - footerOffset - FOOTER_RESERVE_CORRECTION)}px`;
    }
  };

  const toggle = () => {
    collapsed = !collapsed;
    applyState();
    chrome.storage.local.set({ [STORAGE_KEY_COLLAPSED]: collapsed });
  };

  // Drag-to-resize: only active while expanded. A drag that moves less than
  // DRAG_THRESHOLD_PX is still treated as a click (collapse/expand toggle).
  let isDragging = false;
  let dragMoved = false;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragOverlay: HTMLDivElement | null = null;

  divider.addEventListener("mousedown", (event: MouseEvent) => {
    if (collapsed) return;
    isDragging = true;
    dragMoved = false;
    dragStartY = event.clientY;
    dragStartHeight = expandedHeight;
    // Disable the height/bottom transition while dragging — otherwise every
    // mousemove-driven resize gets animated over 0.2s, which reads as lag.
    container.style.transition = "none";

    // The iframe is a separate document — if the cursor moves over it
    // mid-drag, our window-level mousemove/mouseup listeners stop receiving
    // events (they go to the iframe's own document instead), which makes
    // the drag appear to freeze/lag. A full-viewport overlay above the
    // iframe captures pointer events for the duration of the drag.
    dragOverlay = document.createElement("div");
    Object.assign(dragOverlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1000000",
      cursor: "row-resize",
    });
    document.documentElement.appendChild(dragOverlay);

    event.preventDefault();
  });

  window.addEventListener("mousemove", (event: MouseEvent) => {
    if (!isDragging) return;
    const deltaY = dragStartY - event.clientY; // dragging up increases height
    if (Math.abs(deltaY) > DRAG_THRESHOLD_PX) dragMoved = true;
    expandedHeight = Math.min(maxExpandedHeight(), Math.max(MIN_EXPANDED_HEIGHT, dragStartHeight + deltaY));
    container.style.height = `${expandedHeight}px`;
    document.body.style.paddingBottom = `${Math.max(0, expandedHeight - getFooterOffset() - FOOTER_RESERVE_CORRECTION)}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    container.style.transition = "height 0.2s ease, bottom 0.2s ease";
    dragOverlay?.remove();
    dragOverlay = null;
    if (dragMoved) {
      chrome.storage.local.set({ [STORAGE_KEY_HEIGHT]: expandedHeight });
    } else {
      // The overlay makes mousedown/mouseup land on different elements, so
      // the browser never synthesizes a native "click" here — decide the
      // toggle ourselves instead of relying on the click listener below
      // (which only fires for the no-overlay, collapsed-state case).
      toggle();
    }
  });

  divider.addEventListener("click", () => {
    if (dragMoved || isDragging) {
      return;
    }
    toggle();
  });
  divider.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });

  // Toolbar icon click (relayed from background.ts) also toggles the panel.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "toggle-shell") {
      toggle();
    }
  });

  divider.addEventListener("mouseenter", () => {
    divider.style.background = "#ff9900";
  });
  divider.addEventListener("mouseleave", () => {
    divider.style.background = "#ec7211";
  });

  // Re-sync collapsed height/position with the AWS footer on viewport resize
  window.addEventListener("resize", applyState);

  // Restore the user's last collapsed/expanded state and height (persisted across reloads),
  // plus preferences set on the options page.
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_COLLAPSED,
    STORAGE_KEY_HEIGHT,
    STORAGE_KEY_ALWAYS_COLLAPSED,
    STORAGE_KEY_REGION_OVERRIDE,
  ]);
  if (stored[STORAGE_KEY_ALWAYS_COLLAPSED] === true) {
    collapsed = true;
  } else if (typeof stored[STORAGE_KEY_COLLAPSED] === "boolean") {
    collapsed = stored[STORAGE_KEY_COLLAPSED];
  }
  if (typeof stored[STORAGE_KEY_HEIGHT] === "number") {
    expandedHeight = stored[STORAGE_KEY_HEIGHT];
  }
  if (typeof stored[STORAGE_KEY_REGION_OVERRIDE] === "string" && stored[STORAGE_KEY_REGION_OVERRIDE]) {
    regionOverride = stored[STORAGE_KEY_REGION_OVERRIDE];
  }

  applyState();
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
        handleGetRegion(data, regionOverride, defaultRegion)
          .then(reply)
          .catch(reply);
        break;

      case "fetch-http":
        handleFetchHttp(data)
          .then(reply)
          .catch(reply);
        break;
    }
  });
};

/**
 * Render a disabled divider-only indicator when the shell can't be started
 * on this page (no CSRF token found), instead of injecting nothing and
 * leaving the user with no signal that the extension is even active here.
 */
const initUnavailable = () => {
  const footerOffset = getFooterOffset();
  const bar = document.createElement("div");
  bar.id = "wasm-shell-container";
  bar.title = "AWS CLI Web Shell unavailable on this page";
  Object.assign(bar.style, {
    position: "fixed",
    bottom: `${footerOffset}px`,
    left: "0",
    width: "100%",
    height: "6px",
    minHeight: "6px",
    background: "#888",
    cursor: "not-allowed",
    zIndex: "999999",
    borderTop: "1px solid #888",
  });

  // AWS's Console already reserves room for its own fixed footer bar — only
  // reserve the extra 6px for our indicator bar sitting above it.
  document.body.style.paddingBottom = `${Math.max(0, 6 - FOOTER_RESERVE_CORRECTION)}px`;
  document.documentElement.appendChild(bar);
};

if (document.getElementById("wasm-shell-container")) {
  console.debug("[content] Already injected.");
} else if (!csrfToken) {
  console.debug("[content] No CSRF token found — showing unavailable indicator.");
  initUnavailable();
} else {
  init(csrfToken);
}
