/**
 * Derive the legacy structured scene plan (src/scenes/structuredPlan.js
 * SCENE_PLAN_SCHEMA) deterministically from a validated Cinematic Scene.
 *
 * Why: the existing renderer/persistence path (`buildPlannedScene`) needs a
 * legacy `plan`; before this module the plan came from a SECOND synchronous
 * LLM call (20–40 s on gpt-6.1-sol). Deriving it from the streamed director
 * scene removes that call entirely while keeping every legacy guarantee
 * (location/citations/verification preserved EXACTLY, bounded counts, beats
 * chronological from 0, allowed entity types only).
 */
import {
  validateScenePlan,
  SCENE_PLAN_VERSION,
  SCENE_ENTITY_TYPES,
} from '../../src/scenes/structuredPlan.js';

const LEGACY_MAX_DURATION = 180;
const LEGACY_MAX_ENTITIES = 300;
const LEGACY_MAX_BEATS = 90;

const TYPE_BY_CATEGORY = Object.freeze({
  person: 'person',
  crowd: 'person',
  police: 'police',
  responder: 'person',
  vehicle: 'vehicle',
  aircraft: 'vehicle',
  vessel: 'vehicle',
  barrier: 'barrier',
  signage: 'barrier',
});

function legacyType(entity) {
  const asset = String(entity.assetId || '');
  if (asset.includes('police_car')) return 'police_vehicle';
  if (asset.includes('police_officer') || asset.includes('police_unit'))
    return 'police';
  if (asset.includes('runner')) return 'runner';
  if (asset.includes('start_finish') || asset.includes('route_start'))
    return 'start_line';
  if (asset.includes('route_finish')) return 'finish_line';
  const role = String(entity.role || '').toLowerCase();
  if (role === 'runner') return 'runner';
  if (role === 'organizer' || role === 'official' || role === 'marshal')
    return 'organizer';
  const mapped = TYPE_BY_CATEGORY[entity.category];
  return SCENE_ENTITY_TYPES.includes(mapped) ? mapped : null;
}

const legacyId = (id, used) => {
  let base = String(id)
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/^[^A-Za-z]+/, '');
  if (!base) base = 'entity';
  base = base.slice(0, 70);
  let candidate = base;
  let n = 1;
  while (used.has(candidate)) candidate = `${base}-${++n}`;
  used.add(candidate);
  return candidate;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const text = (v, max, fallback) => {
  const s = String(v ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, max);
  return s || fallback;
};

function cameraFromShot(shot, fallbackDistance = 400) {
  const distanceM = clamp(shot?.distanceM ?? fallbackDistance, 10, 20000);
  return {
    distanceM,
    heading: (((shot?.headingDeg ?? 0) % 360) + 360) % 360,
    pitch: clamp(shot?.pitchDeg ?? -35, -89, -5),
    framing: distanceM > 900 ? 'wide' : distanceM > 200 ? 'medium' : 'close',
  };
}

/**
 * @param {object} scene validated CinematicScene
 * @param {{location:{name:string,lat:number,lon:number,sourceUrl?:string}, verification:object, citations:object[]}} ctx authoritative legacy fields
 * @returns {object} validated legacy plan
 */
export function legacyPlanFromCinematic(
  scene,
  { location, verification, citations },
) {
  const durationSec = clamp(scene.timeline.durationSec, 5, LEGACY_MAX_DURATION);
  // Legacy beats are bounded to 180 s; longer cinematic timelines are scaled.
  const timeScale =
    scene.timeline.durationSec > LEGACY_MAX_DURATION
      ? LEGACY_MAX_DURATION / scene.timeline.durationSec
      : 1;
  const idMap = new Map();
  const used = new Set();
  const entities = [];
  let total = 0;
  for (const e of scene.entities) {
    const type = legacyType(e);
    if (!type) continue;
    const quantity = clamp(Math.round(e.count || 1), 1, 100);
    if (total + quantity > LEGACY_MAX_ENTITIES) break;
    const radius = Math.hypot(e.position.eastM, e.position.northM);
    const scale = radius > 5000 ? 4999 / radius : 1;
    const id = legacyId(e.id, used);
    idMap.set(e.id, id);
    const hypothetical = e.hypothetical ? 'HYPOTHETICAL · ' : '';
    entities.push({
      id,
      type,
      label: text(`${hypothetical}${e.label}`, 160, type),
      quantity,
      position: {
        eastM: Math.round(e.position.eastM * scale * 100) / 100,
        northM: Math.round(e.position.northM * scale * 100) / 100,
      },
      heading: (((e.headingDeg ?? 0) % 360) + 360) % 360,
    });
    total += quantity;
  }
  if (!entities.length) {
    entities.push({
      id: 'focal',
      type: 'person',
      label: text(scene.title, 160, 'Illustrative focal marker'),
      quantity: 1,
      position: { eastM: 0, northM: 0 },
      heading: 0,
    });
  }
  const shotsSorted = [...scene.shots].sort((a, b) => a.startSec - b.startSec);
  const camera = cameraFromShot(shotsSorted[0]);
  const shotAt = (sec) => {
    let current = shotsSorted[0];
    for (const s of shotsSorted) if (s.startSec * timeScale <= sec) current = s;
    return current;
  };
  const rawBeats = [...scene.timeline.beats]
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, LEGACY_MAX_BEATS)
    .map((b) => ({
      atSec: Math.round(clamp(b.atSec * timeScale, 0, durationSec) * 100) / 100,
      title: text(b.title, 200, 'Scene beat'),
      narration: text(
        b.narration,
        2000,
        `${text(b.title, 180, 'Beat')} — illustrative staging, not an observed event.`,
      ),
      entityIds: [
        ...new Set(b.entityIds.map((id) => idMap.get(id)).filter(Boolean)),
      ],
      camera: cameraFromShot(shotAt(b.atSec * timeScale), camera.distanceM),
    }));
  const beats = [];
  let last = -1;
  for (const b of rawBeats) {
    if (b.atSec <= last && beats.length)
      b.atSec = Math.min(durationSec, last + 0.01);
    if (b.atSec >= durationSec && beats.length) continue;
    beats.push(b);
    last = b.atSec;
  }
  if (!beats.length || beats[0].atSec !== 0)
    beats.unshift({
      atSec: 0,
      title: 'Illustrative overview',
      narration: `Illustrative overview of ${text(scene.title, 150, 'the scene')} around ${text(location.name, 150, 'the anchor')}; staging, not observed facts.`,
      entityIds: [],
      camera,
    });
  const plan = {
    version: SCENE_PLAN_VERSION,
    title: text(scene.title, 200, 'Illustrative scene'),
    illustrative: true,
    durationSec,
    location: {
      name: location.name,
      lat: location.lat,
      lon: location.lon,
      ...(location.sourceUrl ? { sourceUrl: location.sourceUrl } : {}),
    },
    camera,
    entities,
    relationships: [],
    beats,
    citations,
    verification,
  };
  return validateScenePlan(plan);
}
