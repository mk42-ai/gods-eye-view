/**
 * Incident routes — mounted under /api/ondemand/v2/incidents by proxy-route.js.
 *
 *   POST /ingest   {incidents:[…]} | {incident:{…}}   header X-Ingest-Secret
 *                  (env INCIDENT_INGEST_SECRET) OR a session-scoped body
 *                  {externalUserId, incident} from the composer. Schema
 *                  validated, AOI filtered with reason, deduped by
 *                  sha1(category|round(lat,2)|round(lon,2)|6h bucket),
 *                  persisted in the user+object-keyed incident store.
 *   GET  /list?aoi=<id|all>&externalUserId=   incidents + scenes (+ rejected with reasons)
 *   POST /refresh  pulls live incidents through the PluginContract registry
 *                  (research plugins via OnDemand chat sessions; FIRMS via the
 *                  in-process tool invoker) and ingests whatever lands in AOI.
 *                  TODO(workflow): the scheduled OnDemand workflow will POST
 *                  here with X-Ingest-Secret (NEXT_ACTIONS N-33).
 *   POST /locate   {text, externalUserId?} → OnDemand entity extraction +
 *                  geocoding via the registry (plugin research + geocode_place
 *                  tool), gazetteer fallback from config/aoi/uae-interest.json,
 *                  → {candidates:[{name,lat,lon,aoi_membership,reason,confidence}]}
 *
 * The browser never talks to a provider directly; ONDEMAND_API_KEY and
 * INCIDENT_INGEST_SECRET live only in the server process.
 */

import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createAoiIndex, haversineKm } from '../../src/aoi/membership.js';
import {
  normalizeIncident,
  dedupeIncidents,
  buildScenes,
  IncidentValidationError,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  INCIDENT_CATEGORIES,
} from '../../src/incidents/model.js';
import { getIncidentStore, SHARED_SCOPE } from './store.js';
// Historical seed fixtures are injected by isolated tests/diagnostics only.
import { readJsonBody, sendJson } from '../ondemand/http.js';
import {
  ValidationError,
  validateExternalUserId,
} from '../ondemand/foundation/types.js';
import { contractRegistry } from '../ondemand/foundation/contracts.js';
import { objectContextKey } from '../ondemand/foundation/conversation-store.js';
import { extractCitations } from '../ondemand/foundation/intelligence-object.js';
import {
  sanitizeUntrusted,
  wrapUntrusted,
} from '../ondemand/foundation/guards.js';
import { config as odConfig, isConfigured } from '../ondemand/config.js';
import { parseIncidentQuery } from '../../src/incidents/query.js';
import { searchIncidentsAt } from './search.js';
import { sceneAoiConfig, resolveIncidentGate } from '../../src/aoi/sceneGate.js';

const MAX_BODY = 512 * 1024;
const MAX_INGEST = 500;
const MAX_TEXT = 500;
const SAME_PLACE_KM = 15;

let aoiConfigCache = null;
export function loadAoiConfig() {
  if (!aoiConfigCache) {
    aoiConfigCache = JSON.parse(
      readFileSync(
        new URL('../../config/aoi/uae-interest.json', import.meta.url),
        'utf8',
      ),
    );
  }
  return aoiConfigCache;
}

let aoiIndexCache = null;
export function getAoiIndex() {
  if (!aoiIndexCache) aoiIndexCache = createAoiIndex(loadAoiConfig());
  return aoiIndexCache;
}

