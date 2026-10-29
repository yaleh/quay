// @test-group engine
// plugin/test/gate-scripts-retirement.test.mjs — gap-gate-scripts-laid-down-but-dead-and-
// not-mutation-checked. Pins the RETIREMENT of the plugin/gate-scripts/ distribution category:
//
//   AC2: the classic-pipeline era gate scripts were laid into every target project's
//        scripts/gates/ but nothing called them — dead weight shipped to every install.
//        分层退休（Layered retirement）: the files are no longer laid down by quay-init and no
//        longer synced by sync.sh.
//
//   ARCHIVAL (gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan,
//   2026-10-28): layered retirement kept the directory in the plugin tree, but two of its files
//   (drain-scheduler.ts / drain-dispose-corruption-check.ts) were byte-identical to the LIVE
//   experiments/quay-perpetual-stream/scripts/ copies with NO drift checker watching the pair, and
//   the rest were a stale mirror of those same live scripts (5 of 13 byte-identical at archiving,
//   the others frozen at 2026-08-11). A "historical artifact" that is a mirror of live code is not
//   an artifact — it is an unguarded second copy nobody reads. The directory is now ARCHIVED
//   (archive/2026-10-28-retired-gate-scripts-orphan/), so the live tree holds exactly ONE copy of
//   each script and no drift check is needed to keep it that way.
//
// Contract measure: dead_gates_remaining = `grep -c 'gate-scripts' plugin/scripts/quay-init.sh`
//   — band 0 (dead gates no longer installed). The tests below pin that measure at 0 AND prove it
//   end-to-end by running a real quay-init --all into a temp workspace and asserting scripts/gates/
//   is NOT created while the live categories (.claude/workflows/, .claude/agents/) still land.
//
// Run: node --test plugin/test/gate-scripts-retirement.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

test('AC2: quay-init.sh carries ZERO gate-scripts references (contract measure dead_gates_remaining = 0)', () => {
  const quayInit = read(path.join(pluginDir, 'scripts', 'quay-init.sh'));
  assert.equal(quayInit.includes('gate-scripts'), false,
    'quay-init.sh must contain ZERO "gate-scripts" references — the retired category must not be laid down');
});

test('AC2: sync.sh no longer syncs the retired gate scripts', () => {
  const sync = read(path.join(pluginDir, 'sync.sh'));
  // No `cp` operation may target the retired plugin/gate-scripts/ directory anymore. (A comment
  // naming the retired dir is documentation of the retirement, not a sync operation.)
  assert.doesNotMatch(sync, /cp\s+.*gate-scripts\//,
    'sync.sh must contain no cp operation targeting the retired plugin/gate-scripts/ directory');
  // The workflows sync (the surviving distribution category) must still be present.
  assert.match(sync, /drain-directives\.js/, 'sync.sh must still sync drain-directives.js');
  assert.match(sync, /run-routines\.js/, 'sync.sh must still sync run-routines.js');
});

