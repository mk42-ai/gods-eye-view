import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  installStageCollector,
  attachAndSaveScreenshot, openScenesPanel } from './_helpers.mjs';

test.describe('08 recreate-diff', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('recreates existing scene with new stage traversal, route planning, and diff summary badge', async ({ page }, testInfo) => {
    let routePlanCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/footage/route/plan')) {
        routePlanCount++;
      }
    });

    await installStageCollector(page);
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);
    await openScenesPanel(page);

    const initialPlanCount = routePlanCount;
    expect(initialPlanCount).toBeGreaterThanOrEqual(1);

    const sceneId = await page.evaluate(() => window.__godsEye?.getState?.()?.activeId);
    expect(sceneId).toBeTruthy();

    const stageCountBefore = await page.evaluate(() => window.__geStages?.length || 0);

    // Call window.__godsEye.recreateScene(id)
    await page.evaluate((id) => window.__godsEye.recreateScene(id), sceneId);

    // Expect a stage event S0 again then S4
    await waitStage(page, 'S4', 60_000);

    const stagesAfterRecreate = await page.evaluate((fromIdx) => {
      const all = window.__geStages || [];
      return all.slice(fromIdx).map((s) => s.stage);
    }, stageCountBefore);

    expect(stagesAfterRecreate).toContain('S0');
    expect(stagesAfterRecreate).toContain('S4');

    // Route plan called once more
    expect(routePlanCount).toBeGreaterThan(initialPlanCount);

    // .ge-scene-diff text matches /\+\d+ new · \d+ removed · \d+ unchanged/
    const diffEl = page.locator('.ge-scene-diff').first();
    await expect(diffEl).toBeVisible({ timeout: 15_000 });
    const diffText = await diffEl.textContent();
    expect(diffText).toMatch(/\+\d+\s+new\s+·\s+\d+\s+removed\s+·\s+\d+\s+unchanged/i);

    await attachAndSaveScreenshot(page, testInfo, '08-recreate-diff');
  });
});
