import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeometryResearch,
  decimate,
  outerRing,
  featureOffsets,
  unavailableGeometry,
} from './geometry.js';
import { createScenePlanService } from './index.js';

// Synthetic fixtures only: transport and OSM responses are mocked; no live provider success is claimed.
const candidate = {
  name: 'Dubai Marina',
  lat: 25.0805,
  lon: 55.1403,
  verified: true,
  source: 'Fixture geocoder',
  sourceUrl: 'https://www.openstreetmap.org/node/1',
};
function transport(answer) {
  const calls = [];
  return {
    calls,
    configured: () => true,
    createSession: async (pluginIds) => ({
      id: `s${calls.length + 1}`,
      externalUserId: 'x',
      pluginIds,
    }),
    query: async (s, q, o) => {
      calls.push({ s, q, o });
      return {
        answer:
          typeof answer === 'function'
            ? answer(q, calls.length)
            : JSON.stringify(answer),
        sessionId: s.id,
        messageId: 'm',
      };
    },
  };
}
const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  body: { cancel() {} },
});
function osm(routes = true) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    if (u.hostname.includes('routing'))
      return routes
        ? json({
            code: 'Ok',
            routes: [
              {
                distance: 4200,
                geometry: {
                  coordinates: [
                    [55.15, 25.09],
                    [55.145, 25.085],
                    [55.14, 25.08],
                  ],
                },
              },
            ],
          })
        : json({ code: 'NoRoute' });
    const q = u.searchParams.get('q');
    if (/nowhere/i.test(q)) return json([]);
    if (/london/i.test(q))
      return json([{ lat: '51.5', lon: '-0.12', osm_type: 'node', osm_id: 2 }]);
    if (/footprint/i.test(q))
      return json([
        {
          lat: '25.08',
          lon: '55.14',
          osm_type: 'way',
          osm_id: 7,
          geojson: {
            type: 'Polygon',
            coordinates: [
              [
                [55.139, 25.079],
                [55.141, 25.079],
                [55.141, 25.081],
                [55.139, 25.079],
              ],
            ],
          },
        },
      ]);
    if (/start/i.test(q))
      return json([
        { lat: '25.09', lon: '55.15', osm_type: 'node', osm_id: 3 },
      ]);
    return json([{ lat: '25.08', lon: '55.14', osm_type: 'node', osm_id: 4 }]);
  };
  return { fetchImpl, seen };
}
const research = {
  interpretation: { summary: 'A run along the marina', sceneType: 'event' },
  timeContext: {
    description: 'Morning',
    startUtc: '2026-10-31T03:00:00Z',
    endUtc: '2026-10-31T06:00:00Z',
  },
  features: [
    {
      name: 'Run route',
      kind: 'route',
      role: 'course',
      routeWaypoints: ['Start, Dubai', 'Finish, Dubai'],
      citations: [{ url: 'https://example.org/run', title: 'Run' }],
      lat: 1,
      lon: 2,
    },
    {
      name: 'Marina venue footprint',
      kind: 'area',
      geocodeQuery: 'footprint Marina',
      citations: ['https://example.org/run'],
    },
    {
      name: 'Marina Walk',
      kind: 'point',
      citations: [{ url: 'https://example.com/walk' }],
    },
    { name: 'Nowhere place', kind: 'point', citations: [] },
    {
      name: 'London pub',
      kind: 'point',
      geocodeQuery: 'London',
      citations: [],
    },
  ],
  citations: [{ url: 'https://example.net/extra', title: 'Extra' }],
};

test('LLM/Perplexity names features; OSM grounds them; road route is snapped; model coordinates ignored', async () => {
  const t = transport(research);
  const { fetchImpl, seen } = osm();
  const g = await createGeometryResearch({
    transport: t,
    fetchImpl,
    nominatimSpacingMs: 0,
  })({ prompt: 'Run at Dubai Marina', candidate, selectedTime: 72 });
  assert.deepEqual(t.calls[0].s.pluginIds, ['plugin-1722260873']);
  assert.match(t.calls[0].q, /NEVER output coordinates/);
  assert.equal(g.status, 'partial');
  const route = g.features.find((f) => f.kind === 'route');
  assert.deepEqual(route.geometry.coordinates, [
    [55.15, 25.09],
    [55.145, 25.085],
    [55.14, 25.08],
  ]);
  assert.match(route.provenance.source, /OSRM/);
  assert.equal(
    g.features.find((f) => f.kind === 'area').geometry.coordinates[0].length,
    4,
  );
  assert.deepEqual(
    g.features.find((f) => f.name === 'Marina Walk').geometry.coordinates,
    [55.14, 25.08],
  );
  assert.deepEqual(
    g.unresolved.map((u) => u.name),
    ['Nowhere place', 'London pub'],
  );
  assert.deepEqual(
    g.citations.map((c) => c.url),
    [
      'https://example.org/run',
      'https://example.com/walk',
      'https://example.net/extra',
    ],
  );
  assert.ok(
    seen.some((u) => u.includes('bounded=1')),
    'geocoding is bounded to the anchor surroundings',
  );
  assert.equal(g.timeContext.startUtc, '2026-10-31T03:00:00.000Z');
});

