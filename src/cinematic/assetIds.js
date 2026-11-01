/**
 * Cinematic asset registry — the ONLY asset identifiers a model may reference.
 *
 * Shared by the browser runtime (src/cinematic/assetRegistry.js), the server
 * Cinematic Director prompt (server/scene-plans/director.js) and the sprite
 * build (tools/scene-icons/build-icons.mjs). Dependency-free so Node tests and
 * the Vite bundle both import it.
 *
 * Every entry records provenance + licence. Sprites resolve to
 * `/scene-icons/png/<key>.png` (32 px), `@2x` (64 px) and `@4x` (128 px);
 * models resolve to `/models/...glb`. `fallback` names the nearest registered
 * asset used when a requested id is missing or fails to load (logged, never
 * silent).
 */

export const ASSET_KIND = Object.freeze({ SPRITE: 'sprite', MODEL: 'model' });

const SPRITE_SOURCE_EXISTING =
  'Supplied 1024² top-down PNG (black keyed to alpha), tools/scene-icons/sources';
const SPRITE_SOURCE_NEW =
  'Supplied 1024² top-down PNG (2026-11-01 batch, black keyed to alpha), tools/scene-icons/sources';
const SPRITE_SOURCE_BATCH_B =
  'Generated 1024² top-down PNG (2026-11-01 batch B, black #000000 keyed to alpha), tools/scene-icons/sources';
const SPRITE_LICENCE =
  'Project-supplied artwork (OnDemand), used with permission';
const SPRITE_SVG = 'Hand-authored SVG in public/scene-icons/svg';

/** @typedef {{id:string,kind:'sprite'|'model',key?:string,file?:string,label:string,category:string,licence:string,source:string,fallback:string|null,footprintM?:number,upAxis?:string,noseAxis?:string}} CinematicAsset */

