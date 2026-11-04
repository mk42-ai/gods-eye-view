import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpriteAtlas } from './spriteAtlas.js';

function createMockDocument() {
  const canvases = [];
  return {
    createElement(tag) {
      if (tag === 'canvas') {
        const drawCalls = [];
        const ctx = {
          shadowColor: 'transparent',
          shadowBlur: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          save() {},
          restore() {},
          drawImage(...args) {
            drawCalls.push({
              args,
              shadowColor: this.shadowColor,
              shadowBlur: this.shadowBlur,
            });
          },
        };
        const canvas = {
          tagName: 'CANVAS',
          width: 0,
          height: 0,
          getContext(type) {
            if (type === '2d') return ctx;
            return null;
          },
          _drawCalls: drawCalls,
          _ctx: ctx,
        };
        canvases.push(canvas);
        return canvas;
      }
      if (tag === 'img') {
        const img = {
          tagName: 'IMG',
          src: '',
          naturalWidth: 2048,
          naturalHeight: 384,
          complete: false,
          onload: null,
          onerror: null,
        };
        return img;
      }
      return { tagName: tag.toUpperCase() };
    },
    _canvases: canvases,
  };
}

const mockManifest = {
  version: 5,
  generatedAt: new Date().toISOString(),
  elementTypeIcons: {
    checkpoint: 'checkpoint',
    inner_cordon: 'cordon_node',
  },
  keys: [
    {
      key: 'cone',
      png: 'png/cone.png',
      png2x: 'png/cone@2x.png',
      sprite: { x: 0, y: 0, width: 64, height: 64 },
      sourceFile: 'tools/scene-icons/sources/cone.png',
      sha256: 'abc123',
    },
    {
      key: 'generic',
      png: 'png/generic.png',
      png2x: 'png/generic@2x.png',
      sprite: { x: 64, y: 0, width: 64, height: 64 },
      sourceFile: 'generated:generic',
      sha256: 'def456',
    },
    {
      key: 'checkpoint',
      png: 'png/checkpoint.png',
      png2x: 'png/checkpoint@2x.png',
      sprite: { x: 128, y: 0, width: 64, height: 64 },
      sourceFile: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
      sha256: 'ghi789',
    },
  ],
};

test('URL fallback before load() resolves', () => {
  const doc = createMockDocument();
  const atlas = createSpriteAtlas({ document: doc, baseUrl: '/scene-icons/' });

  assert.equal(atlas.isLoaded(), false);
  const entry = atlas.imageFor('cone', { scale: 2 });
  assert.equal(entry.id, 'gev-sprite:cone@2');
  assert.equal(entry.image, '/scene-icons/png/cone@2x.png');
  assert.equal(entry.width, 128);
  assert.equal(entry.height, 128);

  const entry1x = atlas.imageFor('cone', { scale: 1 });
  assert.equal(entry1x.id, 'gev-sprite:cone@1');
  assert.equal(entry1x.image, '/scene-icons/png/cone.png');
  assert.equal(entry1x.width, 64);
  assert.equal(entry1x.height, 64);
});

test('loads manifest and sprite image, slices into canvas, preserves cache identity, and bakes contrast halo', async () => {
  const doc = createMockDocument();

  // Stub global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('manifest.json')) {
      return {
        ok: true,
        json: async () => mockManifest,
      };
    }
    return { ok: false, status: 404 };
  };

  // Stub Image constructor
  const originalImage = globalThis.Image;
  globalThis.Image = class MockImage {
    constructor() {
      this.naturalWidth = 2048;
      this.naturalHeight = 384;
      this.complete = false;
      this.onload = null;
      setTimeout(() => {
        this.complete = true;
        this.onload?.();
      }, 0);
    }
  };

  try {
    const atlas = createSpriteAtlas({
      document: doc,
      baseUrl: '/scene-icons/',
    });
    await atlas.load();

    assert.equal(atlas.isLoaded(), true);
    assert.equal(atlas.has('cone'), true);
    assert.equal(atlas.has('checkpoint'), true);
    assert.equal(atlas.has('nonexistent'), false);
    assert.deepEqual(
      atlas.keys().sort(),
      ['checkpoint', 'cone', 'generic'].sort(),
    );

    // 1. Slicing into canvas
    const entry1 = atlas.imageFor('cone', { scale: 2 });
    assert.equal(entry1.id, 'gev-sprite:cone@2');
    assert.ok(entry1.image && typeof entry1.image === 'object');
    assert.equal(entry1.image.tagName, 'CANVAS');
    assert.equal(entry1.width, 128);
    assert.equal(entry1.height, 128);

    // Verify contrast halo was painted with shadowColor = #0B1220
    const canvas = entry1.image;
    assert.ok(
      canvas._drawCalls.length >= 2,
      'Should draw halo shadow and foreground sprite',
    );
    const haloCall = canvas._drawCalls[0];
    assert.equal(haloCall.shadowColor, '#0B1220');
    assert.ok(haloCall.shadowBlur > 0, 'Halo shadowBlur must be > 0');

    // 2. Cache identity: subsequent calls return the exact same object
    const entry2 = atlas.imageFor('cone', { scale: 2 });
    assert.equal(
      entry1,
      entry2,
      'Cache identity: must return exact same object reference',
    );
    assert.equal(
      entry1.image,
      entry2.image,
      'Canvas instance must be identical',
    );

    // 3. Unknown key falls back to "generic"
    const unknown = atlas.imageFor('unknown_key_xyz', { scale: 2 });
    assert.equal(unknown.id, 'gev-sprite:generic@2');
    assert.ok(unknown.image);
    assert.equal(unknown.image.tagName, 'CANVAS');

    const unknownAgain = atlas.imageFor('unknown_key_xyz', { scale: 2 });
    assert.equal(unknown, unknownAgain, 'Cache identity on fallback generic');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Image = originalImage;
  }
});
