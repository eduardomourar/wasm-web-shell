import { test, expect } from '@playwright/test';

async function typeCommand(page: import('@playwright/test').Page, command: string) {
  await page.locator('.xterm-screen').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

function getTerminalText(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.xterm-rows > div');
    return Array.from(rows).map((row) => row.textContent || '').join('\n');
  });
}

test.describe('Shell redirection', () => {
  test('should write stdout to a file with > and read it back', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.xterm-screen', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await typeCommand(page, 'echo "hello redirect" > redirect-test.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat redirect-test.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('hello redirect');
  });

  test('should append stdout to a file with >>', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.xterm-screen', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await typeCommand(page, 'echo "line one" > append-test.txt');
    await page.waitForTimeout(1000);
    await typeCommand(page, 'echo "line two" >> append-test.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat append-test.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('line one');
    expect(terminalText).toContain('line two');
  });
});
