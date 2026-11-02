import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ELEMENT_TYPES, DYNAMIC_ELEMENT_TYPES } from './sceneSpec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public/scene-icons');
const PNG_DIR = path.join(PUBLIC_DIR, 'png');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasPngSignature(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

test('manifest.json exists, has version 6, valid timestamp, and keys array', () => {
  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(
    content.version,
    6,
    'manifest version must be 6 (v6: 46 keys, 64px 1x / 128px 2x, grid sprite sheet, elementTypeIcons map)',
  );
  assert.ok(content.generatedAt, 'generatedAt must be present');
  assert.ok(
    !Number.isNaN(Date.parse(content.generatedAt)),
    'generatedAt must be ISO-8601',
  );
  assert.ok(Array.isArray(content.keys), 'keys must be an array');
  assert.ok(
    content.keys.length >= 46,
    `expected at least 46 keys, got ${content.keys.length}`,
  );

  const requiredKeys = [
    'cone',
    'police_unit',
    'barrier',
    'cctv_signal',
    'checkpoint',
    'staging_point',
    'perimeter_unit',
    'crowd_zone',
    'start_finish',
    'egress',
    'command_post',
    'cctv',
    'cordon_node',
    'route_start',
    'route_finish',
    'generic',
    'vehicle_police_car',
    'vehicle_ambulance',
    'vehicle_fire_engine',
    'vehicle_civilian_sedan',
    'aircraft_helicopter',
    'aircraft_fixed_wing',
    'person_runner',
    'person_police_officer',
    'signage_road_closed',
    'effect_smoke_fire',
    'alert_state_1',
    'alert_state_2',
    'alert_state_3',
    'alert_state_4',
    'barrier_crowd',
    'cone_cluster',
    'crowd_spectators',
    'person_responder',
    'vehicle_city_bus',
    'vehicle_police_motorcycle',
    'sensor_cctv_feed',
    'evidence_pin_verified',
    'marker_air_raid_impact_sim',
    'vessel_marine_patrol',
    // 2026-11-02 contract new keys
    'medical_point',
    'marine_patrol',
    'vehicle_checkpoint',
    'screening_lane',
    'road_closed',
    'civilian_sedan',
  ];

  const presentKeys = content.keys.map((k) => k.key);
  for (const rk of requiredKeys) {
    assert.ok(
      presentKeys.includes(rk),
      `required key ${rk} missing from manifest`,
    );
  }
});

test('manifest elementTypeIcons map covers every element type in sceneSpec + contract new types', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8'),
  );

  assert.ok(
    manifest.elementTypeIcons && typeof manifest.elementTypeIcons === 'object',
    'manifest must have top-level elementTypeIcons object',
  );

  const contractNewTypes = [
    'vehicle_checkpoint',
    'screening_lane',
    'medical_point',
    'marine_patrol',
    'foot_patrol',
    'escort_motorcycle',
    'shuttle_bus',
    'road_closed',
  ];

  const allExpectedTypes = new Set([
    ...ELEMENT_TYPES,
    ...DYNAMIC_ELEMENT_TYPES,
    ...contractNewTypes,
  ]);

  for (const type of allExpectedTypes) {
    const iconKey = manifest.elementTypeIcons[type];
    assert.ok(iconKey, `elementTypeIcons must cover type '${type}'`);
    assert.ok(
      manifest.keys.some((k) => k.key === iconKey),
      `iconKey '${iconKey}' for type '${type}' must be present in manifest.keys`,
    );
  }
});

test('every manifest key has valid 64px and 128px PNGs (<= 128px), correct sha256, and no @4x file remains', async () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8'),
  );

  // Assert no @4x files exist in PNG_DIR
  const pngFiles = fs.readdirSync(PNG_DIR);
  const at4xFiles = pngFiles.filter((f) => f.includes('@4x'));
  assert.equal(
    at4xFiles.length,
    0,
    `Found @4x files in PNG_DIR that should have been deleted: ${at4xFiles.join(', ')}`,
  );

  for (const item of manifest.keys) {
    assert.ok(item.key, 'key must not be empty');
    assert.ok(item.png, `png path missing for ${item.key}`);
    assert.ok(item.png2x, `png2x path missing for ${item.key}`);
    assert.ok(item.sha256, `sha256 missing for ${item.key}`);
    assert.equal(
      item.png4x,
      undefined,
      `png4x must not be present in manifest v5 for ${item.key}`,
    );

    const p64Path = path.join(PUBLIC_DIR, item.png);
    const p128Path = path.join(PUBLIC_DIR, item.png2x);

    assert.ok(fs.existsSync(p64Path), `64px PNG file ${item.png} missing`);
    assert.ok(fs.existsSync(p128Path), `128px PNG file ${item.png2x} missing`);

    const p64Buf = fs.readFileSync(p64Path);
    const p128Buf = fs.readFileSync(p128Path);

    assert.ok(hasPngSignature(p64Buf), `${item.png} has invalid PNG signature`);
    assert.ok(
      hasPngSignature(p128Buf),
      `${item.png2x} has invalid PNG signature`,
    );

    const m64 = await sharp(p64Buf).metadata();
    assert.equal(m64.width, 64, `${item.png} width must be 64`);
    assert.equal(m64.height, 64, `${item.png} height must be 64`);
    assert.ok(
      m64.width <= 128 && m64.height <= 128,
      'width and height must be <= 128',
    );

    const m128 = await sharp(p128Buf).metadata();
    assert.equal(m128.width, 128, `${item.png2x} width must be 128`);
    assert.equal(m128.height, 128, `${item.png2x} height must be 128`);
    assert.ok(
      m128.width <= 128 && m128.height <= 128,
      'width and height must be <= 128',
    );

    const expectedSha256 = createHash('sha256').update(p64Buf).digest('hex');
    assert.equal(
      item.sha256,
      expectedSha256,
      `sha256 mismatch for ${item.key}: manifest=${item.sha256}, actual=${expectedSha256}`,
    );
  }
});

