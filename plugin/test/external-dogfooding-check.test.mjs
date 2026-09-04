// @test-group engine
// external-dogfooding-check.test.mjs — DIR-043: pure-function tests for the external-dogfooding
// routine's mechanical contract checker. Exercises the checker against GREEN + RED fixtures; never
// spawns tmux or touches a live foreign session (the real remote-driven fire is the routine's
// operational DoD, not a unit-test concern).
//
// Run: node --test plugin/test/external-dogfooding-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const CHECKER = path.join(pluginRoot, 'scripts', 'external-dogfooding-check.ts');

import {
  checkCadenceTrigger,
  checkRoutineConfig,
  checkTargetDrivable,
  checkRemoteDriveSurface,
  checkDirectiveFinding,
  extractRoutines,
  selftest,
} from '../scripts/external-dogfooding-check.ts';
import { parseRegistry } from '../scripts/drivable-workspace-check.ts';

// ── cadence (AC1) ──────────────────────────────────────────────────────────────
test('cadence: every(N) and on(checkpoint) are valid (AC1 configurable cadence)', () => {
  const e = checkCadenceTrigger('every(5)');
  assert.equal(e.ok, true);
  assert.equal(e.kind, 'every');
  assert.equal(e.n, 5);
  const one = checkCadenceTrigger('every(1)');
  assert.equal(one.ok, true);
  assert.equal(one.n, 1);
  const c = checkCadenceTrigger('on(checkpoint)');
  assert.equal(c.ok, true);
  assert.equal(c.kind, 'on');
  assert.equal(c.event, 'checkpoint');
});

test('cadence: malformed/empty/null triggers fail closed', () => {
  assert.equal(checkCadenceTrigger('every(0)').ok, false, 'every(0) rejected (N>=1)');
  assert.equal(checkCadenceTrigger('sometimes').ok, false, 'unknown grammar rejected');
  assert.equal(checkCadenceTrigger('   ').ok, false, 'blank trigger rejected');
  assert.equal(checkCadenceTrigger(null).ok, false, 'null rejected');
});

// ── routine config (AC1) ───────────────────────────────────────────────────────
const routinesFixture = [
  { name: 'self-validation', trigger: 'every(5)', probe: 'self-validation' },
  { name: 'external-dogfooding', trigger: 'every(8)', probe: 'external-dogfooding' },
  { name: 'architecture-analysis', trigger: 'every(10)', probe: 'architecture-analysis' },
];

test('routine-config: a declared external-dogfooding routine with cadence + action resolves', () => {
  const r = checkRoutineConfig(routinesFixture, 'external-dogfooding');
  assert.equal(r.ok, true);
  assert.equal(r.routine.probe, 'external-dogfooding');
});

test('routine-config: undeclared / malformed / action-less routines fail closed', () => {
  assert.equal(checkRoutineConfig(routinesFixture, 'never-declared').ok, false, 'undeclared rejected');
  assert.equal(checkRoutineConfig([{ name: 'x', trigger: 'sometimes' }], 'x').ok, false, 'bad trigger rejected');
  assert.equal(checkRoutineConfig([{ name: 'x', trigger: 'every(2)' }], 'x').ok, false, 'no action rejected');
  assert.equal(checkRoutineConfig('nope', 'x').ok, false, 'non-array rejected');
});

test('extractRoutines: loop.routines nesting and flat routines both extracted; none -> null', () => {
  const nested = extractRoutines({ loop: { routines: [{ name: 'external-dogfooding' }] } });
  assert.equal(Array.isArray(nested) && nested.length, 1);
  const flat = extractRoutines({ routines: [{ name: 'x' }] });
  assert.equal(Array.isArray(flat) && flat.length, 1);
  assert.equal(extractRoutines({ gates: ['acceptance'] }), null);
});

// ── target drivability (AC2) ───────────────────────────────────────────────────
const fixtureRegistry = parseRegistry(
  'authorized_root: /home/yale/work\nworkspaces:\n  - path: /opt/outside/foreign\n'
);

test('target: a foreign workspace under authorized_root or an explicit entry is drivable (AC2)', () => {
  assert.equal(checkTargetDrivable('/home/yale/work/archguard', fixtureRegistry).ok, true);
  assert.equal(checkTargetDrivable('/opt/outside/foreign', fixtureRegistry).ok, true);
});

