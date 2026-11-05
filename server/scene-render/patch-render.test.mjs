import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  validatePatchRequest,
  createPatchRenderRoutes,
  openApiDocument,
} from './patch-render.js';

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, url, originalUrl: url, headers: { host: 'example.test', 'content-type': 'application/json' } });
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => (headers[k.toLowerCase()] = v),
      getHeader: (k) => headers[k.toLowerCase()],
      end(data) {
        resolve({ status: this.statusCode, headers, body: data ? JSON.parse(String(data)) : null });
      },
      writeHead(s, h) {
        this.statusCode = s;
        Object.assign(headers, h || {});
      },
    };
    handler(req, res, () => resolve({ status: 404, next: true }));
  });
}

const health = { ok: true, gpus: ['2', '6'], gpu_policy: { backend: 'OPTIX' } };

test('validation: bbox size, coordinate inside bbox, placeholders, duration', () => {
  assert.equal(validatePatchRequest({ prompt: 'x' }).error, 'invalid_prompt');
  assert.equal(validatePatchRequest({ prompt: 'crash at {{place}}' }).error, 'unresolved_placeholders');
  assert.equal(validatePatchRequest({ prompt: 'crash', bbox: [54.6, 24.48, 54.6001, 24.4801] }).error, 'bbox_size_out_of_range');
  assert.equal(validatePatchRequest({ prompt: 'crash', duration: 60 }).error, 'invalid_duration');
  const ok = validatePatchRequest({ prompt: 'crash', bbox: [54.604, 24.485, 54.613, 24.492] });
  assert.ok(ok.value.lat > 24.485 && ok.value.lon > 54.604);
  assert.equal(ok.value.camera_mode, 'street');
  assert.equal(validatePatchRequest({ prompt: 'crash', bbox: [54.604, 24.485, 54.613, 24.492], lat: 1, lon: 1 }).error, 'coordinate_outside_bbox');
});

test('POST refuses when the render host advertises a GPU other than 2/6', async () => {
  const fetchImpl = async (u) => ({ ok: true, status: 200, json: async () => ({ ...health, gpus: ['1', '2', '6'] }) });
  const h = createPatchRenderRoutes({ env: { RENDER_SERVICE_URL: 'http://rs', RENDER_SERVICE_TOKEN: 't' }, fetchImpl });
  const r = await call(h, 'POST', '/api/patch-render', { prompt: 'Car crash', lat: 24.48, lon: 54.6 });
  assert.equal(r.status, 409);
  assert.ok(r.body.violations.includes('1'));
});

test('POST with map coordinates forwards selectedCoordinates + camera mode; status returns GPU evidence', async () => {
  const seen = [];
  const fetchImpl = async (u, init = {}) => {
    seen.push([u, init.body ? JSON.parse(init.body) : null, init.headers]);
    if (u.endsWith('/health')) return { ok: true, status: 200, json: async () => health };
    if (u.endsWith('/render')) return { ok: true, status: 200, json: async () => ({ job_id: 'abcdef123456', stage: 'queued' }) };
    if (u.includes('/status/')) return { ok: true, status: 200, json: async () => ({ job_id: 'abcdef123456', stage: 'complete', ttff_s: 25.1, fps_steady: 8.2, frames_done: 120, total_frames: 120, mp4_bytes: 10, frames: [{ workerPid: 7, gpu: { uuid: 'GPU-b2', physicalIndex: 2 } }, { workerPid: 8, gpu: { uuid: 'GPU-2c', physicalIndex: 6 } }] }) };
    if (u.endsWith('/gpu-evidence')) return { ok: true, status: 200, json: async () => ({ rendererGpuUuids: ['GPU-b2', 'GPU-2c'], violations: [] }) };
    throw new Error('unexpected ' + u);
  };
  const h = createPatchRenderRoutes({ env: { RENDER_SERVICE_URL: 'http://rs', RENDER_SERVICE_TOKEN: 'secret' }, fetchImpl });
  const r = await call(h, 'POST', '/api/patch-render', { prompt: 'Car crash', lat: 24.48, lon: 54.6, camera_mode: 'low_oblique', time_of_day: 'dusk' });
  assert.equal(r.status, 202);
  assert.equal(r.body.job_id, 'abcdef123456');
  assert.equal(r.body.illustrative, true);
  assert.match(r.body.latest_frame_url, /^https:\/\/example\.test\/api\/scenes\/render\/abcdef123456\/latest\.jpg$/);
  const fwd = seen.find(([u]) => u.endsWith('/render'))[1];
  assert.equal(fwd.selectedCoordinates, true);
  assert.equal(fwd.camera_mode, 'low_oblique');
  assert.equal(fwd.time_of_day, 'dusk');
  assert.ok(!JSON.stringify(r.body).includes('secret'));
  const st = await call(h, 'GET', '/api/patch-render/abcdef123456');
  assert.equal(st.status, 200);
  assert.deepEqual(st.body.gpu_uuids.sort(), ['GPU-2c', 'GPU-b2']);
  assert.deepEqual(st.body.gpu_physical_indices.sort(), [2, 6]);
  assert.equal(st.body.steady_fps, 8.2);
  assert.equal(st.body.nvidia_smi.violations.length, 0);
});

test('unverified place returns 422 instead of a city substitute', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => health });
  const h = createPatchRenderRoutes({ env: { RENDER_SERVICE_URL: 'http://rs' }, fetchImpl, geocode: async () => ({ verification: 'unverified' }) });
  const r = await call(h, 'POST', '/api/patch-render', { prompt: 'something somewhere' });
  assert.equal(r.status, 422);
});

test('openapi document exposes both operations', () => {
  const d = openApiDocument('https://x.test');
  assert.equal(d.paths['/api/patch-render'].post.operationId, 'ondemandPatchRender');
  assert.equal(d.paths['/api/patch-render/{jobId}'].get.operationId, 'getPatchRenderStatus');
  assert.equal(d.servers[0].url, 'https://x.test');
});

test('resolution is an optional bounded 16:9 enum forwarded to the render host', () => {
  const ok = validatePatchRequest({
    prompt: 'car crash outside Yas Mall',
    lat: 24.4884,
    lon: 54.6088,
    resolution: '1280x720',
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.resolution, '1280x720');
  const bad = validatePatchRequest({
    prompt: 'car crash outside Yas Mall',
    resolution: '4096x2160',
  });
  assert.equal(bad.error, 'invalid_resolution');
  const doc = openApiDocument('https://example.test');
  const props =
    doc.paths['/api/patch-render'].post.requestBody.content[
      'application/json'
    ].schema.properties;
  assert.deepEqual(props.resolution.enum, ['640x360', '960x540', '1280x720']);
});
