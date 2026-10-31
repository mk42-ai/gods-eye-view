/**
 * POST /api/scenes/:locationId/footage/snapchat
 *
 * Body: { locationId, lat, lon, placeName, bbox, clientTimeIso, fresh? }
 * Server-only OnDemand credentials (foundation client). Responds with JSON:
 *   { state, locationId, clips[], coverageLevel, coverageLabel, expanded,
 *     retrievalTime, lastCheckedAt, cached, refresh:{defaultMs,minMs}, plugin:{id,operation},
 *     ladder[], rejected[], trace[] }
 * state ∈ ok | empty | credentials_required | plugin_error | rate_limited | timeout
 *
 * Mounted at '/api/scenes' by server/serverless/app.js (Connect-style
 * mount; :locationId is parsed here with a strict pattern).
 */
import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson, rejectCrossOrigin } from '../ondemand/http.js';
import {
  createRateLimiter,
  clientAddress,
} from '../ondemand/foundation/guards.js';
import {
  createOnDemandClient,
  OnDemandHttpError,
  OnDemandNotConfiguredError,
  OnDemandAbortError,
} from '../ondemand/foundation/client.js';
import { isConfigured } from '../ondemand/config.js';
import { parseIncidentQuery } from '../../src/incidents/query.js';
import {
  footageConfig,
  retrieveSnapchatFootage,
  createFootageCache,
  createMediaVerifier,
  SNAPCHAT_OPERATION,
  redactMediaUrl,
} from './snapchat.js';

const PATH_RE = /^\/([A-Za-z0-9_-]{1,64})\/footage\/snapchat\/?$/;
const finite = (v, lim) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

export function validateFootageRequest(locationId, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'invalid_request_body' };
  if (body.locationId !== undefined && body.locationId !== locationId)
    return { error: 'location_id_mismatch' };
  if (!finite(body.lat, 90) || !finite(body.lon, 180))
    return { error: 'invalid_coordinates' };
  let bbox = null;
  if (body.bbox !== undefined && body.bbox !== null) {
    const b = body.bbox;
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every((x, i) => finite(x, i % 2 ? 90 : 180))
    )
      return { error: 'invalid_bbox' };
    if (b[0] > b[2] || b[1] > b[3] || b[2] - b[0] > 2 || b[3] - b[1] > 2)
      return { error: 'invalid_bbox' };
    bbox = b;
  }
  const placeName =
    body.placeName === undefined || body.placeName === null
      ? ''
      : String(body.placeName)
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 80);
  if (placeName && parseIncidentQuery(placeName).kind === 'conversational')
    return { error: 'place_required_not_a_greeting' };
  let clientTimeIso = null;
  if (body.clientTimeIso !== undefined && body.clientTimeIso !== null) {
    const t = Date.parse(String(body.clientTimeIso));
    if (!Number.isFinite(t)) return { error: 'invalid_client_time' };
    clientTimeIso = new Date(t).toISOString();
  }
  const rawRadius = body.radius ?? body.radius_km;
  if (
    rawRadius !== undefined &&
    rawRadius !== null &&
    (typeof rawRadius !== 'number' ||
      !Number.isFinite(rawRadius) ||
      rawRadius <= 0 ||
      rawRadius > 100)
  )
    return { error: 'invalid_radius' };
  const radius = rawRadius ?? null;
  if (body.strictBounds !== undefined && typeof body.strictBounds !== 'boolean')
    return { error: 'invalid_strict_bounds' };
  const strictBounds = body.strictBounds === true;
  let timeWindow = null;
  const tw =
    body.timeWindow ??
    (body.windowHours !== undefined ? { windowHours: body.windowHours } : null);
  if (tw !== null) {
    if (
      typeof tw !== 'object' ||
      Array.isArray(tw) ||
      Object.keys(tw).some(
        (k) =>
          ![
            'windowHours',
            'windowStart',
            'windowEnd',
            'strictCaptureTime',
          ].includes(k),
      )
    )
      return { error: 'invalid_recording_window' };
    const wObj = {};
    if (tw.windowHours !== undefined) {
      if (
        typeof tw.windowHours !== 'number' ||
        !Number.isFinite(tw.windowHours) ||
        tw.windowHours <= 0 ||
        tw.windowHours > 8784
      )
        return { error: 'invalid_recording_window' };
      wObj.windowHours = tw.windowHours;
    }
    if (tw.windowStart !== undefined || tw.windowEnd !== undefined) {
      const start = Date.parse(tw.windowStart || '');
      const end = Date.parse(tw.windowEnd || '');
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end > Date.now()
      )
        return { error: 'invalid_recording_window' };
      wObj.windowStart = new Date(start).toISOString();
      wObj.windowEnd = new Date(end).toISOString();
    }
    if (!wObj.windowHours && !wObj.windowStart)
      return { error: 'invalid_recording_window' };
    if (
      tw.strictCaptureTime !== undefined &&
      typeof tw.strictCaptureTime !== 'boolean'
    )
      return { error: 'invalid_recording_window' };
    wObj.strictCaptureTime = true;
    timeWindow = wObj;
  }
  const trigger = body.trigger ? String(body.trigger).slice(0, 40) : null;
  return {
    value: {
      locationId,
      lat: body.lat,
      lon: body.lon,
      placeName,
      bbox,
      clientTimeIso,
      fresh: body.fresh === true,
      ...(radius ? { radius } : {}),
      ...(strictBounds ? { strictBounds: true } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(trigger ? { trigger } : {}),
    },
  };
}

