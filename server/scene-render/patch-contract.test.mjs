import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneRenderRoutes,
  validateRenderRequest,
  validateCameraRequest,
  rewriteJobUrls,
} from './routes.js';
import { gpuPolicyViolations } from './promptSeed.js';
const request = (url, body) => ({
  method: 'POST',
  url,
  headers: { host: 'app.local', origin: 'http://app.local' },
  body: JSON.stringify(body),
});
function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(v = '') {
      this.body += v;
    },
    write() {
      return true;
    },
    on() {},
    off() {},
  };
}
const ok = (data) => ({ ok: true, status: 200, json: async () => data });

test('coordinates supplied by a client cannot forge verification or inject source URLs', () => {
  const { value } = validateRenderRequest({
    prompt: 'Example patch',
    aoi: {
      lat: 24.4,
      lon: 54.3,
      radiusM: 400,
      verification: 'verified',
      source: 'official',
    },
    location: { verification: 'verified' },
  });
  assert.equal(value.location.verification, 'unverified');
  assert.equal(value.location.source, 'user-selected');
  assert.deepEqual(value.location.provenance, []);
  assert.equal(value.radius_m, 400);
});

test('invalid bounds, placeholders, coordinates and camera poses fail validation', () => {
  assert.equal(
    validateRenderRequest({ prompt: 'Car at {{location}}' }).error,
    'unresolved_placeholders',
  );
  for (const radius of [0, -100, 1500, NaN])
    assert.equal(
      validateRenderRequest({ prompt: 'Example patch', radius_m: radius })
        .error,
      'invalid_patch_radius',
    );
  assert.equal(
    validateRenderRequest({ prompt: 'Example patch', lat: 89, lng: 54 }).error,
    'invalid_coordinates',
  );
  assert.equal(
    validateCameraRequest({ position: [0, 0, NaN], target: [0, 0, 0] }).error,
    'invalid_camera_pose',
  );
  assert.equal(
    validateCameraRequest({
      position: [0, 0, 80],
      target: [0, 0, 0],
      fovDeg: 170,
    }).error,
    'invalid_camera_fov',
  );
  assert.equal(
    validateCameraRequest({ action: 'run-script' }).error,
    'invalid_camera_action',
  );
  assert.equal(
    validateCameraRequest({ action: 'orbit-left', revision: -1 }).error,
    'invalid_revision',
  );
});

test('missing inventory or an unavailable policy check never permits a render', async () => {
  assert.deepEqual(gpuPolicyViolations({}), ['unverified_gpu_inventory']);
  assert.deepEqual(gpuPolicyViolations({ gpus: ['2'] }), [
    'missing_physical_gpu_6',
  ]);
  const calls = [];
  const h = createSceneRenderRoutes({
    env: { RENDER_SERVICE_URL: 'https://gpu.example' },
    fetchImpl: async (url) => {
      calls.push(url);
      throw new Error('offline');
    },
  });
  const res = response();
  await h(
    request('/render/start', { prompt: 'Example patch', lat: 24.4, lng: 54.3 }),
    res,
    () => assert.fail('next'),
  );
  assert.equal(res.statusCode, 409);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/health$/);
});

test('one verified build transports the actual patch identity and chosen radius', async () => {
  const calls = [];
  const location = {
    name: 'Source site',
    lat: 24.1,
    lng: 54.1,
    verification: 'verified',
    source: 'verified-osm-feature',
    sourceFeatureId: 'way/12',
    radiusM: 700,
    provenance: [{ url: 'https://www.openstreetmap.org/way/12' }],
  };
  const h = createSceneRenderRoutes({
    env: { RENDER_SERVICE_URL: 'https://gpu.example' },
    geocode: async () => location,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return ok(
        url.endsWith('/health')
          ? { ok: true, gpus: ['2', '6'] }
          : { job_id: 'aabbccdd' },
      );
    },
  });
  const res = response();
  await h(
    request('/render/start', {
      prompt: 'Source site',
      request_id: 'request-123',
    }),
    res,
    () => assert.fail('next'),
  );
  assert.equal(res.statusCode, 202);
  const render = calls.filter((c) => c.url.endsWith('/render'));
  assert.equal(render.length, 1);
  const payload = JSON.parse(render[0].init.body);
  assert.equal(payload.location.sourceFeatureId, 'way/12');
  assert.equal(payload.radius_m, 700);
  assert.equal(payload.request_id, 'request-123');
  const body = JSON.parse(res.body);
  assert.equal(body.location.name, 'Source site');
  assert.equal(body.jobId, 'aabbccdd');
});

test('camera update and cancellation use the existing service with authenticated POST, never client transformations', async () => {
  const calls = [];
  const h = createSceneRenderRoutes({
    env: {
      RENDER_SERVICE_URL: 'https://gpu.example',
      RENDER_SERVICE_TOKEN: 'test-only-fixture',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return ok(
        url.endsWith('/health')
          ? { ok: true, gpus: ['2', '6'] }
          : { job_id: 'bbccdd11' },
      );
    },
  });
  const a = response();
  await h(
    request('/render/aabbccdd/camera', { action: 'orbit-left', revision: 3 }),
    a,
    () => assert.fail('next'),
  );
  assert.equal(a.statusCode, 202);
  const c = calls.find((v) => v.url.endsWith('/camera'));
  assert.deepEqual(JSON.parse(c.init.body), {
    action: 'orbit-left',
    revision: 3,
  });
  assert.equal(c.init.headers.authorization, 'Bearer test-only-fixture');
  assert.ok(!a.body.includes('test-only-fixture'));
  const b = response();
  await h(request('/render/bbccdd11/cancel', {}), b, () => assert.fail('next'));
  assert.equal(b.statusCode, 200);
  assert.ok(calls.some((v) => v.url.endsWith('/render/bbccdd11/cancel')));
});

test('frame and patch URLs are same-origin and carry both JPEG playback and PNG export', () => {
  const d = rewriteJobUrls({ job_id: 'aabbccdd' }, 'aabbccdd');
  assert.equal(
    d.frames_url_template,
    '/api/scenes/render/aabbccdd/frames/{n}.jpg',
  );
  assert.equal(
    d.png_frames_url_template,
    '/api/scenes/render/aabbccdd/frames/{n}.png',
  );
  assert.equal(d.patch_url, '/api/scenes/render/aabbccdd/patch');
});
