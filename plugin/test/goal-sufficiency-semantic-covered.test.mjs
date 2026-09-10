// @test-group engine
// goal-sufficiency-semantic-covered.test.mjs — AC-222 (tasks/gap-goal-sufficiency-semantic-covered):
// 充分性闸补语义判定分支——goalSufficiencyVerdict 机械可证部分判不出（有退出条件 + 有在域 AC）时，
// 由语义判定（LLM，测试缝 sufficiencyCmd）判 covered / insufficient；不可用 / 超时 / 读不懂 ⇒
// not-evaluated（⛔ 绝不回落 covered）。覆盖四件事：
// ① 正向——语义判定路径存在：判「覆盖」⇒ semanticSufficiencyVerdict 返回 covered，且 runGoalRound
//    把语义判定接进充分性 fact（verdict === "covered"），在域 AC 全 achieved 时 GOAL 被机械 flip。
// ② 负控制 (a)——判「不覆盖」⇒ insufficient（与 covered 可分）。
// ③ 负控制 (b)——语义判定不可用 / 超时 / 读不懂 ⇒ not-evaluated，⛔ 不得为 covered（fail-closed）。
// ④ 解析器 fail-closed——parseSemanticSufficiencyVerdict 只认明确 covered/insufficient，其余全 not-evaluated。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-semantic-covered.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseSemanticSufficiencyVerdict,
  buildSufficiencyPrompt,
  semanticSufficiencyVerdict,
  runGoalRound,
} from '../scripts/goal-driver.ts';

// 脚本根（goal-store.ts 从这里取，经 goalStoreArgv）；数据根（goals/）在各测试里给临时目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI，
 *  复用 goal-driver.test.mjs 的 temp-root 缝）。body 缺省无 `## 退出条件`（充分性判 insufficient）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, body = '## body\nx' }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '');
  for (const line of body.split('\n')) lines.push(line);
  lines.push('');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

// ── ① 正向：语义判定路径存在，判「覆盖」⇒ covered ────────────────────────────────

test('正向: semanticSufficiencyVerdict 判「覆盖」⇒ covered（语义判定路径存在，⛔ 非无条件 return covered）', async () => {
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acs = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];
  // 测试缝 sufficiencyCmd：写一行 JSON {"verdict":"covered"}（node -e 免 shell 引号剥层；prompt 作末参数追加、被忽略）。
  const v = await semanticSufficiencyVerdict(goal, acs, repoRoot, {
    sufficiencyCmd: ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'],
  });
  assert.equal(v, 'covered', '判「覆盖」⇒ covered');
});

test('正向: runGoalRound 把语义判定接进充分性 fact（covered）且在域 AC 全 achieved 时 GOAL 被机械 flip', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sufficiency-covered-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // GOAL-001 有 `## 退出条件` + AC-001（criterion true ⇒ I2 flip 到 achieved）⇒ 机械可证部分
    // 判 not-evaluated，语义判定接缝产出 covered。
    writeGoalFile(tmp, { id: 'GOAL-001', status: 'active', kind: 'goal', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' });
    writeGoalFile(tmp, { id: 'AC-001', status: 'active', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });

    const { fact, sufficiencyFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      sufficiencyCmd: ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'],
    });

    assert.equal(fact.name, 'goal-ring', '主 fact 仍是 goal-ring');
    assert.ok(Array.isArray(sufficiencyFacts) && sufficiencyFacts.length === 1, '一条 active GOAL ⇒ 一条 sufficiency fact');
    assert.equal(sufficiencyFacts[0].value.sufficiency.goal, 'GOAL-001', 'sufficiency.goal = GOAL-001');
    // 核心：语义判定接进充分性 fact，verdict === "covered"（此前该形态只会出 not-evaluated）。
    assert.equal(sufficiencyFacts[0].value.sufficiency.verdict, 'covered', '语义判定 covered ⇒ sufficiency fact verdict === covered');
    // covered + 在域 AC 全 achieved ⇒ GOAL 机械 flip（充分性闸「能关闭」那一半，GOAL-010 退出条件②）。
    const goalFlips = fact.value.flips.filter((f) => f.id === 'GOAL-001');
    assert.ok(goalFlips.some((f) => f.to === 'achieved' && f.ok), 'GOAL 被机械 flip（covered 触发关闭）');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── ② 负控制 (a)：判「不覆盖」⇒ insufficient（与 covered 可分）─────────────────

test('负控制 (a): semanticSufficiencyVerdict 判「不覆盖」⇒ insufficient（⛔ 与 covered 可分）', async () => {
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acs = [{ id: 'AC-001', title: 't1', expect: '不覆盖条件一' }];
  const v = await semanticSufficiencyVerdict(goal, acs, repoRoot, {
    sufficiencyCmd: ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"insufficient"}))'],
  });
  assert.equal(v, 'insufficient', '判「不覆盖」⇒ insufficient');
  assert.notEqual(v, 'covered', 'insufficient 与 covered 可分');
});

// ── ③ 负控制 (b)：不可用 / 超时 / 读不懂 ⇒ not-evaluated（⛔ 不得回落 covered）────

