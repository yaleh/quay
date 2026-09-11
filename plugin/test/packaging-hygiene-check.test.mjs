// @test-group engine
// packaging-hygiene-check.test.mjs — gap-packaging-hygiene-standing-check: the standing packaging-
// hygiene check (config-key consumer + shipped-entry runnable) and its quality-gate-driver routine.
//
// Coverage:
//   ① the check CLI detects config-key drift (an orphan key ⇒ fail / drift) and is green when wired;
//   ② the check CLI detects shipped-entry drift via the --shipped-entry-test seam (test red ⇒ fail);
//   ③ runPackagingHygiene emits the three-state Fact (verified / failed / not-evaluated) — and on
//      drift spawns a gap-filing agent (gapFiled=true, prompt captured by the --gap-worker-cmd seam),
//      which is exactly AC3's "drift ⇒ a filed gap task, not just a log line".
//
// Run: node --test plugin/test/packaging-hygiene-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runPackagingHygiene, buildPackagingGapWorkerPrompt } from '../scripts/quality-gate-driver.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHECK = path.join(REPO_ROOT, 'plugin', 'scripts', 'packaging-hygiene-check.ts');

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

/** A passing shipped-entry fake test (the --shipped-entry-test seam target for config-key-only tests). */
function writePassingTest(dir) {
  const p = path.join(dir, 'shipped-entry-fake.test.mjs');
  fs.writeFileSync(p, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => { assert.equal(1, 1); });\n", 'utf8');
  return p;
}

/** A failing shipped-entry fake test (drift signal: node --test exits non-zero). */
function writeFailingTest(dir) {
  const p = path.join(dir, 'shipped-entry-fake.test.mjs');
  fs.writeFileSync(p, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('broken', () => { assert.deepEqual(['bin/quay.js: not a declared bin'], []); });\n", 'utf8');
  return p;
}

/** A fixture workspace for the config-key dimension: quay-init.sh writer face + one consumer.ts. */
function writeConfigFixture(dir, { orphan = false } = {}) {
  fs.mkdirSync(path.join(dir, 'plugin', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages', 'quay', 'src'), { recursive: true });
  const lines = ['loop:', '  consumer_key: present'];
  if (orphan) lines.push('  orphan_key: orphan');
  lines.push('EOF');
  fs.writeFileSync(path.join(dir, 'plugin', 'scripts', 'quay-init.sh'), lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'plugin', 'scripts', 'consumer.ts'), 'export const v = "consumer_key";\n', 'utf8');
}

function runCheck(root, extra = []) {
  return spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-strip-types', CHECK, '--root', root, '--json', '--no-build', ...extra],
    { encoding: 'utf8', timeout: 60_000 },
  );
}

function parseReport(out) {
  return JSON.parse(out.stdout.trim());
}

// ── ① config-key dimension (CLI) ────────────────────────────────────────────────────────────────

test('config-key dimension: a delivered key with no consumer ⇒ exit 1 + drift', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-cfg-drift-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeConfigFixture(tmp, { orphan: true });
  writePassingTest(tmp);
  const r = runCheck(tmp, ['--shipped-entry-test', path.join(tmp, 'shipped-entry-fake.test.mjs')]);
  assert.equal(r.status, 1, `orphan key must fail the check (stderr: ${r.stderr})`);
  const rep = parseReport(r);
  assert.equal(rep.status, 'fail');
  assert.deepEqual(rep.configKeys.noConsumerToWire, ['orphan_key']);
  assert.ok(rep.drift.some((d) => d.includes('orphan_key')), 'drift list must name the orphan key');
});

test('config-key dimension: every delivered key wired ⇒ exit 0 (clean)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-cfg-clean-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeConfigFixture(tmp);
  writePassingTest(tmp);
  const r = runCheck(tmp, ['--shipped-entry-test', path.join(tmp, 'shipped-entry-fake.test.mjs')]);
  assert.equal(r.status, 0, `wired keys must pass (stderr: ${r.stderr})`);
  const rep = parseReport(r);
  assert.equal(rep.status, 'pass');
  assert.deepEqual(rep.drift, []);
});

// ── ② shipped-entry dimension (CLI) ─────────────────────────────────────────────────────────────

