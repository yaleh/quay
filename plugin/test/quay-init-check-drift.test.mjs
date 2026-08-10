// @test-group serial
// @load-sensitive heavy
// @load-sensitive-entry 2026-08-09 real-install e2e; install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh (--loop / --check-drift / upgrade subprocess tree). The
// install/quay-init family rotated flakes across groups under full-suite load, so the whole family is
// consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-check-drift.test.mjs — gap-delivery-surface-grows-but-target-freezes-no-upgrade.
//
// The delivery surface (the DERIVED loop-script set) GROWS as the plugin ships new mechanism
// scripts, but a target project installed at time T is frozen at T — a script added to the plugin
// after install never appears in the target, and nothing detects it (meta-cc: 7 of the 8 missing
// derived scripts were built after 08-03). This test pins the L2 "upgrade correctness" drift
// report (`quay-init.sh --check-drift`, Contract measure) and the upgrade path that fills
// drifted/missing derived scripts on re-run:
//
// AC2 — `--check-drift` prints a parseable `drift-report: 漂移 N / 缺失 N / 一致 N (derived-set M)`
//       with all three numbers present; on a clean install every derived script is 一致.
// AC1/control — construct a target missing one derived script ⇒ `--check-drift` reports 缺失-1 and
//       lists it; re-running `--loop` (the upgrade path) fills it; `--check-drift` then reports 缺失-0.
// AC3/control — locally modify a derived script ⇒ `--check-drift` lists it as 漂移 and is READ-ONLY
//       (never silently overwrites); the upgrade re-run backs it up + replaces with a visible report.
// L_G — send-keys-verified.sh is DELETED (superseded implementation removed —
//       gap-retired-script-still-callable); the drift report must NOT list it as missing (it does
//       not exist in the plugin tree, so it can never be laid back).
//
// Run:
//   scripts/test.sh plugin/test/quay-init-check-drift.test.mjs
//   node --test plugin/test/quay-init-check-drift.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

function makeTmp(prefix = 'quay-init-drift-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root the validation will ACCEPT (real disk, not tmpfs — same convention as
// quay-init-loop.test.mjs).
const _worktreeTestRoots = [];
after(() => {
  for (const d of _worktreeTestRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') { dir = fs.mkdtempSync(path.join(base, 'quay-wt-test-')); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-wt-test-'));
  _worktreeTestRoots.push(dir);
  return dir;
}

// A temp COPY of the real plugin with fake built vendor bundles, so `--loop` can succeed without
// depending on the ambient build state of the real worktree (the gitignored dist/ bundles may be
// absent). Same pattern as quay-init-loop.test.mjs's AC7b tests.
// NOTE: the copy ALSO adds a reference-doc declaration for
// `orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` — the loop tick docs
// reference it (added by the branch-model task) but init/SKILL.md lacks the declaration, so
// `verify_referenced_landed` fails on every --loop run (a PRE-EXISTING red on master, out of this
// task's Touches). Adding it to the hermetic copy lets the --loop fixture succeed without the test
// depending on that unrelated tree state.
function fakePluginRoot() {
  const src = makeTmp('quay-plugin-copy-');
  fs.cpSync(pluginDir, src, { recursive: true });
  const initSkill = path.join(src, 'skills', 'init', 'SKILL.md');
  const decl = '<!-- reference-doc: orchestration/SPEC-branching-model-integration-branch-2026-08-05.md -->';
  if (fs.existsSync(initSkill) && !fs.readFileSync(initSkill, 'utf8').includes(decl)) {
    fs.appendFileSync(initSkill, `\n${decl}\n`, 'utf8');
  }
  const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
  fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
  fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
  const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
  fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
  fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
  const fakeProviderYml = path.join(src, 'vendor', 'quay-native', 'provider.yml');
  fs.writeFileSync(fakeProviderYml, 'id: native\nname: "quay-native"\n', 'utf8');
  return src;
}

function runQuayInit(cwd, args, pluginRoot) {
  return spawnSync('bash', [path.join(pluginRoot, 'scripts', 'quay-init.sh'), ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } });
}

