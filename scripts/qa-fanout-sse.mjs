#!/usr/bin/env node
/**
 * Live preview QA for the fan-out + dynamic DSL + SSE streaming delivery
 * (2026-11-01). Drives the deployed app with the repo's puppeteer
 * devDependency + /usr/bin/chromium in its OWN process group, hard-kills the
 * whole group on every exit path and caps its wall-clock time.
 *
 *   node scripts/qa-fanout-sse.mjs --url https://<preview>.vercel.app \
 *     [--out docs/evidence-.../after] [--viewports 1440x900,390x844]
 *
 * Checks (per prompt): 0 construct requests while typing, exactly 1 per Build,
 * SSE stream events observed by the browser (mid-stream screenshot), staging
 * icons render from the new manifest, approximate/exact location badge instead
 * of the old 'verified, attributed geocoder candidate is required' failure,
 * window change → no new network request, voice module idle/ready, retry pill,
 * cancel, saved-scene restore, Snapchat discovery counts (balanced scope).
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
  args.out ||
    `docs/evidence-${new Date().toISOString().slice(0, 10)}-fanout-sse/after`,
);
const viewports = (args.viewports || '1440x900,390x844').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { name: v, width: w, height: h, mobile: w < 700 };
});
const prompts = (
  args.prompts ||
  'im doing a raid in the dubai marina|Burj Al Arab police raid|kanes boxing gym abu dhabi|Kanes Boxing Gym Abu Dhabi'
)
  .split('|')
  .map((p) => p.trim())
  .filter(Boolean);
const timeoutMs = Math.max(30, Number(args['timeout-sec'] || 330)) * 1000;
const snapTimeoutMs = Math.max(30, Number(args['snap-timeout-sec'] || 240)) * 1000;
mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[qa-fanout-sse ${new Date().toISOString()}] ${m}`);
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
setTimeout(
  () => {
    log('global timeout');
    hardKill();
    process.exit(124);
  },
  Number(args['cap-min'] || 40) * 60 * 1000,
).unref();

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
const isNoise = (t) =>
  NOISE.some((n) => String(t).toLowerCase().includes(n.toLowerCase()));

const results = {
  url: appUrl,
  startedUtc: nowUtc(),
  prompts: [],
  extra: {},
  summary: { pass: 0, fail: 0 },
};

async function shot(page, name) {
  const file = `${name}.png`;
  try {
    await page.screenshot({ path: path.join(outDir, file), type: 'png' });
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

/** Install network counters for construct/stream/footage requests. */
function watchNetwork(page, bucket) {
  const onReq = (req) => {
    try {
      const u = new URL(req.url());
      if (u.origin !== new URL(appUrl).origin) return;
      const p = u.pathname;
      if (p.includes('/scene-plans/construct/stream')) bucket.stream++;
      else if (p.includes('/scene-plans/construct')) bucket.constructJson++;
      else if (p.includes('/footage/snapchat')) bucket.snapchat++;
      else if (p.includes('/incidents/locate')) bucket.locate++;
      if (p.startsWith('/api/')) bucket.api++;
    } catch {}
  };
  page.on('request', onReq);
  return () => page.off('request', onReq);
}

