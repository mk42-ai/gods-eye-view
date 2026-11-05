import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BILLBOARDS_PER_SCENE,
  MAX_MEMBERS_PER_ENTITY,
  DENSITY_POLYGON_THRESHOLD,
  MAX_LABELS_VISIBLE,
  MAX_PARTICLE_SYSTEMS,
  MAX_PARTICLE_EMISSION,
  TILESET_CACHE_BYTES,
  TILESET_CACHE_OVERFLOW_BYTES,
  SOFTWARE_TILESET_CACHE_BYTES,
  memberBudget,
  shouldUseDensityPolygon,
  clampParticleEmission,
  billboardBudgetExceeded,
} from './renderBudget.js';

test('renderBudget constants match contract specifications', () => {
  assert.equal(MAX_BILLBOARDS_PER_SCENE, 600);
  assert.equal(MAX_MEMBERS_PER_ENTITY, 12);
  assert.equal(DENSITY_POLYGON_THRESHOLD, 12);
  assert.equal(MAX_LABELS_VISIBLE, 24);
  assert.equal(MAX_PARTICLE_SYSTEMS, 4);
  assert.equal(MAX_PARTICLE_EMISSION, 24);
  assert.equal(TILESET_CACHE_BYTES, 768 * 1024 * 1024);
  assert.equal(TILESET_CACHE_OVERFLOW_BYTES, 256 * 1024 * 1024);
  assert.equal(SOFTWARE_TILESET_CACHE_BYTES, 256 * 1024 * 1024);
});

test('memberBudget: clamps count to MAX_MEMBERS_PER_ENTITY and handles edge cases', () => {
  assert.equal(memberBudget(0), 0);
  assert.equal(memberBudget(1), 1);
  assert.equal(memberBudget(5), 5);
  assert.equal(memberBudget(12), 12);
  assert.equal(memberBudget(50), 12);
  assert.equal(memberBudget(500), 12);
  assert.equal(memberBudget(-5), 0);
  assert.equal(memberBudget(NaN), 0);
  assert.equal(memberBudget(null), 0);
});

test('shouldUseDensityPolygon: triggers only when count exceeds threshold', () => {
  assert.equal(shouldUseDensityPolygon(1), false);
  assert.equal(shouldUseDensityPolygon(10), false);
  assert.equal(shouldUseDensityPolygon(12), false);
  assert.equal(shouldUseDensityPolygon(13), true);
  assert.equal(shouldUseDensityPolygon(60), true);
  assert.equal(shouldUseDensityPolygon(null), false);
});

test('clampParticleEmission: clamps rate to [1, MAX_PARTICLE_EMISSION]', () => {
  assert.equal(clampParticleEmission(10), 10);
  assert.equal(clampParticleEmission(24), 24);
  assert.equal(clampParticleEmission(50), 24);
  assert.equal(clampParticleEmission(0), 1);
  assert.equal(clampParticleEmission(-10), 1);
  assert.equal(clampParticleEmission(undefined), 24);
});

test('billboardBudgetExceeded: checks sum against MAX_BILLBOARDS_PER_SCENE', () => {
  assert.equal(billboardBudgetExceeded(100, 200), false);
  assert.equal(billboardBudgetExceeded(600, 0), false);
  assert.equal(billboardBudgetExceeded(600, 1), true);
  assert.equal(billboardBudgetExceeded(550, 60), true);
  assert.equal(billboardBudgetExceeded(601), true);
});
