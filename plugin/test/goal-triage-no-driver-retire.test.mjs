// @test-group engine
// goal-triage-no-driver-retire.test.mjs — GOAL-010 范围② / AC-211
// (tasks/gap-goal-driver-no-retire-write-surface): goal-driver 写面不越权放弃——writeGoalStatus 只写
// achieved/active/needs-human，分诊判「retire」时只能置 needs-human 并说明理由，retired 归人。
//
// 覆盖两条不变式，各带一条负控制：
//   ① 写面守卫（源形状断言）：枚举 goal-driver.ts 里 writeGoalStatus 的全部调用点，逐点核 status
//     实参 ∈ {achieved, active, needs-human}、⛔ 不含 retired/superseded（把任一调用点改成 "retired"
//     会红，证明枚举非空且逐点真核——硬规则 4 推论三）；
//   ② 分诊判 retire ⇒ 写 needs-human：构造「goal 锚合法 + criterion 非空 + 无 posture + 无牵引」的
//     draft AC，跑一轮后读回记录断言 status=needs-human ∧ statusLog 末笔 reason 非空 ∧ ≠ retired
//     （把写面改成 "retired" 会红，证明判据非恒真）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-no-driver-retire.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  triageDraftAc,
  runGoalRound,
  listGoalRecords,
} from '../scripts/goal-driver.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 不变式①（源形状断言）：枚举 writeGoalStatus 全部调用点，逐点核 status 实参 ──────────────

/** 从 goal-driver.ts 源文里枚举 writeGoalStatus 的【调用点】（跳过函数定义本身与散文提及）。
 *  返回每条调用点的实参串（首括号到配平闭括号之间），供 splitTopLevelCommas 切分。 */
function enumerateWriteGoalStatusCalls(src) {
  const calls = [];
  const needle = 'writeGoalStatus';
  let searchFrom = 0;
  while (true) {
    const idx = src.indexOf(needle, searchFrom);
    if (idx === -1) break;
    searchFrom = idx + needle.length;
    const openMatch = src.slice(idx + needle.length).match(/^\s*\(/);
    if (!openMatch) continue; // 散文提及（如注释里的「writeGoalStatus 写 …」），非调用/定义。
    const openIdx = idx + needle.length + openMatch[0].length - 1;
    // 跳过函数定义本身（needle 前是 `function` 关键词）。
    if (/function\s*$/.test(src.slice(0, idx))) continue;
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
    }
    assert.ok(closeIdx !== -1, 'writeGoalStatus 调用括号必须闭合');
    calls.push(src.slice(openIdx + 1, closeIdx));
    searchFrom = closeIdx + 1;
  }
  return calls;
}

/** 顶层逗号切分（括号/方括号/花括号内的逗号不算顶层——status 实参是第 3 个顶层实参）。 */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; }
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim());
}

/** 不变式①的允许词表（⛔ retired/superseded 是放弃/取代态，最不可逆，归人）。 */
const ALLOWED_WRITE_STATUSES = new Set(['achieved', 'active', 'needs-human']);
const FORBIDDEN_WRITE_STATUSES = new Set(['retired', 'superseded']);

test('不变式① 写面守卫：writeGoalStatus 全部调用点 status 实参 ∈ {achieved, active, needs-human}，⛔ 不含 retired/superseded', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'plugin', 'scripts', 'goal-driver.ts'), 'utf8');
  const calls = enumerateWriteGoalStatusCalls(src);
  assert.ok(calls.length >= 1, 'writeGoalStatus 调用点非空（⛔ 恒真空枚举 = 假保证，硬规则 4 推论三）');
  for (const argsText of calls) {
    const parts = splitTopLevelCommas(argsText);
    assert.ok(parts.length >= 3, `调用必须 ≥3 个顶层实参（status 是第 3 个）: ${argsText}`);
    const statusArg = parts[2];
    const lit = statusArg.match(/^"([^"]*)"$/);
    assert.ok(lit, `status 实参必须是字符串字面量（否则守卫无法核）: ${statusArg}`);
    const status = lit[1];
    assert.ok(!FORBIDDEN_WRITE_STATUSES.has(status), `status 实参不得为 "${status}"（放弃/取代归人，AC-211）`);
    assert.ok(ALLOWED_WRITE_STATUSES.has(status), `status 实参 "${status}" ∉ ${[...ALLOWED_WRITE_STATUSES].join(' / ')}`);
  }
});

