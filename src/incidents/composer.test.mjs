import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIncidentComposer,
  COMPOSER_ID,
  COMPOSER_PLACEHOLDER,
  unresolvedPromptTokens,
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
  test('renders an editable multiline prompt with an illustrative placeholder and submit', () => {
    const doc = makeDoc();
    const composer = createIncidentComposer({
      document: doc,
      client: fakeClient(),
    });
    assert.equal(composer.element.id, COMPOSER_ID);
    assert.equal(composer.input.placeholder, COMPOSER_PLACEHOLDER);
    assert.equal(composer.input.tagName, 'TEXTAREA');
    assert.equal(composer.input.disabled, false);
    assert.equal(composer.input.rows, 2);
    assert.match(composer.input.placeholder, /Burj Khalifa/);
    assert.match(composer.input.placeholder, /\n/);
    assert.equal(
      composer.input.getAttribute('aria-keyshortcuts'),
      'Control+Enter Meta+Enter',
    );
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

  test('missing geographic callback retains the legacy standalone geographic builder', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    const composer = createIncidentComposer({ document: makeDoc(), client });
    const result = await composer.submit(MARINA_QUERY);
    assert.equal(result.scene.geographic, true);
    assert.equal(result.scene.anchor.name, 'Dubai Marina');
    assert.equal(
      client.calls.filter(([method]) => method === 'ingest').length,
      0,
    );
    assert.ok(button(composer, 'play'));
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
      assert.equal(
        composer.state.text,
        'check for incidents near Burj Khalifa',
      );
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
  const ABU_DHABI = {
    ...MARINA,
    name: 'Abu Dhabi',
    lat: 24.4539,
    lon: 54.3773,
  };
  test('bare locations build geographic scenes despite a legacy locate search intent', async () => {
    const rendered = [];
    const client = {
      locate: async (text) => ({
        extraction: {
          originalText: text,
          place: text,
          intent: 'incident_search',
        },
        candidates: [text === 'Dubai Marina' ? MARINA : ABU_DHABI],
      }),
      search: () =>
        assert.fail('BUILD SCENE must not run research for a bare AOI'),
      ingest: () =>
        assert.fail('a geographic plan must not fabricate an incident'),
    };
    const c = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: geographicScene,
      onScene: (p) => rendered.push(p.scene),
    });
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
    const c = createIncidentComposer({
      document: makeDoc(),
      client: {
        locate: async () => ({ candidates: [MARINA] }),
        search: async () => {
          searches += 1;
          return scopedResponse();
        },
        ingest: () => assert.fail('research must not ingest'),
      },
      createGeographicScene: () => assert.fail('research must not build'),
    });
    await c.submit('check for incidents near Dubai Marina');
    assert.equal(searches, 1);
    assert.equal(c.state.busy, false);
    assertNoPlay(c);
    c.destroy();
  });
  test('edited native form submission supersedes pending work; duplicate text coalesces', async () => {
    const old = deferred(),
      next = deferred();
    const calls = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: {
        locate: (text, { signal }) => {
          calls.push({ text, signal });
          return calls.length === 1 ? old.promise : next.promise;
        },
      },
      createGeographicScene: geographicScene,
    });
    c.input.value = 'Dubai Marina';
    c.element.dispatch('submit');
    await tick();
    assert.equal(
      button(c, 'submit').disabled,
      false,
      'edited rebuild remains clickable',
    );
    c.element.dispatch('submit');
    assert.equal(
      calls.length,
      1,
      'same text does not duplicate a pending request',
    );
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
      const c = createIncidentComposer({
        document: makeDoc(),
        requestTimeoutMs: 15,
        client: {
          locate: (_text, options) => {
            signal = options.signal;
            return stage === 'locate' && stalled
              ? hold.promise
              : Promise.resolve({ candidates: [MARINA] });
          },
        },
        createGeographicScene: (p) =>
          stage === 'geographic-build' && stalled
            ? hold.promise
            : geographicScene(p),
        onScene: () =>
          stage === 'render' && stalled ? hold.promise : undefined,
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
      hold.resolve(
        stage === 'locate'
          ? { candidates: [MARINA] }
          : geographicScene({ candidate: MARINA }),
      );
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
    const c = createIncidentComposer({
      document: makeDoc(),
      client: { locate: async () => ({ candidates: [MARINA] }) },
      createGeographicScene: geographicScene,
      onScene: () => {
        if (fail) throw new Error('fixture render failed');
      },
    });
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
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      onUnresolved: () => {
        unresolved += 1;
      },
    });
    const out = await composer.submit('hi');
    assert.equal(out.plan.kind, 'hint');
    assert.equal(client.calls.length, 0);
    assert.equal(composer.element.getAttribute('data-state'), 'hint');
    assert.match(composer.element.text(), /Type a place in the UAE/);
    assert.equal(composer.state.busy, false);
    assert.equal(unresolved, 0);
  });
  test('empty submit is never silent', async () => {
    const composer = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient(),
    });
    assert.equal(await composer.submit('   '), null);
    assert.equal(composer.element.getAttribute('data-state'), 'hint');
    assert.match(composer.element.text(), /Type a place in the UAE/);
  });
  test('a place request shows a pending spinner synchronously, before locate resolves', async () => {
    let release;
    const client = {
      calls: [],
      locate: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const composer = createIncidentComposer({ document: makeDoc(), client });
    const pendingRun = composer.submit('Dubai Marina r');
    assert.equal(composer.element.getAttribute('data-state'), 'busy');
    assert.match(composer.element.text(), /Locating “Dubai Marina”…/);
    assert.equal(
      composer.element.find((n) => n.className === 'incident-composer__spinner')
        .length,
      1,
    );
    release({ candidates: [] });
    await pendingRun;
  });
  test('unresolved locate fires onUnresolved so the camera leaves the boot view', async () => {
    let unresolved = null;
    const composer = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient({ candidates: [] }),
      onUnresolved: (info) => {
        unresolved = info;
      },
    });
    await composer.submit('Atlantis Lost City');
    assert.equal(unresolved?.text, 'Atlantis Lost City');
    assert.equal(composer.element.getAttribute('data-state'), 'error');
  });
  test('locate failure is a discreet retry notice; Retry resubmits the original text', async () => {
    const texts = [];
    let unresolved = 0;
    const client = {
      async locate(text) {
        texts.push(text);
        if (texts.length === 1) throw new Error('HTTP 503 upstream');
        return { candidates: [] };
      },
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      onUnresolved: () => {
        unresolved += 1;
      },
    });
    await composer.submit('Dubai Marina');
    const notice = composer.element.find(
      (n) => n.dataset?.kind === 'retry-notice',
    );
    assert.equal(notice.length, 1);
    assert.match(
      composer.element.text(),
      /Press Retry to resend “Dubai Marina”/,
    );
    assert.equal(unresolved, 1);
    const retry = composer.element.find(
      (n) => n.id === 'incident-composer-retry',
    )[0];
    assert.equal(retry.hidden, false);
    composer.input.value = 'something else';
    retry.dispatch('click');
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(texts, ['Dubai Marina', 'Dubai Marina']);
  });
});

