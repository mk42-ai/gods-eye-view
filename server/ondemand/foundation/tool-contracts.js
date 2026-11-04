/**
 * server/ondemand/foundation/tool-contracts.js — derive one PluginContract
 * (kind `ondemand-tool`) per repo tool from server/tools/registry.js, and a
 * real `toolInvoker` that runs the tool handler in-process (no HTTP hop) with
 * the SAME whitelist validation the /api/tools route applies.
 *
 * Why: until 2026-10-21 only `earthquake_search` had a contract and the
 * orchestrator's `/investigate` ran with `skipped: no tool invoker`
 * (BLOCKERS B-13). The registry is the single source of truth for the
 * OpenAPI documents under docs/plugins/<plugin>/openapi.json, so contracts
 * are generated from it rather than hand-written twice.
 *
 * Pure except for the invoker (which performs the tool's upstream fetch).
 */

import { listPlugins, toolIndex } from '../../tools/registry.js';
import { validateParams } from '../../sources/_shared.js';
import { defineContract } from './plugin-contract.js';

const RULE_TO_SCHEMA = Object.freeze({
  string: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  enum: { type: 'string' },
  'iso-date': { type: 'string', format: 'date-time' },
  csv: { type: 'string' },
});

export const TOOL_ERROR_STATES = Object.freeze([
  {
    code: 'invalid_query',
    httpStatus: 400,
    retryable: false,
    userMessage: 'The tool request was rejected by parameter validation.',
  },
  {
    code: 'not_configured',
    httpStatus: 503,
    retryable: false,
    userMessage: 'This source needs a server-side key that is not configured.',
  },
  {
    code: 'upstream_unavailable',
    httpStatus: 502,
    retryable: true,
    userMessage: 'The upstream data provider is unavailable right now.',
  },
  {
    code: 'upstream_timeout',
    httpStatus: 504,
    retryable: true,
    userMessage: 'The upstream data provider timed out.',
  },
  {
    code: 'not_found',
    httpStatus: 404,
    retryable: false,
    userMessage: 'No matching object is tracked right now.',
  },
]);

/** FieldSchema for one validateParams rule. */
export function fieldSchemaFor(rule = {}) {
  const schema = { ...(RULE_TO_SCHEMA[rule.type] || { type: 'string' }) };
  if (rule.required) schema.required = true;
  if (rule.description) schema.description = rule.description;
  if (Array.isArray(rule.values)) schema.enum = [...rule.values];
  if (rule.min !== undefined) schema.minimum = rule.min;
  if (rule.max !== undefined) schema.maximum = rule.max;
  return schema;
}

/**
 * Build the contracts. `verifiedAt` carries the registry generation time the
 * caller passes (the live table lives in docs/plugins/REGISTRY.md); nothing
 * here claims a live verification it did not perform.
 */
export function buildToolContracts({
  plugins = listPlugins(),
  verifiedAt = null,
  skip = new Set(['earthquake_search']), // hand-written contract in contracts.js
} = {}) {
  const out = [];
  for (const plugin of plugins) {
    for (const tool of plugin.tools || []) {
      if (skip.has(tool.name)) continue;
      const inputs = {};
      for (const [name, rule] of Object.entries(tool.params || {}))
        inputs[name] = fieldSchemaFor(rule);
      out.push(
        defineContract({
          name: tool.name,
          description: `${tool.summary || tool.name} — ${plugin.name} (/api/tools/${tool.name}, docs/plugins/${plugin.id}/openapi.json).`,
          kind: 'ondemand-tool',
          toolRoute: `/api/tools/${tool.name}`,
          inputs,
          outputs: {
            data: { type: 'object', required: true },
            provider: { type: 'object' },
            provenance: { type: 'object' },
            generatedAtUtc: {
              type: 'string',
              format: 'date-time',
              required: true,
            },
          },
          errorStates: TOOL_ERROR_STATES,
          provenance: {
            provider: `${plugin.name} via gateway`,
            kind: 'ondemand-tool',
            citationsRequired: false,
          },
          paginated: false,
          streaming: false,
          availability: 'active',
          ...(verifiedAt ? { verifiedAt } : {}),
          tags: ['geo', 'tool', plugin.id],
        }),
      );
    }
  }
  return Object.freeze(out);
}

/**
 * In-process tool invoker for the orchestrator: validates `args` against the
 * tool's own whitelist (unknown/invalid params → thrown Error with
 * `.code`), runs the handler with a bounded signal and returns the same
 * envelope `/api/tools/<name>` would send.
 */
export function createToolInvoker({
  index = toolIndex(),
  env = process.env,
  now = () => new Date(),
  timeoutMs = 20_000,
} = {}) {
  return async function toolInvoker(contract, args = {}, { signal } = {}) {
    const name = contract?.name || String(contract);
    const tool = index.get(name);
    if (!tool) {
      const err = new Error(`unknown tool "${name}"`);
      err.code = 'unknown_tool';
      throw err;
    }
    const validated = validateParams(args, tool.params || {});
    if (!validated.ok) {
      const err = new Error(validated.error?.message || 'invalid tool args');
      err.code = validated.error?.code || 'invalid_query';
      err.status = validated.status || 400;
      throw err;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await tool.handler(validated.params, {
        signal: controller.signal,
        env,
        now,
        requestUrl: new URL(
          `/api/tools/${name}?${new URLSearchParams(
            Object.entries(validated.params).map(([k, v]) => [k, String(v)]),
          )}`,
          'http://localhost',
        ),
        tool: name,
      });
      if (!result || result.ok === false) {
        const err = new Error(
          result?.error?.message || `${name} returned no result`,
        );
        err.code = result?.error?.code || 'tool_failed';
        err.status = Number(result?.status) || 502;
        throw err;
      }
      return {
        ok: true,
        tool: name,
        params: validated.params,
        data: result.data ?? null,
        ...(result.provider ? { provider: result.provider } : {}),
        ...(result.provenance ? { provenance: result.provenance } : {}),
        generatedAtUtc: now().toISOString(),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  };
}
