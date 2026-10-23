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

  test('out-of-AOI: explicit reason shown, "Add anyway (override)" offered, override ingests with override:true', async () => {
    const doc = makeDoc();
    const client = fakeClient({ candidates: [PARIS] });
    const played = [];
    const composer = createIncidentComposer({
      document: doc,
      client,
      onScene: async (p) => played.push(p),
    });
    const out = await composer.submit('bomb threat in Paris');
    assert.equal(out.plan.kind, 'out-of-aoi');
    assert.equal(out.scene, null);
    const text = composer.element.text();
    assert.match(text, /OUT_OF_AOI: nearest AOI Iran at 3200 km/);
    const override = composer.element.find(
      (n) => n.id === `${COMPOSER_ID}-override`,
    )[0];
    assert.ok(override, 'override button exists');
    assert.equal(override.textContent, 'Add anyway (override)');
    assert.equal(
      client.calls.filter((c) => c[0] === 'ingest').length,
      0,
      'rejected before ingest',
    );
    assert.equal(composer.element.getAttribute('data-state'), 'error');
    override.dispatch('click');
    await tick(20);
    const ingest = client.calls.find((c) => c[0] === 'ingest');
    assert.equal(ingest[1].override, true);
    assert.equal(played.length, 1);
    assert.equal(played[0].override, true);
    assert.equal(played[0].scene.override, true);
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
    const out = await composer.submit('x near Hodeidah');
    assert.equal(out.scene, null);
    assert.match(
      composer.element.text(),
      /OUT_OF_AOI: nearest AOI Yemen at 3 km/,
    );
  });
});
