// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver-s06.test.mjs by gap-suite-split-15-over-30s-test-files — new shard 9 (4 tests): the ⑥c goal-gaps fact section. Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { ALL_GAP_STATES, GOAL_CONTROL_STATE_REL, GOAL_GAPS_FACT_NAME, GOAL_ROUND_REL, QUIET_GAP_STATES, assert, fs, gapViewEntries, gapViewFact, goalDriverRoutines, isFilingGapState, os, path, repoRoot, runGoalRound, runResidentQualityGateLoop, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

// ── ⑥c goal-gaps fact：缺口读数的可见性 ────────────────────────────────────────────────────
// （gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact）
//
// 立案形态：`computeGoalGaps` 每轮算出的读数此前只喂 `runGapSpawnPass`（决定要不要 spawn 立案 agent），
// 而一条 AC 卡在 `done-unresolved`（有 done/superseded 任务认领、判据依然为假、**且没有任何机制会再碰
// 它**——`isFilingGapState` 有意把它排除在 spawn 之外）这个事实上，人要看得自己写外部脚本把同一套推导
// 重做一遍。本 fact 把它（连同其余六种非安静态）落进轮记录。
//
// ⛔ 纯观测性新增：`goal-gaps` 由 `gaps` 单向派生，不进 `runGapSpawnPass`、不进 `goalFlipDecision`
// ⇒ 不改变任何判定（落地前后各跑一轮本文件的负控制，见任务的 AC2 证据）。
// 四条互为负控制：①视图滤错态 ⇒ 第一条红；②把「读不到」写成空数组 ⇒ 第二条红；③视图与 spawn 选取面
// 混同 ⇒ 第三条的「视图 ⊋ spawn 面」与「spawn 面 = isFilingGapState 子集」两句必有一句红。

/** `GapState` 的九个取值（枚举，⛔ 不布尔化）与其中被视图滤掉的「安静态」。 */


test('goal-gaps ①: gapViewEntries 只滤安静态（in-progress/standing-ok），其余七态逐条带出且保序', () => {
  const gaps = ALL_GAP_STATES.map((state, i) => ({
    goal: 'GOAL-001', ac: `AC-00${i}`, state, taskCount: state === 'not-evaluated' ? null : i,
  }));
  const view = gapViewEntries(gaps);
  assert.deepEqual(view.map((e) => e.state), ALL_GAP_STATES.filter((s) => !QUIET_GAP_STATES.includes(s)),
    '恰好滤掉 in-progress/standing-ok 两态，其余七态全部出现（⛔ 不是只挑 done-unresolved 一种）');
  assert.deepEqual(Object.keys(view[0]), ['goal', 'ac', 'state', 'taskCount'], '每条恰好四键 {goal, ac, state, taskCount}');
  assert.deepEqual(view.map((e) => e.ac), gaps.filter((g) => !QUIET_GAP_STATES.includes(g.state)).map((g) => g.ac), '保序（与 computeGoalGaps 的 records 序一致）');
  const ne = view.find((e) => e.state === 'not-evaluated');
  assert.equal(ne.taskCount, null, 'taskCount 原样带出：not-evaluated 时是 null（⛔ 不与 0 同形，硬规则 3）');
  assert.equal(gapViewEntries([]).length, 0, '空输入 ⇒ 空视图（⛔ 不抛、不返回 null）');
});


test('goal-gaps ②: 「读不到」与「查过且零条」不同形（硬规则 3b）', () => {
  const zero = gapViewFact([]);
  assert.equal(zero.name, GOAL_GAPS_FACT_NAME);
  assert.equal(zero.state, 'verified', '算出来且零条 ⇒ verified（空数组是一个测量）');
  assert.deepEqual(zero.value.gaps, []);
  assert.equal(zero.value.evaluated, true);
  assert.equal(zero.value.cause, null);

  const unread = gapViewFact(null, 'goal-list-unreadable');
  assert.equal(unread.state, 'not-evaluated', '没算成 ⇒ fact state not-evaluated');
  assert.equal(unread.value.evaluated, false, 'evaluated:false 把它与「零条」分开');
  assert.equal(unread.value.cause, 'goal-list-unreadable', '成因可区分（⛔ 不是 null/缺键）');
  assert.deepEqual(unread.value.gaps, [], 'gaps 恒为数组（jq 形态稳定），靠 evaluated/cause 区分两态');
  assert.notEqual(unread.state, zero.state, '两态必须不同形（⛔ 绝不让「读不到」长得像「没有缺口」）');
  assert.equal(gapViewFact(null).value.cause, 'gaps-not-computed', '漏传成因也有可区分的缺省值');
});


