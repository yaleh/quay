// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/4 (24 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { DELIVERED_VERSION, GOAL_ACCEPTANCE_ACTIVE_ENV, GOAL_ROUND_REL, HEALTH_OBSERVED_CARRIERS, HEALTH_REQUIRED_CARRIERS, HEALTH_WINDOW_SEC_DEFAULT, OBJECTIVE_ACS, OBJECTIVE_EVIDENCE_CARRIERS, OBJECTIVE_GOAL, PRE_CHANGE_ENTRY, TARGET_HEALTH_FACT_NAME, assert, buildGapWorkerPrompt, buildHealthProbeArgv, cannedProbePrefix, collectObjectiveEvidence, computeGoalGaps, declaredTargetBinding, deriveTargetHealth, evRecord, fs, goalDriverRoutines, goalFlipDecision, goalSufficiencyVerdict, hasPrefilingEvidence, isFilingGapState, judgeCmd, mkTargetRoot, objectiveSufficiencyVerdictDetail, os, parseHealthProbe, path, readFrozenFailing, readHostHealth, recheckFrozenFailing, recheckStandingFailing, repoRoot, resetObjectiveTestState, resolveTargetBinding, runGoalRound, runResidentQualityGateLoop, semanticSufficiencyVerdict, spawn, spawnTargetDriverFixture, sweepFrozenAcs, targetHealthFact, waitForProcessVisible, writeEvidenceCarrier, writeGoalFile, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

test('立案前复核：闸拒绝 ⇒ 独立结局 guard-refused（⛔ 不与「复核通过」同形）；未传/非 violated ⇒ ran:false 零成本', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-recheck-guard-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 1' });
    const reading = { failing: ['AC-900'], judgment: 'violated', cause: null, frozenScope: 1 };

    // 正控制：不在闸下 ⇒ 真跑判据 ⇒ confirmed-failing（`exit 1` 此刻仍为假）。
    const on = await recheckFrozenFailing(repoRoot, tmp, reading);
    assert.equal(on.ran, true);
    assert.equal(on.guardRefused, false);
    assert.deepEqual(on.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'confirmed-failing', 'still-false']],
      '不在闸下 ⇒ 真跑；`exit 1` ⇒ confirmed-failing（判据此刻仍为假）');

    // 闸拒绝：本进程已在跑判据 ⇒ **一条都不跑**，且结局是**独立取值**（⛔ 不是 cleared，也不是 confirmed）。
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = '1';
    try {
      const refused = await recheckFrozenFailing(repoRoot, tmp, reading);
      assert.equal(refused.ran, false, '闸拒绝 ⇒ 没跑');
      assert.equal(refused.guardRefused, true);
      assert.equal(refused.attempted, 1);
      assert.deepEqual(refused.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'not-evaluated', 'guard-refused']],
        '拒绝是独立结局：not-evaluated + cause=guard-refused（⛔ 与 cleared / confirmed 都不同形）');
      assert.notEqual(refused.entries[0].outcome, 'cleared', '⛔ 闸拒绝不得冒充「复核通过」');
      assert.notEqual(refused.entries[0].outcome, 'confirmed-failing', '⛔ 也不得冒充「复核后仍为假」');
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }

    // 零成本路径：读数不适用（未传 / clean / 空 failing）⇒ ran:false，不跑任何判据。
    assert.equal((await recheckFrozenFailing(repoRoot, tmp, null)).ran, false, '未传读数 ⇒ 不跑');
    assert.equal((await recheckFrozenFailing(repoRoot, tmp, { failing: [], judgment: 'clean', cause: null, frozenScope: 1 })).ran, false,
      'clean ⇒ 不跑');
    assert.equal((await recheckFrozenFailing(repoRoot, tmp, { failing: [], judgment: 'not-evaluated', cause: 'unreadable', frozenScope: -1 })).ran, false,
      '读数本身 not-evaluated ⇒ 不跑（缺口分派已在该分支落 not-evaluated）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('立案前复核 ②：台账尾说 fail 而判据此刻 exit 0 ⇒ cleared —— 台账读数是【陈旧】的直接量证据', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-recheck-cleared-'));
  const marker = path.join(tmp, 'fix-landed');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    // 判据 = 「修复已落地」的代理：`test -f <marker>`。⛔ 判据文本全程不变 ⇒ criterionHash 不变
    // ⇒ 台账尾的那条 `fail` 说的**正是当前这条判据**（否则会被判 amendedUnverified，测不到本形态）。
    writeStandingGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: `test -f ${marker}` });

    // 轮转跑一次（marker 不在）⇒ 台账写下 actor=goal-sweep 的 fail。
    await sweepFrozenAcs(repoRoot, tmp);
    const stale = await readFrozenFailing(repoRoot, tmp);
    assert.equal(stale.judgment, 'violated');
    assert.deepEqual(stale.failing, ['AC-900'], 'marker 不在 ⇒ 轮转记 fail');

    // 「修复落地」：marker 出现。台账**没有**因此改变——这正是本任务要修的时差。
    fs.writeFileSync(marker, '', 'utf8');
    const stillStale = await readFrozenFailing(repoRoot, tmp);
    assert.equal(stillStale.judgment, 'violated', '台账尾仍是 fail（轮转 verdict 在 4h 内 ⇒ 优先级高于尾事件）——缺陷形态：读数陈旧');
    assert.deepEqual(stillStale.failing, ['AC-900']);

    // 直接量复核：真跑判据 ⇒ exit 0 ⇒ cleared。
    const rc = await recheckFrozenFailing(repoRoot, tmp, stillStale);
    assert.equal(rc.ran, true);
    assert.deepEqual(rc.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'cleared', 'now-true']],
      '复核是直接量：判据此刻 exit 0 ⇒ cleared（⛔ 台账尾说的不算）');

    // 反方向（负控制①）：marker 撤掉 ⇒ 同一判据此刻为假 ⇒ confirmed-failing，立案照旧。
    fs.rmSync(marker, { force: true });
    const rc2 = await recheckFrozenFailing(repoRoot, tmp, stillStale);
    assert.deepEqual(rc2.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'confirmed-failing', 'still-false']],
      '负控制①：真为假 ⇒ confirmed-failing（复核不是恒绿闸）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('立案前复核 ③：同一时刻同一 AC 的改前/改后对照 —— 改前 frozen-violated，改后无读数', () => {
  const recs = [
    { id: 'GOAL-900', status: 'achieved' },
    { id: 'AC-900', status: 'achieved', goal: 'GOAL-900', criterion: 'exit 1' },
  ];
  const staleReading = { failing: ['AC-900'], judgment: 'violated', cause: null, frozenScope: 1 };
  // 改前（未传复核读数 ⇒ 既有行为）：台账尾 fail 直接被当「此刻为假」⇒ 立案。
  const before = computeGoalGaps(recs, [], null, null, staleReading).find((x) => x.ac === 'AC-900');
  assert.equal(before.state, 'frozen-violated', '改前：产 frozen-violated（台账尾被当直接量）');
  assert.ok(isFilingGapState('frozen-violated'));

  // 改后（复核 cleared）：**不产 frozen-violated**，也不产任何读数（此刻确无工作可立）。
  const cleared = { ran: true, attempted: 1, entries: [{ ac: 'AC-900', outcome: 'cleared', cause: 'now-true', reason: 'exit 0' }], guardRefused: false };
  const after = computeGoalGaps(recs, [], null, null, staleReading, cleared).find((x) => x.ac === 'AC-900');
  assert.equal(after, undefined, '改后：复核 cleared ⇒ 不产 frozen-violated（同一时刻同一 AC 的对照）');

  // 复核 not-evaluated ⇒ **独立取值**（⛔ 既不是 cleared 的「无读数」，也不是 confirmed 的 frozen-violated）。
  const notEv = { ran: false, attempted: 1, entries: [{ ac: 'AC-900', outcome: 'not-evaluated', cause: 'guard-refused', reason: 'guard' }], guardRefused: true };
  const ne = computeGoalGaps(recs, [], null, null, staleReading, notEv).find((x) => x.ac === 'AC-900');
  assert.equal(ne.state, 'not-evaluated', '复核不可评估 ⇒ 独立取值 not-evaluated');
  assert.equal(ne.taskCount, null, 'not-evaluated 时 taskCount=null（⛔ 不与 0 同形）');
  assert.notEqual(ne.state, 'frozen-violated', '⛔ 不得回落成「复核后仍为假」');
  assert.ok(!isFilingGapState('not-evaluated'), 'not-evaluated 不在 spawn 选取面（复核跑不成 ≠ 判据为假）');

  // 复核 confirmed-failing ⇒ 立案照旧（负控制①的分派半边）。
  const confirmed = { ran: true, attempted: 1, entries: [{ ac: 'AC-900', outcome: 'confirmed-failing', cause: 'still-false', reason: 'exit 1' }], guardRefused: false };
  assert.equal(computeGoalGaps(recs, [], null, null, staleReading, confirmed).find((x) => x.ac === 'AC-900').state, 'frozen-violated',
    '负控制①（分派）：复核后仍非 0 ⇒ frozen-violated 照旧立案');

  // 漏传复核读数 ⇒ 照旧立案（fail-visible：调用方漏传不得静默变成「复核通过」）。
  assert.equal(computeGoalGaps(recs, [], null, null, staleReading).find((x) => x.ac === 'AC-900').state, 'frozen-violated',
    '未传复核读数 ⇒ 保守立案（⛔ 不与 cleared 同形）');
});


