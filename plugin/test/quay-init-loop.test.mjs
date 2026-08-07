// @test-group product
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

import { test, after } from 'node:test';
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

// A worktree root the validation will ACCEPT: a real disk path, not tmpfs. /tmp is tmpfs on dev
// boxes (and the whole point of gap-the-shipped-tick-doc-... is that worktrees must NOT live
// there), so the sibling-of-repo default would resolve to /tmp for a /tmp-backed test workspace
// and quay-init would correctly fail closed. /var/tmp is the disk-backed tmp on Linux; prefer it.
// The dirs land in a carrier array cleaned by an after() hook (the doc-store/adr-store pattern),
// so R6 does not read the helper-return as an uncovered mkdtemp leak.
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

function runInit(workspace, args = [], pluginRoot = pluginDir) {
  // --loop tests now need an explicit disk worktree root (the default sibling-of-repo of a /tmp
  // test workspace is tmpfs and is correctly rejected). Inject one BEFORE the caller's args so an
  // explicit --worktree-root in args wins (last flag wins in the parser).
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  return spawnSync('bash', [path.join(pluginRoot, 'scripts', 'quay-init.sh'), ...extra, ...args],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}

// ── gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down helpers ────────────────────────────
// extractRefs(pluginRoot, prefix): every `<prefix>/<file>` reference in the shipped skills + tick
// docs — the SAME extraction quay-init.sh's verify_referenced_landed uses, so the test's landing
// assertion and the installer's own check cannot disagree about what the referenced set is.
function extractRefs(pluginRoot, prefix) {
  const files = [];
  for (const d of fs.readdirSync(path.join(pluginRoot, 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginRoot, 'skills', d.name, 'SKILL.md');
    if (fs.existsSync(f)) files.push(f);
  }
  const loopDir = path.join(pluginRoot, 'loop');
  for (const f of fs.readdirSync(loopDir)) {
    if (f.endsWith('.md')) files.push(path.join(loopDir, f));
  }
  const re = new RegExp(`(?:${prefix})/[a-zA-Z0-9._-]+`, 'g');
  const refs = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) refs.add(m[0]);
  }
  return [...refs].sort();
}

// declaredSet(pluginRoot, kind): the machine-readable `<!-- <kind>: <path> -->` declarations in
// plugin/skills/init/SKILL.md — `self-create` (local-state files the first run creates, AC8) and
// `reference-doc` (quay-specific template prose, not a loop-mechanism deliverable).
function declaredSet(pluginRoot, kind) {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'init', 'SKILL.md'), 'utf8');
  const re = new RegExp(`<!-- ${kind}: ([a-zA-Z0-9._/-]+) -->`, 'g');
  const set = new Set();
  let m;
  while ((m = re.exec(skill)) !== null) set.add(m[1]);
  return set;
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
    assert.match(r.stdout, /manager-loop-tick\.md/,
      'dry-run must list the manager driver tick doc (gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver)');
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
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj',
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // 3 tick docs (outer + inner + manager driver)
    assert.ok(fs.existsSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md')), 'outer tick doc laid down');
    assert.ok(fs.existsSync(path.join(ws, 'docs', 'analysis', 'fast-mode-loop-tick.md')), 'inner tick doc laid down');
    assert.ok(fs.existsSync(path.join(ws, 'orchestration', 'manager-loop-tick.md')),
      'manager driver tick doc laid down (gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver)');
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
    const manager = fs.readFileSync(path.join(ws, 'orchestration', 'manager-loop-tick.md'), 'utf8');
    const outerSrc = fs.readFileSync(path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md'), 'utf8');
    const innerSrc = fs.readFileSync(path.join(pluginDir, 'loop', 'fast-mode-loop-tick.md'), 'utf8');
    const managerSrc = fs.readFileSync(path.join(pluginDir, 'loop', 'manager-loop-tick.md'), 'utf8');
    assert.equal(outer, outerSrc, 'laid-down outer tick doc must be byte-identical to the product (AC1)');
    assert.equal(inner, innerSrc, 'laid-down inner tick doc must be byte-identical to the product (AC1)');
    assert.equal(manager, managerSrc,
      'laid-down manager driver tick doc must be byte-identical to the product (AC1) — the manager DRIVER ships as a generic per-project template');
    const all = outer + '\n' + inner + '\n' + manager;

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
        && l.includes('session-liveness.test.mjs') && l.includes('cold-start-skill.test.mjs'));
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
  const ws = makeTmp();
  try {
    // Pre-place a stale copy of a product mechanism file (a hot-copy leftover) with different content.
    fs.mkdirSync(path.join(ws, 'plugin', 'scripts'), { recursive: true });
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
  const ws = makeTmp();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];
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
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
    // The command must be an absolute project-local path into the laid-down SELF-CONTAINED native
    // provider bundle (.quay/runtime/bin/quay-native.js) — the runtime quay-init actually lays
    // down (gap-ac3b-prove-installed-quay-runs-without-dev-tree). The landing dir is .quay/runtime/
    // (quay's own namespace, never vendor/ — gap-the-runtime-has-nowhere-safe-to-land AC9). It must
    // NOT reference a bin/quay-native.ts source file that needs a node_modules quay/yaml/zod/sdk
    // (not laid down).
    assert.match(src, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
      'the mcp_entry command must be an absolute project-local path into the laid-down provider runtime (self-contained bundle)');
    assert.ok(src.includes('QUAY_NATIVE_TASKS_DIR'), 'config must set the native tasks dir');
  } finally { cleanup(ws); }
});

