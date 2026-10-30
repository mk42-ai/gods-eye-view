// 2026-10-20: the HUD summary moved from the OpenAI bypass to
// /api/ondemand/v2/summaries/hud (the server-side foundation proxy route);
// the graceful "no key" shape is unchanged, only the code name follows.
export const HUD_SUMMARY_UNCONFIGURED_CODE = 'ONDEMAND_NOT_CONFIGURED';
/** Legacy code emitted by the retired OpenAI route — still recognised. */
export const HUD_SUMMARY_LEGACY_UNCONFIGURED_CODE = 'OPENAI_NOT_CONFIGURED';

/**
 * Describe the optional HUD summary capability without turning a deliberately
 * keyless boot into an HTTP failure.
 *
 * @param {unknown} apiKey - Candidate server-side OnDemand credential.
 * @returns {{ statusCode: 200, payload: { configured: false, code: string, error: null, summary: null } }|null}
 *   A graceful unconfigured response, or null when the provider is configured.
 */
export function keylessHudSummaryResponse(apiKey) {
  if (String(apiKey ?? '').trim()) return null;
  return {
    statusCode: 200,
    payload: {
      configured: false,
      code: HUD_SUMMARY_UNCONFIGURED_CODE,
      error: null,
      summary: null,
    },
  };
}

/** Return true only for the deliberate, successful no-key capability response. */
export function isHudSummaryUnconfigured(status, data) {
  const keys =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data)
      : [];
  return (
    keys.length === 4 &&
    status === 200 &&
    data?.configured === false &&
    (data?.code === HUD_SUMMARY_UNCONFIGURED_CODE ||
      data?.code === HUD_SUMMARY_LEGACY_UNCONFIGURED_CODE) &&
    data?.error === null &&
    data?.summary === null
  );
}

/**
 * Conservative AIS copy shared by the HUD and deployment notice. A connected
 * transport, enabled toggle, cached count, or serverless build is not evidence
 * of a live feed. Callers without accepted, recent provider data stay unverified.
 */
export function describeAisAvailability(stats = {}, { now = Date.now() } = {}) {
  const state = String(
    stats.providerStatus || stats.status || stats.feedState || '',
  ).toLowerCase();
  const reason = String(
    stats.providerError || stats.error || stats.lastError || '',
  ).trim();
  const unavailable = [
    'unavailable',
    'unsupported',
    'missing-key',
    'auth-failed',
    'down',
    'closed',
    'error',
  ];
  const count = Number(stats.acceptedRowCount ?? stats.count ?? 0);
  const updated =
    typeof stats.lastUpdate === 'string'
      ? Date.parse(stats.lastUpdate)
      : Number(stats.lastUpdate);
  const recent =
    Number.isFinite(updated) &&
    updated > 0 &&
    now >= updated &&
    now - updated <= 120000;
  const knownLive = ['live', 'ok', 'healthy', 'nominal', 'streaming'].includes(
    state,
  );
  const hasError = Boolean(reason) || stats.degraded === true;
  let status = 'unverified';
  let label = 'AIS · not verified';
  let detail =
    'AIS availability has not been confirmed. An enabled layer is not proof of live vessel data.';
  if (stats.enabled === false || state === 'off' || state === 'disabled') {
    status = 'off';
    label = 'AIS · off';
    detail =
      'The AIS vessel layer is off. Enable it in Layers to check provider availability.';
  } else if (unavailable.includes(state) || stats.keyRequired === true) {
    status = 'unavailable';
    label = 'AIS · unavailable';
    detail =
      reason ||
      'The AIS provider is unavailable. No live vessel positions are confirmed.';
  } else if (
    stats.stale === true ||
    state === 'stale' ||
    (knownLive && count > 0 && !recent)
  ) {
    status = 'stale';
    label = 'AIS · stale';
    detail =
      reason ||
      'AIS positions are not confirmed current. Cached positions must not be treated as live.';
  } else if (
    ['demo', 'replay', 'fallback'].includes(state) ||
    stats.fallback === true ||
    stats.demo === true
  ) {
    status = 'fallback';
    label = 'AIS · fallback';
    detail =
      reason || 'Fallback or replay vessel positions are not a live AIS feed.';
  } else if (
    hasError ||
    ['degraded', 'reconnecting', 'partial'].includes(state)
  ) {
    status = 'degraded';
    label = 'AIS · degraded';
    detail =
      reason ||
      'The AIS feed is incomplete or interrupted. Live coverage is not confirmed.';
  } else if (
    stats.loading === true ||
    ['loading', 'connecting'].includes(state)
  ) {
    status = 'loading';
    label = 'AIS · checking';
    detail =
      'Waiting for accepted AIS vessel positions. No live coverage is confirmed yet.';
  } else if (knownLive && count > 0 && recent) {
    status = 'live';
    label = 'AIS · recent data';
    detail = `${count} accepted vessel positions were recently updated. Coverage is limited to the provider query area, not global.`;
  }
  return { status, label, detail, live: status === 'live' };
}
