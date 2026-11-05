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
  if (prompt.length < 3 || prompt.length > 3000)
    return { error: 'invalid_prompt' };
  if (
    /\{\{[^}]*\}\}|<(?:location|place|insert)[^>]*>|\[(?:location|place|insert)[^\]]*\]/i.test(
      prompt,
    )
  )
    return { error: 'unresolved_placeholders' };
  const out = { prompt };
  const num = (v, lim) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
  const aoi = body.aoi;
  const lat = aoi?.lat ?? body.lat;
  const lng = aoi?.lon ?? aoi?.lng ?? body.lon ?? body.lng;
  if (lat !== undefined || lng !== undefined) {
    if (!num(lat, 80) || !num(lng, 180))
      return { error: 'invalid_coordinates' };
    out.lat = lat;
    out.lng = lng;
    out.location = {
      name: String(aoi?.name || 'Operator-selected geographic patch').slice(
        0,
        160,
      ),
      lat,
      lng,
      source: 'user-selected',
      verification: 'unverified',
      approximate: true,
      precision: 'operator-map-selection',
      limitation:
        'Coordinates were explicitly selected by the operator; the place name is not independently verified.',
      provenance: [],
    };
  }
  const radius = aoi?.radiusM ?? body.radius_m ?? body.radiusM;
  if (radius !== undefined) {
    if (!num(radius, 1200) || radius < 150)
      return { error: 'invalid_patch_radius' };
    out.radius_m = radius;
  }
  if (body.time_of_day !== undefined && body.time_of_day !== null) {
    if (!TIMES.has(body.time_of_day)) return { error: 'invalid_time_of_day' };
    out.time_of_day = body.time_of_day;
  }
  const d = body.duration_s ?? body.durationSec ?? 4;
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
  if (body.request_id !== undefined) {
    if (
      typeof body.request_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,96}$/.test(body.request_id)
    )
      return { error: 'invalid_request_id' };
    out.request_id = body.request_id;
  }
  if (body.camera !== undefined) {
    const v = validateCameraRequest(body.camera);
    if (v.error) return v;
    out.camera = v.value;
  }
  return { value: out };
}

export function validateCameraRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'invalid_camera' };
  const actions = new Set([
    'orbit-left',
    'orbit-right',
    'forward',
    'back',
    'up',
    'down',
  ]);
  const value = {};
  if (body.action !== undefined) {
    if (!actions.has(body.action)) return { error: 'invalid_camera_action' };
    value.action = body.action;
  } else {
    for (const key of ['position', 'target']) {
      if (
        !Array.isArray(body[key]) ||
        body[key].length !== 3 ||
        body[key].some(
          (v) =>
            typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 10000,
        )
      )
        return { error: 'invalid_camera_pose' };
      value[key] = body[key];
    }
    const fov = body.fovDeg ?? 45;
    if (
      typeof fov !== 'number' ||
      !Number.isFinite(fov) ||
      fov < 25 ||
      fov > 70
    )
      return { error: 'invalid_camera_fov' };
    value.fovDeg = fov;
  }
  if (body.revision !== undefined) {
    if (!Number.isSafeInteger(body.revision) || body.revision < 1)
      return { error: 'invalid_revision' };
    value.revision = body.revision;
  }
  return { value };
}

