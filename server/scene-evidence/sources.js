/**
 * Scene evidence source adapters (server-only).
 *
 * Every adapter declares the credentials it needs. When those are missing the
 * pipeline reports `credentials_required` for it and NEVER substitutes data.
 * Keys are read from process.env on the server; nothing here reaches the
 * browser except normalised public post/article metadata.
 *
 * Adapter shape:
 *   { id, name, platforms, kind: 'video'|'signal'|'enrich', budgetMs,
 *     credentials: [ENV_NAME…] (all required), docs,
 *     configured(env) → boolean, run(ctx, emit) → Promise<{count, note?}> }
 * emit({type:'item'|'signal', raw}) is called progressively.
 */
import { createPluginInvoker } from '../scene-videos/orchestrator.js';

export const UA = 'OnDemandIntelligenceWorkstation/1.0 (+scene-evidence; public data only)';

export class SourceError extends Error {
  constructor(state, message) {
    super(message);
    this.state = state; // 'error' | 'unavailable' | 'credentials_required' | 'timeout'
  }
}

/** fetch with a hard per-call timeout that also honours the source signal. */
export async function timedFetch(fetchImpl, url, { signal, timeoutMs = 8000, ...init } = {}) {
  const t = AbortSignal.timeout(timeoutMs);
  const s = signal ? AbortSignal.any([signal, t]) : t;
  return fetchImpl(url, { ...init, signal: s, headers: { 'user-agent': UA, ...(init.headers || {}) } });
}

