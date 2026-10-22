import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInRing,
  pointInPolygon,
  findAoiForPoint,
  filterByAoi,
  gazetteerLookup,
  listAois,
  listAssets,
  UAE_AOI_GROUP_IDS,
  UAE_ZONE_TAGS,
  groupArtwork,
  wrapLongitude,
} from './uaeAoi.js';
import {
  dedupeIncidents,
  normaliseIncident,
  seedIncidents,
  incidentsToScenes,
  incidentToShot,
  timeSince,
  cameraPresetFor,
  countsByGroup,
  normaliseSeverity,
} from './uaeIncidents.js';

const SQUARE = [
  [10, 10],
  [20, 10],
  [20, 20],
  [10, 20],
  [10, 10],
];

test('pointInRing: inside, outside, on-edge and vertex', () => {
  assert.equal(pointInRing(15, 15, SQUARE), true);
  assert.equal(pointInRing(25, 15, SQUARE), false);
  assert.equal(pointInRing(15, 5, SQUARE), false);
  assert.equal(pointInRing(10, 15, SQUARE), true, 'on the west edge counts as inside');
  assert.equal(pointInRing(20, 20, SQUARE), true, 'vertex counts as inside');
  assert.equal(pointInRing(15, 15, SQUARE.slice(0, 4)), true, 'open ring accepted');
  assert.equal(pointInRing(15, 15, [[0, 0]]), false);
});

test('pointInRing is antimeridian-safe', () => {
  const pacific = [
    [170, -10],
    [-170, -10],
    [-170, 10],
    [170, 10],
    [170, -10],
  ];
  assert.equal(pointInRing(179, 0, pacific), true);
  assert.equal(pointInRing(-179, 0, pacific), true);
  assert.equal(pointInRing(181, 0, pacific), true, 'unwrapped longitude');
  assert.equal(pointInRing(160, 0, pacific), false);
  assert.equal(pointInRing(0, 0, pacific), false);
  assert.equal(wrapLongitude(190), -170);
  assert.equal(wrapLongitude(-190), 170);
});

test('pointInPolygon honours holes', () => {
  const withHole = {
    type: 'Polygon',
    coordinates: [
      SQUARE,
      [
        [12, 12],
        [14, 12],
        [14, 14],
        [12, 14],
        [12, 12],
      ],
    ],
  };
  assert.equal(pointInPolygon(13, 13, withHole), false);
  assert.equal(pointInPolygon(16, 16, withHole), true);
});

test('AOI library: four groups, 44 polygons, assets tagged with legal categories, artwork wired', () => {
  assert.deepEqual(UAE_AOI_GROUP_IDS, ['IRAN', 'YEMEN', 'SOMALIA', 'UAE_HOME_BORDER']);
  assert.equal(listAois().length, 44);
  assert.equal(listAois({ group: 'IRAN' }).length, 7);
  assert.ok(listAois({ group: 'UAE_HOME_BORDER' }).length >= 12);
  assert.ok(listAssets().length >= 16);
  for (const asset of listAssets()) {
    assert.ok(asset.properties.zone_tags.length >= 1, asset.properties.id);
    for (const tag of asset.properties.zone_tags)
      assert.ok(UAE_ZONE_TAGS.includes(tag), `${asset.properties.id}: ${tag}`);
    for (const key of ['group', 'country', 'name', 'asset_type', 'operator', 'notes', 'source_url'])
      assert.ok(key in asset.properties, `${asset.properties.id} missing ${key}`);
  }
  for (const group of UAE_AOI_GROUP_IDS)
    assert.match(groupArtwork(group), /^\/assets\/aoi\/.+\.webp$/);
});

test('findAoiForPoint prefers the smallest containing AOI and filterByAoi splits inside/outside', () => {
  const bab = findAoiForPoint(12.6, 43.3);
  assert.equal(bab.id, 'bab-el-mandeb');
  assert.equal(bab.group, 'YEMEN');
  const perim = findAoiForPoint(12.65, 43.42);
  assert.equal(perim.id, 'perim-mayun', 'Perim ring beats the enclosing Bab el-Mandeb ring');
  assert.equal(findAoiForPoint(25.17, 56.36).id, 'fujairah');
  assert.equal(findAoiForPoint(25.34, 56.35).id, 'khor-fakkan');
  assert.equal(findAoiForPoint(-12.05, -77.03), null, 'Lima is outside every AOI');
  assert.equal(findAoiForPoint(12.6, 43.3, { group: 'IRAN' }), null);
  const split = filterByAoi(
    [
      { id: 'a', lat: 12.6, lon: 43.3 },
      { id: 'b', lat: -12.05, lon: -77.03 },
      { id: 'c', lat: 'x', lon: 1 },
    ],
    { allowOutside: true },
  );
  assert.deepEqual(split.inside.map((i) => i.id), ['a']);
  assert.equal(split.inside[0].matchedAoi.id, 'bab-el-mandeb');
  assert.deepEqual(split.outside.map((i) => i.id), ['b', 'c']);
  assert.equal(filterByAoi(split.outside).length, 0);
});

