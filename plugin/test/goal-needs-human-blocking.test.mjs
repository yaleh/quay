// @test-group engine
// goal-needs-human-blocking.test.mjs — gap-goal-needs-human-blocking (AC-209 人 2026-09-09 裁定 2):
// `needs-human` 进 goal 词表且计入 goalAchievedFromRecords 的在域集合，使一条要人裁定的 AC 阻塞 GOAL
// 达成（⛔ 不与 draft 同形——draft 不进词表、不计在域，等于白加一个状态）。
//
// 双向负控制（读的是两个真实导出，⛔ 非 fixture 注入）：
//   ① `VALID_GOAL_STATUSES.includes("needs-human")` —— 词表侧。
//   ② `goalAchievedFromRecords` 全 achieved ⇒ true（正控制）。
//   ③ `goalAchievedFromRecords` 含 needs-human AC ⇒ false（负控制）。
//      关键是「achieved + needs-human」⇒ false：若 needs-human 不在域，这组记录会只剩 achieved ⇒ true；
//      它返回 false 才证明 needs-human 是在域且阻塞（而非「零在域 ⇒ false」那个兜底分支）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-needs-human-blocking.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { goalAchievedFromRecords } from '../scripts/goal-driver.ts';
import { VALID_GOAL_STATUSES } from '../../packages/quay/src/goal-store.ts';

test('VALID_GOAL_STATUSES 含 needs-human（词表侧）', () => {
  assert.ok(VALID_GOAL_STATUSES.includes('needs-human'), 'needs-human 必须进 goal 词表');
});

test('goalAchievedFromRecords: 全 achieved ⇒ true（正控制）', () => {
  assert.equal(
    goalAchievedFromRecords([{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }], 'GOAL-001'),
    true,
  );
});

test('goalAchievedFromRecords: 含 needs-human AC ⇒ false（负控制）', () => {
  assert.equal(
    goalAchievedFromRecords([{ id: 'AC-001', goal: 'GOAL-001', status: 'needs-human' }], 'GOAL-001'),
    false,
  );
});

test('goalAchievedFromRecords: achieved + needs-human ⇒ false（needs-human 在域且阻塞，非零在域兜底）', () => {
  assert.equal(
    goalAchievedFromRecords(
      [
        { id: 'AC-001', goal: 'GOAL-001', status: 'achieved' },
        { id: 'AC-002', goal: 'GOAL-001', status: 'needs-human' },
      ],
      'GOAL-001',
    ),
    false,
    'needs-human 必须计入在域：若被排除，这组记录只剩 achieved 会返回 true',
  );
});
