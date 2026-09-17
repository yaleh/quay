// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/4 (23 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { ALL_GAP_STATES, GOAL_CONTROL_STATE_REL, GOAL_GAPS_FACT_NAME, GOAL_ROUND_REL, OBJECTIVE_ACS, OBJECTIVE_ASSERTION_FIELDS, OBJECTIVE_EVIDENCE_CARRIERS, OBJECTIVE_GOAL, QUIET_GAP_STATES, assert, collectObjectiveEvidence, computeGoalGaps, derivedByAc, derivedCriterionRecords, evRecord, fs, gapViewEntries, gapViewFact, goalCiRunsCollect, goalCiRunsThrottleMs, goalCliResolvable, goalDriverRoutines, goalFlipDecision, goalStoreArgv, goalSufficiencyVerdict, isFilingGapState, judgeCmd, objectiveAssertionCommand, objectiveCacheKey, objectiveEvidenceProfile, objectiveSufficiencyVerdictDetail, os, parseFrozenFailingReading, path, readsFrozenPopulation, repoRoot, resetObjectiveTestState, runGapSpawnPass, runGoalRound, runResidentQualityGateLoop, spawn, spawnSync, verifyObjectiveAssertion, writeEvidenceCarrier, writeGoalFile, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

test('AC2: unsubstantiated 携带指认，且指认能被一条命令复核（命令真的跑出 matched=total）', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac2-'));
  try {
    writeEvidenceCarrier(tmp, [
      evRecord('GOAL-001-AC-001'),
      evRecord('GOAL-001-AC-002', { task_id: 'T-2' }),
    ]);
    const evidence = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    const detail = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'project_root', value: '/p/one' }),
    });

    const a = detail.assertion;
    assert.ok(a !== null, 'unsubstantiated 必须带指认（⛔ 不可复核的判决不得冒充结论）');
    assert.equal(a.kind, 'single-value-field');
    assert.equal(a.field, 'project_root');
    assert.equal(a.value, '/p/one');
    assert.equal(a.matched, 2, 'matched 由产出侧机械算出（判定器不提供）');
    assert.equal(a.total, 2, 'total 由产出侧机械算出（判定器不提供）');
    assert.deepEqual(a.acs, ['GOAL-001-AC-001', 'GOAL-001-AC-002']);
    assert.deepEqual(a.carriers, ['.quay/productization-verification.jsonl'], '载体是 repo-root-relative 路径（命令要能直接跑）');
    assert.ok(a.command.includes('python3'), '指认携带一条可复核命令');

    // 真的跑那条命令（在仓库根语义下：cwd = tmp，载体在 .quay/ 下）。
    const ok = spawnSync('bash', ['-c', a.command], { cwd: tmp, encoding: 'utf8' });
    assert.equal(ok.status, 0, `复核命令应 exit 0，实际 ${ok.status}：${ok.stderr}`);
    assert.match(ok.stdout, /matched=2 total=2/, '命令输出与指认的 matched/total 一致');

    // 负控制（同一条命令的能取假半边）：换一个值 ⇒ matched 归零、exit 1。
    const bad = spawnSync('bash', ['-c', objectiveAssertionCommand(a.acs, a.field, '/p/NOT-THERE', a.carriers)], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(bad.status, 1, '指认为假 ⇒ 命令 exit 1（⛔ 不是恒绿）');
    assert.match(bad.stdout, /matched=0 total=2/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 ⛔ 不默认 covered ─────────────────────────────────────────────────────────────────


test('AC3: 无指认的 unsubstantiated ⇒ not-evaluated（⛔ 不是 covered 也不是 unsubstantiated）', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac3a-'));
  try {
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);
    const evidence = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    const d = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      // 判定器说「不充分」但【不给指认】——这正是「能解释的说法 ≠ 被检验的结论」的形态。
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated' }),
    });
    assert.equal(d.verdict, 'not-evaluated', '无指认 ⇒ not-evaluated');
    assert.notEqual(d.verdict, 'substantiated', '⛔ 不默认 covered/substantiated');
    assert.notEqual(d.verdict, 'unsubstantiated', '⛔ 也不接受这条不可复核的结论');
    assert.equal(d.cause, 'assertion-missing', '成因可区分：指认缺失');
    assert.equal(d.assertion, null, '⛔ 不携带一条未复核通过的指认');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC3: 指认复核不成立（值与记录不符 / 字段在词表外 / 断言本身为假）⇒ not-evaluated', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac3b-'));
  try {
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);
    const evidence = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);

    // (a) 值编错了 ⇒ 逐字比对失败。
    const wrongValue = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'project_root', value: '/p/INVENTED' }),
    });
    assert.equal(wrongValue.verdict, 'not-evaluated');
    assert.equal(wrongValue.cause, 'assertion-unverifiable');

    // (b) 字段不在白名单（自由文本字段名 ⇒「一条命令复核」无从谈起）。
    const badField = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'some_narrative_field', value: 'x' }),
    });
    assert.equal(badField.verdict, 'not-evaluated');
    assert.equal(badField.cause, 'assertion-unverifiable');

    // (c) 指认一个「并非取同一值」的字段：让 task_id 出现两个取值 ⇒ 全称断言不成立。
    writeEvidenceCarrier(tmp, [
      evRecord('GOAL-001-AC-001'),
      evRecord('GOAL-001-AC-002', { task_id: 'T-2' }),
    ]);
    const multiEvidence = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    assert.equal(verifyObjectiveAssertion('task_id', 'T-1', multiEvidence).ok, false, '前置：task_id 非单一取值');
    const multi = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, multiEvidence, tmp, {
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'task_id', value: 'T-1' }),
    });
    assert.equal(multi.verdict, 'not-evaluated');
    assert.equal(multi.cause, 'assertion-unverifiable');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC3: 判定器不可用 / 读不懂 / 两次不一致 ⇒ not-evaluated，⛔ 绝不回落 substantiated', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac3c-'));
  try {
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001')]);
    const evidence = collectObjectiveEvidence(tmp, ['AC-001'], OBJECTIVE_EVIDENCE_CARRIERS);

    const empty = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, { objectiveCmd: [] });
    assert.equal(empty.verdict, 'not-evaluated');
    assert.equal(empty.cause, 'judge-unavailable');

    const gone = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: ['/nonexistent/definitely-not-a-binary'],
    });
    assert.equal(gone.verdict, 'not-evaluated');
    assert.equal(gone.cause, 'judge-unavailable');

    const gibberish = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: ['node', '-e', 'process.stdout.write("I think it is probably fine")'],
    });
    assert.equal(gibberish.verdict, 'not-evaluated');
    assert.equal(gibberish.cause, 'judge-unparseable');

    // 两次取样不一致：第一个样本建计数器文件并答 unsubstantiated，第二个样本见到它改答 substantiated。
    // ⛔ 不取多数票、⛔ 不回落 substantiated（硬规则：判不出有独立取值）。
    const counter = path.join(tmp, 'judge-counter');
    const flip = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evidence, tmp, {
      objectiveCmd: ['sh', '-c', `if [ -f ${counter} ]; then echo substantiated; else : > ${counter}; echo unsubstantiated; fi`],
    });
    assert.equal(flip.verdict, 'not-evaluated');
    assert.equal(flip.cause, 'samples-disagree');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 证据来源真的被消费（⛔ 不是「参数被读到」）──────────────────────────────────────────


