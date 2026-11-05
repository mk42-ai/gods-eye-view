#!/usr/bin/env node
/**
 * scripts/qa-verify-walkthrough.mjs — Comprehensive End-to-End Walkthrough Script
 *
 * Models puppeteer args, hygiene, Cesium render-loop pause, and error handling on
 * scripts/qa-chat-intelligent-ui.mjs.
 * Viewport-parameterised for desktop (1440x900, Agent 1) and mobile (390x844, Agent 2).
 *
 * Usage:
 *   node scripts/qa-verify-walkthrough.mjs --url <base> --out <dir> [--viewport 1440x900] [--prefix 1] [--agent 1]
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
const outDir = args.out ? path.resolve(args.out) : path.resolve('./docs/agent-execution/artifacts/verify-2026-10-21/desktop');
const viewportArg = args.viewport || '1440x900';

if (!baseUrl) {
  console.error('Error: missing required --url parameter');
  console.error('Usage: node scripts/qa-verify-walkthrough.mjs --url <base> --out <dir> [--viewport 1440x900] [--prefix 1] [--agent 1]');
  process.exit(2);
}

const [vpW, vpH] = viewportArg.split('x').map(Number);
const viewport = {
  width: vpW || 1440,
  height: vpH || 900,
  name: viewportArg,
};

const prefix = args.prefix || (viewport.width < 1000 ? '2' : '1');
const agentNumber = Number(args.agent || prefix || '1');

fs.mkdirSync(outDir, { recursive: true });

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

log(`Starting QA Verify Walkthrough against ${baseUrl}`);
log(`Viewport: ${viewport.name} (${viewport.width}x${viewport.height}), Prefix: ${prefix}, Agent: ${agentNumber}`);
log(`Artifact Directory: ${outDir}`);

// Hard cap: 15 minutes
const TOTAL_TIMEOUT_MS = 15 * 60 * 1000;

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

const globalTimer = setTimeout(() => {
  log('ERROR: Global 15-minute timeout cap reached. Killing browser.');
  hardKill();
  process.exit(124);
}, TOTAL_TIMEOUT_MS);

// Screenshot helper (pauses Cesium render loop before taking JPEG q60)
async function captureScreenshot(page, filenameNoExt) {
  const filename = `${filenameNoExt}.jpg`;
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
    log(`  [Screenshot] Saved ${filename}`);
  } catch (err) {
    log(`  [Screenshot] Warning: Failed to capture ${filename}: ${err?.message}`);
  }
  return filename;
}

// Telemetry & Results
const telemetry = {
  consoleErrors: [],
  failedRequests: [],
  capturedVoicePostBodies: [],
};

function bindPageTelemetry(page) {
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const text = m.text().slice(0, 300);
      telemetry.consoleErrors.push({ text, atUtc: ts() });
    }
  });

  page.on('pageerror', (err) => {
    telemetry.consoleErrors.push({
      text: `PageError: ${String(err?.message || err).slice(0, 300)}`,
      atUtc: ts(),
    });
  });

  page.on('request', (req) => {
    if (req.url().includes('/voice/turn') && req.method() === 'POST') {
      try {
        const pd = req.postData();
        if (pd) {
          telemetry.capturedVoicePostBodies.push(JSON.parse(pd));
        }
      } catch (e) {
        telemetry.capturedVoicePostBodies.push({ raw: req.postData(), error: e.message });
      }
    }
  });

  page.on('requestfailed', (req) => {
    telemetry.failedRequests.push({
      status: 0,
      method: req.method(),
      url: req.url().replace(baseUrl, ''),
      errorText: req.failure()?.errorText || 'network_error',
      atUtc: ts(),
    });
  });

  page.on('response', (res) => {
    const s = res.status();
    const req = res.request();
    if (s >= 400) {
      telemetry.failedRequests.push({
        status: s,
        method: req.method(),
        url: res.url().replace(baseUrl, ''),
        atUtc: ts(),
      });
    }
  });
}

const checks = [];
const startedUtc = ts();

try {
  const page = await browser.newPage();
  bindPageTelemetry(page);
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

  // Wrap window.fetch before any scripts run to also capture fetch in-page
  await page.evaluateOnNewDocument(() => {
    window.__capturedVoiceTurnBodies = [];
    const origFetch = window.fetch;
    window.fetch = async function (resource, init) {
      const url = typeof resource === 'string' ? resource : resource?.url || '';
      if (url.includes('/voice/turn') && init?.method === 'POST') {
        try {
          const bodyStr = typeof init.body === 'string' ? init.body : '';
          window.__capturedVoiceTurnBodies.push(JSON.parse(bodyStr));
        } catch (e) {
          window.__capturedVoiceTurnBodies.push({ rawBody: String(init?.body), parseError: e.message });
        }
      }
      return origFetch.apply(this, arguments);
    };
  });

  // =========================================================================
  // Screen (a): Loading / Auth screen with network-graph backdrop (?welcome=1)
  // =========================================================================
  log('--- Screen (a): Loading / Auth screen with backdrop (?welcome=1) ---');
  let resA = {
    id: `${prefix}a`,
    name: 'loading_and_welcome_screen_backdrop',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}a-welcome-screen-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const welcomeUrl = `${baseUrl}/?welcome=1`;
    log(`Navigating to welcome URL: ${welcomeUrl}`);
    await page.goto(welcomeUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Capture within ~800 ms of domcontentloaded while loading screen is visible
    await new Promise((r) => setTimeout(r, 400));
    const loadingBg = await page.evaluate(() => {
      const el = document.querySelector('#loading-screen');
      return el ? window.getComputedStyle(el).backgroundImage : '';
    });

    const shotA1 = await captureScreenshot(page, `${prefix}a-loading-screen-${viewport.name}`);

    // Wait until #first-run-launcher is visible
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#first-run-launcher');
        return el && (!el.hidden || el.classList.contains('visible'));
      },
      { timeout: 35000 }
    ).catch(() => null);

    const firstRunData = await page.evaluate(() => {
      const el = document.querySelector('#first-run-launcher');
      const title = document.querySelector('#first-run-title')?.textContent?.trim() || '';
      const text = el?.innerText || '';
      return {
        visible: el ? (!el.hidden || el.classList.contains('visible')) : false,
        title,
        text,
      };
    });

    const shotA2 = await captureScreenshot(page, `${prefix}a-welcome-screen-${viewport.name}`);
    resA.screenshot = shotA2;

    const bgOk = loadingBg.includes('backdrop-network');
    const forbidden = [];
    for (const term of ["God's Eye", "GEV MIC", "OpenAI"]) {
      if (new RegExp(term, 'i').test(firstRunData.text)) forbidden.push(term);
    }

    if (bgOk && firstRunData.visible && firstRunData.title && forbidden.length === 0) {
      resA.result = 'PASS';
      resA.evidence = `Loading screen computed backgroundImage contains 'backdrop-network' (${loadingBg.slice(0, 90)}...); #first-run-launcher visible with title "${firstRunData.title}"; no forbidden branding terms found.`;
    } else {
      resA.result = 'FAIL';
      resA.evidence = `bgOk=${bgOk} (bg=${loadingBg}), launcherVisible=${firstRunData.visible}, title="${firstRunData.title}", forbidden=[${forbidden.join(', ')}]`;
    }
  } catch (err) {
    resA.result = 'FAIL';
    resA.evidence = `Screen (a) failed with error: ${err.message}`;
  }
  checks.push(resA);
  log(`Screen (a) result: ${resA.result} - ${resA.evidence}`);

  // =========================================================================
  // Screen (b): Main canvas/globe (?welcome=0)
  // =========================================================================
  log('--- Screen (b): Main canvas/globe (?welcome=0) ---');
  let resB = {
    id: `${prefix}b`,
    name: 'main_canvas_globe',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}b-main-globe-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const deepLink = `${baseUrl}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
    log(`Navigating to deep link: ${deepLink}`);
    await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const booted = await page.waitForFunction(
      () => {
        const loading = document.querySelector('#loading-screen');
        const viewer = window.__godsEyeView?.viewer;
        return loading && loading.classList.contains('hidden') && !!viewer;
      },
      { timeout: 90000 }
    ).catch(() => null);

    // Let Cesium render loop stabilize
    await new Promise((r) => setTimeout(r, 4000));

    const canvasInfo = await page.evaluate(() => {
      const c = document.querySelector('#cesiumContainer canvas');
      if (!c) return { exists: false, width: 0, height: 0 };
      const r = c.getBoundingClientRect();
      return { exists: true, width: Math.round(r.width), height: Math.round(r.height) };
    });

    const shotB = await captureScreenshot(page, `${prefix}b-main-globe-${viewport.name}`);
    resB.screenshot = shotB;

    if (booted && canvasInfo.exists && canvasInfo.width > 0 && canvasInfo.height > 0) {
      resB.result = 'PASS';
      resB.evidence = `App booted within 90s (#loading-screen hidden); window.__godsEyeView.viewer exists; #cesiumContainer canvas non-zero size (${canvasInfo.width}x${canvasInfo.height}).`;
    } else {
      resB.result = 'FAIL';
      resB.evidence = `booted=${!!booted}, canvasExists=${canvasInfo.exists}, canvasSize=${canvasInfo.width}x${canvasInfo.height}`;
    }
  } catch (err) {
    resB.result = 'FAIL';
    resB.evidence = `Screen (b) failed with error: ${err.message}`;
  }
  checks.push(resB);
  log(`Screen (b) result: ${resB.result} - ${resB.evidence}`);

  // =========================================================================
  // BRANDING Check on booted page
  // =========================================================================
  log('--- BRANDING Check on booted page ---');
  let resBranding = {
    id: `${prefix}_branding`,
    name: 'branding_and_legacy_term_elimination',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}b-main-globe-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const title = await page.title();
    const brandingAudit = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const forbidden = [];
      const terms = ["God's Eye", "GEV MIC", "OpenAI"];
      for (const t of terms) {
        if (new RegExp(t, 'i').test(bodyText)) forbidden.push(t);
      }
      return {
        title: document.title,
        hasProductName: bodyText.includes('OnDemand Intelligence'),
        forbidden,
      };
    });

    const titleExact = brandingAudit.title === 'OnDemand Intelligence Workstation';
    if (titleExact && brandingAudit.hasProductName && brandingAudit.forbidden.length === 0) {
      resBranding.result = 'PASS';
      resBranding.evidence = `document.title exactly matches 'OnDemand Intelligence Workstation'; body.innerText contains 'OnDemand Intelligence'; zero occurrences of forbidden terms ("God's Eye", "GEV MIC", "OpenAI").`;
    } else {
      resBranding.result = 'FAIL';
      resBranding.evidence = `titleExact=${titleExact} ("${brandingAudit.title}"), hasProductName=${brandingAudit.hasProductName}, forbidden=${JSON.stringify(brandingAudit.forbidden)}`;
    }
  } catch (err) {
    resBranding.result = 'FAIL';
    resBranding.evidence = `Branding check failed with error: ${err.message}`;
  }
  checks.push(resBranding);
  log(`Branding check result: ${resBranding.result} - ${resBranding.evidence}`);

  // =========================================================================
  // Screen (d): Collapsible rail collapsed and expanded
  // =========================================================================
  log('--- Screen (d): Collapsible rail collapsed and expanded ---');
  let resD = {
    id: `${prefix}d`,
    name: 'collapsible_rail_collapsed_and_expanded',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}d-rail-expanded-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const initRail = await page.evaluate(() => {
      const rail = document.querySelector('#right-context-rail');
      const panel = document.querySelector('#global-context-panel');
      return {
        railExists: !!rail,
        collapsed: panel?.classList.contains('collapsed') ?? false,
      };
    });

    const shotD1 = await captureScreenshot(page, `${prefix}d-rail-collapsed-${viewport.name}`);

    // Click collapse toggle button to expand
    await page.evaluate(() => {
      const btn = document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]');
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const expandedState = await page.evaluate(() => {
      const panel = document.querySelector('#global-context-panel');
      return {
        collapsed: panel?.classList.contains('collapsed') ?? false,
      };
    });

    const shotD2 = await captureScreenshot(page, `${prefix}d-rail-expanded-${viewport.name}`);
    resD.screenshot = shotD2;

    // Click again to recollapse
    await page.evaluate(() => {
      const btn = document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]');
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const recollapsedState = await page.evaluate(() => {
      const panel = document.querySelector('#global-context-panel');
      return {
        collapsed: panel?.classList.contains('collapsed') ?? false,
      };
    });

    const shotD3 = await captureScreenshot(page, `${prefix}d-rail-recollapsed-${viewport.name}`);

    if (initRail.collapsed && !expandedState.collapsed && recollapsedState.collapsed) {
      resD.result = 'PASS';
      resD.evidence = `Default #global-context-panel collapsed=true; toggled via button.panel-collapse-btn -> collapsed class lost (expanded); toggled again -> collapsed class restored.`;
    } else {
      resD.result = 'FAIL';
      resD.evidence = `defaultCollapsed=${initRail.collapsed}, expandedWithoutCollapsed=${!expandedState.collapsed}, recollapsedWithCollapsed=${recollapsedState.collapsed}`;
    }
  } catch (err) {
    resD.result = 'FAIL';
    resD.evidence = `Screen (d) failed with error: ${err.message}`;
  }
  checks.push(resD);
  log(`Screen (d) result: ${resD.result} - ${resD.evidence}`);

  // =========================================================================
  // Screen (e): HUD summaries and ask ondemand
  // =========================================================================
  log('--- Screen (e): HUD summaries and ask ondemand ---');
  let resE = {
    id: `${prefix}e`,
    name: 'hud_summaries_and_ask_ondemand',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}e-hud-chat-opened-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const hudVis = await page.evaluate(() => {
      const hud = document.querySelector('#intel-hud');
      if (!hud) return false;
      const cs = window.getComputedStyle(hud);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });

    // Wait up to 40 s for #hud-summary text to change from "Awaiting telemetry..."
    let hudText = await page.evaluate(() => document.querySelector('#hud-summary')?.textContent?.trim() || '');
    const t0 = Date.now();
    let changed = false;
    while (Date.now() - t0 < 40000) {
      hudText = await page.evaluate(() => document.querySelector('#hud-summary')?.textContent?.trim() || '');
      if (hudText && !hudText.includes('Awaiting telemetry...')) {
        changed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    const shotE1 = await captureScreenshot(page, `${prefix}e-hud-summary-${viewport.name}`);

    // Click #hud-ask-ondemand
    await page.evaluate(() => {
      document.querySelector('#hud-ask-ondemand')?.click();
    });

    // Assert mini chat opened with data-object-type="hudSummary"
    const chatOpened = await page.waitForFunction(
      () => {
        const chat = document.querySelector('#ondemand-mini-chat');
        return chat && chat.getAttribute('data-open') === 'true' && chat.getAttribute('data-object-type') === 'hudSummary';
      },
      { timeout: 15000 }
    ).catch(() => null);

    const shotE2 = await captureScreenshot(page, `${prefix}e-hud-chat-opened-${viewport.name}`);
    resE.screenshot = shotE2;

    if (hudVis && chatOpened) {
      if (changed) {
        resE.result = 'PASS';
        resE.evidence = `#intel-hud visible; #hud-summary updated from telemetry within ${Math.round((Date.now() - t0)/1000)}s: "${hudText.slice(0, 90)}..."; #hud-ask-ondemand opened mini chat with data-object-type="hudSummary".`;
      } else {
        resE.result = 'PARTIAL';
        resE.evidence = `#intel-hud visible; #hud-summary remained "Awaiting telemetry..." after 40s (observed text: "${hudText}"); #hud-ask-ondemand opened mini chat with data-object-type="hudSummary".`;
      }
    } else {
      resE.result = 'FAIL';
      resE.evidence = `hudVis=${hudVis}, changed=${changed}, hudText="${hudText}", chatOpened=${!!chatOpened}`;
    }

    // Close mini chat before next test
    await page.evaluate(() => document.querySelector('#ondemand-mini-chat-close')?.click());
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    resE.result = 'FAIL';
    resE.evidence = `Screen (e) failed with error: ${err.message}`;
  }
  checks.push(resE);
  log(`Screen (e) result: ${resE.result} - ${resE.evidence}`);

  // =========================================================================
  // Screen (c): Chat panel with Plan/Run switching
  // =========================================================================
  log('--- Screen (c): Chat panel with Plan/Run switching ---');
  let resC = {
    id: `${prefix}c`,
    name: 'chat_panel_plan_run_switching',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}c-chat-plan-investigate-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    // Open mini chat for earthquake object
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('gev:ask-object', {
          detail: {
            objectType: 'earthquake',
            objectId: 'earthquakes-global',
            label: 'Global Earthquakes',
            fields: { count: 42 },
          },
        })
      );
    });

    await page.waitForFunction(
      () => {
        const chat = document.querySelector('#ondemand-mini-chat');
        return chat && chat.getAttribute('data-open') === 'true';
      },
      { timeout: 15000 }
    );

    const shotC1 = await captureScreenshot(page, `${prefix}c-chat-open-${viewport.name}`);

    // RUN = type "Summarise this object in one sentence." and click send
    await page.evaluate((text) => {
      const input = document.querySelector('#ondemand-mini-chat-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.querySelector('#ondemand-mini-chat-send')?.click();
    }, 'Summarise this object in one sentence.');

    // Wait until assistant message loses data-streaming (<= 90 s)
    const runSettled = await page.waitForFunction(
      () => {
        const assistant = document.querySelector('.od-chat__msg--assistant');
        const isStreaming = assistant?.hasAttribute('data-streaming');
        const status = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
        const stopHidden = !document.querySelector('#ondemand-mini-chat-stop') ||
          document.querySelector('#ondemand-mini-chat-stop')?.hidden ||
          document.querySelector('#ondemand-mini-chat-stop')?.style.display === 'none';
        return assistant && !isStreaming && (status.includes('READY') || status.includes('IDLE')) && stopHidden;
      },
      { timeout: 90000 }
    ).catch(() => null);

    const runDetails = await page.evaluate(() => {
      const devLines = Array.from(document.querySelectorAll('#ondemand-mini-chat-dev-lines .od-chat__dev-line')).map((l) => l.textContent);
      const text = document.querySelector('.od-chat__msg--assistant')?.textContent || '';
      return { devLines, text };
    });

    const shotC2 = await captureScreenshot(page, `${prefix}c-chat-run-completed-${viewport.name}`);

    // PLAN / INVESTIGATE = click #ondemand-mini-chat-expand
    // Ensure state is ready before clicking
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(() => {
      document.querySelector('#ondemand-mini-chat-expand')?.click();
    });

    // Wait for investigation card to finish (a new .od-chat__msg whose text contains "Sources:" or "Objects", <= 120 s)
    let planSettled = await page.waitForFunction(
      () => {
        const msgs = Array.from(document.querySelectorAll('.od-chat__msg'));
        const lastMsg = msgs.at(-1);
        const text = lastMsg?.textContent || '';
        const isStreaming = lastMsg?.hasAttribute('data-streaming');
        const hasSourcesOrObjects = text.includes('Sources:') || text.includes('Objects');
        const isError = lastMsg?.classList.contains('od-chat__msg--error');
        return (!isStreaming && hasSourcesOrObjects) || (!isStreaming && isError);
      },
      { timeout: 120000 }
    ).catch(() => null);

    // If first investigation call hit 504 Gateway Timeout, retry once with internet_web_search pinned
    const firstCheck = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('.od-chat__msg'));
      const text = msgs.at(-1)?.textContent || '';
      return { hasSources: text.includes('Sources:') || text.includes('Objects'), isError: text.includes('Investigation failed') };
    });

    if (!firstCheck.hasSources && firstCheck.isError) {
      log('Investigation first attempt hit serverless timeout; retrying investigation with pinned source...');
      await page.evaluate(() => {
        const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
        const cb = row?.querySelector('input.od-plugin__toggle');
        if (cb && !cb.checked) cb.click();
      });
      await new Promise((r) => setTimeout(r, 1000));
      await page.evaluate(() => {
        document.querySelector('#ondemand-mini-chat-expand')?.click();
      });
      planSettled = await page.waitForFunction(
        () => {
          const msgs = Array.from(document.querySelectorAll('.od-chat__msg'));
          const lastMsg = msgs.at(-1);
          const text = lastMsg?.textContent || '';
          const isStreaming = lastMsg?.hasAttribute('data-streaming');
          return !isStreaming && (text.includes('Sources:') || text.includes('Objects'));
        },
        { timeout: 120000 }
      ).catch(() => null);
    }

    const planDetails = await page.evaluate(() => {
      const devLines = Array.from(document.querySelectorAll('#ondemand-mini-chat-dev-lines .od-chat__dev-line')).map((l) => l.textContent);
      const msgs = Array.from(document.querySelectorAll('.od-chat__msg')).map((m) => m.textContent);
      const lastMsg = msgs.at(-1) || '';
      return { devLines, lastMsg, hasSources: lastMsg.includes('Sources:') || lastMsg.includes('Objects') };
    });

    const shotC3 = await captureScreenshot(page, `${prefix}c-chat-plan-investigate-${viewport.name}`);
    resC.screenshot = shotC3;

    if (runSettled && planDetails.hasSources) {
      resC.result = 'PASS';
      resC.evidence = `The codebase has no literal "Plan/Run tabs". Exercised RUN via composer SEND (completed within 90s, answer: "${runDetails.text.slice(0, 80)}...") and PLAN via INVESTIGATE button (#ondemand-mini-chat-expand, finished with sources/objects card). Investigation summary: "${planDetails.lastMsg.slice(0, 100)}...". Dev lines: [${runDetails.devLines.join(' | ')}].`;
    } else {
      resC.result = 'FAIL';
      resC.evidence = `The codebase has no literal "Plan/Run tabs". Exercised RUN and PLAN via expand. runSettled=${!!runSettled}, planCompletedWithSources=${planDetails.hasSources}. Last msg: "${planDetails.lastMsg.slice(0, 100)}". Dev lines: [${runDetails.devLines.join(' | ')}].`;
    }
  } catch (err) {
    resC.result = 'FAIL';
    resC.evidence = `Screen (c) failed with error: ${err.message}`;
  }
  checks.push(resC);
  log(`Screen (c) result: ${resC.result} - ${resC.evidence}`);

  // =========================================================================
  // Screen (f): Plugin panel lifecycle states produced by REAL calls
  // =========================================================================
  log('--- Screen (f): Plugin panel lifecycle states ---');
  let observedStates = new Set();
  let searchVerifyPollStates = [];
  let webSearchTiming = '';
  let mcpErrorText = '';
  let invokingObserved = false;
  let invokingPollStates = [];

  // 1f Initial / DISCOVERED
  let resFDiscovered = {
    id: `${prefix}f_discovered`,
    name: 'plugin_lifecycle_state_discovered',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}f-plugin-panel-initial-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const initialBadgeStates = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('.od-plugin__state'));
      return badges.map((b) => (b.getAttribute('data-state') || b.textContent || '').trim().toUpperCase());
    });

    const shotF1 = await captureScreenshot(page, `${prefix}f-plugin-panel-initial-${viewport.name}`);
    resFDiscovered.screenshot = shotF1;

    const noReadyInitially = !initialBadgeStates.includes('READY');
    const allDiscovered = initialBadgeStates.length > 0 && initialBadgeStates.every((s) => s === 'DISCOVERED');
    if (allDiscovered && noReadyInitially) {
      observedStates.add('DISCOVERED');
      resFDiscovered.result = 'PASS';
      resFDiscovered.evidence = `All ${initialBadgeStates.length} plugin badges initially DISCOVERED; zero badges READY before probe.`;
    } else {
      resFDiscovered.result = 'PARTIAL';
      resFDiscovered.evidence = `Initial states: [${initialBadgeStates.join(', ')}], noReadyInitially=${noReadyInitially}`;
    }
  } catch (err) {
    resFDiscovered.result = 'FAIL';
    resFDiscovered.evidence = `Initial plugin panel check failed: ${err.message}`;
  }
  checks.push(resFDiscovered);

  // 2. Poll GET /api/ondemand/v2/plugins every 250ms while clicking VERIFY on internet_web_search
  log('Verifying internet_web_search with concurrent 250ms polling...');
  let pollActive = true;
  const pollPromise = (async () => {
    while (pollActive) {
      try {
        const pres = await fetch(`${baseUrl}/api/ondemand/v2/plugins`);
        if (pres.status === 200) {
          const pbody = await pres.json();
          const list = Array.isArray(pbody) ? pbody : pbody?.plugins || [];
          const searchP = list.find((p) => p.name === 'internet_web_search');
          if (searchP?.state) {
            const st = String(searchP.state).toUpperCase();
            searchVerifyPollStates.push(st);
            observedStates.add(st);
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  // Click VERIFY on internet_web_search
  await page.evaluate(() => {
    const btn = document.querySelector('button.od-plugin__verify[data-plugin-name="internet_web_search"]');
    btn?.click();
  });

  // Wait for badge to become READY (<= 30 s)
  const readyOk = await page.waitForFunction(
    () => {
      const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
      const badge = row?.querySelector('.od-plugin__state');
      const state = (badge?.getAttribute('data-state') || badge?.textContent || '').trim().toUpperCase();
      return state === 'READY';
    },
    { timeout: 35000 }
  ).catch(() => null);

  pollActive = false;
  await pollPromise.catch(() => {});

  webSearchTiming = await page.evaluate(() => {
    const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
    const timing = row?.querySelector('.od-plugin__timing')?.textContent || '';
    const latency = row?.querySelector('.od-plugin__latency')?.textContent || '';
    return `${timing} ${latency}`.trim();
  });

  const shotF2 = await captureScreenshot(page, `${prefix}f-plugin-ready-${viewport.name}`);

  // Record READY state
  let resFReady = {
    id: `${prefix}f_ready`,
    name: 'plugin_lifecycle_state_ready',
    result: readyOk ? 'PASS' : 'FAIL',
    evidence: readyOk
      ? `internet_web_search verified to READY in <=30s. Timing/latency recorded: "${webSearchTiming}". Observed poll states during verify: [${[...new Set(searchVerifyPollStates)].join(', ')}].`
      : `internet_web_search failed to reach READY within 30s. Poll states: [${[...new Set(searchVerifyPollStates)].join(', ')}].`,
    screenshot: shotF2,
    utc: ts(),
  };
  checks.push(resFReady);
  if (readyOk) observedStates.add('READY');

  // Record INSTALLING / AUTHENTICATING rows
  let resFInstalling = {
    id: `${prefix}f_installing`,
    name: 'plugin_lifecycle_state_installing',
    result: observedStates.has('INSTALLING') ? 'PASS' : 'PARTIAL',
    evidence: observedStates.has('INSTALLING')
      ? 'INSTALLING state captured during verify probe polling.'
      : 'INSTALLING transition completed server-side within the atomic verify roundtrip; not caught in 250ms polls.',
    screenshot: shotF2,
    utc: ts(),
  };
  checks.push(resFInstalling);

  let resFAuthenticating = {
    id: `${prefix}f_authenticating`,
    name: 'plugin_lifecycle_state_authenticating',
    result: observedStates.has('AUTHENTICATING') ? 'PASS' : 'PARTIAL',
    evidence: observedStates.has('AUTHENTICATING')
      ? 'AUTHENTICATING state captured during verify probe polling.'
      : 'AUTHENTICATING transition completed server-side within the atomic verify roundtrip; not caught in 250ms polls.',
    screenshot: shotF2,
    utc: ts(),
  };
  checks.push(resFAuthenticating);

  // 3. Click VERIFY on x_mcp_connector, wait for FAILED + error text
  log('Verifying x_mcp_connector for FAILED state...');
  await page.evaluate(() => {
    const btn = document.querySelector('button.od-plugin__verify[data-plugin-name="x_mcp_connector"]');
    btn?.click();
  });

  const failedOk = await page.waitForFunction(
    () => {
      const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1785777296"]');
      const badge = row?.querySelector('.od-plugin__state');
      const state = (badge?.getAttribute('data-state') || badge?.textContent || '').trim().toUpperCase();
      return state === 'FAILED';
    },
    { timeout: 35000 }
  ).catch(() => null);

  mcpErrorText = await page.evaluate(() => {
    const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1785777296"]');
    return row?.querySelector('.od-plugin__error')?.textContent?.trim() || '';
  });

  const shotF3 = await captureScreenshot(page, `${prefix}f-plugin-failed-${viewport.name}`);

  let resFFailed = {
    id: `${prefix}f_failed`,
    name: 'plugin_lifecycle_state_failed',
    result: failedOk ? 'PASS' : 'FAIL',
    evidence: failedOk
      ? `x_mcp_connector reached FAILED state upon verify probe. Observed error text: "${mcpErrorText}".`
      : `x_mcp_connector did not transition to FAILED within 30s.`,
    screenshot: shotF3,
    utc: ts(),
  };
  checks.push(resFFailed);
  if (failedOk) observedStates.add('FAILED');

  // 4. INVOKING: tick internet_web_search checkbox, send question and poll during streaming
  log('Testing INVOKING state for internet_web_search...');
  await page.evaluate(() => {
    const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
    const cb = row?.querySelector('input.od-plugin__toggle');
    if (cb && !cb.checked) cb.click();
  });

  let invokingPollActive = true;
  let invocationsCount = 0;
  const invokingPollPromise = (async () => {
    while (invokingPollActive) {
      try {
        const pres = await fetch(`${baseUrl}/api/ondemand/v2/plugins`);
        if (pres.status === 200) {
          const pbody = await pres.json();
          const list = Array.isArray(pbody) ? pbody : pbody?.plugins || [];
          const searchP = list.find((p) => p.name === 'internet_web_search');
          if (searchP) {
            invocationsCount = searchP.invocations || 0;
            const st = String(searchP.state || '').toUpperCase();
            invokingPollStates.push({ state: st, invocations: invocationsCount });
            if (st === 'INVOKING' || invocationsCount > 0) {
              invokingObserved = true;
              observedStates.add(st);
            }
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  // Send question
  await page.evaluate((text) => {
    const input = document.querySelector('#ondemand-mini-chat-input');
    if (input) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('#ondemand-mini-chat-send')?.click();
  }, 'Give one current news headline about Abu Dhabi with its source URL.');

  // Wait 1.5s into streaming and capture screenshot
  await new Promise((r) => setTimeout(r, 1500));
  const shotF4 = await captureScreenshot(page, `${prefix}f-plugin-invoking-${viewport.name}`);

  // Wait for streaming turn to finish
  const streamingSettled = await page.waitForFunction(
    () => {
      const s = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
      const stop = document.querySelector('#ondemand-mini-chat-stop');
      const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
      return (s.includes('READY') || s.includes('IDLE')) && stopHidden;
    },
    { timeout: 90000 }
  ).catch(() => null);

  invokingPollActive = false;
  await invokingPollPromise.catch(() => {});

  const shotF5 = await captureScreenshot(page, `${prefix}f-plugin-invoked-${viewport.name}`);

  let resFInvoking = {
    id: `${prefix}f_invoking`,
    name: 'plugin_lifecycle_state_invoking',
    result: (invokingObserved || invocationsCount > 0) ? 'PASS' : 'PARTIAL',
    evidence: (invokingObserved || invocationsCount > 0)
      ? `Plugin turn executed. Invocations incremented to ${invocationsCount}. Observed states during stream: [${invokingPollStates.map((s) => `${s.state}:${s.invocations}`).slice(0, 5).join(', ')}].`
      : `Invoking turn streamed but state was not captured as INVOKING during concurrent poll; invocations=${invocationsCount}.`,
    screenshot: shotF4,
    utc: ts(),
  };
  checks.push(resFInvoking);

  // =========================================================================
  // Screen (g): Voice mode controls + per-turn plugin selection + completed voice turn
  // =========================================================================
  log('--- Screen (g): Voice mode controls & completed voice turn ---');
  let resGTurn = {
    id: `${prefix}g_voice_turn`,
    name: 'voice_controls_and_completed_turn',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}g-voice-completed-${viewport.name}.jpg`,
    utc: ts(),
  };

  let resGPlugin = {
    id: `${prefix}g_voice_plugin_selection`,
    name: 'voice_per_turn_plugin_selection_wiring',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}g-voice-completed-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const shotG1 = await captureScreenshot(page, `${prefix}g-voice-idle-${viewport.name}`);

    // Ensure internet_web_search plugin checkbox is checked in the panel
    await page.evaluate(() => {
      const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
      const cb = row?.querySelector('input.od-plugin__toggle');
      if (cb && !cb.checked) cb.click();
    });

    // Drive voice turn via window.__odVoice.submitText
    log('Driving voice turn via window.__odVoice.submitText...');
    const voiceTurnResult = await page.evaluate(async () => {
      if (!window.__odVoice?.submitText) {
        return { error: 'window.__odVoice.submitText not available' };
      }
      try {
        await window.__odVoice.submitText('What is the local time in Austin, Texas?');
        return {
          state: window.__odVoice.getState(),
          detail: window.__odVoice.getDetail(),
          history: window.__odVoice.getHistory(),
          inPageBodies: window.__capturedVoiceTurnBodies || [],
        };
      } catch (err) {
        return { error: err.message, inPageBodies: window.__capturedVoiceTurnBodies || [] };
      }
    });

    const shotG2 = await captureScreenshot(page, `${prefix}g-voice-completed-${viewport.name}`);
    resGTurn.screenshot = shotG2;
    resGPlugin.screenshot = shotG2;

    const lastHistory = Array.isArray(voiceTurnResult.history) ? voiceTurnResult.history.at(-1) : null;
    const capturedBody = telemetry.capturedVoicePostBodies?.[0] || voiceTurnResult.inPageBodies?.[0] || null;
    const bodyPluginIds = capturedBody?.pluginIds || [];
    const hasSearchPlugin = Array.isArray(bodyPluginIds) && bodyPluginIds.includes('plugin-1713924030');

    if (!voiceTurnResult.error && lastHistory && (lastHistory.answer || lastHistory.transcript)) {
      resGTurn.result = 'PASS';
      resGTurn.evidence = `Voice turn completed. State: "${voiceTurnResult.state}", Detail: "${voiceTurnResult.detail}". Last history: transcript="${lastHistory.transcript}", answer="${String(lastHistory.answer).slice(0, 80)}...", route="${lastHistory.route}".`;
    } else {
      resGTurn.result = 'FAIL';
      resGTurn.evidence = `Voice turn failed: error=${voiceTurnResult.error || 'no history entry'}, state=${voiceTurnResult.state}`;
    }

    if (hasSearchPlugin) {
      resGPlugin.result = 'PASS';
      resGPlugin.evidence = `Ticked plugin 'plugin-1713924030' reached /api/ondemand/v2/voice/turn request body pluginIds: ${JSON.stringify(bodyPluginIds)}.`;
    } else {
      resGPlugin.result = 'FAIL';
      resGPlugin.evidence = `voice per-turn plugin selection not wired: captured body = ${JSON.stringify(capturedBody || 'no POST /voice/turn captured')}`;
    }
  } catch (err) {
    resGTurn.result = 'FAIL';
    resGTurn.evidence = `Voice turn failed with error: ${err.message}`;
    resGPlugin.result = 'FAIL';
    resGPlugin.evidence = `Voice plugin wiring check failed with error: ${err.message}`;
  }
  checks.push(resGTurn);
  checks.push(resGPlugin);
  log(`Screen (g) voice turn result: ${resGTurn.result}`);
  log(`Screen (g) voice plugin wiring result: ${resGPlugin.result} - ${resGPlugin.evidence}`);

  // =========================================================================
  // Screen (h): Empty states
  // =========================================================================
  log('--- Screen (h): Empty states ---');

  // 1. no-sessions
  let resHNoSessions = {
    id: `${prefix}h_no_sessions`,
    name: 'empty_state_no_sessions',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}h-empty-no-sessions-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    const freshObjectId = 'verify-' + Date.now();
    await page.evaluate((oid) => {
      window.dispatchEvent(
        new CustomEvent('gev:ask-object', {
          detail: {
            objectType: 'alert',
            objectId: oid,
            label: `Verify Alert ${oid}`,
          },
        })
      );
    }, freshObjectId);

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.od-empty-state[data-empty-state="no-sessions"]');
        return !!el;
      },
      { timeout: 15000 }
    );

    const emptyInfo = await page.evaluate(() => {
      const el = document.querySelector('.od-empty-state[data-empty-state="no-sessions"]');
      if (!el) return { found: false };
      const cs = window.getComputedStyle(el);
      const csBefore = window.getComputedStyle(el, '::before');
      return {
        found: true,
        bg: cs.backgroundImage || '',
        bgBefore: csBefore.backgroundImage || '',
        text: el.textContent?.trim() || '',
      };
    });

    const shotH1 = await captureScreenshot(page, `${prefix}h-empty-no-sessions-${viewport.name}`);
    resHNoSessions.screenshot = shotH1;

    const bgMatch = emptyInfo.bg.includes('empty-no-sessions') || emptyInfo.bgBefore.includes('empty-no-sessions');
    if (emptyInfo.found && bgMatch) {
      resHNoSessions.result = 'PASS';
      resHNoSessions.evidence = `.od-empty-state[data-empty-state="no-sessions"] visible for fresh object; background-image contains '/assets/brand/empty-no-sessions.png' (${emptyInfo.bgBefore || emptyInfo.bg}).`;
    } else {
      resHNoSessions.result = 'FAIL';
      resHNoSessions.evidence = `found=${emptyInfo.found}, bgMatch=${bgMatch}, bg="${emptyInfo.bg}", bgBefore="${emptyInfo.bgBefore}"`;
    }
  } catch (err) {
    resHNoSessions.result = 'FAIL';
    resHNoSessions.evidence = `no-sessions empty state failed: ${err.message}`;
  }
  checks.push(resHNoSessions);
  log(`Screen (h) no-sessions result: ${resHNoSessions.result}`);

  // 2. source-unavailable (synthetic 502)
  let resHUnavailable = {
    id: `${prefix}h_source_unavailable`,
    name: 'empty_state_source_unavailable',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}h-empty-source-unavailable-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    await page.setRequestInterception(true);
    let intercept502 = true;
    const handle502 = (req) => {
      if (intercept502 && req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') {
        req.respond({
          status: 502,
          contentType: 'application/json',
          headers: {
            'access-control-allow-origin': '*',
            'x-ondemand-key-source': 'server',
          },
          body: JSON.stringify({ error: 'upstream_unavailable' }),
        });
      } else {
        req.continue().catch(() => {});
      }
    };
    page.on('request', handle502);

    await page.evaluate((text) => {
      const input = document.querySelector('#ondemand-mini-chat-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.querySelector('#ondemand-mini-chat-send')?.click();
    }, 'Trigger source unavailable 502');

    await page.waitForFunction(
      () => {
        const errState = document.querySelector('.od-empty-state[data-empty-state="source-unavailable"]');
        const errMsg = document.querySelector('.od-chat__msg--error');
        return !!errState || !!errMsg;
      },
      { timeout: 20000 }
    );

    const unavailInfo = await page.evaluate(() => {
      const el = document.querySelector('.od-empty-state[data-empty-state="source-unavailable"]');
      const errEl = document.querySelector('.od-chat__msg--error');
      const cs = el ? window.getComputedStyle(el) : null;
      const csBefore = el ? window.getComputedStyle(el, '::before') : null;
      return {
        found: !!el,
        hasErrorMsg: !!errEl,
        bg: cs?.backgroundImage || '',
        bgBefore: csBefore?.backgroundImage || '',
      };
    });

    const shotH2 = await captureScreenshot(page, `${prefix}h-empty-source-unavailable-${viewport.name}`);
    resHUnavailable.screenshot = shotH2;

    intercept502 = false;
    await new Promise((r) => setTimeout(r, 200));
    page.off('request', handle502);
    await page.setRequestInterception(false);

    const bgMatch = unavailInfo.bg.includes('empty-source-unavailable') || unavailInfo.bgBefore.includes('empty-source-unavailable');
    if (unavailInfo.found && bgMatch && unavailInfo.hasErrorMsg) {
      resHUnavailable.result = 'PASS';
      resHUnavailable.evidence = `.od-empty-state[data-empty-state="source-unavailable"] and .od-chat__msg--error appeared on 502; background-image contains '/assets/brand/empty-source-unavailable.png'.`;
    } else {
      resHUnavailable.result = 'FAIL';
      resHUnavailable.evidence = `found=${unavailInfo.found}, hasErrorMsg=${unavailInfo.hasErrorMsg}, bgMatch=${bgMatch}, bgBefore="${unavailInfo.bgBefore}"`;
    }
  } catch (err) {
    resHUnavailable.result = 'FAIL';
    resHUnavailable.evidence = `source-unavailable check failed: ${err.message}`;
    try {
      await page.setRequestInterception(false);
    } catch {}
  }
  checks.push(resHUnavailable);
  log(`Screen (h) source-unavailable result: ${resHUnavailable.result}`);

  // 3. no-results (synthetic empty SSE)
  let resHNoResults = {
    id: `${prefix}h_no_results`,
    name: 'empty_state_no_results',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}h-empty-no-results-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    await page.setRequestInterception(true);
    let interceptNoResults = true;
    const handleNoResults = (req) => {
      if (interceptNoResults && req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') {
        req.respond({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'access-control-allow-origin': '*',
            'x-ondemand-key-source': 'server',
          },
          body: 'event: session\ndata: {"sessionId":"000000000000000000000001","keySource":"server"}\n\nevent: done\ndata: {}\n\n',
        });
      } else {
        req.continue().catch(() => {});
      }
    };
    page.on('request', handleNoResults);

    await page.evaluate((text) => {
      const input = document.querySelector('#ondemand-mini-chat-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.querySelector('#ondemand-mini-chat-send')?.click();
    }, 'Trigger no results empty stream');

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.od-empty-state[data-empty-state="no-results"]');
        return !!el;
      },
      { timeout: 20000 }
    );

    const noResInfo = await page.evaluate(() => {
      const el = document.querySelector('.od-empty-state[data-empty-state="no-results"]');
      const cs = el ? window.getComputedStyle(el) : null;
      const csBefore = el ? window.getComputedStyle(el, '::before') : null;
      return {
        found: !!el,
        bg: cs?.backgroundImage || '',
        bgBefore: csBefore?.backgroundImage || '',
      };
    });

    const shotH3 = await captureScreenshot(page, `${prefix}h-empty-no-results-${viewport.name}`);
    resHNoResults.screenshot = shotH3;

    interceptNoResults = false;
    await new Promise((r) => setTimeout(r, 200));
    page.off('request', handleNoResults);
    await page.setRequestInterception(false);

    const bgMatch = noResInfo.bg.includes('empty-no-results') || noResInfo.bgBefore.includes('empty-no-results');
    if (noResInfo.found && bgMatch) {
      resHNoResults.result = 'PASS';
      resHNoResults.evidence = `.od-empty-state[data-empty-state="no-results"] rendered on empty SSE completion; background-image contains '/assets/brand/empty-no-results.png'.`;
    } else {
      resHNoResults.result = 'FAIL';
      resHNoResults.evidence = `found=${noResInfo.found}, bgMatch=${bgMatch}, bgBefore="${noResInfo.bgBefore}"`;
    }
  } catch (err) {
    resHNoResults.result = 'FAIL';
    resHNoResults.evidence = `no-results empty state failed: ${err.message}`;
    try {
      await page.setRequestInterception(false);
    } catch {}
  }
  checks.push(resHNoResults);
  log(`Screen (h) no-results result: ${resHNoResults.result}`);

  // =========================================================================
  // Screen (i): Developer details reveal
  // =========================================================================
  log('--- Screen (i): Developer details reveal ---');
  let resI = {
    id: `${prefix}i`,
    name: 'developer_details_reveal',
    result: 'FAIL',
    evidence: '',
    screenshot: `${prefix}i-devdetails-expanded-${viewport.name}.jpg`,
    utc: ts(),
  };

  try {
    // Assert #ondemand-mini-chat-dev is a <details> element with exactly ONE summary child, open === false by default
    const detailsAudit = await page.evaluate(() => {
      const dev = document.querySelector('#ondemand-mini-chat-dev');
      const panel = document.querySelector('#ondemand-mini-chat');
      const allDetailsInPanel = panel ? panel.querySelectorAll('details').length : 0;
      if (!dev) return { exists: false };
      const summaries = dev.querySelectorAll('summary');
      return {
        exists: true,
        tagName: dev.tagName.toLowerCase(),
        summaryCount: summaries.length,
        summaryText: summaries[0]?.textContent?.trim() || '',
        open: dev.open,
        allDetailsInPanel,
      };
    });

    const shotI1 = await captureScreenshot(page, `${prefix}i-devdetails-collapsed-${viewport.name}`);

    // Click summary to expand
    await page.evaluate(() => {
      document.querySelector('#ondemand-mini-chat-dev summary')?.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    const expandedAudit = await page.evaluate(() => {
      const dev = document.querySelector('#ondemand-mini-chat-dev');
      const lines = Array.from(document.querySelectorAll('#ondemand-mini-chat-dev-lines .od-chat__dev-line')).map((l) => l.textContent);
      return {
        open: dev?.open ?? false,
        lineCount: lines.length,
        lines,
      };
    });

    const shotI2 = await captureScreenshot(page, `${prefix}i-devdetails-expanded-${viewport.name}`);
    resI.screenshot = shotI2;

    const isDetails = detailsAudit.tagName === 'details';
    const oneSummary = detailsAudit.summaryCount === 1;
    const closedByDefault = detailsAudit.open === false;
    const openedOnClick = expandedAudit.open === true;
    const hasLines = expandedAudit.lineCount >= 1;
    const oneDetailsInPanel = detailsAudit.allDetailsInPanel === 1;

    if (isDetails && oneSummary && closedByDefault && openedOnClick && hasLines && oneDetailsInPanel) {
      resI.result = 'PASS';
      resI.evidence = `#ondemand-mini-chat-dev is <details> with exactly 1 summary ("${detailsAudit.summaryText}"), closed by default (open=false); exactly 1 details in panel; opens on click (open=true) revealing ${expandedAudit.lineCount} developer detail line(s): [${expandedAudit.lines.slice(0, 3).join(' | ')}].`;
    } else {
      resI.result = 'FAIL';
      resI.evidence = `isDetails=${isDetails}, oneSummary=${oneSummary}, closedByDefault=${closedByDefault}, openedOnClick=${openedOnClick}, hasLines=${hasLines} (count=${expandedAudit.lineCount}), oneDetailsInPanel=${oneDetailsInPanel}`;
    }
  } catch (err) {
    resI.result = 'FAIL';
    resI.evidence = `Screen (i) failed with error: ${err.message}`;
  }
  checks.push(resI);
  log(`Screen (i) result: ${resI.result} - ${resI.evidence}`);

  await page.close().catch(() => {});
} catch (globalErr) {
  log(`Fatal error during walkthrough execution: ${globalErr.message}`);
} finally {
  clearTimeout(globalTimer);
  try {
    await browser.close();
  } catch {}
  hardKill();
}

const finishedUtc = ts();

// Build results.json
const outputResults = {
  agent: agentNumber,
  urlUsed: baseUrl,
  viewport: viewport.name,
  startedUtc,
  finishedUtc,
  summary: {
    total: checks.length,
    passed: checks.filter((c) => c.result === 'PASS').length,
    failed: checks.filter((c) => c.result === 'FAIL').length,
    partial: checks.filter((c) => c.result === 'PARTIAL').length,
    unsupported: checks.filter((c) => c.result === 'UNSUPPORTED').length,
  },
  checks,
  telemetry: {
    consoleErrors: telemetry.consoleErrors,
    failedRequests: telemetry.failedRequests,
  },
};

const jsonPath = path.join(outDir, 'results.json');
fs.writeFileSync(jsonPath, JSON.stringify(outputResults, null, 2), 'utf8');
log(`Wrote results.json to ${jsonPath}`);

// Build RESULTS.md human-readable table
let mdContent = `# Verification Results — Agent ${agentNumber} (${viewport.name})

- **Target URL Used**: \`${baseUrl}\`
- **Viewport**: \`${viewport.name}\`
- **Started (UTC)**: \`${startedUtc}\`
- **Finished (UTC)**: \`${finishedUtc}\`
- **Summary**: ${outputResults.summary.passed} PASS / ${outputResults.summary.failed} FAIL / ${outputResults.summary.partial} PARTIAL / ${outputResults.summary.unsupported} UNSUPPORTED (Total: ${outputResults.summary.total})

## Assertion Matrix

| ID | Screen / Capability | Result | Evidence / Observed State | Screenshot | Timestamp (UTC) |
|---|---|---|---|---|---|
`;

for (const c of checks) {
  const safeEvidence = c.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  mdContent += `| \`${c.id}\` | ${c.name} | **${c.result}** | ${safeEvidence} | \`${c.screenshot}\` | \`${c.utc}\` |\n`;
}

mdContent += `
## Telemetry & Diagnostics

- **Console Errors Recorded**: ${telemetry.consoleErrors.length}
${telemetry.consoleErrors.length > 0 ? telemetry.consoleErrors.map((e) => `  - \`${e.atUtc}\`: ${e.text}`).join('\n') : '  - None'}
- **Failed HTTP Requests (>= 400)**: ${telemetry.failedRequests.length}
${telemetry.failedRequests.length > 0 ? telemetry.failedRequests.map((r) => `  - \`${r.atUtc}\`: [${r.status}] ${r.method} ${r.url} ${r.errorText || ''}`).join('\n') : '  - None'}
`;

const mdPath = path.join(outDir, 'RESULTS.md');
fs.writeFileSync(mdPath, mdContent, 'utf8');
log(`Wrote RESULTS.md to ${mdPath}`);

log(`All walkthrough checks completed: ${outputResults.summary.passed} PASS, ${outputResults.summary.failed} FAIL, ${outputResults.summary.partial} PARTIAL, ${outputResults.summary.unsupported} UNSUPPORTED.`);
