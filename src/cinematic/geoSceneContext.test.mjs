import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createGeoSceneContext } from './geoSceneContext.js';

test('createGeoSceneContext throws when origin is missing or invalid', () => {
  assert.throws(() => createGeoSceneContext(), /origin with lat and lon/);
  assert.throws(
    () => createGeoSceneContext({ origin: {} }),
    /origin with lat and lon/,
  );
  assert.throws(
    () => createGeoSceneContext({ origin: { lat: 25.0 } }),
    /origin with lat and lon/,
  );
});

test('Burj Khalifa round trip error < 1e-6 m at 1 km offsets', () => {
  const origin = {
    lat: 25.1972,
    lon: 55.2744,
    heightM: 10,
    name: 'Burj Khalifa',
  };
  const context = createGeoSceneContext({ origin });

  const offsets = [
    { eastM: 1000, northM: 0, heightM: 0 },
    { eastM: 0, northM: 1000, heightM: 0 },
    { eastM: 1000, northM: 1000, heightM: 50 },
    { eastM: -1000, northM: -1000, heightM: -10 },
  ];

  for (const off of offsets) {
    const c3 = context.localToCartesian(off);
    const local = context.cartesianToLocal(c3);
    const err = Math.hypot(
      local.eastM - off.eastM,
      local.northM - off.northM,
      local.heightM - off.heightM,
    );
    assert.ok(
      err < 1e-6,
      `Burj Khalifa round trip err ${err} >= 1e-6 at ${JSON.stringify(off)}`,
    );
  }
});

test('Umm Suqeim round trip error < 1e-6 m at 1 km offsets', () => {
  const origin = { lat: 25.15, lon: 55.19, heightM: 0, name: 'Umm Suqeim' };
  const context = createGeoSceneContext({ origin });

  const offsets = [
    { eastM: 1000, northM: 0, heightM: 0 },
    { eastM: 0, northM: 1000, heightM: 0 },
    { eastM: 700, northM: 700, heightM: 100 },
  ];

  for (const off of offsets) {
    const c3 = context.localToCartesian(off);
    const local = context.cartesianToLocal(c3);
    const err = Math.hypot(
      local.eastM - off.eastM,
      local.northM - off.northM,
      local.heightM - off.heightM,
    );
    assert.ok(
      err < 1e-6,
      `Umm Suqeim round trip err ${err} >= 1e-6 at ${JSON.stringify(off)}`,
    );
  }
});

test('eastM=1000 moves longitude east and northM=1000 moves latitude north', () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin });

  const eastPt = context.localToCartographic({ eastM: 1000, northM: 0 });
  assert.ok(eastPt.lon > origin.lon, 'eastM=1000 must increase longitude');
  assert.ok(
    Math.abs(eastPt.lat - origin.lat) < 1e-4,
    'latitude should barely change for pure east move',
  );

  const northPt = context.localToCartographic({ eastM: 0, northM: 1000 });
  assert.ok(northPt.lat > origin.lat, 'northM=1000 must increase latitude');
  assert.ok(
    Math.abs(northPt.lon - origin.lon) < 1e-4,
    'longitude should barely change for pure north move',
  );
});

test('wgs84ToLocal round trips with localToCartographic', () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin });

  const local = { eastM: 250, northM: -180, heightM: 15 };
  const geo = context.localToCartographic(local);
  const back = context.wgs84ToLocal(geo);

  assert.ok(Math.abs(back.eastM - local.eastM) < 1e-4);
  assert.ok(Math.abs(back.northM - local.northM) < 1e-4);
  assert.ok(Math.abs(back.heightM - local.heightM) < 1e-4);
});

test('headingToQuaternion returns valid Quaternion', () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin });

  const q0 = context.headingToQuaternion({ eastM: 0, northM: 0 }, 0);
  const q90 = context.headingToQuaternion({ eastM: 0, northM: 0 }, 90);

  assert.ok(q0 instanceof Cesium.Quaternion);
  assert.ok(q90 instanceof Cesium.Quaternion);
  assert.notDeepEqual(q0, q90);
});

test('bounds and rectangle create bounding box around origin', () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin, boundsRadiusM: 1500 });

  const b = context.bounds();
  assert.ok(b.west < origin.lon && b.east > origin.lon);
  assert.ok(b.south < origin.lat && b.north > origin.lat);

  const rect = context.rectangle();
  assert.ok(rect instanceof Cesium.Rectangle);
  assert.ok(rect.west < rect.east);
  assert.ok(rect.south < rect.north);
});

test('groundHeightAt returns 0 when no samples cached', () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin });
  assert.equal(context.groundHeightAt({ eastM: 100, northM: 100 }), 0);
});

test('sampleTerrain handles missing provider or ellipsoid provider', async () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const context = createGeoSceneContext({ origin });

  // No provider
  const res1 = await context.sampleTerrain(null, [{ lat: 25.19, lon: 55.27 }]);
  assert.deepEqual(res1, {
    heights: [0],
    sampled: false,
    source: 'unavailable',
  });

  // Ellipsoid provider
  const ellipsoidViewer = {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  };
  const res2 = await context.sampleTerrain(ellipsoidViewer, [
    { lat: 25.19, lon: 55.27 },
  ]);
  assert.deepEqual(res2, { heights: [0], sampled: false, source: 'ellipsoid' });
});

test('sampleTerrain caches nearest heights when sampling succeeds', async () => {
  const origin = { lat: 25.1972, lon: 55.2744 };
  const mockSampleImpl = async (_provider, cartographics) => {
    return cartographics.map((c, i) => {
      c.height = 25.5 + i * 10;
      return c;
    });
  };

  const context = createGeoSceneContext({
    origin,
    sampleTerrainImpl: mockSampleImpl,
  });

  const mockViewer = { terrainProvider: { isEllipsoid: false } };
  const res = await context.sampleTerrain(mockViewer, [
    { lat: 25.1972, lon: 55.2744 }, // at origin
    { lat: 25.2062, lon: 55.2744 }, // north
  ]);

  assert.equal(res.sampled, true);
  assert.equal(res.source, 'sampleTerrainMostDetailed');
  assert.deepEqual(res.heights, [25.5, 35.5]);

  // Nearest to origin (0, 0) should be 25.5
  assert.equal(context.groundHeightAt({ eastM: 10, northM: 10 }), 25.5);
  // Nearest to the north point (~1000m north) should be 35.5
  assert.equal(context.groundHeightAt({ eastM: 10, northM: 990 }), 35.5);
});
