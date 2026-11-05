/** Pure local contracts. This does NOT launch or drive a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { ShareLinkManager } from '../src/sharelink.js';
import { decodeLayerStateParams } from '../src/data/layerState.js';

const keys =
  'v lat lon alt heading pitch roll style bloom sharpen bi bv si hud hv dm dd da kf ko cr sc scf map l lo ui'.split(
    ' ',
  );
// Read the fixture as TEXT. Importing this older QA file would launch Puppeteer.
const source = readFileSync(
  new URL('./qa-scene-videos.mjs', import.meta.url),
  'utf8',
);
const hash = source.match(
  /export const APPROVED_HASH\s*=\s*['"]([^'"]+)['"]/,
)[1];
const fixture = new URLSearchParams(hash.slice(1));

test('approved fixture retains exactly 27 keys including empty l and roll=360', () => {
  assert.deepEqual([...fixture.keys()].sort(), [...keys].sort());
  assert.equal(fixture.size, 27);
  assert.equal(fixture.get('l'), '');
  assert.equal(fixture.get('roll'), '360');
});

test('pure parse → state setters → serialize roundtrip preserves ALL 27 approved values', () => {
  const priorWindow = globalThis.window;
  let manager;
  try {
    globalThis.window = { location: { hash } };
    const deg = (key) => Number(fixture.get(key));
    const viewer = {
      camera: {
        positionCartographic: Cesium.Cartographic.fromDegrees(
          deg('lon'),
          deg('lat'),
          deg('alt'),
        ),
        heading: Cesium.Math.toRadians(deg('heading')),
        pitch: Cesium.Math.toRadians(deg('pitch')),
        roll: Cesium.Math.toRadians(deg('roll')),
        changed: { addEventListener: () => () => {} },
        moveEnd: { addEventListener: () => () => {} },
      },
    };
    manager = new ShareLinkManager(viewer);
    manager._scheduleUpdate = () => {}; // no timer/history or fake browser driver
    const state = manager.parseInitialHash();
    manager.onStyleChange(state.style);
    manager.onToggleChange(state.bloom, state.sharpen, {
      ...state,
      celestialRingEnabled: state.celestialRing,
    });
    manager.setLayerStateProvider(() => decodeLayerStateParams(fixture));
    manager.setPanelStateProvider(() => state.panelState);
    const output = manager._buildHashParams();
    assert.equal(output.size, 27);
    for (const key of keys)
      assert.equal(output.get(key), fixture.get(key), key);
    assert.equal(state.bloomIntensity, 50);
    assert.equal(state.bloomVersion, 2);
    assert.equal(state.sharpenIntensity, 65);
    assert.equal(state.scopeFeatherPct, 11);
    assert.equal(state.mapStack, 'esri-imagery');
  } finally {
    manager?.destroy();
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('independent evidence tool is offline and cannot invoke a browser stack', () => {
  const tool = readFileSync(
    new URL('./qa-geopatch-evidence.py', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    tool,
    /puppeteer|playwright|selenium|Page\.startScreencast|websocket\.connect|requests\.(get|post)\(/i,
  );
  assert.match(tool, /path\.open\('x'\)/); // output is never overwritten
  assert.match(tool, /candidate\['validationHistory'\]\[:-1\]/);
});
