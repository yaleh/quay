// @test-group engine
// criterion-fidelity-historical-case.test.mjs — AC-230 (tasks/gap-criterion-fidelity-gate-activation-
// blind-to-vacuous-criteria) + gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests
// 缺陷 B 修法：AC-225 真实历史案例的判决由【真判定器】给出并 vendor 原始输出——⛔ 不再由测试自算
// verdict 喂回解析器（原 judgeByMechanism stub 即缺陷 B）。两个检查器形态逐字 vendor 成仓库内文件
// （plugin/test/fixtures/criterion-fidelity/），⛔ 不锚 commit SHA（硬规则 5b）。
//
// ⚠️ 实测（2026-09-10，deepseek-v4-pro-anthropic 经 launchArgv("fix-worker")）：真判定器对 pre/post
// 两个夹具【都判 faithful】（原始输出均为 {"verdict":"faithful"}）——⛔ 未复现「扩面前 vacuous」的预期。
// 这是【发现】：原 stub 自算的「扩面前 vacuous」并非真判定器的实际判决。本测试只钉「解析器对真判定器
// 原始输出」给出的 verdict 与真判定器记录一致，⛔ 不再自算（AC3 已按本条「与预期不符则降为发现」处理）。
//
// gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case：真判定器对 pre/post 都判 faithful
// ⇒ 判别力 = 0。修法 = 方向 B 机械前置筛（mechanicalFidelityVerdict，⛔ 不调 LLM，能取假）：
// pre（扫描面含 packages/ 而 RegExp 不引用 packages）⇒ vacuous；post（加了引用 packages 的 P4）⇒
// faithful。本测试新增机械半的判定钉死（含【独立构造】的空洞/保真负控制——⛔ 不认夹具本身/文件名/
// AC 编号），并把「真判定器读数」那两条从「失败读数的发现」保留为「诊断载体的解析一致性」。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/criterion-fidelity-historical-case.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFidelityVerdict,
  buildFidelityPrompt,
  criterionFidelityVerdict,
  mechanicalFidelityVerdict,
  scanSurfaceTopSegments,
  regexBodies,
  readMechanismFromCriterion,
} from '../../packages/quay/src/criterion-fidelity.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = path.join(repoRoot, 'plugin', 'test', 'fixtures', 'criterion-fidelity');

// AC-225 逐字的 criterion/expect（2026-09-10 07:00:55Z 被 I2 flip achieved 的那一条）。⛔ 逐字 vendor
// 进本测试，不读 goals/AC-225*.md、不锚 commit SHA——判据不得引用生命周期短于判据本身的对象。
const AC225_CRITERION = `test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json`;
const AC225_EXPECT = `\`kernel-sibling-resolution-check.ts\` 存在，且在本仓库当前树上跑 exit 0——即 KERNEL 域违例（把自己的 sibling 脚本锚在 target root / worktree / naive \`__dirname\` 而非经 \`resolveKernelSibling\`/\`resolveKernelPluginRoot\`）**枚举为 0 处**。立条时实测残量 **9 处** naive \`__dirname\` ⇒ 红。本条与 AC-224 构成双向：AC-224 证明该检查器会红（能取假），本条证明它此刻是绿（迁移已完成）。⛔ 完整性由检查器的机械枚举给出，不是手工清单——人工枚举已做过 3 次、3 次都有遗漏。`;

const postSource = fs.readFileSync(path.join(fixtureDir, 'kernel-sibling-post-aca7a0511.ts'), 'utf8');
const preSource = fs.readFileSync(path.join(fixtureDir, 'kernel-sibling-pre-aca7a0511.ts'), 'utf8');

// AC3 负控制：独立构造的空洞/保真判据（⛔ 与 kernel-sibling 无关——只验「扫描面段 vs 模式覆盖」的
// 结构不对称；空洞形态 = 扫描 packages/… 而 RegExp 不引用 packages，保真形态 = 加了引用 packages 的
// L3 模式）。criterion 对两者相同，expect 逐字相同，判别只来自 mechanism 覆盖面。
const INDEPENDENT_CRITERION = `test -f plugin/scripts/legacy-anchor-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/legacy-anchor-resolution-check.ts --root . --json`;
const INDEPENDENT_EXPECT = `\`legacy-anchor-resolution-check.ts\` 存在，且在本仓库当前树上跑 exit 0——即遗留模块锚定违例**枚举为 0 处**。⛔ 完整性由检查器的机械枚举给出，不是手工清单。`;
const independentVacuousSource = fs.readFileSync(path.join(fixtureDir, 'independent-vacuous-case.txt'), 'utf8');
const independentFaithfulSource = fs.readFileSync(path.join(fixtureDir, 'independent-faithful-case.txt'), 'utf8');

