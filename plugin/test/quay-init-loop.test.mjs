// @test-group governance
// quay-init-loop.test.mjs — gap-loop-mechanism-lives-outside-the-package-and-cannot-ship +
// gap-cold-start-needs-a-human-to-dictate-eight-steps (phase 1: AC2/AC3/AC4).
// Tests the `--loop` category of plugin/scripts/quay-init.sh: lays down the two-layer loop
// mechanism into a target workspace with mechanized placeholder substitution (AC3/AC4), and
// the upgrade path that must not overwrite local changes (AC5).
//
// AC3 — `quay-init --loop --dry-run` lists would-copy items; a real run lays down the full set.
// AC4 — the laid-down tick docs have the target's test command / tmux session / repo root, and
//       grep finds NO quay-specific literals (scripts/test.sh, /home/yale/work/quay).
// AC5 — on a workspace where a laid-down tick doc was locally edited, a re-run does NOT overwrite
//       the local change and lists the conflict.
// AC2 — the test command detection ladder (scripts/test.sh → package.json scripts.test → go.mod →
//       Cargo.toml) detects each real project's convention and PRINTS it for human confirmation;
//       an explicit --test-command takes priority. (gap-cold-start-...-eight-steps AC2)
// AC3 — with no detection source, --loop FAILS CLOSED naming every location searched, never a
//       guessed default. (AC3 negative control)
// AC4 — a stale same-name mechanism file is residue: backed up + replaced + reported without
//       --force; localizable prose (tick docs) is NOT residue-cleaned (upgrade path preserved).
//       (AC4)
//
// Run:
//   scripts/test.sh plugin/test/quay-init-loop.test.mjs
//   node --test plugin/test/quay-init-loop.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

function makeTmp(prefix = 'quay-init-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function runInit(workspace, args = [], pluginRoot = pluginDir) {
  return spawnSync('bash', [path.join(pluginRoot, 'scripts', 'quay-init.sh'), ...args],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}

// ── AC3: dry-run lists would-copy; real run lays down the full set ─────────────────────────────────
test('AC3 — --loop --dry-run lists would-copy items for the full loop mechanism', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--dry-run', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /would-copy/, 'dry-run must report would-copy lines');
    assert.match(r.stdout, /orchestrator-loop-tick\.md/, 'dry-run must list the outer tick doc');
    assert.match(r.stdout, /fast-mode-loop-tick\.md/, 'dry-run must list the inner tick doc');
    assert.match(r.stdout, /fast-mode-telemetry\.ts/, 'dry-run must list the telemetry checker');
    assert.match(r.stdout, /resource-gate\.sh/, 'dry-run must list the resource gate');
    assert.match(r.stdout, /heavy-op-token\.sh/, 'dry-run must list the heavy-op token');
    // Dry-run must NOT write anything.
    assert.ok(!fs.existsSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md')), 'dry-run must not write files');
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh')), 'dry-run must not write files');
  } finally { cleanup(ws); }
});

test('AC3 — a real --loop run lays down the full two-layer mechanism set', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // 2 tick docs
    assert.ok(fs.existsSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md')), 'outer tick doc laid down');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'analysis', 'fast-mode-loop-tick.md')), 'inner tick doc laid down');
    // mechanism scripts
    const expectedScripts = [
      'fast-mode-telemetry.ts', 'inner-blocked-signal.ts', 'inner-forensics.mjs', 'inner-idle-log.ts',
      'inner-state.sh', 'loop-driver-check.sh', 'resource-gate.sh', 'heavy-op-token.sh', 'task-contract-check.ts',
      'task-status-drift-check.ts', 'touches-orthogonality-check.ts', 'concurrent-batch-scheduler.ts',
      'it0-split-or-commit-check.ts', 'pipe-exit-code-check.sh',
      // transitive deps of the checkers (the laid-down mechanism must be functional)
      'gate-script-base.ts', 'workflow-event-schema.mjs', 'task-schema.ts', 'touches-parser.ts',
      'wiring-coverage-check.ts',
    ];
    for (const s of expectedScripts) {
      assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', s)), `loop script must be laid down: plugin/scripts/${s}`);
    }
    // state file records the plugin version (upgrade path seed)
    assert.ok(fs.existsSync(path.join(ws, '.quay', 'quay-init-state.json')), 'state file must be written');
    const state = JSON.parse(fs.readFileSync(path.join(ws, '.quay', 'quay-init-state.json'), 'utf8'));
    assert.equal(typeof state.pluginVersion, 'string');
  } finally { cleanup(ws); }
});

