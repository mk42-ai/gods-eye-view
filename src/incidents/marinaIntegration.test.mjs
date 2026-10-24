import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseIncidentQuery } from './query.js';
import { planFromCandidates } from './client.js';
import { altitudeForZoom, distanceKm } from './model.js';
import { resolveIncidentGate, sceneAoiConfig } from '../aoi/sceneGate.js';
import {
  buildGeographicScene,
  createGeographicSceneStore,
  GEOGRAPHIC_SCENE_STORAGE_KEY,
} from '../scenes/geographicScene.js';
import { locateText } from '../../server/incidents/routes.js';

// Task-supplied observed OSM Marina anchor. Provider responses below are explicit
// test doubles: these tests perform no live research or incident verification.
const ANCHOR = Object.freeze({ lat: 25.0786415, lon: 55.1352524 });
const CITY = Object.freeze({ lat: 25.2048, lon: 55.2708 });
const QUERY = 'Create a waterfront orbit scene around Dubai Marina';
const FIXTURE_NOW = '2026-10-24T00:00:00.000Z';
const CANDIDATE = Object.freeze({
  name: 'Dubai Marina',
  ...ANCHOR,
  source: 'geocode_place',
  verified: true,
  confidence: 0.95,
});

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

function compile(
  text = QUERY,
  candidate = CANDIDATE,
  storage = memoryStorage(),
) {
  const extraction = parseIncidentQuery(text);
  const gate = resolveIncidentGate(extraction.originalText, candidate);
  const store = createGeographicSceneStore(storage);
  if (!gate.allowed)
    return { extraction, gate, scene: null, saved: null, store, storage };
  const scene = buildGeographicScene({
    text,
    extraction,
    now: FIXTURE_NOW,
    candidate: {
      ...candidate,
      aoi_membership: { inside: gate.allowed, aoi_ids: gate.aoiIds },
    },
  });
  const saved = store.save(scene);
  assert.equal(saved.saved, true);
  return { extraction, gate, scene, saved, store, storage };
}

function stubGeocoder(candidates, calls) {
  return async (contract, args, options) => {
    calls.push({ contract: contract.name, args, options });
    return {
      ok: true,
      provider: { fetchedAt: FIXTURE_NOW }, // Fixed fixture timestamp, not a live observation.
      data: {
        candidates: candidates.map(({ name, lat, lon }) => ({
          formatted_address: name,
          geometry: { location: { lat, lng: lon } },
        })),
      },
    };
  };
}

