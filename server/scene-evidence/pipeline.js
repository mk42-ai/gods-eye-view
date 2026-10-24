/**
 * Scene evidence pipeline (server-only): fans a BUILD SCENE out to every
 * configured source IN PARALLEL with a per-source budget, normalises and
 * streams partial results through `emit`, enriches posts with official oEmbed
 * (public profile fields + titles), and caches the finished set per scene key.
 *
 * Events (in order of arrival, all JSON):
 *   plan     {key, place, aliases, anchor, radiusKm, windowHours, engine, sources:[{id,name,kind,state,credentials}]}
 *   source   {id, state: running|ok|empty|error|timeout|unavailable|credentials_required, ms, count, note}
 *   item     EvidenceItem (upsert by id; re-sent when merged/enriched)
 *   signal   Signal
 *   summary  {text, engine, ms, fallback?}
 *   done     {key, cached:false, totals, timings:{firstItemMs, firstSignalMs, sourcesMs, totalMs, intentMs, summaryMs}, items, signals, sources}
 *   cached   (instead of the above, when served from cache) same shape as done + cachedAt
 */
import {
  buildEvidenceItem,
  buildSignal,
  rankEvidence,
  dedupeEvidence,
  refreshFreshness,
  sanitizeForCache,
  evidenceKey,
  scoreGeo,
  mentionsPlace,
} from '../../src/sceneEvidence/model.js';
import { SourceError, enrichWithOembed } from './sources.js';
import { CEREBRAS_ONDEMAND_ENDPOINT } from './inference.js';

const TTL_MS = 15 * 60_000;
const MAX_CACHE = 64;

export function createEvidenceCache({ ttlMs = TTL_MS, max = MAX_CACHE, now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (now() - e.at > ttlMs) {
        map.delete(key);
        return null;
      }
      return e;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { ...value, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

async function withBudget(promise, ms, signal) {
  let timer;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new SourceError('timeout', `budget ${ms} ms exceeded`)), ms);
  });
  try {
    return await Promise.race([promise, t, ...(signal ? [new Promise((_, rej) => signal.addEventListener('abort', () => rej(new SourceError('error', 'aborted')), { once: true }))] : [])]);
  } finally {
    clearTimeout(timer);
  }
}