test('production BUILD constructs a geographic scene for research text and carries recording scope', async () => {
  const client = fakeClient({ candidates: [BURJ] }),
    delivered = [];
  const composer = createIncidentComposer({
    document: makeDoc(),
    client,
    buildResearchScene: true,
    createGeographicScene: ({ candidate }) => ({
      id: 'fixture-geographic',
      geographic: true,
      anchor: candidate,
    }),
    onScene: async (payload) => delivered.push(payload),
  });
  await composer.submit('burj khalifa check if there is any incidents');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].selectedTime.windowHours, 1);
  assert.equal(delivered[0].scene.geographic, true);
  assert.equal(client.calls.filter(([kind]) => kind === 'ingest').length, 0);
  assert.ok(
    composer.element.find((n) => n.id === 'incident-composer-play').length,
  );
});

import { shortPlaceLabel, STEP_STATUS_TEXT } from './ui/composer.js';
describe('cycle 22 composer status row', () => {
  test('shortPlaceLabel keeps only the first geocoder segment', () => {
    assert.equal(
      shortPlaceLabel(
        'American University Of Sharjah, Bobyan Street, Sharjah, United Arab Emirates',
      ),
      'American University of Sharjah',
    );
    assert.equal(shortPlaceLabel('Dubai Marina'), 'Dubai Marina');
    assert.equal(shortPlaceLabel(''), '');
  });
  test('one inline status label per step', () => {
    assert.deepEqual(Object.keys(STEP_STATUS_TEXT), [
      'locating',
      'verifying',
      'building',
      'searching',
    ]);
  });
  test('built scene: short place + Play in one status row, never the long "Scene generated at" sentence', async () => {
    const LONG = {
      ...MARINA,
      name: 'Dubai Marina, Marsa Dubai, Dubai, United Arab Emirates',
    };
    const composer = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient({ candidates: [LONG] }),
      createGeographicScene: async (input) => geographicScene(input),
      onScene: async () => {},
    });
    await composer.submit(MARINA_QUERY);
    const text = composer.element.text();
    assert.doesNotMatch(text, /Scene generated at/);
    const place = composer.element.find(
      (n) => n.className === 'incident-composer__place',
    )[0];
    assert.equal(place.textContent, 'Dubai Marina');
    assert.equal(place.title, LONG.name);
    const status = composer.element.find(
      (n) => n.id === `${COMPOSER_ID}-status`,
    )[0];
    assert.ok(
      status.find((n) => n.id === `${COMPOSER_ID}-play`).length === 1,
      'Play lives in the status row',
    );
    assert.ok(
      status.find((n) => n.id === `${COMPOSER_ID}-evidence-slot`).length === 1,
      'evidence chip slot shares the row',
    );
  });
});

