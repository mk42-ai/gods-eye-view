#!/usr/bin/env node
/**
 * Real, continuous mobile-browser recording. No fixture/network/state injection.
 *
 * Run AFTER integration/deployment:
 *   node scripts/qa-marina-recording.mjs --url https://LIVE-APP --out ./qa-marina
 * Optional: --chromium /usr/bin/chromium
 *
 * The supervisor puts the worker in its OWN process group. Chromium is spawned
 * non-detached in that group, as are both ffmpeg processes. The WHOLE group is
 * killed on every exit, including errors/signals/a deadline below six minutes.
 *
 * page.screencast() captures the actual compositor continuously to WebM. ffmpeg
 * transcodes that recording (NOT checkpoint PNGs) to H.264/yuv420p/+faststart.
 * A 375x739 viewport needs one black pixel of padding at right/bottom for x264's
 * even-size 4:2:0 requirement: MP4 = 376x740; screenshots/source = 375x739.
 *
 * Required selectors (missing/occluded controls FAIL; no hidden-DOM fallback):
 * #incident-composer-input, #incident-composer-play, #scene-library-name,
 * #scene-library-save, #scene-library-status, #scene-library-saved,
 * #scene-library .scene-library__meta, #sidebar-layers-tab, #sidebar-scenes-tab,
 * #scene-drawer-toggle, #data-panel, #scene-panel, #incident-playback-play,
 * #incident-playback-pause, #incident-playback-next, #incident-playback-prev.
 * Read-only diagnostics: __godsEyeView.viewer.camera, .sceneDirector and
 * __gevIncidents.composer.state. No diagnostic methods that mutate state called.
 */