test('no route from the router falls back to mapped road geometry or reports unresolved, never invented', async () => {
  const t = transport({
    features: [
      {
        name: 'Nowhere road',
        kind: 'route',
        routeWaypoints: ['nowhere a', 'nowhere b'],
      },
    ],
  });
  const g = await createGeometryResearch({
    transport: t,
    fetchImpl: osm(false).fetchImpl,
    nominatimSpacingMs: 0,
  })({ prompt: 'x y z', candidate });
  assert.equal(g.status, 'empty');
  assert.equal(g.features.length, 0);
  assert.match(g.message, /Nothing was drawn/);
});

test('empty research is an explicit empty geometry; identical prompts are cached', async () => {
  const t = transport({ features: [], citations: [] });
  const r = createGeometryResearch({
    transport: t,
    fetchImpl: osm().fetchImpl,
    nominatimSpacingMs: 0,
  });
  const a = await r({ prompt: 'Quiet street', candidate });
  const b = await r({ prompt: 'quiet street ', candidate });
  assert.equal(a.status, 'empty');
  assert.deepEqual(a, b);
  assert.equal(t.calls.length, 1);
});

test('construct returns validated geometry beside the plan and feeds grounded points to the planner', async () => {
  const geo = await createGeometryResearch({
    transport: transport(research),
    fetchImpl: osm().fetchImpl,
    nominatimSpacingMs: 0,
  })({ prompt: 'Run', candidate });
  const planner = transport((q) => {
    const input = JSON.parse(q.split('\nINPUT ')[1]);
    assert.ok(input.groundedFeatures.length >= 2);
    assert.ok(
      input.groundedFeatures.every((f) =>
        f.localPoints.every((p) => Math.hypot(p.eastM, p.northM) <= 5000),
      ),
    );
    return JSON.stringify({
      version: 1,
      title: 'Run',
      illustrative: true,
      durationSec: 10,
      location: input.location,
      camera: { distanceM: 500, heading: 0, pitch: -40, framing: 'wide' },
      entities: [
        {
          id: 'r',
          type: 'runner',
          label: 'Runners',
          quantity: 2,
          position: input.groundedFeatures[0].localPoints[0],
          heading: 0,
        },
      ],
      relationships: [],
      beats: [
        { atSec: 0, title: 'Go', narration: 'Runners go.', entityIds: ['r'] },
      ],
      citations: input.citations,
      verification: input.verification,
    });
  });
  const svc = createScenePlanService({
    transport: planner,
    research: async () => ({
      kind: 'generic',
      status: 'generic',
      citations: [],
    }),
    geometry: async () => geo,
  });
  const result = await svc.construct({
    prompt: 'Run at the marina',
    candidate,
    revision: 1,
  });
  assert.equal(result.geometry.status, 'partial');
  assert.equal(result.geometry.features.length, geo.features.length);
});

test('a failing geometry provider yields an explicit unavailable state, not placeholder geometry', async () => {
  const planner = transport((q) => {
    const input = JSON.parse(q.split('\nINPUT ')[1]);
    assert.deepEqual(input.groundedFeatures, []);
    return JSON.stringify({
      version: 1,
      title: 'T',
      illustrative: true,
      durationSec: 10,
      location: input.location,
      camera: { distanceM: 500, heading: 0, pitch: -40, framing: 'wide' },
      entities: [
        {
          id: 'p',
          type: 'person',
          label: 'People',
          quantity: 1,
          position: { eastM: 0, northM: 0 },
          heading: 0,
        },
      ],
      relationships: [],
      beats: [
        { atSec: 0, title: 'A', narration: 'A person.', entityIds: ['p'] },
      ],
      citations: input.citations,
      verification: input.verification,
    });
  });
  const svc = createScenePlanService({
    transport: planner,
    research: async () => ({
      kind: 'generic',
      status: 'generic',
      citations: [],
    }),
    geometry: async () => {
      throw Object.assign(new Error('boom'), { code: 'provider_unavailable' });
    },
  });
  const result = await svc.construct({ prompt: 'Somewhere calm', candidate });
  assert.equal(result.geometry.status, 'unavailable');
  assert.equal(result.geometry.features.length, 0);
  assert.match(
    unavailableGeometry('x').message,
    /No lines, dots or areas were drawn/,
  );
});

test('helpers: decimation keeps endpoints; outer ring closes; offsets are local metres', () => {
  const line = Array.from({ length: 1000 }, (_, i) => [55 + i / 1e4, 25]);
  const d = decimate(line, 50);
  assert.equal(d.length, 50);
  assert.deepEqual(d[0], [55, 25]);
  assert.deepEqual(d.at(-1), [55.0999, 25]);
  const ring = outerRing({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
      [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    ],
  });
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(ring.length, 5);
  const offs = featureOffsets(
    {
      features: [
        {
          id: 'f',
          kind: 'point',
          name: 'n',
          geometry: { type: 'Point', coordinates: [55.1503, 25.0805] },
        },
      ],
    },
    candidate,
  );
  assert.ok(Math.abs(offs[0].localPoints[0].eastM - 1008) < 5);
});
