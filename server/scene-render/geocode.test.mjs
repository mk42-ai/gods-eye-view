import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePromptLocation,
  cleanPlaceQuery,
  queryLadder,
  VERIFIED_SITES,
  locationFromOsm,
  polygonCentre,
} from './geocode.js';

// Synthetic square for the resolver contract only; not live geographic proof.
function mappedSite(site = VERIFIED_SITES[0]) {
  return {
    elements: [
      { type: 'node', id: 1, lat: 24.48, lon: 54.6 },
      { type: 'node', id: 2, lat: 24.48, lon: 54.61 },
      { type: 'node', id: 3, lat: 24.49, lon: 54.61 },
      { type: 'node', id: 4, lat: 24.49, lon: 54.6 },
      {
        type: 'way',
        id: site.osmId,
        version: 7,
        timestamp: '2026-01-01T00:00:00Z',
        nodes: [1, 2, 3, 4, 1],
        tags: { building: 'yes', 'name:en': site.expectedNames[0] },
      },
    ],
  };
}
const response = (data) => ({ ok: true, status: 200, json: async () => data });

test('Yas Mall resolves through a source feature, not a remembered coordinate', async () => {
  const calls = [];
  const r = await resolvePromptLocation('Car crash outside Yas Mall', {
    fetchImpl: async (url) => {
      calls.push(url);
      return response(mappedSite());
    },
  });
  assert.deepEqual(calls, [
    'https://api.openstreetmap.org/api/0.6/way/312812656/full.json',
  ]);
  assert.equal(r.verification, 'verified');
  assert.equal(r.sourceFeatureId, 'way/312812656');
  assert.equal(r.featureVersion, 7);
  assert.ok(Math.abs(r.lat - 24.485) < 1e-7);
  assert.ok(Math.abs(r.lng - 54.605) < 1e-7);
  assert.equal(r.provenance[0].license, 'ODbL-1.0');
});

test('Kane gym is tied to its official venue address and mapped footprint, never Abu Dhabi city', async () => {
  const r = await resolvePromptLocation("Kane's Boxing Gym, Abu Dhabi", {
    fetchImpl: async () => response(mappedSite(VERIFIED_SITES[1])),
  });
  assert.equal(r.sourceFeatureId, 'way/27374404');
  assert.equal(r.precision, 'official-address-mapped-building');
  assert.match(r.provenance[1].url, /kanesboxingacademy\.com\/contact-us$/);
  assert.match(r.limitation, /not the gym unit/);
  assert.notEqual(r.lat, 24.4539);
});

test('source is revalidated: wrong name, missing nodes and nonclosed geometry fail closed', () => {
  const d = mappedSite();
  d.elements.at(-1).tags['name:en'] = 'Unrelated shopping centre';
  assert.equal(locationFromOsm(d, VERIFIED_SITES[0]), null);
  const a = mappedSite();
  a.elements.shift();
  assert.equal(locationFromOsm(a, VERIFIED_SITES[0]), null);
  const b = mappedSite();
  b.elements.at(-1).nodes = [1, 2, 3, 4];
  assert.equal(locationFromOsm(b, VERIFIED_SITES[0]), null);
});

test('map lookup failure does not return known/city/prompt-only coordinates', async () => {
  for (const prompt of [
    'Car crash outside Yas Mall',
    "Kane's Boxing Gym Abu Dhabi",
    'warehouse fire in abu dhabi industrial',
    'mystery warehouse fire',
  ]) {
    const r = await resolvePromptLocation(prompt, {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(r, null);
  }
});

test('a generic city result and an unrelated first hit cannot verify a site', async () => {
  const cases = [
    [
      {
        name: 'Abu Dhabi',
        type: 'city',
        osm_type: 'relation',
        osm_id: 1,
        lat: '24.4',
        lon: '54.3',
      },
    ],
    [
      {
        name: 'Starbucks',
        type: 'cafe',
        osm_type: 'node',
        osm_id: 2,
        lat: '24.4',
        lon: '54.3',
      },
    ],
    [],
  ];
  for (const rows of cases)
    assert.equal(
      await resolvePromptLocation('warehouse Abu Dhabi', {
        fetchImpl: async () => response(rows),
      }),
      null,
    );
});

test('Burj Khalifa and Umm Suqeim remain available through exact attributed lookups', async () => {
  for (const name of ['Burj Khalifa', 'Umm Suqeim']) {
    const r = await resolvePromptLocation('police at ' + name, {
      fetchImpl: async () =>
        response([
          {
            name,
            type: name.startsWith('Burj') ? 'tower' : 'suburb',
            osm_type: 'way',
            osm_id: 100,
            lat: '25.1',
            lon: '55.2',
          },
        ]),
    });
    assert.equal(r.name, name);
    assert.equal(r.verification, 'verified');
    assert.match(r.sourceUrl, /openstreetmap\.org\/way\/100/);
  }
});

test('two exact-name candidates require explicit site selection', async () => {
  const row = {
    name: 'Example Gym',
    type: 'sports_centre',
    osm_type: 'way',
    osm_id: 1,
    lat: '25.1',
    lon: '55.2',
  };
  assert.equal(
    await resolvePromptLocation('Example Gym Abu Dhabi', {
      fetchImpl: async () => response([row, { ...row, osm_id: 2 }]),
    }),
    null,
  );
});

test('same source lookup coalesces and caches; different sites never reuse coordinates', async () => {
  let count = 0;
  const fetchImpl = async (url) => {
    count++;
    await new Promise((r) => setTimeout(r, 5));
    return response(
      mappedSite(
        url.includes('27374404') ? VERIFIED_SITES[1] : VERIFIED_SITES[0],
      ),
    );
  };
  const [a, b] = await Promise.all([
    resolvePromptLocation('Yas Mall', { fetchImpl }),
    resolvePromptLocation('car crash outside Yas Mall', { fetchImpl }),
  ]);
  assert.equal(count, 1);
  assert.equal(a.sourceFeatureId, b.sourceFeatureId);
  const c = await resolvePromptLocation('Kanes Boxing Gym', { fetchImpl });
  assert.equal(count, 2);
  assert.notEqual(c.sourceFeatureId, a.sourceFeatureId);
});

test('unresolved placeholders do not query geography', async () => {
  assert.equal(
    await resolvePromptLocation('Car crash at {{location}}', {
      fetchImpl: async () => assert.fail('no lookup'),
    }),
    null,
  );
});

test('centroid is translation-stable and rejects degenerate shapes', () => {
  assert.equal(
    polygonCentre([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 0],
    ]),
    null,
  );
  const a = polygonCentre([
    [54, 24],
    [55, 24],
    [55, 25],
    [54, 25],
    [54, 24],
  ]);
  assert.deepEqual(a, { lng: 54.5, lat: 24.5 });
});

test('query cleanup strips scenario words without silently shortening to a city', () => {
  assert.equal(cleanPlaceQuery("Car crash outside Kane's gym"), 'kanes gym');
  assert.deepEqual(queryLadder('yas mall west', 6), [
    'yas mall west',
    'yas mall',
    'mall west',
    'yas',
    'mall',
    'west',
  ]);
});
