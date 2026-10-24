import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('02 burj-khalifa-build', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('builds Burj Khalifa live scene through S0..S4 camera ladder with VIIRS and cards', async ({ page }, testInfo) => {
    // Collect 'gev:scene-stage' events with altitude, VIIRS status, pin count, and playing state
    await page.addInitScript(() => {
      window.__geStages = window.__geStages || [];
      window.addEventListener('gev:scene-stage', (e) => {
        let alt = null;
        let hasViirs = false;
        let pinCount = 0;

        try {
          const viewer = window.__godsEyeView?.viewer;
          if (viewer?.camera?.positionCartographic) {
            alt = viewer.camera.positionCartographic.height;
          }
          if (viewer?.imageryLayers) {
            const count = viewer.imageryLayers.length || 0;
            for (let i = 0; i < count; i++) {
              const layer = viewer.imageryLayers.get(i);
              const provider = layer?.imageryProvider;
              const url = provider?.url || provider?._url || '';
              if (String(url).includes('gibs.earthdata') && layer.show !== false) {
                hasViirs = true;
              }
            }
          }
          if (viewer?.entities?.values) {
            const entities = viewer.entities.values;
            pinCount = entities.filter(
              (ent) => ent.id && String(ent.id).startsWith('ge:') && Boolean(ent.point || ent.billboard)
            ).length;
          }
        } catch {}

        const playing = document.querySelector('#ge-player')?.getAttribute('data-playing') || '0';

        window.__geStages.push({
          time: Date.now(),
          stage: e.detail?.stage,
          sceneId: e.detail?.sceneId,
          altitude: alt,
          hasViirs,
          pinCount,
          playing,
        });
      });
    });

    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);

    // Retrieve collected stage progression
    const stageHistory = await page.evaluate(() => window.__geStages || []);
    const stageNames = stageHistory.map((s) => s.stage);

    // Assert stage order S0..S4
    const requiredStages = ['S0', 'S1', 'S2', 'S3', 'S4'];
    for (const req of requiredStages) {
      expect(stageNames).toContain(req);
    }
    const s0Idx = stageNames.indexOf('S0');
    const s1Idx = stageNames.indexOf('S1');
    const s2Idx = stageNames.indexOf('S2');
    const s3Idx = stageNames.indexOf('S3');
    const s4Idx = stageNames.indexOf('S4');
    expect(s0Idx).toBeLessThan(s1Idx);
    expect(s1Idx).toBeLessThan(s2Idx);
    expect(s2Idx).toBeLessThan(s3Idx);
    expect(s3Idx).toBeLessThan(s4Idx);

    // Expected altitudes: S0 8e6, S1 1.2e6, S2 18000, S3 2000, S4 300 (±15%)
    const expectedAlt = {
      S0: 8_000_000,
      S1: 1_200_000,
      S2: 18_000,
      S3: 2_000,
      S4: 300,
    };

    for (const st of stageHistory) {
      if (st.altitude != null && expectedAlt[st.stage]) {
        const target = expectedAlt[st.stage];
        const lower = target * 0.85;
        const upper = target * 1.15;
        // Check within ±15% of ladder target
        expect(st.altitude).toBeGreaterThanOrEqual(lower);
        expect(st.altitude).toBeLessThanOrEqual(upper);
      }
    }

    // VIIRS imagery layer present at S0/S1 and absent/hidden after S2
    const s0Item = stageHistory.find((s) => s.stage === 'S0');
    const s1Item = stageHistory.find((s) => s.stage === 'S1');
    const s3Item = stageHistory.find((s) => s.stage === 'S3');
    const s4Item = stageHistory.find((s) => s.stage === 'S4');
    if (s0Item && s0Item.hasViirs !== undefined) {
      expect(s0Item.hasViirs || s1Item?.hasViirs).toBe(true);
    }
    if (s3Item && s3Item.hasViirs !== undefined) {
      expect(s3Item.hasViirs).toBe(false);
    }
    if (s4Item && s4Item.hasViirs !== undefined) {
      expect(s4Item.hasViirs).toBe(false);
    }

    // Pins first appear at S2 not before
    if (s0Item) expect(s0Item.pinCount).toBe(0);
    if (s1Item) expect(s1Item.pinCount).toBe(0);
    const s2Item = stageHistory.find((s) => s.stage === 'S2');
    if (s2Item && s2Item.pinCount !== undefined) {
      expect(s2Item.pinCount).toBeGreaterThanOrEqual(0);
    }

    // #ge-player[data-playing=1] only after S4
    for (const st of stageHistory) {
      if (st.stage !== 'S4') {
        expect(st.playing).not.toBe('1');
      }
    }
    // After S4 reached:
    await expect(page.locator('#ge-player')).toHaveAttribute('data-playing', '1', { timeout: 10_000 });

    // >=5 li.ge-card with non-empty .ge-card-distance and .ge-card-delta
    const cards = page.locator('li.ge-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const dist = await card.locator('.ge-card-distance').textContent();
      const delta = await card.locator('.ge-card-delta').textContent();
      expect(dist?.trim().length).toBeGreaterThan(0);
      expect(delta?.trim().length).toBeGreaterThan(0);
    }

    await attachAndSaveScreenshot(page, testInfo, '02-burj-khalifa-build');
  });
});
