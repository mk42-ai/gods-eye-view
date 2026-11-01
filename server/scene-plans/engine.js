/**
 * Deterministic scene engine (server only). Turns a validated Scene Spec plus a
 * resolved anchor into GeoJSON staging layers using ONLY prebuilt code and real
 * map data:
 *   footprint   OSM building containing / nearest the anchor (Overpass), else a
 *               small circle (provenance `circle-buffer`, reported in sources)
 *   cordons     Turf buffers of the footprint (inner = radius_m, outer = larger)
 *   closed road segments = road network clipped to the outer cordon
 *   cones / barriers     turf.along every spacing_m along closed segments
 *   perimeter units / checkpoints  road ∩ outer-cordon boundary (access points)
 *   staging point        nearest open road outside the outer cordon in `direction`
 *   approach / egress    OSRM road routes to/from the access points
 *   crowd / route events route_line from researched route geometry or the
 *                        named major road, start/finish + crowd zones + barriers
 *   cctv_signal          NOT invented here — the browser adds verified camera
 *                        discovery results (see sceneStagingLayer.setCameras)
 *
 * Everything that could not be derived from real data is listed under
 * `unavailable[]`; nothing is fabricated to fill the gap.
 */
import * as turf from '@turf/turf';
import {
  validateSceneStaging,
  STAGING_BADGE_TEXT,
  STAGING_COLORS,
  PRIORITY,
  cleanMapLabel,
  SCENE_STAGING_VERSION,
} from '../../src/scenes/sceneStaging.js';
import { SCENARIO_LABELS } from '../../src/scenes/sceneTemplates.js';
import { createOsmClient } from './osm.js';

const { teal, mint, white, amber } = STAGING_COLORS;
const BEARING = Object.freeze({
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
});
const km = (m) => m / 1000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const rc = (coords) => coords.map(([x, y]) => [round6(x), round6(y)]);
const first = (spec, type) =>
  spec.elements.find((e) => e.type === type) || null;
const all = (spec, type) => spec.elements.filter((e) => e.type === type);
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'x';

function feature(geometry, props) {
  return {
    type: 'Feature',
    geometry,
    properties: { illustrative: true, ...props },
  };
}
function ringOf(polygon) {
  return polygon.geometry.type === 'Polygon'
    ? polygon.geometry.coordinates[0]
    : polygon.geometry.coordinates
        .map((p) => p[0])
        .sort((a, b) => b.length - a.length)[0];
}
/** Decimate a ring/line to at most `max` vertices (keeps endpoints). */
function decimate(coords, max) {
  if (coords.length <= max) return rc(coords);
  const out = [];
  const step = (coords.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(coords[Math.round(i * step)]);
  return rc(out);
}
function toPolygonFeature(poly) {
  if (!poly) return null;
  if (poly.geometry.type === 'Polygon') return poly;
  // Largest part of a MultiPolygon.
  const parts = poly.geometry.coordinates.map((c) => turf.polygon(c));
  return parts.sort((a, b) => turf.area(b) - turf.area(a))[0];
}
function nameMatches(a, b) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 && !['road', 'street', 'the', 'and', 'al'].includes(w),
      );
  const x = norm(a);
  const y = new Set(norm(b));
  return (
    x.length > 0 && x.filter((w) => y.has(w)).length >= Math.min(2, x.length)
  );
}

