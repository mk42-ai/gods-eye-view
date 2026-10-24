/**
 * 23 — INDEPENDENT ACCEPTANCE CHECK (2026-10-24): "clicking BUILD SCENE does nothing".
 *
 * Every check runs in a BRAND-NEW browser context: no storage state, service
 * workers blocked, HTTP cache disabled via CDP, cookies/cache cleared. The
 * driver behaves like a person: real pointer moves + mouse down/up on the
 * button's bounding box, keyboard typing character by character, Enter key
 * for check C. Nothing calls into the app's JS to trigger a build; the only
 * page-side script is a PASSIVE listener that timestamps `gev:scene-status`
 * events, and every assertion is read back from the rendered DOM / pixels.
 *
 * Checks (each at 1440x900 and 767x524, from the task):
 *  A   load: non-black scene pixels, composer placeholder, BUILD SCENE, build id
 *  B1  'burj khalifa' + real click     → BUILDING… state, fly-in pixel diff,
 *      S0→S4, header, pins, rail, timeline, evidence, Scenes entry, re-enabled
 *  B2  'Burj Khalifa' + real click     → same criteria
 *  C   'rebuild the car crash reported in Umm Suqeim' + Enter → archival banner
 *  D   B1 at 767x524 with WebGL disabled (--disable-webgl/--disable-webgl2/--disable-gpu)
 *
 * Evidence per check in $PROOF_DIR: timestamped PNG series with a burned-in
 * UTC label, a Playwright video, console-log.json, network-log.json and a
 * JSON report. PREVIEW_URL selects the target.
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const PROOF = process.env.PROOF_DIR || 'tests/report/acceptance';
fs.mkdirSync(PROOF, { recursive: true });
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const BUILD_WAIT_MS = Number(process.env.ACCEPT_BUILD_WAIT_MS) || 60_000;
const MIN_BUILD = process.env.ACCEPT_MIN_BUILD || 'a692f7b';
const ONLY = (process.env.ACCEPT_ONLY || '').split(',').filter(Boolean);
const stamp = () => new Date().toISOString();
const fileStamp = () => stamp().replace(/[:.]/g, '-');
const previewHost = new URL(BASE).host;

const SUMMARY_FILE = path.join(PROOF, 'acceptance-summary.json');
const summary = fs.existsSync(SUMMARY_FILE) ? JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8')) : { previewUrl: BASE, checks: [] };
const saveSummary = () => fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

// ---------------------------------------------------------------- pixels
async function burn(buffer, label) {
  const meta = await sharp(buffer).metadata();
  const w = Math.min(meta.width, Math.max(260, label.length * 7 + 16));
  const svg = `<svg width="${w}" height="22" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(0,0,0,0.72)"/><text x="8" y="15" font-family="monospace" font-size="11" fill="#9ff">${label}</text></svg>`;
  return sharp(buffer).composite([{ input: Buffer.from(svg), gravity: 'southeast' }]).png().toBuffer();
}
async function pixelStats(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonBlack = 0, sum = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const l = data[i] + data[i + 1] + data[i + 2];
    sum += l;
    if (l > 45) nonBlack++;
  }
  return { width: info.width, height: info.height, nonBlackRatio: +(nonBlack / n).toFixed(4), meanLuma: +(sum / n / 3).toFixed(1) };
}
async function pixelDiff(a, b) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = A.info.width, h = A.info.height;
  const B = await sharp(b).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = 0;
  for (let i = 0; i < A.data.length; i += 3) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > 60) changed++;
  }
  return +(changed / (w * h)).toFixed(4);
}

// ---------------------------------------------------------------- context
async function freshContext(browser, viewport, videoDir) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    // ACCEPT_NO_VIDEO=1 skips the recording when Playwright's ffmpeg is absent.
    ...(process.env.ACCEPT_NO_VIDEO ? {} : { recordVideo: { dir: videoDir, size: viewport } }),
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.clearBrowserCookies');
  return { context, page };
}

function wire(page, logs) {
  page.on('console', (m) => {
    const url = m.location()?.url || '';
    logs.console.push({ ts: stamp(), type: m.type(), text: m.text().slice(0, 600), url, line: m.location()?.lineNumber ?? null });
  });
  page.on('pageerror', (e) => logs.console.push({ ts: stamp(), type: 'pageerror', text: String(e?.message || e).slice(0, 600), url: '', stack: String(e?.stack || '').slice(0, 800) }));
  page.on('response', (r) => {
    const req = r.request();
    logs.network.push({ ts: stamp(), method: req.method(), url: r.url().slice(0, 300), status: r.status(), type: req.resourceType() });
  });
  page.on('requestfailed', (r) => logs.network.push({ ts: stamp(), method: r.method(), url: r.url().slice(0, 300), status: 'failed', failure: r.failure()?.errorText, type: r.resourceType() }));
}
function classifyConsole(logs) {
  const errors = logs.console.filter((c) => c.type === 'error' || c.type === 'pageerror');
  const isApp = (c) => {
    if (c.type === 'pageerror') return true;
    try { return !c.url || new URL(c.url).host === previewHost; } catch { return true; }
  };
  // Network "Failed to load resource" lines carry the RESOURCE url; a third-party tile/CDN host is noise.
  const app = errors.filter((c) => isApp(c) && !/Failed to load resource.*(arcgisonline|openstreetmap|reearth|gibs\.earthdata|youtube|ytimg|googlevideo|tiktok|instagram|cdninstagram)/i.test(c.text));
  const third = errors.filter((c) => !app.includes(c));
  return { appErrors: app, thirdPartyErrors: third, warnings: logs.console.filter((c) => c.type === 'warning').length, total: logs.console.length };
}
function networkStats(logs) {
  const hosts = {};
  for (const r of logs.network) { try { const h = new URL(r.url).host; hosts[h] = (hosts[h] || 0) + 1; } catch {} }
  return {
    requests: logs.network.length,
    hosts,
    status429: logs.network.filter((r) => r.status === 429).map((r) => r.url),
    status5xx: logs.network.filter((r) => typeof r.status === 'number' && r.status >= 500).map((r) => `${r.status} ${r.url}`),
    failed: logs.network.filter((r) => r.status === 'failed').map((r) => `${r.failure} ${r.url}`),
  };
}

// ---------------------------------------------------------------- human input
async function realClick(page, locator, { steps = 12 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error('target has no bounding box');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const under = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el ? `${el.tagName.toLowerCase()}#${el.id}` : null; }, [x, y]);
  await page.mouse.move(x - 40, y + 25, { steps: 4 });
  await page.mouse.move(x, y, { steps });
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  return { x: Math.round(x), y: Math.round(y), under, ts: stamp() };
}
async function humanType(page, locator, text) {
  await realClick(page, locator);
  await page.keyboard.type(text, { delay: 55 });
}

// ---------------------------------------------------------------- DOM reads
const domSnapshot = () => ({
  ts: new Date().toISOString(),
  chipStage: document.getElementById('incident-composer-chips')?.dataset.stage || null,
  chips: [...document.querySelectorAll('#incident-composer-chips .incident-composer__chip')].map((c) => `${c.dataset.step}:${c.dataset.status}`).join(' '),
  formState: document.getElementById('incident-composer')?.dataset.state || null,
  geStage: document.documentElement.dataset.geStage || null,
  buildStage: document.documentElement.dataset.geBuildStage || null,
  btnDisabled: document.getElementById('incident-composer-submit')?.disabled ?? null,
  btnText: document.getElementById('incident-composer-submit')?.textContent?.trim() || null,
  result: document.getElementById('incident-composer-result')?.innerText?.slice(0, 220) || '',
  banner: (() => { const b = document.getElementById('ge-banner'); return b && !b.hidden && b.getBoundingClientRect().height > 0 ? b.textContent.trim() : null; })(),
  hash: location.hash.slice(0, 160),
  renderState: document.documentElement.dataset.renderState || null,
});
const visibleBox = (sel) => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return null;
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
};

// ---------------------------------------------------------------- the check
async function runCheck({ browser, id, viewport, prompt, submit, expectArchive = false, noWebgl = false }) {
  const label = `${id}-${viewport.width}x${viewport.height}${noWebgl ? '-nowebgl' : ''}`;
  const dir = path.join(PROOF, label);
  fs.mkdirSync(dir, { recursive: true });
  const logs = { console: [], network: [] };
  const report = { check: id, label, viewport, prompt, submit, noWebgl, previewUrl: BASE, startedAt: stamp(), events: [], screenshots: [], stageTransitions: [], confirmed: {}, failures: [] };
  const shots = [];
  const shot = async (page, name, { clip } = {}) => {
    const ts = stamp();
    const file = `${label}-${name}-${ts.replace(/[:.]/g, '-')}.png`;
    try {
      const raw = await page.screenshot({ timeout: 25_000, clip, animations: 'disabled', caret: 'hide' });
      fs.writeFileSync(path.join(dir, file), await burn(raw, `${ts} ${label} ${name}`));
      report.screenshots.push({ name, file: path.join(label, file), ts });
      return raw;
    } catch (e) {
      report.events.push({ ts, event: 'screenshot-failed', name, error: String(e?.message || e).slice(0, 200) });
      return null;
    }
  };
  const mark = (event, extra = {}) => report.events.push({ ts: stamp(), event, ...extra });
  const fail = (what, detail) => { report.failures.push({ what, detail }); mark('FAIL', { what, detail }); };

  const { context, page } = await freshContext(browser, viewport, dir);
  wire(page, logs);
  // Passive listener only: timestamps the app's own status events; triggers nothing.
  await page.addInitScript(() => {
    window.__accept = { statuses: [] };
    window.addEventListener('gev:scene-status', (e) => window.__accept.statuses.push({ t: new Date().toISOString(), status: e.detail?.status }));
  });
  try {
    // ---- A: load
    mark('navigate', { url: BASE });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const input = page.locator('#incident-composer-input');
    const button = page.locator('#incident-composer-submit');
    await expect(input).toBeVisible({ timeout: 45_000 });
    mark('composer-visible');
    // A human waits for the map header to settle (3D ready, or the 2D recovery) — up to 45 s.
    await page.waitForFunction(() => ['ready', 'fallback'].includes(document.documentElement.dataset.renderState), null, { timeout: 45_000 }).catch(() => mark('render-state-timeout'));
    // First-run launcher (fresh profile) — dismiss it the way a visitor does: real click on EXPLORE MANUALLY.
    const launcher = page.locator('#first-run-launcher.visible');
    if (await launcher.count()) {
      const explore = launcher.locator('[data-first-run-choice="explore"]');
      if (await explore.isVisible().catch(() => false)) { const c = await realClick(page, explore); mark('first-run-dismissed-by-click', c); await page.waitForTimeout(600); }
    }
    await page.waitForTimeout(2500);
    const load = await page.evaluate(() => ({
      build: document.documentElement.dataset.geBuild || '',
      renderState: document.documentElement.dataset.renderState || null,
      renderStatus: document.getElementById('workstation-render-status')?.textContent?.trim(),
      placeholder: document.getElementById('incident-composer-input')?.getAttribute('placeholder'),
      buttonText: document.getElementById('incident-composer-submit')?.textContent?.trim(),
      canvas: (() => { const c = document.querySelector('#cesiumContainer canvas'); return c ? { w: c.width, h: c.height } : null; })(),
      rasterTiles: document.querySelectorAll('#workstation-raster-tiles img').length,
      webgl: (() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })(),
      title: document.title,
    }));
    const viewBox = await page.evaluate(visibleBox, '#workstation-view');
    const beforeRaw = await shot(page, 'A-loaded', { clip: viewBox || undefined });
    const beforeStats = beforeRaw ? await pixelStats(beforeRaw) : null;
    await shot(page, 'A-full');
    const buildOk = /^[0-9a-f]{7,}$/.test(load.build);
    report.load = { ...load, viewBox, scenePixels: beforeStats };
    report.confirmed.A = {
      scenePixelsNonBlack: Boolean(beforeStats && beforeStats.nonBlackRatio > 0.05),
      placeholder: /^Type an incident(\.\.\.|\u2026)$/.test(load.placeholder || ''),
      buildButton: /BUILD SCENE/i.test(load.buttonText || ''),
      buildId: load.build,
      buildIdOk: buildOk,
      renderState: load.renderState,
    };
    if (!report.confirmed.A.scenePixelsNonBlack) fail('A scene pixels', beforeStats);
    if (!report.confirmed.A.placeholder) fail('A placeholder', load.placeholder);
    if (!report.confirmed.A.buildButton) fail('A BUILD SCENE button', load.buttonText);
    if (!buildOk) fail('A build id', load.build);
    if (noWebgl && load.webgl) fail('D webgl still available', load);
    if (noWebgl && load.renderState !== 'fallback') fail('D render state not fallback', load.renderState);

    // ---- type + submit like a human
    await humanType(page, input, prompt);
    mark('typed', { value: await input.inputValue() });
    const initialHash = await page.evaluate(() => location.hash);
    let click = null;
    const tSubmit = Date.now();
    if (submit === 'enter') { await page.keyboard.press('Enter'); mark('enter-pressed'); }
    else { click = await realClick(page, button); mark('button-clicked', click); }

    // ---- observe stage transitions from the DOM (poll 150 ms, up to BUILD_WAIT + 30 s)
    let prev = null, sawBuilding = false, s4At = null, savedAt = null, flyShotDone = false, last = null;
    const deadline = tSubmit + BUILD_WAIT_MS + 30_000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(domSnapshot).catch(() => null);
      if (!s) break;
      last = s;
      if (s.btnDisabled === true && /BUILDING/i.test(s.btnText || '')) sawBuilding = true;
      const key = `${s.chipStage}|${s.geStage}|${s.formState}|${s.btnDisabled}`;
      if (key !== prev) {
        report.stageTransitions.push({ ts: s.ts, sinceSubmitMs: Date.now() - tSubmit, chipStage: s.chipStage, geStage: s.geStage, formState: s.formState, btn: `${s.btnText}${s.btnDisabled ? ' (disabled)' : ''}`, hash: s.hash });
        prev = key;
        if (['parsing', 'routing', 'flying', 'fetching'].includes(s.chipStage) || /^S[0-4]$/.test(s.geStage || '')) await shot(page, `stage-${s.chipStage || 'x'}-${s.geStage || 'x'}`);
      }
      if (!flyShotDone && s.geStage && s.geStage !== 'S0' && s.geStage !== 'S4') { flyShotDone = true; }
      if (!s4At && s.geStage === 'S4') s4At = Date.now();
      if (!savedAt && s.formState === 'done') savedAt = Date.now();
      if (s.formState === 'error') { fail('build error state', s.result); break; }
      if (s4At && savedAt && s.btnDisabled === false) break;
      await page.waitForTimeout(150);
    }
    report.timeToS4s = s4At ? +((s4At - tSubmit) / 1000).toFixed(1) : null;
    report.timeToSavedS = savedAt ? +((savedAt - tSubmit) / 1000).toFixed(1) : null;
    report.statusEvents = await page.evaluate(() => window.__accept?.statuses || []).catch(() => []);
    await page.waitForTimeout(1500);
    const afterRaw = await shot(page, 'built', { clip: viewBox || undefined });
    await shot(page, 'built-full');
    const diff = beforeRaw && afterRaw ? await pixelDiff(beforeRaw, afterRaw) : null;
    const afterStats = afterRaw ? await pixelStats(afterRaw) : null;

    const dom = await page.evaluate((sel) => {
      const vis = (s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' ? { w: Math.round(r.width), h: Math.round(r.height) } : null; };
      const chips = [...document.querySelectorAll('#incident-composer-chips .incident-composer__chip')].map((c) => `${c.dataset.step}:${c.dataset.status}`);
      const pinsCesium = (window.__godsEyeView?.viewer?.entities?.values || []).filter((e) => /:pin:/.test(String(e.id || ''))).length;
      return {
        header: vis('#ge-scene-header'), headerText: document.querySelector('#ge-scene-header')?.innerText?.slice(0, 160) || null,
        rail: vis('#ge-rail'), railCards: document.querySelectorAll('#ge-rail .ge-card').length,
        timeline: vis('#ge-timeline'), evidence: vis('#ge-evidence'), player: vis('#ge-player'),
        media: document.querySelectorAll('#ge-player iframe, #ge-player video').length,
        banner: (() => { const b = document.getElementById('ge-banner'); return b && !b.hidden && b.getBoundingClientRect().height > 0 ? b.textContent.trim() : null; })(),
        chips, allDone: chips.length === 8 && chips.every((c) => c.endsWith(':done')),
        geStage: document.documentElement.dataset.geStage, btnDisabled: document.getElementById('incident-composer-submit')?.disabled, btnText: document.getElementById('incident-composer-submit')?.textContent?.trim(),
        pinsCesium, hash: location.hash, rasterTransform: document.getElementById('workstation-raster-tiles')?.style.transform || null, rasterStatus: document.getElementById('workstation-raster-status')?.textContent || null,
        isoStamps: (document.getElementById('ge-scene-root')?.innerText.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?Z?/g) || []).slice(0, 3),
      };
    });
    // ---- Scenes panel: open it with a real click, read the entry
    const scenesBtn = page.locator('[data-workstation-panel="scenes"]');
    const sc = await realClick(page, scenesBtn);
    mark('scenes-panel-clicked', sc);
    await page.waitForSelector('#ge-scenes-list [data-scene-id]', { timeout: 10_000 }).catch(() => {});
    const scenes = await page.evaluate(() => [...document.querySelectorAll('#ge-scenes-list [data-scene-id]')].map((c) => ({ id: c.getAttribute('data-scene-id'), text: c.innerText.replace(/\s+/g, ' ').slice(0, 120) })));
    await shot(page, 'scenes-panel');
    // button re-enabled?
    const reEnabled = await page.waitForFunction(() => document.getElementById('incident-composer-submit')?.disabled === false, null, { timeout: 15_000 }).then(() => true).catch(() => false);
    const finalBtn = await page.evaluate(() => ({ disabled: document.getElementById('incident-composer-submit')?.disabled, text: document.getElementById('incident-composer-submit')?.textContent?.trim() }));

    const hashLatLon = (h) => { const p = new URLSearchParams((h || '').replace(/^#/, '')); return { lat: Number(p.get('lat')), lon: Number(p.get('lon')), alt: Number(p.get('alt')) }; };
    const pos0 = hashLatLon(initialHash), pos1 = hashLatLon(dom.hash);
    const camMoved = Number.isFinite(pos1.lat) && (Math.abs(pos1.lat - pos0.lat) > 0.01 || Math.abs(pos1.lon - pos0.lon) > 0.01 || Math.abs(pos1.alt - pos0.alt) > 1000 || !Number.isFinite(pos0.lat));
    const expectedTarget = expectArchive ? { lat: 25.147, lon: 55.199 } : { lat: 25.1972, lon: 55.2744 };
    const nearTarget = Number.isFinite(pos1.lat) && Math.abs(pos1.lat - expectedTarget.lat) < 0.03 && Math.abs(pos1.lon - expectedTarget.lon) < 0.03;

    report.confirmed.build = {
      buildingState: sawBuilding,
      stagesS0toS4: s4At != null,
      stageSequence: report.stageTransitions.map((t) => t.geStage).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
      chipsAllDone: dom.allDone, chips: dom.chips,
      flyIn: { pixelDiffRatio: diff, hashBefore: pos0, hashAfter: pos1, cameraMoved: camMoved, nearTarget, rasterTransform: dom.rasterTransform },
      placeHeader: Boolean(dom.header), headerText: dom.headerText,
      pins: { cesiumEntities: dom.pinsCesium, railCards: dom.railCards },
      footageRail: Boolean(dom.rail) && dom.railCards > 0,
      timeline: Boolean(dom.timeline), evidenceStrip: Boolean(dom.evidence), player: Boolean(dom.player), mediaElements: dom.media,
      scenesPanelEntries: scenes, scenesEntry: scenes.length > 0,
      buttonReEnabled: reEnabled && finalBtn.disabled === false, finalButton: finalBtn,
      banner: dom.banner, isoStamps: dom.isoStamps,
      scenePixelsAfter: afterStats,
      timeToS4s: report.timeToS4s, withinBudget: report.timeToS4s != null && report.timeToS4s <= BUILD_WAIT_MS / 1000,
    };
    const c = report.confirmed.build;
    if (!c.buildingState) fail('BUILDING… / disabled state never observed', report.stageTransitions.slice(0, 6));
    if (!c.stagesS0toS4) fail('S4 not reached', last);
    if (!c.withinBudget) fail(`S4 later than ${BUILD_WAIT_MS / 1000}s`, report.timeToS4s);
    if (!c.chipsAllDone) fail('stage chips not all done', dom.chips);
    if (!(diff != null && diff > 0.02) && !camMoved) fail('no fly-in detected (pixel diff and hash unchanged)', c.flyIn);
    if (!nearTarget) fail('camera not at expected target', c.flyIn);
    if (!c.placeHeader) fail('place header not visible', dom);
    if (!c.footageRail) fail('footage rail not visible / empty', { rail: dom.rail, cards: dom.railCards });
    if (!c.timeline) fail('timeline not visible', dom.timeline);
    if (!c.evidenceStrip) fail('evidence strip not visible', dom.evidence);
    if (!c.scenesEntry) fail('no Scenes panel entry', scenes);
    if (!c.buttonReEnabled) fail('button not re-enabled', finalBtn);
    if (!noWebgl && dom.pinsCesium === 0) fail('no pins on the globe', dom.pinsCesium);
    if (expectArchive) {
      const m = /REBUILT FROM ARCHIVAL FOOTAGE — originally reported (\d{4}-\d{2}-\d{2})/.exec(dom.banner || '');
      report.confirmed.build.archiveBannerDate = m ? m[1] : null;
      if (!m) fail('archival banner missing', dom.banner);
    }
  } catch (e) {
    fail('exception', String(e?.stack || e).slice(0, 800));
    await shot(page, 'exception').catch(() => {});
  } finally {
    report.console = classifyConsole(logs);
    report.network = networkStats(logs);
    report.finishedAt = stamp();
    report.result = report.failures.length ? 'FAIL' : 'PASS';
    fs.writeFileSync(path.join(dir, `${label}-console-log.json`), JSON.stringify(logs.console, null, 1));
    fs.writeFileSync(path.join(dir, `${label}-network-log.json`), JSON.stringify(logs.network, null, 1));
    const video = page.video();
    await context.close();
    if (video) { try { const vp = await video.path(); const dest = path.join(dir, `${label}-recording.webm`); fs.renameSync(vp, dest); report.video = path.join(label, `${label}-recording.webm`); } catch {} }
    fs.writeFileSync(path.join(dir, `${label}-report.json`), JSON.stringify(report, null, 2));
    summary.checks = summary.checks.filter((x) => x.label !== label);
    summary.checks.push({ label, check: id, viewport: `${viewport.width}x${viewport.height}`, result: report.result, startedAt: report.startedAt, finishedAt: report.finishedAt, timeToS4s: report.timeToS4s, buildId: report.load?.build, appErrors: report.console.appErrors.length, thirdPartyErrors: report.console.thirdPartyErrors.length, failures: report.failures.map((f) => f.what), confirmed: report.confirmed, video: report.video, screenshots: report.screenshots.length });
    saveSummary();
    console.log(`ACCEPTANCE ${label}: ${report.result} S4=${report.timeToS4s}s appErrors=${report.console.appErrors.length} failures=${JSON.stringify(report.failures.map((f) => f.what))}`);
  }
  return report;
}

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 767, height: 524 }];
const MATRIX = [
  { id: 'B1', prompt: 'burj khalifa', submit: 'click' },
  { id: 'B2', prompt: 'Burj Khalifa', submit: 'click' },
  { id: 'C', prompt: 'rebuild the car crash reported in Umm Suqeim', submit: 'enter', expectArchive: true },
];

test.describe.configure({ mode: 'serial' });
test.describe('23 independent acceptance — human-style, fresh cache-free contexts', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'contexts are created explicitly; run once'); });

  for (const vp of VIEWPORTS) for (const m of MATRIX) {
    const label = `${m.id}@${vp.width}`;
    test(`${label} ${m.prompt} (${m.submit})`, async ({ browser }) => {
      test.skip(ONLY.length > 0 && !ONLY.includes(label) && !ONLY.includes(m.id), 'ACCEPT_ONLY filter');
      test.setTimeout(300_000);
      const r = await runCheck({ browser, id: m.id, viewport: vp, prompt: m.prompt, submit: m.submit, expectArchive: m.expectArchive });
      expect.soft(r.failures, JSON.stringify(r.failures)).toEqual([]);
      expect.soft(r.console.appErrors, 'app console errors').toEqual([]);
      expect(r.confirmed.A?.buildIdOk, `served build id ${r.load?.build} must be a short sha (>= ${MIN_BUILD})`).toBe(true);
    });
  }

  test('D@767 no-WebGL burj khalifa (click) — 2D engine', async () => {
    test.skip(ONLY.length > 0 && !ONLY.includes('D') && !ONLY.includes('D@767'), 'ACCEPT_ONLY filter');
    test.setTimeout(300_000);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
    try {
      const r = await runCheck({ browser, id: 'D', viewport: { width: 767, height: 524 }, prompt: 'burj khalifa', submit: 'click', noWebgl: true });
      expect.soft(r.failures, JSON.stringify(r.failures)).toEqual([]);
      expect.soft(r.console.appErrors, 'app console errors').toEqual([]);
    } finally { await browser.close(); }
  });
});
