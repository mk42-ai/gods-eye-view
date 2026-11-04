/**
 * Scene Workstation — pure presentation model (no DOM).
 *
 * Everything the Build loop shows is derived here from the render job record
 * so it can be unit-tested without a browser: the progress line
 * ("Building — rendering frame i/N on GPU x"), the failure banner (HTTP status
 * + service message, never a silent return to "Ready"), the outliner rows
 * (environment, placed assets, reference-asset bindings), the properties
 * entries (frames / GPUs / time-to-first-frame) and the timeline state.
 */

export const ASSET_LABELS = Object.freeze({
  police_patrol_car: 'Police patrol car',
  police_escort_motorcycle: 'Police motorcycle',
  ambulance_medical_point: 'Ambulance',
  crowd_control_barrier: 'Crowd barrier',
  road_closed_barricade: 'Road barricade',
  traffic_cone_cluster: 'Traffic cone',
  checkpoint_cordon_node: 'Checkpoint barrier',
  start_finish_gate: 'Start/finish gate',
  foot_patrol_officer: 'Officer on foot',
  spectator_crowd_cluster: 'Pedestrian group',
  cctv_camera: 'CCTV camera',
  city_bus: 'Bus',
  event_command_post: 'Command post',
  marine_patrol_boat: 'Patrol boat',
  civilian_sedan: 'Silver sedan (crash vehicle)',
  civilian_suv: 'Civilian SUV',
  civilian_taxi: 'Civilian taxi',
  civilian_hatchback: 'Blue hatchback (crash vehicle)',
  debris_bumper: 'Debris · bumper',
  debris_tire: 'Debris · tyre',
  debris_door: 'Debris · door',
  debris_plate: 'Debris · plate',
  debris_cluster_decal: 'Debris cluster (reference decal)',
  mall_facade_module: 'Mall facade module',
});

/**
 * The four studio reference images supplied for crash scenes and the scene
 * element each one drives. `applies_to` lists the placement keys the render
 * service binds the reference to (paint/material + decal/facade texture).
 */
export const REFERENCE_ASSETS = Object.freeze([
  {
    id: 'silver_sedan',
    file: 'D3IfJIiClM.png',
    label: 'Silver sedan · crumpled front (reference)',
    applies_to: ['civilian_sedan'],
  },
  {
    id: 'blue_hatchback',
    file: 'Rv6TULP5dW.png',
    label: 'Blue hatchback · dented corner (reference)',
    applies_to: ['civilian_hatchback'],
  },
  {
    id: 'mall_facade_module',
    file: 'HrOVNUqLwL.png',
    label: 'Mall entrance facade module (reference)',
    applies_to: ['mall_facade_module'],
  },
  {
    id: 'debris_cluster',
    file: 'ewvknQr9AP.png',
    label: 'Collision debris cluster (reference)',
    applies_to: [
      'debris_cluster_decal',
      'debris_bumper',
      'debris_tire',
      'debris_door',
      'debris_plate',
    ],
  },
]);

const STAGE_LABELS = Object.freeze({
  queued: 'Queued',
  geocode: 'Locating',
  land_patch: 'Fetching land patch',
  scene_spec: 'Planning scene',
  placement: 'Placing assets',
  render: 'Rendering (Cycles · OptiX)',
  encode: 'Encoding',
});

export function assetLabel(key) {
  return ASSET_LABELS[key] || String(key || '').replace(/_/g, ' ');
}

