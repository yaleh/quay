// @test-group engine
// goal-driver-activation-blocked.test.mjs — gap-meta-writegoalstatus
//
// 契约：goal-driver ⑧ 对分诊判 activate 的 draft AC 调 writeGoalStatus 时，**若拒绝来自 goals 的
// 能力闸**，本轮 goal-ring fact 必须带一条具名 `activationBlocked` 条目：ac + cause +
// **缺失载体路径**。此前那条拒绝只留下 `flips{ok:false, reason:<截断到 200 字符的散文>}`——
// 没有消费者读 ok:false，载体路径落在截断点之外，于是那条 draft AC 每轮重判、永不激活、
// 也永不进入缺口环（computeGoalGaps 只数 active），其缺失载体因此永不被委托。
//
// 本文件跑【真】goal-store CLI（⛔ 不注入 seam）：夹具是 goals/*.md 真文件，读数来自一轮真 driver。
//
// 覆盖：
//  ① 正向：draft AC 的 criterion 执行一个**不存在**的载体 ⇒ 能力闸拒绝 ⇒ fact.value.activationBlocked
//     恰一条 {ac, cause:criterion-capability-unevaluated, missingCarriers:[<该路径>]}，且 AC 仍 draft
//     （改坏=不落条目 / 落成空载体清单 ⇒ 红）。
//  ② 负控制（AC 契约的那一条）：把该载体真的造出来（判据变为可认证）⇒ 同一条 AC 激活成功、
//     `activationBlocked` 里不再有该条目（改坏=条目常驻 ⇒ 红）。
//  ③ 成因不是硬编码的：同一形态但**工作区声明了写能力** ⇒ cause 必须是 `criterion-side-effect`
//     且 missingCarriers 为 `[]`（declared 轴压过 uncertifiable 轴）。这条是 ① 的取假半边：
//     一个恒说同一个 cause 的条目携带零信息。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-driver-activation-blocked.test.mjs

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

/** 判据要执行的载体：**在夹具树里不存在**（能力闸的 uncertifiable 轴正是「执行一个解析不出的载体」）。 */
const MISSING_CARRIER = 'plugin/test/missing-carrier.mjs';

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

/** 一轮 driver（真 goal-store CLI；gap spawn 与资源门用 `true` 短路，本文件不测那两条路径）。 */
function runRound(tmp) {
  return runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });
}

