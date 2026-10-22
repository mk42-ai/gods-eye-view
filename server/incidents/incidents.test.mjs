import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createIncidentStore } from './store.js';
import {
  createIncidentsHandler,
  incidentState,
} from './route.js';
import {
  resolveOffline,
  resolveIncidentText,
  parseResolveAnswer,
  parseRefreshAnswer,
  refreshIncidents,
  refreshPrompt,
} from './resolver.js';
import { getAoi } from '../../src/data/uaeAoi.js';
import { seedIncidents } from '../../src/data/uaeIncidents.js';

function mockRes() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    end(chunk) {
      this.headersSent = true;
      if (chunk !== undefined) this.body += chunk;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}
function mockReq(url, { method = 'GET', headers = {}, body } = {}) {
  return {
    url,
    method,
    headers: { host: 'localhost', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    socket: { remoteAddress: '127.0.0.1' },
  };
}
function tmpStore(extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uae-incidents-'));
  const filePath = path.join(dir, 'incidents.json');
  const store = createIncidentStore({
    filePath,
    kv: { enabled: false },
    warn: () => {},
    ...extra,
  });
  return { store, filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const BAB = 'Houthi drone strike on tanker near Bab el-Mandeb';

test('store seeds from the shipped JSON on first read and persists to the file', async () => {
  const { store, filePath, cleanup } = tmpStore();
  try {
    const doc = await store.read();
    assert.equal(doc.source, 'seed');
    assert.equal(doc.incidents.length, seedIncidents().length);
    assert.equal(doc.counts.IRAN, 10);
    assert.equal(doc.counts.YEMEN, 10);
    assert.equal(doc.counts.SOMALIA, 8);
    assert.equal(doc.counts.UAE_HOME_BORDER, 3);
    assert.equal(doc.lastRefreshUtc, null);
    const result = await store.ingest([
      { headline: BAB, lat: 12.6, lon: 43.3, severity: 'high' },
    ]);
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].group, 'YEMEN');
    assert.equal(result.added[0].aoi_id, 'bab-el-mandeb');
    assert.equal(result.source, 'store');
    assert.ok(existsSync(filePath));
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).incidents.length, 32);
    // a fresh store instance over the same file reloads the persisted record
    const again = createIncidentStore({ filePath, kv: { enabled: false }, warn: () => {} });
    const reloaded = await again.read();
    assert.equal(reloaded.source, 'store');
    assert.equal(reloaded.incidents.length, 32);
  } finally {
    cleanup();
  }
});

test('store dedupes same headline + 0.1° cell within 24 h and keeps distinct records', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const first = await store.ingest([
      { headline: BAB, lat: 12.6, lon: 43.3, event_time_utc: '2026-10-21T10:00:00Z' },
    ]);
    assert.equal(first.added.length, 1);
    const dup = await store.ingest([
      { headline: 'Houthi drone strike on a tanker near Bab el-Mandeb!', lat: 12.62, lon: 43.34, event_time_utc: '2026-10-21T20:00:00Z' },
    ]);
    assert.equal(dup.added.length, 0);
    assert.equal(dup.duplicates.length, 1);
    assert.equal(dup.duplicates[0].duplicateOf, first.added[0].id);
    const later = await store.ingest([
      { headline: BAB, lat: 12.6, lon: 43.3, event_time_utc: '2026-10-23T10:00:00Z' },
    ]);
    assert.equal(later.added.length, 1, '>24 h apart is kept');
    const elsewhere = await store.ingest([
      { headline: BAB, lat: 12.79, lon: 45.03, event_time_utc: '2026-10-21T10:00:00Z' },
    ]);
    assert.equal(elsewhere.added.length, 1, 'different location is kept');
    assert.equal(elsewhere.added[0].aoi_id, 'aden');
  } finally {
    cleanup();
  }
});

test('store rejects invalid payloads and can refuse out-of-AOI points', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const r = await store.ingest(
      [
        { headline: '', lat: 1, lon: 1 },
        { headline: 'Earthquake in Lima', lat: -12.05, lon: -77.03 },
        { headline: 'bad coords', lat: 'x', lon: 2 },
      ],
      { allowOutside: false },
    );
    assert.equal(r.added.length, 0);
    assert.equal(r.rejected.length, 3);
    assert.equal(r.rejected[1].reason, 'outside_aoi');
    const allowed = await store.ingest([{ headline: 'Earthquake in Lima', lat: -12.05, lon: -77.03 }]);
    assert.equal(allowed.added.length, 1);
    assert.equal(allowed.added[0].insideAoi, false);
    assert.equal(allowed.added[0].group, null);
  } finally {
    cleanup();
  }
});

