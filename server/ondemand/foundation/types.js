/**
 * OnDemand foundation — typed request/response schemas (JSDoc typedefs +
 * runtime validators). Server-side only. Every shape below was taken from
 * the LIVE OpenAPI documents fetched on 2026-10-20 through
 * `GET https://gateway.on-demand.io/config/v1/public/docs/reference/api/<slug>`
 * (slugs: createchatsession, getchatsessions, getchatsession,
 * getchatmessages, submitquery, fetchmedia, createmediaurl, deletemedia,
 * post_workflow-id-execute, get_execution-executionid,
 * get_execution-executionid-logs, get_execution-executionid-node-outputs,
 * get_execution-list) — see docs/agent-execution/TEST_RESULTS.md §1.
 *
 * Nothing here reads the environment or performs I/O.
 */

/** @typedef {'sync'|'stream'|'webhook'} ResponseMode */
/** @typedef {'low'|'medium'|'max'} ReasoningEffort */

/**
 * @typedef {object} ChatSession
 * @property {string} id
 * @property {string} [companyId]
 * @property {string} externalUserId
 * @property {string[]} [pluginIds]
 * @property {string} [title]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

/**
 * @typedef {object} CreateSessionRequest
 * @property {string} externalUserId  required (live spec)
 * @property {string[]} [pluginIds]   max 20 (live spec)
 */

/**
 * @typedef {object} ModelConfigs
 * @property {string} [fulfillmentPrompt]
 * @property {string[]} [stopSequences]  up to 4
 * @property {number} [temperature]       0..2
 * @property {number} [topP]              0..1
 * @property {number} [presencePenalty]   0..2
 * @property {number} [frequencyPenalty]  0..2
 */

/**
 * @typedef {object} SubmitQueryRequest
 * @property {string} query                 required
 * @property {string} endpointId            required
 * @property {ResponseMode} responseMode    required
 * @property {string[]} [pluginIds]         max 20; replaces session plugins for this query
 * @property {boolean} [fulfillmentOnly]
 * @property {ModelConfigs} [modelConfigs]
 * @property {ReasoningEffort} [reasoningEffort]  accepted by the live API (observed 2026-10-20)
 */

/**
 * @typedef {object} SubmitQuerySyncResponse
 * @property {string} message
 * @property {{sessionId:string, messageId:string, answer:string, status:'processing'|'completed'|'failed', metrics?:object}} data
 */

/**
 * SSE event as observed on the wire (2026-10-20T21:45:50Z):
 *   event:message   data:{sessionId,messageId,status:"processing",eventIndex,answer:"<delta>",eventType:"fulfillment"}
 *   event:message   data:{...,eventType:"metricsLog",publicMetrics:{inputTokens,outputTokens,totalTokens,...}}
 *   event:heartbeat data:{sessionId,messageId,time}
 *   event:message   data:[DONE]
 * @typedef {object} StreamEvent
 * @property {'message'|'heartbeat'|'error'|'done'|'proxy-heartbeat'} event
 * @property {object|string|null} data  parsed JSON when possible, '[DONE]' sentinel kept as string
 * @property {string} [answer]          convenience: `data.answer` for fulfillment deltas
 */

/**
 * @typedef {object} Pagination
 * @property {string} [cursor]
 * @property {string} [nextCursor]
 * @property {number} [limit]
 * @property {boolean} [hasMore]
 */

/**
 * @typedef {object} WorkflowExecution
 * @property {string} id
 * @property {string} workflowID
 * @property {string} status  observed: 'executing' | 'success' | 'failed' | ...
 * @property {number} [startedAtInMilliseconds]
 * @property {number} [endedAtInMilliseconds]
 * @property {number} [timeTakenInMilliseconds]
 */

/**
 * @typedef {object} ExecutionLog
 * @property {string} executionId
 * @property {string} [requestId]
 * @property {string} [task]
 * @property {number} timestamp
 * @property {string} workflowId
 * @property {string} nodeKey
 * @property {string} message
 * @property {object} [fields]
 */

const MAX_PLUGIN_IDS = 20; // live spec: maxItems 20
const MAX_USER_ID_LEN = 128;
const MAX_QUERY_BYTES = 64 * 1024;
const PLUGIN_ID = /^plugin-\d{6,}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;

/** Thrown for a request that fails schema validation BEFORE anything goes upstream. */
export class ValidationError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
    this.status = 400;
  }
}

/** @param {unknown} value @returns {value is string} */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} ids
 * @param {string} field
 * @returns {string[]|undefined}
 */
export function validatePluginIds(ids, field = 'pluginIds') {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) throw new ValidationError(field, 'must be an array');
  if (ids.length > MAX_PLUGIN_IDS)
    throw new ValidationError(field, `at most ${MAX_PLUGIN_IDS} plugin ids`);
  for (const id of ids) {
    if (!nonEmptyString(id) || !PLUGIN_ID.test(id))
      throw new ValidationError(field, `invalid plugin id ${String(id)}`);
  }
  return [...new Set(ids)];
}

