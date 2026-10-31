/** Pure scene construction. Authored staging is never evidence of an incident. */
import { validateScenePlan } from './structuredPlan.js';

export const PLANNED_SCENE_VERSION = 2;
export const GEOGRAPHIC_SCENE_STORAGE_VERSION = 2;
export const GEOGRAPHIC_SCENE_VERSION = 1;
export const GEOGRAPHIC_SCENE_STORAGE_KEY = 'gev.geographic-scenes.v1';
const SCHEMA = 'gev-geographic-scene';
const EARTH_RADIUS_M = 6371008.8;
const MAX_SCENES = 100;
const MAX_STORAGE_CHARS = 1_000_000;

/**
 * @typedef {Object} GeographicCandidate
 * @property {string} name Geocoder's resolved place name, not raw request text.
 * @property {number} lat WGS84 latitude.
 * @property {number} lon WGS84 longitude.
 * @property {boolean} [verified] Server /locate marks verified geocoder results true.
 * @property {boolean} [validated] Equivalent explicit validation flag for other callers.
 * @property {string} [source]
 * @property {number} [confidence] Location confidence only (0..1).
 * @property {{inside?:boolean,aoi_ids?:string[]}} [aoi_membership]
 * @property {string} [aoi]
 */
/**
 * @typedef {Object} GeographicKeyframe
 * @property {string} label
 * @property {number} lat
 * @property {number} lon
 * @property {number} zoom Inverse of incidents/model.js altitudeForZoom.
 * @property {number} altitudeM Ellipsoid height, not measured terrain clearance.
 * @property {number} bearing Degrees clockwise from north.
 * @property {number} pitch
 * @property {number} time Normalized 0..1, compatible with incident keyframes.
 * @property {number} timeOffsetSec Offset on the authored camera timeline, not event time.
 */
/**
 * @typedef {Object} GeographicStep
 * @property {string} id
 * @property {string} title
 * @property {number} timeOffsetSec
 * @property {number} durationSec
 * @property {{lat:number,lon:number,alt:number,heading:number,pitch:number,roll:number,altitudeReference:'ellipsoid'}} camera
 * @property {'relative-geographic-waypoint'} provenance
 * @property {false} landmarkVerified These are camera waypoints, not independently resolved POIs.
 */
/**
 * @typedef {Object} GeographicScene
 * @property {string} schema
 * @property {number} version
 * @property {string} id Collision-free, namespaced identity; not a truncated hash.
 * @property {string} title
 * @property {true} geographic
 * @property {'geographic'} category
 * @property {{name:string,lat:number,lon:number}} anchor
 * @property {string} aoi Incident-compatible AOI ID; 'geographic' when membership is absent.
 * @property {number} aoiRadiusM Camera-plan extent, not a claim of AOI membership.
 * @property {'unverified'} confidence Incident confidence remains unverified.
 * @property {{kind:'geocoder',source:string,confidence:number|null,verified:true,incidentConfirmed:false}} provenance
 * @property {string} summary
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} time_utc Creation time, not an alleged incident timestamp.
 * @property {number} durationSec
 * @property {true} preserveMapLabels
 * @property {false} imagerySynthesis
 * @property {GeographicKeyframe[]} keyframes
 * @property {GeographicStep[]} steps
 * @property {string[]} incident_ids Always empty: not a confirmed or reported incident.
 * @property {Object[]} markers
 * @property {Object[]} evidence
 * @property {Object[]} timeline_events
 * @property {{state:'idle',position:0}} playback
 */

function label(value, limit = 200) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, limit)
    : '';
}
function identifier(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(value)
    ? value
    : fallback;
}
function iso(value) {
  if (
    !(value instanceof Date) &&
    typeof value !== 'number' &&
    typeof value !== 'string'
  )
    throw new TypeError('now must be a Date, timestamp, or ISO date string');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError('invalid scene timestamp');
  return date.toISOString();
}
function coordinate(value, limit) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit
  );
}
function destination(lat, lon, distanceM, bearing) {
  if (!distanceM) return { lat, lon };
  const radians = Math.PI / 180;
  const phi = lat * radians;
  const lambda = lon * radians;
  const theta = bearing * radians;
  const distance = distanceM / EARTH_RADIUS_M;
  const nextPhi = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        Math.sin(phi) * Math.cos(distance) +
          Math.cos(phi) * Math.sin(distance) * Math.cos(theta),
      ),
    ),
  );
  const nextLambda =
    lambda +
    Math.atan2(
      Math.sin(theta) * Math.sin(distance) * Math.cos(phi),
      Math.cos(distance) - Math.sin(phi) * Math.sin(nextPhi),
    );
  return {
    lat: nextPhi / radians,
    lon: ((nextLambda / radians + 540) % 360) - 180,
  };
}

