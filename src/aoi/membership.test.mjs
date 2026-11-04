import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAoiIndex,
  haversineKm,
  pointInRing,
  pointInBbox,
  distanceToAoiKm,
  outlineRing,
} from './membership.js';

const config = JSON.parse(
  readFileSync(new URL('../../config/aoi/uae-interest.json', import.meta.url)),
);
const index = createAoiIndex(config);

describe('geometry primitives', () => {
  test('haversine: Dubai → Abu Dhabi ≈ 123 km', () => {
    const km = haversineKm(25.2048, 55.2708, 24.4539, 54.3773);
    assert.ok(km > 118 && km < 128, String(km));
  });
  test('ray casting: inside / outside a square', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    assert.equal(pointInRing(5, 5, ring), true);
    assert.equal(pointInRing(15, 5, ring), false);
    assert.equal(pointInRing(5, -1, ring), false);
  });
  test('bbox membership respects [west,south,east,north]', () => {
    assert.equal(
      pointInBbox(26.4, 56.2, [55.2127, 25.7106, 57.3469, 27.1888]),
      true,
    );
    assert.equal(
      pointInBbox(24.0, 56.2, [55.2127, 25.7106, 57.3469, 27.1888]),
      false,
    );
  });
  test('distance to a circle is 0 inside and positive beyond the radius', () => {
    const aoi = {
      kind: 'circle',
      center: { lat: 10.4386, lon: 45.0134 },
      radius_km: 25,
    };
    assert.equal(distanceToAoiKm(10.5, 45.0, aoi), 0);
    assert.ok(distanceToAoiKm(11.5, 45.0, aoi) > 80);
  });
  test('outline rings are closed', () => {
    for (const aoi of index.aois) {
      const ring = outlineRing(aoi, 16);
      assert.deepEqual(ring[0], ring[ring.length - 1], aoi.id);
    }
  });
});

describe('config', () => {
  test('loads 27 AOIs across the five groups with editable buffers', () => {
    assert.equal(index.aois.length, 27);
    const groups = new Set(index.aois.map((a) => a.group));
    assert.deepEqual([...groups].sort(), [
      'border',
      'country',
      'maritime',
      'presence',
      'waters',
    ]);
    assert.equal(config.buffers_km.presence_node_km, 25);
    assert.equal(config.buffers_km.land_border_km, 50);
    assert.equal(config.buffers_km.territorial_nmi, 12);
  });
  test('gazetteer fallbacks are flagged verified:false', () => {
    const unverified = config.gazetteer
      .filter((g) => g.verified === false)
      .map((g) => g.name);
    assert.ok(unverified.includes('Ghuwaifat'));
    assert.ok(unverified.includes('Greater Tunb'));
    assert.ok(unverified.includes('Lesser Tunb'));
  });
  test('invalid AOI entries are rejected', () => {
    assert.throws(() =>
      createAoiIndex({
        aois: [
          { id: 'x', name: 'x', group: 'g', kind: 'bbox', bbox: [1, 2, 0, 3] },
        ],
      }),
    );
    assert.throws(() =>
      createAoiIndex({
        aois: [
          { id: 'x', name: 'x', group: 'g', kind: 'polygon', ring: [[0, 0]] },
        ],
      }),
    );
  });
});

describe('membership + reason', () => {
  test('Hodeidah port is inside Yemen (+ southern Red Sea)', () => {
    const m = index.membership(14.7979, 42.9545);
    assert.equal(m.inside, true);
    assert.ok(m.aoi_ids.includes('yemen'));
    assert.match(m.reason, /^IN_AOI: /);
  });
  test('Strait of Hormuz mid-channel is inside the maritime AOI', () => {
    const m = index.membership(26.5, 56.4);
    assert.equal(m.inside, true);
    assert.ok(m.aoi_ids.includes('strait-of-hormuz'));
  });
  test('Berbera presence node: inside only via the 25 km protection radius', () => {
    const m = index.membership(10.45, 45.02);
    assert.equal(m.inside, true);
    assert.ok(m.aoi_ids.includes('presence-berbera'));
  });
  test('Paris is OUT_OF_AOI with the nearest AOI named and a distance', () => {
    const m = index.membership(48.8566, 2.3522);
    assert.equal(m.inside, false);
    assert.deepEqual(m.aoi_ids, []);
    assert.match(m.reason, /^OUT_OF_AOI: nearest AOI .+ at \d+(\.\d)? km$/);
    assert.ok(m.nearest.km > 3000, String(m.nearest.km));
  });
  test('Hotan (China) is OUT_OF_AOI', () => {
    const m = index.membership(37.1114, 79.9229);
    assert.equal(m.inside, false);
    assert.equal(m.nearest.name, 'Iran');
  });
  test('Yanbu (Red Sea, Saudi) is outside the southern Red Sea box', () => {
    const m = index.membership(24.0896, 38.0618);
    assert.equal(m.inside, false);
    assert.match(m.reason, /OUT_OF_AOI/);
  });
  test('Ethiopian/Djibouti hotspot near 11.26,41.52 is out of AOI', () => {
    const m = index.membership(11.26427, 41.5168);
    assert.equal(m.inside, false);
    assert.match(m.reason, /OUT_OF_AOI: nearest AOI .* at \d/);
  });
  test('Mogadishu hotspot (2.07, 45.29) is inside Somalia', () => {
    const m = index.membership(2.06698, 45.28712);
    assert.equal(m.inside, true);
    assert.ok(m.aoi_ids.includes('somalia'));
  });
  test('Fujairah anchorage hotspot is inside UAE waters', () => {
    const m = index.membership(25.30717, 56.37327);
    assert.equal(m.inside, true);
    assert.ok(m.aoi_ids.includes('fujairah-anchorage'));
  });
  test('group filter narrows the index (presence only)', () => {
    const presence = createAoiIndex(config, { groups: ['presence'] });
    assert.equal(presence.aois.length, 8);
    assert.equal(presence.membership(26.5, 56.4).inside, false);
    assert.equal(presence.membership(12.79, 45.03).inside, true);
  });
  test('invalid coordinates never throw', () => {
    const m = index.membership('x', null);
    assert.equal(m.inside, false);
    assert.match(m.reason, /invalid coordinates/);
  });
});

describe('gazetteer lookup', () => {
  test('free text "drone strike reported near Hodeidah port" resolves to Hodeidah', () => {
    const hits = index.gazetteerLookup(
      'drone strike reported near Hodeidah port',
    );
    assert.equal(hits[0].name, 'Hodeidah');
    assert.ok(Math.abs(hits[0].lat - 14.7979) < 1e-3);
  });
  test('"Paris" resolves and is flagged out of AOI by membership', () => {
    const [hit] = index.gazetteerLookup('explosion in Paris');
    assert.equal(hit.name, 'Paris');
    assert.equal(index.membership(hit.lat, hit.lon).inside, false);
  });
  test('unknown text returns an empty candidate list', () => {
    assert.deepEqual(index.gazetteerLookup('zzzz nowhere'), []);
  });
});
