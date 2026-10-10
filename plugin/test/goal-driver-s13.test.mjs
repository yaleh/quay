// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// goal-driver-s13.test.mjs — shard 13, split out of goal-driver-s03 by
// gap-suite-split-15-over-30s-test-files (AC3: every shard of the 15 split files must run <30s;
// s03 was ~21s standalone / ~32s under load). It holds the three tests whose cost is a REAL
// goal-store CLI invocation (sweepFrozenAcs 轮转 / readFrozenFailing 读回 / runGoalRound 端到端),
// taken from the AC-242 successor section and the ③ 冻结population 所有权 section of s03 — the pure
// unit tests of that section stay in s03 together with their section comment.
// Shared fixtures: ./helpers/goal-driver-harness.mjs (single source — ⛔ no fixture is re-declared here).

import { test } from "node:test";
import { GOAL_ACCEPTANCE_ACTIVE_ENV, assert, fs, os, path, readFrozenFailing, repoRoot, runGoalRound, sweepFrozenAcs, writeGoalFile, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

// gap-ac355-criterion-false-from-goal-acceptance-active-guard: this file's behaviour must NOT depend
// on the host's `QUAY_GOAL_ACCEPTANCE_ACTIVE`. That var is the goal-criterion re-entrancy guard: the
// goal-evaluation paths (goal-store `checkAchievedFailing` / `sweepFrozen`, goal-driver
// `runPrefilingRecheck`) set it on their own `process.env` before running a criterion, and a bare
// `node --test` (exactly how the AC-355 criterion runs these files) inherits it. The suite entry
// script unsets it before running tests, but the criterion bypasses that entry. Saving and deleting it at module
// load restores the file's independence for BOTH the in-process readers below and the spawned CLI
// children (which inherit this `process.env`); a test that WANTS the guard set sets it itself and
// restores it in its own `finally`. Restored after the file so the deletion never escapes it.
const __hostGoalAcceptance = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
test.after(() => {
  if (__hostGoalAcceptance === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
  else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = __hostGoalAcceptance;
});

// ── AC-242 successor 的【动作】接线（gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass）
// pass 1c 调 `goal-store check --stale-pass --sweep` 对冻结population 做一次有界轮转。这里跑**真
// goal-store CLI**（⛔ 不注入 seam）：断言它确实轮转到那条冻结 AC 并把 verdict 透传出来；并断言
// 读不懂输出 ⇒ null（⛔ 不与「轮转了且全过」同形，硬规则 3b）。

test('AC-242 successor — sweepFrozenAcs 真跑有界轮转并透传 verdict；读不懂 ⇒ null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-sweep-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  // 冻结population：GOAL 非 active 且未声明 long-term，AC achieved 且有非空 criterion。
  writeGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
  writeGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 1' });
  writeGoalFile(tmp, { id: 'AC-901', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 0' });

  const r = await sweepFrozenAcs(repoRoot, tmp);
  assert.ok(r, 'sweepFrozenAcs 应返回读数（非 null）');
  assert.deepEqual(r.ran.map((x) => x.id).sort(), ['AC-900', 'AC-901'], '轮转覆盖了冻结population 的两条');
  assert.equal(r.ran.find((x) => x.id === 'AC-900').verdict, 'fail', 'verdict 透传：当前为假的那条');
  assert.equal(r.ran.find((x) => x.id === 'AC-901').verdict, 'pass', '双向：健康的那条');
  assert.equal(r.stoppedBy, 'exhausted', '两条都在 budget 内跑完');

  // 负控制：脚本根不存在 ⇒ 读不懂输出 ⇒ null（⛔ 不是 ran:[]）。
  const bad = await sweepFrozenAcs(path.join(tmp, 'no-such-scripts'), tmp);
  assert.equal(bad, null, '读不懂 ⇒ null，⛔ 不与「轮转了且全过」同形');
});

test('冻结population：readFrozenFailing 跑真 goal-store —— 违反被枚举，缺 GOAL 的判据落 not-evaluated', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-frozen-read-'));
  fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
  writeGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
  writeGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 1' });
  writeGoalFile(tmp, { id: 'AC-901', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 0' });

  // 轮转从未跑过 ⇒ 机制不在 ⇒ 独立第三态（⛔ 不是 clean）。
  const before = await readFrozenFailing(repoRoot, tmp);
  assert.equal(before.judgment, 'not-evaluated', '轮转从未跑过 ⇒ not-evaluated（机制不在，⛔ 不与「零条」同形）');
  assert.equal(before.cause, 'no-rotation');

  // 跑一次轮转 ⇒ 读数可用：AC-900 此刻为假、AC-901 为真。
  await sweepFrozenAcs(repoRoot, tmp);
  const after = await readFrozenFailing(repoRoot, tmp);
  assert.equal(after.judgment, 'violated');
  assert.deepEqual(after.failing, ['AC-900'], '只枚举此刻为假的那条（AC-901 为真 ⇒ 不在枚举里）');
  assert.equal(after.frozenScope, 2, 'population 规模透传');

  // 台账/命令读不到（脚本根不存在）⇒ unreadable，⛔ 绝不与 clean 同形。
  const broken = await readFrozenFailing(path.join(tmp, 'no-such-scripts'), tmp);
  assert.equal(broken.judgment, 'not-evaluated');
  assert.equal(broken.cause, 'unreadable');
});

test('冻结population 端到端：真 runGoalRound 把域外失败的 AC 枚举为 frozen-violated 并**立案**', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-frozen-e2e-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true }); // 空 tasks ⇒ taskFacts=[]（⛔ 不是 null）
    // GOAL 已 achieved（非 active），AC 已 achieved、**未声明 long-term**、判据此刻为假 ⇒ 冻结population。
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    // 对照：同域外但判据此刻为真 ⇒ 查过且全好，⛔ 不产生读数、不消耗 spawn 名额。
    writeStandingGoalFile(tmp, { id: 'AC-002', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 0' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;
    const gapByAc = new Map(v.gaps.map((g) => [g.ac, g.state]));

    assert.equal(v.frozenFailing.judgment, 'violated', '轮记录带三态读数（judgment=violated）');
    assert.deepEqual(v.frozenFailing.failing, ['AC-001'], '读数枚举此刻为假的那条（⛔ 不布尔化）');
    assert.equal(gapByAc.get('AC-001'), 'frozen-violated', '端到端：域外且此刻为假 ⇒ 进缺口读数（本任务修的就是「一条读数都不产生」）');
    assert.equal(gapByAc.get('AC-002'), undefined, '对照：域外但此刻为真 ⇒ 无读数（「查过且全好」与「此刻为假」不同形）');
    assert.deepEqual(v.gap_spawns.map((s) => s.ac), ['AC-001'], '端到端：它进了 spawn 立案路径（被枚举 ≠ 有主，立案才算有主）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
