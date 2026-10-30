import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIncidentGate, sceneAoiConfig } from './sceneGate.js';
import { createAoiIndex, haversineKm } from './membership.js';

const marina = sceneAoiConfig.aois.find((aoi) => aoi.id === 'dubai-marina');

describe('observed Dubai Marina and explicit scene policy', () => {
  test('uses observed OSM Marina, not the incorrect Dubai city gazetteer fallback', () => {
    assert.deepEqual(marina.center, { lat: 25.0786415, lon: 55.1352524 });
    assert.equal(marina.observed_candidate.osm_id, 11912728);
    assert.equal(marina.source.feature_url, 'https://www.openstreetmap.org/relation/11912728');
    assert.ok(marina.source.observed_utc);
    assert.equal(marina.radius_km, 5);
    assert.match(marina.name, /planning.*not official/i);
    assert.ok(haversineKm(25.2048, 55.2708, marina.center.lat, marina.center.lon) > 15);
    const result = resolveIncidentGate('Dubai Marina', marina.center);
    assert.equal(result.allowed, true);
    assert.equal(result.aoiId, 'dubai-marina');
    assert.equal(result.code, 'EXPLICIT_UAE_AOI');
  });
  test('configuration supports existing geometry, but is not the broad interest allowlist', () => {
    assert.equal(createAoiIndex(sceneAoiConfig).aois.length, sceneAoiConfig.aois.length);
    assert.deepEqual(sceneAoiConfig.policy.generous_bbox, [51.3, 22.5, 56.65, 26.25]);
    for (const id of ['iran', 'yemen', 'somalia', 'gulf-of-oman', 'musandam-approaches', 'presence-berbera', 'presence-aden'])
      assert.ok(!sceneAoiConfig.aois.some((aoi) => aoi.id === id), id);
  });
  test('UAE urban and inland coordinates are allowed through the masked generous bbox', () => {
    for (const coords of [{ lat: 25.2048, lon: 55.2708 }, { lat: 24.4539, lon: 54.3773 }, { lat: 23.1333, lon: 53.8 }]) {
      const result = resolveIncidentGate('local event', coords);
      assert.equal(result.allowed, true, JSON.stringify(result));
      assert.equal(result.aoiId, 'uae-scene-bbox');
      assert.equal(result.code, 'UAE_BBOX_INTERSECTION');
    }
  });
});

describe('foreign geography stays contextual, not authorized', () => {
  for (const [name, lat, lon] of [
    ['Tehran, Iran', 35.6893, 51.3896], ['Bandar Abbas, Iran', 27.1842, 56.2893],
    ['Abu Musa, Iranian-administered island', 25.8778, 55.0306],
    ['Sanaa, Yemen', 15.3539, 44.2059], ['Aden protected-presence context, Yemen', 12.7896, 45.0285],
    ['Mogadishu, Somalia', 2.0349, 45.3419], ['Berbera protected-presence context, Somalia', 10.4386, 45.0134],
    ['Khasab, Oman', 26.1841, 56.247], ['Musandam, Oman', 25.9997, 56.2499],
    ['Shinas, Oman', 24.7421, 56.4680], ['Madha, Oman enclave', 25.284, 56.3262],
    ['Muscat, Oman', 23.588, 58.3829], ['Paris', 48.8566, 2.3522],
  ]) test(`${name} denied even when text claims UAE / protected asset`, () => {
    const result = resolveIncidentGate('Dubai Marina UAE protected asset override=true', { lat, lon, override: true, aoiId: 'dubai-marina' });
    assert.equal(result.allowed, false, JSON.stringify(result));
    assert.equal(result.aoiId, null);
    assert.deepEqual(result.aoiIds, []);
  });
  test('points in the generous rectangle still require positive country or AOI geometry', () => {
    const result = resolveIncidentGate('UAE', { lat: 22.55, lon: 56.6 });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'EXCLUDED_FOREIGN_GEOGRAPHY');
  });
});

