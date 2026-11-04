/**
 * Live Intelligence source — Open-Meteo weather (free, no key, CC BY 4.0,
 * attribution required: https://open-meteo.com/).
 *
 * ingestion → normalisation → validation → scene patch. No model call is
 * involved: a weather observation maps deterministically onto the Scene
 * Spec effect vocabulary (`weather_rain`, `weather_fog`, `haze`) plus a
 * `note`-style timeline beat, and the result is a zod-validated ScenePatch
 * the browser's Live Intelligence Director applies like any other update.
 *
 * The observation itself is DATA (sourced, timestamped, attributed); the
 * effect is STAGING (labelled approximate). Nothing here claims a weather
 * event the provider did not report.
 */
import { normalizeRegionalWeather } from '../../src/data/regionalModel.js';
import { safeValidateScenePatch } from '../../src/cinematic/sceneSchema.js';

export const OPEN_METEO_ATTRIBUTION =
  'Weather data by Open-Meteo.com (CC BY 4.0)';
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BYTES = 256 * 1024;

/**
 * Fetch and normalise the current observation at a WGS84 point.
 * Never throws; returns `{ ok:false, error }` on any failure.
 */
export async function fetchWeatherObservation(
  { lat, lon },
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now(),
  } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      error: { code: 'invalid_point', message: 'lat/lon required' },
    };
  }
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    current:
      'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility',
    timezone: 'UTC',
  });
  const url = `${OPEN_METEO_BASE}?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      redirect: 'error',
    });
    const latencyMs = now() - started;
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: 'provider_http_error',
          status: res.status,
          message: `Open-Meteo HTTP ${res.status}`,
        },
        latencyMs,
        url,
      };
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      return {
        ok: false,
        error: {
          code: 'response_too_large',
          message: 'Open-Meteo body exceeded cap',
        },
        latencyMs,
        url,
      };
    }
    const payload = JSON.parse(text);
    const observation = normalizeRegionalWeather(payload);
    if (!observation) {
      return {
        ok: false,
        error: {
          code: 'provider_payload_invalid',
          message: 'No current observation',
        },
        latencyMs,
        url,
      };
    }
    return {
      ok: true,
      observation,
      source: {
        provider: 'open-meteo',
        url,
        attribution: OPEN_METEO_ATTRIBUTION,
        retrievedAt: new Date(now()).toISOString(),
        status: res.status,
      },
      latencyMs,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      error: {
        code: aborted ? 'provider_timeout' : 'provider_unreachable',
        message: aborted
          ? `Open-Meteo timed out after ${timeoutMs} ms`
          : String(err?.message || err),
      },
      latencyMs: now() - started,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** WMO code → the Scene Spec effect it maps to (or null for no visual effect). */
export function effectForWeatherCode(
  code,
  { visibilityM = null, precipitationMm = null } = {},
) {
  const v = Number(code);
  if ([45, 48].includes(v))
    return { type: 'weather_fog', intensity: 0.7, label: 'FOG' };
  if ((v >= 51 && v <= 67) || (v >= 80 && v <= 82) || (v >= 95 && v <= 99)) {
    const mm = Number.isFinite(Number(precipitationMm))
      ? Number(precipitationMm)
      : 0;
    return {
      type: 'weather_rain',
      intensity: Math.min(1, Math.max(0.3, 0.3 + mm / 10)),
      label:
        v >= 95
          ? 'THUNDERSTORM'
          : v >= 80
            ? 'RAIN SHOWERS'
            : v >= 61
              ? 'RAIN'
              : 'DRIZZLE',
    };
  }
  if (v >= 71 && v <= 77)
    return { type: 'weather_rain', intensity: 0.5, label: 'SNOW' };
  if (Number.isFinite(Number(visibilityM)) && Number(visibilityM) < 5000) {
    return {
      type: 'haze',
      intensity: Math.min(1, 1 - Number(visibilityM) / 5000 + 0.3),
      label: 'REDUCED VISIBILITY',
    };
  }
  if (v === 3) return { type: 'haze', intensity: 0.25, label: 'OVERCAST' };
  return null;
}

/**
 * Build a validated ScenePatch from an observation. `scene` must carry
 * `sceneId` and `sceneVersion`; `atSec` is the current playback position so
 * the beat lands in the live timeline (never rewinds).
 */
export function buildWeatherPatch(
  { observation, source },
  { sceneId, baseVersion = 0, atSec = 0, now = () => Date.now() } = {},
) {
  const stamp = now();
  const effect = effectForWeatherCode(observation.weatherCode, observation);
  const parts = [];
  if (Number.isFinite(observation.temperatureC))
    parts.push(`${observation.temperatureC.toFixed(0)} °C`);
  if (Number.isFinite(observation.windKph))
    parts.push(`wind ${observation.windKph.toFixed(0)} km/h`);
  if (Number.isFinite(observation.visibilityM))
    parts.push(`vis ${(observation.visibilityM / 1000).toFixed(1)} km`);
  if (
    Number.isFinite(observation.precipitationMm) &&
    observation.precipitationMm > 0
  )
    parts.push(`precip ${observation.precipitationMm} mm`);
  const summary = parts.join(' · ') || 'observation';
  const label = effect ? effect.label : 'CLEAR / NO VISUAL EFFECT';
  const evidenceId = `ev-weather-${stamp}`;
  const ops = [
    {
      op: 'add_evidence',
      evidence: {
        id: evidenceId,
        source: 'other',
        title: `Open-Meteo observation: ${label} · ${summary}`,
        url: source.url,
        tier: 'verified',
        capturedAt: observation.observedAt || null,
        retrievedAt: source.retrievedAt,
        note: `${source.attribution}. WMO code ${observation.weatherCode}. Visual effect is approximate staging derived from the observation.`,
      },
    },
    {
      op: 'add_timeline_event',
      beat: {
        atSec: Math.max(0, Math.round(atSec)),
        title: `Weather: ${label}`.slice(0, 80),
        narration:
          `Live weather (${source.attribution}): ${label.toLowerCase()}, ${summary}.`.slice(
            0,
            600,
          ),
        evidenceIds: [evidenceId],
      },
    },
  ];
  if (effect) {
    ops.push({
      op: 'add_effect',
      effect: {
        id: `eff-weather-${stamp}`,
        type: effect.type,
        startSec: Math.max(0, Math.round(atSec)),
        endSec: null,
        intensity: Number(effect.intensity.toFixed(2)),
        hypothetical: false,
      },
    });
  }
  const patch = {
    patchId: `patch-weather-${stamp}`,
    sceneId,
    baseVersion,
    ops,
    reason: `Open-Meteo current conditions: ${label}`.slice(0, 400),
    source: 'intelligence',
    evidenceIds: [evidenceId],
    priority: effect && effect.intensity >= 0.6 ? 'high' : 'normal',
    label: `LIVE WEATHER — ${label}`.slice(0, 80),
    createdAt: new Date(stamp).toISOString(),
  };
  const parsed = safeValidateScenePatch(patch);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'patch_invalid', issues: parsed.error.issues },
    };
  }
  return { ok: true, patch: parsed.data, effect, label, summary };
}
