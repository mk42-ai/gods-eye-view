/**
 * The eleven research plugins the workstation's Settings panel prefills
 * (docs/PLUGIN_RESOLUTION.md), expressed as PluginContracts. Availability
 * is what the LIVE platform answered on 2026-10-20 (POST /chat/v1/sessions
 * with each id alone — docs/agent-execution/TEST_RESULTS.md §2):
 *   • 10 accepted at session creation;
 *   • plugin-1785777296 (X MCP connector) rejected: "One or more agents are
 *     inactive or missing configuration: X" → availability 'inactive'.
 * NOTE (same run): a query that lets the SESSION-level list of 10 run was
 * rejected with "One or more agents are invalid" (400), while a query that
 * names ONE plugin in `pluginIds` succeeded. Until the platform behaviour is
 * clarified, callers should pass an explicit, short `pluginIds` per query
 * (see docs/agent-execution/BLOCKERS.md B-3).
 */

import {
  defineContract,
  createContractRegistry,
  COMMON_ERRORS,
} from './plugin-contract.js';

const VERIFIED_AT = '2026-10-20T21:31:48Z';

const researchInputs = {
  query: {
    type: 'string',
    required: true,
    description: 'Natural-language research question',
  },
  objectContext: {
    type: 'object',
    description:
      'Workstation object context (objectType, objectId, label, position, timeWindow, fields)',
  },
  timeWindow: {
    type: 'string',
    description: 'ISO-8601 interval the question refers to',
    format: 'interval',
  },
};
const researchOutputs = {
  answer: { type: 'string', required: true },
  citations: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        title: { type: 'string' },
      },
    },
  },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
};

function research(
  name,
  pluginId,
  provider,
  description,
  availability,
  tags,
  extra = {},
) {
  return defineContract({
    name,
    description,
    kind: 'ondemand-plugin',
    pluginId,
    inputs: researchInputs,
    outputs: researchOutputs,
    errorStates: COMMON_ERRORS,
    provenance: {
      provider: `OnDemand · ${provider}`,
      kind: 'ondemand-plugin',
      citationsRequired: true,
    },
    paginated: false,
    streaming: true,
    availability,
    verifiedAt: VERIFIED_AT,
    tags,
    ...extra,
  });
}

export const RESEARCH_CONTRACTS = Object.freeze([
  research(
    'perplexity_research',
    'plugin-1722260873',
    'Perplexity investigation research',
    'Deep web research with cited sources for investigations.',
    'active',
    ['web', 'research', 'citations'],
  ),
  research(
    'internet_web_search',
    'plugin-1713924030',
    'Internet web search',
    'General web search; verified live with a sourced answer on 2026-10-20.',
    'active',
    ['web', 'search', 'citations'],
  ),
  research(
    'gpt_search',
    'plugin-1741871229',
    'GPT Search',
    'LLM-grounded web search with URL annotations.',
    'active',
    ['web', 'search'],
  ),
  research(
    'x_search',
    'plugin-1751872652',
    'X Search Agent',
    'Search public posts on X for an entity, place or event.',
    'active',
    ['social', 'x'],
  ),
  research(
    'x_mcp_connector',
    'plugin-1785777296',
    'X MCP connector',
    'X MCP connector — INACTIVE on the account (session creation rejected 2026-10-20).',
    'inactive',
    ['social', 'x', 'mcp'],
  ),
  research(
    'tiktok_scraper',
    'plugin-1716372717',
    'TikTok scraper',
    'Public TikTok content lookup for a place or hashtag.',
    'active',
    ['social', 'tiktok'],
  ),
  research(
    'instagram_user_info',
    'plugin-1716164040',
    'Instagram User Info Extracter',
    'Public Instagram profile metadata.',
    'active',
    ['social', 'instagram'],
  ),
  research(
    'instagram_professional',
    'plugin-1785987361',
    'Instagram professional',
    'Instagram professional/business account data.',
    'active',
    ['social', 'instagram'],
  ),
  research(
    'youtube_captions',
    'plugin-1784356219',
    'YouTube Data API v3 Captions',
    'Caption / transcript retrieval for YouTube videos.',
    'active',
    ['video', 'youtube'],
  ),
  research(
    'reddit_posts',
    'plugin-1748003575',
    'Reddit Posts',
    'Reddit post search for places, incidents and entities.',
    'active',
    ['social', 'reddit'],
  ),
  research(
    'linkedin_search',
    'plugin-1718116202',
    'LinkedIn Search',
    'LinkedIn people/company search.',
    'active',
    ['social', 'linkedin'],
  ),
]);

/** Repo-owned geodata tools already exposed under /api/tools (server/tools/*). */
export const TOOL_CONTRACTS = Object.freeze([
  defineContract({
    name: 'earthquake_search',
    description:
      'USGS FDSN earthquake search executed by the gateway (/api/tools/earthquake_search, docs/ondemand-tools/earthquake_search.json).',
    kind: 'ondemand-tool',
    toolRoute: '/api/tools/earthquake_search',
    inputs: {
      bbox: {
        type: 'array',
        items: { type: 'number' },
        description: '[west, south, east, north]',
      },
      minMagnitude: { type: 'number', minimum: 0, maximum: 10 },
      hours: { type: 'integer', minimum: 1, maximum: 720 },
    },
    outputs: {
      count: { type: 'integer', required: true },
      events: { type: 'array', items: { type: 'object' } },
      provider: { type: 'string', required: true },
      fetchedAt: { type: 'string', format: 'date-time', required: true },
    },
    errorStates: COMMON_ERRORS,
    provenance: {
      provider: 'USGS FDSN via gateway',
      kind: 'ondemand-tool',
      citationsRequired: false,
    },
    paginated: false,
    streaming: false,
    availability: 'active',
    verifiedAt: VERIFIED_AT,
    tags: ['geo', 'seismic'],
  }),
]);

export const WORKFLOW_CONTRACTS = Object.freeze([
  defineContract({
    name: 'spatial_advanced_workflow',
    description:
      'OnDemand Spatial Advanced Workflow (Agents Flow Builder, 9 llm nodes, webhook trigger). Executed + polled live on 2026-10-20 (execution reached 23 log lines; terminal state not reached within the 100 s probe window).',
    kind: 'ondemand-workflow',
    workflowId: '6aace534859f7b0abb53d99a',
    inputs: {
      question: { type: 'string', required: true },
      spatialContext: { type: 'object' },
    },
    outputs: {
      executionID: { type: 'string', required: true },
      status: { type: 'string', required: true },
      nodeOutputs: { type: 'object' },
    },
    errorStates: COMMON_ERRORS,
    provenance: {
      provider: 'OnDemand Agents Flow Builder',
      kind: 'ondemand-workflow',
      citationsRequired: false,
    },
    paginated: false,
    streaming: false,
    availability: 'active',
    verifiedAt: '2026-10-20T21:36:07Z',
    tags: ['workflow', 'spatial'],
  }),
]);

/** Process-wide registry of every contract above. */
export const contractRegistry = createContractRegistry([
  ...RESEARCH_CONTRACTS,
  ...TOOL_CONTRACTS,
  ...WORKFLOW_CONTRACTS,
]);
