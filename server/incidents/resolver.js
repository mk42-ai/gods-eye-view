/**
 * server/incidents/resolver.js — OnDemand-backed incident intelligence for
 * the UAE AOI library: entity extraction + geocoding (`resolve`) and the
 * per-AOI news sweep (`refresh`). Every model call goes through the
 * foundation client (server-side ONDEMAND_API_KEY only) and the
 * PluginContract registry; the built-in gazetteer is the honest fallback
 * when OnDemand is not configured, unavailable, or returns no coordinates.
 *
 * Nothing here fabricates activity: a refresh without a key reports
 * `{ state: 'NO KEY' }` and ingests nothing.
 */
import { config, isConfigured } from '../ondemand/config.js';
import {
  getOnDemandClient,
  linkedSignal,
} from '../ondemand/foundation/client.js';
import { contractRegistry } from '../ondemand/foundation/contracts.js';
import {
  getConversationStore,
  objectContextKey,
} from '../ondemand/foundation/conversation-store.js';
import {
  extractCitations,
  recogniseEntities,
} from '../ondemand/foundation/intelligence-object.js';
import { wrapUntrusted } from '../ondemand/foundation/guards.js';
import {
  findAoiForPoint,
  gazetteerLookup,
  listAois,
  summariseAoi,
} from '../../src/data/uaeAoi.js';
import {
  normaliseSeverity,
  safeUrl,
  toIsoUtc,
} from '../../src/data/uaeIncidents.js';

export const INCIDENT_EXTERNAL_USER = 'workstation-incidents';
const RESOLVE_TIMEOUT_MS = 25_000;
const REFRESH_PLUGIN_TIMEOUT_MS = 30_000;
/** Whole-sweep budget: Vercel functions cap at 60 s (vercel.json maxDuration). */
const REFRESH_BUDGET_MS = 50_000;
const INCIDENT_TERMS =
  'incident OR strike OR attack OR seizure OR piracy OR cyberattack';

const RESOLVE_SCHEMA = `{
  "placeName": string|null,          // most specific place named in the text
  "lat": number|null,                // WGS84 decimal degrees, null when unknown
  "lon": number|null,
  "country": string|null,
  "summary": string,                 // one sentence, <= 240 chars, no new facts
  "incident_type": string,           // snake_case, e.g. drone_strike, piracy_hijack, cyber, maritime_attack
  "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "entities": string[],              // actors, vessels, units, organisations named in the text
  "event_time_utc": string|null      // ISO-8601 UTC if the text states a time, else null
}`;

/** Prompt for one resolve call; the user text is fenced as untrusted data. */
export function resolvePrompt(text) {
  return [
    'You are the geocoding and classification step of a maritime/security incident workstation.',
    'Read the incident text below and answer with ONE JSON object only (no prose, no code fence) matching this schema:',
    RESOLVE_SCHEMA,
    'Rules: coordinates must be real WGS84 values for the named place (ports, straits, islands, cities); use null when you cannot place it. Never invent facts that are not in the text.',
    wrapUntrusted('incident_text', text),
  ].join('\n');
}

/** Parse the model's JSON (tolerates fences/prose around it); null when unparseable. */
export function parseResolveAnswer(answer) {
  const s = String(answer ?? '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!j || typeof j !== 'object') return null;
    const lat = Number(j.lat);
    const lon = Number(j.lon);
    const hasCoords =
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      !(lat === 0 && lon === 0);
    return {
      placeName: j.placeName ? String(j.placeName).slice(0, 160) : null,
      lat: hasCoords ? lat : null,
      lon: hasCoords ? lon : null,
      country: j.country ? String(j.country).slice(0, 64) : null,
      summary: String(j.summary ?? '').slice(0, 480),
      incident_type: String(j.incident_type || 'unclassified')
        .toLowerCase()
        .replace(/[^a-z0-9_/]+/g, '_')
        .slice(0, 64),
      severity: normaliseSeverity(j.severity),
      entities: Array.isArray(j.entities)
        ? j.entities.map((e) => String(e).slice(0, 80)).slice(0, 20)
        : [],
      event_time_utc: toIsoUtc(j.event_time_utc),
    };
  } catch {
    return null;
  }
}

