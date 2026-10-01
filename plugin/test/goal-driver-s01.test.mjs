// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/6 (16 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).

import { test } from "node:test";
import { CRITERION_KINDS, GAP_WORKER_TIMEOUT_MS_DEFAULT, GOAL_SPAWN_CAP_DEFAULT, assert, buildGapWorkerPrompt, classifyCriterionKind, computeGoalGaps, fs, goalAchievedFromRecords, goalGapWorkerTimeoutMs, goalSpawnCap, isFilingGapState, isTaskStuck, os, path, productionCarriersOf, readTaskFacts, readsProductionCarrier, runGapSpawnPass, spawn } from "./helpers/goal-driver-harness.mjs";

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


test('关联任务全为 done：判据只读工作产物 ⇒ workable（照常立案）；零关联任务 ⇒ gap（负控制）', () => {
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active', criterion: 'test -f src/x.ts' }];
  // 正：关联任务全部 done + 判据只读仓库内工作产物 ⇒ workable（还有 worker 能改变它），taskCount=关联数（枚举，非布尔化）。
  const gaps = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-X' }]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].state, 'workable');
  assert.equal(gaps[0].taskCount, 1);
  // superseded 同理——有关联任务但无牵引（工作已关闭）⇒ workable，⛔ 不再与「零关联」同判 gap。
  const gaps2 = computeGoalGaps(records, [{ id: 't', status: 'superseded', goalAc: 'AC-X' }]);
  assert.equal(gaps2[0].state, 'workable');
  assert.equal(gaps2[0].taskCount, 1);
  // 负控制：零关联任务（goal_ac 指向别处）⇒ gap（真缺口不被误放）。
  const gaps3 = computeGoalGaps(records, [{ id: 'other', status: 'todo', goalAc: 'AC-OTHER' }]);
  assert.equal(gaps3[0].state, 'gap');
  assert.equal(gaps3[0].taskCount, 0);
});

// ── gap-done-unresolved-conflates-workable-with-world-gated：有关联任务但全非牵引时，按【判据载体】
//    机械三分（workable / world-gated / unclassified），⛔ 不再压成一个 done-unresolved（终点黑洞）──

test('AC1：判据读生产载体（.quay/<file>）⇒ world-gated（独立取值，⛔ 不立案）', () => {
  const records = [{
    id: 'AC-X', goal: 'GOAL-001', status: 'active',
    criterion: 'python3 - <<P\nimport json\nfor ln in open(".quay/ci-runs.jsonl"):\n  print(json.loads(ln))\nP',
  }];
  const gaps = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-X' }]);
  assert.equal(gaps[0].state, 'world-gated', '判据读生产载体 ⇒ 真值是未来生产事件 ⇒ world-gated');
  assert.equal(gaps[0].taskCount, 1, 'taskCount 枚举关联数（⛔ 非布尔化）');
  assert.equal(isFilingGapState(gaps[0].state), false, 'world-gated ⛔ 不消耗 spawn 名额（无 worker 能产出该事件）');
});

test('AC5：「读不到 / 解析不出判据」⇒ unclassified（既不与 workable 也不与 world-gated 同形，硬规则 3b）', () => {
  const records = [{ id: 'AC-X', goal: 'GOAL-001', status: 'active' }]; // criterion 缺失 ⇒ 读不到
  const gaps = computeGoalGaps(records, [{ id: 't', status: 'done', goalAc: 'AC-X' }]);
  assert.equal(gaps[0].state, 'unclassified');
  assert.equal(gaps[0].taskCount, 1);
  assert.equal(isFilingGapState(gaps[0].state), false, 'unclassified ⛔ 不消耗 spawn 名额');
});

test('AC1/AC3/AC5 三态逐一不同形：workable / world-gated / unclassified 互不相等', () => {
  const mk = (criterion) => ({ id: 'AC-X', goal: 'GOAL-001', status: 'active', ...(criterion === undefined ? {} : { criterion }) });
  const done = [{ id: 't', status: 'done', goalAc: 'AC-X' }];
  const workable = computeGoalGaps([mk('test -f src/x.ts')], done)[0];
  const world = computeGoalGaps([mk('cat .quay/release-branch-finish.jsonl')], done)[0];
  const unk = computeGoalGaps([mk(undefined)], done)[0];
  assert.equal(workable.state, 'workable');
  assert.equal(world.state, 'world-gated');
  assert.equal(unk.state, 'unclassified');
  assert.equal(new Set([workable.state, world.state, unk.state]).size, 3, '三态互不同形（硬规则 3b）');
  // 立案面：只有 workable 该立案（AC2 的正半边 + AC1/AC5 的负半边）
  assert.deepEqual([workable, world, unk].map((g) => isFilingGapState(g.state)), [true, false, false]);
});

