/**
 * chart-saturation-check.test — tests for chart-saturation-check.ts
 *
 * Run: node --experimental-strip-types --test experiments/quay-perpetual-stream/scripts/chart-saturation-check.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSaturation } from './chart-saturation-check.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, 'chart-saturation-check.ts');

test('checkSaturation returns NOT-DUE for non-zero slope with headroom', () => {
  const result = checkSaturation({ slope: 0.5, headroom: 0.3, counter: 200 });
  assert.equal(result.verdict, 'NOT-DUE');
  assert.ok(result.reasons.some((r) => r.includes('slope') && r.includes('>')), 'slope reason missing');
});

test('checkSaturation returns NOT-DUE for zero slope but large headroom', () => {
  const result = checkSaturation({ slope: 0, headroom: 0.5, counter: 200 });
  assert.equal(result.verdict, 'NOT-DUE');
  assert.ok(result.reasons.some((r) => r.includes('headroom') && r.includes('≥')), 'headroom reason missing');
});

test('checkSaturation returns NOT-DUE for zero slope, small headroom, but counter too low', () => {
  const result = checkSaturation({ slope: 0, headroom: 0.01, counter: 5 });
  assert.equal(result.verdict, 'NOT-DUE');
  assert.ok(result.reasons.some((r) => r.includes('counter') && r.includes('≤')), 'counter reason missing');
});

test('checkSaturation returns NOT-DUE at exact thresholds', () => {
  // Slope exactly at ε, headroom exactly at ε, counter at threshold — all edge
  const result = checkSaturation({ slope: 0.02, headroom: 0.05, counter: 10 });
  assert.equal(result.verdict, 'NOT-DUE');
});

test('checkSaturation returns TRANSITION-DUE for cp-120 state', () => {
  // Real cp-120: slope ≈ 0, chart-1 headroom ≈ 0.08 (110.65/120 ≈ 0.922, headroom = 1-0.922 = 0.078)
  // counter = m120 - m3 = 117 (chart-1 opened at m3)
  const result = checkSaturation({ slope: 0.0, headroom: 0.08, counter: 117 });
  assert.equal(result.verdict, 'TRANSITION-DUE');
  assert.equal(result.reasons.length, 3);
});

test('checkSaturation returns TRANSITION-DUE for clear saturation', () => {
  const result = checkSaturation({ slope: 0.001, headroom: 0.01, counter: 50 });
  assert.equal(result.verdict, 'TRANSITION-DUE');
});

// ── CLI integration tests ───────────────────────────────────────────────

test('CLI --json returns valid JSON with correct verdict for NOT-DUE', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --slope 0.5 --headroom 0.3 --counter 20 --json`, {
    encoding: 'utf-8', cwd: resolve(__dirname, '../..'), stdio: 'pipe',
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.verdict, 'NOT-DUE');
  assert.ok(Array.isArray(parsed.reasons));
});

test('CLI --json returns TRANSITION-DUE for cp-120 fixture', () => {
  try {
    execSync(`node --experimental-strip-types ${scriptPath} --slope 0 --headroom 0.08 --counter 117 --json`, {
      encoding: 'utf-8', cwd: resolve(__dirname, '../..'), stdio: 'pipe',
    });
  } catch (e: any) {
    // TRANSITION-DUE exits 1, but JSON is on stdout
    const parsed = JSON.parse(e.stdout);
    assert.equal(parsed.verdict, 'TRANSITION-DUE');
  }
});

test('CLI exits 0 for NOT-DUE', () => {
  execSync(`node --experimental-strip-types ${scriptPath} --slope 0.5 --headroom 0.3 --counter 20`, {
    encoding: 'utf-8', cwd: resolve(__dirname, '../..'), stdio: 'pipe',
  });
});

test('CLI exits 1 for TRANSITION-DUE', () => {
  try {
    execSync(`node --experimental-strip-types ${scriptPath} --slope 0 --headroom 0.01 --counter 50`, {
      encoding: 'utf-8', cwd: resolve(__dirname, '../..'), stdio: 'pipe',
    });
    assert.fail('expected non-zero exit for TRANSITION-DUE');
  } catch (e: any) {
    assert.equal(e.status, 1);
  }
});
