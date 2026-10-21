#!/usr/bin/env node
/**
 * QA Verification Script: rAF coalescing, list virtualization, scroll anchoring,
 * and runtime network telemetry capture.
 *
 * Usage:
 *   node scripts/qa-verify-perf.mjs --url <base> --out <dir>
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
const outDir = args.out || 'docs/agent-execution/artifacts/verify-2026-10-21/scenarios';

if (!baseUrl) {
  console.error('Error: missing required --url parameter');
  console.error('Usage: node scripts/qa-verify-perf.mjs --url <base> --out <dir>');
  process.exit(2);
}

const VIEWPORT_LIST = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];

const TOTAL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min total cap

fs.mkdirSync(outDir, { recursive: true });

const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

log(`Starting QA Verify Perf against ${baseUrl}`);
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
    log(`Saved screenshot: ${filePath}`);
  } catch (err) {
    log(`Warning: Failed to capture screenshot ${filename}: ${err?.message}`);
  }
  return filename;
}

function calculateMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function sendQueryAndWait(page, text) {
  const turnIndex = await page.evaluate(() => {
    return window.__godsEyeView?.miniChat?.getState?.()?.turns?.length || 0;
  });

  await page.evaluate((q) => {
    const input = document.getElementById('ondemand-mini-chat-input');
    if (input) {
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const sendBtn = document.getElementById('ondemand-mini-chat-send');
    sendBtn?.click();
  }, text);

  await page.waitForFunction(
    (prevTurns) => {
      const turns = window.__godsEyeView?.miniChat?.getState?.()?.turns?.length || 0;
      const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
      return turns > prevTurns || s.includes('STREAMING') || !s.includes('READY');
    },
    { timeout: 10000 },
    turnIndex
  ).catch(() => {});

  await page.waitForFunction(
    () => {
      const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
      const stop = document.getElementById('ondemand-mini-chat-stop');
      const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
      const busy = window.__godsEyeView?.miniChat?.getState?.()?.busy;
      return (s.includes('READY') || s.includes('IDLE')) && stopHidden && !busy;
    },
    { timeout: 90000 }
  );

  await new Promise((r) => setTimeout(r, 400));
}

const perfResults = {
  startedAt: ts(),
  endedAt: null,
  baseUrl,
  viewports: {},
};

const networkRequests = [];

try {
  for (const vp of VIEWPORT_LIST) {
    log(`\n===============================================================`);
    log(`Running performance & telemetry checks for ${vp.name} (${vp.width}x${vp.height})`);
    log(`===============================================================`);

    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

    // Track requests (for Part 3 s3, record on 1440x900)
    const requestStatusMap = new Map();
    page.on('request', (req) => {
      if (vp.name === '1440x900') {
        const headers = req.headers();
        const hasLeakedKey = Boolean(headers['apikey'] || headers['x-ondemand-key']);
        const reqRecord = {
          url: req.url(),
          method: req.method(),
          status: null,
          resourceType: req.resourceType(),
          utc: ts(),
          hasLeakedKey,
        };
        requestStatusMap.set(req, reqRecord);
        networkRequests.push(reqRecord);
      }
    });

    page.on('response', (res) => {
      if (vp.name === '1440x900') {
        const req = res.request();
        const rec = requestStatusMap.get(req);
        if (rec) {
          rec.status = res.status();
        }
      }
    });

    page.on('requestfailed', (req) => {
      if (vp.name === '1440x900') {
        const rec = requestStatusMap.get(req);
        if (rec) {
          rec.status = 0;
          rec.errorText = req.failure()?.errorText || 'network_error';
        }
      }
    });

    const appUrl = `${baseUrl}/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`;
    log(`Navigating to: ${appUrl}`);
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait for boot
    await page.waitForFunction(
      () => {
        const loading = document.querySelector('#loading-screen');
        const canvas = document.querySelector('canvas');
        const dm = window.__godsEyeView?.dataManager;
        return (loading && loading.classList.contains('hidden')) || (canvas && dm);
      },
      { timeout: 90000 }
    ).catch(() => {});

    await new Promise((r) => setTimeout(r, 2000));

    // Open mini chat for earthquake object
    log('Opening mini chat for earthquake object...');
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

    await page.waitForFunction(
      () => {
        const el = document.getElementById('ondemand-mini-chat');
        return el && el.getAttribute('data-open') === 'true';
      },
      { timeout: 20000 }
    );
    log('Mini chat is open.');

    // -------------------------------------------------------------------------
    // (p1) rAF coalescing
    // -------------------------------------------------------------------------
    log('\n--- Step (p1): rAF Coalescing Measurement ---');

    await page.evaluate(() => {
      window.__perfInstrumentation = {
        active: true,
        literalDeltaEvents: 0,
        wireDeltaEvents: 0,
        rafCalls: 0,
        mutationBatches: 0,
        mutationIntervals: [],
        lastMutationTime: 0,
        streamText: '',
      };

      // 1. Wrap window.requestAnimationFrame
      const originalRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function (cb) {
        if (window.__perfInstrumentation?.active) {
          window.__perfInstrumentation.rafCalls++;
        }
        return originalRaf.call(window, cb);
      };

      // 2. Wrap ReadableStreamDefaultReader.prototype.read
      if (typeof ReadableStreamDefaultReader !== 'undefined') {
        const originalRead = ReadableStreamDefaultReader.prototype.read;
        const decoder = new TextDecoder();
        ReadableStreamDefaultReader.prototype.read = async function (...readArgs) {
          const res = await originalRead.apply(this, readArgs);
          if (res && res.value && window.__perfInstrumentation?.active) {
            try {
              const chunk = typeof res.value === 'string' ? res.value : decoder.decode(res.value, { stream: true });
              window.__perfInstrumentation.streamText += chunk;

              // Literal occurrences of "event: delta"
              const litMatches = window.__perfInstrumentation.streamText.match(/event:\s*delta/g);
              window.__perfInstrumentation.literalDeltaEvents = litMatches ? litMatches.length : 0;

              // Wire delta occurrences: event: delta OR event: message with answer/fulfillment
              const wireMatches = window.__perfInstrumentation.streamText.match(/event:\s*delta|"eventType"\s*:\s*"fulfillment"|"answer"\s*:/g);
              window.__perfInstrumentation.wireDeltaEvents = wireMatches ? wireMatches.length : 0;
            } catch (err) {}
          }
          return res;
        };
      }

      // 3. MutationObserver on transcript
      const transcript = document.getElementById('ondemand-mini-chat-transcript');
      if (transcript) {
        const observer = new MutationObserver(() => {
          if (!window.__perfInstrumentation?.active) return;
          window.__perfInstrumentation.mutationBatches++;
          const now = performance.now();
          if (window.__perfInstrumentation.lastMutationTime > 0) {
            window.__perfInstrumentation.mutationIntervals.push(now - window.__perfInstrumentation.lastMutationTime);
          }
          window.__perfInstrumentation.lastMutationTime = now;
        });

        observer.observe(transcript, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        window.__perfInstrumentation.observer = observer;
      }
    });

    log('Instrumented rAF, ReadableStreamDefaultReader, and MutationObserver. Sending p1 question...');

    const p1Question = 'Describe this object in three sentences.';
    await sendQueryAndWait(page, p1Question);

    // Capture p1 results
    const p1Data = await page.evaluate(() => {
      if (window.__perfInstrumentation) {
        window.__perfInstrumentation.active = false;
        const lastTurn = window.__godsEyeView?.miniChat?.getState?.()?.turns?.at(-1);
        return {
          literalDeltaEvents: window.__perfInstrumentation.literalDeltaEvents,
          wireDeltaEvents: window.__perfInstrumentation.wireDeltaEvents,
          turnTokens: lastTurn?.tokens || 0,
          rafCalls: window.__perfInstrumentation.rafCalls,
          mutationBatches: window.__perfInstrumentation.mutationBatches,
          mutationIntervals: window.__perfInstrumentation.mutationIntervals,
        };
      }
      return null;
    });

    const literalDeltaEvents = p1Data?.literalDeltaEvents || 0;
    // In OnDemand v2, wire SSE uses event: message (contract §4), parsed into type: 'delta' and counted in turn.tokens
    const deltaEvents = p1Data?.literalDeltaEvents > 0
      ? p1Data.literalDeltaEvents
      : (p1Data?.turnTokens || p1Data?.wireDeltaEvents || 0);

    const rafCalls = p1Data?.rafCalls || 0;
    const mutationBatches = p1Data?.mutationBatches || 0;
    const ratio = mutationBatches > 0 ? deltaEvents / mutationBatches : 0;
    const medianIntervalMs = calculateMedian(p1Data?.mutationIntervals || []);

    const p1Pass = deltaEvents > 1 && mutationBatches <= deltaEvents;

    log(`p1 metrics: deltaEvents=${deltaEvents} (literal "event: delta"=${literalDeltaEvents}, turnTokens=${p1Data?.turnTokens}), rafCalls=${rafCalls}, mutationBatches=${mutationBatches}`);
    log(`p1 ratio (deltas/mutationBatches)=${ratio.toFixed(3)}, medianIntervalMs=${medianIntervalMs.toFixed(2)} ms`);
    log(`p1 PASS=${p1Pass} (expected deltaEvents > 1 and mutationBatches <= deltaEvents)`);

    await captureScreenshot(page, `perf-p1-${vp.name}.jpg`);

    // -------------------------------------------------------------------------
    // (p2) list virtualization
    // -------------------------------------------------------------------------
    log('\n--- Step (p2): List Virtualization Measurement ---');

    const p2Initial = await page.evaluate(() => {
      const state = window.__godsEyeView?.miniChat?.getState?.();
      const activityInMemory = Array.isArray(state?.activity) ? state.activity.length : 0;
      const rowsRendered = document.querySelectorAll('.od-chat__activity-row').length;
      return { activityInMemory, rowsRendered };
    });

    log(`p2 initial: activityInMemory=${p2Initial.activityInMemory}, rowsRendered=${p2Initial.rowsRendered}`);

    // Stress test: 3 quick turns ("One word: ok.")
    for (let i = 1; i <= 3; i++) {
      log(`Stress turn ${i}/3...`);
      await sendQueryAndWait(page, 'One word: ok.');
    }

    const p2AfterStress = await page.evaluate(() => {
      const state = window.__godsEyeView?.miniChat?.getState?.();
      const activityInMemory = Array.isArray(state?.activity) ? state.activity.length : 0;
      const rowsRendered = document.querySelectorAll('.od-chat__activity-row').length;
      return { activityInMemory, rowsRendered };
    });

    const p2Pass = p2AfterStress.rowsRendered <= 6 && p2AfterStress.activityInMemory <= 200;
    log(`p2 after stress: activityInMemory=${p2AfterStress.activityInMemory}, rowsRendered=${p2AfterStress.rowsRendered}`);
    log(`p2 PASS=${p2Pass} (expected rowsRendered <= 6 and activityInMemory <= 200)`);

    // -------------------------------------------------------------------------
    // (p3) scroll anchoring
    // -------------------------------------------------------------------------
    log('\n--- Step (p3): Scroll Anchoring Measurement ---');

    const longQuestion = 'Explain, in at least twelve sentences, how earthquakes are measured and reported.';
    log(`Sending long question: "${longQuestion}"`);

    await page.evaluate((text) => {
      const input = document.getElementById('ondemand-mini-chat-input');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.getElementById('ondemand-mini-chat-send')?.click();
    }, longQuestion);

    // Wait for the first delta to arrive (non-empty assistant streaming message text)
    log('Waiting for first streaming delta to arrive...');
    await page.waitForFunction(() => {
      const el = document.querySelector('.od-chat__msg--assistant[data-streaming]');
      return el && el.textContent.trim().length > 0;
    }, { timeout: 30000 });

    log('First delta arrived. Waiting 1.5s as specified by brief...');
    await new Promise((r) => setTimeout(r, 1500));

    // Wait for content to overflow transcript so user can scroll up
    await page.waitForFunction(() => {
      const t = document.getElementById('ondemand-mini-chat-transcript');
      return t && (t.scrollHeight - t.clientHeight > 40);
    }, { timeout: 15000 });

    // Scroll up to 0 and trigger scroll event
    log('Setting scrollTop = 0 and triggering scroll event...');
    await page.evaluate(() => {
      const t = document.getElementById('ondemand-mini-chat-transcript');
      if (t) {
        t.scrollTo({ top: 0, behavior: 'instant' });
        t.dispatchEvent(new Event('scroll'));
      }
    });

    // Sample scrollTop every 100ms until stream completes
    const scrollSamples = [];
    log('Sampling scrollTop every 100ms until stream completion...');
    while (true) {
      const sample = await page.evaluate(() => {
        const t = document.getElementById('ondemand-mini-chat-transcript');
        const s = document.getElementById('ondemand-mini-chat-status')?.textContent || '';
        const stop = document.getElementById('ondemand-mini-chat-stop');
        const stopHidden = !stop || stop.hidden || stop.style.display === 'none';
        const busy = window.__godsEyeView?.miniChat?.getState?.()?.busy;
        const isDone = (s.includes('READY') || s.includes('IDLE')) && stopHidden && !busy;
        return {
          scrollTop: t ? t.scrollTop : 0,
          scrollHeight: t ? t.scrollHeight : 0,
          clientHeight: t ? t.clientHeight : 0,
          isDone,
        };
      });

      scrollSamples.push(sample.scrollTop);
      if (sample.isDone) {
        log(`Stream completed. Collected ${scrollSamples.length} samples.`);
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const minScrollTop = Math.min(...scrollSamples);
    const maxScrollTop = Math.max(...scrollSamples);
    const anchoringHeld = maxScrollTop <= 40;

    log(`Scroll samples range: min=${minScrollTop}, max=${maxScrollTop}, count=${scrollSamples.length}`);
    log(`Anchoring held during stream (maxScrollTop <= 40): ${anchoringHeld}`);

    await captureScreenshot(page, `perf-p3-${vp.name}.jpg`);

    // Send a short follow-up without touching scroll and assert transcript is pinned to bottom at completion
    log('Sending short follow-up without touching scroll: "One word: acknowledged."');
    await sendQueryAndWait(page, 'One word: acknowledged.');

    const followUpScroll = await page.evaluate(() => {
      const t = document.getElementById('ondemand-mini-chat-transcript');
      if (!t) return { scrollHeight: 0, scrollTop: 0, clientHeight: 0, diff: 9999, pinned: false };
      const diff = t.scrollHeight - t.scrollTop - t.clientHeight;
      return {
        scrollHeight: t.scrollHeight,
        scrollTop: t.scrollTop,
        clientHeight: t.clientHeight,
        diff,
        pinned: diff < 40,
      };
    });

    log(`Follow-up scroll state: scrollHeight=${followUpScroll.scrollHeight}, scrollTop=${followUpScroll.scrollTop}, clientHeight=${followUpScroll.clientHeight}, diff=${followUpScroll.diff}`);
    log(`Pinned to bottom (diff < 40): ${followUpScroll.pinned}`);

    const p3Pass = anchoringHeld && followUpScroll.pinned;
    log(`p3 overall PASS=${p3Pass} (anchoringHeld=${anchoringHeld}, pinnedToBottom=${followUpScroll.pinned})`);

    // If 1440x900, run one voice turn to capture voice network traffic
    if (vp.name === '1440x900') {
      log('\n--- Step (Part 3 s3 voice turn): window.__odVoice.submitText ---');
      try {
        await page.evaluate(async () => {
          if (window.__odVoice?.submitText) {
            try {
              await Promise.race([
                window.__odVoice.submitText('Say hello in five words.'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Voice turn timeout')), 25000)),
              ]);
            } catch (err) {
              console.warn('Voice submitText note:', err.message);
            }
          }
        });
        log('Voice turn executed.');
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        log(`Voice turn error: ${err.message}`);
      }
    }

    perfResults.viewports[vp.name] = {
      p1: {
        question: p1Question,
        deltaEvents,
        literalDeltaEvents,
        turnTokens: p1Data?.turnTokens,
        rafCalls,
        mutationBatches,
        deltasToMutationBatchesRatio: Number(ratio.toFixed(3)),
        medianIntervalMs: Number(medianIntervalMs.toFixed(2)),
        mutationIntervalsSample: p1Data?.mutationIntervals?.slice(0, 20) || [],
        pass: p1Pass,
      },
      p2: {
        initial: p2Initial,
        afterStress: p2AfterStress,
        pass: p2Pass,
      },
      p3: {
        longQuestion,
        minScrollTop,
        maxScrollTop,
        samplesCount: scrollSamples.length,
        anchoringHeld,
        followUp: {
          question: 'One word: acknowledged.',
          ...followUpScroll,
        },
        pass: p3Pass,
      },
    };

    await page.close();
  }
} catch (outerErr) {
  log(`Outer error in perf run: ${outerErr?.stack || outerErr}`);
} finally {
  clearTimeout(globalTimer);
  perfResults.endedAt = ts();

  // Write perf.json
  const perfPath = path.join(outDir, 'perf.json');
  fs.writeFileSync(perfPath, JSON.stringify(perfResults, null, 2), 'utf8');
  log(`Wrote perf report to ${perfPath}`);

  // Write network-log.json
  const netPath = path.join(outDir, 'network-log.json');
  fs.writeFileSync(netPath, JSON.stringify(networkRequests, null, 2), 'utf8');
  log(`Wrote network log (${networkRequests.length} requests) to ${netPath}`);

  hardKill();
}