async function pool(tasks, n) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const k = i++;
      out[k] = await tasks[k]().catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runSceneEvidence(input, deps) {
  const t0 = Date.now();
  const now = deps.now || new Date();
  const env = deps.env || process.env;
  const emit = deps.emit || (() => {});
  const signal = deps.signal;
  const cache = deps.cache;
  const sources = deps.sources;
  const timings = { firstItemMs: null, firstSignalMs: null, intentMs: 0, summaryMs: 0, sourcesMs: null, totalMs: null };
  const radiusKm = Math.max(1, Math.min(50, Number(input.radiusKm) || 5));
  const windowHours = Math.max(1, Math.min(168, Number(input.windowHours) || 72));
  const anchor = Number.isFinite(input.lat) && Number.isFinite(input.lon) ? { lat: input.lat, lon: input.lon } : null;
  const key = evidenceKey({ sceneId: input.sceneId, place: input.place || input.text, lat: input.lat, lon: input.lon, radiusKm, windowHours });

  // ---------------- cache
  if (cache && !input.fresh) {
    const hit = cache.get(key);
    if (hit) {
      const items = rankEvidence(refreshFreshness(hit.items, now));
      const payload = { ...hit, key, cached: true, cachedAt: new Date(hit.at).toISOString(), items, timings: { totalMs: Date.now() - t0 } };
      emit('cached', payload);
      return payload;
    }
  }

  // ---------------- intent (place + aliases); skipped when the composer already resolved a place
  const inference = deps.inference;
  let intent;
  if (input.place) intent = { place: String(input.place).slice(0, 80), aliases: [], engine: 'composer', windowHours };
  else {
    intent = await inference.parseIntent(input.text || '', { signal });
    timings.intentMs = intent.ms || 0;
  }
  const place = intent.place;
  const aliases = intent.aliases || [];
  const engine = inference.engine;
  const pluginEndpointId = engine === 'deterministic' ? deps.defaultEndpointId : CEREBRAS_ONDEMAND_ENDPOINT;

  const status = sources.map((s) => {
    const configured = s.configured(env);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      platforms: s.platforms,
      credentials: s.credentials,
      docs: s.docs,
      state: configured ? 'running' : 'credentials_required',
      note: configured ? '' : `credentials required: ${s.credentials.join(' + ')}`,
      ms: null,
      count: 0,
    };
  });
  emit('plan', { key, place, aliases, anchor, radiusKm, windowHours, engine, intentEngine: intent.engine, pluginEndpointId, sources: status });

  // ---------------- fan-out
  const items = new Map();
  const signals = new Map();
  const ctxBase = { place, aliases, anchor, now, windowHours };
  const enrichQueue = [];
  const onRaw = (src) => (ev) => {
    if (signal?.aborted) return;
    if (ev.type === 'item') {
      const it = buildEvidenceItem(ev.raw, ctxBase);
      if (!it) return;
      const prev = items.get(it.id);
      const rank = { exact: 3, place: 2, text: 1, none: 0 };
      if (prev && rank[prev.geo.precision] >= rank[it.geo.precision] && (prev.publishedAt || !it.publishedAt)) {
        prev.alsoFrom = [...new Set([...(prev.alsoFrom || []), src.id])];
        return;
      }
      if (prev) it.alsoFrom = [...new Set([...(prev.alsoFrom || []), prev.source.id])];
      items.set(it.id, it);
      if (timings.firstItemMs === null) timings.firstItemMs = Date.now() - t0;
      emit('item', it);
      if (!prev) enrichQueue.push(it.id);
    } else if (ev.type === 'signal') {
      const s = buildSignal(ev.raw, ctxBase);
      if (!s || signals.has(s.id)) return;
      signals.set(s.id, s);
      if (timings.firstSignalMs === null) timings.firstSignalMs = Date.now() - t0;
      emit('signal', s);
    }
  };

  const runOne = async (src, st) => {
    if (st.state === 'credentials_required') {
      emit('source', st);
      return;
    }
    const s0 = Date.now();
    emit('source', st);
    const ctx = { ...ctxBase, query: [place, ...aliases.slice(0, 1)].join(' OR ').slice(0, 120), radiusKm, env, fetch: deps.fetch, invoke: deps.invoke, signal, pluginEndpointId };
    try {
      let r;
      try {
        r = await withBudget(src.run(ctx, onRaw(src)), src.budgetMs, signal);
      } catch (err) {
        // Fast endpoint failed (not a timeout/credentials problem) → one retry on the default endpoint.
        const retryable = /plugin|ondemand/i.test(src.docs) && pluginEndpointId !== deps.defaultEndpointId && !(err instanceof SourceError && ['timeout', 'unavailable', 'credentials_required'].includes(err.state));
        if (!retryable) throw err;
        r = await withBudget(src.run({ ...ctx, pluginEndpointId: deps.defaultEndpointId }, onRaw(src)), Math.max(4000, src.budgetMs - (Date.now() - s0)), signal);
        r.note = `${r.note || ''} (retried on ${deps.defaultEndpointId})`.trim();
      }
      Object.assign(st, { state: r.count ? 'ok' : 'empty', count: r.count, note: r.note || '', ms: Date.now() - s0 });
    } catch (err) {
      const state = err instanceof SourceError ? err.state : /timeout|abort/i.test(String(err?.name || err?.message)) ? 'timeout' : 'error';
      Object.assign(st, { state, note: String(err?.message || err).replace(/(key|token|bearer|access_token)=?[^\s&]*/gi, '$1=[redacted]').slice(0, 200), ms: Date.now() - s0 });
    }
    emit('source', st);
  };

  // oEmbed enrichment runs concurrently with the sources (drains as items arrive).
  let fanoutDone = false;
  const enricher = (async () => {
    const enriched = new Set();
    while (!signal?.aborted) {
      const batch = enrichQueue.splice(0, 6).filter((id) => !enriched.has(id));
      if (!batch.length) {
        if (fanoutDone) break;
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      await pool(
        batch.map((id) => async () => {
          enriched.add(id);
          const it = items.get(id);
          if (!it) return;
          const e = await enrichWithOembed(it, { fetch: deps.fetch, env, signal, timeoutMs: 3500 });
          if (!e?.ok) {
            it.embedStatus = e?.status === 404 || e?.status === 400 ? 'unavailable' : 'unverified';
            emit('item', it);
            return;
          }
          it.embedStatus = 'verified';
          if (e.title && (!it.title || it.title === it.url)) it.title = e.title.slice(0, 220);
          if (e.text && it.platform === 'x') it.snippet = e.text;
          if (e.thumbnail) it.thumbnail = e.thumbnail;
          const a = e.author || {};
          it.author = { ...it.author, ...(a.name && !it.author.name ? { name: a.name } : {}), ...(a.url && !it.author.url ? { url: a.url } : {}), ...(a.handle && !it.author.handle ? { handle: a.handle } : {}), source: it.author.source || a.source };
          it.author.fields = ['name', 'handle', 'url', 'avatar', 'bio', 'followers', 'verified'].filter((k) => it.author[k] !== undefined && it.author[k] !== null && it.author[k] !== '');
          if (it.geo.precision === 'none' && mentionsPlace(`${it.title} ${it.snippet}`, place, aliases)) it.geo = scoreGeo({ text: `${it.title} ${it.snippet}`, place, aliases, anchor });
          emit('item', it);
        }),
        6,
      );
    }
  })();

  await Promise.all(sources.map((s, i) => runOne(s, status[i])));
  timings.sourcesMs = Date.now() - t0;
  fanoutDone = true;
  await withBudget(enricher, 6000).catch(() => {});

  const ranked = rankEvidence(dedupeEvidence([...items.values()]));
  const sigs = [...signals.values()].sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
  const summary = await inference.summarize({ place, items: ranked, signals: sigs, sources: status }, { signal });
  timings.summaryMs = summary.ms || 0;
  emit('summary', summary);
  timings.totalMs = Date.now() - t0;
  const totals = {
    items: ranked.length,
    signals: sigs.length,
    byFreshness: ranked.reduce((m, x) => ((m[x.freshness] = (m[x.freshness] || 0) + 1), m), {}),
    byGeo: ranked.reduce((m, x) => ((m[x.geo.precision] = (m[x.geo.precision] || 0) + 1), m), {}),
    sources: status.reduce((m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m), {}),
  };
  const result = { key, place, aliases, anchor, radiusKm, windowHours, engine, items: ranked, signals: sigs, sources: status, summary, totals, timings, builtAt: now.toISOString() };
  if (cache && !signal?.aborted) cache.set(key, { ...result, items: ranked.map(sanitizeForCache) });
  emit('done', { ...result, cached: false });
  return result;
}
