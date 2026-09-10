// @test-group engine
// criterion-fidelity-gate.test.mjs — AC-229 (tasks/gap-criterion-fidelity-gate-activation-blind-
// to-vacuous-criteria) + gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests 的
// AC1 可见性半边：保真性闸接在【真实激活路径】上——测试 spawn 真的 goal-store.ts CLI 对一个
// hermetic 临时 goals 目录（⛔ 不是只 import 判定函数做单测，硬规则 4 推论三：生产载体就是激活路径本身），
// 方向缺一不可：
//   ① vacuous       ⇒ 拒绝激活（非零退出 + 不写状态 + 理由可见于 stderr）
//   ② faithful      ⇒ 放行（exit 0 + 状态确实变 active —— 防「恒拒」的负控制）
//   ③ not-evaluated ⇒ 不放行，且与 vacuous 取值可区分（stderr 理由含不同词）
//   ④ --force       ⇒ 越权，且越权在记录里留痕（fidelity.verdict === "forced"）
//   ⑤ 无 seam       ⇒ 激活仍放行（fail-open），但记录留 `not-evaluated / "no judge configured"`（可见性）
//   ⑥ --fidelity-judge-argv（JSON argv 数组）⇒ 与 env seam 同效（robust 形态：带空格的 argv 也能过）
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const goalStorePath = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

// 保真性闸的注入 seam（QUAY_GOAL_FIDELITY_JUDGE）：一个 argv 前缀，prompt 作末参数追加。三个假判定器
// —— ⛔ 全用无空格的 JS，避免 splitArgs 语义下的引号剥层问题。
const JUDGE_VACUOUS = `node -e process.stdout.write(JSON.stringify({verdict:"vacuous"}))`;
const JUDGE_FAITHFUL = `node -e process.stdout.write(JSON.stringify({verdict:"faithful"}))`;
const JUDGE_UNREADABLE = `node -e process.stdout.write("not-a-verdict")`;

/** Hermetic temp workspace：建 goals/ 并落一条 draft AC。 */
function makeWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'criterion-fidelity-gate-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  return tmp;
}