/**
 * Build four deliberate shots around a validated location. Caller must resolve/validate
 * the candidate first; numeric coordinates alone or AI-extracted coordinates are not proof.
 * extraction/text are accepted for call-site compatibility but intentionally not persisted:
 * the geocoder's resolved name defines the plan, never an untrusted requested place.
 * No input mutation, clock reads, random IDs, storage access, or imagery synthesis.
 * @param {{candidate:GeographicCandidate,extraction?:Object,text?:string,now?:Date|string|number}} input
 * @returns {GeographicScene}
 * @throws {TypeError} Invalid/unverified candidate or timestamp.
 */
export function buildGeographicScene(input = {}) {
  if (input.plan != null) return buildPlannedScene(input);
  const { candidate, now = 0 } = input;
  if (
    !candidate ||
    (candidate.verified !== true && candidate.validated !== true) ||
    candidate.verified === false ||
    candidate.validated === false ||
    candidate.source === 'ondemand-entity-extraction'
  )
    throw new TypeError('a verified geocoder candidate is required');
  if (!coordinate(candidate.lat, 90) || !coordinate(candidate.lon, 180))
    throw new TypeError('candidate needs finite WGS84 coordinates');
  const name = label(candidate.name);
  if (!name) throw new TypeError('candidate needs a resolved place name');
  const lat = Object.is(candidate.lat, -0) ? 0 : candidate.lat;
  const lon = Object.is(candidate.lon, -0) ? 0 : candidate.lon;
  const source = identifier(candidate.source, 'geocoder');
  const marina = /\bdubai\s+marina\b/i.test(name);
  const kind = marina ? 'waterfront-orbit' : 'geographic-orbit';
  // Encoding the complete canonical tuple avoids truncation/hash collisions and keeps
  // co-located but differently named/provider-derived candidates distinct. Never use text.
  const id = `geo-scene-v1-${encodeURIComponent(JSON.stringify([kind, source, name, lat, lon]))}`;
  const time = iso(now);
  const aoi = identifier(
    candidate.aoi_membership?.aoi_ids?.[0] ?? candidate.aoi,
    'geographic',
  );
  const locationConfidence =
    typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1
      ? candidate.confidence
      : null;
  const titles = marina
    ? [
        'Basin overview',
        'Marina Walk waterfront',
        'Inlet / JBR waterfront',
        'Orbit closure',
      ]
    : [
        'Area overview',
        'Near-side context',
        'Far-side context',
        'Orbit closure',
      ];
  const bearings = [30, 120, 210, 300];
  const heights = [2400, 1200, 900, 1800];
  const pitches = [-62, -48, -42, -58];
  const offsets = [0, 8, 18, 28];
  // Small relative waypoints only; Marina Walk and JBR have NOT been separately geocoded.
  const positions = [
    { lat, lon },
    destination(lat, lon, 350, 45),
    destination(lat, lon, 650, 240),
    { lat, lon },
  ];
  const keyframes = positions.map((point, i) => ({
    label: titles[i],
    ...point,
    zoom: Math.log2(
      (156543.03 * Math.cos((point.lat * Math.PI) / 180) * 1200) / heights[i],
    ),
    altitudeM: heights[i],
    bearing: bearings[i],
    pitch: pitches[i],
    time: offsets[i] / 28,
    timeOffsetSec: offsets[i],
  }));
  const steps = keyframes.map((frame, i) => ({
    id: `${id}-step-${i + 1}`,
    title: frame.label,
    timeOffsetSec: offsets[i],
    durationSec: i < 3 ? offsets[i + 1] - offsets[i] : 0,
    camera: {
      lat: frame.lat,
      lon: frame.lon,
      alt: frame.altitudeM,
      heading: frame.bearing,
      pitch: frame.pitch,
      roll: 0,
      altitudeReference: 'ellipsoid',
    },
    provenance: 'relative-geographic-waypoint',
    landmarkVerified: false,
  }));
  return {
    schema: SCHEMA,
    version: GEOGRAPHIC_SCENE_VERSION,
    id,
    title: marina
      ? 'Dubai Marina — Waterfront Orbit'
      : `${name} — Geographic Orbit`,
    geographic: true,
    category: 'geographic',
    anchor: { name, lat, lon },
    aoi,
    aoiRadiusM: 1200,
    confidence: 'unverified',
    provenance: {
      kind: 'geocoder',
      source,
      confidence: locationConfidence,
      verified: true,
      incidentConfirmed: false,
      ...(typeof candidate.sourceUrl === 'string' &&
      /^https:\/\/(www\.)?(openstreetmap\.org|nominatim\.openstreetmap\.org)\//.test(
        candidate.sourceUrl,
      )
        ? { sourceUrl: candidate.sourceUrl.split('?')[0].split('#')[0] }
        : {}),
      ...(candidate.observedAt
        ? { observedAt: iso(candidate.observedAt) }
        : {}),
    },
    summary:
      'Geographic camera plan around a verified geocoder anchor; not a confirmed incident. ' +
      'All intermediate camera targets are illustrative relative offsets, not separately verified landmarks. ' +
      'Existing map imagery and labels are preserved; no imagery is synthesized.',
    createdAt: time,
    updatedAt: time,
    time_utc: time,
    durationSec: 28,
    preserveMapLabels: true,
    imagerySynthesis: false,
    keyframes,
    steps,
    incident_ids: [],
    markers: [],
    evidence: [],
    timeline_events: [],
    playback: { state: 'idle', position: 0 },
  };
}