test('AC1 谓词（按位置判定）：readsProductionCarrier 只认 `.quay/<file>` 路径 token', () => {
  assert.equal(readsProductionCarrier('cat .quay/ci-runs.jsonl'), true);
  assert.equal(readsProductionCarrier('T=/x; for f in $T/.quay/fan-in-*.log; do :; done'), true, '第三方项目里的 .quay/ 载体同样算');
  assert.equal(readsProductionCarrier('d="$T/.quay"; glob(d + "/fan-in-*.log")'), true, '`.quay` 目录本身（+ 其下 glob）也算——AC-318 的形态');
  assert.equal(readsProductionCarrier('test -f src/x.ts && exit 0'), false, '仓库内工作产物不是生产载体');
  assert.equal(readsProductionCarrier('grep -c my.quay/x notes.md'), false, '成词要求：`my.quay/` 这个子串不算');
  assert.equal(readsProductionCarrier('grep -c .quayx notes.md'), false, '成词要求：`.quayx` 这个子串不算');
  assert.equal(readsProductionCarrier(''), false);
  assert.deepEqual(productionCarriersOf('a .quay/ci-runs.jsonl b .quay/ci-runs.jsonl c .quay/release-branch-finish.jsonl'),
    ['.quay/ci-runs.jsonl', '.quay/release-branch-finish.jsonl'], '去重保序');
  assert.equal(classifyCriterionKind(undefined), 'unclassified');
  assert.equal(classifyCriterionKind('   '), 'unclassified', '空/纯空白 ⇒ 读不到 ⇒ unclassified');
  assert.equal(classifyCriterionKind('exit 1'), 'workable');
  assert.deepEqual([...CRITERION_KINDS].sort(), ['unclassified', 'workable', 'world-gated']);
});

test('AC2：workable 进入 runGapSpawnPass 选取面；world-gated / unclassified 不进入', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-3way-'));
  try {
    const records = [
      { id: 'GOAL-001', title: 'g', status: 'active' },
      { id: 'AC-W', goal: 'GOAL-001', title: 'w', expect: 'e', status: 'active', criterion: 'test -f src/x.ts' },
      { id: 'AC-G', goal: 'GOAL-001', title: 'g2', expect: 'e', status: 'active', criterion: 'cat .quay/ci-runs.jsonl' },
      { id: 'AC-U', goal: 'GOAL-001', title: 'u', expect: 'e', status: 'active' },
    ];
    const taskFacts = [
      { id: 't-w', status: 'done', goalAc: 'AC-W' },
      { id: 't-g', status: 'done', goalAc: 'AC-G' },
      { id: 't-u', status: 'done', goalAc: 'AC-U' },
    ];
    const gaps = computeGoalGaps(records, taskFacts);
    assert.deepEqual(gaps.map((g) => g.state), ['workable', 'world-gated', 'unclassified'], '三条各落一态、逐条不同形');
    const r = runGapSpawnPass(gaps, records, tmp, { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
    assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-W'], '选取面 = 只要 workable（AC2 正控制 + AC1/AC5 负控制）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 关联任务翻 done 后 computeGoalGaps 不再报 gap（=每轮 spawn 立案）；具体落哪个非牵引态由
//    判据载体决定（workable / world-gated / unclassified，见上面三态分叉的用例）。与「零关联任务
//    ⇒ gap」不同形（硬规则 3：枚举不布尔，每种成因不同处置）。
//    （gap-goal-gap-done-task-not-traction-respawns-every-round +
//      gap-done-unresolved-conflates-workable-with-world-gated）


test('AC2 词表可区分：GapState 含 workable/world-gated/unclassified，与 gap/in-progress 两两不同（读源 + 行为判定）', () => {
  const src = fs.readFileSync(new URL('../scripts/goal-driver.ts', import.meta.url), 'utf8');
  assert.match(src, /export type GapState = "in-progress" \| "gap" \| "workable" \| "world-gated" \| "unclassified" \| "stalled" \| "not-evaluated"/, 'GapState 词表含 workable/world-gated/unclassified');
  const workRec = { id: 'AC-X', goal: 'GOAL-001', status: 'active', criterion: 'test -f src/x.ts' };
  const worldRec = { id: 'AC-X', goal: 'GOAL-001', status: 'active', criterion: 'cat .quay/ci-runs.jsonl' };
  const unkRec = { id: 'AC-X', goal: 'GOAL-001', status: 'active' };
  const done = [{ id: 't', status: 'done', goalAc: 'AC-X' }];
  const workable = computeGoalGaps([workRec], done)[0];
  const world = computeGoalGaps([worldRec], done)[0];
  const unk = computeGoalGaps([unkRec], done)[0];
  const gap = computeGoalGaps([workRec], [{ id: 'other', status: 'todo', goalAc: 'AC-OTHER' }])[0];
  const inProg = computeGoalGaps([workRec], [{ id: 't', status: 'ready', goalAc: 'AC-X' }], { eligibleTodoIds: new Set(), excludedReadyIds: new Set() })[0];
  assert.equal(workable.state, 'workable');
  assert.equal(world.state, 'world-gated');
  assert.equal(unk.state, 'unclassified');
  assert.equal(gap.state, 'gap');
  assert.equal(inProg.state, 'in-progress');
  const all = [workable.state, world.state, unk.state, gap.state, inProg.state];
  assert.equal(new Set(all).size, 5, '五个取值两两不同形（硬规则 3b：⛔ 不给两种成因共用输出）');
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
