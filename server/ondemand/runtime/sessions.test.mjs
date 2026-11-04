import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from './sessions.js';

function createMockTransport() {
  let counter = 0;
  const created = [];
  return {
    async createSession(pluginIds = []) {
      counter++;
      const id = `sess-${counter}`;
      const externalUserId = `cinematic-user-${counter}`;
      created.push({ id, externalUserId, pluginIds });
      return { id, externalUserId, pluginIds };
    },
    get created() {
      return created;
    },
  };
}

test('createSessionManager acquire() creates and reuses sessions by purpose', async () => {
  let time = 1000;
  const transport = createMockTransport();
  const manager = createSessionManager({
    transport,
    now: () => time,
  });

  // First acquire for purpose 'director'
  const sess1 = await manager.acquire({ purpose: 'director' });
  assert.equal(sess1.id, 'sess-1');
  assert.equal(sess1.purpose, 'director');
  assert.equal(sess1.refs, 1);
  assert.equal(sess1.createdAt, 1000);
  assert.equal(sess1.lastUsedAt, 1000);
  assert.equal(transport.created.length, 1);

  // Second acquire for same purpose with reuse: true -> reuse same session, refs=2
  time = 2000;
  const sess2 = await manager.acquire({ purpose: 'director', reuse: true });
  assert.equal(sess2.id, 'sess-1');
  assert.equal(sess2.refs, 2);
  assert.equal(sess2.lastUsedAt, 2000);
  assert.equal(transport.created.length, 1);

  // Acquire with reuse: false -> creates new session
  time = 3000;
  const sess3 = await manager.acquire({ purpose: 'director', reuse: false });
  assert.equal(sess3.id, 'sess-2');
  assert.equal(sess3.refs, 1);
  assert.equal(transport.created.length, 2);

  // Acquire for different purpose 'qa' -> creates new session
  const sessQa = await manager.acquire({ purpose: 'qa' });
  assert.equal(sessQa.id, 'sess-3');
  assert.equal(sessQa.purpose, 'qa');
  assert.equal(transport.created.length, 3);
});

test('createSessionManager release() decrements refs and updates lastUsedAt', async () => {
  let time = 1000;
  const transport = createMockTransport();
  const manager = createSessionManager({
    transport,
    now: () => time,
  });

  const sess = await manager.acquire({ purpose: 'director' });
  assert.equal(sess.refs, 1);

  time = 2000;
  manager.release(sess.id);
  assert.equal(sess.refs, 0);
  assert.equal(sess.lastUsedAt, 2000);

  // Releasing again does not drop below 0
  manager.release(sess.id);
  assert.equal(sess.refs, 0);
});

test('createSessionManager reset() refuses while refs > 0 and succeeds when idle', async () => {
  const transport = createMockTransport();
  const manager = createSessionManager({ transport });

  const sess = await manager.acquire({ purpose: 'director' });
  assert.equal(sess.refs, 1);

  // Attempt reset while refs > 0 -> refused
  const refused = manager.reset('director');
  assert.deepEqual(refused, { reset: false, reason: 'active_stream' });

  // Release session -> refs = 0
  manager.release(sess.id);

  // Now reset succeeds
  const success = manager.reset('director');
  assert.equal(success.reset, true);
  assert.equal(success.count, 1);

  // Next acquire creates a fresh session
  const fresh = await manager.acquire({ purpose: 'director' });
  assert.notEqual(fresh.id, sess.id);
});

test('createSessionManager cleanup() evicts idle sessions by TTL and LRU, never evicts refs > 0', async () => {
  let time = 1000;
  const transport = createMockTransport();
  const manager = createSessionManager({
    transport,
    ttlMs: 5000,
    maxSessions: 2,
    now: () => time,
  });

  const s1 = await manager.acquire({ purpose: 'p1' }); // sess-1, refs 1
  const s2 = await manager.acquire({ purpose: 'p2' }); // sess-2, refs 1

  // Release s1, keep s2 active (refs=1)
  manager.release(s1.id);

  // Advance time past TTL
  time = 10000;

  // Cleanup: s1 is idle and past TTL -> evicted; s2 has refs > 0 -> preserved
  const cleanResult = manager.cleanup({ now: time });
  assert.equal(cleanResult.evicted, 1);

  const stats = manager.stats();
  assert.equal(stats.total, 1);
  assert.equal(stats.active, 1);

  // Even if maxSessions is exceeded, active sessions (refs > 0) are never evicted
  const s3 = await manager.acquire({ purpose: 'p3' }); // sess-3, refs 1
  const s4 = await manager.acquire({ purpose: 'p4' }); // sess-4, refs 1
  assert.equal(manager.stats().total, 3); // 3 active sessions, capacity 2
  const cleanActive = manager.cleanup({ now: time });
  assert.equal(cleanActive.evicted, 0); // None evicted because all are active (refs > 0)
});

test('createSessionManager stats() returns accurate breakdown', async () => {
  const transport = createMockTransport();
  const manager = createSessionManager({ transport });

  const s1 = await manager.acquire({ purpose: 'p1' });
  const s2 = await manager.acquire({ purpose: 'p2' });
  manager.release(s1.id);

  const st = manager.stats();
  assert.equal(st.total, 2);
  assert.equal(st.active, 1);
  assert.equal(st.byPurpose.p1.count, 1);
  assert.equal(st.byPurpose.p1.active, 0);
  assert.equal(st.byPurpose.p2.count, 1);
  assert.equal(st.byPurpose.p2.active, 1);
});

test('createSessionManager strictly separates session ID from model ID', async () => {
  const transport = createMockTransport();
  const manager = createSessionManager({ transport });

  const sess = await manager.acquire({ purpose: 'director' });
  assert.equal(sess.endpointId, undefined);
  assert.equal(sess.modelId, undefined);
  assert.ok(sess.id.startsWith('sess-'));
});
