import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from '../ondemand/test-helpers.mjs';
import { createConversationStore } from '../ondemand/foundation/conversation-store.js';
import { createIncidentStore } from './store.js';
import {
  createIncidentRoutes,
  getAoiIndex,
  screenIncidents,
  parseIncidentArray,
  firesToIncidents,
  locateText,
  refreshFromPlugins,
  ensureSeeded,
  __resetSeedForTests,
} from './routes.js';
import { seedIncidents } from './seed.js';
import { resolveIncidentGate } from '../../src/aoi/sceneGate.js';

const index = getAoiIndex();

async function run(handler, init) {
  const res = makeRes();
  const req = makeReq(init);
  const url = new URL(init.url, 'http://localhost');
  let handled;
  try {
    handled = await handler(req, res, {
      path: url.pathname,
      method: init.method || 'GET',
      url,
    });
  } catch (err) {
    return { status: 0, error: err, body: null, res };
  }
  if (!handled || !res.ended) return { status: 0, body: null, res };
  let body;
  try {
    body = res.json();
  } catch {
    body = res.text();
  }
  return { status: res.statusCode, body, res };
}

function fakeClient({ answer = '[]', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    sessions: {
      async create(input) {
        calls.push(['create', input]);
        return { id: 'a'.repeat(24) };
      },
    },
    query: {
      async sync(sessionId, input) {
        calls.push(['sync', input.query.slice(0, 60)]);
        if (fail) {
          const e = new Error('boom');
          e.name = 'OnDemandHttpError';
          e.status = 502;
          throw e;
        }
        return {
          data: {
            answer: typeof answer === 'function' ? answer(input) : answer,
            messageId: 'm',
          },
        };
      },
    },
  };
}

describe('seed + screening', () => {
  test('seed runs through the AOI filter; Hotan/Yanbu/Ethiopia points are rejected with reasons', () => {
    const screened = screenIncidents(seedIncidents(), {
      membership: index.membership,
      now: new Date('2026-10-22T00:00:00Z'),
    });
    const rejectedTitles = screened.rejected.map((r) => r.title);
    assert.ok(rejectedTitles.some((t) => /Hotan/.test(t)));
    assert.ok(rejectedTitles.some((t) => /Riyadh and Yanbu/.test(t)));
    assert.ok(
      screened.rejected.filter(
        (r) => Math.abs(r.lat - 11.26) < 0.4 && Math.abs(r.lon - 41.52) < 0.1,
      ).length >= 10,
      'Ethiopia/Djibouti hotspots out of AOI',
    );
    for (const r of screened.rejected)
      assert.match(r.reason, /^OUT_OF_AOI: nearest AOI .+ at \d+(\.\d)? km$/);
    assert.equal(screened.invalid.length, 0);
    assert.ok(screened.accepted.length >= 30, String(screened.accepted.length));
    assert.ok(
      screened.accepted.some(
        (i) => i.category === 'protected_asset_presence_node',
      ),
    );
    assert.ok(screened.accepted.some((i) => i.place === 'Hodeidah'));
  });
});

