/** Exact AOI control regression: native input only; read-only rendering diagnostics.
 * Usage: node scripts/qa-aoi-rebuild.mjs --url https://sb-....vercel.run
 * Chromium and ffmpeg are supervised in process groups with a 9 minute cap.
 * The only intercepted request is the separately labelled HTTP-503 fault test.
 */
import puppeteer from 'puppeteer';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const utc = () => new Date().toISOString();
const exec = promisify(execFile);
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[URL omitted]'; } };
const safeText = text => String(text).replace(/https?:\/\/[^\s"<>]+/g, safeUrl).replace(/\b(?:Bearer|apikey|api_key|authorization)[=: ]+\S+/gi, '[credential omitted]').slice(0, 1800);
function killGroup(pid) { if (pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch {} }
function assert(ok, message) { if (!ok) throw new Error(message); }
const cleanEnv = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'XDG_RUNTIME_DIR'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));

async function worker(config) {
  const report = { startedUtc: utc(), url: config.url, environment: 'direct live preview, not the user embedded host', assertions: [], runs: [], failures: [] };
  let browser, browserPid;
  const save = async () => fs.writeFile(config.report, JSON.stringify(report, null, 2));
  const cleanup = () => killGroup(browserPid);
  process.on('exit', cleanup);
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, env: cleanEnv(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 120000 });
    browserPid = browser.process()?.pid;
    process.send?.({ browserPid });
    for (const [width, height] of [[1440, 900], [375, 739]]) {
      const vp = `${width}x${height}`;
      const run = { viewport: vp, startedUtc: utc(), network: [], console: [], pageErrors: [], actions: [], recording: null };
      report.runs.push(run);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
      await page.evaluateOnNewDocument(() => {
        window.__aoiNativeEvents = [];
        for (const type of ['focus', 'blur', 'pointerdown', 'click', 'keydown', 'beforeinput', 'input', 'submit']) {
          document.addEventListener(type, e => {
            if (e.target?.closest?.('#incident-composer')) window.__aoiNativeEvents.push({ utc: new Date().toISOString(), type, trusted: e.isTrusted, id: e.target.id, key: e.key, inputType: e.inputType, value: e.target.value, active: document.activeElement?.id });
          }, true);
        }
      });
      page.on('pageerror', e => run.pageErrors.push({ utc: utc(), error: safeText(e.message) }));
      page.on('console', m => { if (['error', 'warn'].includes(m.type())) run.console.push({ utc: utc(), type: m.type(), text: safeText(m.text()) }); });
      page.on('requestfailed', r => run.network.push({ utc: utc(), kind: 'failed', url: safeUrl(r.url()), error: r.failure()?.errorText }));
      page.on('response', async r => {
        const u = new URL(r.url());
        if (u.origin === new URL(config.url).origin && u.pathname.startsWith('/api/')) {
          const item = { utc: utc(), kind: 'response', path: u.pathname, method: r.request().method(), status: r.status() };
          run.network.push(item);
          if (/incidents\/(locate|search)/.test(u.pathname)) {
            try {
              const body = JSON.parse(r.request().postData() || '{}');
              item.request = { text: body.text };
              const response = await r.json();
              item.response = response;
            } catch {}
          }
        }
      });
      const screenshot = async label => {
        const file = path.join(config.out, `aoi-after-${config.mapProof ? 'clear-map' : 'verified'}-${label}-${vp}.png`);
        await page.screenshot({ path: file, type: 'png', fullPage: false });
        return file;
      };
      const sample = async () => page.evaluate(() => {
        const api = window.__gevIncidents, s = api?.composer?.state, v = window.__godsEyeView?.viewer, d = window.__godsEyeView?.sceneDirector, c = v?.camera;
        const input = document.querySelector('#incident-composer-input'), btn = document.querySelector('#incident-composer-submit');
        const hit = node => { if (!node) return null; const b = node.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, top = document.elementFromPoint(x, y); return { x, y, width: b.width, height: b.height, visible: b.width > 0 && b.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight, ok: top === node || node.contains(top), top: top?.id || top?.className }; };
        const p = c?.positionCartographic;
        const label = document.querySelector('#scene-anchor-label');
        const lb = label?.getBoundingClientRect();
        const above = lb && document.elementFromPoint(lb.x + lb.width / 2, lb.y + lb.height / 2);
        const anchorScreen = lb ? { hidden: label.hidden, x: lb.x, y: lb.y, width: lb.width, height: lb.height, foregroundTag: above?.tagName, foregroundId: above?.id, unobstructed: above?.tagName === 'CANVAS' } : null;
        let center = null;
        try { const point = v.scene.globe.pick(c.getPickRay({ x: v.canvas.clientWidth / 2, y: v.canvas.clientHeight / 2 }), v.scene); if (point) { const cp = v.scene.globe.ellipsoid.cartesianToCartographic(point); center = { lat: cp.latitude * 180 / Math.PI, lon: cp.longitude * 180 / Math.PI }; } } catch {}
        const geo = v?.dataSources?._dataSources?.find(source => source.name === 'authored-geography');
        const tiles = (v?.scene?.globe?._surface?._tilesToRender || []).slice(0, 100).map(t => ({ level: t.level, x: t.x, y: t.y, west: t.rectangle?.west * 180 / Math.PI, east: t.rectangle?.east * 180 / Math.PI, south: t.rectangle?.south * 180 / Math.PI, north: t.rectangle?.north * 180 / Math.PI, imageryReady: (t.data?.imagery || []).some(i => !!i.readyImagery) }));
        const imaginary = [];
        for (let i = 0; i < (v?.imageryLayers?.length || 0); i++) { const layer = v.imageryLayers.get(i), provider = layer.imageryProvider; imaginary.push({ show: layer.show, ready: provider?.ready, type: provider?.constructor?.name, host: (() => { try { return new URL(provider?.url || provider?._resource?.url || '').hostname; } catch { return null; } })() }); }
        return { anchorScreen, viewport: { width: innerWidth, height: innerHeight }, utc: new Date().toISOString(), state: document.querySelector('#incident-composer')?.dataset.state, busy: s?.busy, input: { value: input?.value, disabled: input?.disabled, readOnly: input?.readOnly, hit: hit(input) }, button: { disabled: btn?.disabled, hit: hit(btn) }, active: document.activeElement?.id, generation: s?.generation, text: document.querySelector('#incident-composer-result')?.innerText, scene: s?.lastScene ? { id: s.lastScene.id, title: s.lastScene.title, anchor: s.lastScene.anchor, aoi: s.lastScene.aoi, radiusM: s.lastScene.aoiRadiusM, keyframes: s.lastScene.keyframes, provenance: s.lastScene.provenance } : null, extraction: s?.extraction, running: d?.running, paused: !!d?.paused, selectedSceneId: d?._selectedSceneId, clock: document.querySelector('#incident-playback-clock')?.textContent, camera: p ? { lat: p.latitude * 180 / Math.PI, lon: p.longitude * 180 / Math.PI, height: p.height, heading: c.heading * 180 / Math.PI, pitch: c.pitch * 180 / Math.PI } : null, center, overlay: api?.getState?.().geographicOverlay, entityIds: geo?.entities?.values.map(e => e.id) || [], tilesLoaded: v?.scene?.globe?.tilesLoaded, renderedTiles: tiles, imagery: imaginary, events: window.__aoiNativeEvents || [] };
      });
      const until = async (test, timeout = 70000) => {
        const end = Date.now() + timeout; let last;
        do { last = await sample(); if (test(last)) return last; await sleep(250); } while (Date.now() < end);
        const e = new Error('Timed out waiting for rendered AOI state'); e.observed = last; throw e;
      };
      const click = async selector => {
        const target = await page.evaluate(sel => { const node = document.querySelector(sel); if (!node) return null; const b = node.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, top = document.elementFromPoint(x, y); return { x, y, ok: (top === node || node.contains(top)) && b.width > 0 && b.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight, disabled: !!node.disabled, top: top?.id || top?.className }; }, selector);
        assert(target?.ok && !target.disabled, `Native target obstructed/disabled: ${selector} by ${target?.top}`);
        if (width < 600) await page.touchscreen.tap(target.x, target.y); else await page.mouse.click(target.x, target.y);
        run.actions.push({ utc: utc(), action: width < 600 ? 'native-touch' : 'native-click', selector, target });
      };
      const type = async text => {
        await click('#incident-composer-input');
        await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
        await page.keyboard.type(text, { delay: 55 });
        const state = await sample();
        assert(state.input.value === text, 'Ordinary native typing failed');
        assert(state.active === 'incident-composer-input', 'AOI did not retain focus');
        assert(!state.input.disabled && !state.input.readOnly, 'AOI not editable');
        run.actions.push({ utc: utc(), action: 'native-type', text });
      };
      const check = async (action, body) => {
        const entry = { action, viewport: vp, environment: 'direct live preview', startedUtc: utc(), status: 'FAIL' };
        report.assertions.push(entry);
        try { entry.observed = await body(entry); entry.status = 'PASS'; }
        catch (e) { entry.error = safeText(e.message); if (e.observed) entry.observed = e.observed; else try { entry.observed = await sample(); } catch {} report.failures.push({ action, viewport: vp, error: entry.error }); try { entry.screenshot = await screenshot('failure-' + action.replace(/[^a-z0-9]+/gi, '-')); } catch {} }
        entry.finishedUtc = utc(); await save(); return entry;
      };
      const trace = path.join(config.out, `aoi-after-${config.mapProof ? 'clear-map' : 'verified'}-native-${vp}.trace.json`);
      let recording, recorded, recordError;
      const recordingSource = `/tmp/aoi-rebuild-${process.pid}-${vp}.webm`;
      await page.tracing.start({ path: trace, screenshots: true, categories: ['devtools.timeline', 'blink.user_timing'] });
      run.trace = trace;
      try {
        await check('load-and-exact-AOI-hit-target', async entry => {
          const response = await page.goto(config.url + '/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 90000 });
          assert(response.status() === 200, 'App document is not HTTP200');
          await page.waitForFunction(() => window.__gevIncidents?.composer && window.__godsEyeView?.viewer && document.querySelector('#loading-screen')?.classList.contains('hidden'), { timeout: 60000 });
          await sleep(1300);
          const state = await sample(); assert(state.input.hit.ok && state.button.hit.ok, 'Exact AOI input or BUILD SCENE covered');
          entry.screenshot = await screenshot('idle'); return state;
        });
        if (width < 600) {
          run.recording = { startedUtc: utc(), method: 'continuous browser compositor; no synthetic frames', status: 'RECORDING' };
          try { recording = await page.screencast({ format: 'webm', fps: 15, quality: 25, ffmpegPath: 'ffmpeg' }); recorded = pipeline(recording, createWriteStream(recordingSource)).catch(e => { recordError = e; }); await sleep(700); }
          catch (e) { run.recording.status = 'BLOCKED'; run.recording.error = safeText(e.message); }
        }
        const submit = async (text, method, label, expected) => check(label, async entry => {
          const before = await sample();
          const networkStart = run.network.length;
          await type(text);
          if (method === 'Enter') { await page.keyboard.press('Enter'); run.actions.push({ utc: utc(), action: 'native-Enter', text }); }
          else await click('#incident-composer-submit');
          let state = await until(s => s.generation > before.generation && !s.busy && ['done', 'error', 'external'].includes(s.state));
          assert(state.state === 'done' && state.scene, `No generated scene: ${state.state} ${state.text}`);
          assert(state.extraction.intent === 'build_scene', 'Bare AOI not routed to a scene');
          if (config.mapProof) {
            if (await page.$eval('#scene-drawer-toggle', node => node.getAttribute('aria-expanded') === 'true')) await click('#scene-drawer-toggle');
            if (await page.$eval('.od-plugins__details', node => node.open)) await click('.od-plugins__summary');
            await sleep(400);
          }
          assert(state.scene.anchor.name === expected.name, 'Wrong rendered scene anchor name');
          assert(Math.abs(state.scene.anchor.lat - expected.lat) < .002 && Math.abs(state.scene.anchor.lon - expected.lon) < .002, 'Wrong resolved coordinate');
          state = await until(s => !s.running && s.tilesLoaded && Math.abs(s.camera?.lat - expected.lat) < .025 && Math.abs(s.camera?.lon - expected.lon) < .025, 45000);
          await sleep(1000); state = await sample();
          assert(state.entityIds.includes('geographic-scene-anchor') && state.entityIds.includes('geographic-camera-orbit'), 'Real Cesium overlay geometry missing');
          assert(state.overlay.entities >= 6 && state.overlay.markerVisible, 'AOI geometry not visibly rendered');
          if (config.mapProof) assert(state.anchorScreen?.unobstructed, 'Geographic target is hidden behind a panel rather than on the visible map');
          assert(state.center && Math.abs(state.center.lat - expected.lat) < .04 && Math.abs(state.center.lon - expected.lon) < .04, 'Rendered center remains at another location');
          assert(state.renderedTiles.some(t => t.imageryReady && t.west <= expected.lon && t.east >= expected.lon && t.south <= expected.lat && t.north >= expected.lat), 'No ready rendered imagery tile covering AOI');
          assert(state.input.hit.ok && state.button.hit.ok && !state.button.disabled, 'Rebuild controls did not recover');
          assert(!run.network.slice(networkStart).some(n => /incidents\/(search|ingest)$/.test(n.path || '')), 'Bare place wrongly triggered incident search/ingest');
          entry.screenshot = await screenshot(label); return { beforeScene: before.scene?.anchor, after: state, method };
        });
        const marina = { name: 'Dubai Marina', lat: 25.0786415, lon: 55.1352524 }, abu = { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773 };
        await submit('Dubai Marina', 'Enter', 'marina-enter', marina);
        await submit('Abu Dhabi', 'button', 'abu-dhabi-button', abu);
        await submit('Dubai Marina', 'button', 'marina-button-rebuild', marina);
        await check('live-playback-advances', async entry => {
          await click('#incident-composer-play');
          const a = await until(s => s.running); await sleep(1600); const b = await sample();
          assert(b.running && b.clock !== a.clock, 'Scene playback clock did not advance');
          assert(b.entityIds.includes('geographic-camera-orbit'), 'Real playback geometry missing');
          entry.screenshot = await screenshot('marina-playback'); return { first: a, second: b };
        });
        await submit('Abu Dhabi', 'Enter', 'rebuild-during-playback', abu);
        await submit('Dubai Marina', 'Enter', 'marina-final-rebuild', marina);
        await check('controlled-503-restores-controls', async entry => {
          entry.environment = 'direct live preview; explicit injected HTTP503, not a live provider failure';
          let injected = false;
          const handler = async request => {
            if (!injected && new URL(request.url()).pathname.endsWith('/incidents/locate') && request.method() === 'POST') {
              injected = true; run.network.push({ utc: utc(), kind: 'FAULT-INJECTION', path: '/api/ondemand/v2/incidents/locate', status: 503 });
              await request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled HTTP 503 — verification fault. Location service temporarily unavailable.' }) });
            } else await request.continue();
          };
          await page.setRequestInterception(true); page.on('request', handler);
          try {
            await type('Dubai Marina'); await click('#incident-composer-submit');
            const state = await until(s => s.state === 'error' && !s.busy, 15000);
            assert(injected && /Controlled HTTP 503.*temporarily unavailable/.test(state.text), 'Fault did not produce a useful error');
            assert(!state.scene && !state.button.disabled && state.input.hit.ok && state.button.hit.ok, 'Failed request left a scene or locked controls');
            const retry = await page.$('#incident-composer-retry'); assert(retry && await retry.isVisible(), 'Retry control missing');
            entry.screenshot = await screenshot('controlled-503'); return state;
          } finally { page.off('request', handler); await page.setRequestInterception(false); }
        });
        await check('live-retry-after-controlled-failure', async entry => {
          const start = run.network.length; await click('#incident-composer-retry');
          let state = await until(s => s.state === 'done' && !s.busy && s.scene?.anchor.name === 'Dubai Marina');
          state = await until(s => s.tilesLoaded && Math.abs(s.camera?.lat - marina.lat) < .025 && Math.abs(s.camera?.lon - marina.lon) < .025);
          assert(run.network.slice(start).some(n => n.path?.endsWith('/incidents/locate') && n.status === 200), 'Recovery was not a real live request');
          assert(state.input.hit.ok && state.button.hit.ok, 'Recovered controls obscured'); entry.screenshot = await screenshot('live-recovery'); return state;
        });
        await check('native-input-event-provenance', async () => {
          const state = await sample(), events = state.events;
          assert(events.filter(e => e.type === 'input').length >= 30, 'No native typing event evidence');
          assert(events.filter(e => e.type === 'input').every(e => e.trusted), 'Synthetic input events were used');
          assert(events.some(e => e.type === 'submit' && e.trusted), 'No trusted native form submission');
          assert(run.pageErrors.length === 0, 'Page runtime errors occurred');
          return { trustedInputEvents: events.filter(e => e.type === 'input' && e.trusted).length, trustedSubmits: events.filter(e => e.type === 'submit' && e.trusted).length, events };
        });
      } finally {
        if (recording) {
          try {
            await recording.stop(); await recorded; if (recordError) throw recordError;
            const output = path.join(config.workspace, `aoi-${config.mapProof ? 'map-' : ''}rebuild-${vp}.mp4`);
            await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', recordingSource, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', output], { timeout: 60000, env: cleanEnv() });
            const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,codec_name', '-of', 'json', output], { timeout: 10000, env: cleanEnv() });
            run.recording = { ...run.recording, status: 'PASS', finishedUtc: utc(), path: output, media: JSON.parse(stdout) };
          } catch (e) { run.recording = { ...run.recording, status: 'FAIL', finishedUtc: utc(), error: safeText(e.message) }; }
        }
        try { await page.tracing.stop(); } catch (e) { run.traceError = safeText(e.message); }
        run.finishedUtc = utc(); await ctx.close(); await save();
      }
    }
  } catch (e) { report.failures.push({ action: 'browser-driver', error: safeText(e.message) }); }
  finally { try { await browser?.close(); } catch {} cleanup(); report.finishedUtc = utc(); report.passed = report.assertions.filter(x => x.status === 'PASS').length; report.failed = report.assertions.filter(x => x.status === 'FAIL').length; await save(); }
}

