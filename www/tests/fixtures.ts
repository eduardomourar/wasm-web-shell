import { test as base, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * WebKit's OPFS implementation needs a persistent, on-disk profile to back
 * it - `browser.newContext()`'s default ephemeral context makes
 * `navigator.storage.getDirectory()` throw a generic UnknownError, which
 * breaks every command since the shell can't set up its preopens.
 * Chromium and Firefox don't have this restriction.
 */
export const test = base.extend<{}, {}>({
  context: async ({ browser, browserName, playwright, contextOptions }, use) => {
    if (browserName !== 'webkit') {
      const context = await browser.newContext(contextOptions);
      await use(context);
      await context.close();
      return;
    }

    const userDataDir = mkdtempSync(join(tmpdir(), 'wk-profile-'));
    const context = await playwright.webkit.launchPersistentContext(userDataDir, contextOptions);
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect };
