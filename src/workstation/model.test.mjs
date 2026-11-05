import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeJob,
  progressText,
  progressFraction,
  buildFailure,
  outlinerRows,
  propertyEntries,
  planGeometry,
  frameSource,
  canSeek,
  latestFrameNumber,
  jobGpus,
  patchSelectionIssue,
} from './model.js';
const job = {
  job_id: 'abc123',
  sceneId: 'scene-1',
  stage: 'render',
  frames_done: 2,
  total_frames: 8,
  frames_url_template: '/api/scenes/render/abc123/frames/{n}.jpg',
  shards: [{ gpu: '2' }, { gpu: '6' }],
  patch: {
    id: 'patch-1',
    bounds: [54, 24, 54.01, 24.01],
    origin: { lat: 24.005, lon: 54.005 },
    crs: 'EPSG:4326',
    verification: 'unverified',
    features: [
      {
        id: 'way/42',
        type: 'Feature',
        properties: { name: 'Service road' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [54, 24],
            [54.01, 24.01],
          ],
        },
      },
    ],
  },
  camera: { position: [10, 20, 30], target: [0, 0, 0], fovDeg: 45 },
  placement: { instances: 1, by_asset: { civilian_sedan: 1 } },
};
test('normalizes camel and snake service metadata without creating a scene', () => {
  const out = normalizeJob({
    jobId: 'new',
    sceneId: 's',
    frames: { done: 3, total: 8, urlTemplate: '/api/{n}.jpg' },
    status: 'render',
  });
  assert.equal(out.job_id, 'new');
  assert.equal(out.sceneId, 's');
  assert.equal(out.frames_done, 3);
  assert.equal(out.frames_url_template, '/api/{n}.jpg');
  assert.equal(out.patch, null);
  assert.equal(out.camera, null);
});
test('progress labels rendering and encoding distinctly', () => {
  assert.equal(
    progressText(job),
    'Building — rendering frame 2/8 on GPUs 2, 6',
  );
  assert.match(
    progressText({ ...job, stage: 'encode' }),
    /Encoding video.*encoding is not rendering/,
  );
  assert.equal(progressFraction({ stage: 'complete' }), 1);
  assert.equal(
    progressFraction({ ...job, frames_done: 4 }),
    0.6000000000000001,
  );
});
test('failure surfaces nested selection errors, HTTP status, and server messages', () => {
  const failure = buildFailure({
    status: 422,
    kind: 'request',
    body: {
      detail: { error: 'selection_required', message: 'Exact site unresolved' },
    },
  });
  assert.equal(failure.code, 'selection_required');
  assert.match(failure.text, /422.*selection_required.*Exact site unresolved/);
  assert.match(
    buildFailure({ kind: 'network', error: new Error('offline') }).text,
    /offline/,
  );
});
test('outliner lists only returned geometry, assets, cameras and bindings', () => {
  assert.deepEqual(outlinerRows(null), []);
  assert.deepEqual(outlinerRows({}), []);
  const rows = outlinerRows(job);
  assert.ok(rows.find((r) => r.object === 'feature:way/42'));
  assert.ok(rows.find((r) => r.object === 'camera'));
  assert.ok(rows.find((r) => r.group?.includes('not evidence')));
  assert.equal(rows.filter((r) => r.reference).length, 0);
  assert.ok(
    !rows.some((r) => /sun_sky|facade|ref_silver/.test(r.object || '')),
  );
});
test('feature IDs remain selectable when the service omits geometry', () => {
  const rows = outlinerRows({
    patch: { id: 'p', featureIds: ['way/42', 'node/2'] },
  });
  assert.equal(
    rows.find((r) => r.object === 'feature:way/42').data.geometry,
    'Not returned by service',
  );
});
test('selected Outliner object drives Properties, not a disconnected static panel', () => {
  const props = Object.fromEntries(
    propertyEntries(job, { selection: 'feature:way/42', revision: 7 }),
  );
  assert.equal(props.Selected, 'Service road');
  assert.equal(props.id, 'way/42');
  assert.equal(props.Revision, 7);
  assert.match(props.geometry, /LineString/);
  const staged = Object.fromEntries(
    propertyEntries(job, { selection: 'civilian_sedan' }),
  );
  assert.equal(staged.verification, 'illustrative — not observed');
});
test('missing telemetry is not reported as a device, GPU, or rendered FPS', () => {
  const props = Object.fromEntries(
    propertyEntries({ ...job, shards: [], fps: 24 }),
  );
  assert.equal(props.GPUs, 'Not reported');
  assert.equal(props.Device, 'Not reported');
  assert.equal(props['Rendered FPS'], 'Not reported');
  assert.equal(props['Video playback FPS'], 24);
  assert.deepEqual(jobGpus({ shards: [{ gpu: '2' }, { gpu: '2' }] }), ['2']);
});
test('plan projects actual service GeoJSON into the returned bounds', () => {
  const plan = planGeometry(job);
  assert.equal(plan.geographic, true);
  assert.equal(plan.shapes[0].id, 'feature:way/42');
  assert.deepEqual(plan.shapes[0].points, [
    [16, 174],
    [284, 16],
  ]);
  assert.equal(planGeometry({}), null);
  assert.equal(planGeometry({ patch: { bounds: [1, 2, 1, 4] } }), null);
});
test('plan refuses out-of-bounds and unlabelled local coordinates instead of inventing roads', () => {
  const wrong = structuredClone(job);
  wrong.patch.features[0].geometry.coordinates = [
    [0, 0],
    [1, 1],
  ];
  assert.deepEqual(planGeometry(wrong).shapes, []);
  const local = {
    patch: {
      localBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      features: [{ geometry: { type: 'Point', coordinates: [50, 50] } }],
    },
  };
  assert.deepEqual(planGeometry(local).shapes, []);
  local.patch.features[0].coordinateSpace = 'local';
  assert.equal(planGeometry(local).shapes.length, 1);
});
test('frame templates use compressed service URLs; frame count is not a frame index', () => {
  assert.equal(frameSource(job, 2), '/api/scenes/render/abc123/frames/2.jpg');
  assert.equal(canSeek(job), true);
  assert.equal(canSeek({ job_id: 'abc123', frames_done: 4 }), false);
  assert.equal(latestFrameNumber(job), null); // parallel shards may have returned frames 7 and 8 first
  assert.equal(latestFrameNumber({ ...job, latest_frame_number: 8 }), 8);
  assert.equal(
    latestFrameNumber({
      frames: {
        items: [
          { number: 7, url: '/api/7.jpg' },
          { number: 1, url: '/api/1.jpg' },
        ],
      },
    }),
    7,
  );
});