describe('Marina parser → strict scene gate → geographic scene → persisted store', () => {
  test('scene style is parsed without inventing coordinates or an event', () => {
    const extraction = parseIncidentQuery(QUERY);
    assert.equal(extraction.intent, 'build_scene');
    assert.equal(extraction.place, 'Dubai Marina');
    assert.equal(extraction.sceneStyle, 'waterfront orbit');
    assert.equal(extraction.originalText, QUERY);
    assert.equal(extraction.radiusKm, 5);
    for (const key of [
      'lat',
      'lon',
      'latitude',
      'longitude',
      'coordinates',
      'evidence',
    ])
      assert.equal(Object.hasOwn(extraction, key), false);
  });

  test('observed anchor survives the complete pipeline, without touching an incident ledger', () => {
    const storage = memoryStorage();
    storage.setItem('test-incident-ledger', 'unchanged-fixture-ledger');
    const { extraction, gate, scene, saved } = compile(
      QUERY,
      CANDIDATE,
      storage,
    );
    assert.equal(extraction.place, CANDIDATE.name);
    assert.equal(gate.allowed, true);
    assert.equal(gate.aoiId, 'dubai-marina');
    assert.equal(gate.textUsedForAuthorization, false);
    assert.deepEqual(gate.coordinates, ANCHOR);
    assert.equal(scene.title, 'Dubai Marina — Waterfront Orbit');
    assert.deepEqual(scene.anchor, { name: CANDIDATE.name, ...ANCHOR });
    assert.equal(scene.aoi, 'dubai-marina');
    assert.equal(saved.id, scene.id);
    const restarted = createGeographicSceneStore(storage);
    assert.deepEqual(restarted.load(scene.id), scene);
    assert.deepEqual(restarted.list(), [scene]);
    assert.equal(
      storage.getItem('test-incident-ledger'),
      'unchanged-fixture-ledger',
    );
    assert.ok(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY));
    assert.equal(scene.category, 'geographic');
    assert.equal(scene.confidence, 'unverified');
    assert.equal(scene.provenance.verified, true);
    assert.equal(scene.provenance.incidentConfirmed, false);
    assert.equal(scene.preserveMapLabels, true);
    assert.equal(scene.imagerySynthesis, false);
    assert.match(scene.summary, /not a confirmed incident/);
    for (const key of [
      'incident_ids',
      'evidence',
      'markers',
      'timeline_events',
    ])
      assert.deepEqual(scene[key], []);
  });

  for (const [index, title, heading, altitude, offset, radius] of [
    [0, 'Basin overview', 30, 2400, 0, 0],
    [1, 'Marina Walk waterfront', 120, 1200, 8, 350],
    [2, 'Inlet / JBR waterfront', 210, 900, 18, 650],
    [3, 'Orbit closure', 300, 1800, 28, 0],
  ]) {
    test(`camera/step ${index + 1} round-trips every authored field: ${title}`, () => {
      const { scene, storage } = compile();
      const loaded = createGeographicSceneStore(storage).load(scene.id);
      assert.equal(loaded.keyframes.length, 4);
      assert.equal(loaded.steps.length, 4);
      const frame = loaded.keyframes[index];
      const step = loaded.steps[index];
      assert.deepEqual(frame, scene.keyframes[index]);
      assert.deepEqual(step, scene.steps[index]);
      assert.equal(frame.label, title);
      assert.equal(frame.bearing, heading);
      assert.equal(frame.altitudeM, altitude);
      assert.equal(frame.timeOffsetSec, offset);
      assert.equal(frame.time, offset / 28);
      assert.equal(step.title, title);
      assert.equal(step.timeOffsetSec, offset);
      assert.deepEqual(step.camera, {
        lat: frame.lat,
        lon: frame.lon,
        alt: altitude,
        heading,
        pitch: frame.pitch,
        roll: 0,
        altitudeReference: 'ellipsoid',
      });
      assert.ok(
        Math.abs(altitudeForZoom(frame.zoom, frame.lat) - altitude) < 1e-8,
      );
      assert.ok(Math.abs(distanceKm(ANCHOR, frame) * 1000 - radius) < 0.1);
      assert.equal(
        step.landmarkVerified,
        false,
        'relative targets are not independently geocoded POIs',
      );
      assert.equal(step.provenance, 'relative-geographic-waypoint');
      if (index === 0 || index === 3)
        assert.deepEqual({ lat: frame.lat, lon: frame.lon }, ANCHOR);
      assert.equal(
        loaded.steps.reduce((sum, item) => sum + item.durationSec, 0),
        28,
      );
    });
  }

  test('renaming preserves all four cameras, steps, anchor and scene identity after reload', () => {
    const { scene, store, storage } = compile();
    const renamed = store.rename(scene.id, 'Operator fixture — marina orbit', {
      now: '2026-10-24T01:00:00.000Z',
    });
    assert.equal(renamed.saved, true);
    assert.equal(renamed.id, scene.id);
    const restored = createGeographicSceneStore(storage).load(scene.id);
    assert.equal(restored.title, 'Operator fixture — marina orbit');
    assert.deepEqual(restored.keyframes, scene.keyframes);
    assert.deepEqual(restored.steps, scene.steps);
    assert.deepEqual(restored.anchor, scene.anchor);
    assert.equal(restored.createdAt, scene.createdAt);
    assert.equal(restored.updatedAt, '2026-10-24T01:00:00.000Z');
    assert.equal(createGeographicSceneStore(storage).list().length, 1);
  });

  test('request wording cannot inject incident claims into the geographic store', () => {
    const phrase = 'UNTRUSTED_TEST_CLAIM';
    const { scene, storage } = compile(`${QUERY} ${phrase}`);
    assert.equal(scene.anchor.name, 'Dubai Marina');
    assert.equal(scene.provenance.incidentConfirmed, false);
    assert.equal(
      storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY).includes(phrase),
      false,
    );
    assert.equal(Object.hasOwn(scene, 'text'), false);
    assert.equal(Object.hasOwn(scene, 'extraction'), false);
  });

  test('inside the scene AOI is not a substitute for a verified geocoder candidate', () => {
    const candidate = { ...CANDIDATE, verified: false };
    assert.equal(resolveIncidentGate(QUERY, candidate).allowed, true);
    assert.throws(
      () => compile(QUERY, candidate),
      /verified geocoder candidate is required/,
    );
    assert.throws(
      () =>
        compile(QUERY, { ...CANDIDATE, source: 'ondemand-entity-extraction' }),
      /verified geocoder/,
    );
  });

  for (const candidate of [
    { name: 'Paris', lat: 48.8566, lon: 2.3522 },
    { name: 'Hodeidah', lat: 14.7979, lon: 42.9545 },
    { name: 'Khasab, Oman', lat: 26.1841, lon: 56.247 },
    { name: 'Abu Musa', lat: 25.8778, lon: 55.0306 },
  ]) {
    test(`strict gate refuses ${candidate.name} despite a Marina request and forged override`, () => {
      const { gate, scene, saved, store, storage } = compile(QUERY, {
        ...CANDIDATE,
        ...candidate,
        override: true,
        aoi_membership: { inside: true, aoi_ids: ['dubai-marina'] },
      });
      assert.equal(gate.allowed, false);
      assert.equal(gate.aoiId, null);
      assert.equal(gate.textUsedForAuthorization, false);
      assert.equal(scene, null);
      assert.equal(saved, null);
      assert.deepEqual(store.list(), []);
      assert.equal(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY), null);
    });
  }
});

