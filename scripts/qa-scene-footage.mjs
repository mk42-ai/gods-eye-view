#!/usr/bin/env node
/**
 * Snapchat scene-footage regression (cycle 19) — real plugin, real browser.
 *
 * Loads public/embed-canvas-harness.html (a MIRROR of the OnDemand chat-canvas
 * embed — NOT the real OnDemand host) from a separate local origin so the app
 * runs in a CROSS-ORIGIN sandboxed iframe, then drives the visible AOI box and
 * BUILD SCENE with native keyboard/mouse/touch input and verifies, per stage
 * with ISO timestamps: scene selection → backend request (network trace) →
 * OnDemand session/query with the Snapchat plugin id (server trace) →
 * schema-validated clips → in-scene playback (readyState ≥ 3, currentTime
 * advancing, muted) → refresh tick (last-checked moves, current clip kept,
 * no duplicates). Plus: rapid A→B→A→C race, expired-link (injected 403 on the
 * storage MP4), empty result (real), forced plugin error / credentials state
 * (injected API responses, labelled as such), timestamp honesty, no LIVE
 * label, and the OnDemand key never present in browser traffic.
 *
 * Usage: node scripts/qa-scene-footage.mjs --url https://sb-xxxx.vercel.run --label after
 *        [--viewports 1440x900,375x739] [--record out.mp4] [--mode full|before]
 * The key to scan for is read from ONDEMAND_KEY_TO_SCAN (env only, never printed).
 *
 * Supervision: worker in its OWN process group; Chromium + screencast ffmpeg
 * inherit it; supervisor SIGKILLs the whole group on exit/signal/hard cap.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utc = () => new Date().toISOString();
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const killGroup = (pid) => {
  if (pid > 1)
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
};
const safe = (t) =>
  String(t)
    .replace(/sig=[^&"\s]+/g, 'sig=<redacted>')
    .replace(/\b(?:apikey|authorization)[=: ]+\S+/gi, '[credential omitted]')
    .slice(0, 600);

const LOCATIONS = [
  { id: 'marina', text: 'Dubai Marina', locationId: 'snap-dubai-marina' },
  { id: 'burj', text: 'Burj Khalifa', locationId: 'snap-burj-khalifa' },
  { id: 'jbr', text: 'Jumeirah Beach Residence', locationId: 'snap-jumeirah-beach-residence' },
  { id: 'corniche', text: 'Abu Dhabi Corniche', locationId: 'snap-abu-dhabi-corniche' },
];

async function worker(cfg) {
  const { default: puppeteer } = await import('puppeteer');
  const KEY = process.env.ONDEMAND_KEY_TO_SCAN || '';
  const report = { startedUtc: utc(), url: cfg.url, label: cfg.label, mode: cfg.mode, host: 'MIRRORED chat-canvas harness (cross-origin sandboxed iframe) — not the real OnDemand host', driver: 'Puppeteer (repo devDependency) driving /usr/bin/chromium', runs: [], passed: 0, failed: 0, failures: [], keyScan: { checked: 0, hits: 0, enabled: Boolean(KEY) } };
  const save = () => fs.writeFile(cfg.report, JSON.stringify(report, null, 2));
  const check = (run, name, ok, detail) => {
    const item = { utc: utc(), name, ok: Boolean(ok), detail };
    run.checks.push(item);
    if (ok) report.passed += 1;
    else {
      report.failed += 1;
      report.failures.push(`${run.id}: ${name} — ${safe(JSON.stringify(detail)).slice(0, 300)}`);
    }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${item.utc} ${run.id} ${name} ${safe(JSON.stringify(detail)).slice(0, 220)}`);
    return ok;
  };
  const harnessHtml = await fs.readFile(path.join(REPO, 'public/embed-canvas-harness.html'), 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(harnessHtml);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // The app's CSP is frame-ancestors 'self' https://on-demand.io https://*.on-demand.io,
  // so the mirrored host page is served AS https://canvas.on-demand.io (fulfilled
  // locally by request interception — no request leaves the machine for it). The
  // app's real CSP stays in force; the parent is a genuinely allowed origin.
  const hostOrigin = cfg.hostOrigin;
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    protocolTimeout: 300000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  process.send?.({ browserPid: browser.process()?.pid });
  try {
    for (const vp of cfg.viewports) {
      const [width, height] = vp.split('x').map(Number);
      const mobile = width < 600;
      const run = { id: `${cfg.label}-${vp}`, viewport: vp, startedUtc: utc(), checks: [], stages: [], network: [], pageErrors: [], screenshots: [], locations: {} };
      report.runs.push(run);
      const stage = (location, name, data = {}) => {
        const s = { utc: utc(), location, stage: name, ...data };
        run.stages.push(s);
        console.log(`STAGE ${s.utc} ${run.id} ${location} ${name} ${safe(JSON.stringify(data)).slice(0, 200)}`);
      };
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      page.on('pageerror', (e) => run.pageErrors.push({ utc: utc(), text: safe(e.message) }));
      // ---- request interception: key scan + injected failures (labelled) ----
      const inject = { mediaFail: 0, mediaFailAlways: false, api: null };
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        try {
          const u = req.url();
          if (!cfg.sameOriginHost && u.startsWith(hostOrigin + '/')) return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: harnessHtml });
          if (KEY) {
            report.keyScan.checked += 1;
            const hay = `${u}\n${JSON.stringify(req.headers())}\n${req.postData() || ''}`;
            if (hay.includes(KEY)) report.keyScan.hits += 1;
          }
          if (/\.blob\.core\.windows\.net\/.+\.mp4/.test(u) && (inject.mediaFail > 0 || inject.mediaFailAlways)) {
            if (inject.mediaFail > 0) inject.mediaFail -= 1;
            run.network.push({ utc: utc(), injected: true, kind: 'media-403', url: safe(u.split('?')[0]) });
            return req.respond({ status: 403, contentType: 'application/xml', body: '<Error><Code>AuthenticationFailed</Code><Message>Signed expiry time has passed (INJECTED BY QA)</Message></Error>' });
          }
          if (inject.api && u.includes('/api/scenes/') && req.method() === 'POST') {
            const body = JSON.parse(req.postData() || '{}');
            const r = inject.api;
            run.network.push({ utc: utc(), injected: true, kind: `api-${r.state}`, path: new URL(u).pathname });
            return req.respond({ status: r.status, contentType: 'application/json', body: JSON.stringify({ state: r.state, error: r.error, locationId: body.locationId, clips: [], refresh: { defaultMs: 120000, minMs: 30000 }, injectedByQa: true }) });
          }
          req.continue();
        } catch {
          req.continue().catch(() => {});
        }
      });
      page.on('response', async (res) => {
        try {
          const u = new URL(res.url());
          if (!u.pathname.startsWith('/api/scenes/')) return;
          const req = res.request();
          let json = null;
          try { json = await res.json(); } catch { /* injected/opaque */ }
          if (KEY && json && JSON.stringify(json).includes(KEY)) report.keyScan.hits += 1;
          run.network.push({ utc: utc(), method: req.method(), path: u.pathname, status: res.status(), requestBody: JSON.parse(req.postData() || '{}'), state: json?.state, clips: json?.clips?.length, requestId: json?.requestId, trace: json?.trace, ladder: json?.ladder, coverageLevel: json?.coverageLevel, expanded: json?.expanded, rejected: json?.rejected, injected: Boolean(json?.injectedByQa), clipsRaw: json?.clips?.map((c) => ({ id: c.id, publicationTime: c.publicationTime, publicationTimeRaw: c.publicationTimeRaw, captureTime: c.captureTime, isLive: c.isLive, retrievalTime: c.retrievalTime, mediaExpiresAt: c.mediaExpiresAt, matchedPlaceName: c.matchedPlaceName, locationEvidence: c.locationEvidence, sourceUrl: c.sourceUrl })) });
        } catch { /* diagnostics only */ }
      });
      const shot = async (name) => {
        const file = path.join(cfg.out, `${cfg.label}-${name}-${vp}.png`);
        await page.screenshot({ path: file });
        run.screenshots.push(path.basename(file));
        return file;
      };
      const target = `${cfg.url.replace(/\/$/, '')}/?welcome=0`;
      // Local http baselines cannot be framed by an https parent (mixed content) and the
      // app CSP only allows self/on-demand.io parents: --same-origin-host serves the
      // harness from the app itself (labelled same-origin in the report).
      if (cfg.sameOriginHost) report.host = 'MIRRORED chat-canvas harness served SAME-ORIGIN from the app (local http baseline only)';
      await page.goto(`${cfg.sameOriginHost ? cfg.url.replace(/\/$/, '') + '/embed-canvas-harness.html' : hostOrigin + '/'}?src=${encodeURIComponent(target)}&allow=restrictive`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      let frame = null;
      for (let i = 0; i < 120 && !frame; i += 1) {
        frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(cfg.url.replace(/\/$/, '')));
        if (!frame) await sleep(500);
      }
      check(run, 'cross-origin-iframe-found', Boolean(frame), { hostOrigin });
      await frame.waitForSelector('#incident-composer-input', { timeout: 90000 });
      await sleep(cfg.settleMs);
      const fstate = () => frame.evaluate(() => window.__gevSceneFootage?.getState?.() || null);
      const typeAndBuild = async (text, via) => {
        const input = await frame.$('#incident-composer-input');
        if (mobile) await input.tap(); else await input.click({ clickCount: 3 });
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
        await page.keyboard.type(text, { delay: 18 });
        // In-page timing (performance.now) from the trusted submit event to the first
        // pending-feedback node — excludes CDP/iframe polling latency.
        await frame.evaluate(() => {
          window.__qaPending = { submitAt: null, pendingAt: null };
          const mark = () => { if (window.__qaPending.submitAt === null) window.__qaPending.submitAt = performance.now(); };
          document.addEventListener('keydown', (e) => { if (e.key === 'Enter') mark(); }, { capture: true, once: true });
          document.getElementById('incident-composer-submit')?.addEventListener('pointerdown', mark, { capture: true, once: true });
          document.getElementById('incident-composer-submit')?.addEventListener('click', mark, { capture: true, once: true });
          const seen = () => document.querySelector('#incident-composer-result .incident-composer__message--pending, #incident-composer[data-state="busy"]');
          const mo = new MutationObserver(() => { if (window.__qaPending.submitAt !== null && window.__qaPending.pendingAt === null && seen()) { window.__qaPending.pendingAt = performance.now(); mo.disconnect(); } });
          mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'class'] });
        });
        const t0 = Date.now();
        if (via === 'enter') await page.keyboard.press('Enter');
        else { const btn = await frame.$('#incident-composer-submit'); if (mobile) await btn.tap(); else await btn.click(); }
        const seenAt = await frame.waitForSelector('#incident-composer-result .incident-composer__message--pending, #incident-composer[data-state="busy"]', { timeout: 8000 }).then(() => Date.now() - t0).catch(() => null);
        const inPage = await frame.evaluate(() => window.__qaPending);
        const pendingMs = inPage?.submitAt != null && inPage?.pendingAt != null ? Math.round((inPage.pendingAt - inPage.submitAt) * 10) / 10 : seenAt === null ? null : -1;
        return pendingMs;
      };
      const waitFootage = (locationId, timeout = 200000) =>
        frame.waitForFunction((id) => { const r = document.querySelector('#scene-footage'); return r && r.dataset.locationId === id && !['idle', 'loading'].includes(r.dataset.phase); }, { timeout, polling: 250 }, locationId).then(() => true).catch(() => false);
      const playback = async () => {
        const a = await frame.evaluate(() => { const v = document.querySelector('#scene-footage-video'); return v ? { rs: v.readyState, t: v.currentTime, muted: v.muted, playsInline: v.playsInline, paused: v.paused, clipId: v.dataset.clipId, locationId: v.dataset.locationId, err: v.error?.code ?? null } : null; });
        await sleep(2500);
        const b = await frame.evaluate(() => { const v = document.querySelector('#scene-footage-video'); return v ? { rs: v.readyState, t: v.currentTime, muted: v.muted, clipId: v.dataset.clipId } : null; });
        return { a, b };
      };
      const panelText = () => frame.evaluate(() => document.querySelector('#scene-footage')?.innerText || '');
      await shot('idle');
      if (cfg.mode === 'before') {
        const pendingMs = await typeAndBuild('Dubai Marina', 'button');
        check(run, 'before: pending feedback', pendingMs !== null, { pendingMs });
        await sleep(25000);
        const hasPanel = await frame.evaluate(() => Boolean(document.querySelector('#scene-footage')));
        check(run, 'before: no Snapchat footage panel exists (baseline)', !hasPanel, { hasPanel });
        await shot('marina-30s');
      } else {
        const list = mobile ? LOCATIONS.filter((l) => ['marina', 'corniche'].includes(l.id)) : LOCATIONS;
        for (const loc of list) {
          const L = (run.locations[loc.id] = { text: loc.text });
          stage(loc.id, 'scene-selection', { input: loc.text, via: loc.id === 'burj' ? 'enter' : mobile ? 'tap' : 'click' });
          const netBefore = run.network.length;
          const pendingMs = await typeAndBuild(loc.text, loc.id === 'burj' ? 'enter' : 'button');
          L.pendingMs = pendingMs;
          check(run, `${loc.id}: pending feedback appears immediately (in-page submit→pending < 250 ms)`, pendingMs !== null && pendingMs >= 0 && pendingMs < 250, { pendingMs });
          if (loc.id === 'marina') await shot('marina-pending');
          const footageLoading = await frame.waitForFunction(() => document.querySelector('#scene-footage')?.dataset.phase === 'loading', { timeout: 30000 }).then(() => true).catch(() => false);
          stage(loc.id, 'footage-loading-visible', { ok: footageLoading });
          const settled = await waitFootage(loc.locationId);
          const st = await fstate();
          const apiCalls = run.network.slice(netBefore).filter((n) => n.path === `/api/scenes/${loc.locationId}/footage/snapchat` && !n.injected);
          const last = apiCalls.at(-1);
          stage(loc.id, 'backend-request', { method: last?.method, path: last?.path, status: last?.status, requestBody: last?.requestBody });
          check(run, `${loc.id}: footage request settled for the active locationId`, settled, { phase: st?.phase, locationId: st?.locationId });
          check(run, `${loc.id}: POST /api/scenes/:locationId/footage/snapchat observed`, Boolean(last) && last.method === 'POST', { status: last?.status, body: last?.requestBody && Object.keys(last.requestBody) });
          const t = last?.trace || [];
          const submit = t.find((x) => x.stage === 'query_submit');
          stage(loc.id, 'ondemand-session-and-query', { session_create: t.find((x) => x.stage === 'session_create')?.utc, session_created: t.find((x) => x.stage === 'session_created')?.utc, sessionId: t.find((x) => x.stage === 'session_created')?.sessionId, query_submit: submit?.utc, pluginIds: submit?.pluginIds, query_completed: t.find((x) => x.stage === 'query_completed')?.utc, cached: t.some((x) => x.stage === 'cache_hit') });
          check(run, `${loc.id}: OnDemand query carried pluginIds [plugin-1792945050] (or served from the per-location cache of such a query)`, (submit?.pluginIds || []).includes('plugin-1792945050') || t.some((x) => x.stage === 'cache_hit'), { pluginIds: submit?.pluginIds, cache: t.some((x) => x.stage === 'cache_hit') });
          stage(loc.id, 'schema-validated', { state: last?.state, clips: last?.clips, coverageLevel: last?.coverageLevel, expanded: last?.expanded, rejected: (last?.rejected || []).map((r) => r.reason), ladder: (last?.ladder || []).map((l) => `${l.label}:${l.level}:${l.queried ? 'q' : '-'}${l.capped ? ':capped' : ''}:${l.clips}`) });
          L.state = last?.state; L.clips = last?.clips; L.ladder = last?.ladder; L.rejected = last?.rejected; L.trace = t; L.coverageLevel = last?.coverageLevel; L.expanded = last?.expanded; L.clipsRaw = last?.clipsRaw;
          const text = await panelText();
          L.panelText = text.slice(0, 1500);
          check(run, `${loc.id}: no clip labelled LIVE`, !/\bLIVE\b/.test(text.replace(/not live/gi, '')) && (last?.clipsRaw || []).every((c) => c.isLive === false), {});
          if (last?.state === 'ok' && st?.clipIds?.length) {
            const pb = await playback();
            stage(loc.id, 'in-scene-playback', pb);
            L.playback = pb;
            check(run, `${loc.id}: playback readyState ≥ 3, currentTime advancing, muted`, pb.a && pb.b && pb.b.rs >= 3 && pb.b.t > pb.a.t && pb.a.muted && pb.b.muted && pb.a.playsInline, pb);
            check(run, `${loc.id}: playing clip belongs to the active locationId`, pb.a?.locationId === loc.locationId, { video: pb.a?.locationId });
            // timestamp honesty: displayed published UTC stamp == parsed raw
            const raw = last.clipsRaw.find((c) => c.id === st.selectedId) || last.clipsRaw[0];
            const shown = text.match(/published [^(]+\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC\)/)?.[1];
            check(run, `${loc.id}: displayed publication time matches raw uploadDateMs (UTC)`, raw?.publicationTime && shown === raw.publicationTime.slice(0, 16).replace('T', ' '), { raw: raw?.publicationTimeRaw, parsed: raw?.publicationTime, shown });
            check(run, `${loc.id}: capture time shown as unknown (plugin returns none)`, /capture time unknown/.test(text) && raw?.captureTime === null, {});
            check(run, `${loc.id}: source attribution + original link shown`, /Source: Snapchat Spotlight/.test(text) && /open original/.test(text), { sourceUrl: raw?.sourceUrl });
            if (loc.id === 'marina') {
              await shot('marina-playing');
              // ---- refresh tick ----
              const before = await fstate();
              const sel = await frame.$('#scene-footage-refresh');
              stage(loc.id, 'refresh-tick-start', { lastCheckedAt: before.lastCheckedAt, selectedId: before.selectedId, refreshMs: before.refreshMs, via: mobile ? 'CHECK NOW tap' : 'interval timer set to 30 s via the UI select' });
              if (!mobile) await sel.select('30000');
              else { const b = await frame.$('#scene-footage-check'); await b.tap(); }
              const ticked = await frame.waitForFunction((prev) => { const s = window.__gevSceneFootage.getState(); return s.refreshCount > prev && s.lastCheckedAt; }, { timeout: 200000, polling: 500 }, before.refreshCount).then(() => true).catch(() => false);
              const after = await fstate();
              const ids = after.clipIds;
              stage(loc.id, 'refresh-tick-done', { ticked, lastCheckedAt: after.lastCheckedAt, selectedId: after.selectedId, refreshCount: after.refreshCount, clipIds: ids.length, refreshMs: after.refreshMs });
              const videoAfter = await frame.evaluate(() => document.querySelector('#scene-footage-video')?.dataset.clipId);
              check(run, 'marina: refresh tick updated last-checked time', ticked && after.lastCheckedAt !== before.lastCheckedAt, { before: before.lastCheckedAt, after: after.lastCheckedAt });
              check(run, 'marina: refresh preserved the current clip', after.selectedId === before.selectedId && videoAfter === before.selectedId, { before: before.selectedId, after: after.selectedId, videoAfter });
              check(run, 'marina: refresh merged without duplicates', new Set(ids).size === ids.length, { ids: ids.length });
              const domIds = await frame.evaluate(() => [...document.querySelectorAll('#scene-footage-clips [data-clip-id]')].map((n) => n.dataset.clipId));
              check(run, 'marina: clip selector has no duplicate entries', new Set(domIds).size === domIds.length, { domIds: domIds.length });
              await shot('marina-refreshed');
              if (!mobile) { const s2 = await frame.$('#scene-footage-refresh'); await s2.select('0'); }
              // ---- expired link (INJECTED 403 on the storage MP4) ----
              await page.setCacheEnabled(false);
              inject.mediaFail = 1;
              stage(loc.id, 'expired-link-injected', { note: 'next storage MP4 request answered 403 by the QA harness (injected)' });
              await frame.evaluate(() => { const v = document.querySelector('#scene-footage-video'); const src = v.src; v.removeAttribute('src'); v.load(); v.src = src; v.play().catch(() => {}); });
              const refetched = await frame.waitForFunction(() => /Media link refreshed|re-fetching/.test(document.querySelector('#scene-footage-status')?.innerText || ''), { timeout: 200000, polling: 300 }).then(() => true).catch(() => false);
              await frame.waitForFunction(() => document.querySelector('#scene-footage')?.dataset.phase === 'ready' && !/re-fetching/.test(document.querySelector('#scene-footage-status')?.innerText || ''), { timeout: 200000 }).catch(() => {});
              await sleep(3000);
              const pb2 = await playback();
              check(run, 'marina: expired link → one automatic re-fetch, playback resumes', refetched && pb2.b?.rs >= 3 && pb2.b.t > pb2.a.t, { refetched, pb2 });
              inject.mediaFailAlways = true;
              await frame.evaluate(() => { const v = document.querySelector('#scene-footage-video'); const src = v.src; v.removeAttribute('src'); v.load(); v.src = src; v.play().catch(() => {}); });
              const gaveUp = await frame.waitForFunction(() => /expired again after one re-fetch/.test(document.querySelector('#scene-footage-status')?.innerText || ''), { timeout: 200000, polling: 300 }).then(() => true).catch(() => false);
              check(run, 'marina: second expiry → message, no further re-fetch loop', gaveUp, {});
              await shot('expired-message');
              inject.mediaFailAlways = false;
              await page.setCacheEnabled(true);
            }
          } else {
            const msg = await frame.evaluate(() => document.querySelector('#scene-footage-status')?.innerText || '');
            stage(loc.id, 'no-playable-clip', { state: last?.state, message: msg.slice(0, 300) });
            check(run, `${loc.id}: honest non-ok state rendered (no substitute footage)`, ['empty', 'plugin_error', 'timeout', 'rate_limited'].includes(last?.state) && (await frame.$('#scene-footage-video')) === null, { state: last?.state, msg: msg.slice(0, 160) });
            if (last?.state === 'empty') check(run, `${loc.id}: empty message text`, /No relevant Snapchat footage found for this area/.test(msg), {});
            if (last?.expanded) check(run, `${loc.id}: wider coverage was searched and disclosed`, (last.ladder || []).filter((l) => l.queried).length > 1, { ladder: (last.ladder || []).map((l) => l.label) });
            await shot(`${loc.id}-result`);
          }
        }
        // ---- rapid A→B→A→C race (programmatic opens, real network) ----
        stage('race', 'start', { sequence: 'Dubai Marina → Burj Khalifa → Dubai Marina → Abu Dhabi Corniche' });
        const mismatches = await frame.evaluate(async () => {
          const api = window.__gevSceneFootage;
          const bad = [];
          let samples = 0;
          const probe = setInterval(() => {
            samples += 1;
            const root = document.querySelector('#scene-footage');
            const active = root?.dataset.locationId;
            for (const n of document.querySelectorAll('#scene-footage [data-location-id]')) if (n.dataset.locationId !== active) bad.push({ active, rendered: n.dataset.locationId });
          }, 50);
          const A = { lat: 25.0786415, lon: 55.1352524, place: 'Dubai Marina', force: true };
          const B = { lat: 25.1970336, lon: 55.2741329, place: 'Burj Khalifa', force: true };
          const C = { lat: 24.474, lon: 54.329, place: 'Abu Dhabi Corniche', force: true };
          api.open(A, 'race'); await new Promise((r) => setTimeout(r, 120));
          api.open(B, 'race'); await new Promise((r) => setTimeout(r, 120));
          api.open(A, 'race'); await new Promise((r) => setTimeout(r, 120));
          api.open(C, 'race');
          const t0 = Date.now();
          while (Date.now() - t0 < 180000) { const s = api.getState(); if (s.locationId === 'snap-abu-dhabi-corniche' && !['loading', 'idle'].includes(s.phase)) break; await new Promise((r) => setTimeout(r, 250)); }
          await new Promise((r) => setTimeout(r, 1500));
          clearInterval(probe);
          const s = api.getState();
          return { bad: bad.slice(0, 5), badCount: bad.length, samples, final: { locationId: s.locationId, phase: s.phase, clips: s.clipIds.length, discarded: s.discarded } };
        });
        stage('race', 'done', mismatches);
        check(run, 'race A→B→A→C: rendered clips always matched the active locationId', mismatches.badCount === 0 && mismatches.final.locationId === 'snap-abu-dhabi-corniche', mismatches);
        // ---- forced plugin error + credentials state (INJECTED API responses) ----
        for (const forced of [{ state: 'plugin_error', status: 502, error: 'upstream_500', re: /Snapchat plugin error/ }, { state: 'credentials_required', status: 503, error: 'credentials_required', re: /Credentials required/ }]) {
          inject.api = forced;
          await frame.evaluate((st) => window.__gevSceneFootage.open({ lat: 25.0786415, lon: 55.1352524, place: 'Dubai Marina', force: true }, `forced-${st}`), forced.state);
          const ok = await frame.waitForFunction((st) => document.querySelector('#scene-footage')?.dataset.phase === st, { timeout: 30000 }, forced.state).then(() => true).catch(() => false);
          const msg = await frame.evaluate(() => document.querySelector('#scene-footage-status')?.innerText || '');
          check(run, `forced ${forced.state} (INJECTED response) renders its state and no video`, ok && forced.re.test(msg) && (await frame.$('#scene-footage-video')) === null, { msg: msg.slice(0, 140) });
          await shot(`forced-${forced.state}`);
          inject.api = null;
        }
      }
      check(run, 'no uncaught page errors', run.pageErrors.length === 0, run.pageErrors.slice(0, 3));
      run.endedUtc = utc();
      await save();
      await ctx.close();
    }
  } finally {
    report.endedUtc = utc();
    if (report.keyScan.enabled) {
      const item = { utc: utc(), name: 'OnDemand key never present in browser requests/responses', ok: report.keyScan.hits === 0, detail: { requestsChecked: report.keyScan.checked, hits: report.keyScan.hits } };
      report.runs.at(-1)?.checks.push(item);
      if (item.ok) report.passed += 1; else { report.failed += 1; report.failures.push(item.name); }
      console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.utc} key-scan ${JSON.stringify(item.detail)}`);
    }
    await save();
    await browser.close().catch(() => {});
    server.close();
  }
}

async function recordWorker(cfg) {
  // Short continuous recording: scene → footage → refresh (desktop, harness).
  const { default: puppeteer } = await import('puppeteer');
  const harnessHtml = await fs.readFile(path.join(REPO, 'public/embed-canvas-harness.html'), 'utf8');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(harnessHtml); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  process.send?.({ browserPid: browser.process()?.pid });
  const log = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith(cfg.hostOrigin + '/') ? req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: harnessHtml }) : req.continue()));
    const target = `${cfg.url.replace(/\/$/, '')}/?welcome=0`;
    await page.goto(`${cfg.hostOrigin}/?src=${encodeURIComponent(target)}&allow=restrictive`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let frame = null;
    for (let i = 0; i < 120 && !frame; i += 1) { frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(cfg.url.replace(/\/$/, ''))); if (!frame) await sleep(500); }
    await frame.waitForSelector('#incident-composer-input', { timeout: 90000 });
    await sleep(cfg.settleMs);
    const rec = await page.screencast({ path: cfg.record, fps: 15, quality: 28 });
    log.push({ utc: utc(), event: 'recording-start' });
    const input = await frame.$('#incident-composer-input');
    await input.click({ clickCount: 3 });
    await page.keyboard.type('Dubai Marina', { delay: 60 });
    await (await frame.$('#incident-composer-submit')).click();
    log.push({ utc: utc(), event: 'BUILD SCENE clicked' });
    await frame.waitForFunction(() => document.querySelector('#scene-footage')?.dataset.phase === 'ready', { timeout: 200000 });
    log.push({ utc: utc(), event: 'footage ready', state: await frame.evaluate(() => ({ t: document.querySelector('#scene-footage-video')?.currentTime })) });
    await sleep(6000);
    const prev = await frame.evaluate(() => window.__gevSceneFootage.getState().refreshCount);
    await (await frame.$('#scene-footage-check')).click();
    log.push({ utc: utc(), event: 'CHECK NOW clicked (refresh)' });
    await frame.waitForFunction((p) => window.__gevSceneFootage.getState().refreshCount > p, { timeout: 200000, polling: 500 }, prev);
    log.push({ utc: utc(), event: 'refresh done', state: await frame.evaluate(() => { const s = window.__gevSceneFootage.getState(); return { lastCheckedAt: s.lastCheckedAt, selectedId: s.selectedId, t: document.querySelector('#scene-footage-video')?.currentTime }; }) });
    await sleep(6000);
    await rec.stop();
    log.push({ utc: utc(), event: 'recording-stop' });
  } finally {
    await fs.writeFile(cfg.report, JSON.stringify(log, null, 2));
    await browser.close().catch(() => {});
    server.close();
  }
}

if (process.argv[2] === '--worker') {
  const cfg = JSON.parse(process.argv[3]);
  await (cfg.mode === 'record' ? recordWorker(cfg) : worker(cfg));
  process.exit(0);
} else {
  const url = arg('url');
  if (!url) { console.error('--url is required'); process.exit(2); }
  const workspace = path.resolve(REPO, '..');
  const label = arg('label', 'after');
  const mode = arg('mode', 'full');
  const cfg = {
    url, label, mode,
    viewports: arg('viewports', '1440x900,375x739').split(','),
    record: arg('record', null),
    settleMs: Number(arg('settle-ms', 6000)),
    hostOrigin: arg('host-origin', 'https://canvas.on-demand.io'),
    sameOriginHost: process.argv.includes('--same-origin-host'),
    out: arg('out', path.join(workspace, '.ui-proof')),
    report: arg('report', `/tmp/qa-scene-footage-${label}.json`),
  };
  await fs.mkdir(cfg.out, { recursive: true });
  let child, browserPid;
  const cleanup = () => { killGroup(browserPid); killGroup(child?.pid); };
  process.on('exit', cleanup);
  const cap = setTimeout(() => { console.error('hard cap reached'); cleanup(); process.exit(124); }, Number(arg('max-ms', 1500000)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); process.exit(124); });
  try {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'ONDEMAND_KEY_TO_SCAN'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', JSON.stringify(cfg)], { cwd: REPO, detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env });
    child.on('message', (m) => { if (m.browserPid) browserPid = m.browserPid; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (mode !== 'record') {
      const result = JSON.parse(await fs.readFile(cfg.report, 'utf8'));
      console.log(JSON.stringify({ report: cfg.report, passed: result.passed, failed: result.failed, failures: result.failures, keyScan: result.keyScan, workerExitCode: code }, null, 2));
      process.exitCode = result.failed || code ? 1 : 0;
    } else process.exitCode = code;
  } finally { clearTimeout(cap); cleanup(); }
}
