import { test, expect } from '@playwright/test';
import { gotoShell, typeCommand, getTerminalText } from './helpers';

test.describe('Symbolic links', () => {
  test('ln -s then ls -la shows the link pointing at its target', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "target contents" > target.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ln -s target.txt link.txt');
    await page.waitForTimeout(1500);

    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1500);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('link.txt -> target.txt');
    expect(terminalText).not.toContain('cannot access');
  });

  test('cat follows a symlink to read the target contents', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "hello via symlink" > cat-target.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ln -s cat-target.txt cat-link.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'cat cat-link.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('hello via symlink');
  });

  test('deleting and recreating a symlink still shows it correctly', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'echo "target contents" > redo-target.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'ln -s redo-target.txt redo-link.txt');
    await page.waitForTimeout(1500);

    await typeCommand(page, 'rm redo-link.txt');
    await page.waitForTimeout(1500);

    await typeCommand(page, 'ln -s redo-target.txt redo-link.txt');
    await page.waitForTimeout(1500);

    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1500);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('redo-link.txt -> redo-target.txt');
    expect(terminalText).not.toContain('cannot access');
  });

  test('a dangling symlink is listed without erroring', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'ln -s missing-target.txt dangling-link.txt');
    await page.waitForTimeout(1500);

    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1500);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('dangling-link.txt -> missing-target.txt');
    expect(terminalText).not.toContain('cannot access');
  });

  test('readlink prints the stored target of a symlink', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(page, 'ln -s some-target.txt readlink-test.txt');
    await page.waitForTimeout(1000);

    await typeCommand(page, 'readlink readlink-test.txt');
    await page.waitForTimeout(1000);

    const terminalText = await getTerminalText(page);
    expect(terminalText).toContain('some-target.txt');
  });
});
