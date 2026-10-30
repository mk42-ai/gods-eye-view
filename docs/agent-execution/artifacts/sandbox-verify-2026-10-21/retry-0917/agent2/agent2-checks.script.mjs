import puppeteer from 'puppeteer'; import fs from 'node:fs'; import path from 'node:path';
const URL = process.argv[2] || 'https://sb-4asza5droe1u.vercel.run';
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
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

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const log = (...a) => console.log(`[${now()}]`, ...a);
function record(check, viewport, status, duration_ms, run_at, screenshot, evidence) {
  results.push({ check, scenario: 'extra', viewport, status, duration_ms, run_at_iso8601: run_at, screenshot: screenshot ? path.basename(screenshot) : null, evidence, url: URL });
  log(check, viewport, status, JSON.stringify(evidence).slice(0, 600));
}

async function openMini(page, detail) {
  await page.evaluate((d) => { document.querySelector('#ondemand-mini-chat-close')?.click?.(); }, null).catch(()=>{});
  await sleep(300);
  await page.evaluate((d) => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: d })), detail);
  await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 });
  await sleep(1500);
}
let preCount = 0;
async function sendMsg(page, text) {
  await page.waitForFunction(() => { const b = document.querySelector('#ondemand-mini-chat-send'); return b && !b.disabled && !document.querySelector('#ondemand-mini-chat-transcript [data-streaming]'); }, { timeout: 90000 });
  preCount = await page.evaluate(() => document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length);
  await page.evaluate((t) => { const i = document.querySelector('#ondemand-mini-chat-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  const sendRect = await page.evaluate(() => { const b = document.getElementById('ondemand-mini-chat-send'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return { x: r.x, y: r.y, w: r.width, h: r.height, disabled: b.disabled, topIsSend: top === b || b.contains(top), top: top ? (top.id || top.className || top.tagName) : null }; });
  log('send-button', JSON.stringify(sendRect));
  await page.evaluate(() => document.getElementById('ondemand-mini-chat-send')?.click());
}
async function waitStatus(page, re, timeout) {
  const start = Date.now();
  try {
    await page.waitForFunction((src, pre) => {
      const n = document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length;
      const streaming = !!document.querySelector('#ondemand-mini-chat-transcript [data-streaming]');
      const sendBusy = document.querySelector('#ondemand-mini-chat-send')?.disabled;
      return n > pre && !streaming && !sendBusy && new RegExp(src).test(document.querySelector('#ondemand-mini-chat-status')?.textContent || '');
    }, { timeout }, re.source, preCount);
  } catch {}
  return { ms: Date.now() - start, status: await page.$eval('#ondemand-mini-chat-status', e => e.textContent.trim()).catch(() => null), newMsgs: (await page.evaluate(() => document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length)) - preCount };
}
const assistantInfo = () => ({
  msgs: document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length,
  assistant: (() => { const nodes = [...document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg')]; const a = nodes.reverse().find(n => n.classList.contains('od-chat__msg--assistant') || n.getAttribute('data-role') === 'assistant') || nodes[0]; if (!a) return null;
    const cites = [...a.querySelectorAll('a.od-chat__cite')].map(x => x.getAttribute('href'));
    return { className: a.className, confidence: a.getAttribute('data-confidence'), cites, text: (a.textContent || '').trim().slice(0, 400) }; })(),
  allCites: [...document.querySelectorAll('#ondemand-mini-chat a.od-chat__cite')].map(x => x.getAttribute('href')),
  sources: (() => { const s = document.querySelector('#ondemand-mini-chat-sources'); if (!s) return null; const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); return { hidden: s.hidden, display: cs.display, visibility: cs.visibility, visible: !s.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0, text: s.textContent.trim().slice(0, 200), rect: { w: r.width, h: r.height } }; })(),
  emptyState: (() => { const e = document.querySelector('#ondemand-mini-chat .od-empty-state'); return e ? { className: e.className, text: e.textContent.trim().slice(0, 200), before: getComputedStyle(e, '::before').backgroundImage } : null; })(),
  status: document.querySelector('#ondemand-mini-chat-status')?.textContent.trim(),
});

const ONLY = process.argv[4]; const VIEWPORTS = [{ name: '1440x900', w: 1440, h: 900, mobile: false }, { name: '390x844', w: 390, h: 844, mobile: true }];
for (const vp of VIEWPORTS.filter(v => !ONLY || v.name === ONLY)) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  page.on('pageerror', e => log('pageerror', vp.name, String(e).slice(0, 200)));

  // --- 3c: loading-screen backdrop (read right after goto) ---
  let t0 = Date.now(); let ra = now();
  await page.goto(BOOT(URL), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const loadBg = await page.evaluate(() => { const l = document.querySelector('#loading-screen'); if (!l) return { present: false }; return { present: true, hidden: l.classList.contains('hidden'), backgroundImage: getComputedStyle(l).backgroundImage }; });
  record('loading-screen-backdrop', vp.name, loadBg.present && /\/assets\/brand\/backdrop-network\.png/.test(loadBg.backgroundImage) ? 'PASS' : 'FAIL', Date.now() - t0, ra, null, loadBg);
  await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
  await sleep(2000);
  log('booted', vp.name, Date.now() - t0, 'ms');

  // --- 2: citations deep-check ---
  t0 = Date.now(); ra = now();
  await openMini(page, { objectType: 'newsArticle', objectId: 'citations-0917', label: 'Citations probe', fields: { title: 'OnDemand platform' } });
  await sendMsg(page, 'What public sources discuss the OnDemand AI platform? Cite URLs.');
  const ws = await waitStatus(page, /^(READY|TURN FAILED|CANCELLED)/, 90000);
  await sleep(1000);
  const ci = await page.evaluate(assistantInfo);
  const f = path.join(OUT, `check-citations-${vp.name}.png`); await shot(page, f);
  const hrefs = ci.assistant?.cites || [];
  const allHttp = hrefs.every(h => /^https?:\/\//i.test(h || ''));
  const srcCount = (ci.sources?.text || '').match(/SOURCES\s*·\s*(\d+)/i)?.[1];
  const honest = !!ci.assistant?.confidence && hrefs.length === 0;
  const citesOk = hrefs.length > 0 && allHttp;
  const terminal = /^(READY|TURN FAILED)/.test(ws.status || '');
  record('citations-deep-check', vp.name, terminal && (citesOk || honest) ? 'PASS' : (terminal ? 'DEFECT' : 'FAIL'), Date.now() - t0, ra, f,
    { finalStatus: ws.status, waitMs: ws.ms, newMsgs: ws.newMsgs, citeCount: hrefs.length, hrefs, allHttp, sourcesVisible: ci.sources?.visible, sourcesText: ci.sources?.text, sourcesCount: srcCount ? Number(srcCount) : null, confidence: ci.assistant?.confidence, emptyState: ci.emptyState ? ci.emptyState.className : null, assistantPreview: ci.assistant?.text?.slice(0, 200) });

  // --- 3a: no-sessions empty state ---
  t0 = Date.now(); ra = now();
  const freshId = 'fresh-' + Date.now();
  await openMini(page, { objectType: 'alert', objectId: freshId, label: 'Fresh alert' });
  try { await page.waitForSelector('#ondemand-mini-chat .od-empty-state--no-sessions', { timeout: 15000 }); } catch {}
  const es = await page.evaluate(() => { const e = document.querySelector('#ondemand-mini-chat .od-empty-state--no-sessions'); if (!e) return { present: false, any: document.querySelector('#ondemand-mini-chat .od-empty-state')?.className || null, status: document.querySelector('#ondemand-mini-chat-status')?.textContent }; const r = e.getBoundingClientRect(); return { present: true, text: e.textContent.trim(), before: getComputedStyle(e, '::before').backgroundImage, rect: { w: r.width, h: r.height } }; });
  const f3a = path.join(OUT, `check-empty-no-sessions-${vp.name}.png`); await shot(page, f3a);
  record('empty-state-no-sessions', vp.name, es.present && /No prior investigation for this object/.test(es.text) && /\/assets\/brand\/empty-no-sessions\.png/.test(es.before) ? 'PASS' : (es.present ? 'DEFECT' : 'FAIL'), Date.now() - t0, ra, f3a, { objectId: freshId, ...es });

  // --- 3b: source-unavailable via 504 interception ---
  t0 = Date.now(); ra = now();
  await page.setRequestInterception(true);
  const onReq = (req) => { try { if (req.method() === 'POST' && /\/api\/ondemand\/v2\/chat/.test(req.url())) { req.respond({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'upstream_timeout' }) }); return; } } catch {} req.continue().catch(() => {}); };
  page.on('request', onReq);
  await sendMsg(page, 'Trigger upstream timeout probe');
  const ws2 = await waitStatus(page, /^(TURN FAILED|READY|CANCELLED)/, 60000);
  await sleep(1000);
  const su = await page.evaluate(() => { const e = document.querySelector('#ondemand-mini-chat .od-empty-state--source-unavailable'); const err = document.querySelector('#ondemand-mini-chat-transcript .od-chat__msg--error'); return { emptyPresent: !!e, emptyText: e?.textContent.trim().slice(0, 200), before: e ? getComputedStyle(e, '::before').backgroundImage : null, errorMsgPresent: !!err, errorText: err?.textContent.trim().slice(0, 200), status: document.querySelector('#ondemand-mini-chat-status')?.textContent.trim(), anyEmpty: document.querySelector('#ondemand-mini-chat .od-empty-state')?.className || null }; });
  const f3b = path.join(OUT, `check-empty-source-unavailable-${vp.name}.png`); await shot(page, f3b);
  page.off('request', onReq); await page.setRequestInterception(false);
  const stateOk = su.emptyPresent || (su.errorMsgPresent && /TURN FAILED/.test(su.status || ''));
  const imgOk = su.emptyPresent && /empty-source-unavailable\.png/.test(su.before || '');
  record('empty-state-source-unavailable', vp.name, stateOk && imgOk ? 'PASS' : (stateOk ? 'DEFECT' : 'FAIL'), Date.now() - t0, ra, f3b, { waitMs: ws2.ms, newMsgs: ws2.newMsgs, ...su });

  // --- 4: root-first / responsive ---
  t0 = Date.now(); ra = now();
  await openMini(page, { objectType: 'alert', objectId: 'rootfirst-0917', label: 'Root-first probe' });
  const rf = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const mini = document.querySelector('#ondemand-mini-chat'); const mr = mini.getBoundingClientRect();
    const inp = document.querySelector('#ondemand-mini-chat-input'); const ir = inp.getBoundingClientRect(); const ics = getComputedStyle(inp);
    const marks = [...document.querySelectorAll('[data-brand-mark]')].map(m => { const r = m.getBoundingClientRect(); const cs = getComputedStyle(m); return { id: m.id || m.className, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !m.closest('#loading-screen.hidden') }; });
    const overlaps = marks.filter(m => m.visible && !(m.rect.x + m.rect.w <= mr.x || m.rect.x >= mr.x + mr.width || m.rect.y + m.rect.h <= mr.y || m.rect.y >= mr.y + mr.height));
    return { vw, vh, scrollWidth: document.documentElement.scrollWidth, mini: { x: mr.x, y: mr.y, w: mr.width, h: mr.height, fits: mr.x >= -0.5 && mr.y >= -0.5 && mr.right <= vw + 0.5 && mr.bottom <= vh + 0.5 },
      input: { x: ir.x, y: ir.y, w: ir.width, h: ir.height, visible: ics.display !== 'none' && ics.visibility !== 'hidden' && ir.width > 0 && ir.height > 0 && ir.x >= 0 && ir.y >= 0 && ir.right <= vw && ir.bottom <= vh }, marks, overlaps: overlaps.map(o => o.id) };
  });
  const f4 = path.join(OUT, `check-rootfirst-${vp.name}.png`); await shot(page, f4);
  let ok;
  if (vp.mobile) ok = rf.scrollWidth <= 390 && rf.input.visible && rf.mini.fits; else ok = rf.overlaps.length === 0;
  record('root-first-responsive', vp.name, ok ? 'PASS' : 'DEFECT', Date.now() - t0, ra, f4, rf);

  await page.close();
}
fs.writeFileSync(path.join(OUT, ONLY ? `checks-${ONLY}.json` : 'checks.json'), JSON.stringify({ url: URL, finished_at: now(), results }, null, 2));
await browser.close(); hardKill();
log('done');