/** Pure geometry step (no network). Exported for unit tests. */
export function stageFromData({
  spec,
  anchor,
  buildings = [],
  roads = [],
  routes = {},
  researchRoutes = [],
  now = Date.now,
}) {
  const t0 = now();
  const center = turf.point([anchor.lon, anchor.lat]);
  const areas = [];
  const lines = [];
  const points = [];
  const labels = [];
  const unavailable = [];
  const legendCounts = new Map();
  const addLegend = (key, label, swatch, color, icon) => {
    const cur = legendCounts.get(key) || {
      key,
      label,
      swatch,
      color,
      ...(icon ? { icon } : {}),
      count: 0,
    };
    cur.count += 1;
    legendCounts.set(key, cur);
  };
  const usedLabels = new Set();
  const addLabel = (
    coord,
    text,
    element,
    role,
    priority,
    labelFor,
    extra = {},
  ) => {
    const label = cleanMapLabel(text);
    const key = label.toLowerCase();
    if (!label || usedLabels.has(key)) return;
    usedLabels.add(key);
    labels.push(
      feature(
        { type: 'Point', coordinates: rc([coord])[0] },
        {
          id: `label-${slug(labelFor || element)}-${labels.length + 1}`,
          element,
          role,
          label,
          priority,
          color: role === 'focal' ? white : mint,
          provenance: 'anchor',
          ...(labelFor ? { labelFor } : {}),
          ...extra,
        },
      ),
    );
  };

  // ---- footprint -----------------------------------------------------------
  let footprint = null;
  let footprintSource = 'circle-fallback';
  const containing = buildings.filter((b) => {
    try {
      return turf.booleanPointInPolygon(center, b);
    } catch {
      return false;
    }
  });
  const candidates = containing.length
    ? containing
    : buildings
        .map((b) => ({
          b,
          d:
            turf.distance(center, turf.centroid(b), { units: 'kilometers' }) *
            1000,
        }))
        .filter(
          (x) =>
            x.d <= 60 &&
            (!spec.focalEntity.name ||
              nameMatches(spec.focalEntity.name, x.b.properties?.name) ||
              x.d <= 25),
        )
        .sort((a, b) => a.d - b.d)
        .map((x) => x.b)
        .slice(0, 1);
  if (candidates.length) {
    footprint = candidates.sort((a, b) => turf.area(b) - turf.area(a))[0];
    footprintSource = 'osm-building';
  } else {
    footprint = turf.circle(center, km(30), { steps: 32, units: 'kilometers' });
  }
  const focalName = cleanMapLabel(spec.focalEntity.name || anchor.name, 40);
  areas.push(
    feature(
      { type: 'Polygon', coordinates: [decimate(ringOf(footprint), 200)] },
      {
        id: 'focal-footprint',
        element: 'focal',
        role: 'focal',
        label: focalName,
        priority: PRIORITY.focal,
        color: white,
        provenance:
          footprintSource === 'osm-building'
            ? 'osm-footprint-buffer'
            : 'circle-buffer',
      },
    ),
  );
  addLabel(
    [anchor.lon, anchor.lat],
    focalName,
    'focal',
    'focal',
    PRIORITY.focal,
    'focal-footprint',
  );
  addLegend(
    'focal',
    footprintSource === 'osm-building'
      ? 'Focal building footprint (OSM)'
      : 'Focal point (approximate footprint)',
    'area',
    white,
  );

  // ---- cordons -------------------------------------------------------------
  const innerSpec = first(spec, 'inner_cordon');
  const outerSpec = first(spec, 'outer_cordon');
  const innerR = innerSpec?.params.radius_m ?? 80;
  const outerR = Math.max(
    outerSpec?.params.radius_m ?? innerR * 2.75,
    innerR + 40,
  );
  let inner = null;
  let outer = null;
  if (innerSpec) {
    inner = toPolygonFeature(
      turf.buffer(footprint, km(innerR), { units: 'kilometers', steps: 12 }),
    );
    areas.push(
      feature(
        { type: 'Polygon', coordinates: [decimate(ringOf(inner), 300)] },
        {
          id: 'inner-cordon',
          element: 'inner_cordon',
          role: 'cordon',
          label: 'Inner cordon',
          priority: PRIORITY.cordon,
          color: teal,
          lineStyle: 'cordon_inner',
          provenance:
            footprintSource === 'osm-building'
              ? 'osm-footprint-buffer'
              : 'circle-buffer',
        },
      ),
    );
    const edge = ringOf(inner)[Math.floor(ringOf(inner).length * 0.12)];
    addLabel(
      edge,
      `Inner cordon · ${Math.round(innerR)} m`,
      'inner_cordon',
      'cordon',
      PRIORITY.cordon,
      'inner-cordon',
    );
    addLegend(
      'inner_cordon',
      `Inner cordon (${Math.round(innerR)} m buffer)`,
      'area',
      teal,
    );
  }
  if (outerSpec) {
    outer = toPolygonFeature(
      turf.buffer(footprint, km(outerR), { units: 'kilometers', steps: 16 }),
    );
    areas.push(
      feature(
        { type: 'Polygon', coordinates: [decimate(ringOf(outer), 400)] },
        {
          id: 'outer-cordon',
          element: 'outer_cordon',
          role: 'cordon',
          label: 'Outer cordon',
          priority: PRIORITY.cordon - 1,
          color: mint,
          lineStyle: 'cordon_outer',
          provenance:
            footprintSource === 'osm-building'
              ? 'osm-footprint-buffer'
              : 'circle-buffer',
        },
      ),
    );
    const edge = ringOf(outer)[Math.floor(ringOf(outer).length * 0.62)];
    addLabel(
      edge,
      `Outer cordon · ${Math.round(outerR)} m`,
      'outer_cordon',
      'cordon',
      PRIORITY.cordon - 1,
      'outer-cordon',
    );
    addLegend(
      'outer_cordon',
      `Outer cordon (${Math.round(outerR)} m, dashed)`,
      'area',
      mint,
    );
  }
  const perimeter = outer || inner;

  // ---- road network inside / crossing the outer cordon ---------------------
  const closedSegments = [];
  const accessPoints = [];
  if (perimeter && roads.length) {
    const boundary = turf.polygonToLine(perimeter);
    for (const road of roads) {
      let crossings;
      try {
        crossings = turf.lineIntersect(road, boundary).features;
      } catch {
        crossings = [];
      }
      for (const c of crossings) {
        const coord = c.geometry.coordinates;
        if (
          accessPoints.some(
            (p) =>
              turf.distance(turf.point(p.coord), c, { units: 'kilometers' }) *
                1000 <
              25,
          )
        )
          continue;
        accessPoints.push({
          coord,
          road,
          major: Boolean(road.properties?.major),
          name: road.properties?.name || '',
        });
      }
      let pieces;
      try {
        pieces = crossings.length
          ? turf.lineSplit(road, perimeter).features
          : [road];
      } catch {
        pieces = [road];
      }
      for (const piece of pieces) {
        const mid = turf.along(
          piece,
          turf.length(piece, { units: 'kilometers' }) / 2,
          { units: 'kilometers' },
        );
        if (turf.booleanPointInPolygon(mid, perimeter))
          closedSegments.push({ piece, road });
      }
    }
  } else if (perimeter) {
    unavailable.push({
      element: 'cones',
      reason: 'road network unavailable (Overpass); no closed segments derived',
    });
  }
  accessPoints.sort(
    (a, b) =>
      Number(b.major) - Number(a.major) ||
      turf.bearing(center, turf.point(a.coord)) -
        turf.bearing(center, turf.point(b.coord)),
  );

  // ---- cones & barriers along closed segments ------------------------------
  const placeAlong = (elementType, spacingM, icon, role, color, cap) => {
    let n = 0;
    for (const { piece, road } of closedSegments) {
      const lenKm = turf.length(piece, { units: 'kilometers' });
      const step = km(spacingM);
      for (let d = step / 2; d < lenKm && n < cap; d += step) {
        const p = turf.along(piece, d, { units: 'kilometers' });
        const next = turf.along(piece, Math.min(lenKm, d + step / 4), {
          units: 'kilometers',
        });
        const heading = (turf.bearing(p, next) + 360) % 360;
        points.push(
          feature(
            { type: 'Point', coordinates: rc([p.geometry.coordinates])[0] },
            {
              id: `${elementType}-${n + 1}`,
              element: elementType,
              role,
              priority: PRIORITY[role],
              color,
              icon,
              heading,
              index: n,
              provenance: 'turf-along',
              ...(road.properties?.name
                ? { source: String(road.properties.name).slice(0, 80) }
                : {}),
            },
          ),
        );
        n += 1;
        addLegend(
          elementType,
          elementType === 'cones'
            ? `Traffic cones every ${spacingM} m on closed segments`
            : `Barriers every ${spacingM} m on closed segments`,
          'icon',
          color,
          icon,
        );
      }
    }
    return n;
  };
  const conesSpec = first(spec, 'cones');
  if (conesSpec) {
    const n = closedSegments.length
      ? placeAlong(
          'cones',
          conesSpec.params.spacing_m ?? 8,
          'cone',
          'cone',
          teal,
          160,
        )
      : 0;
    if (!n && closedSegments.length === 0 && roads.length)
      unavailable.push({
        element: 'cones',
        reason: 'no road segment lies inside the outer cordon',
      });
  }
  const barriersSpec = first(spec, 'barriers');
  if (barriersSpec) {
    const n = closedSegments.length
      ? placeAlong(
          'barriers',
          barriersSpec.params.spacing_m ?? 25,
          'barrier',
          'barrier',
          mint,
          80,
        )
      : 0;
    if (!n && closedSegments.length === 0)
      unavailable.push({
        element: 'barriers',
        reason: roads.length
          ? 'no road segment lies inside the outer cordon'
          : 'road network unavailable (Overpass)',
      });
  }

  // ---- perimeter units & checkpoints at access points ----------------------
  const unitSpec = first(spec, 'perimeter_unit');
  if (unitSpec && perimeter) {
    const want = unitSpec.params.count ?? 6;
    const chosen = accessPoints.slice(0, want).map((a) => a.coord);
    if (chosen.length < want) {
      // Fill evenly around the outer ring (still on the cordon boundary, never inside a building).
      const ring = ringOf(perimeter);
      const need = want - chosen.length;
      for (let i = 0; i < need; i++)
        chosen.push(ring[Math.floor(((i + 0.5) / need) * (ring.length - 1))]);
    }
    chosen.forEach((coord, i) =>
      points.push(
        feature(
          { type: 'Point', coordinates: rc([coord])[0] },
          {
            id: `perimeter-unit-${i + 1}`,
            element: 'perimeter_unit',
            role: 'unit',
            priority: PRIORITY.unit,
            color: teal,
            icon: i < accessPoints.length ? 'police_unit' : 'perimeter_unit',
            index: i,
            provenance:
              i < accessPoints.length ? 'turf-intersect' : 'circle-buffer',
          },
        ),
      ),
    );
    addLegend(
      'perimeter_unit',
      `Perimeter units at access points (${chosen.length})`,
      'icon',
      teal,
      'police_unit',
    );
    legendCounts.get('perimeter_unit').count = chosen.length;
    if (!accessPoints.length)
      unavailable.push({
        element: 'perimeter_unit',
        reason: roads.length
          ? 'no road crosses the outer cordon; units spaced on the cordon ring'
          : 'road network unavailable; units spaced on the cordon ring',
      });
  }
  const checkpointSpec = first(spec, 'checkpoint');
  if (checkpointSpec && perimeter) {
    const want = checkpointSpec.params.count ?? 2;
    const majors = accessPoints
      .filter((a) => a.major)
      .concat(accessPoints.filter((a) => !a.major))
      .slice(0, want);
    majors.forEach((a, i) => {
      // Offset 18 m outward along the radial so the checkpoint icon does not sit on the unit icon.
      const b = turf.bearing(center, turf.point(a.coord));
      const p = turf.destination(turf.point(a.coord), km(18), b, {
        units: 'kilometers',
      });
      points.push(
        feature(
          { type: 'Point', coordinates: rc([p.geometry.coordinates])[0] },
          {
            id: `checkpoint-${i + 1}`,
            element: 'checkpoint',
            role: 'unit',
            priority: PRIORITY.unit + 2,
            color: mint,
            icon: 'checkpoint',
            index: i,
            provenance: 'turf-intersect',
            ...(a.name ? { source: String(a.name).slice(0, 80) } : {}),
          },
        ),
      );
      addLegend(
        'checkpoint',
        'Checkpoints on major access roads',
        'icon',
        mint,
        'checkpoint',
      );
      if (i === 0)
        addLabel(
          p.geometry.coordinates,
          a.name ? `Checkpoint · ${a.name}` : 'Checkpoint',
          'checkpoint',
          'unit',
          PRIORITY.unit + 2,
          `checkpoint-1`,
        );
    });
    if (!majors.length)
      unavailable.push({
        element: 'checkpoint',
        reason: 'no access road crosses the outer cordon',
      });
  }

  // ---- staging point -------------------------------------------------------
  const stagingSpec = first(spec, 'staging_point');
  let stagingCoord = null;
  if (stagingSpec) {
    const bearing = BEARING[stagingSpec.params.direction || 'N'];
    const target = turf.destination(center, km(outerR + 140), bearing, {
      units: 'kilometers',
    });
    let best = null;
    for (const road of roads) {
      const snapped = turf.nearestPointOnLine(road, target, {
        units: 'kilometers',
      });
      if (perimeter && turf.booleanPointInPolygon(snapped, perimeter)) continue;
      const d = snapped.properties.dist ?? Infinity;
      if (!best || d < best.d)
        best = {
          d,
          coord: snapped.geometry.coordinates,
          name: road.properties?.name || '',
        };
    }
    stagingCoord =
      best && best.d * 1000 < 400 ? best.coord : target.geometry.coordinates;
    points.push(
      feature(
        { type: 'Point', coordinates: rc([stagingCoord])[0] },
        {
          id: 'staging-point',
          element: 'staging_point',
          role: 'unit',
          priority: PRIORITY.unit + 5,
          color: mint,
          icon: 'staging_point',
          provenance:
            best && best.d * 1000 < 400 ? 'overpass-highway' : 'circle-buffer',
          ...(best?.name ? { source: String(best.name).slice(0, 80) } : {}),
        },
      ),
    );
    addLabel(
      stagingCoord,
      `Staging point (${stagingSpec.params.direction || 'N'})`,
      'staging_point',
      'unit',
      PRIORITY.unit + 5,
      'staging-point',
    );
    addLegend(
      'staging_point',
      'Staging point on nearest open road',
      'icon',
      mint,
      'staging_point',
    );
    if (!(best && best.d * 1000 < 400))
      unavailable.push({
        element: 'staging_point',
        reason:
          'no open road within 400 m in the requested direction; placed on the radial',
      });
  }

  // ---- approach & egress routes (routed by OSRM, supplied in `routes`) -----
  const addRoute = (
    id,
    coords,
    elementType,
    style,
    label,
    color,
    priorityDelta = 0,
  ) => {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    lines.push(
      feature(
        { type: 'LineString', coordinates: decimate(coords, 500) },
        {
          id,
          element: elementType,
          role: 'route',
          label,
          priority: PRIORITY.route + priorityDelta,
          color,
          lineStyle: style,
          provenance: 'osrm-route',
          widthClass: elementType === 'route_line' ? 'major' : 'minor',
        },
      ),
    );
    const mid = coords[Math.floor(coords.length / 2)];
    addLabel(
      mid,
      label,
      elementType,
      'route',
      PRIORITY.route + priorityDelta,
      id,
    );
    return true;
  };
  const approachSpec = first(spec, 'approach_route');
  if (approachSpec) {
    let n = 0;
    for (const r of routes.approach || [])
      if (
        addRoute(
          `approach-route-${n + 1}`,
          r.coordinates,
          'approach_route',
          'route_approach',
          `Approach route ${n + 1}`,
          teal,
        )
      )
        n += 1;
    for (let i = 0; i < n; i++)
      addLegend(
        'approach_route',
        'Approach routes (road-routed)',
        'line',
        teal,
      );
    if (!n)
      unavailable.push({
        element: 'approach_route',
        reason: routes.approachReason || 'routing unavailable (OSRM)',
      });
  }
  const egressSpec = first(spec, 'egress_route');
  if (egressSpec) {
    const r = routes.egress;
    if (
      r &&
      addRoute(
        'egress-route',
        r.coordinates,
        'egress_route',
        'route_egress',
        `Egress route (${egressSpec.params.direction || 'out'})`,
        mint,
        -5,
      )
    ) {
      addLegend('egress_route', 'Egress route (road-routed)', 'line', mint);
      const end = r.coordinates.at(-1);
      points.push(
        feature(
          { type: 'Point', coordinates: rc([end])[0] },
          {
            id: 'egress-marker',
            element: 'egress_route',
            role: 'marker',
            priority: PRIORITY.marker,
            color: mint,
            icon: 'egress',
            provenance: 'osrm-route',
          },
        ),
      );
    } else
      unavailable.push({
        element: 'egress_route',
        reason: routes.egressReason || 'routing unavailable (OSRM)',
      });
  }

  // ---- event / route-closure / motorcade line ------------------------------
  const routeLineSpec = first(spec, 'route_line');
  let routeLine = null;
  if (routeLineSpec) {
    const researched = researchRoutes.find(
      (r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2,
    );
    if (researched)
      routeLine = {
        coordinates: researched.coordinates,
        label: cleanMapLabel(researched.name || 'Researched route'),
        provenance: 'osrm-route',
      };
    else if (routes.routeLine)
      routeLine = {
        coordinates: routes.routeLine.coordinates,
        label: routes.routeLine.name
          ? cleanMapLabel(`${routes.routeLine.name} corridor`)
          : 'Route corridor',
        provenance: 'osrm-route',
      };
    if (routeLine) {
      lines.push(
        feature(
          {
            type: 'LineString',
            coordinates: decimate(routeLine.coordinates, 600),
          },
          {
            id: 'route-line',
            element: 'route_line',
            role: 'route',
            label: routeLine.label,
            priority: PRIORITY.route + 5,
            color: teal,
            lineStyle: 'route_line',
            provenance: routeLine.provenance,
            widthClass: 'major',
          },
        ),
      );
      const line = turf.lineString(routeLine.coordinates);
      const mid = turf.along(
        line,
        turf.length(line, { units: 'kilometers' }) / 2,
        { units: 'kilometers' },
      ).geometry.coordinates;
      addLabel(
        mid,
        routeLine.label,
        'route_line',
        'route',
        PRIORITY.route + 5,
        'route-line',
      );
      addLegend(
        'route_line',
        'Route / course corridor (road-routed)',
        'line',
        teal,
      );
      // barriers / cones along the route line
      const lineLen = turf.length(line, { units: 'kilometers' });
      for (const [elType, icon, role, color, cap, defaultSpacing] of [
        ['barriers', 'barrier', 'barrier', mint, 80, 40],
        ['cones', 'cone', 'cone', teal, 160, 12],
      ]) {
        const s = first(spec, elType);
        if (!s || closedSegments.length) continue;
        const stepKm = km(s.params.spacing_m ?? defaultSpacing);
        let n = 0;
        for (let d = stepKm / 2; d < lineLen && n < cap; d += stepKm) {
          const p = turf.along(line, d, { units: 'kilometers' });
          points.push(
            feature(
              { type: 'Point', coordinates: rc([p.geometry.coordinates])[0] },
              {
                id: `${elType}-${n + 1}`,
                element: elType,
                role,
                priority: PRIORITY[role],
                color,
                icon,
                index: n,
                provenance: 'turf-along',
              },
            ),
          );
          n += 1;
          addLegend(
            elType,
            `${elType === 'cones' ? 'Traffic cones' : 'Barriers'} along the course`,
            'icon',
            color,
            icon,
          );
        }
      }
      // perimeter units spread along the line when no cordon placed them
      if (unitSpec && !perimeter) {
        const want = unitSpec.params.count ?? 4;
        for (let i = 0; i < want; i++) {
          const p = turf.along(line, (lineLen * (i + 0.5)) / want, {
            units: 'kilometers',
          });
          points.push(
            feature(
              { type: 'Point', coordinates: rc([p.geometry.coordinates])[0] },
              {
                id: `perimeter-unit-${i + 1}`,
                element: 'perimeter_unit',
                role: 'unit',
                priority: PRIORITY.unit,
                color: teal,
                icon: 'police_unit',
                index: i,
                provenance: 'turf-along',
              },
            ),
          );
          addLegend(
            'perimeter_unit',
            'Marshal / unit positions along the course',
            'icon',
            teal,
            'police_unit',
          );
        }
      }
      if (checkpointSpec && !perimeter) {
        const want = checkpointSpec.params.count ?? 2;
        for (let i = 0; i < want; i++) {
          const p = turf.along(line, (lineLen * (i + 1)) / (want + 1), {
            units: 'kilometers',
          });
          points.push(
            feature(
              { type: 'Point', coordinates: rc([p.geometry.coordinates])[0] },
              {
                id: `checkpoint-${i + 1}`,
                element: 'checkpoint',
                role: 'unit',
                priority: PRIORITY.unit + 2,
                color: mint,
                icon: 'checkpoint',
                index: i,
                provenance: 'turf-along',
              },
            ),
          );
          addLegend(
            'checkpoint',
            'Checkpoints along the corridor',
            'icon',
            mint,
            'checkpoint',
          );
        }
      }
    } else
      unavailable.push({
        element: 'route_line',
        reason:
          routes.routeLineReason ||
          'no researched route and no routable major road near the anchor',
      });
  }
  const startFinishSpec = first(spec, 'start_finish');
  if (startFinishSpec) {
    const coord = routeLine
      ? routeLine.coordinates[0]
      : [anchor.lon, anchor.lat];
    points.push(
      feature(
        { type: 'Point', coordinates: rc([coord])[0] },
        {
          id: 'start-finish',
          element: 'start_finish',
          role: 'marker',
          priority: PRIORITY.marker + 10,
          color: white,
          icon: 'start_finish',
          provenance: routeLine ? 'osrm-route' : 'anchor',
        },
      ),
    );
    addLabel(
      coord,
      'Start / finish',
      'start_finish',
      'marker',
      PRIORITY.marker + 10,
      'start-finish',
    );
    addLegend(
      'start_finish',
      routeLine ? 'Start / finish (route origin)' : 'Start / finish (anchor)',
      'icon',
      white,
      'start_finish',
    );
  }
  const crowdSpecs = all(spec, 'crowd_zone');
  if (crowdSpecs.length) {
    const r = crowdSpecs[0].params.radius_m ?? 100;
    const count = Math.min(
      6,
      crowdSpecs.reduce((n, s) => n + (s.params.count ?? 1), 0),
    );
    const anchorsForZones = [];
    if (routeLine) {
      const line = turf.lineString(routeLine.coordinates);
      const len = turf.length(line, { units: 'kilometers' });
      for (let i = 0; i < count; i++)
        anchorsForZones.push(
          turf.along(line, (len * i) / Math.max(1, count - 1), {
            units: 'kilometers',
          }).geometry.coordinates,
        );
    } else
      for (let i = 0; i < count; i++)
        anchorsForZones.push(
          turf.destination(center, km(r * 1.6 * i), 90 * i, {
            units: 'kilometers',
          }).geometry.coordinates,
        );
    anchorsForZones.forEach((c, i) => {
      const zone = turf.circle(turf.point(c), km(r), {
        steps: 24,
        units: 'kilometers',
      });
      areas.push(
        feature(
          { type: 'Polygon', coordinates: [rc(zone.geometry.coordinates[0])] },
          {
            id: `crowd-zone-${i + 1}`,
            element: 'crowd_zone',
            role: 'zone',
            label: `Crowd zone ${i + 1}`,
            priority: PRIORITY.zone,
            color: mint,
            provenance: 'circle-buffer',
          },
        ),
      );
      points.push(
        feature(
          { type: 'Point', coordinates: rc([c])[0] },
          {
            id: `crowd-zone-marker-${i + 1}`,
            element: 'crowd_zone',
            role: 'zone',
            priority: PRIORITY.zone,
            color: mint,
            icon: 'crowd_zone',
            index: i,
            provenance: 'circle-buffer',
          },
        ),
      );
      addLegend('crowd_zone', `Crowd zones (${r} m radius)`, 'area', mint);
    });
    legendCounts.get('crowd_zone').count = anchorsForZones.length;
  }
  if (first(spec, 'cctv_signal'))
    unavailable.push({
      element: 'cctv_signal',
      reason:
        'camera markers come only from verified camera discovery in the client; none are generated',
    });

  // ---- Dynamic intelligence DSL elements -----------------------------------
  const coordFromOffset = (offset, defaultBearing = 0, defaultDistM = 100) => {
    if (
      offset &&
      (Number.isFinite(offset.eastM) || Number.isFinite(offset.northM))
    ) {
      const e = offset.eastM || 0;
      const n = offset.northM || 0;
      const dist = Math.hypot(e, n);
      if (dist === 0) return [round6(anchor.lon), round6(anchor.lat)];
      const b = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
      const dest = turf.destination(center, km(dist), b, {
        units: 'kilometers',
      });
      return rc([dest.geometry.coordinates])[0];
    }
    const dest = turf.destination(center, km(defaultDistM), defaultBearing, {
      units: 'kilometers',
    });
    return rc([dest.geometry.coordinates])[0];
  };

  const notes = [];
  const timeline = [];

  // 1. threat_zone (#F59E0B amber)
  const threatZones = all(spec, 'threat_zone');
  threatZones.forEach((tz, i) => {
    const r = tz.params?.radius_m ?? tz.radius_m ?? 120;
    const c = coordFromOffset(tz.offset, (i * 90) % 360, innerR + 60);
    const zone = turf.circle(turf.point(c), km(r), {
      steps: 24,
      units: 'kilometers',
    });
    areas.push(
      feature(
        { type: 'Polygon', coordinates: [rc(zone.geometry.coordinates[0])] },
        {
          id: `threat-zone-${i + 1}`,
          element: 'threat_zone',
          role: 'zone',
          label: tz.label || `Threat zone ${i + 1}`,
          priority: PRIORITY.zone,
          color: amber,
          provenance: 'circle-buffer',
          confidence: tz.confidence ?? 0.5,
          ...(tz.source ? { source: tz.source } : {}),
          ...(tz.generic ? { generic: true } : {}),
        },
      ),
    );
    addLabel(
      c,
      tz.label || `Threat zone ${i + 1}`,
      'threat_zone',
      'zone',
      PRIORITY.zone,
      `threat-zone-${i + 1}`,
    );
    addLegend('threat_zone', `Threat zone (${Math.round(r)} m)`, 'area', amber);
  });

  // 2. interest_zone (#14B8A6 teal)
  const interestZones = all(spec, 'interest_zone');
  interestZones.forEach((iz, i) => {
    const r = iz.params?.radius_m ?? iz.radius_m ?? 150;
    const c = coordFromOffset(iz.offset, (45 + i * 90) % 360, outerR + 40);
    const zone = turf.circle(turf.point(c), km(r), {
      steps: 24,
      units: 'kilometers',
    });
    areas.push(
      feature(
        { type: 'Polygon', coordinates: [rc(zone.geometry.coordinates[0])] },
        {
          id: `interest-zone-${i + 1}`,
          element: 'interest_zone',
          role: 'zone',
          label: iz.label || `Interest zone ${i + 1}`,
          priority: PRIORITY.zone,
          color: teal,
          provenance: 'circle-buffer',
          confidence: iz.confidence ?? 0.5,
          ...(iz.source ? { source: iz.source } : {}),
          ...(iz.generic ? { generic: true } : {}),
        },
      ),
    );
    addLabel(
      c,
      iz.label || `Interest zone ${i + 1}`,
      'interest_zone',
      'zone',
      PRIORITY.zone,
      `interest-zone-${i + 1}`,
    );
    addLegend(
      'interest_zone',
      `Interest zone (${Math.round(r)} m)`,
      'area',
      teal,
    );
  });

  // 3. crowd_density_zone (#A7F3D0 mint)
  const crowdDensityZones = all(spec, 'crowd_density_zone');
  crowdDensityZones.forEach((cdz, i) => {
    const r = cdz.params?.radius_m ?? cdz.radius_m ?? 100;
    const c = coordFromOffset(cdz.offset, (180 + i * 90) % 360, outerR + 60);
    const zone = turf.circle(turf.point(c), km(r), {
      steps: 24,
      units: 'kilometers',
    });
    areas.push(
      feature(
        { type: 'Polygon', coordinates: [rc(zone.geometry.coordinates[0])] },
        {
          id: `crowd-density-zone-${i + 1}`,
          element: 'crowd_density_zone',
          role: 'zone',
          label: cdz.label || `Crowd density zone ${i + 1}`,
          priority: PRIORITY.zone,
          color: mint,
          provenance: 'circle-buffer',
          confidence: cdz.confidence ?? 0.5,
          ...(cdz.source ? { source: cdz.source } : {}),
          ...(cdz.generic ? { generic: true } : {}),
        },
      ),
    );
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `crowd-density-marker-${i + 1}`,
          element: 'crowd_density_zone',
          role: 'zone',
          priority: PRIORITY.zone,
          color: mint,
          icon: 'crowd_zone',
          provenance: 'circle-buffer',
          confidence: cdz.confidence ?? 0.5,
          ...(cdz.source ? { source: cdz.source } : {}),
          ...(cdz.generic ? { generic: true } : {}),
        },
      ),
    );
    addLabel(
      c,
      cdz.label || `Crowd density zone ${i + 1}`,
      'crowd_density_zone',
      'zone',
      PRIORITY.zone,
      `crowd-density-zone-${i + 1}`,
    );
    addLegend(
      'crowd_density_zone',
      `Crowd density zone (${Math.round(r)} m)`,
      'area',
      mint,
    );
  });

  // 4. overwatch
  const overwatches = all(spec, 'overwatch');
  overwatches.forEach((ow, i) => {
    const c = coordFromOffset(ow.offset, (30 + i * 120) % 360, outerR + 100);
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `overwatch-${i + 1}`,
          element: 'overwatch',
          role: 'unit',
          priority: PRIORITY.overwatch || 70,
          color: mint,
          icon: 'command_post',
          provenance: ow.offset ? 'circle-buffer' : 'anchor',
          confidence: ow.confidence ?? 0.5,
          ...(ow.source ? { source: ow.source } : {}),
          ...(ow.generic ? { generic: true } : {}),
        },
      ),
    );
    addLabel(
      c,
      ow.label || `Overwatch ${i + 1}`,
      'overwatch',
      'unit',
      PRIORITY.overwatch || 70,
      `overwatch-${i + 1}`,
    );
    addLegend('overwatch', 'Overwatch position', 'icon', mint, 'command_post');
  });

  // 5. command_post
  const commandPosts = all(spec, 'command_post');
  commandPosts.forEach((cp, i) => {
    const b =
      (cp.params?.direction ? BEARING[cp.params.direction] : 0) + i * 45;
    const c = coordFromOffset(cp.offset, b, outerR + 120);
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `command-post-${i + 1}`,
          element: 'command_post',
          role: 'unit',
          priority: PRIORITY.command_post || 70,
          color: mint,
          icon: 'command_post',
          provenance: cp.offset ? 'circle-buffer' : 'anchor',
          confidence: cp.confidence ?? 0.5,
          ...(cp.source ? { source: cp.source } : {}),
          ...(cp.generic ? { generic: true } : {}),
        },
      ),
    );
    addLabel(
      c,
      cp.label || 'Command post',
      'command_post',
      'unit',
      PRIORITY.command_post || 70,
      `command-post-${i + 1}`,
    );
    addLegend('command_post', 'Command post', 'icon', mint, 'command_post');
  });

  // 6. cordon_node
  const cordonNodes = all(spec, 'cordon_node');
  cordonNodes.forEach((cn, i) => {
    let c;
    if (cn.offset) {
      c = coordFromOffset(cn.offset);
    } else if (perimeter) {
      const ring = ringOf(perimeter);
      c =
        ring[
          Math.floor(
            ((i + 0.5) / Math.max(1, cordonNodes.length)) * (ring.length - 1),
          )
        ];
    } else {
      c = coordFromOffset(null, (i * 60) % 360, innerR);
    }
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `cordon-node-${i + 1}`,
          element: 'cordon_node',
          role: 'unit',
          priority: PRIORITY.cordon_node || 60,
          color: teal,
          icon: 'cordon_node',
          provenance: 'circle-buffer',
          confidence: cn.confidence ?? 0.5,
          ...(cn.source ? { source: cn.source } : {}),
          ...(cn.generic ? { generic: true } : {}),
        },
      ),
    );
    if (cn.label) {
      addLabel(
        c,
        cn.label,
        'cordon_node',
        'unit',
        PRIORITY.cordon_node || 60,
        `cordon-node-${i + 1}`,
      );
    }
    addLegend('cordon_node', 'Cordon node', 'icon', teal, 'cordon_node');
  });

  // 7. cctv_pick
  const cctvPicks = all(spec, 'cctv_pick');
  cctvPicks.forEach((cp, i) => {
    const c = coordFromOffset(cp.offset, (210 + i * 40) % 360, innerR + 30);
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `cctv-pick-${i + 1}`,
          element: 'cctv_pick',
          role: 'signal',
          priority: PRIORITY.cctv || 50,
          color: mint,
          icon: 'cctv',
          provenance: cp.offset ? 'circle-buffer' : 'anchor',
          confidence: cp.confidence ?? 0.5,
          relevance: cp.relevance ?? 0.5,
          ...(cp.source ? { source: cp.source } : {}),
          ...(cp.generic ? { generic: true } : {}),
        },
      ),
    );
    if (cp.label) {
      addLabel(
        c,
        cp.label,
        'cctv_pick',
        'signal',
        PRIORITY.cctv || 50,
        `cctv-pick-${i + 1}`,
      );
    }
    addLegend('cctv_pick', 'CCTV camera selection', 'icon', mint, 'cctv');
  });

  // 8. intel_note
  const intelNotes = all(spec, 'intel_note');
  intelNotes.forEach((inNote, i) => {
    notes.push({
      text: inNote.label || inNote.title || 'Intel note',
      evidenceTier: inNote.evidenceTier || 'inferred',
      citations: inNote.citations || [],
      confidence: inNote.confidence ?? 0.5,
      ...(inNote.source ? { source: inNote.source } : {}),
      ...(inNote.offset ? { offset: inNote.offset } : {}),
    });
    if (inNote.offset) {
      const c = coordFromOffset(inNote.offset);
      addLabel(
        c,
        inNote.label || 'Intel note',
        'intel_note',
        'marker',
        45,
        `intel-note-${i + 1}`,
      );
    }
  });

  // 9. timeline_event
  const timelineEvents = all(spec, 'timeline_event');
  timelineEvents.forEach((te, i) => {
    timeline.push({
      atSec: te.atSec ?? 0,
      title: te.title || te.label || 'Timeline event',
      confidence: te.confidence ?? 0.5,
      ...(te.source ? { source: te.source } : {}),
    });
    if (te.offset && te.title) {
      const c = coordFromOffset(te.offset);
      addLabel(
        c,
        te.title,
        'timeline_event',
        'marker',
        40,
        `timeline-event-${i + 1}`,
      );
    }
  });

  // 10. generic unknown elements
  const genericElements = spec.elements.filter(
    (e) =>
      e.generic === true &&
      ![
        'threat_zone',
        'interest_zone',
        'crowd_density_zone',
        'overwatch',
        'command_post',
        'cordon_node',
        'cctv_pick',
        'intel_note',
        'timeline_event',
      ].includes(e.type),
  );
  genericElements.forEach((ge, i) => {
    const c = coordFromOffset(ge.offset, (i * 72) % 360, outerR + 80);
    points.push(
      feature(
        { type: 'Point', coordinates: rc([c])[0] },
        {
          id: `generic-${slug(ge.type)}-${i + 1}`,
          element: ge.type,
          role: 'marker',
          priority: PRIORITY.generic || 40,
          color: teal,
          icon: 'generic',
          generic: true,
          provenance: ge.offset ? 'circle-buffer' : 'anchor',
          confidence: ge.confidence ?? 0.5,
          ...(ge.source ? { source: ge.source } : {}),
          ...(ge.evidenceTier ? { evidenceTier: ge.evidenceTier } : {}),
        },
      ),
    );
    if (ge.label) {
      addLabel(
        c,
        ge.label,
        ge.type,
        'marker',
        PRIORITY.generic || 40,
        `generic-${slug(ge.type)}-${i + 1}`,
        { generic: true },
      );
    }
    addLegend(
      ge.type,
      cleanMapLabel(ge.label || ge.type),
      'icon',
      teal,
      'generic',
    );
  });

  // Route-line placement may have supplied cones/barriers after the cordon pass said none.
  for (const key of ['cones', 'barriers'])
    if (points.some((p) => p.properties.element === key)) {
      const i = unavailable.findIndex((u) => u.element === key);
      if (i >= 0) unavailable.splice(i, 1);
    }
  // normalise legend counts for area/line groups
  for (const [key, entry] of legendCounts) {
    if (['cones', 'barriers'].includes(key))
      entry.count = points.filter((p) => p.properties.element === key).length;
    if (key === 'approach_route')
      entry.count = lines.filter(
        (l) => l.properties.element === 'approach_route',
      ).length;
    if (key === 'checkpoint')
      entry.count = points.filter(
        (p) => p.properties.element === 'checkpoint',
      ).length;
    if (
      [
        'focal',
        'inner_cordon',
        'outer_cordon',
        'staging_point',
        'egress_route',
        'route_line',
        'start_finish',
      ].includes(key)
    )
      entry.count = 1;
    if (
      [
        'threat_zone',
        'interest_zone',
        'crowd_density_zone',
        'overwatch',
        'command_post',
        'cordon_node',
        'cctv_pick',
      ].includes(key)
    ) {
      entry.count =
        areas.filter((a) => a.properties.element === key).length ||
        points.filter((p) => p.properties.element === key).length ||
        1;
    }
  }
  return {
    areas,
    lines,
    points,
    labels,
    unavailable,
    legend: [...legendCounts.values()],
    notes,
    timeline,
    footprintSource,
    accessPoints: accessPoints.length,
    closedSegments: closedSegments.length,
    stagingCoord,
    geometryMs: now() - t0,
  };
}

