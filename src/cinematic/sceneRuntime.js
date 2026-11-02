/**
 * Cesium Scene Runtime for Cinematic Scenes.
 * Manages the 'cinematic-scene' CustomDataSource, incremental diffing,
 * rAF batched writes, billboard/model rendering, velocity orientations,
 * route polylines & road closures, uncertainty styling, and snapshotting.
 */
import * as Cesium from 'cesium';
import { createGeoSceneContext } from './geoSceneContext.js';
import { createAssetRegistry } from './assetRegistry.js';
import { createEffects } from './effects.js';
import { governorRequestRender } from '../renderGovernor.js';

const DEFAULT_EPOCH = Cesium.JulianDate.fromIso8601('2026-01-01T00:00:00Z');

// Seeded PRNG (mulberry32) for deterministic multi-entity spreading
function createPrng(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  let a = h >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates the Cesium Scene Runtime.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Document} [options.document]
 * @param {object} [options.assets] AssetRegistry instance
 * @param {object} [options.playback] PlaybackController
 * @param {Function} [options.onEvent]
 * @param {object} [options.clock] Clock or {startTime: JulianDate}
 * @param {Function} [options.log]
 */
export function createSceneRuntime({
  viewer,
  document: doc = globalThis.document,
  assets: customAssets,
  playback,
  onEvent,
  clock: customClock,
  log = console.log,
} = {}) {
  const assets = customAssets || createAssetRegistry({ onEvent, log });
  const dataSource = new Cesium.CustomDataSource('cinematic-scene');

  if (viewer?.dataSources?.add) {
    viewer.dataSources.add(dataSource);
  }

  let context = null;
  let currentScene = null;
  let effects = null;

  let selectedId = null;
  const highlightedIds = new Map(); // id -> alertState

  // Entity cache: id -> { entity: Cesium.Entity, data: object, children: string[] }
  const entityMap = new Map();
  // Route cache: id -> { entity: Cesium.Entity, data: object, closureEntities: string[] }
  const routeMap = new Map();

  let queue = [];
  let flushScheduled = false;

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);

    schedule(() => {
      flushScheduled = false;
      flush();
    });
  }

  function flush() {
    while (queue.length > 0) {
      const op = queue.shift();
      try {
        op();
      } catch (err) {
        log?.(`[sceneRuntime] write error: ${err.message}`);
      }
    }
    governorRequestRender('cinematic-runtime-flush');
  }

  function getEpoch() {
    if (customClock?.startTime) return customClock.startTime;
    if (playback?.clock?.startTime) return playback.clock.startTime;
    if (currentScene?.provenance?.generatedAt) {
      try {
        return Cesium.JulianDate.fromIso8601(
          currentScene.provenance.generatedAt,
        );
      } catch {}
    }
    return DEFAULT_EPOCH;
  }

  function formatLabelText(entity) {
    let text = entity.label || entity.id;
    if (entity.hypothetical) {
      text = `HYPOTHETICAL · ${text}`;
    }
    if (entity.uncertainty === 'approximate') {
      text = `${text} ≈`;
    }
    if (text.length > 48) {
      text = `${text.slice(0, 47)}…`;
    }
    return text;
  }

  function getLabelColor(uncertainty) {
    switch (uncertainty) {
      case 'approximate':
        return Cesium.Color.fromCssColorString('#F59E0B'); // amber
      case 'verified':
        return Cesium.Color.fromCssColorString('#A7F3D0'); // mint
      case 'illustrative':
      default:
        return Cesium.Color.fromCssColorString('#14B8A6'); // teal
    }
  }

  function buildEntityPositionProperty(entity, epoch) {
    const behavior = entity.behavior;
    const pos = entity.position || { eastM: 0, northM: 0, heightM: 0 };
    const groundH = context?.groundHeightAt ? context.groundHeightAt(pos) : 0;
    const isAirOrEffect =
      entity.category === 'aircraft' || entity.category === 'effect';

    if (!behavior || behavior.type === 'static' || !behavior.type) {
      const h = isAirOrEffect
        ? groundH + (pos.heightM || 20)
        : (pos.heightM ?? 0);
      return context.localToCartesian({
        eastM: pos.eastM,
        northM: pos.northM,
        heightM: h,
      });
    }

    if (behavior.type === 'hover') {
      const alt = behavior.altitudeM ?? pos.heightM ?? 25;
      return context.localToCartesian({
        eastM: pos.eastM,
        northM: pos.northM,
        heightM: groundH + alt,
      });
    }

    if (behavior.type === 'orbit') {
      const radius = behavior.orbitRadiusM ?? 50;
      const alt = behavior.altitudeM ?? pos.heightM ?? 30;
      const duration = currentScene?.timeline?.durationSec ?? 60;
      const sampled = new Cesium.SampledPositionProperty();
      sampled.setInterpolationOptions({
        interpolationDegree: 1,
        interpolationAlgorithm: Cesium.LinearApproximation,
      });
      sampled.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
      sampled.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

      const steps = Math.max(12, Math.floor(duration));
      for (let i = 0; i <= steps; i++) {
        const sec = (i / steps) * duration;
        const angle =
          (2 * Math.PI * sec) / Math.max(10, behavior.orbitPeriodSec || 20);
        const e = pos.eastM + radius * Math.cos(angle);
        const n = pos.northM + radius * Math.sin(angle);
        const c3 = context.localToCartesian({
          eastM: e,
          northM: n,
          heightM: groundH + alt,
        });
        const time = Cesium.JulianDate.addSeconds(
          epoch,
          sec,
          new Cesium.JulianDate(),
        );
        sampled.addSample(time, c3);
      }
      return sampled;
    }

    // Path behaviors: walk, run, drive, fly, patrol, crowd_flow
    const path =
      behavior.path && behavior.path.length > 0 ? behavior.path : [pos];
    const defaultSpeed =
      {
        walk: 1.4,
        run: 3.5,
        drive: 12.0,
        fly: 45.0,
        patrol: 2.0,
        crowd_flow: 1.2,
      }[behavior.type] || 5.0;
    const speed = behavior.speedMps ?? defaultSpeed;

    // Synthesize atSec if absent
    let cumulativeDist = 0;
    const waypoints = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (i > 0) {
        const prev = path[i - 1];
        cumulativeDist += Math.hypot(
          p.eastM - prev.eastM,
          p.northM - prev.northM,
        );
      }
      const atSec =
        typeof p.atSec === 'number'
          ? p.atSec
          : cumulativeDist / Math.max(0.1, speed);
      waypoints.push({ ...p, atSec });
    }

    const sampled = new Cesium.SampledPositionProperty();
    sampled.setInterpolationOptions({
      interpolationDegree: 1,
      interpolationAlgorithm: Cesium.LinearApproximation,
    });
    sampled.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    sampled.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

    const baseAlt = behavior.altitudeM ?? (isAirOrEffect ? 30 : 0);

    for (const wp of waypoints) {
      const time = Cesium.JulianDate.addSeconds(
        epoch,
        wp.atSec,
        new Cesium.JulianDate(),
      );
      const gH = context?.groundHeightAt ? context.groundHeightAt(wp) : 0;
      const h = isAirOrEffect
        ? gH + (wp.heightM ?? baseAlt)
        : (wp.heightM ?? 0);
      const c3 = context.localToCartesian({
        eastM: wp.eastM,
        northM: wp.northM,
        heightM: h,
      });
      sampled.addSample(time, c3);
    }

    return sampled;
  }

  function createEntityGraphics(entity) {
    const epoch = getEpoch();
    const positionProp = buildEntityPositionProperty(entity, epoch);
    const isMoving = positionProp instanceof Cesium.SampledPositionProperty;
    const orientation = isMoving
      ? new Cesium.VelocityOrientationProperty(positionProp)
      : entity.headingDeg != null
        ? context?.headingToQuaternion
          ? context.headingToQuaternion(
              entity.position || {},
              entity.headingDeg,
            )
          : undefined
        : undefined;

    const labelText = formatLabelText(entity);
    const labelColor = getLabelColor(entity.uncertainty);

    const isModel = entity.assetId?.startsWith('model.');
    let modelGraphics = undefined;
    let billboardGraphics = undefined;

    if (isModel && !assets.isUnavailable(entity.assetId)) {
      const modelInfo = assets.modelFor(entity.assetId);
      if (modelInfo?.uri) {
        modelGraphics = new Cesium.ModelGraphics({
          uri: modelInfo.uri,
          minimumPixelSize: 24,
          maximumScale: 100,
          runAnimations: true,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        });
      }
    }

    if (!modelGraphics) {
      const bbInfo = assets.billboardFor(entity.assetId, { scale: 2 });
      const isAir =
        entity.category === 'aircraft' ||
        entity.category === 'effect' ||
        entity.position?.heightM != null;
      billboardGraphics = new Cesium.BillboardGraphics({
        image: bbInfo.image,
        width: Math.min(40, Math.max(28, bbInfo.width || 32)),
        height: Math.min(40, Math.max(28, bbInfo.height || 32)),
        scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 8000, 0.4),
        heightReference: isAir
          ? Cesium.HeightReference.NONE
          : Cesium.HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
      });
    }

    const labelGraphics = new Cesium.LabelGraphics({
      text: labelText,
      font: '13px sans-serif',
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      fillColor: labelColor,
      outlineColor: Cesium.Color.fromCssColorString('#0B1220'),
      outlineWidth: 4,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -26),
      scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 5000, 0.4),
      showBackground: false,
    });

    const cesEntity = new Cesium.Entity({
      id: entity.id,
      name: entity.label || entity.id,
      position: positionProp,
      orientation,
      label: labelGraphics,
      ...(modelGraphics ? { model: modelGraphics } : {}),
      ...(billboardGraphics ? { billboard: billboardGraphics } : {}),
    });

    return { cesEntity, positionProp };
  }

  function addEntity(entity) {
    const { cesEntity, positionProp } = createEntityGraphics(entity);
    dataSource.entities.add(cesEntity);

    const childIds = [];

    // Multi-member crowd/squad spreading (count > 1)
    if (typeof entity.count === 'number' && entity.count > 1) {
      const count = Math.min(60, entity.count);
      const spreadM = entity.spreadM ?? 20;
      const prng = createPrng(entity.id);
      const bbInfo = assets.billboardFor(entity.assetId, { scale: 2 });

      for (let i = 1; i < count; i++) {
        const memberId = `${entity.id}__member_${i}`;
        const r = spreadM * Math.sqrt(prng());
        const theta = 2 * Math.PI * prng();
        const dEast = r * Math.cos(theta);
        const dNorth = r * Math.sin(theta);

        const memberPos = entity.position
          ? {
              eastM: (entity.position.eastM || 0) + dEast,
              northM: (entity.position.northM || 0) + dNorth,
              heightM: entity.position.heightM || 0,
            }
          : { eastM: dEast, northM: dNorth, heightM: 0 };

        const memberCartesian = context.localToCartesian(memberPos);
        const memberEntity = new Cesium.Entity({
          id: memberId,
          position: memberCartesian,
          billboard: new Cesium.BillboardGraphics({
            image: bbInfo.image,
            width: Math.min(40, Math.max(28, bbInfo.width || 32)),
            height: Math.min(40, Math.max(28, bbInfo.height || 32)),
            scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 8000, 0.4),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }),
        });
        dataSource.entities.add(memberEntity);
        childIds.push(memberId);
      }
    }

    entityMap.set(entity.id, {
      entity: cesEntity,
      data: entity,
      children: childIds,
      positionProp,
    });
  }

  function removeEntity(id) {
    const item = entityMap.get(id);
    if (!item) return;

    dataSource.entities.remove(item.entity);
    for (const childId of item.children) {
      const child = dataSource.entities.getById(childId);
      if (child) dataSource.entities.remove(child);
    }

    // Remove badge if present
    const badge = dataSource.entities.getById(`${id}__badge`);
    if (badge) dataSource.entities.remove(badge);

    entityMap.delete(id);
  }

  function addRoute(route) {
    const coords = route.coordinates || [];
    if (!coords.length) return;

    const isClosed = Boolean(route.closed);
    const closureEntities = [];

    const positions = Cesium.Cartesian3.fromDegreesArray(coords.flat());

    const material = isClosed
      ? new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#EF4444'),
          dashLength: 16,
        })
      : Cesium.Color.fromCssColorString('#14B8A6');

    const polyline = new Cesium.Entity({
      id: route.id,
      name: route.label || route.id,
      polyline: {
        positions,
        width: 4,
        material,
        clampToGround: true,
      },
    });

    dataSource.entities.add(polyline);

    if (isClosed) {
      // Midpoint sign & label
      const midIdx = Math.floor(coords.length / 2);
      const midCoord = coords[midIdx];
      const midC3 = Cesium.Cartesian3.fromDegrees(midCoord[0], midCoord[1]);

      const isTestOrGen =
        route.provenance?.kind === 'test' ||
        route.provenance?.kind === 'generated';
      const labelText = isTestOrGen
        ? 'ROAD CLOSED (illustrative)'
        : 'ROAD CLOSED';

      const signId = `${route.id}__closed_sign`;
      const signEntity = new Cesium.Entity({
        id: signId,
        position: midC3,
        billboard: {
          image: '/scene-icons/png/signage_road_closed@2x.png',
          width: 32,
          height: 32,
          scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 5000, 0.5),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: labelText,
          font: '12px sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.fromCssColorString('#EF4444'),
          outlineColor: Cesium.Color.fromCssColorString('#0B1220'),
          outlineWidth: 3,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -24),
        },
      });

      dataSource.entities.add(signEntity);
      closureEntities.push(signId);
    }

    routeMap.set(route.id, {
      entity: polyline,
      data: route,
      closureEntities,
    });
  }

  function removeRoute(id) {
    const item = routeMap.get(id);
    if (!item) return;

    dataSource.entities.remove(item.entity);
    for (const cId of item.closureEntities) {
      const c = dataSource.entities.getById(cId);
      if (c) dataSource.entities.remove(c);
    }
    routeMap.delete(id);
  }

  function setHighlight(id, on, alertState = 2) {
    if (on) {
      highlightedIds.set(id, alertState);
      queue.push(() => {
        const item = entityMap.get(id);
        if (!item) return;

        const badgeId = `${id}__badge`;
        let badge = dataSource.entities.getById(badgeId);
        const image = `/scene-icons/png/alert_state_${alertState}@2x.png`;

        if (!badge) {
          badge = new Cesium.Entity({
            id: badgeId,
            position: item.entity.position,
            billboard: {
              image,
              width: 28,
              height: 28,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -50),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          });
          dataSource.entities.add(badge);
        } else if (badge.billboard) {
          badge.billboard.image = image;
        }

        effects?.add(
          {
            id: `eff-pulse-${id}`,
            type: 'highlight_pulse',
            entityId: id,
          },
          () => positionAt(id, 0),
          (entId) => entityById(entId),
        );
      });
    } else {
      highlightedIds.delete(id);
      queue.push(() => {
        const badge = dataSource.entities.getById(`${id}__badge`);
        if (badge) dataSource.entities.remove(badge);
        effects?.remove(`eff-pulse-${id}`);
      });
    }
    scheduleFlush();
  }

  function select(id) {
    if (selectedId && selectedId !== id) {
      setHighlight(selectedId, false);
    }
    selectedId = id;
    if (id) {
      setHighlight(id, true);
    }
  }

  function ensurePatrolPaths(scene) {
    if (
      !scene ||
      !Array.isArray(scene.entities) ||
      scene.entities.length === 0
    ) {
      return;
    }

    const hasMoving = scene.entities.some((e) => {
      if (e.synthesizedPath) return true;
      if (e.behavior?.path && e.behavior.path.length > 1) return true;
      if (e.behavior?.type === 'orbit') return true;
      if (
        ['walk', 'run', 'drive', 'fly', 'patrol', 'crowd_flow'].includes(
          e.behavior?.type,
        ) &&
        e.behavior?.path &&
        e.behavior.path.length > 0
      ) {
        return true;
      }
      return false;
    });

    if (hasMoving) {
      for (const e of scene.entities) {
        if (
          !e.synthesizedPath &&
          (!e.behavior || e.behavior.type === 'static')
        ) {
          e.idleAnimation = true;
        }
      }
      return;
    }

    const eligibleCategories = new Set([
      'vehicle',
      'person',
      'responder',
      'police',
    ]);
    const duration = Math.max(10, scene.timeline?.durationSec || 60);

    for (const entity of scene.entities) {
      if (eligibleCategories.has(entity.category)) {
        const pos = entity.position || { eastM: 0, northM: 0, heightM: 0 };
        const isVehicle = entity.category === 'vehicle';
        const radius = isVehicle ? 60 : 40;

        const t0 = 0;
        const t1 = duration * 0.25;
        const t2 = duration * 0.5;
        const t3 = duration * 0.75;
        const t4 = duration;
        const h = pos.heightM ?? 0;

        entity.behavior = {
          type: 'patrol',
          loop: true,
          speedMps: (radius * 4) / duration,
          path: [
            { eastM: pos.eastM, northM: pos.northM, heightM: h, atSec: t0 },
            {
              eastM: pos.eastM + radius,
              northM: pos.northM,
              heightM: h,
              atSec: t1,
            },
            {
              eastM: pos.eastM + radius,
              northM: pos.northM + radius,
              heightM: h,
              atSec: t2,
            },
            {
              eastM: pos.eastM,
              northM: pos.northM + radius,
              heightM: h,
              atSec: t3,
            },
            { eastM: pos.eastM, northM: pos.northM, heightM: h, atSec: t4 },
          ],
        };
        entity.synthesizedPath = true;
      } else {
        if (!entity.behavior || entity.behavior.type === 'static') {
          entity.idleAnimation = true;
        }
      }
    }
  }

  function attach(scene) {
    if (!scene) return;
    ensurePatrolPaths(scene);
    currentScene = scene;

    if (
      !context ||
      context.origin.lat !== scene.origin?.lat ||
      context.origin.lon !== scene.origin?.lon
    ) {
      context = createGeoSceneContext({
        viewer,
        origin: scene.origin,
        boundsRadiusM: scene.boundsRadiusM || 1500,
      });
      effects = createEffects({ viewer, context, onEvent });
    }

    queue.push(() => {
      // Clear existing
      for (const [id] of entityMap) removeEntity(id);
      for (const [id] of routeMap) removeRoute(id);
      effects?.clear();

      // Add all
      if (scene.entities) {
        for (const e of scene.entities) addEntity(e);
      }
      if (scene.routes) {
        for (const r of scene.routes) addRoute(r);
      }
      if (scene.effects) {
        for (const eff of scene.effects) {
          effects?.add(
            eff,
            (eid) => positionAt(eid, 0),
            (eid) => entityById(eid),
          );
        }
      }
    });

    scheduleFlush();
  }

  function update(scene, changes) {
    if (!currentScene) {
      attach(scene);
      return;
    }
    ensurePatrolPaths(scene);
    currentScene = scene;

    queue.push(() => {
      // Diff entities
      const nextEntIds = new Set((scene.entities || []).map((e) => e.id));
      for (const [id] of entityMap) {
        if (!nextEntIds.has(id)) removeEntity(id);
      }

      for (const e of scene.entities || []) {
        const existing = entityMap.get(e.id);
        if (!existing) {
          addEntity(e);
        } else if (JSON.stringify(existing.data) !== JSON.stringify(e)) {
          removeEntity(e.id);
          addEntity(e);
        }
      }

      // Diff routes
      const nextRouteIds = new Set((scene.routes || []).map((r) => r.id));
      for (const [id] of routeMap) {
        if (!nextRouteIds.has(id)) removeRoute(id);
      }

      for (const r of scene.routes || []) {
        const existing = routeMap.get(r.id);
        if (!existing) {
          addRoute(r);
        } else if (JSON.stringify(existing.data) !== JSON.stringify(r)) {
          removeRoute(r.id);
          addRoute(r);
        }
      }

      // Effects
      if (scene.effects) {
        for (const eff of scene.effects) {
          if (!effects?.get(eff.id)) {
            effects?.add(
              eff,
              (eid) => positionAt(eid, 0),
              (eid) => entityById(eid),
            );
          }
        }
      }
    });

    scheduleFlush();
  }

  function entityById(id) {
    return dataSource.entities.getById(id) || null;
  }

  function positionAt(id, sec = 0) {
    const item = entityMap.get(id);
    if (!item?.positionProp) return null;

    const prop = item.positionProp;
    if (prop instanceof Cesium.Cartesian3) {
      return prop;
    }
    if (typeof prop.getValue === 'function') {
      const epoch = getEpoch();
      const time = Cesium.JulianDate.addSeconds(
        epoch,
        sec,
        new Cesium.JulianDate(),
      );
      return prop.getValue(time);
    }
    return null;
  }

  function positionsSnapshot(sec = 0) {
    const out = {};
    for (const [id] of entityMap) {
      const c3 = positionAt(id, sec);
      if (!c3) continue;
      const carto = Cesium.Cartographic?.fromCartesian?.(c3);
      if (carto) {
        out[id] = {
          lon: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
          lat: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
        };
      } else if (context) {
        const local = context.cartesianToLocal(c3);
        const geo = context.localToCartographic(local);
        if (geo) {
          out[id] = {
            lon: Number(geo.lon.toFixed(6)),
            lat: Number(geo.lat.toFixed(6)),
          };
        }
      }
    }
    return out;
  }

  function snapshot() {
    let bbCount = 0;
    let polyCount = 0;
    let modelCount = 0;

    for (const e of dataSource.entities.values) {
      if (e.billboard) bbCount++;
      if (e.polyline) polyCount++;
      if (e.model) modelCount++;
    }

    const entities = (currentScene?.entities || []).map((e) => {
      const isHighlighted = highlightedIds.has(e.id);
      return {
        id: e.id,
        label: e.label || e.id,
        assetId: e.assetId,
        lat: e.position
          ? (context?.localToCartographic(e.position)?.lat ?? 0)
          : 0,
        lon: e.position
          ? (context?.localToCartographic(e.position)?.lon ?? 0)
          : 0,
        heightM: e.position?.heightM ?? 0,
        visible: true,
        behavior: e.behavior?.type || 'static',
        uncertainty: e.uncertainty,
        hypothetical: Boolean(e.hypothetical),
        highlight: isHighlighted,
        synthesizedPath: Boolean(e.synthesizedPath),
      };
    });

    const routes = (currentScene?.routes || []).map((r) => ({
      id: r.id,
      label: r.label || r.id,
      closed: Boolean(r.closed),
    }));

    const effectsList = (currentScene?.effects || []).map((eff) => ({
      id: eff.id,
      type: eff.type,
    }));

    const synthesizedCount = entities.filter((e) => e.synthesizedPath).length;

    return {
      sceneId: currentScene?.sceneId || '',
      sceneVersion: currentScene?.sceneVersion || 0,
      entities,
      routes,
      shots: currentScene?.shots || [],
      effects: effectsList,
      playback: playback?.state?.() || null,
      rendered: {
        billboards: bbCount,
        polylines: polyCount,
        models: modelCount,
      },
      stats: {
        synthesizedPath: synthesizedCount > 0,
        synthesizedCount,
      },
      debug: {
        synthesizedPath: synthesizedCount > 0,
        synthesizedCount,
      },
    };
  }

  function destroy() {
    if (viewer?.dataSources?.remove) {
      try {
        viewer.dataSources.remove(dataSource, true);
      } catch (err) {
        log?.(`[sceneRuntime] remove dataSource error: ${err.message}`);
      }
    }
    effects?.clear();
    entityMap.clear();
    routeMap.clear();
    queue = [];
  }

  return {
    attach,
    update,
    flush,
    get context() {
      return context;
    },
    get dataSource() {
      return dataSource;
    },
    entityById,
    positionAt,
    positionsSnapshot,
    setHighlight,
    select,
    selected: () => selectedId,
    snapshot,
    destroy,
  };
}
