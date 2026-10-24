import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('06 instagram-toggle', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('toggles instagram source in sidebar, removing and restoring cards and pins', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);

    // Count initial instagram cards
    const igCards = page.locator('li.ge-card[data-platform=instagram]');
    const initialCardCount = await igCards.count();
    expect(initialCardCount).toBeGreaterThan(0);

    // Count initial instagram pins
    const initialPinCount = await page.evaluate(() => {
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        return entities.filter(
          (e) => e.id && String(e.id).startsWith('ge:') && String(e.id).toLowerCase().includes('instagram')
        ).length;
      } catch {
        return 0;
      }
    });

    // Open #ge-sources-toggle
    const sourcesToggle = page.locator('#ge-sources-toggle');
    await sourcesToggle.click();

    // Locate checkbox for instagram in li.ge-source[data-platform=instagram]
    const igCheckbox = page.locator('li.ge-source[data-platform=instagram] input[type=checkbox]');
    await expect(igCheckbox).toBeVisible({ timeout: 10_000 });

    // Uncheck instagram
    await igCheckbox.uncheck();

    // Assert instagram cards are 0
    await expect(page.locator('li.ge-card[data-platform=instagram]')).toHaveCount(0, { timeout: 10_000 });

    // Assert no ge: pin entities with 'instagram'
    const pinsAfterUncheck = await page.evaluate(() => {
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        return entities.filter(
          (e) => e.id && String(e.id).startsWith('ge:') && String(e.id).toLowerCase().includes('instagram')
        ).length;
      } catch {
        return 0;
      }
    });
    expect(pinsAfterUncheck).toBe(0);

    // Re-check instagram checkbox
    await igCheckbox.check();

    // Assert cards are restored
    await expect(page.locator('li.ge-card[data-platform=instagram]')).toHaveCount(initialCardCount, { timeout: 10_000 });

    await attachAndSaveScreenshot(page, testInfo, '06-instagram-toggle');
  });
});
