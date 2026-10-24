/** Pure, geocoder-derived camera plans. No provider calls, imagery generation, or incident claims. */
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
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit)
    : '';
}
function identifier(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,80}$/i.test(value)
    ? value
    : fallback;
}
function iso(value) {
  if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string')
    throw new TypeError('now must be a Date, timestamp, or ISO date string');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('invalid scene timestamp');
  return date.toISOString();
}
function coordinate(value, limit) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}
function destination(lat, lon, distanceM, bearing) {
  if (!distanceM) return { lat, lon };
  const radians = Math.PI / 180;
  const phi = lat * radians;
  const lambda = lon * radians;
  const theta = bearing * radians;
  const distance = distanceM / EARTH_RADIUS_M;
  const nextPhi = Math.asin(Math.max(-1, Math.min(1,
    Math.sin(phi) * Math.cos(distance) + Math.cos(phi) * Math.sin(distance) * Math.cos(theta))));
  const nextLambda = lambda + Math.atan2(
    Math.sin(theta) * Math.sin(distance) * Math.cos(phi),
    Math.cos(distance) - Math.sin(phi) * Math.sin(nextPhi));
  return { lat: nextPhi / radians, lon: ((nextLambda / radians + 540) % 360) - 180 };
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
  const { candidate, now = 0 } = input;
  if (!candidate || (candidate.verified !== true && candidate.validated !== true) ||
      candidate.verified === false || candidate.validated === false ||
      candidate.source === 'ondemand-entity-extraction')
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
  const aoi = identifier(candidate.aoi_membership?.aoi_ids?.[0] ?? candidate.aoi, 'geographic');
  const locationConfidence = typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1
    ? candidate.confidence : null;
  const titles = marina
    ? ['Basin overview', 'Marina Walk waterfront', 'Inlet / JBR waterfront', 'Orbit closure']
    : ['Area overview', 'Near-side context', 'Far-side context', 'Orbit closure'];
  const bearings = [30, 120, 210, 300];
  const heights = [2400, 1200, 900, 1800];
  const pitches = [-62, -48, -42, -58];
  const offsets = [0, 8, 18, 28];
  // Small relative waypoints only; Marina Walk and JBR have NOT been separately geocoded.
  const positions = [
    { lat, lon }, destination(lat, lon, 350, 45),
    destination(lat, lon, 650, 240), { lat, lon },
  ];
  const keyframes = positions.map((point, i) => ({
    label: titles[i], ...point,
    zoom: Math.log2(156543.03 * Math.cos(point.lat * Math.PI / 180) * 1200 / heights[i]),
    altitudeM: heights[i], bearing: bearings[i], pitch: pitches[i],
    time: offsets[i] / 28, timeOffsetSec: offsets[i],
  }));
  const steps = keyframes.map((frame, i) => ({
    id: `${id}-step-${i + 1}`, title: frame.label, timeOffsetSec: offsets[i],
    durationSec: i < 3 ? offsets[i + 1] - offsets[i] : 0,
    camera: { lat: frame.lat, lon: frame.lon, alt: frame.altitudeM,
      heading: frame.bearing, pitch: frame.pitch, roll: 0, altitudeReference: 'ellipsoid' },
    provenance: 'relative-geographic-waypoint', landmarkVerified: false,
  }));
  return {
    schema: SCHEMA, version: GEOGRAPHIC_SCENE_VERSION, id,
    title: marina ? 'Dubai Marina — Waterfront Orbit' : `${name} — Geographic Orbit`,
    geographic: true, category: 'geographic', anchor: { name, lat, lon }, aoi,
    aoiRadiusM: 1200, confidence: 'unverified',
    provenance: { kind: 'geocoder', source, confidence: locationConfidence,
      verified: true, incidentConfirmed: false,
      ...(typeof candidate.sourceUrl === 'string' && /^https:\/\/(www\.)?(openstreetmap\.org|nominatim\.openstreetmap\.org)\//.test(candidate.sourceUrl) ? { sourceUrl: candidate.sourceUrl.split('?')[0].split('#')[0] } : {}),
      ...(candidate.observedAt ? { observedAt: iso(candidate.observedAt) } : {}),
    },
    summary: 'Geographic camera plan around a verified geocoder anchor; not a confirmed incident. ' +
      'All intermediate camera targets are illustrative relative offsets, not separately verified landmarks. ' +
      'Existing map imagery and labels are preserved; no imagery is synthesized.',
    createdAt: time, updatedAt: time, time_utc: time, durationSec: 28,
    preserveMapLabels: true, imagerySynthesis: false, keyframes, steps,
    incident_ids: [], markers: [], evidence: [], timeline_events: [],
    playback: { state: 'idle', position: 0 },
  };
}

function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
    return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.hasOwn(b, key) && equal(a[key], b[key]));
}

