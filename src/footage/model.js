/**
 * LIVE FOOTAGE — runtime-neutral model: URL-hash state (fv/fk/fm/fs + the
 * `ui=` f.c token), the natural-language rebuild command parser, the
 * offline place dictionary, freshness labels and the playlist reducer.
 *
 * Everything here is pure so node:test can cover it without a browser; the
 * DOM dock (ui/dock.js) and the service client (client.js) sit on top.
 */

export const FOOTAGE_PARAMS = Object.freeze({
  visible: 'fv', // 0|1
  keywords: 'fk', // free text
  mode: 'fm', // live|rebuild
  since: 'fs', // ISO-8601 or relative (24h, 7d, 2y)
});
/** Panel token appended to the existing `ui=` share param (`f.c.1` = dock collapsed). */
export const FOOTAGE_UI_TOKEN = 'f';
export const FOOTAGE_MODES = Object.freeze(['live', 'rebuild']);
export const FRESHNESS = Object.freeze({
  LIVE: { label: 'LIVE', tone: 'live', maxAgeMs: 15 * 60_000 },
  RECENT: { label: 'RECENT', tone: 'recent', maxAgeMs: 24 * 3_600_000 },
  ARCHIVE: { label: 'ARCHIVE', tone: 'archive', maxAgeMs: Infinity },
});

/** Offline place dictionary (mirrors api/footage/geo.py so the client can fly before the backend answers). */
export const PLACES = Object.freeze([
  {
    name: 'Umm Suqeim',
    lat: 25.147,
    lon: 55.199,
    aliases: [
      'umm suqeim',
      'um suqeim',
      'umm suqaim',
      'umm suqeim street',
      'أم سقيم',
    ],
    city: 'Dubai',
  },
  {
    name: 'Jumeirah',
    lat: 25.218,
    lon: 55.252,
    aliases: ['jumeirah', 'jumeira', 'jumeirah street', 'جميرا'],
    city: 'Dubai',
  },
  {
    name: 'Al Barsha',
    lat: 25.112,
    lon: 55.196,
    aliases: ['al barsha', 'barsha', 'البرشاء'],
    city: 'Dubai',
  },
  {
    name: 'Jumeirah Village Circle',
    lat: 25.058,
    lon: 55.209,
    aliases: ['jvc', 'jumeirah village circle', 'jumeirah village'],
    city: 'Dubai',
  },
  {
    name: 'Dubai Marina',
    lat: 25.08,
    lon: 55.14,
    aliases: ['dubai marina', 'marina', 'jbr', 'مرسى دبي'],
    city: 'Dubai',
  },
  {
    name: 'Al Warqa',
    lat: 25.192,
    lon: 55.41,
    aliases: ['al warqa', 'warqa', 'al warqaa', 'الورقاء'],
    city: 'Dubai',
  },
  {
    name: 'Business Bay',
    lat: 25.186,
    lon: 55.265,
    aliases: ['business bay', 'downtown dubai', 'downtown', 'الخليج التجاري'],
    city: 'Dubai',
  },
  {
    name: 'Deira',
    lat: 25.271,
    lon: 55.312,
    aliases: ['deira', 'al rigga', 'ديرة'],
    city: 'Dubai',
  },
  {
    name: 'Bur Dubai',
    lat: 25.255,
    lon: 55.297,
    aliases: ['bur dubai', 'karama', 'al karama', 'بر دبي'],
    city: 'Dubai',
  },
  {
    name: 'Al Quoz',
    lat: 25.139,
    lon: 55.232,
    aliases: ['al quoz', 'quoz'],
    city: 'Dubai',
  },
  {
    name: 'Al Qusais',
    lat: 25.275,
    lon: 55.38,
    aliases: ['al qusais', 'qusais'],
    city: 'Dubai',
  },
  {
    name: 'Mirdif',
    lat: 25.221,
    lon: 55.42,
    aliases: ['mirdif', 'mirdiff'],
    city: 'Dubai',
  },
  {
    name: 'Dubai Silicon Oasis',
    lat: 25.121,
    lon: 55.381,
    aliases: ['silicon oasis', 'dso'],
    city: 'Dubai',
  },
  {
    name: 'International City',
    lat: 25.164,
    lon: 55.408,
    aliases: ['international city'],
    city: 'Dubai',
  },
  {
    name: 'Jebel Ali',
    lat: 24.985,
    lon: 55.065,
    aliases: ['jebel ali', 'jafza'],
    city: 'Dubai',
  },
  {
    name: 'Palm Jumeirah',
    lat: 25.112,
    lon: 55.138,
    aliases: ['palm jumeirah', 'the palm'],
    city: 'Dubai',
  },
  {
    name: 'Dubai International Airport',
    lat: 25.253,
    lon: 55.365,
    aliases: ['dubai airport', 'dxb'],
    city: 'Dubai',
  },
  {
    name: 'Sheikh Zayed Road',
    lat: 25.197,
    lon: 55.272,
    aliases: ['sheikh zayed road', 'szr'],
    city: 'Dubai',
  },
  {
    name: 'Al Nahda',
    lat: 25.293,
    lon: 55.37,
    aliases: ['al nahda', 'nahda'],
    city: 'Dubai',
  },
  {
    name: 'Motor City',
    lat: 25.047,
    lon: 55.237,
    aliases: ['motor city', 'sports city'],
    city: 'Dubai',
  },
  { name: 'Hatta', lat: 24.8, lon: 56.12, aliases: ['hatta'], city: 'Dubai' },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, aliases: ['dubai', 'دبي'] },
  {
    name: 'Abu Dhabi',
    lat: 24.4539,
    lon: 54.3773,
    aliases: ['abu dhabi', 'أبوظبي'],
  },
  {
    name: 'Sharjah',
    lat: 25.3463,
    lon: 55.4209,
    aliases: ['sharjah', 'الشارقة'],
  },
  { name: 'Ajman', lat: 25.4052, lon: 55.5136, aliases: ['ajman'] },
  {
    name: 'Ras Al Khaimah',
    lat: 25.7895,
    lon: 55.9432,
    aliases: ['ras al khaimah', 'rak'],
  },
  { name: 'Fujairah', lat: 25.1288, lon: 56.3265, aliases: ['fujairah'] },
  { name: 'Al Ain', lat: 24.2075, lon: 55.7447, aliases: ['al ain'] },
  {
    name: 'Hodeidah',
    lat: 14.7978,
    lon: 42.9545,
    aliases: ['hodeidah', 'hudaydah'],
  },
  { name: 'Aden', lat: 12.7855, lon: 45.0187, aliases: ['aden'] },
  { name: 'Mukalla', lat: 14.5425, lon: 49.1242, aliases: ['mukalla'] },
  {
    name: 'Strait of Hormuz',
    lat: 26.56,
    lon: 56.25,
    aliases: ['hormuz', 'strait of hormuz'],
  },
  { name: 'Tehran', lat: 35.6892, lon: 51.389, aliases: ['tehran'] },
  { name: 'Mogadishu', lat: 2.0469, lon: 45.3182, aliases: ['mogadishu'] },
  { name: 'Berbera', lat: 10.4396, lon: 45.0143, aliases: ['berbera'] },
]);

