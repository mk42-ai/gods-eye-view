/**
 * scripts/qa-snapchat-live-probe.mjs
 *
 * Live QA probe for the DIRECT plugin path of Snapchat discovery
 * (plugin-1792945050). It drives the production retrieval function
 * (`retrieveSnapchatFootage`) with the real foundation client, so what is
 * measured here is exactly what the deployed route executes:
 *
 *   POST /chat/v1/sessions                  reused pool (≤3) per discovery run
 *   POST /chat/v1/sessions/{id}/query       one SYNC query per place-name variant
 *                                            (pluginIds [plugin], max 3 in flight,
 *                                             30 s per request, backoff on 409/429/5xx)
 *
 * Verified against the live OnDemand Chat API docs (createchatsession /
 * submitquery, 2026-11-02). No legacy multi-query transport exists in this code base.
 *
 * Usage:
 *   node scripts/qa-snapchat-live-probe.mjs [--out docs/evidence-<date>/snapchat-direct-probe]
 *
 * NEVER prints, logs, or records any API key or secret.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  footageConfig,
  retrieveSnapchatFootage,
  redactMediaUrl,
} from '../server/scene-footage/snapchat.js';
import { createOnDemandClient } from '../server/ondemand/foundation/client.js';
import { isConfigured } from '../server/ondemand/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const OUT_DIR = resolve(
  ROOT,
  outArg || 'docs/evidence-2026-11-02-direct-plugin/snapchat-direct-probe',
);
mkdirSync(OUT_DIR, { recursive: true });
const JSON_OUT = resolve(OUT_DIR, 'snapchat-direct-probe.json');
const MD_OUT = resolve(OUT_DIR, 'snapchat-direct-probe.md');

// The container exports ON_DEMAND_API_KEY; the app reads ONDEMAND_API_KEY.
if (!process.env.ONDEMAND_API_KEY && process.env.ON_DEMAND_API_KEY) {
  process.env.ONDEMAND_API_KEY = process.env.ON_DEMAND_API_KEY;
}
if (!isConfigured()) {
  console.error(
    'ERROR: ONDEMAND_API_KEY (or ON_DEMAND_API_KEY) must be set in environment.',
  );
  process.exit(1);
}

function redactString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(
      /(?:key|apikey|token|secret)[=:][\s"']*([A-Za-z0-9_\-.]{8,})/gi,
      (match) => match.slice(0, 10) + '...[REDACTED]',
    )
    .replace(/sig=([A-Za-z0-9%_-]+)/gi, 'sig=[REDACTED]');
}

/** The three probes requested by the user (prompt → anchored scene). */
const PROBES = [
  {
    prompt: 'Dubai Marina raid',
    scene: {
      locationId: 'snap-dubai-marina',
      lat: 25.0786415,
      lon: 55.1352524,
      placeName: 'Dubai Marina',
      text: 'Dubai Marina raid',
      scope: 'balanced',
    },
  },
  {
    prompt: 'boxing gym',
    scene: {
      locationId: 'snap-kanes-boxing-gym-abu-dhabi',
      lat: 24.4539,
      lon: 54.3773,
      placeName: "Kane's Boxing Gym Abu Dhabi",
      text: 'boxing gym',
      nearbyNames: ['Al Zahiyah', 'Abu Dhabi'],
      scope: 'balanced',
    },
  },
  {
    prompt: 'Yas Mall crash',
    scene: {
      locationId: 'snap-yas-mall',
      lat: 24.4886,
      lon: 54.6081,
      placeName: 'Yas Mall',
      text: 'Yas Mall crash',
      nearbyNames: ['Yas Island'],
      scope: 'balanced',
    },
  },
];

const cfg = { ...footageConfig(process.env), verifyMedia: false };
const baseClient = createOnDemandClient({ retry: { retries: 0 } });
// Wrap the documented sync query so the raw plugin answer of every direct
// request is kept for the evidence table (the retrieval function only keeps
// validated clips). Nothing else about the client changes.
const rawAnswers = [];
const client = {
  ...baseClient,
  sessions: baseClient.sessions,
  query: {
    ...baseClient.query,
    async sync(sessionId, input, opts) {
      const places = /"places":(\[[^\]]*\])/.exec(input.query)?.[1] || null;
      const t0 = Date.now();
      try {
        const out = await baseClient.query.sync(sessionId, input, opts);
        rawAnswers.push({
          at: new Date().toISOString(),
          sessionId,
          places,
          httpStatus: 200,
          latencyMs: Date.now() - t0,
          upstreamStatus: out?.data?.status || null,
          messageId: out?.data?.messageId || null,
          excerpt: excerptOf(out?.data?.answer || ''),
        });
        return out;
      } catch (err) {
        rawAnswers.push({
          at: new Date().toISOString(),
          sessionId,
          places,
          httpStatus: err?.status ?? 0,
          latencyMs: Date.now() - t0,
          error: redactString(String(err?.message || err)).slice(0, 160),
          excerpt: excerptOf(
            typeof err?.upstream === 'string'
              ? err.upstream
              : JSON.stringify(err?.upstream ?? ''),
          ),
        });
        throw err;
      }
    },
  },
};

