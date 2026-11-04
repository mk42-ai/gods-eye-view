/**
 * src/incidents/ui/sceneFlyIn.js
 *
 * Cinematic camera fly-in transition to framed scene bounding volume.
 *
 * Computes a BoundingSphere containing all scene feature positions (or anchor + 600 m fallback)
 * and animates viewer.camera.flyToBoundingSphere with pitch, heading offset, and duration.
 */
import * as DefaultCesium from 'cesium';

/**
 * Computes a BoundingSphere for scene elements and initiates camera fly-in.
 *
 * @param {object} viewer - Cesium Viewer instance
 * @param {object} [options]
 * @param {Array<{lat: number, lon: number}>} [options.positions=[]] - Feature coordinates
 * @param {{lat: number, lon: number}} [options.anchor] - Scene anchor coordinate
 * @param {object} [options.Cesium=DefaultCesium] - Cesium library reference
 * @param {number} [options.durationSec=2.5] - Fly-in duration in seconds
 * @param {number} [options.pitchDeg=-45] - Camera pitch in degrees (clamped negative)
 * @param {number} [options.headingOffsetDeg=25] - Camera heading offset in degrees
 * @returns {object} The computed BoundingSphere
 */
export function flyToScene(
  viewer,
  {
    positions = [],
    anchor = null,
    Cesium = DefaultCesium,
    durationSec = 2.5,
    pitchDeg = -45,
    headingOffsetDeg = 25,
  } = {},
) {
  const points = [];

  for (const p of positions || []) {
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
      points.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
    }
  }

  if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon)) {
    points.push(Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat));
  }

  let sphere;

  if (points.length > 0) {
    if (
      Cesium.BoundingSphere?.fromPoints &&
      typeof Cesium.BoundingSphere.fromPoints === 'function'
    ) {
      sphere = Cesium.BoundingSphere.fromPoints(points);
      sphere.radius = Math.max(600, sphere.radius || 0);
    } else {
      const center = points[0];
      sphere = new Cesium.BoundingSphere(center, 600);
    }
  } else if (
    anchor &&
    Number.isFinite(anchor.lat) &&
    Number.isFinite(anchor.lon)
  ) {
    const center = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat);
    sphere = new Cesium.BoundingSphere(center, 600);
  } else {
    const center = Cesium.Cartesian3.fromDegrees(0, 0);
    sphere = new Cesium.BoundingSphere(center, 600);
  }

  const heading = Cesium.Math?.toRadians
    ? Cesium.Math.toRadians(headingOffsetDeg)
    : (headingOffsetDeg * Math.PI) / 180;
  const pitch = Cesium.Math?.toRadians
    ? Cesium.Math.toRadians(pitchDeg)
    : (pitchDeg * Math.PI) / 180;
  const range = 0; // 0 lets Cesium frame the entire bounding sphere

  const offset =
    Cesium.HeadingPitchRange && typeof Cesium.HeadingPitchRange === 'function'
      ? new Cesium.HeadingPitchRange(heading, pitch, range)
      : { heading, pitch, range };

  if (viewer?.camera?.flyToBoundingSphere) {
    viewer.camera.flyToBoundingSphere(sphere, {
      offset,
      duration: durationSec,
    });
  }

  return sphere;
}