/** Convert authored east/north metre offsets to WGS84, including antimeridian wrapping. */
export function localOffsetToWgs84(anchor, eastM, northM) {
  if (
    !coordinate(anchor?.lat, 90) ||
    !coordinate(anchor?.lon, 180) ||
    !Number.isFinite(eastM) ||
    !Number.isFinite(northM)
  )
    throw new TypeError('invalid local coordinate');
  return destination(
    anchor.lat,
    anchor.lon,
    Math.hypot(eastM, northM),
    (Math.atan2(eastM, northM) * 180) / Math.PI,
  );
}

function validatedPlan(raw) {
  // Accept the shared validator's direct-plan and {ok,plan} interfaces; never use
  // raw provider JSON if validation did not produce a plan.
  const result = validateScenePlan(raw);
  if (!result || result.ok === false || result.valid === false)
    throw new TypeError('invalid structured scene plan');
  const plan = result.plan || (result.version === 1 ? result : null);
  if (
    !plan ||
    plan.version !== 1 ||
    plan.illustrative !== true ||
    !Number.isFinite(plan.durationSec) ||
    plan.durationSec < 5 ||
    plan.durationSec > 180 ||
    !Array.isArray(plan.entities) ||
    !Array.isArray(plan.beats) ||
    !Array.isArray(plan.citations)
  )
    throw new TypeError('invalid structured scene plan');
  if (plan.location?.sourceUrl) safeUrl(plan.location.sourceUrl);
  citations(plan.citations);
  return cloneData(plan);
}

const FOOTPRINT = Object.freeze({
  person: 0.65,
  runner: 0.7,
  police: 0.65,
  organizer: 0.65,
  vehicle: 2.8,
  police_vehicle: 2.8,
  barrier: 1.25,
  start_line: 3.2,
  finish_line: 3.2,
});

/** One deterministic ground placement per quantity, centered rows facing heading.
 * Inter-group collisions use a deterministic local search, never random jitter. */
function placeEntities(plan) {
  const placements = [];
  for (const entity of plan.entities) {
    if (
      !Object.hasOwn(FOOTPRINT, entity.type) ||
      !Number.isInteger(entity.quantity) ||
      entity.quantity < 1 ||
      entity.quantity > 500 ||
      placements.length + entity.quantity > 1000
    )
      throw new TypeError('invalid or excessive scene entity quantity');
    const radius = FOOTPRINT[entity.type];
    const columns =
      entity.type === 'barrier'
        ? entity.quantity
        : Math.ceil(Math.sqrt(entity.quantity));
    const rows = Math.ceil(entity.quantity / columns);
    const spacing = radius * 2 + 0.5;
    const angle = (entity.heading * Math.PI) / 180;
    for (let i = 0; i < entity.quantity; i++) {
      const row = Math.floor(i / columns);
      const rowCount = Math.min(columns, entity.quantity - row * columns);
      const right = ((i % columns) - (rowCount - 1) / 2) * spacing;
      const forward = ((rows - 1) / 2 - row) * spacing;
      const baseEast =
        entity.position.eastM +
        right * Math.cos(angle) +
        forward * Math.sin(angle);
      const baseNorth =
        entity.position.northM -
        right * Math.sin(angle) +
        forward * Math.cos(angle);
      let eastM = baseEast,
        northM = baseNorth,
        attempt = 0;
      while (
        placements.some(
          (p) =>
            Math.hypot(p.position.eastM - eastM, p.position.northM - northM) <
            radius + FOOTPRINT[p.type] + 0.15,
        )
      ) {
        if (++attempt > 4000)
          throw new TypeError('scene formation is too dense');
        const distance = spacing * Math.sqrt(attempt);
        const theta = attempt * 2.399963229728653;
        eastM = baseEast + distance * Math.cos(theta);
        northM = baseNorth + distance * Math.sin(theta);
      }
      placements.push({
        id: `${entity.id}-${i + 1}`,
        entityId: entity.id,
        index: i,
        type: entity.type,
        label: entity.label,
        heading: entity.heading,
        position: { eastM, northM },
        ...localOffsetToWgs84(plan.location, eastM, northM),
        illustrative: true,
        incidentConfirmed: false,
      });
    }
  }
  return placements;
}
function fingerprint(value) {
  let a = 2166136261,
    b = 2246822519;
  for (const ch of JSON.stringify(value)) {
    a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
    b = Math.imul(b ^ ch.charCodeAt(0), 3266489917);
  }
  return (
    (a >>> 0).toString(16).padStart(8, '0') +
    (b >>> 0).toString(16).padStart(8, '0')
  );
}