// ── AC4: config-driven install (SPEC AC1-AC4) — byte-identical landing + negative control ───────────
// gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them: install no longer
// text-substitutes the tick docs. Every laid-down file is byte-identical to the product
// (AC1, cmp-checkable); the target values (repo_root/test_command/tmux_session) live in ONE
// config file (.quay/config.yml `loop:`, AC2) and are read at runtime, never baked in (AC3).
test('AC4 — laid-down tick docs are byte-identical to the product and carry NO target values (they live in .quay/config.yml loop:)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'myproj',
      '--test-command', 'npm test', '--tmux-session', 'myproj-0:0.0', '--repo-root', '/srv/target']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);

    // Byte-identical to the product (SPEC AC1) — the laid-down copy is VERBATIM.
    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    const inner = fs.readFileSync(path.join(ws, 'docs', 'analysis', 'fast-mode-loop-tick.md'), 'utf8');
    const outerSrc = fs.readFileSync(path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md'), 'utf8');
    const innerSrc = fs.readFileSync(path.join(pluginDir, 'loop', 'fast-mode-loop-tick.md'), 'utf8');
    assert.equal(outer, outerSrc, 'laid-down outer tick doc must be byte-identical to the product (AC1)');
    assert.equal(inner, innerSrc, 'laid-down inner tick doc must be byte-identical to the product (AC1)');
    const all = outer + '\n' + inner;

    // No target values baked in (SPEC AC3 — config-driven, not text-substitution).
    assert.ok(!all.includes('npm test'), 'laid-down tick docs must NOT contain the target test command (AC3)');
    assert.ok(!all.includes('/srv/target'), 'laid-down tick docs must NOT contain the target repo root (AC3)');
    assert.ok(!all.includes('myproj-0:0.0'), 'laid-down tick docs must NOT contain the target tmux session (AC3)');
    // No quay-specific literals either (the old substitution inputs are gone from the docs).
    assert.ok(!all.includes('scripts/test.sh'), 'laid-down tick docs must NOT contain scripts/test.sh (AC4 negative control)');
    assert.ok(!all.includes('/home/yale/work/quay'), 'laid-down tick docs must NOT contain the quay dev-tree root (AC8 negative control)');
    assert.ok(!all.includes('quay-0:0.0'), 'laid-down tick docs must NOT contain quay tmux session');

    // The target values live in ONE config file (.quay/config.yml `loop:`) — SPEC AC2.
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.match(cfg, /loop:/, 'config.yml must carry a loop: section (SPEC AC2)');
    assert.match(cfg, /repo_root:\s*\/srv\/target/, 'config.yml loop.repo_root must carry the target repo root');
    assert.match(cfg, /test_command:\s*npm test/, 'config.yml loop.test_command must carry the target test command');
    assert.match(cfg, /tmux_session:\s*myproj-0:0\.0/, 'config.yml loop.tmux_session must carry the target tmux session');

    // The mechanism scripts that used to carry quay literals are now self-locating.
    const innerState = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'inner-state.sh'), 'utf8');
    assert.ok(!innerState.includes('/home/yale/work/quay'), 'inner-state.sh must not carry a hardcoded quay root');
  } finally { cleanup(ws); }
});

test('AC3 — no detection source: --loop fails closed, naming every location it searched, without guessing a default', () => {
  const ws = makeTmp(); // empty — no scripts/test.sh, package.json, go.mod, or Cargo.toml
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 2, '--loop with no detectable test command must fail closed (exit 2)');
    assert.match(r.stderr, /--test-command/, 'failure must tell the human to pass --test-command explicitly');
    // AC3: the failure must say WHICH locations it searched (not just "no command found").
    for (const src of ['scripts/test.sh', 'package.json', 'go.mod', 'Cargo.toml']) {
      assert.ok(r.stderr.includes(src), `failure must name the searched detection source: ${src}`);
    }
    assert.match(r.stderr, /no universal default/, 'failure must state that no default is guessed');
  } finally { cleanup(ws); }
});

