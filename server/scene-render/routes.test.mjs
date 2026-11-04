import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRenderRequest,
  rewriteJobUrls,
  createSceneRenderRoutes,
  renderServiceConfig,
  RENDER_LABEL,
} from './routes.js';

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: '', ended: false, listeners: {} };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.end = (b) => { if (b) res.body += b; res.ended = true; };
  res.write = (b) => { res.body += Buffer.from(b).toString(); return true; };
  res.on = (ev, fn) => (res.listeners[ev] = fn);
  res.off = () => {};
  res.once = () => {};
  return res;
}
const req = (method, url, body, headers = {}) => ({
  method, url, headers: { host: 'app.local', origin: 'http://app.local', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('validateRenderRequest enforces prompt, coordinates, time_of_day and duration', () => {
  assert.equal(validateRenderRequest(null).error, 'invalid_request_body');
  assert.equal(validateRenderRequest({ prompt: 'hi' }).error, 'invalid_prompt');
  assert.equal(validateRenderRequest({ prompt: 'car crash yas mall', lat: 1 }).error, 'invalid_coordinates');
  assert.equal(validateRenderRequest({ prompt: 'car crash yas mall', time_of_day: 'noon' }).error, 'invalid_time_of_day');
  assert.equal(validateRenderRequest({ prompt: 'car crash yas mall', duration_s: 1 }).error, 'invalid_duration');
  assert.deepEqual(
    validateRenderRequest({ prompt: ' car crash yas mall ', lat: 24.4885, lng: 54.6088, time_of_day: 'dusk' }).value,
    { prompt: 'car crash yas mall', lat: 24.4885, lng: 54.6088, time_of_day: 'dusk', duration_s: 60 },
  );
});

test('rewriteJobUrls maps service URLs onto same-origin proxy paths and stamps the illustrative label', () => {
  const out = rewriteJobUrls({ job_id: 'abc123', stage: 'render', mp4_url: 'https://gpu.example/video/abc123.mp4' }, 'abc123');
  assert.equal(out.mp4_url, '/api/scenes/render/abc123/video.mp4');
  assert.equal(out.stream_url, '/api/scenes/render/abc123/stream');
  assert.equal(out.latest_frame_url, '/api/scenes/render/abc123/latest.jpg');
  assert.equal(out.illustrative, true);
  assert.equal(out.label, RENDER_LABEL);
});

test('unconfigured service: health answers configured:false and render/status answer 503 not_configured', async () => {
  assert.equal(renderServiceConfig({}).configured, false);
  const h = createSceneRenderRoutes({ env: {}, fetchImpl: async () => { throw new Error('must not be called'); } });
  let res = fakeRes();
  await h(req('GET', '/render/health'), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: false, configured: false, illustrative: true, label: RENDER_LABEL });
  res = fakeRes();
  await h(req('POST', '/render', { prompt: 'car crash yas mall' }), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'not_configured');
  res = fakeRes();
  await h(req('GET', '/render/abcdef01/status'), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 503);
});

test('configured service: POST /render forwards the bearer token server-side and returns proxied URLs; status is rewritten', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/render'))
      return { ok: true, status: 200, json: async () => ({ job_id: 'deadbeef1234', stream_url: 'https://gpu/stream/deadbeef1234' }) };
    if (url.endsWith('/status/deadbeef1234'))
      return { ok: true, status: 200, json: async () => ({ job_id: 'deadbeef1234', stage: 'render', progress: 0.5, mp4_url: 'https://gpu/video/x.mp4' }) };
    throw new Error('unexpected ' + url);
  };
  const h = createSceneRenderRoutes({ env: { RENDER_SERVICE_URL: 'https://gpu.example/', RENDER_SERVICE_TOKEN: 'secret-token' }, fetchImpl });
  let res = fakeRes();
  await h(req('POST', '/render', { prompt: 'dubai marina raid', time_of_day: 'night', duration_s: 60 }), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.equal(body.job_id, 'deadbeef1234');
  assert.equal(body.stream_url, '/api/scenes/render/deadbeef1234/stream');
  assert.equal(body.label, RENDER_LABEL);
  assert.equal(calls[0].url, 'https://gpu.example/render');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.ok(!res.body.includes('secret-token'), 'token never reaches the client');
  res = fakeRes();
  await h(req('GET', '/render/deadbeef1234/status'), res, () => assert.fail('next'));
  const st = JSON.parse(res.body);
  assert.equal(st.stage, 'render');
  assert.equal(st.mp4_url, '/api/scenes/render/deadbeef1234/video.mp4');
  assert.equal(st.illustrative, true);
});

test('cross-origin POST /render is rejected and unknown sub-paths fall through to next()', async () => {
  const h = createSceneRenderRoutes({ env: { RENDER_SERVICE_URL: 'https://gpu.example' }, fetchImpl: async () => assert.fail('no upstream') });
  let res = fakeRes();
  await h(req('POST', '/render', { prompt: 'x y z' }, { origin: 'https://evil.example' }), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 403);
  let nexted = false;
  await h(req('GET', '/render/not-a-job/status'), fakeRes(), () => (nexted = true));
  assert.equal(nexted, true);
  nexted = false;
  await h(req('GET', '/abc/footage/snapchat'), fakeRes(), () => (nexted = true));
  assert.equal(nexted, true);
});

test('POST /render resolves coordinates server-side so a geocoder miss never blocks the Blender job', async () => {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    sent.push({ url, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ job_id: 'abc123def456' }) };
  };
  const geocode = async () => ({ name: 'Abu Dhabi', lat: 24.4539, lng: 54.3773, source: 'prompt-only-fallback', approximate: true });
  const h = createSceneRenderRoutes({ env: { RENDER_SERVICE_URL: 'https://gpu.example' }, fetchImpl, geocode });
  const res = fakeRes();
  await h(req('POST', '/render', { prompt: 'kanes boxing gym abu dhabi', duration_s: 4 }), res, () => assert.fail('next'));
  assert.equal(res.statusCode, 202);
  assert.equal(sent.length, 1, 'exactly one upstream render request');
  assert.equal(sent[0].body.lat, 24.4539);
  assert.equal(sent[0].body.lng, 54.3773);
  assert.equal(JSON.parse(res.body).location.source, 'prompt-only-fallback');
});
