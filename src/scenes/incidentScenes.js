/**
 * Incident scene → Scene Director project scene.
 *
 * The incident model (src/incidents/model.js) describes a scene as
 * keyframes {lat, lon, zoom, bearing, pitch, time}; the director plays
 * shots {camera:{lat,lon,alt,heading,pitch,roll}, durationSec, holdSec}.
 * This adapter is the only place that translation lives, so the director's
 * authored-scene machinery (play / pause / scrub / next / previous, progress,
 * share, export) works unchanged for incident scenes.
 */
import { altitudeForZoom } from '../incidents/model.js';
import { normalizeShot, uid } from './project.js';

export const INCIDENT_SCENE_PREFIX = 'inc-scene-';
export const INCIDENT_SCENE_DURATION_SEC = 18;

/** Shot durations from the normalized keyframe times (sum ≈ total). */
export function shotTimings(keyframes, totalSec = INCIDENT_SCENE_DURATION_SEC) {
  const times = keyframes.map((k, i) =>
    Number.isFinite(k.time) ? k.time : i / Math.max(1, keyframes.length - 1),
  );
  return keyframes.map((_, i) => {
    const start = i === 0 ? 0 : times[i - 1];
    const end = times[i] || (i === keyframes.length - 1 ? 1 : start);
    const span = Math.max(0.1, end - start) * totalSec;
    const fly = i === 0 ? Math.min(3, span) : Math.max(2, span * 0.7);
    const hold = Math.max(0.6, span - fly);
    return {
      durationSec: Math.round(fly * 10) / 10,
      holdSec: Math.round(hold * 10) / 10,
    };
  });
}

// Geographic keyframes name ground targets. Offsetting the camera behind the
// target keeps that location in frame at an oblique pitch; putting the camera
// directly above it points the viewport several kilometres past the AOI.
export function geographicCameraPose(kf) {
  const rad = Math.PI / 180;
  const alt = Number.isFinite(kf.altitudeM)
    ? kf.altitudeM
    : altitudeForZoom(kf.zoom, kf.lat);
  const pitch = kf.pitch ?? -45;
  const heading = kf.bearing || 0;
  const distance =
    alt / Math.tan(Math.max(1, Math.min(90, Math.abs(pitch))) * rad);
  const angle = distance / 6371008.8;
  const lat = kf.lat * rad;
  const bearing = (heading + 180) * rad;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(angle) +
      Math.cos(lat) * Math.sin(angle) * Math.cos(bearing),
  );
  const nextLon =
    kf.lon * rad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angle) * Math.cos(lat),
      Math.cos(angle) - Math.sin(lat) * Math.sin(nextLat),
    );
  return {
    lat: nextLat / rad,
    lon: ((nextLon / rad + 540) % 360) - 180,
    alt,
    heading,
    pitch,
    roll: 0,
  };
}

function sceneLayers() {
  // Incident scenes do not take an opinion on live data layers; they only
  // assert that the incident overlay is on (reconciled by the overlay itself).
  return {};
}

/**
 * @param {object} incidentScene scene from src/incidents/model.js#sceneFromCluster
 * @param {{visualStyle?:string}} [options]
 */
export function incidentSceneToProjectScene(incidentScene, options = {}) {
  if (!incidentScene?.keyframes?.length)
    throw new Error('incident scene needs keyframes');
  const planned = Boolean(incidentScene.plan && incidentScene.version === 2);
  const frames = planned
    ? incidentScene.keyframes.slice(0, -1)
    : incidentScene.keyframes;
  const timings = planned
    ? frames.map((frame, index) => {
        const span =
          incidentScene.keyframes[index + 1].timeOffsetSec -
          frame.timeOffsetSec;
        if (!(span >= 0.2))
          throw new Error(
            'Structured scene beats must allow at least 0.2 seconds per shot',
          );
        const durationSec = Math.min(
          span,
          Math.max(0.2, Math.min(2.5, span * 0.25)),
        );
        return { durationSec, holdSec: span - durationSec };
      })
    : shotTimings(
        frames,
        incidentScene.durationSec || INCIDENT_SCENE_DURATION_SEC,
      );
  const shots = frames.map((kf, i) =>
    normalizeShot(
      {
        id: uid('shot'),
        title: kf.label || `Keyframe ${i + 1}`,
        durationSec: timings[i].durationSec,
        holdSec: timings[i].holdSec,
        camera: incidentScene.geographic
          ? geographicCameraPose(kf)
          : {
              lat: kf.lat,
              lon: kf.lon,
              alt: Number.isFinite(kf.altitudeM)
                ? kf.altitudeM
                : altitudeForZoom(kf.zoom, kf.lat),
              heading: kf.bearing || 0,
              pitch: kf.pitch ?? -45,
              roll: 0,
            },
        visual: {
          style: options.visualStyle || 'normal',
          hud: { visible: true, variant: 'tactical' },
          detection: { mode: 'OFF', density: 35 },
        },
        layers: sceneLayers(),
      },
      i,
    ),
  );
  const incident = {
    incident_ids: [...(incidentScene.incident_ids || [])],
    category: String(incidentScene.category || ''),
    aoi: String(incidentScene.aoi || ''),
    markers: (incidentScene.markers || []).map((m) => ({
      lat: m.lat,
      lon: m.lon,
      category: m.category,
      icon: m.icon,
      title: m.title,
      incident_id: m.incident_id,
      ...(m.confidence ? { confidence: m.confidence } : {}),
    })),
    evidence: (incidentScene.evidence || []).map((e) => ({
      item_id: e.item_id,
      thumbnail_url: e.thumbnail_url,
      acquired: e.acquired ?? null,
      ...(Number.isFinite(e.clear_percent)
        ? { clear_percent: e.clear_percent }
        : {}),
    })),
    timeline_events: (incidentScene.timeline_events || []).map((t) => ({
      time_utc: t.time_utc,
      title: t.title,
      incident_id: t.incident_id,
    })),
    ...(incidentScene.sources ? { sources: incidentScene.sources } : {}),
    ...(incidentScene.summary
      ? { summary: String(incidentScene.summary) }
      : {}),
    ...(incidentScene.confidence
      ? { confidence: incidentScene.confidence }
      : {}),
    ...(incidentScene.time_utc ? { time_utc: incidentScene.time_utc } : {}),
    ...(incidentScene.override ? { override: true } : {}),
    ...(incidentScene.reason ? { reason: String(incidentScene.reason) } : {}),
  };
  return {
    id: String(incidentScene.id || uid(INCIDENT_SCENE_PREFIX.slice(0, -1))),
    title: String(incidentScene.title || 'Incident scene').slice(0, 300),
    releaseLayerIds: [],
    appliedShotPacks: [],
    shots,
    incident,
  };
}

export function isIncidentScene(scene) {
  return Boolean(scene?.incident?.incident_ids);
}
