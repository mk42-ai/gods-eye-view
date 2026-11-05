/** Presentation derived only from service records; planned assets are not evidence. */
export const ASSET_LABELS = Object.freeze({
  civilian_sedan: 'Civilian sedan',
  civilian_hatchback: 'Civilian hatchback',
  police_patrol_car: 'Police patrol car',
  cctv_camera: 'Staged CCTV camera',
});
export const REFERENCE_ASSETS = Object.freeze([]); // No implied bindings: service must report actual references.
const STAGES = {
  queued: 'Queued',
  geocode: 'Locating',
  land_patch: 'Fetching land patch',
  scene_spec: 'Planning scene',
  placement: 'Placing assets',
  render: 'Rendering',
  encode: 'Encoding',
  complete: 'Complete',
  partial: 'Partial',
};
export function assetLabel(key) {
  return ASSET_LABELS[key] || String(key || '').replace(/_/g, ' ');
}
export function jobGpus(job) {
  return [
    ...new Set(
      [
        ...(job?.shards || []).map((s) => String(s.gpu ?? '')),
        ...(job?.frameMetadata || job?.frames || []).map((f) =>
          String(f.gpu?.physicalIndex ?? ''),
        ),
      ].filter(Boolean),
    ),
  ];
}
export function normalizeJob(raw, start = {}) {
  const job = { ...start, ...raw };
  job.job_id = raw.jobId || raw.job_id || start.jobId || start.job_id;
  job.sceneId = raw.sceneId || raw.scene_id || start.sceneId || start.scene_id;
  job.stage = raw.stage || raw.status || 'queued';
  job.frames_done = Number(
    raw.frames_done ?? raw.framesDone ?? raw.frames?.done ?? 0,
  );
  job.total_frames = Number(
    raw.total_frames ?? raw.totalFrames ?? raw.frames?.total ?? 0,
  );
  job.patch = raw.patch
    ? { ...(start.patch?.id === raw.patch.id ? start.patch : {}), ...raw.patch }
    : raw.land_patch?.patch || start.patch || null;
  job.camera =
    raw.camera ||
    raw.pose ||
    raw.camera_pose ||
    start.camera ||
    start.pose ||
    null;
  job.frames_url_template =
    raw.frames_url_template ||
    raw.framesUrlTemplate ||
    raw.frames?.urlTemplate ||
    start.frames_url_template ||
    '';
  job.mp4_url =
    raw.mp4_url || raw.mp4Url || raw.videoUrl || raw.video?.url || '';
  job.frameMetadata = Array.isArray(raw.frames)
    ? raw.frames
    : raw.frameMetadata || [];
  return job;
}
export function stageLabel(stage) {
  return STAGES[stage] || stage || 'Queued';
}
export function progressText(job, prompt = '') {
  if (!job) return 'Building — submitting explicit scene request…';
  const g = jobGpus(job),
    gpu = g.length ? ` on GPU${g.length > 1 ? 's' : ''} ${g.join(', ')}` : '';
  if (job.stage === 'render')
    return `Building — rendering frame ${job.frames_done || 0}/${job.total_frames || '?'}${gpu}`;
  if (job.stage === 'encode')
    return `Encoding video — ${job.frames_done || 0} rendered frames (encoding is not rendering)`;
  return `${stageLabel(job.stage)}${prompt ? '' : ''}…`;
}
export function progressFraction(job) {
  const pre = {
    queued: 0.03,
    geocode: 0.06,
    land_patch: 0.1,
    scene_spec: 0.15,
    placement: 0.2,
  };
  if (!job) return 0.02;
  if (job.stage in pre) return pre[job.stage];
  if (['complete', 'partial'].includes(job.stage)) return 1;
  if (job.total_frames)
    return 0.2 + 0.8 * Math.min(1, job.frames_done / job.total_frames);
  return Math.max(0, Math.min(1, Number(job.progress) || 0.2));
}
export function buildFailure({ kind, status, body, error }) {
  const detail =
    body?.detail && typeof body.detail === 'object' ? body.detail : body || {};
  const code =
    typeof detail.error === 'string' ? detail.error : detail.code || null;
  const message =
    detail.message ||
    (typeof detail.detail === 'string' ? detail.detail : '') ||
    error?.message ||
    code ||
    'No service detail returned.';
  const title =
    kind === 'network'
      ? 'Render service unreachable'
      : kind === 'job'
        ? 'Blender job failed'
        : 'Request unavailable';
  return {
    kind,
    status: status || null,
    code,
    message,
    title,
    text: `${title}${status ? ' · HTTP ' + status : ''}${code ? ' · ' + code : ''} — ${message}`,
  };
}
export function patchFeatures(job) {
  const p = job?.patch;
  const raw = p?.features || job?.features || [];
  return Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.features)
      ? raw.features
      : [];
}
export function outlinerRows(job) {
  if (!job) return [];
  const rows = [];
  if (job.patch)
    rows.push(
      { group: 'Geographic data (service)' },
      {
        object: 'land_patch',
        label: `AOI patch · ${job.patch.id || 'identifier unavailable'}`,
        count: 1,
        data: job.patch,
      },
    );
  if (!patchFeatures(job).length)
    for (const id of job.patch?.featureIds || [])
      rows.push({
        object: `feature:${id}`,
        label: String(id),
        count: 1,
        data: { id, geometry: 'Not returned by service' },
        feature: true,
      });
  for (const [index, feature] of patchFeatures(job).entries())
    rows.push({
      object: `feature:${feature.id ?? feature.properties?.id ?? index}`,
      label:
        feature.properties?.name ||
        feature.name ||
        feature.properties?.type ||
        feature.type ||
        'Geographic feature',
      count: 1,
      data: feature,
      feature: true,
    });
  if (job.camera)
    rows.push({
      object: 'camera',
      label: 'Render camera',
      count: 1,
      data: job.camera,
    });
  const assets = job.placement?.by_asset || {};
  if (Object.keys(assets).length)
    rows.push({ group: 'Illustrative staging · not evidence' });
  for (const [key, count] of Object.entries(assets))
    rows.push({
      object: key,
      label: assetLabel(key),
      count,
      asset: true,
      data: {
        asset: key,
        instances: count,
        verification: 'illustrative — not observed',
      },
    });
  if (Array.isArray(job.references) && job.references.length)
    rows.push({ group: 'Reported reference bindings · not observations' });
  for (const ref of job.references || [])
    rows.push({
      object: `ref_${ref.id}`,
      label: ref.label || ref.id,
      reference: ref.file,
      count: ref.applied_count ?? 0,
      state: ref.applied_count > 0 ? 'applied (reported)' : 'not applied',
      data: ref,
    });
  return rows;
}
export function deviceFromEvents(job) {
  if (job?.latestFrame?.gpu?.cyclesDevice)
    return `${job.latestFrame.gpu.cyclesDevice.name} · ${job.latestFrame.gpu.cyclesDevice.type} · CPU disabled: ${job.latestFrame.gpu.cpuEnabled === false}`;
  const line = (job?.events_tail || [])
    .map((e) => e?.data?.line || '')
    .find((l) => l.startsWith('SCENE_READY'));
  return line?.match(/devices=\[([^\]]*)\]/)?.[1]?.replace(/'/g, '') || null;
}
export function propertyEntries(job, extra = {}, result = null) {
  const selected = outlinerRows(job).find((r) => r.object === extra.selection);
  const rows = [
    ['Selected', selected?.label || 'None — select an Outliner or AOI feature'],
    ['Scene', job?.sceneId || '—'],
    ['Job', job?.job_id || '—'],
    ['Revision', extra.revision ?? '—'],
    [
      'Renderer',
      job?.renderer || (job ? 'Blender (service)' : 'Awaiting service'),
    ],
    ['Device', deviceFromEvents(job) || 'Not reported'],
    ['GPUs', jobGpus(job).join(', ') || 'Not reported'],
    ['Stage', job?.stage || '—'],
    [
      'Frames rendered',
      job ? `${job.frames_done} / ${job.total_frames || '?'}` : '—',
    ],
    ['Rendered FPS', job?.fps_sustained ?? job?.renderedFps ?? 'Not reported'],
    ['Steady render FPS', job?.fps_after_first_frame ?? 'Not reported'],
    [
      'Video playback FPS',
      job?.timeline_fps ??
        job?.video_fps ??
        job?.encoding_fps ??
        job?.fps ??
        'Not reported',
    ],
    [
      'Client first frame',
      result?.clientTtffS != null ? `${result.clientTtffS} s` : '—',
    ],
    ['Service first frame', job?.ttff_s != null ? `${job.ttff_s} s` : '—'],
    ['Patch', job?.patch?.id || 'Not reported'],
    ['CRS', job?.patch?.crs ? stringify(job.patch.crs) : 'Not reported'],
    [
      'Elevation',
      job?.patch?.elevation ? stringify(job.patch.elevation) : 'Not reported',
    ],
    [
      'Geographic provenance',
      job?.patch?.provenance
        ? job.patch.provenance
            .map(
              (p) =>
                `${p.source || p.provider || 'Source'} · ${p.retrievedUtc || p.reviewedUtc || 'time unreported'}`,
            )
            .join('; ')
        : 'Not reported',
    ],
    ['Unique views / second', job?.unique_views_per_second ?? 'Not reported'],
    [
      'Verification',
      job?.patch?.verification
        ? stringify(job.patch.verification)
        : 'Unverified / not reported',
    ],
    [
      'Coordinates',
      extra.aoi
        ? `${extra.aoi.lat}, ${extra.aoi.lon} · ${extra.aoi.verification === 'verified' ? 'source-verified mapped site' : 'operator-selected, unverified'}`
        : 'Selection required',
    ],
  ];
  if (selected)
    for (const [key, value] of Object.entries(selected.data || {}))
      rows.push([key, stringify(value)]);
  return rows;
}
export function stringify(value) {
  if (Array.isArray(value) && value.length > 12)
    return `${value.length} records (full metadata in patch/source manifest)`;
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
  return text.length > 1600
    ? text.slice(0, 1600) + '… (full metadata in source manifest)'
    : text;
}
export function timelineState(job, current = 0) {
  const total = job?.total_frames || 0,
    done = job?.frames_done || 0;
  return {
    total,
    done,
    current,
    max: Math.max(1, done),
    disabled: done < 1,
    readout: `${current} / ${total || '?'}`,
  };
}
export function isCurrentRun(mine, current) {
  return Number.isInteger(mine) && mine === current;
}
/** GeoJSON uses WGS84; local geometry is accepted only if explicitly designated. Never invent a patch. */
export function planGeometry(job) {
  const patch = job?.patch;
  const geographic =
    Array.isArray(patch?.bounds) &&
    patch.bounds.length === 4 &&
    patch.bounds.every(Number.isFinite);
  const local = patch?.localBounds;
  const bounds = geographic
    ? patch.bounds
    : local && [local.minX, local.minY, local.maxX, local.maxY];
  if (
    !bounds ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    return null;
  const [w, s, e, n] = bounds;
  const project = (p) => [
    16 + ((p[0] - w) / (e - w)) * 268,
    174 - ((p[1] - s) / (n - s)) * 158,
  ];
  const shapes = [];
  const inBounds = (p) =>
    Array.isArray(p) &&
    p.length >= 2 &&
    p.slice(0, 2).every(Number.isFinite) &&
    p[0] >= w - 1e-8 &&
    p[0] <= e + 1e-8 &&
    p[1] >= s - 1e-8 &&
    p[1] <= n + 1e-8;
  for (const [index, feature] of patchFeatures(job).entries()) {
    const g = geographic
      ? feature.geometry
      : feature.localGeometry ||
        (feature.coordinateSpace === 'local' ? feature.geometry : null);
    if (!g) continue;
    const id = `feature:${feature.id ?? feature.properties?.id ?? index}`;
    const add = (coords, close = false) => {
      if (coords?.length && coords.every(inBounds))
        shapes.push({
          id,
          close,
          points: coords.map(project),
          label: feature.properties?.name || feature.name || id,
        });
    };
    if (g.type === 'Point') add([g.coordinates]);
    if (g.type === 'LineString') add(g.coordinates);
    if (g.type === 'Polygon') for (const ring of g.coordinates) add(ring, true);
    if (g.type === 'MultiLineString')
      for (const line of g.coordinates) add(line);
    if (g.type === 'MultiPolygon')
      for (const poly of g.coordinates)
        for (const ring of poly) add(ring, true);
  }
  return { bounds, geographic, shapes };
}
export function frameSource(job, n) {
  const explicit =
    job?.frames?.items?.find((f) => Number(f.number ?? f.index) === n) ||
    (Array.isArray(job?.frameMetadata)
      ? [...job.frameMetadata]
          .reverse()
          .find((f) => Number(f.number ?? f.index) === n)
      : null);
  if (explicit?.url) return explicit.url;
  if (job?.frames_url_template)
    return job.frames_url_template.replace('{n}', String(n));
  return (
    job?.latest_frame_url ||
    job?.latestFrameUrl ||
    (job?.job_id
      ? `/api/scenes/render/${encodeURIComponent(job.job_id)}/latest.jpg?n=${n}`
      : null)
  );
}

export function canSeek(job) {
  return (
    !!job?.frames_url_template ||
    !!job?.frames?.items?.length ||
    !!job?.frameMetadata?.length
  );
}
/** Counts are not indices (parallel GPU shards can finish out of order). */
export function latestFrameNumber(job) {
  const reported =
    job?.latestFrame?.index ??
    job?.latest_frame_number ??
    job?.latestFrameNumber ??
    job?.frames?.latestNumber;
  if (Number.isInteger(reported) && reported >= 0) return reported;
  const records =
    job?.frames?.items ||
    (Array.isArray(job?.frameMetadata) ? job.frameMetadata : []);
  if (records.length) {
    const numbers = records
      .map((f) => Number(f.number ?? f.index))
      .filter((v) => Number.isInteger(v) && v > 0);
    if (numbers.length) return Math.max(...numbers);
  }
  // Without a reported index, use the latest URL but label it "latest", not frames_done.
  return null;
}

/** Fail closed if rendered geography cannot be tied to the operator's selected AOI. */
export function patchSelectionIssue(job, aoi) {
  const patch = job?.patch;
  if (
    !Array.isArray(patch?.bounds) ||
    patch.bounds.length !== 4 ||
    !patch.bounds.every(Number.isFinite)
  )
    return 'No geographic patch bounds returned; cannot verify this render against the selected AOI.';
  const [w, s, e, n] = patch.bounds;
  if (w >= e || s >= n || w < -180 || e > 180 || s < -90 || n > 90)
    return 'Invalid geographic patch bounds returned.';
  if (!aoi || aoi.lon < w || aoi.lon > e || aoi.lat < s || aoi.lat > n)
    return 'Returned patch does not contain the selected AOI. Refusing a substituted location.';
  return null;
}
