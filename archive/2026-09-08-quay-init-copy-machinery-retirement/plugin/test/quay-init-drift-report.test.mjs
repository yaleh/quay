// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e; governance file flaked at 20s in main body (round-162)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh (--loop install / --check-drift / upgrade subprocess tree).
// The install/quay-init family rotated flakes across groups under full-suite load — this governance
// file flaked at 20s in the concurrency-N main body (round-162) — so the whole family is consolidated
// into the concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-drift-report.test.mjs — gap-delivery-surface-grows-but-target-freezes-no-upgrade.
//
// MERGED (gap-quay-init-check-drift-merge-into-drift-report, 2026-08-19): absorbed the unique
// assertions from the retired quay-init-check-drift.test.mjs (which duplicated this file on the
// SAME gap, AC numbered 1:1) so no assertion style is lost:
//   - the INDEPENDENT before/after --check-drift 对照 (separate process invocations before and
//     after the upgrade, not just slicing the upgrade's own printed before/after reports),
//   - the READ-ONLY-on-drifted-script assertion (--check-drift lists, never overwrites the edit),
//   - the install-does-NOT-lay-down-deleted-script control (send-keys-verified.sh in the target),
//   - the derived>0 denominator assertion on a clean install.
//
// The delivery surface grows (new derived scripts ship with the plugin) while an installed target
// freezes at install time — there was no upgrade/refresh channel and no drift report. This test pins
// the mechanism added to plugin/scripts/quay-init.sh:
//
//   AC1  — upgrade/refresh path: re-running quay-init detects + updates the target's derived scripts
//          (per-item classification: drift/missing/consistent).
//   AC2  — drift report: `--check-drift` emits the parseable `漂移 N / 缺失 N / 一致 N` on the
//          DERIVED-SET axis (not the raw plugin/scripts file count — L_D); the L2 "升级正确性"
//          dimension.
//   AC3  — no silent overwrite: a locally-modified derived script is LISTED as drift and the upgrade
//          backs it up + reports before replacing (never silent); a missing one is auto-added.
//   L_G  — positive note: send-keys-verified.sh (deleted — superseded implementation) is NOT
//          reported.
//
// Contract:
//   measure   drift_report = `bash plugin/scripts/quay-init.sh --check-drift` stdout 的 漂移/缺失/一致 数字段
//   band      drift_report = 可解析（三数字齐全；缺失/漂移可升级到 0 或列明）
//   control   构造目标项目缺一个派生脚本 ⇒ 升级必补 + 报告缺失-1；本地改动脚本 ⇒ 列漂移不静默覆盖
//
// Run:
//   scripts/test.sh plugin/test/quay-init-drift-report.test.mjs
//   node --test plugin/test/quay-init-drift-report.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// AC3 (gap-serial-install-family-shared-prebuilt-fixture): the install-as-setup tests below copy a
// fresh installed root from the SHARED prebuilt fixture (one real install per serial phase, not one
// per test). The upgrade/drift re-runs stay REAL installs (they verify the upgrade path itself).
import { laydownWorkspace } from './quay-init-loop-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const INIT = path.join(pluginDir, 'scripts', 'quay-init.sh');

