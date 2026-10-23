/**
 * Gods-Eye scene engine — prompt parser and geocoding.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

import { PLACES, findPlace, parseCommand } from '../../footage/model.js';
import { listAoi } from './aoiRegister.js';

// Explicit rebuilds use the ORIGINAL REPORTED DATE as tRef (spec §1). The
// date is verified (Gulf Today + Khaleej Times, published 2026-09-26 ~14:52Z,
// tests/fixtures/step1-fixtures.json); the time of day of the crash is NOT
// reported anywhere public, so 07:00Z (11:00 GST, morning commute) is an
// estimate and the header labels it "reported 2026-09-26", never a clock time.
export const KNOWN_INCIDENTS = Object.freeze({
  'umm suqeim|car crash': '2026-09-26T07:00:00Z',
});

const REBUILD_START = /^(?:please\s+)?(rebuild|replay|reconstruct|recreate)\b/i;
const INCIDENT_NOUNS =
  /\b(crash|accident|fire|strike|explosion|protest|flood|closure|collision|drone|attack|shooting)\b/i;
const SPLIT_PREPOSITIONS = /\s+(?:in|at|near)\s+(.+)$/i;

/**
 * Parses natural-language prompt into structured intent.
 * @param {string} text
 */
export function parsePrompt(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { kind: 'live', verb: null, incident: '', placeName: '', raw: '' };
  }

  const cmd = parseCommand(raw);
  const rebuildMatch = raw.match(REBUILD_START);

  if (rebuildMatch) {
    const verb = rebuildMatch[1].toLowerCase();
    let placeName = cmd?.place?.name || cmd?.placeText || '';
    let incident = cmd?.incident || '';

    if (!placeName) {
      const m = raw.match(SPLIT_PREPOSITIONS);
      if (m) placeName = m[1].trim();
    }
    if (!incident && placeName) {
      incident = raw
        .slice(rebuildMatch[0].length)
        .replace(new RegExp(`\\b(?:in|at|near)\\s+${placeName}\\b`, 'i'), '')
        .replace(/^(?:the|a|an)\s+/i, '')
        .replace(/\s+(?:reported|happened|occurred)$/i, '')
        .trim();
    }

    return { kind: 'rebuild', verb, incident, placeName, raw };
  }

  const hasPrep = /\b(?:in|at|near)\b/i.test(raw);
  const hasIncidentNoun = INCIDENT_NOUNS.test(raw);

  if (hasPrep && hasIncidentNoun) {
    let placeName = cmd?.place?.name || cmd?.placeText || '';
    let incident = cmd?.incident || '';

    if (!placeName) {
      const m = raw.match(SPLIT_PREPOSITIONS);
      if (m) placeName = m[1].trim();
    }
    if (!incident && placeName) {
      const pIdx = raw.search(SPLIT_PREPOSITIONS);
      if (pIdx > 0) incident = raw.slice(0, pIdx).trim();
    }

    return {
      kind: 'incident',
      verb: cmd?.verb || null,
      incident,
      placeName,
      raw,
    };
  }

  let placeName = cmd?.place?.name || '';
  if (!placeName) {
    placeName = raw
      .replace(/^(?:show|watch|find|get|fetch|take me to|fly to|go to)\s+/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .trim();
  }

  return {
    kind: 'live',
    verb: cmd?.verb || null,
    incident: '',
    placeName,
    raw,
  };
}

/**
 * Geocodes a place name via dictionary -> register -> Nominatim.
 *
 * @param {string} name
 * @param {object} [options={}]
 * @param {typeof fetch} [options.fetch]
 * @param {object} [options.register]
 * @returns {Promise<{
 *   name: string,
 *   lat: number,
 *   lon: number,
 *   geocodeSource: 'dictionary'|'register'|'nominatim',
 *   confidence: number
 * }|null>}
 */
export async function geocodePlace(name, { fetch, register } = {}) {
  const q = String(name || '').trim();
  if (!q) return null;

  const dictPlace = findPlace(q);
  if (dictPlace) {
    return {
      name: dictPlace.name,
      lat: dictPlace.lat,
      lon: dictPlace.lon,
      geocodeSource: 'dictionary',
      confidence: 0.95,
    };
  }

  const aois =
    register && typeof register.listAoi === 'function'
      ? register.listAoi()
      : Array.isArray(register)
        ? register
        : listAoi();

  const lowerQ = q.toLowerCase();
  const regHit = aois.find((a) => {
    const aName = (a.name || '').toLowerCase();
    return aName === lowerQ || aName.includes(lowerQ) || lowerQ.includes(aName);
  });

  if (regHit) {
    return {
      name: regHit.name,
      lat: regHit.lat,
      lon: regHit.lon,
      geocodeSource: 'register',
      confidence: 0.9,
    };
  }

  const fetchFn = fetch || globalThis.fetch;
  if (fetchFn) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetchFn(url, {
        headers: { Accept: 'application/json' },
      });
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const item = data[0];
          return {
            name: item.name || item.display_name || q,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            geocodeSource: 'nominatim',
            confidence: 0.7,
          };
        }
      }
    } catch {
      // network/parse error swallowed
    }
  }

  return null;
}

/**
 * Derives reference timestamp and label from prompt and kind.
 *
 * @param {object} params
 * @param {'live'|'incident'|'rebuild'} params.kind
 * @param {string} [params.text='']
 * @param {() => number|number} [params.now]
 * @returns {{ tRef: string, tRefLabel: string }}
 */
export function deriveTRef({ kind, text = '', now } = {}) {
  const nowMs =
    typeof now === 'function'
      ? now()
      : typeof now === 'number'
        ? now
        : Date.now();

  const gstDate = new Date(nowMs + 4 * 3600_000);
  const hh = String(gstDate.getUTCHours()).padStart(2, '0');
  const mm = String(gstDate.getUTCMinutes()).padStart(2, '0');
  const gstLabel = `estimated ${hh}:${mm} GST ±10 min`;

  if (kind === 'live' || kind === 'incident') {
    return {
      tRef: new Date(nowMs).toISOString(),
      tRefLabel: gstLabel,
    };
  }

  if (kind === 'rebuild') {
    const lowerText = String(text).toLowerCase();
    for (const [pattern, dateIso] of Object.entries(KNOWN_INCIDENTS)) {
      const tokens = pattern.toLowerCase().split('|');
      const matches = tokens.every((token) => lowerText.includes(token.trim()));
      if (matches) {
        const dateStr = dateIso.slice(0, 10);
        return {
          tRef: dateIso,
          tRefLabel: `reported ${dateStr}`,
        };
      }
    }

    const fallbackDate = new Date(nowMs - 24 * 3600_000);
    return {
      tRef: fallbackDate.toISOString(),
      tRefLabel: 'reported (date unknown)',
    };
  }

  return {
    tRef: new Date(nowMs).toISOString(),
    tRefLabel: gstLabel,
  };
}
