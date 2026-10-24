/**
 * Gods-Eye scene engine — AOI (Area of Interest) register.
 * Provides spatial lookup and local storage persistence.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

import seed from './aoiRegister.seed.json' with { type: 'json' };
import { haversineKm } from '../../aoi/membership.js';

const STORAGE_KEY = 'godsEye.aoiRegister';
let currentRegistry = seed.map((item) => ({ ...item }));
let customAdditions = [];

/**
 * Loads AOI register, merging seed entries with stored custom additions.
 *
 * @param {object} [options={}]
 * @param {Storage|object} [options.storage]
 * @returns {Array<object>}
 */
export function loadRegister({ storage } = {}) {
  customAdditions = [];
  if (storage && typeof storage.getItem === 'function') {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          customAdditions = parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  const byId = new Map();
  for (const item of seed) {
    byId.set(item.id, { ...item });
  }
  for (const item of customAdditions) {
    if (item?.id) {
      byId.set(item.id, { ...item });
    }
  }
  currentRegistry = Array.from(byId.values());
  return currentRegistry.map((item) => ({ ...item }));
}

/**
 * Returns current list of registered AOIs.
 *
 * @returns {Array<object>}
 */
export function listAoi() {
  return currentRegistry.map((item) => ({ ...item }));
}

/**
 * Find the nearest registered AOI containing the given coordinate (distance <= radiusKm).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {object|null} { ...entry, distanceKm, inside: true } or null
 */
export function findAoi(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return null;

  let best = null;
  let minDistance = Infinity;

  for (const entry of currentRegistry) {
    const d = haversineKm(nLat, nLon, entry.lat, entry.lon);
    if (d <= entry.radiusKm && d < minDistance) {
      minDistance = d;
      best = {
        ...entry,
        distanceKm: Math.round(d * 100) / 100,
        inside: true,
      };
    }
  }

  return best;
}

/**
 * Returns the nearest AOI regardless of whether the point is inside or outside.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {object|null} { ...entry, distanceKm, inside: boolean } or null
 */
export function nearestAoi(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return null;
  if (!currentRegistry.length) return null;

  let best = null;
  let minDistance = Infinity;

  for (const entry of currentRegistry) {
    const d = haversineKm(nLat, nLon, entry.lat, entry.lon);
    if (d < minDistance) {
      minDistance = d;
      best = {
        ...entry,
        distanceKm: Math.round(d * 100) / 100,
        inside: d <= entry.radiusKm,
      };
    }
  }

  return best;
}

/**
 * Adds or updates an AOI in the registry and optionally persists to storage.
 *
 * @param {object} entry
 * @param {object} [options={}]
 * @param {Storage|object} [options.storage]
 * @returns {object}
 */
export function addAoi(entry, { storage } = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('AOI entry required');
  }

  const id =
    entry.id ||
    `aoi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const item = {
    id,
    name: entry.name || '',
    country: entry.country || 'ARE',
    lat: Number(entry.lat) || 0,
    lon: Number(entry.lon) || 0,
    category: entry.category || 'home',
    radiusKm: Number(entry.radiusKm) || 20,
  };

  const existingIndex = currentRegistry.findIndex((x) => x.id === id);
  if (existingIndex >= 0) {
    currentRegistry[existingIndex] = item;
  } else {
    currentRegistry.push(item);
  }

  const customIndex = customAdditions.findIndex((x) => x.id === id);
  if (customIndex >= 0) {
    customAdditions[customIndex] = item;
  } else {
    customAdditions.push(item);
  }

  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(customAdditions));
    } catch {
      // ignore storage errors
    }
  }

  return item;
}
