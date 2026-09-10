// @test-group engine
// laydown-set-check.test.mjs — gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.
//
// Pins the cold-start gate's Contract:
//   measure   laydown_set_green = `bash plugin/scripts/laydown-set-check.sh` stdout 的 绿/红 字段
//   invariant lay_what_you_verify = 1（gate 集合 = 派生铺设集，机械派生；不静默回退到整个套件）
//   control   铺设集外失败 ⇒ 不阻塞冷启动（AC4 负向）；铺设集内失败（如 M3 session-liveness）⇒ 阻塞
//
// AC1  — 冷启动 gate = 派生铺设集内脚本全绿（铺什么验什么），非「整个套件绿」：gate 只跑铺设集的
//        测试文件，铺设集外的测试（哪怕是红的）不参与判定。
// AC2  — 铺设集机械派生：helper CALLS quay-init.sh 的 `derive_loop_scripts()`（单一正本，无手写清单，
//        漂移免疫）——不再是自己复刻的 grep。测试断言 helper 的派生集 == derive_loop_scripts() 输出。
// AC3  — 静态检查：laydown-set-check.sh 里不存在独立的 `grep ... plugin/scripts/` 派生（必须调用
//        derive_loop_scripts，不得自己再枚举），防止未来再分裂出第三份实现。
// AC4  — 真实使用：session-liveness.sh / session-liveness-mount.sh 在铺设集内（M3 回归会随铺扩散，
//        所以本次等待正确）；铺设集外失败不阻塞。
// AC6  — 本测试用 node:test 且带 `// @test-group engine`。
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
const HELPER = path.join(pluginDir, 'scripts', 'laydown-set-check.sh');

function runHelper(args, opts = {}) {
  return spawnSync('bash', [HELPER, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || repoRoot,
  });
}

// deriveViaQuayInit() — the SINGLE source of truth for "该落地哪些脚本": SOURCE quay-init.sh in its
// library mode (the guard stops before the install flow) and call derive_loop_scripts() directly.
// Mirrors the runSourced pattern in quay-init.test.mjs (gap-quay-init-reduce-real-install-count).
function deriveViaQuayInit() {
  const script = '_fargs=("$@")\nset --\nsource "$QUAY_INIT_SCRIPT"\nderive_loop_scripts';
  const r = spawnSync('bash', ['-c', script, 'quay-init-sourced'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginDir,
      QUAY_INIT_SCRIPT: path.join(pluginDir, 'scripts', 'quay-init.sh'),
    },
  });
  assert.equal(r.status, 0, `derive_loop_scripts() must run when sourced:\n${r.stderr}`);
  return r.stdout.trim().split('\n').filter(Boolean).sort();
}

function makeFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lsc-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function writeFixtureFiles(root, { skillRefs, loopRefs, tests }) {
  fs.mkdirSync(path.join(root, 'plugin', 'skills', 'fake'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'loop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'skills', 'fake', 'SKILL.md'),
    '---\nname: fake\n---\nRun ' + skillRefs.map((r) => `bash ${r}`).join(' and ') + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'plugin', 'loop', 'fake-loop.md'),
    'Execute ' + loopRefs.map((r) => `${r}`).join(' and ') + '\n', 'utf8');
  for (const [name, body] of Object.entries(tests)) {
    fs.writeFileSync(path.join(root, 'plugin', 'test', name), body, 'utf8');
  }
}

const PASSING_TEST = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('passes', () => { assert.equal(1, 1); });\n`;
const FAILING_TEST = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fails', () => { assert.equal(1, 2); });\n`;

// ── AC2: 机械派生 == quay-init.sh 同一派生源（漂移免疫，无手写清单）──────────────────────────────
test('AC2 — the helper derives the laydown set by CALLING quay-init.sh derive_loop_scripts() (single source)', () => {
  assert.ok(fs.existsSync(HELPER), 'laydown-set-check.sh must exist in plugin/scripts/');
  const list = runHelper(['--list', '--json']);
  assert.equal(list.status, 0, `--list must exit 0:\n${list.stderr}`);
  const parsed = JSON.parse(list.stdout);
  assert.ok(Array.isArray(parsed.scripts), '--list --json must expose scripts[]');
  assert.ok(parsed.derived_scripts > 0, 'the derived set must be non-empty');

  // 单一正本：helper 的派生集 == quay-init.sh derive_loop_scripts() 的完整输出（不再是自己复刻的 grep）。
  const quayDerived = deriveViaQuayInit();
  assert.deepEqual(parsed.scripts, quayDerived,
    'helper derived set must EQUAL quay-init derive_loop_scripts() (single source, no second list)');
});