function makeTmp(prefix = 'drift-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A disk (non-tmpfs) worktree root the --loop validation will accept — /tmp is tmpfs on dev boxes
// and quay-init correctly fails closed there (gap-the-shipped-tick-doc-...-in-tmpfs).
const _wtRoots = [];
import { after } from 'node:test';
// ── AC2 install-setup timing (gap-serial-install-family-shared-prebuilt-fixture) ─────────────────
// Measure-first gate: time every REAL `--loop` install (the setup a shared prebuilt fixture would
// eliminate) vs the file's total wall time. Behavior-preserving — adds timing only, no assertion or
// flow change. Reported to stderr (never the TAP stream) from the after() hook below.
const _fileStart = Date.now();
let _loopInstallMs = 0;
let _loopInstallCount = 0;
after(() => {
  for (const d of _wtRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  const totalMs = Date.now() - _fileStart;
  const ratio = totalMs > 0 ? (_loopInstallMs / totalMs) * 100 : 0;
  process.stderr.write(
    `__INSTALL_SETUP__ install_ms=${_loopInstallMs} install_count=${_loopInstallCount} total_ms=${totalMs} ratio=${ratio.toFixed(1)}%\n`);
});
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') { dir = fs.mkdtempSync(path.join(base, 'quay-wt-drift-')); break; }
    } catch { /* try next */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-wt-drift-'));
  _wtRoots.push(dir);
  return dir;
}

function runInit(workspace, args = []) {
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  const t0 = Date.now();
  const r = spawnSync('bash', [INIT, ...extra, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
  });
  if (loop) { _loopInstallMs += Date.now() - t0; _loopInstallCount += 1; }
  return r;
}

const LOOP_ARGS = (ws) => ['--loop', '--root', ws, '--project', 'proj',
  '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];

// parseDriftReport(stdout): the parseable `漂移 N / 缺失 N / 一致 N (derived-set M)` line → {drift, missing, consistent, derived}.
function parseDriftReport(stdout) {
  const m = stdout.match(/drift-report: 漂移 (\d+) \/ 缺失 (\d+) \/ 一致 (\d+) \(derived-set (\d+)\)/);
  assert.ok(m, `parseable drift-report line must exist in output:\n${stdout}`);
  return { drift: Number(m[1]), missing: Number(m[2]), consistent: Number(m[3]), derived: Number(m[4]) };
}

// ── AC1/AC2: --check-drift is parseable + classifies a fresh target as all-missing ────────────────
test('AC1/AC2 — --check-drift on a fresh target: parseable 漂移/缺失/一致, all missing, READ-ONLY', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(r.status, 0, `--check-drift must exit 0:\n${r.stderr}`);
    const rep = parseDriftReport(r.stdout);
    assert.equal(rep.drift, 0, 'fresh target: no drift');
    assert.equal(rep.consistent, 0, 'fresh target: nothing consistent');
    assert.ok(rep.missing > 0, 'fresh target: derived scripts are all missing');
    assert.equal(rep.drift + rep.missing + rep.consistent, rep.derived,
      '漂移+缺失+一致 must equal the derived-set size (the report is on the derived axis)');
    // READ-ONLY: --check-drift must not create anything.
    assert.ok(!fs.existsSync(path.join(ws, 'plugin')), '--check-drift must NOT create plugin/');
    assert.ok(!fs.existsSync(path.join(ws, '.quay')), '--check-drift must NOT write state');
  } finally { cleanup(ws); }
});

// ── AC1/AC2: after a full --loop install the drift report is all-consistent ───────────────────────
test('AC1/AC2 — after a --loop install, --check-drift reports the derived set all consistent', () => {
  // AC3: the initial install is pure setup — copy it from the shared prebuilt fixture.
  const { ws, install: r1 } = laydownWorkspace();
  try {
    assert.equal(r1.status, 0, `--loop install must exit 0:\n${r1.stderr}`);
    const r2 = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(r2.status, 0, `--check-drift after install must exit 0:\n${r2.stderr}`);
    const rep = parseDriftReport(r2.stdout);
    assert.equal(rep.drift, 0, 'installed target: no drift');
    assert.equal(rep.missing, 0, 'installed target: nothing missing');
    assert.equal(rep.consistent, rep.derived, 'installed target: every derived script is consistent');
    assert.ok(rep.derived > 0, 'the derived set must be non-empty (a meaningful denominator)');
  } finally { cleanup(ws); }
});

