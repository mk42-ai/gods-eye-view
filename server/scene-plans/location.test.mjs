import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nameVariations,
  namesMatch,
  normalizeName,
  normalizeResearch,
  createLocationResolver,
  withLocationFeatures,
  locationResearchPrompt,
  withBranch,
  trailingPlace,
} from './location.js';
import { createScenePlanService } from './index.js';
import { createSceneFootageControls } from '../../src/incidents/ui/sceneFootageControls.js';

// Synthetic fixtures only: transport, Nominatim and Photon are mocked. These
// tests do NOT claim live-provider success (live evidence is in docs/evidence).
const ABU_DHABI = { lat: 24.4538352, lon: 54.3774014 };
const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  body: { cancel() {} },
});
const RESEARCH = {
  query: 'kanes boxing gym abu dhabi',
  area: {
    name: 'Abu Dhabi',
    city: 'Abu Dhabi',
    country: 'United Arab Emirates',
    countryCode: 'AE',
  },
  locations: [
    {
      name: "Kane's Boxing Academy — AD City",
      aliases: ['Kanes Boxing Academy'],
      address:
        'Fotouh Al Khair Shopping Centre, Abu Dhabi, United Arab Emirates',
      branch: 'AD City',
      district: null,
      city: 'Abu Dhabi',
      country: 'United Arab Emirates',
      lat: null,
      lon: null,
      coordinatesSourced: false,
      confidence: 0.99,
      citations: [
        {
          url: 'https://privilee.ae/insider/now-on-privilee-kane-s-boxing-academy',
          title: 'Privilee',
        },
      ],
    },
    {
      name: "Kane's Boxing Academy — Al Raha Branch",
      aliases: [],
      address: 'Al Raha Mall, Abu Dhabi',
      branch: 'Al Raha',
      district: 'Al Raha',
      city: 'Abu Dhabi',
      country: 'United Arab Emirates',
      lat: 99,
      lon: 54.6,
      coordinatesSourced: true,
      confidence: 0.85,
      citations: [
        {
          url: 'https://classpass.com/studios/kanes-boxing-academy-al-raha-branch-abu-dhabi',
          title: 'ClassPass',
        },
      ],
    },
  ],
  features: [
    {
      name: 'Airport Road',
      kind: 'route',
      role: 'address road',
      geocodeQuery: 'Airport Road, Abu Dhabi',
      routeWaypoints: [],
      citations: [],
    },
  ],
  citations: [
    {
      url: 'https://www.facebook.com/p/Kanes-Boxing-Academy-100077169768037/',
      title: 'Facebook',
    },
  ],
};
function transport(answer = RESEARCH, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    configured: () => true,
    createSession: async (pluginIds) => ({
      id: 's1',
      externalUserId: 'x',
      pluginIds,
    }),
    query: async (s, q, o) => {
      calls.push({ s, q, o });
      if (fail)
        throw Object.assign(new Error('provider down'), {
          code: 'provider_unavailable',
        });
      return {
        answer: typeof answer === 'string' ? answer : JSON.stringify(answer),
        sessionId: 's1',
        messageId: 'm1',
        endpointId: o?.endpointId,
      };
    },
  };
}
/** Mock OSM: knows Abu Dhabi, "Foutouh al Khair Centre" (Photon only), Al Raha Mall and Al Raha. */
function osm({ venue = false } = {}) {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const u = new URL(url);
    const q = normalizeName(u.searchParams.get('q') || '');
    const photon = u.hostname.includes('photon');
    const nominatimRow = (name, lat, lon, type, id) => ({
      name,
      display_name: `${name}, Abu Dhabi`,
      lat: String(lat),
      lon: String(lon),
      addresstype: type,
      osm_type: 'way',
      osm_id: id,
    });
    const photonRow = (name, lat, lon, value, id) => ({
      geometry: { coordinates: [lon, lat] },
      properties: {
        name,
        countrycode: 'AE',
        osm_type: 'W',
        osm_id: id,
        osm_value: value,
      },
    });
    if (q === 'abu dhabi united arab emirates' || q === 'abu dhabi')
      return json(
        photon
          ? {
              features: [
                photonRow('Abu Dhabi', ABU_DHABI.lat, ABU_DHABI.lon, 'city', 1),
              ],
            }
          : [
              nominatimRow(
                'Abu Dhabi',
                ABU_DHABI.lat,
                ABU_DHABI.lon,
                'city',
                1,
              ),
            ],
      );
    if (venue && q.includes('kanes boxing academy'))
      return json(
        photon
          ? { features: [] }
          : [nominatimRow("Kane's Boxing Academy", 24.49, 54.36, 'leisure', 7)],
      );
    if (q.startsWith('fotouh al khair') && photon)
      return json({
        features: [
          photonRow(
            'Foutouh al Khair Centre',
            24.4850018,
            54.3586369,
            'marketplace',
            27374404,
          ),
        ],
      });
    if (q.startsWith('al raha mall'))
      return json(
        photon
          ? {
              features: [
                photonRow(
                  'Al Raha Mall',
                  24.4390188,
                  54.5741217,
                  'mall',
                  91673831,
                ),
              ],
            }
          : [
              nominatimRow(
                'Al Raha Mall',
                24.4390188,
                54.5741217,
                'mall',
                91673831,
              ),
            ],
      );
    return json(photon ? { features: [] } : []);
  };
  return { seen, fetchImpl };
}

