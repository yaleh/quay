// @test-group engine
// goal-sufficiency-gate.test.mjs — AC-212 充分性闸 (tasks/gap-goal-sufficiency-gate):
// GOAL 达成判定从「在域 AC 纯语法合取」变成「AC 合取 + 充分性 covered」。覆盖两件事：
// ① goalFlipDecision 纯函数——正控制 covered ⇒ true；负控制 insufficient/not-evaluated/null ⇒ false
//   （后者即 AC-212 判据点名的那条：在域 AC 全绿但充分性判 insufficient ⇒ 不 flip GOAL）；
// ② runGoalRound 把每条 active GOAL 的三态充分性判定落成独立 Fact（value.sufficiency={goal, verdict}）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-gate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  goalFlipDecision,
  goalAchievedFromRecords,
  goalSufficiencyVerdict,
  runGoalRound,
} from '../scripts/goal-driver.ts';

// 脚本根（goal-store.ts 从这里取，经 goalStoreArgv）；数据根（goals/）在各测试里给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI，
 *  复用 goal-driver.test.mjs 的 temp-root 缝）。body 缺省无 `## 退出条件`（充分性判 insufficient）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, body = '## body\nx' }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '');
  for (const line of body.split('\n')) lines.push(line);
  lines.push('');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

// ── ① goalFlipDecision 纯函数（AC-212 判据点名的负控制）────────────────────────────

test('AC1: goalFlipDecision — 在域 AC 全 achieved + covered ⇒ true；insufficient/not-evaluated/null ⇒ false', () => {
  const allAchieved = [
    { id: 'GOAL-001', status: 'active', body: '' },
    { id: 'AC-001', goal: 'GOAL-001', status: 'achieved' },
    { id: 'AC-002', goal: 'GOAL-001', status: 'achieved' },
  ];
  // 前置：在域 AC 全 achieved（goalAchievedFromRecords 取真）。
  assert.equal(goalAchievedFromRecords(allAchieved, 'GOAL-001'), true, '前置：在域 AC 全 achieved');
  // 正控制：covered ⇒ flip。
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', { verdict: 'covered' }), true, 'covered ⇒ flip');
  // 负控制（AC-212 判据点名的那条）：insufficient ⇒ 不 flip。
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', { verdict: 'insufficient' }), false, 'insufficient ⇒ 不 flip');
  // not-evaluated / null / undefined ⇒ 不 flip（判不出不与通过同形，硬规则 3b；AC-213 独立测试）。
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', { verdict: 'not-evaluated' }), false, 'not-evaluated ⇒ 不 flip');
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', null), false, 'null ⇒ 不 flip');
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', undefined), false, 'undefined ⇒ 不 flip');
});

test('AC1 负控制: 有未达成 AC ⇒ 即便 covered 也不 flip（充分性闸在 AC 合取之上，⛔ 不是替代）', () => {
  const partial = [
    { id: 'GOAL-001', status: 'active', body: '' },
    { id: 'AC-001', goal: 'GOAL-001', status: 'achieved' },
    { id: 'AC-002', goal: 'GOAL-001', status: 'active' },
  ];
  assert.equal(goalFlipDecision(partial, 'GOAL-001', { verdict: 'covered' }), false, 'AC 未全 achieved ⇒ 不 flip');
});

// ── ② goalSufficiencyVerdict 三态（机械可证部分）────────────────────────────────────

test('goalSufficiencyVerdict: 无退出条件 / 零在域 AC ⇒ insufficient；有退出条件 ⇒ not-evaluated', () => {
  // 无 `## 退出条件` ⇒ 覆盖无从谈起 ⇒ insufficient（GOAL-005/007/008 空 body 形态）。
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## body\nx' }, [{ id: 'AC-001' }]), 'insufficient');
  // 有 `## 退出条件` 但零在域 AC ⇒ 空集合无法覆盖 ⇒ insufficient。
  assert.equal(
    goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n1. 条件一\n' }, []),
    'insufficient',
  );
  // 有 `## 退出条件` 且有在域 AC ⇒ 覆盖与否需 LLM（AC-213）⇒ not-evaluated（⛔ 不与 covered 同形）。
  assert.equal(
    goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n1. 条件一\n' }, [{ id: 'AC-001' }]),
    'not-evaluated',
  );
  // 只有标题、节体为空 ⇒ 仍算「没写下」⇒ insufficient。
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n## 风险\n' }, [{ id: 'AC-001' }]), 'insufficient');
});

// ── ③ runGoalRound 把充分性判定落成独立 Fact（value.sufficiency）───────────────────

test('AC3: runGoalRound 返回的 facts 中存在 value.sufficiency（dict，含 goal 与三态 verdict）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sufficiency-gate-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001（body 无退出条件 ⇒ insufficient）+ AC-001（criterion false ⇒ 不 flip ⇒ 仍 active）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    // GOAL-002（body 有退出条件 ⇒ not-evaluated）+ AC-002（criterion false ⇒ 不 flip）。
    writeGoalFile(tmp, { id: 'GOAL-002', status: 'active', kind: 'goal', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-002', criterion: 'false' });

    const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'],
    });

    // 充分性判定是【独立 Fact】（name="goal-sufficiency"），与 goal-ring fact 分离落进轮记录。
    assert.equal(fact.name, 'goal-ring', '主 fact 仍是 goal-ring');
    assert.ok(Array.isArray(sufficiencyFacts) && sufficiencyFacts.length === 2, '两条 active GOAL ⇒ 两条 sufficiency fact');

    const byGoal = new Map(sufficiencyFacts.map((f) => [f.value.sufficiency.goal, f.value.sufficiency]));
    // GOAL-001 body 无 `## 退出条件` ⇒ 机械可证 insufficient（负控制：充分性闸取假，GOAL 不被 flip）。
    assert.ok(byGoal.has('GOAL-001'), '存在 GOAL-001 的 sufficiency 判定');
    assert.equal(byGoal.get('GOAL-001').verdict, 'insufficient', 'body 无退出条件 ⇒ insufficient');
    // GOAL-002 body 有 `## 退出条件` ⇒ 覆盖与否需 LLM（AC-213）⇒ not-evaluated（三态之一，⛔ 不与 covered 同形）。
    assert.ok(byGoal.has('GOAL-002'), '存在 GOAL-002 的 sufficiency 判定');
    assert.equal(byGoal.get('GOAL-002').verdict, 'not-evaluated', 'body 有退出条件 ⇒ not-evaluated');

    // value.sufficiency 是 dict，含 goal（string）与 verdict（三态之一）——AC-212 判据 grep 的正是它。
    for (const f of sufficiencyFacts) {
      const s = f.value.sufficiency;
      assert.ok(s && typeof s === 'object', 'value.sufficiency 是 dict');
      assert.equal(typeof s.goal, 'string', 'sufficiency.goal 是 string');
      assert.ok(['covered', 'insufficient', 'not-evaluated'].includes(s.verdict), `verdict ∈ 三态（实测 ${s.verdict}）`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
