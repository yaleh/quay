// @test-group engine
// goal-triage-fresh-draft-not-retire.test.mjs — GOAL-010 范围② / AC-219
// (tasks/gap-meta-goal-triage-fresh-draft-not-retire): draft AC 分诊的默认分支不得对刚提案
// （无任务牵引）的 draft AC 判退役——「无任务牵引」≠「死信」。
//
// 覆盖两件事：①纯函数（triageDraftAc 对刚提案、goal 锚合法、criterion 非空、无 posture、
//   无任务牵引的 draft AC ⇒ activate，⛔ 不判 retire）；②真实机械环（active GOAL 名下
//   无牵引 draft AC 跑一轮后翻 active、不翻 needs-human——正是 AC-217/218/219 同日被误判退役的
//   反例；激活后 computeGoalGaps 看得见它，可立案）。
// 判据本身能取假（硬规则 4 推论三）：把实现改回「无牵引 ⇒ retire」时，三条都会红——
//   ①decision ≠ retire 红；②TRIAGE_DECISIONS 不含 retire 红；③真实环 status=active（非 needs-human）红。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-fresh-draft-not-retire.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  triageDraftAc,
  TRIAGE_DECISIONS,
  runGoalRound,
  listGoalRecords,
} from '../scripts/goal-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

// ── AC 方向一（纯函数）：刚提案 draft AC ⇒ hold/activate，⛔ 不判 retire ─────────────────

test('纯函数：刚提案 draft AC（锚合法 + criterion 非空 + 无 posture + 无牵引）⇒ activate，⛔ retire', () => {
  // 「刚提案」= 结构完备的 draft AC 天然无任务牵引（还没人给它立案/激活）。
  for (const taskFacts of [null, []]) {
    const e = triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, null, taskFacts);
    assert.equal(e.decision, 'activate', `无牵引 ⇒ activate（⛔ 不再 hold）: ${e.decision}`);
    assert.notEqual(e.decision, 'retire', '⛔ 不得判 retire（无任务牵引≠死信）');
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length > 0, `reason 非空: ${e.reason}`);
  }
});

// ── 负控制（判据取假）：词表不含 retire——恢复「无牵引 ⇒ retire」即红 ────────────────────

test('负控制：TRIAGE_DECISIONS 不含 retire（⛔ 恢复 retire 即本测试与 AC2 都会红）', () => {
  assert.ok(!TRIAGE_DECISIONS.includes('retire'), '四态词表不含 retire——「无任务牵引」不再是退役信号');
});

// ── 真实机械环：无牵引 draft AC 跑一轮后翻 active（⛔ 不翻 needs-human）────────────────────

test('真实环：active GOAL 名下无牵引 draft AC 跑一轮后翻 active（⛔ 不翻 needs-human、不判 retire）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-fresh-draft-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // active GOAL-009 名下一条 draft AC：goal 锚合法 + criterion 非空 + 无 posture + 无牵引。
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-900', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    // tasks 目录空 ⇒ 无任何 task 关联 AC-900 ⇒ 无牵引（刚提案的常态，⛔ 非死信）。

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });

    const triageEntry = fact.value.triage.find((t) => t.ac === 'AC-900');
    assert.ok(triageEntry, 'AC-900 应在 triage 里');
    assert.equal(triageEntry.decision, 'activate', '无牵引 ⇒ 分诊判 activate（⛔ 不判 retire、不判 hold）');

    const records = await listGoalRecords(repoRoot, tmp);
    const ac = records.find((r) => String(r.id) === 'AC-900');
    assert.ok(ac, '读回 AC-900');
    assert.equal(ac.status, 'active', '无牵引 draft AC 翻 active（牵引不再是激活判据）');
    assert.notEqual(ac.status, 'needs-human', '⛔ 不得翻 needs-human——刚提案待激活（⛔ 非建议退役）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
