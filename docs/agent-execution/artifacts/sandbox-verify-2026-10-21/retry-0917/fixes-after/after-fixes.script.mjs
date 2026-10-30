import puppeteer from 'puppeteer'; import fs from 'node:fs'; import path from 'node:path';
const URL0 = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars'], protocolTimeout: 300000 });
const hardKill = () => { try { const p = browser.process(); if (p?.pid) { try { process.kill(-p.pid,'SIGKILL'); } catch {} try { p.kill('SIGKILL'); } catch {} } } catch {} };
for (const sig of ['SIGTERM','SIGINT','SIGHUP']) process.on(sig, () => { hardKill(); process.exit(124); });
process.on('exit', hardKill);
setTimeout(() => { console.error('global timeout'); hardKill(); process.exit(124); }, 8*60*1000).unref();
const BOOT = (u) => `${u}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
const ts = () => new Date().toISOString();
async function boot(page) { await page.goto(BOOT(URL0), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => { const l = document.querySelector('#loading-screen'); return (!l || l.classList.contains('hidden')) && window.__godsEyeView?.dataManager; }, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 2500)); }
async function shot(page, file) { await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = false; }).catch(()=>{});
  await page.screenshot({ path: path.join(OUT, file), type: 'png' }); await page.evaluate(() => { const v = window.__godsEyeView?.viewer; if (v) v.useDefaultRenderLoop = true; }).catch(()=>{}); }
const results = [];
const rec = (check, viewport, pass, evidence, screenshot, t0) => { const r = { check, scenario: 'A/fix', viewport, status: pass ? 'PASS' : 'FAIL', duration_ms: Date.now() - t0, run_at_iso8601: ts(), screenshot: screenshot ? path.join(OUT, screenshot) : null, evidence }; results.push(r); console.log(JSON.stringify(r)); };
const SSE = 'event: session\ndata: {"sessionId":"synthetic-after","keySource":"server"}\n\n' +
  'event: message\ndata: {"eventType":"fulfillment","answer":"Report: https://example.com/brief.pdf Image: https://example.com/figure.png Video: https://example.com/clip.mp4 Source: https://example.com/article"}\n\n' +
  'event: done\ndata: {}\n\n';
for (const vp of [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await boot(page);
  // 1. banner present before chat opens, hidden when chat open, back when closed
  let t0 = Date.now();
  const bannerBefore = await page.evaluate(() => { const b = document.querySelector('[data-gev-serverless-notice]'); return b ? { present: true, hidden: b.hidden, z: getComputedStyle(b).zIndex } : { present: false }; });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: { objectType: 'earthquake', objectId: 'after-fix-0917', label: 'After-fix Earthquake' } })));
  await page.waitForFunction(() => document.getElementById('ondemand-mini-chat')?.getAttribute('data-open') === 'true', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 400));
  const bannerOpen = await page.evaluate(() => { const b = document.querySelector('[data-gev-serverless-notice]'); return b ? { present: true, hidden: b.hidden, display: getComputedStyle(b).display } : { present: false }; });
  // hit-test composer
  const hit = await page.evaluate(() => { const out = {}; for (const id of ['ondemand-mini-chat-input','ondemand-mini-chat-send']) { const el = document.getElementById(id); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); out[id] = { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, topId: top?.id || null, topTag: top?.tagName || null, hitsSelf: top === el || el.contains(top) }; } return out; });
  await shot(page, `check-composer-hittest-${vp.name}.png`);
  rec('mobile_composer_not_occluded_by_banner', vp.name, hit['ondemand-mini-chat-input'].hitsSelf && hit['ondemand-mini-chat-send'].hitsSelf && bannerOpen.hidden === true && bannerBefore.present,
    `bannerBefore=${JSON.stringify(bannerBefore)} bannerWhileChatOpen=${JSON.stringify(bannerOpen)} hit=${JSON.stringify(hit)}`, `check-composer-hittest-${vp.name}.png`, t0);
  // real pointer tap on SEND with text → user message appears (intercept chat to avoid upstream cost)
  t0 = Date.now();
  await page.setRequestInterception(true);
  const onReq = (req) => { if (req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') req.respond({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*', 'x-ondemand-key-source': 'server' }, body: SSE }); else req.continue().catch(() => {}); };
  page.on('request', onReq);
  await page.type('#ondemand-mini-chat-input', 'Show deliverables');
  const sendRect = await page.evaluate(() => { const r = document.getElementById('ondemand-mini-chat-send').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  if (vp.isMobile) await page.touchscreen.tap(sendRect.x, sendRect.y); else await page.mouse.click(sendRect.x, sendRect.y);
  const settled = await page.waitForFunction(() => { const s = document.getElementById('ondemand-mini-chat-status')?.textContent || ''; return /READY|FAILED/.test(s) && document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg--user').length >= 1; }, { timeout: 20000 }).then(() => true).catch(() => false);
  const userMsgs = await page.evaluate(() => document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg--user').length);
  rec('real_pointer_send_delivers_message', vp.name, settled && userMsgs >= 1, `pointer=${vp.isMobile ? 'touchscreen.tap' : 'mouse.click'} userMessages=${userMsgs} settled=${settled}`, null, t0);
  // 2. media rendering
  t0 = Date.now();
  const media = await page.evaluate(() => { const msg = [...document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg--assistant')].pop(); const q = (s) => msg.querySelectorAll(s).length; const grid = msg.querySelector('.od-chat__deliverables'); const gridStyle = grid ? getComputedStyle(grid) : null; const cards = grid ? [...grid.children].map(c => { const r = c.getBoundingClientRect(); return { media: c.dataset.media, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }) : []; const v = msg.querySelector('video'); return { anchors: q('a.od-chat__cite'), imgs: q('img'), videos: q('video'), autoplayVideos: q('video[autoplay]'), videoAutoplayProp: v ? v.autoplay : null, videoControls: v ? v.controls : null, videoPaused: v ? v.paused : null, gridDisplay: gridStyle?.display, gridCols: gridStyle?.gridTemplateColumns?.split(' ').length, cards, docCards: q('.od-chat__doc'), thumbs: q('.od-chat__thumb'), posters: q('.od-chat__poster'), lightboxInDom: !!document.getElementById('ondemand-mini-chat-lightbox'), paneInDom: !!document.getElementById('ondemand-mini-chat-media') }; });
  const sideBySide = media.cards.length >= 2 && media.cards[0].y === media.cards[1].y && media.cards[1].x > media.cards[0].x;
  await shot(page, `check-media-rendering-${vp.name}.png`);
  rec('media_deliverables_render_thumb_poster_doc_no_autoplay', vp.name, media.imgs === 1 && media.videos === 1 && media.autoplayVideos === 0 && media.videoAutoplayProp === false && media.videoPaused === true && media.docCards === 1 && media.gridDisplay === 'grid' && sideBySide,
    `${JSON.stringify(media)} sideBySide=${sideBySide}`, `check-media-rendering-${vp.name}.png`, t0);
  // 3. lightbox opens on thumbnail click (real pointer), closes on Escape/close
  t0 = Date.now();
  const thumbRect = await page.evaluate(() => { const r = document.querySelector('#ondemand-mini-chat-transcript .od-chat__thumb').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  if (vp.isMobile) await page.touchscreen.tap(thumbRect.x, thumbRect.y); else await page.mouse.click(thumbRect.x, thumbRect.y);
  await new Promise(r => setTimeout(r, 300));
  const lb = await page.evaluate(() => { const l = document.getElementById('ondemand-mini-chat-lightbox'); return l ? { open: l.getAttribute('data-open'), hidden: l.hidden, display: getComputedStyle(l).display, src: l.querySelector('img')?.getAttribute('src'), z: getComputedStyle(l).zIndex, role: l.getAttribute('role') } : null; });
  await shot(page, `check-lightbox-${vp.name}.png`);
  await page.click('.od-chat__lightbox-close');
  await new Promise(r => setTimeout(r, 200));
  const lbClosed = await page.evaluate(() => document.getElementById('ondemand-mini-chat-lightbox')?.hidden);
  rec('image_thumbnail_opens_lightbox', vp.name, lb?.open === 'true' && lb.display !== 'none' && lb.src === 'https://example.com/figure.png' && lbClosed === true, `lightbox=${JSON.stringify(lb)} closedAfterX=${lbClosed}`, `check-lightbox-${vp.name}.png`, t0);
  // 4. video poster opens side pane; pane video has controls, not autoplaying
  t0 = Date.now();
  const posterRect = await page.evaluate(() => { const r = document.querySelector('#ondemand-mini-chat-transcript .od-chat__poster').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  if (vp.isMobile) await page.touchscreen.tap(posterRect.x, posterRect.y); else await page.mouse.click(posterRect.x, posterRect.y);
  await new Promise(r => setTimeout(r, 400));
  const pane = await page.evaluate(() => { const p = document.getElementById('ondemand-mini-chat-media'); const v = p?.querySelector('video'); const chat = document.getElementById('ondemand-mini-chat').getBoundingClientRect(); const pr = p?.getBoundingClientRect(); const overlap = pr ? !(pr.right <= chat.left || pr.left >= chat.right || pr.bottom <= chat.top || pr.top >= chat.bottom) : null; return p ? { open: p.getAttribute('data-open'), display: getComputedStyle(p).display, media: p.getAttribute('data-media'), hasVideo: !!v, controls: v?.controls, autoplay: v?.autoplay, paused: v?.paused, rect: pr && { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) }, overlapsChat: overlap, streamAutoplay: document.querySelectorAll('#ondemand-mini-chat-transcript video[autoplay]').length } : null; });
  await shot(page, `check-video-sidepane-${vp.name}.png`);
  rec('video_poster_opens_side_pane_no_autoplay', vp.name, pane?.open === 'true' && pane.display !== 'none' && pane.hasVideo && pane.controls === true && pane.autoplay === false && pane.paused === true && pane.overlapsChat === false && pane.streamAutoplay === 0, JSON.stringify(pane), `check-video-sidepane-${vp.name}.png`, t0);
  // 5. doc card opens pane with PDF iframe
  t0 = Date.now();
  await page.evaluate(() => document.querySelector('#ondemand-mini-chat-transcript .od-chat__doc').click());
  await new Promise(r => setTimeout(r, 300));
  const docPane = await page.evaluate(() => { const p = document.getElementById('ondemand-mini-chat-media'); return { open: p?.getAttribute('data-open'), media: p?.getAttribute('data-media'), iframe: !!p?.querySelector('iframe'), iframeSrc: p?.querySelector('iframe')?.getAttribute('src'), sandbox: p?.querySelector('iframe')?.getAttribute('sandbox') }; });
  await shot(page, `check-doc-preview-${vp.name}.png`);
  await page.click('.od-chat__media-close');
  rec('document_card_opens_pdf_preview', vp.name, docPane.open === 'true' && docPane.iframe && docPane.iframeSrc === 'https://example.com/brief.pdf' && docPane.sandbox === '', JSON.stringify(docPane), `check-doc-preview-${vp.name}.png`, t0);
  // 6. plugin dock not covered while chat open
  t0 = Date.now();
  const dock = await page.evaluate(() => { const d = document.getElementById('ondemand-plugin-dock'); if (!d) return { present: false }; const det = d.querySelector('details'); if (det && !det.open) det.open = true; const btn = d.querySelector('button.od-plugin__verify'); const r = (btn || d).getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); const chat = document.getElementById('ondemand-mini-chat').getBoundingClientRect(); const dr = d.getBoundingClientRect(); const overlap = !(dr.right <= chat.left || dr.left >= chat.right || dr.bottom <= chat.top || dr.top >= chat.bottom); return { present: true, dockRect: { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width), h: Math.round(dr.height) }, chatRect: { x: Math.round(chat.x), y: Math.round(chat.y), w: Math.round(chat.width), h: Math.round(chat.height) }, verifyHitsSelf: btn ? (top === btn || btn.contains(top)) : null, topId: top?.id || top?.className?.toString().slice(0, 40), overlapsChat: overlap, right: getComputedStyle(d).right }; });
  await shot(page, `check-plugin-dock-hittest-${vp.name}.png`);
  rec('plugin_dock_reachable_while_chat_open', vp.name, dock.present && dock.overlapsChat === false && dock.verifyHitsSelf !== false, JSON.stringify(dock), `check-plugin-dock-hittest-${vp.name}.png`, t0);
  // 7. close chat → banner returns
  t0 = Date.now();
  await page.evaluate(() => document.getElementById('ondemand-mini-chat-close').click());
  await new Promise(r => setTimeout(r, 300));
  const bannerAfter = await page.evaluate(() => { const b = document.querySelector('[data-gev-serverless-notice]'); return b ? { hidden: b.hidden } : { present: false }; });
  rec('banner_restored_after_chat_close', vp.name, bannerAfter.hidden === false, JSON.stringify(bannerAfter), null, t0);
  page.off('request', onReq); await page.setRequestInterception(false).catch(() => {});
  await page.close();
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ url: URL0, generated_utc: ts(), results }, null, 2));
console.log(`SUMMARY PASS=${results.filter(r => r.status === 'PASS').length} FAIL=${results.filter(r => r.status === 'FAIL').length}`);
await browser.close(); hardKill();