/** Distinct GPU indices the job's shards run on, in launch order. */
export function jobGpus(job) {
  const out = [];
  for (const s of job?.shards || []) {
    const g = String(s?.gpu ?? '');
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Progress line for the viewport while a Build is in flight.
 * "Building — rendering frame 22/96 on GPUs 2, 6" during the render stage,
 * "Building — planning scene…" before it.
 */
export function progressText(job, prompt = '') {
  if (!job)
    return `Building “${prompt}” — locating, planning scene, starting Blender…`;
  const stage = job.stage || 'queued';
  const gpus = jobGpus(job);
  const gpuText = gpus.length
    ? ` on GPU${gpus.length > 1 ? 's' : ''} ${gpus.join(', ')}`
    : '';
  if (stage === 'render' || stage === 'encode') {
    const i = job.frames_done || 0;
    const n = job.total_frames || '?';
    return `Building — rendering frame ${i}/${n}${gpuText}`;
  }
  const label = STAGE_LABELS[stage] || stage;
  return `Building — ${label.toLowerCase()}…`;
}

/** 0..1 progress for the progress bar (stage-weighted before frames arrive). */
export function progressFraction(job) {
  if (!job) return 0.02;
  const stage = job.stage || 'queued';
  const pre = {
    queued: 0.03,
    geocode: 0.06,
    land_patch: 0.1,
    scene_spec: 0.15,
    placement: 0.2,
  };
  if (stage in pre) return pre[stage];
  if (stage === 'render' || stage === 'encode') {
    const n = job.total_frames || 0;
    const i = job.frames_done || 0;
    return n ? 0.2 + 0.8 * Math.min(1, i / n) : 0.2;
  }
  if (stage === 'complete' || stage === 'partial') return 1;
  return typeof job.progress === 'number' ? job.progress : 0.2;
}

/**
 * Failure banner contents. `kind` separates the three ways a Build can fail
 * so the banner never collapses them into "Ready":
 *   request  — POST /api/scenes/render answered non-2xx (HTTP status + body)
 *   job      — the Blender job reached stage 'failed'
 *   network  — fetch threw (offline / proxy unreachable)
 */
export function buildFailure({ kind, status, body, error, prompt }) {
  const detail = body && typeof body === 'object' ? body : {};
  const code = detail.error || detail.detail || null;
  let message =
    detail.message ||
    (typeof detail.detail === 'string' ? detail.detail : '') ||
    (error ? String(error.message || error) : '') ||
    'no message from service';
  if (kind === 'request' && code === 'gpu_policy_violation')
    message = `${message} Advertised GPUs: ${(detail.advertised_gpus || []).join(', ') || 'unknown'}.`;
  const httpText = status ? `HTTP ${status}` : 'no response';
  const title =
    kind === 'job'
      ? 'Blender job failed'
      : kind === 'network'
        ? 'Render service unreachable'
        : 'Scene build failed';
  return {
    kind,
    title,
    status: status || null,
    code,
    message,
    text: `${title} · ${httpText}${code ? ` ${code}` : ''} — ${message}${prompt ? ` (prompt: “${prompt}”)` : ''}`,
  };
}

function envRows(job) {
  const rows = [
    { group: 'Environment' },
    {
      object: 'land_patch',
      label: 'Ground · satellite patch + roads',
      count: 1,
    },
  ];
  if (job?.land_patch?.roads)
    rows.push({
      object: 'roads',
      label: 'OSM roads',
      count: job.land_patch.roads,
    });
  if (job?.land_patch?.buildings)
    rows.push({
      object: 'buildings',
      label: 'OSM buildings (extruded)',
      count: job.land_patch.buildings,
    });
  const facade = job?.references?.find((r) => r.id === 'mall_facade_module');
  if (facade?.applied_count)
    rows.push({
      object: 'mall_facade_module',
      label: `${job?.focal?.name || 'Mall'} facade modules (reference)`,
      count: facade.applied_count,
      reference: facade.file,
    });
  rows.push({
    object: 'sun_sky',
    label: `Sun + sky (${job?.time_of_day || 'auto'})`,
    count: 1,
  });
  rows.push({ object: 'camera', label: 'Camera (crane orbit)', count: 1 });
  return rows;
}

/**
 * Outliner rows: environment, placed assets (from the job's real
 * `placement.by_asset`), then the reference-asset bindings the service
 * reports in `job.references` (or, for a service that predates the binding
 * step, the four references marked "not applied on render host").
 */
export function outlinerRows(job) {
  if (!job) return [];
  const rows = envRows(job);
  const by = job?.placement?.by_asset || {};
  const keys = Object.keys(by).sort();
  if (keys.length) {
    rows.push({ group: 'Placed assets' });
    for (const k of keys)
      rows.push({ object: k, label: assetLabel(k), count: by[k], asset: true });
  }
  const refs = Array.isArray(job?.references) ? job.references : null;
  rows.push({ group: 'Reference assets' });
  for (const ref of REFERENCE_ASSETS) {
    const applied = refs?.find((r) => r.id === ref.id);
    const placed = ref.applies_to.reduce((n, k) => n + (by[k] || 0), 0);
    rows.push({
      object: `ref_${ref.id}`,
      label: ref.label,
      reference: ref.file,
      count: applied ? applied.applied_count || placed : placed,
      state: applied
        ? 'applied'
        : refs
          ? 'not used in this scene'
          : 'not applied on render host',
    });
  }
  return rows;
}

/** Device string parsed from the Blender SCENE_READY log line, if present. */
export function deviceFromEvents(job) {
  const line = (job?.events_tail || [])
    .map((e) => e?.data?.line || '')
    .find((l) => l.startsWith('SCENE_READY'));
  if (!line) return null;
  const m = line.match(/devices=\[([^\]]*)\]/);
  return m ? m[1].replace(/'/g, '') : null;
}

/** Properties panel entries as [label, value] pairs. */
export function propertyEntries(job, extra = {}, result = null) {
  const gpus = jobGpus(job);
  const refs = Array.isArray(job?.references) ? job.references : null;
  const dev = deviceFromEvents(job);
  return [
    ['Renderer', 'Blender Cycles · OptiX'],
    ['Device', dev || 'GPU (OptiX)'],
    ['GPUs', gpus.length ? gpus.join(', ') : 'allowed 2, 6'],
    [
      'Place',
      job?.focal
        ? `${job.focal.name} (${Number(job.focal.lat).toFixed(4)}, ${Number(job.focal.lon).toFixed(4)})`
        : extra.place || '—',
    ],
    ['Located by', extra.locationSource || job?.focal?.source || '—'],
    [
      'Scene spec',
      job?.model?.attempts?.[0]?.endpointId || job?.model?.endpointId || '—',
    ],
    ['Scenario', job?.spec?.scenarioType || '—'],
    ['Prompt seed', job?.seed ?? extra.seed ?? '—'],
    ['Objects', job?.placement?.instances ?? '—'],
    [
      'Reference assets',
      refs
        ? `${refs.filter((r) => r.applied_count).length} / ${REFERENCE_ASSETS.length} applied`
        : job
          ? 'not applied on render host (service predates binding step)'
          : '—',
    ],
    ['Stage', job?.stage || '—'],
    [
      'Frames',
      job?.total_frames ? `${job.frames_done || 0} / ${job.total_frames}` : '—',
    ],
    ['First frame', job?.ttff_s ? `${job.ttff_s} s (service)` : '—'],
    [
      'Client first frame',
      result?.clientTtffS ? `${result.clientTtffS} s` : '—',
    ],
    ['Sustained fps', job?.fps_sustained ?? '—'],
    ['Steady fps', job?.fps_after_first_frame ?? '—'],
    ['Encoder', job?.encoder || '—'],
    ['Job', job?.job_id || '—'],
  ];
}

/** Timeline state derived from the job: scrub range, enabled flag, readout. */
export function timelineState(job, current = 0) {
  const total = job?.total_frames || 0;
  const done = job?.frames_done || 0;
  const shown = Math.min(done, Math.max(0, current)) || done;
  return {
    total,
    done,
    current: shown,
    max: Math.max(1, done),
    disabled: done < 1,
    readout: `${shown} / ${total}`,
  };
}

/**
 * Request sequencing guard: a result belongs to the latest Build only when its
 * run id equals the current run id. Older runs must drop every write.
 */
export function isCurrentRun(mine, current) {
  return Number.isInteger(mine) && mine === current;
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || 'Queued';
}
