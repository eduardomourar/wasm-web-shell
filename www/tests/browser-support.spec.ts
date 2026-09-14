import { test, expect } from './fixtures';
import { gotoShell, typeCommand, getTerminalText, waitForIdlePrompt } from './helpers';

/**
 * Guards against the exact regression this suite was written for: the
 * generated component bindings need WebAssembly JS Promise Integration
 * (JSPI), which was missing in Safari/WebKit until Safari Technology
 * Preview 252. Without it, commands used to hang or throw a cryptic
 * `TypeError: undefined is not a constructor (evaluating 'new
 * WebAssembly.Suspending(...))'` with no visible feedback in the terminal.
 */
test.describe('Browser support (JSPI)', () => {
  test('WebAssembly.Suspending is available', async ({ page }) => {
    await gotoShell(page);

    const jspiSupported = await page.evaluate(
      () => typeof (WebAssembly as any).Suspending === 'function'
    );
    expect(jspiSupported).toBe(true);
  });

  test('welcome banner does not show the JSPI unsupported warning', async ({ page }) => {
    await gotoShell(page);

    const terminalText = await getTerminalText(page);
    expect(terminalText).not.toContain('JS Promise Integration');
  });

  test('a coreutils command runs and returns output instead of hanging or throwing', async ({
    page,
  }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo jspi-smoke-test');
    const terminalText = await waitForIdlePrompt(page);

    expect(terminalText).toContain('jspi-smoke-test');
    expect(terminalText).not.toContain('does not support the WebAssembly');
  });
});