async function driveBuild(page, prompt, timeout) {
  return page.evaluate(
    async (PROMPT, TIMEOUT) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const api = window.__gevIncidents;
      const input = document.querySelector('#incident-composer-input');
      const form = document.querySelector('#incident-composer');
      const out = {
        callsStream: 0,
        callsJson: 0,
        constructError: null,
        sseEvents: {},
        firstSeenMs: {},
        midStream: null,
      };
      let lastResult = null;
      const origStream = api.client.constructSceneStream;
      const origJson = api.client.constructScene;
      let t0 = 0;
      api.client.constructSceneStream = async function (payload, opts = {}) {
        out.callsStream++;
        const wrapped = {
          ...opts,
          onEvent: (evt) => {
            const k = evt?.event || 'message';
            out.sseEvents[k] = (out.sseEvents[k] || 0) + 1;
            if (out.firstSeenMs[k] === undefined)
              out.firstSeenMs[k] = Date.now() - t0;
            if (k === 'element_added' && out.sseEvents[k] === 20 && !out.midStream)
              out.midStream = {
                atMs: Date.now() - t0,
                displayedText: (
                  document.querySelector('.composer-stream-text')?.textContent || ''
                ).length,
                previewEntities:
                  window.__gevIncidents?.getState?.()?.sceneStream?.count ?? null,
              };
            opts.onEvent?.(evt);
          },
        };
        try {
          lastResult = await origStream.call(this, payload, wrapped);
          return lastResult;
        } catch (e) {
          out.constructError = String(e?.message || e);
          throw e;
        }
      };
      api.client.constructScene = async function (...a) {
        out.callsJson++;
        try {
          lastResult = await origJson.apply(this, a);
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
        out.callsAfterTyping = out.callsStream + out.callsJson;
        out.submitUtc = new Date().toISOString();
        t0 = Date.now();
        document.querySelector('#incident-composer-submit').click();
        await wait(500);
        while (
          Date.now() - t0 < TIMEOUT &&
          !(!api.composer.state.busy && ['done', 'error'].includes(form.dataset.state))
        )
          await wait(500);
        out.totalWallMs = Date.now() - t0;
        out.formState = form.dataset.state || null;
        out.timedOut = out.totalWallMs >= TIMEOUT && out.formState !== 'done';
        out.streamTimings = window.__gevLastStreamTimings || null;
        out.dataStreamTimings = form.dataset.streamTimings || null;
        out.chipText =
          document.querySelector('#incident-composer-stream-chip')?.textContent ||
          document.querySelector('.composer-stream-chip')?.textContent ||
          null;
        out.typedText = (
          document.querySelector('.composer-stream-text')?.textContent || ''
        ).length;
        out.resultText = form.querySelector('.incident-composer__done-text')?.textContent || null;
        out.errorText =
          form.querySelector('.incident-composer__message--error, [data-kind="retry-notice"]')
            ?.textContent || null;
        out.retryText = document.querySelector('#incident-composer-retry')?.textContent || null;
        out.retryHidden = document.querySelector('#incident-composer-retry')?.hidden ?? null;
        out.staging = lastResult?.staging
          ? {
              scenario: lastResult.staging.spec?.scenarioType || null,
              elementTypes: (lastResult.staging.spec?.elements || []).map((e) => e.type),
              model: lastResult.staging.model
                ? {
                    provider: lastResult.staging.model.provider,
                    id: lastResult.staging.model.id,
                    endpointId: lastResult.staging.model.endpointId,
                    latencyMs: lastResult.staging.model.latencyMs,
                    fallback: lastResult.staging.model.fallback,
                  }
                : null,
              timing: lastResult.staging.timing || null,
              layerCounts: Object.fromEntries(
                ['areas', 'lines', 'points', 'labels'].map((k) => [
                  k,
                  lastResult.staging.layers?.[k]?.features?.length ?? 0,
                ]),
              ),
              icons: [
                ...new Set(
                  (lastResult.staging.layers?.points?.features || [])
                    .map((f) => f?.properties?.icon)
                    .filter(Boolean),
                ),
              ],
              notes: (lastResult.staging.notes || []).length,
              timeline: (lastResult.staging.timeline || []).length,
            }
          : null;
        out.locationResolution = lastResult?.locationResolution
          ? {
              method: lastResult.locationResolution.method,
              precision: lastResult.locationResolution.precision,
              approximate: lastResult.locationResolution.approximate,
              confidence: lastResult.locationResolution.confidence,
              sourceCount: lastResult.locationResolution.sourceCount,
              name: lastResult.locationResolution.name,
            }
          : null;
        out.anchor = lastResult?.anchor || null;
        out.verification = lastResult?.plan?.verification?.status || null;
        const st = api.getState?.() || {};
        out.sceneStaging = st.sceneStaging
          ? {
              status: st.sceneStaging.status,
              counts: st.sceneStaging.counts,
              badgeVisible: st.sceneStaging.badgeVisible,
              badgeCount: st.sceneStaging.badgeCount,
            }
          : null;
        out.sceneStreamPreviewCount = st.sceneStream?.count ?? null;
      } catch (e) {
        out.driveError = String(e?.message || e);
      } finally {
        api.client.constructSceneStream = origStream;
        api.client.constructScene = origJson;
      }
      return out;
    },
    prompt,
    timeout,
  );
}