test('立案前复核 ④（生产形态端到端）：修复已落地而台账尾尚未轮转 ⇒ 下一轮不再产生 gap 立案', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-recheck-e2e-'));
  const marker = path.join(tmp, 'fix-landed');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true }); // 空 tasks ⇒ taskFacts=[]（⛔ 不是 null）
    writeStandingGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: `test -f ${marker}` });

    // 第 1 轮：判据为假（marker 不在）⇒ 复核 confirmed-failing ⇒ 立案（既有行为不许被削弱）。
    const r1 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const g1 = new Map(r1.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.equal(g1.get('AC-900'), 'frozen-violated', '第 1 轮：真为假 ⇒ 照旧立案');
    assert.deepEqual(r1.fact.value.gap_spawns.map((s) => s.ac), ['AC-900'], '第 1 轮：进 spawn 立案路径');
    assert.deepEqual(r1.fact.value.frozenRecheck.entries.map((e) => [e.ac, e.outcome]), [['AC-900', 'confirmed-failing']],
      '第 1 轮：复核读数落进轮记录（产物可查）');

    // 「修复落地」：marker 出现。⛔ 不动判据文本 ⇒ criterionHash 不变 ⇒ 台账尾的那条 fail 仍描述当前判据。
    fs.writeFileSync(marker, '', 'utf8');

    // 第 2 轮：台账尾**仍然**是 fail（轮转 verdict 在 4h 内、且 fail 的再查窗口 10 min 未到）⇒ 缺陷形态
    // 必须仍在读数里，而复核必须把它按下去 ⇒ 不立案。
    const r2 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    assert.deepEqual(r2.fact.value.frozenFailing.failing, ['AC-900'],
      '第 2 轮：台账读数**仍然**说此刻为假（轮转尚未轮到它）——这正是缺陷的输入，⛔ 不是被修好了');
    const g2 = new Map(r2.fact.value.gaps.map((g) => [g.ac, g.state]));
    assert.notEqual(g2.get('AC-900'), 'frozen-violated', '第 2 轮：复核 cleared ⇒ 不产 frozen-violated');
    assert.equal(g2.get('AC-900'), undefined, '第 2 轮：也不产任何读数（此刻确无工作可立）');
    assert.deepEqual(r2.fact.value.gap_spawns.map((s) => s.ac), [], '第 2 轮：不 spawn（不烧 spawn 名额，也不给下游指一个不存在的缺陷）');
    assert.deepEqual(r2.fact.value.frozenRecheck.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'cleared', 'now-true']],
      '第 2 轮：复核读数「cleared/now-true」落进轮记录（这就是「修复已落地」的直接量证据）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ②b 常设域内的立案前【直接量复核】（gap-standing-violated-false-spawn-no-prefiling-recheck）──────
//
// 缺陷：I5（`check --achieved-failing`）的那次读数是**本轮的**、没有时差（这点与 ③ 相反），但它只有
// **一次**。宿主进入不健康态时（2026-09-16 实测 ENOSPC：那条 worker 自述 root fs 100% full、
// 自己的 Bash 调用死于 `No space left on device`）它为**真值为真**的常设判据给出 fail ⇒ driver 据此
// spawn 一个 prompt 逐字断言「the guarantee it asserts has regressed」的 agent，给下游指一个
// **不存在的缺陷**（那轮之后逐条复测：判据 11 次全绿、`achievedButFailing` 恒为 `["AC-242"]`）。
// 修法 = 立案前**再跑一次**那条 criterion（第二次直接量，复用同一 `runPrefilingRecheck`）：两次一致
// 才立案；并把复核那一刻的**宿主健康量**与该次读数钉在一起，使「环境类误读」与「真回归」事后可分。
//
// 下面五组互为控制：①正向（复核 cleared ⇒ 不立案、spawned=0）；②负控制（两次都失败 ⇒ 照旧立案、
// spawned=1——证明复核不是恒绿闸）；③三态互不同形（含复核跑不成给独立取值）；④复核函数自身的闸拒绝
// 与零成本路径；⑤轮记录里的复核读数，且**负控制是改动前的真实旧对象**（⛔ 不是自造一个必然失败的对象）。


