import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAoiScenePolicy } from './aoiScenePolicy.js';
import { getUaeAoiIndex } from '../aoi/uaeInterest.js';
import {
  incidentSceneToProjectScene,
  shotTimings,
  isIncidentScene,
} from './incidentScenes.js';
import { createDefaultProject } from './project.js';
import { parseSceneDocument } from '../director/document.js';
import { buildScenes, normalizeIncident } from '../incidents/model.js';
import { SceneDirector } from './director.js';

const policy = createAoiScenePolicy(getUaeAoiIndex());

describe('AOI scene policy', () => {
  test('bundled demo scenes: Nepal Flood + globals hidden with a reason, nothing deleted', () => {
    const project = createDefaultProject();
    const { visible, hidden } = policy.partition(project.scenes);
    const hiddenTitles = hidden.map((h) => h.title);
    assert.ok(
      hiddenTitles.includes('Nepal Flood Incident'),
      hiddenTitles.join(','),
    );
    assert.ok(hiddenTitles.includes('Global Flights Radar'));
    const nepal = hidden.find((h) => h.title === 'Nepal Flood Incident');
    assert.match(nepal.reason, /^OUT_OF_AOI: nearest AOI .+ at \d+(\.\d)? km$/);
    assert.equal(visible.length + hidden.length, project.scenes.length);
    assert.equal(
      project.scenes.length,
      createDefaultProject().scenes.length,
      'source untouched',
    );
  });
  test('an IMP-08 style Iran → Hormuz → Dubai reconstruction stays visible', () => {
    const scene = {
      id: 'imp-08-warda',
      title: 'IMP-08 Warda Apartments strike reconstruction',
      shots: [
        { camera: { lat: 27.18, lon: 56.29, alt: 120000 } },
        { camera: { lat: 26.45, lon: 56.2, alt: 90000 } },
        { camera: { lat: 25.6, lon: 55.3, alt: 60000 } },
        { camera: { lat: 25.25, lon: 55.35, alt: 2000 } },
      ],
    };
    const verdict = policy.classify(scene);
    assert.equal(verdict.visible, true);
    assert.ok(verdict.aoi_ids.includes('strait-of-hormuz'));
  });
  test('a global pull-back shot does not count as out-of-AOI evidence', () => {
    const scene = {
      id: 'x',
      title: 'x',
      shots: [
        { camera: { lat: 20, lon: -30, alt: 19_000_000 } },
        { camera: { lat: 14.8, lon: 42.95, alt: 50000 } },
      ],
    };
    assert.equal(policy.classify(scene).visible, true);
  });
  test('allowlisted ids bypass the geometry check', () => {
    const p = createAoiScenePolicy(getUaeAoiIndex(), {
      alwaysVisibleIds: ['keep-me'],
    });
    assert.equal(
      p.classify({
        id: 'keep-me',
        title: 'x',
        shots: [{ camera: { lat: 48.85, lon: 2.35, alt: 1000 } }],
      }).visible,
      true,
    );
  });
});

describe('incident scene adapter', () => {
  const incident = normalizeIncident(
    {
      id: 'inc-hodeidah',
      title: 'Drone strike reported near Hodeidah port',
      category: 'missile_drone_strike',
      lat: 14.7979,
      lon: 42.9545,
      time_utc: '2026-10-22T06:00:00Z',
      sources: [
        {
          url: 'https://example.org/report',
          published_at: '2026-10-22T06:30:00Z',
        },
      ],
    },
    { membership: getUaeAoiIndex().membership },
  );
  const [incidentScene] = buildScenes([incident]);

  test('keyframes become shots with altitude from zoom and bounded timings', () => {
    const scene = incidentSceneToProjectScene(incidentScene);
    assert.equal(scene.shots.length, 3);
    assert.ok(
      scene.shots[1].camera.alt < scene.shots[0].camera.alt,
      'overhead lower than approach',
    );
    assert.ok(scene.shots.every((s) => s.durationSec >= 0.2 && s.holdSec >= 0));
    const total = scene.shots.reduce(
      (s, x) => s + x.durationSec + x.holdSec,
      0,
    );
    assert.ok(total > 10 && total < 30, String(total));
    assert.ok(isIncidentScene(scene));
    assert.deepEqual(scene.incident.incident_ids, ['inc-hodeidah']);
    assert.equal(
      scene.incident.markers[0].icon,
      '/icons/incidents/missile_drone_strike.png',
    );
  });
  test('shotTimings sums to roughly the scene length', () => {
    const t = shotTimings([{ time: 0 }, { time: 0.45 }, { time: 1 }], 18);
    const sum = t.reduce((s, x) => s + x.durationSec + x.holdSec, 0);
    assert.ok(Math.abs(sum - 18) < 3, String(sum));
  });
  test('the resulting project document validates (incident block is schema-checked)', () => {
    const project = createDefaultProject();
    project.scenes.unshift(incidentSceneToProjectScene(incidentScene));
    assert.doesNotThrow(() => parseSceneDocument(JSON.stringify(project)));
    const bad = incidentSceneToProjectScene(incidentScene);
    bad.incident.markers[0].lat = 123;
    project.scenes[0] = bad;
    assert.throws(
      () => parseSceneDocument(JSON.stringify(project)),
      /markers\[0\]\.lat/,
    );
  });
  test('the incident scene itself is inside the AOI', () => {
    assert.equal(
      policy.classify(incidentSceneToProjectScene(incidentScene)).visible,
      true,
    );
  });
});

