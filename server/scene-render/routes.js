/**
 * Hyper-real Render proxy — /api/scenes/render/*
 *
 * The browser never talks to the GPU render service directly: the service's
 * bearer token (RENDER_SERVICE_TOKEN) and base URL (RENDER_SERVICE_URL) stay
 * server-side, exactly like the OnDemand key. This module forwards a small,
 * validated surface:
 *
 *   GET  /api/scenes/render/health                  -> service /health (+ configured flag)
 *   POST /api/scenes/render                         -> service POST /render  (renderScene)
 *   GET  /api/scenes/render/:job/status             -> service /status/:job   (getRenderStatus)
 *   GET  /api/scenes/render/:job/stream             -> service /stream/:job   (MJPEG passthrough)
 *   GET  /api/scenes/render/:job/latest.jpg         -> service /frames/:job/latest.jpg
 *   GET  /api/scenes/render/:job/frames/:n.png      -> service /frames/:job/:n.png
 *   GET  /api/scenes/render/:job/video.mp4          -> service /video/:job.mp4 (Range passthrough)
 *
 * When RENDER_SERVICE_URL is unset every route answers 503 `not_configured`
 * with the same shape, so the UI can show an honest "render service not
 * connected" state instead of failing silently. Every proxied JSON payload is
 * re-stamped with `illustrative:true` and the fixed label — renders are
 * never evidence.
 *
 * Mounted at '/api/scenes' by server/serverless/app.js next to the Snapchat
 * footage routes (same Connect-style mount, same strict path patterns).
 */
import { readJsonBody, sendJson, rejectCrossOrigin } from '../ondemand/http.js';
import { resolvePromptLocation } from './geocode.js';
import {
  promptSeed,
  promptHash,
  gpuPolicyViolations,
  ALLOWED_RENDER_GPUS,
} from './promptSeed.js';

export const RENDER_LABEL = 'Illustrative render · not evidence';
const JOB_RE = /^[a-f0-9]{6,32}$/;
const TIMES = new Set(['dusk', 'night', 'midday', 'auto']);

export function renderServiceConfig(env = process.env) {
  const url = String(env.RENDER_SERVICE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const token = String(env.RENDER_SERVICE_TOKEN || '').trim();
  return { url, token, configured: Boolean(url) };
}

export function validateRenderRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'invalid_request_body' };
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > 600)
    return { error: 'invalid_prompt' };
  const out = { prompt };
  const num = (v, lim) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
  if (body.lat !== undefined || body.lng !== undefined) {
    if (!num(body.lat, 90) || !num(body.lng, 180))
      return { error: 'invalid_coordinates' };
    out.lat = body.lat;
    out.lng = body.lng;
  }
  if (body.time_of_day !== undefined && body.time_of_day !== null) {
    if (!TIMES.has(body.time_of_day)) return { error: 'invalid_time_of_day' };
    out.time_of_day = body.time_of_day;
  }
  const d = body.duration_s === undefined ? 60 : body.duration_s;
  if (!Number.isInteger(d) || d < 2 || d > 120)
    return { error: 'invalid_duration' };
  out.duration_s = d;
  if (body.samples !== undefined) {
    if (
      !Number.isInteger(body.samples) ||
      body.samples < 4 ||
      body.samples > 128
    )
      return { error: 'invalid_samples' };
    out.samples = body.samples;
  }
  return { value: out };
}

/** Rewrite service-absolute URLs in a status payload to same-origin proxy paths. */
export function rewriteJobUrls(payload, jobId) {
  if (!payload || typeof payload !== 'object') return payload;
  const base = `/api/scenes/render/${jobId}`;
  return {
    ...payload,
    illustrative: true,
    label: RENDER_LABEL,
    status_url: `${base}/status`,
    stream_url: `${base}/stream`,
    latest_frame_url: `${base}/latest.jpg`,
    frames_url_template: `${base}/frames/{n}.png`,
    mp4_url: `${base}/video.mp4`,
  };
}