async function json(fetchImpl, url, opts) {
  const res = await timedFetch(fetchImpl, url, opts);
  const text = await res.text();
  if (res.status === 401 || res.status === 403)
    throw new SourceError(/appname|credential|auth|token|key/i.test(text) ? 'credentials_required' : 'unavailable', `HTTP ${res.status}: ${text.slice(0, 160)}`);
  if (res.status === 429) throw new SourceError('unavailable', `HTTP 429 rate limited: ${text.slice(0, 120)}`);
  if (!res.ok) throw new SourceError('error', `HTTP ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError('error', `non-JSON response: ${text.slice(0, 120)}`);
  }
}

const has = (env, names) => names.every((n) => String(env[n] || '').trim().length > 0);
const isoAgo = (now, hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();

// ---------------------------------------------------------------- RSS helpers
function decodeXml(v) {
  return String(v || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function parseRss(xml, limit = 12) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const tag = (t) => decodeXml((new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, 'i').exec(m[1]) || [])[1]);
    const title = tag('title');
    const url = tag('link');
    if (!title || !/^https?:\/\//.test(url)) continue;
    const date = Date.parse(tag('pubDate'));
    out.push({ title, url, outlet: tag('source'), publishedAt: Number.isNaN(date) ? null : new Date(date).toISOString() });
    if (out.length >= limit) break;
  }
  return out;
}
/** GDELT seendate "20261023T113000Z" → ISO. */
export function gdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

// ---------------------------------------------------------------- plugin search parsing
export function parsePluginHits(answer) {
  const s = String(answer || '');
  for (const [o, c] of [['[', ']'], ['{', '}']]) {
    const a = s.indexOf(o);
    const b = s.lastIndexOf(c);
    if (a !== -1 && b > a) {
      try {
        const j = JSON.parse(s.slice(a, b + 1));
        const rows = Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : [];
        return rows
          .filter((r) => r && typeof r === 'object' && typeof r.url === 'string' && r.url)
          .map((r) => ({ url: r.url, title: String(r.title || ''), snippet: String(r.snippet || r.content || ''), publishedAt: r.published || r.published_date || null }));
      } catch {
        /* try next */
      }
    }
  }
  return [...new Set(s.match(/https?:\/\/[^\s"'<>)\]]+/g) || [])].map((url) => ({ url: url.replace(/[.,;]+$/, ''), title: '', snippet: '', publishedAt: null }));
}
const QUOTA_RE = /quota|credits|spending limit|subscription is not active|rate limit|429|not active/i;

// ---------------------------------------------------------------- adapters
export const SEARCH_PLUGIN = { pluginId: 'plugin-1740745780', name: 'AI Search (Tavily) via OnDemand' };
export const X_PLUGIN = { pluginId: 'plugin-1751872652', name: 'X Search Agent via OnDemand' };

function pluginSiteSearch({ id, name, site, platform }) {
  return {
    id,
    name,
    platforms: [platform],
    kind: 'video',
    budgetMs: 25_000,
    credentials: ['ONDEMAND_API_KEY'],
    docs: 'OnDemand chat session bound to plugin-1740745780 (Tavily getSearchResults), site-restricted query',
    configured: (env) => has(env, ['ONDEMAND_API_KEY']),
    async run(ctx, emit) {
      const days = Math.max(1, Math.ceil(ctx.windowHours / 24));
      const q = `site:${site} ${ctx.query}`;
      const prompt = [
        `Use the search tool for: ${q}`,
        `Prefer the most recent results (last ${days} day(s)) if the tool supports a time filter.`,
        'Return ONLY a JSON array [{"url":"…","title":"…","published":"YYYY-MM-DD or null","snippet":"…"}] of result URLs exactly as the search tool returned them. No prose. If none, return [].',
      ].join('\n');
      const r = await ctx.invoke(SEARCH_PLUGIN.pluginId, prompt, { signal: ctx.signal, timeoutMs: this.budgetMs, endpointId: ctx.pluginEndpointId });
      if (QUOTA_RE.test(r.answer) && !/https?:\/\//.test(r.answer)) throw new SourceError('unavailable', r.answer.slice(0, 200));
      const hits = parsePluginHits(r.answer);
      let n = 0;
      for (const h of hits) {
        emit({ type: 'item', raw: { ...h, dateSource: h.publishedAt ? 'search-reported' : null, sourceId: id, sourceName: name, via: `OnDemand ${SEARCH_PLUGIN.pluginId} (endpoint ${ctx.pluginEndpointId})`, query: q, fetchedAt: r.finishedAt } });
        n += 1;
      }
      return { count: n, note: `${hits.length} search hit(s)` };
    },
  };
}

export function createSources() {
  return [
    // ---- OnDemand-mediated (working with the server ONDEMAND_API_KEY)
    pluginSiteSearch({ id: 'od_search_youtube', name: 'YouTube · OnDemand search', site: 'youtube.com', platform: 'youtube' }),
    pluginSiteSearch({ id: 'od_search_tiktok', name: 'TikTok · OnDemand search', site: 'tiktok.com', platform: 'tiktok' }),
    pluginSiteSearch({ id: 'od_search_instagram', name: 'Instagram · OnDemand search', site: 'instagram.com', platform: 'instagram' }),
    pluginSiteSearch({ id: 'od_search_x', name: 'X · OnDemand search', site: 'x.com', platform: 'x' }),
    {
      id: 'od_x_agent',
      name: 'X Search Agent · OnDemand',
      platforms: ['x'],
      kind: 'video',
      budgetMs: 25_000,
      credentials: ['ONDEMAND_API_KEY'],
      docs: 'OnDemand plugin-1751872652 (X API under the plugin owner credits)',
      configured: (env) => has(env, ['ONDEMAND_API_KEY']),
      async run(ctx, emit) {
        const r = await ctx.invoke(X_PLUGIN.pluginId, `Search X for the most recent posts about "${ctx.place}" from the last ${Math.ceil(ctx.windowHours / 24)} day(s). Return ONLY JSON [{"url":"https://x.com/<user>/status/<id>","title":"<post text>","published":"ISO time"}] or the raw error text.`, { signal: ctx.signal, timeoutMs: this.budgetMs, endpointId: ctx.pluginEndpointId });
        if (QUOTA_RE.test(r.answer) && !/status\/\d/.test(r.answer)) throw new SourceError('unavailable', `plugin reported: ${r.answer.replace(/\s+/g, ' ').slice(0, 200)}`);
        let n = 0;
        for (const h of parsePluginHits(r.answer)) {
          emit({ type: 'item', raw: { ...h, dateSource: h.publishedAt ? 'api' : null, sourceId: this.id, sourceName: this.name, via: `OnDemand ${X_PLUGIN.pluginId}`, query: ctx.place, fetchedAt: r.finishedAt } });
          n += 1;
        }
        return { count: n };
      },
    },
    // ---- Official platform APIs (credentials required)
    {
      id: 'youtube_data_api',
      name: 'YouTube Data API v3 (geo search)',
      platforms: ['youtube'],
      kind: 'video',
      budgetMs: 8000,
      credentials: ['YOUTUBE_API_KEY'],
      docs: 'search.list type=video location+locationRadius+publishedAfter, then videos.list recordingDetails + channels.list',
      configured: (env) => has(env, ['YOUTUBE_API_KEY']),
      async run(ctx, emit) {
        const key = ctx.env.YOUTUBE_API_KEY;
        const p = new URLSearchParams({ part: 'snippet', type: 'video', q: ctx.place, maxResults: '15', order: 'date', publishedAfter: isoAgo(ctx.now, ctx.windowHours), key });
        if (Number.isFinite(ctx.anchor?.lat)) {
          p.set('location', `${ctx.anchor.lat},${ctx.anchor.lon}`);
          p.set('locationRadius', `${Math.min(1000, Math.max(1, ctx.radiusKm))}km`);
        }
        const s = await json(ctx.fetch, `https://www.googleapis.com/youtube/v3/search?${p}`, { signal: ctx.signal, timeoutMs: 6000 });
        const ids = (s.items || []).map((i) => i.id?.videoId).filter(Boolean);
        if (!ids.length) return { count: 0 };
        const v = await json(ctx.fetch, `https://www.googleapis.com/youtube/v3/videos?part=snippet,recordingDetails&id=${ids.join(',')}&key=${encodeURIComponent(key)}`, { signal: ctx.signal, timeoutMs: 5000 }).catch(() => ({ items: [] }));
        const chIds = [...new Set((v.items || []).map((i) => i.snippet?.channelId).filter(Boolean))];
        const ch = chIds.length ? await json(ctx.fetch, `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${chIds.join(',')}&key=${encodeURIComponent(key)}`, { signal: ctx.signal, timeoutMs: 5000 }).catch(() => ({ items: [] })) : { items: [] };
        const chMap = new Map((ch.items || []).map((c) => [c.id, c]));
        for (const it of v.items || []) {
          const loc = it.recordingDetails?.location;
          const c = chMap.get(it.snippet?.channelId);
          emit({ type: 'item', raw: {
            url: `https://www.youtube.com/watch?v=${it.id}`,
            title: it.snippet?.title, snippet: it.snippet?.description?.slice(0, 280),
            publishedAt: it.snippet?.publishedAt, dateSource: 'api',
            coords: Number.isFinite(loc?.latitude) ? { lat: loc.latitude, lon: loc.longitude } : null,
            placeTag: !Number.isFinite(loc?.latitude) && it.recordingDetails?.locationDescription ? { name: it.recordingDetails.locationDescription } : null,
            author: { name: it.snippet?.channelTitle, url: `https://www.youtube.com/channel/${it.snippet?.channelId}`, avatar: c?.snippet?.thumbnails?.default?.url, bio: c?.snippet?.description, followers: c?.statistics?.hiddenSubscriberCount ? null : c?.statistics?.subscriberCount, source: 'YouTube Data API channels.list' },
            sourceId: this.id, sourceName: this.name, via: 'YouTube Data API v3', query: `${ctx.place} @${ctx.anchor?.lat},${ctx.anchor?.lon} r${ctx.radiusKm}km`, fetchedAt: new Date().toISOString(),
          } });
        }
        return { count: (v.items || []).length };
      },
    },
    {
      id: 'x_api_v2',
      name: 'X API v2 recent search (point_radius)',
      platforms: ['x'],
      kind: 'video',
      budgetMs: 8000,
      credentials: ['X_BEARER_TOKEN'],
      docs: 'GET /2/tweets/search/recent with point_radius + has:media, expansions geo.place_id,author_id',
      configured: (env) => has(env, ['X_BEARER_TOKEN']),
      async run(ctx, emit) {
        const geo = Number.isFinite(ctx.anchor?.lat) ? ` OR point_radius:[${ctx.anchor.lon.toFixed(5)} ${ctx.anchor.lat.toFixed(5)} ${Math.min(40, ctx.radiusKm)}km]` : '';
        const q = `("${ctx.place.replace(/"/g, '')}"${geo}) has:media -is:retweet`;
        const p = new URLSearchParams({ query: q.slice(0, 512), max_results: '25', start_time: isoAgo(ctx.now, Math.min(ctx.windowHours, 167)), 'tweet.fields': 'created_at,geo,attachments', expansions: 'geo.place_id,author_id', 'place.fields': 'full_name,geo', 'user.fields': 'name,username,profile_image_url,description,public_metrics,verified' });
        const r = await json(ctx.fetch, `https://api.x.com/2/tweets/search/recent?${p}`, { signal: ctx.signal, timeoutMs: 7000, headers: { authorization: `Bearer ${ctx.env.X_BEARER_TOKEN}` } });
        const users = new Map((r.includes?.users || []).map((u) => [u.id, u]));
        const places = new Map((r.includes?.places || []).map((pl) => [pl.id, pl]));
        for (const t of r.data || []) {
          const u = users.get(t.author_id) || {};
          const pl = places.get(t.geo?.place_id);
          const c = t.geo?.coordinates?.coordinates;
          emit({ type: 'item', raw: {
            url: `https://x.com/${u.username || 'i'}/status/${t.id}`, title: t.text, publishedAt: t.created_at, dateSource: 'api',
            coords: Array.isArray(c) ? { lat: c[1], lon: c[0] } : null,
            placeTag: !c && pl ? { name: pl.full_name } : null,
            author: { name: u.name, handle: u.username, url: u.username ? `https://x.com/${u.username}` : null, avatar: u.profile_image_url, bio: u.description, followers: u.public_metrics?.followers_count, verified: u.verified, source: 'X API v2 users expansion' },
            sourceId: this.id, sourceName: this.name, via: 'X API v2', query: q, fetchedAt: new Date().toISOString(),
          } });
        }
        return { count: (r.data || []).length };
      },
    },
    {
      id: 'instagram_graph',
      name: 'Instagram Graph API (hashtag recent media)',
      platforms: ['instagram'],
      kind: 'video',
      budgetMs: 8000,
      credentials: ['IG_GRAPH_ACCESS_TOKEN', 'IG_BUSINESS_USER_ID'],
      docs: 'ig_hashtag_search → /{hashtag}/recent_media (last 24 h, 30 hashtags / 7 days). No location search exists.',
      configured: (env) => has(env, ['IG_GRAPH_ACCESS_TOKEN', 'IG_BUSINESS_USER_ID']),
      async run(ctx, emit) {
        const tok = encodeURIComponent(ctx.env.IG_GRAPH_ACCESS_TOKEN);
        const uid = encodeURIComponent(ctx.env.IG_BUSINESS_USER_ID);
        const tag = ctx.place.toLowerCase().replace(/[^a-z0-9]/g, '');
        const h = await json(ctx.fetch, `https://graph.facebook.com/v21.0/ig_hashtag_search?user_id=${uid}&q=${encodeURIComponent(tag)}&access_token=${tok}`, { signal: ctx.signal, timeoutMs: 4000 });
        const hid = h.data?.[0]?.id;
        if (!hid) return { count: 0 };
        const m = await json(ctx.fetch, `https://graph.facebook.com/v21.0/${hid}/recent_media?user_id=${uid}&fields=id,media_type,permalink,timestamp,caption&limit=25&access_token=${tok}`, { signal: ctx.signal, timeoutMs: 4000 });
        let n = 0;
        for (const it of m.data || []) {
          if (it.media_type !== 'VIDEO' && it.media_type !== 'CAROUSEL_ALBUM') continue;
          emit({ type: 'item', raw: { url: it.permalink, title: `#${tag}`, snippet: '', publishedAt: it.timestamp, dateSource: 'api', sourceId: this.id, sourceName: this.name, via: 'Instagram Graph API', query: `#${tag}`, fetchedAt: new Date().toISOString(), hashtagMatch: true } });
          n += 1;
        }
        return { count: n };
      },
    },
    {
      id: 'tiktok_research',
      name: 'TikTok Research API (video query)',
      platforms: ['tiktok'],
      kind: 'video',
      budgetMs: 9000,
      credentials: ['TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET'],
      docs: 'client_credentials token → POST /v2/research/video/query (region_code AE + keyword). Approved researchers only.',
      configured: (env) => has(env, ['TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET']),
      async run(ctx, emit) {
        const tokRes = await timedFetch(ctx.fetch, 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', signal: ctx.signal, timeoutMs: 3000, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: ctx.env.TIKTOK_RESEARCH_CLIENT_KEY, client_secret: ctx.env.TIKTOK_RESEARCH_CLIENT_SECRET, grant_type: 'client_credentials' }) });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) throw new SourceError('credentials_required', 'token exchange refused');
        const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
        const body = { query: { and: [{ operation: 'IN', field_name: 'region_code', field_values: ['AE'] }, { operation: 'IN', field_name: 'keyword', field_values: [ctx.place] }] }, start_date: ymd(new Date(ctx.now.getTime() - Math.max(24, ctx.windowHours) * 3_600_000)), end_date: ymd(ctx.now), max_count: 20 };
        const r = await json(ctx.fetch, 'https://open.tiktokapis.com/v2/research/video/query/?fields=id,create_time,username,region_code,video_description', { method: 'POST', signal: ctx.signal, timeoutMs: 6000, headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        let n = 0;
        for (const v of r.data?.videos || []) {
          emit({ type: 'item', raw: { url: `https://www.tiktok.com/@${v.username}/video/${v.id}`, title: v.video_description, publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null, dateSource: 'api', sourceId: this.id, sourceName: this.name, via: 'TikTok Research API', query: `${ctx.place} region AE`, fetchedAt: new Date().toISOString() } });
          n += 1;
        }
        return { count: n };
      },
    },
    // ---- Public incident / context signals
    {
      id: 'google_news_rss',
      name: 'Google News RSS (place, last window)',
      platforms: [],
      kind: 'signal',
      budgetMs: 6000,
      credentials: [],
      docs: 'https://news.google.com/rss/search?q="<place>" when:<n>d (public RSS)',
      configured: () => true,
      async run(ctx, emit) {
        const d = Math.max(1, Math.ceil(ctx.windowHours / 24));
        const q = `"${ctx.place.replace(/"/g, '')}" when:${d}d`;
        const res = await timedFetch(ctx.fetch, `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: 'en-AE', gl: 'AE', ceid: 'AE:en' })}`, { signal: ctx.signal, timeoutMs: 5000 });
        if (!res.ok) throw new SourceError('error', `HTTP ${res.status}`);
        const rows = parseRss(await res.text(), 12);
        for (const r of rows) emit({ type: 'signal', raw: { ...r, kind: 'news', sourceId: this.id, sourceName: 'Google News RSS' } });
        return { count: rows.length };
      },
    },
    {
      id: 'official_channels',
      name: 'Official channels (Dubai Police / RTA / WAM / Dubai Media Office via news index)',
      platforms: [],
      kind: 'signal',
      budgetMs: 6000,
      credentials: [],
      docs: 'Google News RSS restricted to official outlets; the official X/YouTube channels themselves need X API / YouTube API keys',
      configured: () => true,
      async run(ctx, emit) {
        const d = Math.max(1, Math.ceil(ctx.windowHours / 24));
        const q = `("Dubai Police" OR RTA OR "Dubai Media Office" OR WAM OR "Abu Dhabi Police") "${ctx.place.replace(/"/g, '')}" when:${Math.max(d, 7)}d`;
        const res = await timedFetch(ctx.fetch, `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: 'en-AE', gl: 'AE', ceid: 'AE:en' })}`, { signal: ctx.signal, timeoutMs: 5000 });
        if (!res.ok) throw new SourceError('error', `HTTP ${res.status}`);
        const rows = parseRss(await res.text(), 8);
        for (const r of rows) emit({ type: 'signal', raw: { ...r, kind: 'official', sourceId: this.id, sourceName: 'Official channels (news index)' } });
        return { count: rows.length };
      },
    },
    {
      id: 'gdelt_doc',
      name: 'GDELT DOC 2.0 (article list)',
      platforms: [],
      kind: 'signal',
      budgetMs: 10_000,
      credentials: [],
      docs: 'https://api.gdeltproject.org/api/v2/doc/doc mode=artlist sort=datedesc (1 request / 5 s)',
      configured: () => true,
      async run(ctx, emit) {
        const ts = `${Math.max(1, Math.min(ctx.windowHours, 24 * 7))}h`;
        const p = new URLSearchParams({ query: `"${ctx.place.replace(/"/g, '')}"`, mode: 'artlist', format: 'json', maxrecords: '10', sort: 'datedesc', timespan: ts });
        const res = await timedFetch(ctx.fetch, `https://api.gdeltproject.org/api/v2/doc/doc?${p}`, { signal: ctx.signal, timeoutMs: 9500 });
        const text = await res.text();
        if (res.status === 429 || /limit requests/i.test(text)) throw new SourceError('unavailable', 'GDELT rate limit (1 request / 5 s)');
        if (!res.ok) throw new SourceError('error', `HTTP ${res.status}`);
        let j = {};
        try { j = JSON.parse(text); } catch { j = {}; }
        const rows = j.articles || [];
        for (const a of rows) emit({ type: 'signal', raw: { title: a.title, url: a.url, outlet: a.domain, publishedAt: gdeltDate(a.seendate), kind: 'news', sourceId: this.id, sourceName: 'GDELT DOC 2.0' } });
        return { count: rows.length };
      },
    },
    {
      id: 'reliefweb',
      name: 'ReliefWeb API v2 (reports)',
      platforms: [],
      kind: 'signal',
      budgetMs: 6000,
      credentials: ['RELIEFWEB_APPNAME'],
      docs: 'Requires an approved appname since 2025 (403 "not using an approved appname" otherwise)',
      configured: (env) => has(env, ['RELIEFWEB_APPNAME']),
      async run(ctx, emit) {
        const p = new URLSearchParams({ appname: ctx.env.RELIEFWEB_APPNAME, 'query[value]': `${ctx.place} United Arab Emirates`, 'sort[]': 'date.created:desc', limit: '8', 'fields[include][]': 'title' });
        p.append('fields[include][]', 'url_alias');
        p.append('fields[include][]', 'date.created');
        p.append('fields[include][]', 'source.shortname');
        const j = await json(ctx.fetch, `https://api.reliefweb.int/v2/reports?${p}`, { signal: ctx.signal, timeoutMs: 5000 });
        for (const r of j.data || []) emit({ type: 'signal', raw: { title: r.fields?.title, url: r.fields?.url_alias || `https://reliefweb.int/node/${r.id}`, outlet: r.fields?.source?.[0]?.shortname, publishedAt: r.fields?.date?.created, kind: 'incident', sourceId: this.id, sourceName: 'ReliefWeb' } });
        return { count: (j.data || []).length };
      },
    },
  ];
}

// ---------------------------------------------------------------- oEmbed enrichment (public profile fields)
/** Official oEmbed endpoint per platform (public, documented). */
export function oembedUrl(platform, url, env = {}) {
  const u = encodeURIComponent(url);
  if (platform === 'youtube') return `https://www.youtube.com/oembed?format=json&url=${u}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/oembed?url=${u}`;
  if (platform === 'x') return `https://publish.x.com/oembed?omit_script=1&dnt=true&url=${u}`;
  if (platform === 'instagram') {
    const tok = String(env.META_OEMBED_ACCESS_TOKEN || '').trim();
    return `https://graph.facebook.com/v21.0/instagram_oembed?omitscript=true&url=${u}${tok ? `&access_token=${encodeURIComponent(tok)}` : ''}`;
  }
  return null;
}

/** Map an oEmbed response to the public fields we are allowed to show. */
export function profileFromOembed(platform, j = {}) {
  const name = j.author_name || null;
  const url = j.author_url || null;
  const handle = url ? (String(url).match(/(?:@|\.com\/)([A-Za-z0-9_.-]+)\/?$/) || [])[1] || null : null;
  return { name, url, handle: platform === 'youtube' ? (handle?.startsWith('channel') ? null : handle) : handle, source: `${platform} oEmbed` };
}

export async function enrichWithOembed(item, { fetch: fetchImpl, env, signal, timeoutMs = 4000 }) {
  const url = oembedUrl(item.platform, item.url, env);
  if (!url) return null;
  try {
    const res = await timedFetch(fetchImpl, url, { signal, timeoutMs });
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json();
    return {
      ok: true,
      title: typeof j.title === 'string' && j.title ? j.title : null,
      text: item.platform === 'x' && typeof j.html === 'string' ? j.html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 280) : null,
      thumbnail: typeof j.thumbnail_url === 'string' ? j.thumbnail_url : null,
      author: profileFromOembed(item.platform, j),
    };
  } catch (err) {
    return { ok: false, error: String(err?.name || err) };
  }
}

/** Invoker with a per-call endpoint override (fast endpoint for plugin answers). */
export function createEvidenceInvoker({ client, defaultEndpointId }) {
  const cache = new Map();
  return (pluginId, query, opts = {}) => {
    const ep = opts.endpointId || defaultEndpointId;
    if (!cache.has(ep)) cache.set(ep, createPluginInvoker({ client, endpointId: ep, externalUserId: 'scene-evidence' }));
    return cache.get(ep)(pluginId, query, opts);
  };
}