describe('cycle 23: composer Play is a real transport control', () => {
  test('Play → Pause → Resume follows the director clock and never no-ops', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    client.search = async () => assert.fail('no incident search');
    const played = [];
    const controls = [];
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: async (input) => geographicScene(input),
      onScene: async (payload) => {
        played.push(payload);
        return payload.play ? { started: true } : undefined;
      },
      onPlaybackControl: (c) => controls.push(c.action),
    });
    await composer.submit(MARINA_QUERY);
    const play = () => button(composer, 'play');
    assert.equal(play().dataset.playback, 'idle');
    assert.equal(play().getAttribute('aria-label'), 'Play scene: Dubai Marina');
    play().dispatch('click');
    await tick(20);
    assert.equal(played.length, 2, 'first press plays the built scene');
    composer.setPlaybackState('playing');
    assert.equal(play().dataset.playback, 'playing');
    assert.match(play().getAttribute('aria-label'), /^Pause scene/);
    play().dispatch('click');
    await tick(5);
    assert.deepEqual(
      controls,
      ['pause'],
      'second press pauses instead of a rejected replay',
    );
    composer.setPlaybackState('paused');
    assert.match(play().getAttribute('aria-label'), /^Resume scene/);
    play().dispatch('click');
    await tick(5);
    assert.deepEqual(controls, ['pause', 'resume']);
    assert.equal(played.length, 2, 'pause/resume never rebuilds or replays');
  });

  test('a refused start surfaces an error instead of a silent "Scene ready"', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    client.search = async () => assert.fail('no incident search');
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: async (input) => geographicScene(input),
      onScene: async (payload) =>
        payload.play
          ? { started: false, reason: 'camera-unavailable' }
          : undefined,
    });
    await composer.submit(MARINA_QUERY);
    button(composer, 'play').dispatch('click');
    await tick(20);
    assert.equal(composer.element.getAttribute('data-state'), 'error');
  });
});

// Lifecycle fixtures are deterministic; these assertions do not claim live-provider evidence.
function field(composer, id) {
  const found = composer.element.find(
    (n) => n.id === `incident-composer-${id}`,
  );
  assert.equal(found.length, 1);
  return found[0];
}
function typePrompt(composer, text) {
  composer.input.value = text;
  composer.input.dispatch('input');
}

