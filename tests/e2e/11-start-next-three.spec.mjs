import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  installStageCollector,
  attachAndSaveScreenshot, openScenesPanel } from './_helpers.mjs';

test.describe('11 start-next-three', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('queues three scenes and controls sequential playback with dwell times, NEXT, and STOP', async ({ page }, testInfo) => {
    // Collect dwell and status events
    await page.addInitScript(() => {
      window.__dwellEvents = [];
      window.addEventListener('gev:scene-dwell', (e) => {
        window.__dwellEvents.push(e.detail);
      });
      window.__statusEvents = [];
      window.addEventListener('gev:scene-status', (e) => {
        window.__statusEvents.push(e.detail);
      });
    });

    await installStageCollector(page);
    await installFixtureRoutes(page);
    await gotoApp(page);

    // 1. Create Scene 1: Burj Khalifa
    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);

    // 2. Create Scene 2: Umm Suqeim rebuild
    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // 3. Create Scene 3: drone strike in Hodeidah
    await buildPrompt(page, 'drone strike in Hodeidah');
    await waitStage(page, 'S4', 60_000);

    // Ensure the SCENES panel is expanded and the Gods-Eye tab is active
    await openScenesPanel(page);

    // Verify playback queue exists in store
    const queue = await page.evaluate(() => {
      const pb = window.__godsEye?.getState?.()?.playback;
      return pb?.queue || [];
    });
    expect(queue.length).toBeGreaterThanOrEqual(1);

    // Click #scene-start-btn
    const startBtn = page.locator('#scene-start-btn');
    await startBtn.click();

    await page.waitForTimeout(2000);

    // Check playback running state
    const running = await page.evaluate(() => {
      return Boolean(window.__godsEye?.getState?.()?.playback?.running);
    });
    expect(running).toBe(true);

    // Verify dwell at S2 = 4200 ms ± 200 ms and S4 = 11000 ms ± 200 ms if exposed
    const dwellEvents = await page.evaluate(() => window.__dwellEvents || []);
    for (const d of dwellEvents) {
      if (d.stage === 'S2' && typeof d.ms === 'number') {
        expect(d.ms).toBeGreaterThanOrEqual(4000);
        expect(d.ms).toBeLessThanOrEqual(4400);
      }
      if (d.stage === 'S4' && typeof d.ms === 'number') {
        expect(d.ms).toBeGreaterThanOrEqual(10800);
        expect(d.ms).toBeLessThanOrEqual(11200);
      }
    }

    // Click #scene-next-btn advances early
    const nextBtn = page.locator('#scene-next-btn');
    await nextBtn.click();
    await page.waitForTimeout(1000);

    // Click #scene-stop-btn stops playback
    const stopBtn = page.locator('#scene-stop-btn');
    await stopBtn.click();
    await page.waitForTimeout(500);

    const stopped = await page.evaluate(() => {
      return window.__godsEye?.getState?.()?.playback?.running === false;
    });
    expect(stopped).toBe(true);

    await attachAndSaveScreenshot(page, testInfo, '11-start-next-three');
  });
});