test('②b 正向：常设判据「单次读数说 fail、复核那次 pass」⇒ 不产 standing-violated、spawned=0', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-standing-recheck-'));
  const counter = path.join(tmp, 'runs');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true }); // 空 tasks ⇒ taskFacts=[]（⛔ 不是 null）
    // 判据 = 「前两次调用失败、第 3 次起通过」。⚠️ 阈值 2 **不是**随手写的常量：常设 AC 在本轮恰好有
    // 3 个跑判据的调用点，实测顺序是 pass 1b（每轮 gate 集合）→ I5（achieved-but-failing 读数）→ ②b
    // （立案前复核，本任务新增）。⇒ 第 1、2 次失败让 I5 把它读进 `achievedButFailing`（前提**真的成立**），
    // 第 3 次通过让复核判 cleared。**若调用顺序变了**，I5 会落到第 3 次上、读数转 pass，下面那条
    // `achievedButFailing` 断言会**立刻红** —— ⛔ 这个夹具不会静默退化成空转（硬规则 4c）。
    const crit = `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; [ "$n" -gt 2 ]`;
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: crit, longTerm: true });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;

    assert.equal(fs.readFileSync(counter, 'utf8').trim(), '3',
      '前提（实测轮次）：常设 AC 本轮被判据执行器跑了 3 次（pass 1b → I5 → ②b）——顺序变了这条就红');
    assert.ok(v.achievedFailing.achievedButFailing.includes('AC-001'),
      '前提（I5 读数）：那一刻读数说它此刻为假 —— ⛔ 这正是缺陷的**输入**，不是被修好了');
    assert.deepEqual(v.standingRecheck.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-001', 'cleared', 'now-true']],
      '②b：立案前复核真跑了这条 criterion ⇒ exit 0 ⇒ cleared（第二次直接量推翻了那一次读数）');
    assert.equal(v.gaps.find((g) => g.ac === 'AC-001'), undefined,
      '复核 cleared ⇒ 不产生读数（此刻确无工作可立），⛔ 尤其不产 standing-violated');
    assert.equal(v.spawned, 0, '⛔ 不 spawn —— 本任务要的正是这一条：一次环境类失准不再产生立案');
    assert.deepEqual(v.gap_spawns.map((s) => s.ac), [], '不烧 spawn 名额，也不给下游指一个不存在的缺陷');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('②b 负控制：criterion 两次都失败 ⇒ 照旧产 standing-violated 并 spawn（复核不是恒绿闸）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-standing-recheck-neg-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1', longTerm: true });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;

    assert.ok(v.achievedFailing.achievedButFailing.includes('AC-001'), 'I5 读数：此刻为假');
    assert.deepEqual(v.standingRecheck.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-001', 'confirmed-failing', 'still-false']],
      '负控制①：复核**真跑**且回了 fail ⇒ confirmed-failing（⛔ 复核不得是恒绿闸——改坏它这条就红）');
    assert.equal(v.gaps.find((g) => g.ac === 'AC-001').state, 'standing-violated', '两次直接量一致 ⇒ 立案照旧');
    assert.equal(v.spawned, 1, '负控制②：真的回归照旧 spawn 1 条（本次改动不得削弱既有行为）');
    assert.deepEqual(v.gap_spawns.map((s) => s.ac), ['AC-001'], '负控制②（同一读数的另一半）：被 spawn 的正是它');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('②b prompt：常设口径陈述本轮真的做了什么（重跑一次后仍为假），⛔ 不复用冻结口径的措辞', () => {
  const p = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-001', state: 'standing-violated', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(p.includes('regressed'), '常设口径仍在：这是常设不变式的回归');
  assert.ok(p.includes('RE-RAN the criterion before filing'),
    '新增：说明立案前重跑过一次 criterion ⇒「此刻为假」是两次一致，不是一个孤立的单次读数');
  assert.ok(p.includes('two independent measurements, not by a single reading'),
    '把「一次环境类失准」与「真的回归」在下游 agent 眼里区分开——本任务立案的正是前者被当成后者');
  // 既有口径不许被这次改动削弱（同处断言，防止改 A 破 B）。
  assert.ok(p.includes('IN FLIGHT'), '去重口径仍在：只有在飞任务算重复');
  // ⛔ 两个 population 的措辞必须可区分（既有 AC5 断言的那条，此处再钉一次）：
  // 「已离开复验域」是冻结口径的标记，「RE-RAN its criterion」是冻结口径的动作表述 —— 常设分支
  // ⛔ 一个都不许带（本任务新增的常设表述刻意换了字面：RE-RAN **the** criterion）。
  assert.ok(!p.includes('LEFT the reverify scope') && !p.includes('RE-RAN its criterion'),
    '⛔ 常设分支不得复用冻结口径的措辞（两个 population 的成因与处置不同）');
  assert.ok(p.includes('goal_ac: AC-001'), '顶层 goal_ac 要求仍在（下一轮独立复核的抓手）');
});


test('②b 三态互不同形：复核 not-evaluated ⇒ 独立取值（⛔ 既不是 standing-ok 也不是 standing-violated）', () => {
  const recs = [
    { id: 'GOAL-900', status: 'achieved' },
    { id: 'AC-900', status: 'achieved', goal: 'GOAL-900', criterion: 'exit 1', longTerm: true },
  ];
  const standings = { achievedButFailing: ['AC-900'], evaluated: true };
  const ev = (outcome, cause) => ({ ran: outcome !== 'not-evaluated', attempted: 1, entries: [{ ac: 'AC-900', outcome, cause, reason: 'x', verdict: outcome === 'cleared' ? 'pass' : 'fail', durationMs: 12, hostFreeBytes: 1, load1: 0 }], guardRefused: outcome === 'not-evaluated' });

  // 改前（未传复核读数 ⇒ 既有行为）：I5 的单次读数直接立案。
  assert.equal(computeGoalGaps(recs, [], null, standings).find((x) => x.ac === 'AC-900').state, 'standing-violated',
    '改前：单次读数即产 standing-violated（可立案）');

  // 复核 cleared ⇒ **不产生读数**（此刻确无工作可立；与 standing-ok 同为静默，因为真值为真）。
  assert.equal(computeGoalGaps(recs, [], null, standings, null, null, ev('cleared', 'now-true')).find((x) => x.ac === 'AC-900'), undefined,
    '复核 cleared ⇒ 不产任何读数（同一时刻同一 AC 的改前/改后对照）');

  // 复核 not-evaluated ⇒ 独立取值。
  const ne = computeGoalGaps(recs, [], null, standings, null, null, ev('not-evaluated', 'guard-refused')).find((x) => x.ac === 'AC-900');
  assert.equal(ne.state, 'not-evaluated', '复核跑不成 ⇒ 独立取值 not-evaluated');
  assert.equal(ne.taskCount, null, 'not-evaluated 时 taskCount=null（⛔ 不与 0 同形）');
  assert.notEqual(ne.state, 'standing-ok', '⛔ 复核跑不成不得冒充「查过且成立」');
  assert.notEqual(ne.state, 'standing-violated', '⛔ 也不得回落成「复核后仍为假」');
  assert.ok(!isFilingGapState('not-evaluated'), 'not-evaluated 不在 spawn 选取面（复核跑不成 ≠ 判据为假）');

  // 复核 confirmed-failing ⇒ 立案照旧（分派半边）。
  assert.equal(computeGoalGaps(recs, [], null, standings, null, null, ev('confirmed-failing', 'still-false')).find((x) => x.ac === 'AC-900').state,
    'standing-violated', '复核后仍非 0 ⇒ standing-violated 照旧立案');

  // 漏传复核读数 ⇒ 照旧立案（fail-visible：调用方漏传不得静默变成「复核通过」）。
  assert.equal(computeGoalGaps(recs, [], null, standings).find((x) => x.ac === 'AC-900').state, 'standing-violated',
    '未传复核读数 ⇒ 保守立案（⛔ 不与 cleared 同形）');
});


