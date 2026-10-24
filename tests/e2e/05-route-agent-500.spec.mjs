import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('05 route-agent-500', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('falls back gracefully to great-circle ladder when route agent returns HTTP 500', async ({ page }, testInfo) => {
    // Install routes with route500 enabled
    await installFixtureRoutes(page, { route500: true });
    await gotoApp(page);

    await buildPrompt(page, 'Burj Khalifa');

    // Expect header .ge-h-route text 'ROUTE: FALLBACK' and data-route-fallback=1
    const routeHeader = page.locator('.ge-h-route');
    await expect(routeHeader).toBeVisible({ timeout: 25_000 });
    await expect(routeHeader).toContainText('ROUTE: FALLBACK');

    const sceneHeader = page.locator('#ge-scene-header');
    await expect(sceneHeader).toHaveAttribute('data-route-fallback', '1', { timeout: 10_000 });

    // Scene reaches S4 (completes successfully)
    await waitStage(page, 'S4', 60_000);

    const currentStage = await page.evaluate(() => document.documentElement.dataset.geStage);
    expect(currentStage).toBe('S4');

    await attachAndSaveScreenshot(page, testInfo, '05-route-agent-500');
  });
});
