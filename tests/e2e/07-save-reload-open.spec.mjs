import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  collectMedia,
  installFixtureRoutes,
  saveJson,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('07 save-reload-open', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('restores saved scene on reload via openScene with identical state and zero network calls', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // Read state from active scene before reload
    const preReloadState = await page.evaluate(() => {
      const state = window.__godsEye?.getState?.() || {};
      const activeId = state.activeId;
      const scene = activeId ? state.scenes?.[activeId] : null;

      let camera = null;
      try {
        const cam = window.__godsEyeView?.viewer?.camera;
        if (cam?.positionCartographic) {
          const cart = cam.positionCartographic;
          camera = {
            lat: Number((cart.latitude * (180 / Math.PI)).toFixed(4)),
            lon: Number((cart.longitude * (180 / Math.PI)).toFixed(4)),
            alt: Math.round(cart.height),
          };
        }
      } catch {}

      if (!camera && scene?.camera) {
        camera = {
          lat: Number(scene.camera.lat.toFixed(4)),
          lon: Number(scene.camera.lon.toFixed(4)),
          alt: Math.round(scene.camera.alt),
        };
      }

      let pinIds = [];
      let routeIds = [];
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        pinIds = entities.filter((e) => e.id && String(e.id).includes(':pin:')).map((e) => String(e.id)).sort();
        routeIds = entities.filter((e) => e.id && String(e.id).includes(':route:')).map((e) => String(e.id)).sort();
      } catch {}

      if (routeIds.length === 0 && scene?.route?.groundRoutes) {
        routeIds = scene.route.groundRoutes.map((r) => r.id).sort();
      }

      const cardEls = Array.from(document.querySelectorAll('li.ge-card'));
      const cardIds = cardEls.map((el) => el.getAttribute('data-item-id')).filter(Boolean).sort();

      const playingItemId =
        document.querySelector('#ge-player')?.getAttribute('data-item-id') ||
        scene?.footage?.find((f) => f.id)?.id ||
        null;

      return {
        activeId,
        camera,
        pinIds,
        routeIds,
        cardIds,
        playingItemId,
      };
    });

    expect(preReloadState.activeId).toBeTruthy();

    // Reload page (same origin, fixtures=1, NO prompt)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__godsEye || window.__godsEyeView?.godsEye), null, { timeout: 30_000 });

    // Start request collection AFTER reload
    const mediaRequests = collectMedia(page);

    // Call window.__godsEye.openScene(id)
    await page.evaluate((id) => window.__godsEye.openScene(id), preReloadState.activeId);
    await waitStage(page, 'S4', 60_000);

    // Read restored state
    const postReloadState = await page.evaluate(() => {
      const state = window.__godsEye?.getState?.() || {};
      const activeId = state.activeId;
      const scene = activeId ? state.scenes?.[activeId] : null;

      let camera = null;
      try {
        const cam = window.__godsEyeView?.viewer?.camera;
        if (cam?.positionCartographic) {
          const cart = cam.positionCartographic;
          camera = {
            lat: Number((cart.latitude * (180 / Math.PI)).toFixed(4)),
            lon: Number((cart.longitude * (180 / Math.PI)).toFixed(4)),
            alt: Math.round(cart.height),
          };
        }
      } catch {}

      if (!camera && scene?.camera) {
        camera = {
          lat: Number(scene.camera.lat.toFixed(4)),
          lon: Number(scene.camera.lon.toFixed(4)),
          alt: Math.round(scene.camera.alt),
        };
      }

      let pinIds = [];
      let routeIds = [];
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        pinIds = entities.filter((e) => e.id && String(e.id).includes(':pin:')).map((e) => String(e.id)).sort();
        routeIds = entities.filter((e) => e.id && String(e.id).includes(':route:')).map((e) => String(e.id)).sort();
      } catch {}

      if (routeIds.length === 0 && scene?.route?.groundRoutes) {
        routeIds = scene.route.groundRoutes.map((r) => r.id).sort();
      }

      const cardEls = Array.from(document.querySelectorAll('li.ge-card'));
      const cardIds = cardEls.map((el) => el.getAttribute('data-item-id')).filter(Boolean).sort();

      const playingItemId =
        document.querySelector('#ge-player')?.getAttribute('data-item-id') ||
        scene?.footage?.find((f) => f.id)?.id ||
        null;

      return {
        activeId,
        camera,
        pinIds,
        routeIds,
        cardIds,
        playingItemId,
      };
    });

    // Assert identical camera within ±1%
    if (preReloadState.camera && postReloadState.camera) {
      expect(Math.abs(postReloadState.camera.lat - preReloadState.camera.lat) / preReloadState.camera.lat).toBeLessThanOrEqual(0.01);
      expect(Math.abs(postReloadState.camera.lon - preReloadState.camera.lon) / preReloadState.camera.lon).toBeLessThanOrEqual(0.01);
      expect(Math.abs(postReloadState.camera.alt - preReloadState.camera.alt) / (preReloadState.camera.alt || 1)).toBeLessThanOrEqual(0.01);
    }

    // Assert same card id sets
    expect(postReloadState.cardIds).toEqual(preReloadState.cardIds);

    // Assert same playing item
    if (preReloadState.playingItemId) {
      expect(postReloadState.playingItemId).toBe(preReloadState.playingItemId);
    }

    // Assert 0 /footage/* and 0 media requests
    const footageOrMedia = mediaRequests.filter((r) =>
      /footage\/(stream|search)|youtube|tiktok|instagram|googlevideo|cdninstagram|\.mp4/i.test(r.url)
    );
    expect(footageOrMedia.length).toBe(0);

    // Save tests/report/network-07.json
    await saveJson('report/network-07.json', mediaRequests);

    await attachAndSaveScreenshot(page, testInfo, '07-save-reload-open');
  });
});
