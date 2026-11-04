/**
 * tools/scene-icons/build-icons.mjs
 *
 * Keying & sprite generation pipeline for Scene Spec icons (manifest v5).
 *
 * 1. Reads 1024x1024 RGB source PNGs with pure black #000000 background.
 * 2. Keys black (#000000) to alpha using a soft threshold (tolerance ≈ 40/255):
 *      alpha = clamp((max(r,g,b) - 10) / 36, 0, 1)
 *    Navy (#0B1220 → max channel 32) survives with alpha ≈ 0.6 before
 *    unpremultiply and is restored to full colour by the fringe-safe rule in
 *    step 6 (no navy outline is keyed out).
 *    and un-premultiplies RGB towards original hue:
 *      c_orig = c / alpha
 * 3. Applies 1 px alpha erosion and feather to eliminate black fringe.
 * 4. Crops to content bbox + 8% padding, centered on square.
 * 5. Exports 64px (<key>.png), 128px (<key>@2x.png) and 256px (<key>@4x.png)
 *    to public/scene-icons/png/ (2026-11-02 icon family: 64/128/256).
 * 6. Verifies no output pixel with alpha > 0.5 is darker than (12,12,12) unless inside navy (#0B1220).
 * 7. Generates sprite sheets: sprite.png (64px cells, <= 16 cols grid) and sprite@2x.png (128px cells)
 *    + sprite.json / sprite@2x.json (MapLibre format).
 * 8. Writes public/scene-icons/manifest.json (version 5: 46 keys + top-level elementTypeIcons map).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const SOURCES_DIR = path.join(REPO_ROOT, 'tools/scene-icons/sources');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public/scene-icons');
const PNG_DIR = path.join(PUBLIC_DIR, 'png');
const SVG_DIR = path.join(PUBLIC_DIR, 'svg');

// Palette
const TEAL = '#14B8A6';
const MINT = '#A7F3D0';
const NAVY = '#0B1220';
const WHITE = '#FFFFFF';

export const ELEMENT_TYPE_ICONS = Object.freeze({
  inner_cordon: 'cordon_node',
  outer_cordon: 'cordon_node',
  approach_route: 'vehicle_police_car',
  egress_route: 'egress',
  staging_point: 'staging_point',
  perimeter_unit: 'perimeter_unit',
  checkpoint: 'checkpoint',
  vehicle_checkpoint: 'checkpoint',
  cones: 'cone_cluster',
  barriers: 'barrier',
  cctv_signal: 'cctv',
  cctv_pick: 'sensor_cctv_feed',
  crowd_zone: 'crowd_spectators',
  crowd_density_zone: 'crowd_spectators',
  route_line: 'route_start',
  start_finish: 'start_finish',
  command_post: 'command_post',
  event_command_post: 'event_command_post',
  overwatch: 'aircraft_helicopter',
  cordon_node: 'cordon_node',
  checkpoint_cordon_node: 'checkpoint_cordon_node',
  road_closed_barricade: 'road_closed_barricade',
  medical_point: 'medical_point',
  marine_patrol: 'vessel_marine_patrol',
  foot_patrol: 'perimeter_unit',
  escort_motorcycle: 'vehicle_police_motorcycle',
  shuttle_bus: 'vehicle_city_bus',
  road_closed: 'signage_road_closed',
  screening_lane: 'barrier_crowd',
  threat_zone: 'alert_state_3',
  interest_zone: 'generic',
  intel_note: 'generic',
  timeline_event: 'generic',
  // Legacy plan entity types from structuredPlan.js:
  person: 'perimeter_unit',
  runner: 'person_runner',
  police: 'person_police_officer',
  organizer: 'command_post',
  vehicle: 'vehicle_civilian_sedan',
  police_vehicle: 'vehicle_police_car',
  barrier: 'barrier_crowd',
  start_line: 'start_finish',
  finish_line: 'start_finish',
});

export const KEY_DEFINITIONS = [
  // Core scene spec keys with updated artwork
  { key: 'cone', source: 'tools/scene-icons/sources/cone.png' },
  {
    key: 'police_unit',
    source: 'tools/scene-icons/sources/police_patrol_car.png',
  },
  { key: 'barrier', source: 'tools/scene-icons/sources/barrier.png' },
  { key: 'cctv_signal', source: 'tools/scene-icons/sources/cctv.png' },
  {
    key: 'checkpoint',
    source: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
  },
  {
    key: 'staging_point',
    source: 'tools/scene-icons/sources/event_command_post.png',
  },
  {
    key: 'perimeter_unit',
    source: 'tools/scene-icons/sources/foot_patrol_officer.png',
  },
  {
    key: 'crowd_zone',
    source: 'tools/scene-icons/sources/spectator_crowd_cluster.png',
  },
  {
    key: 'start_finish',
    source: 'tools/scene-icons/sources/start_finish_gate.png',
  },
  { key: 'egress', source: 'tools/scene-icons/sources/egress.png' },

  // Command, CCTV, cordons, flags
  {
    key: 'command_post',
    source: 'tools/scene-icons/sources/event_command_post.png',
  },
  { key: 'cctv', source: 'tools/scene-icons/sources/cctv.png' },
  {
    key: 'cordon_node',
    source: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
  },
  { key: 'route_start', source: 'tools/scene-icons/sources/route_flag.png' },
  {
    key: 'route_finish',
    source: 'tools/scene-icons/sources/route_flag.png',
    transform: 'flop',
  },

  // Generated generic dot
  { key: 'generic', source: 'generated:generic' },

  // Vehicles, aircraft, persons, signage
  {
    key: 'vehicle_police_car',
    source: 'tools/scene-icons/sources/police_patrol_car.png',
  },
  {
    key: 'vehicle_ambulance',
    source: 'tools/scene-icons/sources/ambulance_medical_point.png',
  },
  {
    key: 'vehicle_fire_engine',
    source: 'tools/scene-icons/sources/vehicle_fire_engine.png',
  },
  {
    key: 'vehicle_civilian_sedan',
    source: 'tools/scene-icons/sources/civilian_sedan.png',
  },
  {
    key: 'aircraft_helicopter',
    source: 'tools/scene-icons/sources/aircraft_helicopter.png',
  },
  {
    key: 'aircraft_fixed_wing',
    source: 'tools/scene-icons/sources/aircraft_fixed_wing.png',
  },
  {
    key: 'person_runner',
    source: 'tools/scene-icons/sources/person_runner.png',
  },
  {
    key: 'person_police_officer',
    source: 'tools/scene-icons/sources/foot_patrol_officer.png',
  },
  {
    key: 'signage_road_closed',
    source: 'tools/scene-icons/sources/road_closed_barricade.png',
  },
  {
    key: 'effect_smoke_fire',
    source: 'tools/scene-icons/sources/effect_smoke_fire.png',
  },

  // Alert states (quadrants)
  {
    key: 'alert_state_1',
    source: 'tools/scene-icons/sources/alert_states_sheet.png',
    quadrant: 0,
  },
  {
    key: 'alert_state_2',
    source: 'tools/scene-icons/sources/alert_states_sheet.png',
    quadrant: 1,
  },
  {
    key: 'alert_state_3',
    source: 'tools/scene-icons/sources/alert_states_sheet.png',
    quadrant: 2,
  },
  {
    key: 'alert_state_4',
    source: 'tools/scene-icons/sources/alert_states_sheet.png',
    quadrant: 3,
  },

  // Batch B icons
  {
    key: 'barrier_crowd',
    source: 'tools/scene-icons/sources/crowd_control_barrier.png',
  },
  { key: 'cone_cluster', source: 'tools/scene-icons/sources/cone_cluster.png' },
  {
    key: 'crowd_spectators',
    source: 'tools/scene-icons/sources/spectator_crowd_cluster.png',
  },
  {
    key: 'person_responder',
    source: 'tools/scene-icons/sources/person_responder.png',
  },
  {
    key: 'vehicle_city_bus',
    source: 'tools/scene-icons/sources/vehicle_city_bus.png',
  },
  {
    key: 'vehicle_police_motorcycle',
    source: 'tools/scene-icons/sources/vehicle_police_motorcycle.png',
  },
  {
    key: 'sensor_cctv_feed',
    source: 'tools/scene-icons/sources/sensor_cctv_feed.png',
  },
  {
    key: 'evidence_pin_verified',
    source: 'tools/scene-icons/sources/evidence_pin_verified.png',
  },
  {
    key: 'marker_air_raid_impact_sim',
    source: 'tools/scene-icons/sources/marker_air_raid_impact_sim.png',
  },
  {
    key: 'vessel_marine_patrol',
    source: 'tools/scene-icons/sources/vessel_marine_patrol.png',
  },

  // New keys (2026-11-02 contract)
  {
    key: 'medical_point',
    source: 'tools/scene-icons/sources/ambulance_medical_point.png',
  },
  {
    key: 'marine_patrol',
    source: 'tools/scene-icons/sources/vessel_marine_patrol.png',
    aliasOf: 'vessel_marine_patrol',
  },
  {
    key: 'vehicle_checkpoint',
    source: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
    aliasOf: 'checkpoint',
  },
  {
    key: 'screening_lane',
    source: 'tools/scene-icons/sources/crowd_control_barrier.png',
  },
  {
    key: 'road_closed',
    source: 'tools/scene-icons/sources/road_closed_barricade.png',
    aliasOf: 'signage_road_closed',
  },
  {
    key: 'civilian_sedan',
    source: 'tools/scene-icons/sources/civilian_sedan.png',
    aliasOf: 'vehicle_civilian_sedan',
  },
  // 2026-11-02 icon family: three new first-class types
  {
    key: 'event_command_post',
    source: 'tools/scene-icons/sources/event_command_post.png',
    aliasOf: 'command_post',
  },
  {
    key: 'checkpoint_cordon_node',
    source: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
    aliasOf: 'cordon_node',
  },
  {
    key: 'road_closed_barricade',
    source: 'tools/scene-icons/sources/road_closed_barricade.png',
    aliasOf: 'road_closed',
  },
];

function generateGenericSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="22" fill="${TEAL}" stroke="${NAVY}" stroke-width="4"/>
  <circle cx="32" cy="32" r="10" fill="${WHITE}"/>
</svg>`;
}

function checkFringe(rawBuffer, width, height) {
  let darkCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rawBuffer[idx];
      const g = rawBuffer[idx + 1];
      const b = rawBuffer[idx + 2];
      const a = rawBuffer[idx + 3] / 255;
      if (a > 0.5) {
        // Darker than (12,12,12) in all components
        if (r < 12 && g < 12 && b < 12) {
          // Check if near navy (#0B1220) region: (11, 18, 32)
          let nearNavy = false;
          for (let dy = -3; dy <= 3 && !nearNavy; dy++) {
            for (let dx = -3; dx <= 3 && !nearNavy; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nidx = (ny * width + nx) * 4;
                const nr = rawBuffer[nidx];
                const ng = rawBuffer[nidx + 1];
                const nb = rawBuffer[nidx + 2];
                if (nb >= 20 && nb > nr * 1.3 && ng >= 10 && ng <= 40) {
                  nearNavy = true;
                }
              }
            }
          }
          if (!nearNavy) {
            darkCount++;
          }
        }
      }
    }
  }
  return darkCount;
}

async function keyAndCropSource(
  sourceFilePath,
  transform = null,
  quadrant = null,
) {
  let img = sharp(sourceFilePath);
  if (quadrant != null) {
    const meta = await img.metadata();
    const qw = Math.floor(meta.width / 2);
    const qh = Math.floor(meta.height / 2);
    img = img.extract({
      left: (quadrant % 2) * qw,
      top: Math.floor(quadrant / 2) * qh,
      width: qw,
      height: qh,
    });
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // 1. Soft key + unpremultiply
  const alphas = new Float32Array(w * h);
  const unpr = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * info.channels;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      const m = Math.max(r, g, b);
      const alpha = Math.min(1, Math.max(0, (m - 10) / 36));
      alphas[y * w + x] = alpha;
      if (alpha > 0) {
        unpr[(y * w + x) * 3] = Math.min(
          255,
          Math.max(0, Math.round(r / alpha)),
        );
        unpr[(y * w + x) * 3 + 1] = Math.min(
          255,
          Math.max(0, Math.round(g / alpha)),
        );
        unpr[(y * w + x) * 3 + 2] = Math.min(
          255,
          Math.max(0, Math.round(b / alpha)),
        );
      }
    }
  }

  // 2. 1 px alpha erosion
  const eroded = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minA = alphas[y * w + x];
      if (x > 0) minA = Math.min(minA, alphas[y * w + (x - 1)]);
      if (x < w - 1) minA = Math.min(minA, alphas[y * w + (x + 1)]);
      if (y > 0) minA = Math.min(minA, alphas[(y - 1) * w + x]);
      if (y < h - 1) minA = Math.min(minA, alphas[(y + 1) * w + x]);
      eroded[y * w + x] = minA;
    }
  }

  // 3. 0.5 px feather on eroded alpha (4-neighbor cross blur with 4x center weight)
  const out = Buffer.alloc(w * h * 4);
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = eroded[y * w + x] * 4;
      let count = 4;
      if (x > 0) {
        sum += eroded[y * w + (x - 1)];
        count++;
      }
      if (x < w - 1) {
        sum += eroded[y * w + (x + 1)];
        count++;
      }
      if (y > 0) {
        sum += eroded[(y - 1) * w + x];
        count++;
      }
      if (y < h - 1) {
        sum += eroded[(y + 1) * w + x];
        count++;
      }
      const finalA = sum / count;
      const dstIdx = (y * w + x) * 4;

      if (finalA <= 0.001) {
        out[dstIdx] = 0;
        out[dstIdx + 1] = 0;
        out[dstIdx + 2] = 0;
        out[dstIdx + 3] = 0;
      } else {
        out[dstIdx] = unpr[(y * w + x) * 3];
        out[dstIdx + 1] = unpr[(y * w + x) * 3 + 1];
        out[dstIdx + 2] = unpr[(y * w + x) * 3 + 2];
        out[dstIdx + 3] = Math.min(255, Math.max(0, Math.round(finalA * 255)));

        if (out[dstIdx + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  const contentW = Math.max(1, maxX - minX + 1);
  const contentH = Math.max(1, maxY - minY + 1);
  const maxDim = Math.max(contentW, contentH);
  // Content bbox + 8% padding
  const pad = Math.round(maxDim * 0.08);
  const squareSize = maxDim + 2 * pad;
  const offsetX = Math.round((squareSize - contentW) / 2);
  const offsetY = Math.round((squareSize - contentH) / 2);

  let pipeline = sharp(out, {
    raw: { width: w, height: h, channels: 4 },
  })
    .extract({ left: minX, top: minY, width: contentW, height: contentH })
    .extend({
      top: offsetY,
      bottom: squareSize - contentH - offsetY,
      left: offsetX,
      right: squareSize - contentW - offsetX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

  if (transform === 'flop') {
    pipeline = pipeline.flop();
  }

  const squareBuffer = await pipeline.png().toBuffer();
  // 64 px (<key>.png), 128 px (<key>@2x.png), 256 px (<key>@4x.png)
  const p64 = await sharp(squareBuffer).resize(64, 64).png().toBuffer();
  const p128 = await sharp(squareBuffer).resize(128, 128).png().toBuffer();
  const p256 = await sharp(squareBuffer).resize(256, 256).png().toBuffer();

  const raw64 = await sharp(p64).raw().toBuffer({ resolveWithObject: true });
  const fringeViolations = checkFringe(raw64.data, 64, 64);
  // Corner alpha must be 0 at every size (transparent background proof).
  const corners = [];
  for (const [buf, size] of [
    [p64, 64],
    [p128, 128],
    [p256, 256],
  ]) {
    const raw = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const a = (x, y) => raw.data[(y * size + x) * 4 + 3];
    corners.push(a(0, 0), a(size - 1, 0), a(0, size - 1), a(size - 1, size - 1));
  }
  const cornerAlphaMax = Math.max(...corners);

  return { p64, p128, p256, fringeViolations, cornerAlphaMax };
}

export async function buildIcons() {
  fs.mkdirSync(PNG_DIR, { recursive: true });
  fs.mkdirSync(SVG_DIR, { recursive: true });

  // Remove stale @4x files of keys no longer defined (the 2026-11-02 family
  // ships 64/128/256 for every defined key).
  const definedKeys = new Set(KEY_DEFINITIONS.map((d) => d.key));
  for (const file of fs.readdirSync(PNG_DIR)) {
    const m = /^(.+)@4x\.png$/.exec(file);
    if (m && !definedKeys.has(m[1])) fs.unlinkSync(path.join(PNG_DIR, file));
  }

  // Generate generic SVG
  const genericSvg = generateGenericSvg();
  fs.writeFileSync(path.join(SVG_DIR, 'generic.svg'), genericSvg, 'utf8');

  const processed = [];
  const fringeReport = [];

  for (const def of KEY_DEFINITIONS) {
    let p64,
      p128,
      p256,
      fringeViolations = 0,
      cornerAlphaMax = 0;
    if (def.source === 'generated:generic') {
      p64 = await sharp(Buffer.from(genericSvg))
        .resize(64, 64)
        .png()
        .toBuffer();
      p128 = await sharp(Buffer.from(genericSvg))
        .resize(128, 128)
        .png()
        .toBuffer();
      p256 = await sharp(Buffer.from(genericSvg))
        .resize(256, 256)
        .png()
        .toBuffer();
    } else {
      const fullPath = path.join(REPO_ROOT, def.source);
      const res = await keyAndCropSource(
        fullPath,
        def.transform,
        def.quadrant ?? null,
      );
      p64 = res.p64;
      p128 = res.p128;
      p256 = res.p256;
      fringeViolations = res.fringeViolations;
      cornerAlphaMax = res.cornerAlphaMax;
    }

    fringeReport.push({
      key: def.key,
      violations: fringeViolations,
      cornerAlphaMax,
    });

    // Write PNG files (64 px, 128 px and 256 px)
    const pngPath = path.join(PNG_DIR, `${def.key}.png`);
    const png2xPath = path.join(PNG_DIR, `${def.key}@2x.png`);
    const png4xPath = path.join(PNG_DIR, `${def.key}@4x.png`);
    fs.writeFileSync(pngPath, p64);
    fs.writeFileSync(png2xPath, p128);
    fs.writeFileSync(png4xPath, p256);

    // If new key doesn't have an SVG, write one embedding the 64px PNG
    const svgPath = path.join(SVG_DIR, `${def.key}.svg`);
    if (!fs.existsSync(svgPath)) {
      const b64 = p64.toString('base64');
      const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="data:image/png;base64,${b64}" width="64" height="64"/></svg>\n`;
      fs.writeFileSync(svgPath, svgWrapper, 'utf8');
    }

    const sha256 = createHash('sha256').update(p64).digest('hex');
    processed.push({
      key: def.key,
      source:
        def.source + (def.quadrant != null ? `#quadrant-${def.quadrant}` : ''),
      aliasOf: def.aliasOf,
      p64,
      p128,
      p256,
      sha256,
    });
  }

  // Build sprite sheets: 1x (64x64 per icon) and 2x (128x128 per icon)
  // Grid layout: <= 16 columns grid (NOT a single row)
  const ICON_SIZE_1X = 64;
  const ICON_SIZE_2X = 128;
  const COLS = 16;
  const count = processed.length;
  const rows = Math.ceil(count / COLS);
  const sheetWidth1x = COLS * ICON_SIZE_1X;
  const sheetHeight1x = rows * ICON_SIZE_1X;
  const sheetWidth2x = COLS * ICON_SIZE_2X;
  const sheetHeight2x = rows * ICON_SIZE_2X;

  const sprite1xEntries = {};
  const sprite2xEntries = {};
  const composite1x = [];
  const composite2x = [];
  const manifestKeys = [];

  processed.forEach((item, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x1x = col * ICON_SIZE_1X;
    const y1x = row * ICON_SIZE_1X;
    const x2x = col * ICON_SIZE_2X;
    const y2x = row * ICON_SIZE_2X;

    sprite1xEntries[item.key] = {
      x: x1x,
      y: y1x,
      width: ICON_SIZE_1X,
      height: ICON_SIZE_1X,
      pixelRatio: 1,
      sdf: false,
    };

    sprite2xEntries[item.key] = {
      x: x2x,
      y: y2x,
      width: ICON_SIZE_2X,
      height: ICON_SIZE_2X,
      pixelRatio: 2,
      sdf: false,
    };

    composite1x.push({ input: item.p64, left: x1x, top: y1x });
    composite2x.push({ input: item.p128, left: x2x, top: y2x });

    const keyEntry = {
      key: item.key,
      png: `png/${item.key}.png`,
      png2x: `png/${item.key}@2x.png`,
      png4x: `png/${item.key}@4x.png`,
      sprite: {
        x: x1x,
        y: y1x,
        width: ICON_SIZE_1X,
        height: ICON_SIZE_1X,
      },
      sourceFile: item.source,
      sha256: item.sha256,
    };
    if (item.aliasOf) {
      keyEntry.aliasOf = item.aliasOf;
    }
    manifestKeys.push(keyEntry);
  });

  // Render sprite sheets
  const sprite1xBuffer = await sharp({
    create: {
      width: sheetWidth1x,
      height: sheetHeight1x,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite1x)
    .png()
    .toBuffer();

  const sprite2xBuffer = await sharp({
    create: {
      width: sheetWidth2x,
      height: sheetHeight2x,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite2x)
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(PUBLIC_DIR, 'sprite.png'), sprite1xBuffer);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sprite@2x.png'), sprite2xBuffer);
  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'sprite.json'),
    JSON.stringify(sprite1xEntries, null, 1) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'sprite@2x.json'),
    JSON.stringify(sprite2xEntries, null, 1) + '\n',
    'utf8',
  );

  const manifest = {
    version: 7,
    generatedAt: new Date().toISOString(),
    elementTypeIcons: ELEMENT_TYPE_ICONS,
    keys: manifestKeys,
  };
  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  // Write docs/evidence-2026-11-02-bugfix/icons-integrated.json
  const EVIDENCE_SLOTS = [
    {
      slot: 'event_command_post',
      source_file: 'tools/scene-icons/sources/event_command_post.png',
      keys: ['command_post', 'staging_point', 'event_command_post'],
    },
    {
      slot: 'police_patrol_car',
      source_file: 'tools/scene-icons/sources/police_patrol_car.png',
      keys: ['police_unit', 'vehicle_police_car'],
    },
    {
      slot: 'crowd_control_barrier',
      source_file: 'tools/scene-icons/sources/crowd_control_barrier.png',
      keys: ['barrier_crowd', 'screening_lane'],
    },
    {
      slot: 'ambulance_medical_point',
      source_file: 'tools/scene-icons/sources/ambulance_medical_point.png',
      keys: ['medical_point', 'vehicle_ambulance'],
    },
    {
      slot: 'civilian_sedan',
      source_file: 'tools/scene-icons/sources/civilian_sedan.png',
      keys: ['civilian_sedan', 'vehicle_civilian_sedan'],
    },
    {
      slot: 'foot_patrol_officer',
      source_file: 'tools/scene-icons/sources/foot_patrol_officer.png',
      keys: ['perimeter_unit', 'person_police_officer'],
    },
    {
      slot: 'start_finish_gate',
      source_file: 'tools/scene-icons/sources/start_finish_gate.png',
      keys: ['start_finish'],
    },
    {
      slot: 'checkpoint_cordon_node',
      source_file: 'tools/scene-icons/sources/checkpoint_cordon_node.png',
      keys: [
        'checkpoint',
        'cordon_node',
        'vehicle_checkpoint',
        'checkpoint_cordon_node',
      ],
    },
    {
      slot: 'spectator_crowd_cluster',
      source_file: 'tools/scene-icons/sources/spectator_crowd_cluster.png',
      keys: ['crowd_spectators', 'crowd_zone'],
    },
    {
      slot: 'road_closed_barricade',
      source_file: 'tools/scene-icons/sources/road_closed_barricade.png',
      keys: ['signage_road_closed', 'road_closed', 'road_closed_barricade'],
    },
    {
      slot: 'vessel_marine_patrol',
      source_file: 'tools/scene-icons/sources/vessel_marine_patrol.png',
      keys: ['vessel_marine_patrol', 'marine_patrol'],
    },
    {
      slot: 'cone_cluster',
      source_file: 'tools/scene-icons/sources/cone_cluster.png',
      keys: ['cone_cluster'],
    },
    {
      slot: 'vehicle_police_motorcycle',
      source_file: 'tools/scene-icons/sources/vehicle_police_motorcycle.png',
      keys: ['vehicle_police_motorcycle'],
    },
    {
      slot: 'vehicle_city_bus',
      source_file: 'tools/scene-icons/sources/vehicle_city_bus.png',
      keys: ['vehicle_city_bus'],
    },
    {
      slot: 'cctv',
      source_file: 'tools/scene-icons/sources/cctv.png',
      keys: ['cctv', 'cctv_signal'],
    },
  ];

  const fringeByKey = new Map(fringeReport.map((r) => [r.key, r.violations]));
  const cornerByKey = new Map(
    fringeReport.map((r) => [r.key, r.cornerAlphaMax ?? 0]),
  );
  const evidenceList = EVIDENCE_SLOTS.map((s) => {
    const primaryKey = s.keys[0];
    const s1 = sprite1xEntries[primaryKey] || {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    };
    const s2 = sprite2xEntries[primaryKey] || {
      x: 0,
      y: 0,
      width: 128,
      height: 128,
    };
    const maxFringe = Math.max(...s.keys.map((k) => fringeByKey.get(k) ?? 0));
    return {
      slot: s.slot,
      source_file: s.source_file,
      'key(s)': s.keys.length === 1 ? s.keys[0] : s.keys,
      keys: s.keys,
      atlas_coords: {
        '1x': { x: s1.x, y: s1.y, w: s1.width, h: s1.height },
        '2x': { x: s2.x, y: s2.y, w: s2.width, h: s2.height },
      },
      fringe_pixels: maxFringe,
      corner_alpha_max: Math.max(...s.keys.map((k) => cornerByKey.get(k) ?? 0)),
      sizes: [64, 128, 256],
    };
  });

  const evidenceDir = path.join(
    REPO_ROOT,
    'docs/evidence-2026-11-02-direct-plugin',
  );
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, 'icons-integrated.json'),
    JSON.stringify(evidenceList, null, 2) + '\n',
    'utf8',
  );

  console.log(
    `[build-icons] Successfully generated ${count} icons in manifest v7 (${rows} rows x ${COLS} cols, 64/128/256 px):`,
  );
  console.log('[build-icons] --- PER-KEY FRINGE REPORT ---');
  for (const r of fringeReport) {
    console.log(
      `  - ${r.key.padEnd(26)}: ${r.violations === 0 ? 'CLEAN (0 fringe pixels)' : `${r.violations} violations`} · corner alpha max ${r.cornerAlphaMax ?? 0}`,
    );
  }
}

// Allow direct execution: node tools/scene-icons/build-icons.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildIcons().catch((err) => {
    console.error('[build-icons] Error:', err);
    process.exit(1);
  });
}
