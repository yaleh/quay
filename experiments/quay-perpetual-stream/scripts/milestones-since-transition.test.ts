/**
 * milestones-since-transition.test — tests for milestones-since-transition.ts
 *
 * Run: node --experimental-strip-types --test experiments/quay-perpetual-stream/scripts/milestones-since-transition.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { compute, GROWTH_PHASE_LENGTH } from './milestones-since-transition.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const scriptPath = resolve(__dirname, 'milestones-since-transition.ts');

test('compute returns valid structure from real dashboard', () => {
  const result = compute();
  assert.equal(typeof result.currentChart, 'number');
  assert.equal(typeof result.lastTransitionMilestone, 'number');
  assert.equal(typeof result.milestonesSinceTransition, 'number');
  assert.equal(typeof result.currentMilestone, 'number');
  assert.ok(result.currentChart >= 2, `expected chart >= 2, got ${result.currentChart}`);
  assert.ok(result.currentMilestone >= 126, `expected counter >= 126, got ${result.currentMilestone}`);
});

test('compute reports correct last transition milestone', () => {
  const result = compute();
  // chart-2 opened at M121
  assert.equal(result.lastTransitionMilestone, 121);
});

test('compute reports milestones since transition correctly', () => {
  const result = compute();
  const expected = result.currentMilestone - 121;
  assert.equal(result.milestonesSinceTransition, expected);
});

test('GROWTH_PHASE_LENGTH is 10', () => {
  assert.equal(GROWTH_PHASE_LENGTH, 10);
});

test('compute works with fixture dashboard', () => {
  const tmp = resolve(repoRoot, 'test/fixtures/milestones-since-transition-fixture');
  mkdirSync(tmp, { recursive: true });
  try {
    const fixture = `# Dashboard

**state: RUNNING**
**milestone_counter: 50** · **chart: 1**

### Chart-1 transition (M03-abi-eval, DIR-001 items 1-2) — Provider-ABI surface added

New surface, weight **20**.
`;
    writeFileSync(resolve(tmp, 'dashboard.md'), fixture);
    const result = compute(resolve(tmp, 'dashboard.md'));
    assert.equal(result.currentChart, 1);
    assert.equal(result.currentMilestone, 50);
    // chart-1 at m3, so 50-3=47
    assert.equal(result.milestonesSinceTransition, 47);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI integration tests ───────────────────────────────────────────────

test('CLI outputs counter and exits 0', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  assert.ok(out.includes('milestones-since-transition:'), `got: ${out.slice(0, 200)}`);
});

test('CLI --json returns valid JSON', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --json`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.currentChart, 'number');
  assert.equal(typeof parsed.milestonesSinceTransition, 'number');
});