test('incidentState is honest: NO KEY / SEED / LIVE', () => {
  assert.equal(incidentState({ configured: false, source: 'store', lastRefreshUtc: 'x' }), 'NO KEY');
  assert.equal(incidentState({ configured: true, source: 'seed', lastRefreshUtc: null }), 'SEED');
  assert.equal(incidentState({ configured: true, source: 'store', lastRefreshUtc: null }), 'SEED');
  assert.equal(incidentState({ configured: true, source: 'store', lastRefreshUtc: '2026-10-22T08:00:00Z' }), 'LIVE');
});

test('GET /api/incidents returns seed incidents, counts per group and state', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const h = createIncidentsHandler({ store, env: {}, configured: () => false });
    const res = mockRes();
    await h(mockReq('/'), res);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.source, 'seed');
    assert.equal(body.state, 'NO KEY');
    assert.equal(body.incidents.length, 31);
    assert.deepEqual(Object.keys(body.counts), ['IRAN', 'YEMEN', 'SOMALIA', 'UAE_HOME_BORDER']);
    assert.ok(body.counts.IRAN > 0 && body.counts.YEMEN > 0 && body.counts.SOMALIA > 0);
    const res2 = mockRes();
    await h(mockReq('/?group=SOMALIA'), res2);
    assert.equal(res2.json().incidents.length, 8);
  } finally {
    cleanup();
  }
});

test('POST /api/incidents requires the ingest secret (503 unset, 401 wrong, 200 right)', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const noSecret = createIncidentsHandler({ store, env: {}, configured: () => false, audit: () => {} });
    let res = mockRes();
    await noSecret(mockReq('/', { method: 'POST', body: { headline: 'x', lat: 12.6, lon: 43.3 } }), res);
    assert.equal(res.statusCode, 503);
    const h = createIncidentsHandler({
      store,
      env: { INCIDENT_INGEST_SECRET: 'unit-test-secret-value' },
      configured: () => false,
      audit: () => {},
    });
    res = mockRes();
    await h(mockReq('/', { method: 'POST', headers: { 'x-ingest-secret': 'nope' }, body: { headline: 'x', lat: 12.6, lon: 43.3 } }), res);
    assert.equal(res.statusCode, 401);
    res = mockRes();
    await h(
      mockReq('/', {
        method: 'POST',
        headers: { 'x-ingest-secret': 'unit-test-secret-value' },
        body: { incidents: [{ headline: BAB, lat: 12.6, lon: 43.3 }, { headline: BAB, lat: 12.6, lon: 43.3 }] },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.added.length, 1);
    assert.equal(body.duplicates.length, 1);
    assert.equal(body.counts.YEMEN, 11);
    assert.equal(JSON.stringify(body).includes('unit-test-secret-value'), false);
  } finally {
    cleanup();
  }
});

test('POST /api/incidents/composer persists without the browser holding the secret; cross-origin rejected', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const h = createIncidentsHandler({ store, env: { INCIDENT_INGEST_SECRET: 's' }, configured: () => false, audit: () => {} });
    let res = mockRes();
    await h(
      mockReq('/composer', { method: 'POST', headers: { origin: 'https://evil.example' }, body: { incident: { headline: BAB, lat: 12.6, lon: 43.3 } } }),
      res,
    );
    assert.equal(res.statusCode, 403);
    res = mockRes();
    await h(mockReq('/composer', { method: 'POST', body: { incident: { headline: BAB, lat: 12.6, lon: 43.3, severity: 'HIGH' } } }), res);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.incident.group, 'YEMEN');
    assert.equal(body.incident.provenance.via, 'composer');
    assert.equal(body.via, 'composer-proxy');
    assert.equal((await store.read()).incidents.length, 32);
  } finally {
    cleanup();
  }
});

test('resolveOffline: gazetteer places Bab el-Mandeb inside YEMEN and Lima outside every AOI', () => {
  const bab = resolveOffline(BAB);
  assert.ok(Math.abs(bab.lat - 12.6) < 0.2 && Math.abs(bab.lon - 43.3) < 0.2);
  assert.equal(bab.insideAoi, true);
  assert.equal(bab.matchedAoi.group, 'YEMEN');
  assert.equal(bab.matchedAoi.id, 'bab-el-mandeb');
  assert.equal(bab.incident_type, 'drone_strike');
  assert.equal(bab.provenance.provider, 'gazetteer');
  const lima = resolveOffline('earthquake in Lima');
  assert.equal(lima.insideAoi, false);
  assert.equal(lima.lat, null);
  assert.equal(lima.matchedAoi, null);
  const alias = resolveOffline('Pirates board a dhow off BOSASSO harbour');
  assert.equal(alias.matchedAoi.id, 'bosaso');
  assert.equal(alias.incident_type, 'piracy');
});

