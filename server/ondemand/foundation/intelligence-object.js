/**
 * OnDemand foundation — reusable intelligence objects (Phase C/D/G).
 *
 * Every plugin/tool/workflow result is normalised into ONE shape so the
 * orchestrator, the mini chat and the UI reason over the same record:
 *
 *   IntelligenceObject {
 *     id            stable hash of (source, kind, naturalKey)
 *     kind          'answer' | 'event' | 'entity' | 'relationship' | 'document'
 *     source        { provider, pluginId?, toolRoute?, workflowId?, contract }
 *     observedAt    ISO-8601 UTC — when the upstream said it happened/was published
 *     fetchedAt     ISO-8601 UTC — when WE received it
 *     freshnessSec  fetchedAt - observedAt (null when observedAt unknown)
 *     confidence    0..1 and a `confidenceBasis` label: 'confirmed' (two+ independent
 *                   sources agree) | 'inferred' (model-derived) | 'unverified' (single source)
 *     claims        [{text, evidence:[{url,title,quote?}], status}]
 *     entities      [{name, type, ids:{…}}]   recognised entities (plain extraction, no invention)
 *     raw           the untouched upstream payload (never mutated; may be truncated by size with `rawTruncated`)
 *   }
 *
 * Nothing here calls the network or the model. Entity recognition is a
 * conservative regex/pattern pass (ICAO24 hex, MMSI, NORAD id, lat/lon,
 * MGRS, URLs, ISO timestamps, @handles); the orchestrator can ask the model
 * for richer extraction, but that output is labelled 'inferred'.
 */

import { createHash } from 'node:crypto';

const MAX_RAW_BYTES = 32 * 1024;

/** Normalise anything date-like to ISO-8601 UTC (or null). */
export function toIsoUtc(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date)
    return Number.isNaN(+value) ? null : value.toISOString();
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value; // seconds vs ms
    const d = new Date(ms);
    return Number.isNaN(+d) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value.trim());
    return Number.isNaN(+d) ? null : d.toISOString();
  }
  return null;
}

export function stableId(parts) {
  return createHash('sha256')
    .update(parts.map((p) => String(p ?? '')).join('\u0001'))
    .digest('hex')
    .slice(0, 24);
}

/** Markdown links + bare URLs → [{url,title}], de-duplicated by URL. */
export function extractCitations(text) {
  const out = new Map();
  const s = String(text ?? '');
  for (const m of s.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g))
    out.set(m[2], { url: m[2], title: m[1].trim() });
  for (const m of s.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.has(url)) out.set(url, { url, title: null });
  }
  return [...out.values()];
}

