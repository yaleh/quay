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
  resetSufficiencyCacheForTest,
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

// ── gap-sufficiency-prompt-blind-to-scope-section-relies-on-title-alone ──────────────────────────
// 充分性判官的第一层 prompt 原先只喂 title + `## 退出条件` + 在域 AC，⛔ **看不到 goal body 的 `## 范围`
// 节**。而退出条件刻意写成**不写死数字**的结构性自指句式（「本目标名下未被 superseded 的全部 criterion
// 状态为 achieved」）——它对任意数量的在域 AC 都同样成立，本身不携带「这个目标应该有几块」的信息；
// 那个信息实际写在范围节。⇒ 判官能否识别「当前只有 1 条 AC，还不够」完全依赖**标题是否恰好写得够详细**。
//
// 下面覆盖 AC1/AC2/AC3（AC4 在 goal-sufficiency-determinism.test.mjs，那里 import 了 sufficiencyCacheKey）。

const SCOPE_EXIT = '## 退出条件\n\n本目标名下、未被 superseded 的全部 criterion 状态为 achieved，不写死数字。\n';
/** 三个子项的范围节（quay-fleet GOAL-003 body 的真实形态，标题无后缀）。 */
const SCOPE_THREE = '## 范围\n\n1. PWA 壳静态服务\n2. SSE 驱动实时列表\n3. Web Push 订阅机制\n';
/** 三个范围关键词（假判官按它们在【整个 prompt】里是否可见判）。 */
const SCOPE_KEYWORDS = ['PWA 壳静态服务', 'SSE 驱动实时列表', 'Web Push 订阅机制'];

test('AC1: buildSufficiencyPrompt 必须内嵌 `## 范围` 节原文；删掉范围节后两次 prompt 必须不同', () => {
  const acs = [{ id: 'AC-016', title: '推送订阅', expect: '三块都要' }];
  const withScope = buildSufficiencyPrompt(
    { id: 'GOAL-003', title: 'PWA 与推送', body: '## 命题\np\n\n' + SCOPE_THREE + SCOPE_EXIT },
    acs, '/repo',
  );
  const withoutScope = buildSufficiencyPrompt(
    { id: 'GOAL-003', title: 'PWA 与推送', body: '## 命题\np\n\n' + SCOPE_EXIT },
    acs, '/repo',
  );
  assert.ok(
    SCOPE_KEYWORDS.every((k) => withScope.includes(k)),
    '范围节三个子项逐字进 prompt（读了且带着用——⛔ 不是「读了没用」）',
  );
  assert.notEqual(
    withScope, withoutScope,
    '范围节存在与否**必须**改变 prompt 内容（能取假：把 scopeSections 从 buildSufficiencyPrompt 里摘掉 ⇒ 本条红）',
  );
});