test('AC4: 改变载体记录会改变结论（同一判定器输出、同一 goal）', async () => {
  resetObjectiveTestState();
  const sameJudge = { verdict: 'unsubstantiated', field: 'project_root', value: '/p/one' };
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac4a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac4b-'));
  try {
    // A：两条记录同源（同一 project_root）⇒ 指认成立 ⇒ unsubstantiated。
    writeEvidenceCarrier(dirA, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);
    // B：**只多了一条**来自另一个 project_root 的记录，其余一切相同。
    writeEvidenceCarrier(dirB, [
      evRecord('GOAL-001-AC-001'),
      evRecord('GOAL-001-AC-002'),
      evRecord('GOAL-001-AC-002', { project_root: '/p/two', task_id: 'T-3' }),
    ]);
    const evA = collectObjectiveEvidence(dirA, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    const evB = collectObjectiveEvidence(dirB, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);

    // 先证明输入真的不同（否则下面的「结论不同」是空转）。
    assert.equal(objectiveEvidenceProfile(evA).distinctProjectRoots.length, 1);
    assert.equal(objectiveEvidenceProfile(evB).distinctProjectRoots.length, 2);
    assert.notEqual(
      objectiveCacheKey(OBJECTIVE_GOAL, OBJECTIVE_ACS, evA),
      objectiveCacheKey(OBJECTIVE_GOAL, OBJECTIVE_ACS, evB),
      '载体记录进缓存 key ⇒ 记录一变必重判（⛔ 不拿旧证据下的裁决继续用）',
    );

    const dA = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evA, dirA, { objectiveCmd: judgeCmd(sameJudge) });
    const dB = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, evB, dirB, { objectiveCmd: judgeCmd(sameJudge) });

    assert.equal(dA.verdict, 'unsubstantiated', 'A：证据同源 ⇒ 指认成立');
    assert.equal(dB.verdict, 'not-evaluated', 'B：证据变成两个 project_root ⇒ 同一条指认不再成立');
    assert.notEqual(dA.verdict, dB.verdict, '★ AC4：同一判定器输出下，结论随载体记录改变');
    assert.equal(dB.cause, 'assertion-unverifiable', '成因说明是「指认被记录否证」，⛔ 不是判定器换了话');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});


