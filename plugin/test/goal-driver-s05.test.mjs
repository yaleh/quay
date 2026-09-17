// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/6 (16 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { DELIVERED_VERSION, GOAL_ROUND_REL, HEALTH_OBSERVED_CARRIERS, HEALTH_REQUIRED_CARRIERS, HEALTH_WINDOW_SEC_DEFAULT, OBJECTIVE_ACS, OBJECTIVE_ASSERTION_FIELDS, OBJECTIVE_EVIDENCE_CARRIERS, OBJECTIVE_GOAL, TARGET_HEALTH_FACT_NAME, assert, buildHealthProbeArgv, cannedProbePrefix, collectObjectiveEvidence, declaredTargetBinding, deriveTargetHealth, evRecord, fs, goalDriverRoutines, goalFlipDecision, goalSufficiencyVerdict, judgeCmd, mkTargetRoot, objectiveAssertionCommand, objectiveCacheKey, objectiveEvidenceProfile, objectiveSufficiencyVerdictDetail, os, parseHealthProbe, path, repoRoot, resetObjectiveTestState, resolveTargetBinding, runResidentQualityGateLoop, semanticSufficiencyVerdict, spawn, spawnSync, spawnTargetDriverFixture, targetHealthFact, verifyObjectiveAssertion, waitForProcessVisible, writeEvidenceCarrier, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

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
