/**
 * OnDemand foundation — server-side proxy route, mounted at
 *   /api/ondemand/v2/*   (served by the api/[...route].js catch-all →
 *   server/serverless/app.js → mountFoundationRoutes(router))
 *
 * The browser NEVER holds an OnDemand key for these routes: the key comes
 * from process.env.ONDEMAND_API_KEY through server/ondemand/config.js →
 * foundation/client.js, and an incoming client-key header (the legacy override) is ignored
 * (the response always says `X-OnDemand-Key-Source: server`). The legacy
 * routes (/api/ondemand/chat, /api/ondemand/sessions) keep their
 * per-request override ONLY when ONDEMAND_ALLOW_CLIENT_KEY=1 (dev flag,
 * see server/ondemand/client.js#resolveRequestKey).
 *
 * Surface
 *   GET    /api/ondemand/v2/health
 *   GET    /api/ondemand/v2/contracts
 *   POST   /api/ondemand/v2/conversations          {externalUserId, objectContext?, pluginIds?}
 *   GET    /api/ondemand/v2/conversations?externalUserId=
 *   DELETE /api/ondemand/v2/conversations          {externalUserId, objectContext?}
 *   POST   /api/ondemand/v2/chat                   {externalUserId, objectContext?, query, endpointId?,
 *                                                    pluginIds?, fulfillmentOnly?, responseMode?='stream',
 *                                                    reasoningEffort?, modelConfigs?}
 *   GET    /api/ondemand/v2/messages?externalUserId=&objectContextKey=&limit=&cursor=
 *   POST   /api/ondemand/v2/workflows/execute      {workflowId?}  (defaults to config.spatialFlowId)
 *   GET    /api/ondemand/v2/workflows/executions/:executionID/stream   (polling relay as SSE)
 *
 * Streaming: upstream SSE events are parsed and re-emitted one per event
 * (`event:` + `data:` JSON) with a proxy heartbeat comment every 15 s; a
 * client disconnect aborts the upstream fetch (abort propagation).
 */

import { config, isConfigured } from '../config.js';
import {
  readJsonBody,
  BodyError,
  sendJson,
  rejectCrossOrigin,
  getRequestUrl,
} from '../http.js';
import {
  getOnDemandClient,
  OnDemandHttpError,
  OnDemandNotConfiguredError,
  OnDemandAbortError,
} from './client.js';
import {
  getConversationStore,
  objectContextKey,
} from './conversation-store.js';
import { contractRegistry } from './contracts.js';
import {
  ValidationError,
  validateExternalUserId,
  validatePluginIds,
} from './types.js';

export const FOUNDATION_MOUNT = '/api/ondemand/v2';
const KEY_SOURCE_HEADER = 'X-OnDemand-Key-Source';
const HEARTBEAT_MS = 15_000;
const MAX_BODY = 256 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;

function errorToResponse(err) {
  if (err instanceof ValidationError)
    return [
      400,
      { error: 'validation_error', field: err.field, message: err.message },
    ];
  if (err instanceof OnDemandNotConfiguredError)
    return [503, { error: 'not_configured', message: err.message }];
  if (err instanceof OnDemandAbortError)
    return [err.status, { error: err.reason }];
  if (err instanceof OnDemandHttpError)
    return [
      err.status === 429 ? 429 : err.status >= 500 ? 502 : err.status,
      {
        error: err.rateLimited ? 'rate_limited' : 'upstream_error',
        status: err.status,
        upstream: err.upstream,
        traceId: err.meta?.traceId,
      },
    ];
  if (err instanceof BodyError) return [err.status, err.payload];
  if (err?.name === 'ContractError')
    return [400, { error: 'contract_error', message: err.message }];
  return [500, { error: 'internal_error' }];
}

function validateObjectContext(ctx) {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx !== 'object' || Array.isArray(ctx))
    throw new ValidationError('objectContext', 'object');
  if (Buffer.byteLength(JSON.stringify(ctx), 'utf8') > MAX_CONTEXT_BYTES)
    throw new ValidationError(
      'objectContext',
      `at most ${MAX_CONTEXT_BYTES} bytes`,
    );
  return ctx;
}

