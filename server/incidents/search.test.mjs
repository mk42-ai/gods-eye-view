import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OnDemandAbortError,
  OnDemandHttpError,
} from '../ondemand/foundation/client.js';
import { ValidationError } from '../ondemand/foundation/types.js';
import {
  searchScope,
  parseSearchAnswer,
  qualifyReports,
  searchIncidentsAt,
} from './search.js';

const now = new Date('2026-10-24T01:00:00Z');
const input = {
  text: 'burj khalifa check if there is any incidents',
  candidate: {
    name: 'Burj Khalifa',
    lat: 25.1972,
    lon: 55.2744,
    source: 'geocode_place',
    verified: true,
  },
};
const { scope } = searchScope(input, now);
const fixture = {
  title: 'Unit-test incident, not live evidence',
  lat: 25.1972,
  lon: 55.2744,
  location_precision: 'exact',
  incident_time_utc: '2026-10-23T22:00:00Z',
  sources: [
    { url: 'https://news.example/test', published_at: '2026-10-23T23:00:00Z' },
  ],
};
const contracts = [1, 2].map((n) => ({
  name: `test-source-${n}`,
  pluginId: `plugin-${n}`,
  availability: 'active',
}));
function fake(responses) {
  const calls = [];
  return {
    calls,
    sessions: {
      create: async (body) => {
        calls.push(body);
        return { id: body.pluginIds[0] };
      },
    },
    query: {
      sync: async (id, body) => {
        calls.push(body);
        const response = responses[id];
        if (response instanceof Error) throw response;
        return { data: { answer: JSON.stringify(response) } };
      },
    },
  };
}
const complete = (incidents) => ({ search_status: 'complete', incidents });

test('scope extracts location/intent, five-km radius and real explicit interval', () => {
  assert.equal(scope.lat, 25.1972);
  assert.equal(scope.lon, 55.2744);
  assert.equal(scope.radiusKm, 5);
  assert.equal(scope.startUtc, '2026-10-21T01:00:00.000Z');
  assert.equal(searchScope(input, now).extraction.place, 'burj khalifa');
});
for (const candidate of [
  { lat: null, lon: 55 },
  { lat: 25, lon: '' },
  { lat: 91, lon: 55 },
  { lat: 25, lon: 181 },
])
  test(`invalid coordinate cannot be coerced: ${JSON.stringify(candidate)}`, () =>
    assert.throws(
      () => searchScope({ ...input, candidate }, now),
      /resolved WGS84/,
    ));
