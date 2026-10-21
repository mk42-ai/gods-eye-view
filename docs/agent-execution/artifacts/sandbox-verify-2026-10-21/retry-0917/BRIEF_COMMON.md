# sandbox-verify-2026-10-21 / retry-0917 — common brief for the five verification agents

Target: brand-new Vercel Sandbox preview `https://sb-4asza5droe1u.vercel.run`
(sandbox `sbx_C7YcHpK0v9hb018cNsHaEObsAyvi`, created 2026-10-21T09:17:55Z, projected expiry ≈ 2026-10-21T10:47:55Z,
serverless preview server `node server/serverless/dev-server.mjs` PID 176 on 0.0.0.0:5173, deploy source = workspace
head `712a552150784bbaddf46f3cc4ead10e56fcf5eb` = tag `checkpoint-2026-10-21-post-sandbox-verification`).
Health gate passed at 2026-10-21T09:19:13Z: `GET /api/health` 200 (`contracts:33, activePlugins:10, keySource:"server"`),
`GET /` 200 with `<title>OnDemand Intelligence Workstation</title>`.

Rules shared by every agent
- Only the sanctioned browser drivers: `scripts/qa-chat-intelligent-ui.mjs` (Puppeteer + SwiftShader, process-group hardKill,
  global 15-min cap) or a focused Puppeteer script under /tmp that copies the launch + `hardKill` + global-timeout block from
  `scripts/qa-chat-intelligent-ui.mjs` verbatim (executablePath /usr/bin/chromium, `--no-sandbox --use-gl=angle --use-angle=swiftshader`).
  Never start Chromium any other way; never install Playwright/Puppeteer (puppeteer is already in node_modules).
- Boot wait: navigate to `<url>/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`, then wait
  for `document.querySelector('#loading-screen')?.classList.contains('hidden')` (or the element to be gone) AND `window.__godsEyeView?.dataManager`
  before any screenshot — this is the corrected harness boot wait that avoids the loading overlay.
- Open the mini chat with `window.dispatchEvent(new CustomEvent('gev:ask-object', {detail:{objectType, objectId, label}}))` and wait for
  `#ondemand-mini-chat[data-open="true"]`; input `#ondemand-mini-chat-input`, send `#ondemand-mini-chat-send`, stop `#ondemand-mini-chat-stop`,
  status `#ondemand-mini-chat-status`, transcript `#ondemand-mini-chat-transcript .od-chat__msg`, sources `#ondemand-mini-chat-sources`.
- Every result carries the URL used and ISO-8601 UTC timestamps; every scenario × viewport cell has a PNG screenshot.
- No secrets are printed, read or written (the OnDemand key lives only in the sandbox server process; never read `.env`).
- Agents write only inside their own `agentN/` directory under this run directory; no git operations; no source edits
  (fixes are the orchestrator's job — report defects with evidence instead).
- Screenshots are PNG; filenames `<scenario>-<viewport>.png` for A–G cells, `check-<name>-<viewport>.png` for extra checks.
- If the sandbox answers 410 / connection refused, stop immediately and report `SANDBOX_EXPIRED` with the timestamp.
- Each agent ends by writing `agentN/RESULTS.md` (human table) and `agentN/results.json` (machine: array of
  `{check, scenario, viewport, status: PASS|FAIL|DEFECT|UNSUPPORTED, duration_ms, run_at_iso8601, screenshot, evidence}`).

Orchestrator pre-run (for reference, do not duplicate): `node scripts/qa-chat-intelligent-ui.mjs --url https://sb-4asza5droe1u.vercel.run --out <run>/orchestrator-ag --scenarios A-G --format png`
→ 14/14 PASS at 2026-10-21T09:26:21Z–09:27:17Z (boot: loader hidden after 9033 ms desktop / 5054 ms mobile).

Puppeteer template for a focused script (copy verbatim, run from the repo root so `import puppeteer from 'puppeteer'` resolves):
```js
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
// ... your checks ... then: await browser.close(); hardKill();
```
Only ONE Chromium at a time per agent (the pod is shared, 8 cores); close it at the end.
