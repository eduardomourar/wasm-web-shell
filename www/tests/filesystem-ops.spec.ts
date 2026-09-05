import { test, expect } from '@playwright/test';
import { gotoShell, typeCommand, getTerminalText } from './helpers';

test.describe('Filesystem operations', () => {
  test('mkdir creates a directory that shows up in ls, rmdir removes it', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'mkdir my-dir');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1000);

    let terminalText = await getTerminalText(page);
    expect(terminalText).toContain('my-dir');

    await typeCommand(page, 'rmdir my-dir');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1000);

    terminalText = await getTerminalText(page);
    const lines = terminalText.split('\n');
    const lastLsLines = lines.slice(lines.length - 6);
    expect(lastLsLines.join('\n')).not.toContain('my-dir');
  });

  test('cp copies a file, leaving the original in place', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "copy me" > cp-source.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cp cp-source.txt cp-dest.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat cp-source.txt cp-dest.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    const occurrences = terminalText.split('copy me').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test('mv renames a file', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "move me" > mv-source.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'mv mv-source.txt mv-dest.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat mv-dest.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ls mv-source.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('move me');
    expect(terminalText).toContain('No such file or directory');
  });

  test('rm deletes a file', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "delete me" > rm-target.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'rm rm-target.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat rm-target.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('No such file or directory');
  });
});
