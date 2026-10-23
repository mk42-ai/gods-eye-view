/**
 * Scene video orchestrator — fans a scene build out to the YouTube, TikTok
 * and Instagram lanes IN PARALLEL, every provider call going through an
 * OnDemand chat session bound to ONE plugin (BLOCKERS B-3: explicit short
 * pluginIds per query). Custom code here is only a proxy / normaliser:
 * it parses the plugin answers, dedupes, ranks and labels (src/sceneVideos/evidence.js).
 *
 * Plugins (live-verified 2026-10-23, docs/agent-execution/INTEGRATION_MATRIX.md):
 *   plugin-1740745780  AI Search (Tavily)          — site: search for YouTube / TikTok / Instagram URLs
 *   plugin-1792727178  YouTube oEmbed API (custom, created 2026-10-23T03:46:18Z) — verify + title/author
 *   plugin-1792727179  TikTok oEmbed API  (custom, created 2026-10-23T03:46:19Z) — verify + title/author
 *   plugin-1716372717  TikTok scraper (RapidAPI)   — primary TikTok search; MONTHLY quota exhausted → circuit breaker
 *   plugin-1762980461  Instagram Content Downloader — downloadInstagramMedia → shortUrl (playable mp4)
 *   plugin-1784356219  YouTube Captions            — misconfigured ("field key is missing") → not used for offsets;
 *                                                   offsets come from [m:ss] transcript snippets in search results
 *
 * emit(event, data) is called progressively:
 *   plan · incident · source (lane status) · clip (one VideoEvidence) · ranked (snapshot) · done
 */
import { readFileSync } from 'node:fs';
import { buildVideoQueryPlan } from './plan.js';
import {
  normalizeEvidence,
  dedupeEvidence,
  rankEvidence,
  countByPlatform,
  parseVideoUrl,
  instagramCdnMeta,
} from '../../src/sceneVideos/evidence.js';

export const SCENE_VIDEO_PLUGINS = Object.freeze({
  search: { pluginId: 'plugin-1740745780', name: 'AI Search (Tavily)' },
  youtubeOembed: { pluginId: 'plugin-1792727178', name: 'YouTube oEmbed API' },
  tiktokOembed: { pluginId: 'plugin-1792727179', name: 'TikTok oEmbed API' },
  tiktokSearch: {
    pluginId: 'plugin-1716372717',
    name: 'TikTok (RapidAPI tiktok-scraper7)',
  },
  instagramDownload: {
    pluginId: 'plugin-1762980461',
    name: 'Instagram Content Downloader Tool',
  },
  youtubeCaptions: {
    pluginId: 'plugin-1784356219',
    name: 'YouTube Data API v3 - Captions',
  },
});

const MAX_PER_LANE = 6;
const RELEVANCE_MIN_KEYWORD = 0.01;