test('②b recheckStandingFailing：闸拒绝 ⇒ 独立结局；读数未传/命中集为空 ⇒ ran:false 零成本', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-standing-recheck-guard-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-900', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-900', status: 'achieved', kind: 'criterion', goal: 'GOAL-900', criterion: 'exit 1', longTerm: true });
    const standings = { achievedButFailing: ['AC-900'], evaluated: true };

    // 正控制：不在闸下 ⇒ 真跑判据 ⇒ confirmed-failing，且读数带该次执行的原始 verdict 与实测墙钟。
    const on = await recheckStandingFailing(repoRoot, tmp, standings);
    assert.equal(on.ran, true);
    assert.equal(on.guardRefused, false);
    assert.deepEqual(on.entries.map((e) => [e.ac, e.outcome, e.cause, e.verdict]), [['AC-900', 'confirmed-failing', 'still-false', 'fail']],
      '不在闸下 ⇒ 真跑；`exit 1` ⇒ confirmed-failing（verdict = 该次执行的原始读数）');
    assert.ok(typeof on.entries[0].durationMs === 'number' && on.entries[0].durationMs >= 0, 'durationMs 是本次执行的实测墙钟');
    for (const k of ['hostFreeBytes', 'load1']) {
      assert.ok(on.entries[0][k] === null || typeof on.entries[0][k] === 'number',
        `${k} 随读数落痕（读不出 ⇒ null，⛔ 不与 0 同形）`);
    }

    // 闸拒绝：本进程已在跑判据 ⇒ **一条都不跑**，且结局是**独立取值**。
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = '1';
    try {
      const refused = await recheckStandingFailing(repoRoot, tmp, standings);
      assert.equal(refused.ran, false, '闸拒绝 ⇒ 没跑');
      assert.equal(refused.guardRefused, true);
      assert.equal(refused.attempted, 1);
      assert.deepEqual(refused.entries.map((e) => [e.ac, e.outcome, e.cause]), [['AC-900', 'not-evaluated', 'guard-refused']],
        '拒绝是独立结局：not-evaluated + cause=guard-refused（⛔ 与 cleared / confirmed 都不同形）');
      assert.equal(refused.entries[0].durationMs, null, '⛔ 没跑 ⇒ 时长 null（⛔ 不写 0：0 会被读成「跑得极快」）');
      assert.notEqual(refused.entries[0].outcome, 'cleared', '⛔ 闸拒绝不得冒充「复核通过」');
      assert.notEqual(refused.entries[0].outcome, 'confirmed-failing', '⛔ 也不得冒充「复核后仍为假」');
    } finally {
      if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }

    // 零成本路径：读不到 I5 读数 / 命中集为空 ⇒ ran:false，不跑任何判据。
    assert.equal((await recheckStandingFailing(repoRoot, tmp, null)).ran, false, '读不到 I5 读数 ⇒ 不跑');
    assert.equal((await recheckStandingFailing(repoRoot, tmp, { achievedButFailing: [], evaluated: true })).ran, false, '命中集为空 ⇒ 不跑');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** AC2 的**判据**：一条复核读数是否带齐「结论四键 + 宿主健康量」。
 *  ⛔ 写成函数而不是内联断言，正是为了能在**改动前的真实旧对象**上干跑一次——「字段存在」如果只在新
 *  对象上跑过，就是自证（硬规则 2 的零计数配套动作：谓词必须对一个已知为假/为真的样本各跑一次）。 */

/** 改动前的**真实**读数（⛔ 不是自造的）：逐字摘录自本仓生产载体 `.quay/goal-round.jsonl`
 *  round 59 / ts=2026-09-16T11:42:53.534Z 的 `facts[goal-ring].value.frozenRecheck.entries[0]`
 *  （`reason` 原值较长，此处未删改）。它只有 `ac/outcome/cause/reason` 四项
 *  ——**这正是「环境类误读事后不可分」的载体证据**：读它的人无法知道那次 fail 跑在什么宿主状态下。 */


test('AC2：轮记录里出现立案前复核读数（含宿主健康量）；负控制 = 改动前的真实旧对象上谓词为假', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-standing-recheck-ac2-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeStandingGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeStandingGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'exit 1', longTerm: true });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const v = fact.value;
    assert.equal(v.standingRecheck.entries.length, 1, '本轮有一条复核读数（AC-001 命中 I5）');
    const e = v.standingRecheck.entries[0];
    assert.ok(hasPrefilingEvidence(e), `复核读数带齐 {ac,outcome,verdict,durationMs,hostFreeBytes|load1}，实测键=${Object.keys(e).join(',')}`);
    assert.equal(e.ac, 'AC-001');
    assert.equal(e.outcome, 'confirmed-failing');
    assert.equal(e.verdict, 'fail');
    assert.ok(typeof e.durationMs === 'number' && e.durationMs >= 0, 'durationMs 实测（⛔ 不是占位常量）');
    // 宿主健康量必须是**当时**的读数：与此刻独立重读一次同量级（⛔ 不与 0 同形、⛔ 不是写死的字面量）。
    const now = readHostHealth();
    if (now.hostFreeBytes !== null && e.hostFreeBytes !== null) {
      assert.ok(e.hostFreeBytes > 0, 'hostFreeBytes > 0（⛔ 0 = 盘满，null = 没读到，两者与「盘不紧张」不同形）');
      assert.ok(e.hostFreeBytes <= now.hostFreeBytes * 4, `复核那一刻的可用字节应与此刻同量级（读数=${e.hostFreeBytes} 此刻=${now.hostFreeBytes}）`);
    }

    // ⛔ 负控制：同一个谓词在**改动前的真实读数**上必须为假 —— 否则本判据只是「字段存在」的自证。
    assert.equal(hasPrefilingEvidence(PRE_CHANGE_ENTRY), false,
      '负控制：改动前的真实读数不含 verdict/durationMs/宿主量 ⇒ 新旧可区分（⛔ 不靠「字段存在」自证）');
    assert.ok(!('durationMs' in PRE_CHANGE_ENTRY) && !('hostFreeBytes' in PRE_CHANGE_ENTRY),
      '负控制的成因可核：旧对象缺的正是「这次跑在什么环境下」那一半');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC5：frozen 分支的 prompt 不再断言「No other mechanism re-runs it」——改为可核的「本轮已复核」表述', () => {
  const p = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-001', state: 'frozen-violated', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(!p.includes('No other mechanism re-runs it'),
    '⛔ 该断言自【有界轮转】落地后为假，且与 checkStalePass 自己的设计注释互相矛盾');
  assert.ok(!p.includes('stays false forever'), '⛔ 同句的结论半边一并去掉');
  assert.ok(p.includes('RE-RAN its criterion directly before filing'),
    '改为陈述本轮真的做了什么：立案前跑过一次 criterion（直接量，⛔ 不是台账尾的陈旧读数）');
  // 既有口径不许被这次改动削弱（同处断言，防止改 A 破 B）。
  assert.ok(p.includes('LEFT the reverify scope'), '口径仍在：已离开复验域');
  assert.ok(p.includes('IN FLIGHT') && !p.includes('ANY status'), '去重口径仍在：只有在飞任务算重复');
  assert.ok(p.includes('make the criterion TRUE again') && p.includes('superseded') && p.includes('long-term: true'),
    '三条合法终态仍在');
  // 常设不变式（standing）分支不受影响：⛔ 不得把 frozen 的新措辞漏进那一支。
  const s = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-001', state: 'standing-violated', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(!s.includes('LEFT the reverify scope') && !s.includes('RE-RAN its criterion'), 'standing 分支不带 frozen 的措辞');
});

// ── 被驱动系统（目标项目）健康度 —— gap-goal-driver-blind-to-driven-system-health ────────────────
//
// 症状：本 driver 6 天 5308 轮只产出**内省**读数（goal-ring / goal-sufficiency），它驱动的目标项目
// 两小时内 fan-in 失败 9 次（其中一轮 277 秒全量 suite 全绿、唯独最后一步失败 ⇒ 白烧），而 driver
// 全程无感。本组测的就是补上的那条**外部视角**读数（fact name = goal-target-health）。
//
// ⛔ **口径边界（人 2026-09-07 DIR-131 + `goal-driver-task-boundary-check.ts` Detector 3）**：本 fact
// **不读 task 落地指标**（fan-in 成败 / 落地率 / ready 池积压 / full-suite-state）——那归 task 机制。
// 立案任务体点名的「fan-in 失败步骤分布」因此不在本 fact 内（该维度的去向是人裁，见任务 `## 阻塞`）。
// 本组测的两条信号都是**被驱动系统自身的结构量**：它在不在跑、它的配置形状落不落后。
//
// 夹具是**真实文件系统**（探针脚本读的就是它，⛔ 不注入读数本身）。只有「传输失败」与「进程表读不到」
// 用 argv 前缀缝注入 —— 换的是**传输层**，⛔ 不是答案（硬规则 4 推论三）。

/** 造一个「目标项目」夹具根（真实 .quay/ 载体）。 */

/** 交付物 plugin 版本（本仓 plugin/.claude-plugin/plugin.json）——夹具「配置形状一致」态用它。 */