test('parseResolveAnswer: OnDemand JSON, fenced JSON, malformed JSON, null coordinates', () => {
  const good = parseResolveAnswer('{"placeName":"Bab el-Mandeb","lat":12.58,"lon":43.33,"country":"Yemen","summary":"s","incident_type":"Drone Strike","severity":"high","entities":["Houthi"],"event_time_utc":"2026-10-22T07:00:00Z"}');
  assert.equal(good.lat, 12.58);
  assert.equal(good.incident_type, 'drone_strike');
  assert.equal(good.severity, 'HIGH');
  assert.equal(good.event_time_utc, '2026-10-22T07:00:00.000Z');
  const fenced = parseResolveAnswer('Sure:\n```json\n{"placeName":"Aden","lat":12.79,"lon":45.03,"severity":"LOW"}\n```');
  assert.equal(fenced.placeName, 'Aden');
  assert.equal(parseResolveAnswer('not json at all'), null);
  assert.equal(parseResolveAnswer('{"placeName": oops}'), null);
  const nocoords = parseResolveAnswer('{"placeName":"Somewhere","lat":null,"lon":null,"severity":"MEDIUM"}');
  assert.equal(nocoords.lat, null);
});

function fakeClient(answer) {
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
        calls.push(['sync', sessionId, input]);
        if (answer instanceof Error) throw answer;
        return { data: { answer: typeof answer === 'function' ? answer(input) : answer, messageId: 'm1' } };
      },
    },
  };
}
function fakeStore() {
  const map = new Map();
  return {
    async get(u, k) {
      return map.get(`${u}|${k}`);
    },
    async put(u, k, rec) {
      const r = { ...(map.get(`${u}|${k}`) || {}), ...rec };
      map.set(`${u}|${k}`, r);
      return r;
    },
    async touch() {},
  };
}

test('resolveIncidentText uses OnDemand coordinates when valid and falls back on malformed / missing / errors', async () => {
  const live = await resolveIncidentText(BAB, {
    client: fakeClient('{"placeName":"Bab el-Mandeb Strait","lat":12.55,"lon":43.35,"summary":"Drone hit a tanker","incident_type":"drone_strike","severity":"HIGH","entities":["Houthis"],"event_time_utc":null}'),
    store: fakeStore(),
  });
  assert.equal(live.provenance.provider, 'ondemand');
  assert.equal(live.lat, 12.55);
  assert.equal(live.insideAoi, true);
  assert.equal(live.matchedAoi.group, 'YEMEN');
  assert.ok(live.event_time_utc, 'event time defaults to now when the model has none');
  const malformed = await resolveIncidentText(BAB, { client: fakeClient('no json'), store: fakeStore() });
  assert.equal(malformed.provenance.provider, 'gazetteer');
  assert.equal(malformed.provenance.fallbackReason, 'malformed_json');
  assert.equal(malformed.insideAoi, true);
  const nocoords = await resolveIncidentText(BAB, {
    client: fakeClient('{"placeName":null,"lat":null,"lon":null,"summary":"x","incident_type":"maritime_attack","severity":"CRITICAL"}'),
    store: fakeStore(),
  });
  assert.equal(nocoords.provenance.provider, 'ondemand+gazetteer');
  assert.equal(nocoords.severity, 'CRITICAL');
  assert.equal(nocoords.matchedAoi.id, 'bab-el-mandeb');
  const failed = await resolveIncidentText(BAB, { client: fakeClient(new Error('boom')), store: fakeStore() });
  assert.equal(failed.provenance.fallbackReason, 'upstream_error');
  assert.equal(failed.insideAoi, true);
  const unconfigured = await resolveIncidentText('earthquake in Lima', { client: null, store: fakeStore() });
  assert.equal(unconfigured.insideAoi, false);
  assert.equal(unconfigured.provenance.fallbackReason, 'not_configured');
});