function runLoop(ws, pluginRoot) {
  return runQuayInit(ws, [
    '--loop', '--root', ws, '--project', 'proj',
    '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0',
    '--worktree-root', diskWorktreeRoot(),
  ], pluginRoot);
}

function runCheckDrift(ws, pluginRoot) {
  return runQuayInit(ws, ['--check-drift', '--root', ws], pluginRoot);
}

// Parse the summary line `drift-report: 漂移 N / 缺失 N / 一致 N (derived-set M)` — the
// compute_drift_report output that --check-drift actually produces (the older 漂移报告: format was
// superseded; quay-init-drift-report.test.mjs asserts the same drift-report: line).
function parseDriftSummary(stdout) {
  const m = stdout.match(/drift-report: 漂移 (\d+) \/ 缺失 (\d+) \/ 一致 (\d+) \(derived-set (\d+)\)/);
  if (!m) return null;
  return { drift: Number(m[1]), missing: Number(m[2]), consistent: Number(m[3]), derived: Number(m[4]) };
}

// AC2 — the drift report is parseable (all three numbers) and a clean install is fully 一致.
test('AC2 — --check-drift prints a parseable 漂移/缺失/一致 report; a clean install is 一致 (no drift/missing)', () => {
  const src = fakePluginRoot();
  const ws = makeTmp();
  try {
    const r = runLoop(ws, src);
    assert.equal(r.status, 0, `--loop must exit 0:\n${r.stderr}`);
    const c = runCheckDrift(ws, src);
    assert.equal(c.status, 0, `--check-drift must exit 0:\n${c.stderr}`);
    const s = parseDriftSummary(c.stdout);
    assert.ok(s, `summary must be parseable, got:\n${c.stdout}`);
    assert.equal(s.drift, 0, 'clean install must have zero drift');
    assert.equal(s.missing, 0, 'clean install must have zero missing');
    assert.equal(s.consistent, s.derived, 'clean install: every derived script is 一致 (consistent == derived)');
    assert.ok(s.derived > 0, 'the derived set must be non-empty (a meaningful denominator)');
  } finally { cleanup(ws); cleanup(src); }
});

// AC1/control — a target missing one derived script ⇒ drift report lists 缺失-1; the upgrade path
// (re-run --loop) fills it; drift report then 缺失-0.
test('AC1/control — missing derived script is listed 缺失-1 and the upgrade path (--loop re-run) fills it', () => {
  const src = fakePluginRoot();
  const ws = makeTmp();
  try {
    const r1 = runLoop(ws, src);
    assert.equal(r1.status, 0, `first --loop must exit 0:\n${r1.stderr}`);
    const target = path.join(ws, 'plugin', 'scripts', 'resource-gate.sh');
    assert.ok(fs.existsSync(target), 'resource-gate.sh must be laid down by the first install');
    fs.rmSync(target);   // construct the frozen-target defect: a derived script that went missing

    const before = runCheckDrift(ws, src);
    const sBefore = parseDriftSummary(before.stdout);
    assert.equal(sBefore.missing, 1, 'drift report must list exactly one missing');
    assert.match(before.stdout, /missing: plugin\/scripts\/resource-gate\.sh/, 'the missing script must be named');

    const upgrade = runLoop(ws, src);
    assert.equal(upgrade.status, 0, `upgrade (--loop re-run) must exit 0:\n${upgrade.stderr}`);
    assert.ok(fs.existsSync(target), 'the upgrade path must re-copy the missing derived script');
    assert.match(upgrade.stdout, /copied: .*resource-gate\.sh/, 'the upgrade must report the fill');

    const after = runCheckDrift(ws, src);
    const sAfter = parseDriftSummary(after.stdout);
    assert.equal(sAfter.missing, 0, 'after the upgrade the drift report must show 缺失-0');
    assert.equal(sAfter.drift, 0, 'after the upgrade there must be no drift');
  } finally { cleanup(ws); cleanup(src); }
});