/** 起一个**真在跑**的「目标项目 driver 进程」夹具：cmdline 带 `worker-driver.js --root <目标根>`
 *  ⇒ 探针的 `ps` 扫描能真读到它（⛔ 不是注入答案：读的还是真进程表、真 cmdline，夹具只造环境）。
 *  ⚠️ 必须 spawn（异步）：探针要在它活着的时候跑；调用方负责 kill。 */

/** 等夹具进程的 cmdline 真的出现在进程表里（spawn 是异步的：立刻探针会读到「还没起来」= 假红）。
 *  判据是**进程表**（探针读的同一来源），⛔ 不是子进程自述 —— 与探针同一直接量。 */

/** 「进程表读不到」夹具：transport 缝换成「先吃干 stdin、再打一份 driverProcesses:null 的探针输出」。
 *  ⛔ 这不是注入答案——它造的是**环境**（ps 不可用/被沙箱挡时探针就是这个形态），verdict 仍由
 *  被测代码从这份读数推出（本组其余用例正是它的对照）。 */

// ── AC1：能取假 —— 两条被驱动系统自身的 categorical 信号（⛔ 无阈值、无落地指标）──────────────


test('AC1: not-driving 信号能取假 —— 目标零 driver 进程 ⇒ unhealthy[not-driving]；有 ⇒ 该信号消失', async () => {
  const idle = mkTargetRoot({ pluginVersion: DELIVERED_VERSION, roundRecords: ['worker-round.jsonl'] });
  const running = mkTargetRoot({ pluginVersion: DELIVERED_VERSION, roundRecords: ['worker-round.jsonl'] });
  const proc = spawnTargetDriverFixture(running);
  try {
    assert.ok(waitForProcessVisible(proc.pid), '夹具进程已上进程表（否则下面的对照是假红）');
    const fIdle = targetHealthFact(repoRoot, { targetRoot: idle });
    const fRun = targetHealthFact(repoRoot, { targetRoot: running });
    assert.equal(fIdle.value.liveness.count, 0, '夹具无目标进程 ⇒ 进程计数 0（真读数）');
    assert.deepEqual(fIdle.value.signals, ['not-driving'], '零进程 ⇒ 信号 not-driving');
    assert.equal(fIdle.value.verdict, 'unhealthy', '有信号 ⇒ unhealthy');
    assert.ok(fRun.value.liveness.count >= 1, `目标 driver 进程被真读到（实为 ${fRun.value.liveness.count}）`);
    assert.ok(!fRun.value.signals.includes('not-driving'), '有进程 ⇒ not-driving 消失（信号能取假）');
    // 两态输出逐字贴出做对照（AC1 的留档要求）。
    console.log(`AC1[unhealthy] ${fIdle.reason}`);
    console.log(`AC1[对照·有进程] ${fRun.reason}`);
    assert.equal(fIdle.state, 'verified', '⛔ 取到读数就是 verified（unhealthy 不是「本轮失败」，AC2）');
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(idle, { recursive: true, force: true });
    fs.rmSync(running, { recursive: true, force: true });
  }
});


test('AC1: plugin-version-mismatch 信号能取假 —— 落后 ⇒ unhealthy[plugin-version-mismatch]；一致 ⇒ 该信号消失', () => {
  const stale = mkTargetRoot({ pluginVersion: '0.0.1-stale' });
  const same = mkTargetRoot({ pluginVersion: DELIVERED_VERSION });
  try {
    const fStale = targetHealthFact(repoRoot, { targetRoot: stale });
    const fSame = targetHealthFact(repoRoot, { targetRoot: same });
    // 两者都无目标 driver 进程 ⇒ 都带 not-driving；差异必须在版本信号上，且**只有**它变化。
    assert.ok(fStale.value.signals.includes('plugin-version-mismatch'), '落后 ⇒ 该信号在');
    assert.ok(!fSame.value.signals.includes('plugin-version-mismatch'), '一致 ⇒ 该信号不在（能取假）');
    assert.equal(fStale.value.pluginVersion.equal, false, '并排读数：不等');
    assert.equal(fSame.value.pluginVersion.equal, true, '并排读数：相等');
    console.log(`AC1[stale] ${fStale.reason}`);
    console.log(`AC1[一致] ${fSame.reason}`);
  } finally {
    fs.rmSync(stale, { recursive: true, force: true });
    fs.rmSync(same, { recursive: true, force: true });
  }
});