test('AC1 — when the plugin has no built runtime bundles and auto-build cannot produce them, --loop FAILS CLOSED (exit non-zero, no complete)', () => {
  // Construct the no-bundle scenario deterministically: a temp COPY of the plugin with the Core
  // and native provider bundles removed (fresh-clone state — dist/ is gitignored). The real
  // pluginDir may have bundles (the full suite builds dist into it), so the test must not depend
  // on ambient build state. sync-vendor.sh is stubbed to FAIL deterministically, modelling an
  // auto-build that cannot produce the runtime (no packages/quay source tree in an installed
  // plugin cache). AC1 negative control: the pre-fix code WARNED and reported complete anyway.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'vendor', 'quay', 'dist', 'quay.js'), { force: true });
    fs.rmSync(path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js'), { force: true });
    // Deterministic build failure (the real sync-vendor.sh in a plugin-only copy would fail on
    // the missing packages/quay source tree, but that depends on the ambient parent dir — a stub
    // pins the failure mode).
    const syncStub = path.join(src, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, '#!/usr/bin/env bash\necho "[stub sync-vendor] cannot build: no source tree" >&2\nexit 1\n', 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.notEqual(r.status, 0, 'init must FAIL CLOSED (exit non-zero) when the vendor runtime is missing and auto-build cannot produce it');
      assert.doesNotMatch(r.stdout, /quay-init complete/, 'must NOT report complete with a broken mcp_entry (AC1 negative control)');
      assert.match(r.stderr, /vendor\/quay\/dist\/quay\.js/, 'must name the missing Core runtime bundle');
      assert.match(r.stderr, /vendor\/quay-native\/dist\/quay-native\.js/, 'must name the missing native provider runtime bundle');
      assert.match(r.stderr, /FAILS CLOSED/, 'the error must state the fail-closed resolution');
      assert.ok(!fs.existsSync(path.join(ws, '.quay', 'config.yml')),
        'must NOT write a config whose mcp_entry points at a missing runtime (the fail-closed fires before write_provider_config)');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC7b — a plugin source WITH built runtimes lays them into the target (project-local copies, config points at the native bundle)', () => {
  // Use a temp COPY of the plugin + fake built bundles, so the real worktree is never polluted.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    const fakeProviderYml = path.join(src, 'vendor', 'quay-native', 'provider.yml');
    fs.writeFileSync(fakeProviderYml, 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
      assert.match(r.stdout, /\.quay\/runtime\/bin\/quay\.js/, 'must report the Core runtime lay-down');
      assert.match(r.stdout, /\.quay\/runtime\/bin\/quay-native\.js/, 'must report the native provider runtime lay-down');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the Core runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fake built quay.js bundle\n',
        'the laid-down Core runtime must be byte-identical to the plugin source');
      const laidNative = path.join(ws, '.quay', 'runtime', 'bin', 'quay-native.js');
      assert.ok(fs.existsSync(laidNative), 'the native provider runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laidNative, 'utf8'), '// fake built quay-native.js bundle\n',
        'the laid-down native runtime must be byte-identical to the plugin source');
      const laidProviderYml = path.join(ws, '.quay', 'runtime', 'provider.yml');
      assert.ok(fs.existsSync(laidProviderYml), 'provider.yml must be laid into the target project');
      assert.equal(fs.readFileSync(laidProviderYml, 'utf8'), 'id: native\nname: "quay-native"\n',
        'the laid-down provider.yml must be byte-identical to the plugin source');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.match(cfg, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
        'config must point the provider mcp_entry at the laid-down self-contained native bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-the-runtime-has-nowhere-safe-to-land AC10 — the runtime is install-generated product, not
// source, so quay-init MUST write the .gitignore entry itself (never an instruction to the user —
// that is exactly the manual patch G0 bans). Idempotent + non-destructive.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test('AC10 — quay-init writes the .gitignore runtime entry itself; a pre-existing same-name entry is NOT duplicated and the user gitignore is NOT overwritten', () => {
  const ws = makeTmp();
  try {
    // Pre-existing USER gitignore already carrying the entry + user content.
    fs.writeFileSync(path.join(ws, '.gitignore'), 'node_modules/\n.quay/runtime/\n# user note\n', 'utf8');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const gi = fs.readFileSync(path.join(ws, '.gitignore'), 'utf8');
    assert.equal(gi, 'node_modules/\n.quay/runtime/\n# user note\n',
      'the user gitignore must be byte-preserved (no duplicate write, no overwrite — AC10 negative control)');
    assert.match(r.stdout, /skipped: \.gitignore already carries/, 'must report the skip, not a write');
    const count = (gi.match(/^\.quay\/runtime\/$/gm) || []).length;
    assert.equal(count, 1, 'the runtime entry must appear exactly once (no duplicate)');
  } finally { cleanup(ws); }
});

test('AC10 — quay-init APPENDS the runtime gitignore entry when the target lacks it, preserving the user\'s other content', () => {
  const ws = makeTmp();
  try {
    // A user .gitignore WITHOUT the entry → quay-init appends it, preserving user content.
    fs.writeFileSync(path.join(ws, '.gitignore'), 'node_modules/\n', 'utf8');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report the append');
    const gi = fs.readFileSync(path.join(ws, '.gitignore'), 'utf8');
    assert.ok(gi.includes('node_modules/\n'), 'the user gitignore content must be preserved');
    assert.ok(gi.includes('.quay/runtime/\n'), 'the runtime entry must be present');
    assert.ok(gi.includes('# quay runtime'), 'the entry must carry a self-documenting comment');
  } finally { cleanup(ws); }
});

test('AC10 — quay-init CREATES the .gitignore when the target has none, and the entry covers the whole .quay/runtime/ dir', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report creating the entry');
    const gi = path.join(ws, '.gitignore');
    assert.ok(fs.existsSync(gi), 'a .gitignore must be created');
    const text = fs.readFileSync(gi, 'utf8');
    assert.ok(text.includes('.quay/runtime/\n'), 'the runtime entry must be present');
    // The landing dir is .quay/runtime/ (quay namespace, never vendor/ — AC9): the config file
    // .quay/config.yml is NOT ignored by the entry (only .quay/runtime/ is).
    assert.ok(!text.includes('.quay/config.yml'), 'config.yml must not be swallowed by the gitignore entry');
  } finally { cleanup(ws); }
});

// ── gap-vendor-runtime-not-in-git-clone-broken-mcp-entry (AC1/AC2/AC3) ───────────────────────────────
// The vendored runtime (plugin/vendor/quay/dist/quay.js + vendor/quay-native/dist/quay-native.js) is
// gitignored (bare `dist/` rule, M172), so a fresh plugin clone has no built bundles. quay-init must
// never WARN-and-report-complete with a broken mcp_entry (the pre-fix defect): it auto-builds via
// sync-vendor.sh (AC2) or FAILS CLOSED (AC1). AC3 adds a referenced-existence verify (the config's
// mcp_entry target must actually exist in the target).
test('AC2 — when the plugin lacks the built runtime but sync-vendor.sh can build it, quay-init AUTO-BUILDS and lays the runtime into the target (path 2)', () => {
  // Fresh-clone state: a temp COPY of the plugin with the gitignored bundles removed. sync-vendor.sh
  // is stubbed to SUCCEED and write the bundles (modelling the manager-verified path 2: npm install
  // postinstall → sync-vendor builds them, or a source tree present in the dev clone). quay-init must
  // detect the missing runtime, invoke sync-vendor.sh, re-find the bundles, and proceed to lay-down.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'vendor', 'quay', 'dist', 'quay.js'), { force: true });
    fs.rmSync(path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js'), { force: true });
    const syncStub = path.join(src, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PLUGIN/vendor/quay/dist" "$PLUGIN/vendor/quay-native/dist"
printf '// auto-built quay.js\\n' > "$PLUGIN/vendor/quay/dist/quay.js"
printf '// auto-built quay-native.js\\n' > "$PLUGIN/vendor/quay-native/dist/quay-native.js"
printf 'id: native\\nname: "quay-native"\\n' > "$PLUGIN/vendor/quay-native/provider.yml"
echo "[stub sync-vendor] built"
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must succeed after the auto-build:\n${r.stderr}`);
      assert.match(r.stderr, /auto-built vendor runtime via sync-vendor\.sh/, 'must report the auto-build (AC2)');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the auto-built Core runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// auto-built quay.js\n',
        'the laid-down Core runtime must be the auto-built bundle');
      const laidNative = path.join(ws, '.quay', 'runtime', 'bin', 'quay-native.js');
      assert.ok(fs.existsSync(laidNative), 'the auto-built native provider runtime must be laid into the target project');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.match(cfg, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
        'config must point the provider mcp_entry at the auto-built native bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC3 — after a successful lay-down, the referenced-existence verify reports OK (the mcp_entry target exists in the target)', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must succeed:\n${r.stderr}`);
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'the referenced-existence verify must report OK when the mcp_entry target exists (AC3)');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC3 — verify FAILS CLOSED when the provider mcp_entry references a runtime that does not exist in the target (referenced-existence negative control)', () => {
  // A PRE-EXISTING config whose mcp_entry references a path the lay-down will never create. quay-init
  // lays the bundles, preserves the existing provider config (it is the project's own), and the AC3
  // verify must catch the dangling mcp_entry instead of silently passing (the pre-fix "both verifies
  // passed" defect — verify only checked the landing set, never the referenced runtime).
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/nonexistent/runtime.js", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the provider mcp_entry references a missing runtime (AC3 negative control)');
      assert.match(r.stderr, /referenced-runtime-missing/, 'must report the referenced-existence failure');
      assert.match(r.stderr, /nonexistent\/runtime\.js/, 'must name the missing referenced runtime file');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// gap-dist-runtime-not-self-contained-reads-external-package-json (AC4, upgrade-channel config
// migration): a PRE-EXISTING config from an OLD install can carry a provider mcp_entry pointing at a
// dev-tree source path (e.g. ./bin/quay-native.ts) that does NOT exist in the target. quay-init lays
// the install-state runtime (.quay/runtime/bin/quay-native.js) before writing the config, so a
// dangling reference to a QUAY runtime file must be MIGRATED to that install-state path (not left for
// the AC3 verify to fail closed forever — the "config already exists is never rewritten" upgrade
// hole). SCOPE GUARD: an arbitrary dangling path (e.g. nonexistent/runtime.js) is NOT migrated, so
// the AC3 negative control above keeps its fail-closed meaning.
test('AC4 — a pre-existing config whose mcp_entry points at a stale dev-tree runtime is migrated to the install-state path (upgrade channel)', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      // Old-install config: mcp_entry points at a dev-tree SOURCE path that does not exist in the target.
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/bin"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/bin/quay-native.ts", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `quay-init must succeed after migrating the stale mcp_entry:\n${r.stderr}`);
      assert.match(r.stdout, /migrated: stale provider config/, 'must report the config migration (AC4)');
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'after migration the referenced-existence verify must pass');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.ok(!cfg.includes(`${ws}/bin/quay-native.ts`), 'the stale dev-tree mcp_entry must no longer be present');
      assert.ok(!cfg.includes(`${ws}/bin`), 'the stale dev-tree provider path must no longer be present');
      assert.match(cfg, new RegExp(`${ws.replaceAll('/', '\\/')}/\.quay/runtime/bin/quay-native\\.js`),
        'the config mcp_entry must now point at the install-state runtime (.quay/runtime/bin/quay-native.js)');
      assert.match(cfg, new RegExp(`${ws.replaceAll('/', '\\/')}/\.quay/runtime`),
        'the config provider path must now point at the install-state provider dir (.quay/runtime)');
      // Other provider keys must be preserved (config migration, not a blank rewrite).
      assert.match(cfg, /enabled: true/, 'the existing provider enabled: true must be preserved');
      assert.match(cfg, /tasks_dir:/, 'the existing provider tasks_dir must be preserved');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── gap-upgrade-channel-cant-sync-build-artifacts-dist-stale (AC1/AC2/AC4) ─────────────────────────
// The upgrade channel syncs SOURCE but not build artifacts: a git pull gets new packages/quay/src but
// the gitignored plugin/vendor/*/dist bundle does not follow (B machine: dist built 13:34, fix merged
// 15:10, ENOENT persists). AC1: ensure_vendor_runtime detects STALE (src mtime > dist mtime) and
// auto-rebuilds or fails closed — the negative control is that it previously only rebuilt on MISSING,
// never on STALE. AC2: the referenced-runtime verify now checks FRESHNESS (byte-identical to the
// plugin's current vendored bundle), not just existence. AC4: the user-scope install cache (no
// packages/ source tree) gets a VERSION-CONSISTENCY freshness check (embedded dist version vs the
// vendored package.json version) that PROMPTS instead of fail-closing.
const OLD_MTIME = 1000000000;  // 2001-09-09 (bundle built first)
const NEW_MTIME = 2000000000;  // 2033-05-18 (source updated after — the git-pull state)

function writeFakeBundles(src, coreContent, nativeContent) {
  const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
  fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
  fs.writeFileSync(fakeDist, coreContent, 'utf8');
  const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
  fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
  fs.writeFileSync(fakeNativeDist, nativeContent, 'utf8');
  fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
}

/** Read the version the vendored package.json declares (the AC4 version-freshness comparison
 * target). The test tracks the ACTUAL vendored version — it was hardcoded 0.3.13 when written,
 * and drifted when the vendored version advanced. */
function readVendoredVersion(plugin) {
  const pkg = path.join(plugin, 'vendor', 'quay', 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  assert.ok(typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version),
    `vendored package.json must declare a semver version (got ${JSON.stringify(data.version)})`);
  return data.version;
}

// makePluginCopy: a plugin copy at <parent>/plugin whose SIBLING packages tree (<parent>/packages)
// is PER-TEST unique — the AC1 stale check resolves $PLUGIN_ROOT/../packages relative to the
// plugin root, so a shared sibling (plain /tmp) would leak a source tree between tests.
function makePluginCopy() {
  const parent = makeTmp('upg-src-');
  const plugin = path.join(parent, 'plugin');
  fs.cpSync(pluginDir, plugin, { recursive: true });
  return { parent, plugin };
}

// writeSrcTree(parent, coreMtime, nativeMtime): the dev source tree lives at <parent>/packages/*/src
// (PLUGIN_ROOT = <parent>/plugin, so $PLUGIN_ROOT/../packages = <parent>/packages).
function writeSrcTree(parent, coreMtime, nativeMtime) {
  const coreSrc = path.join(parent, 'packages', 'quay', 'src');
  fs.mkdirSync(coreSrc, { recursive: true });
  const v = path.join(coreSrc, 'version.ts');
  fs.writeFileSync(v, '// version\n', 'utf8');
  fs.utimesSync(v, NEW_MTIME, coreMtime);
  const nativeSrc = path.join(parent, 'packages', 'quay-native', 'src');
  fs.mkdirSync(nativeSrc, { recursive: true });
  const m = path.join(nativeSrc, 'manifest.ts');
  fs.writeFileSync(m, '// manifest\n', 'utf8');
  fs.utimesSync(m, NEW_MTIME, nativeMtime);
}

test('AC1 — when the vendored dist is STALE (source mtime > dist mtime) and auto-rebuild works, quay-init AUTO-REBUILDS and lays the fresh runtime (AC3 B-machine scenario)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    // Dist bundles are OLD; source files are NEW → the exact state a git pull leaves (new src, gitignored dist not rebuilt).
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PLUGIN/vendor/quay/dist" "$PLUGIN/vendor/quay-native/dist"
printf '// rebuilt core\\n' > "$PLUGIN/vendor/quay/dist/quay.js"
printf '// rebuilt native\\n' > "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuilt"
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed after the stale auto-rebuild:\n${r.stderr}`);
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state (AC1 negative control: pre-fix code only rebuilt on missing, never on stale)');
      assert.match(r.stderr, /auto-rebuilt STALE vendor runtime via sync-vendor\.sh/, 'must report the stale auto-rebuild (AC1)');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the rebuilt Core runtime must be laid into the target');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// rebuilt core\n', 'the laid Core runtime must be the REBUILT bundle, not the stale one');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC1 — a FRESH dist (dist mtime > source mtime) is NOT rebuilt (passes through untouched)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// fresh core\n', '// fresh native\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, NEW_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, NEW_MTIME);
    writeSrcTree(parent, OLD_MTIME, OLD_MTIME);  // source OLDER than dist → fresh
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, '#!/usr/bin/env bash\necho "[stub sync-vendor] should NOT run"\nexit 1\n', 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `fresh dist must pass through without a rebuild:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE/, 'a fresh dist must NOT be reported stale');
      assert.doesNotMatch(r.stderr, /\[stub sync-vendor\] should NOT run/, 'sync-vendor.sh must NOT run for a fresh dist');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fresh core\n', 'the laid Core runtime must be the existing fresh bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC1 — a STALE vendored dist whose auto-rebuild cannot produce the bundles FAILS CLOSED (no complete)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
rm -f "$PLUGIN/vendor/quay/dist/quay.js" "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuild failed" >&2
exit 1
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the stale auto-rebuild cannot produce the bundles');
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state before the fail-closed');
      assert.doesNotMatch(r.stdout, /quay-init complete/, 'must NOT report complete with a stale/missing runtime');
      assert.match(r.stderr, /FAILS CLOSED/, 'must state the fail-closed resolution');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC2 — the referenced-runtime verify checks FRESHNESS: a target runtime that differs from the plugin\'s current vendored bundle FAILS CLOSED (stale-runtime)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core v2\n', '// current native v2\n');
    const ws = makeTmp();
    try {
      // Legacy-install config: the mcp_entry points at a NON-standard path the lay-down never
      // refreshes. The file EXISTS (so the existence check passes) but is a stale dist from an
      // older install — the freshness check must catch it.
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'bin', 'quay.js'), '// stale legacy core v1\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/bin/quay.js", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the referenced runtime is a stale dist (freshness, not just existence)');
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'the referenced file EXISTS — the existence check passes (AC2: existence alone was the pre-fix verify)');
      assert.match(r.stderr, /stale-runtime/, 'the freshness check must name the stale-runtime failure');
      assert.match(r.stderr, /bin\/quay\.js/, 'must name the stale referenced runtime');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC2 — a target runtime that MATCHES the plugin\'s current vendored bundle passes the freshness verify', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core\n', '// current native\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.match(r.stdout, /verify-provider-runtime-freshness: OK/, 'the freshness verify must report OK when the laid runtime matches the plugin bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC4 — a user-scope install cache (no packages/ source tree) whose dist embeds a DIFFERENT version than the vendored package.json is flagged STALE (prompt, not fail-closed)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    // The dist bundle is runnable and echoes an OLD core version; the vendored package.json
    // (tracked in git, copied verbatim) declares the real version → version mismatch = stale.
    // No packages/ source tree exists here → the AC1 mtime check cannot fire, so the AC4 version
    // check owns it. The declared version is read from the copied plugin's vendor/package.json so
    // the test tracks the actual vendored version (was hardcoded 0.3.13; now 0.4.0).
    const declared = readVendoredVersion(plugin);
    // Make the fake embedded version unambiguously OLDER than declared (0.4.0 → 0.3.0): lower the
    // MINOR segment by 1 (patch is 0 at a version boundary, so decrementing patch alone would leave
    // 0.4.0 unchanged and the test would not be stale). The version-freshness check compares the
    // whole semver string, so any lower version is STALE.
    const dec = (v) => { const [maj, min, patch] = v.split('.'); return `${maj}.${String(Math.max(0, Number(min) - 1))}.${patch}`; };
    const embeddedStale = dec(declared);
    writeFakeBundles(plugin, `console.log("${embeddedStale}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, 'a stale user-scope runtime is a PROMPT, not a fail-closed (no source tree to rebuild from — AC4)');
      assert.match(r.stderr, /STALE \(user-scope vendor runtime\)/, 'must flag the user-scope stale dist (AC4 negative control: pre-fix treated the 06:01 dist as fresh)');
      assert.match(r.stderr, new RegExp(embeddedStale.replace(/\./g, '\\.')), 'must name the embedded stale version');
      assert.match(r.stderr, new RegExp(declared.replace(/\./g, '\\.')), 'must name the declared vendored version');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC4 — a user-scope dist whose embedded version MATCHES the vendored package.json is NOT flagged stale', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    const declared = readVendoredVersion(plugin);
    writeFakeBundles(plugin, `console.log("${declared}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE \(user-scope vendor runtime\)/, 'a version-consistent user-scope dist must NOT be flagged stale');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'loop-driver-check.sh')),
      'loop-driver-check.sh must be laid down with the loop mechanism');
  } finally { cleanup(ws); }
});

