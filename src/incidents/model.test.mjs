import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAoiIndex } from '../aoi/membership.js';
import {
  sha1Hex,
  dedupeKey,
  timeBucket,
  normalizeIncident,
  normalizeCategory,
  dedupeIncidents,
  clusterIncidents,
  keyframesFor,
  buildScenes,
  sceneFromCluster,
  altitudeForZoom,
  IncidentValidationError,
  INCIDENT_CATEGORIES,
  CATEGORY_ICONS,
} from './model.js';

const config = JSON.parse(
  readFileSync(new URL('../../config/aoi/uae-interest.json', import.meta.url)),
);
const { membership } = createAoiIndex(config);

describe('sha1 + dedupe key', () => {
  test('sha1Hex matches the reference digest', () => {
    assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
  test('6 h buckets floor to 00/06/12/18 UTC', () => {
    assert.equal(
      timeBucket('2026-10-21T10:02:00Z'),
      '2026-10-21T06:00:00.000Z',
    );
    assert.equal(
      timeBucket('2026-10-21T22:29:00Z'),
      '2026-10-21T18:00:00.000Z',
    );
  });
  test('dedupe_key is stable for the same category / 0.01° cell / bucket', () => {
    const a = dedupeKey({
      category: 'thermal_hotspot',
      lat: 24.50376,
      lon: 56.6086,
      time_utc: '2026-10-21T10:02:00Z',
    });
    const b = dedupeKey({
      category: 'thermal hotspot',
      lat: 24.504,
      lon: 56.609,
      time_utc: '2026-10-21T11:59:00Z',
    });
    const c = dedupeKey({
      category: 'thermal_hotspot',
      lat: 24.504,
      lon: 56.609,
      time_utc: '2026-10-21T12:01:00Z',
    });
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^[0-9a-f]{40}$/);
  });
});

describe('normalizeIncident', () => {
  test('fills defaults, stamps AOI membership and dedupe_key', () => {
    const inc = normalizeIncident(
      {
        title: 'Drone strike near Hodeidah port',
        category: 'missile_drone_strike',
        lat: 14.7979,
        lon: 42.9545,
        time_utc: '2026-10-22T05:00:00Z',
        sources: [
          { url: 'https://example.com/a', published_at: '2026-10-22' },
          'not-a-url',
        ],
        confidence: 'Confirmed',
      },
      { membership },
    );
    assert.equal(inc.aoi, 'yemen');
    assert.equal(inc.aoi_membership.inside, true);
    assert.equal(inc.confidence, 'confirmed');
    assert.equal(inc.sources.length, 1);
    assert.match(inc.dedupe_key, /^[0-9a-f]{40}$/);
    assert.ok(inc.id.startsWith('inc-'));
  });
  test('out-of-AOI incidents keep the reason', () => {
    const inc = normalizeIncident(
      {
        title: 'Falcon Shield 2026 at Hotan',
        category: 'airstrike',
        lat: 37.1114,
        lon: 79.9229,
      },
      { membership },
    );
    assert.equal(inc.aoi, 'out-of-aoi');
    assert.match(
      inc.aoi_membership.reason,
      /^OUT_OF_AOI: nearest AOI Iran at \d+(\.\d)? km$/,
    );
  });
  test('rejects missing coordinates and empty titles', () => {
    assert.throws(
      () => normalizeIncident({ title: 'x', lat: 95, lon: 0 }),
      IncidentValidationError,
    );
    assert.throws(
      () => normalizeIncident({ title: '', lat: 1, lon: 1 }),
      IncidentValidationError,
    );
    assert.throws(
      () => normalizeIncident({ title: 'x', lat: 1 }),
      IncidentValidationError,
    );
  });
  test('category aliases map to the 10 canonical categories with icons', () => {
    assert.equal(normalizeCategory('cyber'), 'ied_terror');
    assert.equal(normalizeCategory('thermal hotspot'), 'thermal_hotspot');
    assert.equal(
      normalizeCategory('presence node'),
      'protected_asset_presence_node',
    );
    assert.equal(
      normalizeCategory('Houthi ballistic missile'),
      'missile_drone_strike',
    );
    assert.equal(normalizeCategory('political'), 'protest_unrest');
    for (const c of INCIDENT_CATEGORIES)
      assert.equal(CATEGORY_ICONS[c], `/icons/incidents/${c}.png`);
    assert.equal(Object.keys(CATEGORY_ICONS).length, 10);
  });
});

function hot(lat, lon, t = '2026-10-21T22:29:00Z', extra = {}) {
  return normalizeIncident(
    {
      title: `hotspot ${lat},${lon}`,
      category: 'thermal_hotspot',
      lat,
      lon,
      time_utc: t,
      ...extra,
    },
    { membership },
  );
}

describe('dedupe + clustering', () => {
  test('dedupeIncidents keeps the first of each key', () => {
    const list = [hot(24.5037, 56.6086), hot(24.504, 56.609), hot(25.7, 58.27)];
    assert.equal(dedupeIncidents(list).length, 2);
  });
  test('25 km AND 6 h: nearby+same-window merge, far or late ones split', () => {
    const a = hot(24.50376, 56.6086); // Fujairah cluster
    const b = hot(24.46365, 56.63007); // ~5 km away, same pass
    const c = hot(24.50305, 56.605, '2026-10-22T06:00:00Z'); // same place, 7.5 h later
    const d = hot(27.1615, 56.1013); // Bandar Abbas, ~300 km away
    const clusters = clusterIncidents([a, b, c, d]);
    assert.equal(clusters.length, 3);
    const sizes = clusters.map((c) => c.length).sort();
    assert.deepEqual(sizes, [1, 1, 2]);
  });
  test('categories never mix inside a cluster', () => {
    const a = hot(14.7979, 42.9545);
    const b = normalizeIncident(
      {
        title: 'strike',
        category: 'missile_drone_strike',
        lat: 14.8,
        lon: 42.95,
        time_utc: a.time_utc,
      },
      { membership },
    );
    assert.equal(clusterIncidents([a, b]).length, 2);
  });
});

describe('keyframes + scenes', () => {
  test('keyframes go approach → overhead → context with increasing time', () => {
    const kf = keyframesFor([{ lat: 14.7979, lon: 42.9545 }]);
    assert.equal(kf.length, 3);
    assert.deepEqual(
      kf.map((k) => k.label),
      ['Approach', 'Overhead', 'Context'],
    );
    assert.ok(kf[0].time < kf[1].time && kf[1].time < kf[2].time);
    assert.ok(kf[1].zoom > kf[0].zoom, 'overhead is closer than approach');
    assert.equal(kf[1].pitch, -80);
    for (const k of kf) {
      assert.ok(Number.isFinite(k.lat) && Number.isFinite(k.lon));
      assert.ok(Number.isFinite(k.bearing) && Number.isFinite(k.pitch));
    }
  });
  test('cluster spread widens the overhead zoom', () => {
    const tight = keyframesFor([{ lat: 24.5, lon: 56.6 }]);
    const wide = keyframesFor([
      { lat: 24.5, lon: 56.6 },
      { lat: 24.7, lon: 56.8 },
    ]);
    assert.ok(wide[1].zoom < tight[1].zoom);
  });
  test('altitudeForZoom decreases with zoom', () => {
    assert.ok(altitudeForZoom(6) > altitudeForZoom(12));
  });
  test('sceneFromCluster carries markers, evidence, timeline and playback', () => {
    const a = hot(12.79, 45.03, '2026-10-22T07:00:00Z', {
      evidence: [
        {
          item_id: '20261022_073054_55_255a',
          thumbnail_url:
            'https://serverless.on-demand.io/apps/planet-proxy/thumbnail/PSScene/20261022_073054_55_255a',
          acquired: '2026-10-22T07:30:54Z',
        },
      ],
    });
    const b = hot(12.8, 45.05, '2026-10-22T08:00:00Z');
    const scene = sceneFromCluster([b, a]);
    assert.equal(scene.incident_ids.length, 2);
    assert.equal(scene.markers.length, 2);
    assert.equal(scene.markers[0].icon, '/icons/incidents/thermal_hotspot.png');
    assert.equal(scene.evidence.length, 1);
    assert.equal(scene.timeline_events[0].incident_id, a.id);
    assert.deepEqual(scene.playback, { state: 'idle', position: 0 });
    assert.match(scene.title, /cluster ×2/);
  });
  test('buildScenes returns one scene per cluster, newest first', () => {
    const scenes = buildScenes([
      hot(24.5, 56.6),
      hot(27.16, 56.1, '2026-10-21T10:02:00Z'),
      hot(24.51, 56.61),
    ]);
    assert.equal(scenes.length, 2);
    assert.ok(Date.parse(scenes[0].time_utc) >= Date.parse(scenes[1].time_utc));
  });
});