test('malformed/provider prose is not an empty success', () => {
  for (const answer of ['nothing found', '[]', '{}', '{"incidents":[]}'])
    assert.throws(() => parseSearchAnswer(answer), /invalid_search_response/);
});
test('publication time and incident time remain distinct', () => {
  const [report] = qualifyReports([fixture], scope, 'test').reports;
  assert.equal(report.incident_time_utc, fixture.incident_time_utc);
  assert.equal(report.sources[0].published_at, fixture.sources[0].published_at);
  assert.equal(report.timeBasis, 'incident_time');
});
test('unknown incident date is retained as unknown, never stamped as now', () => {
  const [report] = qualifyReports(
    [{ ...fixture, incident_time_utc: null }],
    scope,
    'test',
  ).reports;
  assert.equal(report.incident_time_utc, null);
  assert.equal(report.timeBasis, 'publication_time_only');
});
test('reject sources without dates, stale events, city-only locations, distant events and unsafe URLs', () => {
  const items = [
    { ...fixture, sources: [{ url: 'https://news.example/a' }] },
    { ...fixture, incident_time_utc: '2020-01-01T00:00:00Z' },
    { ...fixture, location_precision: 'city' },
    { ...fixture, lat: 20 },
    {
      ...fixture,
      sources: [{ url: 'javascript:alert(1)', published_at: '2026-10-23' }],
    },
  ];
  const result = qualifyReports(items, scope, 'test');
  assert.equal(result.reports.length, 0);
  assert.equal(result.excluded.length, 5);
});
test('signed source credentials are removed, not returned to the client', () => {
  const row = {
    ...fixture,
    sources: [
      {
        url: 'https://news.example/a?sig=secret&apikey=secret&id=1',
        published_at: '2026-10-23',
      },
    ],
  };
  assert.equal(
    qualifyReports([row], scope, 'test').reports[0].sources[0].url,
    'https://news.example/a?id=1',
  );
});
test('a clean zero-result search from every source is scoped empty, with an absence disclaimer', async () => {
  const client = fake({ 'plugin-1': complete([]), 'plugin-2': complete([]) });
  const out = await searchIncidentsAt(input, {
    client,
    configured: true,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'empty');
  assert.match(out.message, /not proof/);
  const queries = client.calls.filter((c) => c.query);
  assert.equal(queries.length, 2);
  assert.match(queries[0].query, /25\.1972, 55\.2744/);
  assert.match(queries[0].query, /WITHIN 5 km/);
  assert.equal(
    new Set(
      client.calls.filter((c) => c.externalUserId).map((c) => c.externalUserId),
    ).size,
    2,
  );
});
test('one source failure prevents a false empty claim', async () => {
  const error = new OnDemandHttpError(503, 'unit-test provider error', {});
  const out = await searchIncidentsAt(input, {
    client: fake({ 'plugin-1': complete([]), 'plugin-2': error }),
    configured: true,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'partial');
  assert.equal(out.sources[1].error, 'ondemand_http_503');
});
test('all unavailable sources and absent credentials are disclosed', async () => {
  const out = await searchIncidentsAt(input, {
    configured: false,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'unavailable');
  assert.ok(out.sources.every((s) => s.error === 'ondemand_not_configured'));
});
test('provider-declared unavailable is not converted to empty', async () => {
  const answer = {
    search_status: 'unavailable',
    incidents: [],
    note: 'test quota reached',
  };
  const out = await searchIncidentsAt(input, {
    client: fake({ 'plugin-1': answer, 'plugin-2': answer }),
    configured: true,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'unavailable');
});
test('unverifiable reports keep coverage partial, not empty', async () => {
  const out = await searchIncidentsAt(input, {
    client: fake({
      'plugin-1': complete([{ ...fixture, location_precision: 'city' }]),
      'plugin-2': complete([]),
    }),
    configured: true,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'partial');
  assert.deepEqual(out.reports, []);
});
test('matching reports are deduplicated without changing source dates', async () => {
  const out = await searchIncidentsAt(input, {
    client: fake({
      'plugin-1': complete([fixture]),
      'plugin-2': complete([fixture]),
    }),
    configured: true,
    now: () => now,
    contracts,
  });
  assert.equal(out.status, 'complete');
  assert.equal(out.reports.length, 1);
  assert.equal(out.reports[0].incident_time_utc, fixture.incident_time_utc);
});

for (const status of [409, 499, 504])
  test(`actual upstream HTTP ${status} stays upstream, without guessing a cause`, async () => {
    const error = new OnDemandHttpError(status, {
      message: 'private provider body must not be copied',
    }, {
      traceId: 'trace-unit-409\r\n' + 's'.repeat(64),
      url: 'https://private.example/session?apikey=private',
    });
    const out = await searchIncidentsAt(input, {
      client: fake({ 'plugin-1': error, 'plugin-2': error }),
      configured: true,
      now: () => now,
      contracts,
    });
    assert.equal(out.status, 'unavailable');
    assert.deepEqual(out.reports, []);
    assert.match(out.message, new RegExp(`HTTP ${status}`));
    for (const source of out.sources) {
      assert.equal(source.error, `ondemand_http_${status}`);
      assert.equal(source.errorOrigin, 'upstream_http');
      assert.equal(source.upstreamStatus, status);
      assert.equal(source.phase, 'submit_query');
      assert.equal(source.traceId, 'trace-unit-409<redacted-long-token>');
      assert.match(source.note, /does not establish its cause/);
    }
    assert.doesNotMatch(JSON.stringify(out), /session_busy|private provider|apikey=|private\.example/);
  });

test('409 during session creation preserves the actual phase and stops that query', async () => {
  let queries = 0;
  const client = {
    sessions: {
      create: async () => {
        throw new OnDemandHttpError(409, null, { traceId: 'create-trace' });
      },
    },
    query: { sync: async () => { queries += 1; } },
  };
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts,
  });
  assert.equal(out.status, 'unavailable');
  assert.equal(queries, 0);
  assert.ok(out.sources.every((s) => s.phase === 'create_session' &&
    s.upstreamStatus === 409 && s.traceId === 'create-trace'));
});

for (const [reason, origin, code] of [
  ['aborted', 'local_cancel', 'local_cancelled'],
  ['timeout', 'local_timeout', 'local_timeout'],
])
  test(`client synthetic ${reason} status is local, not upstream HTTP`, async () => {
    const error = new OnDemandAbortError(reason);
    const out = await searchIncidentsAt(input, {
      client: fake({ 'plugin-1': error, 'plugin-2': error }),
      configured: true, now: () => now, contracts,
    });
    assert.equal(out.status, 'unavailable');
    assert.deepEqual(out.reports, []);
    assert.match(out.message, /No conclusion about incidents/);
    assert.doesNotMatch(JSON.stringify(out), /ondemand_http_|upstreamStatus/);
    for (const source of out.sources) {
      assert.equal(source.errorOrigin, origin);
      assert.equal(source.error, code);
      assert.equal(source.phase, 'submit_query');
      assert.equal(source.retrievedAtUtc, now.toISOString());
    }
  });

test('local validation status 400 is not mislabeled as upstream HTTP', async () => {
  const error = new ValidationError('pluginId', 'invalid test id');
  const out = await searchIncidentsAt(input, {
    client: fake({ 'plugin-1': error, 'plugin-2': error }),
    configured: true, now: () => now, contracts,
  });
  assert.equal(out.status, 'unavailable');
  assert.ok(out.sources.every((s) => s.errorOrigin === 'local_validation'));
  assert.doesNotMatch(JSON.stringify(out), /ondemand_http_|upstreamStatus/);
});

for (const [name, origin] of [
  ['AbortError', 'local_cancel'],
  ['TimeoutError', 'local_timeout'],
])
  test(`already-${name} caller signal skips all upstream calls and preserves its origin`, async () => {
    const caller = new AbortController();
    caller.abort(new DOMException('unit-test caller stopped', name));
    const client = fake({ 'plugin-1': complete([]), 'plugin-2': complete([]) });
    const out = await searchIncidentsAt(input, {
      client, configured: true, now: () => now, contracts, signal: caller.signal,
    });
    assert.equal(out.status, 'unavailable');
    assert.equal(client.calls.length, 0);
    assert.ok(out.sources.every((s) => s.errorOrigin === origin && s.phase === 'create_session'));
    assert.doesNotMatch(JSON.stringify(out), /ondemand_http_|upstreamStatus/);
  });

test('caller TimeoutError remains a timeout when the client wraps it as aborted/499', async () => {
  const caller = new AbortController();
  const client = {
    sessions: { create: async () => ({ id: 'test' }) },
    query: { sync: async (_id, _body, { signal }) => {
      const pending = new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new OnDemandAbortError('aborted')), { once: true });
      });
      queueMicrotask(() => caller.abort(new DOMException('unit-test timeout', 'TimeoutError')));
      return pending;
    } },
  };
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts, signal: caller.signal,
  });
  assert.equal(out.status, 'unavailable');
  assert.match(out.message, /local time limit expired/);
  assert.ok(out.sources.every((s) => s.errorOrigin === 'local_timeout' && s.phase === 'submit_query'));
  assert.doesNotMatch(JSON.stringify(out), /ondemand_http_499/);
});

