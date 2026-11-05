import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overpassQuery,
  overpassToFeatures,
  resolveOverpassEndpoints,
  createOsmClient,
  OVERPASS_ENDPOINTS,
} from './osm.js';

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () =>
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  body: { cancel() {} },
});

const sq = (x, y, s = 0.0005) => [
  { lon: x, lat: y },
  { lon: x + s, lat: y },
  { lon: x + s, lat: y + s },
  { lon: x, lat: y + s },
];

const OVERPASS_FIXTURE = {
  elements: [
    {
      type: 'way',
      id: 1,
      tags: { building: 'hotel', name: 'Fixture', 'name:en': 'Fixture Hotel' },
      geometry: [...sq(55.185, 25.141), { lon: 55.185, lat: 25.141 }],
    },
    {
      type: 'way',
      id: 2,
      tags: { building: 'yes', 'building:levels': '3' },
      geometry: [...sq(55.187, 25.141), { lon: 55.187, lat: 25.141 }],
    },
    // unclosed building ring: must be closed by the converter
    {
      type: 'way',
      id: 3,
      tags: { building: 'yes', name: 'Open Ring' },
      geometry: sq(55.189, 25.141),
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential', name: 'Fixture Lane' },
      geometry: [
        { lon: 55.18, lat: 25.14 },
        { lon: 55.19, lat: 25.14 },
      ],
    },
    {
      type: 'way',
      id: 5,
      tags: { highway: 'primary', name: 'Fixture Boulevard' },
      geometry: [
        { lon: 55.18, lat: 25.15 },
        { lon: 55.19, lat: 25.15 },
      ],
    },
    {
      type: 'way',
      id: 6,
      tags: { highway: 'secondary', name: 'Second Street' },
      geometry: [
        { lon: 55.18, lat: 25.16 },
        { lon: 55.19, lat: 25.16 },
      ],
    },
    // footway: dropped
    {
      type: 'way',
      id: 7,
      tags: { highway: 'footway' },
      geometry: [
        { lon: 55.18, lat: 25.13 },
        { lon: 55.19, lat: 25.13 },
      ],
    },
    // no geometry: dropped
    { type: 'way', id: 8, tags: { highway: 'primary' } },
    { type: 'node', id: 9, lat: 25.14, lon: 55.18, tags: { amenity: 'cafe' } },
  ],
};

test('overpassQuery embeds radii, building + highway filters and out geom', () => {
  const q = overpassQuery({
    lat: 25.1412,
    lon: 55.1853,
    buildingRadiusM: 160.4,
    roadRadiusM: 700,
  });
  assert.ok(q.startsWith('[out:json]'));
  assert.ok(q.includes('around:160,25.141200,55.185300'));
  assert.ok(q.includes('around:700,25.141200,55.185300'));
  assert.ok(q.includes('[building]'));
  assert.match(q, /\[highway~"\^\(motorway\|.*residential.*\)\$"\]/);
  assert.ok(q.includes('out geom'));
  assert.ok(!q.includes('footway'));
});

test('overpassToFeatures converts ways into buildings and roads', () => {
  const { buildings, roads } = overpassToFeatures(OVERPASS_FIXTURE);
  assert.equal(buildings.length, 3);
  for (const b of buildings) {
    const ring = b.geometry.coordinates[0];
    assert.equal(b.geometry.type, 'Polygon');
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
  }
  assert.equal(buildings[0].properties.name, 'Fixture Hotel');
  assert.equal(buildings[1].properties.levels, '3');
  assert.equal(buildings[2].properties.name, 'Open Ring');
  assert.equal(buildings[2].geometry.coordinates[0].length, 5);

  assert.equal(roads.length, 3);
  const byName = Object.fromEntries(roads.map((r) => [r.properties.name, r]));
  assert.equal(byName['Fixture Lane'].properties.major, false);
  assert.equal(byName['Fixture Boulevard'].properties.major, true);
  assert.equal(byName['Second Street'].properties.major, true);
  assert.equal(byName['Fixture Lane'].geometry.type, 'LineString');
  assert.ok(!roads.some((r) => r.properties.highway === 'footway'));
  assert.ok(!roads.some((r) => r.properties.osmId === 8));
  assert.deepEqual(overpassToFeatures(null), { buildings: [], roads: [] });
});

test('resolveOverpassEndpoints: defaults, parsing, https only', () => {
  assert.deepEqual(resolveOverpassEndpoints({}), [...OVERPASS_ENDPOINTS]);
  assert.deepEqual(
    resolveOverpassEndpoints({ SCENE_OVERPASS_ENDPOINTS: '   ' }),
    [...OVERPASS_ENDPOINTS],
  );
  assert.deepEqual(
    resolveOverpassEndpoints({
      SCENE_OVERPASS_ENDPOINTS:
        'https://a.example/api, https://b.example/api  http://c.example/api\nhttps://d.example/api',
    }),
    ['https://a.example/api', 'https://b.example/api', 'https://d.example/api'],
  );
  assert.deepEqual(
    resolveOverpassEndpoints({
      SCENE_OVERPASS_ENDPOINTS: 'http://only.example',
    }),
    [...OVERPASS_ENDPOINTS],
  );
});

function makeClient(handler, extra = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  const client = createOsmClient({
    fetch,
    persist: false,
    env: {},
    overpassEndpoints: [
      'https://one.example/api',
      'https://two.example/api',
      'https://three.example/api',
    ],
    osrmEndpoints: [
      'https://osrm-a.example/route/v1/driving',
      'https://osrm-b.example/route/v1/driving',
    ],
    ...extra,
  });
  return { client, calls };
}

