// @test-group engine
// goal-sufficiency-not-evaluated.test.mjs — AC-213 负控制单测 (tasks/gap-goal-sufficiency-not-evaluated):
// 充分性判定为 not-evaluated（判不出）时，不与 covered（通过）同形——不触发 GOAL flip，且在轮记录里
// 与 covered 可区分（硬规则 3b：判定机件读不懂输入时不得返回与「合格」同形的值）。两半：
// ① 负控制（纯函数）——在域 AC 全 achieved（goalAchievedFromRecords===true）时，
//    goalFlipDecision(records, goalId, {verdict:"not-evaluated"}) === false（判不出 ≠ 通过、不触发 flip）；
// ② 可区分性（runGoalRound，temp-root 缝）——sufficiency fact 的 verdict === "not-evaluated"，
//    且在域 AC 全 achieved 的前提下 GOAL 不被 flip（若判成 covered 则会 flip——not-evaluated 与
//    covered 不同形，机械不产 covered）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-not-evaluated.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  goalFlipDecision,
  goalAchievedFromRecords,
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

// ── ① 负控制（纯函数）：在域 AC 全 achieved 时 not-evaluated ⇒ 不 flip ─────────────

test('负控制: 在域 AC 全 achieved 时 not-evaluated ⇒ 不 flip（判不出 ≠ 通过）', () => {
  const allAchieved = [
    { id: 'GOAL-001', status: 'active', body: '' },
    { id: 'AC-001', goal: 'GOAL-001', status: 'achieved' },
    { id: 'AC-002', goal: 'GOAL-001', status: 'achieved' },
  ];
  // 前置：在域 AC 全 achieved（goalAchievedFromRecords 取真）。
  assert.equal(goalAchievedFromRecords(allAchieved, 'GOAL-001'), true, '前置：在域 AC 全 achieved');
  // 负控制（AC-213 判据点名的这条）：not-evaluated ⇒ 不 flip（判不出不与通过同形）。
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', { verdict: 'not-evaluated' }), false, 'not-evaluated ⇒ 不 flip');
  // 对照：同样的记录，充分性判 covered 时 flip 取真——证明「不 flip」归因于 not-evaluated 本身，
  // 而非记录构造错了（硬规则 4 推论四：附一个若 Y 为假则结果不同的对照）。
  assert.equal(goalFlipDecision(allAchieved, 'GOAL-001', { verdict: 'covered' }), true, '对照：covered ⇒ flip');
});

// ── ② 可区分性（runGoalRound，temp-root 缝）：not-evaluated 在轮记录里与 covered 不同形 ──

test('可区分性: runGoalRound 产出的 sufficiency fact verdict === "not-evaluated" 且 GOAL 不被 flip', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sufficiency-not-evaluated-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001 body 有 `## 退出条件` + 一条在域 AC ⇒ goalSufficiencyVerdict = not-evaluated
    // （覆盖与否是语义判定，需 LLM，机械不产 covered——GOAL-010 风险 2 / AC-213）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' });
    // 在域 AC 已 achieved（goalAchievedFromRecords === true）：若判成 covered 会触发 GOAL flip。
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });

    const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'],
    });

    assert.equal(fact.name, 'goal-ring', '主 fact 仍是 goal-ring');
    assert.ok(Array.isArray(sufficiencyFacts) && sufficiencyFacts.length === 1, '一条 active GOAL ⇒ 一条 sufficiency fact');

    const s = sufficiencyFacts[0].value.sufficiency;
    assert.ok(s && typeof s === 'object', 'value.sufficiency 是 dict');
    assert.equal(s.goal, 'GOAL-001', 'sufficiency.goal = GOAL-001');
    // 可区分性核心：轮记录里 not-evaluated 与 covered 不同形（消费方 verdict === "covered" 不命中它）。
    assert.equal(s.verdict, 'not-evaluated', 'verdict === "not-evaluated"（判不出，机械不产 covered）');
    assert.notEqual(s.verdict, 'covered', 'not-evaluated 与 covered 不同形');
    // 在域 AC 全 achieved 的前提下，GOAL 仍不被 flip（not-evaluated ≠ covered，若 covered 此处已 flip）。
    const goalFlips = fact.value.flips.filter((f) => f.id === 'GOAL-001');
    assert.equal(goalFlips.length, 0, 'GOAL 不被 flip（not-evaluated 不触发关闭）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
