import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScenePlan,
  SCENE_PLAN_VERSION,
  validatePublicUrl,
} from './structuredPlan.js';

// Pure synthetic fixture, not provider output or a live-success claim.
export const fixturePlan = () => ({
  version: 1,
  title: 'Illustrative test fixture',
  illustrative: true,
  durationSec: 12,
  location: {
    name: 'Fixture location',
    lat: 25.2,
    lon: 55.3,
    sourceUrl: 'https://www.openstreetmap.org/node/123',
  },
  camera: { distanceM: 400, heading: 50, pitch: -30, framing: 'wide' },
  entities: [
    {
      id: 'runners',
      type: 'runner',
      label: 'Illustrative runners',
      quantity: 8,
      position: { eastM: 10, northM: 20 },
      heading: 90,
    },
  ],
  relationships: [],
  beats: [
    {
      atSec: 0,
      title: 'Opening',
      narration: 'An illustrative group gathers at the verified location.',
      entityIds: ['runners'],
    },
    {
      atSec: 6,
      title: 'Departure',
      narration: 'The group moves through the scene.',
      entityIds: ['runners'],
    },
  ],
  citations: [{ url: 'https://www.openstreetmap.org/node/123' }],
  verification: {
    status: 'location_verified',
    locationSource: 'Fixture geocoder',
    checkedAt: '2026-01-01T00:00:00Z',
    limitations: ['Illustrative staging, not evidence of actual people.'],
  },
});
test('version one plan validates without mutating the input', () => {
  const p = fixturePlan();
  const v = validateScenePlan(p);
  assert.equal(SCENE_PLAN_VERSION, 1);
  assert.deepEqual(v, p);
  assert.notEqual(v, p);
});
for (const [name, edit] of [
  ['unsupported version', (p) => (p.version = 2)],
  ['factual staging claim', (p) => (p.illustrative = false)],
  ['unknown type', (p) => (p.entities[0].type = 'tank')],
  ['nonfinite coordinate', (p) => (p.location.lat = NaN)],
  ['numeric string', (p) => (p.location.lat = '25')],
  ['too short', (p) => (p.durationSec = 4)],
  ['unknown property', (p) => (p.secret = 'x')],
  ['duplicate IDs', (p) => p.entities.push({ ...p.entities[0] })],
  ['quantity cap', (p) => (p.entities[0].quantity = 101)],
  [
    'total quantity',
    (p) =>
      (p.entities = Array.from({ length: 4 }, (_, i) => ({
        ...p.entities[0],
        id: 'r' + i,
        quantity: 100,
      }))),
  ],
  [
    'radial bounds',
    (p) => (p.entities[0].position = { eastM: 4000, northM: 4000 }),
  ],
  ['dangling beat', (p) => (p.beats[0].entityIds = ['absent'])],
  [
    'dangling relation',
    (p) =>
      (p.relationships = [{ from: 'runners', to: 'absent', relation: 'near' }]),
  ],
  ['unordered beat', (p) => (p.beats[1].atSec = 0)],
  ['out of duration', (p) => (p.beats[1].atSec = 12)],
  ['camera bounds', (p) => (p.camera.pitch = 0)],
  ['private source', (p) => (p.location.sourceUrl = 'http://127.0.0.1/')],
  [
    'false event verification',
    (p) => (p.verification.status = 'event_verified'),
  ],
])
  test(`rejects ${name}`, () => {
    const p = fixturePlan();
    edit(p);
    assert.throws(() => validateScenePlan(p), { code: 'invalid_scene_plan' });
  });
test('allows optional full camera on a beat', () => {
  const p = fixturePlan();
  p.beats[1].camera = { ...p.camera, distanceM: 150 };
  assert.deepEqual(validateScenePlan(p), p);
});
test('public URL rejects auth and local endpoints', () => {
  for (const url of [
    'file:///etc/passwd',
    'https://user:pass@example.org',
    'http://metadata.google.internal',
    'https://example.org?api_key=secret',
    'http://2130706433',
  ])
    assert.throws(() => validatePublicUrl(url));
});
