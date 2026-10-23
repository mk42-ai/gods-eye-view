/**
 * Gods-Eye scene engine — data models and factories.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

export const SOURCE_PLATFORMS = Object.freeze([
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'reddit',
  'web',
]);

export const STAGES = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4']);

export const SCENE_STATES = Object.freeze([
  'idle',
  'parsing',
  'geocoded',
  'routing',
  'flying',
  'fetching',
  'ranked',
  'playing',
  'saved',
  'error',
]);

/**
 * Generate a new scene ID starting with 's_'.
 *
 * @param {number} [nowMs=Date.now()] Reference timestamp in ms
 * @returns {string} e.g. 's_<base36 time><rand>'
 */
export function newSceneId(nowMs = Date.now()) {
  const timePart = Number(nowMs).toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `s_${timePart}${randPart}`;
}

/**
 * Recomputes scene lifecycle state (isNew, archivedAt, isArchived).
 *
 * @param {object} scene Scene object or lifecycle object
 * @param {number} [nowMs=Date.now()] Reference timestamp in ms
 * @returns {object} Updated lifecycle object
 */
export function sceneLifecycle(scene, nowMs = Date.now()) {
  const current = scene?.lifecycle || scene || {};
  const createdAtMs = Date.parse(
    current.createdAt || new Date(nowMs).toISOString(),
  );
  const ageMs = nowMs - createdAtMs;
  const isNew = ageMs < 24 * 3600_000 && ageMs >= 0;
  const archivedAtMs = createdAtMs + 72 * 3600_000;
  const archivedAt = new Date(archivedAtMs).toISOString();
  const isArchived = nowMs >= archivedAtMs;

  const updated = {
    ...current,
    createdAt: current.createdAt || new Date(createdAtMs).toISOString(),
    lastBuiltAt: current.lastBuiltAt || new Date(nowMs).toISOString(),
    buildCount: typeof current.buildCount === 'number' ? current.buildCount : 1,
    isNew,
    archivedAt,
    isArchived,
  };

  if (scene && typeof scene === 'object' && scene.lifecycle) {
    scene.lifecycle.isNew = isNew;
    scene.lifecycle.archivedAt = archivedAt;
    scene.lifecycle.isArchived = isArchived;
  }

  Object.defineProperty(updated, 'lifecycle', {
    get() {
      return updated;
    },
    enumerable: false,
    configurable: true,
  });

  return updated;
}

/**
 * Factory for a complete Scene object.
 *
 * @param {object} [partial={}] Partial Scene overrides
 * @param {number} [nowMs=Date.now()] Current timestamp for defaults
 * @returns {object} Scene object matching Contract §1
 */
export function createScene(partial = {}, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const id = partial.id || newSceneId(nowMs);
  const target = {
    name: '',
    lat: 0,
    lon: 0,
    geocodeSource: 'dictionary',
    confidence: 1,
    ...partial.target,
  };

  const initialLifecycle = sceneLifecycle(
    {
      createdAt: partial.lifecycle?.createdAt || nowIso,
      lastBuiltAt: partial.lifecycle?.lastBuiltAt || nowIso,
      buildCount: partial.lifecycle?.buildCount ?? 1,
      ...partial.lifecycle,
    },
    nowMs,
  );

  const sources = {};
  for (const p of SOURCE_PLATFORMS) {
    sources[p] = {
      enabled: true,
      status: 'idle',
      count: 0,
      latencyMs: 0,
      ...(partial.sources?.[p] || {}),
    };
  }

  return {
    id,
    title: partial.title || '',
    prompt: partial.prompt || '',
    label: partial.label || 'UAE Interest Watch',
    kind: partial.kind || 'live',
    aoi: {
      id: null,
      name: '',
      country: '',
      category: 'home',
      inRegister: false,
      ...partial.aoi,
    },
    target,
    tRef: partial.tRef || nowIso,
    tRefLabel: partial.tRefLabel || '',
    preset: {
      alt: 18000,
      heading: 0,
      pitch: 60,
      dwell: [4.2, 11],
      ...partial.preset,
    },
    route: {
      scenePath: partial.route?.scenePath ? [...partial.route.scenePath] : [],
      approachBearing: partial.route?.approachBearing ?? 0,
      groundRoutes: partial.route?.groundRoutes
        ? [...partial.route.groundRoutes]
        : [],
      alerts: partial.route?.alerts ? [...partial.route.alerts] : [],
      confidence: partial.route?.confidence ?? 1,
      basis: partial.route?.basis || '',
      fallback: Boolean(partial.route?.fallback),
      ...partial.route,
    },
    camera: {
      lat: partial.camera?.lat ?? target.lat,
      lon: partial.camera?.lon ?? target.lon,
      alt: partial.camera?.alt ?? 18000,
      heading: partial.camera?.heading ?? 0,
      pitch: partial.camera?.pitch ?? 60,
      roll: partial.camera?.roll ?? 0,
      stage: partial.camera?.stage || 'S0',
      ...partial.camera,
    },
    sources,
    footage: Array.isArray(partial.footage) ? [...partial.footage] : [],
    timeline: {
      start: partial.timeline?.start || nowIso,
      end: partial.timeline?.end || nowIso,
      markers: partial.timeline?.markers ? [...partial.timeline.markers] : [],
      ...partial.timeline,
    },
    lifecycle: initialLifecycle,
    status: partial.status || 'idle',
    error: partial.error || null,
  };
}

/**
 * Factory for a FootageItem object.
 *
 * @param {object} [partial={}] Partial FootageItem overrides
 * @param {number} [nowMs=Date.now()]
 * @returns {object} FootageItem object matching Contract §1
 */
export function createFootageItem(partial = {}, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();

  return {
    id: partial.id || '',
    sceneId: partial.sceneId || '',
    platform: partial.platform || 'web',
    mediaUrl: partial.mediaUrl || '',
    embedUrl: partial.embedUrl || '',
    thumbUrl: partial.thumbUrl || '',
    authorHandle: partial.authorHandle || '',
    authorAvatar: partial.authorAvatar || '',
    caption: partial.caption || '',
    hashtags: Array.isArray(partial.hashtags) ? [...partial.hashtags] : [],
    uploadedAt: partial.uploadedAt || nowIso,
    capturedAt: partial.capturedAt ?? null,
    location: {
      lat: partial.location?.lat ?? null,
      lon: partial.location?.lon ?? null,
      confidence: partial.location?.confidence || 'unknown',
      basis: partial.location?.basis || '',
      ...partial.location,
    },
    distanceKm: partial.distanceKm ?? null,
    timeDelta: partial.timeDelta ?? null,
    recency: partial.recency || 'LIVE',
    rankScore: partial.rankScore ?? 0,
    sourceUrl: partial.sourceUrl || '',
    pluginMeta: {
      icon: partial.pluginMeta?.icon || '',
      rawPayloadRef: partial.pluginMeta?.rawPayloadRef || '',
      ...partial.pluginMeta,
    },
  };
}