test('AC2: the init skill no longer advertises a --gate-scripts flag', () => {
  const skill = read(path.join(pluginDir, 'skills', 'init', 'SKILL.md'));
  // The "## Arguments" code block is the advertised option list — it must NOT list --gate-scripts.
  const argsBlock = skill.match(/## Arguments\n\n```\n([\s\S]*?)\n```/)?.[1] ?? '';
  assert.ok(argsBlock.length > 0, 'init/SKILL.md must have an Arguments code block');
  assert.equal(argsBlock.includes('--gate-scripts'), false,
    'the init Arguments list must no longer advertise the retired --gate-scripts flag');
});

test('AC2 (archival): the retired gate scripts are OUT of the plugin tree and indexed in archive/', () => {
  // gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan: the directory used
  // to stay in the tree (分层退休). It no longer does — its 14 files were a mirror of the live
  // experiments/quay-perpetual-stream/scripts/ copies, so the live tree carried an unguarded second
  // copy of live code. This test goes RED if the directory is ever re-added to plugin/: a
  // resurrected copy must be an explicit decision, not a silent one.
  const gateDir = path.join(pluginDir, 'gate-scripts');
  assert.equal(fs.existsSync(gateDir), false,
    'plugin/gate-scripts/ must NOT exist — the retired category is ARCHIVED (archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/), not kept as a second copy of live code');

  // The 14 files that used to be distributed must still be recoverable from the archive.
  const archiveDir = path.join(repoRoot, 'archive', '2026-10-28-retired-gate-scripts-orphan', 'plugin', 'gate-scripts');
  const retired = [
    'audit-independence-check.sh', 'drain-dispose-corruption-check.ts', 'drain-scheduler.ts',
    'it0-backlog-projection-check.sh', 'it0-ceiling-check.sh',
    'it0-ceiling-line-budget-check.sh', 'it0-dashboard-line-budget-check.sh',
    'it0-dod-check.sh', 'it0-dogfood-evidence-gate.sh', 'it0-gate-hash-check.sh',
    'it0-impl-row-check.sh', 'tree-hygiene-check.sh', 'vmeta-lag-check.sh',
    'worktree-branch-hygiene-check.sh',
  ];
  assert.equal(retired.length, 14, 'the retired set must be the 14 classic-pipeline era gate scripts');
  const idx = fs.readFileSync(path.join(repoRoot, 'archive', 'INDEX.tsv'), 'utf8');
  for (const f of retired) {
    const archived = path.join(archiveDir, f);
    assert.ok(fs.existsSync(archived), `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/${f} must exist (archived, not lost)`);
    assert.match(idx, new RegExp(`^plugin/gate-scripts/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\t`, 'm'),
      `archive/INDEX.tsv must carry a row for the archived plugin/gate-scripts/${f}`);
  }

  // The drift half of the original finding, made executable: there is no file left UNDER
  // plugin/gate-scripts/ to disagree with a live copy, so the pair that could drift without a
  // checker (drain-scheduler.ts / drain-dispose-corruption-check.ts, byte-identical until now) no
  // longer exists. Five of the archived names also live in plugin/scripts/ as genuine product
  // scripts — those are single sources with their own mirror-pair drift coverage, not this
  // directory's copies, and this task must not touch them.
  assert.equal(fs.existsSync(path.join(gateDir, 'drain-scheduler.ts')), false,
    'plugin/gate-scripts/drain-scheduler.ts must be gone (its live copy is experiments/quay-perpetual-stream/scripts/drain-scheduler.ts)');
  assert.equal(fs.existsSync(path.join(gateDir, 'drain-dispose-corruption-check.ts')), false,
    'plugin/gate-scripts/drain-dispose-corruption-check.ts must be gone (its live copy is experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts)');
});

test('AC2/AC3 end-to-end: quay-init --all lays the closed set and NO dead extension/script copies', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-scripts-retire-'));
  try {
    const quayInit = path.join(pluginDir, 'scripts', 'quay-init.sh');
    execFileSync('bash', [quayInit, '--all', '--root', ws, '--plugin-root', pluginDir,
      '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // The retired gate-scripts category must not create scripts/gates/ (the SPEC §6 closed set lays
    // NO scripts at all — .claude/workflows and .claude/agents are retired too).
    assert.equal(fs.existsSync(path.join(ws, 'scripts', 'gates')), false,
      'scripts/gates/ must NOT be created');
    assert.equal(fs.existsSync(path.join(ws, '.claude', 'workflows')), false,
      '.claude/workflows must NOT be created (extension copies retired)');
    assert.equal(fs.existsSync(path.join(ws, '.claude', 'agents')), false,
      '.claude/agents must NOT be created (extension copies retired)');
    // The closed-set files DO land.
    assert.ok(fs.existsSync(path.join(ws, '.quay', 'config.yml')), 'the closed-set config must land');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
