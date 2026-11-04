#!/usr/bin/env node
/**
 * Mobile 390x844 Verification Harness (Subagent 2 / Agent 2).
 *
 * Verifies mobile layout, touch targets, rail, panels, chat, plugins, voice,
 * empty states, and branding at 390x844 viewport.
 *
 * Usage:
 *   node scripts/qa-verify-mobile.mjs --url <base> --out <dir>
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
const rawOutDir = args.out || 'docs/agent-execution/artifacts/verify-2026-10-21/mobile';
const outDir = path.isAbsolute(rawOutDir) ? rawOutDir : path.resolve(process.cwd(), rawOutDir);

if (!baseUrl) {
  console.error('Error: missing required --url parameter');
  console.error('Usage: node scripts/qa-verify-mobile.mjs --url <base> --out <dir>');
  process.exit(2);
}

fs.mkdirSync(outDir, { recursive: true });

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

const TOTAL_TIMEOUT_MS = 14 * 60 * 1000; // 14 min total cap
const STEP_TIMEOUT_MS = 120 * 1000; // 120 s default per step

log(`Starting Mobile 390x844 Verification against ${baseUrl}`);
log(`Output Directory: ${outDir}`);

// Result storage
const results = {
  agent: 2,
  viewport: '390x844',
  urlUsed: baseUrl,
  startedUtc: ts(),
  finishedUtc: null,
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    partial: 0,
    unsupported: 0,
  },
  checks: [],
  consoleErrors: [],
  failedRequests: [],
  ondemandCalls: [],
};

// Launch Puppeteer browser with exact common args
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

// Hard kill on exit
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
    log(`Received ${sig}, terminating browser.`);
    hardKill();
    process.exit(124);
  });
}
process.on('exit', hardKill);

// Global timeout cap
const globalTimer = setTimeout(() => {
  log('ERROR: Global 14-minute timeout cap reached. Terminating browser.');
  hardKill();
  process.exit(124);
}, TOTAL_TIMEOUT_MS);

// Screenshot helper (pauses Cesium render loop if present, saves JPEG q60)
async function captureScreenshot(page, filename) {
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
    log(`Screenshot saved: ${filename}`);
  } catch (err) {
    log(`Warning: Failed to capture screenshot ${filename}: ${err?.message}`);
  }
  return filename;
}

// Timeout wrapper per step
async function withTimeout(fn, timeoutMs = STEP_TIMEOUT_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// Record a check result
function recordCheck({ id, name, result, evidence, screenshot }) {
  const entry = {
    id,
    name,
    result,
    evidence,
    screenshot: screenshot || null,
    utc: ts(),
  };
  results.checks.push(entry);
  results.summary.total += 1;
  const r = result.toLowerCase();
  if (r === 'pass') results.summary.passed += 1;
  else if (r === 'fail') results.summary.failed += 1;
  else if (r === 'partial') results.summary.partial += 1;
  else results.summary.unsupported += 1;
  log(`[${result}] Check ${id} (${name}): ${evidence.slice(0, 80)}`);
  return entry;
}

// Global telemetry tracking
function bindTelemetry(page) {
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
    // Filter out expected / benign 404s like /api/setup/status
    if (s >= 400 && !url.includes('/api/setup/status')) {
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
      if (!text.includes('/api/setup/status')) {
        results.consoleErrors.push({ text, atUtc: ts() });
      }
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
  const page = await browser.newPage();
  bindTelemetry(page);

  // Set mobile 390x844 viewport and iOS Safari user-agent
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );

  // =========================================================================
  // Screen (a): Loading / Auth (Welcome) screen `?welcome=1`
  // =========================================================================
  log('Starting Screen (a): Loading / Auth (Welcome) screen (?welcome=1)...');
  try {
    await withTimeout(async () => {
      const welcomeUrl = `${baseUrl}/?welcome=1`;
      log(`Navigating to ${welcomeUrl}`);
      await page.goto(welcomeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Immediate loading snapshot attempt
      await captureScreenshot(page, '2a-loading-390x844.jpg');

      // Wait for welcome launcher to be present
      await page.waitForSelector('#first-run-launcher, #first-run-title, #loading-screen', { timeout: 30000 });

      // Settle
      await new Promise((r) => setTimeout(r, 2000));

      const welcomeShot = await captureScreenshot(page, '2a-welcome-390x844.jpg');

      // Evaluate backdrop and brand elements
      const backdropInfo = await page.evaluate(() => {
        const loading = document.querySelector('#loading-screen');
        const launcher = document.querySelector('#first-run-launcher');
        const loadBg = loading ? window.getComputedStyle(loading).backgroundImage : '';
        const launchBg = launcher ? window.getComputedStyle(launcher).backgroundImage : '';
        const title = document.title || '';
        const bodyText = document.body?.innerText || '';
        const hasNetworkBackdrop =
          loadBg.includes('backdrop-network.png') || launchBg.includes('backdrop-network.png');

        const forbidden = [];
        if (/God's Eye/i.test(bodyText)) forbidden.push("God's Eye");
        if (/GEV MIC/i.test(bodyText)) forbidden.push('GEV MIC');
        if (/OpenAI/i.test(bodyText)) forbidden.push('OpenAI');

        const hasProductBrand = /OnDemand Intelligence/i.test(bodyText) || /OnDemand Intelligence/i.test(title);

        return {
          hasNetworkBackdrop,
          loadBg: loadBg.slice(0, 100),
          launchBg: launchBg.slice(0, 100),
          title,
          forbidden,
          hasProductBrand,
        };
      });

      const pass = backdropInfo.hasNetworkBackdrop && backdropInfo.forbidden.length === 0;
      recordCheck({
        id: '2a',
        name: 'loading_auth_welcome_screen',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `backdropPresent=${backdropInfo.hasNetworkBackdrop} (launcher/loading bg contains backdrop-network.png), productBrand=${backdropInfo.hasProductBrand}, forbiddenTerms=[${backdropInfo.forbidden.join(', ')}], title="${backdropInfo.title}"`,
        screenshot: welcomeShot,
      });
    }, 60000);
  } catch (err) {
    recordCheck({
      id: '2a',
      name: 'loading_auth_welcome_screen',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2a-welcome-390x844.jpg',
    });
  }

  // =========================================================================
  // Screen (b): Main globe `?welcome=0` deep link, booted
  // =========================================================================
  log('Starting Screen (b): Main globe deep link (?welcome=0)...');
  try {
    await withTimeout(async () => {
      const appUrl = `${baseUrl}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
      log(`Navigating to ${appUrl}`);
      await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

      // Wait for boot: loading screen hides and viewer exists
      await page.waitForFunction(
        () => {
          const loading = document.querySelector('#loading-screen');
          const hidden = loading ? loading.classList.contains('hidden') : true;
          const viewer = window.__godsEyeView?.viewer;
          return hidden && !!viewer;
        },
        { timeout: 90000 }
      );

      // Settle Cesium
      await new Promise((r) => setTimeout(r, 3000));

      const bootedShot = await captureScreenshot(page, '2b-globe-booted-390x844.jpg');

      const bootInfo = await page.evaluate(() => {
        const loadingHidden = document.querySelector('#loading-screen')?.classList.contains('hidden');
        const hasViewer = !!window.__godsEyeView?.viewer;
        const title = document.title || '';
        const bodyText = document.body?.innerText || '';
        const forbidden = [];
        if (/God's Eye/i.test(bodyText)) forbidden.push("God's Eye");
        if (/GEV MIC/i.test(bodyText)) forbidden.push('GEV MIC');
        if (/OpenAI/i.test(bodyText)) forbidden.push('OpenAI');
        const hasProductBrand = /OnDemand Intelligence/i.test(bodyText) || /OnDemand Intelligence/i.test(title);

        return {
          loadingHidden,
          hasViewer,
          title,
          forbidden,
          hasProductBrand,
        };
      });

      const pass = bootInfo.loadingHidden && bootInfo.hasViewer && bootInfo.forbidden.length === 0;
      recordCheck({
        id: '2b',
        name: 'main_globe_booted',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `loadingHidden=${bootInfo.loadingHidden}, hasViewer=${bootInfo.hasViewer}, title="${bootInfo.title}", productBrand=${bootInfo.hasProductBrand}, forbiddenTerms=[${bootInfo.forbidden.join(', ')}]`,
        screenshot: bootedShot,
      });
    }, 120000);
  } catch (err) {
    recordCheck({
      id: '2b',
      name: 'main_globe_booted',
      result: 'FAIL',
      evidence: `Error during boot: ${err.message}`,
      screenshot: '2b-globe-booted-390x844.jpg',
    });
  }

  // =========================================================================
  // Mobile check (m1) part 1: Booted page horizontal overflow
  // =========================================================================
  log('Evaluating Mobile Check (m1) booted horizontal overflow...');
  try {
    const overflowBooted = await page.evaluate(() => {
      const sw = document.documentElement.scrollWidth;
      const bsw = document.body.scrollWidth;
      const vw = window.innerWidth;
      return { sw, bsw, vw, ok: sw <= 390 && bsw <= 390 };
    });
    recordCheck({
      id: '2m1_booted',
      name: 'mobile_no_horizontal_overflow_booted',
      result: overflowBooted.ok ? 'PASS' : 'FAIL',
      evidence: `documentElement.scrollWidth=${overflowBooted.sw}px, body.scrollWidth=${overflowBooted.bsw}px, innerWidth=${overflowBooted.vw}px (target <= 390px)`,
      screenshot: '2b-globe-booted-390x844.jpg',
    });
  } catch (err) {
    recordCheck({
      id: '2m1_booted',
      name: 'mobile_no_horizontal_overflow_booted',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
    });
  }

  // =========================================================================
  // Screen (d): Rail `#right-context-rail` and `#global-context-panel`
  // =========================================================================
  log('Starting Screen (d): Right context rail and global context panel...');
  try {
    await withTimeout(async () => {
      // Check default collapsed state
      const railDefaultShot = await captureScreenshot(page, '2d-rail-default-390x844.jpg');

      const railStateInitial = await page.evaluate(() => {
        const rail = document.querySelector('#right-context-rail');
        const panel = document.querySelector('#global-context-panel');
        const btn = document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]');
        return {
          hasRail: !!rail,
          hasPanel: !!panel,
          hasBtn: !!btn,
          initiallyCollapsed: panel?.classList.contains('collapsed') || false,
        };
      });

      // Expand panel by clicking disclosure button
      await page.evaluate(() => {
        const btn = document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]');
        btn?.click();
      });

      await new Promise((r) => setTimeout(r, 1000));

      const railExpandedShot = await captureScreenshot(page, '2d-rail-expanded-390x844.jpg');

      const railStateExpanded = await page.evaluate(() => {
        const panel = document.querySelector('#global-context-panel');
        const isCollapsed = panel?.classList.contains('collapsed');
        const rect = panel?.getBoundingClientRect();
        const overflow = rect ? rect.right > 390 : false;
        return {
          isCollapsed,
          rect: rect ? { left: rect.left, right: rect.right, width: rect.width } : null,
          overflow,
        };
      });

      // Toggle back to collapsed
      await page.evaluate(() => {
        const btn = document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]');
        btn?.click();
      });
      await new Promise((r) => setTimeout(r, 500));

      const togglesOk = railStateInitial.initiallyCollapsed && !railStateExpanded.isCollapsed;
      const noOverflow = !railStateExpanded.overflow;
      const pass = togglesOk && noOverflow;

      recordCheck({
        id: '2d',
        name: 'rail_and_context_panel_toggle_and_fit',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `initiallyCollapsed=${railStateInitial.initiallyCollapsed}, expandedCollapsed=${railStateExpanded.isCollapsed}, togglesOk=${togglesOk}, panelRight=${railStateExpanded.rect?.right}px (must be <= 390px), noOverflow=${noOverflow}`,
        screenshot: railExpandedShot,
      });
    }, 60000);
  } catch (err) {
    recordCheck({
      id: '2d',
      name: 'rail_and_context_panel_toggle_and_fit',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2d-rail-default-390x844.jpg',
    });
  }

  // =========================================================================
  // Screen (e): HUD `#intel-hud` & `#hud-ask-ondemand`
  // =========================================================================
  log('Starting Screen (e): HUD visibility, summary telemetry, and Ask OnDemand button...');
  try {
    await withTimeout(async () => {
      // Check HUD visibility and wait up to 40s for telemetry text to leave "Awaiting telemetry..."
      let hudSummaryText = '';
      const hudWaitStart = Date.now();
      while (Date.now() - hudWaitStart < 40000) {
        hudSummaryText = await page.evaluate(() => {
          return document.querySelector('#hud-summary')?.textContent || '';
        });
        if (hudSummaryText && !hudSummaryText.includes('Awaiting telemetry...')) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      const hudShot = await captureScreenshot(page, '2e-hud-summary-390x844.jpg');

      const hudVisible = await page.evaluate(() => {
        const hud = document.querySelector('#intel-hud');
        if (!hud) return false;
        const style = window.getComputedStyle(hud);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });

      // Click #hud-ask-ondemand and verify mini chat opens with data-object-type="hudSummary"
      await page.evaluate(() => {
        const btn = document.querySelector('#hud-ask-ondemand');
        btn?.click();
      });

      const hudChatOpened = await page.waitForFunction(
        () => {
          const chat = document.querySelector('#ondemand-mini-chat');
          const isOpen = chat && chat.getAttribute('data-open') === 'true';
          const type = chat?.getAttribute('data-object-type');
          return isOpen && type === 'hudSummary';
        },
        { timeout: 15000 }
      ).catch(() => null);

      const hudChatShot = await captureScreenshot(page, '2e-hud-ask-mini-chat-390x844.jpg');

      const pass = hudVisible && !!hudChatOpened;
      recordCheck({
        id: '2e',
        name: 'hud_summary_and_ask_ondemand',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `hudVisible=${hudVisible}, summaryText="${hudSummaryText.trim().slice(0, 60)}...", chatOpenedForHudSummary=${!!hudChatOpened}`,
        screenshot: hudChatShot,
      });

      // Close mini-chat to reset state
      await page.evaluate(() => {
        document.querySelector('#ondemand-mini-chat-close')?.click();
      });
      await new Promise((r) => setTimeout(r, 500));
    }, 60000);
  } catch (err) {
    recordCheck({
      id: '2e',
      name: 'hud_summary_and_ask_ondemand',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2e-hud-summary-390x844.jpg',
    });
  }

  // =========================================================================
  // Screen (c): Chat panel (Earthquake object): RUN and PLAN/INVESTIGATE turns
  // =========================================================================
  log('Starting Screen (c): Chat panel turns (Earthquake object)...');
  try {
    await withTimeout(async () => {
      // 1. Open mini chat for earthquake object
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
        () => document.querySelector('#ondemand-mini-chat')?.getAttribute('data-open') === 'true',
        { timeout: 15000 }
      );
      await new Promise((r) => setTimeout(r, 500));

      const chatOpenShot = await captureScreenshot(page, '2c-chat-open-390x844.jpg');

      // 2. RUN turn: send "Summarise this object in one sentence."
      await page.evaluate((msg) => {
        const input = document.querySelector('#ondemand-mini-chat-input');
        if (input) {
          input.value = msg;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('#ondemand-mini-chat-send')?.click();
      }, 'Summarise this object in one sentence.');

      // Wait for assistant response to stream and finish (<= 90 s)
      const runTurnSettled = await page.waitForFunction(
        () => {
          const streaming = document.querySelector('.od-chat__msg--assistant[data-streaming="true"]');
          const stop = document.querySelector('#ondemand-mini-chat-stop');
          const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
          const status = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
          return !streaming && stopHidden && (status.includes('READY') || status.includes('IDLE'));
        },
        { timeout: 90000 }
      ).catch(() => null);

      const runTurnShot = await captureScreenshot(page, '2c-chat-run-390x844.jpg');

      const runText = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.od-chat__msg--assistant');
        return msgs.length ? msgs[msgs.length - 1]?.textContent || '' : '';
      });

      // 3. PLAN/INVESTIGATE turn via #ondemand-mini-chat-expand (<= 120 s)
      // Note: As specified in BRIEF_COMMON, there are NO literal Plan/Run tabs.
      // RUN turn is the composer SEND, and PLAN turn is the INVESTIGATE button (#ondemand-mini-chat-expand).
      await page.evaluate(() => {
        const expandBtn = document.querySelector('#ondemand-mini-chat-expand');
        expandBtn?.click();
      });

      const planTurnSettled = await page.waitForFunction(
        () => {
          const streaming = document.querySelector('.od-chat__msg--assistant[data-streaming="true"]');
          const stop = document.querySelector('#ondemand-mini-chat-stop');
          const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
          const status = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
          return !streaming && stopHidden && (status.includes('READY') || status.includes('IDLE'));
        },
        { timeout: 120000 }
      ).catch(() => null);

      const planTurnShot = await captureScreenshot(page, '2c-chat-investigate-390x844.jpg');

      const planText = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.od-chat__msg--assistant');
        return msgs.length ? msgs[msgs.length - 1]?.textContent || '' : '';
      });

      const pass = !!runTurnSettled && runText.trim().length > 0 && !!planTurnSettled && planText.trim().length > 0;
      recordCheck({
        id: '2c',
        name: 'chat_panel_run_and_investigate_turns',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `runTurnSettled=${!!runTurnSettled} (chars=${runText.length}), planTurnSettled=${!!planTurnSettled} (chars=${planText.length}); Note: No literal Plan/Run tabs exist in UI; INVESTIGATE button (#ondemand-mini-chat-expand) switches to multi-source plan/investigation pipeline.`,
        screenshot: planTurnShot,
      });
    }, 240000);
  } catch (err) {
    recordCheck({
      id: '2c',
      name: 'chat_panel_run_and_investigate_turns',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2c-chat-open-390x844.jpg',
    });
  }

  // =========================================================================
  // Mobile Checks (m1) part 2 & (m2): Mini chat fit, composer visibility, overflow
  // =========================================================================
  log('Starting Mobile Checks (m1) chat overflow & (m2) chat panel viewport fit...');
  try {
    const layoutMetrics = await page.evaluate(() => {
      const chat = document.querySelector('#ondemand-mini-chat');
      const input = document.querySelector('#ondemand-mini-chat-input');
      const send = document.querySelector('#ondemand-mini-chat-send');
      const docW = document.documentElement.scrollWidth;
      const bodyW = document.body.scrollWidth;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const chatRect = chat?.getBoundingClientRect();
      const inputRect = input?.getBoundingClientRect();
      const sendRect = send?.getBoundingClientRect();

      const chatFitsViewport = chatRect
        ? chatRect.left >= -2 &&
          chatRect.top >= -2 &&
          chatRect.right <= vw + 2 &&
          chatRect.bottom <= vh + 2
        : false;

      const inputVisible = inputRect ? inputRect.height > 0 && inputRect.width > 0 && inputRect.bottom <= vh : false;
      const sendVisible = sendRect ? sendRect.height > 0 && sendRect.width > 0 && sendRect.bottom <= vh : false;

      return {
        docW,
        bodyW,
        vw,
        vh,
        chatFitsViewport,
        inputVisible,
        sendVisible,
        chatRect: chatRect
          ? { left: chatRect.left, top: chatRect.top, right: chatRect.right, bottom: chatRect.bottom, width: chatRect.width, height: chatRect.height }
          : null,
        inputRect: inputRect
          ? { left: inputRect.left, top: inputRect.top, right: inputRect.right, bottom: inputRect.bottom }
          : null,
      };
    });

    // Check m1 with chat open
    const m1ChatOk = layoutMetrics.docW <= 390 && layoutMetrics.bodyW <= 390;
    recordCheck({
      id: '2m1_chat',
      name: 'mobile_no_horizontal_overflow_with_chat_open',
      result: m1ChatOk ? 'PASS' : 'FAIL',
      evidence: `documentElement.scrollWidth=${layoutMetrics.docW}px, body.scrollWidth=${layoutMetrics.bodyW}px (target <= 390px)`,
      screenshot: '2c-chat-run-390x844.jpg',
    });

    // Check m2: panel fits 0..390 x 0..844 and composer is visible without page scrolling
    const m2Pass = layoutMetrics.chatFitsViewport && layoutMetrics.inputVisible && layoutMetrics.sendVisible;
    recordCheck({
      id: '2m2',
      name: 'mobile_mini_chat_fit_and_composer_visible',
      result: m2Pass ? 'PASS' : 'FAIL',
      evidence: `chatFitsViewport=${layoutMetrics.chatFitsViewport} (rect: ${JSON.stringify(layoutMetrics.chatRect)}), inputVisible=${layoutMetrics.inputVisible}, sendVisible=${layoutMetrics.sendVisible}`,
      screenshot: '2c-chat-run-390x844.jpg',
    });
  } catch (err) {
    recordCheck({
      id: '2m2',
      name: 'mobile_mini_chat_fit_and_composer_visible',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
    });
  }

  // =========================================================================
  // Screen (i): Developer details `#ondemand-mini-chat-dev`
  // =========================================================================
  log('Starting Screen (i): Developer details <details> reveal...');
  try {
    await withTimeout(async () => {
      // Inspect initial collapsed state
      const devStateInitial = await page.evaluate(() => {
        const devs = document.querySelectorAll('#ondemand-mini-chat-dev');
        const dev = devs[0];
        const summaries = dev ? dev.querySelectorAll('summary') : [];
        return {
          count: devs.length,
          isDetails: dev?.tagName === 'DETAILS',
          isOpen: dev?.open || false,
          summaryCount: summaries.length,
          summaryText: summaries[0]?.textContent || '',
        };
      });

      const devCollapsedShot = await captureScreenshot(page, '2i-dev-details-collapsed-390x844.jpg');

      // Tap summary to expand
      await page.evaluate(() => {
        const summary = document.querySelector('#ondemand-mini-chat-dev summary');
        summary?.click();
      });
      await new Promise((r) => setTimeout(r, 600));

      const devExpandedShot = await captureScreenshot(page, '2i-dev-details-expanded-390x844.jpg');

      const devStateExpanded = await page.evaluate(() => {
        const dev = document.querySelector('#ondemand-mini-chat-dev');
        const linesEl = document.querySelector('#ondemand-mini-chat-dev-lines');
        const lines = linesEl ? linesEl.querySelectorAll('.od-chat__dev-line, div') : [];
        return {
          isOpen: dev?.open || false,
          linesCount: lines.length,
          firstLine: lines[0]?.textContent || '',
        };
      });

      const pass =
        devStateInitial.count === 1 &&
        devStateInitial.isDetails &&
        !devStateInitial.isOpen &&
        devStateExpanded.isOpen &&
        devStateExpanded.linesCount >= 1;

      recordCheck({
        id: '2i',
        name: 'developer_details_reveal',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `singleDetailsCount=${devStateInitial.count}, initiallyClosed=${!devStateInitial.isOpen}, expandedOnTap=${devStateExpanded.isOpen}, devLinesCount=${devStateExpanded.linesCount} (sample="${devStateExpanded.firstLine}")`,
        screenshot: devExpandedShot,
      });

      // Check m6: Developer details reveal remains usable with panel open
      const m6Usable = await page.evaluate(() => {
        const summary = document.querySelector('#ondemand-mini-chat-dev summary');
        if (!summary) return { usable: false, reason: 'summary element missing' };
        const rect = summary.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        const isSelfOrDescendant = topEl === summary || summary.contains(topEl);
        return {
          usable: isSelfOrDescendant,
          topElement: topEl ? `${topEl.tagName.toLowerCase()}${topEl.id ? '#' + topEl.id : ''}${topEl.className ? '.' + topEl.className.split(' ').join('.') : ''}` : null,
          coords: { cx, cy },
        };
      });

      recordCheck({
        id: '2m6',
        name: 'mobile_dev_details_reveal_usable',
        result: m6Usable.usable ? 'PASS' : 'FAIL',
        evidence: `usable=${m6Usable.usable}, elementFromPoint=${m6Usable.topElement} at (${Math.round(m6Usable.coords?.cx)}, ${Math.round(m6Usable.coords?.cy)})`,
        screenshot: devExpandedShot,
      });

      // Collapse developer details back
      await page.evaluate(() => {
        const summary = document.querySelector('#ondemand-mini-chat-dev summary');
        summary?.click();
      });
      await new Promise((r) => setTimeout(r, 400));
    }, 60000);
  } catch (err) {
    recordCheck({
      id: '2i',
      name: 'developer_details_reveal',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2i-dev-details-collapsed-390x844.jpg',
    });
  }

  // =========================================================================
  // Screen (f): Plugin panel lifecycle, verify probes & streaming invocation
  // =========================================================================
  log('Starting Screen (f): Plugin panel lifecycle & streaming invocation...');
  try {
    await withTimeout(async () => {
      // 1. Initial screenshot & collect badge states (assert no READY badge before probe)
      const initialBadges = await page.evaluate(() => {
        const panel = document.querySelector('#ondemand-plugin-panel');
        if (!panel) return null;
        const badges = Array.from(panel.querySelectorAll('.od-plugin__state')).map((el) => {
          return {
            pluginId: el.closest('li')?.getAttribute('data-plugin-id') || '',
            stateAttr: el.getAttribute('data-state') || '',
            text: el.textContent?.trim() || '',
          };
        });
        const anyReady = badges.some((b) => b.text.toUpperCase() === 'READY');
        return { badges, anyReady };
      });

      const pluginInitialShot = await captureScreenshot(page, '2f-plugins-initial-390x844.jpg');

      const noReadyInitially = initialBadges ? !initialBadges.anyReady : true;

      // 2. VERIFY internet_web_search -> READY (<= 30 s)
      log('Triggering VERIFY on internet_web_search...');
      await page.evaluate(() => {
        const btn = document.querySelector('button.od-plugin__verify[data-plugin-name="internet_web_search"]');
        btn?.click();
      });

      const webSearchReady = await page.waitForFunction(
        () => {
          const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
          const badge = row?.querySelector('.od-plugin__state');
          return badge && (badge.getAttribute('data-state') === 'ready' || badge.textContent?.includes('READY'));
        },
        { timeout: 30000 }
      ).catch(() => null);

      const webSearchReadyShot = await captureScreenshot(page, '2f-plugins-websearch-ready-390x844.jpg');

      // 3. VERIFY x_mcp_connector -> FAILED + .od-plugin__error (<= 30 s)
      log('Triggering VERIFY on x_mcp_connector...');
      await page.evaluate(() => {
        const btn = document.querySelector('button.od-plugin__verify[data-plugin-name="x_mcp_connector"]');
        btn?.click();
      });

      const xmcpFailed = await page.waitForFunction(
        () => {
          const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1785777296"]');
          const badge = row?.querySelector('.od-plugin__state');
          const err = row?.querySelector('.od-plugin__error');
          const isFailed = badge && (badge.getAttribute('data-state') === 'failed' || badge.textContent?.includes('FAILED'));
          return isFailed && !!err;
        },
        { timeout: 30000 }
      ).catch(() => null);

      const xmcpFailedShot = await captureScreenshot(page, '2f-plugins-xmcp-failed-390x844.jpg');

      const xmcpErrText = await page.evaluate(() => {
        const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1785777296"]');
        return row?.querySelector('.od-plugin__error')?.textContent || '';
      });

      // 4. Mobile Check (m4): Plugin panel scrollable / all rows reachable
      log('Evaluating Mobile Check (m4): Plugin panel scrollability...');
      const m4Scroll = await page.evaluate(() => {
        const list = document.querySelector('ul.od-plugins__list');
        const rows = document.querySelectorAll('li.od-plugin__row');
        if (!list || rows.length === 0) return { scrollable: false, lastRowVisible: false };
        const lastRow = rows[rows.length - 1];
        lastRow.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        const listRect = list.getBoundingClientRect();
        const lastRect = lastRow.getBoundingClientRect();
        const lastRowVisible = lastRect.top >= listRect.top - 10 && lastRect.bottom <= listRect.bottom + 20;
        return {
          scrollable: list.scrollHeight > list.clientHeight,
          lastRowVisible,
          rowsCount: rows.length,
          lastPluginId: lastRow.getAttribute('data-plugin-id'),
        };
      });

      recordCheck({
        id: '2m4',
        name: 'mobile_plugin_panel_scrollable_and_reachable',
        result: m4Scroll.lastRowVisible || m4Scroll.scrollable ? 'PASS' : 'FAIL',
        evidence: `rowsCount=${m4Scroll.rowsCount}, scrollable=${m4Scroll.scrollable}, lastRowVisible=${m4Scroll.lastRowVisible} (lastId="${m4Scroll.lastPluginId}")`,
        screenshot: xmcpFailedShot,
      });

      // 5. Tick internet_web_search checkbox
      log('Ticking internet_web_search toggle...');
      await page.evaluate(() => {
        const row = document.querySelector('li.od-plugin__row[data-plugin-id="plugin-1713924030"]');
        const toggle = row?.querySelector('input.od-plugin__toggle');
        if (toggle && !toggle.checked) {
          toggle.checked = true;
          toggle.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      // 6. Send "Give one current news headline about Abu Dhabi with its source URL."
      // Concurrently poll GET <base>/api/ondemand/v2/plugins every 250 ms
      log('Starting news query turn and polling GET /api/ondemand/v2/plugins every 250 ms...');
      let isQueryActive = true;
      const polledObservations = [];
      const pollTimer = setInterval(async () => {
        if (!isQueryActive) return;
        try {
          const res = await fetch(`${baseUrl}/api/ondemand/v2/plugins`);
          if (res.ok) {
            const data = await res.json();
            const webSearch = data.plugins?.find((p) => p.name === 'internet_web_search');
            if (webSearch) {
              polledObservations.push({
                state: webSearch.state,
                invocations: webSearch.invocations,
                at: Date.now(),
              });
            }
          }
        } catch {}
      }, 250);

      await page.evaluate((text) => {
        const input = document.querySelector('#ondemand-mini-chat-input');
        if (input) {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('#ondemand-mini-chat-send')?.click();
      }, 'Give one current news headline about Abu Dhabi with its source URL.');

      // Capture screenshot during invocation / streaming
      await new Promise((r) => setTimeout(r, 1500));
      const invokingShot = await captureScreenshot(page, '2f-plugins-invoking-turn-390x844.jpg');

      // Wait for chat turn to settle (<= 90 s)
      const newsTurnSettled = await page.waitForFunction(
        () => {
          const streaming = document.querySelector('.od-chat__msg--assistant[data-streaming="true"]');
          const stop = document.querySelector('#ondemand-mini-chat-stop');
          const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
          const status = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
          return !streaming && stopHidden && (status.includes('READY') || status.includes('IDLE'));
        },
        { timeout: 90000 }
      ).catch(() => null);

      isQueryActive = false;
      clearInterval(pollTimer);

      const statesSeen = Array.from(new Set(polledObservations.map((o) => o.state)));
      const maxInvocations = Math.max(0, ...polledObservations.map((o) => o.invocations || 0));

      const pass = noReadyInitially && !!webSearchReady && !!xmcpFailed;
      recordCheck({
        id: '2f',
        name: 'plugin_panel_lifecycle_and_streaming',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `noReadyInitially=${noReadyInitially}, webSearchReady=${!!webSearchReady}, xmcpFailed=${!!xmcpFailed} (err="${xmcpErrText}"), newsTurnSettled=${!!newsTurnSettled}, polledStatesSeen=[${statesSeen.join(', ')}], maxInvocations=${maxInvocations}`,
        screenshot: invokingShot,
      });
    }, 180000);
  } catch (err) {
    recordCheck({
      id: '2f',
      name: 'plugin_panel_lifecycle_and_streaming',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2f-plugins-initial-390x844.jpg',
    });
  }

  // =========================================================================
  // Mobile Check (m3): Touch targets measurement
  // =========================================================================
  log('Starting Mobile Check (m3): Touch targets measurement...');
  try {
    const targets = await page.evaluate(() => {
      const selectors = [
        { id: '#ondemand-mini-chat-send', el: document.querySelector('#ondemand-mini-chat-send') },
        { id: '#ondemand-mini-chat-close', el: document.querySelector('#ondemand-mini-chat-close') },
        { id: '#ondemand-mini-chat-expand', el: document.querySelector('#ondemand-mini-chat-expand') },
        { id: '#od-voice-button', el: document.querySelector('#od-voice-button') },
        { id: '#od-voice-route', el: document.querySelector('#od-voice-route') },
        { id: '#hud-ask-ondemand', el: document.querySelector('#hud-ask-ondemand') },
        {
          id: 'rail-disclosure-btn',
          el: document.querySelector('button.panel-collapse-btn[data-collapse-target="global-context-panel"]'),
        },
        { id: 'dev-details-summary', el: document.querySelector('#ondemand-mini-chat-dev summary') },
      ];

      // Add all button.od-plugin__verify
      document.querySelectorAll('button.od-plugin__verify').forEach((b, idx) => {
        selectors.push({ id: `od-plugin-verify-${b.getAttribute('data-plugin-name') || idx}`, el: b });
      });

      // Add all input.od-plugin__toggle
      document.querySelectorAll('input.od-plugin__toggle').forEach((inp, idx) => {
        selectors.push({ id: `od-plugin-toggle-${inp.getAttribute('data-plugin-id') || idx}`, el: inp });
      });

      return selectors.map(({ id, el }) => {
        if (!el) return { id, present: false };
        const r = el.getBoundingClientRect();
        return {
          id,
          present: true,
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          lt44: r.width < 44 || r.height < 44,
          lt24: r.width < 24 || r.height < 24,
        };
      });
    });

    const failingFloor = targets.filter((t) => t.present && t.lt24);
    const belowRecommended = targets.filter((t) => t.present && t.lt44);
    const pass = failingFloor.length === 0;

    recordCheck({
      id: '2m3',
      name: 'mobile_touch_targets_dimensions',
      result: pass ? 'PASS' : 'FAIL',
      evidence: `totalMeasured=${targets.filter((t) => t.present).length}, belowRecommended44px=${belowRecommended.length} (${belowRecommended.map((t) => `${t.id}:${t.width}x${t.height}`).join(', ')}), belowWcagFloor24px=${failingFloor.length} (${failingFloor.map((t) => `${t.id}:${t.width}x${t.height}`).join(', ')})`,
      screenshot: '2c-chat-run-390x844.jpg',
    });
  } catch (err) {
    recordCheck({
      id: '2m3',
      name: 'mobile_touch_targets_dimensions',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
    });
  }

  // =========================================================================
  // Mobile Check (m5): Voice controls remain usable with mini chat open
  // =========================================================================
  log('Starting Mobile Check (m5): Voice button usability with mini chat open...');
  try {
    const voiceUsability = await page.evaluate(() => {
      const btn = document.querySelector('#od-voice-button');
      if (!btn) return { usable: false, reason: 'voice button missing' };
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      const isSelfOrDescendant = topEl === btn || btn.contains(topEl);
      return {
        usable: isSelfOrDescendant,
        topElement: topEl
          ? `${topEl.tagName.toLowerCase()}${topEl.id ? '#' + topEl.id : ''}${topEl.className ? '.' + topEl.className.split(' ').join('.') : ''}`
          : null,
        coords: { cx: Math.round(cx), cy: Math.round(cy) },
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      };
    });

    recordCheck({
      id: '2m5',
      name: 'mobile_voice_button_not_covered_with_chat_open',
      result: voiceUsability.usable ? 'PASS' : 'FAIL',
      evidence: `usable=${voiceUsability.usable}, topElement="${voiceUsability.topElement}" at (${voiceUsability.coords?.cx}, ${voiceUsability.coords?.cy}); rect: ${JSON.stringify(voiceUsability.rect)}`,
      screenshot: '2c-chat-run-390x844.jpg',
    });
  } catch (err) {
    recordCheck({
      id: '2m5',
      name: 'mobile_voice_button_not_covered_with_chat_open',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
    });
  }

  // =========================================================================
  // Screen (g): Voice controls `#od-voice-control` & per-turn plugin check
  // =========================================================================
  log('Starting Screen (g): Voice controls & pluginId forwarding check...');
  try {
    await withTimeout(async () => {
      // 1. Idle screenshot
      const voiceIdleShot = await captureScreenshot(page, '2g-voice-idle-390x844.jpg');

      // 2. Wrap window.fetch to capture body of next POST /api/ondemand/v2/voice/turn
      await page.evaluate(() => {
        window.__capturedVoiceTurnBodies = [];
        const origFetch = window.fetch;
        window.fetch = async function (...fArgs) {
          const url = typeof fArgs[0] === 'string' ? fArgs[0] : fArgs[0]?.url || '';
          if (url.includes('/api/ondemand/v2/voice/turn') && fArgs[1]?.body) {
            try {
              window.__capturedVoiceTurnBodies.push(JSON.parse(fArgs[1].body));
            } catch {}
          }
          return origFetch.apply(this, fArgs);
        };
      });

      // 3. Submit voice turn text
      log('Calling window.__odVoice.submitText("What is the local time in Austin, Texas?")...');
      const submitResult = await page.evaluate(async () => {
        try {
          if (!window.__odVoice) throw new Error('window.__odVoice is not defined');
          await window.__odVoice.submitText('What is the local time in Austin, Texas?');
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      });

      await new Promise((r) => setTimeout(r, 2000));
      const voiceTurnShot = await captureScreenshot(page, '2g-voice-turn-390x844.jpg');

      // 4. Retrieve state, detail, history, and captured request body
      const voiceData = await page.evaluate(() => {
        const state = window.__odVoice?.getState?.() || null;
        const detail = window.__odVoice?.getDetail?.() || null;
        const history = window.__odVoice?.getHistory?.() || [];
        const lastEntry = history.length ? history[history.length - 1] : null;
        const bodies = window.__capturedVoiceTurnBodies || [];
        return {
          state,
          detail,
          historyCount: history.length,
          lastEntry,
          bodies,
        };
      });

      const capturedBody = voiceData.bodies[0] || null;
      const sentPluginIds = capturedBody?.pluginIds || [];
      const hasTickedPlugin = sentPluginIds.includes('plugin-1713924030');

      // Note: Brief explicitly specifies: "whether pluginIds in the captured body contained plugin-1713924030 (the ticked plugin) — FAIL row if not; screenshot;"
      const pass = submitResult.ok && hasTickedPlugin;
      recordCheck({
        id: '2g',
        name: 'voice_turn_and_plugin_id_forwarding',
        result: pass ? 'PASS' : 'FAIL',
        evidence: `submitOk=${submitResult.ok}, voiceState="${voiceData.state}", voiceDetail="${voiceData.detail}", historyCount=${voiceData.historyCount}, capturedPluginIds=[${sentPluginIds.join(', ')}], containedTickedPlugin=${hasTickedPlugin}${!hasTickedPlugin ? ' (SUSPECT: src/voice/ondemand/index.js does not pass getPluginIds into createVoicePipeline)' : ''}`,
        screenshot: voiceTurnShot,
      });
    }, 120000);
  } catch (err) {
    recordCheck({
      id: '2g',
      name: 'voice_turn_and_plugin_id_forwarding',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2g-voice-idle-390x844.jpg',
    });
  }

  // =========================================================================
  // Screen (h): Empty states (no-sessions, source-unavailable, no-results)
  // =========================================================================
  log('Starting Screen (h): Empty states verification...');
  try {
    // 1. no-sessions empty state (fresh alert object)
    const freshAlertId = `alert-fresh-${Date.now()}`;
    log(`Opening fresh alert object: ${freshAlertId}...`);
    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent('gev:ask-object', {
          detail: {
            objectType: 'alert',
            objectId: id,
            label: 'Fresh Alert Object',
          },
        })
      );
    }, freshAlertId);

    await page.waitForFunction(
      () => document.querySelector('#ondemand-mini-chat')?.getAttribute('data-open') === 'true',
      { timeout: 15000 }
    );
    await new Promise((r) => setTimeout(r, 600));

    const noSessionsShot = await captureScreenshot(page, '2h-empty-no-sessions-390x844.jpg');

    const noSessionsInfo = await page.evaluate(() => {
      const empty = document.querySelector('.od-empty-state[data-empty-state="no-sessions"]');
      const bg = empty ? window.getComputedStyle(empty, '::before').backgroundImage : '';
      return {
        present: !!empty,
        bgContainsImg: bg.includes('empty-no-sessions.png'),
        bg,
      };
    });

    recordCheck({
      id: '2h_no_sessions',
      name: 'empty_state_no_sessions',
      result: noSessionsInfo.present && noSessionsInfo.bgContainsImg ? 'PASS' : 'FAIL',
      evidence: `present=${noSessionsInfo.present}, bgContainsBrandImg=${noSessionsInfo.bgContainsImg} (bg: ${noSessionsInfo.bg.slice(0, 80)})`,
      screenshot: noSessionsShot,
    });

    // 2. source-unavailable empty state (synthetic 502 injection)
    log('Setting up request interception for synthetic 502...');
    await page.setRequestInterception(true);
    let intercept502 = true;
    const handle502 = (req) => {
      if (intercept502 && req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') {
        req.respond({
          status: 502,
          contentType: 'application/json',
          headers: { 'x-ondemand-key-source': 'server', 'access-control-allow-origin': '*' },
          body: JSON.stringify({ error: 'bad_gateway', status: 502, message: 'Synthetic 502 injection' }),
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
    }, 'Trigger source-unavailable error');

    await page.waitForFunction(
      () => {
        const empty = document.querySelector('.od-empty-state[data-empty-state="source-unavailable"], .od-empty-state--source-unavailable');
        const err = document.querySelector('.od-chat__msg--error');
        return !!empty || !!err;
      },
      { timeout: 30000 }
    ).catch(() => null);

    const sourceUnavailableShot = await captureScreenshot(page, '2h-empty-source-unavailable-390x844.jpg');

    const sourceUnavailableInfo = await page.evaluate(() => {
      const empty = document.querySelector(
        '.od-empty-state[data-empty-state="source-unavailable"], .od-empty-state--source-unavailable'
      );
      const bg = empty ? window.getComputedStyle(empty, '::before').backgroundImage : '';
      return {
        present: !!empty,
        bgContainsImg: bg.includes('empty-source-unavailable.png'),
        bg,
      };
    });

    intercept502 = false;
    page.off('request', handle502);
    await page.setRequestInterception(false);

    recordCheck({
      id: '2h_source_unavailable',
      name: 'empty_state_source_unavailable',
      result: sourceUnavailableInfo.present && sourceUnavailableInfo.bgContainsImg ? 'PASS' : 'FAIL',
      evidence: `present=${sourceUnavailableInfo.present}, bgContainsBrandImg=${sourceUnavailableInfo.bgContainsImg} (bg: ${sourceUnavailableInfo.bg.slice(0, 80)})`,
      screenshot: sourceUnavailableShot,
    });

    // 3. no-results empty state (200 SSE done without answer content)
    log('Setting up request interception for empty 200 done stream...');
    await page.setRequestInterception(true);
    let interceptNoResults = true;
    const handleNoResults = (req) => {
      if (interceptNoResults && req.url().includes('/api/ondemand/v2/chat') && req.method() === 'POST') {
        req.respond({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'x-ondemand-key-source': 'server', 'access-control-allow-origin': '*' },
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
    }, 'Trigger no-results stream');

    await page.waitForFunction(
      () => {
        const empty = document.querySelector('.od-empty-state[data-empty-state="no-results"], .od-empty-state--no-results');
        const status = document.querySelector('#ondemand-mini-chat-status')?.textContent || '';
        return !!empty && (status.includes('READY') || status.includes('IDLE'));
      },
      { timeout: 30000 }
    ).catch(() => null);

    const noResultsShot = await captureScreenshot(page, '2h-empty-no-results-390x844.jpg');

    const noResultsInfo = await page.evaluate(() => {
      const empty = document.querySelector('.od-empty-state[data-empty-state="no-results"], .od-empty-state--no-results');
      const bg = empty ? window.getComputedStyle(empty, '::before').backgroundImage : '';
      return {
        present: !!empty,
        bgContainsImg: bg.includes('empty-no-results.png'),
        bg,
      };
    });

    interceptNoResults = false;
    page.off('request', handleNoResults);
    await page.setRequestInterception(false);

    recordCheck({
      id: '2h_no_results',
      name: 'empty_state_no_results',
      result: noResultsInfo.present && noResultsInfo.bgContainsImg ? 'PASS' : 'FAIL',
      evidence: `present=${noResultsInfo.present}, bgContainsBrandImg=${noResultsInfo.bgContainsImg} (bg: ${noResultsInfo.bg.slice(0, 80)})`,
      screenshot: noResultsShot,
    });
  } catch (err) {
    recordCheck({
      id: '2h',
      name: 'empty_states_execution',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
      screenshot: '2h-empty-no-sessions-390x844.jpg',
    });
  }

  // =========================================================================
  // Branding Check Across All Screens
  // =========================================================================
  log('Starting Branding Check across all screens...');
  try {
    const brandAudit = await page.evaluate(() => {
      const title = document.title || '';
      const bodyText = document.body?.innerText || '';
      const forbidden = [];
      if (/God's Eye/i.test(bodyText)) forbidden.push("God's Eye");
      if (/GEV MIC/i.test(bodyText)) forbidden.push('GEV MIC');
      if (/OpenAI/i.test(bodyText)) forbidden.push('OpenAI');
      const hasProductName =
        title.includes('OnDemand Intelligence') || bodyText.includes('OnDemand Intelligence');
      return { title, forbidden, hasProductName };
    });

    const pass = brandAudit.hasProductName && brandAudit.forbidden.length === 0;
    recordCheck({
      id: '2_brand',
      name: 'branding_and_legacy_sanitization',
      result: pass ? 'PASS' : 'FAIL',
      evidence: `title="${brandAudit.title}", hasProductName=${brandAudit.hasProductName}, forbiddenTerms=[${brandAudit.forbidden.join(', ')}]`,
      screenshot: '2b-globe-booted-390x844.jpg',
    });
  } catch (err) {
    recordCheck({
      id: '2_brand',
      name: 'branding_and_legacy_sanitization',
      result: 'FAIL',
      evidence: `Error: ${err.message}`,
    });
  }

  await page.close();
} catch (outerErr) {
  log(`Outer harness error: ${outerErr?.stack || outerErr}`);
} finally {
  clearTimeout(globalTimer);
  results.finishedUtc = ts();

  // Write results.json
  const jsonPath = path.join(outDir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  log(`Wrote results.json to ${jsonPath}`);

  // Write RESULTS.md table
  const mdPath = path.join(outDir, 'RESULTS.md');
  let md = `# Mobile 390x844 Verification Results (Subagent 2)

- **Target URL**: \`${results.urlUsed}\`
- **Viewport**: \`390x844\` (iOS Safari User Agent)
- **Started UTC**: \`${results.startedUtc}\`
- **Finished UTC**: \`${results.finishedUtc}\`
- **Summary**: **${results.summary.passed} PASSED** / **${results.summary.failed} FAILED** / **${results.summary.partial} PARTIAL** / **${results.summary.unsupported} UNSUPPORTED** (Total: ${results.summary.total})

## Verification Summary Table

| ID | Check / Screen | Result | Evidence / Observed Details | Screenshot | UTC Timestamp |
|---|---|---|---|---|---|
`;

  for (const c of results.checks) {
    md += `| \`${c.id}\` | **${c.name}** | \`${c.result}\` | ${c.evidence.replace(/\|/g, '\\|')} | \`${c.screenshot || 'none'}\` | \`${c.utc}\` |\n`;
  }

  md += `\n## Suspected Failures & Architectural Observations\n\n`;
  const fails = results.checks.filter((c) => c.result === 'FAIL');
  if (fails.length === 0) {
    md += `No failures observed. All mobile verification checks passed.\n`;
  } else {
    for (const f of fails) {
      md += `### Check \`${f.id}\`: ${f.name}\n`;
      md += `- **Observed Evidence**: ${f.evidence}\n`;
      if (f.id === '2g') {
        md += `- **Suspected Cause**: In \`src/voice/ondemand/index.js\` and \`src/main.js\`, \`installOndemandVoice\` instantiates \`createVoicePipeline\` without supplying \`getPluginIds\`. As a result, \`pipeline.js:144\` falls back to its default \`getPluginIds = () => []\`, and per-turn plugin selection from \`window.__odPlugins\` is never wired to POST \`/api/ondemand/v2/voice/turn\`.\n`;
      }
      if (f.id === '2m5') {
        md += `- **Suspected Cause**: The mobile mini-chat bottom sheet (\`#ondemand-mini-chat\`) has \`z-index: 186; bottom: 0; left: 0; right: 0;\`, which covers the bottom command dock where \`#od-voice-button\` is mounted. When the chat is open, voice controls cannot receive direct pointer events.\n`;
      }
      md += `\n`;
    }
  }

  md += `\n## Console Errors (${results.consoleErrors.length})\n\n`;
  if (results.consoleErrors.length === 0) {
    md += `No unexpected console errors recorded.\n`;
  } else {
    for (const err of results.consoleErrors) {
      md += `- \`[${err.atUtc}]\` ${err.text}\n`;
    }
  }

  md += `\n## Failed Network Requests (${results.failedRequests.length})\n\n`;
  if (results.failedRequests.length === 0) {
    md += `No unexpected failed requests recorded.\n`;
  } else {
    for (const req of results.failedRequests) {
      md += `- \`[${req.atUtc}]\` ${req.method} ${req.url} (status: ${req.status}${req.errorText ? ` ${req.errorText}` : ''})\n`;
    }
  }

  fs.writeFileSync(mdPath, md, 'utf8');
  log(`Wrote RESULTS.md to ${mdPath}`);

  hardKill();
  try {
    await browser.close();
  } catch {}
}
