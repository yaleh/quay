// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/4 (24 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { GAP_WORKER_TIMEOUT_MS_DEFAULT, GOAL_ACCEPTANCE_ACTIVE_ENV, GOAL_SPAWN_CAP_DEFAULT, assert, buildGapWorkerPrompt, checkAchievedFailing, checkStaleness, computeGoalGaps, fs, goalAchievedFromRecords, goalGapWorkerTimeoutMs, goalSpawnCap, goalStoreAbs, isTaskStuck, os, path, readReadyPoolJudgment, readTaskFacts, repoRoot, runGapSpawnPass, runGoalRound, spawn, spawnSync, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

test('goalAchievedFromRecords: 零 AC ⇒ false；全 achieved ⇒ true；有未达成 ⇒ false', () => {
  assert.equal(goalAchievedFromRecords([], 'GOAL-001'), false, '零 AC 不可达成（与 goal-store.isGoalAchieved 同源）');
  assert.equal(
    goalAchievedFromRecords([{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }], 'GOAL-001'),
    true,
  );
  assert.equal(
    goalAchievedFromRecords(
      [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }, { id: 'AC-002', goal: 'GOAL-001', status: 'active' }],
      'GOAL-001',
    ),
    false,
  );
  // 在域 = active|achieved；draft/superseded/retired 不在域 ⇒ 不阻塞（只数在域 AC）。
  assert.equal(
    goalAchievedFromRecords(
      [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }, { id: 'AC-002', goal: 'GOAL-001', status: 'draft' }],
      'GOAL-001',
    ),
    true,
    'draft 不在域 ⇒ 不阻塞（旧实现 every(status==="achieved") 会把 draft 当阻塞）',
  );
  assert.equal(
    goalAchievedFromRecords(
      [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }, { id: 'AC-002', goal: 'GOAL-001', status: 'superseded' }, { id: 'AC-003', goal: 'GOAL-001', status: 'retired' }],
      'GOAL-001',
    ),
    true,
    'superseded/retired 也不在域 ⇒ 不阻塞',
  );
  assert.equal(
    goalAchievedFromRecords([{ id: 'AC-002', goal: 'GOAL-001', status: 'draft' }], 'GOAL-001'),
    false,
    '只有 draft 无在域 AC ⇒ 不可达成',
  );
});

// AC-1（gap-goal-driver-draft-ac-invisible-yet-blocking）：:172（goalAchievedFromRecords）与
// :201（computeGoalGaps）对 draft AC 口径一致——都【排除】draft。旧实现 :172 用 every(status==="achieved")
// 把 draft 计入阻塞 ⇒ 与 :201（只数 active）相反 ⇒ 一条 draft AC 既不被翻、又不计缺口、却仍挡 GOAL。

test('AC-1: draft AC 在目标达成判定与缺口计算中被【同口径】排除（立条时二者相反，能取假）', () => {
  // :172 侧——目标达成判定不含 draft：含 draft 的 GOAL 不再被它阻塞。
  assert.equal(
    goalAchievedFromRecords(
      [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }, { id: 'AC-002', goal: 'GOAL-001', status: 'draft' }],
      'GOAL-001',
    ),
    true,
    ':172 不含 draft ⇒ draft 不阻塞 GOAL 达成',
  );
  // :201 侧——缺口计算不含 draft：draft 不进 gaps（computeGoalGaps 只数 active）。
  const gaps = computeGoalGaps(
    [{ id: 'AC-001', goal: 'GOAL-001', status: 'active' }, { id: 'AC-002', goal: 'GOAL-001', status: 'draft' }],
    [],
  );
  assert.deepEqual(gaps.map((g) => g.ac), ['AC-001'], ':201 不含 draft ⇒ 缺口只含 active AC');
});

// ── G7 缺口计算（computeGoalGaps 三态 + readTaskFacts，gap-goal-ac-task-linkage-top-level-field）──