// ── AC3: 静态检查 ——「该落地什么」只有一处实现（laydown-set-check.sh 调用 derive_loop_scripts，不得自己重枚举）──
test('AC3 — laydown-set-check.sh has NO independent derivation; it CALLS derive_loop_scripts (single implementation)', () => {
  const src = fs.readFileSync(HELPER, 'utf8');
  // 唯一实现 = quay-init.sh 的 derive_loop_scripts；本脚本必须调用它。
  assert.match(src, /derive_loop_scripts/,
    'laydown-set-check.sh must CALL quay-init.sh\'s derive_loop_scripts (the single implementation)');
  // 独立重枚举的特征 = 本脚本自己跑 `grep -ohE 'plugin/scripts/…'` 的派生；必须不存在。
  assert.doesNotMatch(src, /grep\s+-ohE\s+'plugin\/scripts\//,
    'laydown-set-check.sh must NOT re-enumerate via its own grep (the old independent derivation)');
});

test('AC4 — the retired observer scripts are NOT in the derived set (deleted, no referenced-not-landed)', () => {
  const list = runHelper(['--list', '--json']);
  assert.equal(list.status, 0);
  const parsed = JSON.parse(list.stdout);
  const all = [...parsed.scripts];
  assert.ok(!all.includes('session-liveness.sh'),
    'session-liveness.sh must NOT be in the derived laydown set (retired 2026-09-03)');
  assert.ok(!all.includes('session-liveness-mount.sh'),
    'session-liveness-mount.sh must NOT be in the derived laydown set (retired)');
  assert.ok(!all.includes('monitor-mount-check.sh'),
    'monitor-mount-check.sh must NOT be in the derived laydown set (retired)');
});

// ── AC1/AC4: 铺设集内全绿 ⇒ green（可铺）；铺设集内失败 ⇒ red（阻塞）────────────────────────────
test('AC1/AC4 — derived-set tests all pass ⇒ laydown_set_green: green, exit 0', () => {
  const fx = makeFixture();
  try {
    writeFixtureFiles(fx, {
      skillRefs: ['plugin/scripts/fake-a.sh'],
      loopRefs: ['plugin/scripts/fake-b.ts'],
      tests: { 'fake-a.test.mjs': PASSING_TEST, 'fake-b.test.mjs': PASSING_TEST },
    });
    const r = runHelper(['--root', fx, '--json']);
    assert.equal(r.status, 0, `green fixture must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.laydown_set_green, 'green', `expected green, got: ${r.stdout}`);
    assert.equal(j.fail, 0);
    assert.ok(j.test_files_run.includes('plugin/test/fake-a.test.mjs'));
    assert.ok(j.test_files_run.includes('plugin/test/fake-b.test.mjs'));
  } finally { cleanup(fx); }
});

test('AC1 early-red immunity — a RED shared .quay/full-suite-state.json in the fixture root does NOT flip the laydown gate (the cold-start gate never reads the suite state)', () => {
  // gap-streaming-red-cascade-amplifies-failures-array AC1/AC4 — round 130 mis-attributed a cascade
  // failure to this file; the cold-start gate (laydown-set-check.sh) reads ONLY the derived laydown
  // set's test results, never `.quay/full-suite-state.json`. A red shared state in the fixture root
  // (the round-130 early-red shape) must leave a green derived set green — the gate is immune to
  // cascade by construction (its AC1 asserts "铺什么验什么", not "整个套件绿").
  const fx = makeFixture();
  try {
    writeFixtureFiles(fx, {
      skillRefs: ['plugin/scripts/fake-a.sh'],
      loopRefs: ['plugin/scripts/fake-b.ts'],
      tests: { 'fake-a.test.mjs': PASSING_TEST, 'fake-b.test.mjs': PASSING_TEST },
    });
    // Simulate the early-red shared state the runner writes mid-round (state=red + finishedAt null).
    fs.mkdirSync(path.join(fx, '.quay'), { recursive: true });
    fs.writeFileSync(path.join(fx, '.quay', 'full-suite-state.json'),
      JSON.stringify({ state: 'red', reason: 'failed', finishedAt: null, failures: [{ file: 'plugin/test/checker-cost.test.mjs' }] }, null, 2),
      'utf8');
    const r = runHelper(['--root', fx, '--json']);
    assert.equal(r.status, 0, `green fixture must stay green even with a red shared state:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.laydown_set_green, 'green', 'the laydown gate verdict is independent of the shared suite-state (cascade-immune)');
  } finally { cleanup(fx); }
});

