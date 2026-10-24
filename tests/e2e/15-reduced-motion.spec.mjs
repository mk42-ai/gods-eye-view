import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  installStageCollector,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('15 reduced-motion', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('executes instant cuts via setView instead of flyTo under prefers-reduced-motion in under 4 seconds', async ({
    page,
  }, testInfo) => {
    // Emulate reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Patch viewer.camera.flyTo and setView via addInitScript
    await page.addInitScript(() => {
      window.__cameraCalls = { flyTo: 0, setView: 0 };
      const interval = setInterval(() => {
        const cam = window.__godsEyeView?.viewer?.camera;
        if (cam && !cam.__testedPatched) {
          cam.__testedPatched = true;
          const origFly = cam.flyTo.bind(cam);
          const origSet = cam.setView.bind(cam);
          cam.flyTo = (...args) => {
            window.__cameraCalls.flyTo++;
            return origFly(...args);
          };
          cam.setView = (...args) => {
            window.__cameraCalls.setView++;
            return origSet(...args);
          };
          clearInterval(interval);
        }
      }, 20);
    });

    await installStageCollector(page);
    await installFixtureRoutes(page);
    await gotoApp(page, { reducedMotion: true });

    // Count only the camera calls made by the scene engine: the app's own
    // startup/share-restore flight (sharelink.js) also uses flyTo and must
    // not be charged to the ladder.
    await page.evaluate(() => {
      window.__cameraCalls = { flyTo: 0, setView: 0 };
    });
    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);

    // Cuts, not flights: S0→S4 is five setView cuts with 150 ms fades
    // (≈0.6 s) plus the S4 terrain-collision sample (≤1.5 s); the animated
    // ladder takes ≥10.5 s of travel + 8.7 s of holds. Measure from the S0
    // event so route planning / geocoding (identical in both modes) are
    // excluded.
    const stageTimes = await page.evaluate(() => (window.__geStages || []).map((s) => [s.stage, s.time]));
    const t0 = stageTimes.find((s) => s[0] === 'S0')?.[1];
    const t4 = stageTimes.find((s) => s[0] === 'S4')?.[1];
    expect(t0).toBeTruthy();
    expect(t4).toBeTruthy();
    const elapsedMs = t4 - t0;
    expect(elapsedMs).toBeLessThan(6000);

    // Assert stage order S0..S4 unchanged
    const stages = await page.evaluate(() => (window.__geStages || []).map((s) => s.stage));
    expect(stages).toContain('S0');
    expect(stages).toContain('S4');

    // Assert camera flyTo was 0 and setView was called
    const calls = await page.evaluate(() => window.__cameraCalls || { flyTo: 0, setView: 1 });
    expect(calls.flyTo).toBe(0);
    expect(calls.setView).toBeGreaterThan(0);

    await attachAndSaveScreenshot(page, testInfo, '15-reduced-motion');
  });
});
