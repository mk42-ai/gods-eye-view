/**
 * Gods-Eye Geo Resolver
 * Resolves item location from exact geotag, place dictionary, register, landmarks, or scene target.
 * Browser ES module — no Node builtins, no DOM access at import time.
 */

import { PLACES } from '../../footage/model.js';

export const LANDMARKS = Object.freeze([
  {
    name: 'Burj Khalifa',
    lat: 25.1972,
    lon: 55.2744,
    aliases: ['burj khalifa', 'burj', 'khalifa tower', 'برج خليفة'],
  },
  {
    name: 'Dubai Marina',
    lat: 25.08,
    lon: 55.14,
    aliases: ['dubai marina', 'marina', 'jbr', 'مرسى دبي'],
  },
  {
    name: 'Palm Jumeirah',
    lat: 25.112,
    lon: 55.138,
    aliases: ['palm jumeirah', 'the palm', 'نخلة جميرا'],
  },
  {
    name: 'Jumeirah Beach',
    lat: 25.204,
    lon: 55.24,
    aliases: ['jumeirah beach', 'jbr beach', 'kite beach', 'شاطئ جميرا'],
  },
  {
    name: 'Dubai Mall',
    lat: 25.1985,
    lon: 55.2796,
    aliases: ['dubai mall', 'the dubai mall', 'دبي مول'],
  },
  {
    name: 'Sheikh Zayed Road',
    lat: 25.197,
    lon: 55.272,
    aliases: ['sheikh zayed road', 'szr', 'e11', 'شارع الشيخ زايد'],
  },
]);

/**
 * Normalises text for substring/regex matching, returning versions with and without # / punctuation.
 */
function buildSearchHaystack(item) {
  const parts = [
    String(item?.caption ?? ''),
    Array.isArray(item?.hashtags) ? item.hashtags.join(' ') : '',
    String(item?.title ?? ''),
  ];
  const raw = parts.filter(Boolean).join(' ').toLowerCase();
  const collapsed = raw.replace(/[#_]/g, ' ');
  const stripped = raw.replace(/[^\p{L}\p{N}]/gu, '');
  return { raw, collapsed, stripped };
}

/**
 * Checks if a candidate place matches the item haystack.
 */
function matchPlace(place, { raw, collapsed, stripped }) {
  if (!place) return false;
  const terms = new Set();

  if (place.name) {
    terms.add(String(place.name ?? '').toLowerCase());
  }
  if (place.arabic) {
    terms.add(String(place.arabic ?? '').toLowerCase());
  }
  if (Array.isArray(place.aliases)) {
    for (const a of place.aliases) {
      if (a) terms.add(String(a).toLowerCase());
    }
  }

  for (const term of terms) {
    if (!term || term.length < 2) continue;
    // Check direct substring in raw text (e.g. Arabic 'أم سقيم')
    if (raw.includes(term)) return true;

    // Check with spaces collapsed (e.g. hashtag '#ummsuqeim' -> 'ummsuqeim')
    if (collapsed.includes(term)) return true;

    const termStripped = term.replace(/[^\p{L}\p{N}]/gu, '');
    if (termStripped.length >= 3) {
      // Check if hashtag stripped of spaces matches
      if (collapsed.includes(termStripped)) return true;
      if (stripped.includes(termStripped)) return true;
    }
  }
  return false;
}

/**
 * Resolves the location of a footage item.
 * Never upgrades to 'exact' unless raw coordinates exist on the item.
 *
 * @param {object} item FootageItem
 * @param {object} scene Scene object containing target
 * @param {{ places?: Array, register?: Array }} options
 * @returns {{ lat: number|null, lon: number|null, confidence: 'exact'|'inferred'|'unknown', basis: string }}
 */
export function resolveLocation(
  item,
  scene,
  { places = PLACES, register = [] } = {},
) {
  // 1. Keep exact geotag if present
  if (
    item?.location?.confidence === 'exact' &&
    Number.isFinite(item.location.lat) &&
    Number.isFinite(item.location.lon)
  ) {
    return {
      lat: item.location.lat,
      lon: item.location.lon,
      confidence: 'exact',
      basis: item.location.basis || 'geotag',
    };
  }

  const haystack = buildSearchHaystack(item);

  // 2. Scan PLACES and register
  const candidatePlaces = [...(places || []), ...(register || [])];
  for (const place of candidatePlaces) {
    if (matchPlace(place, haystack)) {
      if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
        return {
          lat: place.lat,
          lon: place.lon,
          confidence: 'inferred',
          basis: `place-tag:${place.name}`,
        };
      }
    }
  }

  // 3. Scan landmark list
  for (const landmark of LANDMARKS) {
    if (matchPlace(landmark, haystack)) {
      return {
        lat: landmark.lat,
        lon: landmark.lon,
        confidence: 'inferred',
        basis: `place-tag:${landmark.name}`,
      };
    }
  }

  // 4. Fall back to scene target
  const target = scene?.target;
  if (target && Number.isFinite(target.lat) && Number.isFinite(target.lon)) {
    return {
      lat: target.lat,
      lon: target.lon,
      confidence: 'unknown',
      basis: 'scene-target',
    };
  }

  return {
    lat: null,
    lon: null,
    confidence: 'unknown',
    basis: 'scene-target',
  };
}
