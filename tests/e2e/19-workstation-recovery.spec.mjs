import { test, expect } from '@playwright/test';

const sizes = [{ width: 401, height: 511 }, { width: 767, height: 524 }, { width: 1440, height: 900 }];
async function visibleRect(locator, viewport) {
  await expect(locator).toBeVisible();
  const r = await locator.boundingBox();
  expect(r.width).toBeGreaterThan(12);
  expect(r.height).toBeGreaterThan(12);
  expect(r.x).toBeGreaterThanOrEqual(-1);
  expect(r.y).toBeGreaterThanOrEqual(-1);
  expect(r.x + r.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(r.y + r.height).toBeLessThanOrEqual(viewport.height + 1);
  return r;
}
async function readyShell(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#workstation-nav')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#incident-composer-input')).toBeVisible();
}

test.describe('19 workstation recovery and responsive layout', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'Runs exact requested viewports itself'); });
  for (const size of sizes) test(`panels and standard chat stay reachable at ${size.width}x${size.height}`, async ({ page }) => {
    test.setTimeout(200000); // full nine-panel interaction matrix, including software WebGL
    await page.setViewportSize(size);
    await readyShell(page);
    await page.waitForFunction(() => document.documentElement.dataset.renderState !== 'loading', null, { timeout: 15000 });
    for (const name of ['sources', 'hud', 'layers', 'scenes', 'location', 'chat', 'help']) {
      const toggle = page.locator(`[data-workstation-panel="${name}"]`);
      await visibleRect(toggle, size);
      await toggle.click();
      const drawer = page.locator('#workstation-drawer');
      const panelRect = await visibleRect(drawer, size);
      const close = page.locator('#workstation-close-panel');
      await visibleRect(close, size);
      await expect(page.locator(`[data-workstation-content="${name}"]`)).toBeVisible();
      const footerRect = await visibleRect(page.locator('#incident-composer'), size);
      expect(panelRect.y + panelRect.height).toBeLessThanOrEqual(footerRect.y + 1);
      if (name === 'sources') {
        const checkbox = page.locator('[data-platform="instagram"] input');
        await visibleRect(checkbox, size);
        const before = await checkbox.isChecked();
        await checkbox.setChecked(!before);
        expect(await checkbox.isChecked()).toBe(!before);
        await checkbox.setChecked(before);
      }
      if (name === 'chat') {
        const input = page.locator('#ondemand-mini-chat-input');
        await input.scrollIntoViewIfNeeded();
        await visibleRect(input, size);
        await input.fill('Hello from the existing standard chat');
        await expect(input).toHaveValue('Hello from the existing standard chat');
      }
      await close.click();
      await expect(drawer).toBeHidden();
      await expect(toggle).toBeFocused();
    }
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(size.width);
  });

  test('shell, source toggles, location lookup and real chat survive unavailable WebGL', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return /webgl/i.test(kind) ? null : getContext.call(this, kind, ...args); };
    });
    await page.setViewportSize(sizes[0]);
    await readyShell(page);
    await expect(page.locator('#workstation-render-status')).toHaveText('2D / RECOVERY');
    await expect(page.locator('#workstation-map-message')).toContainText('WebGL is unsupported');
    await page.locator('#ge-sources-toggle').click();
    await page.locator('[data-platform="youtube"] input').uncheck();
    await page.locator('#workstation-close-panel').click();
    await page.locator('#incident-composer-input').fill('Burj Khalifa');
    await page.locator('#incident-composer-submit').click();
    await expect(page.locator('#incident-composer-result')).toContainText('Located Burj Khalifa');
    await expect(page.locator('#workstation-2d')).toBeVisible();
    await page.locator('[data-workstation-panel="chat"]').click();
    await expect(page.locator('#ondemand-mini-chat-input')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('hung graphics asset does not block the shell or bounded recovery', async ({ page }) => {
    await page.route('**/cesium/Cesium.js', () => new Promise(() => {}));
    await readyShell(page);
    await page.locator('[data-workstation-panel="chat"]').click();
    await expect(page.locator('#ondemand-mini-chat-input')).toBeVisible();
    await expect(page.locator('#workstation-render-status')).toHaveText('2D / RECOVERY', { timeout: 13000 });
    await expect(page.locator('#workstation-map-message')).toContainText('8 seconds');
    await expect(page.locator('#workstation-retry-map')).toBeVisible();
  });

  test('failed APIs remain non-blocking; failed chat is visibly truthful', async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'injected_unavailable', message: 'Simulated upstream outage' }) }));
    await readyShell(page);
    await page.locator('[data-workstation-panel="chat"]').click();
    await page.locator('#ondemand-mini-chat-input').fill('Hello');
    await page.locator('#ondemand-mini-chat-send').click();
    await expect(page.locator('#ondemand-mini-chat')).toContainText(/error|unavailable|failed|outage/i);
    await expect(page.locator('#incident-composer-input')).toBeVisible();
    await page.locator('#workstation-close-panel').click();
    await expect(page.locator('#workstation-nav')).toBeVisible();
  });

  test('context loss offers recovery without losing controls or source preferences', async ({ page }) => {
    await readyShell(page);
    await page.waitForFunction(() => !!window.__godsEyeView?.viewer, null, { timeout: 20000 });
    await page.evaluate(() => window.__godsEyeView.viewer.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect(page.locator('#workstation-map-message')).toContainText('context was lost');
    await expect(page.locator('#workstation-2d')).toBeVisible();
    await page.locator('#ge-sources-toggle').click();
    await expect(page.locator('[data-platform="instagram"] input')).toBeEnabled();
    await page.locator('#workstation-close-panel').click();
    await expect(page.locator('#incident-composer-input')).toBeEnabled();
  });

  test('resize and reload preserve layout and persisted source selection', async ({ page }) => {
    await readyShell(page);
    await page.locator('#ge-sources-toggle').click();
    await page.locator('[data-platform="instagram"] input').uncheck();
    for (const size of sizes) {
      await page.setViewportSize(size);
      await visibleRect(page.locator('#workstation-close-panel'), size);
      await visibleRect(page.locator('[data-platform="instagram"] input'), size);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#ge-sources-toggle').click();
    await expect(page.locator('[data-platform="instagram"] input')).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.locator('#workstation-drawer')).toBeHidden();
  });

  test('hung optional terrain and imagery metadata have deadlines, not a blank shell', async ({ page }) => {
    await page.route('**/terrain.reearth.land/**', () => new Promise(() => {}));
    await page.route('**/services.arcgisonline.com/**', () => new Promise(() => {}));
    await readyShell(page);
    await page.waitForFunction(() => document.documentElement.dataset.renderState !== 'loading', null, { timeout: 15000 });
    await expect(page.locator('#incident-composer-input')).toBeEnabled();
    await page.locator('[data-workstation-panel="chat"]').click();
    await expect(page.locator('#ondemand-mini-chat-input')).toBeVisible();
  });

  test('simulated Overpass outage exhausts three attempts without trapping controls', async ({ page }) => {
    let requests = 0;
    const perViewport = new Map();
    await page.route('**/api/overpass', (route) => {
      requests++;
      const query = new URLSearchParams(route.request().postData() || '').get('data') || '';
      const bounds = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(query);
      const key = bounds ? bounds.slice(1).map((v) => Number(v).toFixed(4)).join(',') : query;
      perViewport.set(key, (perViewport.get(key) || 0) + 1);
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'injected_unavailable', provider: { status: 'degraded', source: 'Overpass', error: 'Injected Overpass outage' } }) }); });
    await readyShell(page);
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), null, { timeout: 25000 });
    // This assertion is per viewport. Stop the startup fly-in before counting
    // requests; otherwise a real camera movement correctly starts a new budget.
    await page.evaluate(() => {
      const viewer = window.__godsEyeView.viewer, C = window.Cesium;
      viewer.camera.cancelFlight();
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-97.7431, 30.2672, 1000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
      viewer.scene.requestRender();
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__godsEyeView.dataManager.setEnabled('traffic', true, { origin: 'user' }));
    await page.waitForFunction(() => window.__godsEyeView.dataManager.layers.get('traffic').module.getStats().retryExhausted, null, { timeout: 25000 });
    const stopped = requests;
    await page.waitForTimeout(2000);
    expect(requests).toBe(stopped);
    // Startup navigation can finish in another viewport. The production
    // contract is three attempts per rounded viewport, never three globally.
    expect(Math.max(...perViewport.values())).toBe(3);
    expect([...perViewport.values()].every((count) => count <= 3)).toBe(true);
    await page.locator('[data-workstation-panel="layers"]').click();
    await expect(page.locator('#workstation-retry-roads')).toBeEnabled();
    await expect(page.locator('#incident-composer-input')).toBeVisible();
  });

});