function writeDraftAc(tmp, { id = 'AC-901', goal = 'GOAL-001', criterion = 'true', expect = 'the criterion measures X', status = 'draft' } = {}) {
  const lines = [
    '---', `id: ${id}`, 'title: t', `status: ${status}`, 'kind: criterion', `goal: ${goal}`,
    'criterion: |', `  ${criterion}`, 'expect: >-', `  ${expect}`, 'origin: test fixture', '---', '',
  ];
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 读该 AC 落盘的原始 frontmatter 文件内容（⛔ 不经过 view-model，直读载体）。 */
function readRecordFile(tmp, id) {
  const f = fs.readdirSync(path.join(tmp, 'goals')).find((n) => n.startsWith(`${id}-`) || n.startsWith(`${id}.md`));
  return f ? fs.readFileSync(path.join(tmp, 'goals', f), 'utf8') : null;
}

/** spawn 真 goal-store CLI 激活一条 AC。judge===undefined ⇒ 不注入 env seam；judgeArgv 给定时经
 *  `--fidelity-judge-argv`（JSON argv 数组）注入 robust seam。 */
function activate(tmp, id, { judge = undefined, judgeArgv = undefined, force = false } = {}) {
  const args = ['--no-warnings', '--experimental-strip-types', goalStorePath, 'write', id, '--status', 'active', '--root', tmp];
  if (force) args.push('--force');
  if (judgeArgv !== undefined) args.push('--fidelity-judge-argv', JSON.stringify(judgeArgv));
  const env = { ...process.env };
  if (judge === undefined) delete env.QUAY_GOAL_FIDELITY_JUDGE;
  else env.QUAY_GOAL_FIDELITY_JUDGE = judge;
  return spawnSync('node', args, { encoding: 'utf8', env });
}

// ── ① vacuous ⇒ 拒绝激活 ──────────────────────────────────────────────────

test('① vacuous ⇒ 拒绝激活：非零退出 + 不写状态 + 理由可见于 stderr', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_VACUOUS });
    assert.notEqual(r.status, 0, 'vacuous ⇒ 非零退出');
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(raw, '记录文件仍存在');
    assert.ok(/^status: draft/m.test(raw), '⛔ 不写状态——记录仍是 draft，未变 active');
    assert.ok(!/^status: active/m.test(raw), '状态未翻 active');
    assert.ok(String(r.stderr).includes('vacuous'), `理由可见于 stderr（含 "vacuous"）：${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② faithful ⇒ 放行（防「恒拒」负控制）────────────────────────────────

test('② faithful ⇒ 放行：exit 0 + 状态确实变 active（防恒拒负控制）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_FAITHFUL });
    assert.equal(r.status, 0, `faithful ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), 'faithful ⇒ 状态确实变 active');
    assert.ok(raw.includes('fidelity:') && raw.includes('faithful'), '判定结果落在记录自身（fidelity.verdict=faithful）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ not-evaluated ⇒ 不放行，且与 vacuous 取值可区分 ──────────────────────

test('③ not-evaluated ⇒ 不放行，且与 vacuous 取值可区分（stderr 理由不同词）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_UNREADABLE });
    assert.notEqual(r.status, 0, 'not-evaluated ⇒ 非零退出');
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: draft/m.test(raw), 'not-evaluated ⇒ 不写状态');
    assert.ok(String(r.stderr).includes('not-evaluated'), `stderr 含 "not-evaluated"：${r.stderr}`);
    assert.ok(!String(r.stderr).includes('vacuous'), '⛔ 与 vacuous 取值可区分——not-evaluated 理由不含 "vacuous"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ④ --force ⇒ 越权，且越权在记录里留痕 ─────────────────────────────────

test('④ --force ⇒ 越权，且越权在记录里留痕（fidelity.verdict === "forced"）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901', criterion: 'true' });
    const r = activate(tmp, 'AC-901', { force: true });
    assert.equal(r.status, 0, `--force ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), '--force ⇒ 状态变 active');
    assert.ok(raw.includes('verdict: forced'), '⛔ 越权在记录里留痕（fidelity.verdict=forced）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑤ 无 seam ⇒ 放行（fail-open）但记录留「no judge configured」（可见性，AC1 半边）──────────

test('⑤ 无 seam（不注入 judge）⇒ 激活仍放行（fail-open），但记录留 not-evaluated/"no judge configured"（⛔ 非字段缺失）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901' });
    const r = activate(tmp, 'AC-901', { judge: undefined });
    assert.equal(r.status, 0, `无 seam ⇒ 既有路径 exit 0（fail-open）（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), '无 seam ⇒ 状态变 active（既有路径不变）');
    // 可见性（gap-fidelity-judge-unwired...）：字段不再缺失——「闸从未跑」在载体上与「闸跑过且放行」
    // 不同形（硬规则 3b）。
    assert.ok(raw.includes('verdict: not-evaluated'), '无 seam ⇒ 记录留 fidelity.verdict=not-evaluated（可见性，⛔ 字段缺失不算通过）');
    assert.ok(raw.includes('no judge configured'), '无 seam ⇒ reason 指明 "no judge configured"（可区分取值）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑥ --fidelity-judge-argv（JSON argv 数组，robust seam）⇒ 与 env seam 同效 ──────────

test('⑥ --fidelity-judge-argv（JSON argv 数组）⇒ 跑判定器：vacuous 拒绝、faithful 放行', () => {
  const tmpVacuous = makeWorkspace();
  try {
    writeDraftAc(tmpVacuous, { id: 'AC-901' });
    // 带空格的 argv 数组（robust 形态——env whitespace-split seam 承载不了的空格在此可过）。
    const judgeArgvVacuous = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"vacuous"}))'];
    const r = activate(tmpVacuous, 'AC-901', { judgeArgv: judgeArgvVacuous });
    assert.notEqual(r.status, 0, '--fidelity-judge-argv vacuous ⇒ 非零退出');
    const raw = readRecordFile(tmpVacuous, 'AC-901');
    assert.ok(/^status: draft/m.test(raw), 'vacuous ⇒ 不写状态（仍 draft）');
    assert.ok(String(r.stderr).includes('vacuous'), `stderr 含 "vacuous"：${r.stderr}`);
  } finally {
    fs.rmSync(tmpVacuous, { recursive: true, force: true });
  }

  const tmpFaithful = makeWorkspace();
  try {
    writeDraftAc(tmpFaithful, { id: 'AC-901' });
    const judgeArgvFaithful = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"faithful"}))'];
    const r = activate(tmpFaithful, 'AC-901', { judgeArgv: judgeArgvFaithful });
    assert.equal(r.status, 0, `--fidelity-judge-argv faithful ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmpFaithful, 'AC-901');
    assert.ok(/^status: active/m.test(raw), 'faithful ⇒ 状态变 active');
    assert.ok(raw.includes('verdict: faithful'), '判定结果落在记录自身（fidelity.verdict=faithful）');
  } finally {
    fs.rmSync(tmpFaithful, { recursive: true, force: true });
  }
});

// ── ⑦ achieved→active 重开也过保真性闸（gap-activation-gates-bypassed-on-reopen-path-…）──
// 改动前：`activating` 只认 draft→active ⇒ 重开路径（achieved/needs-human → active）三道闸一道不触发。
// 改动后：任何进入 active 的转换都触发保真性闸 ⇒ 重开记录必须留 fidelity.verdict（字段缺失不算通过）。

test('⑦ achieved→active 重开 ⇒ 保真性闸生效（faithful 放行 + fidelity.verdict 落记录）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901', status: 'achieved' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_FAITHFUL });
    assert.equal(r.status, 0, `achieved→active faithful ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), 'achieved→active ⇒ 状态确实变 active');
    assert.ok(raw.includes('fidelity:') && raw.includes('faithful'), '⛔ 字段缺失不算通过——fidelity.verdict=faithful 落记录');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('⑦b achieved→active 重开 + vacuous 判定器 ⇒ 拒绝激活（非零退出 + 不写状态）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901', status: 'achieved' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_VACUOUS });
    assert.notEqual(r.status, 0, 'achieved→active vacuous ⇒ 非零退出（闸能拒，非恒放行）');
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: achieved/m.test(raw), '⛔ 不写状态——记录仍是 achieved，未变 active');
    assert.ok(String(r.stderr).includes('vacuous'), `理由可见于 stderr（含 "vacuous"）：${r.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑧ needs-human→active（历史 3/5 的多数重开路径）也过保真性闸 ──────────────────────

test('⑧ needs-human→active 重开 ⇒ 保真性闸生效（faithful 放行 + fidelity.verdict 落记录）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901', status: 'needs-human' });
    const r = activate(tmp, 'AC-901', { judge: JUDGE_FAITHFUL });
    assert.equal(r.status, 0, `needs-human→active faithful ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), 'needs-human→active ⇒ 状态确实变 active');
    assert.ok(raw.includes('fidelity:') && raw.includes('faithful'), '⛔ needs-human 路径（历史 3/5）字段缺失不算通过');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑨ --force 重开也留痕（改动前该分支在重开路径不触发 ⇒ 静默越权）────────────────────

test('⑨ --force 重开（achieved→active）⇒ fidelity.verdict === "forced"（⛔ 静默越权被堵）', () => {
  const tmp = makeWorkspace();
  try {
    writeDraftAc(tmp, { id: 'AC-901', status: 'achieved' });
    const r = activate(tmp, 'AC-901', { force: true });
    assert.equal(r.status, 0, `--force 重开 ⇒ exit 0（stderr: ${r.stderr}）`);
    const raw = readRecordFile(tmp, 'AC-901');
    assert.ok(/^status: active/m.test(raw), '--force ⇒ 状态变 active');
    assert.ok(raw.includes('verdict: forced'), '⛔ --force 重开必须在记录里留痕（fidelity.verdict=forced）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