function excerptOf(answer) {
  const s = typeof answer === 'string' ? answer : JSON.stringify(answer ?? '');
  return redactString(s).replace(/\s+/g, ' ').slice(0, 400);
}

async function runProbe(probe) {
  const requests = [];
  const open = new Map();
  let maxInflight = 0;
  const trace = (stage, data) => {
    const at = new Date().toISOString();
    if (stage === 'session_create') {
      requests.push({
        at,
        endpoint: 'POST /chat/v1/sessions',
        kind: 'session',
        attempt: data.attempt,
        status: null,
        latencyMs: null,
      });
    } else if (stage === 'session_created') {
      const last = [...requests]
        .reverse()
        .find((r) => r.kind === 'session' && r.status === null);
      if (last) {
        last.status = data.sessionId ? 201 : null;
        last.sessionId = data.sessionId || null;
      }
    } else if (stage === 'query_submit') {
      const entry = {
        at,
        endpoint: `POST /chat/v1/sessions/${data.sessionId}/query`,
        kind: 'query',
        places: data.places,
        attempt: data.attempt,
        sessionReused: Boolean(data.sessionReused),
        transport: data.transport,
        status: null,
        latencyMs: null,
      };
      requests.push(entry);
      open.set(JSON.stringify(data.places), entry);
      maxInflight = Math.max(maxInflight, open.size);
    } else if (stage === 'query_completed') {
      // the latest open query for that session
      const entry = [...requests]
        .reverse()
        .find(
          (r) =>
            r.kind === 'query' &&
            r.status === null &&
            r.endpoint.includes(data.sessionId),
        );
      if (entry) {
        entry.status = data.status === 'completed' ? 200 : 502;
        entry.latencyMs = data.ms;
        entry.upstreamStatus = data.status;
        open.delete(JSON.stringify(entry.places));
      }
    } else if (stage === 'retry_backoff') {
      const entry = [...requests]
        .reverse()
        .find((r) => r.kind === 'query' && r.status === null);
      if (entry) {
        entry.status = data.status ?? 0;
        entry.error = data.code || null;
        entry.backoffMs = data.delayMs;
        open.delete(JSON.stringify(entry.places));
      }
    } else if (stage === 'fanout_variant_failed') {
      const entry = [...requests]
        .reverse()
        .find(
          (r) =>
            r.kind === 'query' &&
            r.status === null &&
            r.places?.[0] === data.variant,
        );
      if (entry) {
        entry.status = 0;
        entry.error = data.error;
        open.delete(JSON.stringify(entry.places));
      }
    }
  };
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const rawStart = rawAnswers.length;
  let result = null;
  let fatal = null;
  try {
    result = await retrieveSnapchatFootage(probe.scene, {
      client,
      cfg,
      trace,
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    fatal = {
      status: err?.status ?? null,
      message: redactString(String(err?.message || err)).slice(0, 200),
    };
  }
  const finishedAt = new Date().toISOString();
  const clips = result?.clips || [];
  const raw = rawAnswers.slice(rawStart);
  const rawExcerpt =
    raw.find((r) => r.excerpt && /results/.test(r.excerpt))?.excerpt ||
    raw.find((r) => r.excerpt)?.excerpt ||
    null;
  return {
    prompt: probe.prompt,
    placeName: probe.scene.placeName,
    startedAtUtc: startedAt,
    finishedAtUtc: finishedAt,
    totalMs: Date.now() - t0,
    state: fatal ? 'error' : result?.status,
    fatal,
    transport: result?.transport || null,
    counts: result?.counts || null,
    accounting: result?.accounting || null,
    variants: result?.variants || [],
    verifiedCount: clips.filter((c) => c.tier === 'verified').length,
    approximateCount: clips.filter((c) => c.tier === 'candidate').length,
    maxInflightObserved: maxInflight,
    requests: requests.map((r) => ({
      ...r,
      endpoint: r.endpoint.replace(/sessions\/[0-9a-f]{24}/, 'sessions/{id}'),
    })),
    rawExcerpt,
    rawAnswers: raw,
    clips: clips.map((c) => ({
      id: c.id,
      storyId: c.storyId,
      tier: c.tier,
      locationEvidence: c.locationEvidence,
      matchedPlaceName: c.matchedPlaceName,
      caption: c.caption,
      publicationTime: c.publicationTime,
      mediaUrlRedacted: c.mediaUrl ? redactMediaUrl(c.mediaUrl) : null,
    })),
  };
}

const startedAt = new Date().toISOString();
console.log(
  `[direct-plugin probe] plugin ${cfg.pluginId}, endpoint ${cfg.endpointId}, timeout ${cfg.queryTimeoutMs} ms, concurrency ≤${Math.min(3, cfg.fanoutConcurrency)}`,
);
const probes = [];
for (const probe of PROBES) {
  console.log(`\n[direct-plugin probe] "${probe.prompt}" → ${probe.scene.placeName}`);
  const r = await runProbe(probe);
  probes.push(r);
  console.log(
    `  state=${r.state} sessions=${r.transport?.sessionsCreated ?? '-'} directQueries=${r.transport?.directQueries ?? '-'} maxInflight=${r.maxInflightObserved} verified=${r.verifiedCount} approximate=${r.approximateCount} totalMs=${r.totalMs}`,
  );
  for (const q of r.requests) {
    console.log(
      `   ${q.at} ${q.endpoint} ${q.places ? JSON.stringify(q.places) : ''} → HTTP ${q.status ?? 'n/a'} ${q.latencyMs ?? '-'} ms${q.error ? ` error=${q.error}` : ''}`,
    );
  }
}
const finishedAt = new Date().toISOString();

const out = {
  startedAtUtc: startedAt,
  finishedAtUtc: finishedAt,
  pluginId: cfg.pluginId,
  endpointId: cfg.endpointId,
  transport: 'direct-plugin-query',
  perRequestTimeoutMs: cfg.queryTimeoutMs,
  concurrencyCap: Math.min(3, cfg.fanoutConcurrency),
  legacyTransportEndpointsReferenced: 0,
  requestShape: {
    createSession: {
      method: 'POST',
      path: '/chat/v1/sessions',
      headers: { apikey: '[REDACTED]', 'content-type': 'application/json' },
      body: { externalUserId: 'gev-scene-footage', pluginIds: [cfg.pluginId] },
    },
    submitQuery: {
      method: 'POST',
      path: '/chat/v1/sessions/{sessionId}/query',
      headers: { apikey: '[REDACTED]', 'content-type': 'application/json' },
      body: {
        endpointId: cfg.endpointId,
        query: '<AGENT_INSTRUCTION + scene context + fetchSnapchatVideosByPlace({places:[variant],limit})>',
        responseMode: 'sync',
        pluginIds: [cfg.pluginId],
      },
    },
  },
  probes,
};
writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));