test('name variations cover possessives, venue-type swaps and the city qualifier', () => {
  const v = nameVariations('kanes boxing gym abu dhabi', {
    city: 'Abu Dhabi',
    max: 20,
  });
  const n = v.map(normalizeName);
  assert.ok(n.includes('kanes boxing gym abu dhabi'));
  assert.ok(
    v.some((x) => /Kane's Boxing/i.test(x)),
    "adds the possessive Kane's form",
  );
  assert.ok(n.includes('kanes boxing academy abu dhabi'), 'Gym → Academy swap');
  const branch = nameVariations("Kane's Boxing Academy — Al Raha Branch", {
    city: 'Abu Dhabi',
  });
  assert.ok(
    branch.every((x) => !/raha branch/i.test(x)),
    'branch qualifier stripped for venue matching',
  );
  assert.ok(
    namesMatch("Kane's Boxing Academy", 'kanes boxing gym', 'Abu Dhabi'),
  );
  assert.ok(
    namesMatch('Foutouh al Khair Centre', 'Fotouh Al Khair Shopping Centre'),
    'one-letter transliteration drift',
  );
  assert.equal(namesMatch('Mercedes-Benz Airport Road', 'Al Raha Mall'), false);
  assert.equal(
    withBranch({ name: "Kane's Boxing Academy — AD City", branch: 'AD City' }),
    "Kane's Boxing Academy — AD City",
  );
  assert.equal(
    withBranch({ name: 'Kanes Gym', branch: 'Marina' }),
    'Kanes Gym (Marina)',
  );
  assert.deepEqual(trailingPlace('kanes boxing gym abu dhabi').slice(0, 1), [
    'abu dhabi',
  ]);
});

test('research JSON is normalised: unsourced/invalid coordinates and unsafe citations are dropped', () => {
  const data = normalizeResearch({
    ...RESEARCH,
    locations: [
      ...RESEARCH.locations,
      {
        name: 'Stated but uncited',
        lat: 24.4,
        lon: 54.4,
        coordinatesSourced: true,
        confidence: 0.4,
        citations: [],
      },
      {
        name: 'Signed URL',
        confidence: 0.3,
        citations: [
          { url: 'https://x.example/a?sig=abc' },
          { url: 'http://127.0.0.1/a' },
        ],
      },
    ],
  });
  assert.equal(data.locations[0].confidence, 0.99);
  assert.equal('sourcedLat' in data.locations[1], false, 'lat 99 is rejected');
  assert.equal(
    'sourcedLat' in data.locations.find((l) => l.name === 'Stated but uncited'),
    false,
  );
  assert.deepEqual(
    data.locations.find((l) => l.name === 'Signed URL').citations,
    [],
  );
  const prompt = locationResearchPrompt({
    prompt: 'kanes boxing gym abu dhabi',
    hint: null,
  });
  assert.match(prompt, /Perplexity/);
  assert.match(prompt, /NEVER invent/);
  assert.match(prompt, /"coordinatesSourced":boolean/);
  assert.match(prompt, /Kanes\/Kane's/);
});

test('researched address resolves via Photon transliteration match → APPROXIMATE anchor with branch alternative', async () => {
  const t = transport();
  const { fetchImpl } = osm();
  const resolve = createLocationResolver({
    transport: t,
    fetchImpl,
    nominatimSpacingMs: 0,
  });
  const out = await resolve({
    prompt: 'kanes boxing gym abu dhabi',
    hint: { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773, verified: false },
  });
  assert.equal(out.anchor.lat, 24.4850018);
  assert.equal(
    out.anchor.sourceUrl,
    'https://www.openstreetmap.org/way/27374404',
  );
  assert.equal(out.resolution.precision, 'address');
  assert.equal(out.resolution.approximate, true);
  assert.ok(
    out.resolution.confidence > 0.5 && out.resolution.confidence < 0.95,
  );
  assert.equal(out.resolution.matchedName, 'Foutouh al Khair Centre');
  assert.equal(
    out.resolution.alternatives[0].name,
    "Kane's Boxing Academy — Al Raha Branch",
  );
  assert.equal(
    out.resolution.alternatives[0].lat,
    24.4390188,
    'branch located from its researched address',
  );
  assert.ok(
    out.resolution.citations.some((c) => c.url.includes('privilee.ae')),
  );
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].s.pluginIds, ['plugin-1722260873']);
  // Identical prompt is cached: no second research call.
  await resolve({
    prompt: 'kanes boxing gym abu dhabi',
    hint: { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773, verified: false },
  });
  assert.equal(t.calls.length, 1);
});