test('AC1(生产形态): 带后缀的范围节标题（`## 范围（docs/design/… §7 阶段2）` / `## 范围与非目标`）也必须被读到', () => {
  const acs = [{ id: 'AC-001', title: 'a', expect: 'e' }];
  // quay-fleet GOAL-002/GOAL-003 的真实标题形态——逐字正则在这一版上**结构上读不到**这一节，
  // 只按前缀匹配才读得到（同 task-status-drift-check 的 `## Acceptance Criteria (runnable — …)` 实例）。
  const suffixed = buildSufficiencyPrompt(
    { id: 'GOAL-002', title: '跨机聚合', body: '## 命题\np\n\n## 范围（docs/design/quay-fleet-design.md §2/§3.1/§7 阶段2）\n\n1. 全局 sessionKey\n2. 多机视图归并\n3. 本机 tailscale 身份只读\n\n' + SCOPE_EXIT },
    acs, '/repo',
  );
  assert.ok(
    suffixed.includes('3. 本机 tailscale 身份只读'),
    '带后缀标题的范围节内容进 prompt（⛔ 只逐字匹配 `## 范围` 会在生产形态上恒不命中——判据空转）',
  );
  assert.ok(suffixed.includes('范围（docs/design/quay-fleet-design.md §2/§3.1/§7 阶段2）'), '标题逐字保留（判官要看到限定语）');
  assert.ok(!suffixed.includes('命题正文'), '范围节的界在下一个 `## ` 标题处——不吞并后续节');
  // 本仓的实际形态。
  const andNonGoals = buildSufficiencyPrompt(
    { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 范围与非目标\n\n- 做的：A\n- 不做的：B\n\n' + SCOPE_EXIT },
    acs, '/repo',
  );
  assert.ok(andNonGoals.includes('- 不做的：B'), '`## 范围与非目标` 同样被读到');
});

test('AC2: 双向对照——假判官按「prompt 里能否看到范围关键词」判 ⇒ 范围节确实在影响判定（不是摆设）', async () => {
  resetSufficiencyCacheForTest();
  // 假判官：读【整个 prompt】（缝把 prompt 作末参数追加），三个范围关键词全可见 ⇒ covered，否则 insufficient。
  // ⛔ 它给出的是「范围节是不是判官真正看得见的东西」的**直接读数**——若 buildSufficiencyPrompt 不含范围节，
  // ①（带范围节）也会判 insufficient ⇒ 下面的 notEqual 必红。
  const judge = [
    'node', '-e',
    'const p = process.argv[1] || "";' +
    `const k = ${JSON.stringify(SCOPE_KEYWORDS)};` +
    'process.stdout.write(JSON.stringify({ verdict: k.every((x) => p.includes(x)) ? "covered" : "insufficient" }));',
  ];
  const acs = [{ id: 'AC-016', title: '推送订阅', expect: '三块都要' }];
  const withScope = { id: 'GOAL-003', title: 'PWA 与推送', body: '## 命题\np\n\n' + SCOPE_THREE + SCOPE_EXIT };
  const noScope = { id: 'GOAL-003', title: 'PWA 与推送', body: '## 命题\np\n\n' + SCOPE_EXIT };
  // ③ 负控制：无范围节，但把**同样的关键词**手工塞进标题 ⇒ 关键词仍可见 ⇒ covered。
  //    它证明假判官的关键词判据不是恒假（否则 ①≠② 的差可能只是「这个判官永远说不覆盖」），
  //    因而 ①≠② 的差只能归因于 **prompt 里范围节的有无**。
  const titleStuffed = { ...noScope, title: 'PWA 与推送：' + SCOPE_KEYWORDS.join('、') };

  const vWith = await semanticSufficiencyVerdict(withScope, acs, repoRoot, { sufficiencyCmd: judge });
  const vWithout = await semanticSufficiencyVerdict(noScope, acs, repoRoot, { sufficiencyCmd: judge });
  const vStuffed = await semanticSufficiencyVerdict(titleStuffed, acs, repoRoot, { sufficiencyCmd: judge });

  assert.equal(vWith, 'covered', '① 带范围节 ⇒ 判官看得见三块 ⇒ covered');
  assert.equal(vWithout, 'insufficient', '② 删掉范围节（标题/退出条件逐字不变）⇒ 判官看不见 ⇒ insufficient');
  assert.notEqual(vWith, vWithout, '范围节的有无必须改变判官输出（⛔ 范围节不是摆设）');
  assert.equal(vStuffed, 'covered', '③ 负控制：无范围节但标题含同样关键词 ⇒ covered（假判官判据非恒假）');
});

test('AC3: 无 `## 范围` 节的旧格式 body ⇒ 不抛异常，prompt 仍含标题与退出条件文本', () => {
  const acs = [{ id: 'AC-001', title: 'a', expect: 'e' }];
  const legacy = { id: 'GOAL-001', title: '旧格式目标', body: '## 背景\nbg\n\n' + SCOPE_EXIT };
  let p = '';
  assert.doesNotThrow(() => { p = buildSufficiencyPrompt(legacy, acs, '/repo'); }, '缺该节不得抛异常');
  assert.ok(p.includes('goal_title=旧格式目标'), 'prompt 仍含标题');
  assert.ok(p.includes('不写死数字'), 'prompt 仍含退出条件文本');
  assert.ok(
    p.includes('NOT WRITTEN DOWN'),
    '「没写范围节」被显式说出（Plan 第2条：⛔ 不静默当成「没有范围限制」——缺席与「已声明无限制」不同形）',
  );
  // 极端旧格式：连 `## 退出条件` 都没有（机械层判 insufficient 的那一形态）⇒ 同样不得抛。
  assert.doesNotThrow(() => { buildSufficiencyPrompt({ id: 'GOAL-005', title: 'x', body: '## 背景\nbg\n' }, acs, '/repo'); });
  assert.doesNotThrow(() => { buildSufficiencyPrompt({ id: 'GOAL-005', title: 'x' }, acs, '/repo'); }, 'body 整个缺失也不得抛');
});