import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const utc = () => new Date().toISOString();
const PROMPT = 'Create a waterfront orbit scene around Dubai Marina';
const NAME = 'Dubai Marina — Waterfront Orbit';
const VIEWPORT = { width: 375, height: 739, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const SELECTORS = [
  '#incident-composer-input', '#incident-composer-play', '#scene-library-name',
  '#scene-library-save', '#scene-library-status', '#scene-library-saved',
  '#scene-library .scene-library__meta', '#sidebar-layers-tab', '#sidebar-scenes-tab',
  '#scene-drawer-toggle', '#data-panel', '#scene-panel', '#incident-playback-play',
  '#incident-playback-pause', '#incident-playback-next', '#incident-playback-prev',
];

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return '[URL omitted]'; }
}
function errorText(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/[^\s"'<>]+/g, safeUrl)
    .replace(/\b(?:bearer|token|api[-_]?key|authorization)[=: ]+\S+/ig, '[credential omitted]')
    .slice(0, 1500);
}
function assert(condition, message, data) {
  if (!condition) { const error = new Error(message); error.data = data; throw error; }
}
async function saveJson(filename, data) {
  const temporary = `${filename}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temporary, filename);
}
async function limited(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function killGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(-pid, signal); return true; }
  catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
}
function childEnvironment() {
  // Do not forward platform/API credentials to Chromium or ffmpeg.
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'XDG_RUNTIME_DIR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}
function argumentsOf(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--help' || argument === '-h') { result.help = true; continue; }
    const match = /^(--url|--out|--chromium)(?:=(.*))?$/.exec(argument);
    assert(match, `Unknown argument: ${argument}`);
    const value = match[2] ?? argv[++i];
    assert(value && !value.startsWith('--'), `${match[1]} requires a value`);
    result[match[1].slice(2)] = value;
  }
  return result;
}

async function supervise(options) {
  assert(options.url && options.out, 'Usage: node scripts/qa-marina-recording.mjs --url <http(s) URL> --out <directory>');
  assert(process.platform === 'linux', 'Process-group cleanup in this harness requires Linux.');
  const target = new URL(options.url);
  assert(['http:', 'https:'].includes(target.protocol), '--url must be http(s)');
  assert(!target.username && !target.password, 'Do not put credentials in --url.');
  target.searchParams.set('welcome', '0'); target.hash = '';
  const out = path.resolve(options.out);
  await fs.mkdir(out, { recursive: true });
  const prefix = `marina-recording-${utc().replace(/[:.]/g, '-')}-${process.pid}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gev-marina-recording-'));
  const config = {
    url: target.href, out, prefix, profile, chromium: options.chromium,
    reportPath: path.join(out, `${prefix}.json`),
    sourcePath: path.join(out, `${prefix}.webm`),
    videoPath: path.join(out, `${prefix}.mp4`),
  };
  let child, reason, browserPid;
  let softTimer, hardTimer, ultimateTimer, escalation;
  const cleanupGroups = signal => {
    if (child?.pid) killGroup(child.pid, signal);
  };
  const onExit = () => { try { cleanupGroups('SIGKILL'); } catch {} };
  const stop = message => {
    reason ||= message;
    if (child?.exitCode == null) {
      // Let the worker stop/flush its recording before group termination.
      child?.kill('SIGTERM');
      escalation ||= setTimeout(() => cleanupGroups('SIGKILL'), 12_000);
    }
  };
  const onInt = () => stop('Interrupted by SIGINT');
  const onTerm = () => stop('Interrupted by SIGTERM');
  const onHup = () => stop('Interrupted by SIGHUP');
  let report;
  try {
    process.on('exit', onExit);
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--__worker', JSON.stringify(config)], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: childEnvironment(),
    });
    child.on('message', message => {
      if (message?.type === 'browser-pid' && Number.isInteger(message.pid)) browserPid = message.pid;
    });
    softTimer = setTimeout(() => stop('Supervisor deadline: 325 seconds'), 325_000);
    hardTimer = setTimeout(() => {
      reason ||= 'Hard deadline: 350 seconds'; cleanupGroups('SIGKILL');
    }, 350_000);
    // Last-resort wall cap, including supervisor/report cleanup (< six minutes).
    ultimateTimer = setTimeout(() => { cleanupGroups('SIGKILL'); process.exit(124); }, 358_000);
    const outcome = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    cleanupGroups('SIGKILL');
    try { report = JSON.parse(await fs.readFile(config.reportPath, 'utf8')); }
    catch {
      report = { status: 'failed', ok: false, startedUtc: null, endedUtc: utc(),
        assertions: [], recording: {}, failures: ['Worker did not finish an assertion report.'] };
    }
    if (reason || outcome.code !== 0) {
      report.ok = false; report.status = 'failed';
      report.failures ||= [];
      if (reason) report.failures.push(reason);
      else if (!report.failures.length) report.failures.push(`Worker exited ${outcome.code ?? outcome.signal}`);
    }
    report.processCleanup = {
      workerProcessGroup: child.pid, chromiumPid: browserPid || null, chromiumProcessGroup: child.pid,
      scope: 'Chromium and ffmpeg inherit the dedicated worker process group; whole group receives SIGKILL after worker exit.',
      attempted: true, exitCode: outcome.code, signal: outcome.signal,
      hardWallClockCapSeconds: 358,
    };
    report.reportPath = config.reportPath;
    await saveJson(config.reportPath, report);
  } finally {
    try { cleanupGroups('SIGKILL'); } catch {}
    clearTimeout(softTimer); clearTimeout(hardTimer); clearTimeout(escalation);
    await limited(fs.rm(profile, { recursive: true, force: true }), 1500, 'Temporary profile cleanup').catch(() => {});
    clearTimeout(ultimateTimer);
    process.off('exit', onExit); process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm); process.off('SIGHUP', onHup);
  }
  console.log(JSON.stringify({
    ok: report.ok, status: report.status, report: config.reportPath,
    mp4: report.recording?.mp4Verified ? config.videoPath : null,
    continuousSource: report.recording?.sourceReady ? config.sourcePath : null,
    started: report.recording?.startedUtc || null, ended: report.recording?.endedUtc || null,
    screenshots: report.screenshots || [], failures: report.failures || [],
  }, null, 2));
  return report.ok ? 0 : 1;
}

