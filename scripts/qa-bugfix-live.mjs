#!/usr/bin/env node
/**
 * Live acceptance harness for the 2026-11-02 bug-fix turn (track H).
 *
 * Drives the deployed app in headless Chromium (puppeteer, already a devDependency)
 * and records, per prompt × viewport:
 *   - composer terminal state + request count (exactly one network build per Build)
 *   - rendered scene: Cesium entity count across viewer.entities + all dataSources
 *   - console/page errors and failed requests
 *   - Play: clock.shouldAnimate toggles and unit positions change between two samples
 *   - icon billboards: count, pixel sizes, backplate presence
 *   - fallback paths: forced research/director/planner failure via window.__gevQaForce
 *   - Snapchat: the discovery response echoes the plugin id (server-side payload)
 * Writes acceptance.json / acceptance.md + a PNG per check into --out.
 *
 * Usage:
 *   node scripts/qa-bugfix-live.mjs --url https://… --out docs/evidence-2026-11-02-bugfix/qa-live-after
 *     [--viewports 1440x900,390x844] [--label after] [--timeout-sec 200] [--cap-min 40]
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
const outDir = path.resolve(
  args.out || 'docs/evidence-2026-11-02-bugfix/qa-live-after',
);
const label = args.label || 'after';
const timeoutMs = Math.max(30, Number(args['timeout-sec'] || 200)) * 1000;
const viewports = (args.viewports || '1440x900,390x844')
  .split(',')
  .map((v) => v.trim().split('x').map(Number));
const PROMPTS = [
  ['kanes', 'kanes boxing gym abu dhabi'],
  ['marina', 'im doinga. raid in the dubai marina'],
  ['yas', 'car crash outside yas mall'],
];
mkdirSync(outDir, { recursive: true });
const nowUtc = () => new Date().toISOString();
const log = (m) => console.log(`[qa-bugfix ${nowUtc()}] ${m}`);
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
  Number(args['cap-min'] || 40) * 60 * 1000,
).unref();

const checks = [];
const report = {
  url: appUrl,
  label,
  startedUtc: nowUtc(),
  finishedUtc: null,
  checks,
};
function record(check) {
  check.timestamp_utc = check.timestamp_utc || nowUtc();
  checks.push(check);
  log(`${check.status.toUpperCase()} ${check.name} ${check.detail || ''}`);
  writeOut();
}
function writeOut() {
  report.finishedUtc = nowUtc();
  report.summary = {
    passed: checks.filter((c) => c.status === 'passed').length,
    failed: checks.filter((c) => c.status === 'failed').length,
    blocked: checks.filter((c) => c.status === 'blocked').length,
  };
  writeFileSync(
    path.join(outDir, `acceptance-${label}.json`),
    JSON.stringify(report, null, 2),
  );
  const rows = checks.map(
    (c) =>
      `| ${c.name} | **${c.status}** | ${c.screenshot || ''} | ${c.timestamp_utc} | ${(c.detail || '').replace(/\|/g, '/').slice(0, 220)} |`,
  );
  writeFileSync(
    path.join(outDir, `acceptance-${label}.md`),
    `# Live acceptance — ${label} (${report.startedUtc} → ${report.finishedUtc} UTC)\n\nURL: ${appUrl}\n\n| check | status | screenshot | timestamp (UTC) | detail |\n|---|---|---|---|---|\n${rows.join('\n')}\n\nSummary: ${JSON.stringify(report.summary)}\n`,
  );
}

// ------------------------------------------------------------ page helpers
async function newPage(vw, vh) {
  const page = await browser.newPage();
  await page.setViewport({
    width: vw,
    height: vh,
    isMobile: vw < 700,
    hasTouch: vw < 700,
  });
  const consoleErrors = [];
  const failedRequests = [];
  const buildRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${nowUtc()} ${msg.text()}`);
  });
  page.on('pageerror', (err) =>
    consoleErrors.push(`${nowUtc()} PAGEERROR ${err?.message || err}`),
  );
  page.on('requestfailed', (req) =>
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }),
  );
  page.on('request', (req) => {
    const u = req.url();
    if (/scene-plans\/construct/.test(u))
      buildRequests.push({ url: u, t: nowUtc(), method: req.method() });
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page
    .waitForFunction(
      () =>
        Boolean(window.__gevCinematic && window.__gevCinematic.state) &&
        Boolean(document.querySelector('#incident-composer-input')),
      { timeout: 90000 },
    )
    .catch(() => log('debug api / composer not found within 90 s'));
  await sleep(1500);
  await page
    .evaluate(() =>
      document
        .querySelector('#welcome-dismiss, [data-welcome-dismiss]')
        ?.click?.(),
    )
    .catch(() => {});
  return { page, consoleErrors, failedRequests, buildRequests };
}

async function shot(page, name) {
  const file = `${label}-${name}.png`;
  try {
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
    return file;
  } catch (e) {
    log(`screenshot failed ${e.message}`);
    return null;
  }
}

const probeFn = () => {
  const api = window.__gevCinematic;
  const viewer = window.__gevViewer;
  const root = document.querySelector('#incident-composer');
  let ds = 0;
  const icons = [];
  const perSource = {};
  const collect = (entities, name) => {
    let n = 0;
    for (const e of entities || []) {
      n++;
      if (e.billboard) {
        const w = e.billboard.width?.getValue?.(viewer.clock.currentTime);
        const h = e.billboard.height?.getValue?.(viewer.clock.currentTime);
        const img = e.billboard.image?.getValue?.(viewer.clock.currentTime);
        icons.push({
          id: e.id,
          w,
          h,
          kind:
            img && typeof img === 'object' && img.tagName === 'CANVAS'
              ? 'canvas'
              : typeof img === 'string'
                ? img.startsWith('data:')
                  ? 'data-url'
                  : 'url'
                : typeof img,
        });
      }
    }
    perSource[name] = n;
    ds += n;
  };
  if (viewer) {
    collect(viewer.entities?.values, 'viewer.entities');
    const sources = viewer.dataSources;
    const len = sources?.length || 0;
    for (let i = 0; i < len; i++) {
      const s = sources.get(i);
      collect(s.entities?.values, s.name || `ds${i}`);
    }
  }
  const chip = document.querySelector('#incident-composer-stream-chip');
  const st = api?.state?.() || null;
  return {
    composerState: root?.getAttribute('data-state') || null,
    composerFallback: root?.getAttribute('data-fallback') || null,
    requestCount: root?.getAttribute('data-request-count') || null,
    runState: st?.runState || null,
    cinematicEntities: api?.scene?.()?.entities?.length ?? null,
    entityTotal: ds,
    perSource,
    icons: icons.slice(0, 80),
    iconCount: icons.length,
    playback: api?.playback?.state?.() || null,
    shouldAnimate: viewer?.clock?.shouldAnimate ?? null,
    clockRange: viewer?.clock?.clockRange ?? null,
    playDisabled: document.querySelector('#cinematic-play')?.disabled ?? null,
    composerPlay: document.querySelector('#incident-composer-play')
      ? !document.querySelector('#incident-composer-play').disabled
      : null,
    chip: chip?.textContent || null,
    chipTokens: chip?.getAttribute('data-tokens') || null,
    chipElapsed: chip?.getAttribute('data-elapsed-ms') || null,
    legend: Boolean(document.querySelector('#scene-legend')),
    legendExpanded:
      document.querySelector('#scene-legend')?.getAttribute('aria-expanded') ||
      null,
    badge:
      document
        .querySelector('[data-kind="scene-ready"]')
        ?.textContent?.slice(0, 200) || null,
    resultText:
      document
        .querySelector('#incident-composer-result')
        ?.innerText?.slice(0, 300) || null,
    errorPanel: Boolean(document.querySelector('.cesium-widget-errorPanel')),
  };
};

async function submitPrompt(page, text, { ctrlEnterToo = false } = {}) {
  return page.evaluate(
    async (t, ctrl) => {
      const input = document.querySelector('#incident-composer-input');
      const btn = document.querySelector('#incident-composer-submit');
      if (!input || !btn) return false;
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      if (ctrl) {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
          }),
        );
        btn.click();
      }
      return true;
    },
    text,
    ctrlEnterToo,
  );
}

async function waitTerminal(page) {
  const t0 = Date.now();
  let p = null;
  while (Date.now() - t0 < timeoutMs) {
    p = await page.evaluate(probeFn);
    if (['done', 'error', 'cancelled'].includes(p.composerState))
      return { terminal: true, probe: p, ms: Date.now() - t0 };
    await sleep(1000);
  }
  return { terminal: false, probe: p, ms: timeoutMs };
}

async function playCheck(page, tag, vpTag) {
  // Press the composer Play (user-facing) and the cinematic Play.
  const before = await page.evaluate(() => ({
    pos: window.__gevCinematic?.playback?.positionsSnapshot?.() || null,
    st: window.__gevCinematic?.playback?.state?.() || null,
    anim: window.__gevViewer?.clock?.shouldAnimate ?? null,
  }));
  await page.evaluate(() => {
    const b = document.querySelector('#incident-composer-play');
    if (b && !b.disabled) b.click();
    const c = document.querySelector('#cinematic-play');
    if (c && !c.disabled) c.click();
  });
  await sleep(4000);
  const mid = await page.evaluate(() => ({
    pos: window.__gevCinematic?.playback?.positionsSnapshot?.() || null,
    st: window.__gevCinematic?.playback?.state?.() || null,
    anim: window.__gevViewer?.clock?.shouldAnimate ?? null,
  }));
  await sleep(3000);
  const after = await page.evaluate(() => ({
    pos: window.__gevCinematic?.playback?.positionsSnapshot?.() || null,
    st: window.__gevCinematic?.playback?.state?.() || null,
    anim: window.__gevViewer?.clock?.shouldAnimate ?? null,
  }));
  let moved = 0,
    tracked = 0;
  if (mid.pos && after.pos) {
    for (const id of Object.keys(mid.pos)) {
      const a = mid.pos[id],
        b = after.pos[id];
      if (!a || !b) continue;
      tracked++;
      if (Math.abs(a.lat - b.lat) > 1e-7 || Math.abs(a.lon - b.lon) > 1e-7)
        moved++;
    }
  }
  const playing = mid.st?.state === 'playing' && mid.anim === true;
  const file = await shot(page, `${vpTag}-${tag}-playing`);
  // pause
  await page.evaluate(() =>
    document.querySelector('#cinematic-pause')?.click(),
  );
  await sleep(600);
  const paused = await page.evaluate(() => ({
    st: window.__gevCinematic?.playback?.state?.() || null,
    anim: window.__gevViewer?.clock?.shouldAnimate ?? null,
  }));
  record({
    name: `play-${tag}-${vpTag}`,
    status: playing && moved > 0 && paused.anim === false ? 'passed' : 'failed',
    screenshot: file,
    detail: `before=${before.st?.state}/${before.anim} playing=${playing} pos=${(mid.st?.positionSec || 0).toFixed(1)}→${(after.st?.positionSec || 0).toFixed(1)}s moved=${moved}/${tracked} pauseAnim=${paused.anim} range=${mid.st?.clockRange ?? ''}`,
  });
}

async function buildCheck(ctx, key, text, vpTag, opts = {}) {
  const { page, consoleErrors, buildRequests } = ctx;
  const errBase = consoleErrors.length;
  const reqBase = buildRequests.length;
  await page.evaluate((force) => {
    window.__gevQaForce = force || null;
  }, opts.force || null);
  const ok = await submitPrompt(page, text, {
    ctrlEnterToo: opts.ctrlEnterToo,
  });
  if (!ok) {
    record({
      name: `build-${key}-${vpTag}`,
      status: 'failed',
      detail: 'composer missing',
    });
    return null;
  }
  const t = await waitTerminal(page);
  await sleep(2500);
  const p = await page.evaluate(probeFn);
  const file = await shot(page, `${vpTag}-${key}-built`);
  const reqs = buildRequests.length - reqBase;
  const errs = consoleErrors.slice(errBase);
  const rendered = p.entityTotal > 0 && !p.errorPanel;
  const status =
    t.terminal && p.composerState === 'done' && rendered && errs.length === 0
      ? 'passed'
      : 'failed';
  record({
    name: `${opts.name || `build-${key}`}-${vpTag}`,
    status,
    screenshot: file,
    detail: `state=${p.composerState} fallback=${p.composerFallback || '-'} ms=${t.ms} entities=${p.entityTotal} (${JSON.stringify(p.perSource)}) icons=${p.iconCount} buildRequests=${reqs} requestCountAttr=${p.requestCount} chip="${p.chip}" errors=${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' | ').slice(0, 160) : ''} result="${(p.resultText || '').replace(/\s+/g, ' ').slice(0, 120)}"`,
    data: { probe: p, reqs, errs: errs.slice(0, 10), ms: t.ms },
  });
  if (opts.expectOneRequest) {
    record({
      name: `one-request-${key}-${vpTag}`,
      status: reqs === 1 ? 'passed' : 'failed',
      screenshot: file,
      detail: `network construct requests=${reqs} (click + Ctrl/Cmd+Enter fired back-to-back)`,
    });
  }
  return p;
}

async function iconCheck(p, key, vpTag, file) {
  const sizes = p.icons.map((i) => i.w).filter((w) => Number.isFinite(w));
  const min = sizes.length ? Math.min(...sizes) : null;
  const max = sizes.length ? Math.max(...sizes) : null;
  const canvasCount = p.icons.filter((i) => i.kind === 'canvas').length;
  record({
    name: `icons-${key}-${vpTag}`,
    status:
      sizes.length > 0 && min >= 24 && max <= 72
        ? 'passed'
        : sizes.length
          ? 'failed'
          : 'blocked',
    screenshot: file,
    detail: `billboards=${p.iconCount} sizePx=[${min},${max}] backplateCanvas=${canvasCount} kinds=${JSON.stringify(p.icons.slice(0, 6).map((i) => i.kind))} legend=${p.legend}/${p.legendExpanded}`,
  });
}

async function snapchatCheck(ctx, vpTag) {
  const { page } = ctx;
  const res = await page.evaluate(async () => {
    const payload = {
      place: 'Dubai Marina',
      lat: 25.0806,
      lon: 55.1397,
      scope: 'balanced',
    };
    try {
      const r = await fetch('/api/scenes/dubai-marina/footage/snapchat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, text: text.slice(0, 600), json };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  });
  const s = JSON.stringify(res.json || res.text);
  const hasPlugin = /plugin-1792945050/.test(s);
  record({
    name: `snapchat-plugin-echo-${vpTag}`,
    status: hasPlugin ? 'passed' : 'failed',
    detail: `HTTP ${res.status} pluginIdInResponse=${hasPlugin} body=${s.slice(0, 200)}`,
  });
}

// ----------------------------------------------------------------- main
try {
  for (const [vw, vh] of viewports) {
    const vpTag = `${vw}x${vh}`;
    log(`viewport ${vpTag}`);
    const ctx = await newPage(vw, vh);
    const { page } = ctx;
    await shot(page, `${vpTag}-initial`);
    for (const [key, text] of PROMPTS) {
      const p = await buildCheck(ctx, key, text, vpTag, {
        ctrlEnterToo: key === 'marina',
        expectOneRequest: key === 'marina',
      });
      if (!p) continue;
      const file = `${label}-${vpTag}-${key}-built.png`;
      await iconCheck(p, key, vpTag, file);
      if (vw >= 700 || key === 'marina') await playCheck(page, key, vpTag);
      await page.evaluate(() =>
        document.querySelector('#cinematic-pause')?.click(),
      );
    }
    if (vw >= 700) {
      // Fallback paths (forced through the QA hook; the server honours debugForce only for degradation).
      await buildCheck(
        ctx,
        'force-research',
        'car crash outside yas mall',
        vpTag,
        {
          name: 'fallback-geocoder-no-verified',
          force: { research: true },
        },
      );
      await buildCheck(
        ctx,
        'force-llm',
        'im doinga. raid in the dubai marina',
        vpTag,
        {
          name: 'fallback-llm-sse-fail',
          force: { director: true, planner: true },
        },
      );
      await buildCheck(
        ctx,
        'force-timeout',
        'kanes boxing gym abu dhabi',
        vpTag,
        {
          name: 'fallback-llm-timeout',
          force: { director: 'timeout', planner: 'timeout' },
        },
      );
      await snapchatCheck(ctx, vpTag);
    }
    await page.close().catch(() => {});
  }
  writeOut();
  log(`done ${JSON.stringify(report.summary)}`);
} catch (err) {
  log(`fatal ${err?.message || err}`);
  report.fatal = err?.message || String(err);
  writeOut();
} finally {
  await browser.close().catch(() => {});
  hardKill();
}
