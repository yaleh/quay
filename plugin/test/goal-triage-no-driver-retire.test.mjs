// @test-group engine
// goal-triage-no-driver-retire.test.mjs — GOAL-010 范围② / AC-211
// (tasks/gap-goal-driver-no-retire-write-surface): goal-driver 写面不越权放弃——writeGoalStatus 只写
// achieved/active/needs-human，⛔ 不含 retired/superseded（放弃/取代态最不可逆，归人）。
//
// 覆盖一条不变式（源形状断言），带一条负控制：
//   ① 写面守卫：枚举 goal-driver.ts 里 writeGoalStatus 的全部调用点，逐点核 status 实参
//     ∈ {achieved, active, needs-human}、⛔ 不含 retired/superseded（把任一调用点改成 "retired"
//     会红，证明枚举非空且逐点真核——硬规则 4 推论三）。
//
// 原「不变式②（分诊判 retire ⇒ 写 needs-human）」已随 AC-219 退役：triageDraftAc 的四态词表
// 不再含 retire（「无任务牵引」≠「死信」，刚提案 draft AC 分诊为 hold 而非 retire→needs-human，
// 见 plugin/test/goal-triage-fresh-draft-not-retire.test.mjs）。写面守卫不变式①是 AC-211 的
// 承重不变式（driver 永不写 retired/superseded），保留并继续逐点核。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-no-driver-retire.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
