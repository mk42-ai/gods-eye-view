#!/usr/bin/env node
/**
 * Composer / dock / evidence-drawer layout regression (cycle 22, 2026-10-30).
 * Real browser, real OnDemand plugins on the target deployment.
 *
 *   setsid timeout -s KILL 1500 node scripts/qa-composer-evidence.mjs \
 *     --url https://<preview> --out <dir> [--label after] [--viewports 1440x900,375x739] [--mode after|before]
 *
 * Per viewport (fresh browser context, walkthrough dismissed via ?tour=0 except the walkthrough check):
 *   1. walkthrough still auto-starts and steps through its 7 steps (fresh storage)
 *   2. bounding-box overlap: AOI composer vs Visual presets / Location / Voice dock in
 *      idle, focused, building and built states
 *   3. build 'sharjah university': evidence panel hidden by default; chip visible with
 *      compact label; chip opens it; X, Esc and click-outside close it
 *   4. evidence panel: no mid-word breaks, no ellipsis without a tooltip, title vs action
 *      buttons, panel vs telemetry, panel vs composer
 *   5. build 'Dubai Marina': same checks + Snapchat footage plays (readyState >= 3, advancing)
 * `--mode before` only captures screenshots + measurements of an older deployment.
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
const MODE = arg('mode', 'after');
const VIEWPORTS = arg('viewports', '1440x900,375x739').split(',');
const PLACES = arg('places', 'sharjah university,Dubai Marina').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url: URL_BASE, mode: MODE, startedUtc: new Date().toISOString(), passed: 0, failed: 0, checks: [], screenshots: [], measurements: {} };
const check = (vp, name, ok, detail = {}) => {
  if (MODE === 'before') {
    report.checks.push({ vp, name, observed: Boolean(ok), detail });
    console.log(`OBSERVED [${vp}] ${name} = ${Boolean(ok)} ${JSON.stringify(detail).slice(0, 240)}`);
    return ok;
  }
  report.checks.push({ vp, name, ok: Boolean(ok), detail });
  ok ? report.passed++ : report.failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${name} ${JSON.stringify(detail).slice(0, 300)}`);
  return ok;
};

/* ---------------- in-page probes ---------------- */
// Visible rects of the composer, each dock section, telemetry and the evidence drawer.
const RECTS = () => {
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (el.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || r.width < 2 || r.height < 2) return null;
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
  };
  const q = (s) => document.querySelector(s);
  return {
    composer: vis(q('#incident-composer')),
    presets: vis(q('#control-panel')),
    location: vis(q('#location-bar')),
    voice: vis(q('#od-voice-control')),
    dock: vis(q('#command-dock')),
    evidence: vis(q('#scene-evidence')),
    chip: vis(q('#scene-evidence-chip')),
    play: vis(q('#incident-composer-play')),
    teleBR: vis(q('#intel-hud .hud-bottom-right .hud-content')),
    teleTR: vis(q('#intel-hud .hud-top-right .hud-content')),
    teleRE: vis(q('#intel-hud .hud-right-edge')),
    title: vis(q('#scene-evidence-title')),
    actions: vis(q('#scene-evidence .sev__actions')) || vis(q('#scene-evidence-rebuild')),
    timing: vis(q('#scene-evidence-timing')),
    footage: vis(q('#scene-footage')),
    vw: innerWidth,
    vh: innerHeight,
  };
};
const overlap = (a, b, pad = 0) => Boolean(a && b && a.x < b.r - pad && b.x < a.r - pad && a.y < b.b - pad && b.y < a.b - pad);

// Words split across lines (mid-word breaks) inside the given roots.
const MIDWORD = (selectors) => {
  const bad = [];
  for (const sel of selectors) {
    for (const root of document.querySelectorAll(sel)) {
      if (root.closest('[hidden]') || getComputedStyle(root).display === 'none') continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const host = n.parentElement;
        if (!host || host.closest('[hidden], details:not([open]) > :not(summary)')) continue;
        const cs = getComputedStyle(host);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const text = n.textContent;
        const re = /\S{3,}/g;
        let m;
        while ((m = re.exec(text))) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
          const lines = new Set(rects.map((r) => Math.round(r.top)));
          // a URL/route token may legitimately wrap at '/', '.', '-' — only flag letters split
          if (lines.size > 1 && /^[\p{L}]+[.,:;)]?$/u.test(m[0])) bad.push(`${host.className || host.tagName}: "${m[0]}"`);
        }
      }
    }
  }
  return bad.slice(0, 20);
};

