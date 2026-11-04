#!/usr/bin/env node
/**
 * Render-crash reproduction / fix-proof harness (2026-11-02).
 *
 * Builds the same prompt N consecutive times in ONE page (no reload between
 * builds, exactly as a user iterating on a prompt does), presses Play after each
 * build, and records per cycle:
 *   - Cesium error panel presence (`.cesium-widget-errorPanel`) + its text
 *   - `window.__gevRender` recovery counters (renderError / contextLost / recovered)
 *   - JS heap (performance.memory.usedJSHeapSize, MB) before/after build & after play
 *   - FPS during playback (window.__gevCinematic.fps(), 1 s rAF sample)
 *   - Cesium primitive / entity / billboard counts (window.__gevRender.budget())
 *   - console errors, failed requests, run state
 * Writes qa-render-crash.json + .md + screenshots to --out.
 *
 * Usage:
 *   node scripts/qa-render-crash.mjs --url https://… [--prompt "…"] [--cycles 5]
 *     [--out docs/evidence-2026-11-02-render-fix/qa-live] [--viewport 1440x900]
 *     [--timeout-sec 240] [--extra-prompts "a|b|c"] [--label before]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => {
      if (!a.startsWith('--')) return [];
      const key = a.slice(2);
      const val =
        arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
      return [key, val];
    })
    .filter((x) => x.length),
);

const appUrl = (args.url || 'http://127.0.0.1:5173').replace(/\/$/, '');
const prompt =
  args.prompt ||
  'emirates palace world event lets map and do the poloice protection';
const cycles = Math.max(1, Number(args.cycles || 5));
const outDir = path.resolve(
  args.out || 'docs/evidence-2026-11-02-render-fix/qa-live',
);
const label = args.label || 'run';
const timeoutMs = Math.max(30, Number(args['timeout-sec'] || 240)) * 1000;
const [vw, vh] = (args.viewport || '1440x900').split('x').map(Number);
const extraPrompts = (args['extra-prompts'] || '')
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean);
mkdirSync(outDir, { recursive: true });

const nowUtc = () => new Date().toISOString();
const log = (m) => console.log(`[qa-render-crash ${nowUtc()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-precise-memory-info',
    '--hide-scrollbars',
  ],
  protocolTimeout: 300000,
});
const hardKill = () => {
  try {
    const proc = browser.process();
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {}
      try {
        proc.kill('SIGKILL');
      } catch {}
    }
  } catch {}
};
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'])
  process.on(sig, () => {
    hardKill();
    process.exit(124);
  });
process.on('exit', hardKill);
setTimeout(
  () => {
    log('global cap exceeded');
    hardKill();
    process.exit(124);
  },
  Number(args['cap-min'] || 50) * 60 * 1000,
).unref();

const report = {
  url: appUrl,
  label,
  prompt,
  cycles,
  viewport: `${vw}x${vh}`,
  startedUtc: nowUtc(),
  finishedUtc: null,
  results: [],
  extra: [],
  summary: null,
};

const page = await browser.newPage();
await page.setViewport({
  width: vw,
  height: vh,
  isMobile: vw < 700,
  hasTouch: vw < 700,
});
const consoleErrors = [];
const failedRequests = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`${nowUtc()} ${msg.text()}`);
});
page.on('pageerror', (err) =>
  consoleErrors.push(`${nowUtc()} PAGEERROR ${err?.message || err}`),
);
page.on('requestfailed', (req) =>
  failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }),
);

async function probe() {
  return page.evaluate(async () => {
    const panel = document.querySelector('.cesium-widget-errorPanel');
    const toast = document.querySelector('#gev-render-toast');
    const api = window.__gevCinematic;
    const render = window.__gevRender;
    const mem = performance.memory;
    const st = api?.state?.() || null;
    return {
      errorPanel: panel
        ? (panel.textContent || '').replace(/\s+/g, ' ').slice(0, 300)
        : null,
      recoveryToast: toast && !toast.hidden ? toast.textContent : null,
      render: render?.stats?.() || null,
      budget: render?.budget?.() || null,
      heapMb: mem ? Number((mem.usedJSHeapSize / 1048576).toFixed(1)) : null,
      heapLimitMb: mem
        ? Number((mem.jsHeapSizeLimit / 1048576).toFixed(0))
        : null,
      runState: st?.runState || null,
      sceneVersion: st?.sceneVersion ?? null,
      entities: api?.scene?.()?.entities?.length ?? null,
      invalid: (st?.invalid || []).length,
      playback: api?.playback?.state?.() || null,
      playDisabled: document.querySelector('#cinematic-play')?.disabled ?? null,
    };
  });
}

async function submitPrompt(text) {
  return page.evaluate(async (t) => {
    const input =
      document.querySelector('#incident-composer-input') ||
      document.querySelector('textarea.incident-composer__input');
    const submitBtn =
      document.querySelector('#incident-composer-submit') ||
      document.querySelector('button[type="submit"]');
    if (!input || !submitBtn) return false;
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    submitBtn.click();
    return true;
  }, text);
}

async function waitTerminal() {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const p = await probe();
    if (p.errorPanel) return { terminal: true, crashed: true, probe: p };
    if (
      ['succeeded', 'partially_completed', 'failed', 'cancelled', 'timed_out']
        .includes(p.runState)
    )
      return { terminal: true, crashed: false, probe: p, ms: Date.now() - t0 };
    await sleep(1000);
  }
  return { terminal: false, crashed: false, probe: await probe(), ms: timeoutMs };
}

async function shot(name) {
  const file = `${label}-${name}.png`;
  try {
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
    return file;
  } catch (e) {
    log(`screenshot failed ${e.message}`);
    return null;
  }
}

async function runCycle(i, text, bucket) {
  const rec = {
    cycle: i,
    prompt: text,
    startedUtc: nowUtc(),
    heapBeforeMb: null,
    heapAfterBuildMb: null,
    heapAfterPlayMb: null,
    buildMs: null,
    runState: null,
    errorPanel: null,
    recovery: null,
    budget: null,
    fps: null,
    playDisabledBeforePlay: null,
    playbackAfterPlay: null,
    screenshots: [],
    consoleErrorsDelta: 0,
    status: 'running',
  };
  const errBase = consoleErrors.length;
  try {
    const before = await probe();
    rec.heapBeforeMb = before.heapMb;
    const ok = await submitPrompt(text);
    if (!ok) throw new Error('composer not found');
    const term = await waitTerminal();
    rec.buildMs = term.ms ?? null;
    rec.runState = term.probe.runState;
    rec.errorPanel = term.probe.errorPanel;
    rec.recovery = term.probe.render;
    rec.budget = term.probe.budget;
    rec.heapAfterBuildMb = term.probe.heapMb;
    rec.invalid = term.probe.invalid;
    rec.entities = term.probe.entities;
    rec.screenshots.push(await shot(`c${i}-built`));
    if (term.crashed) {
      rec.status = 'failed';
      rec.reason = `render error panel: ${term.probe.errorPanel}`;
    } else if (!term.terminal) {
      rec.status = 'failed';
      rec.reason = 'build did not reach a terminal state';
    }
    // Press Play (button + Space shortcut) and measure
    rec.playDisabledBeforePlay = term.probe.playDisabled;
    await page.evaluate(() => {
      const b = document.querySelector('#cinematic-play');
      if (b && !b.disabled) b.click();
    });
    await sleep(1500);
    rec.fps = await page.evaluate(async () => {
      const f = window.__gevCinematic?.fps;
      return typeof f === 'function' ? await f() : null;
    });
    await sleep(4000);
    const afterPlay = await probe();
    rec.playbackAfterPlay = afterPlay.playback;
    rec.heapAfterPlayMb = afterPlay.heapMb;
    rec.errorPanelAfterPlay = afterPlay.errorPanel;
    rec.recoveryAfterPlay = afterPlay.render;
    rec.screenshots.push(await shot(`c${i}-playing`));
    if (afterPlay.errorPanel) {
      rec.status = 'failed';
      rec.reason = `render error panel during playback: ${afterPlay.errorPanel}`;
    }
    if (rec.status === 'running') rec.status = 'passed';
  } catch (err) {
    rec.status = 'failed';
    rec.reason = err?.message || String(err);
  } finally {
    rec.consoleErrorsDelta = consoleErrors.length - errBase;
    rec.consoleErrors = consoleErrors.slice(errBase, errBase + 12);
    rec.finishedUtc = nowUtc();
    bucket.push(rec);
    log(
      `cycle ${i} [${text.slice(0, 40)}] → ${rec.status} runState=${rec.runState} heap=${rec.heapBeforeMb}→${rec.heapAfterBuildMb}→${rec.heapAfterPlayMb} MB fps=${rec.fps} panel=${rec.errorPanel ? 'YES' : 'no'}`,
    );
    writeOut();
  }
}

function writeOut() {
  report.finishedUtc = nowUtc();
  const all = [...report.results, ...report.extra];
  report.summary = {
    passed: all.filter((r) => r.status === 'passed').length,
    failed: all.filter((r) => r.status === 'failed').length,
    renderErrorPanels: all.filter((r) => r.errorPanel || r.errorPanelAfterPlay)
      .length,
    heapSeriesMb: report.results.map((r) => r.heapAfterPlayMb),
    consoleErrorsTotal: consoleErrors.length,
    failedRequests: failedRequests.slice(0, 20),
  };
  writeFileSync(
    path.join(outDir, `qa-render-crash-${label}.json`),
    JSON.stringify(report, null, 2),
  );
  const rows = all.map(
    (r) =>
      `| ${r.cycle} | ${r.prompt.slice(0, 48)} | **${r.status}** | ${r.runState} | ${r.buildMs ?? '--'} | ${r.heapBeforeMb ?? '--'} → ${r.heapAfterBuildMb ?? '--'} → ${r.heapAfterPlayMb ?? '--'} | ${r.fps ?? '--'} | ${r.errorPanel || r.errorPanelAfterPlay ? 'YES' : 'no'} | ${r.recoveryAfterPlay ? JSON.stringify(r.recoveryAfterPlay) : '--'} | ${r.reason || ''} |`,
  );
  writeFileSync(
    path.join(outDir, `qa-render-crash-${label}.md`),
    `# Render-crash harness — ${label} (${report.startedUtc} → ${report.finishedUtc} UTC)\n\n` +
      `URL: ${appUrl}\nViewport: ${vw}x${vh}\nPrompt: ${prompt}\n\n` +
      `| # | prompt | status | runState | build ms | heap MB (before → built → playing) | FPS | error panel | recovery stats | reason |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n` +
      `Summary: ${JSON.stringify(report.summary)}\n`,
  );
}

try {
  log(`open ${appUrl}`);
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page
    .waitForFunction(
      () => Boolean(window.__gevCinematic && window.__gevCinematic.state),
      { timeout: 90000 },
    )
    .catch(() => log('debug api not found within 90 s'));
  await sleep(2000);
  await page
    .evaluate(() =>
      document.querySelector('#welcome-dismiss, [data-welcome-dismiss]')?.click?.(),
    )
    .catch(() => {});
  report.initialProbe = await probe();
  report.screenshotsInitial = [await shot('initial')];
  for (let i = 1; i <= cycles; i++) await runCycle(i, prompt, report.results);
  let k = cycles;
  for (const p of extraPrompts) await runCycle(++k, p, report.extra);
  // Space shortcut check on the final scene
  try {
    const pb0 = await page.evaluate(() => window.__gevCinematic?.playback?.state?.() || null);
    await page.evaluate(() => {
      document.querySelector('#cinematic-pause')?.click();
      document.activeElement?.blur?.();
    });
    await sleep(500);
    await page.keyboard.press('Space');
    await sleep(800);
    const pb1 = await page.evaluate(() => window.__gevCinematic?.playback?.state?.() || null);
    report.spaceShortcut = { before: pb0, afterPause: 'paused', afterSpace: pb1 };
  } catch (e) {
    report.spaceShortcut = { error: e.message };
  }
  report.screenshotsFinal = [await shot('final')];
  writeOut();
  log(`done: ${JSON.stringify(report.summary)}`);
} catch (err) {
  log(`fatal: ${err?.message || err}`);
  report.fatal = err?.message || String(err);
  writeOut();
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  hardKill();
}
