// @test-group engine
// goal-posture-blocks-activate.test.mjs — GOAL-010 范围② / AC-215 (tasks/gap-goal-posture-blocks-activate):
// goal-driver 分诊尊重 GOAL 层 posture——measure-only 名下 draft AC 不得判 activate，只落
// re-anchor / needs-human / hold 三态之一。
//
// 覆盖三件事（AC-215 criterion 两半 + 端到端集成）：
// ①双向负控制（DoD ②）：未声明 posture ⇒ activate 可达（堵 activate 非恒真）；已声明 measure-only ⇒
//   activate 被拒且判决 ∈ {re-anchor, needs-human, hold}——两条各带「改坏 ⇒ 测试红」的取假路径
//   （硬规则 4 推论三）。
// ②posture 读回（DoD ①）：goal-store list 对带 `posture:` 的 GOAL 记录返回该字段（⛔ 非仅在写路径
//   原样保留——写路径早就在 `!OWNED_KEYS.has(k)` 分支原样保留，读回才是本任务的缺口）。
// ③端到端（驱动真传 posture，非仅纯函数）：active GOAL 带 posture: measure-only + 有牵引任务的 draft
//   AC 跑真一轮 ⇒ triage 判 hold（⛔ 不判 activate——正是本任务对 goal-driver.ts 调用点的改动）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-posture-blocks-activate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  triageDraftAc,
  listGoalRecords,
  runGoalRound,
} from '../scripts/goal-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, posture }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  if (posture !== undefined) lines.push(`posture: ${posture}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 写一个带 goal_ac 的 task 文件（供 triage 的「推进中」口径取 traction）。 */
function writeTaskFile(tmp, { id, status, goalAc }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `goal_ac: ${goalAc}`, '---', '', '## body', 'x', ''];
  fs.writeFileSync(path.join(tmp, 'tasks', `${id}.md`), lines.join('\n'), 'utf8');
}

// ── AC 方向一（负控制①）：未声明 posture ⇒ activate 可达（⛔ 堵 activate 非恒真）────────────

test('方向一（负控制①）：未声明 posture 的 GOAL 名下 draft AC ⇒ activate 可达（改坏=恒挡 activate 会红）', () => {
  const traction = [{ id: 'T-900', status: 'todo', goalAc: 'AC-900' }];
  const d = triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, null, traction).decision;
  assert.equal(d, 'activate', '有牵引 + 无 posture ⇒ 判 activate（证明「堵 activate」不是无条件恒真）');
});

// ── AC 方向二（负控制②）：已声明 measure-only ⇒ activate 被拒且 ∈ {re-anchor, needs-human, hold} ──

test('方向二（负控制②）：声明 measure-only 的 GOAL 名下 draft AC ⇒ 决策 !== activate 且 ∈ 三态（改坏=无视 posture 会红）', () => {
  const traction = [{ id: 'T-900', status: 'todo', goalAc: 'AC-900' }];
  // 有牵引（无 posture 时会是 activate）与无牵引（无 posture 时会是 retire）：posture 都得挡住 activate。
  const decisions = [
    triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, 'measure-only', traction).decision,
    triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, 'measure-only', []).decision,
  ];
  for (const d of decisions) {
    assert.notEqual(d, 'activate', 'measure-only 名下 draft AC 不得判 activate');
    assert.ok(['re-anchor', 'needs-human', 'hold'].includes(d), `判决落在 {re-anchor, needs-human, hold} 三态之一: ${d}`);
  }
  // 取假路径的另一半：posture 声明时，其它诊断前置（re-anchor/needs-human）仍先于 hold 生效——
  // posture 挡 activate 不吞 goal 锚/ criterion 的诊断（顺序即语义，与 triageDraftAc 的判决顺序一致）。
  assert.equal(triageDraftAc({ id: 'AC-900', goal: '', criterion: 'true' }, 'measure-only', traction).decision, 're-anchor');
  assert.equal(triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: '' }, 'measure-only', traction).decision, 'needs-human');
});

// ── DoD ①：goal-store list 对带 posture 的 GOAL 记录返回该字段（非仅在写路径原样保留）────────

test('posture 读回：goal-store list 对带 posture: measure-only 的 GOAL 记录返回该字段', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-posture-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal', posture: 'measure-only' });
    const records = await listGoalRecords(repoRoot, tmp);
    const g = records.find((r) => String(r.id) === 'GOAL-009');
    assert.ok(g, 'GOAL-009 在读回列表中');
    assert.equal(g.posture, 'measure-only', 'posture 读回 measure-only（⛔ 读回不丢弃，非仅写路径原样保留）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 端到端：driver 从 goal 记录读出 posture 并传入 triage（⛔ 非纯函数假绿）──────────────────

test('端到端：active GOAL 声明 measure-only ⇒ 有牵引的 draft AC 判 hold（driver 真传 posture）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-posture-e2e-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // active GOAL-009 声明 measure-only（GOAL 层姿态，覆盖名下所有 AC）。
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal', posture: 'measure-only' });
    // 其名下 draft AC + 一条推进中的 task（T-900 ⇒ 无 posture 时会是 activate）。
    writeGoalFile(tmp, { id: 'AC-900', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    writeTaskFile(tmp, { id: 'T-900', status: 'todo', goalAc: 'AC-900' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const triage = fact.value.triage;
    assert.ok(Array.isArray(triage), 'value.triage 是数组');
    const entry = triage.find((t) => t.ac === 'AC-900');
    assert.ok(entry, 'AC-900 在 triage 中');
    assert.notEqual(entry.decision, 'activate', 'measure-only ⇒ 不得判 activate（即使有牵引）');
    assert.equal(entry.decision, 'hold', 'well-formed + posture ⇒ hold（driver 从 goal 记录读出 posture 并传入）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
