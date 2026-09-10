// @test-group engine
// goal-triage-activate-executed.test.mjs — GOAL-010 退出条件① / AC-223
// (tasks/gap-goal-triage-activate-executed): goal-driver 分诊的 activate 判决被【实际执行】——
// 判 activate 的 draft AC 经一轮 driver 后被 writeGoalStatus 以 "active" 翻写（判决不再零消费）。
//
// 覆盖（AC-223 机制半 + DoD 三条负控制各带「改坏 ⇒ 测试红」的取假路径）：
//  ① 正向：结构完备 + 零关联任务的 draft AC 一轮后 flips 含 to=="active" 且目标 status 翻 active，
//     且次轮被 computeGoalGaps 计为 gap（牵引不再是激活判据；改坏=不消费判决会红）。
//  ② 负控制 (a)：判 needs-human 的 draft AC 不被激活（flips 无该 ac 的 to=="active"；
//     改坏=无视判决把非 activate 也激活会红）。
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

// ── ① 正向 + ② 负控制(a) + ④ 负控制(c)：正向零牵引也激活，needs-human / retired 不被翻 ──

test('正向：结构完备 + 零关联任务的 draft AC 一轮后翻 active，次轮被 computeGoalGaps 计为 gap', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activate-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    // AC-903：criterion 非空 + 零关联任务（无牵引）⇒ activate（本任务核心：牵引不再是激活判据）。
    // criterion `false`（可评估、判 fail）⇒ 次轮不被 I2 翻 achieved，仍 active，可被 computeGoalGaps 计为 gap。
    writeGoalFile(tmp, { id: 'AC-903', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'false' });
    // AC-901：criterion 空 ⇒ needs-human（负控制 a 对象）。
    writeGoalFile(tmp, { id: 'AC-901', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: '' });

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const flips = fact.value.flips;
    assert.ok(Array.isArray(flips), 'value.flips 是数组');

    // 正向：AC-903 翻 active（零关联任务也激活——牵引不再是判据）。
    const flip903 = flips.find((f) => f.id === 'AC-903' && f.to === 'active');
    assert.ok(flip903, 'AC-903 在 flips 中有 to=="active" 条目（判 activate ⇒ writeGoalStatus("active") 被执行）');
    assert.equal(flip903.ok, true, 'AC-903 激活写成功（criterion false 可评估为 fail，P6 放行）');

    // 负控制 (a)：needs-human 的 AC-901 不被激活。
    // （re-anchor 在 runGoalRound 的分诊循环里结构上不可达——循环以 active GOAL 的 gid 过滤
    // 名下 AC，`String(r.goal)===gid` 恒为合法 GOAL-NNN，triageDraftAc 的 re-anchor 前置恒假；
    // 故驱动层的非 activate 判决只可能是 needs-human / hold（posture）两态，hold 由 ③ 覆盖。）
    const activeIds = new Set(flips.filter((f) => f.to === 'active').map((f) => f.id));
    assert.ok(!activeIds.has('AC-901'), 'needs-human 的 AC-901 不被激活（改坏=无视判决把非 activate 也激活会红）');

    // 负控制 (c)：flips 无 to=="retired"（driver 永不写 retired；改坏=把 "active" 写成 "retired" 会红）。
    assert.ok(flips.every((f) => f.to !== 'retired'), 'flips 无 to=="retired"（driver 不写 retired，AC-211）');

    // 目标 status 真翻 active（goal-store 写面生效，⛔ 非仅 flips 记账——硬规则 4 推论三：记账≠写面）。
    const records = await listGoalRecords(repoRoot, tmp);
    const ac903 = records.find((r) => String(r.id) === 'AC-903');
    assert.ok(ac903, 'AC-903 在读回列表中');
    assert.equal(ac903.status, 'active', 'AC-903 目标 status 翻 active（goal-store 写面生效）');

    // 次轮：AC-903 已 active + 零关联任务 ⇒ computeGoalGaps 计为 gap（循环依赖解除的端到端证据）。
    const second = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
    const gap903 = (second.fact.value.gaps ?? []).find((g) => g.ac === 'AC-903');
    assert.ok(gap903, '次轮：AC-903 被 computeGoalGaps 看见（立案机制现在看得见它）');
    assert.equal(gap903.state, 'gap', 'AC-903 计为 gap（零关联任务 ⇒ 缺口语义环会立案）');
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