async function inspectMap(page) {
  return page.evaluate(() => {
    const viewer = window.__godsEyeView?.viewer;
    const Cesium = window.__godsEyeView?.Cesium || window.Cesium || null;
    const now = Cesium?.JulianDate?.now?.();
    const out = {
      stagingBillboards: 0,
      stagingEntities: 0,
      billboardImages: {},
      onScreenBillboards: 0,
      badgeCount: document.querySelectorAll('#scene-illustrative-badge').length,
      badgeVisible: false,
      locationBadge:
        document.getElementById('scene-panel-location-badge')?.textContent?.trim() || null,
      locationBadgeKind:
        document.getElementById('scene-panel-location-badge')?.dataset.kind || null,
      legendItems: [...document.querySelectorAll('#scene-panel-elements li[data-element]')].map(
        (li) => li.dataset.element,
      ),
      builtLine: document.getElementById('scene-panel-built')?.textContent?.trim() || null,
      voiceStatus: document.getElementById('od-voice-status')?.textContent?.trim() || null,
      tooltipPresent: Boolean(document.getElementById('scene-staging-tooltip')),
    };
    const badge = document.querySelector('#scene-illustrative-badge');
    // The badge is position:fixed (offsetParent is null by spec) — use its box.
    const bb = badge?.getBoundingClientRect?.();
    out.badgeVisible = Boolean(
      badge && !badge.hidden && bb && bb.width > 0 && bb.height > 0,
    );
    const ds = viewer?.dataSources;
    const w = viewer?.canvas?.clientWidth || 0,
      h = viewer?.canvas?.clientHeight || 0;
    for (let i = 0; ds && i < ds.length; i++) {
      const source = ds.get(i);
      if (source?.name !== 'scene-staging') continue;
      out.stagingEntities = (source.entities?.values || []).length;
      for (const ent of source.entities?.values || []) {
        const img = ent.billboard?.image?.getValue?.(now);
        if (!img) continue;
        out.stagingBillboards++;
        const key = String(img).split('/').pop().replace(/@2x|\.png/g, '');
        out.billboardImages[key] = (out.billboardImages[key] || 0) + 1;
        try {
          const pos = ent.position?.getValue?.(now);
          const c = pos && viewer.scene.cartesianToCanvasCoordinates(pos);
          if (c && c.x >= 0 && c.y >= 0 && c.x <= w && c.y <= h) out.onScreenBillboards++;
        } catch {}
      }
    }
    return out;
  });
}

async function timeWindowCheck(page) {
  const counters = { api: 0, stream: 0, constructJson: 0, snapchat: 0, locate: 0 };
  const stop = watchNetwork(page, counters);
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sel = document.querySelector('#incident-composer-window');
    if (!sel) return { ok: false, reason: 'no time select' };
    const before = window.__gevIncidents.getState?.()?.sceneStaging?.sceneId || null;
    const options = [...sel.options].map((o) => o.value);
    const next = options.find((v) => v !== sel.value && v !== 'historical') || options[0];
    sel.value = next;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(4000);
    const after = window.__gevIncidents.getState?.()?.sceneStaging?.sceneId || null;
    return { ok: true, selected: next, sameScene: before === after, before, after };
  });
  await sleep(1500);
  stop();
  return { ...r, networkAfterChange: counters };
}

