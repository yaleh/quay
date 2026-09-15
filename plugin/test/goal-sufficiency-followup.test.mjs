// @test-group engine
// goal-sufficiency-followup.test.mjs — 充分性卡死信号
// (tasks/gap-goal-sufficiency-insufficient-has-no-followup-signal)。
//
// 缺口：确定裁决 `insufficient` 写进 `.quay/goal-sufficiency-cache.json` 之后**没有任何下游消费者**
// ——它只在每一轮 `.quay/goal-round.jsonl` 里原样重复，不升级成 finding/立案、不提醒、不上面板。
// 两个真实实例（本仓 GOAL-018 / quay-fleet GOAL-005）都因此永久卡在 active。
//
// 覆盖：
//  ① sufficiencyStallReading 纯函数四态（⛔ 不折叠成布尔；「不计时」与「计时 0 秒」不同形）；
//  ② stall 窗口的**推导式**（judgeWallclockMs + roundIntervalMs）——⛔ 不是一个写死的常数，
//     且 drivers.yml 的声明优先（可配置接缝存在）；
//  ③ runSufficiencyFollowupPass：到阈值 ⇒ file 一次；同一个裁决实例⛔不再 file；
//     裁决变化（key 变）⇒ 重新计时；covered/not-evaluated ⛔不触发；halt/资源门 ⇒ deferred 且不丢计时；
//     spawn 失败 ⇒ 不消耗该实例的唯一一次机会（下一轮重试）；
//  ④ runGoalRound 集成：轮记录带 sufficiency_stall 读数 + 真的产出一条人可见的记录（信号 agent 落盘）；
//     机械层 insufficient（body 缺 `## 退出条件`，从未调语义判官）也走同一条路。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-followup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUFFICIENCY_TIMEOUT_MS,
  buildSufficiencyFollowupArgv,
  buildSufficiencyFollowupPrompt,
  resetSufficiencyCacheForTest,
  runGoalRound,
  runSufficiencyFollowupPass,
  sufficiencyStallReading,
  sufficiencyStallWindowMs,
} from '../scripts/goal-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 夹具 ────────────────────────────────────────────────────────────────────────────────

/** 建一个 temp workspace（goals/ + tasks/ + .quay/）。 */
function mkRoot(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `goal-suff-followup-${tag}-`));
  for (const d of ['goals', 'tasks', '.quay']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  return tmp;
}

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（跑真 goal-store CLI，⛔ 不注入 seam）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, body = '## body\nx' }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '');
  for (const line of body.split('\n')) lines.push(line);
  lines.push('');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

const EXIT_CONDITIONS = '## 退出条件\n\n1. 退出条件一：真实浏览器验证过。\n2. 退出条件二：图标披露真实后果。\n';

/** 信号 agent 的假实现：把收到的 prompt 追加进 marker（可数、可读），并真的在 tasks/ 下落一条记录
 *  ——「产出一条人可见的记录」这条 DoD 在夹具层是可核的（⛔ 不是只看 spawn 数）。 */
function makeAgentScript(tmp, markerRel = '.quay/agent-calls.jsonl') {
  const marker = path.join(tmp, markerRel);
  const script = path.join(tmp, 'fake-followup-agent.mjs');
  fs.writeFileSync(
    script,
    [
      "import fs from 'node:fs';",
      'const prompt = process.argv[2] ?? "";',
      `fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ promptLen: prompt.length, prompt }) + "\\n");`,
      `fs.writeFileSync(${JSON.stringify(path.join(tmp, 'tasks', 'filed-signal.md'))}, "# filed by signal agent\\n");`,
      'process.exit(0);',
      '',
    ].join('\n'),
    'utf8',
  );
  return { marker, script, cmd: `node ${script}` };
}

function readMarker(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function ledgerOf(tmp) {
  const p = path.join(tmp, '.quay', 'goal-sufficiency-followup.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')).entries ?? {};
}

const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-09-15T10:00:00Z');