// ── Contract control: target missing a derived script ⇒ upgrade restores + reports 缺失-1 ──────────
test('Contract control — a derived script deleted from the target ⇒ --loop upgrade auto-adds it and reports 缺失-1 then 缺失-0', () => {
  // AC3: the initial install is pure setup — copy it from the shared prebuilt fixture.
  const { ws, install: r1 } = laydownWorkspace();
  try {
    assert.equal(r1.status, 0, `install must exit 0:\n${r1.stderr}`);
    const victim = path.join(ws, 'plugin', 'scripts', 'resource-gate.sh');
    assert.ok(fs.existsSync(victim), 'resource-gate.sh must be laid down by the install');
    fs.rmSync(victim, { force: true });

    // check-drift merge (独立 before/after 对照): --check-drift as INDEPENDENT process invocations
    // before AND after the upgrade — not only slicing the upgrade's own printed before/after reports.
    const beforeCheck = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(beforeCheck.status, 0, `--check-drift before upgrade must exit 0:\n${beforeCheck.stderr}`);
    const beforeRep = parseDriftReport(beforeCheck.stdout);
    assert.equal(beforeRep.missing, 1, `independent pre-check must show 缺失 1:\n${beforeCheck.stdout}`);
    assert.match(beforeCheck.stdout, /missing: plugin\/scripts\/resource-gate\.sh/,
      'the independent pre-check must name the missing derived script');

    const r2 = runInit(ws, LOOP_ARGS(ws));
    assert.equal(r2.status, 0, `upgrade must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /copied: .*resource-gate\.sh/, 'the upgrade must report the fill (copied:)');
    // Pre-upgrade report must show exactly this one 缺失 (the deleted script).
    const pre = r2.stdout.indexOf('drift report (before upgrade):');
    const post = r2.stdout.indexOf('drift report (after upgrade):');
    assert.ok(pre >= 0 && post > pre, 'the upgrade run must print before/after drift reports');
    const preBlock = r2.stdout.slice(pre, post);
    const preRep = parseDriftReport(preBlock);
    assert.equal(preRep.missing, 1, `upgrade pre-report must show 缺失 1:\n${preBlock}`);
    assert.match(preBlock, /missing: plugin\/scripts\/resource-gate\.sh/,
      'the pre-report must name the missing derived script');
    // The upgrade must actually restore it.
    assert.ok(fs.existsSync(victim), 'the deleted derived script must be auto-added by the upgrade');
    assert.equal(fs.readFileSync(victim, 'utf8'),
      fs.readFileSync(path.join(pluginDir, 'scripts', 'resource-gate.sh'), 'utf8'),
      'the restored script must be byte-identical to the plugin delivery');
    const postRep = parseDriftReport(r2.stdout.slice(post));
    assert.equal(postRep.missing, 0, 'upgrade post-report must show 缺失 0');
    assert.equal(postRep.drift, 0, 'upgrade post-report must show 漂移 0');
    // check-drift merge (独立 before/after 对照): the post-upgrade --check-drift run is independent too.
    const afterCheck = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(afterCheck.status, 0, `--check-drift after upgrade must exit 0:\n${afterCheck.stderr}`);
    const afterRep = parseDriftReport(afterCheck.stdout);
    assert.equal(afterRep.missing, 0, 'independent post-check must show 缺失 0');
    assert.equal(afterRep.drift, 0, 'independent post-check must show 漂移 0');
  } finally { cleanup(ws); }
});

// ── AC3: a locally-modified derived script ⇒ listed as drift; upgrade backs up + reports (never silent) ──
test('AC3 — a locally-modified derived script is listed as drift and the upgrade is NOT silent (backup + report)', () => {
  // AC3: the initial install is pure setup — copy it from the shared prebuilt fixture.
  const { ws, install: r1 } = laydownWorkspace();
  try {
    assert.equal(r1.status, 0, `install must exit 0:\n${r1.stderr}`);
    const victim = path.join(ws, 'plugin', 'scripts', 'resource-gate.sh');
    const localEdit = '\n# local customisation by the target project\n';
    fs.writeFileSync(victim, fs.readFileSync(victim, 'utf8') + localEdit, 'utf8');

    // --check-drift: the local edit is LISTED as drift (not silently ignored).
    const r2 = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(r2.status, 0, `--check-drift must exit 0:\n${r2.stderr}`);
    const rep2 = parseDriftReport(r2.stdout);
    assert.equal(rep2.drift, 1, `the local edit must be reported as 漂移 1:\n${r2.stdout}`);
    assert.match(r2.stdout, /drift: plugin\/scripts\/resource-gate\.sh/, 'the drifted script must be named');
    // check-drift merge (READ-ONLY on a drifted script): --check-drift lists, never overwrites the edit.
    assert.ok(fs.readFileSync(victim, 'utf8').includes('local customisation by the target project'),
      '--check-drift must not touch the local edit (read-only)');

    // --loop upgrade: pre-report lists drift, the residue cleanup backs up + replaces VISIBLY, post 漂移 0.
    const r3 = runInit(ws, LOOP_ARGS(ws));
    assert.equal(r3.status, 0, `upgrade must exit 0:\n${r3.stderr}`);
    const pre = r3.stdout.indexOf('drift report (before upgrade):');
    const post = r3.stdout.indexOf('drift report (after upgrade):');
    assert.ok(pre >= 0 && post > pre, 'the upgrade run must print before/after drift reports');
    assert.equal(parseDriftReport(r3.stdout.slice(pre, post)).drift, 1, 'pre-report must show 漂移 1');
    assert.match(r3.stdout, /cleaned-residue: .*resource-gate\.sh/, 'the drift must be reported (not silent)');
    assert.match(r3.stdout, /backup: .*resource-gate\.sh/, 'the backup path must be reported');
    // The local content is preserved in the backup (nothing silently lost).
    const backupsDir = path.join(ws, '.quay', 'quay-init-backups');
    const backupFiles = fs.readdirSync(backupsDir, { recursive: true })
      .filter((p) => typeof p === 'string' && p.endsWith('resource-gate.sh'));
    assert.ok(backupFiles.length > 0, 'a backup of the drifted script must exist');
    assert.match(fs.readFileSync(path.join(backupsDir, backupFiles[0]), 'utf8'), /local customisation by the target project/,
      'the backup must preserve the local edit (nothing silently lost)');
    // Post-upgrade the target is byte-identical to the plugin delivery again.
    assert.equal(parseDriftReport(r3.stdout.slice(post)).drift, 0, 'post-report must show 漂移 0');
    assert.equal(fs.readFileSync(victim, 'utf8'),
      fs.readFileSync(path.join(pluginDir, 'scripts', 'resource-gate.sh'), 'utf8'),
      'the upgraded script must be byte-identical to the plugin delivery');
  } finally { cleanup(ws); }
});

// ── L_G positive note: send-keys-verified.sh is DELETED (superseded implementation) → NOT reported ──
test('L_G — send-keys-verified.sh (deleted — superseded implementation) is NOT in the drift report', () => {
  const ws = makeTmp();
  try {
    assert.ok(!fs.existsSync(path.join(pluginDir, 'scripts', 'send-keys-verified.sh')),
      'send-keys-verified.sh must NOT exist in the plugin tree (superseded implementation deleted — gap-retired-script-still-callable)');
    const r = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(r.status, 0, `--check-drift must exit 0:\n${r.stderr}`);
    const rep = parseDriftReport(r.stdout);
    const missingLines = r.stdout.split('\n').filter((l) => l.startsWith('  missing: '));
    assert.ok(!missingLines.some((l) => l.includes('send-keys-verified')),
      'missing list must not contain send-keys-verified.sh (deleted — the upgrade has nothing to lay back down)');
    assert.ok(rep.derived > 0, 'the derived set is non-empty');
  } finally { cleanup(ws); }
});

// ── L_G (check-drift merge): a real install does NOT lay down the deleted script in the target ────
test('L_G — a real --loop install does NOT lay down the deleted send-keys-verified.sh (merged from check-drift)', () => {
  const { ws, install: r1 } = laydownWorkspace();
  try {
    assert.equal(r1.status, 0, `install must exit 0:\n${r1.stderr}`);
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'send-keys-verified.sh')),
      'the install must NOT lay down the deleted send-keys-verified.sh (it is not in the derived set)');
    const r2 = runInit(ws, ['--check-drift', '--root', ws]);
    assert.equal(r2.status, 0, `--check-drift must exit 0:\n${r2.stderr}`);
    const itemLines = r2.stdout.split('\n').filter((l) => /^\s+(missing|drift):/.test(l));
    assert.ok(!itemLines.some((l) => l.includes('send-keys-verified')),
      'the drift report must NOT list send-keys-verified.sh as missing/drift');
    parseDriftReport(r2.stdout); // the summary stays parseable
  } finally { cleanup(ws); }
});

// ── Idempotence regression: re-running --loop on a fully-installed target changes nothing ──────────
test('idempotence — re-running --loop on an installed target: all skipped, drift report stays all consistent, no residue cleanup', () => {
  // AC3: the initial install is pure setup — copy it from the shared prebuilt fixture.
  const { ws, install: r1 } = laydownWorkspace();
  try {
    assert.equal(r1.status, 0, `install must exit 0:\n${r1.stderr}`);
    const r2 = runInit(ws, LOOP_ARGS(ws));
    assert.equal(r2.status, 0, `re-run must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /skipped \(identical\)/, 're-run must skip identical files');
    assert.ok(!r2.stdout.includes('cleaned-residue'), 'an identical re-run must NOT clean residue');
    const post = r2.stdout.indexOf('drift report (after upgrade):');
    assert.ok(post >= 0, 're-run must print the post-upgrade drift report');
    const rep = parseDriftReport(r2.stdout.slice(post));
    assert.equal(rep.drift, 0, 're-run post-report: no drift');
    assert.equal(rep.missing, 0, 're-run post-report: nothing missing');
    assert.equal(rep.consistent, rep.derived, 're-run post-report: all consistent');
  } finally { cleanup(ws); }
});
