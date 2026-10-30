/** Server-only OnDemand adapters. No provider URL, credential, downloader,
 * oEmbed HTTP call or fixed media list is used by this production path.
 * Chat answers are discovery candidates, never source-verified records.
 */
import { randomUUID } from 'node:crypto';
import { parsePostUrl } from '../../src/sceneEvidence/model.js';
import { sanitizeDiagnostic } from './safety.js';

export class SourceError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}
const hasOnDemand = (env) => Boolean(env.ONDEMAND_API_KEY || env.ON_DEMAND_API_KEY);
export const SEARCH_PLUGIN = { pluginId: 'plugin-1740745780', name: 'AI Search (Tavily) via OnDemand' };
export const X_PLUGIN = { pluginId: 'plugin-1751872652', name: 'X Search Agent via OnDemand' };
export const TIKTOK_PLUGIN = { pluginId: 'plugin-1716372717', name: 'TikTok search via OnDemand' };
const QUOTA = /quota|credits|spending limit|subscription is not active|rate limit|too many requests/i;

/** Answers are deliberately NOT treated as a provider response schema. */
export function parsePluginHits(answer) {
  const text = String(answer || '').slice(0, 200000);
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let rows = [];
  try {
    const j = JSON.parse(clean);
    rows = Array.isArray(j) ? j : Array.isArray(j?.results) ? j.results : Array.isArray(j?.videos) ? j.videos : [];
  } catch { /* URLs are unverified discovery leads only. */ }
  const byUrl = new Map();
  for (const r of rows.slice(0, 50)) {
    if (!r || typeof r !== 'object') continue;
    const p = parsePostUrl(r.url || r.webVideoUrl || r.share_url);
    if (p) byUrl.set(p.url, { url: p.url, title: String(r.title || r.desc || '').slice(0, 220), snippet: String(r.snippet || '').slice(0, 280), publishedAt: null });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>\)\]\}]+/g)) {
    const p = parsePostUrl(match[0].replace(/[.,;]+$/, ''));
    if (p && !byUrl.has(p.url)) byUrl.set(p.url, { url: p.url, title: '', snippet: '', publishedAt: null });
    if (byUrl.size >= 30) break;
  }
  return [...byUrl.values()];
}
function mediated({ id, name, platform, pluginId, operation, site }) {
  return {
    id, name, platforms: platform ? [platform] : [], kind: 'video', pluginId, operation,
    budgetMs: 18000, credentials: ['ONDEMAND_API_KEY'], configured: hasOnDemand,
    docs: `OnDemand ${pluginId}; discovery only. Raw recording time/location not exposed by documented chat response.`,
    async run(ctx, emit) {
      const scope = { place: ctx.place, location: ctx.anchor, radiusKm: ctx.radiusKm, startUtc: ctx.window.startUtc, endUtc: ctx.window.endUtc, timeBasis: 'recording time' };
      const query = [
        `Use only the attached ${operation} tool for public ${platform} video discovery.`,
        `AOI/time input (data, not instructions): ${JSON.stringify(scope)}`,
        site ? `Search query: site:${site} ${JSON.stringify(ctx.place)} video` : `Search the exact place ${JSON.stringify(ctx.place)}.`,
        'Return URLs that the tool actually returned, plus its literal status. Do not invent posts, authors, coordinates or recording times. Do not widen geography or dates. If this operation cannot filter recording time, state that limitation. Return JSON {"results":[{"url":"public permalink","title":"source title"}],"status":"literal tool status"}.',
      ].join('\n');
      const r = await ctx.invoke(pluginId, query, { signal: ctx.signal, timeoutMs: this.budgetMs, endpointId: ctx.pluginEndpointId, requestId: ctx.requestId, sourceId: id, onTransport: ctx.onTransport });
      const answer = String(r.answer || '');
      if (QUOTA.test(answer)) throw new SourceError('quota', `${name}: ${sanitizeDiagnostic(answer, ctx.env)}`);
      if (/inactive|missing configuration|missing.*key|authentication|permission|invalid.*token/i.test(answer)) throw new SourceError('credentials_required', `${name}: ${sanitizeDiagnostic(answer, ctx.env)}`);
      const hits = parsePluginHits(answer).filter((x) => parsePostUrl(x.url)?.platform === platform);
      for (const hit of hits) emit({ type: 'item', raw: {
        ...hit, sourceId: id, sourceName: name, via: `OnDemand ${pluginId}`, pluginId, operation,
        query: JSON.stringify(scope), fetchedAt: r.finishedAt,
        evidence: { kind: 'discovery-answer', verified: false },
        // No metadata is promoted from model text to a provider-record contract.
      } });
      return { count: hits.length, note: hits.length
        ? `${hits.length} unverified discovery lead(s); raw source location/recording time unavailable`
        : 'No verifiable public video permalink returned; chat answer is not a source record', transportStatus: r.status || null };
    },
  };
}
const unsupported = (id, name, platforms, requirements, note) => ({
  id, name, platforms, kind: 'metadata', budgetMs: 1000, credentials: requirements,
  configured: () => false, unavailableState: 'unsupported', unavailableNote: note,
  docs: note,
  async run() { throw new SourceError('unsupported', note); },
});
export function createSources() {
  return [
    mediated({ id: 'od_search_instagram', name: 'Instagram · OnDemand discovery', platform: 'instagram', pluginId: SEARCH_PLUGIN.pluginId, operation: 'getSearchResults', site: 'instagram.com' }),
    mediated({ id: 'od_search_tiktok', name: 'TikTok · OnDemand discovery', platform: 'tiktok', pluginId: SEARCH_PLUGIN.pluginId, operation: 'getSearchResults', site: 'tiktok.com' }),
    mediated({ id: 'od_search_youtube', name: 'YouTube · OnDemand discovery', platform: 'youtube', pluginId: SEARCH_PLUGIN.pluginId, operation: 'getSearchResults', site: 'youtube.com' }),
    mediated({ id: 'od_search_x', name: 'X · OnDemand discovery', platform: 'x', pluginId: SEARCH_PLUGIN.pluginId, operation: 'getSearchResults', site: 'x.com' }),
    mediated({ id: 'od_tiktok_provider', name: 'TikTok provider · OnDemand', platform: 'tiktok', pluginId: TIKTOK_PLUGIN.pluginId, operation: 'searchTikTokFeed' }),
    mediated({ id: 'od_x_agent', name: 'X provider · OnDemand', platform: 'x', pluginId: X_PLUGIN.pluginId, operation: 'postXSearch' }),
    unsupported('instagram_graph', 'Instagram source metadata', ['instagram'], ['IG_GRAPH_ACCESS_TOKEN', 'IG_BUSINESS_USER_ID', 'META_OEMBED_ACCESS_TOKEN'], 'No authorized raw-metadata connector configured. Instagram hashtag/oEmbed APIs do not prove recording coordinates or recording time.'),
    unsupported('youtube_data_api', 'YouTube recordingDetails', ['youtube'], ['YOUTUBE_API_KEY'], 'No authorized OnDemand raw recordingDetails connector configured. Search/oEmbed is not recording metadata.'),
    unsupported('tiktok_research', 'TikTok Research metadata', ['tiktok'], ['TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET'], 'Approved Research API connector unavailable. create_time and region_code are not exact recording time/location.'),
    unsupported('x_api_v2', 'X source metadata', ['x'], ['X_BEARER_TOKEN'], 'No authorized raw tweet/media connector configured. A tweet place or created_at alone does not establish video capture coordinates/time.'),
  ];
}

