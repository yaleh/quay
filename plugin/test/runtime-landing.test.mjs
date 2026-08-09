// @test-group serial
// @load-sensitive heavy
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test takes a throwaway target through a real quay-init --loop install (shared laydown
// template via quay-init-loop-helpers.mjs). The install/quay-init family rotated flakes across groups
// under full-suite load, so the whole family is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-install-family-tests-rotate-flakes-under-full-suite): moved lowconc→serial. The
// real quay-init --loop install (even via the laydown template) plus real git commit + pre-commit-hook
// round-trips are wall-clock load-sensitive — the serial phase (cc1) is now the family's single
// isolation regime.
// runtime-landing.test.mjs — gap-the-runtime-has-nowhere-safe-to-land (AC3/AC4/AC10).
//
// The quay runtime used to land in `<target>/vendor/quay/dist/quay.js` — a RESERVED directory in
// Go (module vendoring) and a 1.3MB single file against common `check-added-large-files` pre-commit
// hooks (default 500KB). The landing decision (task AC2, mechanism): the runtime is a GENERATED
// ARTIFACT, not source, so it lands in `<target>/.quay/runtime/` — quay's OWN namespace, OUTSIDE
// git, gitignored by quay-init itself. This file proves the three acceptance criteria that depend on
// a real git + pre-commit hook:
//
//   AC3  — positive: a throwaway target WITH a default-threshold (500KB) large-file hook, taken
//          through the documented flow (quay-init --loop, then commit), commits CLEAN with ZERO
//          manual patches. The runtime is gitignored, so the 1.3MB artifact never enters the
//          staging area the hook scans.
//   AC4  — negative: artificially lower the hook threshold to 1KB and force-stage the runtime
//          (bypassing the gitignore). The commit MUST FAIL and the hook MUST name the runtime file.
//          Without this, AC3's success is indistinguishable from a hook that never runs.
//   AC10 — gitignore handling: quay-init writes the `.quay/runtime/` entry itself; an already-
//          present entry is NOT duplicated, and the user's existing .gitignore is never overwritten.
//
// The hook is a faithful standalone reimplementation of pre-commit's `check-added-large-files`
// (scan `git diff --cached`, reject files over MAXKB). The real pre-commit tool is not installed on
// this image; the mechanism being verified — a large-file pre-commit hook rejecting oversized staged
// files — is byte-for-byte the same scan.
//
// Run:
//   scripts/test.sh plugin/test/runtime-landing.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

// AC2 (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles): the state-only
// install tests below run from the shared READ-ONLY laydown template (one real quay-init --loop
// per FILE process) instead of a fresh real install per test — the laid-down state is
// byte-identical, so the git/gitignore/hook assertion surface is unchanged.
import { laydownWorkspace } from './quay-init-loop-helpers.mjs';

function makeTmp(prefix = 'runtime-landing-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// Worktree root on real disk (not tmpfs) — quay-init --loop rejects a tmpfs worktree root (A6).
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

function runInit(workspace, args = []) {
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  return spawnSync('bash', [path.join(pluginDir, 'scripts', 'quay-init.sh'), ...extra, ...args],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
    });
}

// A faithful `check-added-large-files` equivalent: reject any STAGED file over MAXKB (default 500KB).
// Written as the target's own `.git/hooks/pre-commit` so `git commit` actually runs it.
function installLargeFileHook(workspace, maxkb = 500) {
  const hooks = path.join(workspace, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-commit'), `#!/usr/bin/env bash
# check-added-large-files equivalent (threshold MAXKB, default 500)
MAXKB="\${MAXKB:-${maxkb}}"
THRESHOLD=$((MAXKB * 1024))
fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  size=$(stat -c %s "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$THRESHOLD" ]; then
    echo "ERROR: File $f is $size bytes, which exceeds \${MAXKB}KB threshold" >&2
    fail=1
  fi
done < <(git diff --cached --name-only --diff-filter=ACM)
exit $fail
`);
  fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
}

function git(workspace, args, opts = {}) {
  return spawnSync('git', [...args, ...(opts.extra || [])],
    { cwd: workspace, encoding: 'utf8', ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}) });
}

function commitAll(workspace, maxkb, message = 'add runtime') {
  const add = git(workspace, ['add', '-A']);
  assert.equal(add.status, 0, `git add -A failed:\n${add.stderr}`);
  return git(workspace, ['-c', 'user.email=quay-test@example.com', '-c', 'user.name=quay-test', 'commit', '-m', message],
    { env: maxkb !== undefined ? { MAXKB: String(maxkb) } : {} });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC3 — positive: default 500KB hook, documented flow, commit succeeds, zero manual patches
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test('AC3 — a target with a default-threshold (500KB) large-file hook commits the runtime landing clean (zero manual patches)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));
    assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);

    // The runtime must be laid into .quay/runtime/ (the task's landing decision). f9414dd3
    // moved the layout to .quay/runtime/bin/ (keeps the native bundle's ../provider.yml
    // resolution) — the config mcp_entry and install-config-driven-e2e A5/AC11 assert this same
    // bin/ layout.
    for (const rel of ['.quay/runtime/bin/quay.js', '.quay/runtime/bin/quay-native.js', '.quay/runtime/provider.yml']) {
      assert.ok(fs.existsSync(path.join(ws, rel)), `runtime file must be laid down: ${rel}`);
    }

    git(ws, ['init', '-q']);
    installLargeFileHook(ws, 500);

    const stagedBefore = git(ws, ['add', '-A']);
    assert.equal(stagedBefore.status, 0, `git add -A failed:\n${stagedBefore.stderr}`);
    const staged = git(ws, ['diff', '--cached', '--name-only']).stdout;
    assert.ok(!staged.includes('.quay/runtime/'), `the runtime must NOT be staged (gitignore protected it); staged=${JSON.stringify(staged.split('\n').filter(Boolean))}`);

    // AC3 core: the documented flow (`quay-init --loop`, then commit) succeeds with a live 500KB hook.
    const commit = commitAll(ws, 500);
    assert.equal(commit.status, 0, `AC3: commit must succeed at the default 500KB threshold:\n${commit.stdout}\n${commit.stderr}`);
  } finally { cleanup(ws); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC4 — negative: the hook genuinely rejects; threshold 1KB must FAIL, naming the runtime file
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test('AC4 — the large-file hook genuinely runs: threshold 1KB + force-staged runtime MUST FAIL, naming the 1.3MB file', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));
    assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);

    git(ws, ['init', '-q']);
    installLargeFileHook(ws, 1);   // 1KB — the AC4 control threshold
    git(ws, ['add', '-A']);

    // Force-stage the runtime (bypasses the gitignore) — WITHOUT this the gitignore keeps it out
    // and the 1KB control would trip on the tick docs instead of the runtime. Force-staging proves
    // the hook rejects THE RUNTIME itself, and that the gitignore (not size) is what protects AC3.
    const forceAdd = git(ws, ['add', '-f', '.quay/runtime/']);
    assert.equal(forceAdd.status, 0, `git add -f .quay/runtime/ failed:\n${forceAdd.stderr}`);

    const commit = commitAll(ws, 1);
    assert.notEqual(commit.status, 0, 'AC4: the commit MUST fail at the 1KB threshold (a hook that never rejects is indistinguishable from no hook)');
    const out = commit.stdout + commit.stderr;
    assert.match(out, /\.quay\/runtime\/bin\/quay\.js/, `the hook must name the oversized runtime file:\n${out}`);
    assert.match(out, /bytes, which exceeds 1KB/, `the hook must report the file size:\n${out}`);
  } finally { cleanup(ws); }
});

// AC4 companion — at the DEFAULT 500KB threshold the runtime is ALSO > 500KB, so a force-staged
// runtime is rejected there too. This closes the loop: AC3's green commit is green BECAUSE the
// runtime is gitignored, not because the 500KB hook would have let a 1.3MB file through.
test('AC4 companion — force-staging the runtime at the DEFAULT 500KB threshold is also rejected (the gitignore, not size, is what protects AC3)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));
    assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);

    git(ws, ['init', '-q']);
    installLargeFileHook(ws, 500);
    git(ws, ['add', '-A']);
    git(ws, ['add', '-f', '.quay/runtime/']);

    const commit = commitAll(ws, 500);
    assert.notEqual(commit.status, 0, 'the force-staged 1.3MB runtime must be rejected even at the default 500KB threshold');
    assert.match(commit.stdout + commit.stderr, /\.quay\/runtime\/bin\/quay\.js/, 'the hook must name the runtime file at 500KB too');
  } finally { cleanup(ws); }
});

// Upgrade-path companion to AC9 — a REAL old install (pre-fix) laid the runtime into
// `<target>/vendor/quay-native/` and its .quay/config.yml points there. That dir EXISTS on upgrade,
// so a "migrate only nonexistent paths" guard would leave the target pointed at the Go-reserved
// directory forever. The migration must move a quay runtime path sitting under a reserved segment
// (vendor/node_modules/target/build/dist) to `.quay/runtime/` (bin/ layout, f9414dd3), even when
// the old dir exists.
test('AC9 upgrade — an existing install whose config points at vendor/quay-native (dir exists) is migrated to .quay/runtime/bin', () => {
  const ws = makeTmp();
  try {
    // Simulate the pre-fix install residue: the vendor/quay-native dir EXISTS.
    fs.mkdirSync(path.join(ws, 'vendor', 'quay-native', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'vendor', 'quay-native', 'dist', 'quay-native.js'), '// old bundle\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
      `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/vendor/quay-native/dist/quay-native.js", "mcp"]\n`, 'utf8');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));

    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
      '--tmux-session', 'proj-0:0.0', '--plugin-root', pluginDir]);
    assert.equal(r.status, 0, `quay-init must succeed and migrate the old config:\n${r.stderr}`);
    assert.match(r.stdout, /migrated: stale provider config/, 'must report the migration');
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.ok(!cfg.includes(`${ws}/vendor/quay-native`), 'the config must no longer point at the Go-reserved vendor/ dir');
    assert.ok(cfg.includes(`${ws}/.quay/runtime`), 'the config must now point at .quay/runtime');
    assert.ok(cfg.includes(`${ws}/.quay/runtime/bin/quay-native.js`), 'the mcp_entry must now point at the .quay/runtime bundle (bin/ layout, f9414dd3)');
  } finally { cleanup(ws); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC10 — gitignore handling: quay-init writes the entry; no duplicates; never overwrites the user's file
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test('AC10 — quay-init writes the .quay/runtime/ gitignore entry; an already-present entry is not duplicated', () => {
  // Case 1: existing .gitignore WITHOUT the entry → appended, user rules preserved.
  const ws1 = makeTmp();
  try {
    fs.writeFileSync(path.join(ws1, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));
    fs.writeFileSync(path.join(ws1, '.gitignore'), 'node_modules/\n# user rule\n*.log\n', 'utf8');
    const r = runInit(ws1, ['--loop', '--root', ws1, '--project', 'proj', '--test-command', 'node --test',
      '--tmux-session', 'proj-0:0.0', '--plugin-root', pluginDir]);
    assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
    assert.match(r.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report the append');
    const gi = fs.readFileSync(path.join(ws1, '.gitignore'), 'utf8');
    assert.ok(gi.includes('node_modules/'), 'user .gitignore rules must be preserved');
    assert.ok(gi.includes('*.log'), 'user .gitignore rules must be preserved');
    assert.ok(gi.includes('.quay/runtime/'), 'the runtime gitignore entry must be present');
    assert.equal(gi.split('.quay/runtime/').length - 1, 1, 'the entry must appear exactly once');
  } finally { cleanup(ws1); }

  // Case 2: existing .gitignore WITH the entry → no duplicate, no modification.
  const ws2 = makeTmp();
  try {
    fs.writeFileSync(path.join(ws2, 'package.json'), JSON.stringify({ name: 'proj', scripts: { test: 'node --test' } }, null, 2));
    fs.writeFileSync(path.join(ws2, '.gitignore'), 'node_modules/\n.quay/runtime/\n', 'utf8');
    const before = fs.readFileSync(path.join(ws2, '.gitignore'), 'utf8');
    const r = runInit(ws2, ['--loop', '--root', ws2, '--project', 'proj', '--test-command', 'node --test',
      '--tmux-session', 'proj-0:0.0', '--plugin-root', pluginDir]);
    assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
    assert.match(r.stdout, /skipped: \.gitignore already carries/, 'must report the no-op');
    assert.equal(fs.readFileSync(path.join(ws2, '.gitignore'), 'utf8'), before, 'an already-present entry must leave the .gitignore byte-identical');
    assert.equal(before.split('.quay/runtime/').length - 1, 1, 'the entry must appear exactly once');
  } finally { cleanup(ws2); }

  // Case 3: no .gitignore → created with the entry. Runs from the shared READ-ONLY laydown
  // template (AC2, gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles): the
  // template's FIRST install created the .gitignore with the entry, so the copy carries it and the
  // captured install output reports the append.
  const { ws: ws3, install: r3 } = laydownWorkspace();
  try {
    assert.equal(r3.status, 0, `quay-init must succeed:\n${r3.stderr}`);
    assert.match(r3.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report the write');
    assert.ok(fs.existsSync(path.join(ws3, '.gitignore')), '.gitignore must be created');
    assert.ok(fs.readFileSync(path.join(ws3, '.gitignore'), 'utf8').includes('.quay/runtime/'), 'the entry must be written');
  } finally { cleanup(ws3); }
});
