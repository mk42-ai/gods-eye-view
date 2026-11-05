/**
 * Geographic scene context: local ENU coordinate frames, conversions,
 * bounds, and terrain sampling for the Cinematic Scene Runtime.
 */
import * as Cesium from 'cesium';

/**
 * Creates a geographic scene context rooted at origin using an East-North-Up (ENU) frame.
 *
 * @param {object} options
 * @param {Cesium.Viewer} [options.viewer]
 * @param {{lat:number, lon:number, heightM?:number, name?:string}} options.origin
 * @param {number} [options.boundsRadiusM=1500]
 */
export function createGeoSceneContext({
  viewer: initialViewer = null,
  origin,
  boundsRadiusM = 1500,
  sampleTerrainImpl = Cesium.sampleTerrainMostDetailed,
} = {}) {
  if (
    !origin ||
    typeof origin.lat !== 'number' ||
    typeof origin.lon !== 'number'
  ) {
    throw new TypeError(
      'createGeoSceneContext requires origin with lat and lon',
    );
  }

  const originData = {
    lat: origin.lat,
    lon: origin.lon,
    heightM: origin.heightM ?? 0,
    name: origin.name || '',
  };

  const originCartesian = Cesium.Cartesian3.fromDegrees(
    originData.lon,
    originData.lat,
    originData.heightM,
  );

  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(originCartesian);
  const inverseFrame = Cesium.Matrix4.inverseTransformation(
    frame,
    new Cesium.Matrix4(),
  );

  /** @type {Array<{local:{eastM:number,northM:number,heightM:number}, height:number}>} */
  const sampleCache = [];

  function localToCartesian({ eastM = 0, northM = 0, heightM = 0 } = {}) {
    const local = new Cesium.Cartesian3(eastM, northM, heightM);
    return Cesium.Matrix4.multiplyByPoint(
      frame,
      local,
      new Cesium.Cartesian3(),
    );
  }

  function cartesianToLocal(c3) {
    if (!c3) return { eastM: 0, northM: 0, heightM: 0 };
    const local = Cesium.Matrix4.multiplyByPoint(
      inverseFrame,
      c3,
      new Cesium.Cartesian3(),
    );
    return { eastM: local.x, northM: local.y, heightM: local.z };
  }

  function wgs84ToLocal({ lat, lon, heightM = 0 } = {}) {
    const c3 = Cesium.Cartesian3.fromDegrees(lon, lat, heightM ?? 0);
    return cartesianToLocal(c3);
  }

  function localToCartographic(local) {
    const c3 = localToCartesian(local);
    const carto = Cesium.Cartographic.fromCartesian(c3);
    if (!carto) {
      return {
        lat: originData.lat,
        lon: originData.lon,
        heightM: originData.heightM,
      };
    }
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      heightM: carto.height,
    };
  }

  function headingToQuaternion(local, headingDeg = 0) {
    const pos = localToCartesian(local);
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(headingDeg ?? 0),
      0,
      0,
    );
    return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
  }

  function bounds() {
    const r = boundsRadiusM;
    const sw = localToCartographic({ eastM: -r, northM: -r });
    const ne = localToCartographic({ eastM: r, northM: r });
    const nw = localToCartographic({ eastM: -r, northM: r });
    const se = localToCartographic({ eastM: r, northM: -r });

    return {
      west: Math.min(sw.lon, nw.lon),
      south: Math.min(sw.lat, se.lat),
      east: Math.max(ne.lon, se.lon),
      north: Math.max(ne.lat, nw.lat),
    };
  }

  function rectangle() {
    const b = bounds();
    return Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
  }

  async function sampleTerrain(viewerOrPositions, maybePositions) {
    let viewer = initialViewer;
    let positions;

    if (Array.isArray(viewerOrPositions)) {
      positions = viewerOrPositions;
    } else {
      viewer = viewerOrPositions || initialViewer;
      positions = maybePositions;
    }

    if (!positions || !positions.length) {
      return { heights: [], sampled: false, source: 'unavailable' };
    }

    const provider = viewer?.terrainProvider;
    if (!provider) {
      return {
        heights: new Array(positions.length).fill(0),
        sampled: false,
        source: 'unavailable',
      };
    }

    if (
      provider instanceof Cesium.EllipsoidTerrainProvider ||
      provider.constructor?.name === 'EllipsoidTerrainProvider' ||
      provider.isEllipsoid
    ) {
      return {
        heights: new Array(positions.length).fill(0),
        sampled: false,
        source: 'ellipsoid',
      };
    }

    try {
      const cartographics = positions.map((p) =>
        Cesium.Cartographic.fromDegrees(p.lon, p.lat),
      );
      const updated = await sampleTerrainImpl(provider, cartographics);
      const heights = updated.map((c) =>
        Number.isFinite(c.height) ? c.height : 0,
      );

      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const h = heights[i];
        const local = wgs84ToLocal({ lat: p.lat, lon: p.lon, heightM: h });
        sampleCache.push({ local, height: h });
      }

      return {
        heights,
        sampled: true,
        source: 'sampleTerrainMostDetailed',
      };
    } catch {
      return {
        heights: new Array(positions.length).fill(0),
        sampled: false,
        source: 'unavailable',
      };
    }
  }

  function groundHeightAt(local) {
    if (!sampleCache.length || !local) return 0;
    const east = local.eastM ?? 0;
    const north = local.northM ?? 0;

    let nearest = sampleCache[0];
    let minDistSq = Infinity;

    for (let i = 0; i < sampleCache.length; i++) {
      const item = sampleCache[i];
      const de = item.local.eastM - east;
      const dn = item.local.northM - north;
      const distSq = de * de + dn * dn;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = item;
      }
    }

    return nearest.height;
  }

  return {
    origin: originData,
    frame,
    inverseFrame,
    localToCartesian,
    cartesianToLocal,
    wgs84ToLocal,
    localToCartographic,
    headingToQuaternion,
    bounds,
    rectangle,
    sampleTerrain,
    groundHeightAt,
  };
}