// AC3/control — a locally-modified derived script is listed as 漂移 and --check-drift is READ-ONLY
// (never silently overwrites); the upgrade re-run backs it up + replaces with a visible report.
test('AC3/control — local edit is listed 漂移, --check-drift is read-only (不静默覆盖), upgrade backs up + replaces visibly', () => {
  const src = fakePluginRoot();
  const ws = makeTmp();
  try {
    const r1 = runLoop(ws, src);
    assert.equal(r1.status, 0, `first --loop must exit 0:\n${r1.stderr}`);
    const target = path.join(ws, 'plugin', 'scripts', 'resource-gate.sh');
    const original = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, original + '\n# local customisation\n', 'utf8');   // local edit

    const before = runCheckDrift(ws, src);
    const sBefore = parseDriftSummary(before.stdout);
    assert.equal(sBefore.drift, 1, 'drift report must list exactly one drift');
    assert.match(before.stdout, /drift: plugin\/scripts\/resource-gate\.sh/, 'the locally-modified script must be named as drift');

    // READ-ONLY: --check-drift must NOT modify the target (不静默覆盖 — it lists, never overwrites).
    const afterCheck = fs.readFileSync(target, 'utf8');
    assert.ok(afterCheck.includes('local customisation'), '--check-drift must not touch the local edit');

    // Upgrade path: clean-mode derived scripts back up + replace with a VISIBLE report (never silent).
    const upgrade = runLoop(ws, src);
    assert.equal(upgrade.status, 0, `upgrade must exit 0:\n${upgrade.stderr}`);
    assert.match(upgrade.stdout, /cleaned-residue: .*resource-gate\.sh/, 'the upgrade must visibly dispose of the drifted script');
    assert.match(upgrade.stdout, /backup:/, 'the upgrade must report the backup path (not silent)');
    assert.equal(fs.readFileSync(target, 'utf8'), original,
      'after the upgrade the drifted script is replaced with the product content');

    const after = runCheckDrift(ws, src);
    const sAfter = parseDriftSummary(after.stdout);
    assert.equal(sAfter.drift, 0, 'after the upgrade the drift report shows 漂移-0');
  } finally { cleanup(ws); cleanup(src); }
});

// L_G — send-keys-verified.sh is DELETED (superseded implementation removed —
// gap-retired-script-still-callable); the drift report must NOT list it as missing (it does not
// exist in the plugin tree, so it can never be laid back).
test('L_G — send-keys-verified.sh is DELETED (not in plugin tree, not in derived set, not reported missing)', () => {
  const src = fakePluginRoot();
  const ws = makeTmp();
  try {
    assert.ok(!fs.existsSync(path.join(src, 'scripts', 'send-keys-verified.sh')),
      'send-keys-verified.sh must NOT exist in the plugin tree (superseded implementation deleted — gap-retired-script-still-callable)');
    const r1 = runLoop(ws, src);
    assert.equal(r1.status, 0, `--loop must exit 0:\n${r1.stderr}`);
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'send-keys-verified.sh')),
      'the install must NOT lay down the deleted send-keys-verified.sh');
    const c = runCheckDrift(ws, src);
    // The missing/drift per-item lists must NOT contain it (matches quay-init-drift-report.test.mjs L_G).
    const itemLines = c.stdout.split('\n').filter((l) => /^\s+(missing|drift):/.test(l));
    assert.ok(!itemLines.some((l) => l.includes('send-keys-verified')),
      'the drift report must NOT list send-keys-verified.sh as missing/drift (it is not in the derived set)');
    const s = parseDriftSummary(c.stdout);
    assert.ok(s, 'summary must still be parseable');
  } finally { cleanup(ws); cleanup(src); }
});