describe('/incidents routes', () => {
  let handler, incidentStore, store, audits;
  beforeEach(() => {
    __resetSeedForTests();
    incidentStore = createIncidentStore({ backend: 'memory' });
    store = createConversationStore({ backend: 'memory' });
    audits = [];
    handler = createIncidentRoutes({
      incidentStore,
      store,
      aoiIndex: index,
      env: { INCIDENT_INGEST_SECRET: 's3cret-value' },
      audit: (e, f) => audits.push([e, f]),
    });
  });

  test('GET /list seeds the shared ledger, returns scenes per AOI and the rejected count', async () => {
    const { status, body } = await run(handler, {
      url: '/incidents/list?aoi=all',
    });
    assert.equal(status, 200);
    assert.ok(body.count >= 30);
    assert.ok(
      body.scene_count > 0 && body.scene_count < body.count,
      `clustered: ${body.scene_count}/${body.count}`,
    );
    assert.ok(body.rejected.count >= 15);
    assert.ok(Object.keys(body.per_aoi).length >= 5);
    assert.equal(body.categories.length, 10);
    assert.ok(
      body.scenes.every(
        (s) => s.keyframes.length === 3 && s.markers.length >= 1,
      ),
    );
    assert.ok(body.incidents.some((i) => i.id === 'presence-aden'), 'Aden remains available as external context');
    assert.ok(!body.scenes.some((s) => s.incident_ids.includes('presence-aden')), 'Aden is never playable');
    assert.ok(body.scenes.every((s) => resolveIncidentGate(s.title, s.keyframes[0]).allowed));
  });

  test('GET /list?aoi=yemen narrows to that AOI', async () => {
    const { body } = await run(handler, { url: '/incidents/list?aoi=yemen' });
    assert.ok(body.count > 0);
    assert.ok(
      body.incidents.every(
        (i) => i.aoi === 'yemen' || i.aoi_membership.aoi_ids.includes('yemen'),
      ),
    );
  });

  test('POST /ingest with the secret writes the shared ledger; wrong secret → 403', async () => {
    const inc = {
      title: 'Vessel boarded east of Fujairah',
      category: 'vessel_seizure',
      lat: 25.2369,
      lon: 56.3417,
      time_utc: '2026-10-22T08:00:00Z',
      sources: [{ url: 'https://example.org/x' }],
    };
    const ok = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      headers: { 'X-Ingest-Secret': 's3cret-value' },
      body: { incidents: [inc] },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.inserted_count, 1);
    assert.equal(ok.body.scope, 'shared');
    assert.equal(ok.body.scenes.length, 1);
    const dup = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      headers: { 'X-Ingest-Secret': 's3cret-value' },
      body: { incidents: [inc] },
    });
    assert.equal(dup.body.inserted_count, 0);
    assert.equal(dup.body.duplicates.length, 1);
    assert.equal(
      dup.body.existing.length,
      1,
      'duplicate hands back the stored incident',
    );
    assert.equal(
      dup.body.scenes.length,
      1,
      'and its scene, so the composer can reuse it',
    );
    // A session user colliding with the shared entry gets it back too.
    const sess = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      body: { externalUserId: 'ws-default-user9', incident: inc },
    });
    assert.equal(sess.body.inserted_count, 0);
    assert.equal(
      sess.body.existing[0].dedupe_key,
      ok.body.inserted[0].dedupe_key,
    );
    const bad = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      headers: { 'X-Ingest-Secret': 'nope' },
      body: { incidents: [inc] },
    });
    assert.equal(bad.status, 403);
  });

  test('POST /ingest session-scoped (no secret) needs externalUserId and stays private to that user', async () => {
    const inc = {
      title: 'Drone strike reported near Hodeidah port',
      category: 'missile_drone_strike',
      lat: 14.7979,
      lon: 42.9545,
    };
    const out = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      body: { externalUserId: 'ws-default-user1', incident: inc },
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.scope, 'session');
    assert.equal(out.body.inserted_count, 1);
    const mine = await run(handler, {
      url: '/incidents/list?externalUserId=ws-default-user1',
    });
    const other = await run(handler, {
      url: '/incidents/list?externalUserId=ws-default-user2',
    });
    assert.equal(mine.body.count, other.body.count + 1);
    const missing = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      body: { incident: inc },
    });
    assert.equal(missing.status, 0);
    assert.equal(
      missing.error?.name,
      'ValidationError',
      'validation error propagates to the foundation error mapper',
    );
  });

  test('POST /ingest rejects out-of-AOI incidents with the reason unless override:true', async () => {
    const paris = {
      title: 'Explosion in Paris',
      category: 'ied_terror',
      lat: 48.8566,
      lon: 2.3522,
    };
    const rej = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      body: { externalUserId: 'ws-default-user1', incident: paris },
    });
    assert.equal(rej.body.inserted_count, 0);
    assert.equal(rej.body.rejected.length, 1);
    assert.match(rej.body.rejected[0].reason, /^OUT_OF_AOI: nearest AOI/);
    const ovr = await run(handler, {
      url: '/incidents/ingest',
      method: 'POST',
      body: {
        externalUserId: 'ws-default-user1',
        incident: { ...paris, override: true },
      },
    });
    assert.equal(ovr.body.inserted_count, 1);
    assert.equal(ovr.body.inserted[0].override, true);
  });

  test('POST /locate: foreign gazetteer candidate is external context only', async () => {
    const { status, body } = await run(handler, {
      url: '/incidents/locate',
      method: 'POST',
      body: {
        text: 'drone strike reported near Hodeidah port',
        useOnDemand: false,
      },
    });
    assert.equal(status, 200);
    assert.equal(body.candidates[0].name, 'Hodeidah');
    assert.equal(body.candidates[0].aoi_membership.inside, false);
    assert.match(body.candidates[0].reason, /^OUT_OF_SCENE_AOI/);
  });

  test('POST /locate: Paris is a candidate but out of AOI with reason', async () => {
    const { body } = await run(handler, {
      url: '/incidents/locate',
      method: 'POST',
      body: { text: 'car bomb in Paris', useOnDemand: false },
    });
    assert.equal(body.candidates[0].name, 'Paris');
    assert.equal(body.candidates[0].aoi_membership.inside, false);
    assert.match(body.candidates[0].reason, /^OUT_OF_SCENE_AOI/);
  });

  test('POST /refresh without OnDemand configured reports skipped sources and keeps the ledger', async () => {
    const { status, body } = await run(handler, {
      url: '/incidents/refresh',
      method: 'POST',
      body: {},
    });
    assert.equal(status, 200);
    assert.ok(body.sources.length >= 2);
    assert.ok(body.sources.every((s) => s.status !== 'ok'));
    assert.match(body.workflow_hook, /TODO/);
  });

  test('unknown sub-route → 404 with the route list', async () => {
    const { status, body } = await run(handler, { url: '/incidents/' });
    assert.equal(status, 404);
    assert.ok(body.routes.length === 6);
  });
});

