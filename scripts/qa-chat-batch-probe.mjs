/**
 * scripts/qa-chat-batch-probe.mjs
 *
 * Live retest probe of the OnDemand Chat Batch endpoints.
 * First inspects GET {base}/config/v1/public/docs/categories for any 'batch' slug.
 * Then tests:
 *  - POST /chat/v1/batches
 *  - POST /chat/v1/sessions/batch
 *  - POST /chat/v1/batch
 *  - POST /chat/v1/sessions/query/batch
 *  - GET /chat/v1/batches
 *  - webhook-style batch request only if documented.
 *
 * Writes results to docs/evidence-2026-11-01-cinematic/chat-batch-probe.txt
 * NEVER prints, logs, or saves any secret/API key.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'docs/evidence-2026-11-01-cinematic');
const OUT_FILE = resolve(OUT_DIR, 'chat-batch-probe.txt');

mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.ONDEMAND_BASE_URL || 'https://api.on-demand.io';
const API_KEY =
  process.env.ONDEMAND_API_KEY || process.env.ON_DEMAND_API_KEY || '';

if (!API_KEY) {
  console.error(
    'ERROR: ONDEMAND_API_KEY or ON_DEMAND_API_KEY must be set in environment.',
  );
  process.exit(1);
}

function redact(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(
      /(?:key|apikey|token|secret)[=:][\s"']*([A-Za-z0-9_\-.]{8,})/gi,
      (match) => match.slice(0, 10) + '...[REDACTED]',
    )
    .replace(/sig=([A-Za-z0-9%_-]+)/gi, 'sig=[REDACTED]');
}

async function request(method, path, body = null) {
  const url = `${BASE_URL.replace(/\/+$/, '')}${path}`;
  const t = new Date().toISOString();
  const headers = {
    apikey: API_KEY,
  };
  if (body) {
    headers['content-type'] = 'application/json';
  }

  let status = 0;
  let rawBody = '';
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    rawBody = await res.text();
  } catch (err) {
    rawBody = `NETWORK_ERROR: ${err.message}`;
  }

  const cleanBody = redact(rawBody).slice(0, 500);
  return {
    utc: t,
    method,
    path,
    status,
    body: cleanBody,
  };
}

async function run() {
  const entries = [];
  const logLines = [];

  const add = (entry, note = '') => {
    entries.push(entry);
    const line = `[${entry.utc}] ${entry.method} ${entry.path} -> HTTP ${entry.status}\n${entry.body}${note ? `\nNote: ${note}` : ''}\n`;
    logLines.push(line);
    console.log(
      `[${entry.utc}] ${entry.method} ${entry.path} -> HTTP ${entry.status}`,
    );
  };

  console.log(
    `[QA Chat Batch Probe] Starting inspection against ${BASE_URL}...`,
  );

  // 1. Fetch categories docs
  console.log('[QA] Fetching /config/v1/public/docs/categories...');
  const catRes = await request('GET', '/config/v1/public/docs/categories');
  let batchDocumented = false;
  let batchSlugs = [];

  try {
    const parsed = JSON.parse(catRes.body);
    const textToSearch = JSON.stringify(parsed);
    if (/batch/i.test(textToSearch)) {
      batchDocumented = true;
      // find matching items
      const findSlugs = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && /batch/i.test(v))
            batchSlugs.push(`${k}: ${v}`);
          else if (typeof v === 'object') findSlugs(v);
        }
      };
      findSlugs(parsed);
    }
  } catch {
    /* parse error */
  }

  const docNote = batchDocumented
    ? `Batch operations documented in categories: ${batchSlugs.join(', ')}`
    : 'No batch operation is documented in public docs categories (grep for "batch" yielded zero occurrences).';
  add(catRes, docNote);

  // 2. Probes
  // POST /chat/v1/batches
  add(
    await request('POST', '/chat/v1/batches', { items: [{ query: 'probe' }] }),
  );

  // POST /chat/v1/sessions/batch
  add(
    await request('POST', '/chat/v1/sessions/batch', {
      items: [{ query: 'probe' }],
    }),
  );

  // POST /chat/v1/batch
  add(await request('POST', '/chat/v1/batch', { items: [{ query: 'probe' }] }));

  // POST /chat/v1/sessions/query/batch
  add(
    await request('POST', '/chat/v1/sessions/query/batch', {
      items: [{ query: 'probe' }],
    }),
  );

  // GET /chat/v1/batches
  add(await request('GET', '/chat/v1/batches'));

  // If documented, responseMode:'webhook'-style batch body variations
  if (batchDocumented) {
    add(
      await request('POST', '/chat/v1/batches', {
        items: [{ query: 'probe' }],
        responseMode: 'webhook',
        webhookUrl: 'https://example.com/webhook',
      }),
      'Tested documented webhook-style batch request',
    );
  } else {
    logLines.push(
      `\nWebhook-style batch body variations skipped: no batch operation is documented in public docs categories.\n`,
    );
  }

  const finalOutput = [
    `# OnDemand Chat Batch Live API Retest Probe`,
    `# Probed: ${new Date().toISOString()}`,
    `# Base: ${BASE_URL}`,
    `# Summary: ${docNote}`,
    ``,
    ...logLines,
  ].join('\n');

  writeFileSync(OUT_FILE, finalOutput, 'utf8');
  console.log(`[QA] Results written to ${OUT_FILE}`);
}

run().catch((err) => {
  console.error('[QA] Fatal error:', err.message);
  process.exit(1);
});
