/**
 * Incident + Scene data model (runtime-neutral: browser and server).
 *
 * Incident {
 *   id, aoi, category, title, summary, time_utc, lat, lon, place,
 *   actors[], impact, sources:[{url, published_at}],
 *   confidence:'confirmed'|'inferred'|'unverified',
 *   provenance, dedupe_key, aoi_membership:{inside, aoi_ids, reason}
 * }
 * Scene {
 *   id, incident_ids[], title, category,
 *   keyframes:[{lat,lon,zoom,bearing,pitch,time}],
 *   markers:[{lat,lon,category,icon,title,incident_id}],
 *   evidence:[{thumbnail_url, item_id, acquired}],
 *   timeline_events:[{time_utc, title, incident_id}],
 *   playback:{state:'idle'|'playing'|'paused', position:0..1}
 * }
 */

export const INCIDENT_CATEGORIES = Object.freeze([
  'missile_drone_strike',
  'maritime_attack',
  'piracy_hijack',
  'airstrike',
  'ied_terror',
  'border_incursion',
  'vessel_seizure',
  'protest_unrest',
  'thermal_hotspot',
  'protected_asset_presence_node',
]);

export const CONFIDENCE_LEVELS = Object.freeze([
  'confirmed',
  'inferred',
  'unverified',
]);

/** Icon file per category (public/icons/incidents/<category>.png). */
export const CATEGORY_ICONS = Object.freeze(
  Object.fromEntries(
    INCIDENT_CATEGORIES.map((c) => [c, `/icons/incidents/${c}.png`]),
  ),
);

export const CATEGORY_LABELS = Object.freeze({
  missile_drone_strike: 'Missile / drone strike',
  maritime_attack: 'Maritime attack',
  piracy_hijack: 'Piracy / hijack',
  airstrike: 'Airstrike',
  ied_terror: 'IED / terror',
  border_incursion: 'Border incursion',
  vessel_seizure: 'Vessel seizure',
  protest_unrest: 'Protest / unrest',
  thermal_hotspot: 'Thermal hotspot',
  protected_asset_presence_node: 'Protected asset / presence node',
});

/** Free-text category aliases → canonical category. */
const CATEGORY_ALIASES = [
  [
    /presence|protected[_ ]asset|base|port facility/i,
    'protected_asset_presence_node',
  ],
  [/thermal|hotspot|fire|viirs|firms/i, 'thermal_hotspot'],
  [/piracy|hijack|pirate/i, 'piracy_hijack'],
  [/seiz|detain|boarded|board/i, 'vessel_seizure'],
  [/maritime|ship|vessel|tanker|naval|uss |anti-ship|sea/i, 'maritime_attack'],
  [/missile|drone|uav|ballistic|rocket|intercept/i, 'missile_drone_strike'],
  [/airstrike|air strike|air raid|bomb/i, 'airstrike'],
  [
    /ied|terror|suicide|bombing|al-shabaab|cyber|ransomware|breach/i,
    'ied_terror',
  ],
  [/border|incursion|crossing|smuggl/i, 'border_incursion'],
  [
    /protest|unrest|riot|political|strategy|policy|regulation|reporting/i,
    'protest_unrest',
  ],
];

export function normalizeCategory(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  if (INCIDENT_CATEGORIES.includes(raw)) return raw;
  for (const [re, cat] of CATEGORY_ALIASES) if (re.test(raw)) return cat;
  return 'protest_unrest';
}

export function normalizeConfidence(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  return CONFIDENCE_LEVELS.includes(raw) ? raw : 'unverified';
}

