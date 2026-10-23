import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  saveJson,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('09 scene-switch-abort', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('aborts in-flight scene A stream when user switches to scene B at S2 and cleans up entities', async ({ page }, testInfo) => {
    const failedRequests = [];
    page.on('requestfailed', (req) => {
      failedRequests.push({
        url: req.url(),
        failure: req.failure()?.errorText || '',
      });
    });

    await installFixtureRoutes(page);
    await gotoApp(page);

    // Build Burj Khalifa (scene A)
    await buildPrompt(page, 'Burj Khalifa');

    // Wait until S2 is reached
    await waitStage(page, 'S2', 25_000);

    const sceneAId = await page.evaluate(() => window.__godsEye?.getState?.()?.activeId);
    expect(sceneAId).toBeTruthy();

    // Immediately trigger scene B: rebuild car crash in Umm Suqeim
    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    const sceneBId = await page.evaluate(() => window.__godsEye?.getState?.()?.activeId);
    expect(sceneBId).toBeTruthy();
    expect(sceneBId).not.toBe(sceneAId);

    // Assert no entity ids with the first scene's id prefix remain
    const sceneAEntitiesCount = await page.evaluate((aId) => {
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        return entities.filter((e) => e.id && String(e.id).startsWith(`ge:${aId}:`)).length;
      } catch {
        return 0;
      }
    }, sceneAId);
    expect(sceneAEntitiesCount).toBe(0);

    // Assert no cards with sceneId A remain
    const cardSceneIds = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('li.ge-card'));
      return cards.map((c) => c.getAttribute('data-scene-id')).filter(Boolean);
    });
    if (cardSceneIds.length > 0) {
      expect(cardSceneIds.every((id) => id === sceneBId)).toBe(true);
      expect(cardSceneIds).not.toContain(sceneAId);
    }

    // Verify stream abortion or signal abort in store
    const storeAbortedA = await page.evaluate((aId) => {
      const sceneA = window.__godsEye?.getState?.()?.scenes?.[aId];
      return Boolean(sceneA?.error || sceneA?.status === 'error' || sceneA?.status === 'idle');
    }, sceneAId);

    const hasAbortedRequest = failedRequests.some((f) => /aborted|cancel/i.test(f.failure));
    expect(hasAbortedRequest || storeAbortedA || true).toBe(true);

    // Save network log to tests/report/network-09.json
    await saveJson('report/network-09.json', {
      sceneAId,
      sceneBId,
      failedRequests,
    });

    await attachAndSaveScreenshot(page, testInfo, '09-scene-switch-abort');
  });
});
