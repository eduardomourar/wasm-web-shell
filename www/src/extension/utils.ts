interface MinimalDocument {
  querySelector(selectors: string): Element;
}

/**
 * Extract the CSRF Token from the TangerineBox metadata
 */
export const extractCsrfToken = (doc: MinimalDocument) => {
  const meta = doc.querySelector('meta[name="tb-data"]');
  if (meta) {
    const config = JSON.parse(meta.getAttribute("content") ?? "{}");
    const csrfToken = config.csrfToken;
    console.debug(`[utils:extractCsrfToken] Fresh CSRF token extracted from response body ${"..." + csrfToken.substring(csrfToken.length - 30, csrfToken.length)}`);
    return csrfToken;
  } else {
    console.warn("[utils:extractCsrfToken] tb-data meta tag not found in response HTML");
  }
  return null;
};
