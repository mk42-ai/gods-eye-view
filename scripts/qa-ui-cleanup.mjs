#!/usr/bin/env node
/**
 * UI cleanup regression (cycle 21, 2026-10-30) — real browser, real plugin.
 *
 *   setsid timeout -s KILL 900 node scripts/qa-ui-cleanup.mjs --url https://<preview> --out <dir> [--label after]
 *
 * Per viewport (1440x900 and 375x739, fresh browser context each):
 *   1. first load (fresh storage): only the globe + AOI box (+ Scenes tab, Plugins chip, Mic, help);
 *      drawers / Plugins list closed; no telemetry; no first-launch modal / "forbidden cockpit" copy
 *   2. walkthrough auto-starts, steps through all 7 steps, Skip works on a middle step,
 *      "Don't show this again" persists across reload, help button replays it
 *   3. no truncated text in visible chrome; one accent hue (status green/red allowed)
 *   4. live Dubai Marina build → Snapchat footage plays (readyState ≥ 3, currentTime advancing, muted)
 *      in the cleaned-up panel; telemetry appears only after the scene is built
 *   5. the OnDemand key (ONDEMAND_KEY_TO_SCAN, env only, never printed) never appears in browser traffic
 * Uses the repo's Puppeteer devDependency against /usr/bin/chromium. Run it under
 * `setsid timeout -s KILL` so the whole process group (Chromium children included) dies on exit.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL_BASE = arg('url').replace(/\/$/, '');
const OUT = arg('out', '.');
const LABEL = arg('label', 'after');
const VIEWPORTS = arg('viewports', '1440x900,375x739').split(',');
const KEY = process.env.ONDEMAND_KEY_TO_SCAN || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url: URL_BASE, startedUtc: new Date().toISOString(), passed: 0, failed: 0, checks: [], screenshots: [], keyScan: { enabled: Boolean(KEY), requests: 0, hits: 0 }, viewports: {} };
const check = (vp, name, ok, detail = {}) => {
  report.checks.push({ vp, name, ok: Boolean(ok), detail });
  ok ? report.passed++ : report.failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${name} ${JSON.stringify(detail).slice(0, 260)}`);
  return ok;
};

/* ---------- in-page probes ---------- */
const VISIBLE_CHROME = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const ids = ['incident-composer', 'incident-composer-input', 'incident-composer-window', 'incident-composer-submit', 'od-plugins-chip', 'ondemand-plugin-panel', 'scene-panel', 'data-panel', 'intel-hud', 'hud-mgrs', 'hud-gsd', 'hud-alt', 'hud-ais-vessel', 'right-context-rail', 'first-run-launcher', 'od-voice-button', 'gev-help-button', 'sidebar-scenes-tab', 'scene-footage', 'control-panel', 'location-bar', 'top-center-actions', 'style-indicator'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    out[id] = Boolean(el && vis(el) && !el.closest('[hidden]'));
  }
  out.bodyText = document.body.innerText.slice(0, 4000);
  out.chip = document.querySelector('#od-plugins-chip')?.innerText || '';
  return out;
};

const TRUNCATION = () => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#cesiumContainer, .cesium-viewer, canvas, svg, video, select, option, input, textarea, .driver-overlay')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clipped = /(hidden|clip)/.test(cs.overflowX + cs.overflow) && el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace.startsWith('nowrap');
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 2;
    if (ellipsis || clipped || clamp) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')} "${el.innerText.slice(0, 40)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
  }
  return bad;
};