// ── ① 纯函数四态 ────────────────────────────────────────────────────────────────────────

test('AC2/AC3 纯函数: sufficiencyStallReading 四态互不同形（⛔ 不折叠成布尔）', () => {
  const W = 60_000;
  // 非 insufficient（covered / not-evaluated）⇒ 条目删除、不计时（AC3）。
  for (const v of ['covered', 'not-evaluated']) {
    const r = sufficiencyStallReading(v, 'k1', { key: 'k1', since: iso(NOW - 10 * W), filedAt: null }, NOW, W);
    assert.equal(r.decision, 'not-insufficient', `${v} ⇒ 不触发`);
    assert.equal(r.next, null, '⛔ 不保留陈旧实例（留着会让裁决变化后的计时不重置）');
    assert.equal(r.elapsedMs, null, '⛔「不计时」与「计时 0 秒」不同形');
  }
  // 新实例（无 prior）⇒ 计时从此刻开始；窗口 > 0 ⇒ wait。
  const fresh = sufficiencyStallReading('insufficient', 'k1', null, NOW, W);
  assert.equal(fresh.decision, 'wait', '首次观察 ⇒ 开始计时，不立即 file');
  assert.equal(fresh.elapsedMs, 0);
  assert.equal(fresh.next.since, iso(NOW));
  // 到阈值 ⇒ file；⛔ next.filedAt 仍为 null（由 pass 在 agent 真的跑起来后才置）。
  const due = sufficiencyStallReading('insufficient', 'k1', { key: 'k1', since: iso(NOW - W), filedAt: null }, NOW, W);
  assert.equal(due.decision, 'file');
  assert.equal(due.elapsedMs, W);
  assert.equal(due.next.filedAt, null, '⛔ 判定层不预置 filedAt——只有 spawn 成功才算 file 过');
  // 已 file ⇒ already-filed（AC2：不是每轮都触发）。
  const done = sufficiencyStallReading('insufficient', 'k1', { key: 'k1', since: iso(NOW - W), filedAt: iso(NOW) }, NOW, W);
  assert.equal(done.decision, 'already-filed');
  assert.equal(done.next.filedAt, iso(NOW), '已 file 的时刻原样保留');
  // 裁决实例变化（key 变）⇒ 计时重开（AC2：裁决变化才重新计时）——即便旧实例早已过阈值。
  const rekeyed = sufficiencyStallReading('insufficient', 'k2', { key: 'k1', since: iso(NOW - 10 * W), filedAt: iso(NOW - W) }, NOW, W);
  assert.equal(rekeyed.decision, 'wait', 'AC2: 裁决变化 ⇒ 重新计时');
  assert.equal(rekeyed.elapsedMs, 0);
  assert.equal(rekeyed.next.filedAt, null, '新实例没被 file 过');
  // 窗口 0 ⇒ 观察到的当轮就 file（合法边界：阈值非负）。
  assert.equal(sufficiencyStallReading('insufficient', 'k1', null, NOW, 0).decision, 'file');
  // ⛔ since 读不懂 ⇒ 重新计时（方向 = 再等一个窗口），⛔ 不冒充「已经等够了」而立即 file。
  const garbage = sufficiencyStallReading('insufficient', 'k1', { key: 'k1', since: 'not-a-date', filedAt: null }, NOW, W);
  assert.equal(garbage.decision, 'wait', '⛔ 读不懂 since 不得冒充「等够了」');
  assert.equal(garbage.next.since, iso(NOW));
});

// ── ② 窗口推导式（⛔ 无自由常数）────────────────────────────────────────────────────────

