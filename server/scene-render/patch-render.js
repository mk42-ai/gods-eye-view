/**
 * ondemandPatchRender — one public, credential-free facade over the bounded
 * patch-to-3D Blender pipeline (render_service on the GPU host, GPUs 2 and 6).
 *
 *   POST /api/patch-render          {prompt, place?, bbox?, lat?, lon?, time_of_day?, camera_mode?, duration?}
 *   GET  /api/patch-render/:jobId   status + frame/stream/mp4 URLs + GPU UUID/PID evidence
 *   GET  /api/patch-render/openapi.json
 *
 * The Scene Workstation's Build button and the OnDemand custom tool
 * "ondemandPatchRender" both call this same contract. The render host bearer
 * token never leaves the server (RENDER_SERVICE_URL / RENDER_SERVICE_TOKEN).
 * Every response carries `illustrative: true` — renders are never evidence.
 */
import { readJsonBody, sendJson } from '../ondemand/http.js';
import { renderServiceConfig, RENDER_LABEL } from './routes.js';
import { resolvePromptLocation } from './geocode.js';
import { ALLOWED_RENDER_GPUS, gpuPolicyViolations } from './promptSeed.js';

const JOB_RE = /^[a-f0-9]{12,20}$/;
const TIMES = new Set(['midday', 'dusk', 'night', 'auto']);
const MODES = new Set(['street', 'low_oblique', 'orbit']);

export function validatePatchRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'invalid_request_body' };
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > 3000)
    return { error: 'invalid_prompt' };
  if (/\{\{[^}]*\}\}|\[(?:location|place|insert)[^\]]*\]/i.test(prompt))
    return { error: 'unresolved_placeholders' };
  const out = { prompt };
  const place = body.place == null ? '' : String(body.place).trim();
  if (place.length > 200) return { error: 'invalid_place' };
  if (place) out.place = place;
  const num = (v, lim) =>
    typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
  if (body.bbox !== undefined && body.bbox !== null) {
    const b = body.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => num(v, 180)))
      return { error: 'invalid_bbox' };
    const [w, s, e, n] = b;
    if (!(w < e && s < n && Math.abs(s) <= 80 && Math.abs(n) <= 80))
      return { error: 'invalid_bbox' };
    const midLat = (s + n) / 2;
    const widthM = (e - w) * 111320 * Math.cos((midLat * Math.PI) / 180);
    const heightM = (n - s) * 111320;
    if (widthM < 100 || heightM < 100 || widthM > 2400 || heightM > 2400)
      return {
        error: 'bbox_size_out_of_range',
        message: 'bbox sides must be 100–2400 m',
      };
    out.bbox = [w, s, e, n];
  }
  const lat =
    body.lat ?? (out.bbox ? (out.bbox[1] + out.bbox[3]) / 2 : undefined);
  const lon =
    body.lon ??
    body.lng ??
    (out.bbox ? (out.bbox[0] + out.bbox[2]) / 2 : undefined);
  if (lat !== undefined || lon !== undefined) {
    if (!num(lat, 80) || !num(lon, 180))
      return { error: 'invalid_coordinates' };
    out.lat = lat;
    out.lon = lon;
    if (
      out.bbox &&
      !(
        out.bbox[0] <= lon &&
        lon <= out.bbox[2] &&
        out.bbox[1] <= lat &&
        lat <= out.bbox[3]
      )
    )
      return { error: 'coordinate_outside_bbox' };
  }
  const tod = body.time_of_day ?? 'auto';
  if (!TIMES.has(tod)) return { error: 'invalid_time_of_day' };
  out.time_of_day = tod;
  const mode = body.camera_mode ?? 'street';
  if (!MODES.has(mode)) return { error: 'invalid_camera_mode' };
  out.camera_mode = mode;
  const d = body.duration ?? body.duration_s ?? 5;
  if (!Number.isInteger(d) || d < 2 || d > 10)
    return {
      error: 'invalid_duration',
      message: 'duration must be an integer 2–10 s',
    };
  out.duration_s = d;
  if (
    body.layers &&
    typeof body.layers === 'object' &&
    !Array.isArray(body.layers)
  ) {
    out.layers = {};
    for (const k of [
      'imagery',
      'buildings',
      'roads',
      'sidewalks',
      'scenery',
      'staging',
      'skirt',
    ])
      if (typeof body.layers[k] === 'boolean') out.layers[k] = body.layers[k];
  }
  return { value: out };
}

