import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetRegistry } from './assetRegistry.js';

test('resolve known sprite and model assets', () => {
  const registry = createAssetRegistry();

  const spriteRes = registry.resolve('sprite.cordon_node');
  assert.equal(spriteRes.substituted, false);
  assert.equal(spriteRes.asset.id, 'sprite.cordon_node');

  const modelRes = registry.resolve('model.cesium.milk_truck');
  assert.equal(modelRes.substituted, false);
  assert.equal(modelRes.asset.id, 'model.cesium.milk_truck');
});

test('resolve unknown asset falls back and logs substitution', () => {
  const registry = createAssetRegistry();

  const res = registry.resolve('unknown.nonexistent.item');
  assert.equal(res.substituted, true);
  assert.equal(res.asset.id, 'sprite.generic');

  const subs = registry.substitutions();
  assert.ok(subs.length >= 1);
  assert.equal(subs[0].requested, 'unknown.nonexistent.item');
  assert.equal(subs[0].resolved, 'sprite.generic');
});

test('billboardFor returns sprite URL with dimensions and handles model fallback', () => {
  const registry = createAssetRegistry();

  const bb1 = registry.billboardFor('sprite.vehicle.police_car');
  assert.ok(bb1.image.includes('/scene-icons/png/vehicle_police_car@2x.png'));
  assert.equal(bb1.width, 32);
  assert.equal(bb1.height, 32);
  assert.equal(bb1.substituted, false);

  // When document exists, returns width/height 36 and backplated canvas
  const mockDoc = {
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          tagName: 'CANVAS',
          width: 0,
          height: 0,
          getContext: () => ({
            save() {},
            restore() {},
            beginPath() {},
            arc() {},
            fill() {},
            stroke() {},
            drawImage() {},
          }),
        };
      }
      return {};
    },
  };
  const bbDoc = registry.billboardFor('sprite.vehicle.police_car', {
    document: mockDoc,
  });
  assert.equal(bbDoc.width, 36);
  assert.equal(bbDoc.height, 36);
  // Before the PNG is decoded the image is a CallbackProperty that yields the
  // URL (Cesium re-reads it each tick and flips to the backplated canvas
  // once decoded); in a DOM-less test the URL stays.
  const now = bbDoc.image?.getValue ? bbDoc.image.getValue() : bbDoc.image;
  assert.ok(
    typeof now === 'string' || now?.tagName === 'CANVAS',
    'URL first, canvas once decoded',
  );

  // Model asked as billboard falls back to its sprite fallback
  const bb2 = registry.billboardFor('model.cesium.milk_truck');
  assert.ok(bb2.image.includes('vehicle_civilian_sedan'));
  assert.equal(bb2.substituted, true);
});

test('modelFor returns uri for models and null for sprites', () => {
  const registry = createAssetRegistry();

  const m1 = registry.modelFor('model.cesium.milk_truck');
  assert.ok(m1);
  assert.ok(m1.uri.includes('models/cinematic/CesiumMilkTruck.glb'));

  const m2 = registry.modelFor('sprite.barrier');
  assert.equal(m2, null);
});

test('preload succeeds when fetch returns 200 and emits events', async () => {
  const events = [];
  const mockFetch = async () => ({ ok: true, status: 200 });

  const registry = createAssetRegistry({
    fetchImpl: mockFetch,
    onEvent: (name, data) => events.push({ name, data }),
  });

  const res = await registry.preload(['sprite.cordon_node']);
  assert.deepEqual(res.ready, ['sprite.cordon_node']);
  assert.deepEqual(res.failed, []);

  assert.equal(events[0].name, 'asset.loading');
  assert.equal(events[0].data.assetId, 'sprite.cordon_node');
  assert.equal(events[1].name, 'asset.ready');
  assert.equal(events[1].data.assetId, 'sprite.cordon_node');
  assert.equal(events[1].data.substituted, false);
});

test('preload handles fetch failure by marking unavailable and using fallback', async () => {
  const events = [];
  const mockFetch = async () => ({ ok: false, status: 404 });

  const registry = createAssetRegistry({
    fetchImpl: mockFetch,
    onEvent: (name, data) => events.push({ name, data }),
  });

  const res = await registry.preload(['model.cesium.milk_truck']);
  assert.deepEqual(res.ready, []);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].id, 'model.cesium.milk_truck');

  assert.ok(registry.isUnavailable('model.cesium.milk_truck'));

  // Next resolve should use fallback
  const nextRes = registry.resolve('model.cesium.milk_truck');
  assert.equal(nextRes.substituted, true);
  assert.equal(nextRes.asset.id, 'sprite.vehicle.civilian_sedan');
});

test('markUnavailable immediately triggers fallback ready event', () => {
  const events = [];
  const registry = createAssetRegistry({
    onEvent: (name, data) => events.push({ name, data }),
  });

  registry.markUnavailable('model.cesium.air', 'glb_parse_failed');
  assert.ok(registry.isUnavailable('model.cesium.air'));

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'asset.ready');
  assert.equal(events[0].data.assetId, 'model.cesium.air');
  assert.equal(events[0].data.substituted, true);
  assert.equal(events[0].data.resolvedId, 'sprite.aircraft.fixed_wing');
});
