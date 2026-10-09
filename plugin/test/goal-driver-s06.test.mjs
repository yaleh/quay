// @test-group serial
// goal-driver.test.mjs — G6 (tasks/gap-goal-driver-mechanical-ring): goal 机械环的判定面单测。
//
// 覆盖四件事：①I2 的纯推导（goalAchievedFromRecords）；②真实机械环端到端（跑真的 goal-store CLI，
// 非 fixture 注入 seam——载体有 verdict、evidence 不回写、I2 flip、draft 不动、无 tasks 写）；
// ③cli/driver.ts 的 KINDS 与 kernel DRIVER_KINDS 集合一致（AC6）；
// ④CLI 冒烟（--help / 未知参数）。
//
// Run: node --test plugin/test/goal-driver.test.mjs

// SPLIT from goal-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/6 (15 tests). Shared fixtures: ./helpers/goal-driver-harness.mjs (single source).
// FURTHER SPLIT by gap-suite-split-15-over-30s-test-files — the ⑨ ciRuns section moved to goal-driver-s08.test.mjs (shard 8) and the ⑥c goal-gaps section moved to goal-driver-s09.test.mjs (shard 9); the remaining 7 tests stay here.

import { test } from "node:test";
import { assert, computeGoalGaps, derivedByAc, derivedCriterionRecords, evRecord, fs, goalCliResolvable, goalStoreArgv, isFilingGapState, judgeCmd, os, parseFrozenFailingReading, path, readsFrozenPopulation, repoRoot, resetObjectiveTestState, runGapSpawnPass, runGoalRound, writeEvidenceCarrier, writeGoalFile } from "./helpers/goal-driver-harness.mjs";

