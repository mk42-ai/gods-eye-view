#!/usr/bin/env node
/** Real visible-input Chromium verification and compositor recording.
 * Explicitly requested headless-browser path; uses the repo's existing
 * Puppeteer dependency. No fixture responses/state are injected in live runs.
 * Parent owns and kills BOTH worker and browser process groups on every exit.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(import.meta.url);
const arg = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const utc = () => new Date().toISOString();
const safeEnv = () => Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
const kill = pid => { if (pid > 1) try { process.kill(-pid, 'SIGKILL'); } catch { /* exited */ } };
const strip = s => String(s).replace(/https?:\/\/[^\s"<>]+/g, v => { try { const u = new URL(v); return `${u.origin}${u.pathname}`; } catch { return '[url]'; } }).slice(0, 500);
async function worker(cfg) {
  const { default: puppeteer } = await import('puppeteer');
  const result = { startedUtc: utc(), url: cfg.url, scope: 'live standalone app; no mocked provider responses', passed: 0, failed: 0, runs: [], limitations: [] };
  const save = () => fs.writeFile(cfg.report, JSON.stringify(result, null, 2));
  const check = (run, name, ok, detail) => { const entry = { utc: utc(), name, ok: Boolean(ok), detail }; run.checks.push(entry); result[ok ? 'passed' : 'failed']++; console.log(`${ok ? 'PASS' : 'FAIL'} ${run.viewport} ${name} ${JSON.stringify(detail ?? '').slice(0,280)}`); };
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, env: safeEnv(), protocolTimeout: 100000,
    args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
  process.send?.({ browserPid: browser.process()?.pid });
  try {
    for (const vp of cfg.viewports) {
      const [width,height] = vp.split('x').map(Number), mobile = width < 600;
      const run = { viewport: vp, checks: [], errors: [], requests: [], scenes: [], screenshots: [], timings: [] }; result.runs.push(run);
      const context = await browser.createBrowserContext();
      await context.overridePermissions(new URL(cfg.url).origin, []);
      const page = await context.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      page.on('pageerror', e => run.errors.push(strip(e.message)));
      page.on('request', r => {
        const u = new URL(r.url());
        if (!/\/(scene\/evidence|incidents\/(locate|search|ingest))$/.test(u.pathname)) return;
        let body={}; try { body=JSON.parse(r.postData() || '{}'); } catch { /* GET */ }
        run.requests.push({ utc: utc(), at: Date.now(), path: u.pathname, method: r.method(), requestId: body.requestId || null,
          scope: Object.fromEntries(['text','place','lat','lon','radiusKm','windowHours','timeMode','windowStart','windowEnd'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]])) });
      });
      await page.evaluateOnNewDocument(() => {
        window.__repairObservation = { submits: [], feedback: [] };
        document.addEventListener('submit', e => { if (e.target.id === 'incident-composer' && e.isTrusted) window.__repairObservation.submits.push({at:performance.now(), value:document.querySelector('#incident-composer-input')?.value}); }, true);
        new MutationObserver(() => { const n=document.querySelector('#incident-composer-result'); if(n && !n.hidden) { const text=n.innerText; const prev=window.__repairObservation.feedback.at(-1); if(prev?.text!==text) window.__repairObservation.feedback.push({at:performance.now(),text}); } }).observe(document,{subtree:true,childList:true,characterData:true});
      });
      await page.goto(`${cfg.url}/?welcome=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#incident-composer-input', { timeout: 120000 });
      await page.waitForFunction(() => Boolean(window.__gevSceneEvidence && window.__godsEyeView?.viewer), {timeout: 90000});
      await sleep(2000);
      let recorder=null;
      if (cfg.record && vp===cfg.viewports[0]) recorder=await page.screencast({path:cfg.record,fps:10,quality:28});
      const shot = async label => { const name=`strict-${label}-${vp}.png`; await page.screenshot({path:path.join(cfg.out,name)});run.screenshots.push(name); };
      const click = async sel => { const n=await page.$(sel); if(!n)throw new Error(`missing ${sel}`); if(mobile)await n.tap();else await n.click(); };
      const hit = sel => page.evaluate(s => { const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:top===n||n.contains(top),inside:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,rect:[r.x,r.y,r.width,r.height]}; },sel);
      const state = () => page.evaluate(() => window.__gevSceneEvidence.getState());
      const camera = () => page.evaluate(() => {const p=window.__godsEyeView.viewer.camera.positionCartographic;return {lat:p.latitude*180/Math.PI,lon:p.longitude*180/Math.PI,height:p.height};});
      const type = async value => { await click('#incident-composer-input'); await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(value,{delay:18}); };
      const awaitDone = async requestBefore => {
        await page.waitForFunction(n => window.__gevSceneEvidence.getState().requestId && document.querySelector('#scene-evidence')?.hidden===false, {timeout:45000},requestBefore);
        await page.waitForFunction(() => ['done','error','timeout'].includes(window.__gevSceneEvidence.getState().phase), {timeout:65000});
        return state();
      };
      let h=await hit('#incident-composer-input');check(run,'AOI textbox visible and hit-testable',h?.hit&&h?.inside,h);
      h=await hit('#incident-composer-submit');check(run,'BUILD SCENE visible and hit-testable',h?.hit&&h?.inside,h);
      await sleep(1000);check(run,'no background social feed before submit',run.requests.filter(r=>r.path.endsWith('/scene/evidence')).length===0,run.requests);
      await shot('idle');
      await type('hi'); const beforeHi=run.requests.length;await page.keyboard.press('Enter');await sleep(150);
      const hint=await page.$eval('#incident-composer-result',n=>n.innerText);
      check(run,'hi gives immediate validation without network',/Type a place/.test(hint)&&run.requests.length===beforeHi,hint);await shot('greeting');
      if(cfg.smoke){ await save();await context.close();continue; }
      if(cfg.micOnly){
        await click('#od-voice-button');
        await page.waitForFunction(() => /error|unavailable|permission/i.test(document.querySelector('#od-voice-control')?.innerText || ''),{timeout:20000});
        const voiceText=await page.$eval('#od-voice-control',n=>n.innerText);
        check(run,'actual microphone permission denial is visible',/Microphone unavailable/i.test(voiceText),voiceText);
        await type('Dubai Marina');await page.keyboard.press('Enter');
        await page.waitForSelector('#incident-composer-play',{timeout:50000});
        await page.waitForFunction(()=>window.__gevSceneEvidence.getState().phase==='done',{timeout:65000});
        check(run,'typed Build succeeds after microphone denial',Boolean(await page.$('#incident-composer-play'))&&(await hit('#incident-composer-input'))?.hit);
        await shot('microphone-denial-verified');await save();await context.close();continue;
      }
      const build = async (text, label, method='button', expected=[25.0786,55.1353]) => {
        const count=run.requests.filter(r=>r.path.endsWith('/scene/evidence')).length;
        await type(text); const t=Date.now();if(method==='enter')await page.keyboard.press('Enter');else await click('#incident-composer-submit');
        await sleep(80);
        const feedback=await page.$eval('#incident-composer-result',n=>n.innerText);
        check(run,`${label}: immediate visible acknowledgement`,/Locating|Building|Scene generated/.test(feedback),{ms:Date.now()-t,feedback});
        await page.waitForFunction(() => Boolean(document.querySelector('#incident-composer-play')) || document.querySelector('#incident-composer')?.dataset.state==='error', {timeout:75000});
        await page.waitForFunction(() => document.querySelector('#scene-evidence')?.hidden===false, {timeout:30000});
        await shot(`${label}-progress`);
        const s=await awaitDone(count);await sleep(2000);const c=await camera();
        check(run,`${label}: visible input triggered a fresh server evidence request`,run.requests.filter(r=>r.path.endsWith('/scene/evidence')).length>count,{requestId:s.requestId,phase:s.phase});
        check(run,`${label}: camera is at requested AOI`,Math.hypot(c.lat-expected[0],c.lon-expected[1])<0.12,c);
        check(run,`${label}: real scene constructed`,await page.$eval('#incident-composer',n=>n.dataset.state==='done')&&Boolean(await page.$('#incident-composer-play')));
        check(run,`${label}: providers have independent terminal states`,s.phase==='done'&&s.sources.every(x=>x.state!=='running'),s.sources);
        const dom=await page.evaluate(() => ({empty:document.querySelector('#scene-evidence-empty')?.innerText,videoPlays:document.querySelectorAll('#scene-evidence .sev-card[data-eligible="true"] .sev-card__play').length,unverifiedPlays:document.querySelectorAll('#scene-evidence-candidates .sev-card__play').length,pinned:window.__godsEyeView.viewer.dataSources.getByName('scene-evidence-pins')[0]?.entities.values.length}));
        check(run,`${label}: candidates cannot play or become verified map pins`,dom.unverifiedPlays===0&&(!s.items?dom.pinned===0:true),dom);
        if(s.items===0) check(run,`${label}: honest no-verified-footage state`,/No verified recent footage/.test(dom.empty)&&dom.videoPlays===0,dom);
        const observation=await page.evaluate(() => window.__repairObservation);
        const submit=observation.submits.at(-1),first=observation.feedback.find(f=>f.at>=submit?.at&&/Locating|Building|Scene generated/.test(f.text));
        const feedbackMs = first && submit ? first.at - submit.at : null;
        check(run, `${label}: trusted submit produces feedback within 500 ms`, feedbackMs !== null && feedbackMs >= 0 && feedbackMs < 500, { feedbackMs });
        run.timings.push({label,submitToFeedbackMs:feedbackMs,submitToDoneMs:Date.now()-t,server:s.timings,firstVerifiedItemMs:s.items?s.client.firstCardMs:null,verifiedPlaybackMs:null});
        run.scenes.push({label,text,camera:c,state:s});await shot(`${label}-result`);await save();return s;
      };
      let s=await build('Dubai Marina','marina','enter');
      // Camera animation is tested separately and never counted as video playback.
      const cam1=await camera();await click('#incident-composer-play');await sleep(2700);const cam2=await camera();
      check(run,'camera-scene Play changes camera (not video playback)',Math.hypot(cam1.lat-cam2.lat,cam1.lon-cam2.lon)>0.00001,{before:cam1,after:cam2});await shot('camera-playback');
      await build('Dubai Marina','same-aoi-rebuild','button');
      // Native time selector cancels superseded work and sends the selected interval.
      const beforeTime=s.requestId;await page.select('#incident-composer-window','24');
      await page.waitForFunction(old=>window.__gevSceneEvidence.getState().requestId!==old,{timeout:30000},beforeTime);s=await awaitDone();
      check(run,'explicit time control reaches server as 24-hour recording window',s.window?.hours===24,{requestId:s.requestId,window:s.window});run.scenes.push({label:'24-hour-window',state:s});await shot('time-window');
      await build('burj khalifa check if there is any incidents','burj-research','button',[25.1972,55.2744]);
      check(run,'research wording never fabricates incident ingest',!run.requests.some(r=>r.path.endsWith('/incidents/ingest')),run.requests.map(x=>x.path));
      await build('Abu Dhabi','different-aoi','enter',[24.4539,54.3773]);
      // Rapid replacement must never receive late Marina rows in Abu Dhabi's state.
      await type('Dubai Marina');await page.keyboard.press('Enter');await sleep(600);await type('Abu Dhabi');await page.keyboard.press('Enter');await sleep(3000);s=await awaitDone();
      check(run,'AOI change cancels obsolete stream and keeps new scope',/Abu Dhabi/i.test(s.place),{place:s.place,requestId:s.requestId});run.scenes.push({label:'cancellation',state:s});
      const beforeExternal=run.requests.filter(r=>r.path.endsWith('/scene/evidence')).length;
      await type('explosion at Bandar Abbas, Iran');await click('#incident-composer-submit');
      await page.waitForFunction(()=>document.querySelector('#incident-composer')?.dataset.state==='external',{timeout:65000});
      const ext=await page.$eval('#incident-composer-result',n=>n.innerText);
      check(run,'external AOI has refusal and no scene Play',/external context only/.test(ext)&&!await page.$('#incident-composer-play'),ext);
      const marker=await page.$eval('#scene-anchor-label',n=>({external:n.classList.contains('external'),text:n.innerText}));
      check(run,'external map marker is distinctly labelled EXTERNAL',marker.external&&/EXTERNAL/.test(marker.text),marker);
      check(run,'external transition clears old evidence layer',await page.$eval('#scene-evidence',n=>n.hidden)&&run.requests.filter(r=>r.path.endsWith('/scene/evidence')).length===beforeExternal);
      await shot('external');
      const settledCount=run.requests.length; await sleep(2500); check(run,'settled external/idle state does not start another social request',run.requests.length===settledCount,{observationMs:2500,newRequests:run.requests.length-settledCount});
      // Native microphone denial: do not inject an app error or fake provider response.
      const voice=await page.$('#od-voice-button');
      if(voice){await voice.click();await sleep(1800);const vh=await page.$eval('#od-voice-control',n=>n.innerText);check(run,'microphone denial remains isolated from typed AOI',/error|unavailable|permission/i.test(vh)&&(await hit('#incident-composer-input'))?.hit,vh);}
      else result.limitations.push(`${vp}: voice control button not available`);
      await shot('microphone-isolation');
      // The provider player is used only when the live run produced eligible media.
      const qualified=run.scenes.find(x=>x.state.items>0);
      if(qualified){
        const target=await page.$('#scene-evidence .sev-card[data-eligible="true"] .sev-card__play');
        if(target){await target.click();await sleep(3000);const before=await page.$eval('#scene-evidence-player',n=>Number(n.dataset.currentTime));const wall=Date.now();await sleep(3500);const after=await page.$eval('#scene-evidence-player',n=>Number(n.dataset.currentTime));check(run,'eligible source video time progresses over measured interval',Number.isFinite(before)&&Number.isFinite(after)&&after>before+0.2,{before,after,wallMs:Date.now()-wall});}
        else result.limitations.push(`${vp}: eligible item no longer selected; playback not verified.`);
      }
      if(!qualified) result.limitations.push(`${vp}: 0 eligible recordings; video currentTime/progress, public-author popup and source-specific playback unavailable, not passed.`);
      check(run,'no unhandled page errors',run.errors.length===0,run.errors);
      if(recorder)await recorder.stop();
      await context.close();await save();
    }
    result.finishedUtc=utc();await save();return result;
  } finally { await browser.close().catch(()=>{});kill(browser.process()?.pid); }
}
if(process.argv.includes('--worker')) {
  const cfg=JSON.parse(arg('config','{}'));
  worker(cfg).then(result=>process.exit(result.failed ? 1 : 0)).catch(async e=>{console.error(strip(e.stack));process.exit(1);});
} else {
  const cfg={url:arg('url',''),viewports:arg('viewports','1440x900,375x739').split(','),out:arg('out','../.ui-proof'),report:arg('report','/tmp/strict-ui-result.json'),record:arg('record',null),smoke:process.argv.includes('--smoke'),micOnly:process.argv.includes('--mic-only')};
  await fs.mkdir(cfg.out,{recursive:true});
  const child=spawn(process.execPath,[file,'--worker','--config',JSON.stringify(cfg)],{detached:true,env:safeEnv(),stdio:['ignore','pipe','pipe','ipc']});
  const groups=new Set([child.pid]);child.on('message',m=>{if(m.browserPid)groups.add(m.browserPid);});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const cleanup=()=>{for(const pid of groups)kill(pid);};
  const cap=setTimeout(()=>{console.error('hard runtime cap reached');cleanup();process.exitCode=2;},12*60000);
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{cleanup();process.exit(2);});
  const code=await new Promise(r=>child.once('exit',(code)=>r(code??2)));clearTimeout(cap);cleanup();process.exitCode=code;
}
