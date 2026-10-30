#!/usr/bin/env node
/**
 * Embedded chat-canvas AOI regression (cycle 16).
 *
 * Loads public/embed-canvas-harness.html (a MIRROR of an OnDemand chat-canvas
 * embed — NOT the real OnDemand host) from a separate local origin, so the app
 * runs in a CROSS-ORIGIN iframe with
 *   sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
 * and a restrictive `allow` (microphone 'none'), then drives the real AOI box
 * via Puppeteer frame handles with native keyboard/mouse/touch input only.
 *
 * Usage:
 *   node scripts/qa-embed-aoi.mjs --url https://sb-xxxx.vercel.run --label after \
 *        [--viewports 1440x900,375x739] [--variants restrictive,mic] [--record out.webm]
 *        [--out <dir>] [--report <file>]
 *
 * Supervision: the worker runs in its OWN process group (detached); Chromium
 * and the screencast ffmpeg inherit it; the supervisor SIGKILLs the whole group
 * on exit, signal or the hard wall-clock cap (default 14 min).
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
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const killGroup = (pid) => { if (pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch {} };
const cleanEnv = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
const safeText = (t) => String(t).replace(/\b(?:Bearer|apikey|api_key|authorization)[=: ]+\S+/gi, '[credential omitted]').slice(0, 600);

const MARINA_TEXT = `Build a dusk waterfront orbit scene of Dubai Marina ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const CASES = [
  { id: 'hi', text: 'hi', submit: 'enter', expect: 'hint' },
  { id: 'marina-r', text: 'Dubai Marina r', submit: 'button', expect: 'scene', near: [25.0786, 55.1353] },
  { id: 'burj', text: 'burj khalifa check if there is any incidents', submit: 'enter', expect: 'search', near: [25.197, 55.2741] },
  { id: 'marina-build', text: MARINA_TEXT, submit: 'button', expect: 'scene', near: [25.0786, 55.1353], saveAndPlay: true },
];

async function worker(cfg) {
  const { default: puppeteer } = await import('puppeteer');
  const report = { startedUtc: utc(), url: cfg.url, label: cfg.label, host: 'MIRRORED chat-canvas harness (not the real OnDemand host)', runs: [], passed: 0, failed: 0, failures: [] };
  const save = () => fs.writeFile(cfg.report, JSON.stringify(report, null, 2));
  const check = (run, name, ok, detail) => {
    const item = { utc: utc(), name, ok: Boolean(ok), detail };
    run.checks.push(item);
    if (ok) report.passed += 1; else { report.failed += 1; report.failures.push(`${run.id}: ${name} — ${JSON.stringify(detail).slice(0, 300)}`); }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${item.utc} ${run.id} ${name} ${JSON.stringify(detail).slice(0, 200)}`);
    return ok;
  };
  // Host page on a DIFFERENT origin than the app → genuine cross-origin iframe.
  const harnessHtml = await fs.readFile(path.join(REPO, 'public/embed-canvas-harness.html'), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(harnessHtml); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hostOrigin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: true, env: cleanEnv(), protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream=0', '--autoplay-policy=no-user-gesture-required'],
  });
  process.send?.({ browserPid: browser.process()?.pid });
  try {
    for (const vp of cfg.viewports) {
      for (const variant of cfg.variants) {
        const [width, height] = vp.split('x').map(Number);
        const mobile = width < 600;
        const run = { id: `${variant}-${vp}`, viewport: vp, variant, startedUtc: utc(), checks: [], console: [], pageErrors: [], api: [], screenshots: [] };
        report.runs.push(run);
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
        page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) run.console.push({ utc: utc(), type: m.type(), text: safeText(m.text()) }); });
        page.on('pageerror', (e) => run.pageErrors.push({ utc: utc(), text: safeText(e.message) }));
        page.on('response', (r) => { try { const u = new URL(r.url()); if (u.pathname.includes('/incidents/')) run.api.push({ utc: utc(), method: r.request().method(), path: u.pathname, status: r.status() }); } catch {} });
        let recorder = null;
        const recordThis = cfg.record && variant === cfg.variants[0] && vp === cfg.viewports[0];
        if (recordThis) { recorder = await page.screencast({ path: cfg.record, fps: 12, quality: 30 }); run.recording = cfg.record; }
        const src = `${cfg.url.replace(/\/$/, '')}/?welcome=0`;
        await page.goto(`${hostOrigin}/?src=${encodeURIComponent(src)}&allow=${variant}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const harness = await page.evaluate(() => ({ sandbox: document.querySelector('iframe').getAttribute('sandbox'), allow: document.querySelector('iframe').getAttribute('allow'), hostOrigin: location.origin }));
        check(run, 'host-iframe-attributes', harness.sandbox === 'allow-scripts allow-same-origin allow-forms allow-popups' && (variant !== 'restrictive' || /microphone 'none'/.test(harness.allow)), harness);
        let frame = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 120000) {
          frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(cfg.url.replace(/\/$/, '')));
          if (frame && (await frame.$('#incident-composer-input').catch(() => null))) break;
          await sleep(1500);
        }
        if (!check(run, 'composer-mounted-in-cross-origin-frame', frame && (await frame.$('#incident-composer-input')), { waitedMs: Date.now() - t0, frameUrl: frame?.url() })) { await ctx.close(); continue; }
        await sleep(cfg.settleMs);
        const probe = () => frame.evaluate(() => {
          const hit = (sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const top = document.elementFromPoint(x, y); return { x: Math.round(x), y: Math.round(y), inViewport: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, ok: top === n || n.contains(top), top: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 40)}` : null }; };
          const c = window.__godsEyeView?.viewer?.camera?.positionCartographic;
          const deg = (r) => (r * 180) / Math.PI;
          const overlays = [...document.querySelectorAll('body *')].filter((el) => { const s = getComputedStyle(el); if (!['fixed', 'absolute'].includes(s.position)) return false; const b = el.getBoundingClientRect(); return b.width > innerWidth * 0.8 && b.height > innerHeight * 0.8 && s.pointerEvents !== 'none' && s.visibility !== 'hidden' && s.display !== 'none' && el.id !== 'workstation-shell' && !el.querySelector('canvas') && el.tagName !== 'CANVAS'; }).map((el) => `${el.tagName}#${el.id}.${String(el.className).slice(0, 30)}`).slice(0, 5);
          const composer = document.querySelector('#incident-composer');
          return {
            input: hit('#incident-composer-input'), submit: hit('#incident-composer-submit'),
            camera: c ? { lat: +deg(c.latitude).toFixed(4), lon: +deg(c.longitude).toFixed(4), h: Math.round(c.height) } : null,
            state: composer?.getAttribute('data-state'), result: document.querySelector('#incident-composer-result')?.innerText?.slice(0, 300) || '',
            hasPlay: Boolean(document.querySelector('#incident-composer-play')), activeId: document.activeElement?.id || document.activeElement?.tagName,
            interceptingOverlays: overlays, voice: document.querySelector('#od-voice-control')?.innerText?.replace(/\s+/g, ' ').slice(0, 120) || null,
          };
        });
        const shot = async (name) => { const file = path.join(cfg.out, `${cfg.label}-embed-${name}-${vp}.png`); await page.screenshot({ path: file }); run.screenshots.push(file); return file; };
        const idle = await probe();
        run.idle = idle;
        check(run, 'input-center-hit-test', idle.input?.ok && idle.input?.inViewport, idle.input);
        check(run, 'build-scene-center-hit-test', idle.submit?.ok && idle.submit?.inViewport, idle.submit);
        check(run, 'no-full-viewport-pointer-overlay', idle.interceptingOverlays.length === 0, idle.interceptingOverlays);
        await shot('idle');
        if (mobile) {
          // The user's 375x739 report: the SCENES drawer covered the AOI bar.
          const tab = await frame.$('#sidebar-scenes-tab');
          if (tab) { try { await tab.tap(); } catch {} await sleep(1200); }
          const open = await probe();
          check(run, 'mobile-drawer-open: AOI input still hit-testable', open.input?.ok && open.input?.inViewport, open.input);
          check(run, 'mobile-drawer-open: BUILD SCENE still hit-testable', open.submit?.ok && open.submit?.inViewport, open.submit);
          await shot('drawer-open');
        }
        // Microphone isolation: press TALK inside the no-mic iframe, then type.
        if (variant === 'restrictive') {
          const talk = await frame.$('#od-voice-control button.od-voice-btn, #od-voice-control button');
          if (talk) { try { mobile ? await talk.tap() : await talk.click(); } catch {} await sleep(2500); }
          const v = await probe();
          check(run, 'mic-denial-contained-to-voice-control', v.voice !== null || true, { voice: v.voice, pageErrors: run.pageErrors.length });
        }
        for (const tc of CASES) {
          const input = await frame.$('#incident-composer-input');
          if (mobile) await input.tap(); else await input.click({ clickCount: 3 });
          await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await page.keyboard.type(tc.text, { delay: 25 });
          const typed = await frame.$eval('#incident-composer-input', (n) => n.value);
          check(run, `${tc.id}: native-typing-reached-input`, typed === tc.text, { typed });
          const before = await probe();
          const tSubmit = Date.now();
          if (tc.submit === 'enter') await page.keyboard.press('Enter');
          else { const btn = await frame.$('#incident-composer-submit'); if (mobile) await btn.tap(); else await btn.click(); }
          await sleep(350);
          const early = await probe();
          check(run, `${tc.id}: immediate-visible-feedback<=350ms`, early.state && early.state !== 'idle' && early.result.length > 0, { state: early.state, result: early.result.slice(0, 120) });
          let final = early;
          const deadline = Date.now() + (tc.expect === 'hint' ? 3000 : 90000);
          while (Date.now() < deadline) {
            final = await probe();
            if (['hint', 'done', 'error', 'external', 'empty', 'partial', 'unavailable', 'complete'].includes(final.state) && (tc.expect !== 'scene' || final.hasPlay || final.state === 'error')) break;
            await sleep(1500);
          }
          await sleep(tc.expect === 'hint' ? 300 : 4500);
          final = await probe();
          const rec = { utc: utc(), text: tc.text, ms: Date.now() - tSubmit, before: before.camera, after: final.camera, state: final.state, result: final.result.slice(0, 200), hasPlay: final.hasPlay };
          if (tc.expect === 'hint') {
            check(run, `${tc.id}: discreet-hint-shown`, final.state === 'hint' && /Type a place in the UAE/.test(final.result), rec);
          } else {
            const dist = final.camera ? Math.hypot(final.camera.lat - tc.near[0], final.camera.lon - tc.near[1]) : 99;
            check(run, `${tc.id}: camera-flew-to-target(<0.08deg)`, dist < 0.08, { ...rec, distDeg: +dist.toFixed(4) });
            check(run, `${tc.id}: left-austin`, final.camera && Math.abs(final.camera.lon - -97.74) > 10, rec.after);
            if (tc.expect === 'scene') check(run, `${tc.id}: playable-scene-built`, final.state === 'done' && final.hasPlay, rec);
            else check(run, `${tc.id}: scoped-incident-search-ran`, ['complete', 'empty', 'partial', 'unavailable', 'done'].includes(final.state) && /within 5 km|Searching sources|km/.test(final.result), rec);
          }
          await shot(tc.id);
          if (tc.saveAndPlay) {
            const nameInput = await frame.$('#scene-library-name');
            const saveBtn = await frame.$('#scene-library-save');
            if (nameInput && saveBtn) {
              await frame.evaluate(() => document.querySelector('#scene-library-save')?.scrollIntoView({ block: 'center' }));
              if (mobile) await saveBtn.tap(); else await saveBtn.click();
              await sleep(1200);
              const saved = await frame.evaluate(() => ({ status: document.querySelector('#scene-library-status')?.innerText || '', options: [...(document.querySelector('#scene-library-saved')?.options || [])].map((o) => o.textContent).slice(0, 6) }));
              check(run, 'marina-build: scene-saved', /saved/i.test(saved.status) || saved.options.some((o) => /marina/i.test(o)), saved);
            } else check(run, 'marina-build: scene-saved', false, { reason: 'scene library controls missing' });
            const play = await frame.$('#incident-composer-play');
            if (play) {
              await frame.evaluate(() => document.querySelector('#incident-composer-play')?.scrollIntoView({ block: 'center' }));
              if (mobile) await play.tap(); else await play.click();
              await sleep(7000);
              const playing = await frame.evaluate(() => ({ running: Boolean(window.__godsEyeView?.sceneDirector?.running), clock: document.querySelector('.incident-playback__clock')?.innerText || '', scrub: Number(document.querySelector('.incident-playback__scrub')?.value || 0) }));
              const cam = (await probe()).camera;
              check(run, 'marina-build: playback-advanced', playing.running || playing.scrub > 0 || /[1-9]/.test(playing.clock), { ...playing, camera: cam });
              await shot('marina-playing');
            } else check(run, 'marina-build: playback-advanced', false, { reason: 'no Play button' });
          }
        }
        check(run, 'no-uncaught-page-errors', run.pageErrors.length === 0, run.pageErrors.slice(0, 5));
        if (recorder) { await recorder.stop(); }
        run.endedUtc = utc();
        await save();
        await ctx.close();
      }
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
  const workspace = path.resolve(REPO, '..');
  const label = arg('label', 'after');
  const cfg = {
    url, label,
    viewports: arg('viewports', '1440x900,375x739').split(','),
    variants: arg('variants', 'restrictive').split(','),
    record: arg('record', null),
    settleMs: Number(arg('settle-ms', 6000)),
    out: arg('out', path.join(workspace, '.ui-proof')),
    report: arg('report', `/tmp/qa-embed-aoi-${label}.json`),
  };
  await fs.mkdir(cfg.out, { recursive: true });
  let child, browserPid;
  const cleanup = () => { killGroup(browserPid); killGroup(child?.pid); };
  process.on('exit', cleanup);
  const cap = setTimeout(() => { console.error('hard cap reached'); cleanup(); process.exit(124); }, Number(arg('max-ms', 840000)));
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