test('computeGoalGaps: active AC 三态（in-progress / gap），achieved/draft 排除', () => {
  const records = [
    { id: 'AC-170', goal: 'GOAL-001', status: 'active' },   // 有任务推进
    { id: 'AC-171', goal: 'GOAL-001', status: 'active' },   // 无任务 ⇒ gap
    { id: 'AC-172', goal: 'GOAL-001', status: 'achieved' }, // 已达成 ⇒ 排除
    { id: 'AC-173', goal: 'GOAL-001', status: 'draft' },    // 未激活 ⇒ 排除
  ];
  const taskFacts = [
    { id: 'gap-a', status: 'ready', goalAc: 'AC-170' },
    { id: 'gap-b', status: 'done', goalAc: 'AC-170' },   // done 不计入推进中
  ];
  const gaps = computeGoalGaps(records, taskFacts);
  assert.equal(gaps.length, 2, '只有两条 active AC 进入缺口读数（achieved/draft 排除）');
  const g170 = gaps.find((g) => g.ac === 'AC-170');
  const g171 = gaps.find((g) => g.ac === 'AC-171');
  assert.equal(g170.state, 'in-progress');
  assert.equal(g170.taskCount, 1, 'done 不计，只数 todo/ready');
  assert.equal(g171.state, 'gap');
  assert.equal(g171.taskCount, 0);
});


test('computeGoalGaps: taskFacts==null ⇒ 逐条 not-evaluated（⛔ 与 gap 不同形，硬规则 3b）', () => {
  const records = [{ id: 'AC-180', goal: 'GOAL-001', status: 'active' }];
  const gaps = computeGoalGaps(records, null);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].state, 'not-evaluated');
  assert.equal(gaps[0].taskCount, null, 'not-evaluated 时 taskCount 为 null，不是 0');
});


test('readTaskFacts: 读 tasks/*.md 的 status+goal_ac；目录不存在 ⇒ null（不是空数组）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-gap-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-x.md'),
      '---\nid: gap-x\nstatus: ready\ngoal_ac: AC-170\n---\nbody\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'tasks', 'gap-y.md'),
      '---\nid: gap-y\nstatus: done\n---\nbody\n', 'utf8');
    const facts = await readTaskFacts(tmp);
    assert.ok(Array.isArray(facts), 'readTaskFacts 返回数组');
    assert.equal(facts.length, 2);
    const x = facts.find((f) => f.id === 'gap-x');
    assert.equal(x.status, 'ready');
    assert.equal(x.goalAc, 'AC-170');
    const y = facts.find((f) => f.id === 'gap-y');
    assert.equal(y.status, 'done');
    assert.equal(y.goalAc, null, '未设 goal_ac ⇒ null');

    const empty = await readTaskFacts(path.join(tmp, 'nope'));
    assert.equal(empty, null, 'tasks 目录不存在 ⇒ null，不是 []');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── G9 缺口语义环（tasks/gap-goal-driver-gap-semantic-filing-ring）──────────────────────────


test('computeGoalGaps 四态：stalled = 关联任务全无法自行前进（结构量，⛔ 计时器）', () => {
  const records = [
    { id: 'AC-170', goal: 'GOAL-001', status: 'active' },  // 关联 todo 被判不合格 ⇒ stalled
    { id: 'AC-171', goal: 'GOAL-001', status: 'active' },  // 关联 todo 合格 ⇒ in-progress
    { id: 'AC-172', goal: 'GOAL-001', status: 'active' },  // 关联 ready 被排除 ⇒ stalled
    { id: 'AC-173', goal: 'GOAL-001', status: 'active' },  // 关联 ready 可派发 ⇒ in-progress
    { id: 'AC-174', goal: 'GOAL-001', status: 'active' },  // 无关联任务 ⇒ gap
  ];
  const taskFacts = [
    { id: 't-stuck-todo', status: 'todo', goalAc: 'AC-170' },
    { id: 't-ok-todo', status: 'todo', goalAc: 'AC-171' },
    { id: 't-stuck-ready', status: 'ready', goalAc: 'AC-172' },
    { id: 't-ok-ready', status: 'ready', goalAc: 'AC-173' },
  ];
  const judgment = {
    eligibleTodoIds: new Set(['t-ok-todo']),
    excludedReadyIds: new Set(['t-stuck-ready']),
  };
  const gaps = computeGoalGaps(records, taskFacts, judgment);
  const g = (ac) => gaps.find((x) => x.ac === ac);
  assert.equal(g('AC-170').state, 'stalled', '关联 todo 全被判不合格 ⇒ stalled');
  assert.equal(g('AC-171').state, 'in-progress', '关联 todo 有合格者 ⇒ in-progress');
  assert.equal(g('AC-172').state, 'stalled', '关联 ready 全被排除 ⇒ stalled');
  assert.equal(g('AC-173').state, 'in-progress', '关联 ready 有可派发者 ⇒ in-progress');
  assert.equal(g('AC-174').state, 'gap');
  assert.equal(g('AC-174').taskCount, 0);
  // judgment===null（读不到 ready-pool-check）⇒ 不判 stalled（⛔ 读不懂 ≠ 卡住，回到 in-progress）
  const noJudgment = computeGoalGaps(records, taskFacts, null);
  assert.equal(noJudgment.find((x) => x.ac === 'AC-170').state, 'in-progress', 'judgment=null ⇒ 不判 stalled');
});