test('DoD: runGoalRound 同时产出两层 fact（goal-sufficiency 与 goal-objective 并列，⛔ 互不含对方的键）', async () => {
  resetObjectiveTestState();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-objective-round-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    writeGoalFile(tmp, {
      id: 'GOAL-001', status: 'active', kind: 'goal',
      body: '## 背景\nbg\n\n## 退出条件\n\n1. 条件一\n',
    });
    writeGoalFile(tmp, { id: 'AC-001', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeGoalFile(tmp, { id: 'AC-002', status: 'achieved', kind: 'criterion', goal: 'GOAL-001', criterion: 'true' });
    writeEvidenceCarrier(tmp, [evRecord('GOAL-001-AC-001'), evRecord('GOAL-001-AC-002')]);

    const { sufficiencyFacts, objectiveFacts } = await runGoalRound(tmp, {
      scriptRoot: repoRoot,
      gapWorkerCmd: 'true',
      resourceGateArgv: ['true'],
      sufficiencyCmd: judgeCmd({ verdict: 'covered' }),
      objectiveCmd: judgeCmd({ verdict: 'unsubstantiated', field: 'project_root', value: '/p/one' }),
    });

    assert.equal(sufficiencyFacts.length, 1, '一条 active GOAL ⇒ 一条 sufficiency fact');
    assert.equal(objectiveFacts.length, 1, '一条 active GOAL ⇒ 一条 objective fact');
    assert.equal(sufficiencyFacts[0].name, 'goal-sufficiency');
    assert.equal(objectiveFacts[0].name, 'goal-objective');

    // 第一层：原形不变（AC-212 判据读的正是 value.sufficiency）。
    const s = sufficiencyFacts[0].value.sufficiency;
    assert.equal(s.verdict, 'covered', '第一层结论不被新层改变（同输入 ⇒ 仍 covered）');

    // 第二层：独立取值 + 指认 + 证据概况。
    const o = objectiveFacts[0].value.objective;
    assert.equal(o.goal, 'GOAL-001');
    assert.equal(o.verdict, 'unsubstantiated');
    assert.equal(o.assertion.field, 'project_root');
    assert.equal(o.profile.records, 2);
    assert.deepEqual(o.profile.distinctProjectRoots, ['/p/one']);

    // ⛔ 不合并：两条 fact 各带自己的键，互不冒充对方。
    assert.equal(o.sufficiency, undefined, 'objective fact ⛔ 不含 sufficiency 键');
    assert.equal(s.objective, undefined, 'sufficiency fact ⛔ 不含 objective 键');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 派生判据：② 不得对【真值派生自 ③ 主体population】的常设判据独立立案 ──────────────────────────
// gap-ac242-derived-criterion-double-judged-and-amendment-unguarded 缺陷①。
//
// 同一条真相——「冻结population 中有一条 AC 此刻为假」——被**两个判官**判成两个主体、两个结论：
//   ③ 冻结population 分支：主体 = **那条为假的 AC**（AC-203），态 = frozen-violated / in-progress
//      ⇒ 正确路由（有 owner 就不重复立案）；
//   ② AC-216 常设不变式分支：主体 = **AC-242**（它自己的 criterion 读的正是 ③ 的输入面），
//      态 = standing-violated（没有任何在飞任务持 `goal_ac: AC-242`）⇒ 为 AC-242 立案。
// 而 AC-242 的复绿条件**不在它自己的域内**：它的 expect 逐字要求「冻结population 中不存在此刻为假的
// AC」，当前为假的那条是 AC-203 ⇒ 任何 AC-242 域内的改动都不能使它转绿；唯一出口是把 AC-203 变真，
// 而那是 AC-203 的域、且已有 owner 在飞。⇒ ② 为它立的每一条任务，其 DoD 都结构上只能由【另一条 AC
// 的 owner】关闭 —— 每轮一条、永远关不掉。
//
// 修法：② 对**真值派生自 ③ 主体population** 的判据（criterion 读 ③ 的输入面 `check --stale-pass`）
// 让位给 ③ —— ③ 是那个命题的唯一判据、且已在本轮为那条为假的 AC 产出了路由。判据 AC-242 本身**不动**
// （它保持诚实）；让位只发生在 ③ 本轮**确实判了 violated**（派生条件成立）时，读不到 / 未评估 ⇒ 照旧
// 立案（⛔ 闸不恒开，见下面的负控制 c）。

/** 一份最小的 ②/③ 夹具：GOAL-900 已关闭（achieved ⇒ 非 active）。三条 achieved AC：
 *  AC-203 未声明 long-term ⇒ **冻结population**（③ 的主体）；AC-242 声明 long-term 且 criterion 读
 *  `check --stale-pass` ⇒ ② 的**派生判据**；AC-214 声明 long-term 而 criterion 与 ③ 无关 ⇒ ② 的
 *  **普通常设判据**（用来证明让位不是「所有常设判据都不再立案」）。 */



test('派生判据 (a)：无 owner ⇒ ③ 产 frozen-violated，② ⛔ 不产 goal_ac: AC-242 立案', () => {
  const records = derivedCriterionRecords();
  // I5 的读数：AC-242 的判据此刻为假（冻结population 里有一条为假），AC-214 不受影响。
  const standings = { achievedButFailing: ['AC-242'], evaluated: true };
  // ③ 的读数：那条冻结 AC 此刻为假。
  const frozen = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  assert.equal(frozen.judgment, 'violated');
  const gaps = computeGoalGaps(records, [], null, standings, frozen);
  const by = derivedByAc(gaps);

  assert.equal(by.get('AC-203').state, 'frozen-violated', '③ 的主体仍被立案（让位⛔ 不波及 ③ 自己）');
  assert.ok(isFilingGapState(by.get('AC-203').state), 'frozen-violated 在 spawn 选取面内');
  assert.equal(by.get('AC-242').state, 'derived-routed', '② 让位：红归 ③ 的主体 AC，不归这条元判据');
  assert.equal(isFilingGapState(by.get('AC-242').state), false, '⛔ derived-routed 不消耗 spawn 名额');
  assert.notEqual(by.get('AC-242').state, 'standing-ok', '⛔ 不是 standing-ok：它此刻确实为假（说它成立即假绿）');
  assert.notEqual(by.get('AC-242').state, 'not-evaluated', '⛔ 不是 not-evaluated：读数在、违反也在，只是成因已由另一个判官接管');
  assert.equal(by.get('AC-242').taskCount, null, '⛔ 与 0 不同形：本态回答的不是「有几条任务是它的」');
  assert.equal(by.get('AC-214').state, 'standing-ok', '对照组：非派生的常设判据此刻成立 ⇒ 仍走原判定');

  // 端到端：spawn 选取面只挑 AC-203 一条。
  const r = runGapSpawnPass(gaps, records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-203'], '只有 ③ 的主体 AC 消耗名额（AC-242 不再每轮一条）');
});


test('派生判据 (b)：有 owner（现状）⇒ ③ 产 in-progress，② 同样⛔ 不产立案', () => {
  const records = derivedCriterionRecords();
  const standings = { achievedButFailing: ['AC-242'], evaluated: true };
  const frozen = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  // 一条在飞任务持 goal_ac: AC-203（这正是生产上 gap-ac203-two-distinct-kinds-no-production-run 的形态）。
  const tasks = [{ id: 'gap-ac203-owner', status: 'ready', goalAc: 'AC-203' }];
  const gaps = computeGoalGaps(records, tasks, null, standings, frozen);
  const by = derivedByAc(gaps);

  assert.equal(by.get('AC-203').state, 'in-progress', '③ 认得 owner ⇒ 不再重复立案');
  assert.equal(by.get('AC-242').state, 'derived-routed', '② 仍让位（有主更要让位）');
  assert.equal(isFilingGapState(by.get('AC-242').state), false);
  const r = runGapSpawnPass(gaps, records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r.outcomes, [], '两条都不该消耗名额');
});


test('派生判据 (c) 负控制：闸不恒开 —— ③ 说不了话时仍立案；非派生的违反也仍立案', () => {
  const records = derivedCriterionRecords();

  // (c1) ③ 未评估（台账读不到 / 轮转从未跑过）⇒ 派生条件不成立 ⇒ 回落 standing-violated（成因不明
  //      时仍要有人看，硬规则 6：缺值 = 未查 ≠ 为假）。
  const standings0 = { achievedButFailing: ['AC-242'], evaluated: true };
  const notEval = parseFrozenFailingReading('not json at all', null);
  assert.equal(notEval.judgment, 'not-evaluated');
  const g1 = derivedByAc(computeGoalGaps(records, [], null, standings0, notEval));
  assert.equal(g1.get('AC-242').state, 'standing-violated', '③ 说不了话 ⇒ ⛔ 不静默放行，照旧立案');
  assert.ok(isFilingGapState(g1.get('AC-242').state));
  // 对照：③ 读到了但【判 clean】（无违反）⇒ 同样不满足派生条件（派生量按定义为假，二者矛盾）⇒ 仍立案。
  const clean = parseFrozenFailingReading(JSON.stringify({ failing: [], frozenScope: 1 }), 0);
  const g2 = derivedByAc(computeGoalGaps(records, [], null, standings0, clean));
  assert.equal(g2.get('AC-242').state, 'standing-violated', '③ 判 clean ⇒ 派生条件不成立 ⇒ 仍立案（⛔ 不静默吞掉一条红）');

  // (c2) 非派生的常设判据此刻违反 ⇒ ② **仍**立案（证明让位是逐条的，不是「常设判据一律不立」）。
  const standings214 = { achievedButFailing: ['AC-214'], evaluated: true };
  const g3 = derivedByAc(computeGoalGaps(records, [], null, standings214, clean));
  assert.equal(g3.get('AC-214').state, 'standing-violated', '普通常设判据的违反照旧立案');
  assert.ok(isFilingGapState(g3.get('AC-214').state));
  const r3 = runGapSpawnPass(computeGoalGaps(records, [], null, standings214, clean), records, os.tmpdir(), { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r3.outcomes.map((o) => o.ac), ['AC-214'], '让位没有把整个 ② 分支关掉（闸不恒开）');

  // (c3) ③ 的违反对象无主 ⇒ 立案**仍然发生**（只是发生在 ③ 的主体 AC 上）。
  const violated = parseFrozenFailingReading(JSON.stringify({ failing: ['AC-203'], frozenScope: 1 }), 1);
  const g4 = computeGoalGaps(records, [], null, standings0, violated);
  assert.ok(g4.some((g) => isFilingGapState(g.state)), '让位后仍有一条可立案的读数（③ 的主体 AC）');
});

// ── AC5：goal 动词 argv 的形态（gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache）──
//
// 缺陷原样：goalStoreArgv 曾把 `<codeRoot>/packages/quay/src/goal-store.ts` 当【子进程入口】返回。
// 那个文件在出厂布局（plugin marketplace cache / npm-pack / 第三方 vendored 副本）里【不存在】：
// goal-store 的【库】已被 coreSrcAliasPlugin 内联进 scripts/dist/goal-driver.js，而它的 CLI 入口不可达
// （`isMain` 判 `process.argv[1].endsWith("goal-store.ts")`，bundle 里恒 false）。⇒ 每轮 spawn 一个
// 不存在的文件，读数全线落 unreadable，而进程 alive=1、载体仍在写（静默失效）。

test('AC5: goal 动词 argv 不含 packages/quay/src（源码树入口已消失），且非空转', () => {
  const dataRoot = '/tmp/ac262-data-root';
  const argv = goalStoreArgv(repoRoot, ['gate', 'AC-001'], dataRoot);
  const line = argv.join(' ');

  // ① 判据本体。⛔ 负控制：把 argv 构造改回旧形（spawn packages/quay/src/goal-store.ts）⇒ 本行必红。
  assert.doesNotMatch(line, /packages\/quay\/src/, `argv 仍指向源码树：${line}`);
  // ② 空转防线（硬规则 3b）：一个空 argv、或一个缺动词的 argv，同样「不含 packages/quay/src」——
  //    不钉住形态，本条就与「什么也没验」同形。故逐项断言它是一条真命令。
  assert.ok(argv.length >= 5, `argv 太短，没构造出真命令：${line}`);
  assert.ok(argv.includes('goal'), `argv 缺 goal 动词：${line}`);
  assert.ok(argv.includes('gate') && argv.includes('AC-001'), `argv 缺子命令/位置参数：${line}`);
  assert.ok(argv.includes('--store'), `argv 缺 --store（driver 跑的是无 config 的裸 root，见 cli/goal.ts）：${line}`);
  assert.ok(argv.includes('--root') && argv.includes(dataRoot), `argv 缺 --root <dataRoot>：${line}`);
  // ③ 入口必须真的【存在】：一个不存在的路径在负控制里也「不含 packages/quay/src」，却跑不动。
  //    ⚠️ 入口段按【前缀】定位（它解析不出时叫 `quay-cli-unresolved`、没有扩展名 —— 用 `.ts/.js`
  //    后缀找会在负控制上恒找不着，把判据写成恒假）。
  const entry = argv.find((a) => a.startsWith(repoRoot));
  assert.ok(entry && fs.existsSync(entry), `argv 的 quay CLI 入口不存在：${entry}`);
});


test('AC5 负控制（契约另一半）: 解析不出的代码根 ⇒ 一个【不存在】的路径，⛔ 不抛、不回退 PATH 上的 quay', () => {
  const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'ac262-no-quay-cli-'));
  try {
    // 前置：夹具根【存在】但是没有 quay CLI —— 这样 ENOENT 归因于「解析不出」，而不是「根本身不存在」。
    assert.equal(fs.existsSync(bogus), true, '前置：夹具根必须存在');
    assert.equal(fs.existsSync(path.join(bogus, 'packages', 'quay', 'bin', 'quay.ts')), false, '前置：夹具里没有源码 CLI');
    const argv = goalStoreArgv(bogus, ['check', '--staleness'], '/tmp/ac262-data-root');
    // 入口段 = 以该代码根开头的那个 argv 元素（解析不出时它是 `<bogus>/quay-cli-unresolved`）。
    const entry = argv.find((a) => a.startsWith(bogus));
    assert.ok(entry, `argv 缺入口段：${argv.join(' ')}`);
    assert.equal(fs.existsSync(entry), false, `解析不出时必须给出不存在的路径（调用方按 unreadable 处理）：${entry}`);
    assert.doesNotMatch(argv.join(' '), /packages\/quay\/src/, '⛔ 解析不出也不得回落到源码树形');
    // 端到端半边：真跑一次 —— 它必须是「解析不出 ⇒ 读不懂」，而⛔ 不是「跑通了、零条」。
    assert.equal(goalCliResolvable(bogus), false, '解析判据本身必须能取假');
  } finally {
    fs.rmSync(bogus, { recursive: true, force: true });
  }
});

// ── AC3（源文本硬检查；gap-goal032-verdict-parse-direct-import-regresses-ac262）──
//
// 上面那条 AC5 pin 钉的是 goalStoreArgv 造出的 **argv 形态**；它对 goal-driver 顶部的一行 **静态
// import** 结构上取不到假。GOAL-032 正是这样回归的：`import { parseBinaryVerdict } from
// "../../packages/quay/src/kernel/verdict-parse.ts"` 加进去后 argv 一点没变（那条 pin 仍绿），而
// goals/AC-262 判据第二支翻假（实测命中 2 处：import 说明符 + JSDoc 散文）。⇒ 按源文本补一条硬检查，
// 谓词与 AC-262 criterion 第二支**逐字相同**：只剥 `//` 行注释，块注释散文存活（则上面两处都算命中）。
const CORE_SRC_RE = /"packages"\s*,\s*"quay"\s*,\s*"src"/;
function coreSrcHitsIn(text) {
  const hits = [];
  text.split('\n').forEach((ln, i) => {
    const code = ln.split('//', 1)[0];
    if (CORE_SRC_RE.test(code) || code.includes('packages/quay/src')) hits.push(`${i + 1}: ${code.trim().slice(0, 90)}`);
  });
  return hits;
}

test('AC3: goal/meta driver 剥掉 `//` 行注释后不含 packages/quay/src（与 AC-262 判据第二支同谓词）', () => {
  // 空转防线（硬规则 3b；规则 2 的**零计数半边**）：先证明谓词对【已知为真】的样本命中，否则
  // 「0 命中」与「文件读成空串」同形。基线样本 = GOAL-032 加的那行直连 import。
  const knownTrue = 'import { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";';
  assert.equal(coreSrcHitsIn(knownTrue).length, 1, '自检：谓词对已知为真的样本必须命中（否则本判据空转）');
  const hits = [];
  for (const rel of ['plugin/scripts/goal-driver.ts', 'plugin/scripts/meta-driver.ts']) {
    const abs = path.join(repoRoot, rel);
    assert.equal(fs.existsSync(abs), true, `前置：${rel} 必须存在（文件不在而读成空串也是 0 命中）`);
    const text = fs.readFileSync(abs, 'utf8');
    assert.ok(text.length > 0, `前置：${rel} 必须非空`);
    for (const h of coreSrcHitsIn(text)) hits.push(`${rel} ${h}`);
  }
  assert.equal(hits.length, 0, `driver 复写了 Core 源码树布局字面量（前 3 条实际命中）：${hits.slice(0, 3).join(' | ')}`);
});


test('派生判据的识别式：按【位置】（判据里成词出现）判定，⛔ 不按子串/散文提及', () => {
  assert.equal(readsFrozenPopulation('node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass'), true);
  assert.equal(readsFrozenPopulation('quay goal check --stale-pass --sweep'), true);
  assert.equal(readsFrozenPopulation('exit 0'), false);
  assert.equal(readsFrozenPopulation(''), false);
  assert.equal(readsFrozenPopulation(null), false);
  // ⛔ 子串不算（成词判定）：`--stale-pass-notes` 不是那个旗标。
  assert.equal(readsFrozenPopulation('echo --stale-pass-notes'), false);
  // 双向控制：与 ③ 无关的常设判据（AC-214 形态：读交付面载体）不得被误判。
  assert.equal(readsFrozenPopulation('python3 - <<\'P\'\nimport json\nP'), false);
});



// ── gap-done-unresolved-conflates-workable-with-world-gated：①（active AC）这一 population 的
//    「曾经 done 不覆盖回归」守卫（standing/frozen 早已有）现在按判据载体分叉：workable 立案、
//    world-gated 走复读路由。本用例在状态侧 shard 里逐条枚举**全词表的立案面**，钉住分叉。

test('AC3 全词表立案面：workable 与 gap/standing-violated/frozen-violated 同列立案；world-gated/unclassified ⛔ 不立案', () => {
  // ① 三条 active AC，关联任务全部 done，只分歧在判据载体。
  const records = [
    { id: 'GOAL-001', title: 'g', status: 'active' },
    { id: 'AC-W', goal: 'GOAL-001', status: 'active', criterion: 'test -f src/x.ts' },
    { id: 'AC-G', goal: 'GOAL-001', status: 'active', criterion: 'cat .quay/ci-runs.jsonl' },
    { id: 'AC-U', goal: 'GOAL-001', status: 'active' },
  ];
  const tasks = [
    { id: 't-w', status: 'done', goalAc: 'AC-W' },
    { id: 't-g', status: 'done', goalAc: 'AC-G' },
    { id: 't-u', status: 'done', goalAc: 'AC-U' },
  ];
  const by = derivedByAc(computeGoalGaps(records, tasks));
  assert.equal(by.get('AC-W').state, 'workable');
  assert.equal(by.get('AC-G').state, 'world-gated');
  assert.equal(by.get('AC-U').state, 'unclassified');
  assert.notEqual(by.get('AC-W').state, by.get('AC-G').state, 'workable ≠ world-gated（硬规则 3b）');
  assert.notEqual(by.get('AC-G').state, by.get('AC-U').state, 'world-gated ≠ unclassified（硬规则 3b）');
  assert.notEqual(by.get('AC-W').state, by.get('AC-U').state, 'workable ≠ unclassified（硬规则 3b）');
  // runGapSpawnPass 选取面 = 只有 workable 一条（⛔ world-gated/unclassified 空耗名额）。
  const r = runGapSpawnPass(computeGoalGaps(records, tasks), records, os.tmpdir(),
    { gapWorkerCmd: 'true', resourceGateArgv: ['true'], spawnCap: 5 });
  assert.deepEqual(r.outcomes.map((o) => o.ac), ['AC-W']);
  // 与另外两个 population 对照：standing-violated / frozen-violated 同样立案（四态同列，workable ⛔ 不独占）。
  assert.deepEqual(
    ['gap', 'workable', 'world-gated', 'unclassified', 'standing-violated', 'frozen-violated', 'stalled', 'not-evaluated', 'standing-ok', 'derived-routed', 'in-progress']
      .filter((s) => isFilingGapState(s)).sort(),
    ['frozen-violated', 'gap', 'standing-violated', 'workable'],
    '立案面恰为四态（⛔ 不多不少——world-gated/unclassified 被有意排除）');
});