/** @type {readonly CinematicAsset[]} */
export const CINEMATIC_ASSETS = Object.freeze(
  [
    // ---- 9 existing manifest icons (already keyed) + the 7 SVG/generated keys
    sprite(
      'sprite.cordon_node',
      'cordon_node',
      'Cordon node',
      'barrier',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.cone',
      'cone',
      'Traffic cone',
      'barrier',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.barrier',
      'barrier',
      'Road barrier',
      'barrier',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.crowd_zone',
      'crowd_zone',
      'Crowd zone',
      'crowd',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.command_post',
      'command_post',
      'Command post',
      'responder',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.checkpoint',
      'checkpoint',
      'Checkpoint',
      'barrier',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.route_flag',
      'route_start',
      'Route flag',
      'route',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.route_finish',
      'route_finish',
      'Route finish flag',
      'route',
      SPRITE_SOURCE_EXISTING + ' (mirrored)',
    ),
    sprite(
      'sprite.egress',
      'egress',
      'Egress arrow',
      'route',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.cctv',
      'cctv',
      'CCTV camera',
      'sensor',
      SPRITE_SOURCE_EXISTING,
    ),
    sprite(
      'sprite.police_unit',
      'police_unit',
      'Police unit',
      'police',
      SPRITE_SVG,
    ),
    sprite(
      'sprite.cctv_signal',
      'cctv_signal',
      'CCTV signal',
      'sensor',
      SPRITE_SVG,
    ),
    sprite(
      'sprite.staging_point',
      'staging_point',
      'Staging point',
      'responder',
      SPRITE_SVG,
    ),
    sprite(
      'sprite.perimeter_unit',
      'perimeter_unit',
      'Perimeter unit',
      'police',
      SPRITE_SVG,
    ),
    sprite(
      'sprite.start_finish',
      'start_finish',
      'Start / finish',
      'route',
      SPRITE_SVG,
    ),
    sprite(
      'sprite.generic',
      'generic',
      'Generic marker',
      'marker',
      'generated:generic',
      null,
    ),
    // ---- 10 new top-down sprites (2026-11-01)
    sprite(
      'sprite.vehicle.police_car',
      'vehicle_police_car',
      'Police car',
      'vehicle',
      SPRITE_SOURCE_NEW,
      'sprite.police_unit',
    ),
    sprite(
      'sprite.vehicle.ambulance',
      'vehicle_ambulance',
      'Ambulance',
      'vehicle',
      SPRITE_SOURCE_NEW,
      'sprite.vehicle.civilian_sedan',
    ),
    sprite(
      'sprite.vehicle.fire_engine',
      'vehicle_fire_engine',
      'Fire engine',
      'vehicle',
      SPRITE_SOURCE_NEW,
      'sprite.vehicle.ambulance',
    ),
    sprite(
      'sprite.vehicle.civilian_sedan',
      'vehicle_civilian_sedan',
      'Civilian sedan',
      'vehicle',
      SPRITE_SOURCE_NEW,
      'sprite.generic',
    ),
    sprite(
      'sprite.aircraft.helicopter',
      'aircraft_helicopter',
      'Helicopter',
      'aircraft',
      SPRITE_SOURCE_NEW,
      'sprite.aircraft.fixed_wing',
    ),
    sprite(
      'sprite.aircraft.fixed_wing',
      'aircraft_fixed_wing',
      'Fixed-wing aircraft',
      'aircraft',
      SPRITE_SOURCE_NEW,
      'sprite.generic',
    ),
    sprite(
      'sprite.person.runner',
      'person_runner',
      'Runner',
      'person',
      SPRITE_SOURCE_NEW,
      'sprite.crowd_zone',
    ),
    sprite(
      'sprite.person.police_officer',
      'person_police_officer',
      'Police officer',
      'person',
      SPRITE_SOURCE_NEW,
      'sprite.police_unit',
    ),
    sprite(
      'sprite.signage.road_closed',
      'signage_road_closed',
      'Road closed sign',
      'signage',
      SPRITE_SOURCE_NEW,
      'sprite.barrier',
    ),
    sprite(
      'sprite.effect.smoke_fire',
      'effect_smoke_fire',
      'Smoke / fire',
      'effect',
      SPRITE_SOURCE_NEW,
      'sprite.generic',
    ),
    // ---- 2×2 alert-state sheet sliced to 4 × 512² (black keyed to alpha)
    sprite(
      'sprite.alert.state_1',
      'alert_state_1',
      'Alert · normal',
      'alert',
      SPRITE_SOURCE_NEW + ' sheet quadrant TL',
      'sprite.generic',
    ),
    sprite(
      'sprite.alert.state_2',
      'alert_state_2',
      'Alert · warning',
      'alert',
      SPRITE_SOURCE_NEW + ' sheet quadrant TR',
      'sprite.alert.state_1',
    ),
    sprite(
      'sprite.alert.state_3',
      'alert_state_3',
      'Alert · critical',
      'alert',
      SPRITE_SOURCE_NEW + ' sheet quadrant BL',
      'sprite.alert.state_2',
    ),
    sprite(
      'sprite.alert.state_4',
      'alert_state_4',
      'Alert · verified',
      'alert',
      SPRITE_SOURCE_NEW + ' sheet quadrant BR',
      'sprite.alert.state_1',
    ),
    // ---- glTF/GLB models. Existing project models are CC BY 4.0 (public/models/README.md).
    // ---- 2026-11-01 batch B — 10 generated icons (teal/mint/white/navy on black, keyed)
    sprite(
      'sprite.barrier.crowd',
      'barrier_crowd',
      'Crowd barrier',
      'barrier',
      SPRITE_SOURCE_BATCH_B,
      'sprite.barrier',
    ),
    sprite(
      'sprite.cone_cluster',
      'cone_cluster',
      'Traffic cone cluster',
      'barrier',
      SPRITE_SOURCE_BATCH_B,
      'sprite.cone',
    ),
    sprite(
      'sprite.crowd.spectators',
      'crowd_spectators',
      'Spectator crowd cluster',
      'crowd',
      SPRITE_SOURCE_BATCH_B,
      'sprite.crowd_zone',
    ),
    sprite(
      'sprite.person.responder',
      'person_responder',
      'Police officer / responder',
      'responder',
      SPRITE_SOURCE_BATCH_B,
      'sprite.person.police_officer',
    ),
    sprite(
      'sprite.vehicle.city_bus',
      'vehicle_city_bus',
      'City bus',
      'vehicle',
      SPRITE_SOURCE_BATCH_B,
      'sprite.vehicle.civilian_sedan',
    ),
    sprite(
      'sprite.vehicle.police_motorcycle',
      'vehicle_police_motorcycle',
      'Police motorcycle',
      'police',
      SPRITE_SOURCE_BATCH_B,
      'sprite.vehicle.police_car',
    ),
    sprite(
      'sprite.sensor.cctv_feed',
      'sensor_cctv_feed',
      'CCTV camera feed marker',
      'sensor',
      SPRITE_SOURCE_BATCH_B,
      'sprite.cctv',
    ),
    sprite(
      'sprite.evidence.pin_verified',
      'evidence_pin_verified',
      'Verified evidence pin',
      'marker',
      SPRITE_SOURCE_BATCH_B,
      'sprite.alert.state_4',
    ),
    sprite(
      'sprite.marker.air_raid_impact_sim',
      'marker_air_raid_impact_sim',
      'Simulated air-raid impact marker (HYPOTHETICAL)',
      'marker',
      SPRITE_SOURCE_BATCH_B,
      'sprite.effect.smoke_fire',
    ),
    sprite(
      'sprite.vessel.marine_patrol',
      'vessel_marine_patrol',
      'Marine patrol boat',
      'vessel',
      SPRITE_SOURCE_BATCH_B,
      'sprite.generic',
    ),
    model(
      'model.cesium.milk_truck',
      'models/cinematic/CesiumMilkTruck.glb',
      'Cesium milk truck',
      'vehicle',
      'CesiumGS/cesium Apps/SampleData (Apache-2.0 repo; also KhronosGroup/glTF-Sample-Models CC BY 4.0, © Cesium)',
      'sprite.vehicle.civilian_sedan',
      6.5,
    ),
    model(
      'model.cesium.man',
      'models/cinematic/Cesium_Man.glb',
      'Cesium Man (animated walk)',
      'person',
      'CesiumGS/cesium Apps/SampleData (Apache-2.0 repo; also KhronosGroup/glTF-Sample-Models CC BY 4.0, © Cesium)',
      'sprite.person.runner',
      0.6,
    ),
    model(
      'model.cesium.air',
      'models/cinematic/Cesium_Air.glb',
      'Cesium Air (animated propellers)',
      'aircraft',
      'CesiumGS/cesium Apps/SampleData (Apache-2.0 repository licence)',
      'sprite.aircraft.fixed_wing',
      12,
    ),
    model(
      'model.cesium.drone',
      'models/cinematic/CesiumDrone.glb',
      'Cesium drone',
      'aircraft',
      'CesiumGS/cesium Apps/SampleData (Apache-2.0 repository licence)',
      'sprite.aircraft.helicopter',
      1.2,
    ),
    model(
      'model.bell206',
      'models/bell206.glb',
      'Bell 206 JetRanger',
      'aircraft',
      'CC BY 4.0 — terran4627 via Sketchfab (public/models/README.md)',
      'model.cesium.drone',
      12,
    ),
    model(
      'model.c172',
      'models/c172.glb',
      'Cessna 172',
      'aircraft',
      'CC BY 4.0 — e737 via Sketchfab (public/models/README.md)',
      'model.cesium.air',
      11,
    ),
    model(
      'model.jet',
      'models/jet.glb',
      'Private jet',
      'aircraft',
      'CC BY 4.0 — Nick the Name via Sketchfab (public/models/README.md)',
      'model.c172',
      20,
    ),
    model(
      'model.mq9',
      'models/mq9.glb',
      'MQ-9 (hypothetical visualisation only)',
      'aircraft',
      'CC BY 4.0 — IProZenoN via Sketchfab (public/models/README.md)',
      'model.cesium.air',
      20,
    ),
    model(
      'model.ship',
      'models/ship.glb',
      'Cargo ship',
      'vessel',
      'CC BY 4.0 — Javier_Fernandez via Sketchfab (public/models/README.md)',
      'sprite.generic',
      120,
    ),
  ].map(Object.freeze),
);

