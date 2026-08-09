// @test-group serial
// @load-sensitive nested-spawn
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion): routed to the `serial` group
// because it IS a nested runner — each --loop test spawns a real quay-init.sh → `$TEST_COMMAND`
// (node --test) worker-pool sub-suite, which derives its own concurrency N (18 nested-runner
// matches, per the manager audit). Per the explicit serial criterion (fast-mode-loop-tick.md), the
// ONLY reason to enter serial is spawning your own worker-pool sub-suite; this file runs in the
// concurrency-1 serial phase, never competing with the concurrency-8 main body's worker pool.
// quay-init-loop-core.test.mjs — split out of quay-init-loop.test.mjs (2026-08-07 inner red-window
// fix). The original 54-test single file exhausted the node:test worker event loop under heavy
// blocking spawnSync (each --loop test spawns a real quay-init.sh → python3 children), self-failing
// at ~167s with 'Promise resolution is still pending'. Each split file keeps < ~19 tests, under the
// exhaustion threshold. Shared helpers live in quay-init-loop-helpers.mjs.
// gap-quay-init-laydown-dominant-red-suite-blocker root-cause verdict 2026-08-07.
//
// gap-serial-phase-install-test-residue-dependency (serial-phase ordering residue): this file is a
// SECOND runner in the round-161 ordering dependency (install-config-driven-e2e passed first, then
// this file's AC2 "init must exit 0" + AC4 "tick docs must NOT be residue-cleaned" failed). Its
// installs were NOT the residue source — every --loop run here already gets a UNIQUE disk worktree
// root (quay-init-loop-helpers.runInit injects --worktree-root diskWorktreeRoot()) and a
// fresh makeTmp/laydownWorkspace per test. The residue came from the FIRST runner's shared default
// namespace (the fixed sibling-of-repo worktree root + the fixed tmux session `proj-0:0.0`), which
// packages/quay/test/install-config-driven-e2e.test.mjs now isolates (unique --worktree-root per
// install + per-workspace tmux session + after() cleanup). Isolation contract for this file: keep
// every install's env namespace independent (unique worktree root via helpers, per-test workspace),
// and do NOT re-introduce a fixed cross-file tmux session as the shared default — `proj-0:0.0`
// below is now EXCLUSIVE to this loop family (no other install test targets it).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, diskWorktreeRoot, runInit, extractRefs, declaredSet, pluginDir, laydownWorkspace } from "./quay-init-loop-helpers.mjs";

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
    // The manager driver tick doc (orchestration/manager-loop-tick.md) is NOT laid down by the
    // current quay-init — the manager-layer propagation (gap-the-manager-layer-does-not-propagate-
    // quay-init-lays-no-manager-driver, status: ready) is a PENDING task; the rolled-back merge
    // (7642849a) briefly had it. Re-instate this assertion when that task lands.
    assert.match(r.stdout, /fast-mode-telemetry\.ts/, 'dry-run must list the telemetry checker');
    assert.match(r.stdout, /resource-gate\.sh/, 'dry-run must list the resource gate');
    assert.ok(!/heavy-op-token\.sh/.test(r.stdout),
      'dry-run must NOT list heavy-op-token.sh (retired 2026-08-06 — the "one heavy test at a time" token is gone)');
    // Dry-run must NOT write anything.
    assert.ok(!fs.existsSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md')), 'dry-run must not write files');
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh')), 'dry-run must not write files');
  } finally { cleanup(ws); }
});