async function cancelRetryCheck(page, prompt) {
  return page.evaluate(async (PROMPT) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const input = document.querySelector('#incident-composer-input');
    const form = document.querySelector('#incident-composer');
    const out = { steps: [] };
    input.focus();
    input.value = PROMPT;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await wait(300);
    document.querySelector('#incident-composer-submit').click();
    await wait(2500);
    out.busyBeforeCancel = window.__gevIncidents.composer.state.busy;
    const cancel = document.querySelector('#incident-composer-cancel');
    out.cancelVisible = Boolean(cancel && !cancel.hidden);
    cancel?.click();
    await wait(1200);
    out.stateAfterCancel = form.dataset.state;
    const retry = document.querySelector('#incident-composer-retry');
    out.retryVisibleAfterCancel = Boolean(retry && !retry.hidden);
    out.retryTextAfterCancel = retry?.textContent?.trim() || null;
    out.retryClass = retry?.className || null;
    const r = retry?.getBoundingClientRect?.();
    out.retryBox = r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    out.noticeText =
      form.querySelector('[data-kind="retry-notice"], .incident-composer__message--error, .incident-composer__message--info')
        ?.textContent?.slice(0, 200) || null;
    // Retry resubmits the identical snapshot: compare the text the composer holds.
    out.snapshotText = window.__gevIncidents.composer.state.text;
    return out;
  }, prompt);
}

async function snapchatCheck(page, timeout) {
  const counters = { api: 0, stream: 0, constructJson: 0, snapchat: 0, locate: 0 };
  const stop = watchNetwork(page, counters);
  const r = await page.evaluate(async (TIMEOUT) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const details = document.querySelector('#scene-snapchat-controls');
    if (details) details.open = true;
    const scope = document.querySelector('#scene-snapchat-scope');
    out.scopeOptions = scope ? [...scope.options].map((o) => o.value) : null;
    out.scopeDefault = scope?.value || null;
    const button = document.querySelector('#scene-snapchat-discover');
    out.discoverDisabled = button?.disabled ?? null;
    if (!button || button.disabled) return { ...out, skipped: 'discover disabled' };
    const t0 = Date.now();
    button.click();
    let status = null;
    while (Date.now() - t0 < TIMEOUT) {
      await wait(1000);
      status = document.querySelector('#scene-footage-status')?.textContent?.trim() || null;
      if (status && /verified ·|No .*footage|error|failed|timed out|unavailable/i.test(status))
        break;
    }
    out.elapsedMs = Date.now() - t0;
    out.status = status;
    out.clipCount = document.querySelectorAll('#scene-footage [data-clip-id], #scene-footage .sfp__clip, #scene-footage li[data-story-id]').length;
    out.unverifiedBadges = document.querySelectorAll('#scene-footage .sfp__badge--unverified').length;
    out.panelText = document.getElementById('scene-footage')?.innerText?.slice(0, 600) || null;
    return out;
  }, timeout);
  stop();
  return { ...r, network: counters };
}

async function saveRestoreCheck(page) {
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const name = document.querySelector('#scene-library-name');
    const save = document.querySelector('#scene-library-save');
    if (!name || !save) return { skipped: 'no scene library controls' };
    name.value = `qa-${Date.now()}`;
    name.dispatchEvent(new Event('input', { bubbles: true }));
    save.disabled = false;
    save.click();
    await wait(1500);
    out.saveStatus = document.querySelector('#scene-library-status')?.textContent?.trim() || null;
    const sel = document.querySelector('#scene-library-saved');
    out.savedOptions = sel ? sel.options.length - 1 : null;
    out.storageNotice = document.querySelector('#scene-library-storage-notice')?.textContent?.trim() || null;
    const key = Object.keys(localStorage).find((k) => /scene/i.test(k) && /librar|saved|scenes/i.test(k));
    out.storageKey = key || Object.keys(localStorage).filter((k) => /scene/i.test(k)).slice(0, 5);
    return out;
  });
}