describe('prompt input lifecycle', () => {
  test('typing and long pauses never build; only explicit submission initiates the initial scene', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ candidates: [BURJ] });
    const delivered = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene: geographicScene,
      onScene: (p) => delivered.push(p),
    });
    typePrompt(c, 'Burj Khalifa');
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    assert.equal(c.state.busy, false);
    assert.equal(c.element.dataset.submissionMode, 'explicit');
    assert.equal(Number(c.element.dataset.promptRevision), 1);
    assert.equal(client.calls.length, 0);
    t.mock.timers.tick(299);
    await tick();
    assert.equal(client.calls.length, 0);
    t.mock.timers.tick(5001);
    await tick(40);
    assert.equal(client.calls.length, 0, 'no timer may initiate generation');
    await c.submit(c.input.value);
    assert.deepEqual(
      client.calls.map(([kind]) => kind),
      ['locate'],
    );
    assert.equal(delivered.length, 1);
    assert.equal(c.state.lastScene.anchor.name, 'Burj Khalifa');
    assert.equal(c.element.getAttribute('data-state'), 'done');
    assert.equal(c.input.value, 'Burj Khalifa');
    assert.equal(delivered[0].revision, c.state.promptRevision);
    assert.equal(delivered[0].signal.aborted, false);
    c.destroy();
  });

  test('an input event immediately aborts a pending locate, before debounce, and discards its late result', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const old = deferred(),
      calls = [],
      built = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: {
        locate(text, options) {
          calls.push({ text, ...options });
          return calls.length === 1
            ? old.promise
            : Promise.resolve({ candidates: [BURJ] });
        },
      },
      createGeographicScene(p) {
        built.push(p);
        return geographicScene(p);
      },
    });
    const first = c.submit('Dubai Marina');
    const previous = c.state.promptRevision;
    typePrompt(c, 'Burj Khalifa');
    assert.equal(
      calls[0].signal.aborted,
      true,
      'abort occurs in input handler, not at timer expiry',
    );
    assert.ok(c.state.promptRevision > previous);
    assert.equal(calls.length, 1);
    old.resolve({ candidates: [MARINA] });
    assert.equal(await first, null);
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    assert.deepEqual(c.state.candidates, []);
    assert.equal(built.length, 0);
    t.mock.timers.tick(3000);
    await tick(40);
    assert.equal(calls.length, 1, 'edited text has no automatic request');
    await c.submit(c.input.value);
    assert.equal(calls.length, 2);
    assert.equal(built.length, 1);
    assert.equal(c.state.lastScene.anchor.name, 'Burj Khalifa');
    c.destroy();
  });

  test('draft bursts queue no work; cancel/retry are explicit actions on a submission', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ candidates: [MARINA] });
    const c = createIncidentComposer({ document: makeDoc(), client });
    typePrompt(c, 'Burj');
    t.mock.timers.tick(200);
    typePrompt(c, 'Dubai Marina');
    t.mock.timers.tick(299);
    await tick();
    assert.equal(client.calls.length, 0);
    assert.equal(c.cancel(), false, 'an idle draft is not a queued request');
    t.mock.timers.tick(1000);
    await tick();
    assert.equal(client.calls.length, 0);
    const first = c.submit(c.input.value);
    assert.equal(c.cancel(), true);
    assert.equal(await first, null);
    assert.equal(c.element.getAttribute('data-state'), 'cancelled');
    button(c, 'retry').dispatch('click');
    await tick(40);
    assert.equal(client.calls[0][1], 'Dubai Marina');
    assert.equal(client.calls.length, 2);
    assert.equal(c.element.getAttribute('data-state'), 'done');
    c.destroy();
  });

  for (const modifier of ['ctrlKey', 'metaKey']) {
    test(`Enter remains a newline; ${modifier}+Enter flushes one multiline submission`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const client = fakeClient({ candidates: [BURJ] });
      const c = createIncidentComposer({ document: makeDoc(), client });
      const text =
        'Create a slow aerial scene around Burj Khalifa.\nShow the surrounding skyline.';
      typePrompt(c, text);
      let prevented = 0;
      c.input.dispatch('keydown', {
        key: 'Enter',
        preventDefault() {
          prevented++;
        },
      });
      assert.equal(prevented, 0);
      assert.equal(client.calls.length, 0);
      c.input.dispatch('keydown', {
        key: 'Enter',
        [modifier]: true,
        preventDefault() {
          prevented++;
        },
      });
      await tick(40);
      assert.equal(prevented, 1);
      assert.equal(client.calls[0][1], text);
      assert.equal(c.input.value, text);
      t.mock.timers.tick(500);
      await tick();
      assert.equal(
        client.calls.length,
        1,
        'keyboard submission was the only admission; no timer duplicates it',
      );
      c.destroy();
    });
  }

  test('unresolved template slots never reach a provider through typing or explicit submit', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient();
    const c = createIncidentComposer({ document: makeDoc(), client });
    for (const slot of ['{{location}}', '[LOCATION]', '<location>']) {
      const text = `Create an aerial scene around ${slot}`;
      assert.deepEqual(unresolvedPromptTokens(text), [slot]);
      typePrompt(c, text);
      assert.equal(c.element.getAttribute('data-state'), 'unresolved');
      assert.match(c.element.text(), /Replace the prompt placeholders/);
      assert.equal(c.state.busy, false);
      t.mock.timers.tick(400);
      const result = await c.submit(text);
      assert.equal(result.plan.kind, 'unresolved');
      assert.deepEqual(result.plan.placeholders, [slot]);
    }
    assert.equal(client.calls.length, 0);
    assertNoPlay(c);
    c.destroy();
  });

  test('clearing the prompt or replacing it with a greeting invalidates old work without another request', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const wait = deferred();
    const c = createIncidentComposer({
      document: makeDoc(),
      client: { locate: () => wait.promise },
    });
    const first = c.submit('Dubai Marina');
    const signal = c.state.abort.signal;
    typePrompt(c, '');
    assert.equal(signal.aborted, true);
    assert.equal(c.state.busy, false);
    assert.equal(c.element.getAttribute('data-state'), 'hint');
    typePrompt(c, 'hi');
    assert.equal(c.element.getAttribute('data-state'), 'hint');
    t.mock.timers.tick(500);
    wait.resolve({ candidates: [MARINA] });
    assert.equal(await first, null);
    assertNoPlay(c);
    c.destroy();
  });

  test('restorePrompt cancels pending work and restores multiline text and scope without generating', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ candidates: [BURJ] });
    const c = createIncidentComposer({ document: makeDoc(), client });
    typePrompt(c, 'Burj Khalifa');
    const revision = c.state.promptRevision;
    const text = 'Dubai Marina\nA slow waterfront orbit';
    c.restorePrompt(text, {
      selectedTime: { windowHours: 6, timeMode: 'recent' },
    });
    t.mock.timers.tick(1000);
    await tick();
    assert.equal(c.input.value, text);
    assert.equal(field(c, 'window').value, '6');
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    assert.ok(c.state.promptRevision > revision);
    assert.equal(client.calls.length, 0);
    c.destroy();
  });

  test('destroy clears the debounce as well as aborting requests', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient();
    const c = createIncidentComposer({ document: makeDoc(), client });
    typePrompt(c, 'Burj Khalifa');
    c.destroy();
    t.mock.timers.tick(1000);
    await tick();
    assert.equal(client.calls.length, 0);
    assert.equal(await c.submit('Dubai Marina'), null);
  });
});