test('AC1 负控制: 两条信号之外的一切都是**读数**不是判据（陈旧度/条数不进 signals）', () => {
  const dir = mkTargetRoot({ pluginVersion: DELIVERED_VERSION, roundRecords: [] });
  try {
    const f = targetHealthFact(repoRoot, { targetRoot: dir });
    assert.deepEqual(f.value.signals, ['not-driving'], '只有 not-driving（round 类载体的条数/龄都不产生信号）');
    // `verification-round.jsonl` **也是** `*-round.jsonl` ⇒ 计入 roundRecords，且读数点名它（否则
    // 「driver 在跳」与「只有复验轮在写」会被读成同一个数——硬规则 4b 的代理量陷阱）。
    assert.equal(f.value.roundRecords.count, 1, 're 里只有 verification-round.jsonl 一条（mkTargetRoot 不写 driver round 载体）');
    assert.equal(f.value.roundRecords.newestRel, '.quay/verification-round.jsonl', '点名最新那条是谁');
    assert.ok(f.value.roundRecords.newestAgeSec <= 5, '龄可读（刚写）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('AC1: fan-in-failing 信号能取假 —— 目标项目自己的 fan-in-step-trace.jsonl 窗口内有 ok:false ⇒ unhealthy[fan-in-failing]；全 ok:true ⇒ 该信号消失（人 2026-09-12 DIR-131 AC6 口径补充裁定）', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const writeTrace = (dir, lines) => fs.writeFileSync(path.join(dir, '.quay', 'fan-in-step-trace.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  const failing = mkTargetRoot({ pluginVersion: DELIVERED_VERSION, roundRecords: ['worker-round.jsonl'] });
  const proc = spawnTargetDriverFixture(failing);
  const passing = mkTargetRoot({ pluginVersion: DELIVERED_VERSION, roundRecords: ['worker-round.jsonl'] });
  const proc2 = spawnTargetDriverFixture(passing);
  try {
    assert.ok(waitForProcessVisible(proc.pid) && waitForProcessVisible(proc2.pid), '两个夹具都已上进程表（否则下面的对照被 not-driving 污染）');
    writeTrace(failing, [
      { event: 'step-end', step: 'ff', task: 'TASK-89', epoch: nowSec - 60, ok: false },
      { event: 'step-end', step: 'merge-develop', task: 'TASK-90', epoch: nowSec - 30, ok: true },
      { event: 'other', step: 'ignored', epoch: nowSec - 10, ok: false }, // 非 step-end ⇒ 不计
    ]);
    writeTrace(passing, [
      { event: 'step-end', step: 'ff', task: 'TASK-91', epoch: nowSec - 30, ok: true },
    ]);
    const fFail = targetHealthFact(repoRoot, { targetRoot: failing });
    const fPass = targetHealthFact(repoRoot, { targetRoot: passing });
    assert.deepEqual(fFail.value.signals, ['fan-in-failing'], '窗口内 1 个 ok:false ⇒ 信号 fan-in-failing（⛔ not-driving 不在，因为进程真在跑）');
    assert.equal(fFail.value.verdict, 'unhealthy', '有信号 ⇒ unhealthy');
    assert.equal(fFail.value.fanIn.failed, 1, '失败步骤数');
    assert.deepEqual(fFail.value.fanIn.failedByStep, { ff: 1 }, '按步骤名归类');
    assert.deepEqual(fFail.value.fanIn.failedTasks, ['TASK-89'], '点名失败任务');
    assert.equal(fFail.value.fanIn.steps, 2, '窗口内 step-end 计 2 条（非 step-end 的第三行不计入）');
    assert.ok(!fPass.value.signals.includes('fan-in-failing'), '全 ok:true ⇒ 该信号消失（能取假）');
    assert.equal(fPass.value.fanIn.failed, 0, '零失败');
    assert.equal(fPass.value.verdict, 'healthy', '零信号 ⇒ healthy');
    console.log(`AC1[fan-in-failing] ${fFail.reason}`);
    console.log(`AC1[fan-in 对照·全绿] ${fPass.reason}`);
  } finally {
    proc.kill('SIGKILL');
    proc2.kill('SIGKILL');
    fs.rmSync(failing, { recursive: true, force: true });
    fs.rmSync(passing, { recursive: true, force: true });
  }
});


test('AC1: fan-in-failing 读不懂时不与「零失败」同形（trace-unreadable / trace-unparseable，硬规则 3b）', () => {
  const badJson = mkTargetRoot({ pluginVersion: DELIVERED_VERSION });
  const dirTrace = mkTargetRoot({ pluginVersion: DELIVERED_VERSION });
  try {
    fs.writeFileSync(path.join(badJson, '.quay', 'fan-in-step-trace.jsonl'), 'not json at all\n', 'utf8');
    const fBad = targetHealthFact(repoRoot, { targetRoot: badJson });
    assert.equal(fBad.value.verdict, 'not-evaluated', 'JSON 坏行 ⇒ not-evaluated（⛔ 不是 healthy/0 failed）');
    assert.equal(fBad.value.cause, 'trace-unparseable', '成因点名是解析问题');

    fs.rmSync(path.join(dirTrace, '.quay', 'fan-in-step-trace.jsonl'));
    fs.mkdirSync(path.join(dirTrace, '.quay', 'fan-in-step-trace.jsonl')); // 载体其实是个目录 ⇒ 读不出来
    const fDirAsFile = targetHealthFact(repoRoot, { targetRoot: dirTrace });
    assert.equal(fDirAsFile.value.verdict, 'not-evaluated', '载体读不出来 ⇒ not-evaluated（⛔ 不是 0 failed）');
    assert.equal(fDirAsFile.value.cause, 'trace-unreadable', '成因点名是「在但读不出来」，⛔ 与 carrier-missing 不同形');
  } finally {
    fs.rmSync(badJson, { recursive: true, force: true });
    fs.rmSync(dirTrace, { recursive: true, force: true });
  }
});

// ── AC2：不阻塞 —— 健康度为红不进入达成判定（goalFlipDecision 输入/输出逐字一致）───────────────


test('AC2: 健康度为红不阻塞 —— goalFlipDecision 输入/输出与改动前逐字一致，且端到端 GOAL 照样 flip', async () => {
  // ① 纯函数层：逐字打印改前/改后的输入与输出（健康度**不在**输入里 —— 形参个数未变）。
  const records = [
    { id: 'GOAL-001', status: 'active', kind: 'goal' },
    { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001' },
  ];
  const decisionInput = { verdict: 'covered' };
  const before = goalFlipDecision(records, 'GOAL-001', decisionInput);

  const bad = mkTargetRoot({ pluginVersion: '0.0.1-stale' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-target-nonblock-'));
  try {
    const health = targetHealthFact(repoRoot, { targetRoot: bad });
    assert.equal(health.value.verdict, 'unhealthy', '构造出的目标态确实是红');
    const after = goalFlipDecision(records, 'GOAL-001', decisionInput);
    console.log(`AC2 改前: goalFlipDecision(records=[GOAL-001/AC-001 achieved], GOAL-001, ${JSON.stringify(decisionInput)}) = ${before}`);
    console.log(`AC2 改后: 同一输入 + 健康度=${health.value.verdict}（${JSON.stringify(health.value.signals)}）⇒ goalFlipDecision = ${after}`);
    assert.equal(after, before, '逐字一致（健康度为红不改变达成判定）');
    assert.equal(after, true, '且该输入下判定为 true —— 不是「两边都 false」的空转对照');
    assert.equal(goalFlipDecision.length, 3, 'goalFlipDecision 形参个数未变（健康度不是它的输入）');
    assert.equal(health.state, 'verified', '健康度为红时 fact.state 仍是 verified（⛔ 不取 failed ⇒ 不把整轮标成失败）');

    // ② 端到端：目标项目为红的那一轮里，GOAL 照样被机械 flip achieved（真 goal-store + 真轮记录）。
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog, runId: 't', json: false,
      routines: goalDriverRoutines(tmp, {
        scriptRoot: repoRoot,
        gapWorkerCmd: 'true',
        resourceGateArgv: ['true'],
        sufficiencyCmd: ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'],
        targetRoot: bad, // 目标项目为红
      }),
    });
    assert.equal(code, 0, '目标项目为红的那一轮仍正常退出（⛔ 不失败）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: achieved$/m, '端到端：GOAL 照样 flip achieved（健康度不构成前置）');
    const rec = JSON.parse(fs.readFileSync(roundLog, 'utf8').trim().split('\n').pop());
    const hf = rec.facts.find((f) => f.name === TARGET_HEALTH_FACT_NAME);
    assert.ok(hf, '轮记录里健康度 fact 与 goal-ring / goal-sufficiency **并列**');
    assert.equal(hf.value.verdict, 'unhealthy', '且它就是那条红读数');
    assert.equal(rec.facts.filter((f) => f.state === 'failed').length, 0, '本轮无 failed fact（红色读数不改轮终态）');
  } finally {
    fs.rmSync(bad, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3：未评估可区分 —— 不可达 / 载体缺失 / 读不到 ⇒ 独立取值（⛔ 既非读数也不是「健康」）─────────


test('AC3: 六种未评估成因各出独立取值，且 signals 恒 null（⛔ 不与「零信号」同形）', () => {
  const made = [];
  const mk = (o) => { const d = mkTargetRoot(o); made.push(d); return d; };
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-target-none-'));
  made.push(emptyRoot);
  const ok = mk({ pluginVersion: DELIVERED_VERSION });
  try {
    const probeFail = targetHealthFact(repoRoot, { targetRoot: ok, healthProbePrefix: ['bash', '-c', 'exit 255'] });
    // 缝的命令必须**先吃干 stdin**（探针载荷走 stdin）：不读 stdin 的假传输会让写端 EPIPE ⇒ 那已是
    // 「载荷没送达 = probe-failed」，测不到 probe-unparseable 这一态。
    const garbled = targetHealthFact(repoRoot, { targetRoot: ok, healthProbePrefix: ['bash', '-c', 'cat >/dev/null; echo not-the-probe-shape'] });
    const absent = targetHealthFact(repoRoot, { targetRoot: path.join(emptyRoot, 'no-such-project') });
    const noTarget = targetHealthFact(emptyRoot, {});
    const noCarrier = targetHealthFact(repoRoot, { targetRoot: mk({ pluginVersion: DELIVERED_VERSION, missingCarriers: [HEALTH_REQUIRED_CARRIERS[0]] }) });
    const noInitState = targetHealthFact(repoRoot, { targetRoot: mk({ initStateAbsent: true }) });
    const noPs = targetHealthFact(repoRoot, {
      targetRoot: ok,
      healthProbePrefix: cannedProbePrefix(emptyRoot, {
        probeVersion: 1, root: ok, rootPresent: true, nowMs: Date.now(), roundRecords: [],
        driverProcesses: null, initStatePresent: true, initStatePluginVersion: DELIVERED_VERSION,
        initStateLaidAt: null, initStateAgeSec: null,
        carriers: Object.fromEntries([...HEALTH_REQUIRED_CARRIERS, ...HEALTH_OBSERVED_CARRIERS].map((c) => [c, true])),
        fanInSteps: [], traceTruncated: false, fanInParseErrors: 0,
      }),
    });
    const cases = [
      ['no-target-configured', noTarget, []],
      ['probe-failed', probeFail, ['exit=255']],
      ['probe-unparseable', garbled, []],
      ['target-root-absent', absent, []],
      ['carrier-missing', noCarrier, [HEALTH_REQUIRED_CARRIERS[0]]],
      ['init-state-missing', noInitState, ['.quay/quay-init-state.json']],
      ['process-list-unreadable', noPs, ['ps -eo pid=,args=']],
    ];
    for (const [cause, fact, detail] of cases) {
      assert.equal(fact.name, TARGET_HEALTH_FACT_NAME, `${cause}: fact 名字`);
      assert.equal(fact.state, 'not-evaluated', `${cause}: state=not-evaluated`);
      assert.equal(fact.value.verdict, 'not-evaluated', `${cause}: verdict=not-evaluated`);
      assert.equal(fact.value.cause, cause, `${cause}: cause 是枚举值（实为 ${fact.value.cause}）`);
      assert.equal(fact.value.signals, null, `${cause}: ⛔ signals 必须是 null —— [] 会与「查过且零信号」同形（硬规则 3b）`);
      assert.notEqual(fact.value.verdict, 'healthy', `${cause}: ⛔ 不与 healthy 同形`);
      for (const d of detail) assert.ok(fact.value.causeDetail.includes(d), `${cause}: causeDetail 含 ${d}（实为 ${JSON.stringify(fact.value.causeDetail)}）`);
    }
    // 三态可区分（AC3 要求「贴出三态的实际输出」）：三种 verdict 各一例。
    // 「healthy」态必须有一个**真在跑**的目标 driver 进程：零进程夹具本身就是 unhealthy[not-driving]
    // （这正是本 fact 的首要信号），拿它当 healthy 对照会把两态压成一态。
    const healthyDir = mk({ pluginVersion: DELIVERED_VERSION });
    const proc = spawnTargetDriverFixture(healthyDir);
    assert.ok(waitForProcessVisible(proc.pid), '夹具进程已上进程表');
    const healthy = targetHealthFact(repoRoot, { targetRoot: healthyDir });
    const unhealthy = targetHealthFact(repoRoot, { targetRoot: mk({ pluginVersion: '0.0.1-stale' }) });
    console.log(`AC3[healthy]       ${healthy.reason}`);
    console.log(`AC3[unhealthy]     ${unhealthy.reason}`);
    console.log(`AC3[not-evaluated] ${probeFail.reason}`);
    console.log(`AC3[载体缺失]      ${noCarrier.reason}`);
    assert.deepEqual(
      [healthy.value.verdict, unhealthy.value.verdict, probeFail.value.verdict].filter((v, i, a) => a.indexOf(v) === i).sort(),
      ['healthy', 'not-evaluated', 'unhealthy'],
      '三态互不相同（各自独立取值）',
    );
    // 活性是**独立**字段（categorical，⛔ 不压进 verdict）：探针没跑成 ⇒ unknown（⛔ 不是 idle）。
    assert.equal(probeFail.value.liveness.state, 'unknown', '探针没跑成 ⇒ liveness=unknown（⛔ 不是 idle）');
    assert.ok(healthy.value.liveness.count >= 1 && healthy.value.liveness.state === 'driving', '有真进程 ⇒ driving；⛔ 与 unknown 不同形');
    assert.equal(noCarrier.value.liveness.count, 0, '无进程夹具 ⇒ 计数 0（⛔ 与 unknown 不同形）');
    assert.equal(noCarrier.value.liveness.state, 'idle', '无进程但进程表可读 ⇒ idle（真读数，不是 unknown）');
    assert.deepEqual(healthy.value.signals, [], 'healthy = 零信号（有进程 ∧ 形状一致）');
    proc.kill('SIGKILL');
  } finally {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  }
});


test('AC3: 探针形态读不懂 ⇒ probe-unparseable（⛔ 不把半个对象当读数 —— 硬规则 3b）', () => {
  assert.equal(parseHealthProbe(''), null, '空 stdout');
  assert.equal(parseHealthProbe('not json'), null, '非 JSON');
  assert.equal(parseHealthProbe('{"root":"/x"}'), null, '缺 rootPresent/nowMs ⇒ 形态不全即拒');
  assert.equal(parseHealthProbe('{"root":"/x","rootPresent":true,"nowMs":1,"roundRecords":"nope","carriers":{}}'), null, 'roundRecords 非数组即拒');
  assert.equal(parseHealthProbe('{"root":"/x","rootPresent":true,"nowMs":1,"roundRecords":[],"carriers":null}'), null, 'carriers 非对象即拒');
  assert.equal(
    parseHealthProbe('{"root":"/x","rootPresent":true,"nowMs":1,"roundRecords":[],"carriers":{},"fanInSteps":"nope"}'),
    null,
    'fanInSteps 非 null 且非数组 ⇒ 拒（同一类形态校验，覆盖 fan-in 载体维度）',
  );
  const ok = parseHealthProbe('{"root":"/x","rootPresent":true,"nowMs":1,"roundRecords":[],"carriers":{},"fanInSteps":null}');
  assert.ok(ok && ok.driverProcesses === null, '形态齐全才收；driverProcesses:null 与「零个进程」不同形（后者是 {count:0}）');
  assert.equal(ok.fanInSteps, null, 'fanInSteps 缺省态透传为 null（⛔ 不是 []）');
});

// ── AC4：版本一致性读数（目标项目配置形状 vs 交付物 plugin 版本，并排 + 可机械检出不等）───────────


test('AC4: pluginVersion 与交付物 plugin 版本并排出现，不等可机械检出（含 equal:null 的第三态）', () => {
  assert.ok(typeof DELIVERED_VERSION === 'string' && DELIVERED_VERSION !== '', '交付物版本可读（本仓 plugin/.claude-plugin/plugin.json）');
  const same = mkTargetRoot({ pluginVersion: DELIVERED_VERSION });
  const stale = mkTargetRoot({ pluginVersion: '0.0.1-stale' });
  const absent = mkTargetRoot({ initStateAbsent: true });
  try {
    const a = targetHealthFact(repoRoot, { targetRoot: same });
    const b = targetHealthFact(repoRoot, { targetRoot: stale });
    const c = targetHealthFact(repoRoot, { targetRoot: absent });
    assert.equal(a.value.pluginVersion.target, DELIVERED_VERSION, '目标侧 pluginVersion 读出（quay-init-state.json）');
    assert.equal(a.value.pluginVersion.delivered, DELIVERED_VERSION, '交付侧并排出现');
    assert.equal(a.value.pluginVersion.equal, true, '相等态');
    assert.equal(b.value.pluginVersion.equal, false, '不等态可机械检出（AC4 的核心）');
    assert.equal(c.value.pluginVersion.equal, null, '一侧读不到 ⇒ null（⛔ 不与 true 同形，硬规则 3b）');
    assert.equal(c.value.pluginVersion.initStatePresent, false, '连 state 文件在不在都要能区分');
    // 版本读数**带陈旧度**：mismatch 时它区分「刚补跑过」与「一个月没更新」。
    fs.writeFileSync(path.join(stale, '.quay', 'quay-init-state.json'), JSON.stringify({ pluginVersion: '0.0.1-stale', laidAt: Math.floor(Date.now() / 1000) - 3600 }), 'utf8');
    const bAged = targetHealthFact(repoRoot, { targetRoot: stale });
    // 龄 = 探针的 now - laidAt，探针在写盘之后跑 ⇒ 允许几秒漂移（⛔ 不钉死等值：那会把时钟漂移当缺陷）。
    assert.ok(Math.abs(bAged.value.pluginVersion.targetAgeSec - 3600) <= 5, `目标配置形状的龄被读出（陈旧度），实为 ${bAged.value.pluginVersion.targetAgeSec}`);
    assert.equal(c.value.pluginVersion.targetAgeSec, null, '无 state 文件 ⇒ 龄未知（⛔ 不是 0）');
    console.log(`AC4[equal]   target=${a.value.pluginVersion.target} delivered=${a.value.pluginVersion.delivered} equal=${a.value.pluginVersion.equal}`);
    console.log(`AC4[unequal] target=${b.value.pluginVersion.target} delivered=${b.value.pluginVersion.delivered} equal=${b.value.pluginVersion.equal}`);
  } finally {
    fs.rmSync(same, { recursive: true, force: true });
    fs.rmSync(stale, { recursive: true, force: true });
    fs.rmSync(absent, { recursive: true, force: true });
  }
});

// ── 生产接线（硬规则 4 推论三：判据必须读生产载体，⛔ 不能只被 fixture 满足）─────────────────────


test('接线: drivers.yml 声明被驱动系统绑定 ⇒ 生产路径解析出真绑定（⛔ 不是恒 not-evaluated 的空转）', () => {
  const declared = declaredTargetBinding(repoRoot);
  assert.ok(declared.root !== null, '生产 drivers.yml 声明了 target_root（否则该读数在生产上恒 not-evaluated = 空转）');
  const argv = buildHealthProbeArgv(declared, {});
  assert.ok(Array.isArray(argv) && argv.length > 0, '绑定 ⇒ 探针 argv 可构造');
  if (declared.host !== null) {
    assert.equal(argv[0], 'ssh', '声明了 host ⇒ 传输是 ssh（目标项目在别的机器上）');
    assert.ok(argv.includes('-o'), '带 -o 选项（BatchMode=yes + ConnectTimeout）');
    assert.ok(argv.some((a) => a.includes('ConnectTimeout=')), '⛔ 必须有连接超时：不可达要快速失败成 not-evaluated，⛔ 不能挂住整条例程');
    assert.ok(argv.some((a) => a === declared.host), 'ssh 目标是声明的主机');
    assert.ok(argv.some((a) => a.includes(declared.root)), '远端命令串里带目标根');
  } else {
    assert.ok(argv.includes(declared.root), '本机目标 ⇒ 直接本地读');
  }
  // 覆盖语义：显式覆盖是**整体性**的（⛔ 不与 drivers.yml 逐键混搭 —— 那会让「只指定本地夹具 root」
  // 变成「拿声明的 host 去 ssh 生产机」，测试缝静默打到真机）。
  assert.deepEqual(resolveTargetBinding(repoRoot, { root: '/tmp/x' }), { host: null, root: '/tmp/x' }, '只覆盖 root ⇒ host 归零（本机）');
  assert.equal(resolveTargetBinding(repoRoot, {}).root, declared.root, '未覆盖 ⇒ 用声明值');
  assert.equal(resolveTargetBinding(repoRoot, { root: '' }).root, null, '显式空串 = 本次运行不绑目标（⇒ not-evaluated）');
});


test('接线: drivers.yml 缺失/无 target_* ⇒ 未声明目标（⛔ 不起任何进程，也不报「健康」）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-target-nodecl-'));
  try {
    assert.deepEqual(declaredTargetBinding(tmp), { host: null, root: null }, '无 drivers.yml ⇒ 未声明');
    assert.equal(buildHealthProbeArgv({ host: null, root: null }, {}), null, '未声明 ⇒ 无 argv（⛔ 不 spawn）');
    // 夹具 drivers.yml：只声明 root（host 缺省 = 本机）。
    fs.mkdirSync(path.join(tmp, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugin', 'scripts', 'drivers.yml'), 'version: 1\nkinds:\n  goal:\n    target_root: /tmp/fake-target\n', 'utf8');
    assert.deepEqual(declaredTargetBinding(tmp), { host: null, root: '/tmp/fake-target' }, '就地从 drivers.yml 读出绑定（生产同一实现）');
    const f = targetHealthFact(tmp, {});
    assert.equal(f.value.verdict, 'not-evaluated', '根不存在 ⇒ not-evaluated');
    assert.equal(f.value.cause, 'target-root-absent', '成因是「根不存在」，⛔ 不是「未声明」');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('deriveTargetHealth 是纯函数三态：probe 失败 ⇒ 独立取值，⛔ 不与 healthy 同形', () => {
  const binding = { host: null, root: '/tmp/x' };
  const v = deriveTargetHealth(
    binding,
    { ok: false, cause: 'probe-failed', detail: ['exit=255'] },
    { deliveredPluginVersion: null, windowSec: HEALTH_WINDOW_SEC_DEFAULT },
  );
  assert.equal(v.verdict, 'not-evaluated');
  assert.equal(v.signals, null, '⛔ 不是 []');
  assert.equal(v.cause, 'probe-failed');
  assert.equal(v.liveness.state, 'unknown', '⛔ unknown ≠ idle');
});


// ── 业务目标层（第二层提问：退出条件 ⊨ 业务目标）──────────────────────────────────────────────
//
// 任务：gap-goal-sufficiency-judges-wrong-layer-and-emits-unverifiable-verdict。
// 第一层判「AC 集 ⊇ 退出条件」，第二层判「退出条件（在实际取得的证据下）⊨ 业务目标」。GOAL-016 实测：
// 第一层 covered 是对的，而业务目标层不充分（样本量 = 1：全部证据来自同一个 project_root）。
// 四条 AC 的对应单测：AC1 两层可区分 / AC2 指认可复核 / AC3 ⛔ 不默认 covered / AC4 证据真的被消费。

/** 判定器测试缝：把给定对象当 stdout 原样输出（prompt 作末参数追加、被忽略）。 */

/** 写一个证据载体 `.quay/productization-verification.jsonl`（行 = 记录）。 */

/** 一条证据记录。 */


/** 每个用例开头隔离两层缓存的模块级状态（否则前一个用例的裁决会被后一个用例命中）。 */

// ── AC1 两层可区分 ────────────────────────────────────────────────────────────────────────


test('AC1: 同一输入上两层给出可区分的结论（第一层 covered ∧ 第二层 unsubstantiated），⛔ 不合并', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac1-'));
  try {
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);

    // 第一层：机械部分判不出（有退出条件 + 有在域 AC）⇒ 语义判定（缝）判 covered。
    assert.equal(goalSufficiencyVerdict(OBJECTIVE_GOAL, OBJECTIVE_ACS), 'not-evaluated', '前置：第一层机械部分判不出');
    const l1 = await semanticSufficiencyVerdict(OBJECTIVE_GOAL, OBJECTIVE_ACS, tmp, {
      sufficiencyCmd: judgeCmd({ verdict: 'covered' }),
    });
    assert.equal(l1, 'covered', '第一层 = covered（AC 集确实覆盖退出条件）');

    // 第二层：同一输入，证据全部来自同一 project_root ⇒ 不充分（带指认）。
    const evidence = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    const l2 = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'project_root', value: '/p/one' }),
    });
    assert.equal(l2.verdict, 'unsubstantiated', '第二层 = unsubstantiated');

    // 两层结论【可区分】：取值不同，且第二层词表不落在第一层的两态里（⛔ 不是同一个词换了层）。
    assert.notEqual(l1, l2.verdict, '两层结论必须不同形');
    assert.ok(!['covered', 'insufficient'].includes(l2.verdict), 'unsubstantiated ⛔ 不在第一层词表内');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC2 指认可复核 ────────────────────────────────────────────────────────────────────────