test('AC6 — zero drivers = STALLED (the loop will never tick), exit 3', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const c = runDriverCheck(ws);
    assert.equal(c.status, 3, `no driver must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED, not "all normal"');
  } finally { cleanup(ws); }
});

test('AC4 — exactly one cron driver = LIVE, exit 0 (end-to-end: one trigger source)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
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
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    writeDriver(ws, 'wakeup');        // the disposed self-paced wakeup as the only driver
    const c = runDriverCheck(ws);
    assert.equal(c.status, 5, `a non-cron sole driver must be BANNED-MECHANISM (exit 5), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /BANNED-MECHANISM/, 'must report BANNED-MECHANISM');
  } finally { cleanup(ws); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down
// referenced-set ⊆ landed-set, mechanically enforced (AC1/AC2/AC3/AC4/AC6/AC7/AC8/AC9).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const INIT_LOOP_ARGS = ['--loop', '--root', 'WS', '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];

// AC1/AC4 — after a real --loop install, EVERY plugin/scripts/* reference in the shipped skills +
// tick docs exists in the target (missing_after_install = 0). The referenced set is non-empty —
// a check that only ever sees the empty set is indistinguishable from one that sees nothing.
test('AC1/AC4 — every plugin/scripts/* reference in the shipped skills/tick docs lands after --loop (missing_after_install = 0)', () => {
  const ws = makeTmp();
  try {
    const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
    const r = runInit(ws, args);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, 'quay-init must run the referenced⊆landed check and report OK');
    const refs = extractRefs(pluginDir, 'plugin/scripts');
    assert.ok(refs.length > 0, 'the referenced set must be non-empty (the check is not verifying the empty set)');
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(ws, ref)), `referenced script must exist after install: ${ref}`);
    }
  } finally { cleanup(ws); }
});

