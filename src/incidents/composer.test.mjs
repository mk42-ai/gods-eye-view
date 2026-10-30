import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIncidentComposer,
  COMPOSER_ID,
  COMPOSER_PLACEHOLDER,
} from './ui/composer.js';
import {
  planFromCandidates,
  incidentFromText,
  incidentChatContext,
} from './client.js';
import { buildGeographicScene } from '../scenes/geographicScene.js';

/** Minimal DOM stand-in: enough of createElement/append/listeners for the composer. */
function makeDoc() {
  function mk(tag) {
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: new Map(),
      dataset: {},
      style: {},
      textContent: '',
      hidden: false,
      disabled: false,
      value: '',
      get className() {
        return this.attrs.get('class') || '';
      },
      set className(v) {
        this.attrs.set('class', v);
      },
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
      },
      getAttribute(k) {
        return this.attrs.has(k) ? this.attrs.get(k) : null;
      },
      append(...kids) {
        for (const k of kids) this.appendChild(k);
      },
      appendChild(k) {
        this.children.push(k);
        k.parentNode = this;
        return k;
      },
      replaceChildren(...kids) {
        this.children = [];
        this.append(...kids);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter(
            (c) => c !== this,
          );
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch(type, event = {}) {
        for (const fn of listeners.get(type) || [])
          fn({ type, preventDefault() {}, stopPropagation() {}, ...event });
      },
      find(pred, out = []) {
        for (const c of this.children) {
          if (pred(c)) out.push(c);
          c.find(pred, out);
        }
        return out;
      },
      text() {
        return [this.textContent, ...this.children.map((c) => c.text())]
          .filter(Boolean)
          .join(' ');
      },
    };
    return node;
  }
  const body = mk('body');
  return { createElement: mk, body };
}

const HODEIDAH = {
  name: 'Hodeidah',
  lat: 14.7979,
  lon: 42.9545,
  confidence: 1,
  source: 'gazetteer',
  aoi_membership: { inside: true, aoi_ids: ['yemen'] },
  reason: 'IN_AOI: Yemen',
};
const PARIS = {
  name: 'Paris',
  lat: 48.8566,
  lon: 2.3522,
  confidence: 1,
  source: 'gazetteer',
  aoi_membership: { inside: false, aoi_ids: [] },
  reason: 'OUT_OF_AOI: nearest AOI Iran at 3200 km',
};
const ADEN = {
  name: 'Aden',
  lat: 12.7896,
  lon: 45.0285,
  confidence: 0.7,
  source: 'gazetteer',
  aoi_membership: { inside: true, aoi_ids: ['yemen'] },
  reason: 'IN_AOI: Yemen',
};

function fakeClient({ candidates = [], ingestResult } = {}) {
  const calls = [];
  return {
    calls,
    async locate(text) {
      calls.push(['locate', text]);
      return { text, candidates };
    },
    async ingest(incident) {
      calls.push(['ingest', incident]);
      return (
        ingestResult || {
          inserted: [{ ...incident, id: 'inc-1', dedupe_key: 'k' }],
          inserted_count: 1,
          duplicates: [],
          rejected: [],
          scenes: [
            {
              id: 'inc-scene-1',
              title: incident.title,
              incident_ids: ['inc-1'],
              keyframes: [
                {
                  lat: incident.lat,
                  lon: incident.lon,
                  zoom: 12,
                  bearing: 0,
                  pitch: -80,
                  time: 0,
                },
              ],
            },
          ],
        }
      );
    },
  };
}

async function tick(n = 10) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

describe('planFromCandidates', () => {
  test('single in-AOI candidate → build directly', () => {
    assert.equal(planFromCandidates([HODEIDAH]).kind, 'single');
  });
  test('single out-of-AOI candidate → reject with reason', () => {
    const plan = planFromCandidates([PARIS]);
    assert.equal(plan.kind, 'out-of-aoi');
    assert.match(plan.reason, /^OUT_OF_AOI/);
  });
  test('ambiguous candidates → picker', () => {
    assert.equal(
      planFromCandidates([ADEN, { ...HODEIDAH, confidence: 0.7 }]).kind,
      'pick',
    );
  });
  test('no candidates → none', () => {
    assert.equal(planFromCandidates([]).kind, 'none');
  });
});

describe('incidentFromText / chat context', () => {
  test('typed text becomes an unverified incident at the candidate', () => {
    const inc = incidentFromText(
      'drone strike reported near Hodeidah port',
      HODEIDAH,
      { now: new Date('2026-10-22T10:00:00Z') },
    );
    assert.equal(inc.lat, 14.7979);
    assert.equal(inc.confidence, 'unverified');
    assert.equal(inc.time_utc, '2026-10-22T10:00:00.000Z');
    assert.equal(inc.override, undefined);
    assert.equal(
      incidentFromText('x', PARIS, { override: true }).override,
      true,
    );
  });
  test('mini chat context carries incident_id, aoi, sources and timestamps', () => {
    const incident = {
      id: 'inc-1',
      title: 'T',
      lat: 1,
      lon: 2,
      aoi: 'yemen',
      category: 'airstrike',
      time_utc: '2026-10-22T00:00:00Z',
      sources: [{ url: 'https://a', published_at: '2026-10-21' }],
      provenance: 'p',
    };
    const ctx = incidentChatContext({ id: 'inc-scene-1' }, incident);
    assert.equal(ctx.objectType, 'alert');
    assert.equal(ctx.objectId, 'inc-1');
    assert.equal(ctx.fields.aoi, 'yemen');
    assert.equal(ctx.fields.scene_id, 'inc-scene-1');
    assert.deepEqual(ctx.sourceRefs, [
      { url: 'https://a', published_at: '2026-10-21' },
    ]);
    assert.equal(ctx.timeWindow.start, '2026-10-22T00:00:00Z');
  });
});

