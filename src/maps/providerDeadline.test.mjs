import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDeadline } from './providerDeadline.js';

test('provider deadline returns fast successes unchanged', async () => {
  const provider = { ready: true };
  assert.equal(await providerDeadline(Promise.resolve(provider), 100, 'Imagery'), provider);
});
test('provider deadline preserves provider rejection', async () => {
  await assert.rejects(providerDeadline(Promise.reject(new Error('HTTP 503')), 100), /HTTP 503/);
});
test('hung optional provider rejects within a bounded interval', async () => {
  const started = performance.now();
  await assert.rejects(providerDeadline(new Promise(() => {}), 25, 'Terrain'), /Terrain timed out after 25ms/);
  assert.ok(performance.now() - started < 1000);
});
test('late disposable provider is released after timeout', async () => {
  let disposed = 0;
  let resolve;
  const work = new Promise((done) => { resolve = done; });
  await assert.rejects(providerDeadline(work, 5), /timed out/);
  resolve({ destroy() { disposed++; }, isDestroyed() { return false; } });
  await new Promise((done) => setImmediate(done));
  assert.equal(disposed, 1);
});
