/**
 * AOI scene policy — decides which authored/saved scenes the Scene panel and
 * playback may show. The project document is NOT mutated: out-of-AOI scenes
 * (e.g. the bundled "Nepal Flood Incident", "Global Flights Radar") stay in
 * storage and in exports; they are simply filtered at load with a reason.
 *
 * A scene is IN AOI when any of its shot cameras (or scene anchors) lands
 * inside a configured AOI (buffers included). Shots looking at the whole
 * globe (altitude above `globalAltitudeM`) do not count as evidence either
 * way — a global pull-back inside an otherwise-UAE scene keeps the scene.
 */

export const GLOBAL_ALTITUDE_M = 3_000_000;

function points(scene, { globalAltitudeM = GLOBAL_ALTITUDE_M } = {}) {
  const out = [];
  for (const anchor of scene?.anchors || []) {
    if (Number.isFinite(anchor?.lat) && Number.isFinite(anchor?.lon))
      out.push({ lat: anchor.lat, lon: anchor.lon, kind: 'anchor' });
  }
  for (const shot of scene?.shots || []) {
    const cam = shot?.camera;
    if (!cam || !Number.isFinite(cam.lat) || !Number.isFinite(cam.lon))
      continue;
    if (Number.isFinite(cam.alt) && cam.alt > globalAltitudeM) continue;
    out.push({ lat: cam.lat, lon: cam.lon, kind: 'camera', alt: cam.alt });
  }
  return out;
}

/**
 * @param {{membership:(lat:number,lon:number)=>{inside:boolean,aoi_ids:string[],reason:string,nearest?:{name:string,km:number}}}} index
 * @param {{globalAltitudeM?:number, alwaysVisibleIds?:string[]}} [options]
 */
export function createAoiScenePolicy(index, options = {}) {
  const always = new Set(options.alwaysVisibleIds || []);
  function classify(scene) {
    if (!scene) return { visible: false, reason: 'OUT_OF_AOI: empty scene' };
    if (always.has(scene.id))
      return { visible: true, reason: 'ALLOWLIST', aoi_ids: [] };
    const pts = points(scene, options);
    if (!pts.length)
      return {
        visible: false,
        reason: 'OUT_OF_AOI: scene has no shots inside a regional camera range',
        aoi_ids: [],
      };
    let nearest = null;
    const hits = new Set();
    for (const p of pts) {
      const m = index.membership(p.lat, p.lon);
      if (m.inside) for (const id of m.aoi_ids) hits.add(id);
      if (m.nearest && (!nearest || m.nearest.km < nearest.km))
        nearest = m.nearest;
    }
    if (hits.size)
      return { visible: true, reason: 'IN_AOI', aoi_ids: [...hits] };
    return {
      visible: false,
      aoi_ids: [],
      reason: nearest
        ? `OUT_OF_AOI: nearest AOI ${nearest.name} at ${nearest.km} km`
        : 'OUT_OF_AOI: no AOI configured',
    };
  }
  /** Split a scene list into visible scenes and hidden {id,title,reason} entries. */
  function partition(scenes) {
    const visible = [];
    const hidden = [];
    for (const scene of scenes || []) {
      const c = classify(scene);
      if (c.visible) visible.push(scene);
      else hidden.push({ id: scene.id, title: scene.title, reason: c.reason });
    }
    return { visible, hidden };
  }
  return { classify, partition };
}