test('surroundings tries endpoints in order, skips failures, caches', async () => {
  const { client, calls } = makeClient(async (url) => {
    if (url.startsWith('https://one.example')) return response(406, 'nope');
    if (url.startsWith('https://two.example')) throw new Error('ECONNRESET');
    return response(200, OVERPASS_FIXTURE);
  });
  const r1 = await client.surroundings({ lat: 25.1412, lon: 55.1853 });
  assert.equal(r1.ok, true);
  assert.equal(r1.endpoint, 'https://three.example/api');
  assert.equal(r1.cacheHit, false);
  assert.equal(r1.buildings.length, 3);
  assert.equal(r1.roads.length, 3);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(String(calls[0].init.body).startsWith('data='));

  const r2 = await client.surroundings({ lat: 25.1412, lon: 55.1853 });
  assert.equal(r2.ok, true);
  assert.equal(r2.cacheHit, true);
  assert.equal(r2.endpoint, 'https://three.example/api');
  assert.equal(calls.length, 3);
  assert.equal(client.stats().entries, 1);
});

test('surroundings returns ok:true from the second endpoint after a 406', async () => {
  const { client, calls } = makeClient(async (url) =>
    url.startsWith('https://one.example')
      ? response(406, 'nope')
      : response(200, OVERPASS_FIXTURE),
  );
  const r = await client.surroundings({ lat: 25.2, lon: 55.2 });
  assert.equal(r.ok, true);
  assert.equal(r.endpoint, 'https://two.example/api');
  assert.equal(calls.length, 2);
});

test('surroundings reports all endpoints failing with hostnames', async () => {
  const { client, calls } = makeClient(async (url) => {
    if (url.startsWith('https://two.example'))
      return response(200, { remark: 'runtime error' });
    return response(503, 'busy');
  });
  const r = await client.surroundings({ lat: 25.3, lon: 55.3 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.buildings, []);
  assert.deepEqual(r.roads, []);
  assert.equal(r.endpoint, null);
  assert.equal(r.cacheHit, false);
  assert.ok(r.reason.includes('one.example'));
  assert.ok(r.reason.includes('two.example'));
  assert.ok(r.reason.includes('three.example'));
  assert.ok(r.reason.includes('503'));
  assert.equal(calls.length, 3);
  // failures are not cached
  await client.surroundings({ lat: 25.3, lon: 55.3 });
  assert.equal(calls.length, 6);
});

test('route builds the OSRM URL, rounds, caches and falls back on NoRoute', async () => {
  const { client, calls } = makeClient(async (url) => {
    if (url.startsWith('https://osrm-a.example'))
      return response(200, { code: 'NoRoute', routes: [] });
    return response(200, {
      code: 'Ok',
      routes: [
        {
          distance: 1234.6,
          geometry: {
            type: 'LineString',
            coordinates: [
              [55.1700001234, 25.1500009876],
              [55.18, 25.145],
              [55.1853, 25.1425],
            ],
          },
        },
      ],
    });
  });
  const r = await client.route([55.17, 25.15], [55.1853, 25.1425]);
  assert.equal(r.ok, true);
  assert.equal(r.endpoint, 'https://osrm-b.example/route/v1/driving');
  assert.equal(r.distanceM, 1235);
  assert.deepEqual(r.coordinates, [
    [55.17, 25.150001],
    [55.18, 25.145],
    [55.1853, 25.1425],
  ]);
  assert.equal(r.cacheHit, false);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    'https://osrm-a.example/route/v1/driving/55.170000,25.150000;55.185300,25.142500?overview=full&geometries=geojson&steps=false&alternatives=false',
  );
  assert.ok(calls[1].url.includes('55.170000,25.150000;55.185300,25.142500'));
  assert.ok(calls[1].url.includes('overview=full&geometries=geojson'));
  assert.equal(calls[0].init.method, undefined);

  const r2 = await client.route([55.17, 25.15], [55.1853, 25.1425]);
  assert.equal(r2.cacheHit, true);
  assert.deepEqual(r2.coordinates, r.coordinates);
  assert.equal(calls.length, 2);
});

test('route reports failure when every OSRM endpoint fails', async () => {
  const { client } = makeClient(async () => response(500, 'boom'));
  const r = await client.route([55.17, 25.15], [55.1853, 25.1425]);
  assert.equal(r.ok, false);
  assert.equal(r.coordinates, null);
  assert.equal(r.distanceM, 0);
  assert.ok(r.reason.includes('osrm-a.example'));
  assert.ok(r.reason.includes('osrm-b.example'));
});

test('an aborted signal rejects with AbortError and performs no fetch', async () => {
  const { client, calls } = makeClient(async () =>
    response(200, OVERPASS_FIXTURE),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.surroundings({ lat: 25.4, lon: 55.4, signal: controller.signal }),
    (e) => e.name === 'AbortError',
  );
  await assert.rejects(
    client.route([55.17, 25.15], [55.18, 25.14], { signal: controller.signal }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(calls.length, 0);
});

test('a fetch that throws AbortError mid-flight propagates when the signal aborted', async () => {
  const controller = new AbortController();
  const { client, calls } = makeClient(async () => {
    controller.abort();
    throw new DOMException('The operation was aborted', 'AbortError');
  });
  await assert.rejects(
    client.surroundings({ lat: 25.5, lon: 55.5, signal: controller.signal }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(calls.length, 1);
});