test('bounded search deadline returns even if query clients ignore abort signals', async () => {
  const options = [];
  const client = {
    sessions: { create: async (_body, opts) => {
      options.push(opts);
      return { id: 'test' };
    } },
    query: { sync: async (_id, _body, opts) => {
      options.push(opts);
      return new Promise(() => {});
    } },
  };
  const started = performance.now();
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts, timeoutMs: 25,
  });
  assert.equal(out.status, 'unavailable');
  assert.match(out.message, /local time limit expired/);
  assert.ok(performance.now() - started < 1000, 'must not await a never-settling client');
  assert.equal(options.length, 4);
  assert.equal(new Set(options.map((o) => o.signal)).size, 1, 'all phases share one budget');
  assert.ok(options.every((o) => o.timeoutMs > 0 && o.timeoutMs <= 25 && o.signal.aborted));
  assert.ok(out.sources.every((s) => s.error === 'local_timeout' && s.timeoutMs === 25 && s.phase === 'submit_query'));
  assert.doesNotMatch(JSON.stringify(out), /ondemand_http_|upstreamStatus/);
});

test('late session completion after deadline cannot start a query', async () => {
  let completeSession;
  let queries = 0;
  const pendingSession = new Promise((resolve) => { completeSession = resolve; });
  const client = {
    sessions: { create: async () => pendingSession },
    query: { sync: async () => { queries += 1; } },
  };
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts, timeoutMs: 15,
  });
  assert.equal(out.status, 'unavailable');
  assert.ok(out.sources.every((s) => s.errorOrigin === 'local_timeout' && s.phase === 'create_session'));
  completeSession({ id: 'late-session' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queries, 0);
});

