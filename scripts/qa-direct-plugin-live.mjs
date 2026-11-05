#!/usr/bin/env node
/**
 * Live acceptance for the 2026-11-02 direct-plugin + icon-family turn.
 *
 * Drives the deployed app in headless Chromium (puppeteer devDependency,
 * SwiftShader GL) and records, per viewport:
 *   - every legend/manifest icon sprite decodes with alpha 0 at all four
 *     corners (64 / 128 / 256 px) — no black squares;
 *   - the three user prompts ('Dubai Marina raid', 'boxing gym', 'Yas Mall
 *     crash') build a scene whose units fly in (billboards present, camera
 *     flew to the scene bounding sphere);
 *   - the Snapchat discovery panel completes through the direct plugin path
 *     (data-phase leaves 'loading', response advertises transport
 *     direct-plugin-query);
 *   - the complete browser network log, asserting ZERO requests whose URL
 *     matches /batch/i.
 * Writes acceptance.json / acceptance.md + PNGs into --out.
 *
 * Usage:
 *   node scripts/qa-direct-plugin-live.mjs --url https://… --out docs/evidence-2026-11-02-direct-plugin/qa-live
 *     [--viewports 1440x900,390x844] [--label after] [--timeout-sec 240] [--cap-min 40]
 *     [--prompts 'key=prompt text;key2=prompt'] [--skip-snapchat]
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
  args.out || 'docs/evidence-2026-11-02-direct-plugin/qa-live',
);
const label = args.label || 'after';
const viewports = (args.viewports || '1440x900,390x844')
  .split(',')
  .map((v) => v.split('x').map(Number));
const TIMEOUT_MS = Number(args['timeout-sec'] || 240) * 1000;
const PROMPTS = args.prompts
  ? args.prompts.split(';').map((p) => {
      const [key, text] = p.split('=');
      return [key.trim(), (text || key).trim()];
    })
  : [
      ['marina', 'Dubai Marina raid'],
      ['boxing', 'boxing gym'],
      ['yas', 'Yas Mall crash'],
    ];
const SKIP_SNAPCHAT = args['skip-snapchat'] === 'true';
mkdirSync(outDir, { recursive: true });
const nowUtc = () => new Date().toISOString();
const log = (m) => console.log(`[qa-direct ${nowUtc()}] ${m}`);
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

const report = {
  label,
  url: appUrl,
  startedAtUtc: nowUtc(),
  finishedAtUtc: null,
  checks: [],
  network: {},
  summary: {},
};
const record = (c) => {
  report.checks.push({ ...c, at: nowUtc() });
  log(`${c.status.toUpperCase().padEnd(7)} ${c.name} — ${c.detail}`);
};
const writeOut = () => {
  report.finishedAtUtc = nowUtc();
  const counts = { passed: 0, failed: 0, blocked: 0 };
  for (const c of report.checks) counts[c.status] = (counts[c.status] || 0) + 1;
  report.summary = counts;
  writeFileSync(
    path.join(outDir, 'acceptance.json'),
    JSON.stringify(report, null, 2),
  );
  let md = `# Live acceptance — direct plugin + icon family (${label})\n\n${appUrl}\n\nStarted ${report.startedAtUtc} · finished ${report.finishedAtUtc}\n\n| check | status | detail |\n|---|---|---|\n`;
  for (const c of report.checks)
    md += `| ${c.name} | ${c.status} | ${String(c.detail).replace(/\|/g, '/').slice(0, 400)} |\n`;
  md += `\n## Network\n\n`;
  for (const [vp, n] of Object.entries(report.network))
    md += `- ${vp}: ${n.total} requests, ${n.batchMatches.length} matching /batch/i, ${n.snapchatRequests.length} Snapchat discovery requests, ${n.ondemandRequests.length} direct OnDemand browser requests\n`;
  writeFileSync(path.join(outDir, 'acceptance.md'), md);
};

async function newPage(vw, vh) {
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1 });
  const requests = [];
  const consoleErrors = [];
  page.on('request', (req) =>
    requests.push({
      t: nowUtc(),
      method: req.method(),
      url: req.url(),
      type: req.resourceType(),
    }),
  );
  page.on('response', (res) => {
    const r = requests.find((x) => x.url === res.url() && x.status == null);
    if (r) r.status = res.status();
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror ${e.message}`));
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
  return { page, requests, consoleErrors };
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

async function iconAlphaCheck(page, vpTag) {
  const res = await page.evaluate(async () => {
    const m = await (await fetch('/scene-icons/manifest.json')).json();
    const bad = [];
    let checked = 0;
    for (const k of m.keys) {
      for (const p of [k.png, k.png2x, k.png4x].filter(Boolean)) {
        const img = new Image();
        img.src = `/scene-icons/${p}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const w = img.width;
        const h = img.height;
        for (const [px, py] of [
          [0, 0],
          [w - 1, 0],
          [0, h - 1],
          [w - 1, h - 1],
        ]) {
          checked += 1;
          if (x.getImageData(px, py, 1, 1).data[3] !== 0) bad.push(p);
        }
      }
    }
    return {
      version: m.version,
      keys: m.keys.length,
      checked,
      bad,
      newTypes: ['event_command_post', 'checkpoint_cordon_node', 'road_closed_barricade'].map(
        (t) => [t, m.elementTypeIcons[t], m.keys.some((k) => k.key === t)],
      ),
    };
  });
  record({
    name: `icon-sprites-transparent-${vpTag}`,
    status:
      res.version === 7 && res.keys >= 49 && res.bad.length === 0
        ? 'passed'
        : 'failed',
    detail: `manifest v${res.version} ${res.keys} keys · ${res.checked} corner samples alpha=0 · black-square files=${res.bad.length} · new types ${JSON.stringify(res.newTypes)}`,
  });
}

const probeFn = () => {
  const api = window.__gevCinematic;
  const viewer = window.__gevViewer;
  const root = document.querySelector('#incident-composer');
  const icons = [];
  const iconKeys = {};
  const collect = (entities) => {
    for (const e of entities || []) {
      if (e.billboard) {
        const img = e.billboard.image?.getValue?.(viewer.clock.currentTime);
        icons.push({
          id: e.id,
          w: e.billboard.width?.getValue?.(viewer.clock.currentTime),
          kind:
            img && typeof img === 'object' && img.tagName === 'CANVAS'
              ? 'canvas'
              : typeof img,
        });
        const k = String(e.id || '').replace(/^staging-/, '').replace(/-\d+$/, '');
        iconKeys[k] = (iconKeys[k] || 0) + 1;
      }
    }
  };
  if (viewer) {
    collect(viewer.entities?.values);
    const len = viewer.dataSources?.length || 0;
    for (let i = 0; i < len; i++) collect(viewer.dataSources.get(i).entities?.values);
  }
  const cam = viewer?.camera;
  const carto = cam?.positionCartographic;
  const legend = document.querySelector('#scene-legend');
  const legendItems = [...document.querySelectorAll('#scene-legend-list li')].map(
    (li) => [li.dataset.element, li.dataset.iconKey],
  );
  const sfp = document.querySelector('#scene-footage');
  return {
    composerState: root?.getAttribute('data-state') || null,
    runState: api?.state?.()?.runState || null,
    iconCount: icons.length,
    canvasIcons: icons.filter((i) => i.kind === 'canvas').length,
    iconKeys,
    cameraHeightM: carto ? Math.round(carto.height) : null,
    cameraLatLon: carto
      ? [
          +(carto.latitude * 57.29577951308232).toFixed(4),
          +(carto.longitude * 57.29577951308232).toFixed(4),
        ]
      : null,
    legend: Boolean(legend && !legend.hidden),
    legendItems,
    snapchat: sfp
      ? {
          hidden: sfp.hidden,
          phase: sfp.dataset.phase,
          text: sfp.innerText.replace(/\s+/g, ' ').slice(0, 400),
        }
      : null,
    footageState: window.__gevSceneFootage?.getState?.() || null,
  };
};

async function buildCheck(ctx, key, text, vpTag) {
  const { page } = ctx;
  const before = await page.evaluate(probeFn);
  const t0 = Date.now();
  const submitted = await page.evaluate(async (t) => {
    const input = document.querySelector('#incident-composer-input');
    const btn = document.querySelector('#incident-composer-submit');
    if (!input || !btn) return false;
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    return true;
  }, text);
  if (!submitted) {
    record({ name: `build-${key}-${vpTag}`, status: 'failed', detail: 'composer not found' });
    return null;
  }
  let p = null;
  while (Date.now() - t0 < TIMEOUT_MS) {
    await sleep(2500);
    p = await page.evaluate(probeFn);
    if (
      p.iconCount > 0 &&
      ['ready', 'done', 'complete', 'completed', 'playing', 'paused', 'partial', 'template', 'failed', 'error'].includes(
        String(p.composerState || p.runState),
      )
    )
      break;
    if (['failed', 'error'].includes(String(p.composerState))) break;
  }
  const ms = Date.now() - t0;
  const moved =
    JSON.stringify(before.cameraLatLon) !== JSON.stringify(p.cameraLatLon) ||
    before.cameraHeightM !== p.cameraHeightM;
  const ok = p.iconCount > 0 && moved && !['failed', 'error'].includes(String(p.composerState));
  const file = await shot(page, `${vpTag}-${key}-built`);
  record({
    name: `units-fly-in-${key}-${vpTag}`,
    status: ok ? 'passed' : 'failed',
    detail: `state=${p.composerState}/${p.runState} in ${ms} ms · billboards=${p.iconCount} (${p.canvasIcons} backplated canvases) · keys=${JSON.stringify(p.iconKeys).slice(0, 220)} · camera ${JSON.stringify(before.cameraLatLon)}@${before.cameraHeightM}m → ${JSON.stringify(p.cameraLatLon)}@${p.cameraHeightM}m · legend=${p.legend} ${JSON.stringify(p.legendItems).slice(0, 160)} · ${file}`,
  });
  return p;
}

async function snapchatPanelCheck(ctx, vpTag) {
  const { page, requests } = ctx;
  const t0 = Date.now();
  const started = await page.evaluate(() => {
    const api = window.__gevSceneFootage;
    if (!api) return 'no-api';
    api.open(
      {
        lat: 25.0786415,
        lon: 55.1352524,
        placeName: 'Dubai Marina',
        text: 'Dubai Marina raid',
        scope: 'balanced',
        force: true,
        standby: false,
      },
      'explicit',
    );
    return 'opened';
  });
  let p = null;
  while (Date.now() - t0 < TIMEOUT_MS) {
    await sleep(2500);
    p = await page.evaluate(probeFn);
    if (p.snapchat && p.snapchat.phase && !['idle', 'loading'].includes(p.snapchat.phase)) break;
  }
  const ms = Date.now() - t0;
  const snapReq = requests.filter((r) => /\/footage\/snapchat/.test(r.url));
  const file = await shot(page, `${vpTag}-snapchat-panel`);
  const transport = p?.footageState?.capabilities?.transport || null;
  const ok =
    started === 'opened' &&
    p?.snapchat &&
    !['idle', 'loading'].includes(p.snapchat.phase) &&
    snapReq.length >= 1;
  record({
    name: `snapchat-direct-plugin-panel-${vpTag}`,
    status: ok ? 'passed' : 'failed',
    detail: `${started} · phase=${p?.snapchat?.phase} in ${ms} ms · requests=${snapReq.map((r) => `${r.method} ${r.url.replace(appUrl, '')} → ${r.status}`).join('; ')} · transport=${transport} · panel="${p?.snapchat?.text?.slice(0, 200)}" · ${file}`,
  });
}

try {
  for (const [vw, vh] of viewports) {
    const vpTag = `${vw}x${vh}`;
    log(`viewport ${vpTag}`);
    const ctx = await newPage(vw, vh);
    const { page, requests, consoleErrors } = ctx;
    await shot(page, `${vpTag}-initial`);
    await iconAlphaCheck(page, vpTag);
    for (const [key, text] of PROMPTS) {
      await buildCheck(ctx, key, text, vpTag);
      // expand the legend for the screenshot
      await page
        .evaluate(() => {
          const b = document.querySelector('#scene-legend-toggle');
          if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
        })
        .catch(() => {});
      await sleep(500);
      await shot(page, `${vpTag}-${key}-legend`);
    }
    if (!SKIP_SNAPCHAT) await snapchatPanelCheck(ctx, vpTag);
    const batchMatches = requests.filter((r) => /batch/i.test(r.url));
    report.network[vpTag] = {
      total: requests.length,
      batchMatches,
      snapchatRequests: requests.filter((r) => /\/footage\/snapchat/.test(r.url)),
      ondemandRequests: requests.filter((r) => /on-demand\.io/.test(r.url)),
      consoleErrors: consoleErrors.slice(0, 20),
      log: requests,
    };
    record({
      name: `network-zero-batch-${vpTag}`,
      status: batchMatches.length === 0 && requests.length > 50 ? 'passed' : 'failed',
      detail: `${requests.length} browser requests · ${batchMatches.length} matching /batch/i · ${report.network[vpTag].ondemandRequests.length} direct browser→on-demand.io requests (expected 0: the key stays server-side) · consoleErrors=${consoleErrors.length}`,
    });
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
