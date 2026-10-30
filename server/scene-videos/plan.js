/**
 * Scene video query planner — pure. Turns the build prompt + the scene state
 * (URL hash camera / incident anchor) into the fan-out plan every platform
 * plugin receives: EN + AR keywords, place names, geo bbox, time window.
 *
 * The gazetteer below is deliberately small and local (UAE road network
 * places the incident composer is most often asked about); unknown places
 * fall back to the scene-state camera position. No provider calls here.
 */

/** Local place gazetteer: name → {lat, lon, bbox:[w,s,e,n], ar, region}. */
export const PLACES = Object.freeze([
  {
    name: 'Umm Suqeim',
    aliases: ['umm suqeim', 'umm suqeim street', 'um suqeim', 'umm sequim'],
    ar: 'أم سقيم',
    lat: 25.1425,
    lon: 55.2055,
    bbox: [55.17, 25.12, 55.24, 25.17],
    region: 'Dubai',
    related: [
      'Umm Suqeim Street',
      'Jumeirah Street',
      'Al Sufouh',
      'Al Barsha South',
    ],
    relatedAr: ['شارع أم سقيم', 'شارع جميرا'],
  },
  {
    name: 'Jumeirah',
    aliases: ['jumeirah', 'jumeirah street', 'jumeirah beach road', 'jumeira'],
    ar: 'جميرا',
    lat: 25.2048,
    lon: 55.2416,
    bbox: [55.18, 25.15, 55.28, 25.24],
    region: 'Dubai',
    related: ['Jumeirah Street', 'Jumeirah Beach Road'],
    relatedAr: ['شارع جميرا'],
  },
  {
    name: 'Al Sufouh',
    aliases: ['al sufouh', 'sufouh'],
    ar: 'الصفوح',
    lat: 25.1036,
    lon: 55.1573,
    bbox: [55.13, 25.08, 55.19, 25.13],
    region: 'Dubai',
    related: ['Al Sufouh Road'],
    relatedAr: ['شارع الصفوح'],
  },
  {
    name: 'Al Barsha',
    aliases: ['al barsha', 'al barsha south', 'barsha'],
    ar: 'البرشاء',
    lat: 25.0946,
    lon: 55.2014,
    bbox: [55.17, 25.06, 55.24, 25.12],
    region: 'Dubai',
    related: ['Al Barsha South'],
    relatedAr: ['البرشاء جنوب'],
  },
  {
    name: 'Sheikh Zayed Road',
    aliases: ['sheikh zayed road', 'szr', 'sheikh zayed rd'],
    ar: 'شارع الشيخ زايد',
    lat: 25.1564,
    lon: 55.2271,
    bbox: [55.12, 25.05, 55.3, 25.24],
    region: 'Dubai',
    related: [],
    relatedAr: [],
  },
  {
    name: 'Al Wasl',
    aliases: ['al wasl', 'al wasl road'],
    ar: 'الوصل',
    lat: 25.1854,
    lon: 55.2433,
    bbox: [55.21, 25.15, 55.28, 25.22],
    region: 'Dubai',
    related: ['Al Wasl Road'],
    relatedAr: ['شارع الوصل'],
  },
  {
    name: 'Dubai Marina',
    aliases: ['dubai marina', 'marina'],
    ar: 'دبي مارينا',
    lat: 25.0805,
    lon: 55.1403,
    bbox: [55.12, 25.06, 55.16, 25.1],
    region: 'Dubai',
    related: [],
    relatedAr: [],
  },
  {
    name: 'Dubai',
    aliases: ['dubai'],
    ar: 'دبي',
    lat: 25.2048,
    lon: 55.2708,
    bbox: [54.9, 24.8, 55.65, 25.35],
    region: 'Dubai',
    related: [],
    relatedAr: [],
  },
  {
    name: 'Abu Dhabi',
    aliases: ['abu dhabi'],
    ar: 'أبوظبي',
    lat: 24.4539,
    lon: 54.3773,
    bbox: [54.2, 24.3, 54.7, 24.6],
    region: 'Abu Dhabi',
    related: [],
    relatedAr: [],
  },
  {
    name: 'Sharjah',
    aliases: ['sharjah'],
    ar: 'الشارقة',
    lat: 25.3463,
    lon: 55.4209,
    bbox: [55.35, 25.25, 55.6, 25.42],
    region: 'Sharjah',
    related: [],
    relatedAr: [],
  },
]);

/** Incident vocabulary EN → AR (what Dubai Police / Gulf press actually use). */
export const INCIDENT_TERMS = Object.freeze([
  {
    re: /\b(car\s+)?(crash|collision|collided|accident|pile-?up|wreck)\b/i,
    en: ['crash', 'accident', 'collision'],
    ar: ['حادث', 'حادث مروري', 'تصادم'],
  },
  {
    re: /\bfaint|unconscious|lost consciousness|fatigue|tired driver\b/i,
    en: ['driver fainted', 'lost consciousness'],
    ar: ['فقدان وعي'],
  },
  { re: /\bfire|blaze|burn/i, en: ['fire'], ar: ['حريق'] },
  { re: /\bflood|rain|storm/i, en: ['flood', 'rain'], ar: ['أمطار', 'سيول'] },
  { re: /\bexplosion|blast/i, en: ['explosion'], ar: ['انفجار'] },
  {
    re: /\bdrone|missile|intercept/i,
    en: ['drone', 'interception'],
    ar: ['مسيرة', 'اعتراض'],
  },
  { re: /\bmotorcycl|biker|rider/i, en: ['motorcyclist'], ar: ['دراجة نارية'] },
]);

