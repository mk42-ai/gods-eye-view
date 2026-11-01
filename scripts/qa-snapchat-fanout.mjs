/**
 * scripts/qa-snapchat-fanout.mjs
 *
 * Live Before/After counter for Snapchat footage ingestion:
 *   - BEFORE: single-name call with limit 5 (old behavior)
 *   - AFTER:  fan-out across place-name variants with limit 25 and concurrency 4
 *
 * Evaluated across 3 scenes:
 *   1. 'Dubai Marina' (25.0805, 55.1403)
 *   2. 'Burj Al Arab' (25.1412, 55.1853)
 *   3. 'kanes boxing gym abu dhabi' (24.4950, 54.3780 approx - approximate)
 *
 * Generates:
 *   - docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.json
 *   - docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.txt
 *
 * NOTE: All SAS URLs are strictly redacted (host + path only; query strings stripped).
 * No API key material is ever logged or written.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOnDemandClient } from '../server/ondemand/foundation/client.js';
import { resolveServerKey } from '../server/ondemand/server-key.js';
import {
  buildQuery,
  extractPluginJson,
  redactMediaUrl,
  withBackoff,
} from '../server/scene-footage/snapchat.js';
import {
  expandPlaceVariants,
  runFanout,
} from '../server/scene-footage/fanout.js';
import { createChatBatchClient } from '../server/scene-footage/chat-batch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EVIDENCE_DIR = resolve(
  ROOT,
  'docs/evidence-2026-11-01-fanout-sse/phase-a',
);

mkdirSync(EVIDENCE_DIR, { recursive: true });

function redactSas(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split('?')[0];
  }
}

const SCENES = [
  {
    name: 'Dubai Marina',
    lat: 25.0805,
    lon: 55.1403,
    approximate: false,
  },
  {
    name: 'Burj Al Arab',
    lat: 25.1412,
    lon: 55.1853,
    approximate: false,
  },
  {
    name: 'kanes boxing gym abu dhabi',
    lat: 24.495,
    lon: 54.378,
    approximate: true, // approximate coordinates
  },
];

async function executeSingleQuery(client, variant, limit, scene) {
  const step = { level: 'landmark', names: [variant], wider: false };
  const query = buildQuery({
    scene: {
      locationId: `qa-${variant.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}`,
      lat: scene.lat,
      lon: scene.lon,
      placeName: variant,
    },
    step,
    limit,
    pluginId: 'plugin-1792945050',
  });

  const session = await client.sessions.create({
    externalUserId: 'gev-qa-before-after',
    pluginIds: ['plugin-1792945050'],
  });

  let res = await client.query.sync(
    session.id,
    {
      query,
      endpointId: 'predefined-openai-gpt4.1-mini',
      responseMode: 'sync',
      pluginIds: ['plugin-1792945050'],
    },
    { timeoutMs: 120_000 },
  );

  let data = res?.data || res || {};
  const messageId = data.messageId;
  let polls = 0;
  while (data.status === 'processing' && polls < 20) {
    await new Promise((r) => setTimeout(r, 1000));
    data = await client.sessions.message(session.id, messageId, {
      timeoutMs: 10_000,
    });
    polls++;
  }

  const json = extractPluginJson(data.answer);
  return json || { limit, results: [] };
}

async function run() {
  const tStart = new Date().toISOString();
  console.log(`[QA] Starting Snapchat Fan-Out Before/After Probe at ${tStart}`);

  const { value: serverKey } = resolveServerKey();
  if (!serverKey) {
    throw new Error('ONDEMAND_API_KEY is not configured in environment.');
  }

  // 1. Probe Chat Batch endpoint
  console.log('[QA] Probing POST /chat/v1/batches once...');
  const batchClient = createChatBatchClient({
    apiKeyProvider: () => serverKey,
  });
  const batchProbe = await batchClient.submitBatch([{ query: 'probe' }]);
  console.log(
    `[QA] Chat Batch Probe result: available=${batchProbe.available}, status=${batchProbe.status}`,
  );

  const client = createOnDemandClient({ retry: { retries: 0 } });
  const results = [];

  for (const scene of SCENES) {
    console.log(`\n========================================`);
    console.log(
      `[QA] Evaluating Scene: "${scene.name}" (${scene.approximate ? 'approximate ' : ''}${scene.lat}, ${scene.lon})`,
    );

    // --- BEFORE: Single-name call, limit 5 ---
    console.log(
      `[QA] [BEFORE] Running single-name query: "${scene.name}", limit=5...`,
    );
    const beforeT0 = Date.now();
    let beforeRaw = 0;
    let beforeUnique = 0;
    let beforeStoryIds = [];
    let beforeVideos = [];
    let beforeError = null;

    try {
      const beforeJson = await executeSingleQuery(client, scene.name, 5, scene);
      const resultsArray = beforeJson.results || [];
      const videos = resultsArray.flatMap((r) =>
        Array.isArray(r.videos) ? r.videos : [],
      );
      beforeRaw = videos.length;
      const seen = new Set();
      for (const v of videos) {
        if (v.storyId && !seen.has(v.storyId)) {
          seen.add(v.storyId);
          beforeStoryIds.push(v.storyId);
          beforeVideos.push({
            storyId: v.storyId,
            caption: v.description || '(none)',
            durationMs: v.durationMs,
            storageUrl: redactSas(v.storageUrl),
            uploadDateMs: v.uploadDateMs,
          });
        }
      }
      beforeUnique = seen.size;
    } catch (err) {
      beforeError = err.message || String(err);
      console.error(`[QA] [BEFORE] Error for ${scene.name}:`, beforeError);
    }
    const beforeElapsedMs = Date.now() - beforeT0;
    console.log(
      `[QA] [BEFORE] Done in ${beforeElapsedMs}ms: raw=${beforeRaw}, unique=${beforeUnique}`,
    );

    // --- AFTER: Fan-out, limit 25, concurrency 4 ---
    // Generate variants
    const allVariants = expandPlaceVariants({
      placeName: scene.name,
      lat: scene.lat,
      lon: scene.lon,
      scope: 'balanced',
      maxVariants: 6,
    });
    console.log(
      `[QA] [AFTER] Fan-out variants (${allVariants.length}): ${JSON.stringify(allVariants)}`,
    );

    const afterT0 = Date.now();
    let afterRes = null;
    let afterError = null;

    try {
      afterRes = await runFanout({
        variants: allVariants,
        callOne: async (variant, { limit }) => {
          return await executeSingleQuery(client, variant, limit, scene);
        },
        limit: 25,
        concurrency: 4,
        timeoutMs: 120_000,
        backoff: { attempts: 2, baseMs: 1000 },
        onProgress: ({ variant, done, total }) => {
          console.log(`[QA] [AFTER] Progress: ${done}/${total} (${variant})`);
        },
      });
    } catch (err) {
      afterError = err.message || String(err);
      console.error(`[QA] [AFTER] Error for ${scene.name}:`, afterError);
    }
    const afterElapsedMs = Date.now() - afterT0;

    const afterVideos = (afterRes?.clips || []).map((v) => ({
      storyId: v.storyId,
      caption: v.description || v.caption || '(none)',
      durationMs: v.durationMs,
      storageUrl: redactSas(v.storageUrl || v.mediaUrl),
      uploadDateMs: v.uploadDateMs || v.publicationTimeRaw,
    }));

    const sceneResult = {
      scene: scene.name,
      coordinates: {
        lat: scene.lat,
        lon: scene.lon,
        approximate: scene.approximate,
      },
      timestampUtc: new Date().toISOString(),
      before: {
        strategy: 'single-name',
        query: scene.name,
        limit: 5,
        elapsedMs: beforeElapsedMs,
        raw: beforeRaw,
        unique: beforeUnique,
        storyIds: beforeStoryIds,
        videos: beforeVideos,
        error: beforeError,
      },
      after: {
        strategy: 'fan-out',
        variantsTried: allVariants,
        limit: 25,
        concurrency: 4,
        elapsedMs: afterElapsedMs,
        counts: afterRes?.counts || {
          verified: 0,
          candidate: 0,
          raw: 0,
          unique: 0,
          variantsTried: allVariants.length,
          truncatedVariants: 0,
        },
        variantStats: afterRes?.variants || [],
        storyIds: afterVideos.map((v) => v.storyId).filter(Boolean),
        videos: afterVideos,
        error: afterError,
      },
      delta: {
        rawDiff: (afterRes?.counts?.raw || 0) - beforeRaw,
        uniqueDiff: (afterRes?.counts?.unique || 0) - beforeUnique,
      },
    };

    results.push(sceneResult);
    console.log(
      `[QA] Summary for "${scene.name}": Before=${beforeUnique} unique -> After=${afterRes?.counts?.unique || 0} unique (Δ +${sceneResult.delta.uniqueDiff})`,
    );
  }

  const tEnd = new Date().toISOString();

  const finalOutput = {
    generatedAtUtc: tEnd,
    startedAtUtc: tStart,
    chatBatchCapability: {
      available: batchProbe.available,
      status: batchProbe.status,
      body: batchProbe.body,
    },
    scenes: results,
  };

  // Write JSON
  const jsonPath = resolve(EVIDENCE_DIR, 'fanout-before-after.json');
  writeFileSync(jsonPath, JSON.stringify(finalOutput, null, 2), 'utf-8');
  console.log(`\n[QA] Wrote evidence JSON: ${jsonPath}`);

  // Write human-readable TXT
  let txt = `================================================================================
SNAPCHAT FOOTAGE FAN-OUT INGESTION AUDIT: BEFORE VS AFTER
Generated: ${tEnd} (Started: ${tStart})
Transport: OnDemand Chat API (predefined-openai-gpt4.1-mini) + plugin-1792945050
Batch API: POST /chat/v1/batches -> HTTP ${batchProbe.status} (${batchProbe.body})
================================================================================

EXECUTIVE SUMMARY
-----------------
`;

  for (const r of results) {
    txt += `Scene: "${r.scene}" (${r.coordinates.approximate ? 'approx. ' : ''}${r.coordinates.lat}, ${r.coordinates.lon})
  BEFORE (single-name, limit 5):  ${r.before.raw} raw / ${r.before.unique} unique (${(r.before.elapsedMs / 1000).toFixed(1)}s)
  AFTER  (fan-out, limit 25):      ${r.after.counts.raw} raw / ${r.after.counts.unique} unique (${(r.after.elapsedMs / 1000).toFixed(1)}s)
  DELTA:                          +${r.delta.rawDiff} raw / +${r.delta.uniqueDiff} unique IDs
  Variants tried (${r.after.variantsTried.length}):
${r.after.variantStats.map((v) => `    • "${v.variant}": raw=${v.raw}, unique=${v.unique}, ms=${v.ms}${v.truncated ? ' [TRUNCATED]' : ''}${v.error ? ` [ERROR: ${v.error}]` : ''}`).join('\n')}
  Story IDs (SAS Redacted):
${r.after.videos.map((v) => `    - [${v.storyId}] ${(v.caption || '').replace(/\s+/g, ' ').slice(0, 50)} (${v.storageUrl})`).join('\n') || '    (none)'}

--------------------------------------------------------------------------------
`;
  }

  const txtPath = resolve(EVIDENCE_DIR, 'fanout-before-after.txt');
  writeFileSync(txtPath, txt, 'utf-8');
  console.log(`[QA] Wrote evidence TXT: ${txtPath}`);
  console.log('[QA] Complete!');
}

run().catch((err) => {
  console.error('[QA] Fatal probe error:', err);
  process.exit(1);
});
