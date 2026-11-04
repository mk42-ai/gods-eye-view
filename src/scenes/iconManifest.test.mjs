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

test('manifest.json exists, has version 7, valid timestamp, and keys array', () => {
  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(
    content.version,
    7,
    'manifest version must be 7 (v7: 49 keys, 64/128/256 px, grid sprite sheet, elementTypeIcons map)',
  );
  assert.ok(content.generatedAt, 'generatedAt must be present');
  assert.ok(
    !Number.isNaN(Date.parse(content.generatedAt)),
    'generatedAt must be ISO-8601',
  );
  assert.ok(Array.isArray(content.keys), 'keys must be an array');
  assert.ok(
    content.keys.length >= 49,
    `expected at least 49 keys, got ${content.keys.length}`,
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
    // 2026-11-02 icon family
    'event_command_post',
    'checkpoint_cordon_node',
    'road_closed_barricade',
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
    'event_command_post',
    'checkpoint_cordon_node',
    'road_closed_barricade',
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

test('every manifest key has valid 64/128/256 px PNGs with fully transparent corners and correct sha256', async () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8'),
  );

  for (const item of manifest.keys) {
    assert.ok(item.key, 'key must not be empty');
    assert.ok(item.png, `png path missing for ${item.key}`);
    assert.ok(item.png2x, `png2x path missing for ${item.key}`);
    assert.ok(item.png4x, `png4x path missing for ${item.key}`);
    assert.ok(item.sha256, `sha256 missing for ${item.key}`);

    for (const [rel, size] of [
      [item.png, 64],
      [item.png2x, 128],
      [item.png4x, 256],
    ]) {
      const abs = path.join(PUBLIC_DIR, rel);
      assert.ok(fs.existsSync(abs), `${size}px PNG file ${rel} missing`);
      const buf = fs.readFileSync(abs);
      assert.ok(hasPngSignature(buf), `${rel} has invalid PNG signature`);
      const meta = await sharp(buf).metadata();
      assert.equal(meta.width, size, `${rel} width must be ${size}`);
      assert.equal(meta.height, size, `${rel} height must be ${size}`);
      // Chroma-key proof: every corner pixel is fully transparent (no black square).
      const raw = await sharp(buf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const a = (x, y) => raw.data[(y * size + x) * 4 + 3];
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ]) {
        assert.equal(a(x, y), 0, `${rel} corner (${x},${y}) alpha must be 0`);
      }
    }

    const p64Buf = fs.readFileSync(path.join(PUBLIC_DIR, item.png));
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

test('2026-11-02 icon family: the three new types resolve through registry, legend map, staging icon keys and the cinematic alias map', async () => {
  const { ELEMENT_TYPE_ICONS } = await import('./iconBillboard.js');
  const { ICON_KEYS } = await import('./sceneStaging.js');
  const { resolveAssetId, ALIAS_MAP } = await import(
    '../cinematic/assetIds.js'
  );
  const { ELEMENT_LABELS, ELEMENT_ICONS } = await import(
    '../incidents/ui/scenePanel.js'
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8'),
  );
  const keys = new Set(manifest.keys.map((k) => k.key));
  for (const type of [
    'event_command_post',
    'checkpoint_cordon_node',
    'road_closed_barricade',
  ]) {
    assert.ok(DYNAMIC_ELEMENT_TYPES.includes(type), `${type} is a spec type`);
    assert.equal(ELEMENT_TYPE_ICONS[type], type, `${type} maps to its own icon`);
    assert.equal(manifest.elementTypeIcons[type], type);
    assert.ok(ICON_KEYS.includes(type), `${type} is a staging icon key`);
    assert.ok(keys.has(type), `${type} is in the manifest`);
    assert.ok(ELEMENT_LABELS[type], `${type} has a legend label`);
    assert.equal(ELEMENT_ICONS[type], type);
    assert.ok(ALIAS_MAP[type]?.[0] === `sprite.${type}`);
    const r = resolveAssetId(`sprite.${type}`);
    assert.equal(r.asset.id, `sprite.${type}`);
    assert.equal(r.substituted, false);
  }
  // Replaced artwork: the six refreshed slots still resolve to the same keys.
  for (const key of [
    'police_unit',
    'barrier_crowd',
    'medical_point',
    'crowd_spectators',
    'start_finish',
    'perimeter_unit',
  ]) {
    assert.ok(keys.has(key), `${key} present after artwork refresh`);
  }
});