test('AC4: 零证据记录 ⇒ not-evaluated(no-evidence-records)，profile 是机械读出而非常量', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-ac4z-'));
  try {
    // 载体里有一条**不属于本 GOAL** 的记录 ⇒ 对 GOAL-001 而言证据为零（来源完备性：过滤按 AC 归属）。
    writeEvidenceCarrier(tmp, [evRecord('GOAL-002-AC-009')]);
    const none = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    assert.equal(none.length, 0, '不属本 GOAL 的记录不计入证据');
    const d = await objectiveSufficiencyVerdictDetail(OBJECTIVE_GOAL, OBJECTIVE_ACS, none, tmp, {
      // 判定器即使说「成立」，零证据也不得采信（⛔ 不是「判定器说了算」）。
      objectiveCmd: judgeCmd({ verdict: 'substantiated' }),
    });
    assert.equal(d.verdict, 'not-evaluated', '零证据 ⇒ not-evaluated（⛔ 不默认 substantiated）');
    assert.equal(d.cause, 'no-evidence-records');
    assert.equal(d.profile.records, 0, 'profile 仍被产出（「查过且零条」与「没查」不同形）');
    assert.deepEqual(d.profile.distinctProjectRoots, []);

    // 同一条记录换成属于本 GOAL ⇒ 证据为 1 条（profile 是机械读出，不是一个恒常量）。
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001')]);
    const one = collectObjectiveEvidence(tmp, ['AC-001', 'AC-002'], OBJECTIVE_EVIDENCE_CARRIERS);
    assert.equal(one.length, 1);
    assert.deepEqual(objectiveEvidenceProfile(one).distinctProjectRoots, ['/p/one']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC4: verifyObjectiveAssertion 的机械复核能取假（同源 ⇒ ok；一条不同源 ⇒ 不 ok）', () => {
  resetObjectiveTestState();
  const same = [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')];
  const mixed = [...same, evRecord('GOAL-001-AC-002', { project_root: '/p/two' })];
  const strip = ({ ok, matched, total }) => ({ ok, matched, total });
  assert.deepEqual(strip(verifyObjectiveAssertion('project_root', '/p/one', same)), { ok: true, matched: 2, total: 2 });
  assert.deepEqual(strip(verifyObjectiveAssertion('project_root', '/p/one', mixed)), { ok: false, matched: 2, total: 3 });
  // 空集上的全称命题恒真 → 本复核显式判不通过（硬规则 4：结构上不可能取假的量不是测量）。
  assert.equal(verifyObjectiveAssertion('project_root', '/p/one', []).ok, false, '零记录不算通过');
  assert.equal(verifyObjectiveAssertion('nope', '/p/one', same).ok, false, '字段在词表外 ⇒ 不通过');
  assert.ok(OBJECTIVE_ASSERTION_FIELDS.includes('project_root'));
});

// ── DoD: 第一层判定不得因新增提问层而退化 ──────────────────────────────────────────────────


test('DoD: 第一层三态与 goalFlipDecision 原样不变（新层是并列读数，⛔ 不接进关闸）', () => {
  // 与 goal-sufficiency-gate.test.mjs 逐条同断言：新层不得让这三条结论漂移。
  resetObjectiveTestState();
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## body\nx' }, [{ id: 'AC-001' }]), 'insufficient');
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n1. 条件一\n' }, []), 'insufficient');
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n1. 条件一\n' }, [{ id: 'AC-001' }]), 'not-evaluated');
  assert.equal(goalSufficiencyVerdict({ id: 'GOAL-001', body: '## 退出条件\n\n## 风险\n' }, [{ id: 'AC-001' }]), 'insufficient');
  // 关闸判据只看第一层 verdict（第二层不进 goalFlipDecision）。
  const records = [
    { id: 'GOAL-001', status: 'active' },
    { id: 'AC-001', goal: 'GOAL-001', status: 'achieved' },
  ];
  assert.equal(goalFlipDecision(records, 'GOAL-001', { verdict: 'covered' }), true);
  assert.equal(goalFlipDecision(records, 'GOAL-001', { verdict: 'not-evaluated' }), false);
});


test('DoD: runGoalRound 同时产出两层 fact（goal-sufficiency 与 goal-objective 并列，⛔ 互不含对方的键）', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-round-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, {
      id: 'GOAL-001', status: 'active', kind: 'goal',
      body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n',
    });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);

    const { sufficiencyFacts, objectiveFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      sufficiencyCmd: judgeCmd({ verdict: 'covered' }),
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'project_root', value: '/p/one' }),
    });

    assert.equal(sufficiencyFacts.length, 1, '一条 active GOAL ⇒ 一条 sufficiency fact');
    assert.equal(objectiveFacts.length, 1, '一条 active GOAL ⇒ 一条 objective fact');
    assert.equal(sufficiencyFacts[0].name, 'goal-sufficiency');
    assert.equal(objectiveFacts[0].name, 'goal-objective');

    // 第一层：原形不变（AC-212 判据读的正是 value.sufficiency）。
    const s = sufficiencyFacts[0].value.sufficiency;
    assert.equal(s.verdict, 'covered', '第一层结论不被新层改变（同输入 ⇒ 仍 covered）');

    // 第二层：独立取值 + 指认 + 证据概况。
    const o = objectiveFacts[0].value.objective;
    assert.equal(o.goal, 'GOAL-001');
    assert.equal(o.verdict, 'unsubstantiated');
    assert.equal(o.assertion.field, 'project_root');
    assert.equal(o.profile.records, 2);
    assert.deepEqual(o.profile.distinctProjectRoots, ['/p/one']);

    // ⛔ 不合并：两条 fact 各带自己的键，互不冒充对方。
    assert.equal(o.sufficiency, undefined, 'objective fact ⛔ 不含 sufficiency 键');
    assert.equal(s.objective, undefined, 'sufficiency fact ⛔ 不含 objective 键');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 派生判据：② 不得对【真值派生自 ③ 主体population】的常设判据独立立案 ──────────────────────────
