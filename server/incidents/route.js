/**
 * server/incidents/route.js — `/api/incidents` (UAE AOI live incident library).
 *
 * Mounted on the shared Connect-style router by server/serverless/app.js, so
 * it is served by the existing catch-all function (api/[...route].js) — no
 * new Vercel function. `req.url` here is the remainder after the mount.
 *
 *   GET  /api/incidents            → { incidents, lastRefreshUtc, counts, source:'store'|'seed', state }
 *   POST /api/incidents            → ingest one or many (header x-ingest-secret === INCIDENT_INGEST_SECRET)
 *   POST /api/incidents/refresh    → OnDemand sweep of every AOI (same-origin, rate-limited, in-flight lock)
 *   POST /api/incidents/resolve    → { text } → entity extraction + geocode (OnDemand, gazetteer fallback)
 *   POST /api/incidents/composer   → same-origin proxy that persists a composer-created incident;
 *                                    the ingest secret never leaves the server.
 *
 * Secrets: ONDEMAND_API_KEY and INCIDENT_INGEST_SECRET are read from
 * process.env only, never echoed. Secret comparison is constant-time.
 */
import { timingSafeEqual } from 'node:crypto';
import {
  readJsonBody,
  BodyError,
  sendJson,
  rejectCrossOrigin,
  getRequestUrl,
} from '../ondemand/http.js';
import { isConfigured } from '../ondemand/config.js';
import {
  createRateLimiter,
  clientAddress,
  auditEvent,
} from '../ondemand/foundation/guards.js';
import { getIncidentStore } from './store.js';
import { resolveIncidentText, refreshIncidents } from './resolver.js';
import { IncidentValidationError } from '../../src/data/uaeIncidents.js';

export const INCIDENTS_MOUNT = '/api/incidents';
const MAX_BODY = 512 * 1024;
const MAX_BATCH = 200;
const RESOLVE_TEXT_MAX = 2048;