test('target: an uncovered or empty target fails closed', () => {
  assert.equal(checkTargetDrivable('/tmp/x', fixtureRegistry).ok, false);
  assert.equal(checkTargetDrivable('', fixtureRegistry).ok, false);
});

test('target: the REAL registry covers archguard and rejects /tmp (round-trip)', () => {
  const realPath = path.resolve(pluginRoot, '..', 'experiments', 'quay-perpetual-stream', 'drivable-workspaces.yml');
  assert.equal(fs.existsSync(realPath), true, 'real registry must exist');
  const real = parseRegistry(fs.readFileSync(realPath, 'utf8'));
  assert.equal(checkTargetDrivable('/home/yale/work/archguard', real).ok, true);
  assert.equal(checkTargetDrivable('/tmp/x', real).ok, false);
});

// ── remote-drive surface (AC4) ─────────────────────────────────────────────────
test('surface: the ADR-016 drive surface is present in the real plugin root (AC4)', () => {
  const r = checkRemoteDriveSurface(pluginRoot);
  assert.equal(r.ok, true, `missing: ${r.missing.join(', ')}`);
  assert.ok(r.present.includes('send-keys-reliable.sh'));
  assert.ok(r.present.includes('transcript-delivery-check.ts'));
});

test('surface: an empty plugin root reports every required file missing (fail-closed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edog-surface-'));
  try {
    const r = checkRemoteDriveSurface(dir);
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── finding shape (AC3) ────────────────────────────────────────────────────────
const GOOD_FINDING = [
  '---',
  'id: GAP-ED-001',
  'title: "dogfooding found a real friction"',
  'status: todo',
  'labels:',
  '  - directive',
  '---',
  '## Finding',
  'Reproduced real friction: `quay task get` on archguard failed for a foreign id prefix.',
  'Evidence: node_modules/quay -- task get QX-999 on /home/yale/work/archguard returned non-zero.',
].join('\n');

test('finding: an evidence-backed directive-shaped finding passes (AC3)', () => {
  const r = checkDirectiveFinding(GOOD_FINDING);
  assert.equal(r.ok, true, r.reasons.join('; '));
});

test('finding: non-directive label, vague no-evidence finding, and empty text all fail closed (AC3)', () => {
  const noLabel = checkDirectiveFinding(GOOD_FINDING.replace('  - directive', '  - milestone-candidate'));
  assert.equal(noLabel.ok, false, 'non-directive label rejected');
  const vague = checkDirectiveFinding(
    GOOD_FINDING
      .replace('`quay task get`', 'the CLI')
      .replace('returned non-zero', 'failed')
      .replace('Evidence: node_modules/quay -- task get QX-999 on /home/yale/work/archguard.', 'A friction happened.')
  );
  assert.equal(vague.ok, false, 'vague finding without evidence rejected');
  assert.equal(checkDirectiveFinding('').ok, false, 'empty finding rejected');
});

test('finding: inline-array labels: [directive] form is accepted too', () => {
  const inline = GOOD_FINDING.replace('labels:\n  - directive', 'labels: [directive]');
  assert.equal(checkDirectiveFinding(inline).ok, true);
});

// ── CLI surface ────────────────────────────────────────────────────────────────
function runCli(args) {
  return spawnSync('node', ['--no-warnings', '--experimental-strip-types', CHECKER, ...args], {
    encoding: 'utf8',
    cwd: pluginRoot,
  });
}

test('CLI: --selftest exits 0 and reports all fixture cases PASS', () => {
  const r = runCli(['--selftest']);
  assert.equal(r.status, 0, `exit 0 expected, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /SELFTEST: all fixture cases PASS\./);
});

test('CLI: --cadence every(8) exits 0; --cadence sometimes exits 1', () => {
  const ok = runCli(['--cadence', 'every(8)']);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /PASS: cadence/);
  const bad = runCli(['--cadence', 'sometimes']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /FAIL: cadence/);
});

test('CLI: --surface with the real plugin root exits 0; --target authorized exits 0', () => {
  const surface = runCli(['--surface', '--plugin-root', pluginRoot]);
  assert.equal(surface.status, 0, surface.stderr);
  const target = runCli(['--target', '/home/yale/work/archguard', '--registry', path.resolve(pluginRoot, '..', 'experiments', 'quay-perpetual-stream', 'drivable-workspaces.yml')]);
  assert.equal(target.status, 0, target.stderr);
});

test('CLI: missing required args are a usage error (exit 2), not a silent pass', () => {
  const r = runCli(['--surface']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
