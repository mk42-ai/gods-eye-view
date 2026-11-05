/**
 * Evidence to Scene Pipeline
 *
 * Normalizes retrieved footage clips into EvidenceSchema records,
 * deduplicates, clusters across time windows, and builds validated
 * ScenePatchSchema patches for the Cesium cinematic runtime.
 */
import {
  validateScenePatch,
  EvidenceSchema,
} from '../../src/cinematic/sceneSchema.js';

/**
 * Sanitize a storyId into a valid Evidence / Entity ID matching ^[a-z][a-z0-9_.-]{0,63}$
 */
export function sanitizeStoryId(storyId) {
  const clean = String(storyId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 48);
  return `ev-snap-${clean || 'unknown'}`.slice(0, 64);
}

/**
 * Format UTC time HH:MM UTC for verified marker labels
 */
export function formatUtcTime(iso) {
  const t = Date.parse(iso || '');
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm} UTC`;
  }
  return '00:00 UTC';
}

/**
 * Calculate local ENU offset in metres using equirectangular projection.
 */
export function equirectangularOffset(point, origin) {
  const R = 6371000;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lat2 = (point.lat * Math.PI) / 180;
  const lon1 = (origin.lon * Math.PI) / 180;
  const lon2 = (point.lon * Math.PI) / 180;
  const northM = Math.round((lat2 - lat1) * R);
  const eastM = Math.round((lon2 - lon1) * R * Math.cos((lat1 + lat2) / 2));
  return {
    eastM: Math.max(-5000, Math.min(5000, eastM)),
    northM: Math.max(-5000, Math.min(5000, northM)),
  };
}

/**
 * Calculate deterministic ring position (radius 60–140m) from string ID.
 */
export function deterministicRingPosition(idStr) {
  let h = 0;
  for (let i = 0; i < idStr.length; i++) {
    h = (h * 31 + idStr.charCodeAt(i)) >>> 0;
  }
  const angleRad = ((h % 360) * Math.PI) / 180;
  const radiusM = 60 + ((h >>> 8) % 81); // 60 to 140 m
  const eastM = Math.round(radiusM * Math.cos(angleRad));
  const northM = Math.round(radiusM * Math.sin(angleRad));
  return { eastM, northM };
}

/**
 * Normalize clips into EvidenceSchema-valid records.
 *
 * @param {Array<object>} clips
 * @param {object} options
 * @param {object} [options.scene]
 * @param {string} [options.retrievedAt]
 * @returns {Array<object>} EvidenceSchema-valid records
 */
export function normalizeClips(clips = [], { scene = {}, retrievedAt } = {}) {
  const retTime = retrievedAt || new Date().toISOString();
  const normalized = [];

  for (const clip of clips || []) {
    if (!clip) continue;
    const storyId =
      clip.storyId || (clip.id ? String(clip.id).replace(/^snap-/, '') : null);
    const id = sanitizeStoryId(storyId);
    const tier = clip.tier === 'verified' ? 'verified' : 'candidate';

    // Source URL must be public Spotlight URL, NEVER a SAS URL
    let url = undefined;
    if (
      clip.sourceUrl &&
      /^https?:\/\//i.test(clip.sourceUrl) &&
      !clip.sourceUrl.includes('sig=')
    ) {
      url = clip.sourceUrl.slice(0, 2000);
    } else if (storyId) {
      url = `https://www.snapchat.com/spotlight/${encodeURIComponent(storyId)}`;
    }

    const title = String(
      clip.caption || clip.matchedPlaceName || 'Snapchat footage',
    )
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 300);

    const lat = Number.isFinite(clip.lat)
      ? clip.lat
      : tier === 'verified' && Number.isFinite(scene?.lat)
        ? scene.lat
        : null;
    const lon = Number.isFinite(clip.lon)
      ? clip.lon
      : tier === 'verified' && Number.isFinite(scene?.lon)
        ? scene.lon
        : null;

    const locText =
      String(clip.matchedPlaceName || scene?.placeName || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 200) || undefined;

    const record = {
      id,
      source: 'snapchat',
      title: title || 'Snapchat footage',
      ...(url ? { url } : {}),
      tier,
      capturedAt: clip.captureTime
        ? String(clip.captureTime).slice(0, 80)
        : null,
      publishedAt: clip.publicationTime
        ? String(clip.publicationTime).slice(0, 80)
        : null,
      retrievedAt: String(clip.retrievalTime || retTime).slice(0, 80),
      lat,
      lon,
      ...(locText ? { locationText: locText } : {}),
      entityIds: [],
      ...(storyId ? { sourceId: String(storyId).slice(0, 200) } : {}),
    };

    // Validate with EvidenceSchema
    const parsed = EvidenceSchema.safeParse(record);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }

  return normalized;
}

