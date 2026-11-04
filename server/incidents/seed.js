/**
 * Seed incidents for the UAE-AOI incident store (2026-10-22).
 *
 * (A) VIIRS NOAA-21 NRT thermal hotspots acquired 2026-10-21 (NASA FIRMS,
 *     retrieved through the OnDemand `getFiresByArea` plugin). Every point is
 *     run through the AOI filter at seed time; out-of-AOI points (Ethiopia /
 *     Djibouti border cluster near 11.26N 41.52E) are kept with their reason
 *     and never rendered as scenes.
 * (B) Web incidents retrieved live via OnDemand research plugins (Perplexity /
 *     internet search) — confidence 'confirmed' only where officially reported.
 * (C) UAE presence nodes as `protected_asset_presence_node` incidents so the
 *     presence layer renders at first load.
 *
 * Nothing here is a secret; no credentials, no personal data.
 */

const VIIRS_PROVENANCE =
  'NASA FIRMS VIIRS N21 NRT (via OnDemand getFiresByArea)';

// lat, lon, frp, acq_time (HHMM UTC) — from the FIRMS CSV rows.
const HORMUZ_UAE_OMAN = [
  [24.50376, 56.6086, 9.39, '1002'],
  [25.70098, 58.27847, 5.74, '1002'],
  [25.97527, 56.07025, 4.18, '1002'],
  [27.1615, 56.1013, 4.22, '1002'],
  [24.00197, 55.44088, 2.62, '2229'],
  [24.4549, 56.55277, 2.86, '2229'],
  [24.46365, 56.63007, 7.38, '2229'],
  [24.46492, 56.62415, 7.38, '2229'],
  [24.50305, 56.605, 11.41, '2229'],
  [24.50349, 56.60958, 7.36, '2229'],
  [24.50473, 56.60371, 4.94, '2229'],
  [24.99005, 55.627, 1.88, '2229'],
  [25.30717, 56.37327, 4.64, '2229'],
  [25.30878, 56.3743, 2.92, '2229'],
  [25.55606, 55.98335, 1.91, '2229'],
  [25.55714, 55.97824, 2.04, '2229'],
  [25.96431, 56.06638, 4.08, '2229'],
  [25.97332, 56.06872, 5.36, '2229'],
  [26.95476, 55.54486, 2.09, '2229'],
  [27.16855, 56.05511, 4.35, '2229'],
  [27.16896, 56.09689, 3.45, '2229'],
  [27.17628, 56.06241, 3.43, '2229'],
  [27.30094, 56.30357, 1.61, '2229'],
  [27.30266, 56.30524, 2.39, '2229'],
  [27.42259, 56.50138, 1.8, '2229'],
];

const RED_SEA_YEMEN_HORN = [
  [11.26427, 41.5168, 58.28, '0958'],
  [11.26481, 41.51972, 58.28, '0958'],
  [11.26926, 41.51591, 58.28, '0958'],
  [11.27035, 41.52176, 65.08, '0958'],
  [11.2709, 41.52467, 65.08, '0958'],
  [11.50064, 41.50893, 21.94, '0958'],
  [11.51423, 43.09402, 6.74, '0958'],
  [13.30689, 45.2908, 5.25, '0958'],
  [15.59628, 49.12955, 2.07, '1000'],
  [11.59029, 41.55872, 2.9, '2231'],
  [11.59238, 41.55756, 8.09, '2231'],
  [11.59389, 41.55925, 14.7, '2231'],
  [11.59452, 41.55502, 14.7, '2231'],
  [11.59598, 41.55809, 8.09, '2231'],
  [11.59812, 41.55555, 14.7, '2231'],
  [11.60018, 41.55439, 13.63, '2231'],
  [15.46879, 45.28715, 1.38, '2231'],
  [15.55065, 45.7729, 1.16, '2231'],
  [15.57961, 45.80304, 2.06, '2231'],
  [15.58467, 46.16353, 0.35, '2231'],
  [15.59455, 49.12813, 1.75, '2231'],
  [15.61093, 46.01872, 0.73, '2231'],
  [15.61205, 46.01164, 2.6, '2231'],
  [15.81939, 45.83595, 0.53, '2231'],
  [11.2548, 41.52552, 3.06, '0958'],
  [11.25839, 41.52605, 6.41, '0958'],
  [2.06698, 45.28712, 0.94, '2235'],
];