test('shipped-entry dimension: a red test ⇒ exit 1 + drift', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-ship-drift-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeConfigFixture(tmp);
  writeFailingTest(tmp);
  const r = runCheck(tmp, ['--shipped-entry-test', path.join(tmp, 'shipped-entry-fake.test.mjs')]);
  assert.equal(r.status, 1, `red shipped-entry test must fail the check (stderr: ${r.stderr})`);
  const rep = parseReport(r);
  assert.equal(rep.shippedEntries.state, 'failed');
  assert.ok(rep.drift.some((d) => d.includes('shipped-entry')), 'drift list must mention shipped-entry');
});

test('shipped-entry dimension: missing dist with no --no-build ⇒ not-evaluated (⛔ not clean)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-ship-nodist-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeConfigFixture(tmp);
  // no dist + no build script ⇒ buildDist fails ⇒ shipped-entry not-evaluated, ⛔ never a hollow clean.
  const r = runCheck(tmp);
  assert.equal(r.status, 3, 'unbuildable dist must be not-evaluated (exit 3), not pass');
  const rep = parseReport(r);
  assert.equal(rep.shippedEntries.state, 'not-evaluated');
  assert.equal(rep.status, 'not-evaluated');
});

// ── ③ the driver routine (runPackagingHygiene) ──────────────────────────────────────────────────

const CLEAN_JSON = '{"mode":"packaging-hygiene-audit","configKeys":{"keysTotal":1,"noConsumerToWire":[],"state":"verified"},"shippedEntries":{"state":"verified","violations":[],"reason":null},"drift":[]}';
const DRIFT_JSON = '{"mode":"packaging-hygiene-audit","configKeys":{"keysTotal":2,"noConsumerToWire":["orphan_key"],"state":"verified"},"shippedEntries":{"state":"verified","violations":[],"reason":null},"drift":["config-key orphan_key: delivered with no code consumer"]}';

function fakeCheckScript(dir, json) {
  const p = path.join(dir, 'fake-check.js');
  fs.writeFileSync(p, `process.stdout.write(${JSON.stringify(json)});`, 'utf8');
  return p;
}

function fakeGapCaptureScript(dir, markerFile) {
  const p = path.join(dir, 'fake-gap-capture.js');
  fs.writeFileSync(p, `require('fs').writeFileSync(${JSON.stringify(markerFile)}, process.argv[2] ?? '');`, 'utf8');
  return p;
}

test('runPackagingHygiene clean ⇒ verified (no gap-filing)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-clean-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, CLEAN_JSON);
  const fact = await runPackagingHygiene(tmp, { checkCmd: ['node', check] });
  assert.equal(fact.name, 'packaging-hygiene');
  assert.equal(fact.state, 'verified');
  assert.equal(fact.value.gapFiled, false);
  assert.deepEqual(fact.value.drift, []);
});

test('runPackagingHygiene drift ⇒ failed + gap-filing spawned (AC3)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-drift-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, DRIFT_JSON);
  const marker = path.join(tmp, 'prompt.txt');
  const capture = fakeGapCaptureScript(tmp, marker);
  // resourceGateArgv 必须注入：不传 ⇒ resourceGateCheck 跑【真实】的 resource-gate.sh，其 load 判据
  // （load >= nproc×LOAD_OVER_FACTOR，gap-resource-gate-psi-does-not-capture-load-flake-driver）在
  // 全量 suite 的 26 路并发下会返回 WAIT ⇒ gapFiled 按设计为 false ⇒ 本用例恒红。这是一条
  // 【宿主负载相关】的单元测试，不是 AC3 的判据（8 个同族 goal-* 测试文件全部注入，本文件此前是唯一例外）。
  const fact = await runPackagingHygiene(tmp, {
    checkCmd: ['node', check],
    gapWorkerCmd: `node ${capture}`,
    gapWorkerTimeoutMs: 10_000,
    resourceGateArgv: ['true'],
  });
  assert.equal(fact.name, 'packaging-hygiene');
  assert.equal(fact.state, 'failed');
  assert.equal(fact.value.gapFiled, true, 'drift must trigger gap-filing');
  assert.equal(fact.value.gapExitCode, 0);
  const prompt = fs.readFileSync(marker, 'utf8');
  assert.ok(prompt.includes('orphan_key'), 'gap-filing prompt must name the drift item');
  assert.ok(prompt.includes('quay-file-task'), 'gap-filing prompt must route through quay-file-task');
});

