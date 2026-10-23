#!/usr/bin/env node
/**
 * Headless proof for the scene video evidence rail (2026-10-23).
 *
 *   node scripts/qa-scene-videos.mjs --url <preview> --out <dir> [--viewports 1440x900,390x844]
 *
 * Per viewport (one PNG per step, UTC timestamps in results.json):
 *   1 boot with the approved URL-hash scene state; the hash round-trips
 *   2 type "rebuild the car crash reported in Umm Suqeim" in the bottom composer
 *     and submit → clips from ≥2 platforms appear WHILE the scene builds
 *   3 at least one <video> plays (readyState ≥ 3 and currentTime advancing)
 *   4 every clip carries a LIVE/RECENT/ARCHIVAL badge; the archival banner
 *     reads "REBUILT FROM ARCHIVAL FOOTAGE: recorded <date>, not live"
 *   5 the app still loads inside an iframe (public/embed-harness.html)
 *
 * Same browser hygiene as scripts/qa-aoi-incident-scenes.mjs: repo puppeteer +
 * /usr/bin/chromium in its own process group, killed on every exit path, 12 min cap.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) =>
      a.startsWith('--')
        ? [
            [
              a.slice(2),
              arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true',
            ],
          ]
        : [],
    ),
);
const appUrl = (args.url || 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = path.resolve(
  args.out || 'docs/agent-execution/artifacts/scene-video-2026-10-23',
);
const viewports = (args.viewports || '1440x900,390x844').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { name: v, width: w, height: h, mobile: w < 700 };
});
export const APPROVED_HASH =
  '#v=2&lat=13.9425&lon=48.9231&alt=712168&heading=0&pitch=-55&roll=360&style=normal&bloom=0&sharpen=0&bi=50&bv=2&si=65&hud=tactical&hv=1&dm=OFF&dd=50&da=elastic&kf=7&ko=1&cr=0&sc=1&scf=11&map=esri-imagery&l=&lo=f.e.1&ui=c.c.1_c.p.0_l.c.1_l.p.0_d.c.1_v.c.1_r.c.1_s.c.0_g.c.1_p.c.1_m.c.0';
const PROMPT = args.prompt || 'rebuild the car crash reported in Umm Suqeim';
mkdirSync(outDir, { recursive: true });
const nowUtc = () => new Date().toISOString();
const log = (m) => console.log(`[qa-scene-videos ${nowUtc()}] ${m}`);
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
    '--autoplay-policy=no-user-gesture-required',
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
  12 * 60 * 1000,
);

const results = {
  url: appUrl,
  prompt: PROMPT,
  startedUtc: nowUtc(),
  viewports: {},
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

function hashParams(h) {
  return Object.fromEntries(new URLSearchParams(String(h).replace(/^#/, '')));
}

try {
  for (const vp of viewports) {
    const tag = vp.name;
    results.viewports[tag] = { checks: [] };
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    page.on('pageerror', (e) => log(`[${tag}] pageerror ${e?.message}`));

    await record(vp, '1-boot-hash-roundtrip', async () => {
      await page.goto(`${appUrl}/${APPROVED_HASH}`, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      const ok = await page
        .waitForFunction(
          () => {
            const loading = document.querySelector('#loading-screen');
            return (
              (!loading || loading.classList.contains('hidden')) &&
              window.__gevSceneVideos &&
              document.getElementById('incident-composer')
            );
          },
          { timeout: 150000 },
        )
        .then(() => true)
        .catch(() => false);
      await sleep(2500);
      const after = await page.evaluate(() => location.hash);
      const a = hashParams(APPROVED_HASH);
      const b = hashParams(after);
      const mismatched = Object.keys(a).filter((k) => a[k] !== b[k]);
      return {
        pass: ok && mismatched.length === 0,
        detail: `booted=${ok}; hash keys ${Object.keys(a).length}, mismatched=${JSON.stringify(mismatched.map((k) => [k, a[k], b[k]]))}`,
        data: { after },
        screenshot: await shot(page, `1-boot-${tag}`),
      };
    });

    let firstClipAt = null;
    await record(vp, '2-clips-stream-while-building', async () => {
      await page.evaluate(() =>
        document
          .querySelector(
            '#welcome-dismiss, [data-welcome-dismiss], #first-run-dismiss',
          )
          ?.click?.(),
      );
      const input = await page.$('#incident-composer-input');
      await input.click({ clickCount: 3 });
      await input.type(PROMPT, { delay: 8 });
      const submittedAt = nowUtc();
      await page.click('#incident-composer-submit');
      // Capture the "searching sources" state first.
      await page
        .waitForFunction(
          () =>
            document.getElementById('scene-video-rail')?.dataset.state ===
            'searching',
          { timeout: 15000 },
        )
        .catch(() => {});
      await sleep(600);
      const searchingShot = await shot(page, `2a-searching-${tag}`);
      const ok = await page
        .waitForFunction(
          () => {
            const rail = document.getElementById('scene-video-rail');
            return (
              rail &&
              (rail.dataset.platforms || '').split(',').filter(Boolean)
                .length >= 2
            );
          },
          { timeout: 150000, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
      firstClipAt = nowUtc();
      const snap = await page.evaluate(() => {
        const rail = document.getElementById('scene-video-rail');
        return {
          railState: rail?.dataset.state,
          platforms: rail?.dataset.platforms,
          clips: Number(rail?.dataset.clips || 0),
          composerState:
            document.getElementById('incident-composer')?.dataset.state ||
            document
              .getElementById('incident-composer')
              ?.getAttribute('data-state'),
          buildingChip:
            document.querySelector(
              '#incident-composer-chips [data-step="building"]',
            )?.dataset.status || null,
        };
      });
      return {
        pass: ok,
        detail: `submitted ${submittedAt}; ≥2 platforms at ${firstClipAt}; rail=${snap.railState} platforms=${snap.platforms} clips=${snap.clips}; stream still running=${snap.railState === 'searching'}; composer=${snap.composerState}/${snap.buildingChip}`,
        data: { ...snap, submittedAt, searchingShot },
        screenshot: await shot(page, `2b-clips-arriving-${tag}`),
      };
    });

    await record(vp, '3-video-playback', async () => {
      await page
        .waitForFunction(
          () =>
            document.getElementById('scene-video-rail')?.dataset.state ===
            'done',
          { timeout: 120000, polling: 1000 },
        )
        .catch(() => {});
      // If the queue started on an iframe (no mp4 yet), switch to the first mp4 clip.
      await page.evaluate(() => {
        if (!document.querySelector('#scene-video-rail video')) {
          const li = document.querySelector(
            '#scene-video-rail .svr__clip[data-playable="mp4"] .svr__play',
          );
          li?.click();
        }
      });
      const res = await page
        .waitForFunction(
          () => {
            const v = document.querySelector('#scene-video-rail video');
            if (!v) return false;
            window.__svrT = window.__svrT || [];
            window.__svrT.push(v.currentTime);
            const t = window.__svrT;
            return v.readyState >= 3 &&
              t.length > 3 &&
              t[t.length - 1] > t[0] + 0.5
              ? {
                  readyState: v.readyState,
                  t0: t[0],
                  t1: t[t.length - 1],
                  muted: v.muted,
                  paused: v.paused,
                  src: v.currentSrc.slice(0, 90),
                  clip: v.dataset.clipId,
                  duration: v.duration,
                }
              : false;
          },
          { timeout: 90000, polling: 500 },
        )
        .then((h) => h.jsonValue())
        .catch(() => null);
      await sleep(1200);
      return {
        pass: Boolean(res),
        detail: res
          ? `clip ${res.clip} readyState=${res.readyState} currentTime ${res.t0.toFixed(2)}→${res.t1.toFixed(2)} muted=${res.muted} duration=${res.duration} src=${res.src}`
          : 'no advancing <video>',
        data: res,
        screenshot: await shot(page, `3-playback-${tag}`),
      };
    });

    await record(vp, '4-archival-labels', async () => {
      const r = await page.evaluate(() => {
        const rail = document.getElementById('scene-video-rail');
        const clips = [...rail.querySelectorAll('.svr__clip')];
        const badges = clips.map(
          (c) => c.querySelector('[data-tier-badge]')?.textContent,
        );
        const banner = document.getElementById('scene-video-rail-banner');
        const counts = {};
        for (const c of clips)
          counts[c.dataset.platform] = (counts[c.dataset.platform] || 0) + 1;
        return {
          clips: clips.length,
          badges,
          everyClipBadged:
            clips.length > 0 &&
            badges.every((b) => ['LIVE', 'RECENT', 'ARCHIVAL'].includes(b)),
          liveCount: badges.filter((b) => b === 'LIVE').length,
          bannerVisible:
            banner &&
            !banner.hidden &&
            getComputedStyle(banner).display !== 'none',
          bannerText: banner?.textContent,
          dateLines: clips
            .slice(0, 4)
            .map((c) => c.querySelector('.svr__clip-when')?.textContent),
          sourceLinks: clips.filter((c) =>
            c.querySelector('a.svr__src')?.href?.startsWith('https://'),
          ).length,
          counts,
          status: rail.querySelector('.svr__status-text')?.textContent,
        };
      });
      const bannerOk =
        /^REBUILT FROM ARCHIVAL FOOTAGE: recorded \d{2} [A-Z][a-z]{2} \d{4}, not live$/.test(
          r.bannerText || '',
        );
      return {
        pass:
          r.everyClipBadged &&
          r.bannerVisible &&
          bannerOk &&
          r.sourceLinks === r.clips,
        detail: `${r.clips} clips ${JSON.stringify(r.counts)}; badges=${[...new Set(r.badges)].join('/')}; LIVE=${r.liveCount}; banner="${r.bannerText}"; source links ${r.sourceLinks}/${r.clips}`,
        data: r,
        screenshot: await shot(page, `4-archival-labels-${tag}`),
      };
    });

    await record(vp, '5-iframe-embed', async () => {
      const harness = await browser.newPage();
      await harness.setViewport({
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      const resp = await harness.goto(`${appUrl}/embed-harness.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      const ok = await harness
        .waitForFunction(
          () =>
            /OnDemand/i.test(document.body.dataset.iframeTitle || '') &&
            document.body.dataset.iframeCanvas === 'true',
          { timeout: 150000, polling: 1000 },
        )
        .then(() => true)
        .catch(() => false);
      const inner = await harness.evaluate(() => {
        const f = document.querySelector('iframe');
        const d = f?.contentDocument;
        return {
          title: d?.title,
          composer: Boolean(d?.getElementById('incident-composer')),
          rail: Boolean(d?.getElementById('scene-video-rail')),
        };
      });
      const headers = resp?.headers() || {};
      const file = await shot(harness, `5-iframe-${tag}`);
      await harness.close();
      return {
        pass: ok && inner.composer && inner.rail,
        detail: `iframe title="${inner.title}" composer=${inner.composer} rail=${inner.rail}; harness x-frame-options=${headers['x-frame-options'] || 'none'}`,
        data: inner,
        screenshot: file,
      };
    });
    await page.close();
  }
} finally {
  clearTimeout(cap);
  results.finishedUtc = nowUtc();
  writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  log(`summary ${JSON.stringify(results.summary)}`);
  await browser.close().catch(() => {});
  hardKill();
}
process.exit(results.summary.fail ? 1 : 0);
