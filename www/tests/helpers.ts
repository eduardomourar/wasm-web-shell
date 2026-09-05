import type { Page } from '@playwright/test';

export async function typeCommand(page: Page, command: string) {
  await page.locator('.xterm-screen').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

export function getTerminalText(page: Page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.xterm-rows > div');
    return Array.from(rows).map((row) => row.textContent || '').join('\n');
  });
}

export async function gotoShell(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.xterm-screen', { timeout: 10000 });
  await page.waitForTimeout(2000);
}

/**
 * Waits for the shell to return to an idle prompt after running a command.
 *
 * xterm only renders the visible viewport, so once output scrolls past a
 * screen's worth of lines the original `$ <command>` line (and any prompt
 * count based on it) is no longer in the DOM - counting "$" occurrences
 * across getTerminalText() output is unreliable for commands with more than
 * a screenful of output. Instead, poll until the last rendered line is a
 * bare idle prompt and the output has stopped changing.
 */
export async function waitForIdlePrompt(page: Page, timeoutMs = 30000, pollMs = 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let previousText: string | null = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    const text = await getTerminalText(page);
    const lines = text.split('\n').map((line) => line.trim());
    const lastNonEmpty = [...lines].reverse().find((line) => line.length > 0);
    if (lastNonEmpty === '$' && text === previousText) {
      return text;
    }
    previousText = text;
  }
  throw new Error(`Shell did not return to an idle prompt within ${timeoutMs}ms`);
}
