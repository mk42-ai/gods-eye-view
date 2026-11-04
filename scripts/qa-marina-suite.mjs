/** Live UI integration suite. Native browser input only; DOM reads are assertions.
 * Existing Puppeteer owns an isolated browser process group, always closed/killed.
 * node scripts/qa-marina-suite.mjs --url <preview> --out /tmp/proof [--case desktop|mobile|iframe|extras|video]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runDesktop } from './qa-marina-desktop.mjs';
import { runMobile, runIframe } from './qa-marina-mobile.mjs';
const arg = (key, fallback) => { const i = process.argv.indexOf('--' + key); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://localhost:5173');
const out = path.resolve(arg('out', '/tmp/gev-marina-suite'));
const only = arg('case', 'all');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const startedUtc = new Date().toISOString();
const report = { startedUtc, url, assertions: [], cases: {}, network: [], errors: [] };
await fs.mkdir(out, { recursive: true });
let browser;
function cleanup() { const pid = browser?.process()?.pid; if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} } }
const cap = setTimeout(() => { report.errors.push('540-second suite wall-clock cap'); void save().finally(() => { cleanup(); process.exit(124); }); }, 540000);
process.on('exit', cleanup);
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => { cleanup(); process.exit(124); });
async function save() { report.finishedUtc = new Date().toISOString(); await fs.writeFile(path.join(out, `marina-${only}-suite.json`), JSON.stringify(report, null, 2)); }
async function assertion(id, work) { const row = { id, startedUtc: new Date().toISOString(), pass: false }; try { row.data = await work(); row.pass = true; } catch (e) { row.error = e.message; throw e; } finally { row.finishedUtc = new Date().toISOString(); report.assertions.push(row); await save(); } }
async function until(read, predicate, timeout = 40000) { const end = Date.now() + timeout; let value; while (Date.now() < end) { value = await read(); if (predicate(value)) return value; await sleep(400); } const e = new Error('Timed out waiting for real UI state'); e.state = value; throw e; }
async function pageFor(width = 375, height = 739) {
  const context = await browser.createBrowserContext(); const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  page.on('pageerror', e => report.errors.push({ type: 'pageerror', message: e.message }));
  page.on('response', response => { try { const u = new URL(response.url()); if (u.origin === new URL(url).origin && u.pathname.startsWith('/api/')) report.network.push({ utc: new Date().toISOString(), path: u.pathname, method: response.request().method(), status: response.status() }); } catch {} });
  return { context, page };
}
async function open(page) { await page.goto(url + '/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 90000 }); await page.waitForFunction(() => !!window.__gevIncidents?.composer && !!window.__godsEyeView?.viewer && (!document.querySelector('#loading-screen') || document.querySelector('#loading-screen').classList.contains('hidden')), { timeout: 70000 }); }
async function read(page) { return page.evaluate(() => ({ state: document.querySelector('#incident-composer')?.dataset.state, busy: window.__gevIncidents?.composer?.state.busy, text: document.querySelector('#incident-composer-result')?.textContent, scene: window.__gevIncidents?.composer?.state.lastScene?.id || null, active: document.querySelector('#scene-library')?.dataset.sceneId || null, marker: !!document.querySelector('.incident-external-marker.external'), play: !!document.querySelector('#incident-composer-play'), generation: window.__gevIncidents?.composer?.state.generation, scrollWidth: document.documentElement.scrollWidth, width: innerWidth })); }
async function type(page, value) { await page.click('#incident-composer-input'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type(value, { delay: 7 }); }
async function hit(page, selector) { return page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, h = document.elementFromPoint(x, y); return { x, y, width: r.width, height: r.height, ok: !!h && (h === e || e.contains(h)), disabled: !!e.disabled }; }, selector); }
async function nativeTap(page, selector) { const p = await hit(page, selector); assert(p?.ok && !p.disabled, `Actual hit target obstructed: ${selector}`); await page.touchscreen.tap(p.x, p.y); }
try {
  browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 90000 });
  for (const name of ['desktop', 'mobile', 'iframe', 'extras', 'video']) {
    if (only !== 'all' && !only.split(',').includes(name)) continue;
    const { context, page } = await pageFor(name === 'desktop' ? 1440 : 375, name === 'desktop' ? 900 : 739);
    try {
      if (name === 'desktop') report.cases.desktop = await runDesktop(page, { url, out, record: report.assertions });
      if (name === 'mobile' || name === 'iframe') report.cases[name] = await (name === 'mobile' ? runMobile : runIframe)(page, { url: url + '/?welcome=0', out, record: row => { report.assertions.push(row); } });
      if (name === 'extras') {
        await open(page);
        await assertion('extras.input-hit-targets', async () => { const a = await hit(page, '#incident-composer-input'), b = await hit(page, '#incident-composer-submit'); assert(a.ok && b.ok); return { input: a, submit: b }; });
        await assertion('extras.loading-cancel-retry', async () => {
          await type(page, 'Dubai Marina check if there are any incidents'); await nativeTap(page, '#incident-composer-submit');
          await until(() => read(page), s => s.busy, 10000);
          await nativeTap(page, '#incident-composer-cancel');
          const cancelled = await until(() => read(page), s => s.state === 'cancelled');
          assert(!cancelled.busy && !cancelled.scene && !cancelled.play);
          const retry = await hit(page, '#incident-composer-retry'); assert(retry.ok && !retry.disabled);
          await nativeTap(page, '#incident-composer-retry');
          await until(() => read(page), s => s.busy, 10000);
          const final = await until(() => read(page), s => !s.busy && ['partial', 'unavailable', 'done', 'error'].includes(s.state), 80000);
          assert(!final.scene && !final.play, 'A research question must not fabricate an incident scene');
          if (final.state === 'unavailable') assert(/unavailable|coverage|could not|failed/i.test(final.text));
          await page.screenshot({ path: path.join(out, 'marina-live-research-unavailable-375x739.png') });
          return { cancelled, retried: final, note: 'Real network; no mocked slow responses or fabricated incident data.' };
        });
        for (const viewport of [{ width: 375, height: 739, isMobile: true, hasTouch: true }, { width: 1440, height: 900, isMobile: false, hasTouch: false }]) {
          await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
          // Changing isMobile reloads Chrome's document; wait for the genuine
          // new app rather than typing into the soon-to-be-destroyed page.
          await open(page);
          await assertion(`extras.external-refusal-${viewport.width}`, async () => {
            await type(page, 'explosion at Bandar Abbas, Iran'); await page.keyboard.press('Enter');
            const final = await until(() => read(page), s => !s.busy && s.state === 'external');
            assert(final.marker && !final.play && !final.active && !final.scene); assert.match(final.text, /Outside UAE AOI/);
            await sleep(2400);
            const file = path.join(out, `marina-external-refusal-${viewport.width}x${viewport.height}.png`); await page.screenshot({ path: file });
            return { ...final, screenshot: file };
          });
        }
        report.cases.extras = { pass: true };
      }
      if (name === 'video') {
        await open(page); await type(page, 'rebuild the car crash reported in Umm Suqeim'); await page.keyboard.press('Enter');
        await assertion('video.actual-plugin-stream-and-archival-labels', async () => {
          const final = await until(() => page.evaluate(() => ({ clips: window.__gevSceneVideos?.getState(), state: document.querySelector('#scene-video-rail')?.dataset.state, count: document.querySelectorAll('.svr__clip').length, text: document.querySelector('#scene-video-rail')?.textContent?.slice(0, 1000) })), s => s.clips?.done || s.state === 'error', 205000);
          assert(final.clips?.clips > 0, 'No actual clips returned'); assert(final.clips.tiers.every(t => t === 'ARCHIVAL'), 'Old clips must not be labelled live');
          return final;
        });
        await assertion('video.muted-actual-playback-time-advances', async () => {
          // Earlier short MP4s may finish while the remaining sources stream.
          // Restart one through its actual visible Play control, never internal state.
          await page.waitForSelector('.svr__clip[data-playable="mp4"] .svr__play', { visible: true, timeout: 15000 });
          await page.click('.svr__clip[data-playable="mp4"] .svr__play');
          await until(() => page.evaluate(() => !!document.querySelector('#scene-video-rail video')), Boolean, 15000);
          const first = await page.evaluate(() => { const v = document.querySelector('#scene-video-rail video'); return { readyState: v.readyState, time: v.currentTime, muted: v.muted, paused: v.paused, source: new URL(v.currentSrc).pathname }; });
          const advanced = await until(() => page.evaluate(() => { const v = document.querySelector('#scene-video-rail video'); return { readyState: v?.readyState, time: v?.currentTime, muted: v?.muted, paused: v?.paused }; }), x => x.readyState >= 2 && !x.paused && x.time > first.time + .4, 20000);
          assert(advanced.muted); await page.screenshot({ path: path.join(out, 'marina-archival-video-playing-375x739.png') }); return { first, advanced };
        });
        report.cases.video = { pass: true };
      }
    } catch (e) { report.cases[name] = { pass: false, error: e.message, state: e.state }; try { await page.screenshot({ path: path.join(out, `${name}-failure.png`) }); } catch {} }
    finally { await context.close(); await save(); }
  }
} catch (e) { report.errors.push(e.message); }
finally { clearTimeout(cap); try { await browser?.close(); } catch {} cleanup(); await save(); }
console.log(JSON.stringify({ report: path.join(out, `marina-${only}-suite.json`), cases: report.cases, passed: report.assertions.filter(a => a.pass).length, failed: report.assertions.filter(a => !a.pass).length, errors: report.errors }, null, 2));
process.exitCode = Object.values(report.cases).every(c => c.pass || c.ok) && !report.errors.length ? 0 : 1;
