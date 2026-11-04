/** Bounded parallel OnDemand research. Each emission is generation-scoped.
 * Only source-backed recordings enter `items`; discovery leads are separate.
 */
import { randomUUID } from 'node:crypto';
import {
  buildEvidenceItem,
  buildSignal,
  rankEvidence,
  sanitizeForCache,
  evidenceKey,
  deterministicSummary,
} from '../../src/sceneEvidence/model.js';
import {
  resolveEvidenceWindow,
  validPoint,
} from '../../src/sceneEvidence/qualification.js';
import { SourceError } from './sources.js';
import { providerFailure } from './safety.js';

export function createEvidenceCache({
  ttlMs = 15 * 60_000,
  max = 64,
  now = () => Date.now(),
} = {}) {
  const map = new Map();
  return {
    get(key) {
      const e = map.get(key);
      if (e && now() - e.at <= ttlMs) return e;
      map.delete(key);
      return null;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { ...value, at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    clear: () => map.clear(),
    size: () => map.size,
  };
}
export async function runSceneEvidence(input, deps) {
  const t0 = Date.now(),
    now = deps.now || new Date(),
    env = deps.env || process.env;
  const requestId = input.requestId || randomUUID();
  const parent = deps.signal;
  const overall = new AbortController();
  const deadlineMs = Number(deps.overallBudgetMs) || 24000;
  let endTimer;
  const signal = parent
    ? AbortSignal.any([parent, overall.signal])
    : overall.signal;
  const emit = (event, data) => {
    if (!parent?.aborted) deps.emit?.(event, { ...data, requestId });
  };
  const window = resolveEvidenceWindow(input, now);
  const radiusKm =
    input.radiusKm === undefined || Number.isNaN(input.radiusKm)
      ? 5
      : input.radiusKm;
  if (
    !validPoint(input.lat, input.lon) ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0 ||
    radiusKm > 50
  ) {
    clearTimeout(endTimer);
    throw new Error('invalid_evidence_scope');
  }
  const anchor = { lat: input.lat, lon: input.lon };
  const place = String(input.place || input.text || '').slice(0, 80);
  const key = evidenceKey({
    ...input,
    place,
    radiusKm,
    windowHours: window.hours,
  });
  const timings = {
    firstProviderResultMs: null,
    firstCandidateMs: null,
    firstVerifiedItemMs: null,
    sourcesMs: null,
    totalMs: null,
  };
  const sources = input.allowedPlatforms
    ? deps.sources.filter((source) =>
        source.platforms?.some((platform) =>
          input.allowedPlatforms.includes(platform),
        ),
      )
    : deps.sources;
  const status = sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    platforms: s.platforms,
    credentials: s.credentials,
    docs: s.docs,
    state: s.configured(env)
      ? 'running'
      : s.unavailableState || 'credentials_required',
    note: s.configured(env)
      ? ''
      : s.unavailableNote || `Requires ${s.credentials.join(' + ')}`,
    ms: null,
    count: 0,
    candidateCount: 0,
    verifiedVideoCount: 0,
    requestId,
  }));
  const items = new Map(),
    candidates = new Map(),
    signals = new Map(),
    transport = [];
  const context = {
    place,
    aliases: [],
    anchor,
    radiusKm,
    now,
    window,
    windowHours: window.hours,
  };
  endTimer = setTimeout(() => overall.abort('overall_deadline'), deadlineMs);
  emit('plan', {
    key,
    place,
    anchor,
    radiusKm,
    window,
    windowHours: window.hours,
    engine: 'deterministic-policy',
    sources: status,
    builtAt: now.toISOString(),
  });
  // Reopened caches are snapshots only: Build and Rebuild always query providers.
  // They are never returned as current footage without requalification.
  try {
    await Promise.all(
      sources.map(async (src, index) => {
        const st = status[index],
          started = Date.now();
        if (st.state !== 'running') {
          emit('source', st);
          return;
        }
        const local = new AbortController();
        const localSignal = AbortSignal.any([signal, local.signal]);
        let accepting = true,
          timer,
          listener;
        const onTransport = (event) => {
          if (!accepting || localSignal.aborted) return;
          const safe = {
            ...event,
            requestId,
            utc: event.utc || new Date().toISOString(),
          };
          transport.push(safe);
          emit('transport', safe);
          // Safe transport-only diagnostics: never bodies/headers/full URLs.
          deps.audit?.('scene_provider_transport', safe);
        };
        const onRaw = (event) => {
          if (!accepting || localSignal.aborted) return;
          if (event.type === 'item') {
            const it = buildEvidenceItem(
              { ...event.raw, sourceId: src.id, sourceName: src.name },
              context,
            );
            if (
              !it ||
              (input.allowedPlatforms &&
                !input.allowedPlatforms.includes(it.platform))
            )
              return;
            const dest = it.eligible ? items : candidates;
            const old = dest.get(it.id);
            if (old) {
              old.alsoFrom = [...new Set([...(old.alsoFrom || []), src.id])];
              return;
            }
            dest.set(it.id, it);
            st.count += 1;
            if (it.eligible) {
              st.verifiedVideoCount += 1;
              timings.firstVerifiedItemMs ??= Date.now() - t0;
              emit('item', it);
            } else {
              st.candidateCount += 1;
              timings.firstCandidateMs ??= Date.now() - t0;
              emit('candidate', it);
            }
          } else if (event.type === 'signal') {
            const s = buildSignal(event.raw, context);
            // Context must name the actual place and be published inside the window.
            if (
              !s ||
              s.geo.precision !== 'text' ||
              !s.publishedAt ||
              Date.parse(s.publishedAt) < Date.parse(window.startUtc) ||
              Date.parse(s.publishedAt) >= Date.parse(window.endUtc)
            )
              return;
            signals.set(s.id, s);
            emit('signal', s);
          }
        };
        emit('source', st);
        try {
          const budget = Math.min(src.budgetMs, deadlineMs);
          const stop = new Promise((_, reject) => {
            listener = () =>
              reject(
                new SourceError(
                  parent?.aborted ? 'cancelled' : 'timeout',
                  parent?.aborted
                    ? 'Request superseded/disconnected'
                    : 'Provider deadline exceeded',
                ),
              );
            localSignal.addEventListener('abort', listener, { once: true });
            timer = setTimeout(() => local.abort('source_deadline'), budget);
            if (localSignal.aborted) listener();
          });
          const work = src.run(
            {
              ...context,
              env,
              signal: localSignal,
              fetch: deps.fetch,
              invoke: deps.invoke,
              requestId,
              onTransport,
              pluginEndpointId:
                env.SCENE_EVIDENCE_ENDPOINT_ID || deps.defaultEndpointId,
            },
            onRaw,
          );
          const result = await Promise.race([work, stop]);
          if (localSignal.aborted)
            throw new SourceError('timeout', 'Provider deadline exceeded');
          Object.assign(st, {
            state: st.count ? 'ok' : 'empty',
            note: result?.note || '',
            transportStatus: result?.transportStatus || null,
          });
        } catch (error) {
          Object.assign(st, providerFailure(error, env));
        } finally {
          accepting = false;
          clearTimeout(timer);
          localSignal.removeEventListener('abort', listener);
          local.abort('source_finished');
          st.ms = Date.now() - started;
          timings.firstProviderResultMs ??= Date.now() - t0;
          emit('source', st);
        }
      }),
    );
    timings.sourcesMs = Date.now() - t0;
    if (parent?.aborted)
      throw new SourceError('cancelled', 'Request superseded/disconnected');
    const ranked = rankEvidence([...items.values()]),
      rejected = rankEvidence([...candidates.values()]);
    const summary = deterministicSummary({
      place,
      items: ranked,
      candidates: rejected,
      signals: [...signals.values()],
      sources: status,
    });
    emit('summary', summary);
    const rejectionCounts = rejected.reduce((out, it) => {
      for (const reason of it.qualification.reasons)
        out[reason] = (out[reason] || 0) + 1;
      return out;
    }, {});
    const totals = {
      items: ranked.length,
      candidates: rejected.length,
      verifiedVideos: ranked.length,
      playbackVerified: 0,
      signals: signals.size,
      rejectionCounts,
      byProvider: Object.fromEntries(
        status.map((s) => [
          s.id,
          {
            candidates: s.candidateCount,
            verifiedVideos: s.verifiedVideoCount,
            playbackVerified: 0,
            state: s.state,
          },
        ]),
      ),
    };
    timings.totalMs = Date.now() - t0;
    const result = {
      requestId,
      key,
      place,
      anchor,
      radiusKm,
      windowHours: window.hours,
      window,
      items: ranked,
      candidates: rejected,
      signals: [...signals.values()],
      sources: status,
      summary,
      totals,
      timings,
      transport,
      builtAt: now.toISOString(),
      cached: false,
      engine: 'deterministic-policy',
    };
    deps.cache?.set(key, {
      ...result,
      items: ranked.map(sanitizeForCache),
      candidates: rejected.map(sanitizeForCache),
    });
    emit('done', result);
    return result;
  } finally {
    clearTimeout(endTimer);
    overall.abort('complete');
  }
}