// gap-ac242-derived-criterion-double-judged-and-amendment-unguarded 缺陷①。
//
// 同一条真相——「冻结population 中有一条 AC 此刻为假」——被**两个判官**判成两个主体、两个结论：
//   ③ 冻结population 分支：主体 = **那条为假的 AC**（AC-203），态 = frozen-violated / in-progress
//      ⇒ 正确路由（有 owner 就不重复立案）；
//   ② AC-216 常设不变式分支：主体 = **AC-242**（它自己的 criterion 读的正是 ③ 的输入面），
//      态 = standing-violated（没有任何在飞任务持 `goal_ac: AC-242`）⇒ 为 AC-242 立案。
// 而 AC-242 的复绿条件**不在它自己的域内**：它的 expect 逐字要求「冻结population 中不存在此刻为假的
// AC」，当前为假的那条是 AC-203 ⇒ 任何 AC-242 域内的改动都不能使它转绿；唯一出口是把 AC-203 变真，
// 而那是 AC-203 的域、且已有 owner 在飞。⇒ ② 为它立的每一条任务，其 DoD 都结构上只能由【另一条 AC
// 的 owner】关闭 —— 每轮一条、永远关不掉。
//
// 修法：② 对**真值派生自 ③ 主体population** 的判据（criterion 读 ③ 的输入面 `check --stale-pass`）
// 让位给 ③ —— ③ 是那个命题的唯一判据、且已在本轮为那条为假的 AC 产出了路由。判据 AC-242 本身**不动**
// （它保持诚实）；让位只发生在 ③ 本轮**确实判了 violated**（派生条件成立）时，读不到 / 未评估 ⇒ 照旧
// 立案（⛔ 闸不恒开，见下面的负控制 c）。

