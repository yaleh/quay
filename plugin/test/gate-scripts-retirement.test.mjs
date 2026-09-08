// @test-group engine
// plugin/test/gate-scripts-retirement.test.mjs — gap-gate-scripts-laid-down-but-dead-and-
// not-mutation-checked. Pins the RETIREMENT of the plugin/gate-scripts/ distribution category:
//
//   AC2: the classic-pipeline era gate scripts were laid into every target project's
//        scripts/gates/ but nothing called them — dead weight shipped to every install.
//        分层退休（Layered retirement）: the files stay in the plugin tree but are no
//        longer laid down by quay-init and no longer synced by sync.sh.
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

test('AC2 (layered retirement): the retired gate scripts remain in the plugin tree as a historical artifact', () => {
  const gateDir = path.join(pluginDir, 'gate-scripts');
  assert.ok(fs.existsSync(gateDir), 'plugin/gate-scripts/ must exist (layered retirement keeps files in tree)');
  // The 14 classic-pipeline era files that used to be distributed must still be present.
  const retired = [
    'audit-independence-check.sh', 'drain-dispose-corruption-check.ts', 'drain-scheduler.ts',
    'it0-backlog-projection-check.sh', 'it0-ceiling-check.sh',
    'it0-ceiling-line-budget-check.sh', 'it0-dashboard-line-budget-check.sh',
    'it0-dod-check.sh', 'it0-dogfood-evidence-gate.sh', 'it0-gate-hash-check.sh',
    'it0-impl-row-check.sh', 'tree-hygiene-check.sh', 'vmeta-lag-check.sh',
    'worktree-branch-hygiene-check.sh',
  ];
  assert.equal(retired.length, 14, 'the retired set must be the 14 classic-pipeline era gate scripts');
  for (const f of retired) {
    assert.ok(fs.existsSync(path.join(gateDir, f)), `plugin/gate-scripts/${f} must remain in tree (retired, not deleted)`);
  }
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