/** @param {unknown} id @param {string} field */
export function validateObjectId(id, field) {
  if (!nonEmptyString(id) || !OBJECT_ID.test(id))
    throw new ValidationError(field, 'must be a 24-hex OnDemand id');
  return id;
}

/** @param {unknown} id @param {string} [field] */
export function validateExternalUserId(id, field = 'externalUserId') {
  if (!nonEmptyString(id)) throw new ValidationError(field, 'required');
  if (id.length > MAX_USER_ID_LEN)
    throw new ValidationError(field, `at most ${MAX_USER_ID_LEN} chars`);
  if (!/^[\x21-\x7e]+$/.test(id))
    throw new ValidationError(field, 'printable ASCII, no spaces');
  return id;
}

/**
 * @param {unknown} input
 * @returns {CreateSessionRequest}
 */
export function validateCreateSession(input) {
  if (!input || typeof input !== 'object')
    throw new ValidationError('body', 'object required');
  const { externalUserId, pluginIds } = /** @type {any} */ (input);
  const out = { externalUserId: validateExternalUserId(externalUserId) };
  const ids = validatePluginIds(pluginIds);
  if (ids) out.pluginIds = ids;
  return out;
}

/**
 * @param {unknown} mc
 * @returns {ModelConfigs|undefined}
 */
export function validateModelConfigs(mc) {
  if (mc === undefined) return undefined;
  if (!mc || typeof mc !== 'object' || Array.isArray(mc))
    throw new ValidationError('modelConfigs', 'object required');
  const m = /** @type {any} */ (mc);
  const out = {};
  const range = (name, lo, hi) => {
    if (m[name] === undefined) return;
    if (typeof m[name] !== 'number' || m[name] < lo || m[name] > hi)
      throw new ValidationError(
        `modelConfigs.${name}`,
        `number in ${lo}..${hi}`,
      );
    out[name] = m[name];
  };
  if (m.fulfillmentPrompt !== undefined) {
    if (typeof m.fulfillmentPrompt !== 'string')
      throw new ValidationError('modelConfigs.fulfillmentPrompt', 'string');
    out.fulfillmentPrompt = m.fulfillmentPrompt;
  }
  if (m.stopSequences !== undefined) {
    if (
      !Array.isArray(m.stopSequences) ||
      m.stopSequences.length > 4 ||
      m.stopSequences.some((s) => typeof s !== 'string')
    )
      throw new ValidationError(
        'modelConfigs.stopSequences',
        'up to 4 strings',
      );
    out.stopSequences = m.stopSequences;
  }
  range('temperature', 0, 2);
  range('topP', 0, 1);
  range('presencePenalty', 0, 2);
  range('frequencyPenalty', 0, 2);
  return out;
}

/**
 * @param {unknown} input
 * @returns {SubmitQueryRequest}
 */
export function validateSubmitQuery(input) {
  if (!input || typeof input !== 'object')
    throw new ValidationError('body', 'object required');
  const b = /** @type {any} */ (input);
  if (!nonEmptyString(b.query)) throw new ValidationError('query', 'required');
  if (Buffer.byteLength(b.query, 'utf8') > MAX_QUERY_BYTES)
    throw new ValidationError('query', `at most ${MAX_QUERY_BYTES} bytes`);
  if (!nonEmptyString(b.endpointId))
    throw new ValidationError('endpointId', 'required');
  if (!['sync', 'stream', 'webhook'].includes(b.responseMode))
    throw new ValidationError('responseMode', 'sync | stream | webhook');
  const out = {
    query: b.query,
    endpointId: b.endpointId,
    responseMode: b.responseMode,
  };
  const ids = validatePluginIds(b.pluginIds);
  if (ids) out.pluginIds = ids;
  if (b.fulfillmentOnly !== undefined) {
    if (typeof b.fulfillmentOnly !== 'boolean')
      throw new ValidationError('fulfillmentOnly', 'boolean');
    out.fulfillmentOnly = b.fulfillmentOnly;
  }
  const mc = validateModelConfigs(b.modelConfigs);
  if (mc) out.modelConfigs = mc;
  if (b.reasoningEffort !== undefined) {
    if (!['low', 'medium', 'max'].includes(b.reasoningEffort))
      throw new ValidationError('reasoningEffort', 'low | medium | max');
    out.reasoningEffort = b.reasoningEffort;
  }
  return out;
}

export const LIMITS = Object.freeze({
  MAX_PLUGIN_IDS,
  MAX_USER_ID_LEN,
  MAX_QUERY_BYTES,
});
