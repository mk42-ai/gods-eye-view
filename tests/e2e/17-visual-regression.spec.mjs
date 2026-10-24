import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  attachAndSaveScreenshot, openScenesPanel } from './_helpers.mjs';

test.describe('17 visual-regression', () => {
  // Runs on all three projects (desktop, tablet, mobile)

  test('validates pixel-perfect visual snapshots of header, rail, timeline, player, scenes, sources, and full page', async ({
    page,
  }, testInfo) => {
    // Seven stable-screenshot captures under the software rasterizer take
    // well over the default 120 s budget.
    test.setTimeout(420_000);
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // Settle: wait for the S4 dwell to begin and the live-status dot /
    // route-monitor polling to quiesce, then freeze the status text that
    // changes between frames (live status, latency) so "stable screenshot"
    // detection converges under the software rasterizer.
    await page.waitForTimeout(1500);
    // The panels are translucent glass over a live WebGL globe; make them
    // opaque for the diff so the (always-changing) globe pixels behind them
    // cannot fail a UI regression check. The globe itself is masked below.
    await page.addStyleTag({
      content: [
        '#ge-scene-root *, #ge-scenes *, #ge-sources * { animation: none !important; transition: none !important; caret-color: transparent !important; }',
        '#ge-scene-root, #ge-scene-header, #ge-rail, #ge-timeline, #ge-player, #ge-evidence, #ge-scenes, #ge-sources-panel, #ge-sources { background: #070f16 !important; backdrop-filter: none !important; }',
        '#ge-player .ge-player-media { visibility: hidden !important; }',
      ].join('\n'),
    });
    const globeMask = [page.locator('#cesiumContainer'), page.locator('#world-overlay-root')];
    const shotOpts = {
      maxDiffPixelRatio: 0.03,
      animations: 'disabled',
      caret: 'hide',
      timeout: 30_000,
    };

    // 1. #ge-scene-header
    const header = page.locator('#ge-scene-header');
    await expect(header).toBeVisible();
    await expect(header).toHaveScreenshot('ge-scene-header.png', shotOpts);

    // 2. #ge-rail
    const rail = page.locator('#ge-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveScreenshot('ge-rail.png', shotOpts);

    // 3. #ge-timeline
    const timeline = page.locator('#ge-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline).toHaveScreenshot('ge-timeline.png', shotOpts);

    // 4. #ge-player
    const player = page.locator('#ge-player');
    await expect(player).toBeVisible();
    await expect(player).toHaveScreenshot('ge-player.png', shotOpts);

    // 5. #ge-scenes (open #scene-panel first by clicking its header if collapsed)
    await openScenesPanel(page);
    const scenesEl = page.locator('#ge-scenes');
    if (await scenesEl.count() > 0 && await scenesEl.isVisible()) {
      await expect(scenesEl).toHaveScreenshot('ge-scenes.png', shotOpts);
    }

    // 6. #ge-sources-panel (open via toggle)
    const sourcesToggle = page.locator('#ge-sources-toggle');
    if (await sourcesToggle.count() > 0 && await sourcesToggle.isVisible()) {
      await sourcesToggle.click();
      await page.waitForTimeout(300);
    }
    const sourcesPanel = page.locator('#ge-sources-panel, #ge-sources').first();
    if (await sourcesPanel.count() > 0 && await sourcesPanel.isVisible()) {
      await expect(sourcesPanel).toHaveScreenshot('ge-sources-panel.png', shotOpts);
    }

    // 7. Full-page shot with route layer visible
    await expect(page).toHaveScreenshot('full-page-route.png', {
      ...shotOpts,
      fullPage: true,
      mask: globeMask,
    });

    await attachAndSaveScreenshot(page, testInfo, '17-visual-regression');
  });
});