describe('composer state machine', () => {
  test('renders the fixed input with the placeholder and submit', () => {
    const doc = makeDoc();
    const composer = createIncidentComposer({
      document: doc,
      client: fakeClient(),
    });
    assert.equal(composer.element.id, COMPOSER_ID);
    assert.equal(composer.input.placeholder, COMPOSER_PLACEHOLDER);
    assert.equal(composer.input.placeholder, 'Type an incident…');
    assert.equal(composer.element.getAttribute('data-state'), 'idle');
  });

  test('single candidate: chips locating → verifying AOI → building scene, ingest called, scene played', async () => {
    const doc = makeDoc();
    const played = [];
    const statuses = [];
    const composer = createIncidentComposer({
      document: doc,
      client: fakeClient({ candidates: [HODEIDAH] }),
      onScene: async ({ scene, incident, override }) =>
        played.push({ scene, incident, override }),
      onStatus: (s) => statuses.push(`${s.step}:${s.status}`),
    });
    const out = await composer.submit(
      'drone strike reported near Hodeidah port',
    );
    assert.equal(out.plan.kind, 'single');
    assert.ok(out.scene);
    assert.equal(played.length, 1);
    assert.equal(played[0].override, false);
    assert.equal(played[0].incident.place, 'Hodeidah');
    assert.deepEqual(statuses, [
      'locating:active',
      'locating:done',
      'verifying:done',
      'building:active',
      'building:done',
    ]);
    const chips = composer.element.find((n) => n.dataset.step);
    assert.deepEqual(
      chips.map((c) => `${c.dataset.step}=${c.dataset.status}`),
      ['locating=done', 'verifying=done', 'building=done'],
    );
    assert.equal(composer.element.getAttribute('data-state'), 'done');
  });

  test('multi-candidate: picker rendered, choosing an in-AOI row builds the scene', async () => {
    const doc = makeDoc();
    const played = [];
    const composer = createIncidentComposer({
      document: doc,
      client: fakeClient({
        candidates: [ADEN, { ...HODEIDAH, confidence: 0.7 }],
      }),
      onScene: async (p) => played.push(p),
    });
    const out = await composer.submit('explosion at the port');
    assert.equal(out.plan.kind, 'pick');
    const rows = composer.element.find(
      (n) => n.className === 'incident-composer__candidate',
    );
    assert.equal(rows.length, 2);
    assert.equal(played.length, 0, 'nothing built until the user picks');
    rows[1].dispatch('click');
    await tick(20);
    assert.equal(played.length, 1);
    assert.equal(played[0].candidate.name, 'Hodeidah');
  });

  test('out-of-AOI: explicit refusal gives external context only, never override or Play', async () => {
    const doc = makeDoc();
    const client = fakeClient({ candidates: [PARIS] });
    const played = [],
      external = [],
      geographic = [];
    const composer = createIncidentComposer({
      document: doc,
      client,
      onScene: async (p) => played.push(p),
      onExternal: async (p) => external.push(p),
      createGeographicScene: async (p) => geographic.push(p),
    });
    const out = await composer.submit('bomb threat in Paris');
    assert.equal(out.plan.kind, 'out-of-aoi');
    assert.equal(out.scene, null);
    assert.equal(composer.state.lastScene, null);
    assert.equal(composer.state.lastSearch, null);
    assert.match(
      composer.element.text(),
      /Outside UAE AOI — external context only/,
    );
    assert.match(
      composer.element.text(),
      /OUT_OF_AOI: nearest AOI Iran at 3200 km/,
    );
    assert.equal(
      composer.element.find((n) => n.id === `${COMPOSER_ID}-override`).length,
      0,
    );
    assert.equal(
      composer.element.find((n) => n.id === `${COMPOSER_ID}-play`).length,
      0,
    );
    assert.doesNotMatch(
      composer.element.text(),
      /Add anyway|override|\bPlay\b/,
    );
    assert.equal(client.calls.filter((c) => c[0] === 'ingest').length, 0);
    assert.equal(played.length, 0);
    assert.equal(geographic.length, 0);
    assert.equal(external.length, 1);
    assert.equal(external[0].candidate, PARIS);
    assert.equal(external[0].text, 'bomb threat in Paris');
    assert.equal(external[0].signal.aborted, false);
    assert.equal(composer.element.getAttribute('data-state'), 'external');
    assert.equal(composer.element.getAttribute('aria-busy'), 'false');
  });

  test('no candidates: explicit message, no ingest', async () => {
    const doc = makeDoc();
    const client = fakeClient({ candidates: [] });
    const composer = createIncidentComposer({ document: doc, client });
    const out = await composer.submit('zzzz');
    assert.equal(out.plan.kind, 'none');
    assert.match(composer.element.text(), /No place could be identified/);
    assert.equal(client.calls.length, 1);
  });

  test('server-side rejection (race) surfaces the reason', async () => {
    const doc = makeDoc();
    const client = fakeClient({
      candidates: [HODEIDAH],
      ingestResult: {
        inserted: [],
        inserted_count: 0,
        duplicates: [],
        rejected: [{ reason: 'OUT_OF_AOI: nearest AOI Yemen at 3 km' }],
        scenes: [],
      },
    });
    const composer = createIncidentComposer({ document: doc, client });
    const out = await composer.submit('drone strike near Hodeidah');
    assert.equal(out.scene, null);
    assert.match(
      composer.element.text(),
      /OUT_OF_AOI: nearest AOI Yemen at 3 km/,
    );
  });
});

