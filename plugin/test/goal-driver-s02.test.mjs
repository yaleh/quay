// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/4 (24 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER_KINDS, GOAL_ROUND_REL, KINDS, KNOWN_KINDS, assert, buildGapWorkerPrompt, checkAchievedFailing, checkStaleness, computeGoalGaps, fs, goalAchievedFromRecords, goalCloseBlockFromRecords, goalDriverRoutines, goalStoreAbs, isFilingGapState, os, parseFrozenFailingReading, path, probeLedger, readFrozenFailing, repoRoot, runGapSpawnPass, runGoalRound, runResidentQualityGateLoop, spawn, spawnSync, sweepFrozenAcs, writeGoalFile, writeStandingGoalFile } from "./helpers/goal-driver-harness.mjs";

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

// ── 真实机械环端到端（⛔ 不用 fixture 注入 seam，跑真的 goal-store CLI）────────────────────


test('real ring: 载体有 verdict + evidence 不回写 + I2 flip + draft 不动 + 无 tasks 写', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // GOAL-001（active）两条 AC 全 pass ⇒ AC 与 GOAL 都该 flip achieved（I2）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    // GOAL-003（draft）——负控制：driver 不得自动激活它、也不得跑它的 AC。
    writeGoalFile(tmp, { id: 'GOAL-003', status: 'draft', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-003', status: 'active', kind: 'criterion', goal: 'GOAL-003', criterion: 'true' });

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp,
      intervalMs: 1,
      once: true,
      maxRounds: null,
      roundLogFile: roundLog,
      runId: 't',
      json: false,
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot }),
    });
    assert.equal(code, 0, 'resident loop 一轮应正常退出');

    // AC1 机制：载体（.quay/goal-round.jsonl）含 criterion verdict。
    const carrier = fs.readFileSync(roundLog, 'utf8');
    assert.ok(carrier.includes('"verdict"'), 'round record must carry criterion verdicts');

    // AC3 机制 + I2：AC pass→achieved + GOAL 全达成→achieved；evidence 不回写进文件
    // （gap-goal-evidence-cache-should-not-enter-git——evidence 是 .quay/gate-events.jsonl 派生的）。
    const g1 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8');
    const a1 = fs.readFileSync(path.join(tmp, 'goals', 'AC-001-t.md'), 'utf8');
    // AC-212 充分性闸：GOAL 达成判定 = 在域 AC 合取 + 充分性 covered。GOAL-001 body 无 `## 退出条件`
    // ⇒ 充分性 insufficient ⇒ 即便两条 AC 全绿也不 flip GOAL（covered 的语义判定归 AC-213 的 LLM）。
    assert.match(g1, /^status: active$/m, 'AC-212 充分性闸：body 无退出条件 ⇒ insufficient ⇒ 不 flip GOAL');
    assert.match(a1, /^status: achieved$/m, 'AC-001 pass ⇒ flip achieved（裁定 5 确定性推导）');
    assert.doesNotMatch(a1, /evidence:/, 'AC-001 evidence 不回写进文件（gate 只写 GateEvent 到账本）');

    // AC4 负控制：draft 不动、其 AC 也不被跑/翻。
    const g3 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-003-t.md'), 'utf8');
    const a3 = fs.readFileSync(path.join(tmp, 'goals', 'AC-003-t.md'), 'utf8');
    assert.match(g3, /^status: draft$/m, 'draft GOAL 不被自动激活（裁定 3）');
    assert.match(a3, /^status: active$/m, 'draft GOAL 的 AC 不被跑/不被翻');

    // AC5 负控制：driver 一轮不产生 tasks/*.md 写入。
    assert.equal(fs.existsSync(path.join(tmp, 'tasks')), false, 'driver 一轮内不产生 tasks/ 写入');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── I2 边界 + AC-219（gap-meta-goal-triage-fresh-draft-not-retire）：active GOAL 下的 draft AC
//    不被 I2 翻成 achieved（裁定 3，I2 只翻 active）、不被翻 retired（放弃归人）；无牵引 ⇒ 分诊判
//    activate ⇒ 翻 active（gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics：
//    激活判据 =「判据就绪」而非「有牵引」）。──────────────────


