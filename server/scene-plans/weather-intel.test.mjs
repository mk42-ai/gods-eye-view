import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchWeatherObservation,
  buildWeatherPatch,
  effectForWeatherCode,
} from './weather-intel.js';
import { safeValidateScenePatch, applyScenePatch } from '../../src/cinematic/sceneSchema.js';

const FIXTURE = {
  current: {
    time: '2026-11-01T14:00',
    temperature_2m: 31.2,
    apparent_temperature: 33.1,
    precipitation: 0,
    weather_code: 45,
    cloud_cover: 20,
    wind_speed_10m: 12.4,
    wind_direction_10m: 310,
    visibility: 3200,
  },
};

function mockFetch(status = 200, body = FIXTURE) {
  return async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.equal(init.redirect, 'error');
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
}

test('weather-intel: fetch normalises an Open-Meteo observation with attribution', async () => {
  const res = await fetchWeatherObservation(
    { lat: 25.1972, lon: 55.2744 },
    { fetchImpl: mockFetch(), now: () => 1_000 },
  );
  assert.equal(res.ok, true);
  assert.equal(res.observation.weatherCode, 45);
  assert.equal(res.observation.observedAt, '2026-11-01T14:00:00.000Z');
  assert.equal(res.source.provider, 'open-meteo');
  assert.match(res.source.attribution, /Open-Meteo/);
});

test('weather-intel: provider failure is reported, never invented', async () => {
  const res = await fetchWeatherObservation({ lat: 1, lon: 1 }, { fetchImpl: mockFetch(503, {}) });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'provider_http_error');
  assert.equal(res.error.status, 503);
  const bad = await fetchWeatherObservation({ lat: NaN, lon: 1 }, { fetchImpl: mockFetch() });
  assert.equal(bad.error.code, 'invalid_point');
});

test('weather-intel: WMO code mapping covers fog, rain, clear', () => {
  assert.equal(effectForWeatherCode(45).type, 'weather_fog');
  assert.equal(effectForWeatherCode(63, { precipitationMm: 4 }).type, 'weather_rain');
  assert.equal(effectForWeatherCode(0, { visibilityM: 20000 }), null);
  assert.equal(effectForWeatherCode(0, { visibilityM: 1200 }).type, 'haze');
});

test('weather-intel: builds a zod-valid ScenePatch that applies to a scene', async () => {
  const fetched = await fetchWeatherObservation(
    { lat: 25.1972, lon: 55.2744 },
    { fetchImpl: mockFetch(), now: () => 5_000 },
  );
  const built = buildWeatherPatch(fetched, {
    sceneId: 'scene-test-weather',
    baseVersion: 2,
    atSec: 42.6,
    now: () => 5_000,
  });
  assert.equal(built.ok, true);
  assert.equal(safeValidateScenePatch(built.patch).success, true);
  assert.equal(built.patch.source, 'intelligence');
  assert.equal(built.patch.ops.map((o) => o.op).join(','), 'add_evidence,add_timeline_event,add_effect');
  assert.equal(built.patch.ops[2].effect.type, 'weather_fog');
  assert.equal(built.patch.ops[1].beat.atSec, 43);
  assert.match(built.patch.label, /LIVE WEATHER — FOG/);
  const scene = {
    schema: 'gev-cinematic-scene',
    schemaVersion: 1,
    sceneId: 'scene-test-weather',
    sceneVersion: 2,
    title: 'T',
    mode: 'cinematic_simulation',
    origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    classification: { scenarioType: 'marathon', intent: 'x' },
    timeline: { durationSec: 60 },
    entities: [],
    routes: [],
    shots: [],
    effects: [],
    evidence: [],
  };
  const applied = applyScenePatch(scene, built.patch);
  assert.equal(applied.rejected?.length || 0, 0, JSON.stringify(applied.rejected));
  assert.equal(applied.scene.effects.length, 1);
  assert.equal(applied.scene.evidence.length, 1);
  assert.equal(applied.scene.sceneVersion, 3);
});