test('refresh: NO KEY without a client; parses plugin JSON, drops citation-less and out-of-AOI candidates', async () => {
  const noKey = await refreshIncidents({ client: null, store: fakeStore() });
  assert.equal(noKey.state, 'NO KEY');
  assert.equal(noKey.candidates.length, 0);
  const aoi = getAoi('bab-el-mandeb');
  assert.match(refreshPrompt(aoi), /Bab el-Mandeb/);
  assert.match(refreshPrompt(aoi), /piracy OR cyberattack/);
  const parsed = parseRefreshAnswer(
    JSON.stringify({
      incidents: [
        { headline: 'Tanker hit off Perim', summary: 's', placeName: 'Perim', lat: null, lon: null, incident_type: 'maritime attack', severity: 'HIGH', event_time_utc: '2026-10-21T00:00:00Z', source_url: 'https://example.com/a' },
        { headline: 'No source here', lat: 12.6, lon: 43.3 },
        { headline: 'Earthquake in Lima', lat: -12.05, lon: -77.03, source_url: 'https://example.com/b' },
      ],
    }),
    aoi,
    { pluginId: 'plugin-1713924030' },
  );
  assert.equal(parsed.incidents.length, 2, 'citation-less candidate dropped');
  assert.equal(parsed.incidents[0].provenance.geocoder, 'gazetteer');
  assert.equal(parsed.incidents[0].incident_type, 'maritime_attack');
  const client = fakeClient((input) =>
    /Bab el-Mandeb/.test(input.query)
      ? '{"incidents":[{"headline":"Tanker hit off Perim","lat":12.64,"lon":43.4,"severity":"HIGH","source_url":"https://example.com/a"},{"headline":"Earthquake in Lima","lat":-12.05,"lon":-77.03,"source_url":"https://example.com/b"}]}'
      : '{"incidents":[]}',
  );
  const sweep = await refreshIncidents({ client, store: fakeStore(), group: 'YEMEN', limitAois: 3, concurrency: 2 });
  assert.equal(sweep.state, 'LIVE');
  assert.equal(sweep.plugin.name, 'internet_web_search');
  assert.equal(sweep.perAoi.length, 3);
  assert.equal(sweep.candidates.length, 1);
  assert.equal(sweep.candidates[0].group, 'YEMEN');
  assert.ok(client.calls.some(([k, , input]) => k === 'sync' && input.pluginIds[0] === 'plugin-1713924030'));
});

test('POST /api/incidents/refresh: NO KEY honestly, LIVE ingests once under the in-flight lock', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const noKey = createIncidentsHandler({ store, env: {}, configured: () => false, audit: () => {} });
    let res = mockRes();
    await noKey(mockReq('/refresh', { method: 'POST', body: {} }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().state, 'NO KEY');
    assert.equal(res.json().ok, false);
    let sweeps = 0;
    const h = createIncidentsHandler({
      store,
      env: {},
      configured: () => true,
      audit: () => {},
      refresh: async () => {
        sweeps += 1;
        await new Promise((r) => setTimeout(r, 20));
        return {
          state: 'LIVE',
          plugin: { name: 'internet_web_search', pluginId: 'plugin-1713924030' },
          endpointId: 'e',
          candidates: [{ headline: BAB, lat: 12.6, lon: 43.3, severity: 'HIGH', source_url: 'https://example.com/a', provenance: { provider: 'OnDemand' } }],
          perAoi: [{ aoi: 'bab-el-mandeb', status: 'ok' }],
        };
      },
    });
    const a = mockRes();
    const b = mockRes();
    await Promise.all([
      h(mockReq('/refresh', { method: 'POST', body: {} }), a),
      h(mockReq('/refresh', { method: 'POST', body: {} }), b),
    ]);
    assert.equal(sweeps, 1, 'concurrent refreshes share one sweep');
    assert.equal(a.json().state, 'LIVE');
    assert.equal(a.json().added, 1);
    assert.equal(b.json().added, 1, 'the waiter receives the shared outcome');
    assert.ok(a.json().shared !== b.json().shared, 'exactly one response is the shared copy');
    const doc = await store.read();
    assert.equal(doc.incidents.length, 32);
    assert.ok(doc.lastRefreshUtc);
    res = mockRes();
    await h(mockReq('/'), res);
    assert.equal(res.json().state, 'LIVE');
  } finally {
    cleanup();
  }
});

test('POST /api/incidents/resolve validates text and returns the resolution', async () => {
  const { store, cleanup } = tmpStore();
  try {
    const h = createIncidentsHandler({ store, env: {}, configured: () => false, audit: () => {}, resolve: (text) => resolveOffline(text) });
    let res = mockRes();
    await h(mockReq('/resolve', { method: 'POST', body: { text: '' } }), res);
    assert.equal(res.statusCode, 400);
    res = mockRes();
    await h(mockReq('/resolve', { method: 'POST', body: { text: BAB } }), res);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Math.abs(body.lat - 12.6) < 0.2);
    assert.equal(body.insideAoi, true);
    assert.equal(body.matchedAoi.group, 'YEMEN');
    res = mockRes();
    await h(mockReq('/nope', { method: 'POST', body: {} }), res);
    assert.equal(res.statusCode, 404);
    res = mockRes();
    await h(mockReq('/resolve', { method: 'DELETE' }), res);
    assert.equal(res.statusCode, 405);
  } finally {
    cleanup();
  }
});
