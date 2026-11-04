import test from 'node:test';
import assert from 'node:assert/strict';
import {
  progressText,
  progressFraction,
  buildFailure,
  outlinerRows,
  propertyEntries,
  timelineState,
  jobGpus,
  isCurrentRun,
  REFERENCE_ASSETS,
  deviceFromEvents,
} from './model.js';

const renderingJob = {
  job_id: 'abc123def456',
  stage: 'render',
  frames_done: 22,
  total_frames: 96,
  time_of_day: 'midday',
  focal: { name: 'Yas Mall', lat: 24.4886, lon: 54.6085, source: 'caller-coordinates' },
  land_patch: { buildings: 45, roads: 217 },
  shards: [
    { frames: [49, 96], gpu: '6' },
    { frames: [1, 48], gpu: '2' },
  ],
  placement: {
    instances: 7,
    by_asset: { civilian_sedan: 1, civilian_hatchback: 1, debris_bumper: 2, police_patrol_car: 3 },
  },
  spec: { scenarioType: 'route_closure' },
  model: { attempts: [{ endpointId: 'predefined-kimi-k3-fast' }] },
  seed: 1139210381,
  ttff_s: 32.19,
  events_tail: [
    { stage: 'blender', data: { line: "SCENE_READY seed=1 cuda_visible=6 order=PCI_BUS_ID devices=['NVIDIA H100 80GB HBM3'] buildings=45" } },
  ],
};

test('progress text names the frame counter and the GPUs while rendering', () => {
  assert.equal(progressText(null, 'car crash yas mall'), 'Building “car crash yas mall” — locating, planning scene, starting Blender…');
  assert.equal(progressText(renderingJob), 'Building — rendering frame 22/96 on GPUs 6, 2');
  assert.equal(progressText({ stage: 'scene_spec' }), 'Building — planning scene…');
  assert.equal(progressText({ stage: 'render', frames_done: 0, total_frames: 96, shards: [{ gpu: '2' }] }), 'Building — rendering frame 0/96 on GPU 2');
});

test('progress fraction is monotonic through the stages and tracks frames', () => {
  const seq = [null, { stage: 'queued' }, { stage: 'geocode' }, { stage: 'scene_spec' }, { stage: 'placement' },
    { stage: 'render', frames_done: 0, total_frames: 96 }, { stage: 'render', frames_done: 48, total_frames: 96 }, { stage: 'complete' }];
  const vals = seq.map(progressFraction);
  for (let i = 1; i < vals.length; i += 1) assert.ok(vals[i] >= vals[i - 1], `${i}: ${vals[i]} >= ${vals[i - 1]}`);
  assert.equal(vals.at(-1), 1);
  assert.ok(Math.abs(progressFraction({ stage: 'render', frames_done: 48, total_frames: 96 }) - 0.6) < 1e-9);
});

test('buildFailure surfaces HTTP status, error code and service message (never a silent Ready)', () => {
  const f = buildFailure({ kind: 'request', status: 409, prompt: 'car crash yas mall', body: {
    error: 'gpu_policy_violation', message: 'Render host advertises GPU(s) 1; Blender may only use GPUs 2, 6.', advertised_gpus: ['2', '6', '1'] } });
  assert.equal(f.title, 'Scene build failed');
  assert.equal(f.status, 409);
  assert.equal(f.code, 'gpu_policy_violation');
  assert.match(f.text, /HTTP 409 gpu_policy_violation/);
  assert.match(f.text, /Advertised GPUs: 2, 6, 1/);
  assert.match(f.text, /car crash yas mall/);
  const g = buildFailure({ kind: 'request', status: 503, body: { error: 'not_configured', message: 'Hyper-real render service is not connected (RENDER_SERVICE_URL unset on the server).' } });
  assert.match(g.text, /HTTP 503 not_configured — Hyper-real render service is not connected/);
  const j = buildFailure({ kind: 'job', status: 200, body: { error: 'Blender exited 3' } });
  assert.equal(j.title, 'Blender job failed');
  assert.match(j.text, /Blender exited 3/);
  const n = buildFailure({ kind: 'network', error: new TypeError('Failed to fetch') });
  assert.equal(n.title, 'Render service unreachable');
  assert.match(n.text, /no response — Failed to fetch/);
  const e = buildFailure({ kind: 'request', status: 502, body: {} });
  assert.match(e.text, /HTTP 502 — no message from service/);
});