/** Build the fulfilment prompt that grounds a mini-chat in its object context. */
export function contextPrompt(ctx) {
  if (!ctx) return undefined;
  const compact = JSON.stringify(ctx).slice(0, 6000);
  return [
    'You are the OnDemand analyst inside a spatial intelligence workstation.',
    'Answer about the OBJECT CONTEXT below. Cite sources (URLs) whenever a research tool was used; say plainly when something is not in the context.',
    `OBJECT CONTEXT (JSON): ${compact}`,
  ].join('\n');
}

/**
 * Resolve (create or reuse) the OnDemand session for (user, objectContext).
 */
async function ensureConversation(
  client,
  store,
  externalUserId,
  objectContext,
  pluginIds,
) {
  const ctxKey = objectContextKey(
    objectContext
      ? {
          objectType: objectContext.objectType,
          objectId: objectContext.objectId,
        }
      : 'global',
  );
  const existing = await store.get(externalUserId, ctxKey);
  if (existing?.sessionId) {
    if (objectContext)
      await store.put(externalUserId, ctxKey, { objectContext });
    return { ...existing, reused: true };
  }
  const session = await client.sessions.create({
    externalUserId,
    ...(pluginIds && pluginIds.length ? { pluginIds } : {}),
  });
  const rec = await store.put(externalUserId, ctxKey, {
    sessionId: session.id,
    pluginIds: pluginIds || [],
    objectContext,
  });
  return { ...rec, reused: false };
}

