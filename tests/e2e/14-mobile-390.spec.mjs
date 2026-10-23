import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('14 mobile-390', () => {
  // Mobile project only
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'mobile', 'Mobile only'); });

  test('renders responsive UI on 390x844 viewport with bounded root, no horizontal overflow, and working composer', async ({
    page,
  }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // Assert #ge-scene-root bounding box width <= 390 and bottom <= 844
    const rootEl = page.locator('#ge-scene-root');
    const rootBox = await rootEl.boundingBox();
    if (rootBox) {
      expect(rootBox.width).toBeLessThanOrEqual(390 + 2); // allowance for subpixel rounding
      expect(rootBox.y + rootBox.height).toBeLessThanOrEqual(844 + 2);
    }

    // Assert no horizontal overflow (document.scrollingElement.scrollWidth <= 390)
    const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth || window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);

    // Fly-in stage events reach S4
    const stage = await page.evaluate(() => document.documentElement.dataset.geStage);
    expect(stage).toBe('S4');

    // Composer still clickable
    const composerSubmit = page.locator('#incident-composer-submit');
    await expect(composerSubmit).toBeVisible();
    await expect(composerSubmit).toBeEnabled();

    await attachAndSaveScreenshot(page, testInfo, '14-mobile-390');
  });
});