test('① 能力闸拒绝的激活 ⇒ goal-ring fact 落具名 activationBlocked 条目（ac + cause + 缺失载体路径）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activation-blocked-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-071', status: 'active', kind: 'goal' });
    // criterion 结构完备（非空、无 posture）⇒ 分诊判 activate；它执行的载体在夹具树里不存在
    // ⇒ 能力闸（uncertifiable-executed-artifact）拒绝，且 --force 也越不过。
    writeGoalFile(tmp, { id: 'AC-701', status: 'draft', kind: 'criterion', goal: 'GOAL-071', criterion: `node ${MISSING_CARRIER}` });

    const { fact } = await runRound(tmp);

    // 前置：拒绝**真的**发生了（否则下面断言的是「没发生的事」的同形读数）。
    const flip = (fact.value.flips ?? []).find((f) => f.id === 'AC-701' && f.to === 'active');
    assert.ok(flip, 'AC-701 有 to=="active" 的 flip 条目（⑧ 真的尝试了激活）');
    assert.equal(flip.ok, false, '激活写被拒（fixture 前提：能力闸拒绝；改坏=闸没守会红）');

    // AC 契约的正面：具名条目存在且三要素齐。
    const blocked = fact.value.activationBlocked;
    assert.ok(Array.isArray(blocked), 'fact.value.activationBlocked 是数组（恒产出字段）');
    const entry = blocked.find((b) => b.ac === 'AC-701');
    assert.ok(entry, 'activationBlocked 有 AC-701 的具名条目（改坏=不落条目 ⇒ 红）');
    assert.equal(entry.goal, 'GOAL-071', '条目点名所属 GOAL');
    assert.equal(entry.cause, 'criterion-capability-unevaluated', 'cause 是「能力无法认证」那一态（AC 契约钉死的词）');
    assert.equal(entry.storeCode, 'criterion-capability-unevaluable', 'store 的机读码逐字留在 storeCode（⛔ 改写成近形词）');
    assert.deepEqual(entry.missingCarriers, [MISSING_CARRIER], '缺失载体路径被枚举出来（修的人要造的那个文件）');
    assert.deepEqual(entry.rules, ['uncertifiable-executed-artifact'], '命中的 Core 轴');
    assert.equal(entry.carrierReading, 'judged', '载体清单来自 Core 同一判定器的复判');
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 0, '条目保留 store 的拒绝原文（证据）');

    // 拒绝真的落地：AC 仍是 draft（⛔ 仅 flips 记账——硬规则 4 推论三：记账≠写面）。
    const records = await listGoalRecords(repoRoot, tmp);
    assert.equal(records.find((r) => String(r.id) === 'AC-701')?.status, 'draft', 'AC-701 仍是 draft（激活确实没发生）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('② 负控制：载体造出来（判据可认证）后同一 AC 激活成功，该条目消失', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activation-blocked-neg-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, { id: 'GOAL-072', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-702', status: 'draft', kind: 'criterion', goal: 'GOAL-072', criterion: `node ${MISSING_CARRIER}` });

    // 第一轮：载体不在 ⇒ 被拒 ⇒ 有条目。
    const first = await runRound(tmp);
    assert.ok(
      (first.fact.value.activationBlocked ?? []).some((b) => b.ac === 'AC-702'),
      '前提：第一轮被能力闸拒绝并落条目',
    );

    // 把载体真的造出来（内容可评估、退出 0）——⛔ 不改 criterion 一个字：变的只有那棵树。
    const carrierAbs = path.join(tmp, MISSING_CARRIER);
    fs.mkdirSync(path.dirname(carrierAbs), { recursive: true });
    fs.writeFileSync(carrierAbs, 'process.exit(0);\n', 'utf8');

    // 第二轮：判据可认证 ⇒ 激活成功 ⇒ `activationBlocked` 里不再有它（改坏=条目常驻 ⇒ 红）。
    const second = await runRound(tmp);
    const still = (second.fact.value.activationBlocked ?? []).filter((b) => b.ac === 'AC-702');
    assert.deepEqual(still, [], '载体存在后该 AC 不再出现在 activationBlocked（条目随之消失）');

    const flip = (second.fact.value.flips ?? []).find((f) => f.id === 'AC-702' && f.to === 'active');
    assert.ok(flip, '第二轮有 AC-702 的 to=="active" flip');
    assert.equal(flip.ok, true, '第二轮激活写成功（能力闸放行）');

    // 写面真的翻了（⛔ 只信 flips）。
    const records = await listGoalRecords(repoRoot, tmp);
    assert.equal(records.find((r) => String(r.id) === 'AC-702')?.status, 'active', 'AC-702 目标 status 翻 active');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('③ 取假半边：工作区声明了写能力 ⇒ cause 是 criterion-side-effect，且 missingCarriers 为空', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-activation-blocked-side-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // 声明「node 跑这个载体 = 会写」。declared 轴压过 uncertifiable 轴（store 侧的同一优先级）。
    fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.quay', 'criterion-capabilities.json'),
      JSON.stringify({ writeCapableCommands: [{ id: 'missing-carrier-writes', pattern: 'missing-carrier\\.mjs', proof: 'fixture' }] }, null, 2),
      'utf8',
    );
    writeGoalFile(tmp, { id: 'GOAL-073', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-703', status: 'draft', kind: 'criterion', goal: 'GOAL-073', criterion: `node ${MISSING_CARRIER}` });

    const { fact } = await runRound(tmp);
    const entry = (fact.value.activationBlocked ?? []).find((b) => b.ac === 'AC-703');
    assert.ok(entry, '被拒的 AC-703 有条目');
    assert.equal(entry.cause, 'criterion-side-effect', 'cause 跟着**实际命中的轴**走（改坏=硬编码 unevaluated ⇒ 红）');
    assert.equal(entry.storeCode, 'criterion-side-effect', 'storeCode 同步');
    assert.deepEqual(entry.missingCarriers, [], '声明的写能力没有「缺失载体」可言（⛔ 硬凑一个路径）');
    assert.ok(entry.rules.includes('declared-write-capable-command'), 'rules 点名声明轴');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
