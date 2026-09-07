// @test-group engine
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6，含补回 suite）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  goalAchievedFromRecords,
  computeGoalGaps,
  readTaskFacts,
  checkStaleness,
  checkAchievedFailing,
  goalDriverRoutines,
  GOAL_ROUND_REL,
} from '../scripts/goal-driver.ts';
import { runResidentQualityGateLoop } from '../scripts/quality-gate-driver.ts';
import { DRIVER_KINDS, KNOWN_KINDS } from '../scripts/driver-runtime.ts';
// cli/driver.ts 的 KINDS 白名单（AC6 断言对象；已导出）。
import { KINDS } from '../../packages/quay/src/cli/driver.ts';

// 脚本根（goal-store.ts 从这里取，经 goalStoreArgv）；数据根（goals/）在各测试里给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
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

test('real ring: 载体有 verdict + evidence 回写 + I2 flip + draft 不动 + 无 tasks 写', async () => {
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

    // AC3 机制 + I2：evidence 回写 + AC pass→achieved + GOAL 全达成→achieved。
    const g1 = fs.readFileSync(path.join(tmp, 'goals', 'GOAL-001-t.md'), 'utf8');
    const a1 = fs.readFileSync(path.join(tmp, 'goals', 'AC-001-t.md'), 'utf8');
    assert.match(g1, /^status: achieved$/m, 'GOAL-001 全部 AC 达成 ⇒ flip achieved（I2）');
    assert.match(a1, /^status: achieved$/m, 'AC-001 pass ⇒ flip achieved（裁定 5 确定性推导）');
    assert.match(a1, /evidence:/, 'AC-001 evidence 回写（gate 写回 at/verdict/reading）');

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

// ── 裁定 3 边界负控制：active GOAL 下的 draft AC 不被翻（draft→active 是人/manager 手动）─────────

test('real ring: draft AC under active GOAL 不被翻（裁定 3 边界负控制）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-driver-draftac-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    // GOAL-001（active）两条 AC：AC-001 active（pass ⇒ flip achieved）、AC-002 draft（pass ⇒ 不翻）。
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
    assert.match(a2, /^status: draft$/m, 'draft AC 不被翻（裁定 3：driver 不碰 draft 激活）');
    // draft AC 未达成 ⇒ isGoalAchieved=false ⇒ GOAL 不 flip achieved。
    assert.match(g1, /^status: active$/m, '含未达成的 draft AC ⇒ GOAL 不 flip achieved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC6：cli/driver.ts KINDS 与 kernel DRIVER_KINDS 集合一致 ─────────────────────────────

test('AC6: cli/driver.ts KINDS 与 kernel DRIVER_KINDS 集合相等（含补回 suite + 新增 goal）', () => {
  assert.ok(KINDS.includes('suite'), 'suite 已补回 cli 白名单');
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
