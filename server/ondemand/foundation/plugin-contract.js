/**
 * OnDemand foundation — PluginContract.
 *
 * A PluginContract is the single typed description of ONE capability the
 * workstation can invoke through OnDemand: either a platform plugin/agent
 * (a `plugin-…` id attached to a chat session) or a repo-owned tool that is
 * registered on the platform and executed by the gateway (`/api/tools/*`,
 * docs/ondemand-tools/*.json). The contract carries name, description,
 * typed inputs (JSON-Schema subset), structured outputs, error states,
 * provenance requirements, pagination/streaming flags.
 *
 * Nothing here calls the network. `validateContract()` is a runtime guard
 * so a malformed contract fails at module load, not at first use.
 */

/**
 * @typedef {'string'|'number'|'integer'|'boolean'|'object'|'array'} JsonType
 *
 * @typedef {object} FieldSchema
 * @property {JsonType} type
 * @property {string} [description]
 * @property {boolean} [required]
 * @property {string[]|number[]} [enum]
 * @property {FieldSchema} [items]
 * @property {Record<string, FieldSchema>} [properties]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {string} [format]  e.g. 'date-time', 'uri', 'lat', 'lon'
 *
 * @typedef {object} ErrorState
 * @property {string} code         stable machine code, e.g. 'rate_limited'
 * @property {number} [httpStatus]
 * @property {boolean} retryable
 * @property {string} userMessage  safe to show in the UI
 *
 * @typedef {object} Provenance
 * @property {string} provider     human provider name, e.g. 'OnDemand · Internet web search'
 * @property {'ondemand-plugin'|'ondemand-tool'|'ondemand-workflow'} kind
 * @property {boolean} citationsRequired  answers MUST carry source URLs when true
 * @property {string} [license]
 *
 * @typedef {object} PluginContract
 * @property {string} name                 kebab/snake case, unique
 * @property {string} description
 * @property {'ondemand-plugin'|'ondemand-tool'|'ondemand-workflow'} kind
 * @property {string} [pluginId]           for kind 'ondemand-plugin' — the platform id (plugin-…)
 * @property {string} [toolRoute]          for kind 'ondemand-tool' — e.g. '/api/tools/earthquake_search'
 * @property {string} [workflowId]         for kind 'ondemand-workflow' — 24-hex id
 * @property {Record<string, FieldSchema>} inputs
 * @property {Record<string, FieldSchema>} outputs   structured output fields
 * @property {ErrorState[]} errorStates
 * @property {Provenance} provenance
 * @property {boolean} paginated
 * @property {boolean} streaming
 * @property {'active'|'inactive'|'unknown'} availability  last verified status
 * @property {string} [verifiedAt]       ISO timestamp of the last live check
 * @property {string[]} [tags]
 */

const NAME = /^[a-z][a-z0-9_.-]{2,63}$/;
const PLUGIN_ID = /^plugin-\d{6,}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;
const KINDS = new Set([
  'ondemand-plugin',
  'ondemand-tool',
  'ondemand-workflow',
]);
const TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
]);

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
  }
}

function checkSchema(schema, path) {
  if (!schema || typeof schema !== 'object')
    throw new ContractError(`${path}: schema object required`);
  if (!TYPES.has(schema.type))
    throw new ContractError(`${path}: bad type ${schema.type}`);
  if (schema.type === 'array' && schema.items)
    checkSchema(schema.items, `${path}.items`);
  if (schema.type === 'object' && schema.properties)
    for (const [k, v] of Object.entries(schema.properties))
      checkSchema(v, `${path}.${k}`);
}

/**
 * Validate and freeze a contract.
 * @param {PluginContract} c
 * @returns {Readonly<PluginContract>}
 */
