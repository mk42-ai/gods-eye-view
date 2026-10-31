/** Real map entities for authored geography and non-playable external context. */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';

export function createGeographicOverlay(
  viewer,
  {
    document: doc = globalThis.document,
    projectToWindow = Cesium.SceneTransforms.worldToWindowCoordinates,
  } = {},
) {
  const source = new Cesium.CustomDataSource('authored-geography');
  viewer.dataSources.add(source);
  const label = doc.createElement('div');
  label.id = 'scene-anchor-label';
  label.className = 'scene-anchor-label';
  label.hidden = true;
  label.setAttribute('aria-live', 'polite');
  doc.body.append(label);
  let anchor = null;
  let external = false;
  let destroyRequested = false;
  let activeScene = null;
  let timeSec = 0;
  let beatIndex = -1;
  const actors = [];
  const colorFor = (type) =>
    Cesium.Color.fromCssColorString(
      {
        person: '#e1bb91',
        runner: '#ff8a48',
        police: '#5091ea',
        organizer: '#bd8bea',
        vehicle: '#ccd5df',
        police_vehicle: '#5091ea',
        barrier: '#ffca59',
        start_line: '#f7fafc',
        finish_line: '#ffca59',
      }[type] || '#51d3c4',
    );
  const relativeHeight = Cesium.HeightReference.RELATIVE_TO_GROUND;
  function addActor(placement) {
    const human = ['person', 'runner', 'police', 'organizer'].includes(
      placement.type,
    );
    const vehicle = ['vehicle', 'police_vehicle'].includes(placement.type);
    const line = ['start_line', 'finish_line'].includes(placement.type);
    const color = colorFor(placement.type);
    const height = human ? 0.9 : vehicle ? 0.8 : line ? 0.04 : 0.55;
    const name = `Illustrative ${placement.label} (${placement.index + 1})`;
    const base = {
      id: `planned-${placement.id}`,
      name,
      position: Cesium.Cartesian3.fromDegrees(
        placement.lon,
        placement.lat,
        height,
      ),
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(placement.lon, placement.lat, height),
        new Cesium.HeadingPitchRoll(
          Cesium.Math.toRadians(placement.heading),
          0,
          0,
        ),
      ),
      description:
        'Illustrative authored staging, not an observed person, vehicle or confirmed incident.',
      properties: {
        illustrative: true,
        incidentConfirmed: false,
        entityId: placement.entityId,
        type: placement.type,
        actorIndex: placement.index,
      },
      label: {
        text: `ILLUSTRATIVE · ${placement.label}`,
        show: placement.index === 0,
        font: '11px sans-serif',
        fillColor: color,
        showBackground: true,
        backgroundColor:
          Cesium.Color.fromCssColorString('#10232d').withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -32),
        heightReference: relativeHeight,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
    if (human)
      base.cylinder = {
        length: 1.2,
        topRadius: 0.22,
        bottomRadius: 0.28,
        material: color,
        heightReference: relativeHeight,
      };
    else
      base.box = {
        dimensions: new Cesium.Cartesian3(
          ...(vehicle
            ? [2, 4.6, 1.5]
            : line
              ? [6, 0.6, 0.08]
              : [2.4, 0.35, 1.1]),
        ),
        material: color,
        heightReference: relativeHeight,
      };
    const body = source.entities.add(base);
    actors.push({
      entity: body,
      placement,
      color,
      graphic: human ? 'cylinder' : 'box',
      labelled: placement.index === 0,
    });
    if (human) {
      const head = source.entities.add({
        id: `planned-${placement.id}-head`,
        name,
        position: Cesium.Cartesian3.fromDegrees(
          placement.lon,
          placement.lat,
          1.68,
        ),
        ellipsoid: {
          radii: new Cesium.Cartesian3(0.19, 0.19, 0.22),
          material: color,
          heightReference: relativeHeight,
        },
        properties: {
          illustrative: true,
          incidentConfirmed: false,
          entityId: placement.entityId,
          part: 'head',
        },
      });
      actors.push({
        entity: head,
        placement,
        color,
        graphic: 'ellipsoid',
        labelled: false,
      });
    }
  }
  function setTime(seconds) {
    if (!activeScene || destroyRequested || !Number.isFinite(seconds)) return;
    timeSec = Math.max(0, Math.min(activeScene.durationSec, seconds));
    const beats = activeScene.plan?.beats || [];
    beatIndex = -1;
    for (let i = 0; i < beats.length; i++)
      if (beats[i].atSec <= timeSec) beatIndex = i;
    const beat = beats[beatIndex];
    const focus = new Set(beat?.entityIds || []);
    for (const actor of actors) {
      const active = !focus.size || focus.has(actor.placement.entityId);
      actor.entity[actor.graphic].material = actor.color.withAlpha(
        active ? 1 : 0.4,
      );
      if (actor.entity.label)
        actor.entity.label.show = actor.labelled && active;
    }
    if (activeScene.plan)
      label.textContent = `ILLUSTRATIVE STAGING · ${activeScene.anchor.name}${beat ? ` · ${beat.title}` : ''}`;
    label.dataset.beatIndex = String(beatIndex);
    label.dataset.timeSec = String(timeSec);
    viewer.scene.requestRender();
    governorRequestRender('authored-geography-timeline');
  }
  const update = () => {
    if (!anchor || destroyRequested) return;
    const p = projectToWindow(viewer.scene, anchor);
    if (
      !p ||
      p.x < 0 ||
      p.y < 0 ||
      p.x > viewer.canvas.clientWidth ||
      p.y > viewer.canvas.clientHeight
    ) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.style.left = `${Math.round(p.x)}px`;
    label.style.top = `${Math.round(p.y)}px`;
  };
  viewer.scene.postRender.addEventListener(update);

  function mark(point, title, isExternal = false) {
    source.entities.removeAll();
    actors.length = 0;
    external = isExternal;
    anchor = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 15);
    const color = Cesium.Color.fromCssColorString(
      isExternal ? '#f3b34c' : '#51d3c4',
    );
    source.entities.add({
      id: isExternal ? 'external-context-anchor' : 'geographic-scene-anchor',
      name: title,
      position: anchor,
      point: {
        pixelSize: isExternal ? 16 : 12,
        color: isExternal ? Cesium.Color.BLACK.withAlpha(0.1) : color,
        outlineColor: color,
        outlineWidth: isExternal ? 4 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: isExternal ? 'EXTERNAL' : title.toUpperCase(),
        font: 'bold 12px sans-serif',
        fillColor: color,
        showBackground: true,
        backgroundColor:
          Cesium.Color.fromCssColorString('#10232d').withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        contextOnly: isExternal,
        playable: !isExternal,
        illustrative: Boolean(activeScene?.plan),
        incidentConfirmed: false,
      },
    });
    label.className = isExternal
      ? 'scene-anchor-label incident-external-marker external'
      : 'scene-anchor-label geographic-scene-marker';
    label.textContent = isExternal ? `EXTERNAL · ${title}` : title;
    label.dataset.external = String(isExternal);
    label.dataset.lat = String(point.lat);
    label.dataset.lon = String(point.lon);
    label.hidden = false;
    viewer.scene.requestRender();
    governorRequestRender('authored-geography');
  }
  return {
    setScene(scene, { timeSec: initialTime = 0 } = {}) {
      activeScene = scene;
      mark(
        scene.anchor,
        scene.plan
          ? `ILLUSTRATIVE STAGING · ${scene.anchor.name}`
          : scene.anchor.name,
      );
      for (const placement of scene.placements || []) addActor(placement);
      source.entities.add({
        id: 'geographic-camera-orbit',
        name: 'Illustrative camera targets, not a road or movement track',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            scene.keyframes.flatMap((frame) => [frame.lon, frame.lat]),
          ),
          width: 2,
          clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#51d3c4').withAlpha(0.8),
            dashLength: 14,
          }),
        },
      });
      scene.keyframes.forEach((frame, index) =>
        source.entities.add({
          id: `geographic-camera-${index}`,
          name: `Camera view ${index + 1}: ${frame.label}`,
          position: Cesium.Cartesian3.fromDegrees(frame.lon, frame.lat, 10),
          point: {
            pixelSize: 6,
            color: Cesium.Color.fromCssColorString('#a1e7df'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
      setTime(initialTime);
      update();
    },
    setTime,
    setPlaybackPosition(position) {
      if (activeScene && Number.isFinite(position))
        setTime(Math.max(0, Math.min(1, position)) * activeScene.durationSec);
    },
    setExternal(candidate) {
      activeScene = null;
      timeSec = 0;
      beatIndex = -1;
      mark(candidate, candidate.name, true);
      update();
    },
    getState() {
      return {
        external,
        entities: source.entities.values.length,
        markerVisible: !label.hidden,
        illustrative: Boolean(activeScene?.plan),
        actorCount: activeScene?.placements?.length || 0,
        timeSec,
        beatIndex,
      };
    },
    destroy() {
      destroyRequested = true;
      viewer.scene.postRender.removeEventListener(update);
      label.remove();
      if (!viewer.isDestroyed?.()) viewer.dataSources.remove(source, true);
    },
  };
}
