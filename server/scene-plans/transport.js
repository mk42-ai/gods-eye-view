/** Documented OnDemand chat API. Authentication stays in the existing server client. */
import { randomUUID } from 'node:crypto';
import { ondemandFetch } from '../ondemand/client.js';
import { config } from '../ondemand/config.js';

export class SceneServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'SceneServiceError';
    Object.assign(this, { status, code, details });
  }
}
export function parseProviderJson(answer) {
  if (typeof answer !== 'string' || answer.length > 180000)
    throw new SceneServiceError(
      502,
      'provider_json_invalid',
      'The provider did not return bounded JSON.',
    );
  let source = answer.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  if (fenced) source = fenced[1];
  try {
    const data = JSON.parse(source);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new SceneServiceError(
      502,
      'provider_json_invalid',
      'The provider did not return a JSON object.',
    );
  }
}

function pausePolling(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException('Request cancelled', 'AbortError'));
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Request cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createChatTransport({
  fetchImpl = ondemandFetch,
  getSettings = () => config,
  pollIntervalMs = 750,
  pollTimeoutMs = 30000,
  maxPolls = 12,
  sleep = pausePolling,
  now = () => Date.now(),
} = {}) {
  async function request(path, body, signal, timeoutMs = 110000) {
    const settings = getSettings();
    if (!settings.apiKey)
      throw new SceneServiceError(
        503,
        'server_key_unavailable',
        'Server-side OnDemand authentication is not configured.',
      );
    let response;
    try {
      response = await fetchImpl(
        `${settings.baseUrl.replace(/\/$/, '')}${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          ...(body === undefined ? {} : { body }),
          timeoutMs,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (e) {
      throw new SceneServiceError(
        e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 504 : 502,
        'provider_unavailable',
        'The OnDemand service could not complete this request.',
      );
    }
    if (!response.ok)
      throw new SceneServiceError(
        response.status === 429
          ? 429
          : response.status === 401 || response.status === 403
            ? 503
            : 502,
        'provider_request_failed',
        'The OnDemand provider rejected the request.',
      );
    try {
      return await response.json();
    } catch {
      throw new SceneServiceError(
        502,
        'provider_response_invalid',
        'The provider returned an unreadable response.',
      );
    }
  }
  return {
    configured: () => Boolean(getSettings().apiKey),
    async createSession(pluginIds = [], { signal } = {}) {
      const externalUserId = `scene-${randomUUID()}`;
      const result = await request(
        '/chat/v1/sessions',
        { externalUserId, pluginIds },
        signal,
      );
      const id = result?.data?.id;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new SceneServiceError(
          502,
          'provider_session_invalid',
          'The provider did not create a valid scene session.',
        );
      return { id, externalUserId, pluginIds };
    },
    async query(
      session,
      query,
      {
        pluginIds = session.pluginIds,
        fulfillmentOnly = false,
        fulfillmentPrompt,
        signal,
        endpointId: endpointOverride,
        reasoningEffort,
        timeoutMs,
      } = {},
    ) {
      const endpointId =
        endpointOverride || getSettings().fulfillmentEndpointId;
      if (!endpointId)
        throw new SceneServiceError(
          503,
          'endpoint_unavailable',
          'No scene-planning model is configured.',
        );
      const result = await request(
        `/chat/v1/sessions/${encodeURIComponent(session.id)}/query`,
        {
          query,
          endpointId,
          responseMode: 'sync',
          pluginIds,
          fulfillmentOnly,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          modelConfigs: {
            temperature: 0.2,
            ...(fulfillmentPrompt ? { fulfillmentPrompt } : {}),
          },
        },
        signal,
        // Perplexity RAG alone can take 60–110 s; research callers may extend
        // the per-request bound (still inside the 300 s function limit).
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? Math.min(timeoutMs, 200000)
          : undefined,
      );
      let data = result?.data;
      const messageId = data?.messageId;
      const validId = (id) =>
        typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
      const deadline = now() + Math.max(0, Math.min(60000, pollTimeoutMs));
      let polls = 0;
      while (data?.status === 'processing') {
        if (!validId(messageId))
          throw new SceneServiceError(
            503,
            'provider_pending',
            'The provider is processing but returned no valid message identifier for status polling.',
          );
        if (data.sessionId && data.sessionId !== session.id)
          throw new SceneServiceError(
            502,
            'provider_session_mismatch',
            'The processing response did not match this scene session.',
          );
        if (polls >= Math.max(0, Math.min(30, maxPolls)) || now() >= deadline)
          throw new SceneServiceError(
            504,
            'provider_poll_timeout',
            'The provider is still processing after the bounded status checks. No query was resubmitted.',
            { polls },
          );
        await sleep(
          Math.min(Math.max(0, pollIntervalMs), Math.max(0, deadline - now())),
          signal,
        );
        if (signal?.aborted)
          throw new DOMException('Request cancelled', 'AbortError');
        const status = await request(
          `/chat/v1/sessions/${encodeURIComponent(session.id)}/messages/${encodeURIComponent(messageId)}`,
          undefined,
          signal,
          Math.max(1, Math.floor(deadline - now())),
        );
        polls++;
        data = status?.data;
        if (
          !data ||
          !['processing', 'completed', 'failed'].includes(data.status)
        )
          throw new SceneServiceError(
            502,
            'provider_status_invalid',
            'The status endpoint returned no supported terminal/processing status.',
          );
        if (
          (data?.id && data.id !== messageId) ||
          (data?.messageId && data.messageId !== messageId)
        )
          throw new SceneServiceError(
            502,
            'provider_message_mismatch',
            'The status response did not match the submitted message.',
          );
      }
      if (data?.status && !['completed', 'failed'].includes(data.status))
        throw new SceneServiceError(
          502,
          'provider_status_invalid',
          'The provider returned an unsupported message status.',
        );
      if (
        data?.status === 'failed' ||
        typeof data?.answer !== 'string' ||
        !data.answer.trim()
      )
        throw new SceneServiceError(
          502,
          'provider_output_missing',
          'The provider returned no completed scene output.',
        );
      if (data.sessionId && data.sessionId !== session.id)
        throw new SceneServiceError(
          502,
          'provider_session_mismatch',
          'The provider response did not match this scene session.',
        );
      return {
        answer: data.answer,
        endpointId,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        sessionId: session.id,
        messageId:
          typeof data.messageId === 'string'
            ? data.messageId
            : validId(messageId)
              ? messageId
              : null,
      };
    },
    async media(session, pluginId, { signal } = {}) {
      const params = new URLSearchParams({
        externalUserId: session.externalUserId,
        plugins: pluginId,
        source: 'audio',
        limit: '50',
        sort: '-createdAt',
      });
      const result = await request(
        `/media/v1/public/file?${params}`,
        undefined,
        signal,
      );
      return Array.isArray(result?.data) ? result.data : [];
    },
  };
}
