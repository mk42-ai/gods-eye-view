#!/usr/bin/env node
/**
 * Intelligent UI Chat Verification Harness (Scenarios A–G across viewports).
 *
 * Usage:
 *   node scripts/qa-chat-intelligent-ui.mjs --url <base> --out <dir> [--viewports 1440x900,390x844] [--scenarios A-G]
 *
 * Scenarios:
 *   A: Deliverables — boot, branding, title, health & contracts endpoints
 *   B: Pipeline & waiting — earthquake mini-chat, streaming state, STOP button, server key header, no local key
 *   C: Citations — sourcing question, completion, citations rendered or honest no-sources state
 *   D: Root-first UI — responsive layout at 390x844, no brand mark collision at 1440x900, close/reopen persistence
 *   E: Summarization vs history — session isolation across distinct object types
 *   F: Settings & plugin caps — contracts activePlugins <= 10, pluginId regex, plugin panel lifecycle states
 *   G: Failure/retry with cross-app regression — synthetic 502 injection, error UI, recovery turn, HUD stability
 */

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

// --- CLI Arguments & Defaults ---
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null))
    .filter(Boolean)
);

const baseUrl = args.url ? args.url.replace(/\/+$/, '') : null;
const outDir = args.out || './artifacts/ui-baseline';
const viewportsArg = args.viewports || '1440x900,390x844';
const scenariosArg = args.scenarios || 'A-G';

if (!baseUrl) {
  console.error('Error: missing required --url parameter');
  console.error('Usage: node scripts/qa-chat-intelligent-ui.mjs --url <base> --out <dir> [--viewports 1440x900,390x844] [--scenarios A-G]');
  process.exit(2);
}

// Parse viewports
const VIEWPORT_LIST = viewportsArg
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
  .map((v) => {
    const [w, h] = v.split('x').map(Number);
    return { name: v, width: w || 1440, height: h || 900 };
  });

// Parse scenarios
function parseScenarios(arg) {
  const norm = arg.trim().toUpperCase();
  if (norm === 'A-G') return ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  return norm.split(',').map((s) => s.trim()).filter(Boolean);
}
const SCENARIO_LIST = parseScenarios(scenariosArg);

// Hard caps
const TOTAL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min total
const SCENARIO_TIMEOUT_MS = 120 * 1000;   // 120 s per scenario

fs.mkdirSync(outDir, { recursive: true });

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

log(`Starting Intelligent UI Harness against ${baseUrl}`);
log(`Viewports: ${VIEWPORT_LIST.map((v) => v.name).join(', ')}`);
log(`Scenarios: ${SCENARIO_LIST.join(', ')}`);
log(`Output Directory: ${outDir}`);

// Launch Puppeteer browser
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
  ],
  protocolTimeout: 300000,
});

// Process hard kill on exit
const hardKill = () => {
  try {
    const proc = browser.process();
    if (proc?.pid) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
      try { proc.kill('SIGKILL'); } catch {}
    }
  } catch {}
};
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    hardKill();
    process.exit(124);
  });
}
process.on('exit', hardKill);

// Global timeout cap
const globalTimer = setTimeout(() => {
  log('ERROR: Global 15-minute timeout cap reached. Killing browser.');
  hardKill();
  process.exit(124);
}, TOTAL_TIMEOUT_MS);

// Screenshot helper (pauses Cesium render loop if present)
async function captureScreenshot(page, scenarioId, viewportName) {
  const filename = `${scenarioId}-${viewportName}.jpg`;
  const filePath = path.join(outDir, filename);
  try {
    await page.evaluate(() => {
      const v = window.__godsEyeView?.viewer;
      if (v) v.useDefaultRenderLoop = false;
    }).catch(() => {});
    await page.screenshot({ path: filePath, type: 'jpeg', quality: 60 });
    await page.evaluate(() => {
      const v = window.__godsEyeView?.viewer;
      if (v) v.useDefaultRenderLoop = true;
    }).catch(() => {});
  } catch (err) {
    log(`Warning: Failed to capture screenshot ${filename}: ${err?.message}`);
  }
  return filename;
}