// ── AC2: the detection ladder (gap-cold-start-...-eight-steps) ──────────────────────────────────────
// Measured on three real projects, each on a different rung:
//   quay ⇒ scripts/test.sh → "bash scripts/test.sh"; archguard ⇒ package.json scripts.test → "npm test";
//   meta-cc ⇒ go.mod → "go test ./..."; Cargo.toml → "cargo test".
test('AC2 — detection ladder: scripts/test.sh is detected as bash scripts/test.sh (quay convention)', () => {
  const ws = makeTmp();
  try {
    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'scripts', 'test.sh'), '#!/bin/bash\necho test\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 0, `init with a detected test command must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected test command: bash scripts\/test\.sh/,
      'must print the detected command for the human to confirm (AC2: 显示给人确认)');
  } finally { cleanup(ws); }
});

test('AC2 — detection ladder: package.json scripts.test is detected as npm test (archguard convention)', () => {
  const ws = makeTmp();
  try {
    fs.writeFileSync(path.join(ws, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: { test: 'vitest run' } }, null, 2));
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected test command: npm test/,
      'must detect npm test from a package.json scripts.test entry');
    // Config-driven (SPEC AC2/AC3): the DETECTED command is written to .quay/config.yml
    // loop.test_command; the tick docs are byte-identical to the product and carry neither the
    // detected command nor the quay default.
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.match(cfg, /test_command:\s*npm test/, 'config.yml loop.test_command must carry the detected command');
    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    assert.ok(!outer.includes('npm test'), 'tick docs must NOT carry the detected command (config-driven, AC3)');
    assert.ok(!outer.includes('scripts/test.sh'), 'tick docs must NOT carry the quay default (AC3/AC4 negative control)');
  } finally { cleanup(ws); }
});

test('AC2 — detection ladder: go.mod is detected as go test ./... (meta-cc convention)', () => {
  const ws = makeTmp();
  try {
    fs.writeFileSync(path.join(ws, 'go.mod'), 'module example.com/proj\n\ngo 1.22\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected test command: go test \.\/\.\.\./,
      'must detect go test ./... from a go.mod file');
  } finally { cleanup(ws); }
});

test('AC2 — detection ladder: Cargo.toml is detected as cargo test', () => {
  const ws = makeTmp();
  try {
    fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "proj"\nversion = "0.1.0"\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected test command: cargo test/,
      'must detect cargo test from a Cargo.toml file');
  } finally { cleanup(ws); }
});

test('AC2 — an explicit --test-command takes priority over detection', () => {
  const ws = makeTmp();
  try {
    // The workspace WOULD detect npm test; the explicit flag must win.
    fs.writeFileSync(path.join(ws, 'package.json'),
      JSON.stringify({ name: 'proj', scripts: { test: 'vitest run' } }, null, 2));
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /using explicit --test-command: node --test/,
      'must report the explicit command');
    assert.ok(!/detected test command/.test(r.stdout),
      'an explicit --test-command must suppress the detection ladder');
    // Config-driven (SPEC AC2/AC3): the explicit command is written to config.yml loop.test_command;
    // the tick docs are generic.
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.match(cfg, /test_command:\s*node --test/, 'config.yml loop.test_command must carry the explicit command');
    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    assert.ok(!outer.includes('npm test'), 'tick docs must NOT carry a detected command when explicit wins');
  } finally { cleanup(ws); }
});

