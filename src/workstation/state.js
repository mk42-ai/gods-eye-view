/** Workstation authority and serialization. No DOM, Cesium, network or random poses. */
export const LEGACY_HASH_KEYS = Object.freeze([
  'v',
  'lat',
  'lon',
  'alt',
  'heading',
  'pitch',
  'roll',
  'style',
  'bloom',
  'sharpen',
  'bi',
  'bv',
  'si',
  'hud',
  'hv',
  'dm',
  'dd',
  'da',
  'kf',
  'ko',
  'cr',
  'sc',
  'scf',
  'map',
  'l',
  'lo',
  'ui',
]);
export const STORAGE_KEY = 'ondemand.scene-workstation.v1';
export const AUTO_STORAGE_KEY = STORAGE_KEY + '.session';
export function readHash(hash = '') {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return Object.fromEntries(params); // Preserve unknown keys too: never migrate legacy links destructively.
}
export function writeHash(values) {
  return new URLSearchParams(values).toString();
}
export function number(value) {
  return value === null || value === undefined || String(value).trim() === ''
    ? NaN
    : Number(value);
}
export function point(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 80 &&
    Math.abs(lon) <= 180
  );
}
export function validateAoi(aoi) {
  if (!aoi || !point(number(aoi.lat), number(aoi.lon)))
    return 'Select an exact AOI: enter latitude and longitude and confirm the operator selection.';
  if (
    !Number.isFinite(number(aoi.radiusM)) ||
    number(aoi.radiusM) < 150 ||
    number(aoi.radiusM) > 1200
  )
    return 'AOI radius must be between 150 and 1,200 metres.';
  const selected =
    aoi.source === 'user-selected' && aoi.verification === 'unverified';
  const verified = aoi.verification === 'verified' && !!aoi.sourceFeatureId;
  if (!selected && !verified)
    return 'Confirm this unverified operator selection before building.';
  return null;
}
export function hasPlaceholder(text) {
  return /\{\{[^}]*\}\}|\$\{[^}]*\}|<[^>\n]+>|\[(?:location|place|lat|lon|insert|site|city|your\b)[^\]]*\]|\b(?:TODO|TBD)\b/i.test(
    text,
  );
}
export function validateDraft(draft) {
  if (String(draft.prompt || '').trim().length < 3)
    return 'Write a scene prompt of at least 3 characters.';
  if (String(draft.prompt || '').length > 600)
    return 'Keep the scene prompt within 600 characters.';
  if (hasPlaceholder(draft.prompt))
    return 'Replace the unresolved prompt placeholders before Build.';
  if (
    !Number.isFinite(number(draft.durationSec)) ||
    number(draft.durationSec) < 2 ||
    number(draft.durationSec) > 120
  )
    return 'Choose a duration from 2 to 120 seconds.';
  return draft.aoi ? validateAoi(draft.aoi) : null; // The server may resolve a source-verified named site.
}
export function validCamera(camera) {
  const vector = (v) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x));
  return !!(
    camera &&
    vector(camera.position) &&
    vector(camera.target) &&
    camera.position.some((x, i) => x !== camera.target[i]) &&
    Number.isFinite(camera.fovDeg) &&
    camera.fovDeg >= 25 &&
    camera.fovDeg <= 70
  );
}
/** Geographic legacy view -> local east/north/up pose, only when a real patch origin exists. */
export function cameraFromHash(hash, origin) {
  const lat = number(hash.lat),
    lon = number(hash.lon),
    altitude = number(hash.alt);
  const heading = number(hash.heading),
    pitch = number(hash.pitch);
  if (
    !origin ||
    !point(origin.lat, origin.lon) ||
    !point(lat, lon) ||
    ![altitude, heading, pitch].every(Number.isFinite)
  )
    return null;
  const h = (heading * Math.PI) / 180,
    p = (pitch * Math.PI) / 180;
  const position = [
    (lon - origin.lon) * 111320 * Math.cos((origin.lat * Math.PI) / 180),
    (lat - origin.lat) * 110540,
    altitude - (origin.elevationM || 0),
  ];
  const distance = Math.max(
    25,
    Math.min(10000, Math.abs(position[2] / (Math.sin(p) || -0.5))),
  );
  return {
    position,
    target: [
      position[0] + Math.sin(h) * Math.cos(p) * distance,
      position[1] + Math.cos(h) * Math.cos(p) * distance,
      position[2] + Math.sin(p) * distance,
    ],
    fovDeg: 45,
  };
}
export function cameraToHash(camera, origin, hash) {
  if (!validCamera(camera) || !origin || !point(origin.lat, origin.lon))
    return hash;
  const [x, y, z] = camera.position,
    d = camera.target.map((v, i) => v - camera.position[i]);
  const lat = origin.lat + y / 110540,
    lon = origin.lon + x / (111320 * Math.cos((origin.lat * Math.PI) / 180));
  if (!point(lat, lon)) return hash;
  return {
    ...hash,
    lat: lat.toFixed(7),
    lon: lon.toFixed(7),
    alt: String(z + (origin.elevationM || 0)),
    heading: String(((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360),
    pitch: String((Math.atan2(d[2], Math.hypot(d[0], d[1])) * 180) / Math.PI),
  };
}
export function createState(saved = {}, hash = '') {
  return {
    prompt: typeof saved.prompt === 'string' ? saved.prompt.slice(0, 600) : '',
    durationSec: Number.isFinite(saved.durationSec) ? saved.durationSec : 4,
    locationQuery:
      typeof saved.locationQuery === 'string' ? saved.locationQuery : '',
    evidenceWindowHours: [1, 24, 72, 168, 720].includes(
      saved.evidenceWindowHours,
    )
      ? saved.evidenceWindowHours
      : 1,
    aoi: !validateAoi(saved.aoi) ? saved.aoi : null,
    camera: validCamera(saved.camera) ? saved.camera : null,
    timeOfDay: ['auto', 'midday', 'dusk', 'night'].includes(saved.timeOfDay)
      ? saved.timeOfDay
      : 'auto',
    cameraMode: ['street', 'low_oblique', 'orbit'].includes(saved.cameraMode)
      ? saved.cameraMode
      : 'street',
    layers: sanitizeLayers(saved.layers),
    chat: Array.isArray(saved.chat)
      ? saved.chat
          .filter(
            (m) =>
              m &&
              ['user', 'assistant'].includes(m.role) &&
              typeof m.text === 'string',
          )
          .slice(-30)
          .map((m) => ({
            role: m.role,
            text: m.text.slice(0, 4000),
            at: typeof m.at === 'string' ? m.at : null,
          }))
      : [],
    legacyHash: hash ? readHash(hash) : saved.legacyHash || {},
    revision: 0,
    phase: 'idle',
    stale: false,
    job: null,
    result: null,
    displayed: null,
    selection: null,
    failure: null,
    candidates: [],
    locationStatus:
      'Select an exact site. City lookups are navigation hints, not verified sites.',
    evidence: {
      phase: 'idle',
      items: [],
      candidates: [],
      sources: [],
      message: 'No source research requested.',
      receivedAt: null,
    },
    cctv: {
      phase: 'idle',
      cameras: [],
      selectedId: saved.cctvId || null,
      message: 'CCTV off — no camera selected.',
      receivedAt: null,
    },
    hashRestored: !!hash,
    active: null,
  };
}
export const LAYER_KEYS = Object.freeze([
  'imagery',
  'buildings',
  'roads',
  'sidewalks',
  'scenery',
  'staging',
  'skirt',
]);
export function sanitizeLayers(layers) {
  const out = {};
  for (const key of LAYER_KEYS)
    out[key] = layers && typeof layers[key] === 'boolean' ? layers[key] : true;
  return out;
}
export const SCENES_KEY = 'ondemand.scene-workstation.scenes.v1';
export const PROMPTS_KEY = 'ondemand.scene-workstation.prompts.v1';
/** Saved-scene library (browser-local). Malformed entries are dropped, never thrown. */
export function readLibrary(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          typeof e.name === 'string' &&
          e.state &&
          e.state.version === 1,
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}
export function addToLibrary(list, name, snapshot, now = new Date()) {
  const id = `scene-${now.getTime().toString(36)}`;
  const entry = {
    id,
    name: String(name || snapshot.prompt || 'Untitled scene')
      .trim()
      .slice(0, 80),
    savedAt: now.toISOString(),
    state: snapshot,
  };
  return [entry, ...list.filter((e) => e.id !== id)].slice(0, 50);
}
export function rememberPrompt(list, prompt) {
  const p = String(prompt || '').trim();
  if (p.length < 3) return list;
  return [p, ...list.filter((x) => x !== p)].slice(0, 12);
}
export function savedState(state) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    prompt: state.prompt,
    durationSec: state.durationSec,
    locationQuery: state.locationQuery,
    evidenceWindowHours: state.evidenceWindowHours,
    aoi: state.aoi,
    camera: state.camera,
    legacyHash: state.legacyHash,
    timeOfDay: state.timeOfDay,
    cameraMode: state.cameraMode,
    layers: state.layers,
    chat: state.chat,
    cctvId: state.cctv.selectedId,
    jobId: state.job?.job_id || null,
    sceneSnapshot: state.job
      ? {
          sceneId: state.job.sceneId,
          patch: state.job.patch,
          spec: state.job.spec,
          placement: state.job.placement,
          references: state.job.references,
          request: state.job.request,
          camera: state.camera,
        }
      : null,
    sourceEvidence: state.evidence,
    sourceCameras: {
      cameras: state.cctv.cameras,
      selectedId: state.cctv.selectedId,
    },
  };
}
/** A Build owns submission synchronously, before the first await. Editing cancels every older owner. */
export class Authority {
  constructor(state, onEvent = () => {}) {
    this.state = state;
    this.onEvent = onEvent;
    this.epoch = 0;
    this.frameEpoch = 0;
    this.pending = new Set();
  }
  controller() {
    const controller = new AbortController();
    this.pending.add(controller);
    return controller;
  }
  release(controller) {
    this.pending.delete(controller);
  }
  cancel(reason = 'cancelled') {
    this.epoch++;
    this.frameEpoch++;
    for (const c of this.pending) c.abort(reason);
    this.pending.clear();
    this.state.active = null;
    if (this.state.evidence?.phase === 'loading') {
      this.state.evidence.phase = 'cancelled';
      this.state.evidence.message =
        'Source request invalidated. Refresh for the current draft.';
    }
    if (this.state.cctv?.phase === 'loading') {
      this.state.cctv.phase = 'cancelled';
      this.state.cctv.message =
        'Source camera request invalidated. Refresh to continue.';
    }
    if (this.state.locationStatus === 'Finding site candidates…')
      this.state.locationStatus =
        'Location lookup invalidated. Find again for this draft.';
    this.onEvent('owner-invalidated', { reason, epoch: this.epoch });
  }
  edit(patch = {}, reason = 'draft-edited') {
    this.cancel(reason);
    Object.assign(this.state, patch);
    this.state.revision++;
    this.state.stale = !!(this.state.job || this.state.displayed);
    this.state.phase = this.state.stale ? 'stale' : 'draft';
    this.state.failure = null;
    this.state.evidence = {
      ...this.state.evidence,
      phase: this.state.evidence.receivedAt ? 'stale' : 'idle',
      message: 'Draft changed. Refresh sources for this AOI.',
    };
    this.state.cctv = {
      ...this.state.cctv,
      phase: this.state.cctv.receivedAt ? 'stale' : 'idle',
    };
  }
  begin(kind = 'build') {
    if (this.state.active) return null;
    this.cancel('new-' + kind);
    const owner = {
      epoch: this.epoch,
      revision: this.state.revision,
      kind,
      controller: this.controller(),
      jobId: null,
    };
    this.state.active = owner;
    this.state.phase = 'building';
    this.state.failure = null;
    this.state.stale = !!this.state.displayed;
    return owner;
  }
  current(owner) {
    return (
      !!owner &&
      owner.epoch === this.epoch &&
      owner.revision === this.state.revision &&
      !owner.controller.signal.aborted
    );
  }
  end(owner) {
    if (this.current(owner) && this.state.active === owner) {
      this.release(owner.controller);
      this.state.active = null;
    }
  }
  frameOwner(owner) {
    return { owner, epoch: ++this.frameEpoch };
  }
  currentFrame(frame) {
    return this.current(frame?.owner) && frame.epoch === this.frameEpoch;
  }
}
/** The caller commits the decoded element itself. The visible frame is never assigned an undecoded src. */
export async function decodeAndCommit({
  authority,
  owner,
  url,
  decode,
  commit,
}) {
  const ticket = authority.frameOwner(owner);
  const decoded = await decode(url, owner.controller.signal);
  if (!authority.currentFrame(ticket)) return false;
  commit(decoded);
  return true;
}
export function safeLink(raw, base = 'https://workstation.invalid') {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw, base);
    return ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function localMedia(raw, base = 'https://workstation.invalid') {
  const link = safeLink(raw, base);
  if (!link) return null;
  const url = new URL(link);
  return url.origin === new URL(base).origin && url.pathname.startsWith('/api/')
    ? url.pathname + url.search
    : null;
}
export function parseSse(buffer) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop();
  const events = [];
  for (const part of parts) {
    const event = part.match(/^event:\s*(.*)$/m)?.[1] || 'message';
    const text = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (text) {
      try {
        events.push({ event, data: JSON.parse(text) });
      } catch {
        /* Ignore incomplete/invalid records, not a success. */
      }
    }
  }
  return { events, rest };
}