function secretMatches(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Normalize + AOI-stamp a batch; returns {accepted, rejected} (rejected keep reasons). */
export function screenIncidents(
  rawList,
  { membership, now, allowOverride = false } = {},
) {
  const accepted = [];
  const rejected = [];
  const invalid = [];
  for (const raw of rawList) {
    let inc;
    try {
      inc = normalizeIncident(raw, { membership, now });
    } catch (err) {
      invalid.push({
        title: String(raw?.title || '').slice(0, 120),
        error:
          err instanceof IncidentValidationError
            ? err.message
            : 'invalid incident',
      });
      continue;
    }
    if (
      inc.aoi_membership?.inside ||
      (allowOverride && raw?.override === true)
    ) {
      accepted.push(inc);
    } else {
      rejected.push({
        id: inc.id,
        title: inc.title,
        lat: inc.lat,
        lon: inc.lon,
        category: inc.category,
        reason: inc.aoi_membership?.reason || 'OUT_OF_AOI',
        dedupe_key: inc.dedupe_key,
      });
    }
  }
  return { accepted: dedupeIncidents(accepted), rejected, invalid };
}

let seeded = null;
/** Seed the shared ledger once per process; out-of-AOI seeds are remembered with reasons. */
export async function ensureSeeded(
  store = getIncidentStore(),
  index = getAoiIndex(),
  diagnosticSeeds = [],
) {
  if (seeded) return seeded;
  const screened = screenIncidents(diagnosticSeeds, {
    membership: index.membership,
    now: new Date('2026-10-22T00:00:00Z'),
  });
  // Out-of-AOI seeds are stored under a dedicated scope so GET /list can
  // report them (count + reasons) without ever rendering them as scenes.
  await store.upsertMany(SHARED_SCOPE, screened.accepted);
  const outOfAoi = screened.rejected.map((r) => ({ ...r, scope: 'seed' }));
  seeded = {
    accepted: screened.accepted.length,
    rejected: outOfAoi,
    invalid: screened.invalid,
  };
  return seeded;
}
export function __resetSeedForTests() {
  seeded = null;
}

function countBy(list, key) {
  const out = {};
  for (const item of list) {
    const k = typeof key === 'function' ? key(item) : item[key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Response payload shared by /list, /ingest and /refresh. */
export async function listPayload(
  store,
  index,
  { scope = SHARED_SCOPE, aoi = 'all', diagnosticSeeds = [] } = {},
) {
  const seed = await ensureSeeded(store, index, diagnosticSeeds);
  const all = await store.listVisible(scope);
  const filtered =
    aoi && aoi !== 'all'
      ? all.filter(
          (i) => i.aoi === aoi || i.aoi_membership?.aoi_ids?.includes(aoi),
        )
      : all;
  const scenes = buildScenes(filtered.filter((incident) => resolveIncidentGate(incident.title, { lat: incident.lat, lon: incident.lon }).allowed));
  return {
    aoi,
    count: filtered.length,
    incidents: filtered,
    scenes,
    scene_count: scenes.length,
    per_aoi: countBy(filtered, 'aoi'),
    per_category: countBy(filtered, 'category'),
    scenes_per_aoi: countBy(scenes, 'aoi'),
    rejected: { count: seed.rejected.length, items: seed.rejected },
    invalid: seed.invalid,
    aoi_groups: index.groups,
    categories: INCIDENT_CATEGORIES.map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c],
      icon: CATEGORY_ICONS[c],
    })),
    store_backend: store.backend,
    generated_utc: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- /refresh
const REFRESH_QUESTION =
  'List the most recent (last 72 hours) security incidents in these areas: Strait of Hormuz, Gulf of Oman, Iran coast, Yemen (Hodeidah, Aden, Mukalla, Mocha, Balhaf), Bab el-Mandeb, Gulf of Aden, Somalia (Mogadishu, Bosaso, Kismayo, Berbera), Socotra, UAE borders and waters (Fujairah, Khor Fakkan, Abu Musa, Al Ain, Hatta). ' +
  'Return ONLY a JSON array; each item: {"title","summary","category","place","lat","lon","time_utc","actors":[],"impact","sources":[{"url","published_at"}],"confidence":"confirmed|inferred|unverified"}. ' +
  'Categories: missile_drone_strike, maritime_attack, piracy_hijack, airstrike, ied_terror, border_incursion, vessel_seizure, protest_unrest, thermal_hotspot. Use decimal WGS84 coordinates. No prose.';

/** Pull a JSON array out of a model answer (tolerates fences and prose). */
export function parseIncidentArray(text) {
  const s = String(text ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const m = body.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)
      ? arr.filter((x) => x && typeof x === 'object')
      : [];
  } catch {
    return [];
  }
}

/** FIRMS CSV (via fire_detection_search tool result) → raw incident rows. */
export function firesToIncidents(
  result,
  { source = 'OnDemand tool fire_detection_search' } = {},
) {
  const rows = Array.isArray(result?.data?.detections)
    ? result.data.detections
    : Array.isArray(result?.data?.rows)
      ? result.data.rows
      : Array.isArray(result?.detections)
        ? result.detections
        : [];
  return rows
    .map((r) => {
      const lat = Number(r.latitude ?? r.lat);
      const lon = Number(r.longitude ?? r.lon);
      const date = r.acq_date || r.date;
      const hhmm = String(r.acq_time ?? r.time ?? '0000').padStart(4, '0');
      const time_utc = date
        ? `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`
        : undefined;
      return {
        category: 'thermal_hotspot',
        title: `Thermal hotspot ${lat.toFixed(3)}, ${lon.toFixed(3)}${r.frp ? ` (FRP ${r.frp} MW)` : ''}`,
        summary: `${r.instrument || 'VIIRS'} ${r.satellite || ''} detection, confidence ${r.confidence || 'n'}.`,
        lat,
        lon,
        frp: Number(r.frp) || undefined,
        time_utc,
        sources: [
          {
            url: 'https://firms.modaps.eosdis.nasa.gov/',
            published_at: time_utc,
          },
        ],
        confidence: 'inferred',
        provenance: source,
      };
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

async function runResearchContract({
  client,
  store,
  contract,
  question,
  externalUserId,
  signal,
}) {
  // One FRESH session per refresh call: OnDemand answers 409 when a second
  // query lands on a session whose previous (long) query is still running,
  // which is exactly what a scheduled refresh overlapping a manual one does.
  const ctxKey = objectContextKey({
    objectType: 'incidentRefresh',
    objectId: `${contract.name}#${Date.now().toString(36)}`,
  });
  // A distinct principal per call as well: the platform answers 409 for a
  // query that overlaps another still-running query of the same user+plugin
  // (a client-side timeout does not stop the upstream run).
  externalUserId = `${externalUserId}-${Date.now().toString(36)}`;
  const session = await client.sessions.create({
    externalUserId,
    pluginIds: [contract.pluginId],
  });
  await store.put(externalUserId, ctxKey, {
    sessionId: session.id,
    pluginIds: [contract.pluginId],
  });
  const ask = (query, reasoningEffort) =>
    client.query.sync(
      session.id,
      {
        query,
        endpointId: odConfig.fulfillmentEndpointId,
        responseMode: 'sync',
        pluginIds: [contract.pluginId],
        fulfillmentOnly: false,
        reasoningEffort,
      },
      { signal, timeoutMs: 90_000 },
    );
  // A freshly created plugin session can still report `session_busy` (409)
  // for a few seconds while the platform attaches the plugin; back off and
  // retry a bounded number of times instead of failing the whole source.
  const askWithBusyRetry = async (query) => {
    let attempt = 0;
    for (;;) {
      try {
        return await ask(query, 'low');
      } catch (err) {
        if (err?.status !== 409 || attempt >= 3 || signal?.aborted) throw err;
        attempt += 1;
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  };
  let out = await askWithBusyRetry(question);
  let answer = out?.data?.answer ?? '';
  let items = parseIncidentArray(answer);
  if (!items.length && !signal?.aborted) {
    // The model answered in prose: ask once more for the JSON array only.
    out = await askWithBusyRetry(
      'Convert your previous answer into the requested JSON array now. Output ONLY the JSON array, no prose, no markdown. If you found no incidents, output [].',
    );
    answer = `${answer}\n${out?.data?.answer ?? ''}`;
    items = parseIncidentArray(out?.data?.answer ?? '');
  }
  await store.touch(externalUserId, ctxKey);
  const mapped = items.map((item) => ({
    ...sanitizeUntrusted(item, 8192),
    provenance: `OnDemand · ${contract.name} (${contract.pluginId})`,
    sources:
      Array.isArray(item.sources) && item.sources.length
        ? item.sources
        : extractCitations(answer).slice(0, 5),
  }));
  return {
    contract: contract.name,
    pluginId: contract.pluginId,
    items: mapped,
    answerChars: answer.length,
  };
}

/**
 * Refresh through the PluginContract registry: research plugins (web) and
 * the FIRMS tool over the AOI bounding boxes. Each source fails independently.
 */
export async function refreshFromPlugins({
  client,
  store,
  toolInvoker,
  externalUserId = 'incident-refresh',
  signal,
  contracts,
  index = getAoiIndex(),
} = {}) {
  const names = contracts || ['perplexity_research', 'internet_web_search'];
  const sources = [];
  const raw = [];
  const candidates = [];
  for (const name of names) {
    const contract = contractRegistry.get(name);
    if (!contract || contract.availability === 'inactive') {
      sources.push({
        contract: name,
        status: 'skipped',
        error: 'inactive_or_unknown',
      });
      continue;
    }
    if (!client || !isConfigured()) {
      sources.push({
        contract: name,
        status: 'skipped',
        error: 'ondemand_not_configured',
      });
      continue;
    }
    try {
      const r = await runResearchContract({
        client,
        store,
        contract,
        question: REFRESH_QUESTION,
        externalUserId,
        signal,
      });
      // A generated answer is not a source incident record. Never geocode
      // it into an exact incident, mark it confirmed, or feed it into scenes.
      candidates.push(...r.items.map(item => ({ title: item.title, sources: item.sources, reason: 'unverified-research-answer' })));
      sources.push({
        contract: name,
        pluginId: r.pluginId,
        status: 'ok',
        items: 0,
        candidates: r.items.length,
        note: 'Model research leads only; excluded from live incident ledger',
      });
    } catch (err) {
      sources.push({
        contract: name,
        status: 'error',
        error:
          err?.name === 'OnDemandHttpError'
            ? `upstream_${err.status}`
            : String(err?.message || err).slice(0, 160),
      });
    }
  }
  // FIRMS through the in-process tool invoker (same whitelist as /api/tools).
  const fires = contractRegistry.get('fire_detection_search');
  if (fires && toolInvoker) {
    const boxes = [
      ['hormuz', '55.0,24.0,59.5,27.5'],
      ['red-sea-aden', '42.0,10.0,51.5,17.0'],
      ['somalia', '41.0,-1.8,51.5,12.0'],
    ];
    for (const [label, bbox] of boxes) {
      try {
        const result = await toolInvoker(
          fires,
          { bbox, day_range: 2, source: 'VIIRS_NOAA21_NRT' },
          { signal },
        );
        const items = firesToIncidents(result);
        raw.push(...items);
        sources.push({
          contract: `fire_detection_search:${label}`,
          status: result?.ok === false ? 'error' : 'ok',
          items: items.length,
          error: result?.error?.code,
        });
      } catch (err) {
        sources.push({
          contract: `fire_detection_search:${label}`,
          status: 'error',
          error: String(err?.code || err?.message || err).slice(0, 120),
        });
      }
    }
  } else {
    sources.push({
      contract: 'fire_detection_search',
      status: 'skipped',
      error: toolInvoker ? 'contract_missing' : 'no_tool_invoker',
    });
  }
  return { raw, sources, candidates };
}

// ---------------------------------------------------------------- /locate
const LOCATE_PROMPT = (text) =>
  [
    'Extract the single most specific PLACE named or implied in the incident text below and geocode it.',
    'Return ONLY JSON: {"candidates":[{"name":"<place>","lat":<decimal>,"lon":<decimal>,"country":"<ISO2 or null>","confidence":<0..1>}]} with at most 3 candidates, best first.',
    'If no place can be identified, return {"candidates":[]}.',
    wrapUntrusted('INCIDENT TEXT', text),
  ].join('\n');

function parseCandidates(text) {
  const s = String(text ?? '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    return (Array.isArray(j.candidates) ? j.candidates : [])
      .map((c) => ({
        name: String(c?.name || '').slice(0, 120),
        lat: Number(c?.lat),
        lon: Number(c?.lon),
        country: c?.country
          ? String(c.country).slice(0, 2).toUpperCase()
          : null,
        confidence: Math.max(0, Math.min(1, Number(c?.confidence) || 0.5)),
      }))
      .filter(
        (c) => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon),
      );
  } catch {
    return [];
  }
}

/**
 * Resolve free text to geocoded candidates. Order: gazetteer (instant, offline)
 * → OnDemand entity extraction (fulfilment endpoint) → geocode_place tool.
 * Every candidate carries AOI membership + reason so the UI can explain a reject.
 */
export async function locateText(
  text,
  {
    index = getAoiIndex(),
    client,
    store,
    toolInvoker,
    externalUserId = 'incident-locate',
    signal,
    useOnDemand = true,
  } = {},
) {
  const extraction = parseIncidentQuery(text);
  // Small talk ("hi") names no place: answer instantly, never spend a provider
  // round-trip (the composer shows a local hint before it would even call us).
  if (extraction.kind === 'conversational')
    return { text: extraction.originalText, extraction, candidates: [], steps: [{ step: 'conversational', status: 'skipped' }], status: 'empty' };
  const query = extraction.place.slice(0, MAX_TEXT);
  const candidates = [];
  const seen = new Set();
  const normalizePlace = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // A city-name substring is not a resolved neighbourhood. Dubai must never
  // short-circuit the registered geocoder when the operator asks for Marina.
  const preciseArea = sceneAoiConfig.aois.find((area) =>
    (area.aliases || []).some((alias) => normalizePlace(alias) === normalizePlace(query)));
  const push = (c, source) => {
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) return;
    const key = `${c.name.toLowerCase()}|${c.lat.toFixed(2)}|${c.lon.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const m = index.membership(c.lat, c.lon);
    const gate = resolveIncidentGate(text, { lat: c.lat, lon: c.lon });
    candidates.push({
      name: c.name,
      lat: Math.round(c.lat * 1e7) / 1e7,
      lon: Math.round(c.lon * 1e7) / 1e7,
      country: c.country ?? null,
      confidence: c.confidence,
      source: source || c.source,
      verified: c.verified !== false && source !== 'ondemand-entity-extraction',
      sourceUrl: c.sourceUrl || null,
      observedAt: c.observedAt || null,
      cached: c.cached === true,
      aoi_membership: { inside: gate.allowed, aoi_ids: gate.aoiIds, nearest: m.nearest },
      scene_gate: gate,
      context_membership: m,
      reason: gate.reason,
    });
  };
  const steps = [];
  for (const hit of index.gazetteerLookup(query, 3)) {
    const canonical = normalizePlace(query).replace(/\s+(?:port|iran|yemen|somalia|oman|uae|united arab emirates)$/, '');
    if (!preciseArea && normalizePlace(hit.name) === canonical) push(hit, 'gazetteer');
  }
  steps.push({ step: 'gazetteer', candidates: candidates.length });

  if (!candidates.length && toolInvoker) {
    const geocode = contractRegistry.get('geocode_place');
    if (geocode) {
      try {
        const result = await toolInvoker(geocode, { q: preciseArea ? `${query}, Dubai, United Arab Emirates` : query }, { signal });
        if (result?.ok === false) throw new Error(result?.error?.code || 'geocoder_unavailable');
        const rows = result?.data?.candidates || [];
        for (const r of rows.slice(0, 3)) {
          const rawLat = r?.geometry?.location?.lat;
          const rawLon = r?.geometry?.location?.lng;
          const lat = typeof rawLat === 'number' ? rawLat : NaN;
          const lon = typeof rawLon === 'number' ? rawLon : NaN;
          if (preciseArea && haversineKm(lat, lon, preciseArea.center.lat, preciseArea.center.lon) > preciseArea.radius_km) continue;
          if (Number.isFinite(lat) && Number.isFinite(lon))
            push(
              {
                name: preciseArea ? query : String(r.formatted_address || query).slice(0, 120),
                lat,
                lon,
                country: preciseArea ? 'AE' : null,
                confidence: 0.95,
                sourceUrl: result?.provenance?.source_url || 'https://www.openstreetmap.org',
                observedAt: result?.provider?.fetchedAt || new Date().toISOString(),
              },
              'geocode_place',
            );
        }
        steps.push({
          step: 'geocode_place',
          query,
          status: 'ok',
          candidates: rows.length,
        });
      } catch (err) {
        steps.push({
          step: 'geocode_place',
          error: String(err?.code || err?.message || err).slice(0, 120),
        });
      }
    }
  }

  // Authoritatively observed OSM feature, served by the same backend plugin
  // boundary when its live provider is unavailable. This is explicitly cached
  // geographic data, not a successful live research result or an incident.
  if (!candidates.length && preciseArea?.observed_candidate && !signal?.aborted) {
    push({
      name: query,
      lat: preciseArea.center.lat,
      lon: preciseArea.center.lon,
      country: 'AE', confidence: 0.95, verified: true, cached: true,
      sourceUrl: preciseArea.source.feature_url,
      observedAt: preciseArea.source.observed_utc,
    }, 'osm-verified-cache');
    steps.push({ step: 'verified-geographic-cache', status: 'cached', source: preciseArea.source.feature_url, observedAt: preciseArea.source.observed_utc });
  }
  const strongGazetteer = candidates.some(
    (c) => c.source === 'gazetteer' && c.confidence >= 0.85,
  );
  if (
    useOnDemand &&
    client &&
    isConfigured() &&
    !strongGazetteer &&
    !candidates.length
  ) {
    try {
      const ctxKey = objectContextKey({
        objectType: 'incidentLocate',
        objectId: query.toLowerCase(),
      });
      let conv = await store.get(externalUserId, ctxKey);
      if (!conv?.sessionId) {
        const session = await client.sessions.create({ externalUserId });
        conv = await store.put(externalUserId, ctxKey, {
          sessionId: session.id,
        });
      }
      const out = await client.query.sync(
        conv.sessionId,
        {
          query: LOCATE_PROMPT(query),
          endpointId: odConfig.fulfillmentEndpointId,
          responseMode: 'sync',
          fulfillmentOnly: true,
          reasoningEffort: 'low',
        },
        { signal, timeoutMs: 20_000 },
      );
      const found = parseCandidates(out?.data?.answer);
      for (const c of found) push(c, 'ondemand-entity-extraction');
      steps.push({ step: 'ondemand', candidates: found.length });
    } catch (err) {
      steps.push({
        step: 'ondemand',
        error: String(err?.message || err).slice(0, 120),
      });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  // The gazetteer and the model usually name the SAME place a few km apart
  // ("Hodeidah" vs "Hodeidah Port"): keep the best-confidence one per 15 km
  // so the composer gets one candidate, not a spurious picker.
  const merged = [];
  for (const c of candidates) {
    if (
      merged.some(
        (m) =>
          haversineKm(m.lat, m.lon, c.lat, c.lon) <= SAME_PLACE_KM &&
          m.aoi_membership.inside === c.aoi_membership.inside,
      )
    )
      continue;
    merged.push(c);
  }
  return {
    text: extraction.originalText,
    extraction,
    candidates: merged.slice(0, 5),
    steps,
    status: merged.length
      ? 'resolved'
      : steps.some((s) => s.error)
        ? 'unavailable'
        : 'empty',
  };
}

// ---------------------------------------------------------------- handler
/**
 * @param {object} deps {client, store (conversation), incidentStore, toolInvoker, audit, authorize, env}
 * @returns {(req, res, {path, method}) => Promise<boolean>} true when handled
 */
export function createIncidentRoutes(deps = {}) {
  const env = deps.env || process.env;
  const index = deps.aoiIndex || getAoiIndex();
  const incidents = deps.incidentStore || getIncidentStore();
  const audit = deps.audit || (() => {});
  return async function incidentHandler(
    req,
    res,
    { path, method, url, authorize = deps.authorize },
  ) {
    if (!path.startsWith('/incidents')) return false;
    const sub = path.slice('/incidents'.length) || '/';
    if (sub === '/list' && method === 'GET') {
      const scope = url?.searchParams.get('externalUserId') || SHARED_SCOPE;
      const aoi = url?.searchParams.get('aoi') || 'all';
      sendJson(res, 200, await listPayload(incidents, index, { scope, aoi, diagnosticSeeds: deps.diagnosticSeeds || [] }));
      return true;
    }
    if (sub === '/aoi' && method === 'GET') {
      sendJson(res, 200, {
        config: loadAoiConfig(),
        outlines: index.outlines(),
      });
      return true;
    }
    if (sub === '/ingest' && method === 'POST') {
      const body = await readJsonBody(req, { maxBytes: MAX_BODY });
      const provided = req.headers?.['x-ingest-secret'];
      const secretOk = secretMatches(provided, env.INCIDENT_INGEST_SECRET);
      let scope = SHARED_SCOPE;
      if (!secretOk) {
        // Session-scoped path (composer): the browser never holds the secret.
        if (provided) {
          audit('incident_ingest_denied', { reason: 'bad_secret' });
          sendJson(res, 403, { error: 'bad_ingest_secret' });
          return true;
        }
        const externalUserId = validateExternalUserId(body.externalUserId);
        if (authorize && !authorize(externalUserId)) return true;
        scope = externalUserId;
      }
      const list = Array.isArray(body.incidents)
        ? body.incidents
        : body.incident
          ? [body.incident]
          : null;
      if (!list) throw new ValidationError('incidents', 'array required');
      if (list.length > MAX_INGEST)
        throw new ValidationError('incidents', `at most ${MAX_INGEST}`);
      const screened = screenIncidents(list, {
        membership: index.membership,
        allowOverride: true,
      });
      // Dedupe session writes against the SHARED ledger too: the same cell /
      // category / 6 h bucket already known to everyone is handed back as
      // `existing` (with its scene) instead of being stored twice.
      let toInsert = screened.accepted;
      const existing = [];
      const duplicates = [];
      if (scope !== SHARED_SCOPE) {
        const shared = await incidents.list(SHARED_SCOPE);
        const sharedByKey = new Map(shared.map((i) => [i.dedupe_key, i]));
        toInsert = [];
        for (const inc of screened.accepted) {
          const hit = sharedByKey.get(inc.dedupe_key);
          if (hit) {
            duplicates.push(inc.dedupe_key);
            existing.push(hit);
          } else toInsert.push(inc);
        }
      }
      const stored = await incidents.upsertMany(scope, toInsert);
      const result = {
        inserted: stored.inserted,
        duplicates: [...duplicates, ...stored.duplicates],
        existing: [...existing, ...stored.existing],
      };
      audit('incident_ingest', {
        scope: scope === SHARED_SCOPE ? 'shared' : 'session',
        inserted: result.inserted.length,
        rejected: screened.rejected.length,
        duplicates: result.duplicates.length,
      });
      const payload = await listPayload(incidents, index, { scope, diagnosticSeeds: deps.diagnosticSeeds || [] });
      sendJson(res, 200, {
        inserted: result.inserted,
        inserted_count: result.inserted.length,
        duplicates: result.duplicates,
        existing: result.existing || [],
        rejected: screened.rejected,
        invalid: screened.invalid,
        scope: scope === SHARED_SCOPE ? 'shared' : 'session',
        scenes: buildScenes([...result.inserted, ...(result.existing || [])].filter((incident) => resolveIncidentGate(incident.title, { lat: incident.lat, lon: incident.lon }).allowed)),
        list: { count: payload.count, scene_count: payload.scene_count },
      });
      return true;
    }
    if (sub === '/refresh' && method === 'POST') {
      const body = await readJsonBody(req, { maxBytes: MAX_BODY }).catch(
        () => ({}),
      );
      const controller = new AbortController();
      const abort = () => controller.abort();
      // IncomingMessage 'close' also fires after a normally completed request.
      // Abort only for a real disconnect, not successful body consumption.
      const responseClosed = () => { if (!res.writableEnded) abort(); };
      req.on?.('aborted', abort);
      res.on?.('close', responseClosed);
      try {
        const pulled = await refreshFromPlugins({
          client: deps.client,
          store: deps.store,
          toolInvoker: deps.toolInvoker,
          signal: controller.signal,
          contracts: Array.isArray(body.contracts)
            ? body.contracts.slice(0, 6)
            : undefined,
        });
        const screened = screenIncidents(pulled.raw, {
          membership: index.membership,
        });
        const result = await incidents.upsertMany(
          SHARED_SCOPE,
          screened.accepted,
        );
        audit('incident_refresh', {
          pulled: pulled.raw.length,
          inserted: result.inserted.length,
          rejected: screened.rejected.length,
        });
        const payload = await listPayload(incidents, index, {
          scope: SHARED_SCOPE,
        });
        sendJson(res, 200, {
          pulled: pulled.raw.length,
          inserted_count: result.inserted.length,
          inserted: result.inserted,
          duplicates: result.duplicates.length,
          rejected: screened.rejected,
          invalid: screened.invalid.length,
          sources: pulled.sources,
          list: { count: payload.count, scene_count: payload.scene_count },
          workflow_hook:
            'TODO: scheduled OnDemand workflow → POST /api/ondemand/v2/incidents/ingest with X-Ingest-Secret (NEXT_ACTIONS N-33)',
        });
      } finally {
        req.off?.('aborted', abort);
        res.off?.('close', responseClosed);
      }
      return true;
    }
    if (sub === '/search' && method === 'POST') {
      const body = await readJsonBody(req, { maxBytes: 64 * 1024 });
      if (typeof body.text !== 'string' || !body.text.trim())
        throw new ValidationError('text', 'required');
      const externalUserId = validateExternalUserId(body.externalUserId);
      if (authorize && !authorize(externalUserId)) return true;
      const out = await searchIncidentsAt(body, {
        client: deps.client,
        ...(deps.searchOptions || {}),
      });
      sendJson(res, 200, out);
      return true;
    }
    if (sub === '/locate' && method === 'POST') {
      const body = await readJsonBody(req, { maxBytes: 64 * 1024 });
      if (typeof body.text !== 'string' || !body.text.trim())
        throw new ValidationError('text', 'required');
      const externalUserId = body.externalUserId !== undefined
        ? validateExternalUserId(body.externalUserId) : 'incident-locate';
      if (authorize && !authorize(externalUserId)) return true;
      const out = await locateText(body.text, {
        index,
        client: deps.client,
        store: deps.store,
        toolInvoker: deps.toolInvoker,
        externalUserId,
        signal: AbortSignal.timeout(45_000),
        useOnDemand: body.useOnDemand !== false,
      });
      sendJson(res, 200, out);
      return true;
    }
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, sub === '/' ? 404 : 405, {
      error: sub === '/' ? 'not_found' : 'method_not_allowed',
      routes: [
        'GET /incidents/list',
        'GET /incidents/aoi',
        'POST /incidents/ingest',
        'POST /incidents/refresh',
        'POST /incidents/locate',
        'POST /incidents/search',
      ],
    });
    return true;
  };
}
