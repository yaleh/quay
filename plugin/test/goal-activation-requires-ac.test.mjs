// @test-group engine
// goal-activation-requires-ac.test.mjs — tasks/gap-meta-goal-store-activation-gate:
// 活跃 GOAL 必须至少有一条 AC 的前置，必须落在【写面】（goal-store 的激活闸），不是落在某条读数上。
//
// 缺陷（本任务修复的）：goal-store 的两道激活闸逐字 `!isGoalRecord`——它们问的是「这条 CRITERION
// 能不能跑 / 能不能取假」，对 GOAL 记录一条都不问；GOAL 激活只查 body 长度（仅创建）与 active cap。
// 于是 GOAL-014 于 2026-09-12T00:33:10Z 以零 AC 被激活，违反已声明的 AC-217「活跃 GOAL 至少一条
// AC」，而分歧层只对【已存在】的 AC 迭代 ⇒ 零 AC 的目标在结构上产生零信号。
//
// 断言的是【写面行为】（真 spawn goal-store CLI，读退出码 / stderr / 落盘状态），⛔ 不读源码版式：
//   ① 零 AC 的 GOAL 激活 ⇒ fail-closed 拒绝（非 0 退出 + stderr 枚举名下 AC 数 = 0 + 盘上仍 draft）
//   ② 名下有 ≥1 AC 的 GOAL 激活 ⇒ 正常放行（取假控制：证明实现不是「恒拒 GOAL 激活」）
//   ③ 取假控制·作用域精确：闸的射程是 `{draft, active}` 这个【上界】，⛔ 不是「凡新 GOAL 一律要 AC」——
//      零 AC 的 GOAL 以 `--status superseded`（作用域之外）出生 ⇒ 仍放行
//      ⚠️ 2026-09-17 本条翻转（tasks/gap-goal-born-draft-zero-ac-escapes-standing-invariant）：它此前
//      断言「零 AC 的 draft GOAL 仍可创建、闸只卡在激活那一步」。AC-217 的作用域逐字是
//      `{draft, active}`，写面谓词扩到该作用域后，禁态在出生的第一步就不可达 ⇒ 旧断言的前提消失。
//      本文件仍测【转换】路径（它用先落盘 draft 文件再转换的形态布置前置，正是为旧载体/手写记录
//      保留的那条路径）；出生路径由 goal-create-as-active-requires-ac.test.mjs 覆盖。
//   ④ 取假控制：AC 的状态不参与计数（achieved 的 AC 也算「有 AC」——与读数同一条谓词，
//      ⛔ 实现不得自行收窄到「draft AC 才算」）
//   ⑤ 取假控制：计数按 `goal:` 名匹配，⛔ 不是「仓库里有 AC 就算」（别的 goal 的 AC 不算数）
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-activation-requires-ac.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const goalStorePath = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

/** 合法的 GOAL body（≥ MIN_GOAL_BODY_CHARS=40 非空白字符——创建路径的完整性契约）。 */
const GOAL_BODY = 'background / scope & non-goals / exit conditions —— 本 fixture 的 body 足够长。';

/** Hermetic temp workspace：goals/ + .quay/（⛔ 不碰真仓库的 goals/）。 */
function makeWorkspace() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activation-requires-ac-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  return tmp;
}