/** Build real entity coordinates and beat-driven camera shots from validated staging.
 * A validated geocoder candidate is required; plan/candidate disagreement is rejected.
 * No wall-clock reads, provider calls, generated imagery or confirmed incident claims. */
export function buildPlannedScene({
  plan: inputPlan,
  candidate,
  text = '',
  originalPrompt,
  selectedTime = null,
  now = 0,
} = {}) {
  const plan = validatedPlan(inputPlan);
  const base = buildGeographicScene({ candidate, now });
  if (
    plan.location.name !== base.anchor.name ||
    (plan.location.sourceUrl &&
      candidate.sourceUrl &&
      plan.location.sourceUrl !== candidate.sourceUrl)
  )
    throw new TypeError(
      'plan location name and provenance must match the verified candidate',
    );
  if (
    Math.abs(plan.location.lat - base.anchor.lat) > 1e-6 ||
    Math.abs(((plan.location.lon - base.anchor.lon + 540) % 360) - 180) > 1e-6
  )
    throw new TypeError(
      'plan location must match the verified geocoder candidate',
    );
  const placements = placeEntities(plan);
  const id = `${base.id}-plan-${fingerprint(plan)}`;
  const beats = [...plan.beats];
  if (!beats.length || beats[0].atSec > 0)
    beats.unshift({
      atSec: 0,
      title: 'Illustrative overview',
      narration: '',
      entityIds: [],
    });
  const timed = beats.map((beat, index) => ({
    beat,
    beatIndex: plan.beats.indexOf(beat),
    index,
  }));
  if (beats.at(-1).atSec < plan.durationSec)
    timed.push({
      beat: { ...beats.at(-1), atSec: plan.durationSec },
      beatIndex: plan.beats.indexOf(beats.at(-1)),
      index: timed.length,
    });
  const keyframes = timed.map(({ beat, beatIndex }) => {
    const camera = beat.camera || plan.camera;
    const focus = placements.filter((p) => beat.entityIds.includes(p.entityId));
    const position = focus.length
      ? {
          eastM: focus.reduce((n, p) => n + p.position.eastM, 0) / focus.length,
          northM:
            focus.reduce((n, p) => n + p.position.northM, 0) / focus.length,
        }
      : { eastM: 0, northM: 0 };
    const point = localOffsetToWgs84(
      plan.location,
      position.eastM,
      position.northM,
    );
    const altitudeM =
      camera.distanceM * Math.sin((Math.abs(camera.pitch) * Math.PI) / 180);
    return {
      label: beat.title,
      ...point,
      altitudeM,
      zoom: Math.log2(
        (156543.03 *
          Math.max(1e-8, Math.cos((point.lat * Math.PI) / 180)) *
          1200) /
          altitudeM,
      ),
      bearing: camera.heading,
      pitch: camera.pitch,
      distanceM: camera.distanceM,
      framing: camera.framing,
      time: beat.atSec / plan.durationSec,
      timeOffsetSec: beat.atSec,
      beatIndex,
      illustrative: true,
    };
  });
  const steps = keyframes.map((frame, index) => {
    const groundDistance =
      frame.distanceM * Math.cos((Math.abs(frame.pitch) * Math.PI) / 180);
    const eye = destination(
      frame.lat,
      frame.lon,
      groundDistance,
      frame.bearing + 180,
    );
    const beat = timed[index].beat;
    return {
      id: `${id}-step-${index + 1}`,
      title: frame.label,
      timeOffsetSec: frame.timeOffsetSec,
      durationSec:
        (keyframes[index + 1]?.timeOffsetSec ?? plan.durationSec) -
        frame.timeOffsetSec,
      beatIndex: frame.beatIndex,
      narration: beat.narration,
      entityIds: [...beat.entityIds],
      camera: {
        ...eye,
        alt: frame.altitudeM,
        heading: frame.bearing,
        pitch: frame.pitch,
        roll: 0,
        altitudeReference: 'ellipsoid',
      },
      provenance: 'illustrative-staging',
      landmarkVerified: false,
      illustrative: true,
    };
  });
  return {
    ...base,
    version: PLANNED_SCENE_VERSION,
    id,
    title: plan.title,
    illustrative: true,
    anchor: { ...base.anchor },
    summary:
      'Illustrative staging on a verified geographic anchor; not a confirmed incident. ' +
      'People, vehicles, barriers, relationships and narration are authored illustrations, not observed facts.',
    aoiRadiusM: Math.max(
      100,
      ...placements.map(
        (p) => Math.hypot(p.position.eastM, p.position.northM) + 25,
      ),
    ),
    plan,
    placements,
    durationSec: plan.durationSec,
    keyframes,
    steps,
    originalPrompt: safeText(originalPrompt ?? text, 16000),
    refinedPrompt: safeText(text, 16000),
    selectedTime: savedTime(selectedTime),
    chat: [],
    citations: citations(plan.citations),
    cameraSelection: 'plan',
    cameraState: cloneData(plan.camera),
    hashSnapshot: {},
    narrationConfig: { enabled: false },
  };
}

