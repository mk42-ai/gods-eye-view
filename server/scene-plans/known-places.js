/**
 * Known places table for UAE landmarks and common scenario anchors.
 * Provides immediate deterministic coordinates for known landmarks, bypassing
 * slow external research when the anchor is already well-known.
 */
import { stripScenarioTerms } from './location.js';

export const KNOWN_PLACES = Object.freeze([
  {
    name: 'Dubai Marina',
    aliases: [
      'dubai marina',
      'the marina dubai',
      'the dubai marina',
      'marina dubai',
      'dubaimarina',
    ],
    lat: 25.0806,
    lon: 55.1397,
    city: 'Dubai',
    country: 'AE',
    kind: 'district',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Dubai%20Marina',
    approximate: true,
  },
  {
    name: 'Yas Mall',
    aliases: ['yas mall', 'yasmall'],
    lat: 24.4886,
    lon: 54.6079,
    city: 'Abu Dhabi',
    country: 'AE',
    kind: 'mall',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Yas%20Mall',
    approximate: true,
  },
  {
    name: 'Burj Khalifa',
    aliases: ['burj khalifa', 'burjkhalifa'],
    lat: 25.1972,
    lon: 55.2744,
    city: 'Dubai',
    country: 'AE',
    kind: 'landmark',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Burj%20Khalifa',
    approximate: true,
  },
  {
    name: 'Umm Suqeim',
    aliases: ['umm suqeim', 'um suqeim', 'ummsuqeim'],
    lat: 25.1535,
    lon: 55.206,
    city: 'Dubai',
    country: 'AE',
    kind: 'district',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Umm%20Suqeim',
    approximate: true,
  },
  {
    name: 'Burj Al Arab',
    aliases: ['burj al arab', 'burj al-arab', 'burj alarab'],
    lat: 25.1412,
    lon: 55.1853,
    city: 'Dubai',
    country: 'AE',
    kind: 'hotel',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Burj%20Al%20Arab',
    approximate: true,
  },
  {
    name: 'Emirates Palace',
    aliases: ['emirates palace', 'emirates palace hotel', 'emiratespalace'],
    lat: 24.4617,
    lon: 54.3173,
    city: 'Abu Dhabi',
    country: 'AE',
    kind: 'hotel',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Emirates%20Palace',
    approximate: true,
  },
  {
    name: 'Yas Marina Circuit',
    aliases: [
      'yas marina circuit',
      'yas marina',
      'yas circuit',
      'yasmarinacircuit',
    ],
    lat: 24.4672,
    lon: 54.6031,
    city: 'Abu Dhabi',
    country: 'AE',
    kind: 'circuit',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl:
      'https://www.openstreetmap.org/search?query=Yas%20Marina%20Circuit',
    approximate: true,
  },
  {
    name: 'Sheikh Zayed Road (Dubai)',
    aliases: [
      'sheikh zayed road',
      'szr',
      'sheikh zayed road dubai',
      'sheikh zayed rd',
      'sh zayed rd',
    ],
    lat: 25.188,
    lon: 55.265,
    city: 'Dubai',
    country: 'AE',
    kind: 'road',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl:
      'https://www.openstreetmap.org/search?query=Sheikh%20Zayed%20Road',
    approximate: true,
  },
  {
    name: 'JBR',
    aliases: [
      'jbr',
      'jumeirah beach residence',
      'jumeirah beach residences',
      'jumeirah beach residence jbr',
    ],
    lat: 25.078,
    lon: 55.133,
    city: 'Dubai',
    country: 'AE',
    kind: 'district',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=JBR',
    approximate: true,
  },
  {
    name: 'Dubai Mall',
    aliases: ['dubai mall', 'the dubai mall', 'dubaimall'],
    lat: 25.1985,
    lon: 55.2796,
    city: 'Dubai',
    country: 'AE',
    kind: 'mall',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl: 'https://www.openstreetmap.org/search?query=Dubai%20Mall',
    approximate: true,
  },
  {
    name: 'Abu Dhabi Corniche',
    aliases: [
      'abu dhabi corniche',
      'corniche abu dhabi',
      'the corniche abu dhabi',
      'the corniche',
      'corniche',
    ],
    lat: 24.4746,
    lon: 54.335,
    city: 'Abu Dhabi',
    country: 'AE',
    kind: 'promenade',
    precision: 'landmark',
    source: 'known-place-table',
    sourceUrl:
      'https://www.openstreetmap.org/search?query=Abu%20Dhabi%20Corniche',
    approximate: true,
  },
  {
    name: "Kane's Boxing Gym Abu Dhabi",
    aliases: [
      'kanes boxing gym',
      "kane's boxing gym",
      'kanes boxing academy',
      "kane's boxing academy",
      'kane boxing gym',
      'kane boxing academy',
      'kanes gym',
      "kane's gym",
      'kanes boxing',
      "kane's boxing",
      'kanes boxing gym abu dhabi',
      "kane's boxing gym abu dhabi",
    ],
    lat: 24.4539,
    lon: 54.3773,
    city: 'Abu Dhabi',
    country: 'AE',
    kind: 'gym',
    precision: 'city',
    source: 'known-place-table',
    sourceUrl:
      'https://www.openstreetmap.org/search?query=Kane%27s%20Boxing%20Gym%20Abu%20Dhabi',
    approximate: true,
  },
]);

function normalizeForMatching(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\bdoinga\b/gi, 'doing a')
    .replace(/['’]/g, '')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Precomputed list of [normalizedAlias, entry] sorted by alias length descending */
const ALIAS_LOOKUP = [];
for (const entry of KNOWN_PLACES) {
  const normName = normalizeForMatching(entry.name);
  ALIAS_LOOKUP.push({ normAlias: normName, entry });
  for (const alias of entry.aliases) {
    const norm = normalizeForMatching(alias);
    if (
      norm &&
      !ALIAS_LOOKUP.some((x) => x.normAlias === norm && x.entry === entry)
    ) {
      ALIAS_LOOKUP.push({ normAlias: norm, entry });
    }
  }
}
// Sort by length descending so more specific names (e.g. Yas Marina Circuit) match before shorter ones
ALIAS_LOOKUP.sort((a, b) => b.normAlias.length - a.normAlias.length);

/**
 * Match a prompt or free text against known UAE places.
 * Case/punctuation-insensitive, strips scenario words and common prefixes.
 *
 * @param {string} text
 * @returns {object|null} Matched entry from KNOWN_PLACES or null
 */
export function matchKnownPlace(text) {
  if (!text || typeof text !== 'string') return null;

  const normalized = normalizeForMatching(text);
  if (!normalized) return null;

  // 1. Direct whole-word phrase match on full normalized text
  for (const { normAlias, entry } of ALIAS_LOOKUP) {
    const rx = new RegExp(`(?:^|\\s)${escapeRegex(normAlias)}(?:\\s|$)`);
    if (rx.test(normalized)) {
      return { ...entry };
    }
  }

  // 2. Try after stripping scenario terms
  let stripped = normalizeForMatching(stripScenarioTerms(text));
  if (stripped && stripped !== normalized) {
    for (const { normAlias, entry } of ALIAS_LOOKUP) {
      const rx = new RegExp(`(?:^|\\s)${escapeRegex(normAlias)}(?:\\s|$)`);
      if (rx.test(stripped)) {
        return { ...entry };
      }
    }
  }

  return null;
}