// AC2 — the check must REPORT the two real live specimens (monitor-mount-check.sh,
// send-keys-reliable.sh) when they are absent from the landing set. Reproduce the pre-fix state in
// a plugin copy by removing them from the shipped scripts dir (referenced by cold-start, unable to
// land) — the check names both and fails the install. NOTE: send-keys-verified.sh was layer-retired
// by gap-cold-start-ac8c-key4 (key 4 now teaches send-keys-reliable.sh); the specimen was swapped to
// the current live replacement.
test('AC2 — the check reports the two real live specimens (monitor-mount-check.sh, send-keys-reliable.sh) when they cannot land', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'scripts', 'monitor-mount-check.sh'), { force: true });
    fs.rmSync(path.join(src, 'scripts', 'send-keys-reliable.sh'), { force: true });
    const ws = makeTmp();
    try {
      const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
      const r = runInit(ws, args, src);
      assert.notEqual(r.status, 0, 'the check must FAIL when a referenced script cannot land');
      assert.match(r.stderr, /monitor-mount-check\.sh/, 'must name monitor-mount-check.sh');
      assert.match(r.stderr, /send-keys-reliable\.sh/, 'must name send-keys-reliable.sh');
      assert.match(r.stderr, /referenced-not-landed/, 'must use the referenced-not-landed category');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// AC3 — bidirectional negative control: a skill reference to a script that does not ship ⇒ the
// check reports it; remove the reference ⇒ the check passes. Both directions.
test('AC3 — bidirectional control: an unlanded script reference is reported; removing it passes', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const skillPath = path.join(src, 'skills', 'cold-start', 'SKILL.md');
    const orig = fs.readFileSync(skillPath, 'utf8');
    // fail direction: add a call to a script that does not exist in plugin/scripts/.
    fs.writeFileSync(skillPath, `${orig}\nbash <root>/plugin/scripts/ghost-check.sh --does-not-exist\n`);
    const ws = makeTmp();
    try {
      const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
      const r = runInit(ws, args, src);
      assert.notEqual(r.status, 0, 'a new unlanded script call must FAIL the check');
      assert.match(r.stderr, /ghost-check\.sh/, 'the failure must name the missing script');
      assert.match(r.stderr, /referenced-not-landed/, 'must use the referenced-not-landed category');
    } finally { cleanup(ws); }
    // pass direction: remove the call → the check passes again.
    fs.writeFileSync(skillPath, orig);
    const ws2 = makeTmp();
    try {
      const args2 = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws2 : a));
      const r2 = runInit(ws2, args2, src);
      assert.equal(r2.status, 0, `removing the call must pass the check:\n${r2.stderr}`);
      assert.match(r2.stdout, /verify-referenced-landed: OK/, 'must report the check passing after removal');
    } finally { cleanup(ws2); }
  } finally { cleanup(src); }
});