/** Offline resolution — the gazetteer + heuristics; always returns a result. */
export function resolveOffline(text, { now = () => new Date() } = {}) {
  const hit = gazetteerLookup(text);
  const lower = String(text || '').toLowerCase();
  const incident_type = /hijack/.test(lower)
    ? 'piracy_hijack'
    : /pira/.test(lower)
      ? 'piracy'
      : /cyber/.test(lower)
        ? 'cyber'
        : /drone|uav/.test(lower) && /strike|attack|hit/.test(lower)
          ? 'drone_strike'
          : /missile/.test(lower)
            ? 'missile_drone'
            : /tanker|vessel|ship|boat/.test(lower) &&
                /struck|attack|strike|fire|hit/.test(lower)
              ? 'maritime_attack'
              : /airstrike|air strike/.test(lower)
                ? 'airstrike'
                : /seiz|captur/.test(lower)
                  ? 'territorial_seizure'
                  : /blockade|closed|closure/.test(lower)
                    ? 'closure'
                    : /jam|gps|gnss/.test(lower)
                      ? 'gnss_interference'
                      : /clash|combat|fighting|shell/.test(lower)
                        ? 'ground_combat'
                        : 'unclassified';
  const severity = /kill|dead|casualt|hijack|closed|seiz|critical/.test(lower)
    ? 'HIGH'
    : /strike|attack|missile|drone|blockade/.test(lower)
      ? 'HIGH'
      : /warn|probe|exercise|release/.test(lower)
        ? 'LOW'
        : 'MEDIUM';
  const entities = recogniseEntities(String(text || '')).map((e) => e.name);
  const base = {
    placeName: hit?.name || null,
    lat: hit?.lat ?? null,
    lon: hit?.lon ?? null,
    country: hit?.country || null,
    summary: String(text || '')
      .trim()
      .slice(0, 240),
    incident_type,
    severity,
    entities,
    event_time_utc: now().toISOString(),
  };
  return finishResolution(base, {
    text,
    provider: 'gazetteer',
    gazetteerAlias: hit?.alias || null,
    confidence: hit?.confidence ?? 0,
  });
}

function finishResolution(
  result,
  { text, provider, gazetteerAlias, confidence, sources = [], raw },
) {
  const hasCoords = Number.isFinite(result.lat) && Number.isFinite(result.lon);
  const match = hasCoords ? findAoiForPoint(result.lat, result.lon) : null;
  const matchedAoi = summariseAoi(match);
  return {
    text: String(text || '').slice(0, 2048),
    lat: hasCoords ? result.lat : null,
    lon: hasCoords ? result.lon : null,
    placeName: result.placeName || match?.name || null,
    country: result.country || match?.country || null,
    matchedAoi,
    group: matchedAoi?.group || null,
    insideAoi: !!match,
    summary: result.summary,
    incident_type: result.incident_type,
    severity: result.severity,
    entities: result.entities || [],
    event_time_utc: result.event_time_utc,
    sources: sources
      .map((s) => ({ url: safeUrl(s.url), title: s.title || null }))
      .filter((s) => s.url),
    provenance: {
      provider,
      keySource: 'server',
      gazetteerAlias: gazetteerAlias || null,
      confidence,
      ...(raw ? { raw } : {}),
    },
  };
}

/**
 * Resolve free text to a place + classification through OnDemand (server
 * key), falling back to the gazetteer when the platform is unavailable or
 * returns no coordinates.
 */
export async function resolveIncidentText(
  text,
  {
    client = isConfigured() ? getOnDemandClient() : null,
    store = getConversationStore(),
    now = () => new Date(),
    signal,
    timeoutMs = RESOLVE_TIMEOUT_MS,
  } = {},
) {
  const cleaned = String(text || '').trim();
  if (!cleaned) throw new Error('text required');
  const offline = resolveOffline(cleaned, { now });
  if (!client)
    return {
      ...offline,
      provenance: { ...offline.provenance, fallbackReason: 'not_configured' },
    };
  const link = linkedSignal(signal, timeoutMs);
  const started = Date.now();
  try {
    const ctxKey = objectContextKey({
      objectType: 'incidentResolve',
      objectId: 'composer',
    });
    let conv = await store.get(INCIDENT_EXTERNAL_USER, ctxKey);
    if (!conv?.sessionId) {
      const session = await client.sessions.create({
        externalUserId: INCIDENT_EXTERNAL_USER,
      });
      conv = await store.put(INCIDENT_EXTERNAL_USER, ctxKey, {
        sessionId: session.id,
        pluginIds: [],
      });
    }
    const out = await client.query.sync(
      conv.sessionId,
      {
        query: resolvePrompt(cleaned),
        endpointId: config.fulfillmentEndpointId,
        responseMode: 'sync',
        fulfillmentOnly: true,
        reasoningEffort: 'low',
      },
      { signal: link.signal, timeoutMs },
    );
    await store.touch(INCIDENT_EXTERNAL_USER, ctxKey);
    const parsed = parseResolveAnswer(out?.data?.answer);
    const ms = Date.now() - started;
    if (!parsed)
      return {
        ...offline,
        provenance: {
          ...offline.provenance,
          fallbackReason: 'malformed_json',
          ondemandMs: ms,
          sessionId: conv.sessionId,
        },
      };
    if (parsed.lat === null || parsed.lon === null) {
      // The model classified but could not place it — keep its classification, place it with the gazetteer.
      const merged = {
        ...parsed,
        lat: offline.lat,
        lon: offline.lon,
        placeName: parsed.placeName || offline.placeName,
        country: parsed.country || offline.country,
        summary: parsed.summary || offline.summary,
        event_time_utc: parsed.event_time_utc || offline.event_time_utc,
      };
      return finishResolution(merged, {
        text: cleaned,
        provider: 'ondemand+gazetteer',
        gazetteerAlias: offline.provenance.gazetteerAlias,
        confidence: offline.provenance.confidence,
        raw: {
          sessionId: conv.sessionId,
          messageId: out?.data?.messageId,
          ms,
          endpointId: config.fulfillmentEndpointId,
        },
      });
    }
    return finishResolution(
      {
        ...parsed,
        event_time_utc: parsed.event_time_utc || offline.event_time_utc,
      },
      {
        text: cleaned,
        provider: 'ondemand',
        gazetteerAlias: offline.provenance.gazetteerAlias,
        confidence: 0.8,
        raw: {
          sessionId: conv.sessionId,
          messageId: out?.data?.messageId,
          ms,
          endpointId: config.fulfillmentEndpointId,
        },
      },
    );
  } catch (error) {
    return {
      ...offline,
      provenance: {
        ...offline.provenance,
        fallbackReason:
          error?.name === 'OnDemandAbortError' ? 'timeout' : 'upstream_error',
        upstreamError: String(error?.message || error).slice(0, 200),
      },
    };
  } finally {
    link.cleanup();
  }
}