// Persistence accepts JSON data only. No class instances, binary/audio blobs,
// prototype keys, account/provider credentials or credential-bearing URLs.
const FORBIDDEN_KEY =
  /^(?:__proto__|prototype|constructor|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret|credentials|audio|audioBlob|audioData|blob)$/i;
const isUnsafeKey = (key) =>
  FORBIDDEN_KEY.test(key) ||
  /(?:apikey|accesstoken|refreshtoken|clientsecret|authorization|password|credential|privatekey|audioblob|audiodata)$/i.test(
    key.replace(/[-_]/g, ''),
  );
const SECRET_TEXT =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-z0-9._~+/-]{8,}|\bsk-[a-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|(?:api[_-]?key|access[_-]?token|password)\s*[=:]\s*[^\s&,;]{6,}|data:audio\/)/i;
function safeText(value, max = 16000) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    SECRET_TEXT.test(value)
  )
    throw new TypeError('unsafe or malformed scene text');
  return value;
}
function cloneData(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 30000 || depth > 12)
    throw new TypeError('excessive scene metadata');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return safeText(value, 64000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 2000) throw new TypeError('excessive scene metadata');
    return value.map((v) => cloneData(v, depth + 1, budget));
  }
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('non-JSON scene metadata');
  const out = {};
  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key) || key.length > 200)
      throw new TypeError('unsafe scene metadata key');
    out[key] = cloneData(value[key], depth + 1, budget);
  }
  return out;
}
function record(raw, keys) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    throw new TypeError('unknown or malformed scene metadata field');
  return cloneData(
    Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value !== undefined),
    ),
  );
}
function savedTime(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return safeText(raw, 200);
  const out = record(raw, [
    'windowHours',
    'timeMode',
    'windowStart',
    'windowEnd',
    'date',
    'time',
    'timezone',
    'start',
    'end',
  ]);
  if (
    out.windowHours != null &&
    (!Number.isFinite(out.windowHours) ||
      out.windowHours <= 0 ||
      out.windowHours > 8784)
  )
    throw new TypeError('invalid selected time');
  if (
    out.timeMode != null &&
    ![
      'recent',
      'custom',
      'historical',
      'range',
      'absolute',
      'relative',
      'date',
    ].includes(out.timeMode)
  )
    throw new TypeError('invalid selected time mode');
  for (const [key, value] of Object.entries(out))
    if (key !== 'windowHours' && typeof value !== 'string')
      throw new TypeError('invalid selected time');
  return out;
}
function safeUrl(raw) {
  const value = safeText(raw, 4096);
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !host.includes('.') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    /^(?:\d+\.){3}\d+$/.test(host) ||
    host.includes(':') ||
    [...url.searchParams.keys()].some(isUnsafeKey)
  )
    throw new TypeError('unsafe citation URL');
  return value;
}
function citations(raw) {
  if (!Array.isArray(raw) || raw.length > 100)
    throw new TypeError('invalid citations');
  return raw.map((value) => {
    const out = record(value, ['url', 'title', 'publishedAt']);
    out.url = safeUrl(out.url);
    for (const key of ['title', 'publishedAt'])
      if (out[key] != null) out[key] = safeText(out[key], 1000);
    return out;
  });
}
const SESSION_FIELDS = [
  'originalPrompt',
  'refinedPrompt',
  'selectedTime',
  'chat',
  'citations',
  'cameraSelection',
  'cameraState',
  'hashSnapshot',
  'narrationConfig',
];
function sessionSnapshot(raw) {
  const out = {};
  for (const field of SESSION_FIELDS) {
    if (!Object.hasOwn(raw, field)) continue;
    const value = raw[field];
    if (field === 'originalPrompt' || field === 'refinedPrompt')
      out[field] = safeText(value);
    else if (field === 'selectedTime') out[field] = savedTime(value);
    else if (field === 'citations') out[field] = citations(value);
    else if (field === 'chat') {
      if (!Array.isArray(value) || value.length > 200)
        throw new TypeError('invalid saved chat');
      out[field] = value.map((item) => {
        const msg = record(item, [
          'role',
          'content',
          'text',
          'id',
          'at',
          'timestamp',
          'createdAt',
        ]);
        if (
          !['user', 'assistant'].includes(msg.role) ||
          (typeof msg.content !== 'string' && typeof msg.text !== 'string')
        )
          throw new TypeError('invalid saved chat message');
        for (const key of Object.keys(msg)) {
          if (
            ['at', 'timestamp', 'createdAt'].includes(key) &&
            typeof msg[key] === 'number'
          ) {
            if (!Number.isFinite(msg[key]))
              throw new TypeError('invalid chat timestamp');
          } else safeText(msg[key]);
        }
        return msg;
      });
    } else if (field === 'hashSnapshot') {
      // Deliberately opaque: do not rename/filter original hash keys, interpret
      // camera/viewer settings or replace the existing URL state schema.
      out[field] = cloneData(value);
      if (
        value === null ||
        (typeof value !== 'string' &&
          (typeof value !== 'object' || Array.isArray(value)))
      )
        throw new TypeError('invalid hash snapshot');
    } else if (field === 'cameraSelection') {
      out[field] =
        typeof value === 'string'
          ? safeText(value, 200)
          : record(value, [
              'mode',
              'preset',
              'entityId',
              'beatIndex',
              'id',
              'index',
            ]);
      if (typeof out[field] === 'object')
        for (const [key, selected] of Object.entries(out[field])) {
          if (['beatIndex', 'index'].includes(key)) {
            if (!Number.isInteger(selected) || selected < 0 || selected > 1000)
              throw new TypeError('invalid camera selection');
          } else safeText(selected, 200);
        }
    } else if (field === 'cameraState') {
      const camera = record(value, [
        'lat',
        'lon',
        'alt',
        'altitudeM',
        'heading',
        'bearing',
        'pitch',
        'roll',
        'distanceM',
        'framing',
        'position',
        'direction',
        'up',
        'target',
      ]);
      for (const [key, n] of Object.entries(camera)) {
        if (['position', 'direction', 'up', 'target'].includes(key)) {
          const vector = record(n, ['x', 'y', 'z', 'lat', 'lon', 'alt']);
          if (Object.values(vector).some((v) => !Number.isFinite(v)))
            throw new TypeError('invalid camera vector');
        } else if (key === 'framing') {
          if (!['wide', 'medium', 'close'].includes(n))
            throw new TypeError('invalid camera framing');
        } else if (!Number.isFinite(n))
          throw new TypeError('invalid camera value');
      }
      if (
        (camera.lat != null && !coordinate(camera.lat, 90)) ||
        (camera.lon != null && !coordinate(camera.lon, 180)) ||
        (camera.distanceM != null && camera.distanceM <= 0) ||
        (camera.pitch != null && Math.abs(camera.pitch) > 90) ||
        (camera.heading != null && Math.abs(camera.heading) > 360)
      )
        throw new TypeError('invalid camera state');
      out[field] = camera;
    } else if (field === 'narrationConfig') {
      const narration = record(value, [
        'enabled',
        'muted',
        'voice',
        'voiceId',
        'modelId',
        'voiceURI',
        'lang',
        'language',
        'rate',
        'pitch',
        'volume',
        'provider',
        'text',
        'stability',
        'similarity_boost',
        'similarityBoost',
        'speed',
        'style',
        'use_speaker_boost',
        'useSpeakerBoost',
        'autoGenerate',
      ]);
      for (const [key, v] of Object.entries(narration)) {
        if (
          [
            'enabled',
            'muted',
            'use_speaker_boost',
            'useSpeakerBoost',
            'autoGenerate',
          ].includes(key)
        ) {
          if (typeof v !== 'boolean')
            throw new TypeError('invalid narration flag');
        } else if (
          [
            'rate',
            'pitch',
            'volume',
            'stability',
            'similarity_boost',
            'similarityBoost',
            'speed',
            'style',
          ].includes(key)
        ) {
          const limits =
            key === 'rate'
              ? [0.1, 10]
              : key === 'pitch'
                ? [0, 2]
                : key === 'speed'
                  ? [0.7, 1.2]
                  : [0, 1];
          if (!Number.isFinite(v) || v < limits[0] || v > limits[1])
            throw new TypeError('invalid narration value');
        } else safeText(v);
      }
      out[field] = narration;
    }
  }
  return out;
}

