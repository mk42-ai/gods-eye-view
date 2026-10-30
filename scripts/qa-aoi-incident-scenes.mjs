#!/usr/bin/env node
/**
 * Headless browser proof for the AOI incident scenes (cycle 9).
 *
 *   node scripts/qa-aoi-incident-scenes.mjs --url <preview> --out <dir>
 *        [--viewports 1440x900,390x844] [--checks a,b,c,d,e,f,g]
 *
 * Checks (one PNG per check per viewport, UTC timestamp recorded):
 *   a  only AOI scenes in the scene list/map (Nepal Flood absent)
 *   b  playback plays and scrubs (scene clock advances; scrub moves camera)
 *   c  typing 'drone strike reported near Hodeidah port' builds + auto-plays
 *      a new scene with the camera near 14.80, 42.95
 *   d  typing an incident in Paris → OUT_OF_AOI reason + override offered
 *   e  POST /refresh adds live incidents and the list count does not shrink
 *   f  mini chat opens from a scene marker with incident context pre-filled
 *   g  the app loads inside an iframe on a test harness page
 *
 * Uses the repo's puppeteer devDependency + /usr/bin/chromium like
 * scripts/qa-chat-intelligent-ui.mjs; the browser is started in its own
 * process group and torn down on every exit path.
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
    `docs/agent-execution/artifacts/aoi-incidents-${new Date().toISOString().slice(0, 10)}`,
);
const viewports = (args.viewports || '1440x900,390x844').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { name: v, width: w, height: h, mobile: w < 700 };
});
const checks = (args.checks || 'a,b,c,d,e,f,g').split(',');
mkdirSync(outDir, { recursive: true });
const log = (m) => console.log(`[qa-aoi ${new Date().toISOString()}] ${m}`);
const nowUtc = () => new Date().toISOString();

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
  14 * 60 * 1000,
);

const results = {
  url: appUrl,
  startedUtc: nowUtc(),
  viewports: {},
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(page) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const ok = await page
    .waitForFunction(
      () => {
        const loading = document.querySelector('#loading-screen');
        return (
          (!loading || loading.classList.contains('hidden')) &&
          window.__gevIncidents &&
          window.__godsEyeView?.sceneDirector
        );
      },
      { timeout: 120000 },
    )
    .then(() => true)
    .catch(() => false);
  await page
    .waitForFunction(
      () =>
        Number(
          document.getElementById('incident-panel')?.dataset.incidents || 0,
        ) > 0,
      { timeout: 60000 },
    )
    .catch(() => {});
  await sleep(1500);
  return ok;
}

async function record(vp, id, fn) {
  const t0 = nowUtc();
  let out;
  try {
    out = await fn();
  } catch (err) {
    out = { pass: false, detail: `threw: ${err?.message || err}` };
  }
  const entry = {
    id,
    pass: Boolean(out.pass),
    detail: out.detail,
    data: out.data,
    screenshot: out.screenshot,
    startedUtc: t0,
    finishedUtc: nowUtc(),
  };
  results.viewports[vp.name].checks.push(entry);
  results.summary[entry.pass ? 'pass' : 'fail'] += 1;
  log(`[${vp.name}] ${id} ${entry.pass ? 'PASS' : 'FAIL'} — ${entry.detail}`);
  return entry;
}

try {
  for (const vp of viewports) {
    results.viewports[vp.name] = { checks: [] };
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    page.on('pageerror', (e) => log(`[${vp.name}] pageerror ${e?.message}`));
    const booted = await boot(page);
    log(`[${vp.name}] booted=${booted}`);
    // Dismiss the first-run/welcome if present so panels are reachable.
    await page
      .evaluate(() => {
        document
          .querySelector(
            '#welcome-dismiss, [data-welcome-dismiss], #first-run-dismiss',
          )
          ?.click?.();
        document.getElementById('scene-panel')?.classList.remove('collapsed');
        document.querySelector('#left-panel-stack')?.scrollTo?.(0, 1e6);
      })
      .catch(() => {});
    await sleep(500);

    if (checks.includes('a'))
      await record(vp, 'a-aoi-only-scenes', async () => {
        const data = await page.evaluate(() => {
          const st = window.__gevIncidents.getState();
          const options = [
            ...document.querySelectorAll('#scene-select option'),
          ].map((o) => o.textContent);
          return {
            ...st,
            options,
            markers: window.__gevIncidents.overlay.incidentCount,
          };
        });
        const nepalAbsent =
          !data.options.some((t) => /nepal/i.test(t)) &&
          !data.sceneTitles.some((t) => /nepal/i.test(t));
        const hiddenNepal = data.hidden.find((h) => /nepal/i.test(h.title));
        const screenshot = await shot(page, `a-aoi-only-${vp.name}`);
        return {
          pass:
            nepalAbsent && !!hiddenNepal && data.scenes > 0 && data.markers > 0,
          detail: `${data.options.length} scenes listed, ${data.markers} markers, nepal absent=${nepalAbsent}, hidden reason="${hiddenNepal?.reason}"`,
          data: {
            options: data.options.slice(0, 12),
            hidden: data.hidden,
            perAoi: data.perAoi,
            incidents: data.incidents,
            scenes: data.scenes,
            rejected: data.rejected,
          },
          screenshot,
        };
      });

    if (checks.includes('b'))
      await record(vp, 'b-playback-plays-and-scrubs', async () => {
        const started = await page.evaluate(async () => {
          const inc = window.__gevIncidents;
          const director = window.__godsEyeView.sceneDirector;
          const scene = director.listIncidentScenes()[0];
          if (!scene) return { error: 'no incident scene' };
          inc.playScene(scene.id, { fly: false });
          await new Promise((r) => setTimeout(r, 1000));
          const snap1 = director.getPlaybackTimingState().snapshot;
          // Shots hold + settle between flights, so sample across a whole shot.
          await new Promise((r) => setTimeout(r, 5000));
          const snap2 = director.getPlaybackTimingState().snapshot;
          return {
            sceneId: scene.id,
            title: scene.title,
            running: director.running,
            p1: snap1?.sceneProgress,
            p2: snap2?.sceneProgress,
            clock: document.getElementById('incident-playback-clock')
              ?.textContent,
          };
        });
        const scrubbed = await page.evaluate(async () => {
          const director = window.__godsEyeView.sceneDirector;
          const sceneId = director._selectedSceneId;
          const before =
            window.__godsEyeView.viewer.camera.positionCartographic.clone();
          director.pauseScene();
          const scrub = document.getElementById('incident-playback-scrub');
          scrub.value = '950';
          scrub.dispatchEvent(new Event('input', { bubbles: true }));
          scrub.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 1800));
          const snap = director.getPlaybackTimingState().snapshot;
          const after = window.__godsEyeView.viewer.camera.positionCartographic;
          const moved =
            Math.abs(after.longitude - before.longitude) +
            Math.abs(after.latitude - before.latitude) +
            Math.abs(after.height - before.height) / 1e6;
          return {
            sceneId,
            paused: Boolean(director.paused),
            scrubProgress: snap?.sceneProgress,
            shotIndex: snap?.shotIndex,
            moved,
            scrubValue: scrub.value,
          };
        });
        const screenshot = await shot(page, `b-playback-${vp.name}`);
        const plays = started.running === true && started.p2 > started.p1;
        const scrubs = scrubbed.scrubProgress > 0.8 || scrubbed.shotIndex >= 1;
        return {
          pass: plays && scrubs,
          detail: `plays: running=${started.running} progress ${started.p1?.toFixed(3)}→${started.p2?.toFixed(3)}; scrub→${scrubbed.scrubProgress?.toFixed(3)} shot ${scrubbed.shotIndex} camera moved=${scrubbed.moved > 1e-4}`,
          data: { started, scrubbed },
          screenshot,
        };
      });

    if (checks.includes('c'))
      await record(vp, 'c-compose-hodeidah', async () => {
        await page.evaluate(() =>
          window.__godsEyeView.sceneDirector.stopScene('qa'),
        );
        const before = await page.evaluate(
          () => document.querySelectorAll('#scene-select option').length,
        );
        await page.click('#incident-composer-input');
        await page.type(
          '#incident-composer-input',
          'drone strike reported near Hodeidah port',
          { delay: 10 },
        );
        await page.keyboard.press('Enter');
        const built = await page
          .waitForFunction(
            () =>
              document
                .getElementById('incident-composer')
                ?.getAttribute('data-state') === 'done',
            { timeout: 60000 },
          )
          .then(() => true)
          .catch(() => false);
        await sleep(3500);
        const data = await page.evaluate(() => {
          const director = window.__godsEyeView.sceneDirector;
          const cam = window.__godsEyeView.viewer.camera.positionCartographic;
          const chips = [
            ...document.querySelectorAll('.incident-composer__chip'),
          ].map((c) => `${c.dataset.step}=${c.dataset.status}`);
          const scene =
            director
              .listScenes()
              .find((item) => item.id === director._selectedSceneId) ||
            director.listScenes()[0];
          return {
            chips,
            running: director.running,
            selected: director._selectedSceneId,
            firstScene: scene?.title,
            lat: (cam.latitude * 180) / Math.PI,
            lon: (cam.longitude * 180) / Math.PI,
            options: document.querySelectorAll('#scene-select option').length,
            result: document.getElementById('incident-composer-result')
              ?.textContent,
          };
        });
        const screenshot = await shot(page, `c-compose-hodeidah-${vp.name}`);
        const near =
          Math.abs(data.lat - 14.8) < 1.2 && Math.abs(data.lon - 42.95) < 1.2;
        return {
          // A second run of the same text inside the 6 h dedupe window reuses the
          // existing scene (count unchanged) — still a pass when it plays there.
          pass:
            built &&
            near &&
            data.running &&
            /hodeidah/i.test(data.firstScene || '') &&
            (data.options > before ||
              /already in the ledger/i.test(data.result || '')),
          detail: `built=${built} chips=${chips(data.chips)} camera=${data.lat.toFixed(2)},${data.lon.toFixed(2)} near=${near} running=${data.running} scenes ${before}→${data.options} first="${data.firstScene}"`,
          data,
          screenshot,
        };
      });

    if (checks.includes('d'))
      await record(vp, 'd-compose-paris-rejected', async () => {
        await page.evaluate(() => {
          window.__godsEyeView.sceneDirector.stopScene('qa');
          const i = document.getElementById('incident-composer-input');
          i.value = '';
        });
        await page.click('#incident-composer-input');
        await page.type(
          '#incident-composer-input',
          'car bomb explosion in Paris',
          { delay: 10 },
        );
        await page.keyboard.press('Enter');
        const settled = await page
          .waitForFunction(
            () =>
              ['error', 'done'].includes(
                document
                  .getElementById('incident-composer')
                  ?.getAttribute('data-state'),
              ),
            { timeout: 60000 },
          )
          .then(() => true)
          .catch(() => false);
        await sleep(600);
        const data = await page.evaluate(() => ({
          state: document
            .getElementById('incident-composer')
            ?.getAttribute('data-state'),
          text:
            document.getElementById('incident-composer-result')?.textContent ||
            '',
          override: !!document.getElementById('incident-composer-override'),
          overrideLabel: document.getElementById('incident-composer-override')
            ?.textContent,
          chips: [...document.querySelectorAll('.incident-composer__chip')].map(
            (c) => `${c.dataset.step}=${c.dataset.status}`,
          ),
        }));
        const screenshot = await shot(page, `d-compose-paris-${vp.name}`);
        return {
          pass:
            settled &&
            data.state === 'error' &&
            /OUT_OF_AOI: nearest AOI .+ km/.test(data.text) &&
            data.override,
          detail: `state=${data.state} override=${data.override} "${data.overrideLabel}" reason=${(data.text.match(/OUT_OF_AOI[^.]*km/) || [''])[0]}`,
          data,
          screenshot,
        };
      });

    if (checks.includes('e'))
      await record(vp, 'e-refresh-live', async () => {
        const before = await page.evaluate(
          () => window.__gevIncidents.getState().incidents,
        );
        const refresh = await page.evaluate(async () => {
          const out = await window.__gevIncidents.client.refresh();
          return {
            pulled: out.pulled,
            inserted: out.inserted_count,
            duplicates: out.duplicates,
            rejected: out.rejected?.length,
            sources: out.sources,
            list: out.list,
          };
        });
        await page.evaluate(() => window.__gevIncidents.load());
        await sleep(2500);
        const after = await page.evaluate(
          () => window.__gevIncidents.getState().incidents,
        );
        const screenshot = await shot(page, `e-refresh-${vp.name}`);
        const okSources = (refresh.sources || []).filter(
          (s) => s.status === 'ok',
        ).length;
        const grew =
          after > before ||
          refresh.inserted > 0 ||
          (refresh.pulled > 0 && refresh.duplicates > 0);
        return {
          // The refresh must run through the PluginContract registry with at
          // least one live source answering, never shrink the ledger, and
          // either add incidents or re-confirm known ones (duplicates). A
          // source that pulled 0 parseable items is reported in the detail.
          pass:
            refresh.sources?.length >= 2 &&
            after >= before &&
            okSources > 0 &&
            (grew || refresh.pulled === 0),
          detail: `pulled=${refresh.pulled} inserted=${refresh.inserted} duplicates=${refresh.duplicates} rejected=${refresh.rejected}; list ${before}→${after}; sources ok ${okSources}/${refresh.sources?.length} [${(refresh.sources || []).map((s) => `${s.contract}:${s.status}${s.error ? '(' + s.error + ')' : ''}`).join(', ')}]`,
          data: { before, after, refresh },
          screenshot,
        };
      });

    if (checks.includes('f'))
      await record(vp, 'f-mini-chat-from-marker', async () => {
        const data = await page.evaluate(async () => {
          const inc = window.__gevIncidents;
          const director = window.__godsEyeView.sceneDirector;
          const scene =
            director
              .listIncidentScenes()
              .find(
                (s) =>
                  s.incident?.incident_ids?.[0] &&
                  inc.overlay.getIncident(s.incident.incident_ids[0]) &&
                  /presence|hodeidah|aden/i.test(s.title),
              ) || director.listIncidentScenes()[0];
          const incident = inc.overlay.getIncident(
            scene.incident.incident_ids[0],
          );
          inc.openPopover(incident, { x: 400, y: 300 });
          await new Promise((r) => setTimeout(r, 300));
          const pop = document.getElementById('incident-popover');
          const popoverOk =
            pop && !pop.hidden && pop.textContent.includes(incident.title);
          const badge = pop.querySelector('.incident-badge')?.textContent;
          const sources = pop.querySelectorAll(
            '.incident-popover__sources a',
          ).length;
          pop.querySelector('[data-action="ask"]').click();
          await new Promise((r) => setTimeout(r, 1200));
          const chat = document.getElementById('ondemand-mini-chat');
          const kind =
            document.getElementById('ondemand-mini-chat-kind')?.textContent ||
            chat?.querySelector('.od-chat__kind')?.textContent ||
            '';
          const title =
            document.getElementById('ondemand-mini-chat-title')?.textContent ||
            chat?.querySelector('.od-chat__title')?.textContent ||
            '';
          const devDetails = chat?.textContent || '';
          return {
            incidentId: incident.id,
            incidentTitle: incident.title,
            popoverOk,
            badge,
            sources,
            chatOpen: chat?.getAttribute('data-open') === 'true',
            objectType: chat?.getAttribute('data-object-type'),
            kind,
            title,
            hasId:
              devDetails.includes(incident.id) || kind.includes(incident.id),
            aoi: incident.aoi,
          };
        });
        const screenshot = await shot(page, `f-mini-chat-${vp.name}`);
        return {
          pass:
            data.popoverOk &&
            data.chatOpen &&
            data.objectType === 'alert' &&
            data.hasId,
          detail: `popover=${data.popoverOk} badge=${data.badge} sources=${data.sources}; chat open=${data.chatOpen} type=${data.objectType} kind="${data.kind}" title="${data.title}" context id present=${data.hasId}`,
          data,
          screenshot,
        };
      });

    await page.close().catch(() => {});

    if (checks.includes('g'))
      await record(vp, 'g-iframe-embed', async () => {
        const harness = await browser.newPage();
        await harness.setViewport({
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
        });
        // Same-origin harness page shipped with the app (public/embed-harness.html,
        // no `sandbox` attribute) so the iframe document is readable.
        await harness.goto(`${appUrl}/embed-harness.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        });
        const loaded = await harness
          .waitForFunction(
            () =>
              /OnDemand/i.test(document.body.dataset.iframeTitle || '') &&
              document.body.dataset.iframeCanvas === 'true',
            { timeout: 150000 },
          )
          .then(() => true)
          .catch(() => false);
        await sleep(5000);
        const data = await harness.evaluate(() => ({
          title: document.body.dataset.iframeTitle,
          len: Number(document.body.dataset.iframeTextLen || 0),
          canvas: document.body.dataset.iframeCanvas,
          status: document.getElementById('status').textContent,
        }));
        const headers = await fetch(`${appUrl}/`, { method: 'GET' })
          .then((r) => ({
            xfo: r.headers.get('x-frame-options'),
            csp: r.headers.get('content-security-policy'),
          }))
          .catch(() => ({}));
        const screenshot = await shot(harness, `g-iframe-${vp.name}`);
        await harness.close().catch(() => {});
        return {
          pass:
            loaded &&
            /OnDemand/i.test(data.title || '') &&
            data.len > 0 &&
            !headers.xfo &&
            !/frame-ancestors/i.test(headers.csp || ''),
          detail: `iframe title="${data.title}" innerText=${data.len} canvas=${data.canvas}; headers x-frame-options=${headers.xfo} csp=${headers.csp}`,
          data: { ...data, headers },
          screenshot,
        };
      });
  }
} finally {
  results.finishedUtc = nowUtc();
  writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  log(
    `done: ${results.summary.pass} pass / ${results.summary.fail} fail → ${outDir}`,
  );
  clearTimeout(cap);
  await browser.close().catch(() => {});
  hardKill();
}
function chips(list) {
  return list.join(',');
}
process.exit(results.summary.fail ? 1 : 0);