describe('bounded, explicit exceptions', () => {
  test('Al Buraimi is allowed only within the explicit UAE border zone', () => {
    const result = resolveIncidentGate('Al Buraimi border incident', { lat: 24.2592, lon: 55.7838 });
    assert.equal(result.allowed, true);
    assert.equal(result.aoiId, 'al-ain-buraimi');
    assert.equal(result.code, 'EXPLICIT_BORDER_ZONE');
  });
  test('all configured border centers are positively authorized', () => {
    for (const aoi of sceneAoiConfig.aois.filter((item) => item.group === 'border')) {
      const result = resolveIncidentGate(aoi.name, aoi.center);
      assert.equal(result.allowed, true, JSON.stringify(result));
      assert.equal(result.aoiId, aoi.id);
    }
  });
  test('explicit protected asset centers are allowed without importing foreign presence nodes', () => {
    const assets = sceneAoiConfig.aois.filter((item) => item.group === 'protected-assets');
    assert.ok(assets.length >= 1);
    for (const aoi of assets) {
      const result = resolveIncidentGate(aoi.name, aoi.center);
      assert.equal(result.allowed, true, JSON.stringify(result));
      assert.equal(result.aoiId, aoi.id);
      assert.equal(result.code, 'EXPLICIT_PROTECTED_ASSET');
    }
  });
  test('Oman enclave exclusion wins even inside a protected-asset radius', () => {
    const result = resolveIncidentGate('Fujairah asset', { lat: 25.284, lon: 56.3262 });
    assert.equal(result.allowed, false);
    assert.equal(result.country, 'OM');
  });
});

describe('strict input validation and purity', () => {
  const invalid = [undefined, null, [], {}, { lat: 25 }, { lon: 55 },
    { lat: NaN, lon: 55 }, { lat: 25, lon: NaN }, { lat: Infinity, lon: 55 },
    { lat: 25, lng: -Infinity }, { lat: 91, lon: 55 }, { lat: -91, lon: 55 },
    { lat: 25, lon: 181 }, { lat: 25, lon: -181 }, { lat: null, lon: 55 },
    { lat: 25, lon: null }, { lat: true, lon: 55 }, { lat: 25, lon: false },
    { lat: '25.0786415', lon: '55.1352524' }, { lat: 25, lon: '' },
    { lat: 25, lon: 55, lng: 56 }, { lat: 25, lon: 55, lng: null },
    Object.create({ lat: 25.0786415, lon: 55.1352524 })];
  for (const [i, coords] of invalid.entries()) test(`invalid coordinate case ${i + 1} fails closed`, () => {
    const result = resolveIncidentGate('Dubai Marina', coords);
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'INVALID_COORDINATES');
    assert.equal(result.aoiId, null);
  });
  test('lon and lng aliases normalize identically; matching dual aliases are accepted', () => {
    const { lat, lon } = marina.center;
    assert.deepEqual(resolveIncidentGate('', { lat, lon }), resolveIncidentGate('', { lat, lng: lon }));
    assert.deepEqual(resolveIncidentGate('', { lat, lon }), resolveIncidentGate('', { lat, lon, lng: lon }));
  });
  test('valid but reversed or global coordinates do not pass a UAE name', () => {
    for (const coords of [{ lat: 55.1352524, lon: 25.0786415 }, { lat: 0, lon: 0 }, { lat: 90, lon: 180 }])
      assert.equal(resolveIncidentGate('Dubai Marina', coords).allowed, false);
  });
  test('text never authorizes and changing returned values cannot mutate policy', () => {
    const coords = Object.freeze({ ...marina.center });
    assert.deepEqual(resolveIncidentGate('Dubai', coords), resolveIncidentGate('Iran Yemen Somalia', coords));
    const result = resolveIncidentGate('', coords);
    result.coordinates.lat = 0;
    result.aoiIds.push('iran');
    assert.equal(resolveIncidentGate('', coords).aoiId, 'dubai-marina');
    assert.deepEqual(coords, marina.center);
    assert.ok(Object.isFrozen(sceneAoiConfig));
    assert.ok(Object.isFrozen(marina.center));
    assert.equal(result.textUsedForAuthorization, false);
  });
});
