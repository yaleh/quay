// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/6 (16 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { DELIVERED_VERSION, GOAL_ACCEPTANCE_ACTIVE_ENV, PRE_CHANGE_ENTRY, assert, buildGapWorkerPrompt, computeGoalGaps, fs, goalFlipDecision, hasPrefilingEvidence, isFilingGapState, mkTargetRoot, os, path, readFrozenFailing, readHostHealth, recheckFrozenFailing, recheckStandingFailing, repoRoot, runGoalRound, spawn, spawnTargetDriverFixture, sweepFrozenAcs, targetHealthFact, waitForProcessVisible, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

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