test('runPackagingHygiene drift + resource-gate WAIT ⇒ failed but gap-filing deferred (AC150-1 同族)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-wait-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, DRIFT_JSON);
  const marker = path.join(tmp, 'prompt.txt');
  const capture = fakeGapCaptureScript(tmp, marker);
  const fact = await runPackagingHygiene(tmp, {
    checkCmd: ['node', check],
    gapWorkerCmd: `node ${capture}`,
    gapWorkerTimeoutMs: 10_000,
    resourceGateArgv: ['bash', '-c', 'exit 1'],   // WAIT（非 0 退出）——同 goal-driver.test.mjs 的负控制
  });
  assert.equal(fact.state, 'failed', 'WAIT defers the spawn, ⛔ 不把 drift 吞掉（三态不得压平）');
  assert.equal(fact.value.gapFiled, false, 'resource-gate WAIT must defer the gap-filing spawn');
  assert.ok(!fs.existsSync(marker), 'no gap-filing spawn ⇒ no captured prompt');
  assert.ok(/deferred/.test(fact.reason ?? ''), 'reason must carry the deferral cause, ⛔ not a bare "failed"');
});

test('runPackagingHygiene halted ⇒ drift reported but gap-filing deferred (halt is a round-internal gate)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-halt-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, DRIFT_JSON);
  const marker = path.join(tmp, 'prompt.txt');
  const capture = fakeGapCaptureScript(tmp, marker);
  const fact = await runPackagingHygiene(tmp, {
    checkCmd: ['node', check],
    gapWorkerCmd: `node ${capture}`,
    gapWorkerTimeoutMs: 10_000,
    halted: true,
  });
  assert.equal(fact.state, 'failed');
  assert.equal(fact.value.gapFiled, false, 'halted must defer the gap-filing spawn');
  assert.ok(!fs.existsSync(marker), 'no gap-filing spawn ⇒ no captured prompt');
});

// 同族 goal-driver.test.mjs 的资源门负控制（`resourceGateArgv: ['bash','-c','exit 1']`）：drift 仍然
// 报 failed（⛔ 不被资源门吞掉），但 gap-filing 延后 —— 资源门是 fail-closed 的【推迟】不是静默 no-op。
test('runPackagingHygiene drift + resource-gate WAIT ⇒ failed reported, gap-filing deferred', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-gate-wait-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, DRIFT_JSON);
  const marker = path.join(tmp, 'prompt.txt');
  const capture = fakeGapCaptureScript(tmp, marker);
  const fact = await runPackagingHygiene(tmp, {
    checkCmd: ['node', check],
    gapWorkerCmd: `node ${capture}`,
    gapWorkerTimeoutMs: 10_000,
    resourceGateArgv: ['bash', '-c', 'exit 1'],
  });
  assert.equal(fact.state, 'failed', 'a WAIT must not swallow the drift verdict');
  assert.equal(fact.value.gapFiled, false, 'resource-gate WAIT must defer the gap-filing spawn');
  assert.equal(fact.value.gapExitCode, null);
  assert.ok(!fs.existsSync(marker), 'no gap-filing spawn ⇒ no captured prompt');
});

test('runPackagingHygiene unparseable check output ⇒ not-evaluated (硬规则 3b)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-hyg-bad-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const check = fakeCheckScript(tmp, 'not json at all');
  const fact = await runPackagingHygiene(tmp, { checkCmd: ['node', check] });
  assert.equal(fact.state, 'not-evaluated');
  assert.equal(fact.value, null);
});

test('buildPackagingGapWorkerPrompt lists every drift item (gap-filing evidence surface)', () => {
  const prompt = buildPackagingGapWorkerPrompt('/repo', ['a', 'b']);
  assert.ok(prompt.includes('a') && prompt.includes('b'));
  assert.ok(prompt.includes('quay-file-task'));
});