// AC7 — the check covers orchestration/* and docs/analysis/* too. Every referenced file must be
// either landed in the target, or declared self-create / reference-doc in init/SKILL.md. Nothing
// may be referenced yet unaccounted-for (that would be drift the two-hand-maintained-lists check
// exists to catch).
test('AC7 — every orchestration/* and docs/analysis/* reference is landed or declared (complete classification)', () => {
  const ws = makeTmp();
  try {
    const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
    const r = runInit(ws, args);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const selfcreate = declaredSet(pluginDir, 'self-create');
    const refdoc = declaredSet(pluginDir, 'reference-doc');
    assert.ok(selfcreate.size > 0, 'init/SKILL.md must declare at least the local-state self-create files');
    assert.ok(refdoc.size > 0, 'init/SKILL.md must declare the quay reference-doc class');
    const refs = [...extractRefs(pluginDir, 'plugin/scripts'), ...extractRefs(pluginDir, 'orchestration'), ...extractRefs(pluginDir, 'docs/analysis')];
    assert.ok(refs.length > 0, 'the referenced set must be non-empty');
    for (const ref of refs) {
      const landed = fs.existsSync(path.join(ws, ref));
      const declared = selfcreate.has(ref) || refdoc.has(ref);
      assert.ok(landed || declared, `referenced file must be landed OR declared: ${ref}`);
    }
  } finally { cleanup(ws); }
});

