// @test-group engine
// long-term-guarantee-goal-backed-check.test.mjs — 反例检测器：长期保证只有 task AC 背书 ⇒ 报红
// (tasks/gap-ac190-long-term-guarantee-goal-backed-check, goals/AC-190-task-ac.md).
//
// 双向负控制（AC-190 origin 逐字，⛔ 不接受只有单向断言的实现）：
//   正控制 = 真仓库上默认运行 exit 0（三条长期保证各被 goal 层 criterion AC 背书）；
//   负控制 = --inject-unbacked-fixture 注入一条「只有 task AC 背书的长期保证」后 exit 非零。
// 纯函数 evaluate/isBackingRecord 的单测覆盖背书判定的四个取假维度（kind/status/criterion 非空/origin 点名），
// 与端到端 spawn 断言互为印证——正/负各至少一条断言（AC6）。
//
// Run: scripts/test.sh plugin/test/long-term-guarantee-goal-backed-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  evaluate,
  isBackingRecord,
  INJECTED_UNBACKED_ID,
} from "../scripts/long-term-guarantee-goal-backed-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "long-term-guarantee-goal-backed-check.ts");

// ── 纯函数：背书判定 ─────────────────────────────────────────────────────────────────────────────

function backing(overrides = {}) {
  return {
    id: "AC-192",
    kind: "criterion",
    status: "achieved",
    criterion: "echo a-runnable-criterion-that-is-long-enough",
    origin: "来源 task gap-fan-in-ff-retry-counter-scope 的长期保证",
    ...overrides,
  };
}

test("isBackingRecord: kind=criterion + active/achieved + criterion≥20 + origin 非空 ⇒ true", () => {
  assert.equal(isBackingRecord(backing()), true);
  assert.equal(isBackingRecord(backing({ status: "active" })), true);
});

test("isBackingRecord: 四个取假维度各为 false（kind/status/空 criterion/空 origin）", () => {
  assert.equal(isBackingRecord(backing({ kind: "goal" })), false);
  assert.equal(isBackingRecord(backing({ status: "draft" })), false);
  assert.equal(isBackingRecord(backing({ criterion: "" })), false);
  assert.equal(isBackingRecord(backing({ criterion: "short" })), false);
  assert.equal(isBackingRecord(backing({ origin: "" })), false);
});

test("evaluate: 有 goal 层背书 ⇒ unbacked 为空（正控制）", () => {
  const { backed, unbacked } = evaluate([backing()], ["gap-fan-in-ff-retry-counter-scope"]);
  assert.deepEqual(unbacked, []);
  assert.deepEqual(backed, ["gap-fan-in-ff-retry-counter-scope"]);
});

test("evaluate: 无 goal 层背书 ⇒ 枚举未背书 id（负控制，枚举不布尔）", () => {
  const { unbacked } = evaluate([backing()], ["gap-some-unbacked-guarantee"]);
  assert.deepEqual(unbacked, ["gap-some-unbacked-guarantee"]);
});

// ── 端到端：真仓库绿 + 注入红（双向负控制，AC6 的 exit 0 与 exit 非零断言） ───────────────────────

function runChecker(args = []) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
}

test("默认运行对真仓库 exit 0（正控制：三条长期保证均被 goal AC 背书）", () => {
  const r = runChecker();
  assert.equal(r.status, 0, `default run must be green, got status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
});

test("--inject-unbacked-fixture 注入未背书条目 ⇒ exit 非零（负控制）", () => {
  const r = runChecker(["--inject-unbacked-fixture"]);
  assert.notEqual(r.status, 0, `injected run must be red, got status=${r.status}`);
  assert.match(r.stdout, new RegExp(INJECTED_UNBACKED_ID));
});
