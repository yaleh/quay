// @test-group engine
// goal-triage-activate-executed.test.mjs — GOAL-010 退出条件① / AC-223
// (tasks/gap-goal-triage-activate-executed): goal-driver 分诊的 activate 判决被【实际执行】——
// 判 activate 的 draft AC 经一轮 driver 后被 writeGoalStatus 以 "active" 翻写（判决不再零消费）。
//
// 覆盖（AC-223 机制半 + DoD 三条负控制各带「改坏 ⇒ 测试红」的取假路径）：
//  ① 正向：判 activate 的 draft AC ⇒ 一轮后 flips 含 to=="active" 且目标 status 翻 active
//     （writeGoalStatus 以 "active" 被调；改坏=不消费判决会红）。
//  ② 负控制 (a)：判 needs-human / hold 的 draft AC 不被激活（flips 无该 ac 的 to=="active"；
//     改坏=只按牵引激活、无视判决会红）。
//  ③ 负控制 (b)：GOAL 声明 posture（measure-only）名下 draft AC 不被激活（改坏=无视 posture
//     自行激活会红）。
//  ④ 负控制 (c)：driver 不写 retired（flips 无 to=="retired"；改坏=把本任务的 "active" 写成
//     "retired" 会红）。源形状守卫在 goal-triage-no-driver-retire.test.mjs（逐点核 writeGoalStatus
//     全部调用点 status 实参 ∈ {achieved, active, needs-human}），本文件只做运行时断言。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-activate-executed.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listGoalRecords,
  runGoalRound,
} from '../scripts/goal-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, posture }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  if (posture !== undefined) lines.push(`posture: ${posture}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 写一个带 goal_ac 的 task 文件（供 triage 的「推进中」口径取 traction）。 */
function writeTaskFile(tmp, { id, status, goalAc }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `goal_ac: ${goalAc}`, '---', '', '## body', 'x', ''];
  fs.writeFileSync(path.join(tmp, 'tasks', `${id}.md`), lines.join('\n'), 'utf8');
}

// ── ① 正向 + ② 负控制(a) + ④ 负控制(c)：一轮 driver 内三条 draft AC 分诊异判，只 activate 被翻 ──

test('正向：判 activate 的 draft AC 一轮后 flips 含 to=="active" 且目标 status 翻 active', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activate-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    // AC-903：criterion 真 + 有牵引 ⇒ activate（正向对象）。
    writeGoalFile(tmp, { id: 'AC-903', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    writeTaskFile(tmp, { id: 'T-903', status: 'todo', goalAc: 'AC-903' });
    // AC-902：criterion 真 + 无牵引 ⇒ hold（负控制 a 对象）。
    writeGoalFile(tmp, { id: 'AC-902', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    // AC-901：criterion 空 + 有牵引 ⇒ needs-human（负控制 a 对象）。
    writeGoalFile(tmp, { id: 'AC-901', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: '' });
    writeTaskFile(tmp, { id: 'T-901', status: 'todo', goalAc: 'AC-901' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const flips = fact.value.flips;
    assert.ok(Array.isArray(flips), 'value.flips 是数组');

    // 正向：AC-903 翻 active。
    const flip903 = flips.find((f) => f.id === 'AC-903' && f.to === 'active');
    assert.ok(flip903, 'AC-903 在 flips 中有 to=="active" 条目（判 activate ⇒ writeGoalStatus("active") 被执行）');
    assert.equal(flip903.ok, true, 'AC-903 激活写成功（criterion true 可评估，P6 放行）');

    // 负控制 (a)：needs-human 的 AC-901 / hold 的 AC-902 不被激活。
    // （re-anchor 在 runGoalRound 的分诊循环里结构上不可达——循环以 active GOAL 的 gid 过滤
    // 名下 AC，`String(r.goal)===gid` 恒为合法 GOAL-NNN，triageDraftAc 的 re-anchor 前置恒假；
    // 故驱动层的非 activate 判决只可能是 needs-human / hold 两态，此处逐态各取一对象。）
    const activeIds = new Set(flips.filter((f) => f.to === 'active').map((f) => f.id));
    assert.ok(!activeIds.has('AC-901'), 'needs-human 的 AC-901 不被激活（改坏=无视判决按牵引激活会红）');
    assert.ok(!activeIds.has('AC-902'), 'hold 的 AC-902 不被激活（改坏=无视判决按牵引激活会红）');

    // 负控制 (c)：flips 无 to=="retired"（driver 永不写 retired；改坏=把 "active" 写成 "retired" 会红）。
    assert.ok(flips.every((f) => f.to !== 'retired'), 'flips 无 to=="retired"（driver 不写 retired，AC-211）');

    // 目标 status 真翻 active（goal-store 写面生效，⛔ 非仅 flips 记账——硬规则 4 推论三：记账≠写面）。
    const records = await listGoalRecords(repoRoot, tmp);
    const ac903 = records.find((r) => String(r.id) === 'AC-903');
    assert.ok(ac903, 'AC-903 在读回列表中');
    assert.equal(ac903.status, 'active', 'AC-903 目标 status 翻 active（goal-store 写面生效）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ 负控制(b)：GOAL 声明 posture（measure-only）名下 draft AC 不被激活 ───────────────────

test('负控制 (b)：GOAL 声明 posture (measure-only) 名下 draft AC 不被激活（有牵引也不翻）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activate-posture-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-010', status: 'active', kind: 'goal', posture: 'measure-only' });
    // 有牵引（无 posture 时会是 activate）⇒ 分诊判 hold，⛔ 不得被驱动翻 active。
    writeGoalFile(tmp, { id: 'AC-910', status: 'draft', kind: 'criterion', goal: 'GOAL-010', criterion: 'true' });
    writeTaskFile(tmp, { id: 'T-910', status: 'todo', goalAc: 'AC-910' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const flips = fact.value.flips;
    const activeIds = new Set(flips.filter((f) => f.to === 'active').map((f) => f.id));
    assert.ok(!activeIds.has('AC-910'), 'posture (measure-only) 名下 draft AC 不被激活（改坏=无视 posture 自行激活会红）');

    // 并确认判决确实是 hold（驱动真读了 posture 并只消费 activate 判决）。
    const entry = fact.value.triage.find((t) => t.ac === 'AC-910');
    assert.ok(entry, 'AC-910 在 triage 中');
    assert.equal(entry.decision, 'hold', 'well-formed + posture ⇒ hold（posture 挡 activate，AC-215）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
