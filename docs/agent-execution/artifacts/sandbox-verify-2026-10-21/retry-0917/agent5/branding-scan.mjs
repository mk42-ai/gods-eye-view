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

const URL = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const VPS = [['1440x900', 1440, 900, false], ['390x844', 390, 844, true]];
const results = [];
const now = () => new Date().toISOString();

const SCAN_FN = () => {
  const terms = [/god'?s eye/i, /god\u2019s eye/i, /gods eye/i, /GEV MIC/i, /\bGEV\b/, /OpenAI/i, /gpt-4o-realtime/i, /Realtime API/i];
  const hits = []; const internal = [];
  const test = (src, s) => { if (!s) return; for (const t of terms) { const m = s.match(t); if (m) hits.push({ src, term: t.source, match: m[0], context: s.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ') }); } };
  test('body.innerText', document.body.innerText);
  for (const el of document.querySelectorAll('*')) {
    for (const a of ['title', 'aria-label', 'alt', 'placeholder']) { const v = el.getAttribute(a); if (v) test(`${el.tagName.toLowerCase()}[${a}]`, v); }
    for (const a of ['id', 'class']) { const v = el.getAttribute(a); if (v && /god'?s?-?eye|gev/i.test(v)) internal.push(`${el.tagName.toLowerCase()}[${a}="${v.slice(0, 80)}"]`); }
  }
  for (const m of document.querySelectorAll('meta')) test(`meta[${m.getAttribute('name') || m.getAttribute('property')}]`, m.getAttribute('content'));
  test('document.title', document.title);
  if (window.__godsEyeView) internal.push('window.__godsEyeView');
  return { count: hits.length, hits, internal: [...new Set(internal)].slice(0, 40) };
};
const EYE_FN = () => {
  const assets = []; const seen = new Set();
  const add = (kind, url, extra) => { const k = kind + '|' + url; if (seen.has(k)) return; seen.add(k); assets.push({ kind, url, ...extra }); };
  for (const i of document.querySelectorAll('img')) add('img', i.currentSrc || i.src, { alt: i.alt || '' });
  for (const s of document.querySelectorAll('svg')) { const t = s.querySelector('title')?.textContent || ''; const d = s.querySelector('desc')?.textContent || ''; add('svg', (s.getAttribute('data-icon') || s.getAttribute('class') || s.id || 'inline-svg').toString().slice(0, 60), { title: t, desc: d }); }
  for (const u of document.querySelectorAll('use')) add('use', u.getAttribute('href') || u.getAttribute('xlink:href') || '', {});
  for (const el of document.querySelectorAll('*')) { for (const pseudo of [null, '::before', '::after']) { const bg = getComputedStyle(el, pseudo).backgroundImage; if (bg && bg !== 'none') { const m = [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)]; for (const x of m) add('css-bg' + (pseudo || ''), x[1], { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') }); } const mk = getComputedStyle(el, pseudo).maskImage || getComputedStyle(el, pseudo).webkitMaskImage; if (mk && mk !== 'none') { for (const x of mk.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add('css-mask' + (pseudo || ''), x[1], { el: el.tagName.toLowerCase() }); } } }
  const flagged = assets.filter(a => /eye/i.test(a.url + ' ' + (a.title || '') + ' ' + (a.desc || '') + ' ' + (a.alt || '')));
  return { total: assets.length, assets, flagged };
};

for (const [vp, w, h, mobile] of VPS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const t0 = Date.now();
  const bootAt = now();
  await boot(page, URL);
  const bootMs = Date.now() - t0;
  const ident = await page.evaluate(() => {
    const wm = document.querySelector('#title-bar [data-product-wordmark]');
    const marks = [...document.querySelectorAll('[data-brand-mark]')].map(m => { const r = m.getBoundingClientRect(); return { tag: m.tagName.toLowerCase(), w: r.width, h: r.height, src: m.getAttribute('src') || m.getAttribute('href') || '' }; });
    const icons = [...document.querySelectorAll('link[rel~="icon"]')].map(l => ({ rel: l.rel, href: l.getAttribute('href'), type: l.type, sizes: l.getAttribute('sizes') }));
    const manifest = document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null;
    const ls = document.querySelector('#loading-screen'); const lsBg = ls ? getComputedStyle(ls).backgroundImage : null;
    return { title: document.title, wordmark: wm ? wm.textContent.trim() : null, marks, icons, manifest, loadingScreenBg: lsBg, loadingHidden: ls ? ls.classList.contains('hidden') : 'absent' };
  });
  const titleOk = ident.title === 'OnDemand Intelligence Workstation';
  const wmOk = !!ident.wordmark && ident.wordmark.includes('OnDemand Intelligence');
  const markOk = ident.marks.length >= 1 && ident.marks.some(m => m.w > 0 && m.h > 0);
  const iconOk = ident.icons.some(i => /^\/assets\/brand\/favicon/.test(i.href || ''));
  results.push({ check: 'identity', scenario: 'title+wordmark+brand-mark+favicon-link', viewport: vp, status: (titleOk && wmOk && markOk && iconOk) ? 'PASS' : 'FAIL', duration_ms: bootMs, run_at_iso8601: bootAt, screenshot: null, evidence: { url: BOOT(URL), ...ident, titleOk, wmOk, markOk, iconOk } });
  const lsOk = !!ident.loadingScreenBg && /backdrop-network\.png/.test(ident.loadingScreenBg);
  results.push({ check: 'loading-screen-backdrop', scenario: '#loading-screen computed background-image', viewport: vp, status: lsOk ? 'PASS' : 'FAIL', duration_ms: 0, run_at_iso8601: now(), screenshot: null, evidence: { backgroundImage: ident.loadingScreenBg } });

  const scanBase = await page.evaluate(SCAN_FN);
  results.push({ check: 'legacy-terms', scenario: 'base page (chat closed)', viewport: vp, status: scanBase.count === 0 ? 'PASS' : 'DEFECT', duration_ms: 0, run_at_iso8601: now(), screenshot: null, evidence: scanBase });
  const eyeBase = await page.evaluate(EYE_FN);
  results.push({ check: 'eye-motif', scenario: 'base page (chat closed)', viewport: vp, status: eyeBase.flagged.length === 0 ? 'PASS' : 'DEFECT', duration_ms: 0, run_at_iso8601: now(), screenshot: null, evidence: eyeBase });

  // open mini chat
  const tChat = Date.now();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: { objectType: 'earthquake', objectId: 'qa-eq-1', label: 'Earthquake' } })));
  let chatOpen = false;
  try { await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 }); chatOpen = true; } catch {}
  await new Promise(r => setTimeout(r, 1500));
  // plugin panel + key setup (settings)
  const panels = await page.evaluate(() => {
    const out = {};
    const pp = document.querySelector('#ondemand-plugin-panel'); const det = pp?.querySelector('details');
    if (det) { det.open = true; out.pluginPanel = { present: true, open: det.open, rows: pp.querySelectorAll('.od-plugin__toggle').length, summary: pp.querySelector('summary')?.textContent.trim() }; } else out.pluginPanel = { present: !!pp };
    const chip = document.querySelector('#key-setup-chip'); const ks = document.querySelector('#key-setup');
    out.keySetup = { chipPresent: !!chip, rootPresent: !!ks };
    if (chip) { chip.click(); out.keySetup.clicked = true; }
    return out;
  });
  await new Promise(r => setTimeout(r, 800));
  const panels2 = await page.evaluate(() => { const ks = document.querySelector('#key-setup'); return { keySetupVisible: !!ks && !ks.hidden && ks.classList.contains('visible') }; });
  const shotFile = path.join(OUT, `check-branding-${vp}.png`);
  await shot(page, shotFile);
  const scanOpen = await page.evaluate(SCAN_FN);
  const eyeOpen = await page.evaluate(EYE_FN);
  results.push({ check: 'mini-chat-open', scenario: 'gev:ask-object earthquake', viewport: vp, status: chatOpen ? 'PASS' : 'FAIL', duration_ms: Date.now() - tChat, run_at_iso8601: now(), screenshot: path.basename(shotFile), evidence: { chatOpen, ...panels, ...panels2 } });
  results.push({ check: 'legacy-terms', scenario: 'chat open + plugins panel open' + (panels2.keySetupVisible ? ' + settings open' : ' (settings/key-setup not present)'), viewport: vp, status: scanOpen.count === 0 ? 'PASS' : 'DEFECT', duration_ms: 0, run_at_iso8601: now(), screenshot: path.basename(shotFile), evidence: scanOpen });
  results.push({ check: 'eye-motif', scenario: 'chat open + plugins panel open', viewport: vp, status: eyeOpen.flagged.length === 0 ? 'PASS' : 'DEFECT', duration_ms: 0, run_at_iso8601: now(), screenshot: path.basename(shotFile), evidence: eyeOpen });
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(r => ({ check: r.check, scenario: r.scenario, viewport: r.viewport, status: r.status })), null, 1));
await browser.close(); hardKill();