test('current GPU manifests expose pose, preview frame zero and timeline rate without losing metadata', () => {
  const frame = {
    id: 'frame-real',
    index: 0,
    quality: 'preview',
    pose: job.camera,
    url: '/api/scenes/render/abc123/frames/0.jpg',
  };
  const out = normalizeJob({
    jobId: 'abc123',
    pose: job.camera,
    frames: [frame],
    latestFrame: frame,
    timeline_fps: 2,
    frames_done: 0,
  });
  assert.deepEqual(out.camera, job.camera);
  assert.equal(out.frameMetadata[0].id, 'frame-real');
  assert.equal(latestFrameNumber(out), 0);
  assert.equal(canSeek(out), true);
  assert.equal(frameSource(out, 0), frame.url);
  assert.equal(
    Object.fromEntries(propertyEntries(out))['Video playback FPS'],
    2,
  );
});
test('refuses missing geography and a patch outside the explicitly selected AOI', () => {
  assert.match(
    patchSelectionIssue({}, { lat: 24, lon: 54 }),
    /No geographic patch/,
  );
  assert.equal(patchSelectionIssue(job, { lat: 24.005, lon: 54.005 }), null);
  assert.match(
    patchSelectionIssue(job, { lat: 25, lon: 55 }),
    /substituted location/,
  );
});