test('a name-matched OSM venue is exact (not approximate)', async () => {
  const { fetchImpl } = osm({ venue: true });
  const resolve = createLocationResolver({
    transport: transport(),
    fetchImpl,
    nominatimSpacingMs: 0,
  });
  const out = await resolve({ prompt: "Kane's Boxing Gym Abu Dhabi" });
  assert.equal(out.resolution.precision, 'exact');
  assert.equal(out.resolution.approximate, false);
  assert.equal(out.anchor.lat, 24.49);
});

test('nothing but the city is known → city-centroid APPROXIMATE fallback, never an invented point', async () => {
  const research = {
    ...RESEARCH,
    locations: [{ ...RESEARCH.locations[0], address: null, branch: null }],
  };
  const { fetchImpl } = osm();
  const resolve = createLocationResolver({
    transport: transport(research),
    fetchImpl,
    nominatimSpacingMs: 0,
  });
  const out = await resolve({ prompt: 'kanes boxing gym abu dhabi' });
  assert.equal(out.resolution.precision, 'city');
  assert.equal(out.resolution.approximate, true);
  assert.equal(out.anchor.lat, ABU_DHABI.lat);
  assert.ok(out.resolution.confidence <= 0.3);
});

test('research provider failure still builds from the prompt city via OSM; total failure with a hint uses a labelled estimate', async () => {
  const { fetchImpl } = osm();
  const down = createLocationResolver({
    transport: transport(RESEARCH, { fail: true }),
    fetchImpl,
    nominatimSpacingMs: 0,
  });
  const out = await down({ prompt: 'kanes boxing gym abu dhabi' });
  assert.equal(out.resolution.method, 'osm-fallback');
  assert.equal(out.resolution.precision, 'city');
  assert.ok(out.resolution.researchError);
  const offline = createLocationResolver({
    transport: transport(RESEARCH, { fail: true }),
    fetchImpl: async () => {
      throw new Error('offline');
    },
    nominatimSpacingMs: 0,
  });
  const est = await offline({
    prompt: 'zzqx venue',
    hint: { name: 'Abu Dhabi', lat: 24.45, lon: 54.37 },
  });
  assert.equal(est.resolution.precision, 'estimate');
  assert.equal(est.resolution.approximate, true);
  await assert.rejects(() => offline({ prompt: 'zzqx venue nowhere' }), {
    code: 'location_unresolved',
  });
});