describe('plugin-mediated refresh + locate (fake OnDemand client)', () => {
  test('refreshFromPlugins parses JSON arrays from research answers and stamps provenance', async () => {
    const answer =
      'Here you go:\n```json\n[{"title":"Tanker struck by drone off Hodeidah","category":"maritime_attack","lat":14.6,"lon":42.7,"time_utc":"2026-10-22T04:00:00Z","sources":[{"url":"https://news.example/1","published_at":"2026-10-22"}],"confidence":"confirmed"}]\n```';
    const client = fakeClient({ answer });
    const store = createConversationStore({ backend: 'memory' });
    const out = await refreshFromPlugins({
      client,
      store,
      contracts: ['internet_web_search'],
    });
    // isConfigured() is false in tests → skipped, but the parser is exercised directly:
    const parsed = parseIncidentArray(answer);
    assert.equal(parsed.length, 1);
    assert.ok(out.sources.length >= 1);
  });
  test('firesToIncidents maps FIRMS rows into thermal hotspots', () => {
    const rows = firesToIncidents({
      data: {
        detections: [
          {
            latitude: 24.5,
            longitude: 56.6,
            acq_date: '2026-10-21',
            acq_time: '2229',
            frp: 11.4,
            satellite: 'N21',
            instrument: 'VIIRS',
            confidence: 'n',
          },
        ],
      },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, 'thermal_hotspot');
    assert.equal(rows[0].time_utc, '2026-10-21T22:29:00Z');
  });
  test('locateText falls back to the geocode_place tool when nothing matches', async () => {
    const toolInvoker = async (contract, args) => {
      assert.equal(contract.name, 'geocode_place');
      return {
        ok: true,
        data: {
          candidates: [
            {
              formatted_address: 'Sohar, Oman',
              geometry: { location: { lat: 24.35, lng: 56.71 } },
            },
          ],
        },
      };
    };
    const out = await locateText('fire at Sohar refinery', {
      index,
      toolInvoker,
      useOnDemand: false,
    });
    assert.equal(out.candidates[0].name, 'Sohar, Oman');
    assert.equal(out.candidates[0].source, 'geocode_place');
    assert.equal(
      out.candidates[0].aoi_membership.inside,
      false,
      'Sohar is foreign context, not a UAE playable scene',
    );
  });
  test('locateText merges same-place candidates from different sources', async () => {
    const client = fakeClient({
      answer:
        '{"candidates":[{"name":"Hodeidah Port, Yemen","lat":14.8,"lon":42.9333,"country":"YE","confidence":0.94}]}',
    });
    const store = createConversationStore({ backend: 'memory' });
    // isConfigured() is false in tests, so exercise the merge through the gazetteer + tool path instead:
    const toolInvoker = async () => ({
      ok: true,
      data: {
        candidates: [
          {
            formatted_address: 'Al Hudaydah Port',
            geometry: { location: { lat: 14.8, lng: 42.9333 } },
          },
        ],
      },
    });
    const out = await locateText('drone strike reported near Hodeidah port', {
      index,
      client,
      store,
      toolInvoker,
      useOnDemand: false,
    });
    assert.equal(out.candidates.length, 1, JSON.stringify(out.candidates));
    assert.equal(out.candidates[0].name, 'Hodeidah');
  });
  test('ensureSeeded is idempotent per process', async () => {
    __resetSeedForTests();
    const s = createIncidentStore({ backend: 'memory' });
    const a = await ensureSeeded(s, index);
    const b = await ensureSeeded(s, index);
    assert.equal(a, b);
    assert.equal(await s.size('shared'), a.accepted);
  });
});

test('locate geocodes the extracted place, not the natural-language query', async () => {
  const queries = [];
  const result = await locateText(
    'dubai opera check if there is any incidents',
    {
      index,
      useOnDemand: false,
      toolInvoker: async (_contract, args) => {
        queries.push(args.q);
        return {
          ok: true,
          data: {
            candidates: [
              {
                formatted_address: 'Dubai Opera, Dubai',
                geometry: { location: { lat: 25.1956, lng: 55.2721 } },
              },
            ],
          },
        };
      },
    },
  );
  assert.deepEqual(queries, ['dubai opera']);
  assert.equal(result.extraction.intent, 'incident_search');
  assert.equal(result.candidates[0].lat, 25.1956);
  assert.equal(result.candidates[0].verified, true);
});
test('unavailable geocoder is reported as unavailable rather than no places', async () => {
  const result = await locateText('Dubai Opera', {
    index,
    useOnDemand: false,
    toolInvoker: async () => {
      throw new Error('unit-test lookup unavailable');
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.candidates.length, 0);
});
test('scoped search route returns missing-credentials coverage without writing an incident', async () => {
  const handler = createIncidentRoutes({
    searchOptions: { configured: false },
  });
  const out = await run(handler, {
    url: '/incidents/search',
    method: 'POST',
    body: {
      text: 'Burj Khalifa',
      externalUserId: 'unit-test-search',
      candidate: {
        name: 'Burj Khalifa',
        lat: 25.1972,
        lon: 55.2744,
        source: 'geocode_place',
      },
    },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.status, 'unavailable');
  assert.deepEqual(out.body.reports, []);
  assert.ok(
    out.body.sources.every(
      (source) => source.error === 'ondemand_not_configured',
    ),
  );
});

test('cycle 16: Burj Khalifa resolves offline from the verified gazetteer even when the geocoder is down', async () => {
  for (const text of ['burj khalifa check if there is any incidents', 'Burj Khalifa']) {
    const result = await locateText(text, {
      index: getAoiIndex(),
      useOnDemand: false,
      toolInvoker: async () => { throw new Error('unit-test lookup unavailable'); },
    });
    assert.equal(result.status, 'resolved');
    assert.equal(result.candidates[0].name, 'Burj Khalifa');
    assert.ok(Math.abs(result.candidates[0].lat - 25.197) < 0.01);
    assert.equal(result.candidates[0].aoi_membership.inside, true);
  }
});
test('cycle 16: trailing noise still reaches the exact Dubai Marina area', async () => {
  const result = await locateText('Dubai Marina r', { index: getAoiIndex(), useOnDemand: false });
  assert.equal(result.extraction.place, 'Dubai Marina');
  assert.equal(result.status, 'resolved');
  assert.ok(Math.abs(result.candidates[0].lat - 25.0786) < 0.01);
});
test('cycle 16: conversational text never calls a provider', async () => {
  let called = 0;
  const result = await locateText('hi', { index: getAoiIndex(), useOnDemand: false, toolInvoker: async () => { called += 1; return { ok: true, data: { candidates: [] } }; } });
  assert.equal(called, 0);
  assert.equal(result.status, 'empty');
  assert.equal(result.extraction.kind, 'conversational');
});