/** Build a one-line summary for the explanation panel (plain text, no tokens). */
export function stagingSummary(spec, anchor, counts) {
  const parts = [];
  if (counts.inner_cordon) parts.push('inner and outer cordons');
  if (counts.approach_route)
    parts.push(
      `${counts.approach_route} approach route${counts.approach_route === 1 ? '' : 's'}`,
    );
  if (counts.egress_route) parts.push('an egress route');
  if (counts.perimeter_unit)
    parts.push(`${counts.perimeter_unit} perimeter units`);
  if (counts.checkpoint) parts.push(`${counts.checkpoint} checkpoints`);
  if (counts.cones) parts.push(`${counts.cones} cones`);
  if (counts.barriers) parts.push(`${counts.barriers} barriers`);
  if (counts.route_line) parts.push('a routed course corridor');
  if (counts.crowd_zone) parts.push(`${counts.crowd_zone} crowd zones`);
  if (counts.threat_zone)
    parts.push(
      `${counts.threat_zone} threat zone${counts.threat_zone === 1 ? '' : 's'}`,
    );
  if (counts.interest_zone)
    parts.push(
      `${counts.interest_zone} interest zone${counts.interest_zone === 1 ? '' : 's'}`,
    );
  if (counts.crowd_density_zone)
    parts.push(
      `${counts.crowd_density_zone} crowd density zone${counts.crowd_density_zone === 1 ? '' : 's'}`,
    );
  if (counts.overwatch)
    parts.push(
      `${counts.overwatch} overwatch position${counts.overwatch === 1 ? '' : 's'}`,
    );
  if (counts.command_post)
    parts.push(
      `${counts.command_post} command post${counts.command_post === 1 ? '' : 's'}`,
    );
  if (counts.cordon_node)
    parts.push(
      `${counts.cordon_node} cordon node${counts.cordon_node === 1 ? '' : 's'}`,
    );
  if (counts.cctv_pick)
    parts.push(
      `${counts.cctv_pick} CCTV camera${counts.cctv_pick === 1 ? '' : 's'}`,
    );
  const place =
    String(anchor.name || '')
      .split(',')[0]
      .trim() || anchor.name;
  return `${SCENARIO_LABELS[spec.scenarioType]} around ${place}: ${parts.length ? parts.join(', ') : 'focal footprint only'}.`.slice(
    0,
    300,
  );
}

