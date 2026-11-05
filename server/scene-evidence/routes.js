import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJson } from '../ondemand/http.js';
import { config as odConfig, isConfigured } from '../ondemand/config.js';
import { createSources, createEvidenceInvoker } from './sources.js';
import { runSceneEvidence, createEvidenceCache } from './pipeline.js';
import {
  resolveEvidenceWindow,
  validPoint,
} from '../../src/sceneEvidence/qualification.js';
import { parseIncidentQuery } from '../../src/incidents/query.js';
import { sanitizeDiagnostic } from './safety.js';

export function createSceneEvidenceRoutes(deps = {}) {
  const env = deps.env || process.env,
    cache = deps.cache || createEvidenceCache(),
    sources = deps.sources || createSources();
  const effectiveEnv = () => ({
    ...env,
    ONDEMAND_API_KEY: isConfigured() || deps.invoke ? 'configured' : '',
  });
  return async function sceneEvidenceHandler(req, res, { path, method, url }) {
    if (!path.startsWith('/scene/evidence')) return false;
    if (path === '/scene/evidence/sources' && method === 'GET') {
      sendJson(res, 200, {
        policy: 'source-recording-v2',
        defaultWindowHours: 1,
        inference: 'deterministic-policy',
        sources: sources.map((s) => ({
          id: s.id,
          name: s.name,
          platforms: s.platforms,
          configured: s.configured(effectiveEnv()),
          credentials: s.credentials,
          docs: s.docs,
          budgetMs: s.budgetMs,
        })),
      });
      return true;
    }
    if (path === '/scene/evidence/cache' && method === 'GET') {
      const key = String(url.searchParams.get('key') || '').slice(0, 800),
        hit = cache.get(key);
      sendJson(
        res,
        hit ? 200 : 404,
        hit
          ? {
              ...hit,
              snapshotOnly: true,
              cached: true,
              cachedAt: new Date(hit.at).toISOString(),
            }
          : { error: 'not_cached' },
      );
      return true;
    }
    if (path !== '/scene/evidence' || !['GET', 'POST'].includes(method))
      return false;
    let body;
    try {
      body =
        method === 'POST'
          ? await readJsonBody(req, { maxBytes: 16 * 1024 })
          : {};
    } catch {
      sendJson(res, 400, { error: 'invalid_request_body' });
      return true;
    }
    const q = (key) => body[key] ?? url.searchParams.get(key) ?? undefined;
    const number = (key) =>
      q(key) === undefined
        ? undefined
        : q(key) === '' || typeof q(key) === 'boolean' || q(key) === null
          ? NaN
          : Number(q(key));
    const requestedPlatforms = q('allowedPlatforms');
    if (
      requestedPlatforms !== undefined &&
      (!Array.isArray(requestedPlatforms) ||
        !requestedPlatforms.length ||
        requestedPlatforms.some(
          (platform) => !['youtube', 'tiktok', 'instagram'].includes(platform),
        ))
    ) {
      sendJson(res, 400, { error: 'invalid_prompt_footage_platforms' });
      return true;
    }
    const input = {
      ...(requestedPlatforms
        ? { allowedPlatforms: [...new Set(requestedPlatforms)] }
        : {}),
      text: String(q('text') || '')
        .trim()
        .slice(0, 500),
      place: String(q('place') || '')
        .trim()
        .slice(0, 80),
      lat: number('lat'),
      lon: number('lon'),
      radiusKm: number('radiusKm') ?? 5,
      windowHours: number('windowHours') ?? 1,
      timeMode: q('timeMode') || 'recent',
      windowStart: q('windowStart'),
      windowEnd: q('windowEnd'),
      sceneId: String(q('sceneId') || '').slice(0, 160),
      fresh: true,
      requestId: /^[a-zA-Z0-9_-]{1,100}$/.test(String(q('requestId') || ''))
        ? String(q('requestId'))
        : randomUUID(),
    };
    if (!input.text && !input.place) {
      sendJson(res, 400, { error: 'text_or_place_required' });
      return true;
    }
    if (
      parseIncidentQuery(input.place || input.text).kind === 'conversational'
    ) {
      sendJson(res, 422, { error: 'place_required_not_a_greeting' });
      return true;
    }
    if (
      !validPoint(input.lat, input.lon) ||
      !Number.isFinite(input.radiusKm) ||
      input.radiusKm <= 0 ||
      input.radiusKm > 50
    ) {
      sendJson(res, 400, { error: 'invalid_coordinates_or_radius' });
      return true;
    }
    const now = deps.now ? deps.now() : new Date();
    try {
      resolveEvidenceWindow(input, now);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }
    res.statusCode = 200;
    for (const [key, value] of Object.entries({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Scene-Request-Id': input.requestId,
    }))
      res.setHeader(key, value);
    res.flushHeaders?.();
    res.write(': open\n\n');
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort('client_disconnect');
    };
    // req.close fires on a normally consumed POST body. res.close is the actual downstream lifetime.
    res.on?.('close', disconnect);
    req.on?.('aborted', disconnect);
    const heartbeat = setInterval(() => {
      if (!controller.signal.aborted) res.write(': hb\n\n');
    }, 8000);
    const emit = (event, data) => {
      if (!controller.signal.aborted && !res.writableEnded)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await runSceneEvidence(input, {
        env: effectiveEnv(),
        cache,
        sources,
        signal: controller.signal,
        now,
        fetch: deps.fetch,
        defaultEndpointId: odConfig.fulfillmentEndpointId,
        audit: deps.audit,
        invoke:
          deps.invoke ||
          (deps.client
            ? createEvidenceInvoker({
                client: deps.client,
                defaultEndpointId: odConfig.fulfillmentEndpointId,
              })
            : null),
        emit,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        emit('error', {
          requestId: input.requestId,
          error: sanitizeDiagnostic(error, env),
        });
    } finally {
      clearInterval(heartbeat);
      res.off?.('close', disconnect);
      req.off?.('aborted', disconnect);
      if (!res.writableEnded) res.end();
    }
    return true;
  };
}
