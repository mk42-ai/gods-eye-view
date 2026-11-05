import test from 'node:test';
import assert from 'node:assert/strict';
import { templateScenePlan } from './fallback-plan.js';
import { validateScenePlan } from '../../src/scenes/structuredPlan.js';

const SAMPLE_LOCATION = {
  name: 'Yas Mall',
  lat: 24.4886,
  lon: 54.6079,
  sourceUrl: 'https://www.openstreetmap.org/search?query=Yas%20Mall',
};

const SAMPLE_VERIFICATION = {
  status: 'location_approximate',
  locationSource: 'known-place-table',
  checkedAt: new Date().toISOString(),
  limitations: [
    'All actors, placements, counts, camera motions and scene beats are illustrative staging, not observed facts.',
  ],
};

const SAMPLE_CITATIONS = [
  {
    url: 'https://www.openstreetmap.org/search?query=Yas%20Mall',
    title: 'OpenStreetMap: Yas Mall',
  },
];

test('templateScenePlan generates schema-valid plan for car crash scenario', () => {
  const plan = templateScenePlan({
    prompt: 'car crash outside yas mall',
    location: SAMPLE_LOCATION,
    verification: SAMPLE_VERIFICATION,
    citations: SAMPLE_CITATIONS,
    durationSec: 60,
  });

  // Must validate with validateScenePlan without throwing
  assert.doesNotThrow(() => validateScenePlan(plan));
  assert.equal(plan.version, 1);
  assert.equal(plan.illustrative, true);
  assert.equal(plan.durationSec, 60);
  assert.equal(plan.location.name, SAMPLE_LOCATION.name);
  assert.equal(plan.location.lat, SAMPLE_LOCATION.lat);
  assert.equal(plan.location.lon, SAMPLE_LOCATION.lon);

  // Entities include two sedans, ambulance, cones, cordon
  const types = plan.entities.map((e) => e.type);
  assert.ok(types.includes('vehicle'));
  assert.ok(types.includes('police_vehicle'));
  assert.ok(types.includes('barrier'));
  const labels = plan.entities.map((e) => e.label.toLowerCase());
  assert.ok(labels.some((l) => l.includes('sedan')));
  assert.ok(labels.some((l) => l.includes('ambulance')));
  assert.ok(labels.some((l) => l.includes('cones')));
  assert.ok(labels.some((l) => l.includes('barricade')));

  // Beats must start at 0 and have illustrative narration
  assert.ok(plan.beats.length >= 3 && plan.beats.length <= 5);
  assert.equal(plan.beats[0].atSec, 0);
  for (const beat of plan.beats) {
    assert.match(beat.narration, /illustrative/i);
    assert.ok(beat.entityIds.length > 0);
  }
});

test('templateScenePlan generates schema-valid plan for police raid scenario', () => {
  const plan = templateScenePlan({
    prompt: 'im doinga. raid in the dubai marina',
    location: { name: 'Dubai Marina', lat: 25.0806, lon: 55.1397 },
    verification: SAMPLE_VERIFICATION,
    citations: SAMPLE_CITATIONS,
    durationSec: 60,
  });

  assert.doesNotThrow(() => validateScenePlan(plan));
  const types = plan.entities.map((e) => e.type);
  assert.ok(types.includes('police_vehicle'));
  assert.ok(types.includes('police'));
  assert.ok(types.includes('barrier'));

  assert.equal(plan.beats[0].atSec, 0);
  for (const beat of plan.beats) {
    assert.match(beat.narration, /illustrative/i);
  }
});

test('templateScenePlan generates schema-valid plan for running route scenario', () => {
  const plan = templateScenePlan({
    prompt: 'marathon race along corniche running route',
    location: { name: 'Abu Dhabi Corniche', lat: 24.4746, lon: 54.335 },
    verification: SAMPLE_VERIFICATION,
    durationSec: 90,
  });

  assert.doesNotThrow(() => validateScenePlan(plan));
  assert.equal(plan.durationSec, 90);

  const types = plan.entities.map((e) => e.type);
  assert.ok(types.includes('start_line'));
  assert.ok(types.includes('finish_line'));
  assert.ok(types.includes('runner'));
  assert.ok(types.includes('barrier'));
  assert.ok(types.includes('organizer'));

  assert.equal(plan.beats[0].atSec, 0);
  for (const beat of plan.beats) {
    assert.match(beat.narration, /illustrative/i);
  }
});

test('templateScenePlan generates schema-valid plan for smoke incident scenario', () => {
  const plan = templateScenePlan({
    prompt: 'heavy smoke and fire alarm evacuation',
    location: SAMPLE_LOCATION,
    verification: SAMPLE_VERIFICATION,
  });

  assert.doesNotThrow(() => validateScenePlan(plan));
  const types = plan.entities.map((e) => e.type);
  assert.ok(types.includes('vehicle'));
  assert.ok(types.includes('person'));
  assert.ok(types.includes('barrier'));
  assert.ok(types.includes('police'));

  assert.equal(plan.beats[0].atSec, 0);
  for (const beat of plan.beats) {
    assert.match(beat.narration, /illustrative/i);
  }
});

test('templateScenePlan generates schema-valid plan for generic venue scenario', () => {
  const plan = templateScenePlan({
    prompt: 'observation around the building venue',
    location: SAMPLE_LOCATION,
  });

  assert.doesNotThrow(() => validateScenePlan(plan));
  assert.equal(plan.beats[0].atSec, 0);
  for (const beat of plan.beats) {
    assert.match(beat.narration, /illustrative/i);
  }
});

test('templateScenePlan throws when location is missing valid coordinates', () => {
  assert.throws(
    () => templateScenePlan({ prompt: 'test', location: null }),
    /requires a location/,
  );
  assert.throws(
    () =>
      templateScenePlan({
        prompt: 'test',
        location: { name: 'X', lat: NaN, lon: 55 },
      }),
    /requires a location/,
  );
});