/** Rebuild an allowlisted snapshot and validate every authored invariant. Unknown
 * root fields (tokens, raw provider responses, request text) never enter storage. */
function snapshot(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('invalid geographic scene');
  const expected = buildGeographicScene({
    candidate: { name: raw.anchor?.name, lat: raw.anchor?.lat, lon: raw.anchor?.lon,
      verified: true, source: raw.provenance?.source, confidence: raw.provenance?.confidence,
      sourceUrl: raw.provenance?.sourceUrl, observedAt: raw.provenance?.observedAt,
      aoi: raw.aoi }, now: raw.createdAt,
  });
  for (const key of Object.keys(expected)) {
    if (key !== 'title' && key !== 'updatedAt' && !equal(expected[key], raw[key]))
      throw new TypeError(`invalid geographic scene field: ${key}`);
  }
  const title = label(raw.title, 300);
  if (!title || title !== raw.title || typeof raw.updatedAt !== 'string' || iso(raw.updatedAt) !== raw.updatedAt)
    throw new TypeError('invalid scene title or timestamp');
  expected.title = title;
  expected.updatedAt = raw.updatedAt;
  return expected;
}

/**
 * @typedef {{saved:true,id:string,scene:GeographicScene}|{saved:false,reason:string}} GeographicSaveResult
 */
/**
 * Inject browser localStorage (or a Storage-like test double); never touches globals.
 * Each mutation re-reads storage, writes once and checks readback. There is no optimistic
 * in-memory cache: quota/security/write errors cannot masquerade as a successful save.
 * Invalid/corrupt envelopes load as null/[] and are never silently overwritten by save.
 * IDs and titles are separate; rename preserves identity. Synchronous Storage does not
 * offer cross-tab compare-and-swap, so simultaneous tab writes remain last-writer-wins.
 * @param {{getItem:Function,setItem:Function}|null|undefined} storage
 * @returns {{load:(id:string)=>GeographicScene|null,list:()=>GeographicScene[],save:(scene:GeographicScene)=>GeographicSaveResult,rename:(id:string,title:string,options?:{now?:Date|string|number})=>GeographicSaveResult}}
 */
export function createGeographicSceneStore(storage) {
  function read() {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')
      return { ok: false, reason: 'storage-unavailable' };
    let text;
    try { text = storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY); }
    catch { return { ok: false, reason: 'storage-unavailable' }; }
    if (text === null) return { ok: true, scenes: [] };
    try {
      if (typeof text !== 'string' || text.length > MAX_STORAGE_CHARS) throw new Error();
      const data = JSON.parse(text);
      if (data.schema !== SCHEMA || data.version !== GEOGRAPHIC_SCENE_VERSION ||
          !Array.isArray(data.scenes) || data.scenes.length > MAX_SCENES) throw new Error();
      const scenes = data.scenes.map(snapshot);
      if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) throw new Error();
      return { ok: true, scenes };
    } catch { return { ok: false, reason: 'corrupt-storage' }; }
  }
  function save(raw) {
    let scene;
    try { scene = snapshot(raw); }
    catch { return { saved: false, reason: 'invalid-scene' }; }
    const current = read();
    if (!current.ok) return { saved: false, reason: current.reason };
    const scenes = [...current.scenes];
    const index = scenes.findIndex((item) => item.id === scene.id);
    if (index >= 0) scenes[index] = scene;
    else scenes.push(scene);
    if (scenes.length > MAX_SCENES) return { saved: false, reason: 'capacity-exceeded' };
    const text = JSON.stringify({ schema: SCHEMA, version: GEOGRAPHIC_SCENE_VERSION, scenes });
    if (text.length > MAX_STORAGE_CHARS) return { saved: false, reason: 'capacity-exceeded' };
    try {
      storage.setItem(GEOGRAPHIC_SCENE_STORAGE_KEY, text);
      if (storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY) !== text)
        return { saved: false, reason: 'write-not-persisted' };
    } catch (error) {
      return { saved: false, reason: error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014
        ? 'quota-exceeded' : 'storage-write-failed' };
    }
    return { saved: true, id: scene.id, scene };
  }
  function load(id) {
    const current = read();
    return current.ok ? current.scenes.find((scene) => scene.id === id) || null : null;
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
    try { updatedAt = iso(now); }
    catch { return { saved: false, reason: 'invalid-timestamp' }; }
    return save({ ...scene, title, updatedAt });
  }
  return Object.freeze({ load, save, list, rename });
}