// ── 解析器 fail-closed（复刻 parseSemanticSufficiencyVerdict 手法）────────────

test('parseFidelityVerdict: 只认明确 faithful/vacuous，其余全 not-evaluated（fail-closed）', () => {
  assert.equal(parseFidelityVerdict('faithful', 0), 'faithful', '纯 token faithful ⇒ faithful');
  assert.equal(parseFidelityVerdict('vacuous', 0), 'vacuous', '纯 token vacuous ⇒ vacuous');
  assert.equal(parseFidelityVerdict('{"verdict":"faithful"}', 0), 'faithful', 'JSON faithful ⇒ faithful');
  assert.equal(parseFidelityVerdict('{"verdict":"vacuous"}', 0), 'vacuous', 'JSON vacuous ⇒ vacuous');
  assert.equal(parseFidelityVerdict('解释性前文…\n{"verdict":"vacuous"}', 0), 'vacuous', '末行 JSON vacuous ⇒ vacuous');
  // ⛔ fail-closed：非零退出 / 空 / 读不懂 / 无 verdict 键 ⇒ not-evaluated（绝不回落 faithful）。
  assert.equal(parseFidelityVerdict('{"verdict":"faithful"}', 1), 'not-evaluated', '非零退出 ⇒ not-evaluated');
  assert.equal(parseFidelityVerdict('', 0), 'not-evaluated', '空输出 ⇒ not-evaluated');
  assert.equal(parseFidelityVerdict('随便一句散文', 0), 'not-evaluated', '散文 ⇒ not-evaluated');
  assert.equal(parseFidelityVerdict('{"foo":"bar"}', 0), 'not-evaluated', '无 verdict 键 ⇒ not-evaluated');
  assert.equal(parseFidelityVerdict('{"verdict":"faithfulx"}', 0), 'not-evaluated', 'verdict 非法值 ⇒ not-evaluated');
});

// ── prompt 承载真实事实（DoD 反例判据：关掉 seam 后测的不是死代码）──────────

test('buildFidelityPrompt: 内嵌 criterion + expect 逐字 + mechanism 源，⛔ 非硬编码 verdict', () => {
  const p = buildFidelityPrompt(AC225_CRITERION, AC225_EXPECT, { root: repoRoot, mechanism: postSource });
  assert.ok(p.includes('kernel-sibling-resolution-check.ts --root . --json'), 'prompt 内嵌 criterion 逐字');
  assert.ok(p.includes('完整性由检查器的机械枚举给出'), 'prompt 内嵌 expect 的声称对象（真实输入，非死代码）');
  assert.ok(p.includes('P4_CROSS_PACKAGE_JOIN_RE'), 'prompt 内嵌 mechanism 源（扩面后形态含 P4）');
});

// ── 真判定器读数（AC3，⛔ 非 stub 自算）───────────────

// 真判定器对两个逐字夹具各跑一次的【原始输出】vendor 成文件（⛔ 不是测试按夹具自算 verdict——
// 缺陷 B 即原 judgeByMechanism 用 prompt.includes('cross-package') 自算判决再喂回解析器，那证明的是
// 「管道通」不是「真语义判定会判成 vacuous」）。真读数见上方实测注释：pre/post 都判 faithful（⛔
// 未复现「扩面前 vacuous」，已按 AC3 降为发现）。测试只钉「解析器对真判定器原始输出」的判决一致。
const realJudgePre = fs.readFileSync(path.join(fixtureDir, 'real-judge-pre.stdout.txt'), 'utf8');
const realJudgePost = fs.readFileSync(path.join(fixtureDir, 'real-judge-post.stdout.txt'), 'utf8');

test('真判定器读数：对两个逐字夹具的原始输出解析出与真判定器记录一致的 verdict', () => {
  assert.equal(parseFidelityVerdict(realJudgePre, 0), 'faithful', 'pre 夹具真判定器判 faithful（⛔ 非 vacuous——见实测注释，已降为发现）');
  assert.equal(parseFidelityVerdict(realJudgePost, 0), 'faithful', 'post 夹具真判定器判 faithful');
});

// ── 机械前置筛（方向 B，⛔ 不调 LLM，能取假——本任务实质）────────────────────