function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

/** Preserve the exact v1 authored camera invariants. Unrecognized legacy input
 * fields are discarded on save; allowlisted session notes are handled separately. */
function legacySnapshot(raw) {
  if (!raw || typeof raw !== 'object')
    throw new TypeError('invalid geographic scene');
  const expected = buildGeographicScene({
    candidate: {
      name: raw.anchor?.name,
      lat: raw.anchor?.lat,
      lon: raw.anchor?.lon,
      verified: true,
      source: raw.provenance?.source,
      confidence: raw.provenance?.confidence,
      sourceUrl: raw.provenance?.sourceUrl,
      observedAt: raw.provenance?.observedAt,
      aoi: raw.aoi,
    },
    now: raw.createdAt,
  });
  for (const key of Object.keys(expected)) {
    if (
      key !== 'title' &&
      key !== 'updatedAt' &&
      !equal(expected[key], raw[key])
    )
      throw new TypeError(`invalid geographic scene field: ${key}`);
  }
  const title = label(raw.title, 300);
  if (
    !title ||
    title !== raw.title ||
    typeof raw.updatedAt !== 'string' ||
    iso(raw.updatedAt) !== raw.updatedAt
  )
    throw new TypeError('invalid scene title or timestamp');
  expected.title = title;
  expected.updatedAt = raw.updatedAt;
  return expected;
}

