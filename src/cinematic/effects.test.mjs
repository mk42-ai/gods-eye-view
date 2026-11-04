import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createEffects } from './effects.js';
import { createGeoSceneContext } from './geoSceneContext.js';

function createMockViewer() {
  const addedPrimitives = [];
  const removedPrimitives = [];

  return {
    scene: {
      primitives: {
        add(p) {
          addedPrimitives.push(p);
          return p;
        },
        remove(p) {
          removedPrimitives.push(p);
        },
      },
      fog: {
        enabled: false,
        density: 0.0002,
      },
      light: {
        intensity: 1.0,
      },
    },
    addedPrimitives,
    removedPrimitives,
  };
}

test('smoke effect creates particle system with bounded parameters', () => {
  const viewer = createMockViewer();
  const context = createGeoSceneContext({ origin: { lat: 25, lon: 55 } });
  const events = [];

  const effects = createEffects({
    viewer,
    context,
    onEvent: (name, data) => events.push({ name, data }),
  });

  const id = effects.add({
    id: 'eff-smoke-1',
    type: 'smoke',
    position: { eastM: 10, northM: 10 },
    intensity: 0.8,
  });

  assert.equal(id, 'eff-smoke-1');
  assert.equal(viewer.addedPrimitives.length, 1);
  const ps = viewer.addedPrimitives[0];
  assert.ok(ps instanceof Cesium.ParticleSystem);
  assert.ok(ps.emissionRate <= 40);
  assert.ok(ps.lifetime <= 6);

  assert.equal(events[0].name, 'asset.loading');
  assert.equal(events[1].name, 'asset.ready');

  effects.remove('eff-smoke-1');
  assert.equal(viewer.removedPrimitives.length, 1);
  assert.equal(effects.count(), 0);
});

test('emergency_lights alternates billboard color on tick', () => {
  const viewer = createMockViewer();
  const effects = createEffects({ viewer });

  const mockEntity = {
    id: 'police-car-1',
    billboard: {
      color: Cesium.Color.WHITE,
    },
  };

  effects.add(
    {
      id: 'eff-lights-1',
      type: 'emergency_lights',
      entityId: 'police-car-1',
    },
    null,
    (id) => (id === 'police-car-1' ? mockEntity : null),
  );

  // Tick at t = 0.0 sec (phase 0 -> red)
  effects.tick(0.0);
  assert.equal(mockEntity.billboard.color.red > 0.8, true);

  // Tick at t = 0.3 sec (phase 1 -> blue)
  effects.tick(0.3);
  assert.equal(mockEntity.billboard.color.blue > 0.8, true);

  // Remove restores original color
  effects.remove('eff-lights-1');
  assert.equal(mockEntity.billboard.color.red, 1.0);
  assert.equal(mockEntity.billboard.color.green, 1.0);
  assert.equal(mockEntity.billboard.color.blue, 1.0);
});

test('haze tweaks fog density and restores on remove', () => {
  const viewer = createMockViewer();
  const effects = createEffects({ viewer });

  assert.equal(viewer.scene.fog.enabled, false);
  const origDensity = viewer.scene.fog.density;

  effects.add({
    id: 'eff-haze-1',
    type: 'haze',
    intensity: 0.7,
  });

  assert.equal(viewer.scene.fog.enabled, true);
  assert.ok(viewer.scene.fog.density > origDensity);

  effects.remove('eff-haze-1');
  assert.equal(viewer.scene.fog.enabled, false);
  assert.equal(viewer.scene.fog.density, origDensity);
});

test('lighting_transition sets intensity and restores on remove', () => {
  const viewer = createMockViewer();
  const effects = createEffects({ viewer });

  effects.add({
    id: 'eff-light-1',
    type: 'lighting_transition',
    intensity: 0.9,
  });

  assert.equal(viewer.scene.light.intensity, 1.8);

  effects.remove('eff-light-1');
  assert.equal(viewer.scene.light.intensity, 1.0);
});

test('highlight_pulse pulses billboard scale on tick and restores on remove', () => {
  const viewer = createMockViewer();
  const effects = createEffects({ viewer });

  const mockEntity = {
    id: 'runner-1',
    billboard: {
      scale: 1.0,
    },
  };

  effects.add(
    {
      id: 'eff-pulse-1',
      type: 'highlight_pulse',
      entityId: 'runner-1',
    },
    null,
    (id) => (id === 'runner-1' ? mockEntity : null),
  );

  effects.tick(0.5);
  assert.notEqual(mockEntity.billboard.scale, 1.0);

  effects.remove('eff-pulse-1');
  assert.equal(mockEntity.billboard.scale, 1.0);
});

test('clear removes all effects cleanly', () => {
  const viewer = createMockViewer();
  const context = createGeoSceneContext({ origin: { lat: 25, lon: 55 } });
  const effects = createEffects({ viewer, context });

  effects.add({ id: 'eff-1', type: 'smoke' });
  effects.add({ id: 'eff-2', type: 'haze' });
  assert.equal(effects.count(), 2);

  effects.clear();
  assert.equal(effects.count(), 0);
  assert.equal(viewer.removedPrimitives.length, 1);
});

test('effects survive minimal fake viewer without scene/primitives', () => {
  const effects = createEffects({ viewer: {} });
  assert.doesNotThrow(() => {
    effects.add({ id: 'eff-smoke', type: 'smoke' });
    effects.tick(1.0);
    effects.remove('eff-smoke');
  });
});