// ── AC4: residue cleanup merged into the install (gap-cold-start-...-eight-steps) ───────────────────
// A same-name-different-content PRODUCT file is a stale hot-copy leftover (residue). The install
// must dispose of it VISIBLY — back it up, replace it with the product content, report both — and
// must NOT require a separate `git rm` step nor a --force flag. Localizable prose (tick docs) stays
// preserve-mode: a local edit is a conflict, listed and left untouched (upgrade path, AC5).
test('AC4 — a stale same-name mechanism file is residue: backed up, replaced, and reported (no --force needed)', () => {
  const ws = makeTmp();
  try {
    // Pre-place a stale copy of a product mechanism file (a hot-copy leftover) with different content.
    fs.mkdirSync(path.join(ws, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh'), '#!/bin/bash\necho stale-residue\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must succeed after disposing of the residue:\n${r.stderr}`);
    assert.match(r.stdout, /cleaned-residue/, 'must report the residue cleanup visibly');
    assert.match(r.stdout, /backup:/, 'must report where the backup went');
    // The stale file is replaced with the product content (byte-identical to the plugin source).
    const installed = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh'), 'utf8');
    const source = fs.readFileSync(path.join(pluginDir, 'scripts', 'resource-gate.sh'), 'utf8');
    assert.equal(installed, source, 'residue must be replaced with the product content');
    // The backup exists and preserves the stale content.
    const backupsDir = path.join(ws, '.quay', 'quay-init-backups');
    assert.ok(fs.existsSync(backupsDir), 'a backup directory must exist');
    const backupFiles = fs.readdirSync(backupsDir, { recursive: true })
      .filter((p) => typeof p === 'string' && p.endsWith('resource-gate.sh'));
    assert.ok(backupFiles.length > 0, 'a backup of the stale file must exist');
    const backupPath = path.join(backupsDir, backupFiles[0]);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '#!/bin/bash\necho stale-residue\n',
      'the backup must preserve the stale content (nothing silently lost)');
    // The AC6 verify check still passes (installed executables byte-identical to the product).
    assert.match(r.stdout, /verify-installed-executables: OK/, 'the byte-identical check must pass after residue cleanup');
  } finally { cleanup(ws); }
});

test('AC4 — localizable files (tick docs) are NOT residue-cleaned: a local edit survives without --force', () => {
  const ws = makeTmp();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test'];
    const r1 = runInit(ws, args);
    assert.equal(r1.status, 0, `first init must exit 0:\n${r1.stderr}`);
    const outerPath = path.join(ws, 'orchestration', 'orchestrator-loop-tick.md');
    const firstContent = fs.readFileSync(outerPath, 'utf8');
    // A project's own customization of a laid-down tick doc.
    fs.writeFileSync(outerPath, firstContent + '\n<!-- local customisation -->\n', 'utf8');
    const r2 = runInit(ws, args);
    assert.equal(r2.status, 0, `re-run must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /CONFLICT/, 'the local tick-doc edit is reported as a conflict');
    assert.ok(!r2.stdout.includes('cleaned-residue'),
      'tick docs (prose, localizable) must NOT be residue-cleaned');
    const after = fs.readFileSync(outerPath, 'utf8');
    assert.ok(after.includes('local customisation'), 'the local edit must survive (upgrade path)');
    assert.equal(after, firstContent + '\n<!-- local customisation -->\n', 'the local edit must be byte-preserved');
  } finally { cleanup(ws); }
});

// ── AC5: upgrade path — idempotent re-run; local edits not overwritten, conflict listed ─────────────
test('AC5 — re-run is idempotent (skips identical), and a locally-edited tick doc is NOT overwritten; the conflict is listed', () => {
  const ws = makeTmp();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test'];
    const r1 = runInit(ws, args);
    assert.equal(r1.status, 0, `first init must exit 0:\n${r1.stderr}`);
    const outerPath = path.join(ws, 'orchestration', 'orchestrator-loop-tick.md');
    const firstContent = fs.readFileSync(outerPath, 'utf8');

    // Second run: everything identical → skipped, nothing changed.
    const r2 = runInit(ws, args);
    assert.equal(r2.status, 0, `second init must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /skipped \(identical\)/, 're-run must skip identical files');
    assert.equal(fs.readFileSync(outerPath, 'utf8'), firstContent, 'second run must not modify the laid-down tick doc');

    // Local edit: simulate the target project customizing its outer tick doc.
    fs.writeFileSync(outerPath, firstContent + '\n<!-- local customisation -->\n', 'utf8');

    // Third run: the local change must SURVIVE (conflict listed, not overwritten).
    const r3 = runInit(ws, args);
    assert.equal(r3.status, 0, `third init must exit 0:\n${r3.stderr}`);
    assert.match(r3.stdout, /CONFLICT/, 're-run must report the conflict for the locally-edited tick doc');
    const after = fs.readFileSync(outerPath, 'utf8');
    assert.ok(after.includes('local customisation'), 'local edit must NOT be overwritten (upgrade path preserves local changes)');
    assert.equal(after, firstContent + '\n<!-- local customisation -->\n', 'the local edit must be byte-preserved');
  } finally { cleanup(ws); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-quay-init-rewrites-an-executable-instead-of-generating-config
// 可执行文件一律原样复制，只生成配置；散文可以本地化，代码不行。
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// AC1/AC2 — session-liveness.sh is laid down VERBATIM (cp, not render_substitutions); the
// per-project session is CONFIG, generated into orchestration/session-liveness.env.
test('AC1/AC2 — session-liveness.sh is copied verbatim; the session is generated config, not a script rewrite', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const src = fs.readFileSync(path.join(pluginDir, 'scripts', 'session-liveness.sh'), 'utf8');
    const installed = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'session-liveness.sh'), 'utf8');
    assert.equal(installed, src, 'installed session-liveness.sh must be byte-identical to its source (cp, not render)');
    assert.ok(!installed.includes('__QUAY_TMUX_SESSION__'), 'the placeholder must not exist (AC1)');
    const envFile = fs.readFileSync(path.join(ws, 'orchestration', 'session-liveness.env'), 'utf8');
    assert.match(envFile, /SESSION_TMUX_SESSION=proj-0:0\.0/, 'the --tmux-session value must be written to the generated config');
    assert.ok(!installed.includes('proj-0'), 'the script itself must NOT carry the target session (config, not code)');
  } finally { cleanup(ws); }
});