test('caller cancellation settles non-cooperative queries without waiting for the deadline', async () => {
  const caller = new AbortController();
  const client = {
    sessions: { create: async () => ({ id: 'test' }) },
    query: { sync: async () => {
      queueMicrotask(() => caller.abort());
      return new Promise(() => {});
    } },
  };
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts, signal: caller.signal,
  });
  assert.equal(out.status, 'unavailable');
  assert.match(out.message, /caller cancelled/);
  assert.ok(out.sources.every((s) => s.errorOrigin === 'local_cancel'));
});

test('the 35-second budget cannot be extended by a larger timeout option', async () => {
  const error = new OnDemandAbortError('timeout');
  const out = await searchIncidentsAt(input, {
    client: fake({ 'plugin-1': error, 'plugin-2': error }),
    configured: true, now: () => now, contracts, timeoutMs: 999999,
  });
  assert.ok(out.sources.every((s) => s.timeoutMs === 35000));
});

test('a qualified successful source survives another source deadline, without changing dates or scope', async () => {
  const client = fake({ 'plugin-1': complete([
    fixture,
    { ...fixture, title: 'Unknown incident date test', incident_time_utc: null,
      sources: [{ url: 'https://news.example/publication-only', published_at: '2026-10-23T21:00:00Z' }] },
    { ...fixture, title: 'Stale event test', incident_time_utc: '2020-01-01T00:00:00Z' },
    { ...fixture, title: 'Distant event test', lat: 20 },
  ]) });
  const sync = client.query.sync;
  client.query.sync = async (id, ...args) => id === 'plugin-2'
    ? new Promise(() => {}) : sync(id, ...args);
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts, timeoutMs: 25,
  });
  assert.equal(out.status, 'partial');
  assert.equal(out.reports.length, 2);
  assert.equal(out.reports[0].incident_time_utc, fixture.incident_time_utc);
  assert.equal(out.reports[0].sources[0].published_at, fixture.sources[0].published_at);
  assert.equal(out.reports[0].timeBasis, 'incident_time');
  assert.equal(out.reports[1].incident_time_utc, null);
  assert.equal(out.reports[1].timeBasis, 'publication_time_only');
  assert.ok(out.reports.every((r) => r.provider === contracts[0].name && r.distanceKm <= scope.radiusKm));
  assert.equal(out.sources[0].status, 'ok');
  assert.deepEqual(out.sources[0].excluded, ['outside_time_window', 'outside_radius']);
  assert.equal(out.sources[1].error, 'local_timeout');
  assert.deepEqual(out.scope, scope);
  assert.equal(out.startedUtc, now.toISOString());
  assert.equal(out.completedUtc, now.toISOString());
});

test('previous successful reports are never replayed when a fresh search now fails', async () => {
  const responses = { 'plugin-1': complete([fixture]), 'plugin-2': complete([]) };
  const client = fake(responses);
  const options = { client, configured: true, now: () => now, contracts };
  const first = await searchIncidentsAt(input, options);
  assert.equal(first.status, 'complete');
  assert.equal(first.reports.length, 1);
  responses['plugin-1'] = new OnDemandHttpError(409, null, {});
  responses['plugin-2'] = new OnDemandAbortError('aborted');
  const second = await searchIncidentsAt(input, options);
  assert.equal(second.status, 'unavailable');
  assert.deepEqual(second.reports, []);
  assert.equal(new Set(client.calls.filter((c) => c.externalUserId).map((c) => c.externalUserId)).size, 4);
  assert.equal(client.calls.filter((c) => c.query).length, 4);
});

test('all malformed answers and no source contracts are unavailable, never complete or empty', async () => {
  const client = fake({ 'plugin-1': { incidents: [] }, 'plugin-2': { search_status: 'complete' } });
  const out = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts,
  });
  assert.equal(out.status, 'unavailable');
  assert.ok(out.sources.every((s) => s.phase === 'parse_response' && s.error === 'invalid_search_response'));
  const absent = await searchIncidentsAt(input, {
    client, configured: true, now: () => now, contracts: [],
  });
  assert.equal(absent.status, 'unavailable');
  assert.deepEqual(absent.reports, []);
});
