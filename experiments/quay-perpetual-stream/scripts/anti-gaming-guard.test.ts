/**
 * anti-gaming-guard.test — tests for anti-gaming-guard.ts
 *
 * Run: node --experimental-strip-types --test experiments/quay-perpetual-stream/scripts/anti-gaming-guard.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSurface } from './anti-gaming-guard.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const scriptPath = resolve(__dirname, 'anti-gaming-guard.ts');

test('validateSurface PASSes machine-verifiable, capped, non-inflatable, explicitly adjudicated', () => {
  const result = validateSurface({
    covSource: 'machine',
    covCapped: true,
    covInflatable: false,
    adjudication: 'fold',
  });
  assert.equal(result.pass, true);
  assert.equal(result.failures.length, 0);
});

test('validateSurface REJECTs subjective cov source', () => {
  const result = validateSurface({
    covSource: 'subjective',
    covCapped: true,
    covInflatable: false,
    adjudication: 'fold',
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('subjective')), 'expected subjective failure');
});

test('validateSurface REJECTs uncapped cov', () => {
  const result = validateSurface({
    covSource: 'machine',
    covCapped: false,
    covInflatable: false,
    adjudication: 'fold',
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('uncapped')), 'expected uncapped failure');
});

test('validateSurface REJECTs inflatable cov', () => {
  const result = validateSurface({
    covSource: 'machine',
    covCapped: true,
    covInflatable: true,
    adjudication: 'fold',
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('inflatable')), 'expected inflatable failure');
});

test('validateSurface REJECTs no adjudication', () => {
  const result = validateSurface({
    covSource: 'machine',
    covCapped: true,
    covInflatable: false,
    adjudication: 'none',
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('adjudication')), 'expected adjudication failure');
});

test('validateSurface REJECTs multiple failures at once', () => {
  const result = validateSurface({
    covSource: 'subjective',
    covCapped: false,
    covInflatable: true,
    adjudication: 'none',
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures.length, 4);
});

test('validateSurface accepts all adjudication types when other checks pass', () => {
  for (const adj of ['pursue', 'abandon', 'fold'] as const) {
    const result = validateSurface({
      covSource: 'machine', covCapped: true, covInflatable: false, adjudication: adj,
    });
    assert.equal(result.pass, true, `adjudication=${adj} should pass`);
  }
});

// ── CLI integration tests ───────────────────────────────────────────────

test('CLI PASSes a valid surface', () => {
  execSync(`node --experimental-strip-types ${scriptPath} --cov-source machine --cov-inflatable false --adjudication fold`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
});

test('CLI REJECTs (exit 1) a subjective + no-adjudication surface (RED fixture)', () => {
  try {
    execSync(`node --experimental-strip-types ${scriptPath} --cov-source subjective --adjudication none`, {
      encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
    });
    assert.fail('expected non-zero exit');
  } catch (e: any) {
    assert.equal(e.status, 1);
  }
});

test('CLI --json returns structured result', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --cov-source machine --cov-inflatable false --adjudication fold --json`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.pass, true);
  assert.ok(Array.isArray(parsed.failures));
});