function writeSse(res, event, data) {
  res.write(
    `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
  );
}

async function handleChat(req, res, client, store) {
  const body = await readJsonBody(req, { maxBytes: MAX_BODY });
  const externalUserId = validateExternalUserId(body.externalUserId);
  const objectContext = validateObjectContext(body.objectContext);
  const pluginIds = validatePluginIds(body.pluginIds);
  const responseMode =
    body.responseMode === undefined ? 'stream' : body.responseMode;
  if (!['sync', 'stream'].includes(responseMode))
    throw new ValidationError('responseMode', 'sync | stream');
  if (typeof body.query !== 'string' || body.query.trim() === '')
    throw new ValidationError('query', 'required');
  const endpointId =
    typeof body.endpointId === 'string' && body.endpointId
      ? body.endpointId
      : config.fulfillmentEndpointId;
  const conv = await ensureConversation(
    client,
    store,
    externalUserId,
    objectContext,
    pluginIds,
  );
  const modelConfigs = { ...(body.modelConfigs || {}) };
  const grounding = contextPrompt(conv.objectContext || objectContext);
  if (grounding && !modelConfigs.fulfillmentPrompt)
    modelConfigs.fulfillmentPrompt = grounding;
  const input = {
    query: body.query,
    endpointId,
    responseMode,
    ...(pluginIds && pluginIds.length ? { pluginIds } : {}),
    ...(body.fulfillmentOnly !== undefined
      ? { fulfillmentOnly: body.fulfillmentOnly }
      : { fulfillmentOnly: !(pluginIds && pluginIds.length) }),
    ...(Object.keys(modelConfigs).length ? { modelConfigs } : {}),
    ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
  };

  if (responseMode === 'sync') {
    const out = await client.query.sync(conv.sessionId, input);
    await store.touch(externalUserId, conv.objectContextKey);
    sendJson(res, 200, {
      sessionId: conv.sessionId,
      objectContextKey: conv.objectContextKey,
      reused: conv.reused,
      messageId: out?.data?.messageId,
      answer: out?.data?.answer ?? '',
      status: out?.data?.status,
      metrics: out?.data?.metrics,
      provenance: {
        provider: 'OnDemand',
        endpointId,
        pluginIds: pluginIds || [],
      },
    });
    return;
  }

  // ---- stream ----
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('close', abort);
  res.on('close', abort);
  let stream;
  try {
    stream = await client.query.stream(conv.sessionId, input, {
      signal: controller.signal,
    });
  } catch (err) {
    req.off?.('close', abort);
    res.off?.('close', abort);
    if (controller.signal.aborted) {
      try {
        res.end();
      } catch {
        /* gone */
      }
      return;
    }
    throw err;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  writeSse(res, 'session', {
    sessionId: conv.sessionId,
    objectContextKey: conv.objectContextKey,
    reused: conv.reused,
    endpointId,
  });
  const heartbeat = setInterval(() => {
    try {
      res.write(`: proxy-heartbeat ${new Date().toISOString()}\n\n`);
    } catch {
      /* gone */
    }
  }, HEARTBEAT_MS);
  let delivered = 0;
  try {
    for await (const evt of stream.events) {
      if (controller.signal.aborted) break;
      delivered += 1;
      if (evt.event === 'done') {
        writeSse(res, 'done', { delivered });
        break;
      }
      writeSse(res, evt.event, evt.data);
    }
    await store.touch(externalUserId, conv.objectContextKey);
  } catch (err) {
    if (!controller.signal.aborted) {
      const [, payload] = errorToResponse(err);
      writeSse(res, 'error', payload);
    }
  } finally {
    clearInterval(heartbeat);
    req.off?.('close', abort);
    res.off?.('close', abort);
    try {
      res.end();
    } catch {
      /* already ended */
    }
  }
}

async function handleWorkflowStream(req, res, client, executionID) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on('close', abort);
  res.on('close', abort);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  writeSse(res, 'note', {
    polling: true,
    reason:
      'OnDemand exposes no SSE log endpoint (verified 2026-10-20); this is a 3 s polling relay capped at 50 s per request.',
  });
  try {
    for await (const snap of client.workflows.follow(executionID, {
      intervalMs: 3000,
      maxMs: 50_000,
      signal: controller.signal,
    })) {
      writeSse(res, 'status', { status: snap.status, terminal: snap.terminal });
      for (const log of snap.newLogs) writeSse(res, 'log', log);
      if (snap.terminal) {
        writeSse(res, 'done', { status: snap.status });
        break;
      }
    }
  } catch (err) {
    if (!controller.signal.aborted)
      writeSse(res, 'error', errorToResponse(err)[1]);
  } finally {
    req.off?.('close', abort);
    res.off?.('close', abort);
    try {
      res.end();
    } catch {
      /* ended */
    }
  }
}

/**
 * The mounted handler: `req.url` is the remainder after FOUNDATION_MOUNT.
 * @param {{client?: ReturnType<typeof getOnDemandClient>, store?: ReturnType<typeof getConversationStore>}} [deps]
 */
export function createFoundationHandler(deps = {}) {
  return async function foundationHandler(req, res) {
    if (rejectCrossOrigin(req, res)) return;
    res.setHeader(KEY_SOURCE_HEADER, 'server'); // the client key is never used here
    const client = deps.client || getOnDemandClient();
    const store = deps.store || getConversationStore();
    const url = getRequestUrl(req);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    try {
      if (path === '/health' && method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          configured: isConfigured(),
          conversationBackend: store.backend,
          contracts: contractRegistry.size(),
          activePlugins: contractRegistry.activePluginIds().length,
          defaultEndpointId: config.fulfillmentEndpointId,
          keySource: 'server',
        });
        return;
      }
      if (path === '/contracts' && method === 'GET') {
        sendJson(res, 200, {
          contracts: contractRegistry.list().map((c) => ({
            name: c.name,
            kind: c.kind,
            description: c.description,
            pluginId: c.pluginId,
            toolRoute: c.toolRoute,
            workflowId: c.workflowId,
            inputs: c.inputs,
            outputs: c.outputs,
            provenance: c.provenance,
            paginated: c.paginated,
            streaming: c.streaming,
            availability: c.availability,
            verifiedAt: c.verifiedAt,
            tags: c.tags,
          })),
        });
        return;
      }
      if (path === '/conversations') {
        if (method === 'POST') {
          const body = await readJsonBody(req, { maxBytes: MAX_BODY });
          const externalUserId = validateExternalUserId(body.externalUserId);
          const objectContext = validateObjectContext(body.objectContext);
          const pluginIds = validatePluginIds(body.pluginIds);
          const conv = await ensureConversation(
            client,
            store,
            externalUserId,
            objectContext,
            pluginIds,
          );
          sendJson(res, conv.reused ? 200 : 201, {
            sessionId: conv.sessionId,
            objectContextKey: conv.objectContextKey,
            reused: conv.reused,
            createdAt: conv.createdAt,
            turns: conv.turns,
          });
          return;
        }
        if (method === 'GET') {
          const externalUserId = validateExternalUserId(
            url.searchParams.get('externalUserId'),
          );
          const local = await store.listByUser(externalUserId);
          sendJson(res, 200, {
            conversations: local.map(
              ({
                sessionId,
                objectContextKey: k,
                createdAt,
                lastUsedAt,
                turns,
              }) => ({
                sessionId,
                objectContextKey: k,
                createdAt,
                lastUsedAt,
                turns,
              }),
            ),
          });
          return;
        }
        if (method === 'DELETE') {
          const body = await readJsonBody(req, { maxBytes: MAX_BODY });
          const externalUserId = validateExternalUserId(body.externalUserId);
          const ctx =
            body.objectContextKey ||
            validateObjectContext(body.objectContext) ||
            'global';
          await store.close(externalUserId, ctx);
          sendJson(res, 200, { closed: true });
          return;
        }
        res.setHeader('Allow', 'GET, POST, DELETE');
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      if (path === '/chat' && method === 'POST') {
        await handleChat(req, res, client, store);
        return;
      }
      if (path === '/messages' && method === 'GET') {
        const externalUserId = validateExternalUserId(
          url.searchParams.get('externalUserId'),
        );
        const ctxKey = url.searchParams.get('objectContextKey') || 'global';
        const conv = await store.get(externalUserId, ctxKey);
        if (!conv) {
          sendJson(res, 404, { error: 'conversation_not_found' });
          return;
        }
        const limit = Number.parseInt(
          url.searchParams.get('limit') || '20',
          10,
        );
        const page = await client.sessions.messages(conv.sessionId, {
          limit: Math.min(Math.max(limit, 1), 50),
          cursor: url.searchParams.get('cursor') || undefined,
          sort: url.searchParams.get('sort') || undefined,
        });
        sendJson(res, 200, { sessionId: conv.sessionId, ...page });
        return;
      }
      if (path === '/workflows/execute' && method === 'POST') {
        const body = await readJsonBody(req, { maxBytes: MAX_BODY });
        const workflowId = body.workflowId || config.spatialFlowId;
        const out = await client.workflows.execute(workflowId);
        sendJson(res, 202, {
          workflowId,
          executionID: out.executionID,
          streamPath: `${FOUNDATION_MOUNT}/workflows/executions/${out.executionID}/stream`,
        });
        return;
      }
      const m = path.match(/^\/workflows\/executions\/([0-9a-f]{24})\/stream$/);
      if (m && method === 'GET') {
        await handleWorkflowStream(req, res, client, m[1]);
        return;
      }
      sendJson(res, 404, { error: 'not_found', mount: FOUNDATION_MOUNT });
    } catch (err) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          /* ended */
        }
        return;
      }
      const [status, payload] = errorToResponse(err);
      if (status === 500)
        console.error('[ondemand-foundation] unhandled', err?.name || err);
      sendJson(res, status, payload);
    }
  };
}

/** Mount on the serverless router (server/serverless/app.js). */
export function mountFoundationRoutes(router, deps) {
  router.use(FOUNDATION_MOUNT, createFoundationHandler(deps));
}