test('机械半：扫描面顶层目录段 vs RegExp 覆盖签名（结构性，⛔ 不认文件名/AC 编号）', () => {
  // pre 扫描面含 packages/（SCAN_ROOTS 有 packages/quay/src），但其 RegExp 只引用 __dirname/plugin/scripts。
  assert.deepEqual([...scanSurfaceTopSegments(preSource)].sort(), ['packages', 'plugin'], 'pre 扫描面段 = {packages, plugin}');
  assert.equal(regexBodies(preSource).includes('packages'), false, 'pre 的 RegExp 不引用 packages 段');
  // post 加了 P4，RegExp 引用 packages 段。
  assert.equal(regexBodies(postSource).includes('packages'), true, 'post 的 RegExp 引用 packages 段');
});

test('机械半：pre ⇒ vacuous、post ⇒ faithful（判据力恢复，⛔ 非 stub 自算）', () => {
  assert.equal(mechanicalFidelityVerdict(AC225_EXPECT, preSource), 'vacuous', 'pre（覆盖面缺口）⇒ vacuous');
  assert.equal(mechanicalFidelityVerdict(AC225_EXPECT, postSource), 'faithful', 'post（全覆盖）⇒ faithful');
});

test('机械半：完整判定短路 LLM——pre/post 的 judge 不被调用（不调 LLM 的读数）', () => {
  const neverCalled = () => { throw new Error('judge must NOT be called for mechanically-decided cases'); };
  assert.equal(criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, neverCalled, { mechanism: preSource }).verdict, 'vacuous', 'pre 机械短路 ⇒ vacuous');
  assert.equal(criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, neverCalled, { mechanism: postSource }).verdict, 'faithful', 'post 机械短路 ⇒ faithful');
});

test('AC3 负控制：独立构造的空洞判据 ⇒ vacuous、保真判据 ⇒ faithful（⛔ 非对 kernel-sibling 过拟合）', () => {
  assert.equal(mechanicalFidelityVerdict(INDEPENDENT_EXPECT, independentVacuousSource), 'vacuous', '独立空洞（扫描 packages 而 RegExp 不含 packages）⇒ vacuous');
  assert.equal(mechanicalFidelityVerdict(INDEPENDENT_EXPECT, independentFaithfulSource), 'faithful', '独立保真（RegExp 含 packages）⇒ faithful');
  // 完整判定同样短路（criterion 与 expect 对两个独立夹具逐字相同，判别只来自 mechanism 覆盖面）。
  const neverCalled = () => { throw new Error('judge must NOT be called'); };
  assert.equal(criterionFidelityVerdict(INDEPENDENT_CRITERION, INDEPENDENT_EXPECT, neverCalled, { mechanism: independentVacuousSource }).verdict, 'vacuous');
  assert.equal(criterionFidelityVerdict(INDEPENDENT_CRITERION, INDEPENDENT_EXPECT, neverCalled, { mechanism: independentFaithfulSource }).verdict, 'faithful');
});

test('机械半 defer：机制缺失 / 无完整性主张 ⇒ null（回落语义半，⛔ 不冒充判定）', () => {
  assert.equal(mechanicalFidelityVerdict(AC225_EXPECT, null), null, '无 mechanism ⇒ defer');
  assert.equal(mechanicalFidelityVerdict('只是 exit 0 的存在性判据', postSource), null, '无完整性主张 ⇒ defer');
});

test('机械半机制源读取：从 criterion 命令引用读回检查器文件（⛔ 不 spawn 进程）', () => {
  const src = readMechanismFromCriterion(AC225_CRITERION, repoRoot);
  assert.ok(src !== null && src.includes('kernel-sibling-resolution-check.ts'), '读回检查器源');
  // 生产激活路径（不传 mechanism）据此也能机械判别——当前树上的检查器已是扩面后形态 ⇒ faithful。
  assert.equal(mechanicalFidelityVerdict(AC225_EXPECT, src), 'faithful', '当前树上检查器（已扩面）⇒ faithful');
});

// ── not-evaluated 传播（判定器不可用/读不懂 ⇒ not-evaluated，绝不回落 faithful）──

test('not-evaluated 传播：判定器读不懂 / 抛错 ⇒ not-evaluated（⛔ 不回落 faithful）', () => {
  const garbage = () => ({ stdout: '不是 faithful 也不是 vacuous 的散文', exitCode: 0 });
  const r = criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, garbage);
  assert.equal(r.verdict, 'not-evaluated', '读不懂 ⇒ not-evaluated');
  assert.notEqual(r.verdict, 'faithful', '读不懂绝不回落 faithful');

  const throwing = () => { throw new Error('judge down'); };
  const r2 = criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, throwing);
  assert.equal(r2.verdict, 'not-evaluated', '判定器抛错 ⇒ not-evaluated');
});