describe('async adapter ownership and recording-window isolation', () => {
  test('all scene adapters get signal/revision and an injected planner rejection never uses the legacy fallback', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    let request;
    const c = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene(p) {
        request = p;
        return Promise.reject(new Error('validated plan rejected'));
      },
      onScene() {
        assert.fail('rejected planner cannot play a fixed scene');
      },
    });
    assert.equal(await c.submit(MARINA_QUERY), null);
    assert.equal(request.revision, c.state.promptRevision);
    assert.equal(request.generation, c.state.generation);
    assert.equal(request.signal, c.state.abort.signal);
    assert.match(c.element.text(), /validated plan rejected/);
    assert.equal(c.element.getAttribute('data-state'), 'error');
    assertNoPlay(c);
    c.destroy();
  });

  test('stale onLocated completion cannot start search after a newer input', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const gate = deferred(),
      calls = [],
      client = fakeClient({ candidates: [MARINA] });
    client.search = () => assert.fail('stale onLocated must not start search');
    const c = createIncidentComposer({
      document: makeDoc(),
      client,
      onLocated(p) {
        calls.push(p);
        return gate.promise;
      },
    });
    const first = c.submit('check for incidents near Dubai Marina');
    await tick(20);
    assert.equal(calls.length, 1);
    typePrompt(c, 'Burj Khalifa');
    assert.equal(calls[0].signal.aborted, true);
    assert.ok(calls[0].revision < c.state.promptRevision);
    gate.resolve();
    assert.equal(await first, null);
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    c.destroy();
  });

  for (const stalled of ['planner', 'apply', 'play']) {
    test(`a stale ${stalled} callback finishing out of order cannot replace the newer scene`, async () => {
      const gate = deferred(),
        captured = [];
      const client = {
        locate: async (text) => ({
          candidates: [text === 'Dubai Marina' ? MARINA : BURJ],
        }),
      };
      const c = createIncidentComposer({
        document: makeDoc(),
        client,
        createGeographicScene(p) {
          if (stalled === 'planner' && p.text === 'Dubai Marina') {
            captured.push(p);
            return gate.promise;
          }
          return geographicScene(p);
        },
        onScene(p) {
          if (
            p.text === 'Dubai Marina' &&
            ((stalled === 'apply' && !p.play) || (stalled === 'play' && p.play))
          ) {
            captured.push(p);
            return gate.promise;
          }
        },
      });
      let first = c.submit('Dubai Marina');
      if (stalled === 'play') {
        await first;
        button(c, 'play').dispatch('click');
      }
      await tick(20);
      assert.equal(captured.length, 1);
      const next = await c.submit('Burj Khalifa');
      assert.equal(captured[0].signal.aborted, true);
      assert.ok(captured[0].revision < c.state.promptRevision);
      gate.resolve(
        stalled === 'planner'
          ? geographicScene({ candidate: MARINA })
          : { started: true },
      );
      if (stalled !== 'play') assert.equal(await first, null);
      await tick(20);
      assert.equal(c.state.lastScene, next.scene);
      assert.equal(c.element.getAttribute('data-state'), 'done');
      assert.match(
        button(c, 'play').getAttribute('aria-label'),
        /Burj Khalifa/,
      );
      c.destroy();
    });
  }

  test('hours without a scene do not locate/build; existing-scene updates use only the injected callback', async () => {
    const client = fakeClient({ candidates: [BURJ] }),
      updates = [],
      built = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client,
      createGeographicScene(p) {
        built.push(p);
        return geographicScene(p);
      },
      onTimeChange(p) {
        updates.push(p);
      },
    });
    c.input.value = 'Burj Khalifa';
    field(c, 'window').value = '6';
    field(c, 'window').dispatch('change');
    await tick(20);
    assert.equal(client.calls.length, 0);
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    const out = await c.submit(c.input.value);
    field(c, 'window').value = '24';
    field(c, 'window').dispatch('change');
    await tick(40);
    assert.equal(client.calls.length, 1);
    assert.equal(built.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].scene, out.scene);
    assert.equal(updates[0].selectedTime.windowHours, 24);
    assert.equal(updates[0].text, 'Burj Khalifa');
    assert.equal(updates[0].signal.aborted, false);
    assert.equal(updates[0].revision, c.state.promptRevision);
    assert.equal(c.state.lastScene, out.scene);
    assert.equal(c.state.extraction.windowHours, 24);
    assert.equal(c.element.getAttribute('data-state'), 'done');
    c.destroy();
  });

  test('historical ranges validate locally and preserve scene identity', async () => {
    const updates = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient({ candidates: [BURJ] }),
      onTimeChange: (p) => updates.push(p),
    });
    const out = await c.submit('Burj Khalifa');
    field(c, 'window').value = 'historical';
    field(c, 'window').dispatch('change');
    await tick();
    assert.equal(updates.length, 0);
    assert.equal(c.element.getAttribute('data-state'), 'error');
    field(c, 'from').value = '2020-01-01T00:00';
    field(c, 'to').value = '2020-01-02T00:00';
    field(c, 'to').dispatch('change');
    await tick(40);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].selectedTime, {
      timeMode: 'historical',
      windowHours: 1,
      windowStart: '2020-01-01T00:00:00Z',
      windowEnd: '2020-01-02T00:00:00Z',
    });
    assert.equal(c.state.lastScene, out.scene);
    c.destroy();
  });

  test('time updates have independent abort ownership and stale completions cannot repaint a newer prompt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const waits = [deferred(), deferred()],
      updates = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: fakeClient({ candidates: [BURJ] }),
      onTimeChange(p) {
        const index = updates.length;
        updates.push(p);
        return waits[index].promise;
      },
    });
    await c.submit('Burj Khalifa');
    field(c, 'window').value = '6';
    field(c, 'window').dispatch('change');
    field(c, 'window').value = '24';
    field(c, 'window').dispatch('change');
    assert.equal(updates[0].signal.aborted, true);
    assert.equal(updates[1].signal.aborted, false);
    waits[1].resolve();
    await tick(40);
    assert.equal(c.state.extraction.windowHours, 24);
    typePrompt(c, 'Dubai Marina');
    assert.equal(updates[1].signal.aborted, true);
    waits[0].resolve();
    await tick(40);
    assert.equal(c.element.getAttribute('data-state'), 'idle');
    assert.equal(c.state.lastScene, null);
    assert.equal(c.state.text, 'Dubai Marina');
    c.destroy();
  });

  test('changing hours while drafting never starts construction, including after the former debounce', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ candidates: [BURJ] });
    const c = createIncidentComposer({ document: makeDoc(), client });
    typePrompt(c, 'Burj Khalifa');
    field(c, 'window').value = '6';
    field(c, 'window').dispatch('change');
    assert.equal(client.calls.length, 0);
    t.mock.timers.tick(3000);
    await tick(40);
    assert.equal(client.calls.length, 0);
    await c.submit(c.input.value);
    assert.equal(client.calls.length, 1);
    assert.equal(c.state.extraction.windowHours, 6);
    c.destroy();
  });
});

