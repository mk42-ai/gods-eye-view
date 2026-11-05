/**
 * Render budget constants and helpers for Cesium memory and performance management.
 * Defines entity, billboard, particle, and tileset cache limits.
 */

export const MAX_BILLBOARDS_PER_SCENE = 600;
export const MAX_MEMBERS_PER_ENTITY = 12;
export const DENSITY_POLYGON_THRESHOLD = 12;
export const MAX_LABELS_VISIBLE = 24;
export const MAX_PARTICLE_SYSTEMS = 4;
export const MAX_PARTICLE_EMISSION = 24;

export const TILESET_CACHE_BYTES = 768 * 1024 * 1024;
export const TILESET_CACHE_OVERFLOW_BYTES = 256 * 1024 * 1024;
export const SOFTWARE_TILESET_CACHE_BYTES = 256 * 1024 * 1024;

/**
 * Returns the member billboard budget for a crowd or squad entity,
 * clamped to MAX_MEMBERS_PER_ENTITY.
 *
 * @param {number} count
 * @returns {number}
 */
export function memberBudget(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Math.min(n, MAX_MEMBERS_PER_ENTITY);
}

/**
 * Determines whether a crowd entity exceeds the density threshold and should
 * render a representative density polygon instead of individual members.
 *
 * @param {number} count
 * @returns {boolean}
 */
export function shouldUseDensityPolygon(count) {
  return Number(count) > DENSITY_POLYGON_THRESHOLD;
}

/**
 * Clamps particle emission rate to MAX_PARTICLE_EMISSION.
 *
 * @param {number} rate
 * @returns {number}
 */
export function clampParticleEmission(rate) {
  const r = Number.isFinite(rate) ? rate : MAX_PARTICLE_EMISSION;
  return Math.max(1, Math.min(Math.round(r), MAX_PARTICLE_EMISSION));
}

/**
 * Checks whether adding billboards would exceed MAX_BILLBOARDS_PER_SCENE.
 *
 * @param {number} current
 * @param {number} [adding=0]
 * @returns {boolean}
 */
export function billboardBudgetExceeded(current, adding = 0) {
  const cur = Number.isFinite(current) ? current : 0;
  const add = Number.isFinite(adding) ? adding : 0;
  return cur + add > MAX_BILLBOARDS_PER_SCENE;
}
