// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// goal-driver-s12.test.mjs — shard 12, split out of goal-driver-s03 by
// gap-suite-split-15-over-30s-test-files (AC3: every shard of the 15 split files must run <30s;
// s03 was ~21s standalone / ~32s under load). It holds the WHOLE AC-216 复验域 group (4 tests):
// its heaviest member measured 9.3s — the single most expensive test in s03 — and the other three
// are that test's declared negative controls (改坏 gate 侧 / 缺口侧 / spawn 选取面 / 去重口径各红一条),
// so they must stay in the same shard to remain readable as a control set.
// Shared fixtures: ./helpers/goal-driver-harness.mjs (single source — ⛔ no fixture is re-declared here).

import { test } from "node:test";
import { assert, buildGapWorkerPrompt, computeGoalGaps, fs, isFilingGapState, os, path, repoRoot, runGapSpawnPass, runGoalRound, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

// ── gap-meta-computegoalgaps：AC-216 复验域接进【每轮 gate 集合 ∪ 缺口立案集合】───────────────────
// 立案读数：criteria.AC-241.verdict=fail，reason 逐字「unattributable failing goal AC(s): AC-161:
// acceptance failed (exit 1)」。AC-161（achieved ∧ long-term，其 GOAL-003 已 achieved）此前【只被 I5 跑】：
// 每轮 gate 循环只走 activeGoals ⇒ 它的台账尾事件永久定格为旧 runner 写的裸 fail（无成因，AC-241 结构上
// 永不通过）；computeGoalGaps 只数 active AC ⇒ 该违规既不进 criteria 也不进 gaps（无写入者、无执行者）。
// 下面四条互为负控制：改坏 gate 侧 ⇒ 第一条的 gated 断言红；改坏缺口侧（或不认 I5 读数）⇒ state 断言红；
// 把 standing-violated 移出 spawn 选取面 ⇒ 第二条红；把去重口径退回 ANY-status ⇒ 第四条红。

/** 写一条 GOAL/AC 记录（可声明 long-term）。longTerm 缺省不写该键（与 goal-standing-ac-reverify-scope 同形）。 */


test('AC-216 复验域：域内 achieved AC 逐轮进 criteria，违反者进 gaps（standing-violated）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-reverify-wire-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true }); // 空 tasks ⇒ taskFacts=[]（⛔ 不是 null）
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    // 域内：achieved ∧ long-term，其 GOAL 已 achieved，判据现 fail（常设不变式回归）。
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1', longTerm: true });
    // 域内对照：同域但判据此刻成立 ⇒ 也必须进两读数（复验域是集合，⛔ 不是只跑红的）。
    writeStandingGoalFile(tmp, { id: 'AC-002', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 0', longTerm: true });
    // 域外对照：achieved 但【未声明 long-term】且 GOAL 已 achieved ⇒ 随 GOAL 离开复验域（成本边界，
    // ⛔ 不是无差别放宽）——**gate 集合**（criteria）不含它。
    writeStandingGoalFile(tmp, { id: 'AC-003', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;
    const gated = new Set(v.criteria.map((c) => c.id));
    const gapByAc = new Map(v.gaps.map((g) => [g.ac, g.state]));

    assert.ok(gated.has('AC-001'), `gate 写侧：AC-001 必须逐轮被 gate（实测 criteria=${[...gated].join(',')}）`);
    assert.equal(v.criteria.find((c) => c.id === 'AC-001').verdict, 'fail', '逐轮重跑 ⇒ 本轮 verdict=fail（台账尾事件随之刷新，reason 带判据自己的成因）');
    assert.equal(gapByAc.get('AC-001'), 'standing-violated', '缺口立案侧：违反且无在飞任务 ⇒ standing-violated（可立案）');

    assert.ok(gated.has('AC-002'), 'gate 写侧：域内成立的那条也必须被 gate');
    assert.equal(gapByAc.get('AC-002'), 'standing-ok', '成立 ⇒ standing-ok（⛔ 与 standing-violated 同形即假绿，硬规则 3b）');

    assert.ok(!gated.has('AC-003'), '域外：未声明 long-term 的 achieved AC 随 GOAL 关闭离开复验域（⛔ 不进每轮 gate 集合）');
    // ⚠️ 2026-09-12 改判（gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation）：域外**不等于无主**。
    // 旧断言是 `!gapByAc.has('AC-003')`（域外 ⇒ 不进缺口读数）——那正是本任务要修的形态：一条离开复验域
    // 却仍被判为假的 AC **检测得到（AC-242 每轮红）却无消费者**。现在它进**第三个** population，取值
    // `frozen-violated`（⛔ 与 standing-violated 不同形：域外/域内的成因不同、处置不同），且**可立案**。
    assert.equal(gapByAc.get('AC-003'), 'frozen-violated', '域外且台账尾说此刻为假且无在飞任务 ⇒ frozen-violated（可立案的独立取值）');
    assert.ok(isFilingGapState('frozen-violated'), 'frozen-violated 在 spawn 选取面内（否则「被枚举」仍等于「无主」）');
    assert.notEqual(gapByAc.get('AC-003'), gapByAc.get('AC-001'), '两个 population 的取值必须不同形（硬规则 3b：合并即把「离开域后没人管」重新藏起来）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC-216 复验域：standing-violated 进 spawn 选取面；standing-ok / stalled ⛔ 不消耗名额', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-reverify-spawn-'));
  try {
    const records = [
      { id: 'GOAL-001', title: 'g', status: 'achieved' },
      { id: 'AC-001', title: 'a1', expect: 'e1', status: 'achieved', goal: 'GOAL-001' },
    ];
    const gaps = [
      { goal: 'GOAL-001', ac: 'AC-001', state: 'standing-violated', taskCount: 0 },
      { goal: 'GOAL-001', ac: 'AC-002', state: 'standing-ok', taskCount: 0 },
      { goal: 'GOAL-001', ac: 'AC-003', state: 'stalled', taskCount: 1 },
    ];
    const r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 3 });
    assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-001'], '只有 standing-violated 消耗 spawn 名额');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC-216 复验域：done 的关联任务⛔ 不覆盖常设不变式的回归（⛔ 不与 done-unresolved 同判）', () => {
  const records = [
    { id: 'GOAL-001', status: 'achieved' },
    { id: 'AC-001', status: 'achieved', goal: 'GOAL-001', longTerm: true, criterion: 'exit 1' },
  ];
  const failing = { achievedButFailing: ['AC-001'], evaluated: true };
  // 曾经 done 的关联任务**不**压下立案——那正是「回归后再无人立案」的成因。
  const done = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-001' }], null, failing)[0];
  assert.equal(done.state, 'standing-violated', 'done 的关联任务不覆盖回归 ⇒ 仍可立案');
  // 对照：有关联任务仍在飞（todo 且可晋升）⇒ 有人接手 ⇒ 回到 in-progress（⛔ 不每轮重复 spawn）。
  const inFlight = computeGoalGaps(records, [{ id: 't', status: 'todo', goalAc: 'AC-001' }],
    { eligibleTodoIds: new Set(['t']), excludedReadyIds: new Set() }, failing)[0];
  assert.equal(inFlight.state, 'in-progress');
  // 对照：读不到 I5 读数 ⇒ not-evaluated（⛔ 不与 standing-ok 同形，硬规则 3b）。
  assert.equal(computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-001' }], null, null)[0].state, 'not-evaluated');
  // 对照：读得到且不在 achievedButFailing ⇒ standing-ok。
  assert.equal(computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-001' }], null,
    { achievedButFailing: [], evaluated: true })[0].state, 'standing-ok');
});


test('AC-216 复验域：standing-violated 的 prompt 改去重口径（done 不覆盖回归），gap 口径不变', () => {
  const base = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-185', state: 'gap', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(base.includes('ANY status'), 'gap 口径不变：任何状态的既有认领都算重复');
  const st = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-185', state: 'standing-violated', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(st.includes('regressed'), '常设口径：说明这是常设不变式的回归');
  assert.ok(st.includes('IN FLIGHT'), '常设口径：只有在飞任务才算重复');
  assert.ok(!st.includes('ANY status'), '⛔ 常设口径不得沿用 gap 的 ANY-status 去重（否则每轮拒立案、缺口永无执行者）');
  assert.ok(st.includes('goal_ac: AC-185'), '两口径都必须要求顶层 goal_ac（下一轮独立复核的抓手）');
});