test('gazetteer is fuzzy, alias-driven and dynamic over arbitrary text', () => {
  const cases = [
    ['Houthi drone strike on tanker near Bab el-Mandeb', 'bab-el-mandeb'],
    ['explosion reported at BAB AL-MANDAB', 'bab-el-mandeb'],
    ['Cargo ship boarded off Mayun island', 'perim-mayun'],
    ['Air raid on Hudaydah port', 'hodeidah'],
    ['Al Mukalla airport closed', 'mukalla'],
    ['Pirates seize dhow near Garacad', 'puntland-coast'],
    ['Mogadishu hotel siege', 'mogadishu'],
    ['Kismayo clashes', 'kismayo'],
    ['Khorfakkan container terminal congestion', 'khor-fakkan'],
    ['Jebel Ali traffic halves', 'jebel-ali'],
    ['Zirku Island loading suspended', 'das-island'],
    ['Fire at Ruwais refinery', 'ruwais'],
    ['Drone intercepted over Al Dhafra', 'al-dhafra'],
    ['Patrol boat off Abu Musa', 'abu-musa'],
    ['Greater Tunb radar activity', 'greater-tunb'],
    ['Missile launch from Bandar-e Abbas', 'bandar-abbas'],
    ['Qeshm ferry incident', 'qeshm-larak'],
    ['Tanker loading at Jask', 'jask'],
    ['Socotra storm damage', 'socotra'],
    ['Balhaf LNG terminal restart', 'balhaf-lng'],
    ['Ataq clashes in Shabwa', 'shabwa'],
    ['Seiyun airport reopens', 'hadramawt'],
    ['Aden port congestion', 'aden'],
    ['Shelling in Mokha', 'mocha'],
    ['Taizz front active', 'taiz'],
    ["Ma'rib missile", 'marib'],
    ['Sanaa airstrike', 'sanaa'],
    ['Dhubab fighting', 'dhubab'],
    ['Zuqar Island seized', 'dhubab'],
    ['Convoy on the Hormuz approaches', 'hormuz-tss'],
    ['Berbera port deal', 'berbera'],
    ['Bosasso airport', 'bosaso'],
    ['Eyl hijacking', 'puntland-coast'],
    ['Gulf of Aden piracy', 'gulf-of-aden-corridor'],
    ['Boats pushed into Emirati waters by jamming', 'uae-eez'],
  ];
  for (const [text, expected] of cases)
    assert.equal(gazetteerLookup(text)?.aoiId, expected, text);
  assert.equal(gazetteerLookup('earthquake in Lima'), null);
  assert.equal(gazetteerLookup(''), null);
  assert.equal(gazetteerLookup('explosion near Hodeid').aoiId, 'hodeidah', 'prefix fallback');
});

test('dedupe: same headline + location within 24 h collapses; >24 h apart or other location kept', () => {
  const base = { headline: 'Drone strike on tanker near Bab el-Mandeb', lat: 12.6, lon: 43.3 };
  const { kept, dropped } = dedupeIncidents([
    { ...base, id: 'a', event_time_utc: '2026-10-21T10:00:00Z' },
    { ...base, id: 'b', headline: 'drone strike on a tanker near bab el-mandeb', lat: 12.63, lon: 43.27, event_time_utc: '2026-10-21T22:00:00Z' },
    { ...base, id: 'c', event_time_utc: '2026-10-23T10:00:00Z' },
    { ...base, id: 'd', lat: 12.79, lon: 45.03, event_time_utc: '2026-10-21T10:00:00Z' },
  ]);
  assert.deepEqual(kept.map((i) => i.id), ['a', 'c', 'd']);
  assert.deepEqual(dropped.map((i) => [i.id, i.duplicateOf]), [['b', 'a']]);
});