/** 一份最小的 ②/③ 夹具：GOAL-900 已关闭（achieved ⇒ 非 active）。三条 achieved AC：
 *  AC-203 未声明 long-term ⇒ **冻结population**（③ 的主体）；AC-242 声明 long-term 且 criterion 读
 *  `check --stale-pass` ⇒ ② 的**派生判据**；AC-214 声明 long-term 而 criterion 与 ③ 无关 ⇒ ② 的
 *  **普通常设判据**（用来证明让位不是「所有常设判据都不再立案」）。 */



test('派生判据 (a)：无 owner ⇒ ③ 产 frozen-violated，② ⛔ 不产 goal_ac: AC-242 立案', () => {
  const records = derivedCriterionRecords();
  // I5 的读数：AC-242 的判据此刻为假（冻结population 里有一条为假），AC-214 不受影响。
  const standings = { achievedButFailing: ['AC-242'], evaluated: true };
  // ③ 的读数：那条冻结 AC 此刻为假。
  const frozen = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  assert.equal(frozen.judgment, 'violated');
  const gaps = computeGoalGaps(records, [], null, standings, frozen);
  const by = derivedByAc(gaps);

  assert.equal(by.get('AC-203').state, 'frozen-violated', '③ 的主体仍被立案（让位⛔ 不波及 ③ 自己）');
  assert.ok(isFilingGapState(by.get('AC-203').state), 'frozen-violated 在 spawn 选取面内');
  assert.equal(by.get('AC-242').state, 'derived-routed', '② 让位：红归 ③ 的主体 AC，不归这条元判据');
  assert.equal(isFilingGapState(by.get('AC-242').state), false, '⛔ derived-routed 不消耗 spawn 名额');
  assert.notEqual(by.get('AC-242').state, 'standing-ok', '⛔ 不是 standing-ok：它此刻确实为假（说它成立即假绿）');
  assert.notEqual(by.get('AC-242').state, 'not-evaluated', '⛔ 不是 not-evaluated：读数在、违反也在，只是成因已由另一个判官接管');
  assert.equal(by.get('AC-242').taskCount, null, '⛔ 与 0 不同形：本态回答的不是「有几条任务是它的」');
  assert.equal(by.get('AC-214').state, 'standing-ok', '对照组：非派生的常设判据此刻成立 ⇒ 仍走原判定');

  // 端到端：spawn 选取面只挑 AC-203 一条。
  const r = runGapSpawnPass(gaps, records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-203'], '只有 ③ 的主体 AC 消耗名额（AC-242 不再每轮一条）');
});


test('派生判据 (b)：有 owner（现状）⇒ ③ 产 in-progress，② 同样⛔ 不产立案', () => {
  const records = derivedCriterionRecords();
  const standings = { achievedButFailing: ['AC-242'], evaluated: true };
  const frozen = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  // 一条在飞任务持 goal_ac: AC-203（这正是生产上 gap-ac203-two-distinct-kinds-no-production-run 的形态）。
  const tasks = [{ id: 'gap-ac203-owner', status: 'ready', goalAc: 'AC-203' }];
  const gaps = computeGoalGaps(records, tasks, null, standings, frozen);
  const by = derivedByAc(gaps);

  assert.equal(by.get('AC-203').state, 'in-progress', '③ 认得 owner ⇒ 不再重复立案');
  assert.equal(by.get('AC-242').state, 'derived-routed', '② 仍让位（有主更要让位）');
  assert.equal(isFilingGapState(by.get('AC-242').state), false);
  const r = runGapSpawnPass(gaps, records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r.outcomes, [], '两条都不该消耗名额');
});


test('派生判据 (c) 负控制：闸不恒开 —— ③ 说不了话时仍立案；非派生的违反也仍立案', () => {
  const records = derivedCriterionRecords();

  // (c1) ③ 未评估（台账读不到 / 轮转从未跑过）⇒ 派生条件不成立 ⇒ 回落 standing-violated（成因不明
  //      时仍要有人看，硬规则 6：缺值 = 未查 ≠ 为假）。
  const standings0 = { achievedButFailing: ['AC-242'], evaluated: true };
  const notEval = parseFrozenFailingReading('not json at all', null);
  assert.equal(notEval.judgment, 'not-evaluated');
  const g1 = derivedByAc(computeGoalGaps(records, [], null, standings0, notEval));
  assert.equal(g1.get('AC-242').state, 'standing-violated', '③ 说不了话 ⇒ ⛔ 不静默放行，照旧立案');
  assert.ok(isFilingGapState(g1.get('AC-242').state));
  // 对照：③ 读到了但【判 clean】（无违反）⇒ 同样不满足派生条件（派生量按定义为假，二者矛盾）⇒ 仍立案。
  const clean = parseFrozenFailingReading(JSON.stringify({ failing: [], frozenScope: 1 }), 0);
  const g2 = derivedByAc(computeGoalGaps(records, [], null, standings0, clean));
  assert.equal(g2.get('AC-242').state, 'standing-violated', '③ 判 clean ⇒ 派生条件不成立 ⇒ 仍立案（⛔ 不静默吞掉一条红）');

  // (c2) 非派生的常设判据此刻违反 ⇒ ② **仍**立案（证明让位是逐条的，不是「常设判据一律不立」）。
  const standings214 = { achievedButFailing: ['AC-214'], evaluated: true };
  const g3 = derivedByAc(computeGoalGaps(records, [], null, standings214, clean));
  assert.equal(g3.get('AC-214').state, 'standing-violated', '普通常设判据的违反照旧立案');
  assert.ok(isFilingGapState(g3.get('AC-214').state));
  const r3 = runGapSpawnPass(computeGoalGaps(records, [], null, standings214, clean), records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r3.outcomes.map((o) => o.ac), ['AC-214'], '让位没有把整个 ② 分支关掉（闸不恒开）');

  // (c3) ③ 的违反对象无主 ⇒ 立案**仍然发生**（只是发生在 ③ 的主体 AC 上）。
  const violated = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  const g4 = computeGoalGaps(records, [], null, standings0, violated);
  assert.ok(g4.some((g) => isFilingGapState(g.state)), '让位后仍有一条可立案的读数（③ 的主体 AC）');
});

// ── AC5：goal 动词 argv 的形态（gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache）──
//
// 缺陷原样：goalStoreArgv 曾把 `<codeRoot>/packages/quay/src/goal-store.ts` 当【子进程入口】返回。
// 那个文件在出厂布局（plugin marketplace cache / npm-pack / 第三方 vendored 副本）里【不存在】：
// goal-store 的【库】已被 coreSrcAliasPlugin 内联进 scripts/dist/goal-driver.js，而它的 CLI 入口不可达
// （`isMain` 判 `process.argv[1].endsWith("goal-store.ts")`，bundle 里恒 false）。⇒ 每轮 spawn 一个
// 不存在的文件，读数全线落 unreadable，而进程 alive=1、载体仍在写（静默失效）。

test('AC5: goal 动词 argv 不含 packages/quay/src（源码树入口已消失），且非空转', () => {
  const dataRoot = '/tmp/ac262-data-root';
  const argv = goalStoreArgv(repoRoot, ['gate', 'AC-001'], dataRoot);
  const line = argv.join(' ');

  // ① 判据本体。⛔ 负控制：把 argv 构造改回旧形（spawn packages/quay/src/goal-store.ts）⇒ 本行必红。
  assert.doesNotMatch(line, /packages\/quay\/src/, `argv 仍指向源码树：${line}`);
  // ② 空转防线（硬规则 3b）：一个空 argv、或一个缺动词的 argv，同样「不含 packages/quay/src」——
  //    不钉住形态，本条就与「什么也没验」同形。故逐项断言它是一条真命令。
  assert.ok(argv.length >= 5, `argv 太短，没构造出真命令：${line}`);
  assert.ok(argv.includes('goal'), `argv 缺 goal 动词：${line}`);
  assert.ok(argv.includes('gate') && argv.includes('AC-001'), `argv 缺子命令/位置参数：${line}`);
  assert.ok(argv.includes('--store'), `argv 缺 --store（driver 跑的是无 config 的裸 root，见 cli/goal.ts）：${line}`);
  assert.ok(argv.includes('--root') && argv.includes(dataRoot), `argv 缺 --root <dataRoot>：${line}`);
  // ③ 入口必须真的【存在】：一个不存在的路径在负控制里也「不含 packages/quay/src」，却跑不动。
  //    ⚠️ 入口段按【前缀】定位（它解析不出时叫 `quay-cli-unresolved`、没有扩展名 —— 用 `.ts/.js`
  //    后缀找会在负控制上恒找不着，把判据写成恒假）。
  const entry = argv.find((a) => a.startsWith(repoRoot));
  assert.ok(entry && fs.existsSync(entry), `argv 的 quay CLI 入口不存在：${entry}`);
});


test('AC5 负控制（契约另一半）: 解析不出的代码根 ⇒ 一个【不存在】的路径，⛔ 不抛、不回退 PATH 上的 quay', () => {
  const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'ac262-no-quay-cli-'));
  try {
    // 前置：夹具根【存在】但是没有 quay CLI —— 这样 ENOENT 归因于「解析不出」，而不是「根本身不存在」。
    assert.equal(fs.existsSync(bogus), true, '前置：夹具根必须存在');
    assert.equal(fs.existsSync(path.join(bogus, 'packages', 'quay', 'bin', 'quay.ts')), false, '前置：夹具里没有源码 CLI');
    const argv = goalStoreArgv(bogus, ['check', '--staleness'], '/tmp/ac262-data-root');
    // 入口段 = 以该代码根开头的那个 argv 元素（解析不出时它是 `<bogus>/quay-cli-unresolved`）。
    const entry = argv.find((a) => a.startsWith(bogus));
    assert.ok(entry, `argv 缺入口段：${argv.join(' ')}`);
    assert.equal(fs.existsSync(entry), false, `解析不出时必须给出不存在的路径（调用方按 unreadable 处理）：${entry}`);
    assert.doesNotMatch(argv.join(' '), /packages\/quay\/src/, '⛔ 解析不出也不得回落到源码树形');
    // 端到端半边：真跑一次 —— 它必须是「解析不出 ⇒ 读不懂」，而⛔ 不是「跑通了、零条」。
    assert.equal(goalCliResolvable(bogus), false, '解析判据本身必须能取假');
  } finally {
    fs.rmSync(bogus, { recursive: true, force: true });
  }
});