describe('Marina resolution refuses the coarse Dubai city substitute', () => {
  test('city coordinates are valid UAE context, but not the Marina AOI or anchor', () => {
    const marina = sceneAoiConfig.aois.find(({ id }) => id === 'dubai-marina');
    assert.deepEqual(marina.center, ANCHOR);
    assert.ok(distanceKm(CITY, ANCHOR) > 15);
    const gate = resolveIncidentGate(QUERY, CITY);
    assert.equal(
      gate.allowed,
      true,
      'the city is inside UAE; this is a precision mismatch, not foreign geography',
    );
    assert.equal(gate.aoiId, 'uae-scene-bbox');
    assert.equal(gate.aoiIds.includes('dubai-marina'), false);
    assert.equal(resolveIncidentGate(QUERY, ANCHOR).aoiId, 'dubai-marina');
  });

  test('actual locate module filters stub city results and falls back to explicitly cached observed Marina', async () => {
    const calls = [];
    const located = await locateText(QUERY, {
      useOnDemand: false,
      toolInvoker: stubGeocoder(
        [{ name: 'Dubai, United Arab Emirates', ...CITY }],
        calls,
      ),
    });
    assert.equal(
      calls.length,
      1,
      'coarse gazetteer must not short-circuit precise geocoding',
    );
    assert.equal(calls[0].contract, 'geocode_place');
    assert.equal(calls[0].args.q, 'Dubai Marina, Dubai, United Arab Emirates');
    assert.equal(located.extraction.place, 'Dubai Marina');
    assert.equal(located.extraction.sceneStyle, 'waterfront orbit');
    assert.equal(located.status, 'resolved');
    assert.equal(located.candidates.length, 1);
    const candidate = located.candidates[0];
    assert.equal(candidate.lat, ANCHOR.lat);
    assert.equal(candidate.lon, ANCHOR.lon);
    assert.equal(candidate.cached, true);
    assert.equal(candidate.source, 'osm-verified-cache');
    assert.equal(candidate.verified, true);
    assert.equal(candidate.scene_gate.aoiId, 'dubai-marina');
    const marina = sceneAoiConfig.aois.find(({ id }) => id === 'dubai-marina');
    assert.equal(candidate.sourceUrl, marina.source.feature_url);
    assert.equal(candidate.observedAt, marina.source.observed_utc);
    assert.ok(
      located.steps.some(
        ({ step, status }) =>
          step === 'verified-geographic-cache' && status === 'cached',
      ),
    );
    assert.equal(planFromCandidates(located.candidates).kind, 'single');
    const { scene, store } = compile(QUERY, candidate);
    assert.equal(scene.provenance.source, 'osm-verified-cache');
    assert.equal(scene.provenance.incidentConfirmed, false);
    assert.deepEqual(store.load(scene.id).anchor, {
      name: 'Dubai Marina',
      ...ANCHOR,
    });
  });

  test('actual locate → strict gate → scene → store retains a verified stub provider anchor', async () => {
    const calls = [];
    const located = await locateText(QUERY, {
      useOnDemand: false,
      toolInvoker: stubGeocoder([CANDIDATE], calls),
    });
    assert.equal(calls.length, 1);
    assert.equal(located.candidates.length, 1);
    const candidate = located.candidates[0];
    assert.equal(candidate.verified, true);
    assert.equal(candidate.cached, false);
    assert.equal(candidate.source, 'geocode_place');
    assert.deepEqual({ lat: candidate.lat, lon: candidate.lon }, ANCHOR);
    const plan = planFromCandidates(located.candidates);
    assert.equal(plan.kind, 'single');
    assert.equal(plan.candidate, candidate);
    const { gate, scene, storage } = compile(QUERY, plan.candidate);
    assert.equal(gate.aoiId, 'dubai-marina');
    assert.equal(scene.provenance.source, 'geocode_place');
    assert.equal(scene.provenance.verified, true);
    assert.deepEqual(
      createGeographicSceneStore(storage).load(scene.id).steps,
      scene.steps,
    );
    assert.deepEqual(scene.evidence, []);
  });

  test('failed stub geocoder uses cached geographic provenance without asserting live research success', async () => {
    const located = await locateText(QUERY, {
      useOnDemand: false,
      toolInvoker: async () => {
        throw new Error('fixture geocoder unavailable');
      },
    });
    assert.equal(located.status, 'resolved');
    assert.equal(located.candidates[0].cached, true);
    assert.equal(located.candidates[0].source, 'osm-verified-cache');
    assert.ok(
      located.steps.some(
        ({ error }) => error === 'fixture geocoder unavailable',
      ),
    );
    const { scene } = compile(QUERY, located.candidates[0]);
    assert.equal(scene.provenance.incidentConfirmed, false);
    assert.deepEqual(scene.incident_ids, []);
    assert.deepEqual(scene.evidence, []);
  });
});