function sprite(id, key, label, category, source, fallback = 'sprite.generic') {
  return {
    id,
    kind: ASSET_KIND.SPRITE,
    key,
    label,
    category,
    licence: SPRITE_LICENCE,
    source,
    fallback,
  };
}
function model(id, file, label, category, licence, fallback, footprintM) {
  return {
    id,
    kind: ASSET_KIND.MODEL,
    file,
    label,
    category,
    licence,
    source: licence,
    fallback,
    footprintM,
    upAxis: '+Y',
    noseAxis: id.startsWith('model.cesium.') ? '+Z' : '-X',
  };
}

export const ASSET_IDS = Object.freeze(CINEMATIC_ASSETS.map((a) => a.id));
export const SPRITE_KEYS = Object.freeze(
  CINEMATIC_ASSETS.filter((a) => a.kind === ASSET_KIND.SPRITE).map(
    (a) => a.key,
  ),
);
const BY_ID = new Map(CINEMATIC_ASSETS.map((a) => [a.id, a]));
const BY_KEY = new Map(
  CINEMATIC_ASSETS.filter((a) => a.key).map((a) => [a.key, a]),
);

export function getAsset(id) {
  return BY_ID.get(id) || null;
}
export function getAssetByKey(key) {
  return BY_KEY.get(key) || null;
}
export function isAssetId(id) {
  return BY_ID.has(id);
}

