// @test-group engine
// goal-standing-ac-reverify-scope.test.mjs — AC-216 (gap-goal-standing-ac-reverify-scope):
// I5 checkAchievedFailing 的复验域不得随 GOAL 关闭而消失——显式声明 `long-term: true` 的 achieved AC
// 其 GOAL 已 achieved/关闭也仍在复验域；未声明的随 GOAL 关闭离开（控成本，⛔ 不无差别放宽）。
//
// 两条方向互为负控制（硬规则 4 推论三：各带「改坏 ⇒ 测试红」的取假路径）：
//   方向① 声明 `long-term: true` 的 achieved AC 其 GOAL 已 achieved ⇒ 在 inScope
//          （把 long-term 投影弄丢 ⇒ inScope 不含它 ⇒ 测试红）
//   方向② 未声明的 achieved AC 其 GOAL 已 achieved ⇒ 不在 inScope
//          （把作用域无差别放宽到全部 achieved ⇒ inScope 含它 ⇒ 测试红）
// 第三条 baseline：achieved AC 其 GOAL 仍 active（未声明）⇒ 仍在 inScope——证「active 半壁不变」。
//
// 测作用域条件（纯枚举），⛔ 不跑真实 criterion：设 GOAL_ACCEPTANCE_ACTIVE_ENV 守卫 env，使
// checkAchievedFailing 在枚举 inScope 后、运行 criterion 前返回（guard 路径同样透传 inScope）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/goal-standing-ac-reverify-scope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createGoalStore, GOAL_ACCEPTANCE_ACTIVE_ENV } from "../../packages/quay/src/goal-store.ts";

/** 写一个 GOAL/AC 记录成 goals/ 下的真实 frontmatter 文件（hermetic，⛔ 不注入 seam——跑真 goal-store
 *  的 list/checkAchievedFailing 作用域枚举）。longTerm 缺省不写 `long-term` 键。 */
function writeGoalFile(tmp, { id, status, kind, goal, criterion, longTerm = false }) {
  const lines = ["---", `id: ${id}`, "title: t", `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push("criterion: |", `  ${criterion}`);
  if (longTerm) lines.push("long-term: true");
  lines.push("origin: test fixture", "---", "");
  fs.writeFileSync(path.join(tmp, "goals", `${id}-t.md`), lines.join("\n"), "utf8");
}

/** 用守卫 env 包住 checkAchievedFailing 的作用域枚举（⛔ 不跑真实 criterion）。 */
function enumeratesInScope(store) {
  const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
  process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
  try {
    return store.checkAchievedFailing();
  } finally {
    if (prev === undefined) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
  }
}

function tmpGoals() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal-reverify-scope-"));
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  return tmp;
}

// ── 方向①：声明 `long-term: true` 的 achieved AC 其 GOAL 已 achieved ⇒ 仍在 inScope ────────────

test("方向① — long-term:true 的 achieved AC 跨 GOAL 关闭仍在 inScope", () => {
  const tmp = tmpGoals();
  try {
    writeGoalFile(tmp, { id: "GOAL-001", status: "achieved", kind: "goal" });
    writeGoalFile(tmp, { id: "AC-001", status: "achieved", kind: "criterion", goal: "GOAL-001", criterion: "true", longTerm: true });
    const s = createGoalStore(path.join(tmp, "goals"));
    // long-term 投影读回（AC 判据点名的「goal-store list 读回可见」半边）。
    assert.equal(s.get("AC-001").longTerm, true, "longTerm 从 frontmatter 投影到 view-model");
    const r = enumeratesInScope(s);
    assert.ok(Array.isArray(r.inScope), "inScope 是数组");
    assert.ok(r.inScope.includes("AC-001"), `方向①：long-term achieved AC 应在 inScope（实测 ${JSON.stringify(r.inScope)}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 方向②：未声明的 achieved AC 其 GOAL 已 achieved ⇒ 不在 inScope（随 GOAL 关闭离开） ────────

test("方向② — 未声明的 achieved AC 随 GOAL 关闭离开 inScope（不无差别放宽）", () => {
  const tmp = tmpGoals();
  try {
    writeGoalFile(tmp, { id: "GOAL-002", status: "achieved", kind: "goal" });
    writeGoalFile(tmp, { id: "AC-002", status: "achieved", kind: "criterion", goal: "GOAL-002", criterion: "true" });
    const s = createGoalStore(path.join(tmp, "goals"));
    assert.equal(s.get("AC-002").longTerm, false, "未声明 ⇒ longTerm 投影为 false");
    const r = enumeratesInScope(s);
    assert.ok(Array.isArray(r.inScope), "inScope 是数组");
    assert.ok(!r.inScope.includes("AC-002"), `方向②：未声明 achieved AC 不应在 inScope（实测 ${JSON.stringify(r.inScope)}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── baseline：achieved AC 其 GOAL 仍 active（未声明）⇒ 仍在 inScope（active 半壁不变） ─────────

test("baseline — active GOAL 名下未声明 achieved AC 仍在 inScope（放宽是增量，⛔ 非替换）", () => {
  const tmp = tmpGoals();
  try {
    writeGoalFile(tmp, { id: "GOAL-003", status: "active", kind: "goal" });
    writeGoalFile(tmp, { id: "AC-003", status: "achieved", kind: "criterion", goal: "GOAL-003", criterion: "true" });
    const s = createGoalStore(path.join(tmp, "goals"));
    const r = enumeratesInScope(s);
    assert.ok(r.inScope.includes("AC-003"), `baseline：active GOAL 名下 achieved AC 应在 inScope（实测 ${JSON.stringify(r.inScope)}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