test('派生判据的识别式：按【位置】（判据里成词出现）判定，⛔ 不按子串/散文提及', () => {
  assert.equal(readsFrozenPopulation('node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass'), true);
  assert.equal(readsFrozenPopulation('quay goal check --stale-pass --sweep'), true);
  assert.equal(readsFrozenPopulation('exit 0'), false);
  assert.equal(readsFrozenPopulation(''), false);
  assert.equal(readsFrozenPopulation(null), false);
  // ⛔ 子串不算（成词判定）：`--stale-pass-notes` 不是那个旗标。
  assert.equal(readsFrozenPopulation('echo --stale-pass-notes'), false);
  // 双向控制：与 ③ 无关的常设判据（AC-214 形态：读交付面载体）不得被误判。
  assert.equal(readsFrozenPopulation('python3 - <<\'P\'\nimport json\nP'), false);
});

// ── ⑨ 每轮 CI run 载体采集的生产调用点（tasks/gap-develop-ci-first-decisive-green）──────────────
//
// 这一节钉的是「采集器有生产消费者」这件事实本身：判据 AC-265 读的是本地载体 `.quay/ci-runs.jsonl`，
// 没有调用点时它只能报 carrier-absent / collection-stalled —— 而那与「CI 真红」在读法上同形（硬规则 3b）。
// ⛔ 同时钉住「没采集」与「采集了零条」不同形：round 记录里的 `ciRuns` **恒存在**，缺省是显式的
// `disabled`，⛔ 不是一个被省略的键。