test('outliner rows: environment, placed assets with labels, and the four reference bindings', () => {
  assert.deepEqual(outlinerRows(null), []);
  const rows = outlinerRows({ ...renderingJob, references: [
    { id: 'silver_sedan', file: 'D3IfJIiClM.png', applied_count: 1 },
    { id: 'blue_hatchback', file: 'Rv6TULP5dW.png', applied_count: 1 },
    { id: 'debris_cluster', file: 'ewvknQr9AP.png', applied_count: 3 },
    { id: 'mall_facade_module', file: 'HrOVNUqLwL.png', applied_count: 4 },
  ] });
  const labels = rows.map((r) => r.label || `#${r.group}`);
  assert.ok(labels.includes('Ground · satellite patch + roads'));
  assert.ok(labels.includes('OSM roads'));
  assert.ok(labels.includes('OSM buildings (extruded)'));
  assert.ok(labels.includes('Yas Mall facade modules (reference)'));
  assert.ok(labels.includes('Sun + sky (midday)'));
  assert.ok(labels.includes('Camera (crane orbit)'));
  assert.ok(labels.includes('Silver sedan (crash vehicle)'));
  assert.ok(labels.includes('Blue hatchback (crash vehicle)'));
  assert.ok(labels.includes('Debris · bumper'));
  assert.ok(labels.includes('Police patrol car'));
  const refRows = rows.filter((r) => r.reference);
  assert.equal(refRows.filter((r) => String(r.object).startsWith('ref_')).length, REFERENCE_ASSETS.length);
  assert.ok(refRows.every((r) => r.state === 'applied' || r.object === 'mall_facade_module'));
  const sedan = rows.find((r) => r.object === 'ref_silver_sedan');
  assert.equal(sedan.count, 1);
  assert.equal(sedan.reference, 'D3IfJIiClM.png');
  // A service that predates the binding step: rows still listed, state honest.
  const legacy = outlinerRows(renderingJob).filter((r) => String(r.object).startsWith('ref_'));
  assert.equal(legacy.length, 4);
  assert.ok(legacy.every((r) => r.state === 'not applied on render host'));
});

test('property entries carry frames, GPUs, device and time-to-first-frame', () => {
  const map = Object.fromEntries(propertyEntries(renderingJob, { place: 'x' }, { clientTtffS: 36.5 }));
  assert.equal(map.Frames, '22 / 96');
  assert.equal(map.GPUs, '6, 2');
  assert.equal(map.Device, 'NVIDIA H100 80GB HBM3');
  assert.equal(map['First frame'], '32.19 s (service)');
  assert.equal(map['Client first frame'], '36.5 s');
  assert.equal(map.Place, 'Yas Mall (24.4886, 54.6085)');
  assert.equal(map['Scene spec'], 'predefined-kimi-k3-fast');
  assert.match(map['Reference assets'], /not applied on render host/);
  const applied = Object.fromEntries(propertyEntries({ ...renderingJob, references: [{ id: 'silver_sedan', applied_count: 1 }, { id: 'debris_cluster', applied_count: 0 }] }));
  assert.equal(applied['Reference assets'], '1 / 4 applied');
  assert.equal(Object.fromEntries(propertyEntries(null)).GPUs, 'allowed 2, 6');
  assert.equal(deviceFromEvents(null), null);
});

test('timeline state drives the scrub range and readout from frames_done', () => {
  assert.deepEqual(timelineState(null), { total: 0, done: 0, current: 0, max: 1, disabled: true, readout: '0 / 0' });
  assert.deepEqual(timelineState(renderingJob), { total: 96, done: 22, current: 22, max: 22, disabled: false, readout: '22 / 96' });
  assert.equal(timelineState(renderingJob, 7).readout, '7 / 96');
  assert.equal(timelineState(renderingJob, 500).current, 22);
});

test('jobGpus deduplicates shards and isCurrentRun drops stale writes', () => {
  assert.deepEqual(jobGpus(renderingJob), ['6', '2']);
  assert.deepEqual(jobGpus({ shards: [{ gpu: '2' }, { gpu: '2' }] }), ['2']);
  assert.deepEqual(jobGpus(null), []);
  assert.equal(isCurrentRun(3, 3), true);
  assert.equal(isCurrentRun(2, 3), false);
  assert.equal(isCurrentRun(undefined, 3), false);
});