let md = `# Snapchat direct-plugin live probe\n\n`;
md += `Started ${startedAt} · finished ${finishedAt} · plugin \`${cfg.pluginId}\` · endpoint \`${cfg.endpointId}\` · transport direct-plugin-query (reused session pool ≤3, ≤3 in flight, ${cfg.queryTimeoutMs} ms per request)\n\n`;
for (const p of probes) {
  md += `## "${p.prompt}" → ${p.placeName}\n\n`;
  md += `state **${p.state}** · sessions created ${p.transport?.sessionsCreated ?? '-'} · direct queries ${p.transport?.directQueries ?? '-'} · max in flight ${p.maxInflightObserved} · verified ${p.verifiedCount} · approximate ${p.approximateCount} · ${p.totalMs} ms\n\n`;
  md += `| timestamp (UTC) | endpoint | places | HTTP | latency ms | note |\n|---|---|---|---|---|---|\n`;
  for (const q of p.requests) {
    md += `| ${q.at} | ${q.endpoint} | ${q.places ? q.places.join(', ') : ''} | ${q.status ?? 'n/a'} | ${q.latencyMs ?? '-'} | ${q.error || (q.sessionReused ? 'session reused' : q.kind === 'session' ? 'session created' : '')} |\n`;
  }
  md += `\n| timestamp (UTC) | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |\n|---|---|---|---|---|---|\n`;
  for (const r of p.rawAnswers || []) {
    md += `| ${r.at} | ${r.places || ''} | ${r.httpStatus} | ${r.latencyMs} | ${r.upstreamStatus || r.error || ''} | ${(r.excerpt || '').replace(/\|/g, '/').slice(0, 220)} |\n`;
  }
  md += `\nResult count ${p.counts?.unique ?? 0} unique (${p.counts?.raw ?? 0} raw) · verified ${p.verifiedCount} / approximate ${p.approximateCount}\n\n`;
  md += `Raw plugin answer excerpt (last message of the run session):\n\n\`\`\`\n${p.rawExcerpt || '(none)'}\n\`\`\`\n\n`;
}
writeFileSync(MD_OUT, md);
console.log(`\n[direct-plugin probe] wrote ${JSON_OUT}\n[direct-plugin probe] wrote ${MD_OUT}`);
