/**
 * Scene video routes — mounted under /api/ondemand/v2/scene by proxy-route.js.
 *
 *   GET|POST /scene/videos   SSE. Query/body: prompt, hash (URL-hash scene state),
 *                            lat/lon (optional anchor), externalUserId.
 *                            Events: plan · incident · source · clip · ranked · done · error
 *                            (+ ": hb" comments every 10 s). Every provider call goes
 *                            through OnDemand plugin sessions (orchestrator.js).
 *   GET      /scene/media?u=  Same-origin media proxy for expiring / CORS-less clip
 *                            URLs (is.gd short links + Instagram/Facebook CDN only),
 *                            Range pass-through so <video> can seek to the caption offset.
 *
 * ONDEMAND_API_KEY stays in this process; the browser only ever sees clip URLs.
 */
import { Readable } from 'node:stream';
import { readJsonBody, sendJson } from '../ondemand/http.js';
import {
  orchestrateSceneVideos,
  createPluginInvoker,
  createShortUrlResolver,
} from './orchestrator.js';
import { config as odConfig, isConfigured } from '../ondemand/config.js';

const MAX_BODY = 32 * 1024;
const MEDIA_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:cdninstagram\.com|fbcdn\.net)$/i;
const SHORT_RE = /^https:\/\/is\.gd\/[A-Za-z0-9_-]{3,32}$/;

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Validate a media target; returns a URL or null. */
export function allowedMediaUrl(raw) {
  const s = String(raw || '');
  if (SHORT_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    return MEDIA_HOST_RE.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

async function resolveMediaTarget(url, fetchImpl) {
  if (!SHORT_RE.test(url)) return url;
  const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual' });
  const loc = res.headers.get('location');
  return allowedMediaUrl(loc) && !SHORT_RE.test(loc) ? loc : null;
}

export function createSceneVideoRoutes(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const audit = deps.audit || (() => {});
  return async function sceneVideoHandler(
    req,
    res,
    { path, method, url, authorize },
  ) {
    if (!path.startsWith('/scene/')) return false;
    if (path === '/scene/media' && (method === 'GET' || method === 'HEAD')) {
      const target = allowedMediaUrl(url.searchParams.get('u'));
      if (!target) {
        sendJson(res, 400, { error: 'media_url_not_allowed' });
        return true;
      }
      try {
        const resolved = await resolveMediaTarget(target, fetchImpl);
        if (!resolved) {
          sendJson(res, 502, { error: 'media_unresolvable' });
          return true;
        }
        const headers = {};
        if (req.headers?.range)
          headers.range = String(req.headers.range).slice(0, 64);
        const upstream = await fetchImpl(resolved, {
          method,
          headers,
          redirect: 'follow',
        });
        if (!upstream.ok && upstream.status !== 206) {
          // Expired signed CDN URL (403/410) → tell the player to re-resolve.
          sendJson(
            res,
            upstream.status === 403 || upstream.status === 410 ? 410 : 502,
            {
              error: 'media_upstream',
              status: upstream.status,
            },
          );
          return true;
        }
        res.statusCode = upstream.status;
        for (const h of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'last-modified',
          'etag',
        ]) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Media-Proxy', 'scene-videos');
        if (method === 'HEAD' || !upstream.body) {
          res.end();
          return true;
        }
        const stream = Readable.fromWeb(upstream.body);
        req.on?.('close', () => stream.destroy());
        stream.on('error', () => res.destroy?.());
        stream.pipe(res);
      } catch (err) {
        if (!res.headersSent)
          sendJson(res, 502, {
            error: 'media_proxy_failed',
            detail: String(err?.message || err).slice(0, 160),
          });
        else res.destroy?.();
      }
      return true;
    }
    if (path === '/scene/videos' && (method === 'GET' || method === 'POST')) {
      const body =
        method === 'POST'
          ? await readJsonBody(req, { maxBytes: MAX_BODY })
          : {};
      const q = (k) => body[k] ?? url.searchParams.get(k) ?? undefined;
      const prompt = String(q('prompt') || '')
        .trim()
        .slice(0, 500);
      if (!prompt) {
        sendJson(res, 400, { error: 'prompt_required' });
        return true;
      }
      const externalUserId = String(
        q('externalUserId') || 'scene-videos',
      ).slice(0, 128);
      if (authorize && q('externalUserId') && !authorize(externalUserId))
        return true;
      const lat = Number(q('lat'));
      const lon = Number(q('lon'));
      const anchor =
        Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
      if (!isConfigured() && !deps.invoke) {
        sendJson(res, 503, { error: 'ondemand_not_configured' });
        return true;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.on?.('close', abort);
      const hb = setInterval(() => res.write(': hb\n\n'), 10_000);
      audit('scene_videos', { externalUserId, chars: prompt.length });
      try {
        await orchestrateSceneVideos(
          { prompt, hash: String(q('hash') || '').slice(0, 2048), anchor },
          {
            invoke:
              deps.invoke ||
              createPluginInvoker({
                client: deps.client,
                endpointId: odConfig.fulfillmentEndpointId,
                externalUserId: `scene-videos-${externalUserId}`.slice(0, 100),
              }),
            resolveShortUrl:
              deps.resolveShortUrl || createShortUrlResolver(fetchImpl),
            emit: (event, data) => {
              if (!controller.signal.aborted) writeSse(res, event, data);
            },
            signal: controller.signal,
            now: deps.now ? deps.now() : new Date(),
          },
        );
      } catch (err) {
        if (!controller.signal.aborted)
          writeSse(res, 'error', {
            error: String(err?.message || err).slice(0, 200),
          });
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
    }
    return false;
  };
}