const BURJ = {
  name: 'Burj Khalifa',
  lat: 25.1972,
  lon: 55.2744,
  source: 'geocode_place',
  verified: true,
  aoi_membership: { inside: true, aoi_ids: ['uae-gulf-waters'] },
};
function searchResponse(status = 'empty') {
  return {
    status,
    reports: [],
    sources: [
      {
        contract: 'test-source',
        status: status === 'unavailable' ? 'unavailable' : 'ok',
        error: status === 'unavailable' ? 'ondemand_not_configured' : undefined,
      },
    ],
    scope: {
      place: 'Burj Khalifa',
      lat: BURJ.lat,
      lon: BURJ.lon,
      radiusKm: 5,
      startUtc: '2026-10-21T00:00:00Z',
      endUtc: '2026-10-24T00:00:00Z',
      geocodeSource: 'geocode_place',
      geocodeVerified: true,
      coverage: 'Public sources; not proof of absence.',
    },
    message:
      status === 'unavailable'
        ? 'Incident search unavailable — no conclusion can be drawn.'
        : 'No qualifying sourced reports returned in this scope; not proof of absence.',
  };
}
for (const query of [
  'burj khalifa check if there is any incidents',
  'check for incidents near Burj Khalifa',
]) {
  test(`query is searched, not fabricated as an incident: ${query}`, async () => {
    const doc = makeDoc(),
      client = fakeClient({ candidates: [BURJ] });
    client.search = async (text, candidate) => {
      client.calls.push(['search', text, candidate]);
      return searchResponse();
    };
    const locations = [];
    const composer = createIncidentComposer({
      document: doc,
      client,
      onLocated: (p) => locations.push(p),
    });
    const result = await composer.submit(query);
    assert.equal(composer.state.extraction.place.toLowerCase(), 'burj khalifa');
    assert.equal(result.scene, null);
    assert.equal(composer.state.lastScene, null);
    assert.equal(client.calls.filter((c) => c[0] === 'ingest').length, 0);
    assert.equal(client.calls.find((c) => c[0] === 'search')[2].lat, BURJ.lat);
    assert.equal(locations.length, 1);
    assert.equal(composer.element.getAttribute('data-state'), 'empty');
    assert.match(composer.element.text(), /not proof of absence/);
    assert.equal(
      composer.element.find((n) => n.id === `${COMPOSER_ID}-submit`)[0]
        .disabled,
      false,
    );
  });
}
test('unavailable provider state is terminal and never an empty-success claim', async () => {
  const client = fakeClient({ candidates: [BURJ] });
  client.search = async () => searchResponse('unavailable');
  const composer = createIncidentComposer({ document: makeDoc(), client });
  await composer.submit('check for incidents near Burj Khalifa');
  assert.equal(composer.element.getAttribute('data-state'), 'unavailable');
  assert.match(composer.element.text(), /ondemand_not_configured/);
  assert.doesNotMatch(composer.element.text(), /No qualifying sourced/);
});
test('search exception releases busy state and exposes terminal error', async () => {
  const client = fakeClient({ candidates: [BURJ] });
  client.search = async () => {
    throw new Error('unit-test upstream failure');
  };
  const composer = createIncidentComposer({ document: makeDoc(), client });
  await composer.submit('check for incidents near Burj Khalifa');
  assert.equal(composer.state.busy, false);
  assert.equal(composer.element.getAttribute('aria-busy'), 'false');
  assert.equal(composer.element.getAttribute('data-state'), 'error');
  assert.match(composer.element.text(), /No conclusion/);
});
test('normal form submission reads the current input, avoids concurrent duplicates and preserves the query', async () => {
  const client = fakeClient({ candidates: [BURJ] });
  let finish;
  let searches = 0;
  client.search = () => {
    searches++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const composer = createIncidentComposer({ document: makeDoc(), client });
  composer.input.value = 'burj khalifa check if there is any incidents';
  composer.element.dispatch('submit');
  await tick();
  assert.equal(composer.state.busy, true);
  assert.equal(composer.element.getAttribute('data-state'), 'busy');
  composer.element.dispatch('submit');
  await tick();
  assert.equal(searches, 1);
  finish(searchResponse());
  await tick(20);
  assert.equal(
    composer.input.value,
    'burj khalifa check if there is any incidents',
  );
  assert.equal(composer.element.getAttribute('data-state'), 'empty');
});

test('mobile stack follows real composer height and releases observer on destroy', () => {
  const doc = makeDoc(),
    values = new Map();
  doc.body.style.setProperty = (key, value) => values.set(key, value);
  doc.body.style.removeProperty = (key) => values.delete(key);
  let notify,
    observed,
    disconnected = false;
  class Observer {
    constructor(callback) {
      notify = callback;
    }
    observe(node) {
      observed = node;
    }
    disconnect() {
      disconnected = true;
    }
  }
  const composer = createIncidentComposer({
    document: doc,
    client: fakeClient(),
    ResizeObserver: Observer,
  });
  assert.equal(observed, composer.element);
  composer.element.getBoundingClientRect = () => ({ height: 47 });
  notify();
  assert.equal(values.get('--incident-composer-height'), '47px');
  composer.element.getBoundingClientRect = () => ({ height: 302.3 });
  notify();
  assert.equal(values.get('--incident-composer-height'), '303px');
  composer.destroy();
  assert.equal(disconnected, true);
  assert.equal(values.has('--incident-composer-height'), false);
});

test('a long terminal result updates the mobile stack synchronously before ResizeObserver delivery', async () => {
  const doc = makeDoc(),
    values = new Map();
  doc.body.style.setProperty = (key, value) => values.set(key, value);
  const client = fakeClient({ candidates: [BURJ] });
  client.search = async () => searchResponse('unavailable');
  const composer = createIncidentComposer({
    document: doc,
    client,
    ResizeObserver: class {
      observe() {}
    },
  });
  composer.element.getBoundingClientRect = () => ({ height: 326.5 });
  await composer.submit('check for incidents near Burj Khalifa');
  assert.equal(values.get('--incident-composer-height'), '327px');
});

// The coordinates below are the observed Marina anchor supplied for this task.
// All client/provider responses in these tests are fixtures, not live evidence.
const MARINA = Object.freeze({
  name: 'Dubai Marina',
  lat: 25.0786415,
  lon: 55.1352524,
  verified: true,
  confidence: 0.95,
  source: 'geocode_place',
  aoi_membership: Object.freeze({
    inside: true,
    aoi_ids: Object.freeze(['dubai-marina']),
  }),
});
const MARINA_QUERY = 'Create a waterfront orbit scene around Dubai Marina';
const FIXTURE_NOW = '2026-10-24T00:00:00.000Z';
function geographicScene(input) {
  return buildGeographicScene({ ...input, now: FIXTURE_NOW });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function button(composer, suffix) {
  const found = composer.element.find(
    (n) => n.id === `${COMPOSER_ID}-${suffix}`,
  );
  assert.equal(found.length, 1, `${suffix} button must exist`);
  return found[0];
}
function assertNoPlay(composer) {
  assert.equal(
    composer.element.find((n) => n.id === `${COMPOSER_ID}-play`).length,
    0,
  );
  assert.equal(composer.state.lastScene, null);
}
function scopedResponse(candidate = MARINA, status = 'empty') {
  const response = searchResponse(status);
  return {
    ...response,
    scope: {
      ...response.scope,
      place: candidate.name,
      lat: candidate.lat,
      lon: candidate.lon,
    },
  };
}

describe('geographic composer integration', () => {
  test('verified Marina candidate and sceneStyle reach the real builder without incident ingest', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    const built = [],
      played = [];
    client.search = async () =>
      assert.fail('geographic requests must not search for incidents');
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: async (input) => {
        built.push(input);
        return geographicScene(input);
      },
      onScene: async (payload) => played.push(payload),
    });
    const result = await composer.submit(MARINA_QUERY);
    assert.equal(built.length, 1);
    assert.equal(built[0].candidate, MARINA);
    assert.equal(built[0].candidate.verified, true);
    assert.equal(built[0].extraction.place, 'Dubai Marina');
    assert.equal(built[0].extraction.sceneStyle, 'waterfront orbit');
    assert.equal(built[0].text, MARINA_QUERY);
    assert.equal(built[0].signal, composer.state.abort.signal);
    assert.equal(built[0].signal.aborted, false);
    assert.equal(result.scene.geographic, true);
    assert.deepEqual(result.scene.anchor, {
      name: MARINA.name,
      lat: MARINA.lat,
      lon: MARINA.lon,
    });
    assert.equal(result.scene.keyframes.length, 4);
    assert.equal(result.scene.steps.length, 4);
    assert.deepEqual(result.scene.incident_ids, []);
    assert.deepEqual(result.scene.evidence, []);
    assert.equal(result.scene.provenance.incidentConfirmed, false);
    assert.equal(played.length, 1);
    assert.equal(played[0].candidate, MARINA);
    assert.equal(played[0].scene, result.scene);
    assert.equal(played[0].incident, null);
    assert.equal(played[0].ingest, null);
    assert.equal(played[0].source, 'geographic');
    assert.equal(played[0].override, false);
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assert.equal(composer.element.getAttribute('data-state'), 'done');
    button(composer, 'play').dispatch('click');
    await tick(20);
    assert.equal(
      played.length,
      2,
      'Play reuses the completed geographic scene',
    );
    assert.equal(played[1].scene, result.scene);
    assert.equal(built.length, 1, 'Play must not rebuild or re-ingest');
  });

  test('unverified candidates cannot acquire verified status in the geographic callback', async () => {
    const unverified = { ...MARINA, verified: false };
    const client = fakeClient({ candidates: [unverified] });
    let received;
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene(input) {
        received = input.candidate;
        return geographicScene(input);
      },
      onScene() {
        assert.fail('unverified location must not be played');
      },
    });
    assert.equal(await composer.submit(MARINA_QUERY), null);
    assert.equal(received, unverified);
    assert.equal(received.verified, false);
    assert.match(
      composer.element.text(),
      /verified geocoder candidate is required/,
    );
    assert.equal(composer.element.getAttribute('data-state'), 'error');
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assertNoPlay(composer);
  });

  test('missing geographic callback fails explicitly instead of fabricating an incident', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    const composer = createIncidentComposer({ document: makeDoc(), client });
    assert.equal(await composer.submit(MARINA_QUERY), null);
    assert.match(
      composer.element.text(),
      /Geographic scene creation is unavailable/,
    );
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assertNoPlay(composer);
  });

  test('verified candidate reaches both onLocated and incident search without ingest', async () => {
    const client = fakeClient({ candidates: [MARINA] }),
      located = [],
      searched = [];
    client.search = async (...args) => {
      searched.push(args);
      return scopedResponse();
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      onLocated: async (payload) => located.push(payload),
      createGeographicScene() {
        assert.fail('search is not scene construction');
      },
    });
    const out = await composer.submit('Dubai Marina check for any incidents');
    assert.equal(out.scene, null);
    assert.equal(located.length, 1);
    assert.equal(searched.length, 1);
    assert.equal(located[0].candidate, MARINA);
    assert.equal(searched[0][1], MARINA);
    assert.equal(searched[0][1].verified, true);
    assert.equal(searched[0][2].signal, located[0].signal);
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assert.equal(composer.element.getAttribute('data-state'), 'empty');
    assertNoPlay(composer);
  });

  test('outside geographic request invokes external context without builder, ingest, search or Play', async () => {
    const client = fakeClient({ candidates: [PARIS] }),
      external = [];
    client.search = () => assert.fail('outside request cannot search');
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      onExternal: async (payload) => external.push(payload),
      createGeographicScene() {
        assert.fail('outside request cannot build');
      },
      onScene() {
        assert.fail('outside request cannot play');
      },
    });
    const result = await composer.submit(
      'Build a waterfront orbit scene around Paris',
    );
    assert.equal(result.scene, null);
    assert.equal(external.length, 1);
    assert.equal(external[0].candidate, PARIS);
    assert.equal(external[0].extraction.sceneStyle, 'waterfront orbit');
    assert.equal(composer.element.getAttribute('data-state'), 'external');
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assertNoPlay(composer);
  });
});