test('isTaskStuck: todo 不在 eligible 集合 ⇒ stuck；ready 在 excluded ⇒ stuck；needs-human ⇒ stuck；done 不 stuck', () => {
  const judgment = { eligibleTodoIds: new Set(['a']), excludedReadyIds: new Set(['b']) };
  assert.equal(isTaskStuck({ id: 'a', status: 'todo' }, judgment), false);
  assert.equal(isTaskStuck({ id: 'x', status: 'todo' }, judgment), true);
  assert.equal(isTaskStuck({ id: 'b', status: 'ready' }, judgment), true);
  assert.equal(isTaskStuck({ id: 'c', status: 'ready' }, judgment), false);
  assert.equal(isTaskStuck({ id: 'nh', status: 'needs-human' }, judgment), true, 'needs-human ⇒ 已离开 todo/ready，不能自行前进 ⇒ stuck');
  assert.equal(isTaskStuck({ id: 'd', status: 'done' }, judgment), false);
  assert.equal(isTaskStuck({ id: 'e', status: 'superseded' }, judgment), false);
});

// ── needs-human ⇒ stalled（gap-goal-gap-needs-human-invisible-burns-spawn-slot）────────────────
// 关联任务翻 needs-human 后，computeGoalGaps 不再报 gap（taskCount=0），而是 stalled（taskCount=真实
// 关联数）——needs-human 是「有处理者、但不能自行前进」，与「无任务 ⇒ gap」不同形。


test('AC1: 关联任务全为 needs-human ⇒ stalled，taskCount = 该 AC 的 needs-human 任务数（不再是 0）', () => {
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active' }];
  const taskFacts = [{ id: 'gap-ac158', status: 'needs-human', goalAc: 'AC-X' }];
  const gaps = computeGoalGaps(records, taskFacts);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].state, 'stalled');
  assert.equal(gaps[0].taskCount, 1);
  // 两条 needs-human 任务 ⇒ taskCount=2（枚举关联数，⛔ 非布尔化——硬规则 3）
  const gaps2 = computeGoalGaps(records, [
    { id: 'gap-a', status: 'needs-human', goalAc: 'AC-X' },
    { id: 'gap-b', status: 'needs-human', goalAc: 'AC-X' },
  ]);
  assert.equal(gaps2[0].state, 'stalled');
  assert.equal(gaps2[0].taskCount, 2);
});


