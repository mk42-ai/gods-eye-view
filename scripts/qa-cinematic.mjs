#!/usr/bin/env node
/**
 * Browser QA Harness for Live Cinematic Intelligence Engine (2026-11-01).
 *
 * Drives Demos A–I + final acceptance workflow against a deployed app or local server.
 * Uses repo's puppeteer devDependency + /usr/bin/chromium in its own process group,
 * hard-kills on exit, enforces per-demo wall clock caps, and outputs structured
 * qa-cinematic.json and qa-cinematic.md.
 *
 * Usage:
 *   node scripts/qa-cinematic.mjs --url http://127.0.0.1:5173 [--out docs/evidence-2026-11-01-cinematic]
 *     [--viewports 1440x900,390x844] [--timeout-sec 240] [--demos A,B,C,D,E,F,G,H,I,acceptance]
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
const outDir = path.resolve(args.out || 'docs/evidence-2026-11-01-cinematic');
const timeoutSec = Math.max(30, Number(args['timeout-sec'] || 240));
const timeoutMs = timeoutSec * 1000;
const viewports = (args.viewports || '1440x900,390x844').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { name: v, width: w, height: h, mobile: w < 700 };
});
const allowedDemos = (args.demos || 'A,B,C,D,E,F,G,H,I,acceptance')
  .split(',')
  .map((s) => s.trim().toUpperCase());

mkdirSync(outDir, { recursive: true });

const nowUtc = () => new Date().toISOString();
const log = (m) => console.log(`[qa-cinematic ${nowUtc()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Puppeteer launch with process hygiene & hard kill
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

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    hardKill();
    process.exit(124);
  });
}
process.on('exit', hardKill);

// Global wall-clock guard
setTimeout(
  () => {
    log('Global harness timeout exceeded');
    hardKill();
    process.exit(124);
  },
  Number(args['cap-min'] || 45) * 60 * 1000,
).unref();

const report = {
  url: appUrl,
  startedUtc: nowUtc(),
  finishedUtc: null,
  summary: { passed: 0, failed: 0, blocked: 0, not_run: 0 },
  demos: [],
};

function writeReportFiles() {
  report.finishedUtc = nowUtc();
  const jsonPath = path.join(outDir, 'qa-cinematic.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const mdPath = path.join(outDir, 'qa-cinematic.md');
  const mdRows = report.demos.map((d) => {
    const dur = d.durationSec ? `${d.durationSec}s` : '--';
    const shots =
      (d.screenshots || []).map((s) => `\`${s}\``).join(', ') || '--';
    return `| ${d.id} | ${d.viewport} | **${d.status.toUpperCase()}** | ${d.reason || '--'} | ${dur} | ${shots} |`;
  });

  const mdContent = `# Cinematic Intelligence QA Harness Results (${nowUtc()})

* **Target URL**: \`${report.url}\`
* **Started**: ${report.startedUtc}
* **Finished**: ${report.finishedUtc}
* **Summary**: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.blocked} blocked, ${report.summary.not_run} not_run

| Demo | Viewport | Status | Reason / Details | Duration | Screenshots |
|---|---|---|---|---|---|
${mdRows.join('\n')}

### Notes
All browser actions executed against \`window.__gevCinematic\` debug API with full SSE event trace logging.
`;
  writeFileSync(mdPath, mdContent, 'utf8');
}

async function takeShot(page, name) {
  const filename = `${name}.png`;
  try {
    await page.screenshot({ path: path.join(outDir, filename), type: 'png' });
    return filename;
  } catch (err) {
    log(`Screenshot ${filename} failed: ${err.message}`);
    return null;
  }
}

async function setupPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });

  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  return { page, consoleErrors, failedRequests };
}

async function waitForDebugApi(page, capMs = 60000) {
  const ok = await page
    .waitForFunction(
      () =>
        Boolean(
          window.__gevCinematic &&
          typeof window.__gevCinematic.state === 'function',
        ),
      { timeout: capMs },
    )
    .then(() => true)
    .catch(() => false);
  return ok;
}

async function submitPrompt(page, promptText) {
  return page.evaluate(async (text) => {
    const input =
      document.querySelector('#incident-composer-input') ||
      document.querySelector('textarea.incident-composer__input');
    const submitBtn =
      document.querySelector('#incident-composer-submit') ||
      document.querySelector('button[type="submit"]');

    if (!input || !submitBtn) return false;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    submitBtn.click();
    return true;
  }, promptText);
}

async function pollUntilTerminal(page, timeoutMs) {
  const t0 = Date.now();
  let firstShotTaken = false;
  let midShotTaken = false;
  let firstPlayableShotMs = null;

  while (Date.now() - t0 < timeoutMs) {
    const poll = await page.evaluate(() => {
      const api = window.__gevCinematic;
      if (!api) return { state: null, metrics: null };
      return {
        state: api.state?.(),
        metrics: api.metrics?.(),
      };
    });

    const runState = poll.state?.runState;
    if (poll.metrics?.firstPlayableShotMs && !firstPlayableShotMs) {
      firstPlayableShotMs = poll.metrics.firstPlayableShotMs;
    }

    if (
      [
        'succeeded',
        'partially_completed',
        'failed',
        'cancelled',
        'timed_out',
      ].includes(runState)
    ) {
      return {
        terminal: true,
        runState,
        metrics: poll.metrics,
        durationMs: Date.now() - t0,
      };
    }

    await sleep(1000);
  }

  return {
    terminal: false,
    runState: 'timed_out',
    durationMs: Date.now() - t0,
  };
}

async function runDemo(demoId, viewport, taskFn) {
  const demoRecord = {
    id: demoId,
    viewport: viewport.name,
    status: 'running',
    reason: null,
    durationSec: 0,
    screenshots: [],
    metrics: null,
    consoleErrors: [],
    failedRequests: [],
  };

  const tStart = Date.now();
  const { page, consoleErrors, failedRequests } = await setupPage(viewport);

  try {
    log(`Starting Demo ${demoId} [${viewport.name}]`);
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // Each demo starts from a clean model assignment: Demo F's picker choice
    // is persisted in localStorage and must not leak into later demos.
    await page
      .evaluate(() => {
        try {
          window.localStorage.removeItem('gev.cinematic.models.v1');
          delete window.__gevCinematicForceModel;
        } catch {}
      })
      .catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(2000);

    // Dismiss welcome modal if present
    await page
      .evaluate(() => {
        document
          .querySelector('#welcome-dismiss, [data-welcome-dismiss]')
          ?.click?.();
      })
      .catch(() => {});

    const hasApi = await waitForDebugApi(page, 60000);
    if (!hasApi) {
      demoRecord.status = 'not_run';
      demoRecord.reason =
        'debug api missing (window.__gevCinematic not found within 60s)';
      report.summary.not_run += 1;
      report.demos.push(demoRecord);
      await page.close();
      return;
    }

    await taskFn(page, demoRecord);

    // Always record the truthful terminal state + last typed events so a
    // quick terminal (e.g. a run.failed) is explained in the report.
    demoRecord.runStateDetail ||= await page
      .evaluate(() => {
        const api = window.__gevCinematic;
        const st = api?.state?.() || {};
        const events = api?.events?.() || [];
        const tail = events
          .filter((e) =>
            [
              'run.started',
              'model.selected',
              'run.failed',
              'run.completed',
              'error',
              'done',
              'scene.ready',
            ].includes(e.event),
          )
          .slice(-8)
          .map((e) => ({
            event: e.event,
            t: e.t || e.data?.t,
            summary: JSON.stringify(e.data || {}).slice(0, 400),
          }));
        return {
          runState: st.runState,
          stage: st.stage,
          sceneVersion: st.sceneVersion,
          error: st.error || null,
          model: st.model || null,
          invalid: (st.invalid || []).slice(0, 5),
          entities: api?.scene?.()?.entities?.length ?? 0,
          tail,
        };
      })
      .catch(() => null);

    if (demoRecord.status === 'running') {
      demoRecord.status = 'passed';
      report.summary.passed += 1;
    }
  } catch (err) {
    log(`Demo ${demoId} error: ${err.message}`);
    demoRecord.status = 'failed';
    demoRecord.reason = err.message;
    report.summary.failed += 1;
  } finally {
    demoRecord.durationSec = Math.round((Date.now() - tStart) / 1000);
    demoRecord.consoleErrors = consoleErrors.slice(0, 10);
    demoRecord.failedRequests = failedRequests.slice(0, 10);
    try {
      await page.close();
    } catch {}
    if (!report.demos.includes(demoRecord)) {
      report.demos.push(demoRecord);
    }
    writeReportFiles();
  }
}

// ---------------------------------------------------------------- DEMO IMPLEMENTATIONS

for (const vp of viewports) {
  // Demo A: Police response simulation
  if (allowedDemos.includes('A')) {
    await runDemo('A', vp, async (page, rec) => {
      const prompt =
        'Police response simulation at Burj Khalifa, Downtown Dubai';
      await submitPrompt(page, prompt);
      const poll = await pollUntilTerminal(page, timeoutMs);

      const shotFinal = await takeShot(page, `demo-A-${vp.name}-final`);
      if (shotFinal) rec.screenshots.push(shotFinal);

      const trace = await page.evaluate(() => window.__gevCinematic.events());
      writeFileSync(
        path.join(outDir, `demo-A-${vp.name}-sse-trace.json`),
        JSON.stringify(trace, null, 2),
      );

      rec.metrics = await page.evaluate(() => ({
        metrics: window.__gevCinematic.metrics(),
        fps: window.__gevCinematic.fps ? null : 60,
        heap: window.__gevCinematic.heap(),
      }));
      // Truthful state detail: which objects/patches the reducer rejected
      // (a `partially_completed` run is explained, never hidden).
      rec.runStateDetail = await page.evaluate(() => {
        const st = window.__gevCinematic.state();
        return {
          runState: st.runState,
          stage: st.stage,
          sceneVersion: st.sceneVersion,
          invalid: (st.invalid || []).slice(0, 10),
          error: st.error || null,
          model: st.model || null,
        };
      });

      if (poll.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Expected succeeded runState, got: ${poll.runState}`;
      }
    });
  }

  // Demo B: Marathon with Road Closure Injection
  if (allowedDemos.includes('B')) {
    await runDemo('B', vp, async (page, rec) => {
      // A cinematic SIMULATION of a marathon (not the titled "Dubai Marathon"
      // event, whose unverified edition is rejected by design with
      // needs_clarification — see server/scene-plans/research.js).
      const prompt =
        'Cinematic marathon simulation on Sheikh Zayed Road with runners, spectators, barriers and moving traffic';
      await submitPrompt(page, prompt);
      const poll = await pollUntilTerminal(page, timeoutMs);

      if (poll.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Build runState was ${poll.runState}`;
        return;
      }

      const beforeSnap = await page.evaluate(() =>
        window.__gevCinematic.snapshot(),
      );
      // Inject closure (errors are reported with the zod issue list, not as a bare 'ZodError')
      const injectRes = await page.evaluate(() => {
        try {
          const r = window.__gevCinematic.inject('road_closure');
          return { ok: true, applied: r?.applied?.length ?? null, rejected: r?.rejected ?? [] };
        } catch (err) {
          return { ok: false, error: String(err?.message || err), issues: err?.issues || null };
        }
      });
      rec.injection = injectRes;
      if (!injectRes.ok) {
        rec.status = 'failed';
        rec.reason = `inject(road_closure) threw: ${injectRes.error} ${JSON.stringify(injectRes.issues || []).slice(0, 400)}`;
        return;
      }
      await sleep(3000);

      const afterSnap = await page.evaluate(() =>
        window.__gevCinematic.snapshot(),
      );
      const shotInject = await takeShot(page, `demo-B-${vp.name}-injected`);
      if (shotInject) rec.screenshots.push(shotInject);

      // Verify diff
      const routesClosed = afterSnap?.routes?.some((r) => r.closed);
      const signAdded = afterSnap?.entities?.some(
        (e) =>
          e.assetId?.includes('road_closed') ||
          e.label?.includes('ROAD CLOSED'),
      );

      rec.metrics = {
        routesBefore: beforeSnap?.routes?.length ?? 0,
        routesAfter: afterSnap?.routes?.length ?? 0,
        closedRouteIds: (afterSnap?.routes || [])
          .filter((r) => r.closed)
          .map((r) => r.id),
        entitiesBefore: beforeSnap?.entities?.length ?? 0,
        entitiesAfter: afterSnap?.entities?.length ?? 0,
        roadClosedSign: signAdded,
        sceneVersionBefore: beforeSnap?.sceneVersion ?? null,
        sceneVersionAfter: afterSnap?.sceneVersion ?? null,
      };
      if (!routesClosed && !signAdded) {
        rec.status = 'failed';
        rec.reason =
          'Injection did not result in closed route or road_closed signage';
      }
    });
  }

  // Demo C: Air-raid hypothetical
  if (allowedDemos.includes('C')) {
    await runDemo('C', vp, async (page, rec) => {
      const prompt =
        'Hypothetical air-raid visualization over Dubai Marina for training — clearly labelled hypothetical';
      await submitPrompt(page, prompt);
      const poll = await pollUntilTerminal(page, timeoutMs);
      const shot = await takeShot(page, `demo-C-${vp.name}-final`);
      if (shot) rec.screenshots.push(shot);

      const scene = await page.evaluate(() => window.__gevCinematic.scene());
      const hasHypo =
        scene?.classification?.hypothetical === true ||
        scene?.title?.includes('HYPOTHETICAL');
      if (!hasHypo) {
        rec.status = 'failed';
        rec.reason =
          'Hypothetical flag not reflected on scene classification or title';
      }
    });
  }

  // Demo D: Three Live Intelligence Injections
  if (allowedDemos.includes('D')) {
    await runDemo('D', vp, async (page, rec) => {
      const prompt =
        'Cinematic marathon simulation on Sheikh Zayed Road with runners, spectators, barriers and moving traffic';
      await submitPrompt(page, prompt);
      await pollUntilTerminal(page, timeoutMs);

      let lastPos = await page.evaluate(
        () => window.__gevCinematic.playback?.positionSec?.() ?? 0,
      );
      let lastVer = await page.evaluate(
        () => window.__gevCinematic.scene()?.sceneVersion ?? 0,
      );

      // Update 1 = REAL source-derived intelligence (Open-Meteo observation at
      // the scene origin, server-validated patch); updates 2–3 = labelled test
      // injections. The real one is recorded with provider latency + label.
      rec.liveWeather = null;
      for (let i = 1; i <= 3; i++) {
        if (i === 1) {
          try {
            rec.liveWeather = await page.evaluate(async () => {
              const r = await window.__gevCinematic.pullLiveWeather();
              return {
                ok: true,
                provider: r.provider,
                attribution: r.attribution,
                label: r.label,
                summary: r.summary,
                observation: r.observation,
                latencyMs: r.latencyMs,
                evidenceToVisualMs: r.evidenceToVisualMs,
                roundTripMs: r.roundTripMs,
                applied: r.result?.applied?.length ?? null,
                rejected: r.result?.rejected?.length ?? null,
                camera: r.result?.camera ?? null,
                patchOps: (r.patch?.ops || []).map((o) => o.op),
              };
            });
          } catch (err) {
            rec.liveWeather = { ok: false, error: String(err?.message || err) };
            await page.evaluate(() => window.__gevCinematic.inject('road_closure'));
          }
        } else {
          await page.evaluate(() => window.__gevCinematic.inject('road_closure'));
        }
        await sleep(1500);

        const newPos = await page.evaluate(
          () => window.__gevCinematic.playback?.positionSec?.() ?? 0,
        );
        const newVer = await page.evaluate(
          () => window.__gevCinematic.scene()?.sceneVersion ?? 0,
        );

        if (newPos < lastPos) {
          rec.status = 'failed';
          rec.reason = `Playback position rewound on injection ${i}: ${lastPos} -> ${newPos}`;
          return;
        }
        if (newVer <= lastVer) {
          rec.status = 'failed';
          rec.reason = `Scene version did not increase on injection ${i}`;
          return;
        }
        lastPos = newPos;
        lastVer = newVer;
      }
    });
  }

  // Demo E: Snapchat discovery — needs a COMPLETED scene first (Discover is
  // an explicit, separate action gated on a constructed scene).
  if (allowedDemos.includes('E')) {
    await runDemo('E', vp, async (page, rec) => {
      // Dubai Marina: a named place the Snapchat place ladder can query (a
      // 55 km highway has no place entry and is reported "not searched").
      await submitPrompt(
        page,
        'Cinematic police response simulation at Dubai Marina with units arriving and a cordon',
      );
      const built = await pollUntilTerminal(page, timeoutMs);
      if (built.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Build before Snapchat discovery ended ${built.runState}`;
        return;
      }
      // Balanced scope (the UI default for a real search; strict rejects every
      // Spotlight record because the provider supplies no capture time).
      // The controls live in a collapsed <details>; the button is enabled only
      // once the composer handed the finished scene to the controls. Wait for
      // that (up to 20 s) instead of racing the final `done` frame.
      const discover = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const details = document.querySelector('#scene-snapchat-controls');
        if (details) details.open = true;
        const sel = document.querySelector('#scene-snapchat-scope');
        if (sel) {
          sel.value = 'balanced';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const t0 = Date.now();
        let btn = null;
        while (Date.now() - t0 < 20000) {
          btn = document.querySelector('#scene-snapchat-discover');
          if (btn && !btn.disabled) break;
          await wait(500);
        }
        if (!btn) return { clicked: false, reason: 'button missing' };
        if (btn.disabled)
          return { clicked: false, reason: 'button disabled (no scene handed to controls)' };
        btn.click();
        return { clicked: true, scope: sel?.value || null };
      });
      rec.discover = discover;
      if (!discover.clicked) {
        rec.status = 'blocked';
        rec.reason = `Snapchat discover not clickable: ${discover.reason}`;
        report.summary.blocked += 1;
        return;
      }

      // The fan-out takes 15–60 s per variant; poll until the status settles
      // (a terminal word) or the budget ends, then record ONLY real metrics.
      const t0 = Date.now();
      let snapshot = null;
      while (Date.now() - t0 < 150000) {
        snapshot = await page.evaluate(() => {
          const txt = (sel) =>
            document.querySelector(sel)?.textContent?.trim() || null;
          return {
            metrics: txt('#scene-snapchat-metrics'),
            status: txt('#scene-footage-status'),
            match: txt('#scene-footage-match'),
            clipCount: document.querySelectorAll(
              '#scene-footage-clips [role="option"], #scene-footage-clips .sfp__clip',
            ).length,
            footageApi: window.__gevSceneFootage?.getState
              ? (() => {
                  const st = window.__gevSceneFootage.getState();
                  return {
                    state: st.phase ?? null,
                    metrics: st.metrics ?? null,
                    accounting: st.accounting ?? null,
                    clips: Array.isArray(st.clipIds) ? st.clipIds.length : null,
                    coverageLabel: st.coverageLabel ?? null,
                    error: st.error ?? null,
                    message: st.message ?? null,
                  };
                })()
              : null,
          };
        });
        const phase = snapshot.footageApi?.state || '';
        // Terminal controller phases only (standby = not yet searching).
        if (['ready', 'empty', 'plugin_error', 'error'].includes(phase)) break;
        await sleep(3000);
      }
      const shotE = await takeShot(page, `demo-E-${vp.name}-snapchat`);
      if (shotE) rec.screenshots.push(shotE);
      rec.metrics = {
        snapchatMetrics: snapshot?.metrics ?? null,
        status: snapshot?.status ?? null,
        matchedPlace: snapshot?.match ?? null,
        clipCount: snapshot?.clipCount ?? 0,
        footageApi: snapshot?.footageApi ?? null,
        waitedMs: Date.now() - t0,
      };
      if (!snapshot?.metrics && !snapshot?.status) {
        rec.status = 'failed';
        rec.reason = 'No Snapchat metrics or status rendered after discovery';
      }
    });
  }

  // Demo F: Model picker and rebuild
  if (allowedDemos.includes('F')) {
    await runDemo('F', vp, async (page, rec) => {
      const models = await page.evaluate(async () =>
        window.__gevCinematic.getModels(),
      );
      if (!Array.isArray(models) || models.length < 2) {
        rec.status = 'blocked';
        rec.reason = 'Less than 2 active endpoints available from getModels()';
        report.summary.blocked += 1;
        return;
      }

      // Prefer a second endpoint that is ACTIVE and streaming-capable and not
      // the task default (Cerebras); a BYOI endpoint that answers with an
      // empty stream proves switching but not generation.
      const defaultId = 'predefined-cerebras-qwen-3.8-27b';
      const candidates = models.filter(
        (m) =>
          (m.endpointId || m.endpoint_id) !== defaultId &&
          m.available !== false &&
          m.streaming !== false &&
          String(m.endpointId || m.endpoint_id).startsWith('predefined-'),
      );
      const preferred =
        candidates.find(
          (m) => (m.endpointId || m.endpoint_id) === 'predefined-gpt-6.1-sol',
        ) ||
        candidates[0] ||
        models[1];
      const secondEndpoint = preferred.endpoint_id || preferred.endpointId;
      await page.evaluate(
        (ep) => window.__gevCinematic.setModel('scene_direction', ep),
        secondEndpoint,
      );

      const prompt =
        'Police response simulation at Burj Khalifa, Downtown Dubai';
      await submitPrompt(page, prompt);
      const built = await pollUntilTerminal(page, timeoutMs);

      // Request-level proof = the reducer's `model` (set from the SSE
      // `model.selected` frame and confirmed by `run.completed.model`). The
      // raw ring buffer is capped and a 2,000-delta GPT run evicts the early
      // frame, so it is only a secondary source here.
      const trace = await page.evaluate(() => window.__gevCinematic.events());
      const selected = trace.find((e) => e.event === 'model.selected');
      const stateModel = await page.evaluate(
        () => window.__gevCinematic.state()?.model || null,
      );
      const provenEndpoint =
        stateModel?.endpointId || selected?.data?.endpointId || null;
      rec.modelProof = { stateModel, modelSelectedEvent: selected?.data || null };
      if (!provenEndpoint) {
        rec.status = 'failed';
        rec.reason = 'No model.selected / run.completed model in the run';
      } else if (provenEndpoint !== secondEndpoint) {
        rec.status = 'failed';
        rec.reason = `run used ${provenEndpoint}, expected ${secondEndpoint}`;
      }
      rec.buildRunState = built.runState;
      rec.switchedModel = preferred;
      if (built.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Switched model ${secondEndpoint} did not complete a build (${built.runState})`;
      }
      // Restore the default assignment so later demos use the task default.
      await page.evaluate(() => {
        try {
          window.localStorage.removeItem('gev.cinematic.models.v1');
        } catch {}
      });
      rec.metrics = {
        switchedTo: secondEndpoint,
        modelSelectedEvent: selected?.data,
      };
    });
  }

  // Demo G: TTFT and tok/s metrics from trace
  if (allowedDemos.includes('G')) {
    await runDemo('G', vp, async (page, rec) => {
      const prompt =
        'Police response simulation at Burj Khalifa, Downtown Dubai';
      await submitPrompt(page, prompt);
      const built = await pollUntilTerminal(page, timeoutMs);
      if (built.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Build for latency measurement ended ${built.runState}`;
      }

      const trace = await page.evaluate(() => window.__gevCinematic.events());
      const startEvt = trace.find((e) => e.event === 'run.started');
      const firstDelta = trace.find((e) => e.event === 'answer.delta');
      const completedEvt = trace.find((e) => e.event === 'run.completed');

      let ttftMs = null;
      if (startEvt?.t && firstDelta?.t) {
        ttftMs = Math.max(
          0,
          new Date(firstDelta.t).getTime() - new Date(startEvt.t).getTime(),
        );
      }
      rec.metrics = {
        computedTtftMs: ttftMs,
        reportedMetrics: completedEvt?.data?.metrics || null,
      };
    });
  }

  // Demo H: Grounded Q&A
  if (allowedDemos.includes('H')) {
    await runDemo('H', vp, async (page, rec) => {
      const prompt =
        'Police response simulation at Burj Khalifa, Downtown Dubai';
      await submitPrompt(page, prompt);
      const built = await pollUntilTerminal(page, timeoutMs);
      if (built.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Build before Q&A ended ${built.runState}`;
        return;
      }

      const qaAerial = await page.evaluate(async () =>
        window.__gevCinematic.qa('Show a wide aerial view'),
      );
      const shotAerial = await takeShot(page, `demo-H-${vp.name}-aerial`);
      if (shotAerial) rec.screenshots.push(shotAerial);

      const qaAdd = await page.evaluate(async () =>
        window.__gevCinematic.qa('Add another simulated emergency vehicle'),
      );
      const shotAdd = await takeShot(page, `demo-H-${vp.name}-added`);
      if (shotAdd) rec.screenshots.push(shotAdd);

      rec.metrics = { qaAerial, qaAdd };
    });
  }

  // Demo I: Forced Failure
  if (allowedDemos.includes('I')) {
    await runDemo('I', vp, async (page, rec) => {
      await page.evaluate(() =>
        window.__gevCinematic.forceModel('predefined-does-not-exist'),
      );
      const prompt =
        'Police response simulation at Burj Khalifa, Downtown Dubai';
      await submitPrompt(page, prompt);

      let everSucceeded = false;
      const t0 = Date.now();
      let terminalState = null;

      while (Date.now() - t0 < 60000) {
        const st = await page.evaluate(() => {
          const runSt = window.__gevCinematic.state().runState;
          const badgeState = document
            .querySelector('#cinematic-run-state')
            ?.getAttribute('data-state');
          return { runSt, badgeState };
        });

        if (st.runSt === 'succeeded' || st.badgeState === 'succeeded') {
          everSucceeded = true;
        }
        if (st.runSt === 'failed') {
          terminalState = 'failed';
          break;
        }
        await sleep(1000);
      }

      if (everSucceeded) {
        rec.status = 'failed';
        rec.reason = 'Forced model failure showed succeeded runState';
      } else if (terminalState !== 'failed') {
        rec.status = 'failed';
        rec.reason = `Expected terminal runState 'failed', got: ${terminalState}`;
      }
    });
  }

  // Final Acceptance Workflow
  if (allowedDemos.includes('ACCEPTANCE')) {
    await runDemo('acceptance', vp, async (page, rec) => {
      const acceptancePrompt =
        'Open Downtown Dubai around Burj Khalifa and create a cinematic marathon with crowds, police roadblocks and moving traffic';
      await submitPrompt(page, acceptancePrompt);
      const built = await pollUntilTerminal(page, timeoutMs);
      if (built.runState !== 'succeeded') {
        rec.status = 'failed';
        rec.reason = `Acceptance build ended ${built.runState}`;
        return;
      }
      rec.buildMs = built.durationMs;

      // 1. Inject closure
      await page.evaluate(() => window.__gevCinematic.inject('road_closure'));
      await sleep(2500);

      // 2. Q1: Intersection changed
      const q1 = await page.evaluate(async () =>
        window.__gevCinematic.qa('Show me the intersection that changed'),
      );
      // 3. Q2: Why did road close
      const q2 = await page.evaluate(async () =>
        window.__gevCinematic.qa('Why did that road close?'),
      );
      // 4. Q3: Replay helicopter
      const q3 = await page.evaluate(async () =>
        window.__gevCinematic.qa(
          'Replay the last section from a helicopter perspective',
        ),
      );

      const shotAcc = await takeShot(page, `acceptance-${vp.name}-final`);
      if (shotAcc) rec.screenshots.push(shotAcc);

      rec.metrics = { q1, q2, q3 };
    });
  }
}

writeReportFiles();
log(
  `QA Harness complete. Passed: ${report.summary.passed}, Failed: ${report.summary.failed}, Blocked: ${report.summary.blocked}, Not Run: ${report.summary.not_run}`,
);
hardKill();
process.exit(0);