export function createSceneRenderRoutes({
  env = process.env,
  fetchImpl = globalThis.fetch,
  geocode = (prompt) => resolvePromptLocation(prompt, { fetchImpl }),
} = {}) {
  const cfg = renderServiceConfig(env);
  const headers = () =>
    cfg.token ? { authorization: `Bearer ${cfg.token}` } : {};
  // GPU policy guard: the render host must advertise only GPUs 2 and 6. If its
  // /health lists any other GPU (e.g. Gemma's GPU 1), refuse to start jobs so
  // the proxy never schedules Blender onto a GPU it must not touch.
  let policyCache = { at: 0, violations: null, gpus: null };
  async function checkGpuPolicy() {
    if (Date.now() - policyCache.at < 30000 && policyCache.violations)
      return policyCache;
    try {
      const r = await fetchImpl(`${cfg.url}/health`, {
        headers: headers(),
        signal: AbortSignal.timeout(8000),
      });
      const body = await r.json().catch(() => ({}));
      policyCache = {
        at: Date.now(),
        violations: gpuPolicyViolations(body),
        gpus: body?.gpus || null,
      };
    } catch {
      policyCache = { at: 0, violations: null, gpus: null };
    }
    return policyCache;
  }
  const notConfigured = (res) =>
    sendJson(res, 503, {
      error: 'not_configured',
      configured: false,
      illustrative: true,
      label: RENDER_LABEL,
      message:
        'Hyper-real render service is not connected (RENDER_SERVICE_URL unset on the server).',
    });

  async function pipe(res, upstream, extraHeaders = {}) {
    res.statusCode = upstream.status;
    for (const h of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Illustrative', 'true');
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    const onClose = () => reader.cancel().catch(() => {});
    res.on('close', onClose);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((r) => res.once('drain', r));
      }
    } catch {
      /* client went away or upstream ended */
    } finally {
      res.off('close', onClose);
      res.end();
    }
  }

  return async function handler(req, res, next) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '/render' && !path.startsWith('/render/')) return next();
    const sub = path.slice('/render'.length);

    if (sub === '/health' && req.method === 'GET') {
      if (!cfg.configured)
        return sendJson(res, 200, {
          ok: false,
          configured: false,
          illustrative: true,
          label: RENDER_LABEL,
        });
      try {
        const r = await fetchImpl(`${cfg.url}/health`, {
          signal: AbortSignal.timeout(8000),
        });
        const body = await r.json().catch(() => ({}));
        const violations = gpuPolicyViolations(body);
        return sendJson(res, 200, {
          ...body,
          gpu_policy: {
            ...(body?.gpu_policy || {}),
            allowed: ALLOWED_RENDER_GPUS,
            violations,
          },
          ok: r.ok && body?.ok !== false && violations.length === 0,
          configured: true,
          illustrative: true,
          label: RENDER_LABEL,
        });
      } catch (error) {
        return sendJson(res, 200, {
          ok: false,
          configured: true,
          unreachable: true,
          error: String(error?.message || error).slice(0, 200),
          illustrative: true,
          label: RENDER_LABEL,
        });
      }
    }

    if (sub === '' && req.method === 'POST') {
      if (rejectCrossOrigin(req, res)) return;
      if (!cfg.configured) return notConfigured(res);
      let body;
      try {
        body = await readJsonBody(req, { maxBytes: 8 * 1024 });
      } catch (error) {
        return sendJson(res, error?.status || 400, { error: 'invalid_json' });
      }
      const v = validateRenderRequest(body);
      if (v.error) return sendJson(res, 400, { error: v.error });
      v.value.seed = promptSeed(v.value.prompt);
      const promptSha = promptHash(v.value.prompt);
      const policy = await checkGpuPolicy();
      if (policy.violations && policy.violations.length)
        return sendJson(res, 409, {
          error: 'gpu_policy_violation',
          message: `Render host advertises GPU(s) ${policy.violations.join(', ')}; Blender may only use GPUs ${ALLOWED_RENDER_GPUS.join(', ')}. Redeploy render_service with RENDER_GPUS=2,6.`,
          advertised_gpus: policy.gpus,
          seed: v.value.seed,
          prompt_hash: promptSha,
        });
      // Never let a geocoder miss kill the Blender job: resolve coordinates
      // here (known place -> Nominatim ladder -> city -> prompt-only) and hand
      // them to the service, which then skips its own failing geocode step.
      let location = null;
      if (v.value.lat === undefined) {
        try {
          location = await geocode(v.value.prompt);
        } catch {
          location = null;
        }
        if (
          location &&
          Number.isFinite(location.lat) &&
          Number.isFinite(location.lng)
        ) {
          v.value.lat = location.lat;
          v.value.lng = location.lng;
        }
      }
      try {
        const r = await fetchImpl(`${cfg.url}/render`, {
          method: 'POST',
          headers: { ...headers(), 'content-type': 'application/json' },
          body: JSON.stringify(v.value),
          signal: AbortSignal.timeout(20000),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok)
          return sendJson(res, r.status === 401 ? 502 : r.status, {
            error: 'render_service_error',
            status: r.status,
            detail: data?.detail || null,
          });
        return sendJson(res, 202, {
          ...rewriteJobUrls(data, data.job_id),
          location,
          seed: v.value.seed,
          prompt_hash: promptSha,
        });
      } catch (error) {
        return sendJson(res, 502, {
          error: 'render_service_unreachable',
          message: String(error?.message || error).slice(0, 200),
        });
      }
    }

    const m = sub.match(
      /^\/([a-f0-9]{6,32})\/(status|stream|latest\.jpg|video\.mp4|frames\/(\d{1,5})\.png)$/,
    );
    if (!m || req.method !== 'GET') return next();
    const [, job, kind, frameNo] = m;
    if (!JOB_RE.test(job)) return next();
    if (!cfg.configured) return notConfigured(res);
    const upstreamPath =
      kind === 'status'
        ? `/status/${job}`
        : kind === 'stream'
          ? `/stream/${job}`
          : kind === 'latest.jpg'
            ? `/frames/${job}/latest.jpg`
            : kind === 'video.mp4'
              ? `/video/${job}.mp4`
              : `/frames/${job}/${Number(frameNo)}.png`;
    try {
      const fwd = { ...headers() };
      if (req.headers.range) fwd.range = req.headers.range;
      const r = await fetchImpl(`${cfg.url}${upstreamPath}`, {
        headers: fwd,
        signal: kind === 'stream' ? undefined : AbortSignal.timeout(30000),
      });
      if (kind === 'status') {
        const data = await r.json().catch(() => ({}));
        return sendJson(res, r.ok ? 200 : r.status, rewriteJobUrls(data, job));
      }
      return pipe(res, r);
    } catch (error) {
      return sendJson(res, 502, {
        error: 'render_service_unreachable',
        message: String(error?.message || error).slice(0, 200),
      });
    }
  };
}

export function mountSceneRenderRoutes(router, deps) {
  const handler = createSceneRenderRoutes(deps);
  router.use('/api/scenes', (req, res, next) => {
    handler(req, res, next).catch(next);
  });
  return handler;
}
