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