// ---------------------------------------------------------------- sha1
// Tiny synchronous SHA-1 (hex) so the dedupe key is identical in Node and
// in the browser without touching crypto.subtle (async) or node:crypto.
function rotl(n, s) {
  return (n << s) | (n >>> (32 - s));
}
export function sha1Hex(message) {
  const bytes = new TextEncoder().encode(String(message));
  const ml = bytes.length;
  const withPad = (((ml + 8) >> 6) << 4) + 16; // words
  const w = new Uint32Array(withPad);
  for (let i = 0; i < ml; i += 1) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  w[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8);
  w[withPad - 1] = ml * 8;
  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const x = new Uint32Array(80);
  for (let i = 0; i < withPad; i += 16) {
    for (let t = 0; t < 16; t += 1) x[t] = w[i + t];
    for (let t = 16; t < 80; t += 1)
      x[t] = rotl(x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16], 1);
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f, k;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (rotl(a, 5) + f + e + k + x[t]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// ---------------------------------------------------------------- time
export const DEDUPE_BUCKET_HOURS = 6;

export function toIsoUtc(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

/** Floor an ISO time to the 6-hour UTC bucket (as ISO string). */
export function timeBucket(isoTime, hours = DEDUPE_BUCKET_HOURS) {
  const ms = Date.parse(isoTime);
  if (!Number.isFinite(ms)) return 'unknown';
  const size = hours * 3600 * 1000;
  return new Date(Math.floor(ms / size) * size).toISOString();
}

/** dedupe_key = sha1(category|round(lat,2)|round(lon,2)|6h bucket). */
export function dedupeKey({ category, lat, lon, time_utc }) {
  const r2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
  return sha1Hex(
    `${normalizeCategory(category)}|${r2(lat)}|${r2(lon)}|${timeBucket(time_utc)}`,
  );
}

// ---------------------------------------------------------------- normalize
const MAX_TEXT = 4000;
const clip = (v, n = MAX_TEXT) =>
  v === undefined || v === null ? '' : String(v).slice(0, n);

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const out = [];
  for (const s of sources.slice(0, 20)) {
    const url = typeof s === 'string' ? s : s?.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    out.push({
      url: url.slice(0, 2048),
      published_at: toIsoUtc(s?.published_at, null),
      ...(s?.title ? { title: clip(s.title, 300) } : {}),
    });
  }
  return out;
}

/**
 * Normalize an arbitrary incident-like object. Throws on missing lat/lon.
 * `membership` (optional) stamps aoi/aoi_membership from the AOI index.
 */
export function normalizeIncident(raw, { membership, now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object')
    throw new IncidentValidationError('incident', 'object required');
  const lat = Number(raw.lat ?? raw.latitude);
  const lon = Number(raw.lon ?? raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90)
    throw new IncidentValidationError('lat', 'number in [-90, 90] required');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180)
    throw new IncidentValidationError('lon', 'number in [-180, 180] required');
  const title = clip(raw.title, 300).trim();
  if (!title) throw new IncidentValidationError('title', 'required');
  const category = normalizeCategory(raw.category);
  const time_utc =
    toIsoUtc(raw.time_utc ?? raw.time ?? raw.published_at, null) ||
    now.toISOString();
  const key = dedupeKey({ category, lat, lon, time_utc });
  const member = membership ? membership(lat, lon) : null;
  const incident = {
    id: clip(raw.id, 128) || `inc-${key.slice(0, 12)}`,
    aoi:
      clip(raw.aoi, 64) ||
      (member?.inside ? member.aoi_ids[0] : member ? 'out-of-aoi' : 'unknown'),
    category,
    title,
    summary: clip(raw.summary),
    time_utc,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    place: clip(raw.place, 200),
    actors: Array.isArray(raw.actors)
      ? raw.actors
          .map((a) => clip(a, 120))
          .filter(Boolean)
          .slice(0, 20)
      : [],
    impact: clip(raw.impact, 1000),
    sources: normalizeSources(raw.sources),
    confidence: normalizeConfidence(raw.confidence),
    provenance: clip(raw.provenance, 300) || 'operator',
    dedupe_key: key,
    ...(raw.frp !== undefined && Number.isFinite(Number(raw.frp))
      ? { frp: Number(raw.frp) }
      : {}),
    ...(Array.isArray(raw.evidence)
      ? { evidence: normalizeEvidence(raw.evidence) }
      : {}),
    ingested_at: now.toISOString(),
    ...(raw.override === true ? { override: true } : {}),
  };
  if (member) {
    incident.aoi_membership = {
      inside: member.inside,
      aoi_ids: member.aoi_ids,
      reason: member.reason,
      ...(member.nearest ? { nearest: member.nearest } : {}),
    };
  }
  return incident;
}

export function normalizeEvidence(items) {
  return items
    .slice(0, 12)
    .map((e) => ({
      item_id: clip(e?.item_id, 64),
      thumbnail_url: clip(e?.thumbnail_url, 2048),
      acquired: toIsoUtc(e?.acquired, null),
      ...(e?.clear_percent !== undefined
        ? { clear_percent: Number(e.clear_percent) }
        : {}),
    }))
    .filter((e) => e.item_id || e.thumbnail_url);
}

export class IncidentValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'IncidentValidationError';
    this.field = field;
  }
}

/** Keep the first incident per dedupe_key (stable order). */
export function dedupeIncidents(incidents) {
  const seen = new Set();
  const out = [];
  for (const inc of incidents) {
    const key = inc.dedupe_key || dedupeKey(inc);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(inc);
  }
  return out;
}

// ---------------------------------------------------------------- clustering
const DEG = Math.PI / 180;
export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const CLUSTER_RADIUS_KM = 25;
export const CLUSTER_WINDOW_HOURS = 6;

/**
 * Greedy single-linkage clustering: incidents within 25 km AND 6 h of any
 * member join the same cluster. Deterministic (input sorted by time, id).
 * @returns {Array<Incident[]>}
 */