function secretMatches(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Honest live state for the LIVE / SEED / NO KEY badge. */
export function incidentState({ configured, source, lastRefreshUtc }) {
  if (!configured) return 'NO KEY';
  if (source === 'seed' || !lastRefreshUtc) return 'SEED';
  return 'LIVE';
}

/**
 * @param {object} [deps]
 * @param {ReturnType<typeof getIncidentStore>} [deps.store]
 * @param {typeof resolveIncidentText} [deps.resolve]
 * @param {typeof refreshIncidents} [deps.refresh]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {() => boolean} [deps.configured]
 */
export function createIncidentsHandler(deps = {}) {
  const env = deps.env || process.env;
  const configured = deps.configured || isConfigured;
  const resolve = deps.resolve || resolveIncidentText;
  const refresh = deps.refresh || refreshIncidents;
  const limiter = deps.limiter || createRateLimiter({ perMinute: 30 });
  const refreshLimiter =
    deps.refreshLimiter || createRateLimiter({ perMinute: 4 });
  const audit =
    deps.audit ||
    ((event, fields) =>
      auditEvent(event, fields, { apiKey: env.ONDEMAND_API_KEY }));
  const now = deps.now || (() => new Date());

  return async function incidentsHandler(req, res) {
    const store = deps.store || getIncidentStore();
    const url = getRequestUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    res.setHeader('X-Incidents-Route', 'uae-aoi');
    try {
      if (path === '/' && (method === 'GET' || method === 'HEAD')) {
        const doc = await store.read();
        const group = url.searchParams.get('group');
        const incidents =
          group && group !== 'ALL'
            ? doc.incidents.filter((i) => i.group === group)
            : doc.incidents;
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, {
          incidents,
          lastRefreshUtc: doc.lastRefreshUtc,
          counts: doc.counts,
          source: doc.source,
          state: incidentState({
            configured: configured(),
            source: doc.source,
            lastRefreshUtc: doc.lastRefreshUtc,
          }),
          configured: configured(),
          backend: store.backend,
          seededAt: doc.seededAt,
          generatedAtUtc: now().toISOString(),
        });
        return;
      }
      if (method !== 'POST') {
        res.setHeader('Allow', path === '/' ? 'GET, HEAD, POST' : 'POST');
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      // Every POST is rate limited per peer; refresh has its own tighter bucket.
      const peer = clientAddress(req);
      const bucket = (path === '/refresh' ? refreshLimiter : limiter).take(
        `${peer}|${path}`,
      );
      if (!bucket.allowed) {
        res.setHeader('Retry-After', String(bucket.retryAfterSec));
        audit('incidents_rate_limited', { path, peer });
        sendJson(res, 429, {
          error: 'rate_limited',
          retryAfterSec: bucket.retryAfterSec,
        });
        return;
      }

      if (path === '/') {
        const expected = env.INCIDENT_INGEST_SECRET;
        if (!expected) {
          sendJson(res, 503, {
            error: 'not_configured',
            message: 'INCIDENT_INGEST_SECRET is not set on the server',
          });
          return;
        }
        if (!secretMatches(req.headers?.['x-ingest-secret'], expected)) {
          audit('incidents_ingest_denied', { peer });
          sendJson(res, 401, { error: 'invalid_ingest_secret' });
          return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY });
        const list = Array.isArray(body)
          ? body
          : Array.isArray(body?.incidents)
            ? body.incidents
            : body && typeof body === 'object' && body.headline
              ? [body]
              : null;
        if (!list) {
          sendJson(res, 400, {
            error: 'validation_error',
            message: 'expected an incident, an array, or {incidents:[...]}',
          });
          return;
        }
        if (list.length > MAX_BATCH) {
          sendJson(res, 413, { error: 'too_many', max: MAX_BATCH });
          return;
        }
        const result = await store.ingest(list, {
          allowOutside: body?.allowOutside !== false,
        });
        audit('incidents_ingested', {
          peer,
          added: result.added.length,
          duplicates: result.duplicates.length,
          rejected: result.rejected.length,
        });
        sendJson(
          res,
          result.rejected.length && !result.added.length ? 422 : 200,
          {
            ok: true,
            added: result.added,
            duplicates: result.duplicates,
            rejected: result.rejected,
            counts: result.counts,
            total: result.total,
            lastRefreshUtc: result.lastRefreshUtc,
            source: result.source,
            persisted: result.persisted,
          },
        );
        return;
      }

      // Browser-originated routes below: same-origin only (CSRF guard).
      if (rejectCrossOrigin(req, res)) return;

      if (path === '/resolve') {
        const body = await readJsonBody(req, { maxBytes: MAX_BODY });
        const text = String(body?.text ?? '').trim();
        if (!text) {
          sendJson(res, 400, {
            error: 'validation_error',
            field: 'text',
            message: 'non-empty text required',
          });
          return;
        }
        if (text.length > RESOLVE_TEXT_MAX) {
          sendJson(res, 413, {
            error: 'payload_too_large',
            maxChars: RESOLVE_TEXT_MAX,
          });
          return;
        }
        const started = Date.now();
        const result = await resolve(text, { now });
        audit('incidents_resolved', {
          peer,
          provider: result.provenance?.provider,
          insideAoi: result.insideAoi,
          ms: Date.now() - started,
        });
        sendJson(res, 200, {
          ...result,
          configured: configured(),
          generatedAtUtc: now().toISOString(),
        });
        return;
      }

      if (path === '/composer') {
        const body = await readJsonBody(req, { maxBytes: MAX_BODY });
        const incident = body?.incident;
        if (!incident || typeof incident !== 'object') {
          sendJson(res, 400, {
            error: 'validation_error',
            field: 'incident',
            message: 'incident object required',
          });
          return;
        }
        // The browser never holds INCIDENT_INGEST_SECRET: this same-origin
        // proxy performs the ingest server-side on its behalf.
        const result = await store.ingest(
          [
            {
              ...incident,
              provenance: {
                ...(incident.provenance || {}),
                via: 'composer',
                ingestSecretConfigured: Boolean(env.INCIDENT_INGEST_SECRET),
              },
            },
          ],
          { allowOutside: body?.allowOutside !== false },
        );
        audit('incidents_composer_ingest', {
          peer,
          added: result.added.length,
          duplicates: result.duplicates.length,
          rejected: result.rejected.length,
        });
        const status = result.rejected.length ? 422 : 200;
        sendJson(res, status, {
          ok: status === 200,
          incident: result.added[0] || null,
          duplicateOf: result.duplicates[0]?.duplicateOf || null,
          rejected: result.rejected,
          counts: result.counts,
          total: result.total,
          persisted: result.persisted,
          via: 'composer-proxy',
        });
        return;
      }

      if (path === '/refresh') {
        if (!configured()) {
          const doc = await store.read();
          sendJson(res, 200, {
            ok: false,
            state: 'NO KEY',
            message:
              'ONDEMAND_API_KEY is not set on the server; no refresh was attempted',
            counts: doc.counts,
            lastRefreshUtc: doc.lastRefreshUtc,
            source: doc.source,
            generatedAtUtc: now().toISOString(),
          });
          return;
        }
        const body = await readJsonBody(req, { maxBytes: MAX_BODY }).catch(
          (error) => {
            if (error instanceof BodyError) return {};
            throw error;
          },
        );
        const lock = store.acquireRefreshLock();
        if (!lock.held) {
          // A refresh is already running: share its outcome instead of
          // launching a second sweep that would double-ingest.
          const shared = await lock.promise;
          sendJson(res, 200, { ...shared, shared: true });
          return;
        }
        const startedAt = now();
        let payload;
        try {
          const sweep = await refresh({
            group: body?.group,
            limitAois: Math.min(44, Math.max(1, Number(body?.limitAois) || 12)),
            now,
          });
          if (sweep.state !== 'LIVE') {
            const doc = await store.read();
            payload = {
              ok: false,
              state: sweep.state,
              counts: doc.counts,
              lastRefreshUtc: doc.lastRefreshUtc,
              source: doc.source,
              perAoi: sweep.perAoi,
            };
          } else {
            const result = sweep.candidates.length
              ? await store.ingest(sweep.candidates, {
                  refresh: true,
                  allowOutside: false,
                })
              : null;
            const lastRefreshUtc = result
              ? result.lastRefreshUtc
              : await store.touchRefresh();
            const doc = await store.read();
            payload = {
              ok: true,
              state: 'LIVE',
              plugin: sweep.plugin,
              endpointId: sweep.endpointId,
              aoisQueried: sweep.perAoi.length,
              aoisOk: sweep.perAoi.filter((p) => p.status === 'ok').length,
              candidates: sweep.candidates.length,
              added: result ? result.added.length : 0,
              duplicates: result ? result.duplicates.length : 0,
              rejected: result ? result.rejected.length : 0,
              counts: doc.counts,
              total: doc.incidents.length,
              lastRefreshUtc,
              source: doc.source,
              perAoi: sweep.perAoi,
              startedAtUtc: startedAt.toISOString(),
              ms: Date.now() - startedAt.getTime(),
            };
          }
          audit('incidents_refresh', {
            peer,
            state: payload.state,
            added: payload.added ?? 0,
            ms: payload.ms ?? 0,
          });
        } finally {
          lock.release(payload || { ok: false, state: 'ERROR' });
        }
        sendJson(res, 200, {
          ...payload,
          generatedAtUtc: now().toISOString(),
        });
        return;
      }

      sendJson(res, 404, { error: 'not_found', mount: INCIDENTS_MOUNT });
    } catch (error) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          /* ended */
        }
        return;
      }
      if (error instanceof BodyError) {
        sendJson(res, error.status, error.payload);
        return;
      }
      if (error instanceof IncidentValidationError) {
        sendJson(res, 400, {
          error: 'validation_error',
          field: error.field,
          message: error.message,
        });
        return;
      }
      console.error('[incidents] unhandled', error?.stack || error);
      sendJson(res, 500, { error: 'internal_error' });
    }
  };
}

/** Mount on the serverless router (server/serverless/app.js). */
export function mountIncidentRoutes(router, deps) {
  router.use(INCIDENTS_MOUNT, createIncidentsHandler(deps));
}