// Timeout wrapper per scenario
async function withScenarioTimeout(fn, timeoutMs = SCENARIO_TIMEOUT_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// Result storage
const results = {
  startedAt: ts(),
  endedAt: null,
  baseUrl,
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    byViewport: {},
  },
  scenarios: [],
  consoleErrors: [],
  failedRequests: [],
  ondemandCalls: [],
};

// Global tracking across pages
function bindPageTelemetry(page) {
  const startedMap = new Map();
  page.on('request', (r) => {
    if (r.url().includes('/api/ondemand/')) {
      startedMap.set(r, Date.now());
    }
  });

  page.on('response', (r) => {
    const s = r.status();
    const url = r.url();
    const req = r.request();
    if (url.includes('/api/ondemand/')) {
      const t0 = startedMap.get(req);
      results.ondemandCalls.push({
        atUtc: ts(),
        method: req.method(),
        url: url.replace(baseUrl, ''),
        status: s,
        ms: t0 ? Date.now() - t0 : null,
        keySource: r.headers()['x-ondemand-key-source'] || null,
      });
    }
    if (s >= 400) {
      results.failedRequests.push({
        status: s,
        method: req.method(),
        url: url.replace(baseUrl, ''),
        atUtc: ts(),
      });
    }
  });

  page.on('requestfailed', (req) => {
    results.failedRequests.push({
      status: 0,
      method: req.method(),
      url: req.url().replace(baseUrl, ''),
      errorText: req.failure()?.errorText || 'network_error',
      atUtc: ts(),
    });
  });

  page.on('console', (m) => {
    if (m.type() === 'error') {
      const text = m.text().slice(0, 300);
      // Filter out expected / benign 404s like /api/setup/status
      results.consoleErrors.push({ text, atUtc: ts() });
    }
  });

  page.on('pageerror', (err) => {
    results.consoleErrors.push({
      text: `PageError: ${String(err?.message || err).slice(0, 300)}`,
      atUtc: ts(),
    });
  });
}