describe('Cancel / Retry and superseded asynchronous results', () => {
  test('Cancel aborts a pending locate and ignores a transport that resolves anyway', async () => {
    const wait = deferred(),
      calls = [],
      statuses = [];
    const client = fakeClient();
    client.locate = (text, options) => {
      calls.push({ text, ...options });
      return wait.promise;
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene() {
        assert.fail('cancelled locate cannot build');
      },
      onLocated() {
        assert.fail('cancelled locate cannot position the map');
      },
      onExternal() {
        assert.fail('cancelled locate cannot apply external context');
      },
      onScene() {
        assert.fail('cancelled locate cannot play');
      },
      onStatus: (status) => statuses.push(status),
    });
    const pending = composer.submit(MARINA_QUERY);
    assert.equal(composer.state.busy, true);
    assert.equal(button(composer, 'cancel').hidden, false);
    button(composer, 'cancel').dispatch('click');
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(composer.state.busy, false);
    assert.equal(composer.state.steps.locating, 'cancelled');
    assert.equal(button(composer, 'retry').hidden, false);
    assert.equal(button(composer, 'submit').disabled, false);
    const count = statuses.length;
    wait.resolve({ candidates: [MARINA] });
    assert.equal(await pending, null);
    assert.equal(statuses.length, count, 'late resolve cannot publish chips');
    assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
    assert.equal(composer.element.getAttribute('aria-busy'), 'false');
    assert.deepEqual(composer.state.candidates, []);
    assertNoPlay(composer);
  });

  test('Cancel while searching discards late reports and preserves cancellation UI', async () => {
    const wait = deferred(),
      client = fakeClient({ candidates: [MARINA] });
    let signal;
    client.search = (_text, _candidate, options) => {
      signal = options.signal;
      return wait.promise;
    };
    const composer = createIncidentComposer({ document: makeDoc(), client });
    const pending = composer.submit('check for incidents near Dubai Marina');
    await tick();
    assert.equal(composer.state.steps.searching, 'active');
    button(composer, 'cancel').dispatch('click');
    assert.equal(signal.aborted, true);
    wait.resolve(scopedResponse());
    assert.equal(await pending, null);
    assert.equal(composer.state.lastSearch, null);
    assert.equal(composer.state.steps.searching, 'cancelled');
    assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
    assert.match(composer.element.text(), /Cancelled/);
    assert.doesNotMatch(
      composer.element.text(),
      /No qualifying sourced reports/,
    );
    assertNoPlay(composer);
  });

  test('Cancel during geographic creation prevents onScene and late Play creation', async () => {
    const wait = deferred(),
      client = fakeClient({ candidates: [MARINA] });
    let input;
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene(payload) {
        input = payload;
        return wait.promise;
      },
      onScene() {
        assert.fail('late geographic scene must not publish');
      },
    });
    const pending = composer.submit(MARINA_QUERY);
    await tick();
    assert.equal(composer.state.steps.building, 'active');
    button(composer, 'cancel').dispatch('click');
    assert.equal(input.signal.aborted, true);
    wait.resolve(geographicScene(input));
    assert.equal(await pending, null);
    assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assertNoPlay(composer);
  });

  test('Cancel during ingest ignores the already-started operation result, not claiming rollback', async () => {
    const wait = deferred(),
      client = fakeClient({ candidates: [MARINA] });
    let signal, raw;
    client.ingest = (incident, options) => {
      raw = incident;
      signal = options.signal;
      return wait.promise;
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      onScene() {
        assert.fail('cancelled ingest result cannot play');
      },
    });
    const pending = composer.submit('fire at Dubai Marina');
    await tick();
    assert.equal(raw.place, 'Dubai Marina');
    button(composer, 'cancel').dispatch('click');
    assert.equal(signal.aborted, true);
    wait.resolve({
      inserted: [{ ...raw, id: 'fixture-incident' }],
      scenes: [{ id: 'fixture-incident-scene' }],
      rejected: [],
      duplicates: [],
    });
    assert.equal(await pending, null);
    assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
    assertNoPlay(composer);
  });

  test('Cancel during onScene completion cannot resurrect a successful scene or Play', async () => {
    const wait = deferred(),
      client = fakeClient({ candidates: [MARINA] });
    const delivered = [];
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: geographicScene,
      onScene(payload) {
        delivered.push(payload);
        return wait.promise;
      },
    });
    const pending = composer.submit(MARINA_QUERY);
    await tick();
    assert.equal(delivered.length, 1, 'callback started before cancellation');
    button(composer, 'cancel').dispatch('click');
    assert.equal(delivered[0].signal.aborted, true);
    wait.resolve();
    assert.equal(await pending, null);
    assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
    assertNoPlay(composer);
  });

  test('Retry after a locate failure repeats the original text with a fresh signal', async () => {
    const client = fakeClient(),
      calls = [],
      played = [];
    client.locate = async (text, options) => {
      calls.push({ text, ...options });
      if (calls.length === 1) throw new Error('fixture locate unavailable');
      return { candidates: [MARINA] };
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: geographicScene,
      onScene: async (payload) => played.push(payload),
    });
    assert.equal(await composer.submit(MARINA_QUERY), null);
    assert.equal(composer.element.getAttribute('data-state'), 'error');
    assert.match(
      composer.element.text(),
      /Locate failed: fixture locate unavailable/,
    );
    assert.equal(button(composer, 'retry').hidden, false);
    composer.input.value = 'edited but not submitted';
    button(composer, 'retry').dispatch('click');
    await tick(20);
    assert.deepEqual(
      calls.map(({ text }) => text),
      [MARINA_QUERY, MARINA_QUERY],
    );
    assert.notEqual(calls[0].signal, calls[1].signal);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, false);
    assert.equal(played.length, 1);
    assert.equal(composer.element.getAttribute('data-state'), 'done');
    assert.equal(composer.state.busy, false);
    assert.equal(button(composer, 'retry').hidden, true);
  });

  test('Retry after cancellation can finish before an uncooperative original locate', async () => {
    const wait = deferred(),
      client = fakeClient(),
      calls = [],
      played = [];
    client.locate = (text, options) => {
      calls.push({ text, ...options });
      return calls.length === 1
        ? wait.promise
        : Promise.resolve({ candidates: [MARINA] });
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: geographicScene,
      onScene: async (payload) => played.push(payload),
    });
    const first = composer.submit(MARINA_QUERY);
    button(composer, 'cancel').dispatch('click');
    composer.input.value = 'do not replace the retry query';
    button(composer, 'retry').dispatch('click');
    await tick(20);
    assert.equal(played.length, 1);
    const scene = composer.state.lastScene;
    assert.ok(scene);
    wait.resolve({ candidates: [PARIS] });
    assert.equal(await first, null);
    assert.equal(composer.state.lastScene, scene);
    assert.deepEqual(composer.state.candidates, [MARINA]);
    assert.deepEqual(
      calls.map(({ text }) => text),
      [MARINA_QUERY, MARINA_QUERY],
    );
    assert.notEqual(calls[0].signal, calls[1].signal);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(composer.element.getAttribute('data-state'), 'done');
    assert.equal(played.length, 1);
  });

  test('Retry after unavailable search performs another search, never an incident ingest', async () => {
    const client = fakeClient({ candidates: [MARINA] }),
      searched = [];
    client.search = async (text, candidate, options) => {
      searched.push({ text, candidate, ...options });
      return scopedResponse(
        candidate,
        searched.length === 1 ? 'unavailable' : 'empty',
      );
    };
    const composer = createIncidentComposer({ document: makeDoc(), client });
    await composer.submit('check for incidents near Dubai Marina');
    assert.equal(composer.element.getAttribute('data-state'), 'unavailable');
    assert.equal(button(composer, 'retry').hidden, false);
    button(composer, 'retry').dispatch('click');
    await tick(20);
    assert.equal(searched.length, 2);
    assert.equal(searched[1].text, 'check for incidents near Dubai Marina');
    assert.equal(searched[1].candidate, MARINA);
    assert.equal(searched[0].signal.aborted, true);
    assert.equal(searched[1].signal.aborted, false);
    assert.equal(composer.element.getAttribute('data-state'), 'empty');
    assert.equal(button(composer, 'retry').hidden, true);
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assertNoPlay(composer);
  });

  for (const settlement of ['resolve', 'reject']) {
    test(`superseded search ${settlement} cannot release a newer busy request or overwrite its result`, async () => {
      const waits = [deferred(), deferred()],
        calls = [];
      const client = fakeClient();
      client.locate = async (text) => ({
        candidates: [text.includes('Dubai Marina') ? MARINA : BURJ],
      });
      client.search = (text, candidate, options) => {
        const index = calls.length;
        calls.push({ text, candidate, ...options });
        return waits[index].promise;
      };
      const composer = createIncidentComposer({ document: makeDoc(), client });
      const first = composer.submit('check for incidents near Dubai Marina');
      await tick();
      button(composer, 'cancel').dispatch('click');
      const second = composer.submit('check for incidents near Burj Khalifa');
      await tick();
      assert.equal(calls.length, 2);
      if (settlement === 'resolve')
        waits[0].resolve(scopedResponse(MARINA, 'unavailable'));
      else waits[0].reject(new Error('fixture stale rejection'));
      assert.equal(await first, null);
      assert.equal(composer.state.busy, true);
      assert.equal(composer.element.getAttribute('aria-busy'), 'true');
      assert.equal(button(composer, 'submit').disabled, false);
      assert.equal(calls[1].signal.aborted, false);
      assert.equal(composer.state.lastSearch, null);
      assert.equal(composer.state.text, 'check for incidents near Burj Khalifa');
      assert.deepEqual(composer.state.candidates, [BURJ]);
      assert.doesNotMatch(
        composer.element.text(),
        /stale rejection|ondemand_not_configured/,
      );
      const latest = scopedResponse(BURJ);
      waits[1].resolve(latest);
      const out = await second;
      assert.equal(out.search, latest);
      assert.equal(composer.state.lastSearch, latest);
      assert.equal(composer.element.getAttribute('data-state'), 'empty');
      assert.equal(composer.state.busy, false);
      assertNoPlay(composer);
    });
  }

  test('a picker from a superseded generation cannot build or replace the current scene', async () => {
    const client = fakeClient(),
      built = [];
    client.locate = async (text) => ({
      candidates:
        text === MARINA_QUERY
          ? [MARINA]
          : [ADEN, { ...HODEIDAH, confidence: 0.7 }],
    });
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene(input) {
        built.push(input);
        return geographicScene(input);
      },
    });
    await composer.submit('explosion at the port');
    const staleRow = composer.element.find(
      (n) => n.className === 'incident-composer__candidate',
    )[0];
    assert.ok(staleRow);
    const current = await composer.submit(MARINA_QUERY);
    staleRow.dispatch('click');
    await tick(20);
    assert.equal(composer.state.lastScene, current.scene);
    assert.equal(built.length, 1);
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assert.equal(composer.element.getAttribute('data-state'), 'done');
  });
});

