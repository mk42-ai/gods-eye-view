#!/usr/bin/env node
/**
 * Headless live-preview proof for the scene staging engine (spec -> geometry).
 *
 *   node scripts/qa-scene-staging.mjs --url <preview> --out <dir>
 *        [--mode before|after] [--viewports 1440x900,390x844]
 *        [--prompts "p1|p2|p3"] [--timeout-sec 300]
 *
 * Per prompt and viewport: boot, type the prompt (must NOT build), click
 * submit (must build exactly once), wait for form state done/error, then
 * capture staging spec/model/timing, layer counts, label font/halo/overlap
 * metrics from the 'scene-staging' Cesium data source, the illustrative
 * badge, the scene panel and console/network failures. One PNG per
 * prompt+viewport, one JSON per mode.
 *
 * --mode before : assertions run (expected to fail on the old build), exit 0.
 * --mode after  : exit 1 when any prompt fails.
 *
 * Uses the repo's puppeteer devDependency + /usr/bin/chromium; the browser is
 * started in its own process group and torn down on every exit path.
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
const mode = args.mode === 'after' ? 'after' : 'before';
const outDir = path.resolve(
  args.out ||
    `docs/evidence-${new Date().toISOString().slice(0, 10)}-staging/${mode}`,
);
const viewports = (args.viewports || '1440x900,390x844').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { name: v, width: w, height: h, mobile: w < 700 };
});
const prompts = (
  args.prompts ||
  'police raid at Burj Al Arab|kanes boxing gym abu dhabi police raid|im doing a raid in the dubai marina|Dubai Run on Sheikh Zayed Road'
)
  .split('|')
  .map((p) => p.trim())
  .filter(Boolean);
const timeoutMs = Math.max(30, Number(args['timeout-sec'] || 300)) * 1000;
mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[qa-staging ${new Date().toISOString()}] ${m}`);
const nowUtc = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

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
  protocolTimeout: 240000,
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
const cap = setTimeout(
  () => {
    log('global timeout');
    hardKill();
    process.exit(124);
  },
  Number(args['cap-min'] || 14) * 60 * 1000,
);

const SCENARIO_TYPES = [
  'police_raid',
  'route_closure',
  'crowd_event',
  'perimeter_cordon',
  'motorcade',
  'observation',
];
const ELEMENT_TYPES = [
  'inner_cordon',
  'outer_cordon',
  'approach_route',
  'egress_route',
  'staging_point',
  'perimeter_unit',
  'checkpoint',
  'cones',
  'barriers',
  'cctv_signal',
  'crowd_zone',
  'route_line',
  'start_finish',
];
const PARAM_KEYS = ['radius_m', 'count', 'spacing_m', 'direction'];
const NOISE = [
  'arcgisonline',
  'terrain.reearth',
  'google',
  'cesium ion',
  'cesium.com',
  'favicon',
  'net::ERR',
  'Failed to load resource',
];
const isNoise = (t) => NOISE.some((n) => String(t).toLowerCase().includes(n.toLowerCase()));

function validateSpec(spec) {
  const issues = [];
  if (!spec || typeof spec !== 'object') return { valid: false, issues: ['no spec'] };
  if (!SCENARIO_TYPES.includes(spec.scenarioType))
    issues.push(`scenarioType ${spec.scenarioType}`);
  if (!Array.isArray(spec.elements) || !spec.elements.length)
    issues.push('elements empty');
  for (const el of spec.elements || []) {
    if (!ELEMENT_TYPES.includes(el?.type)) issues.push(`element type ${el?.type}`);
    for (const k of Object.keys(el?.params || {}))
      if (!PARAM_KEYS.includes(k)) issues.push(`param ${k} on ${el?.type}`);
  }
  return { valid: issues.length === 0, issues };
}

const results = {
  url: appUrl,
  mode,
  startedUtc: nowUtc(),
  timeoutSec: timeoutMs / 1000,
  viewports: {},
  perPrompt: [],
  summary: { pass: 0, fail: 0 },
};

async function shot(page, name) {
  const file = `${name}.png`;
  try {
    await page
      .evaluate(() => {
        const v = window.__godsEyeView?.viewer;
        if (v) v.useDefaultRenderLoop = false;
      })
      .catch(() => {});
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
    await page
      .evaluate(() => {
        const v = window.__godsEyeView?.viewer;
        if (v) v.useDefaultRenderLoop = true;
      })
      .catch(() => {});
  } catch (err) {
    log(`screenshot ${file} failed: ${err?.message}`);
  }
  return file;
}

async function boot(page) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const ok = await page
    .waitForFunction(
      () => {
        const loading = document.querySelector('#loading-screen');
        return (
          (!loading || loading.classList.contains('hidden')) &&
          window.__gevIncidents?.client &&
          window.__gevIncidents?.composer &&
          document.querySelector('#incident-composer-input') &&
          window.__godsEyeView?.viewer
        );
      },
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false);
  await sleep(2000);
  await page
    .evaluate(() => {
      document
        .querySelector('#welcome-dismiss, [data-welcome-dismiss], #first-run-dismiss')
        ?.click?.();
      document.getElementById('scene-panel')?.classList.remove('collapsed');
    })
    .catch(() => {});
  await sleep(500);
  return ok;
}

// Runs inside the page: wrap constructScene, type, submit, wait, measure.
async function driveBuild(page, prompt, timeout) {
  return page.evaluate(
    async (PROMPT, TIMEOUT) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const api = window.__gevIncidents;
      const input = document.querySelector('#incident-composer-input');
      const form = document.querySelector('#incident-composer');
      const out = { calls: 0, constructError: null };
      let lastResult = null;
      const orig = api.client.constructScene;
      api.client.constructScene = async function (...a) {
        out.calls++;
        try {
          lastResult = await orig.apply(this, a);
          return lastResult;
        } catch (e) {
          out.constructError = String(e?.message || e);
          throw e;
        }
      };
      try {
        input.focus();
        input.value = PROMPT;
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
        );
        await wait(1500);
        out.callsAfterTyping = out.calls;
        out.submitUtc = new Date().toISOString();
        const t = Date.now();
        document.querySelector('#incident-composer-submit').click();
        await wait(500);
        while (
          Date.now() - t < TIMEOUT &&
          !(!api.composer.state.busy && ['done', 'error'].includes(form.dataset.state))
        )
          await wait(500);
        out.totalWallMs = Date.now() - t;
        out.formState = form.dataset.state || null;
        out.timedOut = out.totalWallMs >= TIMEOUT && out.formState !== 'done';
        const r0 = performance.now();
        for (let i = 0; i < 3; i++)
          await new Promise((r) => requestAnimationFrame(r));
        out.renderMs = Math.round(performance.now() - r0);
        out.staging = lastResult?.staging
          ? {
              spec: lastResult.staging.spec || null,
              model: lastResult.staging.model || null,
              timing: lastResult.staging.timing || null,
              unavailable: lastResult.staging.unavailable ?? null,
              badge: lastResult.staging.badge ?? null,
              layerCounts: Object.fromEntries(
                ['areas', 'lines', 'points', 'labels'].map((k) => [
                  k,
                  lastResult.staging.layers?.[k]?.features?.length ?? 0,
                ]),
              ),
              areaElements: (lastResult.staging.layers?.areas?.features || []).map(
                (f) => f?.properties?.element,
              ),
            }
          : null;
        out.resultKeys = lastResult ? Object.keys(lastResult) : [];
        const st = api.getState?.() || {};
        out.sceneStaging = st.sceneStaging
          ? {
              status: st.sceneStaging.status,
              scenario: st.sceneStaging.scenario,
              counts: st.sceneStaging.counts,
              badgeVisible: st.sceneStaging.badgeVisible,
              badgeCount: st.sceneStaging.badgeCount,
              model: st.sceneStaging.model,
              labels: (st.sceneStaging.labels || []).length,
            }
          : null;
      } catch (e) {
        out.driveError = String(e?.message || e);
      } finally {
        api.client.constructScene = orig;
      }
      return out;
    },
    prompt,
    timeout,
  );
}

// Runs inside the page: labels, badge, panel.
async function inspect(page) {
  return page.evaluate(() => {
    const viewer = window.__godsEyeView?.viewer;
    const Cesium = window.__godsEyeView?.Cesium || window.Cesium || null;
    const now = Cesium?.JulianDate?.now?.();
    const labels = [];
    let illustrativeLabelCount = 0;
    let citationTokenLabels = 0;
    let stagingSourceFound = false;
    const ds = viewer?.dataSources;
    for (let i = 0; ds && i < ds.length; i++) {
      const source = ds.get(i);
      const isStaging = source?.name === 'scene-staging';
      if (isStaging) stagingSourceFound = true;
      for (const ent of source?.entities?.values || []) {
        const text = ent.label?.text?.getValue?.(now);
        if (typeof text !== 'string') continue;
        if (/^ILLUSTRATIVE/i.test(text.trim())) illustrativeLabelCount++;
        if (/\[\d/.test(text)) citationTokenLabels++;
        if (!isStaging) continue;
        const show = ent.show !== false && ent.label.show?.getValue?.(now) !== false;
        const font = ent.label.font?.getValue?.(now) || '';
        const px = Number((/(\d+(?:\.\d+)?)px/.exec(font) || [])[1]) || null;
        const halo = ent.label.outlineWidth?.getValue?.(now);
        let box = null;
        try {
          const pos = ent.position?.getValue?.(now);
          const c = pos && viewer.scene.cartesianToCanvasCoordinates(pos);
          if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
            const w = text.length * (px || 13) * 0.56;
            box = { x: c.x - w / 2, y: c.y - 9, w, h: 18 };
          }
        } catch {}
        labels.push({ text, show, fontPx: px, halo: halo ?? null, box });
      }
    }
    const visible = labels.filter((l) => l.show);
    let overlaps = 0;
    const boxed = visible.filter((l) => l.box);
    for (let a = 0; a < boxed.length; a++)
      for (let b = a + 1; b < boxed.length; b++) {
        const p = boxed[a].box;
        const q = boxed[b].box;
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h)
          overlaps++;
      }
    const pxs = visible.map((l) => l.fontPx).filter((n) => n != null);
    const halos = visible.map((l) => l.halo).filter((n) => n != null);
    const badges = [...document.querySelectorAll('#scene-illustrative-badge')];
    const badgeVisible = badges.length === 1 && !badges[0].hidden;
    const panel = document.getElementById('scene-panel');
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const built = document.getElementById('scene-panel-built');
    const panelOut = panel
      ? {
          title: txt('#scene-panel-title'),
          summary: txt('#scene-panel-summary'),
          scenario: txt('#scene-panel-scenario'),
          locationBadge: document.getElementById('scene-panel-location-badge')?.dataset.kind || null,
          elements: [...document.querySelectorAll('#scene-panel-elements li[data-element]')].map(
            (li) => li.textContent.trim(),
          ),
          sourcesCount: document.querySelectorAll('#scene-panel-sources a').length,
          caveat: txt('#scene-panel-caveat'),
          builtLine: built?.textContent?.trim() || null,
          builtLatencyMs: built?.dataset.latencyMs ?? null,
          builtTotalMs: built?.dataset.totalMs ?? null,
          hasCitationTokens: /\[\d+(,\d+)*\]/.test(panel.innerText || ''),
        }
      : null;
    return {
      stagingSourceFound,
      labelCount: labels.length,
      visibleLabelCount: visible.length,
      labelTexts: visible.map((l) => l.text).slice(0, 20),
      minLabelPx: pxs.length ? Math.min(...pxs) : null,
      minHalo: halos.length ? Math.min(...halos) : null,
      labelOverlaps: overlaps,
      projectedLabels: boxed.length,
      badgeCount: badges.length,
      badgeVisible,
      illustrativeLabelCount,
      citationTokenLabels,
      panel: panelOut,
    };
  });
}

function evaluate(prompt, d, insp) {
  const failures = [];
  const staging = d.staging;
  const spec = staging?.spec;
  const specCheck = validateSpec(spec);
  if (d.callsAfterTyping !== 0) failures.push(`callsAfterTyping=${d.callsAfterTyping}`);
  if (d.calls !== 1) failures.push(`constructCalls=${d.calls}`);
  if (d.formState !== 'done') failures.push(`formState=${d.formState}`);
  if (!staging) failures.push('staging missing');
  else if (!specCheck.valid) failures.push(`spec invalid: ${specCheck.issues.join('; ')}`);
  if (/raid/i.test(prompt)) {
    const lines = staging?.layerCounts?.lines ?? 0;
    const els = staging?.areaElements || [];
    if (lines < 1) failures.push(`raid lines=${lines}`);
    if (!els.includes('inner_cordon') || !els.includes('outer_cordon'))
      failures.push(`raid cordons=${els.join(',') || 'none'}`);
  }
  if (insp.labelOverlaps !== 0) failures.push(`labelOverlaps=${insp.labelOverlaps}`);
  if (insp.minLabelPx == null || insp.minLabelPx < 12) failures.push(`minLabelPx=${insp.minLabelPx}`);
  if (insp.minHalo == null || insp.minHalo < 1.5) failures.push(`minHalo=${insp.minHalo}`);
  if (!(insp.badgeCount === 1 && insp.badgeVisible))
    failures.push(`badge count=${insp.badgeCount} visible=${insp.badgeVisible}`);
  if (insp.illustrativeLabelCount !== 0)
    failures.push(`illustrativeLabels=${insp.illustrativeLabelCount}`);
  if (insp.citationTokenLabels !== 0) failures.push(`citationTokenLabels=${insp.citationTokenLabels}`);
  if (!insp.panel) failures.push('scene-panel missing');
  else if (insp.panel.hasCitationTokens) failures.push('panel has citation tokens');
  return { failures, specCheck };
}

try {
  for (const vp of viewports) {
    results.viewports[vp.name] = { width: vp.width, height: vp.height, prompts: [] };
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs + 60000);
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    let consoleErrors = [];
    let networkFailures = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isNoise(msg.text())) consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (e) => {
      if (!isNoise(e?.message)) consoleErrors.push(`pageerror: ${String(e?.message).slice(0, 300)}`);
    });
    page.on('response', (res) => {
      try {
        const u = new URL(res.url());
        if (res.status() >= 400 && u.pathname.startsWith('/api/') && u.origin === new URL(appUrl).origin)
          networkFailures.push({ url: u.pathname + u.search, status: res.status() });
      } catch {}
    });

    for (const prompt of prompts) {
      consoleErrors = [];
      networkFailures = [];
      const label = `[${vp.name}] "${prompt}"`;
      log(`${label} booting`);
      const booted = await boot(page);
      log(`${label} booted=${booted}`);
      const entry = {
        prompt,
        viewport: vp.name,
        startedUtc: nowUtc(),
        booted,
      };
      try {
        if (!booted) throw new Error('app did not boot');
        log(`${label} typing + submitting (timeout ${timeoutMs / 1000}s)`);
        const d = await driveBuild(page, prompt, timeoutMs);
        log(
          `${label} formState=${d.formState} calls=${d.calls} afterTyping=${d.callsAfterTyping} wall=${d.totalWallMs}ms staging=${d.staging ? 'yes' : 'no'}`,
        );
        await sleep(2500);
        const insp = await inspect(page);
        const { failures, specCheck } = evaluate(prompt, d, insp);
        const screenshot = await shot(page, `${mode}-${slug(prompt)}-${vp.name}`);
        Object.assign(entry, {
          callsAfterTyping: d.callsAfterTyping,
          constructCalls: d.calls,
          constructError: d.constructError,
          driveError: d.driveError || null,
          formState: d.formState,
          timedOut: d.timedOut,
          spec: d.staging?.spec || null,
          specValid: specCheck.valid,
          specIssues: specCheck.issues,
          modelUsed: d.staging?.model || null,
          timing: d.staging?.timing || null,
          specMs: d.staging?.timing?.specMs ?? null,
          geometryMs: d.staging?.timing?.geometryMs ?? null,
          renderMs: d.renderMs ?? null,
          totalMs: d.staging?.timing?.totalMs ?? null,
          totalWallMs: d.totalWallMs,
          layerCounts: d.staging?.layerCounts || null,
          raidAssertions: /raid/i.test(prompt)
            ? {
                lines: d.staging?.layerCounts?.lines ?? 0,
                innerCordon: (d.staging?.areaElements || []).includes('inner_cordon'),
                outerCordon: (d.staging?.areaElements || []).includes('outer_cordon'),
              }
            : null,
          sceneStaging: d.sceneStaging,
          resultKeys: d.resultKeys,
          labelFontPx: insp.minLabelPx,
          haloWidth: insp.minHalo,
          labelOverlaps: insp.labelOverlaps,
          labelCount: insp.labelCount,
          visibleLabelCount: insp.visibleLabelCount,
          projectedLabels: insp.projectedLabels,
          labelTexts: insp.labelTexts,
          stagingSourceFound: insp.stagingSourceFound,
          badgeCount: insp.badgeCount,
          badgeVisible: insp.badgeVisible,
          illustrativeLabelCount: insp.illustrativeLabelCount,
          citationTokenLabels: insp.citationTokenLabels,
          panel: insp.panel,
          consoleErrors: consoleErrors.slice(0, 20),
          networkFailures: networkFailures.slice(0, 20),
          screenshot,
          pass: failures.length === 0,
          failures,
        });
      } catch (err) {
        entry.pass = false;
        entry.failures = [`threw: ${err?.message || err}`];
        entry.screenshot = await shot(page, `${mode}-${slug(prompt)}-${vp.name}`);
      }
      entry.finishedUtc = nowUtc();
      results.perPrompt.push(entry);
      results.viewports[vp.name].prompts.push(prompt);
      results.summary[entry.pass ? 'pass' : 'fail'] += 1;
      log(`${label} ${entry.pass ? 'PASS' : 'FAIL'} ${entry.failures.join(' | ')}`);
    }
    await page.close().catch(() => {});
  }
} catch (err) {
  log(`fatal: ${err?.stack || err}`);
  results.fatal = String(err?.message || err);
} finally {
  results.finishedUtc = nowUtc();
  const jsonPath = path.join(outDir, `qa-scene-staging-${mode}.json`);
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
  console.log('');
  console.log(
    `${pad('prompt', 36)} ${pad('viewport', 9)} ${pad('state', 6)} ${pad('specMs', 7)} ${pad('geomMs', 7)} ${pad('renderMs', 8)} ${pad('wallMs', 7)} ${pad('model', 22)} result`,
  );
  for (const p of results.perPrompt)
    console.log(
      `${pad(p.prompt, 36)} ${pad(p.viewport, 9)} ${pad(p.formState, 6)} ${pad(p.specMs, 7)} ${pad(p.geometryMs, 7)} ${pad(p.renderMs, 8)} ${pad(p.totalWallMs, 7)} ${pad(p.modelUsed ? `${p.modelUsed.provider}/${p.modelUsed.id}` : '-', 22)} ${p.pass ? 'PASS' : 'FAIL: ' + (p.failures || []).join(' | ')}`,
    );
  console.log(`summary: pass=${results.summary.pass} fail=${results.summary.fail} mode=${mode}`);
  console.log(`json: ${jsonPath}`);
  clearTimeout(cap);
  await browser.close().catch(() => {});
  hardKill();
  const exitCode = mode === 'after' && (results.summary.fail > 0 || results.fatal) ? 1 : 0;
  process.exit(exitCode);
}