function snapshot(raw, { stored = false } = {}) {
  if (raw?.version === GEOGRAPHIC_SCENE_VERSION) {
    const legacy = legacySnapshot(raw);
    if (
      stored &&
      Object.keys(raw).some(
        (key) => !Object.hasOwn(legacy, key) && !SESSION_FIELDS.includes(key),
      )
    )
      throw new TypeError('unknown stored scene field');
    return { ...legacy, ...sessionSnapshot(raw) };
  }
  if (!raw || raw.version !== PLANNED_SCENE_VERSION)
    throw new TypeError('invalid scene version');
  const expected = buildPlannedScene({
    plan: raw.plan,
    candidate: {
      name: raw.anchor?.name,
      lat: raw.anchor?.lat,
      lon: raw.anchor?.lon,
      verified: true,
      source: raw.provenance?.source,
      confidence: raw.provenance?.confidence,
      aoi: raw.aoi,
      sourceUrl: raw.provenance?.sourceUrl,
      observedAt: raw.provenance?.observedAt,
    },
    text: raw.refinedPrompt,
    originalPrompt: raw.originalPrompt,
    selectedTime: raw.selectedTime,
    now: raw.createdAt,
  });
  const mutable = new Set(['title', 'updatedAt', ...SESSION_FIELDS]);
  if (Object.keys(raw).some((key) => !Object.hasOwn(expected, key)))
    throw new TypeError('unknown planned scene field');
  for (const key of Object.keys(expected)) {
    if (!mutable.has(key) && !equal(expected[key], raw[key]))
      throw new TypeError(`invalid planned scene field: ${key}`);
  }
  if (
    !raw.title ||
    safeText(raw.title, 300).trim() !== raw.title ||
    iso(raw.updatedAt) !== raw.updatedAt
  )
    throw new TypeError('invalid scene title or timestamp');
  return {
    ...expected,
    title: raw.title,
    updatedAt: raw.updatedAt,
    ...sessionSnapshot(raw),
  };
}

/**
 * @typedef {{saved:true,id:string,scene:GeographicScene}|{saved:false,reason:string}} GeographicSaveResult
 */