test('goal-gaps ③（E2E）: 轮记录里出现 goal-gaps fact，done-unresolved 与 gap 在内、in-progress 在外', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-gapview-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    writeStandingGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    writeStandingGoalFile(tmp, { id: 'AC-003', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    // AC-001：有关联任务但全部非牵引（done）⇒ done-unresolved（有信号、没人管——本任务的立案形态）
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-a.md'), '---\nid: gap-a\nstatus: done\ngoal_ac: AC-001\n---\nbody\n', 'utf8');
    // AC-002：零关联任务 ⇒ gap（可立案，进 spawn 面）
    // AC-003：有 ready 任务 ⇒ in-progress（安静态，⛔ 不进视图）
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-c.md'), '---\nid: gap-c\nstatus: ready\ngoal_ac: AC-003\n---\nbody\n', 'utf8');

    const r = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const { fact, gapFacts } = r;
    assert.equal(gapFacts.length, 1, '本轮恰好一条 goal-gaps fact（每轮必落，⛔ 不是「有缺口才写」）');
    const gf = gapFacts[0];
    assert.equal(gf.name, GOAL_GAPS_FACT_NAME);
    assert.equal(gf.state, 'verified');
    assert.equal(gf.value.evaluated, true);
    const byAc = new Map(gf.value.gaps.map((e) => [e.ac, e]));
    assert.equal(byAc.get('AC-001')?.state, 'done-unresolved', 'done-unresolved 必须可见（这就是本任务立案的那个事实）');
    assert.equal(byAc.get('AC-001')?.taskCount, 1, 'taskCount 枚举关联数（⛔ 非布尔化，硬规则 3）');
    assert.equal(byAc.get('AC-002')?.state, 'gap', 'gap 在视图内');
    assert.equal(byAc.has('AC-003'), false, 'in-progress 是安静态 ⇒ ⛔ 不进视图');

    // 派生视图不变式：视图 ⊆ 全量读数，逐条同态同 taskCount（⛔ 不是第二处计算，硬规则 5b）
    const full = new Map(fact.value.gaps.map((g) => [g.ac, g]));
    assert.ok(gf.value.gaps.length > 0, '视图非空（负控制：滤成空也能过 ⇒ 判据空转）');
    for (const e of gf.value.gaps) {
      assert.deepEqual(full.get(e.ac), e, `视图条目 ${e.ac} 必须与 goal-ring.value.gaps 里的同一条逐字相同`);
    }

    // spawn 决策仍是【全量 gaps 的立案子集】的函数，⛔ 与视图无关（负控制的决策半边）
    const filingSet = fact.value.gaps.filter((g) => isFilingGapState(g.state)).map((g) => g.ac);
    assert.deepEqual(fact.value.gap_spawns.map((s) => s.ac), filingSet,
      'spawn 面 = 全量 gaps 里 isFilingGapState 的子集（AC-002），⛔ 不含 done-unresolved（AC-001）');
    assert.ok(gf.value.gaps.some((e) => !isFilingGapState(e.state)),
      '视图必须比 spawn 面宽：它含【不立案】的态（done-unresolved）——那正是此前看不见的那一半');
    assert.ok(!gf.value.gaps.some((e) => !full.has(e.ac)), '视图里不存在全量读数里没有的条目');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('goal-gaps ④（载体级）: 常驻循环写出的 .quay/goal-round.jsonl 那条 record 里真的含 goal-gaps fact', async () => {
  // AC-1 的字面主张是「**轮记录**里新增一条 fact」——前三条测的是 `runGoalRound` 的返回值，
  // 这条走例程 + 常驻循环，测的是**写进载体**的那一条（⛔ 返回值有、载体没有即 AC-1 不成立）。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-gapview-carrier-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    writeStandingGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1' });
    // AC-001：关联任务全部 done ⇒ done-unresolved（本任务立案的那个形态）；AC-002：零关联 ⇒ gap。
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-a.md'), '---\nid: gap-a\nstatus: done\ngoal_ac: AC-001\n---\nbody\n', 'utf8');

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog,
      runId: 'goal-gaps-carrier', json: false, controlStateRel: GOAL_CONTROL_STATE_REL,
      // spawnCap 0 ⇒ 本轮不 spawn（本测试只问 fact 落没落进载体，⛔ 不烧名额、不起 LLM）。
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 0 }),
    });
    assert.equal(code, 0);
    const rec = JSON.parse(fs.readFileSync(roundLog, 'utf8').trim().split('\n')[0]);
    const gf = rec.facts.find((f) => f.name === GOAL_GAPS_FACT_NAME);
    assert.ok(gf, `轮记录里必须有 goal-gaps fact（实测 facts=${rec.facts.map((f) => f.name).join(',')}）`);
    assert.equal(gf.state, 'verified');
    assert.equal(gf.value.evaluated, true);
    const byAc = new Map(gf.value.gaps.map((e) => [e.ac, e.state]));
    assert.equal(byAc.get('AC-001'), 'done-unresolved', '载体里能看到 done-unresolved');
    assert.equal(byAc.get('AC-002'), 'gap', '载体里能看到 gap');
    assert.equal(byAc.get('AC-002') !== undefined && gf.value.gaps.find((e) => e.ac === 'AC-002').taskCount, 0, 'taskCount 是 0 而不是 null（枚举，⛔ 非布尔化）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