function publicUrls(origin, jobId) {
  const base = `${origin}/api/scenes/render/${jobId}`;
  return {
    status_url: `${origin}/api/patch-render/${jobId}`,
    stream_url: `${base}/stream`,
    latest_frame_url: `${base}/latest.jpg`,
    mp4_url: `${base}/video.mp4`,
    frames_url_template: `${base}/frames/{n}.jpg`,
  };
}

function originOf(req) {
  const host =
    req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto =
    req.headers['x-forwarded-proto'] ||
    (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
}

export function openApiDocument(origin) {
  const pose = {
    type: 'object',
    description: 'Camera pose in local metres (east, north, up).',
  };
  return {
    openapi: '3.0.3',
    info: {
      title: 'ondemandPatchRender',
      version: '1.0.0',
      description:
        'Render a geo-aligned 3D patch (OSM buildings/roads, Copernicus DSM terrain, ortho imagery, Poly Haven CC0 scenery and illustrative scenario objects) with headless Blender 4.2 Cycles/OptiX on the approved GPUs 2 and 6 only. Renders are illustrative staging, never evidence.',
    },
    servers: [{ url: origin }],
    paths: {
      '/api/patch-render': {
        post: {
          operationId: 'ondemandPatchRender',
          summary: 'Start a patch render job',
          description:
            'Resolves the place (verified OSM feature) or uses the supplied lat/lon or bbox, builds the 3D patch and starts rendering on GPUs 2 and 6. Returns job_id and URLs immediately; poll getPatchRenderStatus.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    prompt: {
                      type: 'string',
                      description:
                        'Scene description, e.g. "Car crash outside Yas Mall".',
                    },
                    place: {
                      type: 'string',
                      description:
                        'Optional place name to resolve (verified OSM feature).',
                    },
                    bbox: {
                      type: 'array',
                      items: { type: 'number' },
                      minItems: 4,
                      maxItems: 4,
                      description:
                        '[west, south, east, north] in degrees; sides 100–2400 m.',
                    },
                    lat: {
                      type: 'number',
                      description: 'Latitude of the patch centre (degrees).',
                    },
                    lon: {
                      type: 'number',
                      description: 'Longitude of the patch centre (degrees).',
                    },
                    time_of_day: {
                      type: 'string',
                      enum: ['midday', 'dusk', 'night', 'auto'],
                      description:
                        'Lighting preset; auto infers night/dusk from the prompt, otherwise midday.',
                    },
                    camera_mode: {
                      type: 'string',
                      enum: ['street', 'low_oblique', 'orbit'],
                      description:
                        'Camera height band: street (default), low_oblique or orbit. Never tilts to the horizon or passes through buildings.',
                    },
                    duration: {
                      type: 'integer',
                      minimum: 2,
                      maximum: 10,
                      description: 'Timeline seconds (24 fps timeline).',
                    },
                  },
                },
              },
            },
          },
          responses: {
            202: {
              description: 'Job accepted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PatchRenderJob' },
                },
              },
            },
          },
        },
      },
      '/api/patch-render/{jobId}': {
        get: {
          operationId: 'getPatchRenderStatus',
          summary:
            'Get patch render job status, frame/stream/mp4 URLs and nvidia-smi GPU evidence',
          parameters: [
            {
              name: 'jobId',
              in: 'path',
              required: true,
              description: 'job_id returned by ondemandPatchRender.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'Job status',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PatchRenderJob' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        PatchRenderJob: {
          type: 'object',
          properties: {
            job_id: { type: 'string', description: 'Render job identifier.' },
            status: {
              type: 'string',
              description:
                'queued | land_patch | scene_spec | placement | render | encode | complete | partial | failed | cancelled',
            },
            stream_url: {
              type: 'string',
              description: 'MJPEG stream of newly published frames.',
            },
            latest_frame_url: {
              type: 'string',
              description: 'Latest published JPEG frame.',
            },
            mp4_url: {
              type: 'string',
              description: 'H.264 MP4 (CPU libx264) once status is complete.',
            },
            gpu_uuids: {
              type: 'array',
              items: { type: 'string' },
              description:
                'GPU UUIDs attested on the rendered frames (approved GPUs 2 and 6 only).',
            },
            nvidia_smi: {
              type: 'object',
              description:
                'nvidia-smi compute-app rows for this renderer (pid, gpuUuid).',
            },
            first_frame_s: {
              type: 'number',
              description: 'Seconds from job accept to first published frame.',
            },
            steady_fps: {
              type: 'number',
              description: 'Measured steady sequence render rate (frames/s).',
            },
            frames_done: { type: 'integer', description: 'Published frames.' },
            total_frames: {
              type: 'integer',
              description: 'Frames planned for the timeline.',
            },
            camera: pose,
            illustrative: {
              type: 'boolean',
              description:
                'Always true: renders are illustrative staging, not evidence.',
            },
          },
        },
      },
    },
  };
}