test('AC2 窗口: 缺省是【推导式】judgeWallclockMs + roundIntervalMs，且 drivers.yml 声明优先', () => {
  const tmp = mkRoot('window');
  try {
    // 无 drivers.yml ⇒ 推导：判官墙钟 + 轮间隔。换任一项，窗口跟着走（⛔ 不是写死的常数）。
    assert.equal(
      sufficiencyStallWindowMs(tmp, { judgeWallclockMs: SUFFICIENCY_TIMEOUT_MS, roundIntervalMs: 30_000 }),
      SUFFICIENCY_TIMEOUT_MS + 30_000,
    );
    assert.equal(sufficiencyStallWindowMs(tmp, { judgeWallclockMs: SUFFICIENCY_TIMEOUT_MS, roundIntervalMs: 5_000 }), SUFFICIENCY_TIMEOUT_MS + 5_000);
    assert.equal(sufficiencyStallWindowMs(tmp, { judgeWallclockMs: 90_000, roundIntervalMs: 5_000 }), 95_000);
    // 显式覆盖优先（CLI / 测试缝），含合法的 0。
    assert.equal(sufficiencyStallWindowMs(tmp, { explicit: 7, judgeWallclockMs: 90_000, roundIntervalMs: 5_000 }), 7);
    assert.equal(sufficiencyStallWindowMs(tmp, { explicit: 0, judgeWallclockMs: 90_000, roundIntervalMs: 5_000 }), 0);
    // drivers.yml 声明优先于推导式——可配置接缝存在（⛔ 生产想改窗口不必改代码）。
    const cfg = path.join(tmp, 'plugin', 'scripts');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'drivers.yml'), 'version: 1\nkinds:\n  goal:\n    sufficiency_stall_window_ms: 12345\n', 'utf8');
    assert.equal(sufficiencyStallWindowMs(tmp, { judgeWallclockMs: 90_000, roundIntervalMs: 5_000 }), 12345);
    // 显式仍优先于 drivers.yml。
    assert.equal(sufficiencyStallWindowMs(tmp, { explicit: 3, judgeWallclockMs: 90_000, roundIntervalMs: 5_000 }), 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ③ pass：file 一次 / 不重复 / 不丢 / 挡下可区分 ───────────────────────────────────────

const GOAL_RECORDS = [
  { id: 'GOAL-001', title: 'g', status: 'active', kind: 'goal', body: EXIT_CONDITIONS },
  { id: 'AC-001', title: 'a', status: 'active', kind: 'criterion', goal: 'GOAL-001', expect: 'e' },
];

test('AC1/AC2: 到阈值 ⇒ file 一次；同一个裁决实例⛔不再 file（不是每轮都触发）', () => {
  const tmp = mkRoot('once');
  try {
    const { marker, script, cmd } = makeAgentScript(tmp);
    const readings = [{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' }];
    const opts = { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'] };

    const r1 = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, opts);
    assert.equal(r1.insufficient, 1);
    assert.equal(r1.filed, 1, 'AC1: 到阈值 ⇒ file 出一条信号');
    assert.equal(r1.waiting, 0);
    assert.equal(r1.deferred, 0);
    assert.equal(r1.outcomes.length, 1);
    assert.equal(r1.outcomes[0].goal, 'GOAL-001');
    assert.equal(r1.outcomes[0].exitCode, 0);
    assert.equal(readMarker(marker).length, 1, '信号 agent 真的被 spawn 了（⛔ 不是只数数）');
    // DoD：产出一条人可见的记录（agent 落盘进 tasks/）——⛔ 不是只写一行没人订阅的日志。
    assert.ok(fs.existsSync(path.join(tmp, 'tasks', 'filed-signal.md')), 'DoD: 信号真的落成了 tasks/ 里的一条记录');
    assert.equal(typeof ledgerOf(tmp)['GOAL-001'].filedAt, 'string', '台账记下 file 时刻');
    assert.equal(ledgerOf(tmp)['GOAL-001'].key, 'k1');

    const r2 = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, opts);
    assert.equal(r2.filed, 0, 'AC2: 同一个裁决实例只 file 一次');
    assert.equal(r2.alreadyFiled, 1);
    assert.equal(readMarker(marker).length, 1, '⛔ 没有第二次 spawn');

    // AC2：裁决变化（新 key）⇒ 重新计时 ⇒ 窗口 0 下再 file 一次。
    const r3 = runSufficiencyFollowupPass([{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k2' }], GOAL_RECORDS, tmp, opts);
    assert.equal(r3.filed, 1, 'AC2: 裁决变化才重新计时（新实例 ⇒ 重新 file）');
    assert.equal(readMarker(marker).length, 2);
    assert.equal(ledgerOf(tmp)['GOAL-001'].key, 'k2');
    assert.ok(script && fs.existsSync(script));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC2 负控制: 未到阈值 ⇒ 只计时不 file（阈值不是摆设）', () => {
  const tmp = mkRoot('wait');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    const readings = [{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' }];
    const opts = { followupCmd: cmd, stallWindowMs: 3_600_000, resourceGateArgv: ['true'] };
    for (let i = 0; i < 3; i++) {
      const r = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, opts);
      assert.equal(r.filed, 0, `第 ${i + 1} 轮：未到阈值 ⇒ 不 file`);
      assert.equal(r.waiting, 1);
      assert.equal(r.insufficient, 1, '读数仍如实报「有 1 条持续 insufficient」');
    }
    assert.equal(readMarker(marker).length, 0, '⛔ 一个信号都没发出去');
    assert.equal(ledgerOf(tmp)['GOAL-001'].filedAt, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC3 负控制: covered / not-evaluated ⇒ 不触发，且台账不保留陈旧实例', () => {
  const tmp = mkRoot('negs');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    // 先让 insufficient 计时（未到阈值），再让裁决变成 covered ⇒ 条目必须被删。
    const w = 3_600_000;
    runSufficiencyFollowupPass([{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' }], GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: w, resourceGateArgv: ['true'] });
    assert.equal(typeof ledgerOf(tmp)['GOAL-001'], 'object', '前置：先有一条计时中的条目');
    const r1 = runSufficiencyFollowupPass([{ goal: 'GOAL-001', verdict: 'covered', key: 'k1' }], GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'] });
    assert.equal(r1.insufficient, 0, 'covered ⛔ 不触发');
    assert.equal(r1.filed, 0);
    assert.equal(ledgerOf(tmp)['GOAL-001'], undefined, 'AC3: covered ⇒ 条目删除（裁决变了，计时不延续）');

    const r2 = runSufficiencyFollowupPass([{ goal: 'GOAL-001', verdict: 'not-evaluated', key: 'k1' }], GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'] });
    assert.equal(r2.insufficient, 0, 'not-evaluated ⛔ 不触发（判不出 ≠ 判不够）');
    assert.equal(r2.filed, 0);
    assert.equal(ledgerOf(tmp)['GOAL-001'], undefined);
    assert.equal(readMarker(marker).length, 0, '⛔ 零信号');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC3 负控制: 裁决在阈值内变化 ⇒ 不触发（重新计时），⛔ 不累计旧实例的时长', () => {
  const tmp = mkRoot('rekey');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    const w = 3_600_000;
    // 旧实例已经等了远超阈值的时间……
    fs.writeFileSync(
      path.join(tmp, '.quay', 'goal-sufficiency-followup.json'),
      JSON.stringify({ version: 1, entries: { 'GOAL-001': { key: 'old', since: iso(NOW - 10 * w), filedAt: null } } }),
      'utf8',
    );
    // ……但本轮的裁决实例是新 key ⇒ 重新计时 ⇒ 不 file（窗口 1h）。
    const r = runSufficiencyFollowupPass(
      [{ goal: 'GOAL-001', verdict: 'insufficient', key: 'new' }],
      GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: w, resourceGateArgv: ['true'], nowMs: NOW },
    );
    assert.equal(r.filed, 0, 'AC3: 阈值内裁决变化 ⇒ 不触发');
    assert.equal(r.waiting, 1);
    assert.equal(readMarker(marker).length, 0);
    assert.equal(ledgerOf(tmp)['GOAL-001'].key, 'new');
    assert.ok(Date.parse(ledgerOf(tmp)['GOAL-001'].since) >= NOW, '计时从新实例被观察到的时刻起算');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC1/AC2: spawn 失败不消耗唯一一次机会（下一轮重试），且 deferred/deferred 成因可区分', () => {
  const tmp = mkRoot('retry');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    const readings = [{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' }];
    // 失败的 agent（非零退出）⇒ 不记 filedAt ⇒ 下一轮仍在阈值内，重试。
    const bad = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, { followupCmd: 'false', stallWindowMs: 0, resourceGateArgv: ['true'] });
    assert.equal(bad.filed, 0, '⛔ spawn 没跑成功不算 file');
    assert.equal(bad.outcomes[0].exitCode, 1, '诊断面留下真实退出码（⛔ 不静默）');
    assert.equal(ledgerOf(tmp)['GOAL-001'].filedAt, null, '⛔ 不消耗该实例的唯一一次机会');
    // 下一轮换一个能跑的 agent ⇒ 真的 file。
    const good = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'] });
    assert.equal(good.filed, 1, 'spawn 恢复后仍会 file（静默丢失的正是本任务要堵的形态）');
    assert.equal(readMarker(marker).length, 1);
    // launchArgv 抛错（profiles.yml 缺失）⇒ 记诊断，⛔ 不静默、⛔ 不消耗机会。
    const tmp2 = mkRoot('retry2');
    try {
      const threw = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp2, { followupCmd: null, stallWindowMs: 0, resourceGateArgv: ['true'] });
      assert.equal(threw.filed, 0);
      assert.ok(threw.outcomes[0].error, 'launchArgv 失败留下成因');
      assert.equal(ledgerOf(tmp2)['GOAL-001'].filedAt, null);
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC1: halt / 资源门只挡 spawn ⛔ 不挡计时，被挡的条数单独计数（⛔ 与 waiting 不同形）', () => {
  const tmp = mkRoot('gates');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    const readings = [{ goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' }];
    const halted = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'], halted: true });
    assert.equal(halted.filed, 0);
    assert.equal(halted.deferred, 1, '停顿下被挡 ⇒ 记 deferred（⛔ 不是静默丢弃）');
    assert.equal(halted.waiting, 0, '⛔「被挡下」与「没到阈值」不同形');
    assert.equal(halted.insufficient, 1, '⛔ 计时/读数不受 halt 约束（零 LLM 的观测面）');
    assert.equal(typeof ledgerOf(tmp)['GOAL-001'].filedAt, 'object', '⛔ 被挡的实例没有被记成「file 过」');
    // 资源门 WAIT ⇒ 同样只挡 spawn。
    const gated = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['false'] });
    assert.equal(gated.filed, 0);
    assert.equal(gated.deferred, 1);
    assert.equal(readMarker(marker).length, 0);
    // 门恢复 ⇒ 同一个实例（计时未断）立即被 file。
    const open = runSufficiencyFollowupPass(readings, GOAL_RECORDS, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'] });
    assert.equal(open.filed, 1, '门一开，等待中的实例就被发出（计时没被重置）');
    assert.equal(readMarker(marker).length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC1: 每轮上限按 spawnCap 截断，超出部分记 deferred（⛔ 不静默丢弃）', () => {
  const tmp = mkRoot('cap');
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    const readings = [
      { goal: 'GOAL-001', verdict: 'insufficient', key: 'k1' },
      { goal: 'GOAL-002', verdict: 'insufficient', key: 'k2' },
    ];
    const records = [
      ...GOAL_RECORDS,
      { id: 'GOAL-002', title: 'g2', status: 'active', kind: 'goal', body: EXIT_CONDITIONS },
    ];
    const r = runSufficiencyFollowupPass(readings, records, tmp, { followupCmd: cmd, stallWindowMs: 0, resourceGateArgv: ['true'], spawnCap: 1 });
    assert.equal(r.filed, 1, '上限 1 ⇒ 只 file 一条');
    assert.equal(r.deferred, 1, '另一条记 deferred（下一轮重试）');
    assert.equal(readMarker(marker).length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ④ prompt / argv ─────────────────────────────────────────────────────────────────────

test('AC1: prompt 内嵌退出条件与在域 AC 原文，并明写「只提议不写 goal-store」的边界', () => {
  const goal = { id: 'GOAL-005', title: 'PWA 视觉/交互对齐', body: EXIT_CONDITIONS };
  const acs = [{ id: 'AC-061', title: '设计令牌地基', expect: 'exit 0' }];
  const p = buildSufficiencyFollowupPrompt(goal, acs, '/tmp/root', 1234);
  // ⛔ 逐条断言节体原文（`exitConditionsText` 取的是**节体**——标题由 prompt 自己的小节标题给出）。
  assert.ok(p.includes('1. 退出条件一：真实浏览器验证过。'), '退出条件一原文进 prompt');
  assert.ok(p.includes('2. 退出条件二：图标披露真实后果。'), '退出条件二原文进 prompt');
  assert.ok(p.includes('AC-061') && p.includes('设计令牌地基') && p.includes('exit 0'), '在域 AC（id/title/expect）进 prompt');
  assert.ok(p.includes('goal_id=GOAL-005'), '被卡的 GOAL id 进 prompt');
  assert.ok(/Do NOT write the goal store/i.test(p), '边界：⛔ 不写 goal-store');
  assert.ok(/Do NOT mark any GOAL or AC/i.test(p), '边界：⛔ 不翻状态');
  assert.ok(/needs-human/.test(p), '产物形态：供人审核（⛔ 不自动进派发链当工作做）');
  // 机械 insufficient 的形态（无退出条件 / 零在域 AC）：prompt 必须**说出来**，⛔ 不是留空。
  const pMechanical = buildSufficiencyFollowupPrompt({ id: 'GOAL-018', title: 't', body: '## body\nx' }, [], '/tmp/root', 1);
  assert.ok(/NONE/.test(pMechanical), '无退出条件时 prompt 如实写 NONE');
  assert.ok(/EMPTY/.test(pMechanical), '零在域 AC 时 prompt 如实写 EMPTY');
});

test('AC1: argv 末参数是 prompt；seam 覆盖前缀时 prompt 仍追加在最后', () => {
  const goal = { id: 'GOAL-005', title: 't', body: EXIT_CONDITIONS };
  const argv = buildSufficiencyFollowupArgv(goal, [{ id: 'AC-061', title: 'a', expect: 'e' }], '/tmp/root', 0, 'node /tmp/x.mjs');
  assert.deepEqual(argv.slice(0, 2), ['node', '/tmp/x.mjs']);
  assert.equal(argv.length, 3);
  assert.ok(argv[2].includes('goal_id=GOAL-005'), 'prompt 作末参数追加（测试缝可捕获真实 prompt）');
});

// ── ⑤ runGoalRound 集成（轮记录 + 端到端落一条记录）──────────────────────────────────────

const judgeCmd = (verdict) => ['node', '-e', `process.stdout.write(JSON.stringify({verdict:${JSON.stringify(verdict)}}))`];

test('AC1/AC2: runGoalRound 端到端——语义判 insufficient 且过阈值 ⇒ file 一条信号，且轮记录带读数', async () => {
  const tmp = mkRoot('round');
  resetSufficiencyCacheForTest();
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal', body: EXIT_CONDITIONS });
    // criterion false ⇒ AC 不 reached ⇒ GOAL 不会因其他原因被 flip，卡死形态保真。
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });

    const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      sufficiencyCmd: judgeCmd('insufficient'),
      sufficiencyFollowupCmd: cmd,
      sufficiencyStallWindowMs: 0,
    });

    assert.equal(sufficiencyFacts[0].value.sufficiency.verdict, 'insufficient', '前置：判官判 insufficient');
    const s = fact.value.sufficiency_stall;
    assert.ok(s && typeof s === 'object', '轮记录带 sufficiency_stall 读数');
    assert.equal(s.insufficient, 1);
    assert.equal(s.filed, 1, 'AC1: 端到端 file 出一条信号');
    assert.equal(s.deferred, 0);
    assert.equal(s.waiting, 0);
    assert.equal(s.alreadyFiled, 0);
    assert.equal(s.outcomes.length, 1);
    assert.equal(readMarker(marker).length, 1, '信号 agent 收到 prompt');
    const prompt = readMarker(marker)[0].prompt;
    assert.ok(prompt.includes('退出条件一'), 'prompt 带着该 GOAL 的退出条件原文');
    assert.ok(prompt.includes('AC-001'), 'prompt 带着在域 AC');
    assert.ok(fs.existsSync(path.join(tmp, 'tasks', 'filed-signal.md')), 'DoD: 产出一条人可见的记录');

    // 第二轮：同一个裁决实例 ⇒ ⛔ 不再 file（AC2）。
    const r2 = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      sufficiencyCmd: judgeCmd('insufficient'),
      sufficiencyFollowupCmd: cmd,
      sufficiencyStallWindowMs: 0,
    });
    assert.equal(r2.fact.value.sufficiency_stall.filed, 0);
    assert.equal(r2.fact.value.sufficiency_stall.alreadyFiled, 1);
    assert.equal(readMarker(marker).length, 1, '⛔ 不是每轮都触发');
  } finally {
    resetSufficiencyCacheForTest();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC1: 机械层 insufficient（body 缺 `## 退出条件`，⛔ 从未调语义判官）同样触发', async () => {
  const tmp = mkRoot('mech');
  resetSufficiencyCacheForTest();
  try {
    const { marker, cmd } = makeAgentScript(tmp);
    writeGoalFile(tmp, { id: 'GOAL-018', status: 'active', kind: 'goal', body: '## 背景\nbg\n' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-018', criterion: 'false' });

    const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      // ⛔ 判官故意配成「不可用」：机械 insufficient 根本不该走到语义层。
      sufficiencyCmd: [],
      sufficiencyFollowupCmd: cmd,
      sufficiencyStallWindowMs: 0,
    });
    assert.equal(sufficiencyFacts[0].value.sufficiency.verdict, 'insufficient', '机械层判 insufficient');
    assert.equal(fact.value.sufficiency_stall.filed, 1, 'GOAL-018 形态（本任务实例①）也 file');
    assert.ok(readMarker(marker)[0].prompt.includes('NONE'), 'prompt 如实说「没有退出条件」——请人补的正是它');
  } finally {
    resetSufficiencyCacheForTest();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC3: runGoalRound 端到端负控制——covered / not-evaluated ⇒ 零信号', async () => {
  for (const [tag, cmd] of [['covered', judgeCmd('covered')], ['not-evaluated', []]]) {
    const tmp = mkRoot(`neg-${tag}`);
    resetSufficiencyCacheForTest();
    try {
      const { marker, cmd: agentCmd } = makeAgentScript(tmp);
      writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal', body: EXIT_CONDITIONS });
      writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'false' });
      const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
        scriptRoot: repoRoot,
        gapWorkerCmd: 'true',
        resourceGateArgv: ['true'],
        sufficiencyCmd: cmd,
        sufficiencyFollowupCmd: agentCmd,
        sufficiencyStallWindowMs: 0,
      });
      assert.ok(['covered', 'not-evaluated'].includes(sufficiencyFacts[0].value.sufficiency.verdict), `${tag}: 裁决不是 insufficient`);
      assert.equal(fact.value.sufficiency_stall.insufficient, 0);
      assert.equal(fact.value.sufficiency_stall.filed, 0, `AC3: ${tag} ⇒ 零信号`);
      assert.equal(readMarker(marker).length, 0);
    } finally {
      resetSufficiencyCacheForTest();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});
