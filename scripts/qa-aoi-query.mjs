#!/usr/bin/env node
/** AOI submission regression matrix. Uses real keyboard/mouse events, no stubs.
 * node scripts/qa-aoi-query.mjs --url https://sb-....vercel.run --phase after --out ../
 * Optional --cases 0,1 (eight cases: viewport, query, method). Chromium must be
 * installed separately. Isolated contexts, browser process-group cleanup on all
 * exit paths and an 18-minute hard cap. Evidence sanitizes credentials and URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const project =
  process.env.AOI_PROJECT ||
  path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(project, 'package.json'));
const puppeteer = require('puppeteer');
const phase = arg('phase', process.env.AOI_PHASE || 'after');
const url = arg('url', process.env.AOI_URL || 'http://127.0.0.1:5173');
const out = arg('out', process.env.AOI_OUTPUT || path.dirname(project));
fs.mkdirSync(out, { recursive: true });
const results = {
  phase,
  url,
  startedUtc: new Date().toISOString(),
  cases: [],
  evidence: [],
  notes: [
    'Fresh browser context per case; real mouse click, keyboard.type and keyboard.press; no forced clicks, DOM value injection, response stubs or provider mocks.',
    'Welcome tour disabled using the application-supported welcome=0 URL parameter.',
  ],
};
const secretValues = Object.entries(process.env)
  .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v?.length >= 12)
  .map(([, v]) => v);
function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        /authorization|apikey|api_key|token|secret|password|cookie|externalUserId/i.test(
          k,
        )
          ? k
          : k,
        /authorization|apikey|api_key|token|secret|password|cookie|externalUserId/i.test(
          k,
        )
          ? '[REDACTED]'
          : safe(v),
      ]),
    );
  if (typeof value !== 'string') return value;
  let s = value;
  for (const x of secretValues) s = s.split(x).join('[REDACTED]');
  s = s
    .replace(/Bearer\s+[\w.\-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:sig|token|key|apikey|api_key|access_token|X-Amz-[\w-]+|se|sp|sr|sv|st|skt|ske|sks|skv|sktid|skoid)=)[^&#\s"<>]*/gi,
      '$1[REDACTED]',
    );
  return s;
}
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
function kill() {
  try {
    const p = browser?.process();
    if (p?.pid) {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
      try {
        p.kill('SIGKILL');
      } catch {}
    }
  } catch {}
}
function save() {
  fs.writeFileSync(
    path.join(out, `aoi-${phase}-evidence.json`),
    JSON.stringify(safe({ ...results, finishedUtc: now() }), null, 2),
  );
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'])
  process.on(sig, () => {
    results.fatal = `Received ${sig}`;
    save();
    kill();
    process.exit(124);
  });
process.on('exit', kill);
const cap = setTimeout(
  () => {
    results.fatal = 'Harness hard wall-clock cap reached';
    save();
    kill();
    process.exit(124);
  },
  18 * 60 * 1000,
);
const matrix = [];
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  for (const query of [
    'burj khalifa check if there is any incidents',
    'Burj Khalifa',
  ])
    for (const method of ['Enter', 'BUILD SCENE'])
      matrix.push({ viewport, query, method });
const chosen = arg('cases', process.env.AOI_CASES);
const indices = chosen
  ? chosen.split(',').map(Number)
  : matrix.map((_, i) => i);
async function snapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#incident-composer');
    const input = document.querySelector('#incident-composer-input');
    const btn = document.querySelector('#incident-composer-submit');
    const box = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const x = r.x + r.width / 2,
        y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        visible:
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(e).visibility !== 'hidden',
        hit: hit?.id || hit?.className || hit?.tagName,
        unobstructed: hit === e || e.contains(hit),
      };
    };
    const state = window.__gevIncidents?.composer?.state;
    return {
      utc: new Date().toISOString(),
      title: document.title,
      url: location.origin + location.pathname,
      enteredValue: input?.value,
      layout: {
        composer: box(root),
        pluginDock: box(document.querySelector('#ondemand-plugin-dock')),
        measuredHeight: document.documentElement.style.getPropertyValue(
          '--incident-composer-height',
        ),
        resizeObserverAvailable: typeof ResizeObserver === 'function',
      },
      focusedElement: document.activeElement?.id,
      composerState: root?.dataset.state,
      result: document.querySelector('#incident-composer-result')?.innerText,
      input: box(input),
      button: box(btn),
      buttonDisabled: btn?.disabled,
      steps: [...document.querySelectorAll('.incident-composer__chip')].map(
        (e) => ({ step: e.dataset.step, status: e.dataset.status }),
      ),
      extraction: state?.extraction || state?.lastSearch?.extraction || null,
      candidates: state?.candidates || [],
      lastPlan: state?.lastPlan,
      lastScene: state?.lastScene
        ? { id: state.lastScene.id, title: state.lastScene.title }
        : null,
      search: state?.lastSearch || null,
      video: window.__gevSceneVideos?.getState?.() || null,
      railState: document.querySelector('#scene-video-rail')?.dataset.state,
      stateText: state?.text,
      trustedEvents: window.__aoiInputEvents || [],
      bodyText: document.body.innerText.slice(-4500),
    };
  });
}
async function screenshot(page, c, suffix) {
  const f = `aoi-${phase}-${c.id}-${suffix}.png`;
  try {
    await page.screenshot({
      path: path.join(out, f),
      type: 'png',
      timeout: 30000,
    });
    c.screenshots.push(f);
  } catch (e) {
    c.screenshotError = safe(e.message);
  }
}
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
    protocolTimeout: 90000,
  });
  for (const i of indices) {
    const spec = matrix[i];
    const c = {
      ...spec,
      id: `${spec.viewport.width}x${spec.viewport.height}-${spec.query === 'Burj Khalifa' ? 'place' : 'natural'}-${spec.method === 'Enter' ? 'enter' : 'button'}`,
      startedUtc: now(),
      screenshots: [],
      status: 'blocked',
    };
    results.cases.push(c);
    save();
    console.log(`[${now()}] ${phase} ${c.id} start`);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const pending = new Set();
    await page.setViewport({
      ...spec.viewport,
      deviceScaleFactor: 1,
      isMobile: spec.viewport.width < 600,
      hasTouch: spec.viewport.width < 600,
    });
    page.setDefaultTimeout(30000);
    await page.evaluateOnNewDocument(() => {
      window.__aoiInputEvents = [];
      for (const type of ['keydown', 'input', 'click', 'submit'])
        document.addEventListener(
          type,
          (event) => {
            if (event.target?.id?.startsWith('incident-composer'))
              window.__aoiInputEvents.push({
                type,
                key: event.key,
                trusted: event.isTrusted,
                target: event.target.id,
                value: event.target.value,
              });
          },
          true,
        );
    });
    page.on('console', (m) => {
      if (['error', 'warn'].includes(m.type()))
        results.evidence.push({
          case: c.id,
          utc: now(),
          type: `console-${m.type()}`,
          message: safe(m.text()).slice(0, 2000),
        });
    });
    page.on('pageerror', (e) =>
      results.evidence.push({
        case: c.id,
        utc: now(),
        type: 'pageerror',
        message: safe(e.message),
      }),
    );
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(url).origin) {
        results.evidence.push({
          case: c.id,
          utc: now(),
          type: 'external-request',
          method: r.method(),
          origin: u.origin,
          path: safe(u.pathname),
        });
      }
      if (u.origin === new URL(url).origin && /\/api\//.test(u.pathname)) {
        const entry = {
          case: c.id,
          utc: now(),
          type: 'request',
          method: r.method(),
          url: safe(u.pathname + u.search),
        };
        if (
          /\/incidents\/(locate|ingest|search)|\/scene\/videos/.test(u.pathname)
        ) {
          try {
            entry.payload = safe(JSON.parse(r.postData() || 'null'));
          } catch {}
        }
        results.evidence.push(entry);
      }
    });
    page.on('requestfailed', (r) =>
      results.evidence.push({
        case: c.id,
        utc: now(),
        type: 'requestfailed',
        url: safe(r.url()),
        error: safe(r.failure()?.errorText),
      }),
    );
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(url).origin || !u.pathname.startsWith('/api/'))
        return;
      const entry = {
        case: c.id,
        utc: now(),
        type: 'response',
        url: safe(u.pathname + u.search),
        status: r.status(),
      };
      results.evidence.push(entry);
      if (/\/incidents\/(locate|ingest|search)/.test(u.pathname)) {
        const p = r
          .json()
          .then((body) => {
            entry.body = safe(body);
            if (u.pathname.endsWith('/locate')) c.locate = entry.body;
            if (u.pathname.endsWith('/search')) c.search = entry.body;
          })
          .catch(() => {})
          .finally(() => pending.delete(p));
        pending.add(p);
      }
    });
    try {
      await page.goto(url + '/?welcome=0', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForSelector('#incident-composer-input', {
        visible: true,
        timeout: 90000,
      });
      await page.waitForFunction(
        () => {
          const l = document.querySelector('#loading-screen');
          return !l || l.classList.contains('hidden');
        },
        { timeout: 60000 },
      );
      await sleep(1800);
      c.idle = await snapshot(page);
      await screenshot(page, c, 'idle');
      if (!c.idle.input?.unobstructed)
        throw new Error(`Input center blocked by ${c.idle.input?.hit}`);
      await page.click('#incident-composer-input');
      await page.keyboard.type(spec.query, { delay: 20 });
      c.typed = await snapshot(page);
      if (c.typed.enteredValue !== spec.query)
        throw new Error('Real keyboard value did not match exact query');
      if (spec.method === 'BUILD SCENE' && !c.typed.button?.unobstructed)
        throw new Error(`Button center blocked by ${c.typed.button?.hit}`);
      c.submittedUtc = now();
      if (spec.method === 'Enter') await page.keyboard.press('Enter');
      else await page.click('#incident-composer-submit');
      await sleep(500);
      c.loading = await snapshot(page);
      await screenshot(page, c, 'loading');
      const terminal = await page
        .waitForFunction(
          () => {
            const s =
              document.querySelector('#incident-composer')?.dataset.state;
            return s && !['idle', 'busy'].includes(s);
          },
          { timeout: 105000, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
      await sleep(300);
      await Promise.allSettled([...pending]);
      c.terminal = await snapshot(page);
      c.terminalObserved = terminal;
      await screenshot(page, c, 'result');
      if (process.argv.includes('--video-smoke')) {
        const appeared = await page
          .waitForSelector('#scene-video-rail video', { timeout: 90000 })
          .then(() => true)
          .catch(() => false);
        const readVideo = () =>
          page.evaluate(() => {
            const video = document.querySelector('#scene-video-rail video');
            const rail = window.__gevSceneVideos?.rail;
            return {
              utc: new Date().toISOString(),
              video: video
                ? {
                    readyState: video.readyState,
                    currentTime: video.currentTime,
                    muted: video.muted,
                    paused: video.paused,
                    error: video.error?.code || null,
                  }
                : null,
              sources: rail?.state?.sources || {},
              done: rail?.state?.done || false,
              clips: [
                ...document.querySelectorAll('#scene-video-rail .svr__clip'),
              ].map((c) => ({
                id: c.dataset.clipId,
                platform: c.dataset.platform,
                tier: c.dataset.tier,
                publishedAt: c.dataset.publishedAt,
                matched: c.dataset.verified !== 'none',
                badge: c.querySelector('[data-tier-badge]')?.textContent,
              })),
              banner: document.querySelector('#scene-video-rail-banner')
                ?.innerText,
            };
          });
        const beforePlayback = await readVideo();
      if (beforePlayback.video?.paused) {
        const clearHit = await page.evaluate(() => {
          const video = document.querySelector('#scene-video-rail video');
          const r = video?.getBoundingClientRect();
          return !!r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === video;
        });
        if (clearHit) {
          await page.click('#scene-video-rail video');
          await sleep(150);
          if ((await readVideo()).video?.paused) await page.keyboard.press('Space');
          await sleep(150);
        }
      }
      const first = await readVideo();
        await sleep(2200);
        const second = await readVideo();
        const incorrect = second.clips.filter((clip) => {
          const age =
            (Date.parse(second.utc) - Date.parse(clip.publishedAt)) / 3600000;
          const expected =
            !clip.matched || !Number.isFinite(age) || age < -1
              ? 'ARCHIVAL'
              : age < 6
                ? 'LIVE'
                : age < 72
                  ? 'RECENT'
                  : 'ARCHIVAL';
          return clip.tier !== expected || clip.badge !== expected;
        });
        c.videoSmoke = {
          appeared,
          first,
          second,
          playbackPass: Boolean(
            first.video &&
            second.video &&
            second.video.muted &&
            second.video.readyState >= 3 &&
            second.video.currentTime > first.video.currentTime + 0.5,
          ),
          freshnessPass: second.clips.length > 0 && incorrect.length === 0,
          incorrect,
        };
        await screenshot(page, c, 'video-smoke');
      }
      const submitted = results.evidence.filter(
        (e) =>
          e.case === c.id &&
          e.type === 'request' &&
          /\/incidents\/(locate|search)$/.test(e.url),
      ).length;
      const search = c.search || c.terminal.search;
      c.status = terminal && submitted && search ? 'pass' : 'fail';
      c.reason = !submitted
        ? 'No intended request initiated'
        : !terminal
          ? 'No terminal UI state within 105s'
          : !search
            ? 'No scoped incident-search request or result; original path only locates/ingests'
            : 'Submission reached scoped search and terminal UI; inspect provider outcome separately';
      if (['after', 'final', 'verified', 'mobile-check'].includes(phase)) {
        const requests = results.evidence.filter(
          (e) => e.case === c.id && e.type === 'request',
        );
        const anchor = c.locate?.candidates?.[0];
        const searchRequest = requests.find((e) =>
          /\/incidents\/search$/.test(e.url),
        );
        const fits = (r) =>
          r &&
          r.visible &&
          r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= spec.viewport.width + 1 &&
          r.y + r.height <= spec.viewport.height + 1;
        const tests = {
          exactKeyboardValue: c.typed.enteredValue === spec.query,
          inputAndButtonUsable:
            fits(c.typed.input) &&
            fits(c.typed.button) &&
            c.typed.input.unobstructed &&
            c.typed.button.unobstructed,
          keyboardEventsTrusted:
            c.typed.trustedEvents.filter((e) => e.type === 'input').length ===
              spec.query.length &&
            c.typed.trustedEvents.every((e) => e.trusted),
          inputStateSynchronized: c.terminal.stateText === spec.query,
          extractsBurjKhalifa:
            c.locate?.extraction?.place?.toLowerCase() === 'burj khalifa' &&
            c.locate?.extraction?.intent === 'incident_search',
          realGeocodeAtBurj:
            anchor?.source === 'geocode_place' &&
            anchor.verified === true &&
            Math.abs(anchor.lat - 25.1972) < 0.005 &&
            Math.abs(anchor.lon - 55.2744) < 0.005,
          searchUsesGeocode:
            !!searchRequest &&
            searchRequest.payload?.candidate?.lat === anchor?.lat &&
            search?.scope?.lat === anchor?.lat &&
            search?.scope?.lon === anchor?.lon &&
            search?.scope?.radiusKm === 5,
          visibleLoading: c.loading.composerState === 'busy',
          terminalState:
            terminal &&
            ['done', 'empty', 'partial', 'unavailable', 'error'].includes(
              c.terminal.composerState,
            ),
          noFabricatedIncident:
            !requests.some((e) => /\/incidents\/ingest$/.test(e.url)) &&
            c.terminal.lastScene === null,
          terminalControlsUsable:
            fits(c.terminal.input) &&
            fits(c.terminal.button) &&
            c.terminal.input.unobstructed &&
            c.terminal.button.unobstructed &&
            !c.terminal.buttonDisabled,
          disclosedCoverage:
            search &&
            (['unavailable', 'partial'].includes(search.status)
              ? /unavailable|partial/i.test(c.terminal.result) &&
                /no conclusion|no absence/i.test(c.terminal.result)
              : /not proof|source-backed/i.test(c.terminal.result)),
        };
        c.assertions = tests;
        c.uiStatus = Object.values(tests).every(Boolean) ? 'pass' : 'fail';
        c.providerOutcome = search?.status || 'not_reached';
        c.status =
          c.uiStatus === 'fail'
            ? 'fail'
            : search?.status === 'unavailable'
              ? 'blocked'
              : 'pass';
        c.reason =
          c.uiStatus === 'fail'
            ? 'Failed: ' +
              Object.entries(tests)
                .filter(([, v]) => !v)
                .map(([k]) => k)
                .join(', ')
            : c.status === 'blocked'
              ? 'UI and submission pass; live incident coverage blocked by provider responses'
              : 'All UI, extraction, coordinate, scope and honest-result assertions pass';
      }
    } catch (e) {
      c.error = safe(e.message);
      c.reason = c.error;
      try {
        c.terminal = await snapshot(page);
        await screenshot(page, c, 'blocked');
      } catch {}
    }
    c.finishedUtc = now();
    console.log(`[${c.finishedUtc}] ${c.id} ${c.status}: ${c.reason}`);
    save();
    await context.close();
  }
} finally {
  clearTimeout(cap);
  save();
  try {
    await browser?.close();
  } finally {
    kill();
  }
}
console.log('Evidence:', path.join(out, `aoi-${phase}-evidence.json`));