const AUTHORITIES = {
  Dubai: { en: 'Dubai Police', ar: 'شرطة دبي' },
  'Abu Dhabi': { en: 'Abu Dhabi Police', ar: 'شرطة أبوظبي' },
  Sharjah: { en: 'Sharjah Police', ar: 'شرطة الشارقة' },
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse the subset of the URL-hash scene state we need (lat/lon/alt). */
export function parseSceneHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const p = new URLSearchParams(s);
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  const alt = Number(p.get('alt'));
  return {
    lat: Number.isFinite(lat) && p.has('lat') ? lat : null,
    lon: Number.isFinite(lon) && p.has('lon') ? lon : null,
    alt: Number.isFinite(alt) && p.has('alt') ? alt : null,
  };
}

/** Find places named in the prompt (longest alias first, most specific wins). */
export function findPlaces(text) {
  const q = String(text || '').toLowerCase();
  const hits = [];
  for (const place of PLACES) {
    const aliases = [...place.aliases].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if (
        new RegExp(`(^|[^a-z])${escapeRe(alias)}([^a-z]|$)`).test(q) ||
        (place.ar && String(text).includes(place.ar))
      ) {
        hits.push(place);
        break;
      }
    }
  }
  // most specific first: smaller bbox area first
  const area = (p) => (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]);
  return hits.sort((a, b) => area(a) - area(b));
}

/**
 * Build the fan-out plan.
 * @param {string} prompt
 * @param {{hash?:string, anchor?:{lat:number,lon:number}, timeWindowDays?:number, now?:Date}} [scene]
 */
export function buildVideoQueryPlan(prompt, scene = {}) {
  const now = scene.now ? new Date(scene.now) : new Date();
  const text = String(prompt || '').slice(0, 500);
  const places = findPlaces(text);
  const primary = places[0] || null;
  const hashState = parseSceneHash(scene.hash);
  const anchor = primary
    ? { lat: primary.lat, lon: primary.lon, source: 'gazetteer' }
    : scene.anchor && Number.isFinite(scene.anchor.lat)
      ? { lat: scene.anchor.lat, lon: scene.anchor.lon, source: 'scene-anchor' }
      : hashState.lat !== null
        ? { lat: hashState.lat, lon: hashState.lon, source: 'url-hash' }
        : null;
  const bbox = primary
    ? primary.bbox
    : anchor
      ? [
          anchor.lon - 0.05,
          anchor.lat - 0.05,
          anchor.lon + 0.05,
          anchor.lat + 0.05,
        ]
      : null;
  const terms = INCIDENT_TERMS.filter((t) => t.re.test(text));
  const incidentEn = [...new Set(terms.flatMap((t) => t.en))];
  const incidentAr = [...new Set(terms.flatMap((t) => t.ar))];
  if (!incidentEn.length) incidentEn.push('incident');
  if (!incidentAr.length) incidentAr.push('حادث');
  const region = primary?.region || null;
  const authority = region ? AUTHORITIES[region] : null;
  const placeNames = [
    ...new Set(places.flatMap((p) => [p.name, ...(p.related || [])])),
  ];
  const placeNamesAr = [
    ...new Set(
      places.flatMap((p) => [p.ar, ...(p.relatedAr || [])]).filter(Boolean),
    ),
  ];
  const keywordsEn = [
    ...new Set([
      ...placeNames.slice(0, 4),
      ...incidentEn,
      ...(authority ? [authority.en] : []),
      ...(region && !placeNames.includes(region) ? [region] : []),
    ]),
  ];
  const keywordsAr = [
    ...new Set([
      ...incidentAr,
      ...placeNamesAr.slice(0, 3),
      ...(authority ? [authority.ar] : []),
    ]),
  ];
  const lead = placeNames[0] || region || '';
  const queriesEn = [
    `${lead} ${incidentEn[0]}`.trim(),
    `${lead} ${incidentEn[0]} ${region || ''} video`
      .replace(/\s+/g, ' ')
      .trim(),
    authority ? `${authority.en} ${incidentEn[0]} ${lead}`.trim() : null,
  ].filter(Boolean);
  const queriesAr = [
    `${incidentAr[0]} ${placeNamesAr[0] || ''}`.trim(),
    authority
      ? `${authority.ar} ${incidentAr[0]} ${placeNamesAr[0] || ''}`.trim()
      : null,
  ].filter(Boolean);
  const days = Number.isFinite(scene.timeWindowDays)
    ? scene.timeWindowDays
    : 60;
  return {
    prompt: text,
    places: placeNames,
    placesAr: placeNamesAr,
    regions: region ? [region, ...(authority ? [authority.en] : [])] : [],
    anchor,
    bbox,
    keywordsEn,
    keywordsAr,
    queriesEn: [...new Set(queriesEn)],
    queriesAr: [...new Set(queriesAr)],
    timeWindow: {
      start: new Date(now.getTime() - days * 86_400_000).toISOString(),
      end: now.toISOString(),
      days,
    },
    sceneHash: hashState,
  };
}
