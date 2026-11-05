import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as Cesium from 'cesium';
import { ShareLinkManager } from './sharelink.js';
import { decodeLayerStateParams } from './data/layerState.js';

// The 27 approved hash keys as locked in scripts/qa-scene-videos.mjs
export const APPROVED_KEYS = Object.freeze([
  'v',
  'lat',
  'lon',
  'alt',
  'heading',
  'pitch',
  'roll',
  'style',
  'bloom',
  'sharpen',
  'bi',
  'bv',
  'si',
  'hud',
  'hv',
  'dm',
  'dd',
  'da',
  'kf',
  'ko',
  'cr',
  'sc',
  'scf',
  'map',
  'l',
  'lo',
  'ui',
]);

function readApprovedHashLiteral() {
  const filePath = path.resolve('scripts/qa-scene-videos.mjs');
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(
    /export const APPROVED_HASH =\s*['"`]([^'"`]+)['"`]/,
  );
  assert.ok(
    match,
    'Expected APPROVED_HASH string literal in scripts/qa-scene-videos.mjs',
  );
  return match[1];
}

function makeFakeViewer({
  lon = 55.27,
  lat = 25.19,
  alt = 712168,
  heading = 0,
  pitch = -0.959931, // -55 deg
  roll = 0,
} = {}) {
  return {
    camera: {
      positionCartographic: Cesium.Cartographic.fromDegrees(lon, lat, alt),
      heading,
      pitch,
      roll,
      changed: {
        addEventListener: () => () => {},
        removeEventListener: () => {},
      },
      moveEnd: {
        addEventListener: () => () => {},
        removeEventListener: () => {},
      },
    },
  };
}

test('sharelink: _buildHashParams produces EXACTLY the 27 approved keys from APPROVED_HASH', () => {
  const approvedHash = readApprovedHashLiteral();
  const approvedParams = new URLSearchParams(approvedHash.slice(1));
  const parsedApprovedKeys = Array.from(approvedParams.keys());

  // Verify the literal in scripts/qa-scene-videos.mjs itself has 27 keys
  assert.equal(
    parsedApprovedKeys.length,
    27,
    `APPROVED_HASH in scripts/qa-scene-videos.mjs must contain 27 keys, found ${parsedApprovedKeys.length}`,
  );
  assert.deepEqual(parsedApprovedKeys.sort(), [...APPROVED_KEYS].sort());

  const viewer = makeFakeViewer();
  const manager = new ShareLinkManager(viewer);

  // Configure layer state provider to output l and lo
  const layerState = decodeLayerStateParams(
    new URLSearchParams('v=2&l=&lo=f.e.1'),
  );
  manager.setLayerStateProvider(() => layerState);

  // Configure panel state provider to output ui
  manager.setPanelStateProvider(() => ({
    specs: [
      { id: 'control-panel', collapsed: true, pinned: false },
      { id: 'location-bar', collapsed: true, pinned: false },
      { id: 'data-panel', collapsed: true },
      { id: 'cctv-panel', collapsed: true },
      { id: 'radio-panel', collapsed: true },
      { id: 'scene-panel', collapsed: false },
      { id: 'global-context-panel', collapsed: true },
      { id: 'pp-toggles', collapsed: true },
      { id: 'param-slider-panel', collapsed: false },
    ],
  }));

  const generatedParams = manager._buildHashParams();
  assert.ok(
    generatedParams,
    'ShareLinkManager._buildHashParams must return URLSearchParams',
  );

  const generatedKeys = Array.from(generatedParams.keys());
  assert.equal(
    generatedKeys.length,
    27,
    `Generated params must contain exactly 27 keys, found ${generatedKeys.length}: ${generatedKeys.join(', ')}`,
  );

  // Fail on any missing or renamed key
  for (const expectedKey of APPROVED_KEYS) {
    assert.ok(
      generatedParams.has(expectedKey),
      `Missing required approved hash key: '${expectedKey}'`,
    );
  }

  for (const actualKey of generatedKeys) {
    assert.ok(
      APPROVED_KEYS.includes(actualKey),
      `Unexpected or renamed key in generated hash params: '${actualKey}'`,
    );
  }

  assert.deepEqual(generatedKeys.sort(), [...APPROVED_KEYS].sort());
});

test('sharelink: decoding APPROVED_HASH restores expected values', () => {
  const approvedHash = readApprovedHashLiteral();
  const approvedParams = new URLSearchParams(approvedHash.slice(1));

  assert.equal(approvedParams.get('v'), '2');
  assert.equal(approvedParams.get('lat'), '13.9425');
  assert.equal(approvedParams.get('lon'), '48.9231');
  assert.equal(approvedParams.get('alt'), '712168');
  assert.equal(approvedParams.get('heading'), '0');
  assert.equal(approvedParams.get('pitch'), '-55');
  assert.equal(approvedParams.get('roll'), '360');
  assert.equal(approvedParams.get('style'), 'normal');
  assert.equal(approvedParams.get('bloom'), '0');
  assert.equal(approvedParams.get('sharpen'), '0');
  assert.equal(approvedParams.get('hud'), 'tactical');
  assert.equal(approvedParams.get('hv'), '1');
  assert.equal(approvedParams.get('dm'), 'OFF');
  assert.equal(approvedParams.get('dd'), '50');
  assert.equal(approvedParams.get('da'), 'elastic');
  assert.equal(approvedParams.get('kf'), '7');
  assert.equal(approvedParams.get('ko'), '1');
  assert.equal(approvedParams.get('cr'), '0');
  assert.equal(approvedParams.get('sc'), '1');
  assert.equal(approvedParams.get('scf'), '11');
  assert.equal(approvedParams.get('map'), 'esri-imagery');
  assert.equal(approvedParams.get('l'), '');
  assert.equal(approvedParams.get('lo'), 'f.e.1');
  assert.equal(
    approvedParams.get('ui'),
    'c.c.1_c.p.0_l.c.1_l.p.0_d.c.1_v.c.1_r.c.1_s.c.0_g.c.1_p.c.1_m.c.0',
  );

  // Verify parseInitialHash decoder
  const origWindow = globalThis.window;
  try {
    globalThis.window = {
      location: {
        hash: approvedHash,
      },
    };
    const viewer = makeFakeViewer();
    const manager = new ShareLinkManager(viewer);
    const parsedState = manager.parseInitialHash();

    assert.ok(parsedState, 'parseInitialHash must return parsed state object');
    assert.equal(parsedState.lat, 13.9425);
    assert.equal(parsedState.lon, 48.9231);
    assert.equal(parsedState.alt, 712168);
    assert.equal(parsedState.heading, 0);
    assert.equal(parsedState.pitch, -55);
    assert.equal(parsedState.roll, 360);
    assert.equal(parsedState.style, 'normal');
    assert.equal(parsedState.bloom, false);
    assert.equal(parsedState.sharpen, false);
    assert.equal(parsedState.hudVariant, 'tactical');
    assert.equal(parsedState.hudVisible, true);
    assert.equal(parsedState.detectionMode, 'OFF');
    assert.equal(parsedState.detectionDensity, 50);
    assert.equal(parsedState.detectionAllocation, 'ELASTIC');
    assert.equal(parsedState.detectionFadePct, 7);
    assert.equal(parsedState.detectionOutsideOpacityPct, 1);
    assert.equal(parsedState.celestialRing, false);
    assert.equal(parsedState.scopeEnabled, true);
  } finally {
    globalThis.window = origWindow;
  }
});
