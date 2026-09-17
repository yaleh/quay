// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/6 (16 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).
// FURTHER SPLIT by gap-suite-split-15-over-30s-test-files — the two "real ring: closeBlocks" tests moved to goal-driver-s07.test.mjs (shard 7); then the AC-216 复验域 group (4 tests) moved to goal-driver-s12.test.mjs and the three real-goal-store tests (sweepFrozenAcs / readFrozenFailing / 端到端, from the AC-242 successor + ③ 冻结population sections) moved to goal-driver-s13.test.mjs, each with their section comments; the remaining 7 tests stay here.

import { test } from "node:test";
import { assert, buildGapWorkerPrompt, computeGoalGaps, fs, goalCloseBlockFromRecords, isFilingGapState, os, parseFrozenFailingReading, path, probeLedger, repoRoot, runGapSpawnPass, runGoalRound, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

test('AC3 — runGoalRound 轮记录 value 带 scopeSize + evaluated（空作用域可被机械读出）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-roundscope-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // 0 active goal（只有 achieved goal + achieved AC）——生产空作用域形态。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    assert.ok(fact && fact.value && typeof fact.value === 'object', 'runGoalRound 返回 fact.value');
    const v = fact.value;
    assert.ok(v.staleness != null, 'staleness 非 null（读得到）');
    assert.equal(v.staleness.scopeSize, 0, '轮记录 staleness.scopeSize=0');
    assert.equal(v.staleness.evaluated, false, '轮记录 staleness.evaluated=false');
    assert.ok(v.achievedFailing != null, 'achievedFailing 非 null（读得到）');
    assert.equal(v.achievedFailing.scopeSize, 0, '轮记录 achievedFailing.scopeSize=0');
    assert.equal(v.achievedFailing.evaluated, false, '轮记录 achievedFailing.evaluated=false');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 关闭前置：不许把「已知失败」冻结在复验域之外 ─────────────────────────────────────────
// gap-goal-closure-freezes-failing-ac-outside-reverify-scope。缺陷实测（生产 round 149，
// 2026-09-08T19:55:07.756Z）：AC-161 是唯一 fail 项，同一轮 GOAL-003 被机械 flip achieved ——
// 关闭后每轮循环只遍历 activeGoals，该 AC 从此不再被 gate，失败被永久冻结，且 AC-241 结构上永不通过。


test('goalCloseBlockFromRecords 三态臂：①全 pass ⇒ clear；②achieved+尾 fail 未声明 long-term ⇒ blocked-failing-ac 且枚举 AC；③声明 long-term ⇒ 恢复 clear', () => {
  const fixture = (acLongTerm) => [
    { id: 'GOAL-900', status: 'active', kind: 'goal' },
    { id: 'AC-901', status: 'achieved', goal: 'GOAL-900', longTerm: false, evidence: { verdict: 'pass' } },
    { id: 'AC-902', status: 'achieved', goal: 'GOAL-900', longTerm: acLongTerm, evidence: { verdict: 'fail' } },
  ];
  // ① 全 pass 且无 long-term ⇒ clear（⛔ 不是恒 blocked：谓词能取假）。
  assert.deepEqual(
    goalCloseBlockFromRecords(fixture(true), 'GOAL-900', { readable: true }),
    { verdict: 'clear', acs: [], cause: null },
    '臂①：无 achieved+fail 的 AC ⇒ clear');
  // ② 一条 achieved ∧ 尾 fail ∧ 未声明 long-term ⇒ 不放行，且【枚举】被点名的 AC（硬规则 3，⛔ 不布尔）。
  assert.deepEqual(
    goalCloseBlockFromRecords(fixture(false), 'GOAL-900', { readable: true }),
    { verdict: 'blocked-failing-ac', acs: ['AC-902'], cause: null },
    '臂②：achieved+尾fail+未声明 long-term ⇒ blocked-failing-ac 并列出 AC-902');
  // ③ 逃生口：该 AC 声明 long-term ⇒ 恢复 clear（AC-222『GOAL 必须能自动关闭』不被本前置永久堵死）。
  assert.deepEqual(
    goalCloseBlockFromRecords(fixture(true), 'GOAL-900', { readable: true }),
    { verdict: 'clear', acs: [], cause: null },
    '臂③：声明 long-term ⇒ 恢复可关闭（逃生口）');
  // 负控制：status 不是 achieved 的 AC 即便尾 fail 也不阻塞（前置只针对「已达成却已变红」）。
  const notAchieved = [
    { id: 'GOAL-900', status: 'active', kind: 'goal' },
    { id: 'AC-903', status: 'active', goal: 'GOAL-900', longTerm: false, evidence: { verdict: 'fail' } },
  ];
  assert.equal(goalCloseBlockFromRecords(notAchieved, 'GOAL-900', { readable: true }).verdict, 'clear',
    '负控制：active AC 尾 fail 不阻塞关闭（那是 I5/缺口面的事，不是冻结）');
  // 作用域：别的 GOAL 名下同样的 AC 不影响本 GOAL（⛔ 不是全库布尔）。
  const otherGoal = [
    { id: 'GOAL-900', status: 'active', kind: 'goal' },
    { id: 'AC-904', status: 'achieved', goal: 'GOAL-999', longTerm: false, evidence: { verdict: 'fail' } },
  ];
  assert.equal(goalCloseBlockFromRecords(otherGoal, 'GOAL-900', { readable: true }).verdict, 'clear',
    '作用域：别的 GOAL 名下的红 AC 不阻塞本 GOAL');
});


test('goalCloseBlockFromRecords 第三态 not-evaluated：台账读不到时不得与 clear 同形（硬规则 3b），且两种成因可分', () => {
  const records = [{ id: 'AC-901', status: 'achieved', goal: 'GOAL-900', longTerm: false, evidence: null }];
  const absent = goalCloseBlockFromRecords(records, 'GOAL-900', { readable: false, cause: 'ledger-absent' });
  const unreadable = goalCloseBlockFromRecords(records, 'GOAL-900', { readable: false, cause: 'ledger-unreadable' });
  assert.deepEqual(absent, { verdict: 'not-evaluated', acs: [], cause: 'ledger-absent' },
    '台账缺失 ⇒ not-evaluated（⛔ 不与 clear 同形：否则删掉台账就能把任何红 AC 静默冻结）');
  assert.equal(unreadable.cause, 'ledger-unreadable', '两种成因可区分（ledger-absent vs ledger-unreadable）');
  assert.notDeepEqual(absent, unreadable, '⛔ 两种成因不得同形');
  assert.notEqual(absent.verdict, 'clear', 'not-evaluated ≠ clear');
  assert.notEqual(absent.verdict, 'blocked-failing-ac', 'not-evaluated ≠ blocked-failing-ac（三态互不同形）');
  // 探针本身：真实临时目录（无台账）⇒ ledger-absent；建一个台账 ⇒ readable。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ledgerprobe-'));
  try {
    assert.deepEqual(probeLedger(tmp), { readable: false, cause: 'ledger-absent' }, '无台账 ⇒ ledger-absent');
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.quay', 'gate-events.jsonl'), '', 'utf8');
    assert.deepEqual(probeLedger(tmp), { readable: true }, '台账存在且可读 ⇒ readable');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


// ── ③ 冻结population 的所有权（gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation）─────
// 缺陷：一条 `achieved ∧ 已离开复验域（GOAL 非 active ∧ 未声明 long-term）` 的 AC，其台账尾 verdict
// 被**任何一次一次性判据运行**改写成 fail 后，`computeGoalGaps` 此前**一个分支都不给它**——不 active
// 故不进 ①、不在域内故不进 ② ⇒ 检测得到（AC-242 每轮红）却没有消费者。这里钉住第三个 population。


test('冻结population：读数三态解析（退出码 0/1/3/其它）——⛔ 三态不同形，且「读不到」不与「零条」同形', () => {
  const j = (o) => JSON.stringify(o);
  const clean = parseFrozenFailingReading(j({ failing: [], frozenScope: 78, rotation: { sweptEver: 78 } }), 0);
  assert.equal(clean.judgment, 'clean');
  assert.equal(clean.cause, null);
  assert.deepEqual(clean.failing, []);

  const violated = parseFrozenFailingReading(j({ failing: ['AC-147', 'AC-149'], frozenScope: 78 }), 1);
  assert.equal(violated.judgment, 'violated');
  assert.deepEqual(violated.failing, ['AC-147', 'AC-149'], '违反是【枚举】不是布尔（硬规则 3）');

  // exit 3 = 判据自己的「机制不在 / 此处无法评估」态：⛔ 必须与 clean 不同形（硬规则 3b）。
  const noRot = parseFrozenFailingReading(j({ failing: [], frozenScope: 78, rotation: { sweptEver: 0 } }), 3);
  assert.equal(noRot.judgment, 'not-evaluated');
  assert.equal(noRot.cause, 'no-rotation', '成因可区分：轮转从未跑过（机制不在）');
  const neCrit = parseFrozenFailingReading(j({ failing: [], frozenScope: 78, rotation: { sweptEver: 12 }, notEvaluated: ['AC-X'] }), 3);
  assert.equal(neCrit.judgment, 'not-evaluated');
  assert.equal(neCrit.cause, 'criterion-not-evaluated', '成因可区分：判据声明此地无法评估');

  // 台账/命令读不到 ⇒ 第三个成因，⛔ 绝不回落 clean。
  const unreadable = parseFrozenFailingReading('not json at all', null);
  assert.equal(unreadable.judgment, 'not-evaluated');
  assert.equal(unreadable.cause, 'unreadable');
  assert.equal(unreadable.frozenScope, -1, 'frozenScope 读不到 ⇒ -1（⛔ 不与 0 同形）');
  assert.notEqual(unreadable.judgment, clean.judgment, '读不到 ≠ 查过且全好');
});


test('冻结population ⇒ frozen-violated（独立取值）；long-term / GOAL active 两条逃生口同时成立', () => {
  const mk = (extra) => [
    { id: 'GOAL-001', status: 'achieved' },
    { id: 'AC-001', status: 'achieved', goal: 'GOAL-001', criterion: 'exit 1', ...extra },
  ];
  const frozen = { failing: ['AC-001'], judgment: 'violated', cause: null, frozenScope: 1 };
  // 正：域外 ∧ achieved ∧ 此刻为假 ∧ 无在飞任务 ⇒ frozen-violated（可立案）。
  const g = computeGoalGaps(mk({}), [], null, null, frozen).find((x) => x.ac === 'AC-001');
  assert.equal(g.state, 'frozen-violated');
  assert.equal(g.taskCount, 0);
  assert.ok(isFilingGapState('frozen-violated'), 'frozen-violated 在 spawn 选取面内（被枚举 ≠ 有主）');
  assert.notEqual(g.state, 'standing-violated', '⛔ 与 standing-violated 不同形：两个 population 的成因与处置不同');

  // 逃生口①：声明 long-term ⇒ 进 AC-216 复验域 ⇒ **改由 ② 判**（不再落 frozen-violated）。
  // ⚠️ 不是「消失」：它换了 population，读数由 ② 给（此处 standings=null ⇒ not-evaluated；给读数则是
  // standing-violated / standing-ok）。两个 population 的成员集**互斥**，⛔ 一条 AC 不得同时出现在两边。
  const lt = computeGoalGaps(mk({ longTerm: true }), [], null, null, frozen).find((x) => x.ac === 'AC-001');
  assert.notEqual(lt.state, 'frozen-violated', 'long-term ⇒ 离开冻结population（由 ② 管）');
  assert.equal(computeGoalGaps(mk({ longTerm: true }), [], null, { achievedButFailing: ['AC-001'], evaluated: true }, frozen)
    .find((x) => x.ac === 'AC-001').state, 'standing-violated', 'long-term + 此刻为假 ⇒ ② 的 standing-violated（⛔ 不是冻结population 的取值）');

  // 逃生口②：GOAL 置 active ⇒ 进 `inAchievedReverifyScope` 的 active 分支 ⇒ 不再是冻结population。
  // ⚠️ 它此后**没有**缺口读数——那是既有分工：active GOAL 名下的 achieved AC 由 I5（`achievedButFailing`）
  // + GOAL 关闭闸（`blocked-failing-ac`）管，⛔ 不由本 population 管（gap-goal-achieved-but-failing-no-handler）。
  const activeRecs = [{ id: 'GOAL-001', status: 'active' }, { id: 'AC-001', status: 'achieved', goal: 'GOAL-001', criterion: 'exit 1' }];
  const act = computeGoalGaps(activeRecs, [], null, { achievedButFailing: ['AC-001'], evaluated: true }, frozen)
    .find((x) => x.ac === 'AC-001');
  assert.notEqual(act?.state, 'frozen-violated', 'GOAL active ⇒ 离开冻结population（改由 I5 + 关闭闸管）');

  // 压下：有一条在飞任务 ⇒ 不再是 frozen-violated（⛔ 不每轮重复 spawn）。
  const inFlight = computeGoalGaps(mk({}), [{ id: 't', status: 'ready', goalAc: 'AC-001' }],
    { eligibleTodoIds: new Set(), excludedReadyIds: new Set() }, null, frozen).find((x) => x.ac === 'AC-001');
  assert.equal(inFlight.state, 'in-progress', '在飞 ⇒ 不重复立案');
  // 但 done 的关联任务**不**压下（它不覆盖「此刻仍为假」）——与 standing-violated 同一口径。
  assert.equal(computeGoalGaps(mk({}), [{ id: 't', status: 'done', goalAc: 'AC-001' }], null, null, frozen)
    .find((x) => x.ac === 'AC-001').state, 'frozen-violated', 'done 的关联任务不覆盖「此刻仍为假」');
});


test('冻结population：查过且全好 ⇒ 零读数；查不成 ⇒ 逐条 not-evaluated（⛔ 两者不同形，硬规则 3b）', () => {
  const recs = [
    { id: 'GOAL-001', status: 'achieved' },
    { id: 'AC-001', status: 'achieved', goal: 'GOAL-001', criterion: 'exit 1' },
  ];
  const clean = { failing: [], judgment: 'clean', cause: null, frozenScope: 1 };
  assert.equal(computeGoalGaps(recs, [], null, null, clean).length, 0, '查过且此刻为真 ⇒ 无工作可立（population 78 条，无事不产生读数）');

  const ne = { failing: [], judgment: 'not-evaluated', cause: 'unreadable', frozenScope: -1 };
  const g = computeGoalGaps(recs, [], null, null, ne);
  assert.equal(g.length, 1, '查不成 ⇒ **必须**产生读数（⛔ 静默读成「全好」）');
  assert.equal(g[0].state, 'not-evaluated');
  assert.equal(g[0].taskCount, null, 'not-evaluated 时 taskCount=null（⛔ 不与 0 同形）');

  // 负控制：本文件未传读数（默认 null）⇒ 同样落 not-evaluated，⛔ 不回落成「无读数」。
  assert.equal(computeGoalGaps(recs, [], null, null).find((x) => x.ac === 'AC-001').state, 'not-evaluated',
    '未传读数 ⇒ not-evaluated（fail-visible：调用方漏传不得与「查过且全好」同形）');
});


test('冻结population：frozen-violated 进 spawn 选取面；prompt 带三条合法终态', () => {
  const records = [
    { id: 'GOAL-001', status: 'achieved' },
    { id: 'AC-001', status: 'achieved', goal: 'GOAL-001', criterion: 'exit 1' },
  ];
  const gaps = [
    { goal: 'GOAL-001', ac: 'AC-001', state: 'frozen-violated', taskCount: 0 },
    { goal: 'GOAL-001', ac: 'AC-002', state: 'standing-ok', taskCount: 0 },
    { goal: 'GOAL-001', ac: 'AC-003', state: 'not-evaluated', taskCount: null },
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-frozen-spawn-'));
  try {
    const r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 3 });
    assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-001'], '只有 frozen-violated 消耗 spawn 名额（standing-ok / not-evaluated ⛔ 不）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const p = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-001', state: 'frozen-violated', taskCount: 0 }, 'g', 'a', 'e', '/repo');
  assert.ok(p.includes('LEFT the reverify scope'), '口径：说明这条 AC 已离开复验域（⛔ 不是常设不变式回归）');
  assert.ok(p.includes('IN FLIGHT'), '去重：只有在飞任务才算重复');
  assert.ok(!p.includes('ANY status'), '⛔ 不得沿用 gap 的 ANY-status 去重（否则每轮拒立案、缺口永无执行者）');
  assert.ok(p.includes('make the criterion TRUE again') && p.includes('superseded') && p.includes('long-term: true'),
    'prompt 必须列出三条合法终态（重跑转绿 / superseded 写明理由 / 声明 long-term 回域）');
  assert.ok(!p.includes('regressed'), '⛔ 冻结population 不得复用常设口径的措辞（两个 population 不同形）');
});


// ── 立案前【直接量复核】（gap-frozen-violated-files-on-stale-verdict）──────────────────────────────
//
// 缺陷：`frozenReading.failing` 是**台账读数**（轮转 verdict，新鲜度界 4h），而轮转周期实测 13–101 min
// ⇒ 修复落地后尾读数最长数小时仍写 `fail`，driver 每轮据此立案 + prompt 逐字告诉下游「earlier fix did
// not hold」。修法 = 立案前真跑一次那条 criterion，只有复核后**仍非 0** 才产 frozen-violated。
//
// 下面四组互为控制：①三态互不同形（含闸拒绝）；②真跑判据的「修复已落地」形态（cleared）；③缺口分派
// 的改前/改后对照（同一时刻同一 AC）；④端到端（生产形态：修复落地、台账尾尚未轮转 ⇒ 不立案）。