// Current explicit-only contract. All providers below are mocks, never live proof.
describe('explicit-only admission regression battery', () => {
  test('slow typing, paste, IME and modified/repeated Enter never initiate a request', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ candidates: [BURJ] });
    const c = createIncidentComposer({ document: makeDoc(), client });
    for (const value of [
      'B',
      'Burj',
      'Burj Khalifa',
      'Burj Khalifa\nThree people',
    ]) {
      typePrompt(c, value);
      t.mock.timers.tick(650);
      await tick();
    }
    c.input.dispatch('paste');
    t.mock.timers.tick(1000);
    await tick();
    c.input.dispatch('compositionstart');
    c.element.dispatch('submit');
    c.input.dispatch('keydown', {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    c.input.dispatch('keydown', { key: 'Enter', ctrlKey: true, keyCode: 229 });
    c.input.dispatch('compositionend');
    for (const extra of [
      { shiftKey: true },
      { ctrlKey: true, altKey: true },
      { metaKey: true, shiftKey: true },
      { ctrlKey: true, repeat: true },
    ])
      c.input.dispatch('keydown', { key: 'Enter', ...extra });
    t.mock.timers.tick(5000);
    await tick(20);
    assert.equal(client.calls.length, 0);
    assert.equal(c.input.value, 'Burj Khalifa\nThree people');
    c.input.dispatch('keydown', { key: 'Enter', ctrlKey: true });
    await tick(40);
    assert.equal(client.calls.length, 1);
    c.destroy();
  });
  test('overlapping button/form/keyboard actions synchronously admit exactly one request', async () => {
    const wait = deferred();
    const calls = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: {
        locate(text, options) {
          calls.push({ text, ...options });
          return wait.promise;
        },
      },
    });
    c.input.value = 'Burj Khalifa';
    c.element.dispatch('submit');
    c.element.dispatch('submit');
    c.input.dispatch('keydown', { key: 'Enter', metaKey: true });
    assert.equal(calls.length, 1);
    wait.resolve({ candidates: [BURJ] });
    await tick(40);
    assert.equal(c.state.busy, false);
    c.destroy();
  });
  test('cancel, late completion and retry retain an immutable prompt/time snapshot and the newer draft', async () => {
    const wait = deferred();
    const calls = [];
    const applied = [];
    const c = createIncidentComposer({
      document: makeDoc(),
      client: {
        locate(text, options) {
          calls.push({ text, ...options });
          return calls.length === 1
            ? wait.promise
            : Promise.resolve({ candidates: [BURJ] });
        },
      },
      onScene: (p) => applied.push(p),
    });
    const original = 'Burj Khalifa\nOriginal submitted draft';
    c.input.value = original;
    field(c, 'window').value = '6';
    const first = c.submit(original);
    assert.equal(c.cancel(), true);
    assert.equal(c.input.value, original);
    typePrompt(c, 'Dubai Marina\nA newer unsent draft');
    field(c, 'window').value = '24';
    assert.equal(button(c, 'retry').hidden, false);
    button(c, 'retry').dispatch('click');
    await tick(40);
    assert.equal(calls[1].text, original);
    assert.equal(applied[0].selectedTime.windowHours, 6);
    assert.equal(c.input.value, 'Dubai Marina\nA newer unsent draft');
    wait.resolve({ candidates: [MARINA] });
    assert.equal(await first, null);
    await tick();
    assert.equal(applied.length, 1);
    assert.equal(c.state.lastScene.anchor.name, BURJ.name);
    c.destroy();
  });
  test('voice/programmatic origins cannot submit or overwrite a typed draft', async () => {
    const doc = makeDoc();
    const client = fakeClient();
    const c = createIncidentComposer({ document: doc, client });
    c.input.value = 'My typed draft';
    await c.submit('Voice replacement', {
      origin: 'voice',
      intentionalVoice: true,
    });
    await c.submit('Programmatic replacement', { origin: 'programmatic' });
    assert.equal(c.input.value, 'My typed draft');
    assert.equal(client.calls.length, 0);
    c.input.value = '';
    doc.activeElement = null;
    await c.submit('Burj Khalifa\nVoice draft', { origin: 'voice' });
    assert.equal(c.input.value, '');
    await c.submit('Burj Khalifa\nVoice draft', {
      origin: 'voice',
      intentionalVoice: true,
    });
    assert.equal(c.input.value, 'Burj Khalifa\nVoice draft');
    assert.equal(client.calls.length, 0);
    c.destroy();
  });
});