test('real ring: draft AC under active GOAL 无牵引 ⇒ 分诊 activate ⇒ 翻 active（⛔ 不翻 achieved/retired）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-draftac-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // GOAL-001（active）两条 AC：AC-001 active（pass ⇒ flip achieved）、AC-002 draft（无牵引 ⇒ 分诊 activate ⇒ 翻 active）。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'draft', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });

    const roundLog = path.join(tmp, GOAL_ROUND_REL);
    const code = await runResidentQualityGateLoop({
      root: tmp,
      intervalMs: 1,
      once: true,
      maxRounds: null,
      roundLogFile: roundLog,
      runId: 't',
      json: false,
      routines: goalDriverRoutines(tmp, { scriptRoot: repoRoot }),
    });
    assert.equal(code, 0, 'resident loop 一轮应正常退出');

    const a1 = fs.readFileSync(path.join(tmp, 'goals', 'AC-001-t.md'), 'utf8');
    const a2 = fs.readFileSync(path.join(tmp, 'goals', 'AC-002-t.md'), 'utf8');
    const g1 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8');
    assert.match(a1, /^status: achieved$/m, 'active AC pass ⇒ flip achieved（裁定 5）');
    // AC-219 + gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics：无牵引 draft AC
    // 分诊判 activate ⇒ 翻 active（⛔ 不翻 achieved/retired——I2 只翻 active、放弃归人）。
    assert.match(a2, /^status: active$/m, 'draft AC 无牵引 ⇒ activate ⇒ 翻 active（激活判据 = 判据就绪，非牵引）');
    assert.doesNotMatch(a2, /^status: achieved$/m, 'draft AC 不得被 I2 翻 achieved（裁定 3：I2 只翻 active）');
    assert.doesNotMatch(a2, /^status: retired$/m, 'draft AC 不得翻 retired（放弃归人，AC-211）');
    // AC-2（行为级）+ AC-212 充分性闸：draft AC 不再阻塞目标达成判定（纯函数层已证，见 goalAchievedFromRecords
    // 单测），但 GOAL 层 flip 还要过充分性闸——GOAL-001 body 无 `## 退出条件` ⇒ insufficient ⇒ 不 flip。
    assert.match(g1, /^status: active$/m, 'draft 不阻塞但充分性 insufficient ⇒ 不 flip GOAL（AC-212）');

    // flips：AC-001 → achieved、AC-002 → active（activate 判决被 ⑧ 消费，⛔ 非只落痕）。
    const lines = fs.readFileSync(roundLog, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[lines.length - 1]);
    const goalFact = rec.facts.find((f) => f.name === 'goal-ring');
    assert.ok(goalFact, 'round record 含 goal-ring fact');
    const flipsById = new Map((goalFact.value.flips ?? []).map((f) => [f.id, f.to]));
    assert.equal(flipsById.get('AC-001'), 'achieved', 'active AC 在 flips 里 to=achieved（达成翻转）');
    assert.equal(flipsById.get('AC-002'), 'active', 'draft AC 无牵引 ⇒ activate ⇒ flips 里 to=active（⛔ 不翻 needs-human，AC-219）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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


test('real ring: GOAL 名下 achieved AC 尾事件 fail ⇒ 关闭被拒（closeBlocks 落痕 + flips ok:false），声明 long-term 后恢复可关闭', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-closeblock-'));
  const sufficiencyCmd = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'];
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001：有退出条件（机械可证部分判 not-evaluated ⇒ 走语义判定 seam ⇒ covered），
    // AC-001 已经是 achieved 而 criterion 恒假 ⇒ 每轮 gate 都往台账写一条 fail 尾事件。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      ['---', 'id: GOAL-001', 'title: t', 'status: active', 'kind: goal',
       'origin: test fixture', '---', '', '## 退出条件', '', '1. 条件一', ''].join('\n'), 'utf8');
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });

    const r1 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    const b1 = r1.fact.value.closeBlocks.find((b) => b.goal === 'GOAL-001');
    assert.ok(b1, 'closeBlocks 含 GOAL-001 一条（⛔ 不是缺席）');
    assert.equal(b1.verdict, 'blocked-failing-ac', 'achieved+尾fail+未声明 long-term ⇒ 关闭被拒');
    assert.deepEqual(b1.acs, ['AC-001'], '被点名的 AC 枚举在 closeBlocks.acs（⛔ 不布尔）');
    assert.equal(b1.cause, null, 'blocked-failing-ac 的 cause 恒 null（与 not-evaluated 不同形）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: active$/m,
      'GOAL 未被关闭（仍在 active）');
    const refused = r1.fact.value.flips.find((f) => f.id === 'GOAL-001' && f.to === 'achieved');
    assert.ok(refused && refused.ok === false, 'flip 记录里有一条 ok:false 的关闭尝试（区别于静默不关）');
    assert.match(refused.reason, /^blocked-failing-ac: AC-001$/, '拒绝理由带独立成因取值与 AC 清单');
    assert.notEqual(r1.sufficiencyFacts[0].value.sufficiency.verdict, 'insufficient',
      '负控制：被拒不是因充分性不足（否则测的是另一条闸）');

    // 逃生口（臂③）：给 AC-001 声明 long-term ⇒ 恢复可关闭。经 goal-store write（机件路径）。
    const w = spawnSync('node', ['--experimental-strip-types', path.join(repoRoot, 'packages/quay/src/goal-store.ts'),
      'write', 'AC-001', '--long-term', 'true', '--root', tmp], { encoding: 'utf8' });
    assert.equal(w.status, 0, 'goal-store write --long-term true 成功:\n' + w.stdout + w.stderr);
    const r2 = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    assert.equal(r2.fact.value.closeBlocks.find((b) => b.goal === 'GOAL-001').verdict, 'clear',
      '声明 long-term ⇒ 恢复 clear（逃生口有效）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: achieved$/m,
      '逃生口打开后 GOAL 确实被关闭');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('real ring: 无 achieved 红 AC 时 closeBlocks 恒有该 GOAL 一条且 verdict=clear（字段存在性，⛔ 不是缺席）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-closeblock-clear-'));
  const sufficiencyCmd = ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'];
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal' });
    fs.writeFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'),
      ['---', 'id: GOAL-001', 'title: t', 'status: active', 'kind: goal',
       'origin: test fixture', '---', '', '## 退出条件', '', '1. 条件一', ''].join('\n'), 'utf8');
    // AC 仍 active（判据 true ⇒ 本轮 I2 翻 achieved，尾事件是 pass）⇒ 不阻塞。
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'], sufficiencyCmd });
    const blocks = fact.value.closeBlocks;
    assert.ok(Array.isArray(blocks), 'closeBlocks 是数组（字段存在 ⇒ 「查过且零条」与「未跑该判定」可分）');
    assert.equal(blocks.length, 1, '一条 active GOAL ⇒ 一条 closeBlock');
    assert.deepEqual(blocks[0], { goal: 'GOAL-001', verdict: 'clear', acs: [], cause: null },
      '无 achieved 红 AC ⇒ clear（本条与上一条的 blocked 对照，证明谓词能取假）');
    assert.match(fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8'), /^status: achieved$/m,
      '对照：clear ⇒ GOAL 正常关闭');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
// ── 立案前【直接量复核】（gap-frozen-violated-files-on-stale-verdict）──────────────────────────────
//
// 缺陷：`frozenReading.failing` 是**台账读数**（轮转 verdict，新鲜度界 4h），而轮转周期实测 13–101 min
// ⇒ 修复落地后尾读数最长数小时仍写 `fail`，driver 每轮据此立案 + prompt 逐字告诉下游「earlier fix did
// not hold」。修法 = 立案前真跑一次那条 criterion，只有复核后**仍非 0** 才产 frozen-violated。
//
// 下面四组互为控制：①三态互不同形（含闸拒绝）；②真跑判据的「修复已落地」形态（cleared）；③缺口分派
// 的改前/改后对照（同一时刻同一 AC）；④端到端（生产形态：修复落地、台账尾尚未轮转 ⇒ 不立案）。