test('AC2: 负控制——三态两两不等（needs-human ⇒ stalled；ready 可晋升 ⇒ in-progress；无关联 ⇒ gap）', () => {
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active' }];
  // needs-human ⇒ stalled（正）
  const stalled = computeGoalGaps(records, [{ id: 't', status: 'needs-human', goalAc: 'AC-X' }])[0];
  // ready + judgment 判其可晋升（不在 excluded）⇒ in-progress
  const judgment = { eligibleTodoIds: new Set(), excludedReadyIds: new Set() };
  const inProgress = computeGoalGaps(records, [{ id: 't', status: 'ready', goalAc: 'AC-X' }], judgment)[0];
  // taskFacts 不含该 goalAc ⇒ gap、taskCount=0
  const gap = computeGoalGaps(records, [{ id: 'other', status: 'todo', goalAc: 'AC-OTHER' }])[0];
  assert.equal(stalled.state, 'stalled');
  assert.equal(stalled.taskCount, 1);
  assert.equal(inProgress.state, 'in-progress');
  assert.equal(gap.state, 'gap');
  assert.equal(gap.taskCount, 0);
  // 三次断言的 state 必须两两不等（判据能取假）
  assert.notEqual(stalled.state, inProgress.state, 'stalled ≠ in-progress');
  assert.notEqual(stalled.state, gap.state, 'stalled ≠ gap');
  assert.notEqual(inProgress.state, gap.state, 'in-progress ≠ gap');
});


test('关联任务全为 done ⇒ done-unresolved（⛔ 不再 gap/不再每轮 spawn）；零关联任务 ⇒ gap（负控制）', () => {
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active' }];
  // 正：关联任务全部 done ⇒ done-unresolved（工作已做过，⛔ 不再 spawn 立案），taskCount=关联数（枚举，非布尔化）。
  const gaps = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-X' }]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].state, 'done-unresolved');
  assert.equal(gaps[0].taskCount, 1);
  // superseded 同理——有关联任务但无牵引（工作已关闭）⇒ done-unresolved，⛔ 不再与「零关联」同判 gap。
  const gaps2 = computeGoalGaps(records, [{ id: 't', status: 'superseded', goalAc: 'AC-X' }]);
  assert.equal(gaps2[0].state, 'done-unresolved');
  assert.equal(gaps2[0].taskCount, 1);
  // 负控制：零关联任务（goal_ac 指向别处）⇒ gap（真缺口不被误放）。
  const gaps3 = computeGoalGaps(records, [{ id: 'other', status: 'todo', goalAc: 'AC-OTHER' }]);
  assert.equal(gaps3[0].state, 'gap');
  assert.equal(gaps3[0].taskCount, 0);
});

// ── gap-goal-gap-done-task-not-traction-respawns-every-round：done 不再每轮 spawn ─────────────
// 关联任务翻 done 后 computeGoalGaps 不再报 gap（=每轮 spawn 立案），而是 done-unresolved（有关联
// 任务但无牵引）。与「零关联任务 ⇒ gap」不同形（硬规则 3：枚举不布尔，两种成因不同处置）。


test('AC2 词表可区分：GapState 含 done-unresolved，与 gap/in-progress 两两不同（读源 + 行为判定）', () => {
  const src = fs.readFileSync(new URL('../scripts/goal-driver.ts', import.meta.url), 'utf8');
  assert.match(src, /export type GapState = "in-progress" \| "gap" \| "done-unresolved" \| "stalled" \| "not-evaluated"/, 'GapState 词表含 done-unresolved');
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active' }];
  const done = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-X' }])[0];
  const gap = computeGoalGaps(records, [{ id: 'other', status: 'todo', goalAc: 'AC-OTHER' }])[0];
  const inProg = computeGoalGaps(records, [{ id: 't', status: 'ready', goalAc: 'AC-X' }], { eligibleTodoIds: new Set(), excludedReadyIds: new Set() })[0];
  assert.equal(done.state, 'done-unresolved');
  assert.equal(gap.state, 'gap');
  assert.equal(inProg.state, 'in-progress');
  assert.notEqual(done.state, gap.state, 'done-unresolved ≠ gap');
  assert.notEqual(done.state, inProg.state, 'done-unresolved ≠ in-progress');
});