// AC2 — no render_substitutions call in quay-init.sh acts on an executable: grep shows the script
// is only ever passed to copy_one. (The two remaining render_substitutions calls are tick docs.)
test('AC2 — quay-init.sh has no render_substitutions call targeting session-liveness.sh', () => {
  const initSrc = fs.readFileSync(path.join(pluginDir, 'scripts', 'quay-init.sh'), 'utf8');
  // The render_substitutions call sites must not reference the executable.
  assert.ok(!initSrc.includes('render_substitutions "$sl_src"'),
    'quay-init.sh must not render the session-liveness.sh executable');
  // The executable path is only ever copied verbatim.
  assert.ok(initSrc.includes('copy_one "$sl_src" "$sl_dst"'),
    'quay-init.sh must copy session-liveness.sh via copy_one (cp)');
});

// AC6 — the mechanical check runs as part of quay-init --loop and passes on a clean install.
test('AC6 — verify-installed-executables.sh runs inside quay-init --loop and passes (byte-identical executables)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-installed-executables: OK/, 'quay-init must run the AC6 check and report OK');
    // Standalone re-run, matching what cold-start-e2e does.
    const v = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.equal(v.status, 0, `verify must exit 0:\n${v.stderr}`);
    assert.match(v.stdout, /byte-identical/, 'verify must report the byte-identical invariant');
  } finally { cleanup(ws); }
});

// AC4 — bidirectional negative control: flip one byte in an installed executable ⇒ the check FAILS
// naming it; restore ⇒ the check PASSES again. A check that only ever reports "same" is the bug.
test('AC4 — the check fails when an installed executable drifts by one byte, and passes after restore', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const installed = path.join(ws, 'plugin', 'scripts', 'session-liveness.sh');
    // fail direction: simulate a future render path rewriting the installed executable by one byte.
    const buf = fs.readFileSync(installed);
    buf[0] ^= 0x01;
    fs.writeFileSync(installed, buf);
    const v = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.notEqual(v.status, 0, 'verify must FAIL when an installed executable drifts by one byte');
    assert.match(v.stderr, /session-liveness\.sh/, 'the failure must name the drifted file');
    // restore direction.
    buf[0] ^= 0x01;
    fs.writeFileSync(installed, buf);
    const v2 = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.equal(v2.status, 0, 'verify must PASS after restore (AC4 restore direction)');
  } finally { cleanup(ws); }
});