// ── 不变式②（行为级）：分诊判 retire ⇒ 写 needs-human、reason 非空、≠ retired ──────────────

/** 把一个 GOAL/AC 记录写成 goals/ 下的真实 frontmatter 文件（⛔ 不注入 seam，跑真 goal-store CLI）。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion }) {
  const lines = ['---', `id: ${id}`, 'title: t', `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push('criterion: |', `  ${criterion}`);
  lines.push('origin: test fixture', '---', '', '## body', 'x', '');
  fs.writeFileSync(path.join(tmp, 'goals', `${id}-t.md`), lines.join('\n'), 'utf8');
}

test('不变式② 分诊判 retire ⇒ 产物是一条 needs-human 的 AC、reason 非空、status ≠ retired', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-no-retire-'));
  try {
    fs.mkdirSync(path.join(tmp, 'goals'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true });
    // active GOAL-009 名下一条 draft AC：goal 锚合法 + criterion 非空 + 无 posture + 无牵引 ⇒ retire。
    writeGoalFile(tmp, { id: 'GOAL-009', status: 'active', kind: 'goal' });
    writeGoalFile(tmp, { id: 'AC-900', status: 'draft', kind: 'criterion', goal: 'GOAL-009', criterion: 'true' });
    // tasks 目录空 ⇒ 无任何 task 关联 AC-900 ⇒ 无牵引 ⇒ 死信 ⇒ 分诊判 retire。

    const { fact } = await runGoalRound(tmp, { scriptRoot: repoRoot, gapWorkerCmd: 'true', resourceGateArgv: ['true'] });

    // 前提自检：分诊判决本身应是 retire（若分诊词表/语义变了，本测试的输入就不成立——防空转）。
    const triageEntry = fact.value.triage.find((t) => t.ac === 'AC-900');
    assert.ok(triageEntry, 'AC-900 应在 triage 里');
    assert.equal(triageEntry.decision, 'retire', '无牵引 ⇒ 分诊判 retire（前提自检，⛔ 空转）');

    // 写面：经 writeGoalStatus（provider 写路径）落地，读回记录断言 status + statusLog.reason。
    const records = await listGoalRecords(repoRoot, tmp);
    const ac = records.find((r) => String(r.id) === 'AC-900');
    assert.ok(ac, '读回 AC-900');
    assert.equal(ac.status, 'needs-human', 'retire 建议 ⇒ 产物 status=needs-human（⛔ 不翻 retired）');
    assert.notEqual(ac.status, 'retired', '产物 status 不得为 retired（最不可逆的一态挡在人这一侧）');

    const last = Array.isArray(ac.statusLog) ? ac.statusLog[ac.statusLog.length - 1] : null;
    assert.ok(last, 'statusLog 有记录（draft→needs-human 是状态翻写）');
    assert.equal(last.to, 'needs-human', 'statusLog 末笔 to=needs-human');
    assert.equal(last.from, 'draft', 'statusLog 末笔 from=draft');
    assert.ok(typeof last.reason === 'string' && last.reason.trim().length > 0, `reason 非空可 grep: "${last.reason}"`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 不变式②的纯函数前提（五态里 retire 可达，供负控制直接调用而不起整个机械环）──────────────

test('分诊纯函数：结构完备 + 无 posture + 无牵引 ⇒ retire（不变式②的判决前提，防空转）', () => {
  const e = triageDraftAc({ id: 'AC-900', goal: 'GOAL-009', criterion: 'true' }, null, []);
  assert.equal(e.decision, 'retire');
  assert.ok(e.reason.trim().length > 0, 'retire 判决 reason 非空');
});
