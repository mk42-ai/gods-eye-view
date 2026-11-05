import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Authority,
  STORAGE_KEY,
  AUTO_STORAGE_KEY,
  LEGACY_HASH_KEYS,
  readHash,
  writeHash,
  createState,
  savedState,
  validateDraft,
  validateAoi,
  validCamera,
  hasPlaceholder,
  cameraFromHash,
  cameraToHash,
  decodeAndCommit,
  safeLink,
  localMedia,
  parseSse,
} from './state.js';
const aoi = {
  lat: 24.4,
  lon: 54.6,
  radiusM: 250,
  source: 'user-selected',
  verification: 'unverified',
};
const camera = { position: [25, 40, 100], target: [0, 0, 0], fovDeg: 45 };
const draft = () =>
  createState({ prompt: 'Inspect selected site', durationSec: 4, aoi });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test('one synchronous submit owner exists before any network await', () => {
  const s = draft(),
    auth = new Authority(s);
  const first = auth.begin();
  assert.ok(first);
  assert.equal(auth.begin(), null);
  assert.equal(s.active, first);
  auth.end(first);
  assert.ok(auth.begin());
});
test('editing invalidates active requests and marks an existing frame immediately stale', () => {
  const s = draft(),
    auth = new Authority(s);
  s.displayed = { jobId: 'old' };
  const owner = auth.begin();
  const research = auth.controller();
  const cameraFetch = auth.controller();
  auth.edit({ prompt: 'Updated draft' });
  assert.equal(s.phase, 'stale');
  assert.equal(s.stale, true);
  assert.equal(s.prompt, 'Updated draft');
  assert.equal(auth.current(owner), false);
  assert.equal(owner.controller.signal.aborted, true);
  assert.equal(research.signal.aborted, true);
  assert.equal(cameraFetch.signal.aborted, true);
  assert.equal(s.active, null);
  assert.equal(s.displayed.jobId, 'old');
});
test('request invalidation clears cancelled source spinners, not just controllers', () => {
  const s = draft(),
    auth = new Authority(s);
  s.evidence.phase = 'loading';
  s.cctv.phase = 'loading';
  s.locationStatus = 'Finding site candidates…';
  auth.cancel('new-build');
  assert.equal(s.evidence.phase, 'cancelled');
  assert.equal(s.cctv.phase, 'cancelled');
  assert.match(s.locationStatus, /invalidated/);
});
test('late frame decode after typing cannot commit or replace the displayed frame', async () => {
  const s = draft(),
    auth = new Authority(s),
    owner = auth.begin(),
    gate = deferred();
  let visible = 'existing';
  const pending = decodeAndCommit({
    authority: auth,
    owner,
    url: '/old.jpg',
    decode: () => gate.promise,
    commit: (image) => {
      visible = image;
    },
  });
  auth.edit({ prompt: 'changed' });
  gate.resolve('late');
  assert.equal(await pending, false);
  assert.equal(visible, 'existing');
});
test('out-of-order scrub frame decodes only commit the newest requested frame', async () => {
  const auth = new Authority(draft()),
    owner = auth.begin(),
    a = deferred(),
    b = deferred();
  const commits = [];
  const old = decodeAndCommit({
    authority: auth,
    owner,
    url: '/1.jpg',
    decode: () => a.promise,
    commit: (v) => commits.push(v),
  });
  const recent = decodeAndCommit({
    authority: auth,
    owner,
    url: '/2.jpg',
    decode: () => b.promise,
    commit: (v) => commits.push(v),
  });
  b.resolve('2');
  assert.equal(await recent, true);
  a.resolve('1');
  assert.equal(await old, false);
  assert.deepEqual(commits, ['2']);
});
test('decode errors leave the previously visible frame intact', async () => {
  const auth = new Authority(draft()),
    owner = auth.begin();
  let visible = 'existing';
  await assert.rejects(
    decodeAndCommit({
      authority: auth,
      owner,
      url: '/broken.jpg',
      decode: async () => {
        throw new Error('404');
      },
      commit: (v) => {
        visible = v;
      },
    }),
    /404/,
  );
  assert.equal(visible, 'existing');
});
test('finished render owner remains valid for timeline but is invalidated by a new Build', () => {
  const auth = new Authority(draft()),
    owner = auth.begin();
  auth.end(owner);
  assert.equal(auth.current(owner), true);
  const next = auth.begin();
  assert.equal(auth.current(owner), false);
  assert.equal(auth.current(next), true);
});
test('all 27 actual legacy keys and values round-trip through local save and reload unchanged', () => {
  const source = readFileSync(
    new URL('../../scripts/qa-scene-videos.mjs', import.meta.url),
    'utf8',
  );
  const hash = source.match(
    /export const APPROVED_HASH =\s*['"`]([^'"`]+)['"`]/,
  )[1];
  const values = readHash(hash);
  assert.equal(Object.keys(values).length, 27);
  assert.deepEqual(Object.keys(values).sort(), [...LEGACY_HASH_KEYS].sort());
  const first = createState({ camera }, hash),
    saved = JSON.parse(JSON.stringify(savedState(first))),
    reload = createState(saved, hash);
  assert.deepEqual(reload.legacyHash, values);
  assert.deepEqual(readHash(writeHash(reload.legacyHash)), values);
  assert.deepEqual(reload.camera, camera);
  assert.equal(reload.legacyHash.roll, '360');
});
test('unknown/optional legacy keys are preserved, not destructively migrated', () => {
  const hash =
    '#lat=24.1234567&lon=54&roll=360&sce=99&sp=g.80&at=123&extension=value';
  assert.deepEqual(readHash(writeHash(readHash(hash))), readHash(hash));
});
test('camera state is actual persisted pose, never a random fallback', () => {
  assert.equal(createState().camera, null);
  assert.equal(cameraFromHash({}, aoi), null);
  assert.equal(
    cameraFromHash(
      { lat: '24', lon: '54', alt: 'oops', heading: '0', pitch: '-20' },
      aoi,
    ),
    null,
  );
  const legacy = {
    lat: '24.4',
    lon: '54.6',
    alt: '100',
    heading: '0',
    pitch: '-45',
    roll: '360',
    style: 'normal',
  };
  const pose = cameraFromHash(legacy, aoi);
  assert.ok(validCamera(pose));
  assert.ok(Math.abs(pose.target[2]) < 1e-10);
  const roundtrip = cameraToHash(pose, aoi, legacy);
  assert.equal(roundtrip.roll, '360');
  assert.equal(roundtrip.style, 'normal');
  assert.ok(Math.abs(Number(roundtrip.pitch) + 45) < 0.00001);
});
test('unresolved names delegate to server verification; explicit coordinates require confirmation', () => {
  assert.equal(validateDraft(createState({ prompt: 'Scene in Dubai' })), null); // Server must verify or return selection-required; no client coordinates.
  assert.equal(validateDraft(draft()), null);
  assert.match(validateAoi({ ...aoi, lat: '' }), /exact AOI/);
  assert.match(validateAoi({ ...aoi, lon: 181 }), /exact AOI/);
  assert.match(validateAoi({ ...aoi, radiusM: 0 }), /radius/);
  assert.match(validateAoi({ ...aoi, source: 'city-centroid' }), /Confirm/);
  assert.match(validateDraft({ ...draft(), durationSec: NaN }), /duration/);
});
test('unresolved placeholders block Build, including multiline and generic angle slots', () => {
  for (const prompt of [
    'Scene at {{location}}',
    'Scene at [your location]',
    'Scene at <location>',
    'Scene at <FOCAL_SITE>',
    'Create ${place}',
    'Scene\nTODO specify site',
  ]) {
    assert.equal(hasPlaceholder(prompt), true, prompt);
    assert.match(validateDraft({ ...draft(), prompt }), /placeholder/);
  }
  assert.equal(
    hasPlaceholder('Show 3 vehicles near the selected entrance'),
    false,
  );
});
test('rejects malformed camera positions, coincident targets and invalid lens values', () => {
  assert.equal(validCamera(camera), true);
  assert.equal(validCamera({ ...camera, position: ['1', 2, 3] }), false);
  assert.equal(validCamera({ ...camera, target: camera.position }), false);
  assert.equal(validCamera({ ...camera, fovDeg: 180 }), false);
});
test('source links allow only web URLs and GPU media only same-origin API URLs', () => {
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,hi'), null);
  assert.equal(safeLink('https://a:b@example.com'), null);
  assert.equal(safeLink('https://osm.org/way/1'), 'https://osm.org/way/1');
  assert.equal(localMedia('https://other.example/frames/1.jpg'), null);
  assert.equal(
    localMedia('/api/scenes/render/abc/frames/1.jpg'),
    '/api/scenes/render/abc/frames/1.jpg',
  );
  assert.equal(localMedia('/outside.jpg'), null);
});
test('SSE parser retains split events and accepts CRLF without fabricating a done record', () => {
  const first = parseSse(
    'event: item\r\ndata: {"id":"1"}\r\n\r\nevent: done\ndata: {"items":',
  );
  assert.deepEqual(first.events, [{ event: 'item', data: { id: '1' } }]);
  const second = parseSse(first.rest + '[]}\n\n');
  assert.equal(second.events[0].event, 'done');
  assert.deepEqual(parseSse('event: done\ndata: invalid\n\n').events, []);
});

test('explicit local save and session persistence are separate; full draft metadata round-trips', () => {
  assert.notEqual(STORAGE_KEY, AUTO_STORAGE_KEY);
  const original = {
    ...draft(),
    locationQuery: 'Exact landmark',
    evidenceWindowHours: 24,
    camera,
  };
  const restored = createState(
    JSON.parse(JSON.stringify(savedState(original))),
  );
  assert.equal(restored.locationQuery, original.locationQuery);
  assert.equal(restored.evidenceWindowHours, 24);
  assert.deepEqual(restored.aoi, aoi);
  assert.deepEqual(restored.camera, camera);
  assert.equal(restored.job, null);
  assert.equal(restored.displayed, null);
});

test('merged UI persistence: layers, render settings, chat and saved-scene library survive malformed data', async () => {
  const m = await import('./state.js');
  assert.deepEqual(Object.values(m.sanitizeLayers({ imagery: false, bogus: 1, roads: 'x' })).filter((v) => v === false).length, 1);
  const s = m.createState({ timeOfDay: 'dusk', cameraMode: 'low_oblique', chat: [{ role: 'user', text: 'hi' }, { role: 'evil', text: 1 }], evidenceWindowHours: 72 });
  assert.equal(s.timeOfDay, 'dusk');
  assert.equal(s.cameraMode, 'low_oblique');
  assert.equal(s.chat.length, 1);
  assert.equal(s.evidenceWindowHours, 72);
  assert.equal(m.createState({ timeOfDay: 'noon', cameraMode: 'drone' }).cameraMode, 'street');
  assert.deepEqual(m.readLibrary('not json'), []);
  assert.deepEqual(m.readLibrary('[{"id":1}]'), []);
  const lib = m.addToLibrary([], 'Yas crash', { version: 1, prompt: 'p' }, new Date(0));
  assert.equal(m.readLibrary(JSON.stringify(lib)).length, 1);
  assert.deepEqual(m.rememberPrompt(['a b c'], 'a b c'), ['a b c']);
});