/** READ ONLY, executed in the real page. Never assigns DOM or application state. */
function inspectState() {
  const d = window.__godsEyeView?.sceneDirector;
  const camera = window.__godsEyeView?.viewer?.camera;
  const last = window.__gevIncidents?.composer?.state?.lastScene;
  const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
  const shown = selector => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const box = el.getBoundingClientRect(), css = getComputedStyle(el);
    return !el.hidden && box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
  };
  return {
    viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio,
      visualWidth: window.visualViewport?.width, visualHeight: window.visualViewport?.height,
      documentWidth: document.documentElement.scrollWidth, touchPoints: navigator.maxTouchPoints },
    ready: !!(window.__godsEyeView?.viewer && window.__gevIncidents?.composer && d),
    busy: window.__gevIncidents?.composer?.state?.busy ?? null,
    composerState: document.querySelector('#incident-composer')?.dataset.state,
    composerInput: document.querySelector('#incident-composer-input')?.value,
    running: typeof d?.running === 'boolean' ? d.running : null,
    paused: !!d?.paused, selectedSceneId: d?._selectedSceneId || null,
    selectedShotId: d?._selectedShotId || null,
    clock: text('#incident-playback-clock'),
    scrub: Number(document.querySelector('#incident-playback-scrub')?.value ?? 0),
    anchor: last?.anchor ? { lat: last.anchor.lat, lon: last.anchor.lon, name: last.anchor.name } : null,
    sceneId: last?.id || null, sceneTitle: last?.title || null,
    keyframes: last?.keyframes?.length ?? null,
    name: document.querySelector('#scene-library-name')?.value || '',
    activeTitle: text('#scene-library .scene-library__active-title'),
    meta: text('#scene-library .scene-library__meta'), status: text('#scene-library-status'),
    savedOptions: Array.from(document.querySelectorAll('#scene-library-saved option'),
      option => ({ value: option.value, title: option.textContent?.trim() || '' })),
    layersSelected: document.querySelector('#sidebar-layers-tab')?.getAttribute('aria-selected'),
    scenesSelected: document.querySelector('#sidebar-scenes-tab')?.getAttribute('aria-selected'),
    drawerExpanded: document.querySelector('#scene-drawer-toggle')?.getAttribute('aria-expanded'),
    layersShown: shown('#data-panel'), scenesShown: shown('#scene-panel'),
    camera: camera ? {
      x: camera.positionWC?.x, y: camera.positionWC?.y, z: camera.positionWC?.z,
      heading: camera.heading, pitch: camera.pitch, roll: camera.roll,
      lat: camera.positionCartographic?.latitude, lon: camera.positionCartographic?.longitude,
      height: camera.positionCartographic?.height,
    } : null,
  };
}
/** READ ONLY hit-testing, clipping and a user-scrollable ancestor. */
function geometry(selector) {
  const el = document.querySelector(selector);
  if (!el) return { selector, exists: false };
  const rect = el.getBoundingClientRect();
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight, visible = true, scroll = null;
  for (let node = el; node; node = node.parentElement) {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    visible = visible && !node.hidden && !node.inert && css.display !== 'none'
      && css.visibility !== 'hidden' && Number(css.opacity) > 0;
    if (node !== el) {
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      if (!scroll && /(auto|scroll)/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 1) scroll = node;
    }
  }
  const root = document.scrollingElement;
  if (!scroll && root?.scrollHeight > innerHeight + 1) scroll = root;
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  let port = null;
  if (scroll) {
    const box = scroll.getBoundingClientRect();
    const l = Math.max(0, box.left), r = Math.min(innerWidth, box.right);
    const t = Math.max(0, box.top), b = Math.min(innerHeight, box.bottom);
    for (const ratio of [.5, .8, .2]) {
      const px = l + (r - l) * ratio, py = t + (b - t) * .55;
      const under = document.elementFromPoint(px, py);
      if (b - t > 20 && r - l > 20 && under && scroll.contains(under)) {
        port = { x: px, y: py, id: scroll.id || scroll.tagName, position: scroll.scrollTop,
          canUp: scroll.scrollTop > 0, canDown: scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1 };
        break;
      }
    }
  }
  return { selector, exists: true, visible: visible && rect.width > 0 && rect.height > 0,
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    text: el.textContent?.trim() || '', value: el.value, focused: document.activeElement === el,
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    center: { x, y }, clip: { left, top, right, bottom },
    hitOK: !!hit && (hit === el || el.contains(hit)), hitId: hit?.id || hit?.tagName || null,
    centerInside: x >= left && x < right && y >= top && y < bottom,
    fullyInside: rect.left >= left && rect.right <= right && rect.top >= top && rect.bottom <= bottom,
    scroll: port };
}

