// @test-group engine
// goal-sufficiency-determinism.test.mjs — gap-sufficiency-verdict-nondeterministic-on-identical-input:
// 充分性裁决对同一输入必须确定——同一输入跨轮/跨调用给出同一裁决（goalAchieved 不再随轮次抽签）。
// 覆盖四个方向（AC7 点名 AC2/AC3/AC4/AC5）：
//  AC2 正向确定性：同一固定输入连续调用 5 次，5 次裁决完全相同；首次判定 2 次采样、其余 4 次命中
//      缓存 ⇒ LLM 被调用 ≤2 次（⛔ 靠真实缓存路径，不 mock 掉 LLM）。
//  AC3 输入变化必重判：改任一在域 AC 的 expect 一个字符 ⇒ 哈希变 ⇒ 重新 spawn；还原 ⇒ 命中缓存不 spawn。
//  AC4 不得把判不出变合格（硬规则 3b）：缓存未命中 ∧ LLM 失败 ⇒ not-evaluated（⛔ 非 covered，⛔ 非
//      沿用别的输入的缓存值），goalFlipDecision 仍 false。
//  AC5 首次判定一致性守卫：两次不一致取样 ⇒ not-evaluated 且不入缓存；下一轮两次一致 ⇒ 入缓存。
//
// 另覆盖 gap-sufficiency-cache-in-memory-only-and-not-evaluated-cause-not-distinguishable 的 AC7：
//  AC2 跨重启存活：缓存落盘后「重启」（reset 内存 Map）同输入命中盘缓存不 spawn；清空盘缓存 ⇒ 重新 spawn。
//  AC3 三成因：samples-disagree / judge-unavailable / judge-unparseable 三个 cause 互不相同。
//  AC4 成因不改语义：三种成因下 verdict 仍 not-evaluated、goalAchieved 仍 false（⛔ 不借成因放行）。
//
// Run: node --test plugin/test/goal-sufficiency-determinism.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  semanticSufficiencyVerdict,
  semanticSufficiencyVerdictDetail,
  sufficiencyCacheKey,
  resetSufficiencyCacheForTest,
  sufficiencyCacheSnapshot,
  goalFlipDecision,
} from '../scripts/goal-driver.ts';

// 仓库根（脚本根 = goal-store.ts 所在；此处只作 prompt 的 `Repo root` 与 root 参数，测试全走
// sufficiencyCmd 缝，⛔ 不 spawn 真 LLM）。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 计数文件读值（LLM 被调用了几次）。读不到 ⇒ 0。 */
function readCounter(counterPath) {
  try { return parseInt(fs.readFileSync(counterPath, 'utf8'), 10) || 0; } catch { return 0; }
}

/** 有状态的 sufficiencyCmd 缝：每次调用递增计数文件，并按序返回 verdicts（超出后重复末项）。
 *  prompt 作末参数追加、被忽略。用 node -e 免 shell 引号剥层（同 goal-sufficiency-semantic-covered）。 */
function seqCmd(counterPath, verdicts) {
  const script = [
    'const fs = require("node:fs");',
    `const p = ${JSON.stringify(counterPath)};`,
    'let n = 0;',
    'try { n = parseInt(fs.readFileSync(p, "utf8"), 10) || 0; } catch {}',
    `const vs = ${JSON.stringify(verdicts)};`,
    'const v = vs[Math.min(n, vs.length - 1)];',
    'fs.writeFileSync(p, String(n + 1));',
    'process.stdout.write(JSON.stringify({ verdict: v }));',
  ].join('\n');
  return ['node', '-e', script];
}

// ── AC2 正向确定性：同一输入 5 次裁决相同，LLM 调用 ≤2 ────────────────────────