describe('SceneDirector with the AOI policy', () => {
  function makeDirector() {
    const saved = [];
    const originalLocalStorage = globalThis.localStorage;
    const originalDocument = globalThis.document;
    globalThis.localStorage = {
      getItem: () => null,
      setItem: (k, v) => saved.push(v),
      removeItem() {},
    };
    const noopClassList = {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    };
    globalThis.document = {
      getElementById: () => null,
      createElement: () => ({
        style: {},
        classList: noopClassList,
        appendChild() {},
        addEventListener() {},
        setAttribute() {},
        remove() {},
      }),
      body: { classList: noopClassList, appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
    };
    const viewer = {
      camera: { cancelFlight() {}, setView() {}, flyTo() {} },
      scene: { canvas: null },
      trackedEntity: null,
      trackedEntityChanged: { addEventListener: () => () => {} },
      entities: { add() {}, remove() {} },
    };
    const styleManager = {
      subscribeCameraHandoff: () => () => {},
      getCameraState: () => null,
    };
    const dataManager = {
      getAll: () => [],
      getLayerParams: () => null,
      layers: new Map(),
      subscribeVisibilityRequests: () => () => {},
    };
    const director = new SceneDirector(viewer, styleManager, dataManager, {
      aoiPolicy: policy,
    });
    const restore = () => {
      director.destroy();
      globalThis.localStorage = originalLocalStorage;
      globalThis.document = originalDocument;
    };
    return { director, saved, restore };
  }

  test('panel scene list excludes Nepal Flood but the saved document keeps it', () => {
    const { director, saved, restore } = makeDirector();
    try {
      const titles = director.listScenes().map((s) => s.title);
      assert.ok(!titles.includes('Nepal Flood Incident'), titles.join(', '));
      assert.ok(
        director
          .hiddenScenes()
          .some(
            (h) =>
              h.title === 'Nepal Flood Incident' && /OUT_OF_AOI/.test(h.reason),
          ),
      );
      director._saveProject();
      const persisted = JSON.parse(saved.at(-1));
      assert.ok(
        persisted.scenes.some((s) => s.title === 'Nepal Flood Incident'),
        'kept in storage',
      );
      assert.doesNotThrow(() => parseSceneDocument(saved.at(-1)));
    } finally {
      restore();
    }
  });
  test('addIncidentScene accepts an AOI scene, rejects Paris unless override', () => {
    const { director, restore } = makeDirector();
    try {
      const inAoi = buildScenes([
        normalizeIncident({
          id: 'a',
          title: 'Hodeidah strike',
          category: 'missile_drone_strike',
          lat: 14.8,
          lon: 42.95,
        }),
      ])[0];
      const paris = buildScenes([
        normalizeIncident({
          id: 'b',
          title: 'Paris blast',
          category: 'ied_terror',
          lat: 48.8566,
          lon: 2.3522,
        }),
      ])[0];
      const ok = director.addIncidentScene(inAoi);
      assert.equal(ok.added, true);
      assert.equal(director.listScenes()[0].title, 'Hodeidah strike');
      assert.equal(director._selectedSceneId, ok.sceneId);
      const rejected = director.addIncidentScene(paris);
      assert.equal(rejected.added, false);
      assert.match(rejected.reason, /^OUT_OF_AOI/);
      const forced = director.addIncidentScene(paris, { override: true });
      assert.equal(forced.added, true);
      assert.equal(director.listIncidentScenes().length, 2);
    } finally {
      restore();
    }
  });
  test('syncIncidentScenes replaces incident scenes and keeps authored ones', () => {
    const { director, restore } = makeDirector();
    try {
      const before = director.listScenes().length;
      const scenes = buildScenes([
        normalizeIncident({
          id: 'a',
          title: 'A',
          category: 'thermal_hotspot',
          lat: 24.5,
          lon: 56.6,
        }),
        normalizeIncident({
          id: 'b',
          title: 'B',
          category: 'thermal_hotspot',
          lat: 27.16,
          lon: 56.1,
        }),
      ]);
      director.syncIncidentScenes(scenes);
      assert.equal(director.listScenes().length, before + 2);
      director.syncIncidentScenes(scenes.slice(0, 1));
      assert.equal(director.listScenes().length, before + 1);
    } finally {
      restore();
    }
  });
});