/**
 * Deduplicate evidence records by id and url.
 */
export function dedupeEvidence(records = []) {
  const seenIds = new Set();
  const seenUrls = new Set();
  const deduped = [];

  for (const record of records || []) {
    if (!record || !record.id) continue;
    if (seenIds.has(record.id)) continue;
    if (record.url && seenUrls.has(record.url)) continue;

    seenIds.add(record.id);
    if (record.url) seenUrls.add(record.url);
    deduped.push(record);
  }

  return deduped;
}

/**
 * Cluster evidence records into time buckets.
 *
 * @param {Array<object>|object} recordsOrOptions
 * @param {object} [options]
 * @returns {Array<object>} [{id, from, to, count, evidenceIds, tier}]
 */
export function clusterEvidence(recordsOrOptions, options = {}) {
  let records = [];
  let timeBucketMin = 30;

  if (Array.isArray(recordsOrOptions)) {
    records = recordsOrOptions;
    if (typeof options.timeBucketMin === 'number') {
      timeBucketMin = options.timeBucketMin;
    }
  } else if (recordsOrOptions && typeof recordsOrOptions === 'object') {
    records = recordsOrOptions.evidence || [];
    if (typeof recordsOrOptions.timeBucketMin === 'number') {
      timeBucketMin = recordsOrOptions.timeBucketMin;
    }
  }

  if (!records.length) return [];

  const bucketMs = Math.max(1, timeBucketMin) * 60_000;
  // Group by (bucketIndex, tier)
  const buckets = new Map();

  for (const r of records) {
    const timeStr = r.publishedAt || r.capturedAt || r.retrievedAt;
    const t = Date.parse(timeStr || '') || 0;
    const bucketIdx = Math.floor(t / bucketMs);
    const key = `${bucketIdx}_${r.tier}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        bucketIdx,
        tier: r.tier,
        times: [],
        evidenceIds: [],
      });
    }

    const b = buckets.get(key);
    b.times.push(t);
    b.evidenceIds.push(r.id);
  }

  const clusters = [];
  let idx = 0;
  for (const b of buckets.values()) {
    idx += 1;
    const minTime = Math.min(...b.times);
    const maxTime = Math.max(...b.times);
    clusters.push({
      id: `cluster-${idx}`,
      from: new Date(minTime).toISOString(),
      to: new Date(maxTime).toISOString(),
      count: b.evidenceIds.length,
      evidenceIds: b.evidenceIds,
      tier: b.tier,
    });
  }

  return clusters;
}

/**
 * Build a ScenePatchSchema-valid patch from normalized evidence records.
 */
export function evidenceToPatch({
  evidence = [],
  sceneId = 'scene-evidence',
  baseVersion = 0,
  origin = { lat: 25.0805, lon: 55.1403 },
  maxMarkers = 40,
  label = 'Snapchat intelligence',
} = {}) {
  const deduped = dedupeEvidence(evidence);
  if (!deduped.length) {
    return null;
  }

  const clusters = clusterEvidence(deduped);
  const ops = [];
  const entityEvidenceMap = new Map();

  // 1. add_evidence ops (bounded to max 100 to avoid exceeding 200 ops total)
  const evidenceToAdd = deduped.slice(0, 100);
  for (const rec of evidenceToAdd) {
    ops.push({
      op: 'add_evidence',
      evidence: rec,
    });
  }

  // 2. add_entity marker ops (bounded to maxMarkers)
  const markerRecords = deduped.slice(0, Math.min(maxMarkers, 40));
  for (const rec of markerRecords) {
    const entityId = `ent-${rec.id}`.slice(0, 64);
    rec.entityIds = [entityId];
    entityEvidenceMap.set(rec.id, entityId);

    const isVerified = rec.tier === 'verified';
    const assetId = isVerified
      ? 'sprite.alert.state_4'
      : 'sprite.alert.state_2';
    const uncertainty = isVerified ? 'verified' : 'approximate';

    let pos;
    if (
      isVerified &&
      Number.isFinite(rec.lat) &&
      Number.isFinite(rec.lon) &&
      origin &&
      Number.isFinite(origin.lat) &&
      Number.isFinite(origin.lon)
    ) {
      pos = equirectangularOffset(rec, origin);
    } else {
      pos = deterministicRingPosition(rec.id);
    }

    const timeLabel = formatUtcTime(
      rec.publishedAt || rec.capturedAt || rec.retrievedAt,
    );
    const markerLabel = isVerified
      ? `Snapchat · verified · ${timeLabel}`
      : 'Snapchat · unverified location';

    const entity = {
      id: entityId,
      assetId,
      label: markerLabel.slice(0, 48),
      category: 'marker',
      position: {
        eastM: pos.eastM,
        northM: pos.northM,
      },
      headingDeg: 0,
      scale: 1,
      count: 1,
      spreadM: 0,
      behavior: { type: 'static' },
      startSec: 0,
      endSec: null,
      uncertainty,
      provenance: {
        kind: 'evidence',
        evidenceId: rec.id,
        ...(rec.url ? { url: rec.url } : {}),
        tier: rec.tier,
        sourceRef: `snapchat:${rec.sourceId || rec.id.replace(/^ev-snap-/, '')}`,
      },
      highlight: false,
      hypothetical: false,
      tags: ['snapchat', rec.tier],
    };

    ops.push({
      op: 'add_entity',
      entity,
    });
  }

  // 3. add_timeline_event ops per cluster (bounded so ops <= 200)
  clusters.slice(0, 20).forEach((cluster, idx) => {
    const clusterEntityIds = cluster.evidenceIds
      .map((eid) => entityEvidenceMap.get(eid))
      .filter(Boolean)
      .slice(0, 50);

    const beat = {
      atSec: Math.min(3600, idx * 10),
      title: `Snapchat evidence ×${cluster.count} (${cluster.tier})`.slice(
        0,
        80,
      ),
      narration:
        `Cluster of ${cluster.count} ${cluster.tier} Snapchat clips from ${cluster.from} to ${cluster.to}`.slice(
          0,
          600,
        ),
      entityIds: clusterEntityIds,
      evidenceIds: cluster.evidenceIds.slice(0, 20),
    };

    ops.push({
      op: 'add_timeline_event',
      beat,
    });
  });

  const patchId = `patch-intel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const patch = {
    patchId,
    sceneId: String(sceneId || 'scene-evidence').slice(0, 120),
    baseVersion: Number.isFinite(baseVersion)
      ? Math.max(0, Math.floor(baseVersion))
      : 0,
    ops: ops.slice(0, 200),
    reason: `Snapchat intelligence (${deduped.length} items)`,
    source: 'intelligence',
    evidenceIds: deduped.map((e) => e.id).slice(0, 50),
    priority: deduped.some((e) => e.tier === 'verified') ? 'high' : 'normal',
    label: String(label || 'Snapchat intelligence').slice(0, 80),
    createdAt: new Date().toISOString(),
  };

  return validateScenePatch(patch);
}