export function createPatchRenderRoutes({
  env = process.env,
  fetchImpl = globalThis.fetch,
  geocode = (prompt) => resolvePromptLocation(prompt, { fetchImpl }),
} = {}) {
  const cfg = renderServiceConfig(env);
  const auth = () =>
    cfg.token ? { authorization: `Bearer ${cfg.token}` } : {};
  async function upstream(path, init = {}, timeout = 20000) {
    const r = await fetchImpl(`${cfg.url}${path}`, {
      ...init,
      headers: { ...auth(), ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeout),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }
  async function gpuEvidence() {
    try {
      const r = await upstream('/gpu-evidence', {}, 12000);
      return r.ok
        ? r.data
        : { error: 'gpu_evidence_unavailable', status: r.status };
    } catch (e) {
      return {
        error: 'gpu_evidence_unavailable',
        message: String(e?.message || e).slice(0, 160),
      };
    }
  }
  function summarize(job, origin, evidence) {
    const frames = Array.isArray(job.frames) ? job.frames : [];
    const uuids = [...new Set(frames.map((f) => f?.gpu?.uuid).filter(Boolean))];
    const pids = [...new Set(frames.map((f) => f?.workerPid).filter(Boolean))];
    return {
      tool: 'ondemandPatchRender',
      job_id: job.job_id || job.jobId,
      status: job.stage,
      error: job.error || null,
      ...publicUrls(origin, job.job_id || job.jobId),
      mp4_ready: Boolean(job.mp4_bytes),
      gpu_uuids: uuids,
      gpu_physical_indices: [
        ...new Set(
          frames.map((f) => f?.gpu?.physicalIndex).filter((v) => v != null),
        ),
      ],
      worker_pids: pids,
      frames_by_gpu: job.frames_by_gpu || null,
      nvidia_smi: evidence || null,
      allowed_gpus: ALLOWED_RENDER_GPUS,
      first_frame_s: job.ttff_s ?? null,
      steady_fps: job.fps_steady ?? null,
      sequence_fps_wall: job.fps_sequence_wall ?? null,
      frames_done: job.frames_done ?? 0,
      total_frames: job.total_frames ?? null,
      timeline_fps: job.timeline_fps ?? null,
      camera: { mode: job.camera_mode || null, pose: job.pose || null },
      focal: job.focal
        ? {
            name: job.focal.name,
            lat: job.focal.lat,
            lon: job.focal.lon,
            source: job.focal.source,
            precision: job.focal.precision,
          }
        : null,
      patch: job.patch ? { id: job.patch.id, bounds: job.patch.bounds } : null,
      imagery: job.imagery || null,
      scenery: job.scenery || null,
      sidewalks: job.sidewalks || null,
      land_patch: job.land_patch || null,
      illustrative: true,
      label: RENDER_LABEL,
    };
  }

  return async function patchRenderHandler(req, res, next) {
    const url = new URL(req.originalUrl || req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '');
    if (!path.startsWith('/api/patch-render')) return next();
    const origin = originOf(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (path === '/api/patch-render/openapi.json' && req.method === 'GET')
      return sendJson(res, 200, openApiDocument(origin));
    if (!cfg.configured)
      return sendJson(res, 503, {
        error: 'not_configured',
        message: 'RENDER_SERVICE_URL is not configured on the server.',
        illustrative: true,
      });

    if (path === '/api/patch-render' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req, { maxBytes: 16 * 1024 });
      } catch {
        return sendJson(res, 400, { error: 'invalid_json' });
      }
      const v = validatePatchRequest(body);
      if (v.error) return sendJson(res, 400, v);
      const req2 = v.value;
      const health = await upstream('/health', {}, 8000).catch(() => null);
      const violations = health?.ok
        ? gpuPolicyViolations(health.data)
        : ['gpu_service_not_ready'];
      if (violations.length)
        return sendJson(res, 409, {
          error: 'gpu_policy_violation',
          violations,
          allowed_gpus: ALLOWED_RENDER_GPUS,
        });
      const payload = {
        prompt: req2.prompt,
        duration_s: req2.duration_s,
        time_of_day: req2.time_of_day,
        camera_mode: req2.camera_mode,
        ...(req2.layers ? { layers: req2.layers } : {}),
      };
      let location = null;
      if (req2.lat !== undefined) {
        payload.lat = req2.lat;
        payload.lon = req2.lon;
        payload.selectedCoordinates = true;
        if (req2.bbox) payload.aoi = req2.bbox;
        else payload.radius_m = 450;
        location = {
          name: req2.place || 'Map-selected patch',
          lat: req2.lat,
          lng: req2.lon,
          verification: 'operator-selected',
          precision: 'map-coordinates',
        };
      } else {
        location = await geocode(req2.place || req2.prompt).catch(() => null);
        if (!location || location.verification !== 'verified')
          return sendJson(res, 422, {
            error: 'location_selection_required',
            message:
              'Place could not be verified to a mapped feature. Supply lat/lon or bbox (map coordinates); no city-centre substitute is rendered.',
          });
        payload.lat = location.lat;
        payload.lon = location.lng;
        payload.radius_m = Math.min(
          600,
          Math.max(300, location.radiusM || 450),
        );
        payload.locationVerification = {
          verified: true,
          precision: [
            'mapped-building-footprint',
            'official-address-mapped-building',
          ].includes(location.precision)
            ? location.precision
            : 'mapped-feature',
          source: location.source,
          featureId: location.sourceFeatureId,
          name: location.name,
          kind: location.siteId === 'yas-mall' ? 'mall' : 'venue',
          provenance: location.provenance,
        };
      }
      let r;
      try {
        r = await upstream('/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        return sendJson(res, 502, {
          error: 'render_service_unreachable',
          message: String(e?.message || e).slice(0, 200),
        });
      }
      if (!r.ok && r.status === 422 && payload.locationVerification) {
        // Geocoder verification failed downstream -> fall back to the map coordinates, labelled unverified.
        delete payload.locationVerification;
        payload.selectedCoordinates = true;
        location = { ...location, verification: 'map-coordinates-fallback' };
        r = await upstream('/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => r);
      }
      if (!r.ok)
        return sendJson(res, r.status === 401 ? 502 : r.status, {
          error: 'render_service_error',
          status: r.status,
          detail: r.data?.detail || null,
        });
      return sendJson(res, 202, {
        ...summarize(r.data, origin, null),
        location,
      });
    }

    const m = path.match(/^\/api\/patch-render\/([a-f0-9]{12,20})$/);
    if (m && req.method === 'GET' && JOB_RE.test(m[1])) {
      try {
        const [st, ev] = await Promise.all([
          upstream(`/status/${m[1]}`, {}, 20000),
          url.searchParams.get('evidence') === '0'
            ? Promise.resolve(null)
            : gpuEvidence(),
        ]);
        if (!st.ok)
          return sendJson(res, st.status, {
            error: 'status_unavailable',
            detail: st.data?.detail || null,
          });
        return sendJson(res, 200, summarize(st.data, origin, ev));
      } catch (e) {
        return sendJson(res, 502, {
          error: 'render_service_unreachable',
          message: String(e?.message || e).slice(0, 200),
        });
      }
    }
    return next();
  };
}

export function mountPatchRenderRoutes(router, deps) {
  const handler = createPatchRenderRoutes(deps);
  router.use('/api/patch-render', (req, res, next) => {
    handler(req, res, next).catch(next);
  });
  return handler;
}