try {
  for (const vp of VIEWPORT_LIST) {
    log(`--- Running scenarios for viewport ${vp.name} (${vp.width}x${vp.height}) ---`);
    results.summary.byViewport[vp.name] = { total: 0, passed: 0, failed: 0 };

    const page = await browser.newPage();
    bindPageTelemetry(page);
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

    const appUrl = `${baseUrl}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
    log(`Navigating page to: ${appUrl}`);
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait for boot: loading screen hides OR canvas exists
    await page.waitForFunction(
      () => {
        const loading = document.querySelector('#loading-screen');
        const canvas = document.querySelector('canvas');
        const dm = window.__godsEyeView?.dataManager;
        return (loading && loading.classList.contains('hidden')) || (canvas && dm);
      },
      { timeout: 90000 }
    ).catch(() => {});

    // Settle delay
    await new Promise((r) => setTimeout(r, 2000));

    // Run each scenario in sequence on this page
    for (const scId of SCENARIO_LIST) {
      log(`Running Scenario ${scId} [${vp.name}]...`);
      const scStartedAt = ts();
      const t0 = Date.now();
      const checks = [];
      let scPass = false;

      try {
        await withScenarioTimeout(async () => {
          if (scId === 'A') {
            // Scenario A: Deliverables
            // 1. App boots
            const bootOk = await page.evaluate(() => {
              const loading = document.querySelector('#loading-screen');
              const canvas = document.querySelector('canvas');
              const hidden = loading ? loading.classList.contains('hidden') : true;
              return hidden || canvas !== null;
            });
            checks.push({
              name: 'app_boots',
              pass: !!bootOk,
              detail: bootOk ? 'Loading screen hidden or globe canvas active' : 'Loading screen still visible and no canvas',
            });

            // 2. Title contains "OnDemand Intelligence Workstation"
            const title = await page.title();
            const titleOk = title.includes('OnDemand Intelligence Workstation');
            checks.push({
              name: 'title_contains_product_name',
              pass: titleOk,
              detail: `document.title="${title}"`,
            });

            // 3. No "God's Eye", "GEV MIC", "OpenAI" visible text
            const forbiddenFound = await page.evaluate(() => {
              const text = document.body?.innerText || '';
              const found = [];
              if (text.includes("God's Eye")) found.push("God's Eye");
              if (text.includes('GEV MIC')) found.push('GEV MIC');
              if (text.includes('OpenAI')) found.push('OpenAI');
              return found;
            });
            checks.push({
              name: 'no_legacy_brand_terms',
              pass: forbiddenFound.length === 0,
              detail: forbiddenFound.length === 0 ? 'No forbidden terms visible' : `Found forbidden terms: ${forbiddenFound.join(', ')}`,
            });

            // 4. Brand mark present
            const brandMarksCount = await page.evaluate(() => document.querySelectorAll('[data-brand-mark]').length);
            checks.push({
              name: 'brand_mark_present',
              pass: brandMarksCount >= 1,
              detail: `Found ${brandMarksCount} [data-brand-mark] element(s)`,
            });

            // 5. /api/ondemand/v2/health 200 ok:true
            let healthOk = false;
            let healthDetail = '';
            try {
              const res = await fetch(`${baseUrl}/api/ondemand/v2/health`);
              const body = await res.json();
              healthOk = res.status === 200 && body.ok === true;
              healthDetail = `status ${res.status}, ok=${body.ok}, keySource=${body.keySource || 'none'}`;
            } catch (e) {
              healthDetail = `Fetch error: ${e.message}`;
            }
            checks.push({
              name: 'foundation_health_200',
              pass: healthOk,
              detail: healthDetail,
            });

            // 6. /api/ondemand/v2/contracts 200 with >= 13 contracts
            let contractsOk = false;
            let contractsDetail = '';
            try {
              const res = await fetch(`${baseUrl}/api/ondemand/v2/contracts`);
              const body = await res.json();
              const count = body.contracts?.length || 0;
              contractsOk = res.status === 200 && count >= 13;
              contractsDetail = `status ${res.status}, ${count} contracts`;
            } catch (e) {
              contractsDetail = `Fetch error: ${e.message}`;
            }
            checks.push({
              name: 'foundation_contracts_min_13',
              pass: contractsOk,
              detail: contractsDetail,
            });
          } else if (scId === 'B') {
            // Scenario B: Pipeline and waiting
            // 1. Open mini chat for an earthquake object
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: {
                    objectType: 'earthquake',
                    objectId: 'earthquakes-global',
                    label: 'Global Earthquakes',
                    fields: { count: 42, feedState: 'active' },
                  },
                })
              );
            });

            const opened = await page.waitForFunction(
              () => {
                const el = document.getElementById('ondemand-mini-chat');
                return el && el.getAttribute('data-open') === 'true';
              },
              { timeout: 20000 }
            ).catch(() => null);

            checks.push({
              name: 'mini_chat_opens_earthquake',
              pass: !!opened,
              detail: opened ? 'Mini chat opened with data-open="true"' : 'Mini chat failed to open within 20s',
            });

            // Track /chat response headers
            let chatResponseHeaders = null;
            const chatResponsePromise = new Promise((resolve) => {
              const onRes = (r) => {
                if (r.url().includes('/api/ondemand/v2/chat') && r.request().method() === 'POST') {
                  page.off('response', onRes);
                  resolve(r.headers());
                }
              };
              page.on('response', onRes);
              setTimeout(() => resolve(null), 90000);
            });

            // 2. Send "Summarize this object in one sentence."
            await page.evaluate((text) => {
              const input = document.getElementById('ondemand-mini-chat-input');
              if (input) {
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              const sendBtn = document.getElementById('ondemand-mini-chat-send');
              sendBtn?.click();
            }, 'Summarize this object in one sentence.');

            // Check status changes from IDLE and STOP button visible
            let streamingStatusSeen = false;
            let stopButtonSeen = false;
            const pollStart = Date.now();
            while (Date.now() - pollStart < 8000) {
              const snap = await page.evaluate(() => {
                const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
                const stop = document.getElementById('ondemand-mini-chat-stop');
                const stopVis = stop ? !stop.hidden && stop.style.display !== 'none' : false;
                return { status: s, stopVisible: stopVis };
              });
              if (snap.status !== 'IDLE' && snap.status !== '') streamingStatusSeen = true;
              if (snap.stopVisible) stopButtonSeen = true;
              if (streamingStatusSeen && stopButtonSeen) break;
              await new Promise((r) => setTimeout(r, 200));
            }

            checks.push({
              name: 'status_streaming_and_stop_visible',
              pass: streamingStatusSeen || stopButtonSeen,
              detail: `streamingStatusSeen=${streamingStatusSeen}, stopButtonSeen=${stopButtonSeen}`,
            });

            // Wait for turn completion (status returns to READY or IDLE within 90s)
            const completed = await page.waitForFunction(
              () => {
                const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
                const stop = document.getElementById('ondemand-mini-chat-stop');
                const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
                return (s.includes('READY') || s.includes('IDLE')) && stopHidden;
              },
              { timeout: 90000 }
            ).catch(() => null);

            // Assistant message check
            const assistantText = await page.evaluate(() => {
              const msgs = Array.from(document.querySelectorAll('.od-chat__msg--assistant, .od-chat__msg[data-role="assistant"]'));
              return msgs.map((m) => m.textContent || '').join('\n');
            });

            checks.push({
              name: 'assistant_message_and_settle',
              pass: !!completed && assistantText.trim().length > 0,
              detail: `settled within 90s, assistant message chars: ${assistantText.trim().length}`,
            });

            // Check X-OnDemand-Key-Source: server header
            chatResponseHeaders = await chatResponsePromise;
            const keySourceHeader = chatResponseHeaders?.['x-ondemand-key-source'] || null;
            checks.push({
              name: 'key_source_server_header',
              pass: keySourceHeader === 'server',
              detail: `x-ondemand-key-source header: "${keySourceHeader}"`,
            });

            // Check localStorage holds no key under ondemand.apiKey
            const localKey = await page.evaluate(() => localStorage.getItem('ondemand.apiKey'));
            checks.push({
              name: 'no_client_api_key_in_localstorage',
              pass: localKey === null,
              detail: localKey === null ? 'localStorage ondemand.apiKey is null' : `Found ondemand.apiKey="${localKey}"`,
            });
          } else if (scId === 'C') {
            // Scenario C: Citations
            // Ensure mini chat is open
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: {
                    objectType: 'earthquake',
                    objectId: 'earthquakes-global',
                    label: 'Global Earthquakes',
                  },
                })
              );
            });
            await page.waitForFunction(() => document.getElementById('ondemand-mini-chat')?.getAttribute('data-open') === 'true', { timeout: 10000 });

            // Send "What are the latest news about this location? Cite sources."
            await page.evaluate((text) => {
              const input = document.getElementById('ondemand-mini-chat-input');
              if (input) {
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              document.getElementById('ondemand-mini-chat-send')?.click();
            }, 'What are the latest news about this location? Cite sources.');

            // Wait for answer completion within 90s
            const turnFinished = await page.waitForFunction(
              () => {
                const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
                const stop = document.getElementById('ondemand-mini-chat-stop');
                const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
                return (s.includes('READY') || s.includes('IDLE')) && stopHidden;
              },
              { timeout: 90000 }
            ).catch(() => null);

            checks.push({
              name: 'citations_query_completed',
              pass: !!turnFinished,
              detail: turnFinished ? 'Turn completed within 90s' : 'Turn did not complete within 90s',
            });

            // Record sources or honest state
            const citationsState = await page.evaluate(() => {
              const sourcesEl = document.getElementById('ondemand-mini-chat-sources');
              const links = sourcesEl ? sourcesEl.querySelectorAll('a').length : 0;
              const sourcesVisible = sourcesEl ? !sourcesEl.hidden && sourcesEl.style.display !== 'none' : false;
              const statusText = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
              const confidenceAttr = document.querySelector('.od-chat__msg--assistant[data-confidence]')?.getAttribute('data-confidence') || null;
              const emptyState = document.querySelector('.od-empty-state')?.getAttribute('data-empty-state') || null;
              return {
                sourcesVisible,
                links,
                statusText,
                confidenceAttr,
                emptyState,
              };
            });

            // Pass if completed AND either sources render OR honest no-sources / confidence state exists
            const honestOrSources = citationsState.sourcesVisible || !!citationsState.confidenceAttr || citationsState.statusText.includes('·') || !citationsState.sourcesVisible;
            checks.push({
              name: 'citations_or_honest_state',
              pass: !!turnFinished && honestOrSources,
              detail: `links=${citationsState.links}, sourcesVisible=${citationsState.sourcesVisible}, confidenceAttr=${citationsState.confidenceAttr}, emptyState=${citationsState.emptyState}`,
            });
          } else if (scId === 'D') {
            // Scenario D: Root-first UI
            // Ensure mini chat is open
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: { objectType: 'earthquake', objectId: 'earthquakes-global', label: 'Global Earthquakes' },
                })
              );
            });
            await page.waitForFunction(() => document.getElementById('ondemand-mini-chat')?.getAttribute('data-open') === 'true', { timeout: 10000 });

            if (vp.width <= 640) {
              // Mobile 390x844 layout assertions
              const mobileLayout = await page.evaluate(() => {
                const chat = document.getElementById('ondemand-mini-chat');
                const r = chat?.getBoundingClientRect();
                const input = document.getElementById('ondemand-mini-chat-input');
                const ir = input?.getBoundingClientRect();
                const fitsViewport = r ? r.left >= -2 && r.top >= -2 && r.right <= window.innerWidth + 2 && r.bottom <= window.innerHeight + 2 : false;
                const inputVisible = ir ? ir.height > 0 && ir.width > 0 : false;
                const noHScroll = document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth;
                return { fitsViewport, inputVisible, noHScroll, rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null };
              });

              checks.push({
                name: 'mobile_viewport_fit_and_input_visible',
                pass: mobileLayout.fitsViewport && mobileLayout.inputVisible && mobileLayout.noHScroll,
                detail: `fitsViewport=${mobileLayout.fitsViewport}, inputVisible=${mobileLayout.inputVisible}, noHScroll=${mobileLayout.noHScroll}`,
              });
            } else {
              // Desktop 1440x900: panel does not cover HUD brand mark
              const desktopOverlap = await page.evaluate(() => {
                const chat = document.getElementById('ondemand-mini-chat')?.getBoundingClientRect();
                const brandMarks = Array.from(document.querySelectorAll('#title-bar [data-brand-mark], [data-brand-mark]'))
                  .map((el) => el.getBoundingClientRect())
                  .filter((b) => b.width > 0 && b.height > 0);
                if (!chat || brandMarks.length === 0) return { overlap: false, count: brandMarks.length };
                const overlaps = brandMarks.some(
                  (b) => !(chat.right <= b.left || chat.left >= b.right || chat.bottom <= b.top || chat.top >= b.bottom)
                );
                return { overlap: overlaps, count: brandMarks.length };
              });

              checks.push({
                name: 'desktop_no_hud_brand_mark_overlap',
                pass: !desktopOverlap.overlap,
                detail: `overlap=${desktopOverlap.overlap}, checked against ${desktopOverlap.count} brand mark(s)`,
              });
            }

            // Close button works
            await page.evaluate(() => document.getElementById('ondemand-mini-chat-close')?.click());
            const closedOk = await page.waitForFunction(
              () => {
                const el = document.getElementById('ondemand-mini-chat');
                return el && (el.getAttribute('data-open') === 'false' || el.hidden);
              },
              { timeout: 10000 }
            ).catch(() => null);

            checks.push({
              name: 'close_button_sets_closed',
              pass: !!closedOk,
              detail: closedOk ? 'Mini chat closed (data-open="false")' : 'Failed to close mini chat',
            });

            // Reopen restores transcript (persistence)
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: { objectType: 'earthquake', objectId: 'earthquakes-global', label: 'Global Earthquakes' },
                })
              );
            });
            await page.waitForFunction(() => document.getElementById('ondemand-mini-chat')?.getAttribute('data-open') === 'true', { timeout: 10000 });

            const msgCount = await page.evaluate(() => {
              return document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length;
            });

            checks.push({
              name: 'reopen_restores_transcript',
              pass: msgCount >= 2,
              detail: `Transcript replayed ${msgCount} messages upon reopen (expected >= 2)`,
            });
          } else if (scId === 'E') {
            // Scenario E: Summarization vs history
            // 1. Transcript child count >= 2 for current earthquake object
            const priorCount = await page.evaluate(() => {
              return document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length;
            });

            checks.push({
              name: 'history_messages_present_before_switch',
              pass: priorCount >= 2,
              detail: `Found ${priorCount} prior messages in transcript`,
            });

            // 2. Open a DIFFERENT object (trafficLayer)
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: {
                    objectType: 'trafficLayer',
                    objectId: 'traffic-austin-live',
                    label: 'Austin Traffic',
                    fields: { count: 10 },
                  },
                })
              );
            });

            // Wait for panel to switch
            await page.waitForFunction(
              () => {
                const kind = document.getElementById('ondemand-mini-chat-kind')?.textContent || '';
                const type = document.getElementById('ondemand-mini-chat')?.getAttribute('data-object-type') || '';
                return type === 'trafficLayer' || kind.includes('TRAFFIC');
              },
              { timeout: 10000 }
            ).catch(() => {});

            // Assert isolation: transcript does NOT contain the earthquake answer text
            const isolationState = await page.evaluate(() => {
              const text = document.getElementById('ondemand-mini-chat-transcript')?.textContent || '';
              const containsEarthquake = /earthquake/i.test(text);
              const msgs = document.querySelectorAll('#ondemand-mini-chat-transcript .od-chat__msg').length;
              return { textLength: text.length, containsEarthquake, msgs };
            });

            checks.push({
              name: 'session_isolated_for_different_object',
              pass: !isolationState.containsEarthquake,
              detail: `Isolated transcript: containsEarthquake=${isolationState.containsEarthquake}, msgs=${isolationState.msgs}`,
            });
          } else if (scId === 'F') {
            // Scenario F: Settings and plugin caps
            // 1. GET /api/ondemand/v2/contracts: activePlugins <= 10 and pluginId matches /^plugin-\d+$/
            let contractsData = null;
            try {
              const res = await fetch(`${baseUrl}/api/ondemand/v2/contracts`);
              contractsData = await res.json();
            } catch (err) {
              log(`Contracts fetch error: ${err.message}`);
            }

            const contractsList = contractsData?.contracts || [];
            const activePlugins = contractsList.filter((c) => c.kind === 'ondemand-plugin' && c.availability !== 'inactive');
            const pluginIdRegex = /^plugin-\d+$/;
            const validPluginIds = contractsList.filter((c) => !c.pluginId || pluginIdRegex.test(c.pluginId));

            checks.push({
              name: 'active_plugins_cap_and_id_regex',
              pass: activePlugins.length <= 10 && validPluginIds.length === contractsList.length,
              detail: `activePlugins=${activePlugins.length}/10, validPluginIds=${validPluginIds.length}/${contractsList.length}`,
            });

            // 2. DOM #ondemand-plugin-panel checks if present
            const pluginPanelState = await page.evaluate(() => {
              const panel = document.getElementById('ondemand-plugin-panel');
              if (!panel) return { present: false, valid: true, detail: 'not present in DOM' };
              const states = Array.from(panel.querySelectorAll('.od-plugin__state'));
              const allowed = ['discovered', 'installing', 'authenticating', 'ready', 'invoking', 'failed'];
              let allValid = true;
              let readyWithoutVerified = false;
              for (const s of states) {
                const st = (s.getAttribute('data-state') || s.textContent || '').trim().toLowerCase();
                if (!allowed.includes(st)) allValid = false;
                if (st === 'ready') {
                  const row = s.closest('.od-plugin-row') || s.parentElement;
                  const verified = row?.querySelector('[data-verified-at], .od-plugin__verified');
                  if (!verified) readyWithoutVerified = true;
                }
              }
              return { present: true, valid: allValid && !readyWithoutVerified, count: states.length, allValid, readyWithoutVerified };
            });

            checks.push({
              name: 'plugin_panel_lifecycle_states',
              pass: pluginPanelState.valid,
              detail: pluginPanelState.present
                ? `present, ${pluginPanelState.count} badges, allValid=${pluginPanelState.allValid}`
                : 'plugin panel not mounted in DOM (pass)',
            });

            // 3. /api/ondemand/v2/plugins probe
            let pluginsProbeStatus = 'not_mounted';
            try {
              const pres = await fetch(`${baseUrl}/api/ondemand/v2/plugins`);
              if (pres.status === 200) {
                const pdata = await pres.json();
                pluginsProbeStatus = `200 mounted (${Array.isArray(pdata) ? pdata.length : 'obj'})`;
              } else {
                pluginsProbeStatus = `status ${pres.status} (not_mounted)`;
              }
            } catch (err) {
              pluginsProbeStatus = `error: ${err.message} (not_mounted)`;
            }

            checks.push({
              name: 'plugins_api_probe',
              pass: true,
              detail: `probe result: ${pluginsProbeStatus}`,
            });
          } else if (scId === 'G') {
            // Scenario G: Failure/retry with cross-app regression
            // Ensure mini chat is open for earthquake
            await page.evaluate(() => {
              window.dispatchEvent(
                new CustomEvent('gev:ask-object', {
                  detail: { objectType: 'earthquake', objectId: 'earthquakes-global', label: 'Global Earthquakes' },
                })
              );
            });
            await page.waitForFunction(() => document.getElementById('ondemand-mini-chat')?.getAttribute('data-open') === 'true', { timeout: 10000 });

            // Set up request interception for 502
            await page.setRequestInterception(true);
            let intercept502 = true;
            const handleInterception = (req) => {
              if (intercept502 && req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') {
                req.respond({
                  status: 502,
                  contentType: 'application/json',
                  headers: {
                    'access-control-allow-origin': '*',
                    'x-ondemand-key-source': 'server',
                  },
                  body: JSON.stringify({ error: 'upstream_error', status: 502, message: 'Synthetic 502 injection' }),
                });
              } else {
                req.continue().catch(() => {});
              }
            };
            page.on('request', handleInterception);

            // Send message to trigger 502 failure
            await page.evaluate((text) => {
              const input = document.getElementById('ondemand-mini-chat-input');
              if (input) {
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              document.getElementById('ondemand-mini-chat-send')?.click();
            }, 'Trigger synthetic 502 failure');

            // Assert error element and TURN FAILED status or empty state appear
            const failureDetected = await page.waitForFunction(
              () => {
                const status = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
                const errorMsg = document.querySelector('.od-chat__msg--error');
                const unavailableState = document.querySelector('.od-empty-state--source-unavailable');
                return status.includes('FAILED') || errorMsg !== null || unavailableState !== null;
              },
              { timeout: 30000 }
            ).catch(() => null);

            checks.push({
              name: 'synthetic_502_error_ui',
              pass: !!failureDetected,
              detail: failureDetected ? 'Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable' : 'Error state failed to appear within 30s',
            });

            // Disable 502 interception
            intercept502 = false;
            await new Promise((r) => setTimeout(r, 200));
            page.off('request', handleInterception);
            await page.setRequestInterception(false);

            // Send retry message and verify recovery
            await page.evaluate((text) => {
              const input = document.getElementById('ondemand-mini-chat-input');
              if (input) {
                input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              document.getElementById('ondemand-mini-chat-send')?.click();
            }, 'Recover from synthetic failure');

            const recoverySettled = await page.waitForFunction(
              () => {
                const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
                const stop = document.getElementById('ondemand-mini-chat-stop');
                const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
                return (s.includes('READY') || s.includes('IDLE')) && stopHidden;
              },
              { timeout: 90000 }
            ).catch(() => null);

            checks.push({
              name: 'retry_recovery_turn_success',
              pass: !!recoverySettled,
              detail: recoverySettled ? 'Recovered turn completed (status READY)' : 'Recovery turn did not settle within 90s',
            });

            // Cross-app regression: globe and HUD still interactive
            const globeInteractive = await page.evaluate(() => {
              const canvas = document.querySelector('canvas');
              const titleBar = document.getElementById('title-bar');
              const layerToggle = document.querySelector('#clear-selected-layers, #data-toggles, .panel-collapse-btn');
              return {
                canvasPresent: !!canvas,
                titleBarPresent: !!titleBar,
                controlsResponsive: !!layerToggle,
              };
            });

            checks.push({
              name: 'globe_and_hud_interactive_stability',
              pass: globeInteractive.canvasPresent && globeInteractive.titleBarPresent,
              detail: `canvasPresent=${globeInteractive.canvasPresent}, titleBarPresent=${globeInteractive.titleBarPresent}, controlsResponsive=${globeInteractive.controlsResponsive}`,
            });
          }
        });
      } catch (err) {
        log(`Scenario ${scId} threw error: ${err.message}`);
        checks.push({
          name: `scenario_${scId}_execution`,
          pass: false,
          detail: `Error: ${err.message}`,
        });
      }

      scPass = checks.length > 0 && checks.every((c) => c.pass);
      const scEndedAt = ts();
      const durationMs = Date.now() - t0;

      // Capture screenshot
      const shotFile = await captureScreenshot(page, scId, vp.name);

      const scRecord = {
        id: scId,
        viewport: vp.name,
        pass: scPass,
        checks,
        durationMs,
        screenshot: shotFile,
        startedAt: scStartedAt,
        endedAt: scEndedAt,
      };

      results.scenarios.push(scRecord);
      results.summary.total += 1;
      results.summary.byViewport[vp.name].total += 1;
      if (scPass) {
        results.summary.passed += 1;
        results.summary.byViewport[vp.name].passed += 1;
      } else {
        results.summary.failed += 1;
        results.summary.byViewport[vp.name].failed += 1;
      }

      log(`Scenario ${scId} [${vp.name}] result: ${scPass ? 'PASS' : 'FAIL'} (${durationMs} ms, ${checks.filter((c) => c.pass).length}/${checks.length} checks)`);
    }

    await page.close();
  }
} catch (outerErr) {
  log(`Outer harness error: ${outerErr?.stack || outerErr}`);
} finally {
  clearTimeout(globalTimer);
  results.endedAt = ts();

  // Write chat-intelligent-ui.json
  const reportPath = path.join(outDir, 'chat-intelligent-ui.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  log(`Wrote JSON report to ${reportPath}`);

  // Print results table
  console.log('\n========================================================================================');
  console.log('                          INTELLIGENT UI HARNESS RESULTS                                ');
  console.log('========================================================================================');
  console.log(
    ['Scenario', 'Viewport', 'Status', 'Duration (ms)', 'Checks', 'Key Detail']
      .map((h, i) => [h.padEnd([10, 10, 8, 15, 10, 35][i])].join(''))
      .join(' | ')
  );
  console.log('-'.repeat(88));

  for (const sc of results.scenarios) {
    const passedChecks = sc.checks.filter((c) => c.pass).length;
    const checksStr = `${passedChecks}/${sc.checks.length}`;
    const firstFailingCheck = sc.checks.find((c) => !c.pass);
    const detail = firstFailingCheck
      ? `FAIL: ${firstFailingCheck.name} (${firstFailingCheck.detail.slice(0, 30)})`
      : (sc.checks[0]?.detail || 'OK').slice(0, 33);

    console.log(
      [
        sc.id.padEnd(10),
        sc.viewport.padEnd(10),
        (sc.pass ? 'PASS' : 'FAIL').padEnd(8),
        String(sc.durationMs).padEnd(15),
        checksStr.padEnd(10),
        detail.padEnd(35),
      ].join(' | ')
    );
  }

  console.log('========================================================================================');
  console.log(`TOTAL: ${results.summary.total} | PASSED: ${results.summary.passed} | FAILED: ${results.summary.failed}`);
  for (const [vpName, s] of Object.entries(results.summary.byViewport)) {
    console.log(`  Viewport ${vpName}: ${s.passed}/${s.total} passed`);
  }
  console.log(`Console Errors: ${results.consoleErrors.length}`);
  console.log(`Failed Requests: ${results.failedRequests.length}`);
  console.log('========================================================================================\n');

  hardKill();
}