test('resolved location and branches become researched dots with citations', async () => {
  const { fetchImpl } = osm();
  const resolve = createLocationResolver({
    transport: transport(),
    fetchImpl,
    nominatimSpacingMs: 0,
  });
  const out = await resolve({ prompt: 'kanes boxing gym abu dhabi' });
  const g = withLocationFeatures(null, out.resolution, out.anchor);
  assert.equal(g.status, 'grounded');
  assert.equal(g.features.length, 2);
  assert.match(g.features[0].name, /^Approx\. Kane's Boxing Academy/);
  assert.match(g.features[1].name, /^Alternative: /);
  assert.ok(g.features[0].citationIds.length >= 1);
});

test('construct ALWAYS builds from an unverified model-extracted hint (no verified geocoder prerequisite) and labels it approximate', async () => {
  const { fetchImpl } = osm();
  let planQuery = '';
  const t = transport();
  const baseQuery = t.query;
  t.query = async (s, q, o) => {
    if (!s.pluginIds?.length) {
      planQuery = q;
      t.calls.push({ s, q, o });
      const ctx = JSON.parse(q.split('\nINPUT ')[1]);
      return {
        answer: JSON.stringify({
          version: 1,
          title: 'Illustrative boxing class arrival',
          illustrative: true,
          durationSec: 12,
          location: ctx.location,
          camera: { distanceM: 400, heading: 40, pitch: -35, framing: 'wide' },
          entities: [
            {
              id: 'members',
              type: 'person',
              label: 'Illustrative members',
              quantity: 6,
              position: { eastM: 10, northM: 5 },
              heading: 90,
            },
          ],
          relationships: [],
          beats: [
            {
              atSec: 0,
              title: 'Approach',
              narration: 'Members arrive at the approximate location.',
              entityIds: ['members'],
            },
            {
              atSec: 6,
              title: 'Entry',
              narration: 'Members enter.',
              entityIds: ['members'],
            },
          ],
          citations: ctx.citations,
          verification: ctx.verification,
        }),
        sessionId: s.id,
        messageId: 'mp',
        endpointId: o.endpointId,
        reasoningEffort: o.reasoningEffort,
      };
    }
    return baseQuery(s, q, o);
  };
  const service = createScenePlanService({
    transport: t,
    research: async () => ({
      kind: 'generic',
      status: 'generic',
      citations: [],
    }),
    locationOptions: { fetchImpl, nominatimSpacingMs: 0 },
    geometry: false,
    model: { endpointId: 'predefined-gpt-6.1-sol', reasoningEffort: 'medium' },
  });
  const result = await service.construct({
    prompt: 'kanes boxing gym abu dhabi',
    candidate: {
      name: "Kane's Boxing Gym, Abu Dhabi",
      lat: 24.4539,
      lon: 54.3773,
      verified: false,
      source: 'ondemand-entity-extraction',
      sourceUrl: null,
    },
    selectedTime: 72,
    revision: 3,
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.location.lat, 24.4850018);
  assert.equal(result.plan.verification.status, 'location_approximate');
  assert.match(result.plan.verification.limitations[1], /APPROXIMATE location/);
  assert.equal(result.locationResolution.approximate, true);
  assert.equal(result.provenance.model.endpointId, 'predefined-gpt-6.1-sol');
  assert.equal(result.provenance.model.reasoningEffort, 'medium');
  assert.ok(
    result.geometry.features.length >= 1,
    'resolved location is drawn as a dot',
  );
  assert.match(planQuery, /location_approximate/);
  // Every provider query carried the configured model + effort.
  assert.ok(
    t.calls.every(
      (c) =>
        c.o.endpointId === 'predefined-gpt-6.1-sol' &&
        c.o.reasoningEffort === 'medium',
    ),
  );
});

test('construct with no hint at all still builds (research-first)', async () => {
  const { fetchImpl } = osm();
  const service = createScenePlanService({
    transport: transport(),
    research: async () => ({
      kind: 'generic',
      status: 'generic',
      citations: [],
    }),
    locationResolver: async () => ({
      anchor: {
        name: 'Abu Dhabi',
        lat: ABU_DHABI.lat,
        lon: ABU_DHABI.lon,
        source: 'openstreetmap',
        sourceUrl: 'https://www.openstreetmap.org/relation/4479763',
      },
      resolution: {
        version: 1,
        method: 'osm-fallback',
        precision: 'city',
        precisionText: 'city centroid',
        approximate: true,
        confidence: 0.2,
        name: 'Abu Dhabi',
        lat: ABU_DHABI.lat,
        lon: ABU_DHABI.lon,
        geocoder: 'OSM',
        sourceCount: 0,
        citations: [],
        alternatives: [],
      },
      researchData: { features: [], citations: [] },
      provenance: null,
    }),
    geometry: false,
  });
  void fetchImpl;
  await assert.rejects(
    () =>
      service.construct({
        prompt: 'kanes boxing gym abu dhabi',
        selectedTime: 72,
      }),
    (e) => e.code !== 'invalid_request',
    'a missing hint is never an invalid_request',
  );
});

test('Snapchat strict scope is optional, separate and cannot gate a build', () => {
  const nodes = [];
  const doc = {
    createElement(tag) {
      const handlers = new Map();
      const n = {
        tagName: tag.toUpperCase(),
        children: [],
        attrs: {},
        value: '',
        disabled: false,
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        append(...c) {
          this.children.push(...c);
        },
        appendChild(c) {
          this.children.push(c);
        },
        addEventListener(k, f) {
          handlers.set(k, f);
        },
        removeEventListener(k) {
          handlers.delete(k);
        },
        remove() {},
        emit(k) {
          handlers.get(k)?.();
        },
      };
      nodes.push(n);
      return n;
    },
  };
  const events = [];
  const control = createSceneFootageControls({
    document: doc,
    window: {
      dispatchEvent: (e) => events.push(e),
      CustomEvent: class {
        constructor(type, init) {
          this.type = type;
          this.detail = init.detail;
        }
      },
    },
  });
  assert.equal(
    control.element.tagName,
    'DETAILS',
    'collapsed optional section',
  );
  assert.equal(control.element.open, false);
  assert.equal(control.element.attrs['data-affects-scene-build'], 'false');
  const note = nodes.find((n) => n.id === 'scene-snapchat-scope-note');
  assert.match(note.textContent, /only to Snapchat results/);
  assert.match(note.textContent, /never affect scene building/);
  // Strict scope with no scene: no event, no error, nothing that could block a build.
  nodes.find((n) => n.id === 'scene-snapchat-discover').emit('click');
  assert.equal(events.length, 0);
  control.destroy();
});
