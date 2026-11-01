import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootageMetrics, formatFootageMetrics } from './metrics.js';

test('createFootageMetrics: tracks start, success, failure, errors, and timestamps', () => {
  let currentTime = 1000;
  const metrics = createFootageMetrics({ now: () => currentTime });

  const initial = metrics.snapshot();
  assert.equal(initial.requestsAttempted, 0);
  assert.equal(initial.requestsSucceeded, 0);
  assert.equal(initial.requestsFailed, 0);
  assert.equal(initial.startedAt, null);
  assert.equal(initial.finishedAt, null);

  currentTime = 2000;
  metrics.start('ladder-step-1');
  currentTime = 2500;
  metrics.success('ladder-step-1', { status: 200 });

  currentTime = 3000;
  metrics.start('fanout-variant-1');
  currentTime = 3500;
  metrics.failure('fanout-variant-1', { status: 502, code: 'plugin_error' });

  const snap = metrics.snapshot();
  assert.equal(snap.requestsAttempted, 2);
  assert.equal(snap.requestsSucceeded, 1);
  assert.equal(snap.requestsFailed, 1);
  assert.equal(snap.errors.length, 1);
  assert.deepEqual(snap.errors[0], {
    step: 'fanout-variant-1',
    status: 502,
    code: 'plugin_error',
  });
  assert.equal(snap.startedAt, new Date(2000).toISOString());
  assert.equal(snap.finishedAt, new Date(3500).toISOString());
});

test('createFootageMetrics: rateLimit sets throttled on 429 or explicit call', () => {
  const metrics = createFootageMetrics();
  assert.equal(metrics.snapshot().rateLimit.state, 'ok');

  metrics.start('req-1');
  metrics.failure('req-1', { status: 429, code: 'rate_limited' });
  assert.equal(metrics.snapshot().rateLimit.state, 'throttled');

  metrics.rateLimit({
    remaining: 10,
    state: 'ok',
    resetAt: '2026-11-01T12:00:00Z',
  });
  const snap = metrics.snapshot();
  assert.equal(snap.rateLimit.state, 'ok');
  assert.equal(snap.rateLimit.remaining, 10);
  assert.equal(snap.rateLimit.resetAt, '2026-11-01T12:00:00Z');

  metrics.rateLimit({ remaining: 0 });
  assert.equal(metrics.snapshot().rateLimit.state, 'throttled');
});

test('createFootageMetrics: batch capability state and active jobs', () => {
  const metrics = createFootageMetrics();
  assert.equal(metrics.snapshot().batchState, 'unavailable (405)');
  assert.equal(metrics.snapshot().activeBatchJobs, 0);

  metrics.batch({ jobId: 'job-123', state: 'active' });
  assert.equal(metrics.snapshot().batchState, 'active');
  assert.equal(metrics.snapshot().activeBatchJobs, 1);

  metrics.batch({ state: 'unavailable (405)' });
  assert.equal(metrics.snapshot().batchState, 'unavailable (405)');
  assert.equal(metrics.snapshot().activeBatchJobs, 1);
});

test('createFootageMetrics: record updates raw, unique, duplicates, relevant', () => {
  const metrics = createFootageMetrics();
  metrics.record({ raw: 15, unique: 10, duplicates: 5, relevant: 8 });
  const snap = metrics.snapshot();
  assert.equal(snap.results, 15);
  assert.equal(snap.unique, 10);
  assert.equal(snap.duplicates, 5);
  assert.equal(snap.relevant, 8);

  // Auto-computes duplicates if omitted
  metrics.record({ raw: 20, unique: 14 });
  const snap2 = metrics.snapshot();
  assert.equal(snap2.results, 20);
  assert.equal(snap2.unique, 14);
  assert.equal(snap2.duplicates, 6);
  assert.equal(snap2.relevant, 8); // preserved
});

test('formatFootageMetrics: formats line with exact format and verified=0 note', () => {
  const metrics = createFootageMetrics();
  metrics.start('s1');
  metrics.success('s1');
  metrics.start('s2');
  metrics.success('s2');
  metrics.start('s3');
  metrics.failure('s3', { status: 500, code: 'upstream_error' });
  metrics.record({ raw: 12, unique: 9, duplicates: 3, relevant: 4 });

  const lineVerified = formatFootageMetrics(metrics.snapshot(), {
    verified: 2,
  });
  assert.equal(
    lineVerified,
    'Requests 3 attempted · 2 ok · 1 failed · 12 results · 9 unique · 3 duplicates · 4 relevant · batch: unavailable (405) · rate limit: ok',
  );

  const lineUnverified = formatFootageMetrics(metrics.snapshot(), {
    verified: 0,
    unverifiedReason: 'no capture time / coordinates',
  });
  assert.equal(
    lineUnverified,
    'Requests 3 attempted · 2 ok · 1 failed · 12 results · 9 unique · 3 duplicates · 4 relevant · batch: unavailable (405) · rate limit: ok · unverified: no capture time / coordinates',
  );
});