// Cycle 15: exact AOI box regressions. Fixtures here are not live-provider proof.
describe('AOI BUILD SCENE intent, bounded work and native rebuilds', () => {
  const ABU_DHABI = { ...MARINA, name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773 };
  test('bare locations build geographic scenes despite a legacy locate search intent', async () => {
    const rendered = [];
    const client = {
      locate: async (text) => ({
        extraction: { originalText: text, place: text, intent: 'incident_search' },
        candidates: [text === 'Dubai Marina' ? MARINA : ABU_DHABI],
      }),
      search: () => assert.fail('BUILD SCENE must not run research for a bare AOI'),
      ingest: () => assert.fail('a geographic plan must not fabricate an incident'),
    };
    const c = createIncidentComposer({ document: makeDoc(), client,
      createGeographicScene: geographicScene, onScene: (p) => rendered.push(p.scene) });
    for (const place of ['Dubai Marina', 'Abu Dhabi', 'Dubai Marina']) {
      const out = await c.submit(place);
      assert.equal(out.scene.anchor.name, place);
      assert.equal(c.state.extraction.intent, 'build_scene');
      assert.equal(c.state.busy, false);
      assert.equal(c.element.getAttribute('data-state'), 'done');
      assert.equal(button(c, 'submit').disabled, false);
    }
    assert.notEqual(rendered[0].id, rendered[1].id);
    assert.equal(rendered[0].id, rendered[2].id);
    c.destroy();
  });
  test('explicit research still searches without generating an incident or geographic scene', async () => {
    let searches = 0;
    const c = createIncidentComposer({ document: makeDoc(), client: {
      locate: async () => ({ candidates: [MARINA] }),
      search: async () => { searches += 1; return scopedResponse(); },
      ingest: () => assert.fail('research must not ingest'),
    }, createGeographicScene: () => assert.fail('research must not build') });
    await c.submit('check for incidents near Dubai Marina');
    assert.equal(searches, 1);
    assert.equal(c.state.busy, false);
    assertNoPlay(c);
    c.destroy();
  });
  test('edited native form submission supersedes pending work; duplicate text coalesces', async () => {
    const old = deferred(), next = deferred();
    const calls = [];
    const c = createIncidentComposer({ document: makeDoc(), client: {
      locate: (text, { signal }) => { calls.push({ text, signal }); return calls.length === 1 ? old.promise : next.promise; },
    }, createGeographicScene: geographicScene });
    c.input.value = 'Dubai Marina';
    c.element.dispatch('submit');
    await tick();
    assert.equal(button(c, 'submit').disabled, false, 'edited rebuild remains clickable');
    c.element.dispatch('submit');
    assert.equal(calls.length, 1, 'same text does not duplicate a pending request');
    c.input.value = 'Abu Dhabi';
    c.element.dispatch('submit');
    await tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(c.state.busy, true, 'old cleanup does not unlock replacement');
    next.resolve({ candidates: [ABU_DHABI] });
    await tick(40);
    assert.equal(c.state.lastScene.anchor.name, 'Abu Dhabi');
    old.resolve({ candidates: [MARINA] });
    await tick(40);
    assert.equal(c.state.lastScene.anchor.name, 'Abu Dhabi');
    assert.equal(c.input.value, 'Abu Dhabi');
    assert.equal(c.state.busy, false);
    c.destroy();
  });
  for (const stage of ['locate', 'geographic-build', 'render']) {
    test(`timeout during ${stage} restores retry and rejects late completion`, async () => {
      const hold = deferred();
      let signal;
      let stalled = true;
      const c = createIncidentComposer({ document: makeDoc(), requestTimeoutMs: 15,
        client: { locate: (_text, options) => {
          signal = options.signal;
          return stage === 'locate' && stalled ? hold.promise : Promise.resolve({ candidates: [MARINA] });
        } },
        createGeographicScene: (p) => stage === 'geographic-build' && stalled ? hold.promise : geographicScene(p),
        onScene: () => stage === 'render' && stalled ? hold.promise : undefined,
      });
      await c.submit('Dubai Marina');
      assert.equal(c.state.busy, false);
      assert.equal(c.element.getAttribute('data-state'), 'error');
      assert.match(c.element.text(), /timed out.*Retry or edit the AOI/i);
      assert.equal(signal.aborted, true);
      assert.equal(button(c, 'retry').hidden, false);
      assert.equal(button(c, 'retry').disabled, false);
      assertNoPlay(c);
      const message = c.element.text();
      hold.resolve(stage === 'locate' ? { candidates: [MARINA] } : geographicScene({ candidate: MARINA }));
      await tick(30);
      assert.equal(c.element.text(), message);
      stalled = false;
      await c.submit('Dubai Marina');
      assert.equal(c.element.getAttribute('data-state'), 'done');
      assert.equal(c.state.lastScene.anchor.name, 'Dubai Marina');
      c.destroy();
    });
  }
  test('a thrown render failure releases controls and the next request succeeds', async () => {
    let fail = true;
    const c = createIncidentComposer({ document: makeDoc(), client: { locate: async () => ({ candidates: [MARINA] }) },
      createGeographicScene: geographicScene, onScene: () => { if (fail) throw new Error('fixture render failed'); } });
    await c.submit('Dubai Marina');
    assert.equal(c.state.busy, false);
    assert.equal(c.element.getAttribute('data-state'), 'error');
    assert.match(c.element.text(), /fixture render failed/);
    assertNoPlay(c);
    fail = false;
    await c.submit('Dubai Marina');
    assert.equal(c.element.getAttribute('data-state'), 'done');
    c.destroy();
  });
});