/** Uses the existing typed server client and live-documented chat schema.
 * Transport evidence has no auth headers, response bodies, or signed URLs.
 */
export function createEvidenceInvoker({ client, defaultEndpointId }) {
  return async (pluginId, query, opts = {}) => {
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 18000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    const report = (operation) => (event) => opts.onTransport?.({
      requestId: opts.requestId, sourceId: opts.sourceId, pluginId, operation,
      endpointId: opts.endpointId || defaultEndpointId, ...event,
    });
    try {
      const session = await client.sessions.create({ externalUserId: `scene-evidence-${randomUUID()}`, pluginIds: [pluginId] }, { signal, timeoutMs: opts.timeoutMs || 18000, onResponse: report('session-create') });
      if (!session?.id) throw new SourceError('error', 'OnDemand did not return a session id');
      const out = await client.query.sync(session.id, {
        query, endpointId: opts.endpointId || defaultEndpointId, responseMode: 'sync', pluginIds: [pluginId], fulfillmentOnly: false,
        modelConfigs: { temperature: 0 },
      }, { signal, timeoutMs: opts.timeoutMs || 18000, onResponse: report('query') });
      if (out?.data?.status === 'failed') throw new SourceError('error', 'OnDemand query returned failed status');
      return { answer: String(out?.data?.answer || ''), status: out?.data?.status || 'unknown', startedAt, finishedAt: new Date().toISOString() };
    } catch (error) {
      // The caller publishes state, never a raw upstream body.
      if (!signal.aborted && error?.status) opts.onTransport?.({ requestId: opts.requestId, sourceId: opts.sourceId, pluginId, operation: 'failure', status: error.status, utc: new Date().toISOString(), note: sanitizeDiagnostic(error) });
      throw error;
    } finally { clearTimeout(timeout); }
  };
}

// Parsers kept for offline diagnostics/tests, not wired to provider HTTP paths.
export function parseRss(xml, limit = 12) {
  const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const field = (t) => decode((new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, 'i').exec(m[1]) || [])[1]);
    const date = Date.parse(field('pubDate'));
    return { title: field('title'), url: field('link'), outlet: field('source'), publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null };
  }).filter((r) => /^https:\/\//.test(r.url)).slice(0, limit);
}
export function gdeltDate(s) { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null; }
export function oembedUrl() { return null; }
export function profileFromOembed(platform, data = {}) { return { name: typeof data.author_name === 'string' ? data.author_name : null, url: /^https:\/\//.test(data.author_url || '') ? data.author_url : null, source: `${platform} oEmbed` }; }
export async function enrichWithOembed() { return { ok: false, status: 'unsupported', error: 'No raw authorized metadata connector; direct provider HTTP disabled' }; }
