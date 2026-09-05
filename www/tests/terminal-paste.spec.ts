import { test, expect } from '@playwright/test';

test.describe('Terminal paste behavior', () => {
  test('should not duplicate prompt when pasting long command', async ({ page }) => {
    // Navigate to the terminal
    await page.goto('/');

    // Wait for terminal to be ready
    await page.waitForSelector('.xterm-screen', { timeout: 10000 });

    // Wait for welcome message and prompt to appear
    await page.waitForTimeout(2000);

    // Long command that wraps (>160 characters)
    const longCommand = 'aws s3 list-objects --region us-east-2 --bucket nara-national-archives-catalog --delimiter / --prefix authority-records/organization/ --max-keys 2 --no-sign-request';

    // Click on the terminal to focus it
    await page.locator('.xterm-screen').click();
    await page.waitForTimeout(200);

    // Use clipboard API to set the clipboard content and trigger paste
    await page.evaluate(async (cmd) => {
      // Set clipboard content
      await navigator.clipboard.writeText(cmd);

      // Find the textarea that xterm uses for input
      const textarea = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        // Dispatch paste event on the textarea
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: new DataTransfer(),
          bubbles: true,
          cancelable: true
        });
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: {
            getData: (type: string) => type === 'text/plain' ? cmd : '',
            types: ['text/plain']
          }
        });
        textarea.dispatchEvent(pasteEvent);
      }
    }, longCommand);

    // Wait for paste to be processed
    await page.waitForTimeout(1000);

    // Get the visible text from the terminal rows (not including styles)
    const terminalText = await page.evaluate(() => {
      const rows = document.querySelectorAll('.xterm-rows > div');
      return Array.from(rows).map(row => row.textContent || '').join('\n');
    });

    console.log('Terminal text after paste:');
    const lines = terminalText.split('\n');
    lines.forEach((line, idx) => {
      console.log(`Line ${idx}: "${line}"`);
    });

    // Find the last prompt line (the user input line after welcome message)
    const lastPromptLineIndex = lines.map((line, idx) => line.startsWith('$') ? idx : -1)
      .filter(idx => idx !== -1)
      .pop();

    console.log(`Last prompt line index: ${lastPromptLineIndex}`);

    // Get only the lines after the welcome message (from last prompt onward)
    const userInputLines = lastPromptLineIndex !== undefined
      ? lines.slice(lastPromptLineIndex)
      : [];

    console.log(`User input section (${userInputLines.length} lines):`);
    userInputLines.forEach((line, idx) => {
      console.log(`  Line ${idx}: "${line.substring(0, 100)}"`);
    });

    // Check that the command appears in the user input section
    const commandInUserInput = userInputLines.filter(line => line.includes('aws s3 list-objects'));
    console.log(`Command appears ${commandInUserInput.length} time(s) in user input section`);

    // Take a screenshot for visual verification
    await page.screenshot({
      path: 'test-results/terminal-paste-long-command.png',
      fullPage: true
    });

    // Count prompts in user input section
    const promptsInUserInput = userInputLines.filter(line => line.startsWith('$')).length;
    console.log(`Number of prompts in user input section: ${promptsInUserInput}`);

    // The key test: there should be exactly ONE prompt after the welcome message
    // This proves the command was not duplicated
    expect(promptsInUserInput).toBe(1);

    // Verify the command is present and complete (check for beginning and end)
    const allUserText = userInputLines.join(' ');
    expect(allUserText).toContain('aws s3 list-objects');
    expect(allUserText).toContain('nara-national-archives-catalog');
    expect(allUserText).toContain('max-keys 2');
    expect(allUserText).toContain('no-sign-request');
  });

  test('should handle paste with wrapped text from clipboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.xterm-screen', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Simulate pasting text that includes line breaks (as if copied from a wrapped terminal)
    const wrappedCommand = 'aws s3 list-objects --region us-east-2 --bucket nara-national-\r\narchives-catalog --delimiter / --prefix authority-records/organization/';

    await page.locator('.xterm-screen').click();
    await page.waitForTimeout(200);

    await page.evaluate(async (cmd) => {
      await navigator.clipboard.writeText(cmd);
      const textarea = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true
        });
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: {
            getData: (type: string) => type === 'text/plain' ? cmd : '',
            types: ['text/plain']
          }
        });
        textarea.dispatchEvent(pasteEvent);
      }
    }, wrappedCommand);

    await page.waitForTimeout(1000);

    const terminalText = await page.evaluate(() => {
      const rows = document.querySelectorAll('.xterm-rows > div');
      return Array.from(rows).map(row => row.textContent || '').join('\n');
    });

    console.log('Terminal text after wrapped paste:');
    console.log(terminalText);

    // The command should be joined without line breaks
    expect(terminalText).toContain('nara-national-archives-catalog');

    // Should not trigger command execution (no extra prompts)
    const lines = terminalText.split('\n');
    const promptLines = lines.filter(line => line.trim().startsWith('$'));
    console.log(`Number of prompt lines: ${promptLines.length}`);

    await page.screenshot({
      path: 'test-results/terminal-paste-wrapped.png',
      fullPage: true
    });
  });
});
