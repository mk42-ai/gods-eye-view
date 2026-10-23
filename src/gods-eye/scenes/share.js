/**
 * Gods-Eye scene engine — share link encoder/decoder.
 * Encodes sc=<sceneId> + fallback fv/fk/fm/fs/gr + camera parameters.
 * Distinguishes legacy sc=0|1 scope toggle from scene IDs starting with 's_'.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

import { createScene } from './models.js';

function toSearchParams(input) {
  if (input instanceof URLSearchParams) return input;
  let str = String(input || '');
  if (str.includes('#')) {
    str = str.slice(str.indexOf('#') + 1);
  } else if (str.includes('?')) {
    str = str.slice(str.indexOf('?') + 1);
  }
  return new URLSearchParams(str);
}

/**
 * Encodes a scene into URLSearchParams.
 *
 * @param {URLSearchParams} params
 * @param {object} scene
 * @returns {URLSearchParams}
 */
export function encodeSceneShare(params, scene) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams();
  if (!scene) return p;

  if (scene.id) {
    p.set('sc', scene.id);
  }

  p.set('fv', '1');

  if (scene.prompt) {
    p.set('fk', scene.prompt);
  } else {
    p.delete('fk');
  }

  if (scene.kind) {
    p.set('fm', scene.kind);
  } else {
    p.delete('fm');
  }

  if (scene.tRef) {
    p.set('fs', scene.tRef);
  } else {
    p.delete('fs');
  }

  if (
    scene.route?.approachBearing !== undefined &&
    scene.route?.approachBearing !== null
  ) {
    p.set('gr', String(scene.route.approachBearing));
  }

  const cam = scene.camera || {};
  const target = scene.target || {};
  const lat = cam.lat ?? target.lat;
  const lon = cam.lon ?? target.lon;

  if (lat !== undefined && lat !== null) p.set('lat', String(lat));
  if (lon !== undefined && lon !== null) p.set('lon', String(lon));
  if (target.lat !== undefined && target.lat !== null)
    p.set('tlat', Number(target.lat).toFixed(4));
  if (target.lon !== undefined && target.lon !== null)
    p.set('tlon', Number(target.lon).toFixed(4));
  if (target.name) p.set('tn', String(target.name).slice(0, 60));
  if (cam.alt !== undefined && cam.alt !== null) p.set('alt', String(cam.alt));
  if (cam.heading !== undefined && cam.heading !== null)
    p.set('heading', String(cam.heading));
  if (cam.pitch !== undefined && cam.pitch !== null)
    p.set('pitch', String(cam.pitch));
  if (cam.roll !== undefined && cam.roll !== null)
    p.set('roll', String(cam.roll));

  return p;
}

/**
 * Decodes URL parameters or hash into scene share info.
 * Legacy sc=0|1 is treated as scope toggle (returns sceneId: null).
 *
 * @param {string|URLSearchParams} input
 * @returns {{ sceneId: string|null, fallback: object|null }}
 */
export function decodeSceneShare(input) {
  const p = toSearchParams(input);
  const sc = p.get('sc');
  const sceneId = sc && sc.startsWith('s_') ? sc : null;

  // Only a link the scene engine wrote carries fv=1 together with fm/fk —
  // a plain legacy camera hash (lat/lon only) must NOT conjure a scene
  // (HARD RULE §0: share-URL load = zero media, zero fetch, no scene).
  const hasFallback =
    p.get('fv') === '1' && (p.has('fm') || p.has('fk')) && p.has('lat');

  if (!hasFallback && !sceneId) {
    return { sceneId: null, fallback: null };
  }

  const lat = p.has('lat') ? Number(p.get('lat')) : null;
  const lon = p.has('lon') ? Number(p.get('lon')) : null;
  const alt = p.has('alt') ? Number(p.get('alt')) : 18000;
  const heading = p.has('heading') ? Number(p.get('heading')) : 0;
  const pitch = p.has('pitch') ? Number(p.get('pitch')) : 60;
  const roll = p.has('roll') ? Number(p.get('roll')) : 0;

  const tlat = p.has('tlat') ? Number(p.get('tlat')) : lat;
  const tlon = p.has('tlon') ? Number(p.get('tlon')) : lon;
  const fallback = {
    tlat,
    tlon,
    tn: p.get('tn') || null,
    fv: p.get('fv'),
    visible: p.get('fv') === '1',
    fk: p.get('fk') || '',
    keywords: p.get('fk') || '',
    fm: p.get('fm') || 'live',
    mode: p.get('fm') || 'live',
    fs: p.get('fs') || null,
    tRef: p.get('fs') || null,
    since: p.get('fs') || null,
    gr: p.has('gr') ? Number(p.get('gr')) : null,
    approachBearing: p.has('gr') ? Number(p.get('gr')) : null,
    lat,
    lon,
    alt,
    heading,
    pitch,
    roll,
    camera:
      lat !== null && lon !== null
        ? { lat, lon, alt, heading, pitch, roll }
        : null,
  };

  return { sceneId, fallback };
}

/**
 * Rebuilds a minimal Scene from fallback parameters with zero network.
 *
 * @param {object} fallback
 * @param {number} [nowMs=Date.now()]
 * @returns {object|null}
 */
export function sceneFromFallback(fallback, nowMs = Date.now()) {
  if (!fallback) return null;

  const lat = fallback.camera?.lat ?? fallback.lat ?? 0;
  const lon = fallback.camera?.lon ?? fallback.lon ?? 0;
  const kind = fallback.mode || fallback.fm || 'live';
  const prompt = fallback.keywords || fallback.fk || '';
  const tRef =
    fallback.tRef ||
    fallback.since ||
    fallback.fs ||
    new Date(nowMs).toISOString();
  const approachBearing = fallback.approachBearing ?? fallback.gr ?? 0;

  return createScene(
    {
      kind,
      prompt,
      title: prompt || 'Shared Scene',
      tRef,
      target: {
        name: fallback.tn || prompt || 'Shared Target',
        lat: fallback.tlat ?? lat,
        lon: fallback.tlon ?? lon,
        geocodeSource: 'prompt',
        confidence: 1,
      },
      camera: {
        lat,
        lon,
        alt: fallback.camera?.alt ?? fallback.alt ?? 18000,
        heading: fallback.camera?.heading ?? fallback.heading ?? 0,
        pitch: fallback.camera?.pitch ?? fallback.pitch ?? 60,
        roll: fallback.camera?.roll ?? fallback.roll ?? 0,
        stage: 'S4',
      },
      route: {
        approachBearing,
        fallback: true,
        basis: 'share-fallback',
      },
      status: 'saved',
    },
    nowMs,
  );
}
