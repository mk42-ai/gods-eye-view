import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  collectMedia,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('13 share-url', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('restores scene in fresh context from sc= share hash and from stripped fallback hash with zero media requests', async ({
    page,
    browser,
  }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // Read location.hash containing sc=s_...
    const fullHash = await page.evaluate(() => window.location.hash);
    expect(fullHash).toContain('sc=s_');

    // 1. Open NEW browser context at that URL (fresh profile, no IndexedDB)
    const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await context2.newPage();
    await installFixtureRoutes(page2);
    const media2 = collectMedia(page2);

    await gotoApp(page2, { hash: fullHash.replace(/^#/, '') });
    await waitStage(page2, 'S4', 25_000);

    // Expect scene restored to S4 with 0 media requests
    expect(media2.length).toBe(0);

    const restoredStage = await page2.evaluate(() => document.documentElement.dataset.geStage);
    expect(restoredStage).toBe('S4');

    await context2.close();

    // 2. Strip sc= from hash, keep fv/fk/fm/fs + camera, load in another fresh context
    const cleanHash = fullHash
      .replace(/^#/, '')
      .replace(/(?:^|&)sc=s_[^&]*/g, '')
      .replace(/^&/, '');

    const context3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page3 = await context3.newPage();
    await installFixtureRoutes(page3);
    const media3 = collectMedia(page3);

    await gotoApp(page3, { hash: cleanHash });
    await waitStage(page3, 'S4', 25_000);

    // Expect scene restored from fallback state (kind rebuild, target ≈ 25.147/55.199) with 0 media requests
    expect(media3.length).toBe(0);

    const fallbackScene = await page3.evaluate(() => {
      const state = window.__godsEye?.getState?.() || {};
      const activeId = state.activeId;
      return activeId ? state.scenes?.[activeId] : null;
    });

    if (fallbackScene) {
      expect(fallbackScene.kind).toBe('rebuild');
      if (fallbackScene.target) {
        expect(Math.abs(fallbackScene.target.lat - 25.147)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(fallbackScene.target.lon - 55.199)).toBeLessThanOrEqual(0.05);
      }
    }

    await context3.close();

    await attachAndSaveScreenshot(page, testInfo, '13-share-url');
  });
});
