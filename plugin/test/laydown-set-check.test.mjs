// @test-group governance
// laydown-set-check.test.mjs — gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.
//
// Pins the cold-start gate criterion: gate = "the DERIVED laydown set's scripts are green"
// (铺什么验什么), NOT "the whole quay suite is green". Unrelated suite failures must NOT block a cold
// start; a failure INSIDE the set (e.g. the M3 session-liveness busy/idle regression) MUST block.
//   AC1 — the gate is scoped to the derived laydown set (`laydown_set_green` green/red field); the
//         default check is exactly the set's members (exists + parses) — an unrelated failure
//         elsewhere (dist build, missing `.quay/config.yml` in a fresh worktree) never enters it.
//   AC2 — the set is MECHANICALLY derived via grep plugin/skills/*/SKILL.md + plugin/loop/*.md (the
//         same grep quay-init.sh derive_loop_scripts() step (a) uses — no new mechanism). The
//         derivation is not a hand-maintained list.
//   AC4 — session-liveness.sh + session-liveness-mount.sh are BOTH derived members (this wait was
//         correct — cold-start would have shipped the M3 regression); the real repo reports green.
//   AC4 negative — a missing / non-parsing member in a fake plugin root ⇒ `laydown_set_green: red`.
//   AC4 deep — a member whose OWN test fails (the M3 class of logic regression a syntax check cannot
//         see) turns the gate red under `--run-tests`, while unrelated failures cannot.
//   AC6 — this file is node:test and declares // @test-group governance.
//
// Run:
//   scripts/test.sh plugin/test/laydown-set-check.test.mjs
//   node --test plugin/test/laydown-set-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');
const checkScript = path.join(pluginDir, 'scripts', 'laydown-set-check.sh');

function runCheck(args = [], opts = {}) {
  return spawnSync('bash', [checkScript, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
    env: { ...process.env, ...opts.env },
  });
}

function makeFakePlugin(scriptRefs, scriptFiles = {}, testFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laydown-fake-'));
  fs.mkdirSync(path.join(dir, 'plugin', 'skills', 'cold-start'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'plugin', 'loop'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'plugin', 'scripts'), { recursive: true });
  if (Object.keys(testFiles).length > 0) fs.mkdirSync(path.join(dir, 'plugin', 'test'), { recursive: true });
  const skill = scriptRefs.map((r) => `run \`bash <root>/${r}\``).join('\n');
  fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'cold-start', 'SKILL.md'), skill);
  fs.writeFileSync(path.join(dir, 'plugin', 'loop', 'orchestrator-loop-tick.md'), '# tick\n');
  for (const [name, content] of Object.entries(scriptFiles)) {
    fs.writeFileSync(path.join(dir, 'plugin', 'scripts', name), content);
  }
  for (const [name, content] of Object.entries(testFiles)) {
    fs.writeFileSync(path.join(dir, 'plugin', 'test', name), content);
  }
  return dir;
}

test('AC2 — the laydown set is mechanically derived (grep skills/loop docs) and contains the session-liveness pair', () => {
  assert.ok(fs.existsSync(checkScript), 'laydown-set-check.sh must exist');
  // AC2 — the derivation must be the documented grep (no new mechanism), asserted by the script's own
  // --list output: every member must be a `plugin/scripts/` reference found in a skill or loop doc.
  const r = runCheck(['--root', repoRoot, '--list']);
  assert.equal(r.status, 0, `check must exit 0 on the real repo:\n${r.stderr}`);
  assert.match(r.stdout, /derived_set:/, 'must print the derived set under --list');
  assert.match(r.stdout, /^  session-liveness\.sh$/m, 'session-liveness.sh must be a derived member');
  assert.match(r.stdout, /^  session-liveness-mount\.sh$/m, 'session-liveness-mount.sh must be a derived member');
  // AC2 — the derivation must actually be driven by the docs' references: the members printed under
  // --list are exactly the grep output over plugin/skills/*/SKILL.md + plugin/loop/*.md.
  const grepped = spawnSync('bash', ['-c',
    `grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' "${repoRoot}"/plugin/skills/*/SKILL.md "${repoRoot}"/plugin/loop/*.md | sed 's#^plugin/scripts/##' | sort -u`],
    { encoding: 'utf8', cwd: repoRoot });
  assert.equal(grepped.status, 0, 'the reference grep must succeed');
  const expected = grepped.stdout.split('\n').filter(Boolean);
  assert.ok(expected.length >= 2, 'the doc-derived set must be non-empty');
  for (const m of expected) {
    assert.match(r.stdout, new RegExp(`^  ${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      `derived member ${m} must appear in --list (derivation = docs' references)`);
  }
});

test('AC1/AC4 — the gate reports `laydown_set_green: green` for the real repo (scoped to the set, not the whole suite)', () => {
  const r = runCheck(['--root', repoRoot]);
  assert.equal(r.status, 0, `real repo must be green:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^laydown_set_green: green$/m,
    'the Contract measure field must read green for a healthy laydown set');
  assert.match(r.stdout, /^scripts_derived: \d+$/m, 'must report the derived-set size');
  assert.match(r.stdout, /^syntax_ok: yes$/m, 'all derived members must parse');
  assert.match(r.stdout, /^tests_resolved: \d+$/m,
    'must resolve (and report) the set\'s own test files — 铺什么验什么');
});

test('AC4 negative — a MISSING derived member blocks the cold start (red)', () => {
  const dir = makeFakePlugin(['plugin/scripts/broken.sh']);
  try {
    const r = runCheck(['--root', dir, '--list']);
    assert.notEqual(r.status, 0, 'a missing member must exit non-zero (red)');
    assert.match(r.stdout, /^laydown_set_green: red$/m, 'the measure field must read red');
    assert.match(r.stdout, /MISSING: plugin\/scripts\/broken\.sh/, 'must name the missing member');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC4 negative — a NON-PARSING derived member blocks the cold start (red)', () => {
  const dir = makeFakePlugin(
    ['plugin/scripts/bad.sh'],
    { 'bad.sh': '#!/usr/bin/env bash\nif [[ ${this is not valid bash\n' },
  );
  try {
    const r = runCheck(['--root', dir, '--list']);
    assert.notEqual(r.status, 0, 'a non-parsing member must exit non-zero (red)');
    assert.match(r.stdout, /^laydown_set_green: red$/m, 'the measure field must read red');
    assert.match(r.stdout, /SYNTAX: plugin\/scripts\/bad\.sh/, 'must name the non-parsing member');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC4 deep — a member whose OWN test fails (the M3 class) blocks under `--run-tests`', () => {
  const dir = makeFakePlugin(
    ['plugin/scripts/foo.sh'],
    { 'foo.sh': '#!/usr/bin/env bash\necho ok\n' },
    { 'foo.test.mjs': "import { test } from 'node:test';\ntest('boom', () => { throw new Error('m3-class regression'); });\n" },
  );
  try {
    const r = runCheck(['--root', dir, '--run-tests']);
    assert.notEqual(r.status, 0, 'a failing member test must exit non-zero (red) under --run-tests');
    assert.match(r.stdout, /^laydown_set_green: red$/m, 'the measure field must read red');
    assert.match(r.stdout, /TESTS:/, 'must report the failing test run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC6 — this file is node:test with a governance @test-group (self-evident)', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.match(src, /^\/\/ @test-group governance/m, 'declares @test-group governance');
  assert.match(src, /import \{ test \} from 'node:test'/, 'uses node:test');
});
