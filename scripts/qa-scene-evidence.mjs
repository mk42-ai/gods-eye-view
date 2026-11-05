#!/usr/bin/env node
/**
 * Scene evidence end-to-end harness (cycle 17, 2026-10-24).
 *
 * Loads public/embed-canvas-harness.html (a MIRROR of the OnDemand chat-canvas
 * embed — NOT the real host) from a separate local origin so the app runs in a
 * CROSS-ORIGIN iframe (sandbox="allow-scripts allow-same-origin allow-forms
 * allow-popups", microphone 'none'), then drives the real AOI box with native
 * keyboard / mouse / touch input:
 *   Dubai Marina via Enter, Burj Khalifa via the BUILD SCENE button (each viewport),
 * and verifies: scene built, evidence streamed (time to first card / full),
 * source-status incl. credentials-required, geo + freshness filters, embed
 * playback (iframe loaded + YouTube currentTime advancing when possible),
 * profile popup, error state (forced 503 via request interception), saved scene
 * reopens from cache (no /scene/evidence request), mobile layout hit-tests.
 *
 * Usage: node scripts/qa-scene-evidence.mjs --url https://sb-….vercel.run
 *          [--viewports 1440x900,375x739] [--record out.webm] [--out dir] [--label after]
 * Supervision: worker in its own process group; Chromium + screencast inherit
 * it; the supervisor SIGKILLs the group on exit / signal / hard cap (16 min).
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utc = () => new Date().toISOString();
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const killGroup = (pid) => { if (pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch {} };
const cleanEnv = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

const CASES = [
  { id: 'marina', text: 'Dubai Marina', submit: 'enter', near: [25.0786, 55.1353] },
  { id: 'burj', text: 'Burj Khalifa', submit: 'button', near: [25.1972, 55.2744] },
];

async function worker(cfg) {
  const { default: puppeteer } = await import('puppeteer');
  const report = { startedUtc: utc(), url: cfg.url, host: 'MIRRORED chat-canvas harness (not the real OnDemand host)', runs: [], passed: 0, failed: 0, failures: [] };
  const save = () => fs.writeFile(cfg.report, JSON.stringify(report, null, 2));
  const check = (run, name, ok, detail) => {
    run.checks.push({ utc: utc(), name, ok: Boolean(ok), detail });
    if (ok) report.passed += 1; else { report.failed += 1; report.failures.push(`${run.id}: ${name} — ${JSON.stringify(detail).slice(0, 300)}`); }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${run.id} ${name} ${JSON.stringify(detail).slice(0, 220)}`);
    return ok;
  };
  const harnessHtml = await fs.readFile(path.join(REPO, 'public/embed-canvas-harness.html'), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(harnessHtml); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hostOrigin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true, env: cleanEnv(), protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  process.send?.({ browserPid: browser.process()?.pid });
  try {
    for (const vp of cfg.viewports) {
      const [width, height] = vp.split('x').map(Number);
      const mobile = width < 600;
      const run = { id: vp, checks: [], pageErrors: [], evidenceRequests: [], screenshots: [], timings: {} };
      report.runs.push(run);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      page.on('pageerror', (e) => run.pageErrors.push(String(e.message).slice(0, 300)));
      page.on('request', (r) => { try { const u = new URL(r.url()); if (u.pathname.endsWith('/scene/evidence')) run.evidenceRequests.push({ utc: utc(), method: r.method() }); } catch {} });
      let recorder = null;
      if (cfg.record && vp === cfg.viewports[0]) recorder = await page.screencast({ path: cfg.record, fps: 10, quality: 30 });
      const src = `${cfg.url.replace(/\/$/, '')}/?welcome=0`;
      await page.goto(`${hostOrigin}/?src=${encodeURIComponent(src)}&allow=restrictive`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      let frame = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(cfg.url.replace(/\/$/, '')));
        if (frame && (await frame.$('#incident-composer-input').catch(() => null)) && (await frame.$('#scene-evidence').catch(() => null))) break;
        await sleep(1500);
      }
      if (!check(run, 'app+evidence panel mounted in cross-origin iframe', frame && (await frame.$('#scene-evidence')), { waitedMs: Date.now() - t0, frameOrigin: frame && new URL(frame.url()).origin, hostOrigin })) { await ctx.close(); continue; }
      await sleep(cfg.settleMs);
      const shot = async (name) => {
        await frame.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) { v.scene.requestRender(); } }).catch(() => {});
        const file = path.join(cfg.out, `${cfg.label}-evidence-${name}-${vp}.png`);
        await page.screenshot({ path: file }); run.screenshots.push(path.basename(file)); return file;
      };
      const hit = (sel) => frame.evaluate((s) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const top = document.elementFromPoint(x, y); return { ok: top === n || n.contains(top), inViewport: b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], top: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 30)}` : null }; }, sel);
      const ev = () => frame.evaluate(() => window.__gevSceneEvidence?.getState?.() || null);
      const cam = () => frame.evaluate(() => { const c = window.__godsEyeView?.viewer?.camera?.positionCartographic; return c ? { lat: +(c.latitude * 180 / Math.PI).toFixed(4), lon: +(c.longitude * 180 / Math.PI).toFixed(4), h: Math.round(c.height) } : null; });
      check(run, 'idle: AOI input hit-testable', (await hit('#incident-composer-input'))?.ok, await hit('#incident-composer-input'));
      check(run, 'idle: BUILD SCENE hit-testable', (await hit('#incident-composer-submit'))?.ok, await hit('#incident-composer-submit'));
      await shot('idle');

      // Measurement mode: every primary BUILD SCENE must stream from the sources,
      // so the harness (a) clears the browser scene cache and (b) adds fresh=1 to
      // the evidence POST (server cache bypass). Cache reuse is verified separately.
      await page.setRequestInterception(true);
      const freshify = (r) => {
        if (r.isInterceptResolutionHandled?.()) return;
        if (r.url().includes('/scene/evidence') && r.method() === 'POST') {
          try { const b = JSON.parse(r.postData() || '{}'); b.fresh = '1'; r.continue({ postData: JSON.stringify(b) }); return; } catch {}
        }
        r.continue();
      };
      page.on('request', freshify);
      // Enter vs button alternate per viewport so BOTH places are exercised with BOTH methods.
      const cases = mobile ? CASES.map((c) => ({ ...c, submit: c.submit === 'enter' ? 'button' : 'enter' })) : CASES;
      for (const tc of cases) {
        await frame.evaluate(() => { try { localStorage.removeItem('gev.sceneEvidence.v1'); } catch {} });
        const input = await frame.$('#incident-composer-input');
        if (mobile) await input.tap(); else await input.click({ clickCount: 3 });
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(tc.text, { delay: 20 });
        const reqBefore = run.evidenceRequests.length;
        const tSubmit = Date.now();
        if (tc.submit === 'enter') await page.keyboard.press('Enter');
        else { const btn = await frame.$('#incident-composer-submit'); if (mobile) await btn.tap(); else await btn.click(); }
        let firstCardMs = null, partialSeen = false, s = null, partialShot = false;
        // Wait for THIS submit's evidence request (the previous case's panel is still 'done').
        while (Date.now() - tSubmit < 60000 && run.evidenceRequests.length === reqBefore) await sleep(250);
        while (Date.now() - tSubmit < 100000) {
          s = await ev();
          if (s?.items > 0 && firstCardMs === null) firstCardMs = Date.now() - tSubmit;
          if (s?.phase === 'streaming' && s.items > 0) {
            partialSeen = true;
            if (!partialShot) { partialShot = true; await shot(`${tc.id}-streaming`); }
          }
          if (['done', 'cached', 'error', 'timeout'].includes(s?.phase)) break;
          await sleep(400);
        }
        const fullMs = Date.now() - tSubmit;
        for (let k = 0; k < 40; k += 1) { const st = await frame.evaluate(() => document.querySelector('#incident-composer')?.getAttribute('data-state')); if (st !== 'busy') break; await sleep(500); }
        await sleep(2500);
        const composer = await frame.evaluate(() => ({ state: document.querySelector('#incident-composer')?.getAttribute('data-state'), play: Boolean(document.querySelector('#incident-composer-play')), result: document.querySelector('#incident-composer-result')?.innerText?.slice(0, 160) }));
        run.timings[tc.id] = { submit: tc.submit, firstCardMs, fullMs, clientFirstCardMs: s?.client?.firstCardMs, clientDoneMs: s?.client?.doneMs, serverTimings: s?.timings, engine: s?.engine, items: s?.items, signals: s?.signals, byFreshness: s?.byFreshness, byGeo: s?.byGeo };
        check(run, `${tc.id}: native ${tc.submit} submit triggered an evidence request`, run.evidenceRequests.length > reqBefore, { requests: run.evidenceRequests.length - reqBefore });
        check(run, `${tc.id}: scene built (Play available)`, composer.play && composer.state === 'done', composer);
        const c = await cam();
        const dist = c ? Math.hypot(c.lat - tc.near[0], c.lon - tc.near[1]) : 99;
        check(run, `${tc.id}: camera at AOI (<0.08 deg)`, dist < 0.08, { camera: c, distDeg: +dist.toFixed(4) });
        check(run, `${tc.id}: evidence completed end-to-end`, s?.phase === 'done' && s.items > 0, { phase: s?.phase, items: s?.items, signals: s?.signals });
        check(run, `${tc.id}: partial results streamed before completion`, partialSeen && firstCardMs !== null && firstCardMs < fullMs, { firstCardMs, fullMs });
        const cred = (s?.sources || []).filter((x) => x.state === 'credentials_required').map((x) => x.id);
        check(run, `${tc.id}: credentials-required sources listed (no fake data)`, cred.length >= 4, cred);
        const labels = await frame.evaluate(() => [...document.querySelectorAll('#scene-evidence .sev-card')].slice(0, 30).map((c) => ({ f: c.dataset.freshness, g: c.dataset.geo, fb: c.querySelector('[data-freshness-badge]')?.textContent, gb: c.querySelector('[data-geo-badge]')?.textContent, orig: c.querySelector('.sev-card__orig')?.getAttribute('href') })));
        check(run, `${tc.id}: every card has freshness + geo label + original link; approximate never shown as exact`, labels.length > 0 && labels.every((l) => l.fb && l.gb && /^https:\/\//.test(l.orig || '') && (l.g === 'exact' ? !l.gb.startsWith('~') : l.gb.startsWith('~'))), labels.slice(0, 3));
        await shot(`${tc.id}-built`);
      }

      page.off('request', freshify);
      await page.setRequestInterception(false);
      // ---- filters (on the Burj result)
      const total = (await ev()).items;
      const fBtn = await frame.$('#scene-evidence [data-filter-kind="freshness"][data-filter-value="ARCHIVAL"]');
      await frame.evaluate(() => document.querySelector('#scene-evidence [data-filter-value="ARCHIVAL"]')?.scrollIntoView({ block: 'center' }));
      if (mobile) await fBtn.tap(); else await fBtn.click();
      await sleep(400);
      const afterF = await frame.evaluate(() => [...document.querySelectorAll('#scene-evidence .sev-card')].map((c) => c.dataset.freshness));
      check(run, 'freshness filter (ARCHIVAL) narrows the rail', afterF.length > 0 && afterF.length <= total && afterF.every((f) => f === 'ARCHIVAL'), { total, shown: afterF.length });
      if (mobile) await fBtn.tap(); else await fBtn.click();
      const gBtn = await frame.$('#scene-evidence [data-filter-kind="precisions"][data-filter-value="exact"]');
      if (mobile) await gBtn.tap(); else await gBtn.click();
      await sleep(400);
      const afterG = await frame.evaluate(() => ({ cards: document.querySelectorAll('#scene-evidence .sev-card').length, status: document.querySelector('#scene-evidence-status')?.textContent }));
      check(run, 'geo filter (EXACT) applies — 0 exact geotags with current sources, shown honestly', afterG.cards === 0 && /0\/\d+/.test(afterG.status), afterG);
      await shot('filter-exact');
      if (mobile) await gBtn.tap(); else await gBtn.click();
      await sleep(300);

      // ---- card click → embed + map pin sync; prefer a YouTube card for currentTime proof
      const pick = await frame.evaluate(() => { const c = document.querySelector('#scene-evidence .sev-card[data-platform="youtube"]') || document.querySelector('#scene-evidence .sev-card'); c?.scrollIntoView({ block: 'center' }); return c?.dataset.evidenceId; });
      const playBtn = await frame.$(`#scene-evidence .sev-card[data-evidence-id="${pick}"] .sev-card__play`);
      if (mobile) await playBtn.tap(); else await playBtn.click();
      let embed = null;
      const te = Date.now();
      while (Date.now() - te < 25000) {
        embed = await frame.evaluate(() => { const p = document.querySelector('#scene-evidence-player'); const f = p?.querySelector('iframe'); return { loaded: p?.dataset.embedLoaded, id: p?.dataset.evidenceId, platform: p?.dataset.platform, src: f?.getAttribute('src'), lazy: f?.getAttribute('loading'), t: p?.dataset.currentTime, state: p?.dataset.playerState, selected: window.__gevSceneEvidence?.getState()?.selectedId }; });
        if (embed.loaded === 'true' && (embed.platform !== 'youtube' || Number(embed.t) > 1.5)) break;
        await sleep(1000);
      }
      const t1 = Number(embed?.t);
      await sleep(3000);
      const t2 = Number(await frame.evaluate(() => document.querySelector('#scene-evidence-player')?.dataset.currentTime));
      check(run, 'card click → selected card + lazy official embed loaded in player', embed?.loaded === 'true' && embed.id === pick && embed.selected === pick && embed.lazy === 'lazy', embed);
      // Inspect the official embed frames themselves (Puppeteer can read cross-origin frames).
      const embedFrameState = async (host) => {
        const f = page.frames().find((x) => x.url().includes(host));
        if (!f) return { found: false };
        return f.evaluate(() => { const v = document.querySelector('video'); return { found: true, text: document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 120), video: v ? { readyState: v.readyState, t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted } : null }; }).catch((e) => ({ found: true, error: String(e.message).slice(0, 80) }));
      };
      if (embed?.platform === 'youtube') {
        const yf = await embedFrameState('youtube-nocookie.com/embed');
        run.youtubeEmbed = { t1, t2, playerState: embed.state, frame: yf };
        check(run, 'YouTube embed: player frame loaded (currentTime via IFrame API reported separately)', yf.found && !/Error 15\d/.test(yf.text || ''), run.youtubeEmbed);
      }
      // TikTok Embed Player: muted autoplay → readyState + currentTime advancing.
      const tt = await frame.evaluate(() => { const c = document.querySelector('#scene-evidence .sev-card[data-platform="tiktok"]'); c?.scrollIntoView({ block: 'center' }); return c?.dataset.evidenceId; });
      if (tt) {
        const ttBtn = await frame.$(`#scene-evidence .sev-card[data-evidence-id="${tt}"] .sev-card__play`);
        if (mobile) await ttBtn.tap(); else await ttBtn.click();
        await sleep(9000);
        const a = await embedFrameState('tiktok.com/player/v1');
        await sleep(3000);
        const b2 = await embedFrameState('tiktok.com/player/v1');
        run.tiktokPlayback = { id: tt, a, b: b2 };
        check(run, 'TikTok embed playback: video readyState>=2 and currentTime advancing', a.video && b2.video && b2.video.readyState >= 2 && b2.video.t > a.video.t, run.tiktokPlayback);
        await shot('playing-tiktok');
        // back to the first-picked card for the pin/profile checks below
        await frame.evaluate((id) => window.__gevSceneEvidence.panel.select(id), pick);
        await sleep(800);
      }
      const pinSel = await frame.evaluate((id) => { const v = window.__godsEyeView?.viewer; const ds = v?.dataSources; let found = null; for (let i = 0; i < (ds?.length || 0); i++) { const d = ds.get(i); if (d.name === 'scene-evidence-pins') { const e = d.entities.getById(`sev-${id}`); found = { pins: d.entities.values.length, selectedPinSize: e?.point?.pixelSize?.getValue?.() }; } } const tl = document.querySelector(`#scene-evidence-timeline [data-evidence-id="${CSS.escape(id)}"]`); return { ...found, timelineSelected: tl?.dataset.selected || 'undated' }; }, pick);
      check(run, 'map pin + timeline synced to the selected card', pinSel?.pins > 0 && pinSel.selectedPinSize === 15 && (pinSel.timelineSelected === 'true' || pinSel.timelineSelected === 'undated'), pinSel);
      await shot('playing');

      // ---- profile popup
      await frame.evaluate((id) => document.querySelector(`#scene-evidence .sev-card[data-evidence-id="${id}"]`)?.scrollIntoView({ block: 'center' }), pick);
      const profBtn = await frame.$(`#scene-evidence .sev-card[data-evidence-id="${pick}"] .sev-card__profile`);
      if (mobile) await profBtn.tap(); else await profBtn.click();
      await sleep(500);
      const prof = await frame.evaluate(() => { const p = document.querySelector('#scene-evidence-profile'); return { open: p && !p.hidden, name: p?.querySelector('.sev__profile-name')?.textContent, link: p?.querySelector('.sev__profile-link')?.getAttribute('href'), note: p?.querySelector('.sev__profile-note')?.textContent?.slice(0, 160) }; });
      check(run, 'profile popup opens with public fields + profile link + field provenance', prof.open && prof.name && /Fields shown/.test(prof.note || ''), prof);
      await shot('profile');
      await frame.evaluate(() => document.querySelector('#scene-evidence-profile .sev__profile-close')?.click());

      // ---- save the Burj scene, reopen from cache (no evidence request)
      const nameInput = await frame.$('#scene-library-name');
      const saveBtn = await frame.$('#scene-library-save');
      let reopened = { skipped: true };
      if (nameInput && saveBtn) {
        await frame.evaluate(() => { document.querySelector('#sidebar-scenes-tab')?.click(); document.querySelector('#scene-library-save')?.scrollIntoView({ block: 'center' }); });
        await sleep(500);
        await frame.evaluate(() => document.querySelector('#scene-library-save')?.click());
        await sleep(1200);
        // switch to another evidence view, then reopen the saved scene from the library
        await frame.evaluate(() => window.__gevSceneEvidence.panel.close());
        const reqBefore = run.evidenceRequests.length;
        reopened = await frame.evaluate(async () => {
          const sel = document.querySelector('#scene-library-saved');
          const opt = [...(sel?.options || [])].find((o) => /burj/i.test(o.textContent));
          if (!opt) return { ok: false, options: [...(sel?.options || [])].map((o) => o.textContent) };
          sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 2500));
          const s = window.__gevSceneEvidence.getState();
          return { ok: true, option: opt.textContent, phase: s.phase, items: s.items, status: document.querySelector('#scene-evidence-status')?.textContent?.slice(0, 120) };
        });
        reopened.newEvidenceRequests = run.evidenceRequests.length - reqBefore;
      }
      check(run, 'saved scene reopens evidence from cache with no provider request', reopened.ok && reopened.phase === 'cached' && reopened.items > 0 && reopened.newEvidenceRequests === 0, reopened);
      await shot('reopened-cache');

      // ---- error state: force the next evidence request to 503 (request interception)
      await page.setRequestInterception(true);
      const onReq = (r) => { if (r.url().includes('/scene/evidence') && r.method() === 'POST') r.respond({ status: 503, contentType: 'application/json', body: '{"error":"ondemand_not_configured"}' }); else r.continue(); };
      page.on('request', onReq);
      await frame.evaluate(() => document.querySelector('#scene-evidence-rebuild')?.click());
      await sleep(2500);
      const err = await frame.evaluate(() => ({ phase: window.__gevSceneEvidence.getState().phase, status: document.querySelector('#scene-evidence-status')?.textContent }));
      check(run, 'error state rendered (forced HTTP 503) with retry guidance, no fabricated items', err.phase === 'error' && /HTTP 503/.test(err.status) && /REBUILD/.test(err.status), err);
      await shot('error');
      page.off('request', onReq);
      await page.setRequestInterception(false);

      // ---- REBUILD (fresh) → diff against cache
      await frame.evaluate(() => document.querySelector('#scene-evidence-rebuild')?.click());
      let rb = null;
      const tr = Date.now();
      while (Date.now() - tr < 75000) { rb = await frame.evaluate(() => ({ s: window.__gevSceneEvidence.getState(), diff: document.querySelector('#scene-evidence-diff')?.textContent })); if (['done', 'error', 'timeout'].includes(rb.s.phase)) break; await sleep(800); }
      check(run, 'REBUILD fetches fresh and shows a diff against the cached scene', rb.s.phase === 'done' && /Rebuilt vs cache/.test(rb.diff || ''), { phase: rb.s.phase, diff: rb.diff });
      await shot('rebuild-diff');

      // ---- mobile layout
      if (mobile) {
        const inp = await hit('#incident-composer-input');
        const sub = await hit('#incident-composer-submit');
        const panelBox = await frame.evaluate(() => { const b = document.querySelector('#scene-evidence').getBoundingClientRect(); const c = document.querySelector('#incident-composer').getBoundingClientRect(); return { panelBottom: Math.round(b.bottom), composerTop: Math.round(c.top), panelWidth: Math.round(b.width), vw: innerWidth }; });
        check(run, 'mobile: evidence panel does not overlap the AOI composer; AOI input + BUILD SCENE still hit-testable', inp?.ok && sub?.ok && panelBox.panelBottom <= panelBox.composerTop && panelBox.panelWidth <= panelBox.vw, { inp, sub, ...panelBox });
      }
      check(run, 'no uncaught page errors', run.pageErrors.length === 0, run.pageErrors.slice(0, 3));
      if (recorder) await recorder.stop();
      await save();
      await ctx.close();
    }
  } finally {
    report.endedUtc = utc();
    await save();
    await browser.close().catch(() => {});
    server.close();
  }
}

if (process.argv[2] === '--worker') {
  await worker(JSON.parse(process.argv[3]));
  process.exit(0);
} else {
  const url = arg('url');
  if (!url) { console.error('--url is required'); process.exit(2); }
  const label = arg('label', 'after');
  const cfg = {
    url, label,
    viewports: arg('viewports', '1440x900,375x739').split(','),
    record: arg('record', null),
    settleMs: Number(arg('settle-ms', 5000)),
    out: arg('out', path.join(path.resolve(REPO, '..'), '.ui-proof')),
    report: arg('report', `/tmp/qa-scene-evidence-${label}.json`),
  };
  await fs.mkdir(cfg.out, { recursive: true });
  let child, browserPid;
  const cleanup = () => { killGroup(browserPid); killGroup(child?.pid); };
  process.on('exit', cleanup);
  const cap = setTimeout(() => { console.error('hard cap reached'); cleanup(); process.exit(124); }, Number(arg('max-ms', 960000)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); process.exit(124); });
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify(cfg)], { cwd: REPO, detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: cleanEnv() });
    child.on('message', (m) => { if (m.browserPid) browserPid = m.browserPid; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    const result = JSON.parse(await fs.readFile(cfg.report, 'utf8'));
    console.log(JSON.stringify({ report: cfg.report, passed: result.passed, failed: result.failed, failures: result.failures, workerExitCode: code }, null, 2));
    process.exitCode = result.failed || code ? 1 : 0;
  } finally { clearTimeout(cap); cleanup(); }
}