const PALETTE = () => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const hsl = ({ r, g, b }) => {
    const [R, G, B] = [r, g, b].map((v) => v / 255);
    const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: h * 60, s, l };
  };
  const hues = {};
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#cesiumContainer, .cesium-viewer, canvas, video, .od-platform-logo, .driver-overlay, [data-layer-color], .legend, .incident-legend, .sev-badge, .geo-marker, img')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const props = { color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor, outline: cs.outlineStyle !== 'none' ? cs.outlineColor : '' };
    if (cs.borderTopWidth === '0px') delete props.border;
    for (const [prop, val] of Object.entries(props)) {
      const c = parse(val);
      if (!c || c.a < 0.2) continue;
      const { h, s, l } = hsl(c);
      if (s < 0.25 || l < 0.12 || l > 0.92) continue; // neutral
      const bucket = Math.round(h / 10) * 10;
      hues[bucket] = (hues[bucket] || 0) + 1;
      const accent = h >= 150 && h <= 175; // #3bb795 ≈ 163.5°
      const success = h >= 130 && h < 150; // --ui-success #5bbf7f ≈ 142° (status dots only)
      const error = h <= 10 || h >= 350; // --ui-error #e5605a ≈ 3° (status only)
      if (!accent && !success && !error) offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].slice(0, 2).join('.')} ${prop}=${val}`);
    }
  }
  return { hues, offenders: offenders.slice(0, 30), offenderCount: offenders.length };
};

async function run(browser, vp) {
  const [width, height] = vp.split('x').map(Number);
  const mobile = width < 600;
  const V = (report.viewports[vp] = {});
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on('request', (req) => {
    if (!KEY) return;
    report.keyScan.requests++;
    if (`${req.url()}\n${JSON.stringify(req.headers())}\n${req.postData() || ''}`.includes(KEY)) report.keyScan.hits++;
  });
  page.on('response', async (res) => {
    if (!KEY || !res.url().includes('/api/')) return;
    const t = await res.text().catch(() => '');
    if (t.includes(KEY)) report.keyScan.hits++;
  });
  const shot = async (name) => {
    const file = path.join(OUT, `${LABEL}-${name}-${vp}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(path.basename(file));
  };
  const tap = async (sel) => {
    const h = await page.waitForSelector(sel, { visible: true, timeout: 15000 });
    if (mobile) await h.tap();
    else await h.click();
  };

  // ---------- 1 + 2: first load, walkthrough ----------
  await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#incident-composer-input', { timeout: 90000 });
  const tourUp = await page.waitForSelector('.driver-popover.gev-tour', { visible: true, timeout: 30000 }).then(() => true).catch(() => false);
  check(vp, 'walkthrough auto-starts on a fresh visit', tourUp);
  const stepTitles = [];
  if (tourUp) {
    await sleep(600);
    await shot('walkthrough-step1');
    for (let i = 0; i < 7; i++) {
      const t = await page.$eval('.driver-popover.gev-tour .driver-popover-title', (n) => n.innerText).catch(() => '');
      const hasSkip = await page.$('.driver-popover.gev-tour [data-tour-skip]').then(Boolean);
      const hasDismiss = await page.$('.driver-popover.gev-tour [data-tour-dismiss]').then(Boolean);
      stepTitles.push({ t, hasSkip, hasDismiss });
      if (i === 5) await shot('walkthrough-plugins-step');
      if (i < 6) {
        await tap('.driver-popover.gev-tour .driver-popover-next-btn');
        // Wait for the popover to actually re-render with the next step (no fixed sleep race).
        await page.waitForFunction((prev) => { const n = document.querySelector('.driver-popover.gev-tour .driver-popover-title'); return n && n.innerText !== prev; }, { timeout: 8000, polling: 100 }, t).catch(() => {});
        await sleep(250);
      }
    }
    V.stepTitles = stepTitles;
    check(vp, 'walkthrough has the 7 requested steps in order', stepTitles.map((s) => s.t).join('|') === 'Type a place|Recording window|Build scene|Footage panel|Scenes drawer|Plugins|Mic', { titles: stepTitles.map((s) => s.t) });
    check(vp, 'every step offers Skip and "Don\'t show this again"', stepTitles.every((s) => s.hasSkip && s.hasDismiss));
    // Done closes it
    await tap('.driver-popover.gev-tour .driver-popover-next-btn');
    await sleep(500);
    check(vp, 'Done closes the walkthrough', !(await page.$('.driver-popover.gev-tour')));
  }
  // replay from help, then Skip on step 3
  await tap('#gev-help-button');
  const replay = await page.waitForSelector('.driver-popover.gev-tour', { visible: true, timeout: 15000 }).then(() => true).catch(() => false);
  check(vp, 'help button replays the walkthrough', replay);
  if (replay) {
    await tap('.driver-popover.gev-tour .driver-popover-next-btn');
    await sleep(400);
    await tap('.driver-popover.gev-tour .driver-popover-next-btn');
    await sleep(400);
    await shot('walkthrough-replay-step3');
    await tap('.driver-popover.gev-tour [data-tour-dismiss]');
    await tap('.driver-popover.gev-tour [data-tour-skip]');
    await sleep(500);
    check(vp, 'Skip on step 3 ends the walkthrough', !(await page.$('.driver-popover.gev-tour')));
    const stored = await page.evaluate(() => localStorage.getItem('gev:walkthrough:v1'));
    check(vp, '"Don\'t show this again" persisted', stored === 'dismissed', { stored });
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#incident-composer-input', { timeout: 90000 });
  await sleep(6000);
  check(vp, 'after "Don\'t show this again" the walkthrough does not auto-start', !(await page.$('.driver-popover.gev-tour')));

  // ---------- 1: calm launch ----------
  const calm = await page.evaluate(VISIBLE_CHROME);
  V.calm = { ...calm, bodyText: undefined };
  check(vp, 'first load: AOI box visible (input, recording window, Build scene)', calm['incident-composer-input'] && calm['incident-composer-window'] && calm['incident-composer-submit']);
  check(vp, 'first load: Scenes drawer and Plugins list closed', !calm['scene-panel'] && !calm['data-panel'] && !calm['ondemand-plugin-panel']);
  check(vp, 'first load: no telemetry (VIIRS/EL/AIS HUD) before a scene', !calm['intel-hud'] && !calm['hud-alt'] && !calm['hud-ais-vessel'] && !calm['hud-gsd']);
  check(vp, 'first load: no context rail, presets, location tray, camera actions', !calm['right-context-rail'] && !calm['control-panel'] && !calm['location-bar'] && !calm['top-center-actions'] && !calm['style-indicator']);
  check(vp, 'Plugins collapsed into one chip "Plugins · N ready"', /^Plugins · \d+ ready$/.test(calm.chip.trim()), { chip: calm.chip });
  check(vp, 'four-card first-launch modal and "forbidden cockpit" copy removed', !calm['first-run-launcher'] && !/forbidden cockpit/i.test(calm.bodyText) && !(await page.$('#first-run-launcher')));
  const trunc0 = await page.evaluate(TRUNCATION);
  check(vp, 'no truncated text on first load', trunc0.length === 0, { truncated: trunc0 });
  const pal0 = await page.evaluate(PALETTE);
  check(vp, 'one accent colour on first load (no off-palette chromatic chrome)', pal0.offenderCount === 0, pal0);
  const accent = await page.$eval('#incident-composer-submit', (b) => getComputedStyle(b).backgroundColor);
  check(vp, 'Build scene carries the single teal accent', accent === 'rgb(59, 183, 149)', { accent });
  await shot('idle');

  // plugins chip list + verify-all
  await tap('#od-plugins-chip');
  await sleep(1200);
  const pl = await page.evaluate(() => ({
    open: !document.getElementById('ondemand-plugin-panel')?.hidden,
    dots: document.querySelectorAll('.od-plugin__dot').length,
    pills: document.querySelectorAll('.od-plugin__state, .od-plugin__verify').length,
    verifyAll: [...document.querySelectorAll('.od-plugins__verify-all')].map((b) => b.innerText.trim()),
  }));
  check(vp, 'Plugins chip opens the list with one status dot per plugin and a single "Verify all"', pl.open && pl.dots > 0 && pl.pills === 0 && pl.verifyAll.length === 1 && pl.verifyAll[0] === 'Verify all', pl);
  const trunc1 = await page.evaluate(TRUNCATION);
  check(vp, 'no truncated text in the Plugins list', trunc1.length === 0, { truncated: trunc1 });
  await shot('plugins-open');
  await tap('.od-plugins__close');
  await sleep(300);
  // scenes drawer
  await tap('#sidebar-scenes-tab');
  await sleep(500);
  const drawer = await page.evaluate(() => ({ open: !document.getElementById('scene-panel')?.hidden, toggle: document.getElementById('scene-drawer-toggle')?.innerText, tbg: getComputedStyle(document.getElementById('scene-drawer-toggle')).backgroundColor }));
  check(vp, 'Scenes tab opens the drawer; Collapse drawer control is dark (not white)', drawer.open && !/rgb\(2[3-5]\d, 2[3-5]\d, 2[3-5]\d\)/.test(drawer.tbg), drawer);
  const trunc2 = await page.evaluate(TRUNCATION);
  check(vp, 'no truncated text in the Scenes drawer', trunc2.length === 0, { truncated: trunc2 });
  await shot('scenes-drawer');
  await tap('#scene-drawer-toggle');
  await sleep(300);

  // ---------- 4: live Dubai Marina build ----------
  const input = await page.$('#incident-composer-input');
  if (mobile) await input.tap();
  else await input.click({ clickCount: 3 });
  await page.keyboard.type('Dubai Marina', { delay: 20 });
  const t0 = Date.now();
  await tap('#incident-composer-submit');
  const footage = await page
    .waitForFunction(() => { const r = document.querySelector('#scene-footage'); return r && !r.hidden && r.dataset.locationId && !['idle', 'loading'].includes(r.dataset.phase); }, { timeout: 240000, polling: 500 })
    .then(() => true)
    .catch(() => false);
  const fst = await page.evaluate(() => ({ phase: document.querySelector('#scene-footage')?.dataset.phase, loc: document.querySelector('#scene-footage')?.dataset.locationId }));
  V.marina = { settleMs: Date.now() - t0, ...fst };
  check(vp, 'Dubai Marina scene built and footage settled', footage, { ...fst, ms: Date.now() - t0 });
  const ready = await page.evaluate(() => document.body.dataset.sceneReady);
  check(vp, 'telemetry revealed after the scene is built', ready === 'true' && (await page.evaluate(VISIBLE_CHROME))['hud-mgrs'], { ready });
  const sample = () => page.evaluate(() => { const v = document.querySelector('#scene-footage-video'); return v ? { rs: v.readyState, t: v.currentTime, muted: v.muted, loop: v.loop, d: v.duration, loc: v.dataset.locationId } : null; });
  await page.waitForFunction(() => (document.querySelector('#scene-footage-video')?.readyState || 0) >= 3, { timeout: 60000 }).catch(() => {});
  const a = await sample();
  await sleep(2500);
  const b = await sample();
  const advanced = a && b && (b.t > a.t || (a.loop && b.t < a.t && a.t > a.d - 3));
  V.playback = { a, b };
  check(vp, 'Snapchat footage plays in the cleaned-up panel (readyState ≥ 3, currentTime advancing, muted)', Boolean(a && b && b.rs >= 3 && advanced && a.muted), { a, b });
  const panel = await page.evaluate(() => {
    const r = document.querySelector('#scene-footage');
    return { text: r?.innerText.slice(0, 900) || '', clips: r?.querySelectorAll('[data-clip-id]').length || 0, logo: Boolean(r?.querySelector('.od-platform-logo--snapchat')), icons: r?.querySelectorAll('svg.od-icon').length || 0 };
  });
  check(vp, 'footage panel shows clip selector, source and upload time', panel.clips > 0 && /Source: Snapchat Spotlight/.test(panel.text) && /published /.test(panel.text), { clips: panel.clips });
  check(vp, 'footage panel uses the monochrome Snapchat logo + Lucide icons', panel.logo && panel.icons > 0, { logo: panel.logo, icons: panel.icons });
  const trunc3 = await page.evaluate(TRUNCATION);
  check(vp, 'no truncated text with the scene and footage open', trunc3.length === 0, { truncated: trunc3 });
  const pal3 = await page.evaluate(PALETTE);
  check(vp, 'one accent colour with the scene built', pal3.offenderCount === 0, pal3);
  await shot('marina-playing');
  V.pageErrors = pageErrors;
  check(vp, 'no uncaught page errors', pageErrors.length === 0, { pageErrors: pageErrors.slice(0, 5) });
  await ctx.close();
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const vp of VIEWPORTS) {
    try {
      await run(browser, vp);
    } catch (e) {
      check(vp, 'run completed without exception', false, { error: String(e.message).slice(0, 300) });
    }
  }
} finally {
  report.finishedUtc = new Date().toISOString();
  check('all', 'OnDemand key never present in browser traffic', !KEY || report.keyScan.hits === 0, report.keyScan);
  await fs.writeFile(path.join('/tmp', `qa-ui-cleanup-${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.passed} passed / ${report.failed} failed`);
  await browser.close().catch(() => {});
}
