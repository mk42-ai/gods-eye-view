import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars'], protocolTimeout: 300000 });
const hardKill = () => { try { const p = browser.process(); if (p?.pid) { try { process.kill(-p.pid,'SIGKILL'); } catch {} try { p.kill('SIGKILL'); } catch {} } } catch {} };
for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, () => { hardKill(); process.exit(124); });
process.on('exit', hardKill);
setTimeout(() => { console.error('global timeout'); hardKill(); process.exit(124); }, 5*60*1000).unref();
const URL='https://sb-4asza5droe1u.vercel.run'; const OUT=process.argv[2];
const BOOT = (u) => `${u}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
async function shot(page, file) { await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = false; }).catch(()=>{}); await page.screenshot({ path: file, type: 'png' }); await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = true; }).catch(()=>{}); }
for (const vp of ['1440x900','390x844']) {
  const [w,h] = vp.split('x').map(Number);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w<500, hasTouch: w<500 });
  await page.goto(BOOT(URL), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: { objectType:'fire', objectId:'tap-probe-0917', label:'Tap Probe' } })));
  await page.waitForSelector('#ondemand-mini-chat[data-open="true"]', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  const info = await page.evaluate(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    const ov = (a, b) => Math.max(0, Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y));
    const banner = document.querySelector('[data-gev-serverless-notice]'); const send = document.getElementById('ondemand-mini-chat-send'); const input = document.getElementById('ondemand-mini-chat-input');
    const b = banner ? R(banner) : null, s = R(send), i = R(input);
    const hit = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return t === el || el.contains(t); };
    return { bannerPresent: !!banner, banner: b, send: s, input: i, sendOverlapPx: b ? ov(b, s) : 0, inputOverlapPx: b ? ov(b, i) : 0, sendHittable: hit(send), inputHittable: hit(input), bannerZ: banner ? getComputedStyle(banner).zIndex : null, chatZ: getComputedStyle(document.getElementById('ondemand-mini-chat')).zIndex };
  });
  console.log(JSON.stringify({ vp, ...info }));
  await shot(page, `${OUT}/check-banner-occlusion-${vp}.png`);
  await page.close();
}
await browser.close(); hardKill();