export function clusterIncidents(
  incidents,
  { radiusKm = CLUSTER_RADIUS_KM, windowHours = CLUSTER_WINDOW_HOURS } = {},
) {
  const sorted = [...incidents].sort(
    (a, b) =>
      Date.parse(a.time_utc) - Date.parse(b.time_utc) ||
      String(a.id).localeCompare(String(b.id)),
  );
  const windowMs = windowHours * 3600 * 1000;
  const clusters = [];
  for (const inc of sorted) {
    let home = null;
    for (const cluster of clusters) {
      if (cluster[0].category !== inc.category) continue;
      const near = cluster.some(
        (m) =>
          Math.abs(Date.parse(m.time_utc) - Date.parse(inc.time_utc)) <=
            windowMs && distanceKm(m, inc) <= radiusKm,
      );
      if (near) {
        home = cluster;
        break;
      }
    }
    if (home) home.push(inc);
    else clusters.push([inc]);
  }
  return clusters;
}

// ---------------------------------------------------------------- scenes
function centroid(points) {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lon: points.reduce((s, p) => s + p.lon, 0) / n,
  };
}

/** Rough spread of a cluster in km (max distance from centroid). */
function spreadKm(points, c) {
  return points.reduce((m, p) => Math.max(m, distanceKm(c, p)), 0);
}

/** Zoom ≈ web-mercator level for a given ground span, clamped. */
function zoomForSpanKm(km) {
  const z = Math.log2(40075 / Math.max(1, km * 2.5));
  return Math.max(4, Math.min(15, Math.round(z * 10) / 10));
}

/**
 * approach → overhead → context keyframes for a cluster.
 * `time` is the normalized playback position in [0, 1].
 */
export function keyframesFor(points, { bearing = 20 } = {}) {
  const c = centroid(points);
  const spread = spreadKm(points, c);
  const focusZoom = points.length > 1 ? zoomForSpanKm(spread + 2) : 12.5;
  return [
    {
      lat: c.lat - 0.6,
      lon: c.lon - 0.2,
      zoom: Math.max(4, focusZoom - 4.5),
      bearing: 0,
      pitch: -55,
      time: 0,
      label: 'Approach',
    },
    {
      lat: c.lat,
      lon: c.lon,
      zoom: focusZoom,
      bearing,
      pitch: -80,
      time: 0.45,
      label: 'Overhead',
    },
    {
      lat: c.lat + 0.15,
      lon: c.lon + 0.25,
      zoom: Math.max(4, focusZoom - 2.5),
      bearing: bearing + 35,
      pitch: -45,
      time: 1,
      label: 'Context',
    },
  ];
}

/** Camera altitude (m) for a web-mercator-ish zoom level at a latitude. */
export function altitudeForZoom(zoom, lat = 0) {
  const groundRes = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.max(400, groundRes * 1200);
}

let sceneCounter = 0;
export function sceneIdFor(cluster) {
  const lead = cluster[0];
  return `inc-scene-${lead.dedupe_key ? lead.dedupe_key.slice(0, 10) : (sceneCounter += 1)}`;
}

/** Build one Scene from a cluster of incidents. */
export function sceneFromCluster(cluster, options = {}) {
  if (!cluster?.length) throw new Error('empty cluster');
  const sorted = [...cluster].sort(
    (a, b) => Date.parse(a.time_utc) - Date.parse(b.time_utc),
  );
  const lead = sorted[sorted.length - 1];
  const title =
    cluster.length === 1
      ? lead.title
      : `${CATEGORY_LABELS[lead.category] || lead.category} cluster ×${cluster.length} — ${lead.place || lead.aoi}`;
  const evidence = [];
  const seen = new Set();
  for (const inc of sorted)
    for (const e of inc.evidence || [])
      if (!seen.has(e.item_id || e.thumbnail_url)) {
        seen.add(e.item_id || e.thumbnail_url);
        evidence.push(e);
      }
  return {
    id: options.id || sceneIdFor(sorted),
    title,
    category: lead.category,
    aoi: lead.aoi,
    incident_ids: sorted.map((i) => i.id),
    keyframes: keyframesFor(sorted, options),
    markers: sorted.map((i) => ({
      lat: i.lat,
      lon: i.lon,
      category: i.category,
      icon: CATEGORY_ICONS[i.category],
      title: i.title,
      incident_id: i.id,
      confidence: i.confidence,
    })),
    evidence,
    timeline_events: sorted.map((i) => ({
      time_utc: i.time_utc,
      title: i.title,
      incident_id: i.id,
    })),
    playback: { state: 'idle', position: 0 },
    time_utc: lead.time_utc,
  };
}

/** Cluster → one scene per cluster, newest first. */
export function buildScenes(incidents, options = {}) {
  return clusterIncidents(incidents, options)
    .map((cluster) => sceneFromCluster(cluster, options))
    .sort((a, b) => Date.parse(b.time_utc) - Date.parse(a.time_utc));
}