let hintsCache = null;
export function loadIncidentHints() {
  if (!hintsCache) {
    try {
      hintsCache = JSON.parse(
        readFileSync(
          new URL(
            '../../config/scene-videos/incident-hints.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    } catch {
      hintsCache = [];
    }
  }
  return hintsCache;
}

/** Pick the incident hint the prompt refers to (most recent match). */
export function matchIncidentHint(plan, hints = loadIncidentHints()) {
  const text = `${plan.prompt} ${plan.places.join(' ')}`.toLowerCase();
  const hits = hints.filter((h) =>
    (h.match || []).some((m) => text.includes(String(m).toLowerCase())),
  );
  hits.sort((a, b) =>
    String(b.reported_at).localeCompare(String(a.reported_at)),
  );
  return hits[0] || null;
}

// ---------------------------------------------------------------- parsing
/** Pull a JSON array/object out of an LLM answer (first balanced block). */
export function extractJson(text) {
  const s = String(text || '');
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ]) {
    const start = s.indexOf(open);
    const end = s.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
export function extractUrls(text) {
  return [...new Set(String(text || '').match(URL_RE) || [])].map((u) =>
    u.replace(/[.,;]+$/, ''),
  );
}

/** "[0:52] … accident …" in a transcript snippet → 52 (first keyword hit). */
export function captionOffsetFromSnippet(snippet, keywords = []) {
  const s = String(snippet || '');
  const re = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]([^[]*)/g;
  const kws = keywords.map((k) => String(k).toLowerCase()).filter(Boolean);
  let m;
  while ((m = re.exec(s))) {
    const seg = m[4].toLowerCase();
    if (!kws.length || kws.some((k) => seg.includes(k))) {
      return m[3] !== undefined
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        : Number(m[1]) * 60 + Number(m[2]);
    }
  }
  return 0;
}

/** Normalise a search answer into [{url,title,published,snippet}]. */
export function parseSearchHits(answer) {
  const json = extractJson(answer);
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.results)
      ? json.results
      : [];
  const out = rows
    .filter((r) => r && typeof r === 'object' && r.url)
    .map((r) => ({
      url: String(r.url),
      title: String(r.title || ''),
      published: r.published || r.published_date || r.date || null,
      snippet: String(r.snippet || r.content || ''),
    }));
  if (out.length) return out;
  return extractUrls(answer).map((url) => ({
    url,
    title: '',
    published: null,
    snippet: '',
  }));
}

// ---------------------------------------------------------------- invoker
/**
 * Real invoker over the foundation OnDemand client: one FRESH session per call
 * (a distinct principal too — OnDemand answers 409 when a second query overlaps
 * a still-running query of the same user+plugin).
 */
export function createPluginInvoker({
  client,
  endpointId,
  externalUserId = 'scene-videos',
}) {
  return async function invoke(
    pluginId,
    query,
    { signal, timeoutMs = 45_000 } = {},
  ) {
    const startedAt = new Date().toISOString();
    const principal = `${externalUserId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const session = await client.sessions.create({
      externalUserId: principal,
      pluginIds: [pluginId],
    });
    const out = await client.query.sync(
      session.id,
      {
        query,
        endpointId,
        responseMode: 'sync',
        pluginIds: [pluginId],
        fulfillmentOnly: false,
        reasoningEffort: 'low',
      },
      { signal, timeoutMs },
    );
    return {
      answer: String(out?.data?.answer ?? ''),
      sessionId: session.id,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  };
}

// ---------------------------------------------------------------- circuit breaker
const breaker = new Map(); // pluginId → {until, reason}
export function breakerOpen(pluginId, now = Date.now()) {
  const b = breaker.get(pluginId);
  return b && b.until > now ? b : null;
}
export function tripBreaker(
  pluginId,
  reason,
  ms = 60 * 60_000,
  now = Date.now(),
) {
  breaker.set(pluginId, { until: now + ms, reason });
}
export function __resetBreakers() {
  breaker.clear();
}
const QUOTA_RE = /exceeded the (monthly|daily) quota|quota|rate limit|429/i;

// ---------------------------------------------------------------- lanes
function hintUrls(hint, platform) {
  return (hint?.videoHints || [])
    .filter((h) => parseVideoUrl(h.url)?.platform === platform)
    .map((h) => ({
      url: h.url,
      title: '',
      snippet: h.note || '',
      published: null,
      from: 'incident-hint',
    }));
}

function searchPrompt(site, plan, lang) {
  const q = lang === 'ar' ? plan.queriesAr[0] : plan.queriesEn[0];
  return [
    `Use the search tool for: site:${site} ${q}`,
    `Return ONLY a JSON array [{"url":"…","title":"…","published":"YYYY-MM-DD or null","snippet":"…"}] of ${site} result URLs exactly as the search tool returned them (keep any [m:ss] transcript timestamps in snippet). No prose. If none, return [].`,
  ].join('\n');
}

async function runSearch(invoke, site, plan, lang, ctx) {
  const plugin = SCENE_VIDEO_PLUGINS.search;
  const query = searchPrompt(site, plan, lang);
  const r = await invoke(plugin.pluginId, query, { signal: ctx.signal });
  return parseSearchHits(r.answer).map((h) => ({
    ...h,
    from: 'search',
    provenance: {
      pluginId: plugin.pluginId,
      plugin: plugin.name,
      operation: 'getSearchResults',
      query: `site:${site} ${lang === 'ar' ? plan.queriesAr[0] : plan.queriesEn[0]}`,
      timestamp: r.finishedAt,
      via: 'search-plugin',
    },
  }));
}

async function verifyOembed(invoke, pluginKey, urls, ctx) {
  if (!urls.length) return new Map();
  const plugin = SCENE_VIDEO_PLUGINS[pluginKey];
  const query = [
    'Call the oEmbed operation once for EACH of these URLs:',
    ...urls.map((u) => `- ${u}`),
    'Return ONLY a JSON array with one object per URL: {"url":"<input url>","ok":true|false,"title":"…","author_name":"…","thumbnail_url":"…"}. No prose.',
  ].join('\n');
  const r = await invoke(plugin.pluginId, query, { signal: ctx.signal });
  const rows = extractJson(r.answer);
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const parsed = parseVideoUrl(row?.url);
    if (!parsed) continue;
    map.set(parsed.id, {
      ok: row.ok !== false && !row.error,
      title: row.title || '',
      author: row.author_name || '',
      thumbnail: row.thumbnail_url || '',
      provenance: {
        pluginId: plugin.pluginId,
        plugin: plugin.name,
        operation: 'oembed',
        query: String(row.url).slice(0, 300),
        timestamp: r.finishedAt,
        via: 'platform-plugin',
      },
    });
  }
  return map;
}

function relevantToPlan(hit, plan) {
  const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
  const kws = [
    ...plan.keywordsEn,
    ...plan.keywordsAr,
    ...plan.places,
    ...plan.placesAr,
  ]
    .map((k) => String(k).toLowerCase())
    .filter((k) => k.length >= 3);
  const incident =
    /(crash|accident|collision|collide|حادث|تصادم|pile|wreck|fire|حريق|explosion)/i;
  return (
    hit.from === 'incident-hint' ||
    (incident.test(text) && kws.some((k) => text.includes(k)))
  );
}

function toRaw(hit, extra = {}) {
  return {
    sourceUrl: hit.url,
    title: hit.title,
    caption: hit.snippet,
    published_at:
      hit.published && /\d{4}-\d{2}-\d{2}/.test(hit.published)
        ? hit.published
        : null,
    ...extra,
    provenance: extra.provenance || hit.provenance,
  };
}

/** YouTube lane: search (EN+AR) → relevance filter → oEmbed verify (one batch). */
export async function youtubeLane({ invoke, plan, hint, ctx }) {
  const [en, ar] = await Promise.allSettled([
    runSearch(invoke, 'youtube.com', plan, 'en', ctx),
    runSearch(invoke, 'youtube.com', plan, 'ar', ctx),
  ]);
  const hits = [
    ...hintUrls(hint, 'youtube'),
    ...(en.status === 'fulfilled' ? en.value : []),
    ...(ar.status === 'fulfilled' ? ar.value : []),
  ].filter((h) => parseVideoUrl(h.url)?.platform === 'youtube');
  const relevant = hits
    .filter((h) => relevantToPlan(h, plan))
    .slice(0, MAX_PER_LANE);
  const verified = await verifyOembed(
    invoke,
    'youtubeOembed',
    relevant.map((h) => parseVideoUrl(h.url).canonical),
    ctx,
  ).catch(() => new Map());
  const kws = [...plan.keywordsEn, ...plan.keywordsAr];
  const raws = [];
  for (const h of relevant) {
    const id = parseVideoUrl(h.url).id;
    const v = verified.get(id);
    if (v && !v.ok) continue;
    raws.push(
      toRaw(h, {
        title: v?.title || h.title,
        author: v?.author || '',
        captionStartOffset: captionOffsetFromSnippet(h.snippet, kws),
        captionOffsetSource: 'search-transcript-snippet',
        provenance: v?.provenance || h.provenance,
      }),
    );
  }
  return {
    raws,
    status: {
      searched: hits.length,
      relevant: relevant.length,
      verified: verified.size,
      errors: [en, ar]
        .filter((x) => x.status === 'rejected')
        .map((x) => String(x.reason?.message || x.reason).slice(0, 160)),
    },
  };
}

/** TikTok lane: primary scraper (breaker) → search fallback + hints → oEmbed verify. */
export async function tiktokLane({ invoke, plan, hint, ctx }) {
  const primary = SCENE_VIDEO_PLUGINS.tiktokSearch;
  const status = { primary: null, fallback: null, errors: [] };
  let hits = [];
  const open = breakerOpen(primary.pluginId);
  if (open) status.primary = `skipped (circuit open: ${open.reason})`;
  else {
    try {
      const r = await invoke(
        primary.pluginId,
        `searchTikTokFeed keywords "${plan.queriesEn[0]}" region ae count 10. Return ONLY the raw JSON tool result (including any error message).`,
        { signal: ctx.signal },
      );
      if (QUOTA_RE.test(r.answer) && !/tiktok\.com\/@/.test(r.answer)) {
        tripBreaker(
          primary.pluginId,
          'monthly quota exhausted (RapidAPI tiktok-scraper7 BASIC)',
        );
        status.primary = 'quota_exhausted';
      } else {
        const json = extractJson(r.answer);
        const videos = json?.data?.videos || json?.videos || [];
        for (const v of videos) {
          const url = v.author?.unique_id
            ? `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id || v.id}`
            : null;
          if (url)
            hits.push({
              url,
              title: v.title || '',
              snippet: v.title || '',
              published: v.create_time
                ? new Date(v.create_time * 1000).toISOString()
                : null,
              from: 'search',
              provenance: {
                pluginId: primary.pluginId,
                plugin: primary.name,
                operation: 'searchTikTokFeed',
                query: plan.queriesEn[0],
                timestamp: r.finishedAt,
                via: 'platform-plugin',
              },
            });
        }
        status.primary = `ok (${hits.length})`;
      }
    } catch (err) {
      status.primary = 'error';
      status.errors.push(String(err?.message || err).slice(0, 160));
    }
  }
  if (!hits.length) {
    const [en, ar] = await Promise.allSettled([
      runSearch(invoke, 'tiktok.com', plan, 'en', ctx),
      runSearch(invoke, 'tiktok.com', plan, 'ar', ctx),
    ]);
    hits = [
      ...(en.status === 'fulfilled' ? en.value : []),
      ...(ar.status === 'fulfilled' ? ar.value : []),
    ];
    status.fallback = `search (${hits.length})`;
  }
  hits = [...hintUrls(hint, 'tiktok'), ...hits].filter(
    (h) => parseVideoUrl(h.url)?.platform === 'tiktok',
  );
  const relevant = hits
    .filter((h) => relevantToPlan(h, plan))
    .slice(0, MAX_PER_LANE);
  const verified = await verifyOembed(
    invoke,
    'tiktokOembed',
    relevant.map((h) => parseVideoUrl(h.url).canonical),
    ctx,
  ).catch((err) => {
    status.errors.push(`oembed: ${String(err?.message || err).slice(0, 120)}`);
    return new Map();
  });
  const raws = [];
  for (const h of relevant) {
    const id = parseVideoUrl(h.url).id;
    const v = verified.get(id);
    if (v && !v.ok) continue;
    raws.push(
      toRaw(h, {
        title: v?.title || h.title || h.snippet,
        author: v?.author || '',
        provenance: v?.provenance ||
          h.provenance || {
            pluginId: SCENE_VIDEO_PLUGINS.tiktokOembed.pluginId,
            plugin: SCENE_VIDEO_PLUGINS.tiktokOembed.name,
            operation: 'oembed',
            query: h.url,
            via: 'platform-plugin',
          },
      }),
    );
  }
  status.relevant = relevant.length;
  status.verified = verified.size;
  return { raws, status };
}

/**
 * Instagram lane: incident-hint shortcodes are downloaded IMMEDIATELY (in
 * parallel with the search), search hits follow; every finished download is
 * streamed through ctx.onRaw so the first reel reaches the rail early.
 */
export async function instagramLane({
  invoke,
  plan,
  hint,
  ctx,
  resolveShortUrl,
}) {
  const status = { errors: [] };
  const plugin = SCENE_VIDEO_PLUGINS.instagramDownload;
  const seen = new Set();
  const raws = [];
  let images = 0;
  let candidates = 0;
  const download = async (code, h) => {
    const r = await invoke(
      plugin.pluginId,
      `downloadInstagramMedia for shortcode ${code}. Return ONLY JSON {"items":[{"type":"video|image","shortUrl":"…or null"}]} using the tool result (shortUrl for videos).`,
      { signal: ctx.signal },
    );
    const json = extractJson(r.answer);
    const items = Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json?.result)
        ? json.result
        : [];
    const shortUrl =
      items.find((i) => i?.type === 'video' && i.shortUrl)?.shortUrl ||
      (r.answer.match(/https:\/\/is\.gd\/[A-Za-z0-9_-]+/) || [])[0] ||
      null;
    if (!shortUrl) {
      images += 1;
      return;
    }
    const mediaUrl = resolveShortUrl
      ? await resolveShortUrl(shortUrl).catch(() => null)
      : null;
    const raw = toRaw(h, {
      title: h.title || h.snippet.slice(0, 140),
      shortUrl,
      mediaUrl,
      provenance: {
        pluginId: plugin.pluginId,
        plugin: plugin.name,
        operation: 'downloadInstagramMedia',
        query: `shortcode ${code}`,
        timestamp: r.finishedAt,
        via: 'platform-plugin',
      },
    });
    raws.push(raw);
    ctx.onRaw?.(raw);
  };
  const schedule = (hits) =>
    hits
      .map((h) => [parseVideoUrl(h.url), h])
      .filter(
        ([p, h]) => p?.platform === 'instagram' && relevantToPlan(h, plan),
      )
      .filter(([p]) => !seen.has(p.id) && seen.add(p.id))
      .slice(0, Math.max(0, MAX_PER_LANE - candidates))
      .map(([p, h]) => {
        candidates += 1;
        return download(p.id, h).catch((err) =>
          status.errors.push(String(err?.message || err).slice(0, 160)),
        );
      });
  const hintJobs = schedule(hintUrls(hint, 'instagram'));
  const searchJob = runSearch(invoke, 'instagram.com', plan, 'en', ctx)
    .then((hits) => Promise.all(schedule(hits)))
    .catch((err) =>
      status.errors.push(
        `search: ${String(err?.message || err).slice(0, 120)}`,
      ),
    );
  await Promise.all([...hintJobs, searchJob]);
  status.candidates = candidates;
  status.videos = raws.length;
  status.imagesSkipped = images;
  return { raws, status };
}

/** Follow an is.gd short link one hop (no body) to read the CDN URL + expiry. */
export function createShortUrlResolver(fetchImpl = globalThis.fetch) {
  return async function resolveShortUrl(shortUrl) {
    if (!/^https:\/\/is\.gd\/[A-Za-z0-9_-]+$/.test(shortUrl)) return null;
    const res = await fetchImpl(shortUrl, {
      method: 'HEAD',
      redirect: 'manual',
    });
    const loc = res.headers?.get?.('location');
    return loc &&
      /^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//.test(loc)
      ? loc
      : null;
  };
}

// ---------------------------------------------------------------- orchestrate
const LANES = {
  youtube: youtubeLane,
  tiktok: tiktokLane,
  instagram: instagramLane,
};

/**
 * Run the fan-out. Resolves with {plan, clips (ranked), counts, sources}.
 * @param {{prompt:string, hash?:string, anchor?:object}} input
 * @param {{invoke:Function, emit?:Function, now?:Date, signal?:AbortSignal, resolveShortUrl?:Function, hints?:object[], lanes?:string[]}} deps
 */
export async function orchestrateSceneVideos(input, deps) {
  const now = deps.now || new Date();
  const emit = deps.emit || (() => {});
  const t0 = Date.now();
  const plan = buildVideoQueryPlan(input.prompt, {
    hash: input.hash,
    anchor: input.anchor,
    now,
  });
  emit('plan', plan);
  const hint = matchIncidentHint(plan, deps.hints || loadIncidentHints());
  if (hint) {
    const ageH = (now - new Date(hint.reported_at)) / 3_600_000;
    emit('incident', {
      id: hint.id,
      title: hint.title,
      reported_at: hint.reported_at,
      place: hint.place,
      lat: hint.lat,
      lon: hint.lon,
      sources: hint.sources,
      rebuild: ageH > 24,
      provenance: hint.provenance,
    });
  }
  const anchor = hint ? { lat: hint.lat, lon: hint.lon } : plan.anchor;
  if (hint) plan.incidentTime = hint.reported_at;
  const all = [];
  const sources = {};
  const ctx = { signal: deps.signal };
  const laneNames = deps.lanes || Object.keys(LANES);
  await Promise.all(
    laneNames.map(async (name) => {
      emit('source', {
        platform: name,
        state: 'searching',
        at: new Date().toISOString(),
      });
      const fresh = [];
      const accept = (raw) => {
        const ev = normalizeEvidence(
          { ...raw, fetched_at: new Date().toISOString() },
          { now, anchor },
        );
        if (!ev || all.some((e) => e.id === ev.id)) return;
        const [ranked] = rankEvidence([ev], plan, { now });
        if (
          ranked.scoreParts.keyword < RELEVANCE_MIN_KEYWORD &&
          raw.provenance?.via === 'search-plugin'
        )
          return;
        all.push(ranked);
        fresh.push(ranked);
        emit('clip', ranked);
      };
      try {
        const { raws, status } = await LANES[name]({
          invoke: deps.invoke,
          plan,
          hint,
          ctx: { ...ctx, onRaw: accept },
          resolveShortUrl: deps.resolveShortUrl,
        });
        for (const raw of raws) accept(raw);
        sources[name] = {
          state: 'done',
          clips: fresh.length,
          ...status,
          at: new Date().toISOString(),
        };
      } catch (err) {
        sources[name] = {
          state: 'error',
          clips: 0,
          error: String(err?.message || err).slice(0, 200),
          at: new Date().toISOString(),
        };
      }
      emit('source', { platform: name, ...sources[name] });
      emit('ranked', {
        clips: rankEvidence(dedupeEvidence(all), plan, { now }).map(
          (c) => c.id,
        ),
      });
    }),
  );
  const clips = rankEvidence(dedupeEvidence(all), plan, { now });
  const counts = countByPlatform(clips);
  const result = {
    plan,
    incident: hint ? { id: hint.id, reported_at: hint.reported_at } : null,
    clips,
    counts,
    sources,
    durationMs: Date.now() - t0,
    tiers: {
      LIVE: clips.filter((c) => c.tier === 'LIVE').length,
      RECENT: clips.filter((c) => c.tier === 'RECENT').length,
      ARCHIVAL: clips.filter((c) => c.tier === 'ARCHIVAL').length,
    },
  };
  emit('done', {
    counts,
    tiers: result.tiers,
    sources,
    durationMs: result.durationMs,
    total: clips.length,
  });
  return result;
}

export { instagramCdnMeta };