// AC8 — local-state files are NOT shipped as empty factory copies (which would break the
// byte-identical upgrade check), and are declared self-create in init/SKILL.md with a command.
test('AC8 — local-state files are not shipped empty; they are declared self-create with a command', () => {
  const ws = makeTmp();
  try {
    const args = INIT_LOOP_ARGS.map((a) => (a === 'WS' ? ws : a));
    const r = runInit(ws, args);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // The local-state files must NOT be laid down by --loop (no empty factory copies).
    for (const f of ['orchestration/tick-log.md', 'orchestration/escalations.md',
      'docs/analysis/batch2-queue-state.md', 'docs/analysis/contract-violations.md']) {
      assert.ok(!fs.existsSync(path.join(ws, f)), `local-state file must NOT be shipped empty: ${f}`);
    }
    // The shipped init skill declares them self-create and gives the self-create command.
    const selfcreate = declaredSet(pluginDir, 'self-create');
    for (const f of ['orchestration/tick-log.md', 'orchestration/escalations.md',
      'docs/analysis/batch2-queue-state.md', 'docs/analysis/contract-violations.md']) {
      assert.ok(selfcreate.has(f), `must be declared self-create: ${f}`);
    }
    const initSkill = fs.readFileSync(path.join(pluginDir, 'skills', 'init', 'SKILL.md'), 'utf8');
    assert.match(initSkill, /Self-create command/, 'the declaration must give the self-create command');
    assert.match(initSkill, /touch orchestration\/tick-log\.md/, 'must give the self-create command for tick-log.md');
    assert.match(initSkill, /byte-identical upgrade check/, 'must state why empty copies are not shipped');
  } finally { cleanup(ws); }
});

