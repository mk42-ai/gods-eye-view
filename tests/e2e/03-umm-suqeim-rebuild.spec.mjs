import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  hashParams,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('03 umm-suqeim-rebuild', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('rebuilds Umm Suqeim archival crash with banner, archive cards, handles, and 3 ground routes', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    await buildPrompt(page, 'rebuild the car crash reported in Umm Suqeim');
    await waitStage(page, 'S4', 60_000);

    // Assert hash lat ≈ 25.147 ± 0.02, lon ≈ 55.199 ± 0.02
    await page.waitForFunction(() => {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const lat = parseFloat(params.get('lat') || '0');
      const lon = parseFloat(params.get('lon') || '0');
      return Math.abs(lat - 25.147) <= 0.02 && Math.abs(lon - 55.199) <= 0.02;
    }, null, { timeout: 15_000 });

    const params = await hashParams(page);
    const lat = parseFloat(params.lat || '0');
    const lon = parseFloat(params.lon || '0');
    expect(Math.abs(lat - 25.147)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(lon - 55.199)).toBeLessThanOrEqual(0.02);

    // Assert #ge-banner text matches /REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26/
    const banner = page.locator('#ge-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26/);

    // Assert every card has [data-recency=ARCHIVE] and delta matches /after incident|before incident/
    const cards = page.locator('li.ge-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    for (let i = 0; i < cardCount; i++) {
      const card = cards.nth(i);
      await expect(card).toHaveAttribute('data-recency', 'ARCHIVE');
      const deltaText = await card.locator('.ge-card-delta').textContent();
      expect(deltaText).toMatch(/after incident|before incident/i);
    }

    // Header .ge-h-sources mentions sources
    const sourcesEl = page.locator('.ge-h-sources');
    await expect(sourcesEl).toBeVisible();
    const sourcesText = await sourcesEl.textContent();
    expect(sourcesText?.trim().length).toBeGreaterThan(0);

    // Cards include handles dubaipolicehq, gulfnews, gulftoday
    const handles = await page.locator('.ge-card-handle').allTextContents();
    const handleText = handles.join(' ').toLowerCase();
    expect(handleText).toContain('dubaipolicehq');
    expect(handleText).toContain('gulfnews');
    expect(handleText).toContain('gulftoday');

    // Ground route entities exist with 3 routes and statuses include 'open' and 'restricted'
    const routeInfo = await page.evaluate(() => {
      const state = window.__godsEye?.getState?.() || {};
      const activeScene = state.activeId ? state.scenes?.[state.activeId] : null;
      const groundRoutes = activeScene?.route?.groundRoutes || [];

      let routeEntityCount = 0;
      let entityDescriptions = [];
      try {
        const entities = window.__godsEyeView?.viewer?.entities?.values || [];
        const routeEntities = entities.filter((e) => e.id && String(e.id).includes(':route:'));
        routeEntityCount = routeEntities.length;
        entityDescriptions = routeEntities.map((e) => String(e.description?.getValue?.() || e.description || ''));
      } catch {}

      return {
        groundRoutes,
        routeEntityCount,
        entityDescriptions,
      };
    });

    const routeCount = routeInfo.groundRoutes.length || routeInfo.routeEntityCount;
    expect(routeCount).toBe(3);

    const statuses = routeInfo.groundRoutes.map((r) => r.status);
    const hasOpen = statuses.includes('open') || routeInfo.entityDescriptions.some((d) => d.includes('open'));
    const hasRestricted =
      statuses.includes('restricted') || routeInfo.entityDescriptions.some((d) => d.includes('restricted'));
    expect(hasOpen).toBe(true);
    expect(hasRestricted).toBe(true);

    await attachAndSaveScreenshot(page, testInfo, '03-umm-suqeim-rebuild');
  });
});
