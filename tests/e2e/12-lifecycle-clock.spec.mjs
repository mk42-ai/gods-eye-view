import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot, openScenesPanel } from './_helpers.mjs';

test.describe('12 lifecycle-clock', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('updates scene card new/archived lifecycle status at +1h, +25h, and +73h', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);
    await openScenesPanel(page);

    const baseTime = await page.evaluate(() => Date.now());

    // 1. mockClock +1 h -> card .ge-sc-new visible (or data-new=1)
    await page.evaluate((base) => {
      const targetTime = base + 3600 * 1000;
      if (window.__godsEye && typeof window.__godsEye.setNow === 'function') {
        window.__godsEye.setNow(() => targetTime);
      }
      window.__godsEye?.store?.dispatch?.({ type: 'SCENE_REFRESH_LIFECYCLE' });
    }, baseTime);

    await page.waitForTimeout(500);

    const isNewAt1h = await page.evaluate(() => {
      const activeId = window.__godsEye?.getState?.()?.activeId;
      const card = document.querySelector(`article.ge-scene-card[data-scene-id="${activeId}"]`);
      const hasNewBadge = Boolean(document.querySelector('.ge-sc-new'));
      const dataNew = card?.getAttribute('data-new') === '1';
      return hasNewBadge || dataNew;
    });
    expect(isNewAt1h).toBe(true);

    // 2. mockClock +25 h -> .ge-sc-new absent (data-new=0)
    await page.evaluate((base) => {
      const targetTime = base + 25 * 3600 * 1000;
      if (window.__godsEye && typeof window.__godsEye.setNow === 'function') {
        window.__godsEye.setNow(() => targetTime);
      }
      window.__godsEye?.store?.dispatch?.({ type: 'SCENE_REFRESH_LIFECYCLE' });
    }, baseTime);

    await page.waitForTimeout(500);

    const isNewAt25h = await page.evaluate(() => {
      const activeId = window.__godsEye?.getState?.()?.activeId;
      const card = document.querySelector(`article.ge-scene-card[data-scene-id="${activeId}"]`);
      const hasNewBadge = Boolean(document.querySelector('.ge-sc-new'));
      const dataNew = card?.getAttribute('data-new') === '1';
      return hasNewBadge && dataNew;
    });
    expect(isNewAt25h).toBe(false);

    // 3. mockClock +73 h -> card under #ge-scenes-tab-archive only (data-archived=1)
    await page.evaluate((base) => {
      const targetTime = base + 73 * 3600 * 1000;
      if (window.__godsEye && typeof window.__godsEye.setNow === 'function') {
        window.__godsEye.setNow(() => targetTime);
      }
      window.__godsEye?.store?.dispatch?.({ type: 'SCENE_REFRESH_LIFECYCLE' });
    }, baseTime);

    await page.waitForTimeout(500);

    const isArchivedAt73h = await page.evaluate(() => {
      const activeId = window.__godsEye?.getState?.()?.activeId;
      const card = document.querySelector(`article.ge-scene-card[data-scene-id="${activeId}"]`);
      const dataArchived = card?.getAttribute('data-archived') === '1';
      const scene = window.__godsEye?.getState?.()?.scenes?.[activeId];
      return dataArchived || Boolean(scene?.lifecycle?.archivedAt);
    });
    expect(isArchivedAt73h).toBe(true);

    await attachAndSaveScreenshot(page, testInfo, '12-lifecycle-clock');
  });
});
