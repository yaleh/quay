// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs
// FURTHER SPLIT (gap-suite-split-15-over-30s-test-files, AC3): the two 'real ring' end-to-end tests
// ('载体有 verdict…) and ('draft AC under active GOAL…') moved to goal-driver-s11.test.mjs together with
// their section comments. This file has no module-level state and no hooks.

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/6 (16 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER_KINDS, GOAL_ACCEPTANCE_ACTIVE_ENV, GOAL_ROUND_REL, KINDS, KNOWN_KINDS, assert, checkAchievedFailing, checkStaleness, fs, goalAchievedFromRecords, goalDriverRoutines, goalStoreAbs, os, path, readReadyPoolJudgment, repoRoot, runGapSpawnPass, runGoalRound, runResidentQualityGateLoop, spawn, spawnSync, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

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

test('runGapSpawnPass: halt ⇒ 0；资源门 WAIT ⇒ 0；cap 读配置；llm_invoked 派生自真实 argv', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-spawn-'));
  try {
    const records = [
      { id: 'GOAL-001', title: 'g', status: 'active' },
      { id: 'AC-001', goal: 'GOAL-001', title: 'a1', expect: 'e1', status: 'active' },
      { id: 'AC-002', goal: 'GOAL-001', title: 'a2', expect: 'e2', status: 'active' },
      { id: 'AC-003', goal: 'GOAL-001', title: 'a3', expect: 'e3', status: 'active' },
    ];
    const gaps = [
      { goal: 'GOAL-001', ac: 'AC-001', state: 'gap', taskCount: 0 },
      { goal: 'GOAL-001', ac: 'AC-002', state: 'gap', taskCount: 0 },
      { goal: 'GOAL-001', ac: 'AC-003', state: 'gap', taskCount: 0 },
    ];
    // halt ⇒ 0（AC3）
    let r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', halted: true });
    assert.equal(r.spawned, 0, 'halted ⇒ 不 spawn');
    assert.equal(r.llmInvoked, false);
    // 资源门 WAIT ⇒ 0（AC4）
    r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['bash', '-c', 'exit 1'] });
    assert.equal(r.spawned, 0, '资源门 WAIT ⇒ 不 spawn');
    // cap=1 ⇒ spawned 1（AC5：3 条缺口只 spawn 1 条，读配置不写死）
    r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 1 });
    assert.equal(r.spawned, 1);
    assert.equal(r.outcomes.length, 1);
    assert.equal(r.outcomes[0].ac, 'AC-001');
    assert.equal(r.llmInvoked, false, 'gapWorkerCmd=true（非 LLM）⇒ llm_invoked=false（派生自真实 argv）');
    // LLM 命令 ⇒ llm_invoked true（AC6：派生自 argv，⛔ 不硬编码）。用 fake `claude` 可执行文件
    // （basename=claude 命中 LLM 集合）避免真起 claude CLI。
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-bin-'));
    const fakeClaude = path.join(binDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: fakeClaude, resourceGateArgv: ['true'], spawnCap: 1, llmCommands: ['claude', 'claude-fjdac'] });
    assert.equal(r.spawned, 1);
    assert.equal(r.llmInvoked, true, 'argv[0] basename=claude（LLM）⇒ llm_invoked=true');
    fs.rmSync(binDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('runGapSpawnPass: 超时 spawn 的 outcome 含 stdout 尾部（诊断面，⛔ 恒 null 即假）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-timeout-'));
  try {
    const records = [
      { id: 'GOAL-001', title: 'g', status: 'active' },
      { id: 'AC-001', goal: 'GOAL-001', title: 'a1', expect: 'e1', status: 'active' },
    ];
    const gaps = [{ goal: 'GOAL-001', ac: 'AC-001', state: 'gap', taskCount: 0 }];
    // 假 worker：先打唯一 marker 到 stdout，再睡 5s ⇒ 在 200ms 预算下必然超时（ETIMEDOUT），
    // 且 spawnSync 超时仍返回已缓冲的 stdout（实测：dt≈200ms、timedOut=true、stdout=marker）。
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-tbin-'));
    const fake = path.join(binDir, 'fake-gap-worker');
    fs.writeFileSync(fake, '#!/bin/sh\necho "FAKE-GAP-WORKER-STDOUT-MARKER"\nsleep 5\n', { mode: 0o755 });
    const r = runGapSpawnPass(gaps, records, tmp, {
      gapWorkerCmd: fake,
      resourceGateArgv: ['true'],
      spawnCap: 1,
      gapWorkerTimeoutMs: 200,  // 200ms << 5s ⇒ 必然超时（显式参数注入小预算作测试缝）
    });
    assert.equal(r.spawned, 1);
    assert.equal(r.outcomes.length, 1);
    const o = r.outcomes[0];
    assert.equal(o.timedOut, true, '假 worker 睡 5s 而预算 200ms ⇒ timedOut=true');
    assert.ok(o.stdout != null, '超时 outcome 必须带 stdout（⛔ 恒 null 即假，硬规则 3b）');
    assert.ok(o.stdout.includes('FAKE-GAP-WORKER-STDOUT-MARKER'), 'stdout 含假 worker 的输出（可归因到哪一步）');
    fs.rmSync(binDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('readReadyPoolJudgment: 解析 candidates eligible + excluded → 两集合；读不懂 ⇒ null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-judge-'));
  try {
    const json = '{"candidates":[{"id":"a","eligible":true},{"id":"b","eligible":false}],"excluded":[{"id":"c","reasons":["x"]}]}';
    const cmd = ['node', '-e', `process.stdout.write(${JSON.stringify(json)})`];
    const j = await readReadyPoolJudgment(tmp, cmd);
    assert.ok(j, '可解析 ⇒ 非 null');
    assert.deepEqual([...j.eligibleTodoIds], ['a']);
    assert.deepEqual([...j.excludedReadyIds], ['c']);
    const bad = await readReadyPoolJudgment(tmp, ['bash', '-c', 'exit 1']);
    assert.equal(bad, null, '非零退出 ⇒ null（⛔ 与零 stuck 不同形）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('real ring (G9): round value 带 spawned + llm_invoked 两键（缺键即判假，硬规则 3b）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-g9-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001 active + AC-001 active（criterion false ⇒ 不 flip ⇒ 保持 active ⇒ gap）
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    assert.ok(fact && fact.value && typeof fact.value === 'object', 'runGoalRound 返回 fact.value');
    const v = fact.value;
    assert.equal(typeof v.spawned, 'number', 'value.spawned 必须是 number（缺键即判假）');
    assert.equal(typeof v.llm_invoked, 'boolean', 'value.llm_invoked 必须是 boolean（缺键即判假）');
    assert.equal(v.spawned, 1, '一条 gap AC ⇒ spawn 1 个 agent');
    assert.equal(v.llm_invoked, false, 'gapWorkerCmd=true（非 LLM）⇒ llm_invoked=false');
    assert.ok(Array.isArray(v.gap_spawns), 'value.gap_spawns 是数组');
    assert.equal(v.gaps.find((g) => g.ac === 'AC-001').state, 'gap', 'spawn 前 gaps 仍记 gap（下一轮才 in-progress）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── I5 achieved-but-failing（gap-goal-achieved-but-failing-no-handler）────────────────────────
// goal-store 的 I5 在【独立子命令】`check --achieved-failing`（跑判据），`check --staleness` 保持纯读
// （甲：结构隔离——AC-175 的 criterion 自己调 `check --staleness`，若 staleness 也跑判据会无界递归，
//  2026-09-07 生产事故 host load 41.89）。跑判据路径带环境变量闸（乙：GOAL_ACCEPTANCE_ACTIVE_ENV），
//  嵌套调用读到即拒跑判据并返回 evaluated:false（⛔ 不是空数组冒充「没有」，硬规则 3b）。



test('checkAchievedFailing wrapper: achieved 且 criterion fail ⇒ achievedButFailing 桶（与 divergent 分离；checkStaleness 纯读）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-stale-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const af = await checkAchievedFailing(repoRoot, tmp);
    assert.ok(af, 'checkAchievedFailing 应返回读数（非 null）');
    assert.deepEqual(af.achievedButFailing, ['AC-001'], 'achieved 且 criterion `false` ⇒ 进桶');
    assert.equal(af.evaluated, true, '非拒跑 ⇒ evaluated: true');
    // checkStaleness 必须纯读：不再携带 achievedButFailing（I5 已移出到独立子命令）。
    const st = await checkStaleness(repoRoot, tmp);
    assert.ok(st, 'checkStaleness 应返回读数');
    assert.equal('achievedButFailing' in st, false, 'checkStaleness 纯读，不带 achievedButFailing 键');
    assert.deepEqual(st.divergent, [], '还有 active AC ⇒ 非 divergent（两桶语义相反、互相独立）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC5 — achievedButFailing 双向取假：criterion fail→pass 移出桶', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-bidir-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    let af = await checkAchievedFailing(repoRoot, tmp);
    assert.deepEqual(af.achievedButFailing, ['AC-001'], 'criterion `false` ⇒ 进桶');
    // 翻成 pass ⇒ 出桶（两个方向都断言）。
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    af = await checkAchievedFailing(repoRoot, tmp);
    assert.deepEqual(af.achievedButFailing, [], 'criterion `true` ⇒ 出桶');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC1 — 递归结构上不可能：criterion 调 check --staleness ⇒ 跑判据深度 = 1（进程级观测，非 guard 断言）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ac1-'));
  const marker = path.join(tmp, 'marker.txt');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    // AC-175 的真实形状：criterion 自己调 `check --staleness`。甲（结构隔离）⇒ staleness 纯读，
    // 不产生第二层跑判据 ⇒ criterion 只被执行 1 次（marker 恰 1 行，即最大嵌套深度 1）。
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001',
      criterion: `echo x >> ${marker} && node ${goalStoreAbs} check --staleness --root ${tmp}` });
    const af = await checkAchievedFailing(repoRoot, tmp);
    assert.ok(af, 'checkAchievedFailing 应返回读数');
    const depth = fs.existsSync(marker)
      ? fs.readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length
      : 0;
    assert.equal(depth, 1, `跑判据最大嵌套深度必须 = 1，实测 marker 行数 ${depth}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC2 — 去掉闸 ⇒ 深度 ≥3：criterion 调 check --achieved-failing（env -u 清闸）递归；带闸 ⇒ 深度 1', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ac2-'));
  const marker = path.join(tmp, 'marker.txt');
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    // 正控制（带闸）：嵌套 check --achieved-failing 读到环境变量闸 ⇒ 拒跑判据 ⇒ 深度 1。
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001',
      criterion: `echo x >> ${marker} && if [ "$(wc -l < ${marker})" -lt 5 ]; then node ${goalStoreAbs} check --achieved-failing --root ${tmp}; fi` });
    await checkAchievedFailing(repoRoot, tmp);
    const depthOn = fs.readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length;
    assert.equal(depthOn, 1, `带闸 ⇒ 深度必须 = 1，实测 ${depthOn}`);

    // 负控制（去闸）：清掉环境变量闸 ⇒ 同一观测立即出现深度 ≥3 的嵌套（证明测的是真行为）。
    fs.rmSync(marker, { force: true });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001',
      criterion: `echo x >> ${marker} && if [ "$(wc -l < ${marker})" -lt 5 ]; then env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node ${goalStoreAbs} check --achieved-failing --root ${tmp}; fi` });
    await checkAchievedFailing(repoRoot, tmp);
    const depthOff = fs.readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).length;
    assert.ok(depthOff >= 3, `去闸 ⇒ 深度必须 ≥3，实测 ${depthOff}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC6 — check --achieved-failing 对 achieved+failing AC exit 1（⛔ 不再空分歧 + exit 0 假绿）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-ac6-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    const r = spawnSync('node', ['--experimental-strip-types', goalStoreAbs, 'check', '--achieved-failing', '--root', tmp], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'achieved-but-failing AC ⇒ exit 1（旧代码 exit 0 假绿）:\n' + r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.achievedButFailing, ['AC-001'], 'achieved+failing AC 被枚举进桶（⛔ 不是布尔/计数）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('AC8 — goal-driver.ts 注释与实现逐字相符（点名 check --achieved-failing，不再点名 I4/divergent 覆盖该形态）', () => {
  const src = fs.readFileSync(new URL('../scripts/goal-driver.ts', import.meta.url), 'utf8');
  // 旧注释（假覆盖）必须消失：它点名 I4/divergent 覆盖一个 I4 结构上不可能触发的形态。
  assert.doesNotMatch(src, /achieved-but-failing 的分歧由 I4/, '旧注释点名 I4 覆盖 achieved-but-failing 的措辞已删除');
  // 不再声称 check --staleness 报出 achievedButFailing（staleness 现在纯读）。
  assert.doesNotMatch(src, /check --staleness 的\s*\n?\s*achievedButFailing/, '不再声称 check --staleness 报出 achievedButFailing');
  // 新注释必须点名真正的检测者：check --achieved-failing 的 achievedButFailing 桶。
  assert.match(src, /check --achieved-failing` 的 achievedButFailing 桶报出/, '新注释点名 check --achieved-failing 的 achievedButFailing 桶');
});

// ── AC6：cli/driver.ts KINDS 与 kernel DRIVER_KINDS 集合一致 ─────────────────────────────


test('AC6: cli/driver.ts KINDS 与 kernel DRIVER_KINDS 集合相等（suite 已退役移除 + goal 在列）', () => {
  assert.ok(!KINDS.includes('suite'), 'suite 已按人 2026-09-07 裁定从 cli 白名单退役移除');
  assert.ok(KINDS.includes('goal'), 'goal 已进 cli 白名单');
  assert.deepEqual(new Set(KINDS), new Set(KNOWN_KINDS), 'cli KINDS 与 kernel DRIVER_KINDS 集合必须一致');
  // goal kind 在 registry 里是例程型（同 quality/outer/meta）：无 cap、有 interval、自写 pid。
  assert.equal(DRIVER_KINDS.goal.driver, 'goal-driver.ts');
  assert.equal(DRIVER_KINDS.goal.capFlag, '', 'goal 无任务池 ⇒ 无 cap');
  assert.equal(DRIVER_KINDS.goal.hasInterval, true);
  assert.equal(DRIVER_KINDS.goal.pidSelf, true);
  assert.deepEqual(DRIVER_KINDS.goal.carriers, ['goal-round.jsonl']);
  assert.equal(DRIVER_KINDS.goal.controlFile, 'goal-control.json');
});

// ── CLI 冒烟 ─────────────────────────────────────────────────────────────────


test('CLI: --help 退出 0 并列出 --once/--interval/--json', async () => {
  const { main } = await import('../scripts/goal-driver.ts');
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try {
    code = await main(['node', 'goal-driver.ts', '--help']);
  } finally {
    process.stdout.write = orig;
  }
  const out = chunks.join('');
  assert.equal(code, 0);
  for (const flag of ['--once', '--json', '--interval']) {
    assert.ok(out.includes(flag), `--help 必须列出 ${flag}`);
  }
});


test('CLI: 未知参数 ⇒ exit 2（⛔ 不静默忽略）', async () => {
  const { main } = await import('../scripts/goal-driver.ts');
  const origOut = process.stdout.write, origErr = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  let code;
  try {
    code = await main(['node', 'goal-driver.ts', '--nope']);
  } finally {
    process.stdout.write = origOut; process.stderr.write = origErr;
  }
  assert.equal(code, 2);
});

// ── gap-goal-store-empty-scope-reads-as-all-verified: 轮记录透传 scopeSize + evaluated ─────────────
// goal-driver 的 checkStaleness / checkAchievedFailing 读数透传 goal-store 的 scopeSize + evaluated，
// 使 .quay/goal-round.jsonl 的轮记录可机械区分「空作用域」与「查过且全过」（AC3）。0 active goal ⇒
// evaluated:false、scopeSize:0（⛔ 与「全过且 evaluated:true、scopeSize>0」同形，硬规则 3b）。


test('AC3 — checkStaleness/checkAchievedFailing 透传 scopeSize + evaluated（空作用域可机械读出）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-emptyscope-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // 0 active goal（只有 achieved goal + achieved AC）——生产空作用域形态。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'achieved', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
    const st = await checkStaleness(repoRoot, tmp);
    assert.ok(st, 'checkStaleness 应返回读数（非 null）');
    assert.equal(st.scopeSize, 0, '0 active goal ⇒ scopeSize 0');
    assert.equal(st.evaluated, false, '0 active goal ⇒ evaluated false');
    const af = await checkAchievedFailing(repoRoot, tmp);
    assert.ok(af, 'checkAchievedFailing 应返回读数（非 null）');
    assert.equal(af.scopeSize, 0, '0 active goal ⇒ scopeSize 0');
    assert.equal(af.evaluated, false, '0 active goal ⇒ evaluated false');
    assert.deepEqual(af.achievedButFailing, [], '非 active goal 下的 achieved AC 不进桶');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
