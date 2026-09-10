// @test-group engine
// criterion-fidelity-historical-case.test.mjs — AC-230 (tasks/gap-criterion-fidelity-gate-activation-
// blind-to-vacuous-criteria)：AC-225 真实历史案例双向回归（⛔ 非合成夹具——本 goal 唯一的生产实证）：
//   ① 扩面前（只有 P1/P2/P3、无 P4 跨包形态）⇒ 判 vacuous
//   ② 扩面后（含 P4 三形态）⇒ 判 faithful
//   两方向用【同一个真实案例】，缺②即与「恒判 vacuous」同形（那样的判定器会挡住一切激活）。
// 两个检查器形态逐字 vendor 成仓库内文件（plugin/test/fixtures/criterion-fidelity/），⛔ 不锚 commit
// SHA（硬规则 5b：判据不得引用生命周期短于判据本身的对象，rebase/squash 后假阴性）。
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
} from '../../packages/quay/src/criterion-fidelity.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = path.join(repoRoot, 'plugin', 'test', 'fixtures', 'criterion-fidelity');

// AC-225 逐字的 criterion/expect（2026-09-10 07:00:55Z 被 I2 flip achieved 的那一条）。⛔ 逐字 vendor
// 进本测试，不读 goals/AC-225*.md、不锚 commit SHA——判据不得引用生命周期短于判据本身的对象。
const AC225_CRITERION = `test -f plugin/scripts/kernel-sibling-resolution-check.ts && node --no-warnings --experimental-strip-types plugin/scripts/kernel-sibling-resolution-check.ts --root . --json`;
const AC225_EXPECT = `\`kernel-sibling-resolution-check.ts\` 存在，且在本仓库当前树上跑 exit 0——即 KERNEL 域违例（把自己的 sibling 脚本锚在 target root / worktree / naive \`__dirname\` 而非经 \`resolveKernelSibling\`/\`resolveKernelPluginRoot\`）**枚举为 0 处**。立条时实测残量 **9 处** naive \`__dirname\` ⇒ 红。本条与 AC-224 构成双向：AC-224 证明该检查器会红（能取假），本条证明它此刻是绿（迁移已完成）。⛔ 完整性由检查器的机械枚举给出，不是手工清单——人工枚举已做过 3 次、3 次都有遗漏。`;

const preSource = fs.readFileSync(path.join(fixtureDir, 'kernel-sibling-pre-aca7a0511.ts'), 'utf8');
const postSource = fs.readFileSync(path.join(fixtureDir, 'kernel-sibling-post-aca7a0511.ts'), 'utf8');

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

// ── 双向真实历史回归（同一个案例，缺②即与恒判 vacuous 同形）───────────────

// 确定性判定器（测试缝）：代理「检查器是否枚举 cross-package 跨包源码锚点」这个历史语义区分。
// 扩面前 form 枚举只含 naive-__dirname/target-root/template-string（无 cross-package）⇒ 对 expect
// 声称的完整 KERNEL 域违例类别结构上不可能红 ⇒ vacuous；扩面后含 P4 cross-package ⇒ faithful。
function judgeByMechanism(prompt) {
  const hasCrossPackage = prompt.includes('cross-package');
  return { stdout: JSON.stringify({ verdict: hasCrossPackage ? 'faithful' : 'vacuous' }), exitCode: 0 };
}

test('① 扩面前（P1/P2/P3，无 P4）⇒ vacuous —— 2026-09-10 07:00:55Z 那 73 分钟里真实发生过的输入', () => {
  const r = criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, judgeByMechanism, {
    root: repoRoot,
    mechanism: preSource,
  });
  assert.equal(r.verdict, 'vacuous', '扩面前 ⇒ vacuous（结构上不可能对声称对象取假）');
});

test('② 扩面后（含 P4 三形态）⇒ faithful —— 缺此向即与恒判 vacuous 同形', () => {
  const r = criterionFidelityVerdict(AC225_CRITERION, AC225_EXPECT, judgeByMechanism, {
    root: repoRoot,
    mechanism: postSource,
  });
  assert.equal(r.verdict, 'faithful', '扩面后 ⇒ faithful（能在声称对象上取假）');
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
