#!/usr/bin/env node
/**
 * Cycle 23 regression: composer Play (camera fly-through), Pause/Resume, Next,
 * Snapchat footage playback and icon visibility, in a real browser.
 *
 *   setsid timeout -s KILL 1800 node scripts/qa-playback-icons.mjs \
 *     --url https://<preview> --out <dir> [--label after] [--viewports 1440x900,375x739] \
 *     [--places "Dubai Marina,sharjah university,Burj Khalifa"] [--iframe 1]
 *
 * --iframe 1 loads the app through /embed-canvas-harness.html (chat-canvas copy).
 * Icon check: every visible control's <svg> has non-zero size, lies in the viewport,
 * is not clipped by a non-scrolling overflow ancestor, and elementFromPoint at its
 * centre lands inside the control. Every icon control has an accessible name.
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
const BASE = arg('url').replace(/\/$/, '');
const OUT = arg('out', '.');
const LABEL = arg('label', 'after');
const VIEWPORTS = arg('viewports', '1440x900,375x739').split(',');
const PLACES = arg('places', 'Dubai Marina,sharjah university,Burj Khalifa').split(',');
const IFRAME = arg('iframe', '0') === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url: BASE, iframe: IFRAME, startedUtc: new Date().toISOString(), passed: 0, failed: 0, checks: [], screenshots: [] };
const check = (vp, name, ok, detail = {}) => {
  report.checks.push({ vp, name, ok: Boolean(ok), detail, at: new Date().toISOString() });
  ok ? report.passed++ : report.failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${name} ${JSON.stringify(detail).slice(0, 260)}`);
  return ok;
};

const ICONS = () => {
  const vw = innerWidth, vh = innerHeight, bad = [], seen = [];
  const shown = (e) => {
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (n.hidden || c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.05) return false;
    }
    return true;
  };
  for (const btn of document.querySelectorAll('button, [role=tab], [role=button]')) {
    if (!shown(btn)) continue;
    const br = btn.getBoundingClientRect();
    if (br.width < 2 || br.height < 2) continue;
    const name = btn.getAttribute('aria-label') || btn.title || btn.innerText.trim();
    for (const ic of btn.querySelectorAll('svg')) {
      if (ic.closest('[hidden]') || ic.parentElement?.closest('svg')) continue;
      const r = ic.getBoundingClientRect();
      const id = btn.id || btn.className.toString().slice(0, 40);
      seen.push(id);
      const issues = [];
      if (!name) issues.push('no-accessible-name');
      if (r.width < 6 || r.height < 6) issues.push(`size ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      let scrolled = false;
      for (let n = ic.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const ov = cs.overflowX + ' ' + cs.overflowY;
        if (!/hidden|clip|auto|scroll/.test(ov)) continue;
        const nr = n.getBoundingClientRect();
        const out = r.left < nr.left - 0.5 || r.right > nr.right + 0.5 || r.top < nr.top - 0.5 || r.bottom > nr.bottom + 0.5;
        if (out) {
          if (/auto|scroll/.test(ov)) scrolled = true; // reachable by scrolling its panel
          else issues.push(`clipped-by ${n.id || n.className.toString().slice(0, 40)}`);
          break;
        }
      }
      if (!scrolled) {
        if (r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.top < -0.5) issues.push('outside-viewport');
        const h = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
        if (h && !btn.contains(h)) issues.push(`covered-by ${h.id || h.className?.toString?.().slice(0, 40) || h.tagName}`);
      }
      if (issues.length) bad.push({ id, name: name.slice(0, 40), issues });
    }
  }
  return { bad, count: seen.length, ids: [...new Set(seen)] };
};
const RECTS = () => {
  const g = (s) => {
    const e = document.querySelector(s);
    if (!e || e.closest('[hidden]')) return null;
    const c = getComputedStyle(e);
    if (c.display === 'none' || c.visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null;
  };
  return { composer: g('#incident-composer'), dock: g('#command-dock'), presets: g('#control-panel'), location: g('#location-bar'), voice: g('#od-voice-control'), sfp: g('#scene-footage'), drawer: g('#left-panel-stack > #scene-panel:not(.collapsed)'), evidence: g('#scene-evidence') };
};
const overlap = (a, b) => Boolean(a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1);
const STATE = () => {
  const d = window.__godsEyeView?.sceneDirector;
  const pl = document.querySelector('#incident-composer-play');
  const r = pl?.getBoundingClientRect();
  const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  const cam = window.__godsEyeView?.viewer?.camera?.positionCartographic;
  const v = document.querySelector('#scene-footage video');
  return {
    playback: document.querySelector('#incident-panel')?.dataset.playback,
    composerPlay: pl?.dataset.playback, playLabel: pl?.getAttribute('aria-label'), playText: pl?.innerText.trim(),
    playHit: Boolean(hit && pl?.contains(hit)), playIcon: pl?.querySelector('svg')?.dataset.icon,
    clock: document.querySelector('#incident-playback-clock')?.textContent,
    elapsed: d?._clock?.snapshot?.sceneElapsedSec ?? null, running: Boolean(d?.running), paused: Boolean(d?.paused),
    shot: d?._selectedShotId || null,
    cam: cam ? [cam.longitude, cam.latitude, cam.height] : null,
    video: v ? { rs: v.readyState, t: v.currentTime, muted: v.muted, paused: v.paused } : null,
    chip: document.querySelector('#scene-evidence-chip:not([hidden])') ? true : false,
    evidenceOpen: document.querySelector('#scene-evidence')?.dataset.open === 'true',
  };
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  await fs.mkdir(OUT, { recursive: true });
  for (const vpSpec of VIEWPORTS) {
    const [w, h] = vpSpec.split('x').map(Number);
    const vp = `${vpSpec}${IFRAME ? '-iframe' : ''}`;
    const mobile = w < 600;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    const target = IFRAME ? `${BASE}/embed-canvas-harness.html?src=${encodeURIComponent('/?tour=0')}` : `${BASE}/?tour=0`;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let frame = page.mainFrame();
    if (IFRAME) {
      const handle = await page.waitForSelector('iframe', { timeout: 60000 });
      frame = await handle.contentFrame();
    }
    await frame.waitForSelector('#incident-composer-input', { timeout: 120000 });
    await sleep(5000);
    const shot = async (name) => {
      const file = path.join(OUT, `${LABEL}-${name}-${vp}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
    };
    const idle = await frame.evaluate(ICONS);
    check(vp, `idle: every icon visible, sized, uncovered and labelled (${idle.count} icons)`, idle.bad.length === 0 && idle.count > 5, idle.bad);
    let R = await frame.evaluate(RECTS);
    check(vp, 'idle: AOI composer does not overlap the dock (presets/location/voice)', !overlap(R.composer, R.presets) && !overlap(R.composer, R.location) && !overlap(R.composer, R.voice), R);
    await shot('idle');
    for (const place of PLACES) {
      const slug = place.toLowerCase().includes('marina') ? 'marina' : place.toLowerCase().includes('sharjah') ? 'sharjah' : 'burj';
      const input = await frame.$('#incident-composer-input');
      await input.click();
      // Touch emulation ignores triple-click selection: clear with select-all + delete.
      await frame.evaluate(() => document.querySelector('#incident-composer-input')?.select());
      await page.keyboard.press('Backspace');
      await input.type(place, { delay: 15 });
      await page.keyboard.press('Enter');
      const ready = await frame.waitForFunction(() => document.querySelector('#incident-composer')?.getAttribute('data-state') === 'done' && document.querySelector('#incident-composer-play'), { timeout: 180000 }).then(() => true, () => false);
      if (!ready) {
        const dbg = await frame.evaluate(() => ({ state: document.querySelector('#incident-composer')?.getAttribute('data-state'), value: document.querySelector('#incident-composer-input')?.value, result: document.querySelector('#incident-composer-result')?.innerText.slice(0, 200), active: document.activeElement?.id }));
        check(vp, `${slug}: scene built`, false, dbg);
        await shot(`${slug}-not-built`);
        continue;
      }
      await sleep(2500);
      let s0 = await frame.evaluate(STATE);
      check(vp, `${slug}: Play button rendered with a play icon and is the topmost element at its centre`, s0.playHit && s0.playIcon === 'play', s0);
      check(vp, `${slug}: evidence drawer hidden by default after build (chip shown)`, s0.chip && !s0.evidenceOpen, { chip: s0.chip, open: s0.evidenceOpen });
      R = await frame.evaluate(RECTS);
      check(vp, `${slug} built: composer does not overlap the dock`, !overlap(R.composer, R.presets) && !overlap(R.composer, R.location) && !overlap(R.composer, R.voice), R);
      check(vp, `${slug} built: footage panel does not overlap composer or open drawer`, !overlap(R.sfp, R.composer) && !overlap(R.sfp, R.drawer), { sfp: R.sfp, drawer: R.drawer });
      const built = await frame.evaluate(ICONS);
      check(vp, `${slug} built: every icon visible, sized, uncovered and labelled (${built.count} icons)`, built.bad.length === 0, built.bad);
      // Real pointer click on Play.
      await (await frame.$('#incident-composer-play')).click();
      await sleep(1500);
      const s1 = await frame.evaluate(STATE);
      await sleep(2500);
      const s2 = await frame.evaluate(STATE);
      const advanced = s1.elapsed !== null && s2.elapsed !== null && s2.elapsed > s1.elapsed + 0.5;
      const moved = s1.cam && s2.cam && (Math.abs(s1.cam[0] - s2.cam[0]) + Math.abs(s1.cam[1] - s2.cam[1]) > 1e-7 || Math.abs(s1.cam[2] - s2.cam[2]) > 0.05);
      check(vp, `${slug}: Play starts the camera scene (running, clock advancing, camera moving)`, s2.running && s2.playback === 'playing' && advanced && moved, { s1: [s1.clock, s1.elapsed], s2: [s2.clock, s2.elapsed], moved });
      check(vp, `${slug}: composer button switched to Pause while playing`, s2.composerPlay === 'playing' && s2.playIcon === 'pause' && /pause/i.test(s2.playText), { text: s2.playText, icon: s2.playIcon });
      await shot(`${slug}-playing`);
      // Pause from the composer button.
      await (await frame.$('#incident-composer-play')).click();
      await sleep(1200);
      const s3 = await frame.evaluate(STATE);
      await sleep(1500);
      const s4 = await frame.evaluate(STATE);
      check(vp, `${slug}: Pause stops the clock`, !s4.running && s4.paused && s3.clock === s4.clock && s4.composerPlay === 'paused', { s3: s3.clock, s4: s4.clock, composer: s4.composerPlay });
      // Next keyframe (panel control; open the drawer first on phones).
      if (mobile) await (await frame.$('#sidebar-scenes-tab')).click(), await sleep(800);
      const before = (await frame.evaluate(STATE)).shot;
      await frame.evaluate(() => document.querySelector('#incident-playback-next')?.scrollIntoView({ block: 'nearest' }));
      await (await frame.$('#incident-playback-next')).click();
      await sleep(2500);
      const s5 = await frame.evaluate(STATE);
      check(vp, `${slug}: Next advances to another keyframe`, Boolean(s5.shot && s5.shot !== before), { before, after: s5.shot });
      // Resume from the composer.
      if (mobile) await (await frame.$('#scene-drawer-toggle')).click().catch(() => {}), await sleep(600);
      await (await frame.$('#incident-composer-play')).click();
      await sleep(2500);
      const s6 = await frame.evaluate(STATE);
      check(vp, `${slug}: Play again resumes playback`, s6.running && s6.playback === 'playing', { clock: s6.clock, composer: s6.composerPlay });
      if (slug === 'marina') {
        const t0 = Date.now();
        let a = null, b = null;
        while (Date.now() - t0 < 120000) {
          a = (await frame.evaluate(STATE)).video;
          if (a && a.rs >= 4) {
            await sleep(1500);
            b = (await frame.evaluate(STATE)).video;
            break;
          }
          await sleep(2000);
        }
        // The clip loops: a lower second sample after a wrap still proves advancing playback.
        const progressed = Boolean(a && b && (b.t > a.t || (b.t < a.t && b.t > 0.05)));
        check(vp, 'marina: Snapchat footage readyState 4, muted, currentTime advancing', Boolean(a && b && b.rs === 4 && b.muted && !b.paused && progressed), { a, b });
        await shot('marina-footage');
      }
      await (await frame.$('#incident-composer-play')).click().catch(() => {});
      await sleep(800);
    }
    check(vp, 'no uncaught page errors', errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
} finally {
  await browser.close();
  report.finishedUtc = new Date().toISOString();
  await fs.writeFile(path.join(OUT, `${LABEL}-qa-playback-icons${IFRAME ? '-iframe' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(`TOTAL ${report.passed} passed / ${report.failed} failed`);
}
