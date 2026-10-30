import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars'], protocolTimeout: 300000 });
const hardKill = () => { try { const p = browser.process(); if (p?.pid) { try { process.kill(-p.pid,'SIGKILL'); } catch {} try { p.kill('SIGKILL'); } catch {} } } catch {} };
for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, () => { hardKill(); process.exit(124); });
process.on('exit', hardKill);
setTimeout(() => { console.error('global timeout'); hardKill(); process.exit(124); }, 5*60*1000).unref();
const URL='https://sb-4asza5droe1u.vercel.run';
const BOOT = (u) => `${u}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(BOOT(URL), { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
await new Promise(r => setTimeout(r, 2000));
await page.evaluate(() => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: { objectType:'fire', objectId:'tap-probe-0917', label:'Tap Probe' } })));
await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 });
await new Promise(r => setTimeout(r, 1500));
const info = await page.evaluate(() => {
  const out = {};
  const sendEl = document.getElementById('ondemand-mini-chat-send'); const sr = sendEl.getBoundingClientRect();
  const stack = document.elementsFromPoint(sr.left + sr.width/2, sr.top + sr.height/2).slice(0, 6).map(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), id: e.id, cls: String(e.className).slice(0, 80), z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: (e.textContent || '').trim().slice(0, 60), parents: (() => { const a = []; let n = e.parentElement; while (n && a.length < 4) { a.push(`${n.tagName.toLowerCase()}#${n.id}.${String(n.className).slice(0, 40)}`); n = n.parentElement; } return a; })() }; });
  out.stackAtSend = stack;
  const panel = document.getElementById('ondemand-mini-chat'); const pr = panel.getBoundingClientRect(); out.panel = { rect: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)], z: getComputedStyle(panel).zIndex };
  for (const id of ['ondemand-mini-chat-send','ondemand-mini-chat-input','ondemand-mini-chat-stop']) {
    const el = document.getElementById(id); if (!el) { out[id] = null; continue; }
    const r = el.getBoundingClientRect(); const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const top = document.elementFromPoint(cx, cy);
    out[id] = { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, hidden: el.hidden, disabled: el.disabled, inViewport: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight, topElement: top ? `${top.tagName.toLowerCase()}#${top.id}.${top.className}` : null, hitIsSelfOrChild: !!(top && (top === el || el.contains(top))), vv: { w: innerWidth, h: innerHeight } };
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
// try a real coordinate click on send with text, see if a user message appears
await page.evaluate(() => { const i = document.querySelector('#ondemand-mini-chat-input'); i.value = 'tap probe'; i.dispatchEvent(new Event('input', { bubbles: true })); });
let clickErr = null; try { await page.click('#ondemand-mini-chat-send', { timeout: 5000 }); } catch (e) { clickErr = String(e); }
await new Promise(r => setTimeout(r, 1500));
const after = await page.evaluate(() => ({ msgs: document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length, status: document.querySelector('#ondemand-mini-chat-status')?.textContent }));
console.log(JSON.stringify({ clickErr, after }));
await page.evaluate(() => document.getElementById('ondemand-mini-chat-stop')?.click()).catch(()=>{});
await browser.close(); hardKill();
