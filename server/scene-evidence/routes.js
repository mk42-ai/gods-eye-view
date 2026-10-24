/**
 * Scene evidence routes — mounted under /api/ondemand/v2/scene by proxy-route.js.
 *
 *   GET|POST /scene/evidence          SSE stream (plan · source · item · signal · summary · done | cached)
 *            params: text, place, lat, lon, radiusKm, windowHours, sceneId, fresh=1
 *   GET      /scene/evidence/sources  JSON: every source, whether it is configured, what it needs
 *   GET      /scene/evidence/cache?key=…  JSON: cached result (no provider calls) or 404
 *
 * Provider keys stay in this process (process.env). The browser receives only
 * normalised public post/article metadata.
 */
import { readJsonBody, sendJson } from '../ondemand/http.js';
import { config as odConfig, isConfigured } from '../ondemand/config.js';
import { createSources, createEvidenceInvoker } from './sources.js';
import { createInference } from './inference.js';
import { runSceneEvidence, createEvidenceCache } from './pipeline.js';

const MAX_BODY = 16 * 1024;

export function createSceneEvidenceRoutes(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || globalThis.fetch;
  const cache = deps.cache || createEvidenceCache();
  const sources = deps.sources || createSources();
  const audit = deps.audit || (() => {});
  const effectiveEnv = () => ({
    ...env,
    ONDEMAND_API_KEY: isConfigured() || deps.invoke ? 'configured' : '',
  });

  return async function sceneEvidenceHandler(req, res, { path, method, url }) {
    if (!path.startsWith('/scene/evidence')) return false;
    if (path === '/scene/evidence/sources' && method === 'GET') {
      const e = effectiveEnv();
      sendJson(res, 200, {
        sources: sources.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          platforms: s.platforms,
          configured: s.configured(e),
          credentials: s.credentials,
          docs: s.docs,
          budgetMs: s.budgetMs,
        })),
        inference: createInference({
          env,
          fetch: fetchImpl,
          client: isConfigured() ? {} : null,
        }).engine,
      });
      return true;
    }
    if (path === '/scene/evidence/cache' && method === 'GET') {
      const key = String(url.searchParams.get('key') || '').slice(0, 300);
      const hit = key ? cache.get(key) : null;
      if (!hit) sendJson(res, 404, { error: 'not_cached', key });
      else
        sendJson(res, 200, {
          ...hit,
          cached: true,
          cachedAt: new Date(hit.at).toISOString(),
        });
      return true;
    }
    if (path !== '/scene/evidence' || (method !== 'GET' && method !== 'POST'))
      return false;
    const body =
      method === 'POST' ? await readJsonBody(req, { maxBytes: MAX_BODY }) : {};
    const q = (k) => body[k] ?? url.searchParams.get(k) ?? undefined;
    const num = (k) => (q(k) === undefined || q(k) === '' ? NaN : Number(q(k)));
    const input = {
      text: String(q('text') || '')
        .trim()
        .slice(0, 300),
      place:
        String(q('place') || '')
          .trim()
          .slice(0, 80) || undefined,
      lat: num('lat'),
      lon: num('lon'),
      radiusKm: num('radiusKm'),
      windowHours: num('windowHours'),
      sceneId: String(q('sceneId') || '').slice(0, 120) || undefined,
      fresh: q('fresh') === '1' || q('fresh') === true,
      // A/B latency switch: may only DOWNGRADE to the deterministic engine.
      deterministic: q('engine') === 'deterministic',
    };
    if (!input.text && !input.place) {
      sendJson(res, 400, { error: 'text_or_place_required' });
      return true;
    }
    if (
      Number.isFinite(input.lat) &&
      (Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180)
    ) {
      sendJson(res, 400, { error: 'invalid_coordinates' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': open\n\n');
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.on?.('close', abort);
    const hb = setInterval(() => res.write(': hb\n\n'), 8000);
    audit('scene_evidence', { chars: (input.text || input.place).length });
    const client = isConfigured() ? deps.client || null : null;
    try {
      await runSceneEvidence(input, {
        env: effectiveEnv(),
        fetch: fetchImpl,
        cache,
        sources,
        signal: controller.signal,
        now: deps.now ? deps.now() : new Date(),
        defaultEndpointId: odConfig.fulfillmentEndpointId,
        invoke:
          deps.invoke ||
          (client
            ? createEvidenceInvoker({
                client,
                defaultEndpointId: odConfig.fulfillmentEndpointId,
              })
            : null),
        inference:
          deps.inference ||
          createInference({
            env,
            fetch: fetchImpl,
            client,
            ...(input.deterministic ? { engine: 'deterministic' } : {}),
          }),
        emit: (event, data) => {
          if (!controller.signal.aborted)
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
      });
    } catch (err) {
      if (!controller.signal.aborted)
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: String(err?.message || err).slice(0, 200) })}\n\n`,
        );
    } finally {
      clearInterval(hb);
      req.off?.('close', abort);
      try {
        res.end();
      } catch {
        /* ended */
      }
    }
    return true;
  };
}