async function restoreAfterReload(page) {
  await boot(page);
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const sel = document.querySelector('#scene-library-saved');
    if (!sel) return { skipped: 'no saved select' };
    out.savedOptions = sel.options.length - 1;
    const first = [...sel.options].find((o) => o.value !== '');
    if (!first) return { ...out, skipped: 'no saved scene' };
    sel.value = first.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(5000);
    out.status = document.querySelector('#scene-library-status')?.textContent?.trim() || null;
    const st = window.__gevIncidents.getState?.() || {};
    out.sceneStaging = st.sceneStaging
      ? { status: st.sceneStaging.status, counts: st.sceneStaging.counts, badgeVisible: st.sceneStaging.badgeVisible }
      : null;
    out.activeScene = document.querySelector('#scene-library')?.dataset.sceneId || null;
    out.panelTitle = document.getElementById('scene-panel-title')?.textContent?.trim() || null;
    return out;
  });
}

function evaluate(prompt, d, insp) {
  const failures = [];
  if (d.callsAfterTyping !== 0) failures.push(`callsAfterTyping=${d.callsAfterTyping}`);
  if (d.callsStream + d.callsJson < 1) failures.push('no construct call');
  if (d.callsStream !== 1) failures.push(`streamCalls=${d.callsStream}`);
  if (d.formState !== 'done') failures.push(`formState=${d.formState} err=${d.constructError || d.errorText}`);
  if (d.errorText && /verified, attributed geocoder candidate is required/i.test(d.errorText))
    failures.push('old geocoder failure reappeared');
  if (!d.staging) failures.push('staging missing');
  if (!(d.sseEvents?.element_added > 0)) failures.push('no element_added events');
  if (!(d.sseEvents?.narration_token > 0)) failures.push('no narration_token events');
  if (!(d.sseEvents?.done === 1)) failures.push('no done event');
  if (!insp.badgeVisible || insp.badgeCount !== 1)
    failures.push(`badge count=${insp.badgeCount} visible=${insp.badgeVisible}`);
  if (!insp.locationBadgeKind) failures.push('no location badge (exact/approximate)');
  // An "observation" scenario legitimately draws only zones + labels: cctv_signal
  // markers come solely from verified camera discovery and police units are not
  // invented for a plain place prompt. Icons are required for every other scenario.
  const scenario = d.staging?.scenario || null;
  if (scenario !== 'observation' && insp.stagingBillboards < 1)
    failures.push('no staging billboards');
  if (insp.stagingEntities < 1) failures.push('no staging entities drawn');
  return failures;
}

