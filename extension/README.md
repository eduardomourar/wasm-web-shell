# WASM AWS CLI Chrome Extension

Chrome extension that embeds an AWS CLI terminal (powered by WebAssembly) directly into any AWS Console page. It uses the Console's existing session to provide temporary AWS credentials — no extra login or API keys required.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ AWS Console Page (e.g. eu-west-1.console.aws.amazon.com)    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Content Script (content.js) — isolated world          │  │
│  │  • Extracts CSRF token from <meta name="tb-data">     │  │
│  │  • Extracts region from page hostname                 │  │
│  │  • Injects iframe + divider UI                        │  │
│  │  • Relays messages between iframe ↔ background        │  │
│  └──────────────────────────┬────────────────────────────┘  │
│                             │ postMessage                   │
│  ┌──────────────────────────▼────────────────────────────┐  │
│  │ Iframe (chrome-extension://…/shell/index.html)        │  │
│  │  • Extension origin → wasm-unsafe-eval CSP applies    │  │
│  │  • Runs React + xterm.js + WASM AWS CLI               │  │
│  │  • Requests credentials via postMessage to parent     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                             │
                chrome.runtime.sendMessage
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ Background Service Worker (background.js)                    │
│  • Receives credential requests from content script          │
│  • Reads AWS Console cookies via chrome.cookies API          │
│  • Fetches fresh CSRF token if needed (no CORS restrictions) │
│  • POSTs to /{serviceId}/tb/creds (TangerineBox endpoint)    │
│  • Returns temporary AWS credentials to content script       │
└──────────────────────────────────────────────────────────────┘
```

### Why this architecture?

| Constraint | Solution |
|-----------|----------|
| WASM requires `wasm-unsafe-eval` CSP | Iframe on `chrome-extension://` origin has its own CSP |
| Console page CSP blocks WASM in content scripts | Content script is lightweight — only UI + message relay |
| Cross-region requests are blocked by CORS | Background worker's `fetch()` is not subject to CORS |
| Need Console session cookies for TangerineBox | Background uses `chrome.cookies` API + `credentials: "include"` |
| CSRF token is tied to the page session | Content script extracts it from `<meta name="tb-data">` |

## File Structure

```
extension/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker (built from www/src/extension/background.ts)
├── content.js                 # Content script (built from www/src/extension/content.ts)
├── images/                    # Extension icons
└── shell/                     # Web shell app (built from www/src/)
    ├── index.html             # Entry point loaded in iframe
    ├── main.js                # Webpack bundle (React + xterm + WASM loader)
    ├── *.js                   # Async chunks (WASM component bindings)
    └── *.wasm                 # WebAssembly binaries (AWS CLI, coreutils)
```

### Source files (in `www/src/`)

| File | Role |
|------|------|
| `extension/content.ts` | Content script — UI injection, CSRF extraction, message relay |
| `extension/background.ts` | Background worker — cookie management, TangerineBox API calls |
| `extension/utils.ts` | Shared utilities (CSRF token parsing) |
| `aws-providers.ts` | Credential/region provider used by the WASM shell app |
| `aws-tb-services.json` | Maps AWS SDK service IDs to TangerineBox console service IDs |

## How Credentials Work

1. User navigates to an AWS Console page (already authenticated)
2. Content script reads the CSRF token from the page's `<meta name="tb-data">` tag
3. User runs an AWS CLI command (e.g., `aws s3 list-objects ...`)
4. The shell app requests credentials via `postMessage` to the content script
5. Content script forwards to background worker with CSRF token + region + service
6. Background worker:
   - Checks if Console session cookies are valid via `chrome.cookies` API
   - If cookies are stale, fetches the service home page to refresh them and extract a new CSRF token
   - POSTs to `https://{region}.console.aws.amazon.com/{serviceId}/tb/creds`
   - Returns temporary STS credentials (`accessKeyId`, `secretAccessKey`, `sessionToken`)
7. Credentials flow back: background → content script → iframe → AWS SDK

## Installation

### From source

```bash
# Build the extension
make build-extension

# Then in Chrome:
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the extension/ directory
```

### Build commands

```bash
# Full extension build (shell app + content script + background)
make build-extension

# Or from www/ directory:
npm run build:extension

# Individual builds:
npm run build           # Shell app → extension/shell/
npm run build:content   # Content script + background → extension/
```

## Development

### Local development (standalone, without extension)

```bash
cd www
npm run start
# Opens at http://localhost:8080
# Uses localStorage-based credentials (set via setCredentials())
```

### Testing with extension

1. `make build-extension`
2. Load extension in Chrome
3. Navigate to any AWS Console page (must be logged in)
4. The terminal appears at the bottom of the page
5. Try: `aws ssm list-public-parameters`

## Permissions

| Permission | Reason |
|-----------|--------|
| `cookies` | Read Console session cookies for TangerineBox authentication |
| Host: `https://*.console.aws.amazon.com/` | Content script injection, cookie access, fetch credentials |
| Host: `https://amazon.com/`, `https://aws.amazon.com/` | Read `aws-userInfo` and `aws-userInfo-signed` cookies |
| Host: `https://*.signin.aws.amazon.com/` | Redirected when cookies not present for region or service |

## Troubleshooting

### "Extension message timed out: get-region"
The iframe's `postMessage` isn't reaching the content script. Verify:
- Extension is loaded and enabled at `chrome://extensions/`
- You're on a `*.console.aws.amazon.com` page
- Check content script console for errors (DevTools → Console)

### "403: Invalid CSRF token"
The CSRF token expired or doesn't match the session. The background worker should auto-refresh it, but if it persists:
- Refresh the Console page (generates a new CSRF token)
- Check background worker logs (click "service worker" link at `chrome://extensions/`)

### "401: Please (re)authenticate"
The Console session has expired. Log back into the AWS Console.

### WASM compilation errors
If you see CSP-related WASM errors, the iframe isn't loading from the extension origin. Check:
- `web_accessible_resources` in manifest includes `shell/*`
- The iframe `src` uses `chrome.runtime.getURL("shell/index.html")`

### Terminal shows but no credentials
- Open DevTools on the Console page and filter by "[content]"
- Open the background worker DevTools (chrome://extensions → service worker link)
- Look for cookie validation failures or network errors

## Security Notes

- Credentials are temporary STS tokens (typically valid for 1 hour)
- The extension only activates on `*.console.aws.amazon.com` pages
- No credentials are stored — they're fetched on demand for each CLI command
- The CSRF token prevents unauthorized credential requests
- The extension has no access to pages outside AWS Console

## License

MIT