test('normaliseIncident validates, fills group/country/aoi from the polygon and assigns a stable id', () => {
  const now = () => new Date('2026-10-22T08:00:00Z');
  const inc = normaliseIncident({ headline: 'Drone strike on tanker near Bab el-Mandeb', lat: 12.6, lon: 43.3, severity: 'critical' }, { now });
  assert.equal(inc.group, 'YEMEN');
  assert.equal(inc.country, 'YEMEN');
  assert.equal(inc.aoi_id, 'bab-el-mandeb');
  assert.equal(inc.severity, 'CRITICAL');
  assert.equal(inc.event_time_utc, '2026-10-22T08:00:00.000Z');
  assert.match(inc.id, /^inc-[0-9a-f]{8}$/);
  assert.equal(inc.insideAoi, true);
  assert.ok(inc.camera.ona_deg >= 35 && inc.camera.ona_deg <= 65);
  assert.ok(inc.camera.altitude_m >= 8000 && inc.camera.altitude_m <= 120000);
  assert.equal(normaliseIncident({ ...inc }, { now }).id, inc.id, 'id is deterministic');
  assert.throws(() => normaliseIncident({ headline: '', lat: 1, lon: 1 }), /headline/);
  assert.throws(() => normaliseIncident({ headline: 'x', lat: 95, lon: 1 }), /out of range/);
  assert.throws(() => normaliseIncident({ headline: 'x', lat: 1, lon: 1, group: 'MARS' }), /group/);
  const outside = normaliseIncident({ headline: 'Earthquake in Lima', lat: -12.05, lon: -77.03 }, { now });
  assert.equal(outside.insideAoi, false);
  assert.equal(outside.group, null);
  assert.equal(normaliseSeverity('major'), 'HIGH');
  assert.equal(normaliseSeverity(undefined), 'MEDIUM');
});

test('seed incidents: 31 records across all four groups, every one inside its AOI with a source', () => {
  const seeds = seedIncidents();
  assert.equal(seeds.length, 31);
  assert.deepEqual(countsByGroup(seeds), { IRAN: 10, YEMEN: 10, SOMALIA: 8, UAE_HOME_BORDER: 3 });
  for (const s of seeds) {
    assert.ok(s.insideAoi, `${s.id} outside AOI`);
    assert.ok(s.source_url?.startsWith('https://'), s.id);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s.severity));
    assert.ok(s.camera.ona_deg >= 35 && s.camera.ona_deg <= 65, s.id);
    assert.ok(s.camera.altitude_m >= 8000 && s.camera.altitude_m <= 120000, s.id);
    assert.ok(s.camera.dwell_in_s >= 3.5 && s.camera.dwell_in_s <= 5.0, s.id);
    assert.ok(s.camera.dwell_hold_s >= 9 && s.camera.dwell_hold_s <= 14, s.id);
    assert.match(s.event_time_utc, /Z$/);
  }
  assert.equal(seeds.some((s) => /Nepal|Devighat|Charaudi/i.test(s.headline)), false);
});

test('incidentsToScenes builds one scene per group (newest first) with the legacy preset line intact', () => {
  const scenes = incidentsToScenes(seedIncidents());
  assert.deepEqual(scenes.map((s) => s.title), ['IRAN', 'YEMEN', 'SOMALIA', 'UAE HOME BORDER']);
  const iran = scenes[0];
  assert.equal(iran.shots.length, 10);
  assert.equal(iran.shots[0].incident.id, 'ir-02', 'newest event first');
  const shot = iran.shots[0];
  assert.equal(shot.visual.style, 'normal');
  assert.equal(shot.visual.detection.mode, 'OFF');
  assert.equal(`${shot.visual.style.toUpperCase()} · ${shot.visual.detection.mode} · ${shot.durationSec.toFixed(1)}s + ${shot.holdSec.toFixed(1)}s`, 'NORMAL · OFF · 4.0s + 12.0s');
  assert.equal(shot.camera.pitch, -42, 'ONA 48° → pitch -42°');
  const outside = incidentsToScenes([{ id: 'x', headline: 'Lima', lat: -12, lon: -77, group: null, severity: 'LOW', event_time_utc: '2026-01-01T00:00:00Z', camera: cameraPresetFor({}) }]);
  assert.equal(outside.at(-1).title, 'OUTSIDE UAE AOI');
  const single = incidentToShot({ id: 'p', headline: 'h', lat: 1, lon: 2, severity: 'LOW' });
  assert.equal(single.incident.id, 'p');
});

test('timeSince renders live relative labels', () => {
  const now = Date.parse('2026-10-22T08:00:00Z');
  assert.equal(timeSince('2026-10-22T07:59:30Z', now), 'now');
  assert.equal(timeSince('2026-10-22T07:15:00Z', now), '45m');
  assert.equal(timeSince('2026-10-21T20:00:00Z', now), '12h');
  assert.equal(timeSince('2026-10-19T22:00:00Z', now), '2d');
  assert.equal(timeSince('2026-05-04T06:00:00Z', now), '5mo');
  assert.equal(timeSince('2023-10-22T08:00:00Z', now), '3y');
  assert.equal(timeSince('2026-10-23T08:00:00Z', now), 'future');
  assert.equal(timeSince(null, now), '—');
});
