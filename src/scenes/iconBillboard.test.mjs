import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  iconBillboardGraphics,
  iconWithBackplate,
  iconFor,
  iconSizeFor,
  INLINE_SVG_GLYPHS,
} from './iconBillboard.js';

function createMockDoc() {
  const canvases = [];
  return {
    createElement(tag) {
      if (tag === 'canvas') {
        const drawCalls = [];
        const ctx = {
          saveCalls: 0,
          restoreCalls: 0,
          paths: 0,
          save() {
            this.saveCalls++;
          },
          restore() {
            this.restoreCalls++;
          },
          beginPath() {
            this.paths++;
          },
          arc(cx, cy, r) {
            this.lastArc = { cx, cy, r };
          },
          fill() {
            this.filled = true;
          },
          stroke() {
            this.stroked = true;
          },
          drawImage(...args) {
            drawCalls.push(args);
          },
        };
        const canvas = {
          tagName: 'CANVAS',
          width: 0,
          height: 0,
          getContext(t) {
            if (t === '2d') return ctx;
            return null;
          },
          _ctx: ctx,
          _drawCalls: drawCalls,
        };
        canvases.push(canvas);
        return canvas;
      }
      return { tagName: tag.toUpperCase() };
    },
    _canvases: canvases,
  };
}

test('iconBillboardGraphics returns valid Cesium BillboardGraphics options', () => {
  class MockNearFarScalar {
    constructor(near, nearVal, far, farVal) {
      this.near = near;
      this.nearValue = nearVal;
      this.far = far;
      this.farValue = farVal;
    }
  }

  const MockCesium = {
    NearFarScalar: MockNearFarScalar,
    HeightReference: { CLAMP_TO_GROUND: 1 },
    VerticalOrigin: { CENTER: 0 },
    Math: {
      toRadians(deg) {
        return (deg * Math.PI) / 180;
      },
    },
  };

  const bg = iconBillboardGraphics(MockCesium, {
    key: 'command_post',
    image: 'mock-canvas',
    sizePx: 44,
    heading: 90,
    rotate: true,
  });

  assert.equal(bg.image, 'mock-canvas');
  assert.equal(bg.width, 44);
  assert.equal(bg.height, 44);
  assert.equal(bg.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  assert.equal(bg.heightReference, 1);
  assert.equal(bg.verticalOrigin, 0);
  assert.ok(bg.scaleByDistance instanceof MockNearFarScalar);
  assert.equal(bg.scaleByDistance.near, 500);
  assert.equal(bg.scaleByDistance.nearValue, 1.0);
  assert.equal(bg.scaleByDistance.far, 50000);
  assert.equal(bg.scaleByDistance.farValue, 0.45);
  assert.ok(Math.abs(bg.rotation - Math.PI / 2) < 0.001);

  // Without rotate
  const bg2 = iconBillboardGraphics(MockCesium, {
    key: 'cone',
    sizePx: 28,
  });
  assert.equal(bg2.width, 28);
  assert.equal(bg2.height, 28);
  assert.equal(bg2.rotation, undefined);
});

test('iconWithBackplate creates cached navy halo canvas and preserves URL string if no canvas', () => {
  const doc = createMockDoc();
  const mockCanvasImage = doc.createElement('canvas');
  mockCanvasImage.width = 64;
  mockCanvasImage.height = 64;

  const result1 = iconWithBackplate(doc, mockCanvasImage, {
    key: 'police_unit',
    sizePx: 36,
  });
  assert.ok(result1);
  assert.equal(result1.tagName, 'CANVAS');
  assert.equal(result1.width, 36);
  assert.equal(result1.height, 36);
  assert.equal(result1._ctx.filled, true);
  assert.equal(result1._ctx.stroked, true);

  // Cache identity
  const result2 = iconWithBackplate(doc, mockCanvasImage, {
    key: 'police_unit',
    sizePx: 36,
  });
  assert.equal(result1, result2, 'must return cached canvas instance');

  // String URL returns unchanged when no canvas is available
  const headlessDoc = {
    createElement(t) {
      return null;
    },
  };
  const urlRes = iconWithBackplate(headlessDoc, '/scene-icons/png/cone.png', {
    sizePx: 28,
  });
  assert.equal(urlRes, '/scene-icons/png/cone.png');

  // But when canvas is available, it wraps the URL into a backplate canvas
  const canvasFromUrl = iconWithBackplate(doc, '/scene-icons/png/cone.png', {
    sizePx: 28,
  });
  assert.equal(canvasFromUrl.tagName, 'CANVAS');
  assert.equal(canvasFromUrl.width, 28);
});

test('INLINE_SVG_GLYPHS contains all required contract keys', () => {
  const requiredGlyphs = [
    'generic',
    'police_unit',
    'vehicle_police_car',
    'perimeter_unit',
    'person_police_officer',
    'barrier',
    'barrier_crowd',
    'screening_lane',
    'vehicle_ambulance',
    'medical_point',
    'vehicle_civilian_sedan',
    'civilian_sedan',
    'command_post',
    'staging_point',
    'checkpoint',
    'cordon_node',
    'crowd_zone',
    'crowd_spectators',
    'start_finish',
    'signage_road_closed',
    'road_closed',
    'cctv',
    'cctv_signal',
    'vessel_marine_patrol',
    'marine_patrol',
    'cone',
    'cone_cluster',
    'vehicle_police_motorcycle',
    'vehicle_city_bus',
  ];

  for (const k of requiredGlyphs) {
    assert.ok(INLINE_SVG_GLYPHS[k], `missing inline SVG glyph for ${k}`);
    assert.ok(
      INLINE_SVG_GLYPHS[k].startsWith('data:image/svg+xml'),
      `${k} must be data:image/svg+xml URL`,
    );
  }
});

test('iconSizeFor returns contract recommended pixel sizes', () => {
  assert.equal(iconSizeFor('command_post'), 44);
  assert.equal(iconSizeFor('staging_point'), 44);
  assert.equal(iconSizeFor('start_finish'), 44);
  assert.equal(iconSizeFor('medical_point'), 44);
  assert.equal(iconSizeFor('cone'), 28);
  assert.equal(iconSizeFor('cone_cluster'), 28);
  assert.equal(iconSizeFor('police_unit'), 36);
  assert.equal(iconSizeFor('generic'), 36);
});

test('iconFor resolves to atlas canvas when loaded, falls back to PNG URL', () => {
  const doc = createMockDoc();
  const mockAtlas = {
    isLoaded: () => true,
    imageFor: (k) => ({
      id: `sprite:${k}`,
      image: doc.createElement('canvas'),
      width: 128,
      height: 128,
    }),
  };

  const canvasRes = iconFor('command_post', {
    atlas: mockAtlas,
    sizePx: 44,
    doc,
  });
  assert.ok(canvasRes && canvasRes.tagName === 'CANVAS');

  // Without atlas
  const pngRes = iconFor('command_post', { atlas: null });
  assert.equal(pngRes, '/scene-icons/png/command_post@2x.png');
});
