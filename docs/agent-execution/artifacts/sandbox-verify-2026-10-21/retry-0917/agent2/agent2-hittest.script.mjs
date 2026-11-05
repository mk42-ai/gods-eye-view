import puppeteer from 'puppeteer'; import fs from 'node:fs'; import path from 'node:path';
const URL = process.argv[2]; const OUT = process.argv[3];
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
const out = {};
for (const vp of [{ name: '1440x900', w: 1440, h: 900, mobile: false }, { name: '390x844', w: 390, h: 844, mobile: true }]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  await boot(page, URL);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: { objectType: 'alert', objectId: 'hit-test-0917', label: 'Hit-test probe' } })));
  await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  const probe = await page.evaluate(() => {
    const desc = (el) => el ? { tag: el.tagName, id: el.id || null, cls: typeof el.className === 'string' ? el.className : null, text: (el.textContent || '').trim().slice(0, 60), z: getComputedStyle(el).zIndex, pe: getComputedStyle(el).pointerEvents, pos: getComputedStyle(el).position, parentChain: (() => { const c = []; let p = el; for (let i = 0; i < 5 && p; i++) { c.push(p.tagName + (p.id ? '#' + p.id : '') + (typeof p.className === 'string' && p.className ? '.' + p.className.split(' ').join('.') : '')); p = p.parentElement; } return c; })() } : null;
    const res = {};
    for (const id of ['ondemand-mini-chat-send', 'ondemand-mini-chat-input', 'ondemand-mini-chat-stop', 'ondemand-mini-chat-close']) {
      const b = document.getElementById(id); if (!b) { res[id] = null; continue; }
      const r = b.getBoundingClientRect();
      const pts = { center: [r.x + r.width / 2, r.y + r.height / 2], tl: [r.x + 3, r.y + 3], br: [r.right - 3, r.bottom - 3] };
      const hits = {};
      for (const [k, [x, y]] of Object.entries(pts)) { const top = document.elementFromPoint(x, y); hits[k] = { x, y, inside: top === b || b.contains(top), top: desc(top) }; }
      res[id] = { rect: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }, hidden: b.hidden, disabled: b.disabled, hits };
    }
    res.innerHeight = window.innerHeight; res.visualViewport = window.visualViewport ? { h: window.visualViewport.height, w: window.visualViewport.width, top: window.visualViewport.offsetTop } : null;
    return res;
  });
  out[vp.name] = probe;
  console.log(vp.name, JSON.stringify(probe, null, 1));
  await shot(page, path.join(OUT, `check-send-hittest-${vp.name}.png`));
  // real pointer click test: puppeteer mouse click at center, then see if message was sent
  const pre = await page.evaluate(() => document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length);
  await page.evaluate(() => { const i = document.getElementById('ondemand-mini-chat-input'); i.value = 'hit test'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  const r = probe['ondemand-mini-chat-send'].rect;
  if (vp.mobile) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await new Promise(r => setTimeout(r, 2500));
  const post = await page.evaluate(() => ({ msgs: document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length, status: document.getElementById('ondemand-mini-chat-status')?.textContent.trim(), inputValue: document.getElementById('ondemand-mini-chat-input')?.value }));
  out[vp.name].pointerClick = { pre, ...post, sent: post.msgs > pre || post.inputValue === '' };
  console.log(vp.name, 'pointerClick', JSON.stringify(out[vp.name].pointerClick));
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'send-hittest.json'), JSON.stringify({ url: URL, at: new Date().toISOString(), out }, null, 2));
await browser.close(); hardKill();
