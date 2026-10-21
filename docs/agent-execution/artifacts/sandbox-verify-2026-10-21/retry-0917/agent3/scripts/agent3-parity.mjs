import puppeteer from 'puppeteer'; import fs from 'node:fs'; import path from 'node:path';
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars'], protocolTimeout: 300000 });
const hardKill = () => { try { const p = browser.process(); if (p?.pid) { try { process.kill(-p.pid,'SIGKILL'); } catch {} try { p.kill('SIGKILL'); } catch {} } } catch {} };
for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, () => { hardKill(); process.exit(124); });
process.on('exit', hardKill);
setTimeout(() => { console.error('global timeout'); hardKill(); process.exit(124); }, 10*60*1000).unref();
const BOOT = (u) => `${u}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
async function boot(page, url) { await page.goto(BOOT(url), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 2000)); }
async function shot(page, file) { await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = false; }).catch(()=>{});
  await page.screenshot({ path: file, type: 'png' }); await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = true; }).catch(()=>{}); }

const URL = process.argv[2] || 'https://sb-4asza5droe1u.vercel.run';
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
function record(check, viewport, status, started, screenshot, evidence) {
  const r = { check, scenario: 'parity', viewport, status, duration_ms: Date.now() - started, run_at_iso8601: new Date(started).toISOString(), screenshot: screenshot ? path.relative(process.cwd(), screenshot) : null, evidence };
  results.push(r); console.log(JSON.stringify(r));
}
const USER_KEY = 'ondemand.v2.externalUserId.default';

async function openObj(page, detail) {
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: d })), detail);
  await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 });
  await sleep(1500);
}
async function send(page, text) {
  await page.evaluate((t) => { const i = document.querySelector('#ondemand-mini-chat-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  await page.evaluate(() => document.getElementById('ondemand-mini-chat-send')?.click());
}
const status = (page) => page.$eval('#ondemand-mini-chat-status', e => e.textContent.trim()).catch(() => '');
const transcript = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg')).map(n => ({ role: n.getAttribute('data-role'), history: n.getAttribute('data-history'), len: n.textContent.length, text: n.textContent.slice(0, 120) })));
const emptyState = (page) => page.evaluate(() => { const e = document.querySelector('#ondemand-mini-chat-transcript .od-empty-state'); return e ? { kind: e.getAttribute('data-empty-state'), text: e.textContent } : null; });
const waitStatus = async (page, re, timeout) => { const t0 = Date.now(); let s = ''; while (Date.now() - t0 < timeout) { s = await status(page); if (re.test(s)) return s; await sleep(300); } return s; };

const FIRE = { objectType: 'fire', objectId: 'parity-fire-0917', label: 'Parity Fire' };
const ALERT = { objectType: 'alert', objectId: 'iso-alert-0917', label: 'Iso Alert' };

const VPS = (process.argv[4] || '1440x900,390x844').split(',').filter(Boolean);
const DO3 = process.argv[5] !== 'no3way';
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  const sawChat = []; const sawMsgs = [];
  page.on('response', (res) => { try { const u = res.url(); if (u.includes('/api/ondemand/v2/chat') && res.request().method() === 'POST') sawChat.push({ status: res.status(), keySource: res.headers()['x-ondemand-key-source'] || null, at: now() }); if (u.includes('/api/ondemand/v2/messages')) sawMsgs.push({ status: res.status(), at: now() }); } catch {} });
  const bootStart = Date.now();
  await boot(page, URL);
  console.log(`[${vp}] boot ${Date.now() - bootStart} ms`);

  // a. failure
  let t0 = Date.now();
  let handler = null;
  try {
    await openObj(page, FIRE);
    let intercepted = 0; let intercept = true;
    await page.setRequestInterception(true);
    handler = (req) => {
      if (intercept && req.method() === 'POST' && req.url().includes('/api/ondemand/v2/chat') && intercepted === 0) {
        intercepted++;
        req.respond({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ondemand-key-source': 'server' }, body: JSON.stringify({ error: 'upstream_error', status: 502, message: 'Synthetic 502' }) });
      } else req.continue();
    };
    page.on('request', handler);
    await send(page, 'Trigger failure');
    await page.waitForSelector('#ondemand-mini-chat-transcript .od-chat__msg--error', { timeout: 30000 });
    const st = await waitStatus(page, /TURN FAILED|CANCELLED|READY/, 10000);
    const es = await emptyState(page);
    const tr = await transcript(page);
    const file = path.join(OUT, `check-failure-${vp}.png`); await shot(page, file);
    const ok = intercepted === 1 && (/TURN FAILED/.test(st) || es?.kind === 'source-unavailable');
    record('failure', vp, ok ? 'PASS' : 'FAIL', t0, file, { url: URL, intercepted, status: st, emptyState: es, errorMsgs: tr.filter(m => m.role === 'error').length, transcript: tr });
    intercept = false; page.off('request', handler); await page.setRequestInterception(false);
  } catch (e) { const file = path.join(OUT, `check-failure-${vp}.png`); await shot(page, file).catch(()=>{}); record('failure', vp, 'FAIL', t0, file, { url: URL, error: String(e), transcript: await transcript(page).catch(()=>null), status: await status(page) }); if (handler) page.off('request', handler); try { await page.setRequestInterception(false); } catch {} }

  // b. retry/recovery
  t0 = Date.now();
  try {
    const before = sawChat.length;
    const retryBtn = await page.evaluate(() => Array.from(document.querySelectorAll('#ondemand-mini-chat button')).filter(b => /retry/i.test(b.textContent)).map(b => b.textContent.trim()));
    await send(page, 'Recover: summarize this object in one sentence.');
    const st = await waitStatus(page, /^READY/, 90000);
    await sleep(500);
    const tr = await transcript(page);
    const last = tr.filter(m => m.role === 'assistant').pop();
    const resp = sawChat.slice(before).pop();
    const file = path.join(OUT, `check-recovery-${vp}.png`); await shot(page, file);
    const ok = /^READY/.test(st) && resp?.keySource === 'server' && (last?.len || 0) > 0;
    record('retry-recovery', vp, ok ? 'PASS' : 'FAIL', t0, file, { url: URL, status: st, chatResponse: resp, assistantLen: last?.len || 0, assistantPreview: last?.text, retryAffordance: retryBtn.length ? retryBtn : 'none (recovery via composer)' });
  } catch (e) { const file = path.join(OUT, `check-recovery-${vp}.png`); await shot(page, file).catch(()=>{}); record('retry-recovery', vp, 'FAIL', t0, file, { url: URL, error: String(e) }); }

  // c. cancel
  t0 = Date.now();
  try {
    await send(page, 'Write a 400-word essay about plate tectonics.');
    await page.waitForSelector('#ondemand-mini-chat-stop', { visible: true, timeout: 15000 });
    await page.evaluate(() => document.getElementById('ondemand-mini-chat-stop')?.click());
    const clickedAt = Date.now();
    const st = await waitStatus(page, /CANCELLED/, 5000);
    const cancelMs = Date.now() - clickedAt;
    const len1 = (await transcript(page)).filter(m => m.role === 'assistant' || m.role === 'error').pop()?.len || 0;
    await sleep(3000);
    const len2 = (await transcript(page)).filter(m => m.role === 'assistant' || m.role === 'error').pop()?.len || 0;
    const file = path.join(OUT, `check-cancel-${vp}.png`); await shot(page, file);
    const ok = /CANCELLED/.test(st) && len2 <= len1;
    record('cancel', vp, ok ? 'PASS' : 'FAIL', t0, file, { url: URL, status: st, cancel_latency_ms: cancelMs, lenAfterCancel: len1, lenAfter3s: len2 });
  } catch (e) { const file = path.join(OUT, `check-cancel-${vp}.png`); await shot(page, file).catch(()=>{}); record('cancel', vp, 'FAIL', t0, file, { url: URL, error: String(e) }); }

  // d. isolation
  t0 = Date.now();
  try {
    const fireBefore = await transcript(page);
    await openObj(page, ALERT);
    await sleep(2500);
    const trAlert = await transcript(page);
    const esAlert = await emptyState(page);
    const alertText = await page.$eval('#ondemand-mini-chat-transcript', e => e.textContent);
    const fileA = path.join(OUT, `check-isolation-alert-${vp}.png`); await shot(page, fileA);
    await openObj(page, FIRE);
    await sleep(3000);
    const trFire = await transcript(page);
    const file = path.join(OUT, `check-isolation-${vp}.png`); await shot(page, file);
    const ok = trAlert.length === 0 && !/fire/i.test(alertText) && esAlert?.kind === 'no-sessions' && trFire.length >= 2;
    record('isolation', vp, ok ? 'PASS' : 'FAIL', t0, file, { url: URL, alertMsgs: trAlert.length, alertEmptyState: esAlert, alertContainsFire: /fire/i.test(alertText), fireMsgsBefore: fireBefore.length, fireMsgsReplayed: trFire.length, fireReplayHistoryAttr: trFire.filter(m => m.history === 'true').length, fireReplayLive: trFire.filter(m => m.history !== 'true').length, alertScreenshot: path.relative(process.cwd(), fileA) });
  } catch (e) { const file = path.join(OUT, `check-isolation-${vp}.png`); await shot(page, file).catch(()=>{}); record('isolation', vp, 'FAIL', t0, file, { url: URL, error: String(e) }); }

  // e. reload persistence
  t0 = Date.now();
  try {
    const msgsBefore = sawMsgs.length;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
    await sleep(2000);
    await openObj(page, FIRE);
    await page.waitForFunction(() => document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length >= 2, { timeout: 20000 }).catch(() => {});
    await sleep(1000);
    const tr = await transcript(page);
    const msgsResp = sawMsgs.slice(msgsBefore);
    const file = path.join(OUT, `check-reload-persist-${vp}.png`); await shot(page, file);
    const ok = tr.length >= 2 && msgsResp.some(r => r.status === 200) && tr.filter(m => m.history === 'true').length >= 2;
    record('reload-persistence', vp, ok ? 'PASS' : 'FAIL', t0, file, { url: URL, restoredMsgs: tr.length, historyAttr: tr.filter(m => m.history === 'true').length, messagesResponses: msgsResp, preview: tr.map(m => m.text.slice(0, 60)) });
  } catch (e) { const file = path.join(OUT, `check-reload-persist-${vp}.png`); await shot(page, file).catch(()=>{}); record('reload-persistence', vp, 'FAIL', t0, file, { url: URL, error: String(e) }); }

  await page.close();
}

// f. 3-way concurrent isolation (desktop only)
if (DO3) {
  const t0 = Date.now();
  const EQ = { objectType: 'earthquake', objectId: 'shared-eq-0917', label: 'Shared EQ' };
  const pages = [];
  try {
    for (let n = 1; n <= 3; n++) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument((k, v) => { try { localStorage.setItem(k, v); } catch {} }, USER_KEY, `iso-user-${n}-0917`);
      pages.push(page);
    }
    await Promise.all(pages.map(p => boot(p, URL)));
    const ids = await Promise.all(pages.map(p => p.evaluate((k) => localStorage.getItem(k), USER_KEY)));
    await Promise.all(pages.map(p => openObj(p, EQ)));
    const msgs = [1, 2, 3].map(n => `ISO-USER-${n} marker message ${n}${n}${n}: reply with the word OK only.`);
    await Promise.all(pages.map((p, i) => send(p, msgs[i])));
    await Promise.all(pages.map(p => waitStatus(p, /^READY|TURN FAILED/, 90000)));
    await sleep(1000);
    const trs = await Promise.all(pages.map(p => transcript(p)));
    const sts = await Promise.all(pages.map(p => status(p)));
    const file = path.join(OUT, 'check-3way-isolation-1440x900.png'); await shot(pages[0], file);
    const bleed = trs.map((tr, i) => { const users = tr.filter(m => m.role === 'user').map(m => m.text); const own = users.filter(t => t.includes(`ISO-USER-${i + 1} `)).length; const foreign = users.filter(t => /ISO-USER-\d/.test(t) && !t.includes(`ISO-USER-${i + 1} `)).length; return { page: i + 1, userId: ids[i], userMsgs: users.length, own, foreign, status: sts[i], assistantLen: tr.filter(m => m.role === 'assistant').pop()?.len || 0 }; });
    const distinct = new Set(ids).size === 3 && ids.every((id, i) => id === `iso-user-${i + 1}-0917`);
    const ok = distinct && bleed.every(b => b.own === 1 && b.foreign === 0 && b.userMsgs === 1);
    record('3way-isolation', '1440x900', ok ? 'PASS' : 'FAIL', t0, file, { url: URL, storageKey: USER_KEY, externalUserIds: ids, perPage: bleed });
  } catch (e) { const file = path.join(OUT, 'check-3way-isolation-1440x900.png'); if (pages[0]) await shot(pages[0], file).catch(()=>{}); record('3way-isolation', '1440x900', 'FAIL', t0, file, { url: URL, error: String(e) }); }
}

fs.writeFileSync(path.join(OUT, `parity-results-${VPS.join('_')}${DO3 ? '' : '-no3way'}.json`), JSON.stringify(results, null, 2));
await browser.close(); hardKill();
console.log('DONE', now());
