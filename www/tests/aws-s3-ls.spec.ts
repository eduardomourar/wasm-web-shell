import { test, expect } from '@playwright/test';
import { gotoShell, typeCommand, waitForIdlePrompt } from './helpers';

test.describe('aws s3 ls', () => {
  test('returns to a new prompt instead of hanging', async ({ page }) => {
    await gotoShell(page);

    await typeCommand(
      page,
      'aws s3 ls --region us-east-2 --no-sign-request s3://nara-national-archives-catalog/authority-records/organization/'
    );

    const terminalText = await waitForIdlePrompt(page);
    console.log('=== TERMINAL OUTPUT ===\n' + terminalText);
    expect(terminalText).not.toContain('error');
    expect(terminalText).toContain('authority-records/organization/');
  });
});
