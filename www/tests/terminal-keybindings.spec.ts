import { test, expect, type Page } from '@playwright/test';
import { gotoShell, getCurrentPromptLine } from './helpers';

/**
 * Regression tests for emacs/readline-style line-editing shortcuts in
 * local-echo (www/local-echo/src/index.ts). These only exercise the input
 * line before Enter is pressed, so no command actually runs.
 *
 * xterm renders asynchronously, so each keystroke needs a short pause
 * before the DOM reflects it - firing keys back-to-back races the render.
 */
async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.waitForTimeout(50);
}

async function type(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(50);
}

test.describe('Terminal line-editing keybindings', () => {
  test.beforeEach(async ({ page }) => {
    await gotoShell(page);
    await page.locator('.xterm-screen').click();
  });

  test('Option/Alt+Left jumps to the previous word', async ({ page }) => {
    await type(page, 'foo bar baz');
    await press(page, 'Alt+ArrowLeft');
    await press(page, 'Alt+ArrowLeft');
    await type(page, '[X]');

    expect(await getCurrentPromptLine(page)).toContain('foo [X]bar baz');
  });

  test('Option/Alt+Right jumps to the next word', async ({ page }) => {
    await type(page, 'foo bar baz');
    await press(page, 'Control+a');
    await press(page, 'Alt+ArrowRight');
    await type(page, '[X]');

    expect(await getCurrentPromptLine(page)).toContain('foo[X] bar baz');
  });

  test('Ctrl+A moves to the start of the line', async ({ page }) => {
    await type(page, 'hello world');
    await press(page, 'Control+a');
    await type(page, '[X]');

    expect(await getCurrentPromptLine(page)).toContain('[X]hello world');
  });

  test('Ctrl+E moves to the end of the line', async ({ page }) => {
    await type(page, 'hello world');
    await press(page, 'Control+a');
    await press(page, 'Control+e');
    await type(page, '[X]');

    expect(await getCurrentPromptLine(page)).toContain('hello world[X]');
  });

  test('Ctrl+K kills to the end of the line', async ({ page }) => {
    await type(page, 'keep this delete this');
    await press(page, 'Control+a');
    for (let i = 0; i < 'keep this'.length; i++) {
      await press(page, 'ArrowRight');
    }
    await press(page, 'Control+k');

    const line = await getCurrentPromptLine(page);
    expect(line).toContain('keep this');
    expect(line).not.toContain('delete this');
  });

  test('Ctrl+U kills from the cursor to the start of the line', async ({ page }) => {
    await type(page, 'delete this keep this');
    await press(page, 'Control+a');
    for (let i = 0; i < 'delete this '.length; i++) {
      await press(page, 'ArrowRight');
    }
    await press(page, 'Control+u');

    const line = await getCurrentPromptLine(page);
    expect(line).toContain('keep this');
    expect(line).not.toContain('delete this');
  });

  test('Ctrl+W deletes the word before the cursor', async ({ page }) => {
    await type(page, 'one two three');
    await press(page, 'Control+w');

    const line = await getCurrentPromptLine(page);
    expect(line).toContain('one two');
    expect(line).not.toContain('three');
  });

  test('Ctrl+D deletes the character under the cursor', async ({ page }) => {
    await type(page, 'abcdef');
    await press(page, 'Control+a');
    await press(page, 'Control+d');

    expect(await getCurrentPromptLine(page)).toContain('bcdef');
  });

  test('Ctrl+D on an empty line does not error or submit', async ({ page }) => {
    await press(page, 'Control+d');
    await type(page, 'still works');

    expect(await getCurrentPromptLine(page)).toContain('still works');
  });

  test('Ctrl+L clears the screen but keeps the current input', async ({ page }) => {
    await type(page, 'still here');
    await press(page, 'Control+l');

    expect(await getCurrentPromptLine(page)).toContain('still here');
  });
});
