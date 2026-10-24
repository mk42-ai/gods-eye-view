/**
 * 22 — REPRODUCTION of the 2026-10-24 bug report: "typing 'burj khalifa'
 * (lowercase) into the AOI composer and clicking BUILD SCENE does nothing".
 * Runs against PREVIEW_URL with LIVE services exactly as the user does:
 * keyboard typing + a REAL pointer click (mouse move → down → up), no
 * programmatic submit. Records click-handler firing, element-under-pointer,
 * every scene status event, console + network, and a timestamped screenshot.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PROOF = process.env.PROOF_DIR || 'tests/report/repro';
fs.mkdirSync(PROOF, { recursive: true });
const stamp = () => new Date().toISOString();
const PROMPT = process.env.REPRO_PROMPT || 'burj khalifa';
const LABEL = process.env.REPRO_LABEL || 'before';

test.describe('22 repro lowercase burj khalifa', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'desktop only'); });

  test(`real pointer click on BUILD SCENE after typing "${PROMPT}"`, async ({ page }) => {
    test.setTimeout(240000);
    const consoleLog = [];
    const networkLog = [];
    page.on('console', (m) => consoleLog.push({ ts: stamp(), type: m.type(), text: m.text().slice(0, 600), url: m.location()?.url || '' }));
    page.on('pageerror', (e) => consoleLog.push({ ts: stamp(), type: 'pageerror', text: String(e?.message || e).slice(0, 600) }));
    page.on('requestfinished', async (r) => { let status = null, ms = null; try { const res = await r.response(); status = res?.status() ?? null; const t = r.timing(); ms = t ? Math.round(t.responseEnd) : null; } catch {} networkLog.push({ ts: stamp(), method: r.method(), url: r.url().slice(0, 300), status, ms, type: r.resourceType() }); });
    page.on('requestfailed', (r) => networkLog.push({ ts: stamp(), method: r.method(), url: r.url().slice(0, 300), status: 'failed', failure: r.failure()?.errorText, type: r.resourceType() }));
    if (process.env.REPRO_SUPPRESS_FIRST_RUN !== '0') await page.addInitScript(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch {} });
    await page.addInitScript(() => {
      window.__repro = { statuses: [], stages: [], clicks: [], submits: [] };
      window.addEventListener('gev:scene-status', (e) => window.__repro.statuses.push({ t: Date.now(), status: e.detail?.status, sceneId: e.detail?.sceneId }));
      window.addEventListener('gev:scene-stage', (e) => window.__repro.stages.push({ t: Date.now(), stage: e.detail?.stage }));
      document.addEventListener('click', (e) => { const t = e.target; window.__repro.clicks.push({ t: Date.now(), id: t?.id, cls: t?.className, defaultPrevented: e.defaultPrevented }); }, true);
      document.addEventListener('submit', (e) => window.__repro.submits.push({ t: Date.now(), id: e.target?.id }), true);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('#incident-composer-input')).toBeVisible({ timeout: 30000 });
    // REPRO_EAGER=1 → type + click as soon as the composer is visible (an eager user), not after the map is ready.
    if (process.env.REPRO_EAGER !== '1') await page.waitForFunction(() => ['ready', 'fallback'].includes(document.documentElement.dataset.renderState), null, { timeout: 40000 }).catch(() => {});
    const loadState = await page.evaluate(() => ({ renderState: document.documentElement.dataset.renderState, hasEngine: Boolean(window.__godsEye), hasViewer: Boolean(window.__godsEyeView?.viewer), renderLoop: window.__godsEyeView?.viewer?.useDefaultRenderLoop ?? null, cesium: Boolean(window.Cesium) }));
    // type like a user
    const input = page.locator('#incident-composer-input');
    await input.click();
    await page.keyboard.type(PROMPT, { delay: 40 });
    const submit = page.locator('#incident-composer-submit');
    const box = await submit.boundingBox();
    const overlays = await page.evaluate(() => [...document.body.querySelectorAll(':scope > *')].filter((n) => { const cs = getComputedStyle(n); return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden'; }).map((n) => { const r = n.getBoundingClientRect(); return { id: n.id || n.className?.toString?.().slice(0, 40), z: getComputedStyle(n).zIndex, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (n.innerText || '').slice(0, 60) }; }).filter((o) => o.w > 0 && o.h > 0));
    const under = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); const b = document.getElementById('incident-composer-submit'); const cs = b ? getComputedStyle(b) : null; return { under: el ? `${el.tagName}#${el.id}.${String(el.className).slice(0, 60)}` : null, isButton: el === b || b?.contains(el), disabled: b?.disabled, pointerEvents: cs?.pointerEvents, visibility: cs?.visibility, opacity: cs?.opacity, zIndex: cs?.zIndex }; }, [box.x + box.width / 2, box.y + box.height / 2]);
    const tClick = Date.now();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    // poll the pipeline for up to 90 s
    const timeline = [];
    let final = null;
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      const snap = await page.evaluate(() => { const g = window.__godsEye; const s = g?.getState?.(); const sc = s?.scenes?.[s?.activeId]; const btn = document.getElementById('incident-composer-submit'); return { sec: null, formState: document.getElementById('incident-composer')?.dataset.state, building: document.getElementById('incident-composer')?.dataset.building || null, btnDisabled: btn?.disabled ?? null, btnText: btn?.textContent || null, build: document.documentElement.dataset.geBuild || null, geStage: document.documentElement.dataset.geStage, buildStage: document.documentElement.dataset.geBuildStage, sceneStatus: sc?.status || null, sceneError: sc?.error || null, footage: sc?.footage?.length ?? null, chips: [...document.querySelectorAll('#incident-composer-chips .incident-composer__chip')].map((c) => `${c.dataset.step}:${c.dataset.status}`).join(' '), result: document.getElementById('incident-composer-result')?.innerText?.slice(0, 200) || '', hasEngine: Boolean(g), renderState: document.documentElement.dataset.renderState, renderLoop: window.__godsEyeView?.viewer?.useDefaultRenderLoop ?? null, statuses: window.__repro.statuses.map((x) => x.status), stages: window.__repro.stages.map((x) => x.stage), clicks: window.__repro.clicks.length, submits: window.__repro.submits.length }; });
      snap.sec = Math.round((Date.now() - tClick) / 1000);
      timeline.push(snap);
      final = snap;
      if (snap.geStage === 'S4' && ['playing', 'saved'].includes(snap.sceneStatus)) break;
      if (snap.formState === 'error') break;
    }
    const shotName = `${LABEL}-burj-lowercase-1440x900-${stamp().replace(/[:.]/g, '-')}.png`;
    await page.screenshot({ path: path.join(PROOF, shotName), timeout: 30000 }).catch(() => {});
    const scenePanel = await page.evaluate(() => ({ header: Boolean(document.querySelector('#ge-scene-header')), rail: document.querySelectorAll('#ge-rail .ge-card').length, timeline: Boolean(document.querySelector('#ge-timeline')), evidence: Boolean(document.querySelector('#ge-evidence')), panelCards: document.querySelectorAll('#ge-scenes-list [data-scene-id]').length, pins: (window.__godsEyeView?.viewer?.entities?.values || []).filter((e) => String(e.id || '').startsWith('ge:')).length }));
    const report = { label: LABEL, prompt: PROMPT, startedAt: new Date(t0).toISOString(), clickedAt: new Date(tClick).toISOString(), loadState, buttonUnderPointer: under, fixedOverlays: overlays, final, scenePanel, timeline, consoleErrors: consoleLog.filter((c) => c.type === 'error' || c.type === 'pageerror'), consoleWarnings: consoleLog.filter((c) => c.type === 'warning'), screenshot: shotName, finishedAt: stamp() };
    fs.writeFileSync(path.join(PROOF, `${LABEL}-repro-report.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(PROOF, `${LABEL}-console-log.json`), JSON.stringify(consoleLog, null, 2));
    fs.writeFileSync(path.join(PROOF, `${LABEL}-network-log.json`), JSON.stringify(networkLog, null, 2));
    console.log('REPRO', JSON.stringify({ loadState, under, overlays, final, scenePanel }, null, 1));
    const built = final?.geStage === 'S4' && ['playing', 'saved'].includes(final?.sceneStatus) && scenePanel.rail > 0 && scenePanel.panelCards > 0;
    // Progress state: the button was disabled + "BUILDING…" at least once mid-build and is re-enabled at the end.
    const sawBuilding = timeline.some((t) => t.btnDisabled === true && /BUILDING/i.test(t.btnText || ''));
    report.progressState = { sawBuilding, reEnabled: final?.btnDisabled === false, finalLabel: final?.btnText };
    fs.writeFileSync(path.join(PROOF, `${LABEL}-repro-report.json`), JSON.stringify(report, null, 2));
    if (process.env.REPRO_EXPECT_PASS === '1') {
      expect(built).toBe(true);
      expect(sawBuilding).toBe(true);
      expect(final?.btnDisabled).toBe(false);
      expect(report.consoleErrors.filter((e) => !/arcgisonline|reearth|youtube|ytimg|googlevideo|tile\.openstreetmap|gibs\.earthdata|ERR_BLOCKED_BY_RESPONSE|Failed to load resource/i.test(e.text + (e.url || '')))).toEqual([]);
    }
  });
});
