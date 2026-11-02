import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CINEMATIC_ASSETS,
  ASSET_IDS,
  SPRITE_KEYS,
  getAsset,
  getAssetByKey,
  isAssetId,
  ALIAS_MAP,
  CATEGORY_DEFAULTS,
  resolveAssetId,
  spriteUrl,
  modelUrl,
  ASSET_KIND,
} from './assetIds.js';

test('new sprite ids are registered in CINEMATIC_ASSETS', () => {
  const newExpected = [
    { id: 'sprite.medical_point', key: 'medical_point' },
    { id: 'sprite.marine_patrol', key: 'vessel_marine_patrol' },
    { id: 'sprite.vehicle_checkpoint', key: 'vehicle_checkpoint' },
    { id: 'sprite.screening_lane', key: 'screening_lane' },
    { id: 'sprite.road_closed', key: 'road_closed' },
    { id: 'sprite.civilian_sedan', key: 'civilian_sedan' },
  ];

  for (const { id, key } of newExpected) {
    assert.ok(isAssetId(id), `Expected ${id} to be registered`);
    const asset = getAsset(id);
    assert.ok(asset, `Asset ${id} must exist`);
    assert.equal(asset.kind, ASSET_KIND.SPRITE);
    assert.equal(asset.key, key, `Expected key for ${id} to be ${key}`);
    assert.ok(asset.label, `${id} must have a label`);
    assert.ok(asset.category, `${id} must have a category`);
  }
});

test('ALIAS_MAP contains all required contract keywords and resolves correctly', () => {
  const keywords = [
    'medical',
    'ambulance',
    'checkpoint',
    'vehicle_checkpoint',
    'screening',
    'queue',
    'marine',
    'boat',
    'patrol_boat',
    'officer',
    'foot_patrol',
    'escort',
    'motorcycle',
    'bus',
    'shuttle',
    'road_closed',
    'barricade',
    'start_finish',
    'gate',
    'sedan',
    'car',
    'traffic',
  ];

  for (const kw of keywords) {
    assert.ok(ALIAS_MAP[kw], `Expected ALIAS_MAP to contain keyword '${kw}'`);
    const resolved = resolveAssetId(kw);
    assert.ok(resolved.asset, `resolveAssetId('${kw}') must return an asset`);
    assert.ok(
      resolved.asset.id.startsWith('sprite.') ||
        resolved.asset.id.startsWith('model.'),
      `resolveAssetId('${kw}') must resolve to a valid registered id`,
    );
  }
});

test("spriteUrl maps scale >= 2 to '@2x' and never emits '@4x'", () => {
  const asset = getAsset('sprite.medical_point');
  assert.ok(asset, 'sprite.medical_point must exist');

  assert.equal(spriteUrl(asset, 1), '/scene-icons/png/medical_point.png');
  assert.equal(spriteUrl(asset, 2), '/scene-icons/png/medical_point@2x.png');
  assert.equal(spriteUrl(asset, 3), '/scene-icons/png/medical_point@2x.png');
  assert.equal(spriteUrl(asset, 4), '/scene-icons/png/medical_point@2x.png');
  assert.equal(spriteUrl(asset, 8), '/scene-icons/png/medical_point@2x.png');

  const modelAsset = getAsset('model.cesium.milk_truck');
  assert.equal(spriteUrl(modelAsset, 1), null);
  assert.equal(spriteUrl(null, 1), null);
});

test('modelUrl returns correct file path or null', () => {
  const modelAsset = getAsset('model.cesium.milk_truck');
  assert.equal(modelUrl(modelAsset), '/models/cinematic/CesiumMilkTruck.glb');
  const spriteAsset = getAsset('sprite.medical_point');
  assert.equal(modelUrl(spriteAsset), null);
  assert.equal(modelUrl(null), null);
});

test('resolveAssetId handles direct match, fallback, and unknown id', () => {
  const direct = resolveAssetId('sprite.medical_point');
  assert.equal(direct.asset.id, 'sprite.medical_point');
  assert.equal(direct.substituted, false);

  const unknown = resolveAssetId('completely_nonexistent_id_12345');
  assert.equal(unknown.asset.id, 'sprite.generic');
  assert.equal(unknown.substituted, true);

  const unavailable = new Set(['sprite.vehicle.police_car']);
  const withFallback = resolveAssetId('sprite.vehicle.police_car', {
    unavailable,
  });
  assert.equal(withFallback.asset.id, 'sprite.police_unit');
  assert.equal(withFallback.substituted, true);
});
