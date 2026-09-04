// @test-group engine
// gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs AC3/AC4: quay-init
// --loop must FAIL CLOSED when the worktree root is on tmpfs (memory, not disk — the 2026-08-04
// machine-wide OOM traced straight to in-flight worktrees living in /tmp), and must PROCEED on a
// real disk root where a worktree can actually be built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

function runInit(workspace, args = [], pluginRoot = pluginDir) {
  return spawnSync('bash', [path.join(pluginRoot, 'scripts', 'quay-init.sh'), ...args],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
function fsType(p) {
  const r = spawnSync('stat', ['-f', '-c', '%T', p], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}
/** A real tmpfs path on this machine, or null (skip the reject direction when none exists). */
function tmpfsPath() {
  for (const p of ['/dev/shm', '/tmp']) {
    try { if (fs.existsSync(p) && fsType(p) === 'tmpfs') return p; } catch { /* next */ }
  }
  return null;
}
/** A real disk (non-tmpfs) temp dir. */
function diskTemp(prefix = 'quay-wt-fscheck-') {
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try { if (fs.existsSync(base) && fsType(base) !== 'tmpfs') return fs.mkdtempSync(path.join(base, prefix)); } catch { /* next */ }
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// AC3 — the reject direction: a worktree root on a REAL tmpfs path must fail closed, name the
// reason (memory, not disk) and suggest a fix.
test('AC3 — a worktree root on tmpfs makes quay-init --loop fail closed with a memory-not-disk error', (t) => {
  const tmpfsBase = tmpfsPath();
  if (!tmpfsBase) {
    t.skip('no tmpfs path found on this machine — cannot exercise the reject direction');
    return;
  }
  const ws = diskTemp('quay-wt-ws-');
  const tmpfsRoot = path.join(tmpfsBase, `quay-wt-ac3-${process.pid}`);
  // Explicit --tmux-session: this test does not care about tmux, but quay-init --loop now
  // fail-closes on an undetectable session (gap-init-guesses-the-tmux-session) — pass one so the
  // tmpfs worktree-root validation is what runs (same precedent as cold-start-skill.test.mjs:137).
  const r = runInit(ws, ['--loop', '--dry-run', '--test-command', 'scripts/test.sh', '--worktree-root', tmpfsRoot, '--tmux-session', 'proj-0:0.0']);
  assert.notEqual(r.status, 0, `tmpfs worktree root must fail closed, got status ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /on tmpfs.*memory|memory.*not disk|this is memory/i,
    `the error must say the root is on tmpfs / memory, got:\n${r.stderr}`);
  assert.match(r.stderr, /worktrees.*-worktrees|change it to|disk path/i,
    `the error must suggest what to change it to, got:\n${r.stderr}`);
  cleanup(ws);
});

// AC4 — the accept direction + negative control (a real disk path must NOT be rejected):
// quay-init --loop exits 0, writes worktree_root into .quay/config.yml loop:, and a real
// `git worktree add` succeeds at that root ("worktree 正常建成").
test('AC4 — a real disk worktree root proceeds: exit 0, config records it, and a worktree builds there', () => {
  const ws = diskTemp('quay-wt-ws-');
  const wtRoot = diskTemp('quay-wt-root-');
  try {
    // A minimal git repo so a worktree can actually be built (AC4's "worktree 正常建成").
    spawnSync('git', ['init', '-q', ws]);
    spawnSync('git', ['-C', ws, 'config', 'user.email', 'test@example.com']);
    spawnSync('git', ['-C', ws, 'config', 'user.name', 'test']);
    fs.writeFileSync(path.join(ws, 'README.md'), '# fixture\n');
    spawnSync('git', ['-C', ws, 'add', '.']);
    spawnSync('git', ['-C', ws, 'commit', '-q', '-m', 'init']);

    // Same --tmux-session rationale as AC3 above: this test verifies the worktree-root validation
    // only; an explicit session keeps quay-init --loop's tmux fail-closed from firing.
    const r = runInit(ws, ['--loop', '--test-command', 'scripts/test.sh', '--worktree-root', wtRoot, '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `disk worktree root must NOT be rejected, got status ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /not tmpfs, OK|not tmpfs/i, 'validation must print that the root is accepted');

    const cfg = path.join(ws, '.quay', 'config.yml');
    assert.ok(fs.existsSync(cfg), '.quay/config.yml must be written');
    const cfgText = fs.readFileSync(cfg, 'utf8');
    assert.ok(cfgText.includes(`worktree_root: ${wtRoot}`),
      `config loop: must record the worktree_root, got:\n${cfgText}`);

    // "worktree 正常建成": git worktree add at the disk root must succeed.
    const wt = spawnSync('git', ['-C', ws, 'worktree', 'add', path.join(wtRoot, 'probe'), '-b', 'probe'], { encoding: 'utf8' });
    assert.equal(wt.status, 0, `git worktree add at the disk root must succeed, got status ${wt.status}\n${wt.stdout}${wt.stderr}`);
    assert.ok(fs.existsSync(path.join(wtRoot, 'probe', 'README.md')), 'the worktree must be checked out with content');
  } finally {
    cleanup(ws);
    cleanup(wtRoot);
  }
});