/**
 * Full engine: fetch OSM data, route with OSRM, run the pure stage, validate.
 * Never throws for data unavailability; returns a validated staging block.
 */
export function createSceneEngine({
  osm = createOsmClient(),
  now = () => Date.now(),
  budgetMs = 45000,
  log = () => {},
} = {}) {
  async function stage({
    spec,
    anchor,
    researchRoutes = [],
    signal,
    model = null,
    specMs = 0,
  }) {
    const started = now();
    const timing = {
      specMs,
      overpassMs: 0,
      routingMs: 0,
      geometryMs: 0,
      totalMs: 0,
    };
    const sources = {
      footprint: 'circle-fallback',
      roads: 'unavailable',
      routing: 'unavailable',
    };
    const innerR = first(spec, 'inner_cordon')?.params.radius_m ?? 80;
    const outerR = Math.max(
      first(spec, 'outer_cordon')?.params.radius_m ?? innerR * 2.75,
      innerR + 40,
    );
    const needsRoads = spec.elements.some((e) =>
      [
        'inner_cordon',
        'outer_cordon',
        'cones',
        'barriers',
        'perimeter_unit',
        'checkpoint',
        'staging_point',
        'route_line',
      ].includes(e.type),
    );
    let buildings = [];
    let roads = [];
    const unavailableExtra = [];
    if (needsRoads) {
      const sur = await osm.surroundings({
        lat: anchor.lat,
        lon: anchor.lon,
        buildingRadiusM: 160,
        roadRadiusM: Math.max(700, outerR * 2.5),
        signal,
      });
      timing.overpassMs = sur.ms;
      if (sur.ok) {
        buildings = sur.buildings;
        roads = sur.roads;
        sources.roads = 'overpass';
        sources.overpassEndpoint = sur.endpoint;
        sources.cacheHit = sur.cacheHit;
      } else
        unavailableExtra.push({
          element: 'outer_cordon',
          reason: `Overpass unavailable: ${sur.reason}`.slice(0, 200),
        });
    }
    // Pre-stage once (no routes) to learn access points / staging coordinate, then route.
    const pre = stageFromData({
      spec,
      anchor,
      buildings,
      roads,
      routes: {},
      researchRoutes,
      now,
    });
    const routes = {};
    const center = [anchor.lon, anchor.lat];
    const t1 = now();
    const routeTasks = [];
    const approachSpec = first(spec, 'approach_route');
    if (approachSpec) {
      const want = Math.min(4, Math.max(2, approachSpec.params.count ?? 3));
      const access = pre.points
        .filter(
          (p) =>
            p.properties.element === 'perimeter_unit' &&
            p.properties.provenance === 'turf-intersect',
        )
        .map((p) => p.geometry.coordinates);
      const targets = access.length ? access : [center];
      const baseBearing =
        BEARING[first(spec, 'staging_point')?.params.direction || 'N'];
      routes.approach = [];
      for (let i = 0; i < want; i++) {
        const bearing = (baseBearing + 180 + (360 / want) * i) % 360;
        const origin = turf.destination(
          turf.point(center),
          km(Math.max(1200, outerR * 5)),
          bearing,
          { units: 'kilometers' },
        ).geometry.coordinates;
        const target = targets[i % targets.length];
        routeTasks.push(
          osm.route(origin, target, { signal }).then((r) => {
            if (
              r.ok &&
              !routes.approach.some((x) => x.distanceM === r.distanceM)
            )
              routes.approach.push({
                coordinates: r.coordinates,
                distanceM: r.distanceM,
              });
            else if (!r.ok)
              routes.approachReason = `routing unavailable: ${r.reason}`.slice(
                0,
                200,
              );
          }),
        );
      }
    }
    const egressSpec = first(spec, 'egress_route');
    if (egressSpec) {
      const bearing = BEARING[egressSpec.params.direction || 'NE'];
      const from =
        pre.stagingCoord &&
        egressSpec.params.direction ===
          first(spec, 'staging_point')?.params.direction
          ? pre.stagingCoord
          : center;
      const to = turf.destination(
        turf.point(center),
        km(Math.max(1500, outerR * 6)),
        bearing,
        { units: 'kilometers' },
      ).geometry.coordinates;
      routeTasks.push(
        osm.route(from, to, { signal }).then((r) => {
          if (r.ok)
            routes.egress = {
              coordinates: r.coordinates,
              distanceM: r.distanceM,
            };
          else
            routes.egressReason = `routing unavailable: ${r.reason}`.slice(
              0,
              200,
            );
        }),
      );
    }
    const routeLineSpec = first(spec, 'route_line');
    if (
      routeLineSpec &&
      !researchRoutes.some(
        (r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2,
      )
    ) {
      // Named major road (e.g. "Sheikh Zayed Road") → route its far ends; else the longest major road nearby.
      const named = roads.filter(
        (r) =>
          r.properties.major &&
          r.properties.name &&
          nameMatches(spec.focalEntity.name, r.properties.name),
      );
      const pool = named.length
        ? named
        : roads.filter((r) => r.properties.major);
      if (pool.length) {
        const allCoords = pool.flatMap((r) => r.geometry.coordinates);
        let a = allCoords[0];
        let b = allCoords[0];
        let best = 0;
        for (const p of allCoords)
          for (const q of allCoords) {
            const d = turf.distance(turf.point(p), turf.point(q), {
              units: 'kilometers',
            });
            if (d > best) {
              best = d;
              a = p;
              b = q;
            }
          }
        const span = Math.min(routeLineSpec.params.radius_m ?? 1500, 5000);
        const ab = turf.bearing(turf.point(a), turf.point(b));
        const start = turf.destination(turf.point(center), km(span), ab + 180, {
          units: 'kilometers',
        }).geometry.coordinates;
        const end = turf.destination(turf.point(center), km(span), ab, {
          units: 'kilometers',
        }).geometry.coordinates;
        routeTasks.push(
          osm.route(start, end, { signal }).then((r) => {
            if (r.ok)
              routes.routeLine = {
                coordinates: r.coordinates,
                distanceM: r.distanceM,
                name: pool[0].properties.name || '',
              };
            else
              routes.routeLineReason = `routing unavailable: ${r.reason}`.slice(
                0,
                200,
              );
          }),
        );
      } else
        routes.routeLineReason = roads.length
          ? 'no major road near the anchor to derive a corridor'
          : 'road network unavailable (Overpass)';
    }
    if (routeTasks.length) {
      await Promise.race([
        Promise.allSettled(routeTasks),
        new Promise((r) =>
          setTimeout(r, Math.max(1000, budgetMs - (now() - started))),
        ),
      ]);
      timing.routingMs = now() - t1;
      if (routes.approach?.length || routes.egress || routes.routeLine)
        sources.routing = 'osrm';
    }
    const staged = stageFromData({
      spec,
      anchor,
      buildings,
      roads,
      routes,
      researchRoutes,
      now,
    });
    sources.footprint = staged.footprintSource;
    timing.geometryMs = pre.geometryMs + staged.geometryMs;
    timing.totalMs = now() - started + specMs;
    const counts = {};
    for (const f of [...staged.areas, ...staged.lines, ...staged.points]) {
      // crowd zones are area + marker pairs; count the areas only
      if (f.properties.element === 'crowd_zone' && f.geometry.type === 'Point')
        continue;
      counts[f.properties.element] = (counts[f.properties.element] || 0) + 1;
    }
    const raw = {
      version: SCENE_STAGING_VERSION,
      illustrative: true,
      spec,
      anchor: { name: anchor.name, lat: anchor.lat, lon: anchor.lon },
      model: model || {
        provider: 'template',
        id: 'scenario-template',
        latencyMs: 0,
        attempts: [],
        repaired: true,
        reasons: ['no model result supplied'],
        fallback: 'template',
      },
      timing,
      sources,
      unavailable: [...unavailableExtra, ...staged.unavailable].slice(0, 40),
      layers: {
        areas: { type: 'FeatureCollection', features: staged.areas },
        lines: { type: 'FeatureCollection', features: staged.lines },
        points: { type: 'FeatureCollection', features: staged.points },
        labels: { type: 'FeatureCollection', features: staged.labels },
      },
      badge: { text: STAGING_BADGE_TEXT, single: true },
      legend: staged.legend,
      summary: stagingSummary(spec, anchor, counts),
      ...(staged.notes?.length ? { notes: staged.notes } : {}),
      ...(staged.timeline?.length ? { timeline: staged.timeline } : {}),
    };
    const staging = validateSceneStaging(raw);
    log({
      event: 'staging',
      scenario: spec.scenarioType,
      anchor: anchor.name,
      timing,
      sources,
      accessPoints: staged.accessPoints,
      closedSegments: staged.closedSegments,
      unavailable: staging.unavailable.length,
    });
    return staging;
  }
  return { stage };
}
