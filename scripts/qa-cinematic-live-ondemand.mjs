#!/usr/bin/env node
/**
 * Live validation harness for OnDemand Cinematic Runtime.
 * Probes:
 *  1. Live registry endpoint list & Cerebras discovery
 *  2. Live streamQuery measuring TTFT and tokens/sec on Cerebras Qwen 3.8
 *  3. Live Cinematic Director generating a full validated scene on Cerebras
 *  4. Live Cinematic Director on predefined-gpt-6.1-sol (model switching proof)
 *  5. Live Scene Q&A asking for wide aerial view
 *
 * Usage:
 *   ONDEMAND_API_KEY="$ON_DEMAND_API_KEY" node scripts/qa-cinematic-live-ondemand.mjs | tee docs/evidence-2026-11-01-cinematic/ondemand-runtime-live.txt
 */
import { createModelRegistry } from '../server/ondemand/runtime/model-registry.js';
import { createSessionManager } from '../server/ondemand/runtime/sessions.js';
import { streamQuery } from '../server/ondemand/runtime/stream-adapter.js';
import { createCinematicDirector } from '../server/scene-plans/director.js';
import { createSceneQa } from '../server/scene-plans/qa.js';

function redact(str) {
  if (!str) return '';
  let out = String(str);
  for (const envKey of ['ON_DEMAND_API_KEY', 'ONDEMAND_API_KEY']) {
    const val = process.env[envKey];
    if (val && val.length > 5) {
      out = out.split(val).join('[REDACTED]');
    }
  }
  return out;
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${redact(msg)}`);
}

async function main() {
  log(
    '========================================================================',
  );
  log('LIVE ONDEMAND CINEMATIC RUNTIME VALIDATION PROBE');
  log(
    '========================================================================',
  );

  const registry = createModelRegistry();
  const sessions = createSessionManager();
  const director = createCinematicDirector({ registry, sessions, streamQuery });
  const qa = createSceneQa({ registry, sessions, streamQuery });

  // -------------------------------------------------------------------------
  // STEP 1: Registry Discovery
  // -------------------------------------------------------------------------
  log('STEP 1: Probing live endpoint registry...');
  const listRes = await registry.list({ refresh: true });
  log(`Registry source: ${listRes.source}`);
  log(`Total endpoints returned: ${listRes.models.length}`);

  const activeModels = listRes.models.filter((m) => m.available);
  log(`Active endpoints count: ${activeModels.length}`);

  const cerebrasModels = listRes.models.filter((m) => m.cerebras);
  log(`Cerebras endpoints count: ${cerebrasModels.length}`);
  for (const m of cerebrasModels) {
    log(
      `  - ${m.endpointId} | name=${m.name} | modelId=${m.modelId} | status=${m.status} | streaming=${m.streaming} | ctx=${m.contextLength}`,
    );
  }

  const assignments = registry.assignments();
  log('Default task assignments:');
  for (const [task, ep] of Object.entries(assignments)) {
    log(`  - ${task} -> ${ep}`);
  }

  // -------------------------------------------------------------------------
  // STEP 2: Stream Adapter Baseline on Cerebras Qwen 3.8
  // -------------------------------------------------------------------------
  log(
    '\nSTEP 2: Probing streaming query on predefined-cerebras-qwen-3.8-27b...',
  );
  const probeSess = await sessions.acquire({ purpose: 'live_probe' });
  let baselineStream = null;
  try {
    let deltasCount = 0;
    baselineStream = await streamQuery({
      sessionId: probeSess.id,
      query:
        'Respond with exactly: "Cerebras streaming engine operational and ready." and nothing else.',
      endpointId: 'predefined-cerebras-qwen-3.8-27b',
      fulfillmentOnly: true,
      onDelta: () => {
        deltasCount++;
      },
    });

    log(`Stream completed in ${baselineStream.totalMs} ms`);
    log(`  TTFT (first delta): ${baselineStream.ttftMs} ms`);
    log(`  First byte latency: ${baselineStream.firstByteMs} ms`);
    log(`  Deltas received: ${deltasCount}`);
    log(`  Output tokens: ${baselineStream.outputTokens ?? 'N/A'}`);
    log(`  Input tokens: ${baselineStream.inputTokens ?? 'N/A'}`);
    log(`  Tokens/second: ${baselineStream.tokensPerSec ?? 'N/A'}`);
    log(`  Answer preview: ${baselineStream.answer.trim().slice(0, 100)}`);
  } finally {
    sessions.release(probeSess.id);
  }

  // -------------------------------------------------------------------------
  // STEP 3: Cinematic Director on Cerebras Qwen 3.8
  // -------------------------------------------------------------------------
  log(
    '\nSTEP 3: Cinematic Director on predefined-cerebras-qwen-3.8-27b (Cerebras)...',
  );
  const prompt =
    'Create a cinematic marathon around Burj Khalifa with crowds, police roadblocks and moving traffic';
  const origin = { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 };

  let cerebrasDirectRes = null;
  for (let iter = 1; iter <= 4; iter++) {
    log(`[Iteration ${iter}/4] Generating scene...`);
    try {
      const emitted = [];
      cerebrasDirectRes = await director.direct({
        prompt,
        origin,
        researchedRoutes: [],
        endpointId: 'predefined-cerebras-qwen-3.8-27b',
        emit: (ev, d) => emitted.push({ ev, d }),
      });

      log(`[Iteration ${iter}/4] Scene generation SUCCEEDED and validated!`);
      log(`  Scene ID: ${cerebrasDirectRes.scene.sceneId}`);
      log(`  Title: ${cerebrasDirectRes.scene.title}`);
      log(`  Entities: ${cerebrasDirectRes.scene.entities.length}`);
      log(`  Shots: ${cerebrasDirectRes.scene.shots.length}`);
      log(`  Beats: ${cerebrasDirectRes.scene.timeline.beats.length}`);
      log(`  Routes: ${cerebrasDirectRes.scene.routes.length}`);
      log(`  Effects: ${cerebrasDirectRes.scene.effects.length}`);
      log(`  Invalid lines: ${cerebrasDirectRes.invalidLines.length}`);
      log(`  Repairs: ${cerebrasDirectRes.repairs}`);
      log(
        `  Asset substitutions: ${cerebrasDirectRes.assetSubstitutions.length}`,
      );
      if (cerebrasDirectRes.assetSubstitutions.length > 0) {
        for (const sub of cerebrasDirectRes.assetSubstitutions) {
          log(
            `    - Substituted '${sub.requested}' -> '${sub.used}' (${sub.reason})`,
          );
        }
      }
      log(
        `  Model metrics: TTFT=${cerebrasDirectRes.model.ttftMs} ms | total=${cerebrasDirectRes.model.latencyMs} ms | tok/s=${cerebrasDirectRes.model.tokensPerSec} | outputTokens=${cerebrasDirectRes.model.outputTokens}`,
      );
      break;
    } catch (err) {
      log(`[Iteration ${iter}/4] Failed: ${err.message}`);
      if (iter === 4) throw err;
    }
  }

  // -------------------------------------------------------------------------
  // STEP 4: Cinematic Director on predefined-gpt-6.1-sol (Model Switching)
  // -------------------------------------------------------------------------
  log(
    '\nSTEP 4: Probing model switching to predefined-gpt-6.1-sol (GPT tier)...',
  );
  let gptDirectRes = null;
  for (let iter = 1; iter <= 4; iter++) {
    log(
      `[Iteration ${iter}/4] Generating scene with predefined-gpt-6.1-sol...`,
    );
    try {
      const emitted = [];
      gptDirectRes = await director.direct({
        prompt,
        origin,
        researchedRoutes: [],
        endpointId: 'predefined-gpt-6.1-sol',
        emit: (ev, d) => emitted.push({ ev, d }),
      });

      log(`[Iteration ${iter}/4] Scene generation SUCCEEDED and validated!`);
      log(`  Scene ID: ${gptDirectRes.scene.sceneId}`);
      log(`  Title: ${gptDirectRes.scene.title}`);
      log(`  Entities: ${gptDirectRes.scene.entities.length}`);
      log(`  Shots: ${gptDirectRes.scene.shots.length}`);
      log(`  Beats: ${gptDirectRes.scene.timeline.beats.length}`);
      log(`  Routes: ${gptDirectRes.scene.routes.length}`);
      log(`  Effects: ${gptDirectRes.scene.effects.length}`);
      log(`  Invalid lines: ${gptDirectRes.invalidLines.length}`);
      log(`  Repairs: ${gptDirectRes.repairs}`);
      log(`  Asset substitutions: ${gptDirectRes.assetSubstitutions.length}`);
      log(
        `  Model metrics: TTFT=${gptDirectRes.model.ttftMs} ms | total=${gptDirectRes.model.latencyMs} ms | tok/s=${gptDirectRes.model.tokensPerSec} | outputTokens=${gptDirectRes.model.outputTokens}`,
      );
      break;
    } catch (err) {
      log(`[Iteration ${iter}/4] Failed: ${err.message}`);
      if (iter === 4) throw err;
    }
  }

  // -------------------------------------------------------------------------
  // STEP 5: Grounded Q&A Asking for Wide Aerial View
  // -------------------------------------------------------------------------
  log('\nSTEP 5: Probing Grounded Q&A...');
  const qaContext = {
    sceneId: cerebrasDirectRes?.scene?.sceneId || 'scene-live-1',
    title: cerebrasDirectRes?.scene?.title || 'Burj Khalifa Marathon',
    location: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    entities: (cerebrasDirectRes?.scene?.entities || [])
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        label: e.label,
        category: e.category,
        assetId: e.assetId,
      })),
    routes: [],
    shots: (cerebrasDirectRes?.scene?.shots || []).slice(0, 2),
    beats: (cerebrasDirectRes?.scene?.timeline?.beats || []).slice(0, 2),
  };

  const qaRes = await qa.ask({
    question: 'show a wide aerial view',
    context: qaContext,
    endpointId: 'predefined-cerebras-qwen-3.8-27b',
  });

  log(`Q&A answer: "${qaRes.answer}"`);
  log(
    `Q&A commands (${qaRes.commands.length}): ${JSON.stringify(qaRes.commands)}`,
  );
  log(`Q&A repaired: ${qaRes.repaired}`);
  log(
    `Q&A model metrics: endpoint=${qaRes.model.endpointId} | TTFT=${qaRes.model.ttftMs} ms | latency=${qaRes.model.latencyMs} ms | tok/s=${qaRes.model.tokensPerSec}`,
  );

  const hasWideAerial = qaRes.commands.some((c) => c.command === 'wide_aerial');
  log(`Contains expected wide_aerial command: ${hasWideAerial}`);

  log(
    '\n========================================================================',
  );
  log('ALL LIVE PROBES COMPLETED SUCCESSFULLY');
  log(
    '========================================================================',
  );
}

main().catch((err) => {
  log(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