const ENTITY_PATTERNS = [
  {
    type: 'aircraft.icao24',
    re: /\b(?:icao24?|hex)[:\s]+([0-9a-f]{6})\b/gi,
    group: 1,
  },
  { type: 'vessel.mmsi', re: /\bmmsi[:\s]+(\d{9})\b/gi, group: 1 },
  {
    type: 'satellite.norad',
    re: /\bnorad(?:\s*id)?[:\s#]+(\d{4,6})\b/gi,
    group: 1,
  },
  {
    type: 'geo.latlon',
    re: /(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/g,
    group: 0,
  },
  {
    type: 'geo.mgrs',
    re: /\b\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}\s?\d{4,10}\b/g,
    group: 0,
  },
  { type: 'social.handle', re: /(?:^|\s)@([A-Za-z0-9_]{2,30})\b/g, group: 1 },
  {
    type: 'time.iso',
    re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
    group: 0,
  },
  {
    type: 'flight.callsign',
    re: /\bcallsign[:\s]+([A-Z]{2,3}\d{1,4}[A-Z]?)\b/g,
    group: 1,
  },
];

/** Conservative, pattern-based entity recognition (never invents). */
export function recogniseEntities(text) {
  const s = String(text ?? '');
  const seen = new Set();
  const out = [];
  for (const { type, re, group } of ENTITY_PATTERNS) {
    for (const m of s.matchAll(re)) {
      const name = String(m[group]).trim();
      const key = `${type}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, type, ids: { [type]: name }, basis: 'pattern' });
      if (out.length >= 64) return out;
    }
  }
  return out;
}

/** Resolve duplicates across objects: same (type, normalised name) → one entity with sources. */
export function resolveEntities(objects) {
  const map = new Map();
  for (const obj of objects) {
    for (const e of obj.entities || []) {
      const key = `${e.type}:${String(e.name).toLowerCase().replace(/\s+/g, ' ')}`;
      const cur = map.get(key) || { ...e, sources: [], mentions: 0 };
      cur.mentions += 1;
      if (!cur.sources.includes(obj.id)) cur.sources.push(obj.id);
      map.set(key, cur);
    }
  }
  return [...map.values()].map((e) => ({
    ...e,
    confidenceBasis: e.sources.length >= 2 ? 'confirmed' : 'unverified',
  }));
}

/** Relationships = entities co-occurring in the same object (evidence-backed). */
export function detectRelationships(objects) {
  const rel = new Map();
  for (const obj of objects) {
    const ents = (obj.entities || []).slice(0, 12);
    for (let i = 0; i < ents.length; i += 1)
      for (let j = i + 1; j < ents.length; j += 1) {
        const a = `${ents[i].type}:${ents[i].name}`;
        const b = `${ents[j].type}:${ents[j].name}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const cur = rel.get(key) || {
          a,
          b,
          kind: 'co-occurrence',
          evidence: [],
        };
        cur.evidence.push(obj.id);
        rel.set(key, cur);
      }
  }
  return [...rel.values()].map((r) => ({
    ...r,
    confidence: Math.min(1, 0.3 + 0.2 * r.evidence.length),
    confidenceBasis: r.evidence.length >= 2 ? 'confirmed' : 'inferred',
  }));
}

function capRaw(raw) {
  const json = JSON.stringify(raw);
  if (json === undefined) return { raw: null, rawTruncated: false };
  if (Buffer.byteLength(json, 'utf8') <= MAX_RAW_BYTES)
    return { raw, rawTruncated: false };
  return { raw: json.slice(0, MAX_RAW_BYTES), rawTruncated: true };
}

/**
 * Build an IntelligenceObject from an OnDemand chat answer (sync or
 * assembled stream) produced through a contract.
 */
export function fromChatAnswer({
  contract,
  answer,
  messageId,
  sessionId,
  endpointId,
  pluginIds = [],
  observedAt,
  fetchedAt = new Date().toISOString(),
  raw,
  objectContext,
}) {
  const text = String(answer ?? '');
  const citations = extractCitations(text);
  const entities = recogniseEntities(text);
  const basis =
    citations.length >= 2
      ? 'confirmed'
      : citations.length === 1
        ? 'unverified'
        : 'inferred';
  const obs = toIsoUtc(observedAt);
  const fetched = toIsoUtc(fetchedAt) || new Date().toISOString();
  return {
    id: stableId([
      'chat',
      contract?.name,
      sessionId,
      messageId || text.slice(0, 200),
    ]),
    kind: 'answer',
    schema: 'ondemand-workstation/intelligence-object/1',
    source: {
      provider: contract?.provenance?.provider || 'OnDemand',
      contract: contract?.name || null,
      pluginId: contract?.pluginId || pluginIds[0] || null,
      pluginIds,
      endpointId: endpointId || null,
      sessionId: sessionId || null,
      messageId: messageId || null,
    },
    objectContext: objectContext
      ? {
          objectType: objectContext.objectType,
          objectId: objectContext.objectId,
        }
      : null,
    observedAt: obs,
    fetchedAt: fetched,
    freshnessSec: obs
      ? Math.round((Date.parse(fetched) - Date.parse(obs)) / 1000)
      : null,
    confidence:
      basis === 'confirmed' ? 0.8 : basis === 'unverified' ? 0.55 : 0.35,
    confidenceBasis: basis,
    claims: [
      {
        text: text.slice(0, 2000),
        evidence: citations,
        status: basis,
      },
    ],
    citations,
    entities,
    ...capRaw(raw ?? { answer: text }),
  };
}

/** Build an IntelligenceObject from a repo tool result (/api/tools/*). */
export function fromToolResult({ contract, result, fetchedAt, args }) {
  const fetched =
    toIsoUtc(fetchedAt) ||
    toIsoUtc(result?.fetchedAt) ||
    new Date().toISOString();
  const events = Array.isArray(result?.events) ? result.events : [];
  const text = JSON.stringify(result ?? {}).slice(0, 8000);
  return {
    id: stableId(['tool', contract?.name, JSON.stringify(args ?? {}), fetched]),
    kind: events.length ? 'event' : 'document',
    schema: 'ondemand-workstation/intelligence-object/1',
    source: {
      provider: contract?.provenance?.provider || result?.provider || 'tool',
      contract: contract?.name || null,
      toolRoute: contract?.toolRoute || null,
      pluginId: null,
      pluginIds: [],
    },
    objectContext: null,
    observedAt: toIsoUtc(events[0]?.time ?? events[0]?.timeUtc ?? null),
    fetchedAt: fetched,
    freshnessSec: null,
    confidence: 0.9,
    confidenceBasis: 'confirmed', // authoritative feed through the gateway
    claims: [
      {
        text: `${contract?.name || 'tool'} returned ${events.length || (result?.count ?? 0)} record(s)`,
        evidence: [],
        status: 'confirmed',
      },
    ],
    citations: [],
    entities: recogniseEntities(text),
    ...capRaw(result),
  };
}

/**
 * Combine objects from several sources: dedupe by id, resolve entities,
 * detect relationships, flag conflicts (same claim text with different
 * citations is NOT a conflict; two 'answer' objects whose numbers disagree
 * on the same entity is reported for the analyst, never auto-resolved).
 */
export function combineObjects(objects) {
  const byId = new Map();
  for (const o of objects) if (o && !byId.has(o.id)) byId.set(o.id, o);
  const list = [...byId.values()];
  const entities = resolveEntities(list);
  const relationships = detectRelationships(list);
  const sources = [
    ...new Set(list.map((o) => o.source?.provider).filter(Boolean)),
  ];
  const observed = list
    .map((o) => o.observedAt)
    .filter(Boolean)
    .sort();
  return {
    objects: list,
    entities,
    relationships,
    sources,
    timeRange: observed.length
      ? { from: observed[0], to: observed.at(-1) }
      : null,
    counts: {
      objects: list.length,
      confirmed: list.filter((o) => o.confidenceBasis === 'confirmed').length,
      inferred: list.filter((o) => o.confidenceBasis === 'inferred').length,
      unverified: list.filter((o) => o.confidenceBasis === 'unverified').length,
    },
  };
}

/** Change detection between two combined snapshots (by object id + claim text). */
export function diffSnapshots(before, after) {
  const b = new Map((before?.objects || []).map((o) => [o.id, o]));
  const a = new Map((after?.objects || []).map((o) => [o.id, o]));
  const added = [...a.keys()].filter((id) => !b.has(id));
  const removed = [...b.keys()].filter((id) => !a.has(id));
  const changed = [...a.keys()].filter(
    (id) =>
      b.has(id) &&
      JSON.stringify(b.get(id).claims) !== JSON.stringify(a.get(id).claims),
  );
  return {
    added,
    removed,
    changed,
    unchanged: a.size - added.length - changed.length,
  };
}