// Dedicated foundation client with transport retries OFF: the footage
// pipeline owns retries (fresh session per attempt + exponential backoff),
// because re-submitting into a still-busy session yields HTTP 409.
let footageClient = null;
const getFootageClient = () =>
  (footageClient ||= createOnDemandClient({ retry: { retries: 0 } }));

export function createSceneFootageRoutes(deps = {}) {
  const env = deps.env || process.env;
  const cfg = () => ({ ...footageConfig(env), ...(deps.config || {}) });
  const cache = deps.cache || createFootageCache({ now: deps.nowMs });
  const limiter =
    deps.limiter || createRateLimiter({ perMinute: cfg().ratePerMinute });
  const inflight = new Map();
  const log = deps.log || ((line) => console.log(line));
  const now = deps.now || (() => new Date());
  const configured = deps.isConfigured || (() => isConfigured());

  return async function sceneFootageHandler(req, res, next) {
    const pathOnly = String(req.url || '/').split('?')[0];
    const m = pathOnly.match(PATH_RE);
    if (!m) return next ? next() : false;
    if ((req.method || 'GET') !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (rejectCrossOrigin(req, res)) return true;
    const requestId = randomUUID();
    res.setHeader('X-Footage-Request-Id', requestId);
    res.setHeader('X-OnDemand-Key-Source', 'server');
    const c = cfg();
    const bucket = limiter.take(clientAddress(req));
    if (!bucket.allowed) {
      res.setHeader('Retry-After', String(bucket.retryAfterSec));
      sendJson(res, 429, {
        state: 'rate_limited',
        error: 'rate_limited',
        retryAfterSec: bucket.retryAfterSec,
        requestId,
      });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req, { maxBytes: 8 * 1024 });
    } catch {
      sendJson(res, 400, { error: 'invalid_request_body', requestId });
      return true;
    }
    const checked = validateFootageRequest(m[1], body);
    if (checked.error) {
      sendJson(
        res,
        checked.error === 'place_required_not_a_greeting' ? 422 : 400,
        { error: checked.error, requestId },
      );
      return true;
    }
    const scene = checked.value;
    const trace = [];
    const stamp = (stage, data = {}) => {
      const entry = { stage, utc: new Date().toISOString(), ...data };
      trace.push(entry);
      log(
        `[scene-footage] ${entry.utc} ${requestId} ${scene.locationId} ${stage} ${JSON.stringify(data)}`,
      );
    };
    stamp('request_received', {
      lat: scene.lat,
      lon: scene.lon,
      placeName: scene.placeName || null,
      bbox: scene.bbox,
      fresh: scene.fresh,
    });
    const base = {
      locationId: scene.locationId,
      requestId,
      plugin: { id: c.pluginId, operation: SNAPCHAT_OPERATION },
      refresh: { defaultMs: c.defaultRefreshMs, minMs: c.minRefreshMs },
      maxCoverageLevel: c.maxCoverageLevel,
      capabilities: {
        paginationSupported: false,
        batchSupported: false,
        geotagSupported: false,
        captureTimeSupported: false,
        directCoordinatesSupported: false,
        spotlightTextSearchOnly: true,
        undocumentedEndpointsUsed: false,
      },
    };
    if (!configured()) {
      stamp('credentials_required');
      sendJson(res, 503, {
        ...base,
        state: 'credentials_required',
        clips: [],
        trace,
      });
      return true;
    }
    const twKey = scene.timeWindow
      ? `${scene.timeWindow.windowHours || ''}_${scene.timeWindow.windowStart || ''}_${scene.timeWindow.windowEnd || ''}_${scene.timeWindow.strictCaptureTime ? '1' : '0'}`
      : '';
    const cacheKey = `${scene.locationId}|${scene.placeName.toLowerCase()}|${c.maxCoverageLevel}|${scene.radius || ''}|${scene.strictBounds ? '1' : '0'}|${twKey}`;
    if (!scene.fresh) {
      const hit = cache.get(cacheKey, c.cacheTtlMs);
      if (hit) {
        stamp('cache_hit', { ageMs: hit.age });
        sendJson(res, 200, {
          ...base,
          ...hit.value,
          cached: true,
          cachedAt: new Date(hit.at).toISOString(),
          lastCheckedAt: new Date(hit.at).toISOString(),
          trace,
        });
        return true;
      }
    }
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort('client_disconnect');
    };
    res.on?.('close', onClose);
    try {
      let job = inflight.get(cacheKey);
      if (job) stamp('coalesced_with_inflight');
      else {
        const verifier = c.verifyMedia
          ? deps.verify || createMediaVerifier({ fetch: deps.mediaFetch })
          : null;
        job = retrieveSnapchatFootage(scene, {
          client: deps.client || getFootageClient(),
          sleep: deps.sleep,
          cfg: c,
          now,
          // A coalesced job has its own bounded lifetime. One disconnect must not
          // cancel another subscriber's identical explicit lookup. No provider-cancel claim.
          signal: AbortSignal.timeout(250000),
          trace: stamp,
          verify: verifier
            ? async (clips, signal) => {
                const kept = await verifier(clips, signal);
                stamp('media_verified', {
                  checked: clips.length,
                  playable: kept.length,
                  rejected: verifier.lastRejected || [],
                });
                return kept;
              }
            : null,
        }).finally(() => inflight.delete(cacheKey));
        inflight.set(cacheKey, job);
      }
      const result = await job;
      const lastCheckedAt = new Date().toISOString();
      const payload = {
        state:
          result.status === 'ok'
            ? 'ok'
            : result.status === 'plugin_error'
              ? 'plugin_error'
              : 'empty',
        error: result.status === 'plugin_error' ? result.emptyReason : null,
        clips: result.clips,
        coverageLevel: result.coverageLevel,
        coverageLabel: result.coverageLabel,
        expanded: result.expanded,
        retrievalTime: result.retrievalTime || lastCheckedAt,
        lastCheckedAt,
        emptyReason: result.emptyReason || null,
        pluginNote: result.pluginNote,
        ladder: result.ladder,
        rejected: result.rejected.slice(0, 40),
        upstream: result.upstream,
        cached: false,
        accounting: result.accounting || null,
        capabilities: result.capabilities || base.capabilities,
        bounds: result.bounds || {
          radius: scene.radius || null,
          strictBounds: Boolean(scene.strictBounds),
          timeWindow: scene.timeWindow || null,
        },
      };
      stamp('schema_validated', {
        clips: payload.clips.length,
        rejected: payload.rejected.length,
        coverageLevel: payload.coverageLevel,
        expanded: payload.expanded,
        media: payload.clips.map((x) => redactMediaUrl(x.mediaUrl)),
      });
      if (payload.state !== 'plugin_error') cache.set(cacheKey, payload);
      if (!res.writableEnded)
        sendJson(res, payload.state === 'plugin_error' ? 502 : 200, {
          ...base,
          ...payload,
          trace,
        });
    } catch (error) {
      if (controller.signal.aborted && !res.writableEnded) {
        res.destroy?.();
        return true;
      }
      let status = 502,
        state = 'plugin_error',
        code = 'plugin_error';
      if (error instanceof OnDemandNotConfiguredError) {
        status = 503;
        state = 'credentials_required';
        code = 'credentials_required';
      } else if (error instanceof OnDemandAbortError) {
        status = 504;
        state = 'timeout';
        code = 'plugin_timeout';
      } else if (error instanceof OnDemandHttpError) {
        if (error.status === 429) {
          status = 429;
          state = 'rate_limited';
          code = 'upstream_rate_limited';
        } else if (error.status === 401 || error.status === 403) {
          status = 503;
          state = 'credentials_required';
          code = `upstream_${error.status}`;
        } else code = `upstream_${error.status}`;
      }
      stamp('failed', { state, code });
      if (!res.writableEnded)
        sendJson(res, status, {
          ...base,
          state,
          error: code,
          clips: [],
          accounting: error.footageAccounting || {
            returnedCount: 0,
            uniqueCount: 0,
            matchingCount: 0,
            rejectedCount: 0,
            queriesCount: 0,
            pagesCount: 0,
            attemptsCount: 0,
            partial: false,
            truncated: false,
          },
          trace,
        });
    } finally {
      res.off?.('close', onClose);
    }
    return true;
  };
}

/** Connect mount helper: router.use('/api/scenes', handler). */
export function mountSceneFootageRoutes(router, deps) {
  const handler = createSceneFootageRoutes(deps);
  router.use('/api/scenes', (req, res, next) => {
    handler(req, res, next).catch(next);
  });
  return handler;
}
