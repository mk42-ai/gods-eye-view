import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPluginLifecycle,
  mapUpstreamError,
  CACHE_TTL_MS,
} from './plugin-lifecycle.js';
import { contractRegistry } from './contracts.js';
import { OnDemandHttpError, OnDemandAbortError } from './client.js';
import { makeReq, makeRes } from '../test-helpers.mjs';

function createMockClient({
  onCreateSession = async () => ({ id: 'sess-test-123' }),
  onSyncQuery = async () => ({
    message: 'OK',
    data: {
      answer: 'READY. The search agent is online.',
      executedAgents: [{ agentId: 'agent-1713924030' }],
    },
  }),
} = {}) {
  return {
    sessions: {
      create: onCreateSession,
    },
    query: {
      sync: onSyncQuery,
    },
  };
}

describe('plugin-lifecycle', () => {
  test('happy path transitions in order with audit calls', async () => {
    let nowTime = 1761000000000;
    const audits = [];
    const client = createMockClient();

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
      now: () => new Date(nowTime),
      audit: (event, meta) => audits.push({ event, ...meta }),
    });

    const entry = await lifecycle.verify('internet_web_search', {
      externalUserId: 'usr-1',
    });

    assert.equal(entry.name, 'internet_web_search');
    assert.equal(entry.state, 'ready');
    assert.equal(entry.pluginId, 'plugin-1713924030');
    assert.ok(entry.verifiedAt);
    assert.equal(typeof entry.latencyMs, 'number');
    assert.ok(entry.answerPreview.startsWith('READY.'));
    assert.deepEqual(entry.executedAgents, [{ agentId: 'agent-1713924030' }]);
    assert.equal(entry.error, null);

    // Verify audits happened in exact order: discovered -> installing -> authenticating -> ready
    assert.deepEqual(audits, [
      {
        event: 'plugin_state',
        pluginId: 'plugin-1713924030',
        from: 'discovered',
        to: 'installing',
      },
      {
        event: 'plugin_state',
        pluginId: 'plugin-1713924030',
        from: 'installing',
        to: 'authenticating',
      },
      {
        event: 'plugin_state',
        pluginId: 'plugin-1713924030',
        from: 'authenticating',
        to: 'ready',
      },
    ]);
  });

  test('inactive contract -> failed inactive_on_account without any client call', async () => {
    let clientCalled = false;
    const client = {
      sessions: {
        create: async () => {
          clientCalled = true;
          throw new Error('Should not be called');
        },
      },
      query: {
        sync: async () => {
          clientCalled = true;
          throw new Error('Should not be called');
        },
      },
    };
    const audits = [];

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
      audit: (event, meta) => audits.push({ event, ...meta }),
    });

    const entry = await lifecycle.verify('x_mcp_connector', {
      externalUserId: 'usr-2',
    });

    assert.equal(
      clientCalled,
      false,
      'Client must not be called for inactive contract',
    );
    assert.equal(entry.state, 'failed');
    assert.equal(entry.error?.code, 'inactive_on_account');
    assert.equal(entry.error?.httpStatus, 400);
    assert.equal(entry.error?.retryable, false);
    assert.ok(entry.error?.failedAt);

    assert.deepEqual(audits, [
      {
        event: 'plugin_state',
        pluginId: 'plugin-1785777296',
        from: 'discovered',
        to: 'failed',
        code: 'inactive_on_account',
      },
    ]);
  });

  test('400 invalidAgentIds -> rejected_by_session', async () => {
    const client = createMockClient({
      onSyncQuery: async () => {
        throw new OnDemandHttpError(
          400,
          {
            error: 'invalid_agents',
            message: 'One or more agents are invalid',
            invalidAgentIds: ['plugin-1741871229'],
          },
          {
            url: 'https://api.on-demand.io/chat/v1/sessions/1/query',
            method: 'POST',
            attempt: 1,
          },
        );
      },
    });

    const audits = [];
    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
      audit: (event, meta) => audits.push({ event, ...meta }),
    });

    const entry = await lifecycle.verify('gpt_search', {
      externalUserId: 'usr-3',
    });

    assert.equal(entry.state, 'failed');
    assert.equal(entry.error?.code, 'rejected_by_session');
    assert.equal(entry.error?.httpStatus, 400);
    assert.equal(entry.error?.retryable, false);

    assert.equal(audits[audits.length - 1].code, 'rejected_by_session');
    assert.equal(audits[audits.length - 1].to, 'failed');
  });

  test('400 inactiveAgentIds -> inactive_on_account', async () => {
    const client = createMockClient({
      onCreateSession: async () => {
        throw new OnDemandHttpError(
          400,
          {
            error: 'inactive_agents',
            message:
              'One or more agents are inactive or missing configuration: X',
            inactiveAgentIds: ['plugin-1722260873'],
          },
          {
            url: 'https://api.on-demand.io/chat/v1/sessions',
            method: 'POST',
            attempt: 1,
          },
        );
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const entry = await lifecycle.verify('perplexity_research', {
      externalUserId: 'usr-4',
    });

    assert.equal(entry.state, 'failed');
    assert.equal(entry.error?.code, 'inactive_on_account');
    assert.equal(entry.error?.httpStatus, 400);
    assert.equal(entry.error?.retryable, false);
  });

  test('429 -> failed rate_limited retryable', async () => {
    const client = createMockClient({
      onSyncQuery: async () => {
        throw new OnDemandHttpError(
          429,
          { error: 'rate_limited', message: 'Too many requests' },
          { url: 'https://api.on-demand.io', method: 'POST', attempt: 1 },
        );
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const entry = await lifecycle.verify('tiktok_scraper', {
      externalUserId: 'usr-5',
    });

    assert.equal(entry.state, 'failed');
    assert.equal(entry.error?.code, 'rate_limited');
    assert.equal(entry.error?.httpStatus, 429);
    assert.equal(entry.error?.retryable, true);
  });

  test('5xx or timeout -> failed upstream_unavailable retryable', async () => {
    const client = createMockClient({
      onSyncQuery: async () => {
        throw new OnDemandAbortError('timeout');
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const entry = await lifecycle.verify('youtube_captions', {
      externalUserId: 'usr-6',
    });

    assert.equal(entry.state, 'failed');
    assert.equal(entry.error?.code, 'upstream_unavailable');
    assert.equal(entry.error?.httpStatus, 504);
    assert.equal(entry.error?.retryable, true);
  });

  test('concurrency de-dupe: concurrent verifies share one client execution', async () => {
    let createCount = 0;
    const client = createMockClient({
      onCreateSession: async () => {
        createCount += 1;
        await new Promise((r) => setTimeout(r, 40));
        return { id: 'sess-dedupe' };
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const [res1, res2] = await Promise.all([
      lifecycle.verify('linkedin_search', { externalUserId: 'usr-7' }),
      lifecycle.verify('linkedin_search', { externalUserId: 'usr-7' }),
    ]);

    assert.equal(createCount, 1, 'Only one session.create call should be made');
    assert.equal(res1.state, 'ready');
    assert.equal(res2.state, 'ready');
    assert.equal(res1.verifiedAt, res2.verifiedAt);
  });

  test('cache: ready state is cached for 10 minutes', async () => {
    let nowTime = 1761000000000;
    let createCount = 0;

    const client = createMockClient({
      onCreateSession: async () => {
        createCount += 1;
        return { id: `sess-${createCount}` };
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
      now: () => new Date(nowTime),
    });

    // 1st verification: executes
    const first = await lifecycle.verify('reddit_posts', {
      externalUserId: 'usr-8',
    });
    assert.equal(first.state, 'ready');
    assert.equal(createCount, 1);

    // 5 minutes later: within cache window (10 min)
    nowTime += 5 * 60 * 1000;
    const cached = await lifecycle.verify('reddit_posts', {
      externalUserId: 'usr-8',
    });
    assert.equal(cached.state, 'ready');
    assert.equal(
      createCount,
      1,
      'Should reuse cached ready state without client call',
    );

    // 11 minutes later: cache expired
    nowTime += 6 * 60 * 1000; // total 11 min since first
    const refreshed = await lifecycle.verify('reddit_posts', {
      externalUserId: 'usr-8',
    });
    assert.equal(refreshed.state, 'ready');
    assert.equal(createCount, 2, 'Cache expired; new client call made');
  });

  test('markInvoking and markInvoked counters and state transitions', () => {
    let nowTime = 1761000000000;
    const lifecycle = createPluginLifecycle({
      registry: contractRegistry,
      now: () => new Date(nowTime),
    });

    const snap0 = lifecycle.snapshot();
    const p0 = snap0.plugins.find((p) => p.name === 'internet_web_search');
    assert.equal(p0.invocations, 0);
    assert.equal(p0.state, 'discovered');

    // Mark invoking
    const invoking = lifecycle.markInvoking('plugin-1713924030', 'turn-abc');
    assert.equal(invoking.state, 'invoking');
    assert.ok(invoking.lastInvokedAt);

    // Mark invoked (ok)
    const invokedOk = lifecycle.markInvoked('plugin-1713924030', { ok: true });
    assert.equal(invokedOk.state, 'ready');
    assert.equal(invokedOk.invocations, 1);

    // Mark invoking again
    lifecycle.markInvoking('plugin-1713924030', 'turn-def');
    assert.equal(
      lifecycle.snapshot().plugins.find((p) => p.name === 'internet_web_search')
        .state,
      'invoking',
    );

    // Mark invoked (failed)
    const invokedFail = lifecycle.markInvoked('plugin-1713924030', {
      ok: false,
      error: { status: 500, message: 'Upstream crashed' },
    });
    assert.equal(invokedFail.state, 'failed');
    assert.equal(invokedFail.invocations, 2);
    assert.equal(invokedFail.error?.code, 'upstream_unavailable');
  });

  test('handle() serves GET /plugins snapshot and includes ondemand-tool', async () => {
    const lifecycle = createPluginLifecycle({
      registry: contractRegistry,
    });

    const req = makeReq({ method: 'GET', url: '/plugins' });
    const res = makeRes();

    const handled = await lifecycle.handle(req, res, {
      path: '/plugins',
      method: 'GET',
    });

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.generatedAt);
    assert.ok(Array.isArray(body.plugins));

    const quakeTool = body.plugins.find((p) => p.name === 'earthquake_search');
    assert.ok(quakeTool, 'earthquake_search tool must be included in snapshot');
    assert.equal(quakeTool.kind, 'ondemand-tool');
    assert.equal(quakeTool.state, 'discovered');
    assert.equal(quakeTool.verification, 'route-level (see /api/tools)');
  });

  test('handle() serves POST /plugins/verify with 403 on failed authorize', async () => {
    const lifecycle = createPluginLifecycle({
      registry: contractRegistry,
    });

    const req = makeReq({
      method: 'POST',
      url: '/plugins/verify',
      body: { externalUserId: 'imposter-user', names: ['internet_web_search'] },
    });
    const res = makeRes();

    const authorize = (externalUserId) => {
      if (externalUserId === 'imposter-user') {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'user_mismatch' }));
        return null;
      }
      return { user: externalUserId };
    };

    const handled = await lifecycle.handle(req, res, {
      path: '/plugins/verify',
      method: 'POST',
      authorize,
    });

    assert.equal(handled, true);
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'user_mismatch');
  });

  test('handle() serves POST /plugins/verify successfully for authorized user', async () => {
    const client = createMockClient();
    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const req = makeReq({
      method: 'POST',
      url: '/plugins/verify',
      body: { externalUserId: 'legit-user', names: ['internet_web_search'] },
    });
    const res = makeRes();

    const authorize = (id) => ({ user: id });

    const handled = await lifecycle.handle(req, res, {
      path: '/plugins/verify',
      method: 'POST',
      authorize,
    });

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.plugins));
    assert.equal(body.plugins.length, 1);
    assert.equal(body.plugins[0].name, 'internet_web_search');
    assert.equal(body.plugins[0].state, 'ready');
  });

  test('verifyAll runs with concurrency bound', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const client = createMockClient({
      onCreateSession: async () => {
        currentConcurrent += 1;
        if (currentConcurrent > maxConcurrent)
          maxConcurrent = currentConcurrent;
        await new Promise((r) => setTimeout(r, 20));
        currentConcurrent -= 1;
        return { id: 'sess-conc' };
      },
    });

    const lifecycle = createPluginLifecycle({
      client,
      registry: contractRegistry,
    });

    const results = await lifecycle.verifyAll({
      externalUserId: 'usr-all',
      concurrency: 2,
    });

    assert.ok(results.length > 0);
    assert.ok(
      maxConcurrent <= 2,
      `max concurrent should be <= 2, was ${maxConcurrent}`,
    );
  });
});
