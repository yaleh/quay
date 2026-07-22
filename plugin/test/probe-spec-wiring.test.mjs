// probe-spec-wiring.test.mjs — DIR-056: verifies that readProbeSpec and
// resolveRoutineAction are correctly wired for probe-spec-based routines.
// Tests the plugin's own copies (plugin/scripts/), never the exp5 path.
//
// Run: node --test plugin/test/probe-spec-wiring.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

import { readProbeSpec } from '../scripts/read-probe-spec.ts';
import { resolveRoutineAction } from '../scripts/routine-scheduler.ts';

// ── T1: malformed YAML frontmatter → PROBE-SPEC FAIL-CLOSED ──────────────────
test('readProbeSpec: malformed YAML frontmatter → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t1-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(path.join(probesDir, 'bad-yaml.md'), '---\n: invalid: yaml: [\n---\nObjective text\n');
    await assert.rejects(
      async () => readProbeSpec('bad-yaml', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T2: missing instrument field → PROBE-SPEC FAIL-CLOSED ───────────────────
test('readProbeSpec: missing instrument field → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t2-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(path.join(probesDir, 'no-instrument.md'), '---\nfallback: none\n---\nObjective text\n');
    await assert.rejects(
      async () => readProbeSpec('no-instrument', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T3: file not found → PROBE-SPEC FAIL-CLOSED ─────────────────────────────
test('readProbeSpec: file not found → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t3-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    // Do NOT create the file — it should not be found
    await assert.rejects(
      async () => readProbeSpec('nonexistent', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T4: all 3 shipped probe specs parse successfully ─────────────────────────
test('all 3 shipped probe specs parse → valid { instrument, output_routing.default, objective }', () => {
  const names = ['self-validation', 'architecture-analysis', 'history-mining'];
  for (const name of names) {
    const spec = readProbeSpec(name, pluginRoot);
    assert.ok(typeof spec.instrument === 'string' && spec.instrument.length > 0,
      `${name}: instrument must be a non-empty string, got: ${JSON.stringify(spec.instrument)}`);
    assert.ok(spec.output_routing && typeof spec.output_routing === 'object' && !Array.isArray(spec.output_routing),
      `${name}: output_routing must be an object`);
    assert.ok(typeof spec.output_routing.default === 'string' && spec.output_routing.default.length > 0,
      `${name}: output_routing.default must be a non-empty string`);
    assert.ok(typeof spec.objective === 'string' && spec.objective.length > 0,
      `${name}: objective must be non-empty string`);
  }
});

// ── T5: resolveRoutineAction dispatch: back-compat ───────────────────────────
test('resolveRoutineAction({dispatch:"some-action"}, "/fake/root") → {kind:"dispatch", action:"some-action"}', () => {
  const r = resolveRoutineAction({ name: 'test-routine', trigger: 'every(1)', dispatch: 'some-action' }, '/fake/root');
  assert.equal(r.kind, 'dispatch');
  assert.equal(r.action, 'some-action');
});

// ── T6: resolveRoutineAction probe: form ─────────────────────────────────────
test('resolveRoutineAction({probe:"self-validation"}, "/fake/root") → {kind:"probe", name:"self-validation"}', () => {
  const r = resolveRoutineAction({ name: 'test-routine', trigger: 'every(1)', probe: 'self-validation' }, '/fake/root');
  assert.equal(r.kind, 'probe');
  assert.equal(r.name, 'self-validation');
  assert.equal(r.pluginRoot, '/fake/root');
});

// ── T7: probe: takes priority over dispatch: when both present ───────────────
test('resolveRoutineAction({probe:"arch",dispatch:"old-action"}, "/fake/root") → probe wins', () => {
  const r = resolveRoutineAction(
    { name: 'test-routine', trigger: 'every(1)', probe: 'arch', dispatch: 'old-action' },
    '/fake/root'
  );
  assert.equal(r.kind, 'probe', `expected probe to win; got kind="${r.kind}"`);
  assert.equal(r.name, 'arch');
});

// ── T8: output_routing merge — default preserved, spec values merged ─────────
test('readProbeSpec with output_routing:{defect:"milestone-candidate"} → merged output_routing preserves default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t8-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(
      path.join(probesDir, 'custom-routing.md'),
      '---\ninstrument: none\noutput_routing:\n  defect: milestone-candidate\n---\nObjective text\n'
    );
    const spec = readProbeSpec('custom-routing', tmpDir);
    assert.deepEqual(spec.output_routing, {
      default: 'milestone-candidate',
      defect: 'milestone-candidate',
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