test('AC3 两处同修：牵引判定收进 isTractionStatus，字面量重复已消除（读源判定）', () => {
  const src = fs.readFileSync(new URL('../scripts/goal-driver.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /status === "todo" \|\| t\.status === "ready"/, '字面量重复已消除');
  // isTractionStatus 定义一次、被 computeGoalGaps 与 triageDraftAc 调用（≥2 调用点）。
  const calls = (src.match(/isTractionStatus\(/g) ?? []).length;
  assert.ok(calls >= 2, `isTractionStatus 调用点 ≥ 2（实测 ${calls}）`);
});


test('AC4: stalled 不消耗 spawn 名额（选取面只取 state==="gap"）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-stalledspawn-'));
  try {
    const records = [
      { id: 'GOAL-001', title: 'g', status: 'active' },
      { id: 'AC-158', goal: 'GOAL-001', title: 'a158', expect: 'e', status: 'active' },
      { id: 'AC-159', goal: 'GOAL-001', title: 'a159', expect: 'e2', status: 'active' },
    ];
    const gaps = [
      { goal: 'GOAL-001', ac: 'AC-158', state: 'stalled', taskCount: 1 },
      { goal: 'GOAL-001', ac: 'AC-159', state: 'gap', taskCount: 0 },
    ];
    const r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 3 });
    assert.equal(r.spawned, 1, '只有 AC-159 一条 gap ⇒ spawn 1');
    // 选取结果的 ac 集合与仅 state==="gap" 的子集逐一相等（stalled 不在选取面）
    const gapOnlyAcs = gaps.filter((g) => g.state === 'gap').map((g) => g.ac);
    assert.deepEqual(r.outcomes.map((o) => o.ac), gapOnlyAcs);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('goalSpawnCap: 读 drivers.yml goal.spawn_cap；explicit 优先；缺失回退缺省（⛔ 不写死）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-cap-'));
  try {
    assert.equal(goalSpawnCap(tmp), GOAL_SPAWN_CAP_DEFAULT, '无 drivers.yml ⇒ 缺省');
    assert.equal(goalSpawnCap(tmp, 1), 1, 'explicit 优先');
    fs.mkdirSync(path.join(tmp, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugin', 'scripts', 'drivers.yml'), 'kinds:\n  goal:\n    spawn_cap: 1\n', 'utf8');
    assert.equal(goalSpawnCap(tmp), 1, 'drivers.yml goal.spawn_cap=1 ⇒ 读配置');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('goalGapWorkerTimeoutMs: 三级回退（explicit → drivers.yml → 缺省）；缺省 > 实测 602.9s（⛔ 不写死）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-timeoutcfg-'));
  try {
    assert.equal(goalGapWorkerTimeoutMs(tmp), GAP_WORKER_TIMEOUT_MS_DEFAULT, '无 drivers.yml ⇒ 缺省');
    assert.ok(GAP_WORKER_TIMEOUT_MS_DEFAULT > 602_900, `缺省 ${GAP_WORKER_TIMEOUT_MS_DEFAULT} 必须 > 实测 602.9s（602900ms）`);
    assert.equal(goalGapWorkerTimeoutMs(tmp, 12345), 12345, 'explicit 优先');
    fs.mkdirSync(path.join(tmp, 'plugin', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugin', 'scripts', 'drivers.yml'), 'kinds:\n  goal:\n    gap_worker_timeout_ms: 60000\n', 'utf8');
    assert.equal(goalGapWorkerTimeoutMs(tmp), 60000, 'drivers.yml goal.gap_worker_timeout_ms=60000 ⇒ 读配置（解析结果，非字面量）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('buildGapWorkerPrompt: 含 quay-file-task 去重指令 + 顶层 goal_ac 指令（AC7 不重复立案）', () => {
  const p = buildGapWorkerPrompt({ goal: 'GOAL-001', ac: 'AC-185', state: 'gap', taskCount: 0 }, 'g-title', 'ac-title', 'expect', '/repo');
  assert.ok(p.includes('quay-file-task'), 'prompt 必须点名 quay-file-task');
  assert.ok(p.includes('MECHANISM-BASED dedup'), 'prompt 必须含按机制去重指令');
  assert.ok(p.includes('goal_ac: AC-185'), 'prompt 必须要求顶层 goal_ac');
  assert.ok(p.includes('needs-human'), 'prompt 必须说明 needs-human 也不重复立案');
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
