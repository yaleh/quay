// @test-group governance
// quay-init-loop.test.mjs — gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.
// Tests the `--loop` category of plugin/scripts/quay-init.sh: lays down the two-layer loop
// mechanism into a target workspace with mechanized placeholder substitution (AC3/AC4), and
// the upgrade path that must not overwrite local changes (AC5).
//
// AC3 — `quay-init --loop --dry-run` lists would-copy items; a real run lays down the full set.
// AC4 — the laid-down tick docs have the target's test command / tmux session / repo root, and
//       grep finds NO quay-specific literals (scripts/test.sh, /home/yale/work/quay).
// AC5 — on a workspace where a laid-down tick doc was locally edited, a re-run does NOT overwrite
//       the local change and lists the conflict.
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
      'inner-state.sh', 'resource-gate.sh', 'heavy-op-token.sh', 'task-contract-check.ts',
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

// ── AC4: mechanized placeholder substitution + negative control ────────────────────────────────────
test('AC4 — laid-down tick docs carry the target values and NO quay-specific literals (negative control)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'myproj',
      '--test-command', 'npm test', '--tmux-session', 'myproj-0:0.0', '--repo-root', '/srv/target']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);

    const outer = fs.readFileSync(path.join(ws, 'orchestration', 'orchestrator-loop-tick.md'), 'utf8');
    const inner = fs.readFileSync(path.join(ws, 'docs', 'analysis', 'fast-mode-loop-tick.md'), 'utf8');
    const all = outer + '\n' + inner;

    // Substitution applied: the target's test command replaced scripts/test.sh.
    assert.ok(!all.includes('scripts/test.sh'), 'laid-down tick docs must NOT contain scripts/test.sh (AC4 negative control)');
    assert.ok(all.includes('npm test'), 'laid-down tick docs must contain the target test command');
    // Repo root replaced.
    assert.ok(!all.includes('/home/yale/work/quay'), 'laid-down tick docs must NOT contain the quay dev-tree root (AC8 negative control)');
    assert.ok(all.includes('/srv/target'), 'laid-down tick docs must contain the target repo root');
    // tmux session replaced.
    assert.ok(!all.includes('quay-0:0.0'), 'laid-down tick docs must NOT contain quay tmux session');
    assert.ok(all.includes('myproj-0:0.0'), 'laid-down tick docs must contain the target tmux session');

    // The mechanism scripts that used to carry quay literals are now self-locating.
    const innerState = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'inner-state.sh'), 'utf8');
    assert.ok(!innerState.includes('/home/yale/work/quay'), 'inner-state.sh must not carry a hardcoded quay root');
  } finally { cleanup(ws); }
});

test('AC4 — --loop without --test-command fails closed (no universal default)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj']);
    assert.equal(r.status, 2, '--loop without --test-command must fail closed (exit 2)');
    assert.match(r.stderr, /--test-command/, 'failure must name the missing required arg');
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
