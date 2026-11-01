/**
 * tools/scene-icons/build-icons.mjs
 *
 * Keying & sprite generation pipeline for Scene Spec icons.
 *
 * 1. Reads 1024x1024 RGB source PNGs with pure black #000000 background.
 * 2. Keys black to alpha using soft threshold:
 *      alpha = clamp((max(r,g,b) - 8) / 40, 0, 1)
 *    and un-premultiplies RGB towards original hue:
 *      c_orig = c / alpha
 * 3. Crops to content bbox + 8% padding, centered on square.
 * 4. Special cases:
 *    - route_start: route_flag.png normal orientation
 *    - route_finish: route_flag.png horizontally mirrored (flop)
 *    - generic: generated target/dot sprite (teal ring, navy outline, white dot)
 *    - kept existing keys: police_unit, cctv_signal, staging_point, perimeter_unit, start_finish
 * 5. Exports 32px (<key>.png) and 64px (<key>@2x.png) to public/scene-icons/png/
 * 6. Generates sprite.png (1x), sprite@2x.png (2x), sprite.json, sprite@2x.json (MapLibre format)
 * 7. Writes public/scene-icons/manifest.json (version 2) with SHA-256 hashes.
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

const KEY_DEFINITIONS = [
  // Existing keys replaced by new keyed artwork from sources/
  { key: 'cone', source: 'tools/scene-icons/sources/cone.png' },
  { key: 'police_unit', source: 'public/scene-icons/svg/police_unit.svg' },
  { key: 'barrier', source: 'tools/scene-icons/sources/barrier.png' },
  { key: 'cctv_signal', source: 'public/scene-icons/svg/cctv_signal.svg' },
  { key: 'checkpoint', source: 'tools/scene-icons/sources/checkpoint.png' },
  { key: 'staging_point', source: 'public/scene-icons/svg/staging_point.svg' },
  {
    key: 'perimeter_unit',
    source: 'public/scene-icons/svg/perimeter_unit.svg',
  },
  { key: 'crowd_zone', source: 'tools/scene-icons/sources/crowd_zone.png' },
  { key: 'start_finish', source: 'public/scene-icons/svg/start_finish.svg' },
  { key: 'egress', source: 'tools/scene-icons/sources/egress.png' },

  // New keys from sources/
  { key: 'command_post', source: 'tools/scene-icons/sources/command_post.png' },
  { key: 'cctv', source: 'tools/scene-icons/sources/cctv.png' },
  { key: 'cordon_node', source: 'tools/scene-icons/sources/cordon_node.png' },
  { key: 'route_start', source: 'tools/scene-icons/sources/route_flag.png' },
  {
    key: 'route_finish',
    source: 'tools/scene-icons/sources/route_flag.png',
    transform: 'flop',
  },

  // Generated generic dot
  { key: 'generic', source: 'generated:generic' },
];

function generateGenericSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="22" fill="${TEAL}" stroke="${NAVY}" stroke-width="4"/>
  <circle cx="32" cy="32" r="10" fill="${WHITE}"/>
</svg>`;
}

async function keyAndCropSource(sourceFilePath, transform = null) {
  const img = sharp(sourceFilePath);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  let minX = info.width;
  let maxX = 0;
  let minY = info.height;
  let maxY = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const srcIdx = (y * info.width + x) * info.channels;
      const dstIdx = (y * info.width + x) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      const m = Math.max(r, g, b);
      // Soft threshold: alpha = clamp((max(r,g,b) - 8) / 40, 0, 1)
      const alpha = Math.min(1, Math.max(0, (m - 8) / 40));

      if (alpha <= 0) {
        out[dstIdx] = 0;
        out[dstIdx + 1] = 0;
        out[dstIdx + 2] = 0;
        out[dstIdx + 3] = 0;
      } else {
        // Un-premultiply colour toward original hue
        out[dstIdx] = Math.min(255, Math.max(0, Math.round(r / alpha)));
        out[dstIdx + 1] = Math.min(255, Math.max(0, Math.round(g / alpha)));
        out[dstIdx + 2] = Math.min(255, Math.max(0, Math.round(b / alpha)));
        out[dstIdx + 3] = Math.min(255, Math.max(0, Math.round(alpha * 255)));

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
    raw: { width: info.width, height: info.height, channels: 4 },
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
  const p32 = await sharp(squareBuffer).resize(32, 32).png().toBuffer();
  const p64 = await sharp(squareBuffer).resize(64, 64).png().toBuffer();

  return { p32, p64 };
}

async function renderSvgIcon(svgFilePath) {
  const svgContent = fs.readFileSync(svgFilePath);
  const p32 = await sharp(svgContent).resize(32, 32).png().toBuffer();
  const p64 = await sharp(svgContent).resize(64, 64).png().toBuffer();
  return { p32, p64 };
}

export async function buildIcons() {
  fs.mkdirSync(PNG_DIR, { recursive: true });
  fs.mkdirSync(SVG_DIR, { recursive: true });

  // Generate generic SVG
  const genericSvg = generateGenericSvg();
  fs.writeFileSync(path.join(SVG_DIR, 'generic.svg'), genericSvg, 'utf8');

  const processed = [];

  for (const def of KEY_DEFINITIONS) {
    let p32, p64;
    if (def.source === 'generated:generic') {
      p32 = await sharp(Buffer.from(genericSvg))
        .resize(32, 32)
        .png()
        .toBuffer();
      p64 = await sharp(Buffer.from(genericSvg))
        .resize(64, 64)
        .png()
        .toBuffer();
    } else if (def.source.endsWith('.svg')) {
      const fullPath = path.join(REPO_ROOT, def.source);
      const res = await renderSvgIcon(fullPath);
      p32 = res.p32;
      p64 = res.p64;
    } else {
      const fullPath = path.join(REPO_ROOT, def.source);
      const res = await keyAndCropSource(fullPath, def.transform);
      p32 = res.p32;
      p64 = res.p64;
    }

    // Write PNG files
    const pngPath = path.join(PNG_DIR, `${def.key}.png`);
    const png2xPath = path.join(PNG_DIR, `${def.key}@2x.png`);
    fs.writeFileSync(pngPath, p32);
    fs.writeFileSync(png2xPath, p64);

    // If new key doesn't have an SVG, write one embedding the 64px PNG
    const svgPath = path.join(SVG_DIR, `${def.key}.svg`);
    if (!fs.existsSync(svgPath)) {
      const b64 = p64.toString('base64');
      const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="data:image/png;base64,${b64}" width="64" height="64"/></svg>\n`;
      fs.writeFileSync(svgPath, svgWrapper, 'utf8');
    }

    const sha256 = createHash('sha256').update(p32).digest('hex');
    processed.push({
      key: def.key,
      source: def.source,
      p32,
      p64,
      sha256,
    });
  }

  // Build sprite sheets: 1x (32x32 per icon) and 2x (64x64 per icon)
  const ICON_SIZE_1X = 32;
  const ICON_SIZE_2X = 64;
  const count = processed.length;
  const sheetWidth1x = count * ICON_SIZE_1X;
  const sheetHeight1x = ICON_SIZE_1X;
  const sheetWidth2x = count * ICON_SIZE_2X;
  const sheetHeight2x = ICON_SIZE_2X;

  const sprite1xEntries = {};
  const sprite2xEntries = {};
  const composite1x = [];
  const composite2x = [];
  const manifestKeys = [];

  processed.forEach((item, index) => {
    const x1x = index * ICON_SIZE_1X;
    const y1x = 0;
    const x2x = index * ICON_SIZE_2X;
    const y2x = 0;

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

    composite1x.push({ input: item.p32, left: x1x, top: y1x });
    composite2x.push({ input: item.p64, left: x2x, top: y2x });

    manifestKeys.push({
      key: item.key,
      png: `png/${item.key}.png`,
      png2x: `png/${item.key}@2x.png`,
      sprite: {
        x: x1x,
        y: y1x,
        width: ICON_SIZE_1X,
        height: ICON_SIZE_1X,
      },
      sourceFile: item.source,
      sha256: item.sha256,
    });
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
    version: 2,
    generatedAt: new Date().toISOString(),
    keys: manifestKeys,
  };
  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  console.log(`[build-icons] Successfully generated ${count} icons:`);
  for (const k of manifestKeys) {
    console.log(
      `  - ${k.key.padEnd(16)} (sha256: ${k.sha256.slice(0, 12)}...)`,
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