function hotspot([lat, lon, frp, hhmm], region) {
  const time_utc = `2026-10-21T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
  return {
    category: 'thermal_hotspot',
    title: `Thermal hotspot ${lat.toFixed(3)}, ${lon.toFixed(3)} (FRP ${frp} MW)`,
    summary: `VIIRS NOAA-21 near-real-time fire detection, fire radiative power ${frp} MW, acquired ${time_utc} (${region}).`,
    lat,
    lon,
    frp,
    time_utc,
    place: region,
    actors: [],
    impact: frp >= 20 ? 'large thermal signature' : 'small thermal signature',
    sources: [
      {
        url: 'https://firms.modaps.eosdis.nasa.gov/',
        published_at: time_utc,
        title: 'NASA FIRMS active fire data',
      },
    ],
    confidence: 'inferred',
    provenance: VIIRS_PROVENANCE,
  };
}

export const SEED_HOTSPOTS = [
  ...HORMUZ_UAE_OMAN.map((row) => hotspot(row, 'Hormuz / UAE / Oman')),
  ...RED_SEA_YEMEN_HORN.map((row) => hotspot(row, 'Red Sea / Yemen / Horn')),
];

const PLANET_THUMB = (id) =>
  `https://serverless.on-demand.io/apps/planet-proxy/thumbnail/PSScene/${id}`;
const ev = (id, acquired, clear) => ({
  item_id: id,
  thumbnail_url: PLANET_THUMB(id),
  acquired,
  ...(clear !== undefined ? { clear_percent: clear } : {}),
});

/** PlanetScope evidence per presence node (from the OnDemand searchImagery plugin). */
export const SEED_EVIDENCE = {
  berbera: [
    ev('20261020_080627_72_24fe', '2026-10-20T08:06:27Z', 98),
    ev('20261018_082850_84_250e', '2026-10-18T08:28:50Z'),
    ev('20261008_072014_32_2591', '2026-10-08T07:20:14Z', 91),
  ],
  bosaso: [
    ev('20261020_071548_67_2560', '2026-10-20T07:15:48Z'),
    ev('20261019_071625_28_254b', '2026-10-19T07:16:25Z'),
    ev('20261009_070400_39_2591', '2026-10-09T07:04:00Z', 87),
  ],
  socotra: [
    ev('20261018_065837_32_2563', '2026-10-18T06:58:37Z', 54),
    ev('20261017_073343_83_254a', '2026-10-17T07:33:43Z'),
  ],
  aden: [
    ev('20261022_073054_55_255a', '2026-10-22T07:30:54Z', 100),
    ev('20261020_081000_69_252e', '2026-10-20T08:10:00Z'),
    ev('20261019_081020_07_254a', '2026-10-19T08:10:20Z'),
  ],
};

export const SEED_WEB_INCIDENTS = [
  {
    id: 'web-uae-csc-ai-cyber-2026',
    category: 'cyber',
    title:
      'UAE Cybersecurity Council: 128 AI-enabled cyber incidents targeting the UAE since start of 2026',
    summary:
      'The UAE Cybersecurity Council reported 128 AI-enabled cyber incidents since the start of 2026, including government breach attempts, data leaks and ransomware.',
    time_utc: '2026-02-24T00:00:00Z',
    lat: 24.4539,
    lon: 54.3773,
    place: 'Abu Dhabi',
    actors: ['UAE Cybersecurity Council'],
    impact: 'government breach attempts, data leaks, ransomware',
    sources: [
      {
        url: 'https://securereading.com/uae-ai-cyberattacks-2026/',
        published_at: '2026-02-24T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand Perplexity research (live web)',
  },
  {
    id: 'web-ptsecurity-gulf-h1-2026',
    category: 'cyber',
    title: 'Positive Technologies H1-2026: UAE 35% of Gulf cyberattacks',
    summary:
      'Positive Technologies H1-2026 report: UAE accounted for 35% of Gulf cyberattacks, Saudi Arabia 15%, Iran 17%; government was 27% of successful attacks.',
    time_utc: '2026-09-17T00:00:00Z',
    lat: 25.2048,
    lon: 55.2708,
    place: 'Dubai',
    actors: ['Positive Technologies'],
    impact: 'sector-wide cyber exposure',
    sources: [
      {
        url: 'https://www.facebook.com/theuaetimes/posts/1539597078208489/',
        published_at: '2026-09-17T00:00:00Z',
      },
    ],
    confidence: 'unverified',
    provenance: 'OnDemand Perplexity research (live web)',
  },
  {
    id: 'web-houthi-missile-yanbu-riyadh',
    category: 'missile_drone_strike',
    title:
      'Houthi missile/drone attacks claimed on Riyadh and Yanbu; Saudi intercept toward Riyadh; RUH flights disrupted',
    summary:
      'US embassy security alerts across UAE, Saudi Arabia, Qatar, Jordan, Bahrain, Kuwait, Oman, Lebanon, Iraq and Israel; Saudi Arabia intercepted a ballistic missile toward Riyadh; Houthis claimed missile/drone attacks on Riyadh and Yanbu; flights at RUH disrupted. Launch-area reference: Hodeidah (14.7979, 42.9545).',
    time_utc: '2026-10-20T00:00:00Z',
    lat: 24.0896,
    lon: 38.0618,
    place: 'Yanbu',
    actors: ['Houthis', 'Saudi air defence'],
    impact: 'flight disruptions at RUH; embassy alerts',
    sources: [
      {
        url: 'https://www.travelandleisure.com/new-middle-east-travel-alerts-and-flight-disruptions-12136336',
        published_at: '2026-10-20T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand internet web search (live web)',
  },
  {
    id: 'web-houthi-launch-area-hodeidah',
    category: 'missile_drone_strike',
    title: 'Houthi launch-area anchor — Hodeidah (Riyadh/Yanbu attack wave)',
    summary:
      'AOI anchor for the Houthi missile/drone wave claimed against Riyadh and Yanbu; Hodeidah is the referenced launch area inside the Yemen / southern Red Sea AOI.',
    time_utc: '2026-10-20T00:00:00Z',
    lat: 14.7979,
    lon: 42.9545,
    place: 'Hodeidah',
    actors: ['Houthis'],
    impact: 'launch area',
    sources: [
      {
        url: 'https://www.travelandleisure.com/new-middle-east-travel-alerts-and-flight-disruptions-12136336',
        published_at: '2026-10-20T00:00:00Z',
      },
    ],
    confidence: 'inferred',
    provenance: 'OnDemand internet web search (live web) + analyst anchor',
  },
  {
    id: 'web-falcon-shield-2026-hotan',
    category: 'airstrike',
    title: 'Falcon Shield 2026: UAE Mirage 2000-9 deployed to Hotan, China',
    summary:
      'UAE Air Force Mirage 2000-9 fighters deployed to Hotan (Xinjiang) for the China–UAE Falcon Shield 2026 exercise, late August to mid September 2026.',
    time_utc: '2026-09-01T00:00:00Z',
    lat: 37.1114,
    lon: 79.9229,
    place: 'Hotan, China',
    actors: ['UAE Air Force', 'PLAAF'],
    impact: 'exercise — outside AOI',
    sources: [
      {
        url: 'https://defencesecurityasia.com/en/china-uae-mirage-2000-hotan-falcon-shield-2026/',
        published_at: '2026-09-15T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand Perplexity research (live web)',
  },
  {
    id: 'web-us-ct-strategy-2026-somalia',
    category: 'political',
    title:
      '2026 US Counterterrorism Strategy names Al-Shabaab and ISIS-Somalia; light US footprint in Africa',
    summary:
      'The May 2026 US Counterterrorism Strategy names Al-Shabaab and ISIS-Somalia as threats and signals a light US footprint in Africa, ending the Mogadishu underwriting model.',
    time_utc: '2026-05-09T00:00:00Z',
    lat: 2.0349,
    lon: 45.3419,
    place: 'Mogadishu',
    actors: ['US Government', 'Al-Shabaab', 'ISIS-Somalia'],
    impact: 'policy shift',
    sources: [
      {
        url: 'https://somalilandchronicle.com/2026/05/09/sink-or-swim-for-somalia-the-2026-u-s-counterterrorism-strategy-and-the-end-of-the-mogadishu-underwriting/',
        published_at: '2026-05-09T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand Perplexity research (live web)',
  },
  {
    id: 'web-uae-ssd-reporting-service',
    category: 'political',
    title:
      'UAE State Security Department launches confidential reporting service (800 6600, SSD UAE app, SMS 6006)',
    summary:
      'The UAE State Security Department launched a confidential public reporting service: hotline 800 6600, the SSD UAE app and SMS 6006.',
    time_utc: '2026-03-01T00:00:00Z',
    lat: 24.4539,
    lon: 54.3773,
    place: 'Abu Dhabi',
    actors: ['UAE State Security Department'],
    impact: 'public reporting channel',
    sources: [
      {
        url: 'https://securereading.com/uae-state-security-reporting-service/',
        published_at: '2026-03-01T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand Perplexity research (live web)',
  },
  {
    id: 'web-adgm-fsra-24h-cyber-reporting',
    category: 'cyber',
    title:
      'ADGM FSRA binding 24-hour cyber incident reporting effective 31 Jan 2026',
    summary:
      'ADGM Financial Services Regulatory Authority made 24-hour cyber incident reporting binding for regulated firms from 31 January 2026.',
    time_utc: '2026-01-31T00:00:00Z',
    lat: 24.5009,
    lon: 54.3892,
    place: 'Abu Dhabi Global Market',
    actors: ['ADGM FSRA'],
    impact: 'regulatory obligation',
    sources: [
      {
        url: 'https://misconsultants.ae/article/uae-cybersecurity-incident-reporting-obligations-in-2026',
        published_at: '2026-05-04T00:00:00Z',
      },
    ],
    confidence: 'confirmed',
    provenance: 'OnDemand Perplexity research (live web)',
  },
];

const PRESENCE_NODES = [
  ['berbera', 'Berbera', 10.4386, 45.0134, 'Somaliland'],
  ['bosaso', 'Bosaso', 11.2785, 49.18, 'Puntland, Somalia'],
  ['aden', 'Aden', 12.7896, 45.0285, 'Yemen'],
  ['mukalla', 'Mukalla', 14.5425, 49.1231, 'Yemen'],
  ['mocha', 'Mocha', 13.3179, 43.2501, 'Yemen'],
  ['socotra', 'Socotra / Hadiboh', 12.6512, 54.0237, 'Yemen'],
  ['balhaf', 'Balhaf', 14.0044, 48.1763, 'Yemen'],
  ['perim', 'Perim / Mayun', 12.6518, 43.4278, 'Yemen'],
];

export const SEED_PRESENCE_NODES = PRESENCE_NODES.map(
  ([key, name, lat, lon, region]) => ({
    id: `presence-${key}`,
    category: 'protected_asset_presence_node',
    title: `UAE presence node — ${name}`,
    summary: `UAE presence / protected asset at ${name} (${region}); 25 km protection radius from config/aoi/uae-interest.json.`,
    time_utc: '2026-10-22T00:00:00Z',
    lat,
    lon,
    place: name,
    actors: ['UAE'],
    impact: 'protected asset',
    sources: [],
    confidence: 'confirmed',
    provenance: 'config/aoi/uae-interest.json presence layer',
    evidence: SEED_EVIDENCE[key] || [],
  }),
);

/** The complete seed set in ingest order. */
export function seedIncidents() {
  return [...SEED_PRESENCE_NODES, ...SEED_WEB_INCIDENTS, ...SEED_HOTSPOTS];
}