// ── AC7b: lay the runtime into the target + PATH-independent provider config ─────────────────────────
// gap-cold-start-...-eight-steps: the cold-started loop must NOT depend on the quay dev tree via
// PATH symlinks (quay-native → /home/yale/work/quay/packages/quay-native/dist/).
test('AC7b — --loop writes a .quay/config.yml whose provider mcp_entry is project-local absolute (never a PATH-resolved quay-native)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const cfg = path.join(ws, '.quay', 'config.yml');
    assert.ok(fs.existsSync(cfg), '--loop must write a .quay/config.yml for a config-less target (AC7b)');
    const src = fs.readFileSync(cfg, 'utf8');
    // The provider's mcp_entry must be an absolute project-local path, not a bare `quay-native`.
    assert.ok(src.includes('mcp_entry'), 'config must declare the provider mcp_entry');
    assert.ok(src.includes(ws), 'config must reference the target project by absolute path');
    // Negative control: the COMMAND element must never be the bare `quay-native` (which PATH-resolves
    // to the dev-tree symlink). It must be an absolute path into the target.
    assert.ok(!/mcp_entry: \["node", "quay-native", "mcp"\]/.test(src),
      'config must not PATH-resolve a bare quay-native command — that is the dev-tree symlink dependency (AC7b negative control)');
    assert.match(src, /mcp_entry: \["node", "\/[^"]*\/packages\/quay-native\/bin\/quay-native\.ts", "mcp"\]/,
      'the mcp_entry command must be an absolute project-local path into the laid-down runtime');
    assert.ok(src.includes('QUAY_NATIVE_TASKS_DIR'), 'config must set the native tasks dir');
  } finally { cleanup(ws); }
});

test('AC7b — when the plugin has no built runtime bundle, --loop warns (does not fail) and still writes the config', () => {
  // Construct the no-bundle scenario deterministically: a temp COPY of the plugin with
  // vendor/quay/dist/quay.js removed. The real pluginDir may have a bundle (the full suite
  // builds dist into it), so the test must not depend on ambient build state.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'vendor', 'quay', 'dist', 'quay.js'), { force: true });
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--plugin-root', src]);
      assert.equal(r.status, 0, `init must exit 0 even without a built runtime:\n${r.stderr}`);
      assert.match(r.stderr, /WARN:.*vendor\/quay\/dist\/quay\.js/, 'must warn that the runtime bundle is absent');
      assert.ok(fs.existsSync(path.join(ws, '.quay', 'config.yml')), 'config must still be written');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC7b — a plugin source WITH a built runtime lays it into the target (project-local copy)', () => {
  // Use a temp COPY of the plugin + a fake built bundle, so the real worktree is never polluted.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--plugin-root', src]);
      assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
      assert.match(r.stdout, /vendor\/quay\/dist\/quay\.js/, 'must report the runtime lay-down');
      const laid = path.join(ws, 'vendor', 'quay', 'dist', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fake built quay.js bundle\n',
        'the laid-down runtime must be byte-identical to the plugin source');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-the-tick-doc-ships-three-contradictory-loop-drivers
// 外层 tick 文档只声明一个循环驱动（CronCreate）；另外两个（ScheduleWakeup / /loop Nm）被显式处置。
// 双触发/不触发用 loop-driver-check.sh 机械检出（AC4/AC5/AC6）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const TICK_DOC = path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md');
const DRIVER_TOKENS = ['CronCreate', 'ScheduleWakeup'];
const LOOP_NM_RE = /\/loop\s+[0-9]+m/;

function distinctDriverMechanisms(text) {
  const mechs = new Set(DRIVER_TOKENS.filter((t) => text.includes(t)));
  if (LOOP_NM_RE.test(text)) mechs.add('loop-interval');
  return mechs;
}

// ── AC1: the doc declares exactly ONE loop-driving mechanism ────────────────────────────────────────
test('AC1 — the outer tick doc declares exactly ONE loop-driving mechanism (CronCreate)', () => {
  const src = fs.readFileSync(TICK_DOC, 'utf8');
  assert.deepEqual([...distinctDriverMechanisms(src)].sort(), ['CronCreate'],
    'the outer tick doc must declare exactly one driver mechanism: CronCreate. ScheduleWakeup and /loop Nm are banned (AC1 band=1)');
});

test('AC1 (laid-down) — the rendered outer tick doc also declares exactly one driver after substitution', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    assert.deepEqual([...distinctDriverMechanisms(outer)].sort(), ['CronCreate'],
      'the laid-down outer tick doc must also declare exactly one driver (the negative control survives shipping)');
    assert.ok(outer.includes('loop-driver-check.sh'), 'the laid-down doc must reference the single-driver check');
  } finally { cleanup(ws); }
});