// AC6 — quay-init.sh self-resolves its plugin root from its own path when the host does not inject
// CLAUDE_PLUGIN_ROOT (the documented Skill call), and still fails closed on an unusable root.
test('AC6 — quay-init self-resolves the plugin root without CLAUDE_PLUGIN_ROOT, and fails closed on a bad root', () => {
  const ws = makeTmp();
  try {
    const script = path.join(pluginDir, 'scripts', 'quay-init.sh');
    const env = { ...process.env };
    delete env.CLAUDE_PLUGIN_ROOT;
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
      '--tmux-session', 'proj-0:0.0', '--worktree-root', diskWorktreeRoot()];
    const r = spawnSync('bash', [script, ...args], { cwd: ws, encoding: 'utf8', env });
    assert.equal(r.status, 0, `self-resolved init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'resource-gate.sh')), 'the loop mechanism must still land');
    // Fail-closed retained: a bad plugin root aborts, never a silent wrong path.
    const bad = spawnSync('bash', [script, ...args, '--plugin-root', '/nonexistent/plugin'],
      { cwd: ws, encoding: 'utf8', env });
    assert.equal(bad.status, 2, 'a bad plugin root must fail closed (exit 2)');
    assert.match(bad.stderr, /not a quay plugin/, 'must name the invalid plugin root');
  } finally { cleanup(ws); }
});