// ------------------------------------------------------------------ refresh

const REFRESH_SCHEMA = `{"incidents":[{"headline":string,"summary":string,"placeName":string,"lat":number|null,"lon":number|null,"incident_type":string,"severity":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL","event_time_utc":string|null,"source_url":string|null,"source_name":string|null}]}`;

/** Research prompt for one AOI (the plugin does the web retrieval). */
export function refreshPrompt(aoi, { sinceIso } = {}) {
  const p = aoi.properties;
  return [
    `Find the latest security incidents (${INCIDENT_TERMS}) at or near "${p.name}" (${p.country}, approx ${p.center.lat.toFixed(2)}N ${p.center.lon.toFixed(2)}E)${sinceIso ? ` reported since ${sinceIso}` : ' in the last 14 days'}.`,
    'Answer with ONE JSON object only matching this schema (no prose, no code fence):',
    REFRESH_SCHEMA,
    'Include only incidents with a real source URL. Coordinates are WGS84 decimal degrees for the incident location (null if unknown). Return {"incidents":[]} when nothing is reported.',
  ].join('\n');
}

/** Parse a refresh answer into candidate incidents (no AOI filtering yet). */
export function parseRefreshAnswer(
  answer,
  aoi,
  { pluginId, now = () => new Date() } = {},
) {
  const s = String(answer ?? '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return { incidents: [], parsed: false };
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return { incidents: [], parsed: false };
  }
  const citations = extractCitations(s);
  const list = Array.isArray(j?.incidents) ? j.incidents : [];
  const incidents = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object' || !item.headline) continue;
    let lat = Number(item.lat);
    let lon = Number(item.lon);
    let geocoder = 'ondemand';
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (lat === 0 && lon === 0)
    ) {
      const hit = gazetteerLookup(`${item.placeName || ''} ${item.headline}`);
      if (hit) {
        lat = hit.lat;
        lon = hit.lon;
        geocoder = 'gazetteer';
      } else {
        lat = aoi.properties.center.lat;
        lon = aoi.properties.center.lon;
        geocoder = 'aoi_center';
      }
    }
    // Only the candidate's OWN source URL counts; a URL cited elsewhere in
    // the answer is never attached to a different incident (no fabricated
    // citations). `citations` is kept for provenance only.
    const source_url = safeUrl(item.source_url);
    if (!source_url) continue;
    incidents.push({
      headline: String(item.headline).slice(0, 512),
      summary: String(item.summary || '').slice(0, 2048),
      lat,
      lon,
      incident_type: String(item.incident_type || 'unclassified')
        .toLowerCase()
        .replace(/[^a-z0-9_/]+/g, '_')
        .slice(0, 64),
      severity: normaliseSeverity(item.severity),
      event_time_utc: toIsoUtc(item.event_time_utc) || now().toISOString(),
      source_url,
      source_name: item.source_name
        ? String(item.source_name).slice(0, 160)
        : null,
      group: aoi.properties.group,
      country: aoi.properties.country,
      aoi_id: aoi.properties.id,
      provenance: {
        provider: 'OnDemand',
        pluginId: pluginId || null,
        geocoder,
        aoiQuery: aoi.properties.id,
        answerCitations: citations.length,
        keySource: 'server',
      },
    });
  }
  return { incidents, parsed: true };
}