/** Rewrite service-absolute URLs in a status payload to same-origin proxy paths. */
export function rewriteJobUrls(payload, jobId) {
  if (!payload || typeof payload !== 'object') return payload;
  const base = `/api/scenes/render/${jobId}`;
  const rewriteFrame = (frame) => {
    if (!frame || typeof frame !== 'object') return frame;
    const name = String(frame.url || '')
      .split('/')
      .pop();
    const url = /^f_\d{4}_(preview|quality|sequence)\.jpg$/.test(name)
      ? `${base}/frames/file/${name}`
      : `${base}/frames/${Number(frame.index) || 1}.jpg`;
    return { ...frame, url };
  };
  return {
    ...payload,
    ...(Array.isArray(payload.frames)
      ? { frames: payload.frames.map(rewriteFrame) }
      : {}),
    ...(payload.latestFrame
      ? { latestFrame: rewriteFrame(payload.latestFrame) }
      : {}),
    illustrative: true,
    label: RENDER_LABEL,
    jobId,
    status_url: `${base}/status`,
    statusUrl: `${base}/status`,
    stream_url: `${base}/stream`,
    latest_frame_url: `${base}/latest.jpg`,
    frames_url_template: `${base}/frames/{n}.jpg`,
    jpeg_frames_url_template: `${base}/frames/{n}.jpg`,
    png_frames_url_template: `${base}/frames/{n}.png`,
    camera_url: `${base}/camera`,
    cancel_url: `${base}/cancel`,
    patch_url: `${base}/patch`,
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
  let policyCache = {
    at: 0,
    violations: ['unverified_gpu_inventory'],
    gpus: null,
  };
  async function checkGpuPolicy() {
    if (
      Date.now() - policyCache.at < 10000 &&
      policyCache.violations.length === 0
    )
      return policyCache;
    try {
      const r = await fetchImpl(`${cfg.url}/health`, {
        headers: headers(),
        signal: AbortSignal.timeout(8000),
      });
      const body = await r.json().catch(() => ({}));
      policyCache = {
        at: Date.now(),
        violations:
          r.ok && body?.ok !== false
            ? gpuPolicyViolations(body)
            : ['gpu_service_not_ready'],
        gpus: body?.gpus || null,
      };
    } catch {
      policyCache = {
        at: 0,
        violations: ['unverified_gpu_inventory'],
        gpus: null,
      };
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
      'etag',
      'last-modified',
      'x-frame-id',
      'x-frame-hash',
      'x-frame-utc',
      'x-frame-sha256',
      'x-frame-created-utc',
      'x-camera-revision',
      'x-patch-id',
      'x-scene-id',
      'x-job-id',
      'x-render-version',
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

    if ((sub === '/locate' || sub === '/resolve') && req.method === 'POST') {
      if (rejectCrossOrigin(req, res)) return;
      let body;
      try {
        body = await readJsonBody(req, { maxBytes: 16 * 1024 });
      } catch {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const v = validateRenderRequest(body);
      if (v.error) return sendJson(res, 400, { error: v.error });
      const location =
        v.value.location || (await geocode(v.value.prompt).catch(() => null));
      return sendJson(
        res,
        location ? 200 : 422,
        location
          ? { location }
          : {
              error: 'location_selection_required',
              message:
                'No unambiguous source-verified site was found. Select the actual patch coordinates; a city-centre substitute will not be rendered.',
            },
      );
    }

    if ((sub === '' || sub === '/start') && req.method === 'POST') {
      if (rejectCrossOrigin(req, res)) return;
      if (!cfg.configured) return notConfigured(res);
      let body;
      try {
        body = await readJsonBody(req, { maxBytes: 16 * 1024 });
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
      // Fail closed: a city centroid or approximate table entry is never proof
      // of a gym, mall, or event site. Explicit operator coordinates remain
      // usable, but are labelled unverified and cannot upgrade themselves.
      let location = v.value.location || null;
      if (v.value.lat === undefined) {
        try {
          location = await geocode(v.value.prompt);
        } catch {
          location = null;
        }
        if (
          !location ||
          location.verification !== 'verified' ||
          !Number.isFinite(location.lat) ||
          !Number.isFinite(location.lng)
        ) {
          return sendJson(res, 422, {
            error: 'location_selection_required',
            message:
              'The exact location could not be verified. Select a geographic patch explicitly; no generic city or unrelated scene was substituted.',
            location: null,
            illustrative: true,
            label: RENDER_LABEL,
          });
        }
        v.value.lat = location.lat;
        v.value.lng = location.lng;
      }
      v.value.location = location;
      if (location?.verification === 'verified') {
        v.value.locationVerification = {
          verified: true,
          precision: [
            'mapped-building-footprint',
            'official-address-mapped-building',
          ].includes(location.precision)
            ? location.precision
            : 'mapped-feature',
          sourcePrecision: location.precision,
          source: location.source,
          featureId: location.sourceFeatureId,
          name: location.name,
          kind: location.siteId === 'yas-mall' ? 'mall' : 'venue',
          provenance: location.provenance,
          verifiedUtc: location.verifiedUtc,
          limitation: location.limitation,
        };
      } else v.value.selectedCoordinates = true;
      v.value.radius_m = v.value.radius_m || location?.radiusM || 500;
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

    const action = sub.match(/^\/([a-f0-9]{6,32})\/(camera|cancel)$/);
    if (action && req.method === 'POST') {
      if (rejectCrossOrigin(req, res)) return;
      if (!cfg.configured) return notConfigured(res);
      let value = {};
      if (action[2] === 'camera') {
        let body;
        try {
          body = await readJsonBody(req, { maxBytes: 4 * 1024 });
        } catch {
          return sendJson(res, 400, { error: 'invalid_json' });
        }
        const v = validateCameraRequest(body);
        if (v.error) return sendJson(res, 400, { error: v.error });
        value = v.value;
        const policy = await checkGpuPolicy();
        if (policy.violations.length)
          return sendJson(res, 409, {
            error: 'gpu_policy_violation',
            message:
              'GPU identity/readiness verification failed; camera render was not started.',
            violations: policy.violations,
          });
      }
      try {
        const r = await fetchImpl(
          `${cfg.url}/render/${action[1]}/${action[2]}`,
          {
            method: 'POST',
            headers: { ...headers(), 'content-type': 'application/json' },
            body: JSON.stringify(value),
            signal: AbortSignal.timeout(25000),
          },
        );
        const data = await r.json().catch(() => ({}));
        return sendJson(
          res,
          r.ok ? (action[2] === 'camera' ? 202 : 200) : r.status,
          r.ok
            ? rewriteJobUrls(data, data.job_id || data.jobId || action[1])
            : {
                error: data.error || 'render_service_error',
                detail: data.detail || null,
                message: data.message || 'Render action could not complete.',
              },
        );
      } catch {
        return sendJson(res, 502, {
          error: 'render_service_unreachable',
          message:
            'Render service did not answer; no CPU or stale-frame fallback was used.',
        });
      }
    }

    const m = sub.match(
      /^\/([a-f0-9]{6,32})\/(status|patch|stream|latest\.jpg|video\.mp4|frames\/(\d{1,5})\.(png|jpg)|frames\/file\/(f_\d{4}_(?:preview|quality|sequence)\.jpg))$/,
    );
    if (!m || req.method !== 'GET') return next();
    const [, job, kind, frameNo, frameExt, immutableName] = m;
    if (!JOB_RE.test(job)) return next();
    if (!cfg.configured) return notConfigured(res);
    const upstreamPath =
      kind === 'status'
        ? `/status/${job}`
        : kind === 'patch'
          ? `/patch/${job}`
          : kind === 'stream'
            ? `/stream/${job}`
            : kind === 'latest.jpg'
              ? `/frames/${job}/latest.jpg`
              : kind === 'video.mp4'
                ? `/video/${job}.mp4`
                : immutableName
                  ? `/frames/${job}/file/${immutableName}`
                  : `/frames/${job}/${Number(frameNo)}.${frameExt}`;
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
