import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSceneShare,
  decodeSceneShare,
  sceneFromFallback,
} from './share.js';
import { createScene } from './models.js';

describe('share encoding and decoding', () => {
  it('round-trips full scene share parameters', () => {
    const scene = createScene({
      id: 's_abc123',
      prompt: 'drone strike in Hodeidah',
      kind: 'incident',
      tRef: '2026-10-23T12:00:00.000Z',
      camera: {
        lat: 14.7978,
        lon: 42.9545,
        alt: 12000,
        heading: 45,
        pitch: -50,
        roll: 0,
      },
      route: {
        approachBearing: 135,
      },
    });

    const params = encodeSceneShare(new URLSearchParams(), scene);
    assert.strictEqual(params.get('sc'), 's_abc123');
    assert.strictEqual(params.get('fv'), '1');
    assert.strictEqual(params.get('fk'), 'drone strike in Hodeidah');
    assert.strictEqual(params.get('fm'), 'incident');
    assert.strictEqual(params.get('fs'), '2026-10-23T12:00:00.000Z');
    assert.strictEqual(params.get('gr'), '135');
    assert.strictEqual(params.get('lat'), '14.7978');
    assert.strictEqual(params.get('lon'), '42.9545');

    const decoded = decodeSceneShare(params);
    assert.strictEqual(decoded.sceneId, 's_abc123');
    assert.ok(decoded.fallback);
    assert.strictEqual(decoded.fallback.keywords, 'drone strike in Hodeidah');
    assert.strictEqual(decoded.fallback.mode, 'incident');
    assert.strictEqual(decoded.fallback.approachBearing, 135);
    assert.strictEqual(decoded.fallback.camera.lat, 14.7978);
    assert.strictEqual(decoded.fallback.camera.lon, 42.9545);
  });

  it('handles legacy sc=1 and sc=0 as non-sceneId scope toggle', () => {
    const legacy1 = decodeSceneShare(
      'sc=1&fv=1&fk=test-legacy&fm=live&lat=25.2&lon=55.3',
    );
    assert.strictEqual(
      legacy1.sceneId,
      null,
      'sc=1 must not be parsed as sceneId',
    );
    assert.ok(legacy1.fallback);
    assert.strictEqual(legacy1.fallback.keywords, 'test-legacy');

    const legacy0 = decodeSceneShare('#sc=0&fv=1&fk=test-legacy-0&lat=25&lon=55');
    assert.strictEqual(
      legacy0.sceneId,
      null,
      'sc=0 must not be parsed as sceneId',
    );
    assert.ok(legacy0.fallback);
    assert.strictEqual(legacy0.fallback.keywords, 'test-legacy-0');
  });

  it('sceneFromFallback reconstructs a minimal valid Scene with zero network', () => {
    const fallback = {
      mode: 'rebuild',
      keywords: 'car crash in Umm Suqeim',
      since: '2026-09-26T07:00:00.000Z',
      camera: {
        lat: 25.147,
        lon: 55.199,
        alt: 18000,
        heading: 90,
        pitch: 60,
        roll: 0,
      },
      approachBearing: 270,
    };

    const scene = sceneFromFallback(fallback);
    assert.ok(scene);
    assert.match(scene.id, /^s_/);
    assert.strictEqual(scene.kind, 'rebuild');
    assert.strictEqual(scene.prompt, 'car crash in Umm Suqeim');
    assert.strictEqual(scene.tRef, '2026-09-26T07:00:00.000Z');
    assert.strictEqual(scene.target.lat, 25.147);
    assert.strictEqual(scene.target.lon, 55.199);
    assert.strictEqual(scene.target.geocodeSource, 'prompt');
    assert.strictEqual(scene.route.approachBearing, 270);
    assert.strictEqual(scene.status, 'saved');
  });
});
