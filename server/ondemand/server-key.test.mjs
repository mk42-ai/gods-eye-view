import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveServerKey,
  serverKeyStatus,
  PERSISTENT_KEY_SOURCE,
} from './server-key.js';
import { parseDotenv, loadServerDotenv } from '../serverless/load-dotenv.js';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const FAKE = 'unit-test-key-never-logged-abc123';

test('server key: canonical env name resolves as env:persistent', () => {
  const r = resolveServerKey({ ONDEMAND_API_KEY: FAKE });
  assert.deepEqual(r, {
    value: FAKE,
    envName: 'ONDEMAND_API_KEY',
    source: PERSISTENT_KEY_SOURCE,
  });
});

test('server key: alias used only when canonical is empty', () => {
  assert.equal(
    resolveServerKey({ ONDEMAND_API_KEY: '', ON_DEMAND_API_KEY: FAKE }).envName,
    'ON_DEMAND_API_KEY',
  );
});

test('server key: fails closed on unset, empty, quoted-empty and placeholder values', () => {
  for (const v of [
    undefined,
    '',
    '   ',
    "''",
    '""',
    'your-api-key-here',
    'changeme',
    '<token>',
    'TODO',
  ]) {
    const s = serverKeyStatus({ ONDEMAND_API_KEY: v });
    assert.equal(s.configured, false, String(v));
    assert.equal(s.keySource, 'unset');
  }
});

test('server key: status never carries the value', () => {
  const s = serverKeyStatus({ ONDEMAND_API_KEY: FAKE });
  assert.deepEqual(s, {
    configured: true,
    keySource: 'env:persistent',
    envName: 'ONDEMAND_API_KEY',
  });
  assert.ok(!JSON.stringify(s).includes(FAKE.slice(4, 20)));
});

test('dotenv loader: parses quotes/comments/export and never overrides a real env value', () => {
  assert.deepEqual(
    parseDotenv(
      '# c\nA=1\nexport B=\'two words\'\nC="x" # note\nD=e # f\nbad line\n',
    ),
    { A: '1', B: 'two words', C: 'x', D: 'e' },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-env-'));
  fs.writeFileSync(
    path.join(dir, '.env'),
    `ONDEMAND_API_KEY=${FAKE}\nKEEP=file\nEMPTY=\n`,
  );
  const env = { KEEP: 'real' };
  const r = loadServerDotenv(dir, env);
  assert.deepEqual(r, { files: ['.env'], loaded: 1 });
  assert.equal(env.ONDEMAND_API_KEY, FAKE);
  assert.equal(env.KEEP, 'real');
  assert.equal(env.EMPTY, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no transient key-file loading path remains in server/api runtime code', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js)$/.test(e.name) && !e.name.endsWith('.test.mjs')) {
        const t = fs.readFileSync(p, 'utf8');
        if (/od-secret\.env|_API_KEY_FILE|secret\.env/.test(t))
          hits.push(path.relative(REPO, p));
      }
    }
  };
  walk(path.join(REPO, 'server'));
  walk(path.join(REPO, 'api'));
  assert.deepEqual(hits, []);
});

test('local secrets files are git-ignored', () => {
  const gi = fs
    .readFileSync(path.join(REPO, '.gitignore'), 'utf8')
    .split(/\r?\n/);
  for (const n of ['.env', '.env.local', '.env.*.local'])
    assert.ok(gi.includes(n), n);
});