// Ellipsis/clipping without a tooltip carrying the full text.
const TRUNC = (selectors) => {
  const bad = [];
  for (const sel of selectors)
    for (const el of document.querySelectorAll(`${sel}, ${sel} *`)) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || cs.display === 'none' || el.closest('[hidden], details:not([open]) > :not(summary)')) continue;
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!own) continue;
      const over = el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX);
      if (!over) continue;
      const tip = el.getAttribute('title') || el.parentElement?.getAttribute('title') || '';
      if (cs.textOverflow !== 'ellipsis' || !tip.includes(el.textContent.trim().slice(0, 20))) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 40)}" ellipsis=${cs.textOverflow} tip=${Boolean(tip)}`);
    }
  return bad.slice(0, 20);
};

const MONO = () => {
  const f = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).fontFamily : null; };
  return { submit: f('#incident-composer-submit'), play: f('#incident-composer-play'), chip: f('#scene-evidence-chip') };
};

async function run(browser, vp) {
  const [width, height] = vp.split('x').map(Number);
  const mobile = width < 600;
  const M = (report.measurements[vp] = {});
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
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
  const rects = () => page.evaluate(RECTS);
  const dockOverlap = (R) => ({ presets: overlap(R.composer, R.presets), location: overlap(R.composer, R.location), voice: overlap(R.composer, R.voice), dock: overlap(R.composer, R.dock) });
  const assertNoDockOverlap = (state, R) => {
    M[`rects-${state}`] = R;
    const o = dockOverlap(R);
    check(vp, `${state}: AOI composer does not overlap Visual presets / Location / Voice dock`, R.composer && !o.presets && !o.location && !o.voice && !o.dock, { o, composer: R.composer, dock: R.dock });
  };

  // ---------- 1. walkthrough still works (fresh storage) ----------
  await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#incident-composer-input', { timeout: 90000 });
  if (MODE !== 'before') {
    const tourUp = await page.waitForSelector('.driver-popover.gev-tour', { visible: true, timeout: 30000 }).then(() => true).catch(() => false);
    check(vp, 'walkthrough auto-starts on a fresh visit', tourUp);
    const titles = [];
    if (tourUp) {
      for (let i = 0; i < 7; i++) {
        const t = await page.$eval('.driver-popover.gev-tour .driver-popover-title', (n) => n.innerText).catch(() => '');
        titles.push(t);
        await tap('.driver-popover.gev-tour .driver-popover-next-btn');
        await page.waitForFunction((prev) => { const n = document.querySelector('.driver-popover.gev-tour .driver-popover-title'); return !n || n.innerText !== prev; }, { timeout: 8000, polling: 100 }, t).catch(() => {});
        await sleep(250);
      }
    }
    check(vp, 'walkthrough steps through all 7 steps and Done closes it', titles.join('|') === 'Type a place|Recording window|Build scene|Footage panel|Scenes drawer|Plugins|Mic' && !(await page.$('.driver-popover.gev-tour')), { titles });
  }
  await page.evaluate(() => localStorage.setItem('gev:walkthrough:v1', 'dismissed'));
  await page.goto(`${URL_BASE}/?tour=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#incident-composer-input', { timeout: 90000 });
  await sleep(5000);

  // ---------- 2. idle ----------
  assertNoDockOverlap('idle', await rects());
  await shot('idle');

  let first = true;
  for (const place of PLACES) {
    const slug = place.toLowerCase().includes('marina') ? 'marina' : 'sharjah';
    // focused (typing)
    const input = await page.$('#incident-composer-input');
    if (mobile) await input.tap();
    else await input.click({ clickCount: 3 });
    await page.evaluate(() => { const i = document.querySelector('#incident-composer-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.keyboard.type(place, { delay: 15 });
    await sleep(400);
    assertNoDockOverlap(`${slug} focused`, await rects());
    if (first) await shot('composer-focused');
    // building
    await page.keyboard.press('Enter');
    await sleep(350);
    const Rb = await rects();
    assertNoDockOverlap(`${slug} building`, Rb);
    const pillsVisible = await page.evaluate(() => [...document.querySelectorAll('#incident-composer .incident-composer__chip')].filter((c) => c.getBoundingClientRect().height > 0).length);
    check(vp, `${slug} building: progress pills collapsed into one inline status`, pillsVisible === 0, { pillsVisible, status: await page.$eval('#incident-composer-result', (n) => n.innerText).catch(() => '') });
    if (first) await shot('composer-building');
    // built
    const built = await page.waitForFunction(() => document.querySelector('#incident-composer')?.dataset.state === 'done' || document.querySelector('#incident-composer')?.getAttribute('data-state') === 'done', { timeout: 120000, polling: 300 }).then(() => true).catch(() => false);
    check(vp, `${slug}: scene built`, built, { state: await page.$eval('#incident-composer', (n) => n.getAttribute('data-state')) });
    await sleep(2500); // dock trays reveal + camera fly
    const R = await rects();
    assertNoDockOverlap(`${slug} built`, R);
    const composerText = await page.$eval('#incident-composer-result', (n) => n.innerText).catch(() => '');
    M[`${slug}-composer-text`] = composerText;
    if (MODE === 'before') {
      await shot(`${slug}-built`);
      // old panel auto-opens: capture it as-is
      M[`${slug}-evidence-visible-by-default`] = Boolean(R.evidence);
      await page.waitForFunction(() => ['done', 'error', 'timeout'].includes(document.querySelector('#scene-evidence')?.dataset.phase), { timeout: 90000, polling: 500 }).catch(() => {});
      await sleep(1000);
      await shot(`${slug}-evidence-open`);
      M[`${slug}-rects-evidence`] = await rects();
      M[`${slug}-midword`] = await page.evaluate(MIDWORD, ['#scene-evidence .sev__head']);
      first = false;
      continue;
    }
    const doneRow = await page.evaluate(() => { const t = document.querySelector('#incident-composer .incident-composer__done-text'); const p = document.querySelector('#incident-composer .incident-composer__place'); return t ? { place: p?.innerText, placeTip: p?.title, h: Math.round(t.getBoundingClientRect().height), lh: parseFloat(getComputedStyle(t).lineHeight) || 17 } : null; });
    check(vp, `${slug} built: no "Scene generated at <full address>" sentence; short place name on one line (full address as tooltip)`, !/Scene generated at/.test(composerText) && doneRow && !doneRow.place.includes(',') && doneRow.h <= doneRow.lh * 1.6 && doneRow.placeTip.length >= doneRow.place.length, { doneRow });
    check(vp, `${slug} built: telemetry clear of the composer and the dock`, ![R.teleBR, R.teleTR].some((t) => overlap(t, R.composer) || overlap(t, R.dock)), { teleBR: R.teleBR, composer: R.composer, dock: R.dock });
    check(vp, `${slug} built: Play merged into the status row (same row as the evidence chip)`, R.play && R.chip && Math.abs((R.play.y + R.play.h / 2) - (R.chip.y + R.chip.h / 2)) < (mobile ? 50 : 6), { play: R.play, chip: R.chip });
    const fonts = await page.evaluate(MONO);
    check(vp, `${slug}: no monospace on Build scene / Play`, !/mono/i.test(fonts.submit || '') && !/mono/i.test(fonts.play || ''), fonts);
    // evidence hidden by default + chip
    check(vp, `${slug}: evidence panel hidden by default after the build`, !R.evidence && R.chip, { evidence: R.evidence, chip: R.chip });
    await page.waitForFunction(() => ['done', 'error', 'timeout'].includes(document.querySelector('#scene-evidence')?.dataset.phase), { timeout: 90000, polling: 500 }).catch(() => {});
    await sleep(600);
    const chipText = await page.$eval('#scene-evidence-chip', (n) => n.innerText.trim()).catch(() => '');
    check(vp, `${slug}: chip reads "Evidence · N verified · N candidates"`, /^Evidence · \d+ verified · \d+ candidates?$/.test(chipText), { chipText });
    check(vp, `${slug}: chip text on one line (no wrap / mid-word break)`, (await page.evaluate(MIDWORD, ['#scene-evidence-chip'])).length === 0 && (await page.$eval('#scene-evidence-chip', (n) => n.getBoundingClientRect().height)) < 48);
    if (first) await shot(`${slug}-built`);
    else await shot(`${slug}-built`);
    // open via chip
    await tap('#scene-evidence-chip');
    await sleep(500);
    const Ro = await rects();
    M[`${slug}-rects-evidence`] = Ro;
    check(vp, `${slug}: chip opens the evidence drawer`, Boolean(Ro.evidence), { evidence: Ro.evidence });
    const mid = await page.evaluate(MIDWORD, ['#scene-evidence', '#incident-composer']);
    check(vp, `${slug}: no mid-word breaks in the evidence drawer or composer`, mid.length === 0, { mid });
    const tr = await page.evaluate(TRUNC, ['#scene-evidence .sev__head', '#scene-evidence .sev__stats', '#scene-evidence .sev__meta', '#incident-composer .incident-composer__status']);
    check(vp, `${slug}: no truncation bugs (every ellipsis carries a full-text tooltip)`, tr.length === 0, { tr });
    const head = await page.evaluate(() => {
      const t = document.querySelector('#scene-evidence-title');
      const a = document.querySelector('#scene-evidence-address');
      return { title: t?.innerText, titleTip: t?.title, address: a?.innerText, addressTip: a?.title, titleLines: t ? Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) : 0, stats: [...document.querySelectorAll('#scene-evidence .sev__stat:not([hidden])')].map((s) => s.innerText.replace(/\s+/g, ' ')), sectionsOpen: [...document.querySelectorAll('#scene-evidence details[open]')].length, sections: [...document.querySelectorAll('#scene-evidence details:not([hidden]) > summary')].map((s) => s.innerText) };
    });
    M[`${slug}-head`] = head;
    check(vp, `${slug}: header = short place name on one line + full address as tooltip`, head.titleLines <= 1 && head.title && !head.title.includes(',') && head.titleTip.length >= head.title.length, head);
    check(vp, `${slug}: summary as compact stat chips (verified / candidates [/ timed out])`, head.stats.length >= 2 && /verified/.test(head.stats[0]) && /candidates/.test(head.stats[1]), { stats: head.stats });
    check(vp, `${slug}: source status / candidates / diagnostics collapsible and collapsed by default`, head.sectionsOpen === 0 && head.sections.some((s) => /^Source status/.test(s)) && head.sections.some((s) => /^Diagnostics/.test(s)), { sections: head.sections, open: head.sectionsOpen });
    check(vp, `${slug}: title does not collide with the action buttons`, Ro.title && Ro.actions && !overlap(Ro.title, Ro.actions), { title: Ro.title, actions: Ro.actions });
    const teleHit = [Ro.teleBR, Ro.teleTR, Ro.teleRE].some((t) => overlap(Ro.evidence, t));
    check(vp, `${slug}: evidence drawer clear of telemetry (or telemetry hidden)`, !teleHit, { evidence: Ro.evidence, teleBR: Ro.teleBR, teleTR: Ro.teleTR });
    if (!mobile) check(vp, `${slug}: evidence drawer clear of the composer and the dock`, !overlap(Ro.evidence, Ro.composer) && !overlap(Ro.evidence, Ro.dock), { evidence: Ro.evidence, composer: Ro.composer, dock: Ro.dock });
    const bleed = await page.evaluate(() => { const e = document.querySelector('#scene-evidence'); const cs = getComputedStyle(e); return { bg: cs.backgroundColor, backdrop: cs.backdropFilter }; });
    check(vp, `${slug}: drawer surface is opaque (no ghosted cards showing through)`, /^rgb\(/.test(bleed.bg) || /, 1\)$/.test(bleed.bg), bleed);
    if (first) await shot('evidence-open');
    else await shot(`${slug}-evidence-open`);
    // close with X
    await tap('#scene-evidence-close');
    await sleep(300);
    check(vp, `${slug}: X closes the drawer (chip stays)`, !(await rects()).evidence && (await rects()).chip);
    // open + Esc
    await tap('#scene-evidence-chip');
    await sleep(300);
    await page.keyboard.press('Escape');
    await sleep(300);
    check(vp, `${slug}: Esc closes the drawer`, !(await rects()).evidence);
    // open + click outside (map)
    await tap('#scene-evidence-chip');
    await sleep(300);
    if (mobile) await page.touchscreen.tap(Math.round(width / 2), 120);
    else await page.mouse.click(Math.round(width * 0.35), Math.round(height * 0.3));
    await sleep(400);
    check(vp, `${slug}: click outside closes the drawer`, !(await rects()).evidence);
    first = false;
  }

  // ---------- 5. footage still plays for Dubai Marina ----------
  if (MODE !== 'before' && PLACES.some((p) => /marina/i.test(p))) {
    const settled = await page.waitForFunction(() => { const r = document.querySelector('#scene-footage'); return r && !r.hidden && r.dataset.locationId && !['idle', 'loading'].includes(r.dataset.phase); }, { timeout: 240000, polling: 500 }).then(() => true).catch(() => false);
    const sample = () => page.evaluate(() => { const v = document.querySelector('#scene-footage-video'); return v ? { rs: v.readyState, t: v.currentTime, muted: v.muted, loop: v.loop, d: v.duration } : null; });
    await page.waitForFunction(() => (document.querySelector('#scene-footage-video')?.readyState || 0) >= 3, { timeout: 60000 }).catch(() => {});
    const a = await sample();
    await sleep(2500);
    const b = await sample();
    const advanced = a && b && (b.t > a.t || (a.loop && b.t < a.t && a.t > a.d - 3));
    M.playback = { a, b };
    check(vp, 'Dubai Marina: Snapchat footage still plays (readyState ≥ 3, currentTime advancing, muted)', settled && Boolean(a && b && b.rs >= 3 && advanced && a.muted), { a, b });
    const R = await rects();
    check(vp, 'Dubai Marina: footage panel does not overlap the composer or dock', !overlap(R.footage, R.composer) && !overlap(R.footage, R.dock), { footage: R.footage, composer: R.composer });
    await shot('marina-footage-playing');
  }
  if (MODE !== 'before') check(vp, 'no uncaught page errors', pageErrors.length === 0, { pageErrors: pageErrors.slice(0, 5) });
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
  await fs.writeFile(path.join('/tmp', `qa-composer-evidence-${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.passed} passed / ${report.failed} failed`);
  await browser.close().catch(() => {});
}