/**
 * Category → preferred asset ids (first that exists wins). Used to map a
 * model's loose `kind`/`role` words to a registered id when it omits one.
 */
export const CATEGORY_DEFAULTS = Object.freeze({
  police_vehicle: ['sprite.vehicle.police_car'],
  ambulance: ['sprite.vehicle.ambulance'],
  fire_engine: ['sprite.vehicle.fire_engine'],
  civilian_vehicle: [
    'sprite.vehicle.civilian_sedan',
    'model.cesium.milk_truck',
  ],
  helicopter: ['sprite.aircraft.helicopter', 'model.bell206'],
  fixed_wing: ['sprite.aircraft.fixed_wing', 'model.cesium.air'],
  drone: ['model.cesium.drone', 'sprite.aircraft.helicopter'],
  runner: ['sprite.person.runner'],
  police_officer: ['sprite.person.police_officer'],
  pedestrian: ['sprite.person.runner', 'model.cesium.man'],
  crowd: ['sprite.crowd_zone'],
  barrier: ['sprite.barrier'],
  cone: ['sprite.cone'],
  road_closed: ['sprite.signage.road_closed'],
  checkpoint: ['sprite.checkpoint'],
  command_post: ['sprite.command_post'],
  cctv: ['sprite.cctv'],
  smoke: ['sprite.effect.smoke_fire'],
  fire: ['sprite.effect.smoke_fire'],
  alert: ['sprite.alert.state_2'],
  marker: ['sprite.generic'],
  crowd_barrier: ['sprite.barrier.crowd'],
  cone_cluster: ['sprite.cone_cluster'],
  spectators: ['sprite.crowd.spectators'],
  spectator_crowd: ['sprite.crowd.spectators'],
  responder: ['sprite.person.responder'],
  bus: ['sprite.vehicle.city_bus'],
  city_bus: ['sprite.vehicle.city_bus'],
  police_motorcycle: ['sprite.vehicle.police_motorcycle'],
  motorcycle: ['sprite.vehicle.police_motorcycle'],
  cctv_feed: ['sprite.sensor.cctv_feed'],
  camera_feed: ['sprite.sensor.cctv_feed'],
  evidence_pin: ['sprite.evidence.pin_verified'],
  evidence: ['sprite.evidence.pin_verified'],
  air_raid_impact: ['sprite.marker.air_raid_impact_sim'],
  impact_marker: ['sprite.marker.air_raid_impact_sim'],
  patrol_boat: ['sprite.vessel.marine_patrol'],
  vessel: ['sprite.vessel.marine_patrol'],
  boat: ['sprite.vessel.marine_patrol'],
});

/**
 * Resolve any requested id (or loose category word) to a registered asset.
 * Returns `{asset, requested, substituted:boolean, reason?}`; never throws and
 * never invents a filename. Follows `fallback` chains (bounded) and ends at
 * `sprite.generic`.
 */
export function resolveAssetId(requested, { unavailable = new Set() } = {}) {
  const want = typeof requested === 'string' ? requested.trim() : '';
  let asset = BY_ID.get(want) || null;
  let reason;
  if (!asset) {
    const loose = want.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const viaKey = BY_KEY.get(loose);
    const viaCategory = CATEGORY_DEFAULTS[loose]
      ?.map((id) => BY_ID.get(id))
      .find(Boolean);
    asset = viaKey || viaCategory || null;
    reason = asset
      ? `mapped '${want}' → ${asset.id}`
      : `unknown asset id '${want}'`;
  }
  let hops = 0;
  while (asset && unavailable.has(asset.id) && asset.fallback && hops < 8) {
    reason = `${reason ? reason + '; ' : ''}${asset.id} unavailable → ${asset.fallback}`;
    asset = BY_ID.get(asset.fallback) || null;
    hops++;
  }
  if (!asset) asset = BY_ID.get('sprite.generic');
  return {
    asset,
    requested: want,
    substituted: asset.id !== want,
    ...(asset.id !== want
      ? { reason: reason || `fallback → ${asset.id}` }
      : {}),
  };
}

export function spriteUrl(asset, scale = 1) {
  if (!asset || asset.kind !== ASSET_KIND.SPRITE) return null;
  const suffix = scale >= 4 ? '@4x' : scale >= 2 ? '@2x' : '';
  return `/scene-icons/png/${asset.key}${suffix}.png`;
}
export function modelUrl(asset) {
  return asset && asset.kind === ASSET_KIND.MODEL ? `/${asset.file}` : null;
}
