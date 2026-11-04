import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClips,
  dedupeEvidence,
  clusterEvidence,
  evidenceToPatch,
  equirectangularOffset,
  deterministicRingPosition,
} from './evidence-pipeline.js';
import { validateScenePatch } from '../../src/cinematic/sceneSchema.js';

test('normalizeClips: transforms footage clips into EvidenceSchema valid records', () => {
  const clips = [
    {
      id: 'snap-abc123DEF',
      storyId: 'abc123DEF',
      tier: 'candidate',
      matchedPlaceName: 'Dubai Marina',
      caption: 'Walking around #dubaimarina with friends!',
      sourceUrl: 'https://www.snapchat.com/spotlight/abc123DEF',
      publicationTime: '2026-11-01T12:00:00.000Z',
      retrievalTime: '2026-11-01T12:05:00.000Z',
    },
    {
      id: 'snap-xyz999',
      storyId: 'xyz999',
      tier: 'verified',
      matchedPlaceName: 'Burj Khalifa',
      caption: 'Burj Khalifa lights',
      sourceUrl: 'https://www.snapchat.com/spotlight/xyz999',
      lat: 25.1972,
      lon: 55.2744,
      publicationTime: '2026-11-01T13:00:00.000Z',
      retrievalTime: '2026-11-01T13:05:00.000Z',
    },
  ];

  const evidence = normalizeClips(clips, {
    scene: { lat: 25.0805, lon: 55.1403, placeName: 'Dubai Marina' },
  });

  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].id, 'ev-snap-abc123def');
  assert.equal(evidence[0].source, 'snapchat');
  assert.equal(evidence[0].tier, 'candidate');
  assert.equal(evidence[0].lat, null);
  assert.equal(evidence[0].url, 'https://www.snapchat.com/spotlight/abc123DEF');

  assert.equal(evidence[1].id, 'ev-snap-xyz999');
  assert.equal(evidence[1].tier, 'verified');
  assert.equal(evidence[1].lat, 25.1972);
  assert.equal(evidence[1].lon, 55.2744);
});

test('dedupeEvidence: deduplicates by id and url', () => {
  const records = [
    {
      id: 'ev-snap-1',
      url: 'https://snapchat.com/spotlight/1',
      tier: 'candidate',
    },
    {
      id: 'ev-snap-1',
      url: 'https://snapchat.com/spotlight/1-diff',
      tier: 'candidate',
    },
    {
      id: 'ev-snap-2',
      url: 'https://snapchat.com/spotlight/1',
      tier: 'candidate',
    },
    {
      id: 'ev-snap-3',
      url: 'https://snapchat.com/spotlight/3',
      tier: 'candidate',
    },
  ];

  const deduped = dedupeEvidence(records);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'ev-snap-1');
  assert.equal(deduped[1].id, 'ev-snap-3');
});

test('clusterEvidence: groups records by time bucket and tier', () => {
  const records = [
    { id: 'ev-1', publishedAt: '2026-11-01T12:05:00Z', tier: 'candidate' },
    { id: 'ev-2', publishedAt: '2026-11-01T12:20:00Z', tier: 'candidate' },
    { id: 'ev-3', publishedAt: '2026-11-01T13:45:00Z', tier: 'candidate' },
  ];

  const clusters = clusterEvidence(records, { timeBucketMin: 30 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
  assert.deepEqual(clusters[0].evidenceIds, ['ev-1', 'ev-2']);
  assert.equal(clusters[1].count, 1);
  assert.deepEqual(clusters[1].evidenceIds, ['ev-3']);
});

test('deterministicRingPosition: returns bounded coordinates between 60 and 140 metres', () => {
  for (const id of ['ev-snap-1', 'ev-snap-test', 'ev-snap-dubai_marina_123']) {
    const pos = deterministicRingPosition(id);
    const dist = Math.hypot(pos.eastM, pos.northM);
    assert.ok(
      dist >= 59 && dist <= 141,
      `Distance ${dist} outside 60-140m for ${id}`,
    );
  }
});

test('equirectangularOffset: calculates local coordinates from origin', () => {
  const origin = { lat: 25.0805, lon: 55.1403 };
  const target = { lat: 25.0805, lon: 55.1503 };
  const offset = equirectangularOffset(target, origin);
  assert.equal(offset.northM, 0);
  assert.ok(offset.eastM > 500 && offset.eastM < 1500);
});

test('evidenceToPatch: creates a valid ScenePatchSchema object with entity and timeline ops', () => {
  const clips = [
    {
      id: 'snap-c1',
      storyId: 'c1',
      tier: 'candidate',
      caption: 'Candidate clip',
      sourceUrl: 'https://www.snapchat.com/spotlight/c1',
      publicationTime: '2026-11-01T10:00:00Z',
    },
    {
      id: 'snap-v1',
      storyId: 'v1',
      tier: 'verified',
      caption: 'Verified clip',
      sourceUrl: 'https://www.snapchat.com/spotlight/v1',
      lat: 25.085,
      lon: 55.145,
      publicationTime: '2026-11-01T10:15:00Z',
    },
  ];

  const evidence = normalizeClips(clips);
  const patch = evidenceToPatch({
    evidence,
    sceneId: 'test-scene-1',
    baseVersion: 2,
    origin: { lat: 25.0805, lon: 55.1403 },
    label: 'Test Snapchat patch',
  });

  assert.ok(patch);
  assert.equal(patch.sceneId, 'test-scene-1');
  assert.equal(patch.baseVersion, 2);
  assert.equal(patch.source, 'intelligence');
  assert.equal(patch.priority, 'high'); // has verified clip

  // Validates with zod schema
  const validated = validateScenePatch(patch);
  assert.equal(validated.patchId, patch.patchId);

  // Check ops: 2 add_evidence, 2 add_entity, 1 add_timeline_event
  const evOps = patch.ops.filter((o) => o.op === 'add_evidence');
  const entOps = patch.ops.filter((o) => o.op === 'add_entity');
  const tlOps = patch.ops.filter((o) => o.op === 'add_timeline_event');

  assert.equal(evOps.length, 2);
  assert.equal(entOps.length, 2);
  assert.ok(tlOps.length >= 1);

  // Candidate entity
  const candEnt = entOps.find((o) => o.entity.id === 'ent-ev-snap-c1').entity;
  assert.equal(candEnt.assetId, 'sprite.alert.state_2');
  assert.equal(candEnt.uncertainty, 'approximate');
  assert.equal(candEnt.label, 'Snapchat · unverified location');

  // Verified entity
  const verEnt = entOps.find((o) => o.entity.id === 'ent-ev-snap-v1').entity;
  assert.equal(verEnt.assetId, 'sprite.alert.state_4');
  assert.equal(verEnt.uncertainty, 'verified');
  assert.ok(verEnt.label.startsWith('Snapchat · verified ·'));
});

test('evidenceToPatch: returns null when evidence list is empty', () => {
  const patch = evidenceToPatch({ evidence: [] });
  assert.equal(patch, null);
});