try {
  for (const vp of viewports) {
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
          networkFailures.push({ url: u.pathname + u.search, status: res.status(), utc: nowUtc() });
      } catch {}
    });
    const promptList = vp.mobile ? prompts.slice(0, 2) : prompts;
    for (const [idx, prompt] of promptList.entries()) {
      consoleErrors = [];
      networkFailures = [];
      const label = `[${vp.name}] "${prompt}"`;
      log(`${label} booting`);
      const booted = await boot(page);
      const entry = { prompt, viewport: vp.name, startedUtc: nowUtc(), booted };
      try {
        if (!booted) throw new Error('app did not boot');
        const counters = { api: 0, stream: 0, constructJson: 0, snapchat: 0, locate: 0 };
        const stop = watchNetwork(page, counters);
        // Mid-stream screenshot: poll from node while the page drives the build.
        const midShotName = `mid-stream-${slug(prompt)}-${vp.name}`;
        const midShot = (async () => {
          const t = Date.now();
          while (Date.now() - t < timeoutMs) {
            await sleep(700);
            const streaming = await page
              .evaluate(
                () =>
                  document.querySelector('.composer-stream-view')?.dataset.state === 'streaming' &&
                  (window.__gevIncidents?.getState?.()?.sceneStream?.count ?? 0) > 5,
              )
              .catch(() => false);
            if (streaming) {
              await sleep(400);
              return { file: await shot(page, midShotName), utc: nowUtc() };
            }
          }
          return null;
        })();
        log(`${label} typing + submitting (timeout ${timeoutMs / 1000}s)`);
        const d = await driveBuild(page, prompt, timeoutMs);
        const mid = await midShot;
        stop();
        log(
          `${label} state=${d.formState} stream=${d.callsStream} json=${d.callsJson} afterTyping=${d.callsAfterTyping} wall=${d.totalWallMs}ms sse=${JSON.stringify(d.sseEvents)} err=${d.constructError || ''}`,
        );
        await sleep(2500);
        const insp = await inspectMap(page);
        const finalShot = await shot(page, `after-${slug(prompt)}-${vp.name}`);
        const failures = evaluate(prompt, d, insp);
        Object.assign(entry, {
          ...d,
          network: counters,
          midStreamScreenshot: mid,
          inspect: insp,
          screenshot: finalShot,
          consoleErrors: consoleErrors.slice(0, 10),
          networkFailures: networkFailures.slice(0, 10),
          failures,
          finishedUtc: nowUtc(),
        });
        // Extra checks once per viewport on the first successful prompt.
        if (!failures.length && idx === 0) {
          log(`${label} time-window check`);
          entry.timeWindow = await timeWindowCheck(page);
          await shot(page, `after-time-window-${vp.name}`);
          if (!vp.mobile) {
            log(`${label} snapchat discovery (balanced)`);
            entry.snapchat = await snapchatCheck(page, snapTimeoutMs);
            await shot(page, `after-snapchat-${slug(prompt)}-${vp.name}`);
            log(`${label} save + reload + restore`);
            entry.save = await saveRestoreCheck(page);
            entry.restore = await restoreAfterReload(page);
            await shot(page, `after-restore-${vp.name}`);
            log(`${label} cancel/retry`);
            entry.cancelRetry = await cancelRetryCheck(page, prompt);
            await shot(page, `after-cancel-retry-${vp.name}`);
          }
        }
      } catch (err) {
        entry.failures = [`driver: ${err?.message}`];
        entry.screenshot = await shot(page, `after-${slug(prompt)}-${vp.name}-error`);
      }
      const pass = !entry.failures?.length;
      results.summary[pass ? 'pass' : 'fail']++;
      entry.result = pass ? 'PASS' : 'FAIL';
      results.prompts.push(entry);
      log(`${label} ${entry.result} ${entry.failures?.join('; ') || ''}`);
    }
    await page.close();
  }
} finally {
  results.finishedUtc = nowUtc();
  writeFileSync(path.join(outDir, 'qa-fanout-sse.json'), JSON.stringify(results, null, 2));
  const rows = results.prompts.map((e) =>
    [
      e.prompt.padEnd(36).slice(0, 36),
      e.viewport.padEnd(9),
      String(e.formState).padEnd(6),
      String(e.callsStream ?? '-').padEnd(3),
      String(e.callsAfterTyping ?? '-').padEnd(3),
      String(e.sseEvents?.element_added ?? '-').padEnd(5),
      String(e.sseEvents?.narration_token ?? '-').padEnd(5),
      String(e.streamTimings?.ttftMs ?? '-').padEnd(7),
      String(e.streamTimings?.firstElementMs ?? '-').padEnd(7),
      String(e.streamTimings?.doneMs ?? '-').padEnd(7),
      String(e.streamTimings?.tokensPerSec ?? '-').padEnd(5),
      String(e.locationResolution?.precision ?? '-').padEnd(10),
      String(e.inspect?.stagingBillboards ?? '-').padEnd(4),
      e.result,
    ].join(' '),
  );
  console.log(
    '\nprompt                               viewport  state  str typ elem  tok   ttft    1stEl   done    tps   precision  bb   result',
  );
  console.log(rows.join('\n'));
  console.log(`summary: pass=${results.summary.pass} fail=${results.summary.fail}`);
  console.log(`json: ${path.join(outDir, 'qa-fanout-sse.json')}`);
  try {
    await browser.close();
  } catch {}
  hardKill();
  process.exit(results.summary.fail ? 1 : 0);
}