describe('research-first structured planning (any place prompt always builds)', () => {
  const KANES = "Kane's Boxing Gym Abu Dhabi";
  const resolvedScene = (input) => ({
    id: `scene-${input.candidate.name}`,
    geographic: true,
    title: 'Illustrative scene',
    anchor: {
      name: "Kane's Boxing Academy — AD City",
      lat: 24.485,
      lon: 54.3586,
    },
    locationResolution: {
      approximate: true,
      precision: 'address',
      confidence: 0.78,
    },
    keyframes: [
      { lat: 24.485, lon: 54.3586, zoom: 14, bearing: 0, pitch: -50, time: 0 },
    ],
  });
  for (const [label, locate] of [
    [
      'unverified model-extracted candidate',
      async () => ({
        status: 'resolved',
        candidates: [
          {
            name: "Kane's Boxing Gym, Abu Dhabi",
            lat: 24.4539,
            lon: 54.3773,
            confidence: 0.4,
            source: 'ondemand-entity-extraction',
            verified: false,
            aoi_membership: { inside: true, aoi_ids: ['uae-scene-bbox'] },
          },
        ],
      }),
    ],
    [
      'ambiguous unverified candidates (no picker)',
      async () => ({
        status: 'resolved',
        candidates: [
          {
            name: 'Abu Dhabi',
            lat: 24.454,
            lon: 54.377,
            confidence: 0.6,
            source: 'ondemand-entity-extraction',
            verified: false,
            aoi_membership: { inside: true, aoi_ids: [] },
          },
          {
            name: 'Abu Dhabi Emirate',
            lat: 24.299,
            lon: 54.697,
            confidence: 0.2,
            source: 'ondemand-entity-extraction',
            verified: false,
            aoi_membership: { inside: true, aoi_ids: [] },
          },
        ],
      }),
    ],
    ['empty locate result', async () => ({ status: 'empty', candidates: [] })],
    [
      'locate transport failure',
      async () => {
        throw new Error('HTTP 502');
      },
    ],
  ]) {
    test(`${label} → hint sent to the planner and the scene builds`, async () => {
      const client = fakeClient();
      client.locate = locate;
      const built = [];
      const played = [];
      const composer = createIncidentComposer({
        document: makeDoc(),
        client,
        structuredPlanning: true,
        buildResearchScene: true,
        createGeographicScene: async (input) => {
          built.push(input);
          return resolvedScene(input);
        },
        onScene: async (payload) => played.push(payload),
      });
      const result = await composer.submit(KANES);
      assert.equal(built.length, 1, 'planner invoked exactly once');
      assert.equal(
        built[0].candidate.verified,
        false,
        'hint is never upgraded to verified',
      );
      assert.equal(built[0].candidate.hintOnly, true);
      assert.equal(result.plan.kind, 'single');
      assert.equal(result.plan.researchFirst, true);
      assert.equal(composer.element.getAttribute('data-state'), 'done');
      assert.equal(played.length, 1);
      assert.equal(
        played[0].candidate.name,
        "Kane's Boxing Academy — AD City",
        'resolved anchor is displayed',
      );
      assert.equal(played[0].candidate.approximate, true);
      assert.doesNotMatch(
        composer.element.text(),
        /verified, attributed geocoder candidate is required/,
      );
    });
  }
  test('a verified geocoder candidate is still passed through unchanged', async () => {
    const client = fakeClient({ candidates: [MARINA] });
    const built = [];
    const composer = createIncidentComposer({
      document: makeDoc(),
      client,
      structuredPlanning: true,
      createGeographicScene: async (input) => {
        built.push(input);
        return geographicScene(input);
      },
      onScene: async () => {},
    });
    await composer.submit(MARINA_QUERY);
    assert.equal(built[0].candidate, MARINA);
  });
});