test('⑨ ciRuns — 开关未置位时轮记录里仍是显式的 disabled（⛔ 不是缺键、不是 ok(0)）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-off-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: false,
    });
    const v = fact.value;
    assert.ok(v.ciRuns && typeof v.ciRuns === 'object', 'value.ciRuns 必须存在（缺键即判假）');
    assert.equal(v.ciRuns.status, 'disabled');
    assert.equal(v.ciRuns.ran, false);
    assert.match(v.ciRuns.reason, /ci_runs_collect/);
    assert.match(fact.reason, /ciRuns=disabled/, '轮记录 reason 带调用痕（人可读的那一半）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 置位时注入的采集函数被真调用，读数落进轮记录（这就是「由该路径写入」的证据形态）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-on-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const seen = [];
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: true,
      ciRunsCollectFn: (root, o) => {
        seen.push({ root, throttleMs: o.throttleMs });
        return {
          status: 'ok',
          ran: true,
          reason: '采集 3 条，追加 2 条，补全 1 条',
          carrier: path.join(root, '.quay', 'ci-runs.jsonl'),
          appended: 2,
          skipped: 1,
          attributed: 2,
          enriched: 1,
          logsFetched: 3,
          testFilesDerived: 2,
          warnings: [],
        };
      },
    });
    assert.equal(seen.length, 1, '每轮恰好调一次');
    assert.equal(seen[0].root, tmp, '调用点是本 driver 的 root（载体就落在它的 .quay/ 下）');
    const v = fact.value;
    assert.equal(v.ciRuns.status, 'ok');
    assert.equal(v.ciRuns.appended, 2);
    assert.equal(v.ciRuns.enriched, 1, '补全数也是读数的一部分（它是「回填补上了」的直接量）');
    assert.match(fact.reason, /ciRuns=ok\(appended=2,enriched=1,attributed=2,logs=3\)/, '调用痕逐字进 reason');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 采集抛错不掀翻整轮（旁路读数），且折算成可区分的 error 读数', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-err-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      ciRunsCollect: true,
      ciRunsCollectFn: () => {
        throw new Error('boom-gh');
      },
    });
    assert.equal(fact.state, 'verified', '采集坏掉不得把整轮判失败');
    assert.equal(fact.value.ciRuns.status, 'error');
    assert.match(fact.value.ciRuns.reason, /boom-gh/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('⑨ ciRuns — 开关与节流从 drivers.yml 就地读（代码缺省 false / 采集器常量缺省）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ciruns-cfg-'));
  try {
    assert.equal(goalCiRunsCollect(tmp), false, 'drivers.yml 不在 ⇒ 代码缺省 false（⛔ 不默认打开网络采集）');
    assert.equal(goalCiRunsCollect(tmp, true), true, '显式 true 压过缺省（测试缝/CLI）');
    fs.mkdirSync(path.join(tmp, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plugin', 'scripts', 'drivers.yml'),
      'version: 1\nkinds:\n  goal:\n    ci_runs_collect: true\n    ci_runs_collect_throttle_ms: 1234\n',
      'utf8',
    );
    assert.equal(goalCiRunsCollect(tmp), true, '配置真源置位 ⇒ 开');
    assert.equal(goalCiRunsThrottleMs(tmp), 1234, '节流从配置读');
    assert.equal(goalCiRunsThrottleMs(tmp, 0), 0, '0 是合法值（= 不节流），⛔ 不被当成「未指定」');
    // 缺字段 ⇒ 回落到采集器自己的常量（⛔ 不在这里再写一个字面量）
    fs.writeFileSync(path.join(tmp, 'plugin', 'scripts', 'drivers.yml'), 'version: 1\nkinds:\n  goal:\n    cap: 5\n', 'utf8');
    assert.equal(goalCiRunsThrottleMs(tmp), 600000, '回落 DEFAULT_COLLECT_THROTTLE_MS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