test('sprite sheets and MapLibre sprite json rects are valid grid (<= 16 cols), inside sheet, and have no duplicate rects', async () => {
  const sprite1xImgPath = path.join(PUBLIC_DIR, 'sprite.png');
  const sprite2xImgPath = path.join(PUBLIC_DIR, 'sprite@2x.png');
  const sprite1xJsonPath = path.join(PUBLIC_DIR, 'sprite.json');
  const sprite2xJsonPath = path.join(PUBLIC_DIR, 'sprite@2x.json');

  assert.ok(fs.existsSync(sprite1xImgPath), 'sprite.png must exist');
  assert.ok(fs.existsSync(sprite2xImgPath), 'sprite@2x.png must exist');
  assert.ok(fs.existsSync(sprite1xJsonPath), 'sprite.json must exist');
  assert.ok(fs.existsSync(sprite2xJsonPath), 'sprite@2x.json must exist');

  const s1Buf = fs.readFileSync(sprite1xImgPath);
  const s2Buf = fs.readFileSync(sprite2xImgPath);
  assert.ok(hasPngSignature(s1Buf), 'sprite.png has invalid signature');
  assert.ok(hasPngSignature(s2Buf), 'sprite@2x.png has invalid signature');

  const meta1x = await sharp(s1Buf).metadata();
  const meta2x = await sharp(s2Buf).metadata();

  assert.equal(
    meta1x.width,
    1024,
    'sprite.png width should be 1024 (16 cols x 64px)',
  );
  assert.ok(
    meta1x.height >= 128,
    'sprite.png must have multiple rows (not a single row)',
  );
  assert.equal(
    meta2x.width,
    2048,
    'sprite@2x.png width should be 2048 (16 cols x 128px)',
  );

  const sprite1x = JSON.parse(fs.readFileSync(sprite1xJsonPath, 'utf8'));
  const sprite2x = JSON.parse(fs.readFileSync(sprite2xJsonPath, 'utf8'));

  const rects1x = new Set();
  const rects2x = new Set();

  for (const [key, rect] of Object.entries(sprite1x)) {
    assert.ok(
      Number.isInteger(rect.x) && rect.x >= 0,
      `${key} rect.x must be >= 0`,
    );
    assert.ok(
      Number.isInteger(rect.y) && rect.y >= 0,
      `${key} rect.y must be >= 0`,
    );
    assert.equal(rect.width, 64, `${key} rect.width must be 64`);
    assert.equal(rect.height, 64, `${key} rect.height must be 64`);
    assert.equal(rect.pixelRatio, 1, `${key} pixelRatio must be 1`);

    assert.ok(
      rect.x + rect.width <= meta1x.width,
      `${key} rect extends beyond 1x sheet width (${rect.x + rect.width} > ${meta1x.width})`,
    );
    assert.ok(
      rect.y + rect.height <= meta1x.height,
      `${key} rect extends beyond 1x sheet height (${rect.y + rect.height} > ${meta1x.height})`,
    );

    const rKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    assert.ok(
      !rects1x.has(rKey),
      `duplicate rect ${rKey} in sprite.json for key ${key}`,
    );
    rects1x.add(rKey);
  }

  for (const [key, rect] of Object.entries(sprite2x)) {
    assert.ok(
      Number.isInteger(rect.x) && rect.x >= 0,
      `${key} 2x rect.x must be >= 0`,
    );
    assert.ok(
      Number.isInteger(rect.y) && rect.y >= 0,
      `${key} 2x rect.y must be >= 0`,
    );
    assert.equal(rect.width, 128, `${key} 2x rect.width must be 128`);
    assert.equal(rect.height, 128, `${key} 2x rect.height must be 128`);
    assert.equal(rect.pixelRatio, 2, `${key} 2x pixelRatio must be 2`);

    assert.ok(
      rect.x + rect.width <= meta2x.width,
      `${key} rect extends beyond 2x sheet width (${rect.x + rect.width} > ${meta2x.width})`,
    );
    assert.ok(
      rect.y + rect.height <= meta2x.height,
      `${key} rect extends beyond 2x sheet height (${rect.y + rect.height} > ${meta2x.height})`,
    );

    const rKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    assert.ok(
      !rects2x.has(rKey),
      `duplicate rect ${rKey} in sprite@2x.json for key ${key}`,
    );
    rects2x.add(rKey);
  }
});