test('负控制 (b): 语义判定不可用（空命令前缀 / spawn 失败）⇒ not-evaluated，⛔ 不得为 covered', async () => {
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acs = [{ id: 'AC-001', title: 't1', expect: 'x' }];
  // 空命令前缀 = 不可用。
  assert.equal(await semanticSufficiencyVerdict(goal, acs, repoRoot, { sufficiencyCmd: [] }), 'not-evaluated', '空命令前缀 ⇒ not-evaluated');
  // spawn 不存在的二进制 ⇒ 不可用。
  assert.equal(
    await semanticSufficiencyVerdict(goal, acs, repoRoot, { sufficiencyCmd: ['/nonexistent/definitely-not-a-binary'] }),
    'not-evaluated',
    'spawn 失败 ⇒ not-evaluated',
  );
});

test('负控制 (b): 语义判定超时 ⇒ not-evaluated，⛔ 不得为 covered', async () => {
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acs = [{ id: 'AC-001', title: 't1', expect: 'x' }];
  // sleep 5 秒 > sufficiencyTimeoutMs=100ms ⇒ runAsync SIGKILL ⇒ not-evaluated。
  const v = await semanticSufficiencyVerdict(goal, acs, repoRoot, {
    sufficiencyCmd: ['sh', '-c', 'sleep 5'],
    sufficiencyTimeoutMs: 100,
  });
  assert.equal(v, 'not-evaluated', '超时 ⇒ not-evaluated');
  assert.notEqual(v, 'covered', '超时绝不回落 covered');
});

test('负控制 (b): 语义判定读不懂（输出不可解析）⇒ not-evaluated，⛔ 不得为 covered', async () => {
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acs = [{ id: 'AC-001', title: 't1', expect: 'x' }];
  const v = await semanticSufficiencyVerdict(goal, acs, repoRoot, {
    sufficiencyCmd: ['sh', '-c', 'echo 这不是 covered 也不是 insufficient 的散文'],
  });
  assert.equal(v, 'not-evaluated', '读不懂 ⇒ not-evaluated');
  assert.notEqual(v, 'covered', '读不懂绝不回落 covered');
});

// ── ④ 解析器 fail-closed（纯函数，AC-222 负控制 b 的核心）──────────────────────

test('parseSemanticSufficiencyVerdict: 只认明确 covered/insufficient，其余全 not-evaluated（fail-closed）', () => {
  // 明确 covered / insufficient 才认（含纯 token 与 JSON 两态）。
  assert.equal(parseSemanticSufficiencyVerdict('covered', 0), 'covered', '纯 token covered ⇒ covered');
  assert.equal(parseSemanticSufficiencyVerdict('insufficient', 0), 'insufficient', '纯 token insufficient ⇒ insufficient');
  assert.equal(parseSemanticSufficiencyVerdict('{"verdict":"covered"}', 0), 'covered', 'JSON covered ⇒ covered');
  assert.equal(parseSemanticSufficiencyVerdict('{"verdict":"insufficient"}', 0), 'insufficient', 'JSON insufficient ⇒ insufficient');
  // 多行输出带解释性前文 + 末行 JSON ⇒ 从末行向上解析出结论。
  assert.equal(parseSemanticSufficiencyVerdict('解释性前文…\n{"verdict":"covered"}', 0), 'covered', '末行 JSON covered ⇒ covered');
  // ⛔ fail-closed：非零退出 / 空 / 读不懂 / 无 verdict 键 ⇒ not-evaluated（绝不回落 covered）。
  assert.equal(parseSemanticSufficiencyVerdict('{"verdict":"covered"}', 1), 'not-evaluated', '非零退出 ⇒ not-evaluated');
  assert.equal(parseSemanticSufficiencyVerdict('', 0), 'not-evaluated', '空输出 ⇒ not-evaluated');
  assert.equal(parseSemanticSufficiencyVerdict('随便一句散文', 0), 'not-evaluated', '散文 ⇒ not-evaluated');
  assert.equal(parseSemanticSufficiencyVerdict('{"foo":"bar"}', 0), 'not-evaluated', '无 verdict 键 ⇒ not-evaluated');
  assert.equal(parseSemanticSufficiencyVerdict('{"verdict":"coveredx"}', 0), 'not-evaluated', 'verdict 非法值 ⇒ not-evaluated');
});

// ── prompt 承载真实事实（DoD 反例判据：关掉 seam 后测的不是死代码）──────────────

test('buildSufficiencyPrompt: 内嵌 GOAL 退出条件文本 + 在域 AC（id/title/expect），⛔ 非硬编码 covered', () => {
  const goal = { id: 'GOAL-001', title: '目标标题', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件甲\n2. 条件乙\n' };
  const acs = [{ id: 'AC-001', title: 'ac 一', expect: '覆盖条件甲' }, { id: 'AC-002', title: 'ac 二', expect: '覆盖条件乙' }];
  const p = buildSufficiencyPrompt(goal, acs, '/repo');
  assert.ok(p.includes('条件甲') && p.includes('条件乙'), 'prompt 内嵌退出条件文本（真实输入，非死代码）');
  assert.ok(p.includes('AC-001') && p.includes('AC-002'), 'prompt 内嵌在域 AC id');
  assert.ok(p.includes('ac 一') && p.includes('覆盖条件甲'), 'prompt 内嵌 AC title/expect');
  assert.ok(p.includes('GOAL-001') && p.includes('目标标题'), 'prompt 内嵌 goal id/title');
});
