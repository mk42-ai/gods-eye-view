import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToolContracts,
  createToolInvoker,
  fieldSchemaFor,
} from './tool-contracts.js';
import { contractRegistry } from './contracts.js';
import { toolArgsFor, TOOL_PLAN } from './orchestrator.js';
import { validateInputs } from './plugin-contract.js';

describe('tool-contracts (registry-derived PluginContracts + in-process invoker)', () => {
  test('fieldSchemaFor maps validateParams rules to FieldSchema', () => {
    assert.deepEqual(fieldSchemaFor({ type: 'number', min: -90, max: 90 }), {
      type: 'number',
      minimum: -90,
      maximum: 90,
    });
    assert.deepEqual(
      fieldSchemaFor({ type: 'enum', values: ['a', 'b'], required: true }),
      { type: 'string', required: true, enum: ['a', 'b'] },
    );
    assert.equal(fieldSchemaFor({ type: 'iso-date' }).format, 'date-time');
  });
  test('one contract per registry tool except earthquake_search; all registered + active', () => {
    const built = buildToolContracts();
    assert.equal(built.length, 20);
    assert.ok(built.every((c) => c.kind === 'ondemand-tool'));
    assert.ok(built.every((c) => c.toolRoute === `/api/tools/${c.name}`));
    assert.ok(!built.some((c) => c.name === 'earthquake_search'));
    assert.equal(contractRegistry.list({ kind: 'ondemand-tool' }).length, 21);
    for (const c of built)
      assert.equal(contractRegistry.get(c.name)?.toolRoute, c.toolRoute);
  });
  test('orchestrator TOOL_PLAN names only registered active contracts and toolArgsFor satisfies their inputs', () => {
    const ctx = {
      objectType: 'fire',
      objectId: 'f1',
      label: 'Abu Dhabi',
      position: { lat: 24.45, lon: 54.65 },
    };
    for (const names of Object.values(TOOL_PLAN)) {
      for (const n of names) {
        const c = contractRegistry.get(n);
        assert.ok(c, `contract ${n} registered`);
        assert.equal(c.availability, 'active');
        const args = toolArgsFor(c, ctx);
        assert.doesNotThrow(() => validateInputs(c, args), `${n} args valid`);
      }
    }
    assert.deepEqual(toolArgsFor(contractRegistry.get('regional_brief'), ctx), {
      lat: 24.45,
      lon: 54.65,
    });
    assert.deepEqual(
      toolArgsFor(contractRegistry.get('geocode_place'), { label: 'Paris' }),
      { q: 'Paris' },
    );
  });
  test('invoker validates with the tool whitelist, runs the handler in-process and returns the /api/tools envelope', async () => {
    const calls = [];
    const index = new Map([
      [
        'demo_tool',
        {
          name: 'demo_tool',
          params: { lat: { type: 'number', required: true, min: -90, max: 90 } },
          handler: async (params, ctx) => {
            calls.push({ params, tool: ctx.tool, hasSignal: !!ctx.signal });
            return { ok: true, data: { hello: params.lat }, provider: { status: 'live' } };
          },
        },
      ],
    ]);
    const invoke = createToolInvoker({ index, now: () => new Date('2026-10-21T00:00:00Z') });
    const out = await invoke({ name: 'demo_tool' }, { lat: '12.5' });
    assert.equal(out.ok, true);
    assert.deepEqual(out.data, { hello: 12.5 });
    assert.equal(out.generatedAtUtc, '2026-10-21T00:00:00.000Z');
    assert.deepEqual(calls[0], { params: { lat: 12.5 }, tool: 'demo_tool', hasSignal: true });
    await assert.rejects(invoke({ name: 'demo_tool' }, { lat: 5, bogus: 1 }), /unknown parameter/);
    await assert.rejects(invoke({ name: 'nope' }, {}), /unknown tool/);
  });
  test('invoker surfaces honest tool failures as errors with code/status', async () => {
    const index = new Map([
      [
        't',
        {
          name: 't',
          params: {},
          handler: async () => ({
            ok: false,
            status: 503,
            error: { code: 'not_configured', message: 'needs KEY' },
          }),
        },
      ],
    ]);
    const invoke = createToolInvoker({ index });
    await assert.rejects(invoke({ name: 't' }, {}), (err) => {
      assert.equal(err.code, 'not_configured');
      assert.equal(err.status, 503);
      return true;
    });
  });
});