async function runWorker(config) {
  const { default: puppeteer } = await import('puppeteer');
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Interrupted; stopping the real browser recording.'));
  process.on('SIGTERM', abort); process.on('SIGINT', abort); process.on('SIGHUP', abort);
  const deadline = setTimeout(() => controller.abort(new Error('Worker deadline: 300 seconds')), 300_000);
  const report = {
    agent: 20, status: 'running', ok: false, startedUtc: utc(), endedUtc: null,
    url: safeUrl(config.url), navigation: 'Supplied live URL with welcome=0',
    prompt: PROMPT, savedName: NAME, viewport: VIEWPORT,
    requiredSelectors: SELECTORS, assertions: [], screenshots: [], failures: [], actions: [],
    missingSelectors: [], blockedSelectors: [], recording: {
      method: 'Puppeteer page.screencast (continuous live compositor stream), then ffmpeg transcode',
      sourcePath: config.sourcePath, mp4Path: config.videoPath,
      startedUtc: null, endedUtc: null, sourceReady: false, mp4Verified: false,
      pixels: '375x739 browser viewport and PNG/WebM; 376x740 MP4 with 1px right/bottom black padding for H.264 yuv420p',
      checkpointImagesUsedAsVideo: false, syntheticFrames: false,
    },
    policy: { nativeTyping: true, nativePointer: true, readOnlyEvaluate: true,
      networkInterception: false, stateInjection: false, overlayOrCssChanges: false,
      networkBodiesOrCredentialsLogged: false },
  };
  let browser, browserProcess, page, recorder, streamDone, recorderFailure, stopPromise, reachedEnding = false;
  const flush = () => saveJson(config.reportPath, report);
  const read = () => page.evaluate(inspectState);
  const guard = () => controller.signal.throwIfAborted();
  async function until(get, predicate, label, ms = 20_000) {
    const end = Date.now() + ms; let last;
    do {
      guard(); last = await limited(get(), Math.min(12_000, ms), `${label}: read`);
      if (predicate(last)) return last;
      await sleep(150);
    } while (Date.now() < end);
    const error = new Error(`Timed out: ${label}`); error.data = last; throw error;
  }
  async function step(id, action) {
    guard();
    const row = { id, startedUtc: utc(), endedUtc: null, pass: false };
    report.assertions.push(row); await flush();
    try { row.data = (await action()) ?? null; row.pass = true; }
    catch (error) {
      row.error = errorText(error); row.data = error.data ?? null;
      report.failures.push(`${id}: ${row.error}`); throw error;
    } finally { row.endedUtc = utc(); await flush(); }
  }
  async function target(selector, full = false) {
    await until(() => page.evaluate(geometry, selector), g => g.exists && g.visible && !g.disabled && (!g.centerInside || g.hitOK),
      `visible enabled unobstructed selector ${selector}`, 15_000).catch(error => {
      if (error.data?.exists === false) report.missingSelectors.push(selector);
      else report.blockedSelectors.push(selector);
      throw error;
    });
    let previousPosition, stalled = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      guard();
      const g = await page.evaluate(geometry, selector);
      if (g.visible && !g.disabled && g.centerInside && g.hitOK && (!full || g.fullyInside)) return g;
      assert(g.scroll, `${selector} is clipped or occluded with no visible native-scroll recovery`, g);
      const direction = g.center.y < g.clip.top || (full && g.rect.top < g.clip.top) ? -1 : 1;
      assert(direction > 0 ? g.scroll.canDown : g.scroll.canUp, `${selector} cannot be scrolled into view`, g);
      stalled = previousPosition === g.scroll.position ? stalled + 1 : 0;
      assert(stalled < 2, `Native scrolling made no progress for ${selector}`, g);
      previousPosition = g.scroll.position;
      await page.mouse.move(g.scroll.x, g.scroll.y);
      await page.mouse.wheel({ deltaY: direction * 180 });
      report.actions.push({ at: utc(), method: 'page.mouse.wheel', selector, deltaY: direction * 180 });
      await sleep(250);
    }
    report.blockedSelectors.push(selector);
    assert(false, `${selector} remained clipped/occluded after bounded native scrolling`, await page.evaluate(geometry, selector));
  }
  async function tap(selector) {
    const g = await target(selector);
    await page.touchscreen.tap(g.center.x, g.center.y);
    report.actions.push({ at: utc(), method: 'page.touchscreen.tap', selector, x: g.center.x, y: g.center.y });
    await sleep(100);
    return g;
  }
  async function type(selector, value) {
    await tap(selector);
    await until(() => page.evaluate(geometry, selector), g => g.focused, `touch focus ${selector}`, 3000);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type(selector, value, { delay: 65 });
    report.actions.push({ at: utc(), method: 'page.type', selector, value });
    const g = await page.evaluate(geometry, selector);
    assert(g.focused && g.value === value, `Native typing did not reach ${selector}`, g);
    return g;
  }
  async function scenes() {
    if ((await read()).drawerExpanded === 'false') await tap('#scene-drawer-toggle');
    await tap('#sidebar-scenes-tab');
    return until(read, s => s.scenesSelected === 'true' && s.scenesShown && !s.layersShown, 'Scenes panel selected');
  }
  async function screenshot(stage) {
    guard();
    const filename = path.join(config.out, `${config.prefix}-${stage}.png`);
    await page.screenshot({ path: filename, type: 'png', fullPage: false, captureBeyondViewport: false });
    const handle = await fs.open(filename, 'r');
    let dimensions;
    try {
      const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0);
      dimensions = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    } finally { await handle.close(); }
    assert(dimensions.width === 375 && dimensions.height === 739, 'Checkpoint PNG must be exactly 375x739', dimensions);
    const record = { stage, path: filename, at: utc(), ...dimensions };
    report.screenshots.push(record); await flush(); return record;
  }
  async function motion(label, seconds = 6) {
    const samples = [], started = Date.now();
    do {
      guard(); const state = await read();
      assert(state.running === true && state.camera && Number.isFinite(state.camera.x), `${label}: real camera/director is not running`, state);
      samples.push({ at: utc(), elapsedMs: Date.now() - started, clock: state.clock, camera: state.camera });
      if (Date.now() - started >= seconds * 1000) break;
      await sleep(1000);
    } while (true);
    let transitions = 0, distance = 0, angular = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].camera, b = samples[i].camera;
      const meters = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const radians = Math.max(Math.abs(b.heading - a.heading), Math.abs(b.pitch - a.pitch));
      if (meters > .05 || radians > 0.00001) transitions++;
      distance += meters; angular += radians;
    }
    assert(samples.length >= 4 && transitions >= 3 && new Set(samples.map(s => s.clock)).size >= 3,
      `${label}: no sustained genuine camera motion plus advancing playback clock`, { samples, transitions, distance, angular });
    return { observedSeconds: (Date.now() - started) / 1000, transitions, distanceMeters: distance, angularRadians: angular, samples };
  }
  async function pausePlayback() {
    await tap('#incident-playback-pause');
    return until(read, s => s.running === false && s.paused && /paused/i.test(s.clock), 'Playback paused');
  }
  async function stopRecording() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (!recorder) return;
      report.recording.stoppingUtc = utc();
      try {
        await limited(recorder.stop(), 10_000, 'Native screencast stop/flush');
        await limited(streamDone, 5000, 'Continuous WebM file flush');
        if (recorderFailure) throw recorderFailure;
        const file = await fs.stat(config.sourcePath);
        assert(file.size > 1024, 'Continuous screencast source is missing or empty');
        report.recording.sourceReady = true;
        report.recording.sourceBytes = file.size;
      } catch (error) {
        report.failures.push(`Recording stop: ${errorText(error)}`);
      } finally { report.recording.endedUtc = utc(); await flush(); }
    })();
    return stopPromise;
  }

  const stopOnAbort = () => { void stopRecording().catch(() => {}); };
  controller.signal.addEventListener('abort', stopOnAbort, { once: true });
  await flush();
  try {
    let executablePath = config.chromium;
    if (!executablePath) {
      for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
        try { await fs.access(candidate, fsConstants.X_OK); executablePath = candidate; break; } catch {}
      }
      executablePath ||= puppeteer.executablePath();
    }
    await fs.access(executablePath, fsConstants.X_OK);
    await exec('ffmpeg', ['-version'], { timeout: 3000, env: childEnvironment() });
    await exec('ffprobe', ['-version'], { timeout: 3000, env: childEnvironment() });
    // puppeteer.launch() detaches Chromium into another group by default. Spawn
    // it explicitly NON-detached so an early startup failure cannot orphan a
    // browser before a PID is returned. Puppeteer still owns all page driving.
    browserProcess = spawn(executablePath, [
      '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${config.profile}`, '--no-sandbox', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
      '--window-size=375,739', 'about:blank',
    ], { detached: false, stdio: 'ignore', env: childEnvironment() });
    let launchError, browserExit;
    browserProcess.once('error', error => { launchError = error; });
    browserProcess.once('exit', (code, signal) => { browserExit = { code, signal }; });
    if (browserProcess.pid) process.send?.({ type: 'browser-pid', pid: browserProcess.pid });
    const endpoint = await until(async () => {
      if (launchError) throw launchError;
      assert(!browserExit, 'Chromium exited before the debugging endpoint was ready', browserExit);
      try { return await fs.readFile(path.join(config.profile, 'DevToolsActivePort'), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }, value => !!value?.trim(), 'Chromium local debugging endpoint', 30_000);
    const [port, socketPath] = endpoint.trim().split(/\r?\n/);
    assert(/^\d+$/.test(port) && socketPath?.startsWith('/devtools/browser/'), 'Invalid local Chromium endpoint');
    browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${port}${socketPath}`,
      defaultViewport: VIEWPORT, protocolTimeout: 20_000,
    });
    page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.setDefaultNavigationTimeout(70_000); page.setDefaultTimeout(20_000);

    await step('ready-real-mobile-workstation', async () => {
      const response = await page.goto(config.url, { waitUntil: 'domcontentloaded' });
      assert(response && response.status() >= 200 && response.status() < 400, 'Live document did not load successfully', { status: response?.status() });
      const input = await page.waitForSelector('#incident-composer-input', { visible: true, timeout: 70_000 });
      await input.dispose();
      const state = await until(read, s => s.ready, 'Actual Cesium viewer and incident composer', 60_000);
      const v = state.viewport;
      assert(v.width === 375 && v.height === 739 && v.scale === 1 && v.touchPoints > 0,
        'Expected actual 375x739 touch viewport', v);
      await target('#incident-composer-input');
      return { status: response.status(), viewport: v };
    });
    await step('continuous-screencast-started-before-any-typing', async () => {
      report.recording.startedUtc = utc();
      recorder = await page.screencast({ format: 'webm', fps: 20, quality: 25, ffmpegPath: 'ffmpeg' });
      streamDone = pipeline(recorder, createWriteStream(config.sourcePath, { flags: 'wx' }))
        .catch(error => { recorderFailure = error; });
      // Real idle lead-in, not an injected or separately generated title frame.
      await sleep(1200);
      return { startedUtc: report.recording.startedUtc, fps: 20, source: config.sourcePath };
    });
    await step('native-page-type-exact-prompt-and-keyboard-enter', async () => {
      report.recording.firstTypingUtc = utc();
      assert(Date.parse(report.recording.startedUtc) < Date.parse(report.recording.firstTypingUtc), 'Recording must precede typing');
      await type('#incident-composer-input', PROMPT);
      // Explicit native Enter, not evaluate/dispatchEvent or a submit handler call.
      await page.keyboard.press('Enter');
      report.actions.push({ at: utc(), method: 'page.keyboard.press', key: 'Enter', purpose: 'submit exact Marina prompt' });
      return { prompt: PROMPT };
    });
    await step('scene-created-and-resolved-to-dubai-marina', async () => {
      const state = await until(read, s => s.composerState === 'done' && !s.busy && s.sceneId && s.name.trim(),
        'scene creation and nonempty #scene-library-name', 90_000);
      assert(state.composerInput === PROMPT && state.anchor
        && Math.abs(state.anchor.lat - 25.07864) < .00001
        && Math.abs(state.anchor.lon - 55.13525) < .00001
        && state.keyframes >= 2,
      'Created scene must resolve to the real Dubai Marina anchor with multiple keyframes', state);
      await until(() => page.evaluate(geometry, '#incident-composer-play'), g => g.exists && g.visible && !g.disabled,
        '#incident-composer-play appears after creation');
      await scenes();
      return { state, screenshot: await screenshot('created') };
    });
    await step('composer-play-and-six-seconds-genuine-camera-motion', async () => {
      await tap('#incident-composer-play');
      await until(read, s => s.running === true, 'Composer Play starts director');
      const evidence = await motion('Composer Play');
      return { evidence, screenshot: await screenshot('playing') };
    });
    await step('visible-playback-pause', pausePlayback);
    await step('type-visible-scene-name-and-save', async () => {
      await scenes(); await type('#scene-library-name', NAME);
      await tap('#scene-library-save');
      const state = await until(read, s => s.name === NAME && s.activeTitle === NAME
        && /\bSaved\b/.test(s.meta) && /^Scene saved\./i.test(s.status)
        && s.savedOptions.some(option => option.title === NAME), 'Real visible saved confirmation');
      await target('#scene-library .scene-library__meta');
      return { state, screenshot: await screenshot('saved') };
    });
    await step('clean-visible-layers-scenes-buttons-and-real-switching', async () => {
      const layers = await target('#sidebar-layers-tab', true), scenesButton = await target('#sidebar-scenes-tab', true);
      assert(layers.text === 'Layers' && scenesButton.text === 'Scenes', 'Sidebar tabs must have clean Layers / Scenes labels', { layers, scenes: scenesButton });
      await tap('#sidebar-layers-tab');
      const state = await until(read, s => s.layersSelected === 'true' && s.layersShown && !s.scenesShown, 'Layers tab actually reveals Layers');
      const shot = await screenshot('layers');
      await scenes(); await sleep(700);
      return { layers, scenes: scenesButton, layersState: state, screenshot: shot };
    });
    await step('visible-playback-play-resumes-six-seconds-camera-motion', async () => {
      await tap('#incident-playback-play');
      await until(read, s => s.running === true, 'Playback Play resumes');
      return motion('Playback Play');
    });
    await step('pause-before-native-keyframe-stepping', pausePlayback);
    await step('visible-next-keyframe', async () => {
      const before = await read(); await tap('#incident-playback-next');
      const after = await until(read, s => s.selectedShotId && s.selectedShotId !== before.selectedShotId,
        'Next changes the selected real keyframe');
      await sleep(1200); return { before, after };
    });
    await step('visible-previous-keyframe', async () => {
      const before = await read(); await tap('#incident-playback-prev');
      const after = await until(read, s => s.selectedShotId && s.selectedShotId !== before.selectedShotId,
        'Previous changes the selected real keyframe');
      await sleep(1200); return { before, after };
    });
    await step('final-play-with-six-seconds-real-camera-motion', async () => {
      await tap('#incident-playback-play');
      await until(read, s => s.running === true, 'Final Playback Play');
      return motion('Final Playback Play');
    });
    await step('final-visible-pause-and-real-idle-tail', async () => {
      const state = await pausePlayback(); await sleep(1200); return state;
    });
    reachedEnding = true;
  } catch (error) {
    if (!report.failures.some(message => message.includes(errorText(error)))) report.failures.push(errorText(error));
    report.stoppedAt = report.assertions.at(-1)?.id || 'browser setup';
  } finally {
    // Always finish the SAME recording, even when a selector/assertion fails.
    await stopRecording();
  }

  if (reachedEnding && !controller.signal.aborted) {
    try {
      await step('saved-scene-survives-reload-after-recording', async () => {
        assert(report.recording.endedUtc, 'Reload is allowed only after recording has stopped');
        const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 70_000 });
        assert(response && response.status() >= 200 && response.status() < 400, 'Reload did not succeed', { status: response?.status() });
        await until(read, s => s.ready, 'Workstation initializes after reload', 60_000);
        await scenes();
        const state = await until(read, s => s.savedOptions.some(option => option.title === NAME && option.value !== ''),
          'Exact named scene persists in the real Saved scenes control', 25_000);
        // Native keyboard selection verifies the persisted scene is usable, not
        // merely a stale transient confirmation. No .select(), .value or storage writes.
        const index = state.savedOptions.findIndex(option => option.title === NAME);
        await tap('#scene-library-saved');
        await page.keyboard.press('Home');
        for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
        const selected = await until(read, s => s.name === NAME && s.activeTitle === NAME && /\bSaved\b/.test(s.meta),
          'Persisted scene reloads through the native select');
        return { selected, screenshot: await screenshot('reloaded') };
      });
    } catch (error) {
      if (!report.failures.some(message => message.includes(errorText(error)))) report.failures.push(errorText(error));
    }
  }

  // Release Chromium resources before spending CPU on the encode. The supervisor
  // kills the whole inherited process group, even if browser.close() fails.
  if (browser) await limited(browser.close(), 5000, 'Browser close').catch(error => {
    report.failures.push(errorText(error));
  });
  if (browserProcess && browserProcess.exitCode === null) browserProcess.kill('SIGKILL');
  try {
    if (report.recording.sourceReady) {
      await step('continuous-source-to-browser-compatible-h264-mp4', async () => {
        const probe = async filename => {
          const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'format=duration,size,format_name:stream=codec_name,pix_fmt,width,height,nb_frames,r_frame_rate',
            '-of', 'json', filename], { timeout: 5000, maxBuffer: 100_000, env: childEnvironment() });
          return JSON.parse(stdout);
        };
        const source = await probe(config.sourcePath);
        assert(source.streams?.[0]?.width === 375 && source.streams[0].height === 739,
          'Native screencast source must preserve the exact 375x739 viewport', source);
        await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', config.sourcePath, '-map', '0:v:0', '-an',
          '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black,setsar=1',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-threads', '2', '-movflags', '+faststart', config.videoPath],
        { timeout: 30_000, maxBuffer: 100_000, env: childEnvironment(), killSignal: 'SIGKILL' });
        const mp4 = await probe(config.videoPath), stream = mp4.streams?.[0];
        const duration = Number(mp4.format?.duration);
        const wallDuration = (Date.parse(report.recording.stoppingUtc) - Date.parse(report.recording.startedUtc)) / 1000;
        assert(stream?.codec_name === 'h264' && stream.pix_fmt === 'yuv420p'
          && stream.width === 376 && stream.height === 740 && Number(stream.nb_frames) >= 20
          && duration > 1 && Math.abs(duration - wallDuration) <= Math.max(3, wallDuration * .15),
        'ffprobe must confirm playable H.264/yuv420p with a real-time continuous timeline', { mp4, wallDuration });
        const atoms = await topLevelMp4Atoms(config.videoPath);
        assert(atoms.includes('moov') && atoms.includes('mdat') && atoms.indexOf('moov') < atoms.indexOf('mdat'),
          'MP4 must have moov before mdat (+faststart)', { atoms });
        report.recording.mp4Verified = true;
        report.recording.metadata = { source, mp4, atoms, wallDurationSeconds: wallDuration };
        return report.recording.metadata;
      });
    }
  } catch (error) {
    if (!report.failures.some(message => message.includes(errorText(error)))) report.failures.push(errorText(error));
  } finally {
    clearTimeout(deadline);
    controller.signal.removeEventListener('abort', stopOnAbort);
    process.off('SIGTERM', abort); process.off('SIGINT', abort); process.off('SIGHUP', abort);
    report.endedUtc = utc();
    report.recording.completeUserFlow = reachedEnding;
    report.ok = reachedEnding && report.assertions.some(row => row.id === 'saved-scene-survives-reload-after-recording' && row.pass)
      && report.recording.mp4Verified && report.failures.length === 0;
    report.status = report.ok ? 'passed' : 'failed';
    report.missingSelectors = [...new Set(report.missingSelectors)];
    report.blockedSelectors = [...new Set(report.blockedSelectors)];
    await flush();
  }
  return report.ok ? 0 : 1;
}

async function topLevelMp4Atoms(filename) {
  const handle = await fs.open(filename, 'r'), atoms = [];
  try {
    const { size } = await handle.stat(); let offset = 0;
    while (offset + 8 <= size && atoms.length < 100) {
      const header = Buffer.alloc(16), result = await handle.read(header, 0, 16, offset);
      if (result.bytesRead < 8) break;
      let length = header.readUInt32BE(0);
      const atom = header.toString('ascii', 4, 8);
      if (length === 1) length = Number(header.readBigUInt64BE(8));
      if (length === 0) length = size - offset;
      assert(length >= 8 && offset + length <= size, 'Malformed MP4 atom', { atom, offset, length });
      atoms.push(atom); offset += length;
    }
    return atoms;
  } finally { await handle.close(); }
}

try {
  if (process.argv[2] === '--__worker') {
    assert(typeof process.send === 'function' && process.connected, 'Internal worker requires the supervised IPC/process-group launcher');
    const code = await runWorker(JSON.parse(process.argv[3]));
    // Explicit exit also handles a stuck Chromium/ffmpeg pipe; the parent kills
    // the dedicated process group after receiving this worker's exit.
    process.exit(code);
  } else {
    const options = argumentsOf(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/qa-marina-recording.mjs --url <live URL> --out <artifact directory> [--chromium /usr/bin/chromium]\nRuns only on invocation; real browser/network, 375x739 touch viewport, continuous WebM + H.264 MP4 + PNG checkpoints + assertion JSON. Linux. Hard cap: 358s.');
    else process.exitCode = await supervise(options);
  }
} catch (error) {
  console.error(`Marina recording failed: ${errorText(error)}`);
  process.exitCode = 1;
}