test('AC4 positive control — a FAILING derived-set test ⇒ red, exit 1 (blocks cold-start)', () => {
  const fx = makeFixture();
  try {
    writeFixtureFiles(fx, {
      skillRefs: ['plugin/scripts/fake-a.sh'],
      loopRefs: ['plugin/scripts/fake-b.ts'],
      tests: { 'fake-a.test.mjs': PASSING_TEST, 'fake-b.test.mjs': FAILING_TEST },
    });
    const r = runHelper(['--root', fx, '--json']);
    assert.equal(r.status, 1, `red fixture must exit 1:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.laydown_set_green, 'red');
    assert.ok(j.fail >= 1);
  } finally { cleanup(fx); }
});

// ── AC4 负向: 铺设集外的失败不阻塞（gate 只跑铺设集，不跑整个套件）────────────────────────────
test('AC4 negative — a failing test OUTSIDE the derived set does NOT block (whole-suite red ≠ cold-start red)', () => {
  const fx = makeFixture();
  try {
    writeFixtureFiles(fx, {
      skillRefs: ['plugin/scripts/fake-a.sh'],
      loopRefs: ['plugin/scripts/fake-b.ts'],
      tests: {
        'fake-a.test.mjs': PASSING_TEST,
        'fake-b.test.mjs': PASSING_TEST,
        'unrelated.test.mjs': FAILING_TEST, // 红，但不在铺设集里（没被任何 skill/loop 文档引用）
      },
    });
    const r = runHelper(['--root', fx, '--json']);
    assert.equal(r.status, 0, `unrelated-red fixture must stay green:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.laydown_set_green, 'green');
    assert.ok(!j.test_files_run.includes('plugin/test/unrelated.test.mjs'),
      'the gate must NOT run tests outside the derived set');
  } finally { cleanup(fx); }
});

// ── 负控制: 不静默回退到整个套件（0 测试文件 ⇒ fail-closed red）─────────────────────────────────
test('adversarial — 0 test files resolved ⇒ fail-closed red, NEVER a whole-suite fallback', () => {
  const fx = makeFixture();
  try {
    writeFixtureFiles(fx, {
      skillRefs: ['plugin/scripts/untested.sh'],
      loopRefs: ['plugin/scripts/untested.sh'],
      tests: {},
    });
    const r = runHelper(['--root', fx, '--json']);
    assert.equal(r.status, 1, `no-test fixture must fail closed (exit 1):\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.laydown_set_green, 'red');
    assert.match(j.reason, /never falls back to the whole suite/i,
      'the reason must state the no-whole-suite-fallback invariant');
    assert.ok(Array.isArray(j.test_files_run) && j.test_files_run.length === 0,
      'fail-closed must run ZERO test files (never the whole suite)');
    assert.ok(j.no_test_scripts.includes('untested.sh'), 'the no-test script must be reported');
  } finally { cleanup(fx); }
});

// ── 用法错误 ⇒ exit 2 ─────────────────────────────────────────────────────────────────────────────
test('usage — a bad --root fails with exit 2 (fail-closed on misuse, not a silent green)', () => {
  const r = runHelper(['--root', '/nonexistent/not-a-repo']);
  assert.equal(r.status, 2, 'a non-repo --root must be a usage error (exit 2)');
});