/** 直接落一条 GOAL/AC 记录文件（真 frontmatter，⛔ 不经 seam）。 */
function writeGoalFile(tmp, { id, status, kind = 'goal', goal }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (kind === 'criterion') {
    lines.push('criterion: |', '  true', 'expect: >-', '  the criterion measures X');
  } else {
    lines.push('body: >-', `  ${GOAL_BODY}`);
  }
  lines.push('origin: test fixture', '---', '', '## body', GOAL_BODY, '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

function readRecordFile(tmp, id) {
  const f = fs.readdirSync(path.join(tmp, 'goals')).find((n) => n.startsWith(`${id}-`) || n === `${id}.md`);
  return f ? fs.readFileSync(path.join(tmp, 'goals', f), 'utf8') : null;
}

/** spawn 真 goal-store CLI（写面），返回 { status, stdout, stderr }。 */
function goalStoreWrite(tmp, args) {
  const argv = ['--no-warnings', '--experimental-strip-types', goalStorePath, 'write', ...args, '--root', tmp];
  const env = { ...process.env };
  delete env.QUAY_GOAL_FIDELITY_JUDGE;
  return spawnSync('node', argv, { encoding: 'utf8', env });
}

// ── ① 零 AC 的 GOAL 激活 ⇒ fail-closed 拒绝（本任务的核心判据）────────────────────────────────

test('① 零 AC 的 GOAL 激活 ⇒ 非 0 退出 + stderr 枚举名下 AC 数 = 0 + 盘上仍 draft', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'draft' });
    const r = goalStoreWrite(tmp, ['GOAL-001', '--status', 'active']);
    assert.notEqual(r.status, 0, `零 AC 激活必须被拒（fail-closed），实际退出码 ${r.status}`);
    assert.ok(
      String(r.stderr).includes('0 AC records name it'),
      `stderr 必须枚举名下 AC 数 = 0（硬规则 3：枚举不布尔），实际：${r.stderr}`,
    );
    assert.ok(String(r.stderr).includes('GOAL-001'), `stderr 必须点名是哪条 GOAL，实际：${r.stderr}`);
    assert.ok(/^status: draft$/m.test(readRecordFile(tmp, 'GOAL-001')), '拒绝即不落盘：盘上仍是 draft');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② 名下有 ≥1 AC ⇒ 正常放行（取假控制：⛔ 实现不得是「恒拒 GOAL 激活」）──────────────────────

test('② 名下有 1 条 AC 的 GOAL 激活 ⇒ 放行（exit 0，盘上 active）', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'draft' });
    writeGoalFile(tmp, { id: 'AC-901', status: 'draft', kind: 'criterion', goal: 'GOAL-001' });
    const r = goalStoreWrite(tmp, ['GOAL-001', '--status', 'active']);
    assert.equal(r.status, 0, `有 AC ⇒ 放行（stderr: ${r.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'GOAL-001')), '状态确实落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ 取假控制·作用域精确：射程止于 {draft, active}，⛔ 不是「凡新 GOAL 一律要 AC」──────────────

test('③ 零 AC 的 GOAL 以 --status superseded 出生 ⇒ 仍放行（⛔ 闸的射程没有溢出作用域）', () => {
  const tmp = makeWorkspace();
  try {
    // ⚠️ 本条曾断言「零 AC 的 draft GOAL 仍可创建 ⇒ exit 0」——那是写面谓词只读 active 时的读数。
    //     作用域扩到 AC-217 自己声明的 {draft, active} 之后该断言的前提消失，故改用一个【在作用域
    //     之外】的状态来钉同一件事：闸没有顺手把「所有新 GOAL 都要 AC」也一并关上。
    //     实测同一命令行在 `achieved` / `retired` 上也是 exit 0；这里取 `superseded`——一条被否决的
    //     目标不需要退出条件，语义上最干净，且它一旦被过度收窄就会红。
    const r = goalStoreWrite(tmp, [
      'GOAL-002', '--status', 'superseded', '--title', 'new', '--origin', 'test fixture', '--body', GOAL_BODY,
    ]);
    assert.equal(r.status, 0, `作用域外的状态仍须放行（stderr: ${r.stderr}）`);
    assert.ok(/^status: superseded$/m.test(readRecordFile(tmp, 'GOAL-002')), '创建落成 superseded');
    // 同一条记录：出生放行 ≠ 能变 active——闸仍卡在进入 {draft, active} 那一步。
    const a = goalStoreWrite(tmp, ['GOAL-002', '--status', 'active']);
    assert.notEqual(a.status, 0, '同一条零 AC 记录激活仍必须被拒（证明 ③ 不是把闸整个关掉）');
    assert.ok(/^status: superseded$/m.test(readRecordFile(tmp, 'GOAL-002')), '仍 superseded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ④ 取假控制：AC 的状态不参与计数（achieved 的 AC 也算——与读数同一条谓词）──────────────────

test('④ 名下只有一条 achieved AC ⇒ 仍放行（计数不看 AC 自身状态，⛔ 不得收窄到 draft AC）', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'draft' });
    writeGoalFile(tmp, { id: 'AC-901', status: 'achieved', kind: 'criterion', goal: 'GOAL-001' });
    const r = goalStoreWrite(tmp, ['GOAL-001', '--status', 'active']);
    assert.equal(r.status, 0, `achieved 的 AC 同样是写下来的退出条件（stderr: ${r.stderr}）`);
    assert.ok(/^status: active$/m.test(readRecordFile(tmp, 'GOAL-001')), '放行并落成 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ⑤ 取假控制：计数按 `goal:` 名匹配，⛔ 不是「目录里有 AC 就算」──────────────────────────────

test('⑤ 目录里有 AC 但都挂在别的 GOAL 名下 ⇒ 本条激活仍被拒（谓词是名匹配，不是有无 AC）', () => {
  const tmp = makeWorkspace();
  try {
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'draft' });
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'draft' });
    writeGoalFile(tmp, { id: 'AC-901', status: 'draft', kind: 'criterion', goal: 'GOAL-009' });
    const r = goalStoreWrite(tmp, ['GOAL-001', '--status', 'active']);
    assert.notEqual(r.status, 0, 'AC-901 挂的是 GOAL-009 ⇒ 不算 GOAL-001 的 AC');
    assert.ok(
      String(r.stderr).includes('0 AC records name it'),
      `stderr 枚举 GOAL-001 名下 AC 数 = 0，实际：${r.stderr}`,
    );
    assert.ok(/^status: draft$/m.test(readRecordFile(tmp, 'GOAL-001')), 'GOAL-001 仍未激活');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