test('AC2: 同一固定输入连续 5 次裁决完全相同，LLM 调用 ≤2（首次判定 2 次采样 + 4 次命中缓存）', async () => {
  resetSufficiencyCacheForTest();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-suff-det-ac2-'));
  const counter = path.join(tmp, 'counter.txt');
  try {
    const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
    const acs = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];
    const cmd = seqCmd(counter, ['covered']);
    const verdicts = [];
    for (let i = 0; i < 5; i++) {
      verdicts.push(await semanticSufficiencyVerdict(goal, acs, repoRoot, { sufficiencyCmd: cmd }));
    }
    assert.deepEqual(verdicts, ['covered', 'covered', 'covered', 'covered', 'covered'], '5 次裁决完全相同');
    const calls = readCounter(counter);
    assert.ok(calls <= 2, `LLM 被调用 ${calls} 次（应 ≤2：首次判定 2 次采样，其余命中缓存）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 输入变化必重判（防缓存过期为假保证）─────────────────────────────────

test('AC3: 改 expect 一个字符 ⇒ 重 spawn；还原 ⇒ 命中原缓存不再 spawn', async () => {
  resetSufficiencyCacheForTest();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-suff-det-ac3-'));
  const counter = path.join(tmp, 'counter.txt');
  try {
    const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
    const acsA = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];
    const acsB = [{ id: 'AC-001', title: 't1', expect: '覆盖条件二' }]; // expect 变一个字符（一→二）
    const cmd = seqCmd(counter, ['covered']);

    const v1 = await semanticSufficiencyVerdict(goal, acsA, repoRoot, { sufficiencyCmd: cmd });
    const c1 = readCounter(counter);
    const v2 = await semanticSufficiencyVerdict(goal, acsB, repoRoot, { sufficiencyCmd: cmd });
    const c2 = readCounter(counter);
    const v3 = await semanticSufficiencyVerdict(goal, acsA, repoRoot, { sufficiencyCmd: cmd });
    const c3 = readCounter(counter);

    assert.equal(v1, 'covered', '原输入 ⇒ covered');
    assert.equal(v2, 'covered', '改 expect ⇒ 重新判定 covered');
    assert.equal(v3, 'covered', '还原 ⇒ covered');
    assert.ok(c2 > c1, `改动 expect 后应重新 spawn（c1=${c1}, c2=${c2}）`);
    assert.equal(c3, c2, `还原后应命中缓存不再 spawn（c2=${c2}, c3=${c3}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 不得把判不出变合格（硬规则 3b，能取假）──────────────────────────────

test('AC4: 缓存未命中 ∧ LLM 失败 ⇒ not-evaluated（⛔ 非 covered、⛔ 非沿用别的输入的缓存值）且 goal 不 flip', async () => {
  resetSufficiencyCacheForTest();
  const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
  const acsA = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];
  const acsB = [{ id: 'AC-001', title: 't1', expect: '另一组 expect' }];
  // 先让 acsA（不同输入）缓存成 covered——证明缓存按输入隔离。
  await semanticSufficiencyVerdict(goal, acsA, repoRoot, {
    sufficiencyCmd: ['node', '-e', 'process.stdout.write(JSON.stringify({verdict:"covered"}))'],
  });
  // acsB 缓存未命中 ∧ LLM 失败（spawn 不存在的二进制）⇒ not-evaluated，⛔ 不沿用 acsA 的 covered。
  const v = await semanticSufficiencyVerdict(goal, acsB, repoRoot, { sufficiencyCmd: ['/nonexistent/definitely-not-a-binary'] });
  assert.equal(v, 'not-evaluated', '缓存未命中 ∧ LLM 失败 ⇒ not-evaluated');
  assert.notEqual(v, 'covered', '⛔ 不得为 covered（判不出 ≠ 合格）');
  // goalAchieved 仍 false：AC 全 achieved 但 sufficiency=not-evaluated ⇒ 不 flip GOAL。
  const records = [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }];
  assert.equal(goalFlipDecision(records, 'GOAL-001', { verdict: v }), false, 'not-evaluated 不得触发 GOAL 达成');
});

// ── AC5 首次判定一致性守卫：不一致不入缓存，一致才入 ─────────────────────────

test('AC5: 两次不一致取样 ⇒ not-evaluated 且不入缓存；下一轮两次一致 ⇒ 入缓存', async () => {
  resetSufficiencyCacheForTest();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-suff-det-ac5-'));
  try {
    const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
    const acs = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];
    const key = sufficiencyCacheKey(goal, acs);

    // 轮 1：两次不一致（covered 然后 insufficient）。
    const counter1 = path.join(tmp, 'c1.txt');
    const v1 = await semanticSufficiencyVerdict(goal, acs, repoRoot, { sufficiencyCmd: seqCmd(counter1, ['covered', 'insufficient']) });
    assert.equal(v1, 'not-evaluated', '两次不一致 ⇒ not-evaluated');
    assert.equal(sufficiencyCacheSnapshot().has(key), false, '两次不一致 ⇒ 不入缓存');

    // 轮 2：两次一致（covered）⇒ 入缓存。
    const counter2 = path.join(tmp, 'c2.txt');
    const v2 = await semanticSufficiencyVerdict(goal, acs, repoRoot, { sufficiencyCmd: seqCmd(counter2, ['covered']) });
    assert.equal(v2, 'covered', '两次一致 ⇒ covered');
    assert.equal(sufficiencyCacheSnapshot().get(key)?.verdict, 'covered', '两次一致 ⇒ 入缓存');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 以下三条覆盖 gap-sufficiency-cache-in-memory-only-and-not-evaluated-cause-not-distinguishable ──
// （AC2 跨重启存活 / AC3 三成因 / AC4 成因不改语义——本条的任务 Touches 含本文件）

// ── AC2 缓存跨重启存活（直接量，能取假）─────────────────────────────────────

test('AC2(跨重启): 落盘缓存跨「重启」存活——同输入命中盘缓存不 spawn；清空盘缓存 ⇒ 重新 spawn', async () => {
  resetSufficiencyCacheForTest();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-suff-det-ac2-persist-'));
  try {
    const cacheDir = path.join(tmp, '.quay');
    const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
    const acs = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];

    // ① 首次判定（落盘）：2 次一致 ⇒ covered 入缓存并落盘。
    const c1 = path.join(tmp, 'c1.txt');
    const v1 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, {
      sufficiencyCmd: seqCmd(c1, ['covered']),
      sufficiencyCacheDir: cacheDir,
    });
    assert.equal(v1.verdict, 'covered', '首次判定 ⇒ covered');
    assert.equal(v1.cause, null, 'covered 无成因');
    assert.equal(readCounter(c1), 2, '首次判定 2 次采样');
    assert.ok(fs.existsSync(path.join(cacheDir, 'goal-sufficiency-cache.json')), '缓存已落盘');

    // ② 模拟「重启」：清内存 Map + 解绑目录（resetSufficiencyCacheForTest），下一轮同输入 ⇒ 从盘上命中不 spawn。
    resetSufficiencyCacheForTest();
    const c2 = path.join(tmp, 'c2.txt');
    const v2 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, {
      sufficiencyCmd: seqCmd(c2, ['covered']),
      sufficiencyCacheDir: cacheDir,
    });
    assert.equal(v2.verdict, 'covered', '重启后同输入 ⇒ covered（与重启前相同）');
    assert.equal(readCounter(c2), 0, '重启后命中盘缓存 ⇒ 未 spawn 判定器（LLM 调用计数 0）');

    // ③ 负控制：清空缓存载体后重启 ⇒ 重新 spawn。
    fs.rmSync(path.join(cacheDir, 'goal-sufficiency-cache.json'), { force: true });
    resetSufficiencyCacheForTest();
    const c3 = path.join(tmp, 'c3.txt');
    const v3 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, {
      sufficiencyCmd: seqCmd(c3, ['covered']),
      sufficiencyCacheDir: cacheDir,
    });
    assert.equal(v3.verdict, 'covered', '清空盘缓存后重新判定 ⇒ covered');
    assert.ok(readCounter(c3) > 0, `清空盘缓存后重启 ⇒ 重新 spawn（调用计数 ${readCounter(c3)} > 0）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 not-evaluated 成因可区分（三方向各一次，三 cause 互不相同）────────────

test('AC3(三成因): samples-disagree / judge-unavailable / judge-unparseable 三个 cause 互不相同且 verdict 均 not-evaluated', async () => {
  resetSufficiencyCacheForTest();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-suff-det-ac3-cause-'));
  try {
    const goal = { id: 'GOAL-001', title: 't', body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n' };
    const acs = [{ id: 'AC-001', title: 't1', expect: '覆盖条件一' }];

    // ① 两次取样不一致 ⇒ samples-disagree。
    const c1 = path.join(tmp, 'c1.txt');
    const d1 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, {
      sufficiencyCmd: seqCmd(c1, ['covered', 'insufficient']),
    });
    assert.equal(d1.verdict, 'not-evaluated', '两次不一致 ⇒ not-evaluated');
    assert.equal(d1.cause, 'samples-disagree', '成因 = samples-disagree');

    // ② 判定器不可用（空命令前缀）⇒ judge-unavailable。
    const d2 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, { sufficiencyCmd: [] });
    assert.equal(d2.verdict, 'not-evaluated', '空命令 ⇒ not-evaluated');
    assert.equal(d2.cause, 'judge-unavailable', '成因 = judge-unavailable');

    // ③ 输出不可解析（exit 0 散文）⇒ judge-unparseable。
    const d3 = await semanticSufficiencyVerdictDetail(goal, acs, repoRoot, {
      sufficiencyCmd: ['sh', '-c', 'echo 这不是 covered 也不是 insufficient 的散文'],
    });
    assert.equal(d3.verdict, 'not-evaluated', '读不懂 ⇒ not-evaluated');
    assert.equal(d3.cause, 'judge-unparseable', '成因 = judge-unparseable');

    const causes = [d1.cause, d2.cause, d3.cause];
    assert.equal(new Set(causes).size, 3, `三成因互不相同（${causes.join(' / ')}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 成因不改变判定语义（⛔ 不得借成因字段放行）───────────────────────────

test('AC4(成因不改语义): 三种成因下 verdict 均 not-evaluated，goalAchieved 仍 false', () => {
  const records = [{ id: 'AC-001', goal: 'GOAL-001', status: 'achieved' }];
  for (const cause of ['samples-disagree', 'judge-unavailable', 'judge-unparseable']) {
    assert.equal(
      goalFlipDecision(records, 'GOAL-001', { verdict: 'not-evaluated', cause }),
      false,
      `cause=${cause} 时 goalAchieved 仍 false（成因不影响 flip）`,
    );
  }
});

// ── gap-sufficiency-prompt-blind-to-scope-section-relies-on-title-alone AC4 ─────────────────────
// 缓存 key 必须覆盖 prompt 的**全部**语义输入——任一输入改了而 key 不变，缓存就会把旧输入下的裁决原样
// 回给新输入，判据空转且与「判过了」同形（硬规则 3b）。本任务新增的 `## 范围` 节与（原先漏掉的）title
// 都属于此类。

/** 通用句式退出条件（同一 body 里其余节保持逐字不变，只动被测的那一节）。 */
const KEY_EXIT = '## 退出条件\n\n本目标名下、未被 superseded 的全部 criterion 状态为 achieved，不写死数字。\n';
const KEY_ACS = [{ id: 'AC-001', title: 'a', expect: 'e' }];

test('AC4(范围节进 key): 其它输入逐字不变、只改 `## 范围` 节 ⇒ sufficiencyCacheKey 必须不同', () => {
  const base = { id: 'GOAL-003', title: 't', body: '## 命题\np\n\n## 范围\n\n1. 甲\n\n' + KEY_EXIT };
  const edited = { id: 'GOAL-003', title: 't', body: base.body.replace('1. 甲', '1. 甲\n2. 乙') };
  const removed = { id: 'GOAL-003', title: 't', body: '## 命题\np\n\n' + KEY_EXIT };

  assert.notEqual(
    sufficiencyCacheKey(base, KEY_ACS), sufficiencyCacheKey(edited, KEY_ACS),
    '只改范围节文本 ⇒ key 必变（否则范围节改了也不重判——判据空转）',
  );
  assert.notEqual(
    sufficiencyCacheKey(base, KEY_ACS), sufficiencyCacheKey(removed, KEY_ACS),
    '删掉范围节 ⇒ key 必变',
  );
  assert.equal(
    sufficiencyCacheKey(base, KEY_ACS), sufficiencyCacheKey({ ...base }, KEY_ACS),
    '同一输入 ⇒ 同一 key（确定性——不是「key 一直在变所以当然不同」）',
  );
  // 负控制：只改**无关节**（`## 命题`）⇒ key 不变（证明上面的差不是「改了 body 就变」这种粗糙实现）。
  assert.equal(
    sufficiencyCacheKey(base, KEY_ACS),
    sufficiencyCacheKey({ ...base, body: base.body.replace('## 命题\np', '## 命题\nq') }, KEY_ACS),
    '只改 prompt 读不到的节 ⇒ key 不变（排除「body 一动 key 就变」的虚假通过）',
  );
});

test('缓存 key 覆盖 title（prompt 的语义输入之一，原先漏掉——与本任务同源，同一函数同一纪律）', () => {
  const acs = KEY_ACS;
  const a = { id: 'GOAL-003', title: 'PWA 与推送', body: '## 命题\np\n\n' + KEY_EXIT };
  const b = { ...a, title: 'PWA 与推送：PWA 壳静态服务、SSE 驱动实时列表、Web Push 订阅机制' };
  assert.notEqual(
    sufficiencyCacheKey(a, acs), sufficiencyCacheKey(b, acs),
    '标题改了 ⇒ key 必变（标题是 prompt 的语义输入；原样复用旧裁决 = 「标题已写详细」却仍拿旧 insufficient）',
  );
});