if (process.argv[2] === '--worker') {
  await worker(JSON.parse(process.argv[3]));
} else {
  const i = process.argv.indexOf('--url');
  const url = i >= 0 ? process.argv[i + 1] : 'http://localhost:5173';
  const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const mapProof = process.argv.includes('--map-proof');
  const config = { url, workspace, mapProof, out: path.join(workspace, '.ui-proof'), report: path.join(workspace, mapProof ? 'aoi-rebuild-map-browser-results.json' : 'aoi-rebuild-browser-results.json') };
  await fs.mkdir(config.out, { recursive: true });
  let child, browserPid;
  const cleanup = () => { killGroup(browserPid); killGroup(child?.pid); };
  process.on('exit', cleanup);
  const timer = setTimeout(() => { cleanup(); process.exit(124); }, 540000);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); process.exit(124); });
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify(config)], { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: cleanEnv() });
    child.on('message', m => { if (m.browserPid) browserPid = m.browserPid; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    const result = JSON.parse(await fs.readFile(config.report, 'utf8'));
    console.log(JSON.stringify({ report: config.report, passed: result.passed, failed: result.failed, failures: result.failures, recordings: result.runs.map(r => r.recording).filter(Boolean), workerExitCode: code }, null, 2));
    process.exitCode = result.failed || result.failures.length || code ? 1 : 0;
  } finally { clearTimeout(timer); cleanup(); }
}
