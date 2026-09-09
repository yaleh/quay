// @test-group engine
// active-ac-must-have-criterion.test.mjs — AC-180 常设不变式下沉套件
// (tasks/gap-ac180-scope-empty-so-criterion-passes-vacuously, goals/AC-180-active-ac.md).
//
// 缺陷（该任务修复的）：AC-180 原判据 `list --status active` 的作用域恒空（0 条 active AC）——
// `test 0 -eq 0` 恒真 ⇒ 判据「没有任何 active AC 缺 criterion」在空作用域上恒过（空过）。
// 改写后的不变式：**任何非 draft/retired/superseded 的 AC 都必须有非空 criterion**（该集合恒非空）。
//
// 两个取假维度都保留（⛔ 不接受只有单向断言的实现）：
//   正控制 = 当前仓库上作用域 > 0（打印实际条数）且空 criterion 计数 = 0；
//   负控制 = 作用域为空 ⇒ evaluated:false（未评估，不与「通过」同形，硬规则 3b）；
//            造一条非 draft 且无 criterion 的 AC ⇒ empty 命中（判据红）；
//            移除该条 ⇒ empty 空（判据转绿，证明不是恒红）。
// `evaluate` 纯函数 + 真 goal-store 读数的端到端断言互为印证。
//
// Run: scripts/test.sh plugin/test/active-ac-must-have-criterion.test.mjs
//      node --test plugin/test/active-ac-must-have-criterion.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGoalStore } from "../../packages/quay/src/goal-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// 作用域排除集（硬规则 3：枚举，不布尔）——这些状态是「尚未 / 不再受治理」，缺 criterion 不算违例。
const OUT_OF_SCOPE_STATUSES = new Set(["draft", "retired", "superseded"]);

/**
 * 改写后的 AC-180 不变式（纯函数）：
 *   作用域 = 所有 id 形如 AC-* 且 status 不在 draft/retired/superseded 的记录；
 *   违例   = 作用域内 criterion 为空（null / 空白）的记录。
 * 返回 { evaluated, scopeCount, empty } —— `evaluated` 为 false ⟺ 作用域为空：
 * 空作用域是「未评估」，⛔ 永不与「通过」同形（同 gap-goal-store-empty-scope 的纪律）。
 */
function evaluate(records) {
  const scope = records.filter(
    (r) => /^AC-/.test(String(r.id ?? "")) && !OUT_OF_SCOPE_STATUSES.has(String(r.status ?? "")),
  );
  const empty = scope.filter(
    (r) => r.criterion == null || String(r.criterion).trim() === "",
  );
  return {
    evaluated: scope.length > 0,
    scopeCount: scope.length,
    empty: empty.map((r) => String(r.id)),
  };
}

/** 造一条 AC 记录 view-model（纯函数测试用 fixture，⛔ 不改真仓库）。 */
function acRecord(overrides = {}) {
  return {
    id: "AC-900",
    title: "fixture",
    status: "achieved",
    kind: "criterion",
    goal: "GOAL-001",
    criterion: "test 0 -eq 0",
    ...overrides,
  };
}

// ── 纯函数：两个取假维度 + 未评估区分 ────────────────────────────────────────────────────────────

test("evaluate: 空作用域 ⇒ evaluated:false（未评估，不与通过同形）", () => {
  const r = evaluate([]);
  assert.equal(r.evaluated, false);
  assert.equal(r.scopeCount, 0);
  assert.deepEqual(r.empty, []);
});

test("evaluate: 非 draft AC 无 criterion ⇒ empty 命中（负控制：判据红）", () => {
  const r = evaluate([
    acRecord({ id: "AC-901", status: "achieved", criterion: "" }),
    acRecord({ id: "AC-902", status: "active", criterion: null }),
  ]);
  assert.equal(r.evaluated, true);
  assert.equal(r.scopeCount, 2);
  assert.deepEqual(r.empty, ["AC-901", "AC-902"]);
});

test("evaluate: 非 draft AC 有 criterion ⇒ empty 空（反向负控制：非恒红）", () => {
  const r = evaluate([acRecord({ id: "AC-901", status: "achieved", criterion: "test 0 -eq 0" })]);
  assert.equal(r.evaluated, true);
  assert.deepEqual(r.empty, []);
});

test("evaluate: draft/retired/superseded 无 criterion ⇒ 不计入作用域（不在治理范围内）", () => {
  const r = evaluate([
    acRecord({ id: "AC-1", status: "draft", criterion: "" }),
    acRecord({ id: "AC-2", status: "retired", criterion: "" }),
    acRecord({ id: "AC-3", status: "superseded", criterion: "" }),
  ]);
  assert.equal(r.evaluated, false); // 全部出作用域 ⇒ 空作用域 ⇒ 未评估
  assert.deepEqual(r.empty, []);
});

// ── 端到端：真 goal-store 读当前仓库（正控制：作用域 > 0 且无空 criterion） ──────────────────────

test("当前仓库：作用域 > 0 且空 criterion 计数 = 0（打印实际条数，拒绝空过）", () => {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const r = evaluate(store.list());
  assert.equal(r.evaluated, true, `作用域为空 ⇒ 未评估，拒绝恒真通过（AC-180 空过缺陷）`);
  assert.ok(r.scopeCount > 0, `作用域必须非空（实际 ${r.scopeCount} 条非 draft/retired/superseded AC）`);
  assert.deepEqual(r.empty, [], `空 criterion 的 AC 必须为 0（作用域 ${r.scopeCount} 条）`);
});

// ── 端到端负控制：临时 goals 目录走真 goal-store 解析（造违例 ⇒ 红；移除 ⇒ 绿） ───────────────────

function writeFixture(goalsDir, id, status, criterion) {
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.writeFileSync(
    path.join(goalsDir, `${id}.md`),
    `---\nid: ${id}\ntitle: fixture\nstatus: ${status}\nkind: criterion\ngoal: GOAL-001\ncriterion: ${criterion}\norigin: fixture\n---\n`,
    "utf8",
  );
}

test("端到端：临时 goals 里一条无 criterion 的非 draft AC ⇒ empty 命中（造违例 ⇒ 红）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmcc-"));
  try {
    writeFixture(path.join(dir, "goals"), "AC-999", "achieved", '""');
    const store = createGoalStore(path.join(dir, "goals"));
    const r = evaluate(store.list());
    assert.equal(r.evaluated, true);
    assert.deepEqual(r.empty, ["AC-999"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("端到端：同一临时 goals 移除该违例 AC ⇒ empty 空（移除 ⇒ 转绿，非恒红）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmcc-"));
  try {
    writeFixture(path.join(dir, "goals"), "AC-999", "achieved", '"test 0 -eq 0"');
    const store = createGoalStore(path.join(dir, "goals"));
    const r = evaluate(store.list());
    assert.equal(r.evaluated, true);
    assert.deepEqual(r.empty, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