test('AC3 — a real --loop run lays down the full two-layer mechanism set', () => {
  // AC2 (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles): runs from the
  // shared READ-ONLY laydown template (one real quay-init --loop per FILE process) — the laid-down
  // state is byte-identical, so the mechanism-set assertions are unchanged.
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // 2 tick docs (outer + inner). The manager driver tick doc (orchestration/manager-loop-tick.md)
    // is NOT laid down by the current quay-init — the manager-layer propagation
    // (gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver, status: ready) is a
    // PENDING task; the rolled-back merge (7642849a) briefly had it. Re-instate the 3rd assertion when
    // that task lands.
    assert.ok(fs.existsSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md')), 'outer tick doc laid down');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'analysis', 'fast-mode-loop-tick.md')), 'inner tick doc laid down');
    // mechanism scripts (inner-state.sh is deliberately NOT here — retired,
    // gap-retire-inner-state-one-observer-targets-by-parameter AC3; observation ships as
    // session-liveness.sh via the separate session-liveness section below).
    const expectedScripts = [
      'fast-mode-telemetry.ts', 'inner-blocked-signal.ts', 'inner-forensics.mjs', 'inner-idle-log.ts',
      'loop-driver-check.sh', 'resource-gate.sh', 'task-contract-check.ts',
      'task-status-drift-check.ts', 'touches-orthogonality-check.ts', 'concurrent-batch-scheduler.ts',
      'it0-split-or-commit-check.ts', 'pipe-exit-code-check.sh',
      // transitive deps of the checkers (the laid-down mechanism must be functional)
      'gate-script-base.ts', 'workflow-event-schema.mjs', 'task-schema.ts', 'touches-parser.ts',
      'wiring-coverage-check.ts',
      // dependency-closure regression (gap-laydown-derivation-is-sensitive-to-reference-spelling-
      // dependency-closure AC1): the bare-name-referenced checker of send-keys-reliable.sh must ship
      'transcript-delivery-check.ts',
    ];
    for (const s of expectedScripts) {
      assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', s)), `loop script must be laid down: plugin/scripts/${s}`);
    }
    // The retired monitor must NOT be laid down into new target projects (AC3).
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'inner-state.sh')),
      'inner-state.sh must NOT be laid down into new target projects (retired, AC3)');
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'session-liveness.sh')),
      'session-liveness.sh — the ONE observer — must be laid down');
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
    // The manager driver tick doc (orchestration/manager-loop-tick.md) is NOT laid down by the
    // current quay-init — the manager-layer propagation (gap-the-manager-layer-does-not-propagate-
    // quay-init-lays-no-manager-driver, status: ready) is a PENDING task; the rolled-back merge
    // (7642849a) briefly had it. Re-instate the manager byte-identity assertion when that task lands.
    const all = outer + '\n' + inner;

    // No target values baked in (SPEC AC3 — config-driven, not text-substitution).
    assert.ok(!all.includes('npm test'), 'laid-down tick docs must NOT contain the target test command (AC3)');
    assert.ok(!all.includes('/srv/target'), 'laid-down tick docs must NOT contain the target repo root (AC3)');
    assert.ok(!all.includes('myproj-0:0.0'), 'laid-down tick docs must NOT contain the target tmux session (AC3)');
    // No quay-specific literals either (the old substitution inputs are gone from the docs).
    // AC4 (b53f7402/gap-load-sensitive-session-family-confounds-step-three): the SHIPPED
    // fast-mode-loop-tick.md carries a KNOWN-LOAD-SENSITIVE annotation naming the load-sensitive
    // family via the CONFIG-DRIVEN generic name `$TEST_COMMAND` (gap-full-suite-belongs-to-outer-
    // background reframed the literal `scripts/test.sh` → `$TEST_COMMAND`: the config-driven doc
    // must not name the quay-repo-specific path, and the inner side greps `scripts/test.sh` to 0).
    // The byte-identity assertion above already pins the laid-down doc to the product. The negative
    // control's intent is unchanged — a config-driven install must not BAKED-IN target values — so
    // the annotation must name the family's test files via the generic command, never a bare value,
    // and the repo-specific `scripts/test.sh` literal must not appear anywhere in the docs.
    const klsLines = all.split('\n').filter((l) => l.includes('KNOWN-LOAD-SENSITIVE'));
    const familyCmdLines = all.split('\n')
      .filter((l) => l.includes('$TEST_COMMAND')
        && (l.includes('session-liveness-events.test.mjs') || l.includes('session-liveness.test.mjs'))
        && l.includes('cold-start-skill.test.mjs'));
    assert.ok(klsLines.length > 0,
      'the shipped tick doc must carry the KNOWN-LOAD-SENSITIVE marker (b53f7402)');
    assert.ok(familyCmdLines.length > 0,
      'the KNOWN-LOAD-SENSITIVE baseline annotation must invoke the load-sensitive family via $TEST_COMMAND');
    assert.ok(!all.includes('scripts/test.sh'),
      'laid-down tick docs must NOT name the quay-repo-specific scripts/test.sh (config-driven; full-suite-to-outer reframe)');
    assert.ok(!all.includes('/home/yale/work/quay'), 'laid-down tick docs must NOT contain the quay dev-tree root (AC8 negative control)');
    assert.ok(!all.includes('quay-0:0.0'), 'laid-down tick docs must NOT contain quay tmux session');

    // The target values live in ONE config file (.quay/config.yml `loop:`) — SPEC AC2.
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.match(cfg, /loop:/, 'config.yml must carry a loop: section (SPEC AC2)');
    assert.match(cfg, /repo_root:\s*\/srv\/target/, 'config.yml loop.repo_root must carry the target repo root');
    assert.match(cfg, /test_command:\s*npm test/, 'config.yml loop.test_command must carry the target test command');
    assert.match(cfg, /tmux_session:\s*myproj-0:0\.0/, 'config.yml loop.tmux_session must carry the target tmux session');

    // The mechanism scripts that used to carry quay literals are now self-locating. The retired
    // inner-state.sh is NOT laid down at all (AC3) — the ONE observer session-liveness.sh is.
    const liveness = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'session-liveness.sh'), 'utf8');
    assert.ok(!liveness.includes('/home/yale/work/quay'), 'session-liveness.sh must not carry a hardcoded quay root');
    assert.ok(!fs.existsSync(path.join(ws, 'plugin', 'scripts', 'inner-state.sh')),
      'inner-state.sh must not be laid down (retired, AC3)');
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected test command: go test \.\/\.\.\./,
      'must detect go test ./... from a go.mod file');
  } finally { cleanup(ws); }
});

test('AC2 — detection ladder: Cargo.toml is detected as cargo test', () => {
  const ws = makeTmp();
  try {
    fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "proj"\nversion = "0.1.0"\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
  // AC2: the copy starts from the shared READ-ONLY laydown template (already fully installed);
  // pre-placing a stale product file and RE-RUNNING init exercises the residue-cleanup path
  // (the re-run emits the cleaned-residue/backup report and the byte-identical verify).
  const { ws } = laydownWorkspace();
  try {
    // Pre-place a stale copy of a product mechanism file (a hot-copy leftover) with different content.
    fs.writeFileSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh'), '#!/bin/bash\necho stale-residue\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
  const { ws, install: r1 } = laydownWorkspace();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];
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
  const { ws, install: r1 } = laydownWorkspace();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];
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

