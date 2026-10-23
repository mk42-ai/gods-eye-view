/**
 * 21 — BUILD SCENE end-to-end verification (2026-10-23 bug report).
 * Runs against PREVIEW_URL with LIVE services (no fixture routes):
 *  (a) no-prompt load renders globe/2D map + UI, no black screen
 *  (b) 'Burj Khalifa' + BUILD SCENE click → status chips advance, fly-in,
 *      header, footage rail, timeline, evidence strip, Scenes panel entry
 *  (c) Enter with 'rebuild the car crash reported in Umm Suqeim' → archival banner
 *  (d) Open the saved scene from the Scenes panel with ZERO refetch
 *  (e) layout screenshots at 1440×900, 1024×768, 767×524, 401×511; 0 console errors
 * Evidence is written to $PROOF_DIR (screenshots, console + network logs).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROOF = process.env.PROOF_DIR || 'tests/report/proof';
fs.mkdirSync(PROOF, { recursive: true });
const results = [];
const consoleLog = [];
const networkLog = [];
const stamp = () => new Date().toISOString();
const record = (check, result, screenshot, detail = '') => results.push({ check, result, screenshot, ts: stamp(), detail });
// Third-party map tiles (Esri/OSM/GIBS) intermittently answer without CORS headers;
// those are browser network errors, not application errors. They are still saved in console-log.json.
const IGNORED_CONSOLE = /services\.arcgisonline\.com|terrain\.reearth\.land|youtube\.com|ytimg|googlevideo|doubleclick|google\.com\/js|Permissions policy|third-party cookie|tile\.openstreetmap|gibs\.earthdata|ERR_BLOCKED_BY_RESPONSE/i;

function wire(page, label) {
  page.on('console', (m) => {
    const loc = m.location()?.url || '';
    consoleLog.push({ ts: stamp(), label, type: m.type(), text: m.text().slice(0, 500), url: loc });
  });
  page.on('pageerror', (e) => consoleLog.push({ ts: stamp(), label, type: 'pageerror', text: String(e?.message || e).slice(0, 500), url: '' }));
  page.on('requestfinished', async (r) => {
    let status = null; try { status = (await r.response())?.status() ?? null; } catch {}
    networkLog.push({ ts: stamp(), label, method: r.method(), url: r.url().slice(0, 300), status, type: r.resourceType() });
  });
  page.on('requestfailed', (r) => networkLog.push({ ts: stamp(), label, method: r.method(), url: r.url().slice(0, 300), status: 'failed', failure: r.failure()?.errorText, type: r.resourceType() }));
}
const appErrors = (label) => consoleLog.filter((c) => c.label === label && (c.type === 'error' || c.type === 'pageerror') && !IGNORED_CONSOLE.test(`${c.text} ${c.url}`));

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch {} });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.locator('#workstation-shell')).toBeVisible();
  await expect(page.locator('#incident-composer-input')).toBeVisible();
  await page.waitForFunction(() => ['ready', 'fallback'].includes(document.documentElement.dataset.renderState), null, { timeout: 30000 });
}
const shot = async (page, name) => { const file = path.join(PROOF, name); await page.screenshot({ path: file, timeout: 30000 }).catch(async () => { await page.screenshot({ path: file, timeout: 30000, animations: 'disabled', caret: 'hide' }).catch(() => {}); }); return name; };

test.describe.configure({ mode: 'serial' });
test.describe('21 build scene verification (live preview)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'viewport matrix runs inside the desktop project'); });

  test('(a)–(d) build, rebuild and zero-refetch open', async ({ page }) => {
    test.setTimeout(420000);
    wire(page, 'flow');
    await page.setViewportSize({ width: 1440, height: 900 });
    // (a)
    await boot(page);
    await page.waitForTimeout(4000);
    const a = await page.evaluate(() => {
      const rs = document.documentElement.dataset.renderState;
      const canvas = document.querySelector('#cesiumContainer canvas');
      const raster = document.querySelectorAll('#workstation-raster-tiles img').length;
      return { rs, canvas: Boolean(canvas && canvas.width > 0), raster, nav: document.querySelectorAll('#workstation-nav button').length, composer: Boolean(document.getElementById('incident-composer-submit')) };
    });
    const aOk = (a.rs === 'ready' ? a.canvas : a.raster > 0) && a.nav >= 6 && a.composer;
    record('(a) no-prompt load renders globe/2D map + UI', aOk ? 'PASS' : 'FAIL', await shot(page, 'a-load-1440x900.png'), JSON.stringify(a));
    expect(aOk).toBe(true);

    // (b) click BUILD SCENE
    const seen = new Set();
    await page.exposeFunction('__recordStage', (s) => seen.add(s));
    await page.evaluate(() => window.addEventListener('gev:scene-status', (e) => window.__recordStage(e.detail?.status)));
    await page.locator('#incident-composer-input').fill('Burj Khalifa');
    await page.locator('#incident-composer-submit').click();
    await expect(page.locator('#incident-composer-chips .incident-composer__chip').first()).toBeVisible({ timeout: 5000 });
    await shot(page, 'b1-status-parsing-1440x900.png');
    await page.waitForFunction(() => { const g = window.__godsEye; const s = g?.getState?.(); const sc = s?.scenes?.[s.activeId]; return sc && ['playing', 'saved'].includes(sc.status) && document.documentElement.dataset.geStage === 'S4'; }, null, { timeout: 150000 });
    await page.waitForTimeout(2500);
    const b = await page.evaluate(() => {
      const s = window.__godsEye.getState(); const sc = s.scenes[s.activeId];
      const vis = (sel) => { const n = document.querySelector(sel); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
      return { id: sc.id, title: sc.title, status: sc.status, stage: document.documentElement.dataset.geStage, target: sc.target, footage: sc.footage.length, fixture: Boolean(sc.fixtureFallback), route: sc.route?.fallback ? 'FALLBACK' : 'AGENT', header: vis('#ge-scene-header'), rail: vis('#ge-rail') && document.querySelectorAll('#ge-rail .ge-card').length, timeline: vis('#ge-timeline'), evidence: vis('#ge-evidence'), player: vis('#ge-player'), media: document.querySelectorAll('#ge-player iframe, #ge-player video').length, pins: (window.__godsEyeView?.viewer?.entities?.values || []).filter((e) => String(e.id || '').includes(sc.id)).length, panelCard: Boolean(document.querySelector(`#ge-scenes-list [data-scene-id="${sc.id}"]`)), chips: [...document.querySelectorAll('#incident-composer-chips .incident-composer__chip')].map((c) => `${c.dataset.step}:${c.dataset.status}`), sources: Object.fromEntries(Object.entries(sc.sources || {}).map(([k, v]) => [k, v.status])), hash: location.hash };
    });
    b.stagesSeen = [...seen];
    const bOk = b.header && b.rail > 0 && b.timeline && b.evidence && b.panelCard && Math.abs(b.target.lat - 25.1972) < 0.01 && b.stagesSeen.includes('routing') && b.stagesSeen.includes('flying') && b.stagesSeen.includes('fetching');
    record('(b) Burj Khalifa BUILD SCENE: stages, fly-in, header/pins/rail/timeline/evidence, Scenes panel', bOk ? 'PASS' : 'FAIL', await shot(page, 'b2-burj-khalifa-built-1440x900.png'), JSON.stringify(b));
    expect(bOk).toBe(true);
    const burjId = b.id;

    // (c) Enter key
    seen.clear();
    await page.locator('#incident-composer-input').fill('rebuild the car crash reported in Umm Suqeim');
    await page.locator('#incident-composer-input').press('Enter');
    await page.waitForFunction((prev) => { const s = window.__godsEye?.getState?.(); const sc = s?.scenes?.[s.activeId]; return sc && sc.id !== prev && ['playing', 'saved'].includes(sc.status) && document.documentElement.dataset.geStage === 'S4'; }, burjId, { timeout: 150000 });
    await page.waitForTimeout(2500);
    const c = await page.evaluate(() => {
      const s = window.__godsEye.getState(); const sc = s.scenes[s.activeId];
      const banner = document.getElementById('ge-banner');
      return { id: sc.id, kind: sc.kind, target: sc.target, footage: sc.footage.length, fixture: Boolean(sc.fixtureFallback), banner: banner && !banner.hidden ? banner.textContent : null, archiveTags: document.body.innerText.match(/ARCHIVE/g)?.length || 0, isoStamps: (document.getElementById('ge-scene-root')?.innerText.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}Z/g) || []).slice(0, 4), hash: location.hash.match(/lat=[^&]+&lon=[^&]+/)?.[0] };
    });
    const cOk = c.kind === 'rebuild' && /REBUILT FROM ARCHIVAL FOOTAGE — originally reported \d{4}-\d{2}-\d{2}/.test(c.banner || '') && Math.abs(c.target.lat - 25.147) < 0.01 && c.footage > 0;
    record('(c) Enter: Umm Suqeim rebuild + archival banner', cOk ? 'PASS' : 'FAIL', await shot(page, 'c-umm-suqeim-rebuild-1440x900.png'), JSON.stringify(c));
    expect(cOk).toBe(true);

    // (d) open saved Burj scene from Scenes panel, assert zero refetch
    await page.locator('[data-workstation-panel="scenes"]').click();
    await expect(page.locator(`#ge-scenes-list [data-scene-id="${burjId}"]`)).toBeVisible();
    await page.waitForTimeout(1500);
    const marker = networkLog.length;
    const before = Date.now();
    await page.locator(`#ge-scenes-list [data-scene-id="${burjId}"]`).getByRole('button', { name: /open/i }).first().click();
    await page.waitForFunction((id) => window.__godsEye?.getState?.().activeId === id, burjId, { timeout: 15000 });
    await page.waitForTimeout(4000);
    const during = networkLog.slice(marker).filter((r) => Date.parse(r.ts) >= before - 50);
    const refetch = during.filter((r) => /\/footage\/(stream|search|route\/plan)|nominatim|youtube\.com\/embed|tiktok\.com\/embed|instagram\.com/.test(r.url));
    const d = { opened: burjId, requestsDuring: during.length, refetch: refetch.map((r) => r.url), armed: await page.evaluate(() => document.getElementById('ge-player')?.dataset.kind) };
    const dOk = refetch.length === 0;
    record('(d) Open saved scene from Scenes panel — zero refetch (network log)', dOk ? 'PASS' : 'FAIL', await shot(page, 'd-open-saved-scene-1440x900.png'), JSON.stringify(d));
    expect(dOk).toBe(true);
  });

  test('(e) layout at four breakpoints with an active scene, zero console errors', async ({ page }) => {
    test.setTimeout(420000);
    wire(page, 'layout');
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await page.locator('#incident-composer-input').fill('Burj Khalifa');
    await page.locator('#incident-composer-submit').click();
    await page.waitForFunction(() => { const s = window.__godsEye?.getState?.(); const sc = s?.scenes?.[s?.activeId]; return sc && ['playing', 'saved'].includes(sc.status); }, null, { timeout: 150000 });
    const details = [];
    let allOk = true;
    for (const [w, h] of [[1440, 900], [1024, 768], [767, 524], [401, 511]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const sels = ['#workstation-header', '#workstation-nav', '#workstation-build-host', '#ge-scene-root', '#ge-scene-header', '#ge-player', '#ge-rail', '#ge-timeline', '#ge-evidence', '#workstation-map-actions'];
        const boxes = {};
        // Visible box = element rect clipped by every scrolling/overflow-hidden
        // ancestor (content scrolled inside the scene card is reachable, not overlapping).
        const visibleRect = (n) => {
          let r = n.getBoundingClientRect(); let x = r.left, y = r.top, R = r.right, B = r.bottom;
          for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (/(hidden|auto|scroll|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX)) { const q = p.getBoundingClientRect(); x = Math.max(x, q.left); y = Math.max(y, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
          }
          return R - x > 1 && B - y > 1 ? { x, y, w: R - x, h: B - y, r: R, b: B } : null;
        };
        for (const s of sels) { const n = document.querySelector(s); if (!n) continue; const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const v = visibleRect(n); if (v) boxes[s] = v; }
        const W = innerWidth, H = innerHeight;
        if (W >= 768 && H >= 600) delete boxes['#ge-scene-root'];
        const clipped = Object.entries(boxes).filter(([, b]) => b.x < -1 || b.y < -1 || b.r > W + 1 || b.b > H + 1).map(([k]) => k);
        const keys = Object.keys(boxes); const overlaps = [];
        const inScene = (k) => k.startsWith('#ge-');
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
          const A = boxes[keys[i]], B = boxes[keys[j]];
          // scene sub-panels inside the single stacked mobile scene card scroll together; only flag cross-region overlap
          if (inScene(keys[i]) && inScene(keys[j]) && (W < 768 || H < 600 || keys[i] === '#ge-scene-root' || keys[j] === '#ge-scene-root')) continue;
          if ((keys[i] === '#ge-scene-root' || keys[j] === '#ge-scene-root') && (inScene(keys[i]) && inScene(keys[j]))) continue;
          const ix = Math.min(A.r, B.r) - Math.max(A.x, B.x), iy = Math.min(A.b, B.b) - Math.max(A.y, B.y);
          if (ix > 2 && iy > 2) overlaps.push(`${keys[i]}×${keys[j]}`);
        }
        return { W, H, docOverflowX: document.documentElement.scrollWidth > W + 1, clipped, overlaps, loose: ['#pp-toggles', '#cctv-panel', '#global-context-panel'].filter((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && !n.closest('#workstation-drawer'); }) };
      });
      const ok = !m.docOverflowX && !m.clipped.length && !m.overlaps.length && !m.loose.length;
      allOk &&= ok;
      const name = await shot(page, `e-layout-${w}x${h}.png`);
      details.push({ ...m, ok, name });
      record(`(e) layout ${w}×${h}: no overlap/clipping, HUD controls grouped`, ok ? 'PASS' : 'FAIL', name, JSON.stringify(m));
    }
    await page.setViewportSize({ width: 767, height: 524 });
    await page.locator('[data-workstation-panel="hud"]').click();
    await page.waitForTimeout(800);
    record('(e) grouped HUD controls stack (Display/CCTV/Context + BITS/LVL) at 767×524', 'INFO', await shot(page, 'e-hud-stack-767x524.png'));
    const errs = [...appErrors('flow'), ...appErrors('layout')];
    record('(e) 0 application console errors (flow + layout runs)', errs.length ? 'FAIL' : 'PASS', '', JSON.stringify(errs.slice(0, 10)));
    expect(allOk).toBe(true);
    expect(errs).toEqual([]);
  });

  test('(f) no WebGL: 2D map renders and BUILD SCENE still runs S0→S4 in 2D', async ({ page }) => {
    test.setTimeout(240000);
    wire(page, 'nowebgl');
    await page.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/i.test(k) ? null : g.call(this, k, ...a); }; });
    await page.setViewportSize({ width: 767, height: 524 });
    await boot(page);
    await expect(page.locator('#workstation-2d')).toBeVisible();
    await page.locator('#incident-composer-input').fill('Burj Khalifa');
    await page.locator('#incident-composer-submit').click();
    await page.waitForFunction(() => { const s = window.__godsEye?.getState?.(); const sc = s?.scenes?.[s?.activeId]; return sc && ['playing', 'saved'].includes(sc.status) && document.documentElement.dataset.geStage === 'S4'; }, null, { timeout: 150000 });
    const f = await page.evaluate(() => ({ is2d: window.__godsEye.is2d, stage: document.documentElement.dataset.geStage, tiles: document.querySelectorAll('#workstation-raster-tiles img').length, hash: location.hash.match(/lat=[^&]+&lon=[^&]+/)?.[0], footage: window.__godsEye.listScenes()[0]?.footage?.length }));
    const ok = f.is2d && f.stage === 'S4' && f.tiles > 0 && /lat=25\.19/.test(f.hash || '');
    record('(f) no-WebGL 2D fallback: map renders + scene builds S0→S4', ok ? 'PASS' : 'FAIL', await shot(page, 'f-no-webgl-2d-build-767x524.png'), JSON.stringify(f));
    expect(ok).toBe(true);
  });

  test.afterAll(() => {
    fs.writeFileSync(path.join(PROOF, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(PROOF, 'console-log.json'), JSON.stringify(consoleLog, null, 2));
    fs.writeFileSync(path.join(PROOF, 'network-log.json'), JSON.stringify(networkLog, null, 2));
  });
});
