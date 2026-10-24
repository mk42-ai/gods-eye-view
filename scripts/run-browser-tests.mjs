#!/usr/bin/env node
/** Run the repository's Playwright suite with a wall-clock cap and process-tree cleanup. */
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
const args = process.argv.slice(2);
const duration = Number(process.env.BROWSER_TEST_TIMEOUT_MS) || 900000;
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'tests/playwright.config.mjs', ...args], { stdio: 'inherit', detached: true });
const owned = new Set([child.pid]);
const groups = new Set([child.pid]);
let finishing = false;
function track() {
  const rows = spawnSync('ps', ['-eo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).stdout?.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)) || [];
  for (let pass = 0; pass < 8; pass++) for (const [pid, parent, group] of rows) if (owned.has(parent)) { owned.add(pid); if (group !== process.pid && group !== process.ppid) groups.add(group); }
}
const watch = setInterval(track, 500);
function finish(code) {
  if (finishing) return;
  finishing = true;
  clearTimeout(cap); clearInterval(watch); track();
  for (const group of groups) { try { process.kill(-group, 'SIGKILL'); } catch {} }
  process.exit(code);
}
const cap = setTimeout(() => { console.error(`Browser suite exceeded ${duration}ms wall-clock cap`); finish(124); }, duration);
process.on('SIGINT', () => finish(130));
process.on('SIGTERM', () => finish(143));
child.on('error', (error) => { console.error(error.message); finish(1); });
child.on('exit', (code) => finish(code ?? 1));