/**
 * Inject browser localStorage (or a Storage-like test double); never touches globals.
 * Each mutation re-reads storage, writes once and checks readback. There is no optimistic
 * in-memory cache: quota/security/write errors cannot masquerade as a successful save.
 * Invalid/corrupt envelopes load as null/[] and are never silently overwritten by save.
 * Valid v1 envelopes are read without writes and migrated to v2 on the next save.
 * Structured scenes are rebuilt from their validated plan and derived geometry is
 * checked before accepting the explicit session-field allowlist. getStatus()
 * exposes corrupt/unavailable storage without discarding its contents.
 * IDs and titles are separate; rename preserves identity. Synchronous Storage does not
 * offer cross-tab compare-and-swap, so simultaneous tab writes remain last-writer-wins.
 * @param {{getItem:Function,setItem:Function}|null|undefined} storage
 * @returns {{load:(id:string)=>GeographicScene|null,list:()=>GeographicScene[],save:(scene:GeographicScene)=>GeographicSaveResult,rename:(id:string,title:string,options?:{now?:Date|string|number})=>GeographicSaveResult}}
 */
export function createGeographicSceneStore(storage) {
  function read() {
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    )
      return { ok: false, reason: 'storage-unavailable' };
    let text;
    try {
      text = storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY);
    } catch {
      return { ok: false, reason: 'storage-unavailable' };
    }
    if (text === null) return { ok: true, scenes: [] };
    try {
      if (typeof text !== 'string' || text.length > MAX_STORAGE_CHARS)
        throw new Error();
      const data = JSON.parse(text);
      if (
        data.schema !== SCHEMA ||
        ![GEOGRAPHIC_SCENE_VERSION, GEOGRAPHIC_SCENE_STORAGE_VERSION].includes(
          data.version,
        ) ||
        !Array.isArray(data.scenes) ||
        data.scenes.length > MAX_SCENES
      )
        throw new Error();
      if (
        Object.keys(data).some(
          (k) => !['schema', 'version', 'scenes'].includes(k),
        )
      )
        throw new Error();
      const scenes = data.scenes.map((item) =>
        snapshot(item, { stored: true }),
      );
      if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length)
        throw new Error();
      return { ok: true, scenes };
    } catch {
      return { ok: false, reason: 'corrupt-storage' };
    }
  }
  function save(raw) {
    let scene;
    try {
      scene = snapshot(raw);
    } catch {
      return { saved: false, reason: 'invalid-scene' };
    }
    const current = read();
    if (!current.ok) return { saved: false, reason: current.reason };
    const scenes = [...current.scenes];
    const index = scenes.findIndex((item) => item.id === scene.id);
    if (index >= 0) scenes[index] = scene;
    else scenes.push(scene);
    if (scenes.length > MAX_SCENES)
      return { saved: false, reason: 'capacity-exceeded' };
    const text = JSON.stringify({
      schema: SCHEMA,
      version: GEOGRAPHIC_SCENE_STORAGE_VERSION,
      scenes,
    });
    if (text.length > MAX_STORAGE_CHARS)
      return { saved: false, reason: 'capacity-exceeded' };
    try {
      storage.setItem(GEOGRAPHIC_SCENE_STORAGE_KEY, text);
      if (storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY) !== text)
        return { saved: false, reason: 'write-not-persisted' };
    } catch (error) {
      return {
        saved: false,
        reason:
          error?.name === 'QuotaExceededError' ||
          error?.code === 22 ||
          error?.code === 1014
            ? 'quota-exceeded'
            : 'storage-write-failed',
      };
    }
    return { saved: true, id: scene.id, scene };
  }
  function load(id) {
    const current = read();
    return current.ok
      ? current.scenes.find((scene) => scene.id === id) || null
      : null;
  }
  function list() {
    const current = read();
    return current.ok ? current.scenes : [];
  }
  function rename(id, title, { now = new Date() } = {}) {
    if (!label(title, 300) || label(title, 300) !== title)
      return { saved: false, reason: 'invalid-title' };
    const current = read();
    if (!current.ok) return { saved: false, reason: current.reason };
    const scene = current.scenes.find((item) => item.id === id);
    if (!scene) return { saved: false, reason: 'not-found' };
    let updatedAt;
    try {
      updatedAt = iso(now);
    } catch {
      return { saved: false, reason: 'invalid-timestamp' };
    }
    return save({ ...scene, title, updatedAt });
  }
  return Object.freeze({
    load,
    save,
    list,
    rename,
    getStatus() {
      const state = read();
      return {
        available: state.ok,
        reason: state.ok ? null : state.reason,
        persistence: 'browser-local',
        version: GEOGRAPHIC_SCENE_STORAGE_VERSION,
      };
    },
  });
}