describe('cycle 16: embedded-host feedback guarantees', () => {
  test("'hi' shows a discreet local hint instantly and calls no provider", async () => {
    const client = fakeClient({ candidates: [] });
    let unresolved = 0;
    const composer = createIncidentComposer({ document: makeDoc(), client, onUnresolved: () => { unresolved += 1; } });
    const out = await composer.submit('hi');
    assert.equal(out.plan.kind, 'hint');
    assert.equal(client.calls.length, 0);
    assert.equal(composer.element.getAttribute('data-state'), 'hint');
    assert.match(composer.element.text(), /Type a place in the UAE/);
    assert.equal(composer.state.busy, false);
    assert.equal(unresolved, 0);
  });
  test('empty submit is never silent', async () => {
    const composer = createIncidentComposer({ document: makeDoc(), client: fakeClient() });
    assert.equal(await composer.submit('   '), null);
    assert.equal(composer.element.getAttribute('data-state'), 'hint');
    assert.match(composer.element.text(), /Type a place in the UAE/);
  });
  test('a place request shows a pending spinner synchronously, before locate resolves', async () => {
    let release;
    const client = { calls: [], locate: () => new Promise((resolve) => { release = resolve; }) };
    const composer = createIncidentComposer({ document: makeDoc(), client });
    const pendingRun = composer.submit('Dubai Marina r');
    assert.equal(composer.element.getAttribute('data-state'), 'busy');
    assert.match(composer.element.text(), /Locating “Dubai Marina”…/);
    assert.equal(composer.element.find((n) => n.className === 'incident-composer__spinner').length, 1);
    release({ candidates: [] });
    await pendingRun;
  });
  test('unresolved locate fires onUnresolved so the camera leaves the boot view', async () => {
    let unresolved = null;
    const composer = createIncidentComposer({ document: makeDoc(), client: fakeClient({ candidates: [] }), onUnresolved: (info) => { unresolved = info; } });
    await composer.submit('Atlantis Lost City');
    assert.equal(unresolved?.text, 'Atlantis Lost City');
    assert.equal(composer.element.getAttribute('data-state'), 'error');
  });
  test('locate failure is a discreet retry notice; Retry resubmits the original text', async () => {
    const texts = [];
    let unresolved = 0;
    const client = { async locate(text) { texts.push(text); if (texts.length === 1) throw new Error('HTTP 503 upstream'); return { candidates: [] }; } };
    const composer = createIncidentComposer({ document: makeDoc(), client, onUnresolved: () => { unresolved += 1; } });
    await composer.submit('Dubai Marina');
    const notice = composer.element.find((n) => n.dataset?.kind === 'retry-notice');
    assert.equal(notice.length, 1);
    assert.match(composer.element.text(), /Press Retry to resend “Dubai Marina”/);
    assert.equal(unresolved, 1);
    const retry = composer.element.find((n) => n.id === 'incident-composer-retry')[0];
    assert.equal(retry.hidden, false);
    composer.input.value = 'something else';
    retry.dispatch('click');
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(texts, ['Dubai Marina', 'Dubai Marina']);
  });
});