/** Pick the research plugin contract used for the sweep (first active one). */
export function refreshPluginContract(registry = contractRegistry) {
  const preferred = [
    'internet_web_search',
    'perplexity_research',
    'gpt_search',
  ];
  for (const name of preferred) {
    const c = registry.get(name);
    if (c && c.availability === 'active') return c;
  }
  return (
    registry.list({ kind: 'ondemand-plugin', availability: 'active' })[0] ||
    null
  );
}

/**
 * Sweep every AOI (optionally one group) through the research plugin and
 * return candidate incidents filtered to the AOI polygons. Returns
 * `{ state: 'NO KEY' }` honestly when the server key is absent.
 */
export async function refreshIncidents({
  client = isConfigured() ? getOnDemandClient() : null,
  store = getConversationStore(),
  registry = contractRegistry,
  group,
  limitAois = 12,
  concurrency = 3,
  signal,
  now = () => new Date(),
  timeoutMs = REFRESH_PLUGIN_TIMEOUT_MS,
  budgetMs = REFRESH_BUDGET_MS,
  log = () => {},
} = {}) {
  if (!client)
    return { state: 'NO KEY', candidates: [], perAoi: [], plugin: null };
  const sweepStarted = Date.now();
  const budgetLeft = () => budgetMs - (Date.now() - sweepStarted);
  const contract = refreshPluginContract(registry);
  if (!contract)
    return { state: 'NO PLUGIN', candidates: [], perAoi: [], plugin: null };
  const aois = listAois({ group }).slice(0, limitAois);
  const perAoi = [];
  const candidates = [];
  const queue = [...aois];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const aoi = queue.shift();
      const startedAt = Date.now();
      if (budgetLeft() < 5_000) {
        perAoi.push({
          aoi: aoi.properties.id,
          group: aoi.properties.group,
          status: 'skipped_budget',
          ms: 0,
        });
        continue;
      }
      const link = linkedSignal(signal, Math.min(timeoutMs, budgetLeft()));
      try {
        const ctxKey = objectContextKey({
          objectType: 'incidentRefresh',
          objectId: aoi.properties.id,
        });
        let conv = await store.get(INCIDENT_EXTERNAL_USER, ctxKey);
        if (!conv?.sessionId) {
          const session = await client.sessions.create({
            externalUserId: INCIDENT_EXTERNAL_USER,
            pluginIds: [contract.pluginId],
          });
          conv = await store.put(INCIDENT_EXTERNAL_USER, ctxKey, {
            sessionId: session.id,
            pluginIds: [contract.pluginId],
          });
        }
        const out = await client.query.sync(
          conv.sessionId,
          {
            query: refreshPrompt(aoi),
            endpointId: config.fulfillmentEndpointId,
            responseMode: 'sync',
            pluginIds: [contract.pluginId],
            fulfillmentOnly: false,
            reasoningEffort: 'low',
          },
          { signal: link.signal, timeoutMs },
        );
        await store.touch(INCIDENT_EXTERNAL_USER, ctxKey);
        const parsed = parseRefreshAnswer(out?.data?.answer, aoi, {
          pluginId: contract.pluginId,
          now,
        });
        const inside = [];
        const outside = [];
        for (const c of parsed.incidents) {
          const match = findAoiForPoint(c.lat, c.lon);
          if (match)
            inside.push({
              ...c,
              aoi_id: match.id,
              group: match.group,
              country: match.country,
              insideAoi: true,
            });
          else outside.push(c.headline);
        }
        candidates.push(...inside);
        perAoi.push({
          aoi: aoi.properties.id,
          group: aoi.properties.group,
          status: 'ok',
          parsed: parsed.parsed,
          found: parsed.incidents.length,
          inside: inside.length,
          outside: outside.length,
          ms: Date.now() - startedAt,
          sessionId: conv.sessionId,
          messageId: out?.data?.messageId || null,
        });
      } catch (error) {
        perAoi.push({
          aoi: aoi.properties.id,
          group: aoi.properties.group,
          status: link.timedOut() ? 'timeout' : 'error',
          error: String(error?.message || error).slice(0, 200),
          ms: Date.now() - startedAt,
        });
        log(
          `[incidents] refresh ${aoi.properties.id} failed: ${error?.message || error}`,
        );
      } finally {
        link.cleanup();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return {
    state: 'LIVE',
    plugin: { name: contract.name, pluginId: contract.pluginId },
    endpointId: config.fulfillmentEndpointId,
    candidates,
    perAoi,
  };
}
