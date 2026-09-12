// @test-group engine
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

import {
  goalAchievedFromRecords,
  computeGoalGaps,
  isTaskStuck,
  readTaskFacts,
  checkStaleness,
  checkAchievedFailing,
  readFrozenFailing,
  parseFrozenFailingReading,
  isFilingGapState,
  sweepFrozenAcs,
  goalDriverRoutines,
  runGoalRound,
  runGapSpawnPass,
  buildGapWorkerPrompt,
  readReadyPoolJudgment,
  goalSpawnCap,
  goalGapWorkerTimeoutMs,
  GAP_WORKER_TIMEOUT_MS_DEFAULT,
  GOAL_SPAWN_CAP_DEFAULT,
  GOAL_ROUND_REL,
  goalCloseBlockFromRecords,
  probeLedger,
  goalFlipDecision,
  targetHealthFact,
  deriveTargetHealth,
  resolveTargetBinding,
  declaredTargetBinding,
  buildHealthProbeArgv,
  parseHealthProbe,
  readDeliveredPluginVersion,
  TARGET_HEALTH_FACT_NAME,
  HEALTH_REQUIRED_CARRIERS,
  HEALTH_OBSERVED_CARRIERS,
  HEALTH_WINDOW_SEC_DEFAULT,
} from '../scripts/goal-driver.ts';
import { runResidentQualityGateLoop } from '../scripts/quality-gate-driver.ts';
import { DRIVER_KINDS, KNOWN_KINDS } from '../scripts/driver-runtime.ts';
// cli/driver.ts 的 KINDS 白名单（AC6 断言对象；已导出）。
import { KINDS } from '../../packages/quay/src/cli/driver.ts';

// 脚本根（goal-store.ts 从这里取，经 goalStoreArgv）；数据根（goals/）在各测试里给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。
 *  body 缺省无 `## 退出条件`（= 充分性机械判 insufficient）；需要语义判定接缝的用例显式给 body。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, body = '## body\nx' }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '');
  for (const line of body.split('\n')) lines.push(line);
  lines.push('');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

// ── I2 纯推导 ─────────────────────────────────────────────────────────────────

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

const goalStoreAbs = path.join(repoRoot, 'packages', 'quay', 'src', 'goal-store.ts');

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
function writeStandingGoalFile(tmp, { id, status, kind, goal, criterion, longTerm = false }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  if (longTerm) lines.push('long-term: true');
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

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
function mkTargetRoot({
  missingCarriers = [], pluginVersion, initStateAbsent = false, roundRecords = [],
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-target-'));
  const q = path.join(dir, '.quay');
  fs.mkdirSync(q, { recursive: true });
  for (const name of [...HEALTH_REQUIRED_CARRIERS, ...HEALTH_OBSERVED_CARRIERS]) {
    if (missingCarriers.includes(name)) continue;
    fs.writeFileSync(path.join(q, name), '{}\n', 'utf8');
  }
  for (const name of roundRecords) fs.writeFileSync(path.join(q, name), '{}\n', 'utf8');
  if (!initStateAbsent && pluginVersion !== undefined) {
    fs.writeFileSync(path.join(q, 'quay-init-state.json'), JSON.stringify({ pluginVersion }), 'utf8');
  }
  return dir;
}

/** 交付物 plugin 版本（本仓 plugin/.claude-plugin/plugin.json）——夹具「配置形状一致」态用它。 */
const DELIVERED_VERSION = readDeliveredPluginVersion(repoRoot);

/** 起一个**真在跑**的「目标项目 driver 进程」夹具：cmdline 带 `worker-driver.js --root <目标根>`
 *  ⇒ 探针的 `ps` 扫描能真读到它（⛔ 不是注入答案：读的还是真进程表、真 cmdline，夹具只造环境）。
 *  ⚠️ 必须 spawn（异步）：探针要在它活着的时候跑；调用方负责 kill。 */
function spawnTargetDriverFixture(targetRoot) {
  return spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)', 'worker-driver.js', '--root', targetRoot], { stdio: 'ignore' });
}

/** 等夹具进程的 cmdline 真的出现在进程表里（spawn 是异步的：立刻探针会读到「还没起来」= 假红）。
 *  判据是**进程表**（探针读的同一来源），⛔ 不是子进程自述 —— 与探针同一直接量。 */
function waitForProcessVisible(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).includes('worker-driver.js')) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},120)']); // 有界小睡（不引入额外依赖）
  }
  return false;
}

/** 「进程表读不到」夹具：transport 缝换成「先吃干 stdin、再打一份 driverProcesses:null 的探针输出」。
 *  ⛔ 这不是注入答案——它造的是**环境**（ps 不可用/被沙箱挡时探针就是这个形态），verdict 仍由
 *  被测代码从这份读数推出（本组其余用例正是它的对照）。 */
function cannedProbePrefix(tmp, reading) {
  const f = path.join(tmp, 'canned-probe.js');
  fs.writeFileSync(f, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify(${JSON.stringify(reading)})+String.fromCharCode(10)));`, 'utf8');
  return ['bash', '-c', `cat >/dev/null; node ${f}`];
}

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