/** Longest alias wins; returns null when no dictionary place is named. */
export function findPlace(text) {
  const q = ` ${String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')} `;
  let best = null;
  let bestLen = 0;
  for (const place of PLACES) {
    for (const alias of [place.name.toLowerCase(), ...place.aliases]) {
      if (alias.length > bestLen && q.includes(` ${alias} `)) {
        best = place;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

const VERBS =
  /^(?:please\s+)?(rebuild|replay|reconstruct|show|play|pull|find|get|fetch|watch|load)\b/i;
const PLACE_SPLIT =
  /\b(?:reported|happened|occurred|seen|filmed|spotted|that\s+happened)?\s*(?:in|at|near|around|from)\s+(.+?)\s*$/i;
const FILLER =
  /^(?:me\s+)?(?:the\s+|a\s+|an\s+|that\s+|latest\s+|recent\s+|live\s+)*/i;
const TRAIL = /\s*(?:footage|video|videos|clips?|scene)\s*$/i;

/**
 * Parse "<verb> the <incident> reported in <place>" (and loose variants) into
 * { verb, mode, incident, placeText, place } — `place` from the dictionary,
 * null when the text names no known place (caller may geocode `placeText`).
 */
export function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const verbMatch = raw.match(VERBS);
  const verb = verbMatch ? verbMatch[1].toLowerCase() : null;
  const mode =
    verb && /rebuild|replay|reconstruct/.test(verb) ? 'rebuild' : 'live';
  let body = verb ? raw.slice(verbMatch[0].length).trim() : raw;
  body = body.replace(FILLER, '').trim();
  let placeText = null;
  let incident = body;
  const m = body.match(PLACE_SPLIT);
  if (m) {
    placeText = m[1].trim();
    incident = body.slice(0, m.index).trim();
  }
  incident = incident
    .replace(FILLER, '')
    .replace(TRAIL, '')
    .replace(/\s+(?:reported|happened|occurred)$/i, '')
    .trim();
  let place = findPlace(placeText || '');
  if (!place) {
    place = findPlace(raw);
    if (place && !placeText) {
      placeText = place.name;
      // strip the place words from the incident so keywords stay clean
      const re = new RegExp(
        `\\b(?:in|at|near|around)?\\s*${place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i',
      );
      incident = incident.replace(re, '').replace(/\s+/g, ' ').trim();
    }
  }
  if (!incident && !placeText) return null;
  return {
    verb,
    mode,
    incident: incident || '',
    placeText,
    place: place ? { ...place } : null,
    raw,
  };
}

/** Freshness from an absolute published_at (ISO-8601 UTC). */
export function freshnessOf(publishedAt, nowMs = Date.now()) {
  const t = Date.parse(publishedAt || '');
  if (!Number.isFinite(t)) return 'ARCHIVE';
  const age = nowMs - t;
  if (age <= FRESHNESS.LIVE.maxAgeMs) return 'LIVE';
  if (age <= FRESHNESS.RECENT.maxAgeMs) return 'RECENT';
  return 'ARCHIVE';
}

export function formatUtc(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

export function formatDate(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** Read fv/fk/fm/fs (+ `ui=` f.c) from a hash/URLSearchParams; defaults when absent. */
export function decodeFootageParams(params) {
  const p =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(String(params || '').replace(/^#/, ''));
  const mode = FOOTAGE_MODES.includes(p.get(FOOTAGE_PARAMS.mode))
    ? p.get(FOOTAGE_PARAMS.mode)
    : null;
  const visibleRaw = p.get(FOOTAGE_PARAMS.visible);
  let collapsed = null;
  const ui = p.get('ui');
  if (ui) {
    for (const token of ui.split('_')) {
      const [key, field, value] = token.split('.');
      if (
        key === FOOTAGE_UI_TOKEN &&
        field === 'c' &&
        (value === '0' || value === '1')
      )
        collapsed = value === '1';
    }
  }
  return {
    visible: visibleRaw === null ? null : visibleRaw === '1',
    keywords: p.get(FOOTAGE_PARAMS.keywords) || '',
    mode,
    since: p.get(FOOTAGE_PARAMS.since) || null,
    collapsed,
  };
}

/** Write fv/fk/fm/fs into `params` (mutating) and merge the f.c token into `ui=` without disturbing other panels. */
export function encodeFootageParams(params, state) {
  if (!state) return params;
  if (typeof state.visible === 'boolean')
    params.set(FOOTAGE_PARAMS.visible, state.visible ? '1' : '0');
  if (state.keywords) params.set(FOOTAGE_PARAMS.keywords, state.keywords);
  else params.delete(FOOTAGE_PARAMS.keywords);
  if (state.mode && FOOTAGE_MODES.includes(state.mode))
    params.set(FOOTAGE_PARAMS.mode, state.mode);
  else params.delete(FOOTAGE_PARAMS.mode);
  if (state.since) params.set(FOOTAGE_PARAMS.since, state.since);
  else params.delete(FOOTAGE_PARAMS.since);
  if (typeof state.collapsed === 'boolean') {
    const tokens = (params.get('ui') || '')
      .split('_')
      .filter((t) => t && !t.startsWith(`${FOOTAGE_UI_TOKEN}.`));
    tokens.push(`${FOOTAGE_UI_TOKEN}.c.${state.collapsed ? '1' : '0'}`);
    params.set('ui', tokens.join('_'));
  }
  return params;
}

/** Items whose freshness is ARCHIVE dominate (>= 60%) or mode is rebuild → archive banner. */
export function archiveBannerFor(items, mode, { reportedAt = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length && mode !== 'rebuild') return null;
  const archive = list.filter(
    (i) => (i.freshness || freshnessOf(i.published_at)) === 'ARCHIVE',
  ).length;
  const dominant = list.length ? archive / list.length >= 0.6 : false;
  if (mode !== 'rebuild' && !dominant) return null;
  const dates = list
    .map((i) => Date.parse(i.published_at || ''))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const reported = Date.parse(reportedAt || '');
  // The verified first report (backend seed) wins over the earliest clip date.
  const earliest = Number.isFinite(reported)
    ? new Date(reported).toISOString().slice(0, 10)
    : dates.length
      ? new Date(dates[0]).toISOString().slice(0, 10)
      : null;
  return {
    text: earliest
      ? `REBUILT FROM ARCHIVAL FOOTAGE — originally reported ${earliest}`
      : 'REBUILT FROM ARCHIVAL FOOTAGE — original report date unknown',
    earliest,
    archiveCount: archive,
    total: list.length,
  };
}

/** Which player an item needs: 'youtube' | 'tiktok' | 'video' | 'instagram' | 'link'. */
export function playerKindFor(item) {
  if (!item) return 'link';
  const url = String(item.url || '');
  const embed = String(item.embed_url || '');
  if (/youtube\.com\/embed\//.test(embed) || /youtube\.com|youtu\.be/.test(url))
    return 'youtube';
  if (/tiktok\.com\/embed/.test(embed) || /tiktok\.com\/@/.test(url))
    return 'tiktok';
  if (item.play_url && /\.(mp4|webm|m3u8)(\?|$)/i.test(item.play_url))
    return 'video';
  if (
    item.play_url &&
    /is\.gd|cdninstagram|fbcdn|\/o1\/v\//.test(item.play_url)
  )
    return 'video';
  if (/instagram\.com/.test(url)) return 'instagram';
  return 'link';
}

export function youtubeIdOf(item) {
  const m = String(item?.embed_url || item?.url || '').match(
    /(?:embed\/|shorts\/|watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/** Playlist reducer: ordered, de-duplicated by canonical/url, playable-first. */
export function appendToPlaylist(list, item) {
  const key = item?.canonical || item?.url;
  if (!key) return list;
  if (list.some((i) => (i.canonical || i.url) === key)) return list;
  return [...list, item];
}

export function playableItems(list) {
  return (list || []).filter((i) =>
    ['youtube', 'tiktok', 'video', 'instagram'].includes(playerKindFor(i)),
  );
}

/** Debounce helper with a cancel handle (pure wiring, injectable timers). */
export function debounce(
  fn,
  ms,
  { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {},
) {
  let handle = null;
  const wrapped = (...args) => {
    if (handle) clearTimeoutImpl(handle);
    handle = setTimeoutImpl(() => {
      handle = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (handle) clearTimeoutImpl(handle);
    handle = null;
  };
  return wrapped;
}

/** Last-resort client fixtures — used ONLY when the backend reports every source failed; always labelled. */
export const UMM_SUQEIM_FIXTURES = Object.freeze([
  {
    source: 'instagram',
    title:
      'Dubai Police release footage of the Umm Suqeim Street crash (driver lost consciousness)',
    url: 'https://www.instagram.com/p/DXgVj3djDAR/',
    embed_url: 'https://www.instagram.com/p/DXgVj3djDAR/embed/',
    play_url: null,
    thumb: null,
    published_at: '2026-04-24T07:00:51Z',
    freshness: 'ARCHIVE',
    relevance: 0.8,
    author: 'gulfmoments',
    fixture: true,
  },
  {
    source: 'instagram',
    title: 'Umm Suqeim Street crash — Dubai Police warning (reel)',
    url: 'https://www.instagram.com/reel/DW8khmCg4CY/',
    embed_url: 'https://www.instagram.com/reel/DW8khmCg4CY/embed/',
    play_url: null,
    thumb: null,
    published_at: '2026-04-10T09:38:57Z',
    freshness: 'ARCHIVE',
    relevance: 0.8,
    author: 'world_arabia',
    fixture: true,
  },
  {
    source: 'instagram',
    title:
      'Gulf Today: driver faints, crashes into other cars on Umm Suqeim Street',
    url: 'https://www.instagram.com/p/DdyBfSdl-zh/',
    embed_url: 'https://www.instagram.com/p/DdyBfSdl-zh/embed/',
    play_url: null,
    thumb: null,
    published_at: '2026-09-27T07:00:10Z',
    freshness: 'ARCHIVE',
    relevance: 0.8,
    author: 'gulftoday',
    fixture: true,
  },
  {
    source: 'youtube',
    title: 'Dubai road incident coverage (YouTube Shorts)',
    url: 'https://www.youtube.com/shorts/pu6shIJmb5s',
    embed_url:
      'https://www.youtube.com/embed/pu6shIJmb5s?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0',
    play_url: null,
    thumb: 'https://i.ytimg.com/vi/pu6shIJmb5s/hqdefault.jpg',
    published_at: '2026-03-08T00:00:00Z',
    freshness: 'ARCHIVE',
    relevance: 0.5,
    author: 'CRUX',
    fixture: true,
  },
]);

export function fixturesFor(keywords, place) {
  const k = String(keywords || '').toLowerCase();
  const p = String(place?.name || place || '').toLowerCase();
  if (
    (p.includes('umm suqeim') || k.includes('umm suqeim')) &&
    /crash|accident|collision|حادث/.test(k)
  )
    return [...UMM_SUQEIM_FIXTURES];
  return [];
}
