import { test, expect } from '@playwright/test';
import { installFixtureRoutes } from './_helpers.mjs';

test.describe('20 workstation integration', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'Exact viewport assertions run in this project'); });

  test('controlled iframe at exact requested CSS sizes mounts shell and usable panels', async ({ page }) => {
    await page.goto('/embed-harness.html', { waitUntil: 'domcontentloaded' });
    const frameElement = page.locator('#app');
    for (const { width, height } of [{ width: 401, height: 511 }, { width: 767, height: 524 }]) {
      await page.setViewportSize({ width: width + 40, height: height + 80 });
      await frameElement.evaluate((frame, size) => { frame.style.width = `${size.width}px`; frame.style.height = `${size.height}px`; }, { width, height });
      const frame = page.frameLocator('#app');
      await expect(frame.locator('#workstation-shell')).toBeVisible();
      expect(await frame.locator('body').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
      await frame.locator('[data-workstation-panel="sources"]').click();
      await expect(frame.locator('#ge-sources-panel')).toBeVisible();
      await expect(frame.locator('[data-platform="instagram"] input')).toBeEnabled();
      await frame.locator('#workstation-close-panel').click();
      await expect(frame.locator('#workstation-drawer')).toBeHidden();
      await expect(frame.locator('#incident-composer-input')).toBeVisible();
    }
  });

  test('scene pipeline keeps location, archive state and evidence while fixture data are explicitly marked', async ({ page }) => {
    await installFixtureRoutes(page);
    await page.goto('/?fixtures=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__godsEye), null, { timeout: 25000 });
    await expect(page.locator('.workstation-fixture-label')).toHaveText('TEST FIXTURES — not live data');
    await page.locator('#incident-composer-input').fill('rebuild the car crash reported in Umm Suqeim');
    await page.locator('#incident-composer-submit').click();
    await page.waitForFunction(() => document.documentElement.dataset.geStage === 'S4', null, { timeout: 65000 });
    await expect(page.locator('#ge-banner')).toContainText('REBUILT FROM ARCHIVAL FOOTAGE');
    await expect(page.locator('#ge-scene-root')).toBeVisible();
    const coords = await page.evaluate(() => { const target = window.__godsEye.getState(); return target.scenes[target.activeId].target; });
    expect(Math.abs(coords.lat - 25.147)).toBeLessThan(.02);
    expect(Math.abs(coords.lon - 55.199)).toBeLessThan(.02);
    await expect(page.locator('#incident-composer-submit')).toBeVisible();
    await page.locator('[data-workstation-panel="scenes"]').click();
    await expect(page.locator('#ge-scenes')).toBeVisible();
    await page.locator('#workstation-close-panel').click();
    expect(await page.locator('.ge-player-poster').getAttribute('src')).toBeNull();
  });

  test('attribution, canvas and footer occupy separate visible regions after resizing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), null, { timeout: 25000 });
    for (const viewport of [{ width: 401, height: 511 }, { width: 767, height: 524 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { credits: box('#cesium-credits'), map: box('#workstation-view'), footer: box('#incident-composer'), nav: box('#workstation-nav'), canvas: box('#cesiumContainer canvas') };
      });
      expect(geometry.credits.width).toBeGreaterThan(20);
      expect(geometry.credits.y).toBeGreaterThanOrEqual(geometry.map.y);
      expect(geometry.credits.bottom).toBeLessThanOrEqual(geometry.map.bottom + 1);
      expect(geometry.map.bottom).toBeLessThanOrEqual(geometry.footer.y + 1);
      expect(geometry.map.y).toBeGreaterThanOrEqual(geometry.nav.bottom - 1);
      expect(geometry.canvas.height).toBeGreaterThan(100);
      expect(Math.abs(geometry.canvas.width - geometry.map.width)).toBeLessThan(2);
    }
  });
});