export function defineContract(c) {
  if (!c || typeof c !== 'object')
    throw new ContractError('contract object required');
  if (!NAME.test(c.name))
    throw new ContractError(`name "${c.name}" must match ${NAME}`);
  if (typeof c.description !== 'string' || c.description.length < 8)
    throw new ContractError(`${c.name}: description required`);
  if (!KINDS.has(c.kind))
    throw new ContractError(`${c.name}: kind must be one of ${[...KINDS]}`);
  if (c.kind === 'ondemand-plugin' && !PLUGIN_ID.test(c.pluginId || ''))
    throw new ContractError(
      `${c.name}: pluginId must look like plugin-<digits>`,
    );
  if (
    c.kind === 'ondemand-tool' &&
    !/^\/api\/(?:tools\/[a-z0-9_.-]+|incidents(?:\/[a-z]+)?)$/.test(
      c.toolRoute || '',
    )
  )
    throw new ContractError(
      `${c.name}: toolRoute must be /api/tools/<name> or /api/incidents[/<step>]`,
    );
  if (c.kind === 'ondemand-workflow' && !OBJECT_ID.test(c.workflowId || ''))
    throw new ContractError(`${c.name}: workflowId must be a 24-hex id`);
  for (const [k, v] of Object.entries(c.inputs || {}))
    checkSchema(v, `${c.name}.inputs.${k}`);
  for (const [k, v] of Object.entries(c.outputs || {}))
    checkSchema(v, `${c.name}.outputs.${k}`);
  if (!Array.isArray(c.errorStates) || c.errorStates.length === 0)
    throw new ContractError(`${c.name}: at least one errorState`);
  for (const e of c.errorStates) {
    if (!e.code || typeof e.retryable !== 'boolean' || !e.userMessage)
      throw new ContractError(
        `${c.name}: errorState {code, retryable, userMessage} required`,
      );
  }
  if (
    !c.provenance?.provider ||
    !KINDS.has(c.provenance?.kind) ||
    typeof c.provenance?.citationsRequired !== 'boolean'
  )
    throw new ContractError(
      `${c.name}: provenance {provider, kind, citationsRequired} required`,
    );
  if (typeof c.paginated !== 'boolean' || typeof c.streaming !== 'boolean')
    throw new ContractError(`${c.name}: paginated/streaming booleans required`);
  if (!['active', 'inactive', 'unknown'].includes(c.availability))
    throw new ContractError(`${c.name}: availability active|inactive|unknown`);
  return Object.freeze({
    ...c,
    inputs: Object.freeze({ ...(c.inputs || {}) }),
    outputs: Object.freeze({ ...(c.outputs || {}) }),
    errorStates: Object.freeze([...c.errorStates]),
    tags: Object.freeze([...(c.tags || [])]),
  });
}

/**
 * Validate a caller-supplied input object against `contract.inputs`
 * (required + type + enum + range). Returns the pruned object.
 */
export function validateInputs(contract, input = {}) {
  const out = {};
  for (const [field, schema] of Object.entries(contract.inputs)) {
    const v = input[field];
    if (v === undefined || v === null) {
      if (schema.required)
        throw new ContractError(`${contract.name}: input "${field}" required`);
      continue;
    }
    const t = Array.isArray(v) ? 'array' : typeof v;
    const ok =
      schema.type === 'integer'
        ? Number.isInteger(v)
        : schema.type === 'number'
          ? t === 'number'
          : t === schema.type;
    if (!ok)
      throw new ContractError(
        `${contract.name}: input "${field}" must be ${schema.type}`,
      );
    if (schema.enum && !schema.enum.includes(v))
      throw new ContractError(
        `${contract.name}: input "${field}" must be one of ${schema.enum.join(', ')}`,
      );
    if (typeof v === 'number') {
      if (schema.minimum !== undefined && v < schema.minimum)
        throw new ContractError(
          `${contract.name}: "${field}" < ${schema.minimum}`,
        );
      if (schema.maximum !== undefined && v > schema.maximum)
        throw new ContractError(
          `${contract.name}: "${field}" > ${schema.maximum}`,
        );
    }
    out[field] = v;
  }
  return out;
}

/** Shared error states most contracts reuse. */
export const COMMON_ERRORS = Object.freeze([
  {
    code: 'not_configured',
    httpStatus: 503,
    retryable: false,
    userMessage: 'OnDemand is not configured on this server.',
  },
  {
    code: 'rate_limited',
    httpStatus: 429,
    retryable: true,
    userMessage: 'OnDemand is rate-limiting requests; retrying shortly.',
  },
  {
    code: 'upstream_error',
    httpStatus: 502,
    retryable: true,
    userMessage: 'OnDemand returned an error; please retry.',
  },
  {
    code: 'timeout',
    httpStatus: 504,
    retryable: true,
    userMessage: 'OnDemand took too long to answer.',
  },
  {
    code: 'plugin_inactive',
    httpStatus: 400,
    retryable: false,
    userMessage:
      'This research source is currently inactive on the OnDemand account.',
  },
]);

/**
 * Minimal registry: name → contract. Throws on duplicate names so two
 * surfaces cannot register conflicting definitions.
 */
export function createContractRegistry(contracts = []) {
  const map = new Map();
  const api = {
    register(c) {
      const frozen = defineContract(c);
      if (map.has(frozen.name))
        throw new ContractError(`duplicate contract ${frozen.name}`);
      map.set(frozen.name, frozen);
      return frozen;
    },
    get(name) {
      return map.get(name);
    },
    list(filter = {}) {
      return [...map.values()].filter(
        (c) =>
          (!filter.kind || c.kind === filter.kind) &&
          (!filter.availability || c.availability === filter.availability) &&
          (!filter.tag || c.tags.includes(filter.tag)),
      );
    },
    /** pluginIds to attach to a session: only ACTIVE plugin-kind contracts. */
    activePluginIds() {
      return api
        .list({ kind: 'ondemand-plugin', availability: 'active' })
        .map((c) => c.pluginId);
    },
    size() {
      return map.size;
    },
  };
  for (const c of contracts) api.register(c);
  return api;
}