test('production BUILD constructs a geographic scene for research text and carries recording scope', async () => {
  const client = fakeClient({ candidates: [BURJ] }), delivered = [];
  const composer = createIncidentComposer({ document: makeDoc(), client, buildResearchScene: true,
    createGeographicScene: ({ candidate }) => ({ id: 'fixture-geographic', geographic: true, anchor: candidate }),
    onScene: async (payload) => delivered.push(payload),
  });
  await composer.submit('burj khalifa check if there is any incidents');
  assert.equal(delivered.length, 1); assert.equal(delivered[0].selectedTime.windowHours, 1);
  assert.equal(delivered[0].scene.geographic, true);
  assert.equal(client.calls.filter(([kind]) => kind === 'ingest').length, 0);
  assert.ok(composer.element.find(n => n.id === 'incident-composer-play').length);
});

import { shortPlaceLabel, STEP_STATUS_TEXT } from './ui/composer.js';
describe('cycle 22 composer status row', () => {
  test('shortPlaceLabel keeps only the first geocoder segment', () => {
    assert.equal(shortPlaceLabel('American University Of Sharjah, Bobyan Street, Sharjah, United Arab Emirates'), 'American University of Sharjah');
    assert.equal(shortPlaceLabel('Dubai Marina'), 'Dubai Marina');
    assert.equal(shortPlaceLabel(''), '');
  });
  test('one inline status label per step', () => {
    assert.deepEqual(Object.keys(STEP_STATUS_TEXT), ['locating', 'verifying', 'building', 'searching']);
  });
  test('built scene: short place + Play in one status row, never the long "Scene generated at" sentence', async () => {
    const LONG = { ...MARINA, name: 'Dubai Marina, Marsa Dubai, Dubai, United Arab Emirates' };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient({ candidates: [LONG] }),
      createGeographicScene: async (input) => geographicScene(input),
      onScene: async () => {},
    });
    await composer.submit(MARINA_QUERY);
    const text = composer.element.text();
    assert.doesNotMatch(text, /Scene generated at/);
    const place = composer.element.find((n) => n.className === 'incident-composer__place')[0];
    assert.equal(place.textContent, 'Dubai Marina');
    assert.equal(place.title, LONG.name);
    const status = composer.element.find((n) => n.id === `${COMPOSER_ID}-status`)[0];
    assert.ok(status.find((n) => n.id === `${COMPOSER_ID}-play`).length === 1, 'Play lives in the status row');
    assert.ok(status.find((n) => n.id === `${COMPOSER_ID}-evidence-slot`).length === 1, 'evidence chip slot shares the row');
  });
});