test('AC1 (skill) — the cold-start skill\'s only driver is CronCreate and it enforces the single-driver check', () => {
  const skill = fs.readFileSync(path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('CronCreate'), 'the skill re-creates the cron via CronCreate');
  assert.ok(!skill.includes('ScheduleWakeup'), 'the skill must NOT instruct ScheduleWakeup (AC3 dispose)');
  assert.ok(!LOOP_NM_RE.test(skill), 'the skill must NOT instruct a /loop Nm invocation (AC3 dispose)');
  assert.match(skill, /loop-driver-check\.sh/, 'the skill must run the single-driver check');
  assert.match(skill, /LIVE/, 'the skill must require the check to report LIVE');
  assert.match(skill, /double-trigger/i, 'the skill must name the double-trigger it prevents');
});

// ── AC4/AC5/AC6: loop-driver-check.sh — LIVE / DOUBLE-TRIGGER / STALLED ──────────────────────────────
const driverReg = (ws) => path.join(ws, '.quay', 'loop-driver.jsonl');
function writeDriver(ws, mech = 'cron', interval = '*/20 * * * *') {
  fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
  fs.appendFileSync(driverReg(ws), JSON.stringify({ mechanism: mech, interval, source: 'cold-start' }) + '\n', 'utf8');
}
function runDriverCheck(ws) {
  return spawnSync('bash', [path.join(ws, 'plugin', 'scripts', 'loop-driver-check.sh'), ws],
    { cwd: ws, encoding: 'utf8' });
}

test('AC4 — loop-driver-check.sh is laid down by quay-init --loop', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'loop-driver-check.sh')),
      'loop-driver-check.sh must be laid down with the loop mechanism');
  } finally { cleanup(ws); }
});

test('AC6 — zero drivers = STALLED (the loop will never tick), exit 3', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const c = runDriverCheck(ws);
    assert.equal(c.status, 3, `no driver must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED, not "all normal"');
  } finally { cleanup(ws); }
});

test('AC4 — exactly one cron driver = LIVE, exit 0 (end-to-end: one trigger source)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    writeDriver(ws, 'cron');
    const c = runDriverCheck(ws);
    assert.equal(c.status, 0, `one cron driver must be LIVE (exit 0), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /LIVE/, 'must report LIVE');
    assert.match(c.stdout, /\(1\)/, 'must report count 1');
  } finally { cleanup(ws); }
});

test('AC5 — a second driver = DOUBLE-TRIGGER, exit 4 (double-trigger negative control)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    writeDriver(ws, 'cron');          // step 4: CronCreate
    writeDriver(ws, 'loop');          // §4a relapse: a second /loop driver
    const c = runDriverCheck(ws);
    assert.equal(c.status, 4, `two drivers must be DOUBLE-TRIGGER (exit 4), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /DOUBLE-TRIGGER/, 'must report DOUBLE-TRIGGER');
  } finally { cleanup(ws); }
});

test('AC6 (remove direction) — removing the only driver is detected as STALLED, not "all normal"', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    writeDriver(ws, 'cron');
    assert.equal(runDriverCheck(ws).status, 0, 'precondition: one driver is LIVE');
    fs.rmSync(driverReg(ws), { force: true });
    const c = runDriverCheck(ws);
    assert.equal(c.status, 3, `removing the only driver must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED — silence is exactly what the non-trigger control forbids');
  } finally { cleanup(ws); }
});

test('AC3 — a disposed mechanism cannot become the sole driver (BANNED-MECHANISM, exit 5)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    writeDriver(ws, 'wakeup');        // the disposed self-paced wakeup as the only driver
    const c = runDriverCheck(ws);
    assert.equal(c.status, 5, `a non-cron sole driver must be BANNED-MECHANISM (exit 5), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /BANNED-MECHANISM/, 'must report BANNED-MECHANISM');
  } finally { cleanup(ws); }
});
