// @test-group engine
// long-term-guarantee-goal-backed-check.test.mjs — 位置判定：delivery-critical 新立案任务必须声明 goal_ac
// (tasks/gap-long-term-guarantee-registry-hand-maintained, goals/AC-190-task-ac.md).
//
// 双向负控制（AC-190 origin 逐字，⛔ 不接受只有单向断言的实现）：
//   正控制 = 真仓库上默认运行 exit 0（生效线之后 delivery-critical 任务均声明 goal_ac）；
//   负控制 = --inject-unbacked-fixture 注入一条「生效线之后、带标签、无 goal_ac」后 exit 非零。
// 纯函数 isDeliveryCritical/hasGoalAc/filedAfterCutoff/evaluateDeliveryCritical 的单测覆盖位置判定的
// 三个取假维度（标签有无 / goal_ac 空 / 生效线前后），与端到端 spawn 断言互为印证。
//
// Run: scripts/test.sh plugin/test/long-term-guarantee-goal-backed-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ACTIVATION_LINE_ISO,
  activationLineMs,
  DELIVERY_CRITICAL_LABEL,
  INJECTED_UNBACKED_ID,
  isDeliveryCritical,
  hasGoalAc,
  filedAfterCutoff,
  evaluateDeliveryCritical,
} from "../scripts/long-term-guarantee-goal-backed-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "long-term-guarantee-goal-backed-check.ts");

// ── 纯函数：标签判定 ─────────────────────────────────────────────────────────────────────────────

test("isDeliveryCritical: labels 含 delivery-critical ⇒ true；不含 ⇒ false（标签位置，非名单）", () => {
  assert.equal(isDeliveryCritical({ labels: ["gap", DELIVERY_CRITICAL_LABEL] }), true);
  assert.equal(isDeliveryCritical({ labels: ["gap", "mechanism"] }), false);
  assert.equal(isDeliveryCritical({ labels: [] }), false);
  assert.equal(isDeliveryCritical({}), false);
  assert.equal(isDeliveryCritical({ labels: "delivery-critical" }), false); // 非数组 ⇒ false
});

// ── 纯函数：goal_ac 非空判定 ────────────────────────────────────────────────────────────────────

test("hasGoalAc: 非空 string ⇒ true；空/缺值/非 string ⇒ false（fail-closed）", () => {
  assert.equal(hasGoalAc({ goal_ac: "AC-190" }), true);
  assert.equal(hasGoalAc({ goal_ac: "" }), false);
  assert.equal(hasGoalAc({ goal_ac: "   " }), false);
  assert.equal(hasGoalAc({}), false);
  assert.equal(hasGoalAc({ goal_ac: null }), false);
  assert.equal(hasGoalAc({ goal_ac: 123 }), false);
});

// ── 纯函数：生效线判定 ──────────────────────────────────────────────────────────────────────────

test("filedAfterCutoff: ≥ 生效线 ⇒ true；< ⇒ false；缺值 ⇒ true（缺值=未查，fail-closed）", () => {
  const cutoff = activationLineMs();
  assert.equal(filedAfterCutoff({ filedAtMs: cutoff }, cutoff), true);
  assert.equal(filedAfterCutoff({ filedAtMs: cutoff + 1 }, cutoff), true);
  assert.equal(filedAfterCutoff({ filedAtMs: cutoff - 1 }, cutoff), false);
  assert.equal(filedAfterCutoff({}, cutoff), true); // 缺值 ⇒ fail-closed
  assert.equal(filedAfterCutoff({ filedAtMs: NaN }, cutoff), true);
});

test("activationLineMs: 解析 ACTIVATION_LINE_ISO 为有限 ms 且 ≥ 0", () => {
  assert.ok(Number.isFinite(activationLineMs()));
  assert.ok(activationLineMs() >= 0);
  assert.ok(Date.parse(ACTIVATION_LINE_ISO) === activationLineMs());
});

// ── 纯函数：位置判定（三份清单 + 存量拆分，枚举不布尔） ─────────────────────────────────────────

function dcTask(id, { goal_ac = null, filedAtMs = Date.now() } = {}) {
  return { id, labels: [DELIVERY_CRITICAL_LABEL], goal_ac, filedAtMs };
}

test("evaluateDeliveryCritical: 生效线后带标签无 goal_ac ⇒ violating（负控制）", () => {
  const r = evaluateDeliveryCritical([dcTask("gap-new-unbacked")]);
  assert.deepEqual(r.violating, ["gap-new-unbacked"]);
  assert.deepEqual(r.compliant, []);
  assert.equal(r.total, 1);
});

test("evaluateDeliveryCritical: 生效线后带标签有 goal_ac ⇒ compliant（正控制，证明非恒红）", () => {
  const r = evaluateDeliveryCritical([dcTask("gap-new-backed", { goal_ac: "AC-190" })]);
  assert.deepEqual(r.violating, []);
  assert.deepEqual(r.compliant, ["gap-new-backed"]);
});

test("evaluateDeliveryCritical: 生效线前存量不判红，且按 goal_ac 有无拆开（grandfather）", () => {
  const cutoff = activationLineMs();
  const old = cutoff - 1000;
  const r = evaluateDeliveryCritical([
    dcTask("gap-old-unbacked", { filedAtMs: old }),
    dcTask("gap-old-backed", { goal_ac: "AC-190", filedAtMs: old }),
  ], cutoff);
  assert.deepEqual(r.violating, []);
  assert.deepEqual(r.compliant, []);
  assert.deepEqual(r.grandfathered.sort(), ["gap-old-backed", "gap-old-unbacked"]);
  assert.deepEqual(r.grandfatheredNoGoalAc, ["gap-old-unbacked"]);
  assert.deepEqual(r.grandfatheredWithGoalAc, ["gap-old-backed"]);
});

test("evaluateDeliveryCritical: 非 delivery-critical 任务不参与判定（位置判定只认标签）", () => {
  const r = evaluateDeliveryCritical([{ id: "gap-other", labels: ["gap"], goal_ac: null, filedAtMs: Date.now() }]);
  assert.equal(r.total, 0);
  assert.deepEqual(r.violating, []);
});

// ── 端到端：真仓库绿 + 注入红（双向负控制） ─────────────────────────────────────────────────────

function runChecker(args = []) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
}

test("默认运行对真仓库 exit 0（正控制：生效线后 delivery-critical 任务均声明 goal_ac）", () => {
  const r = runChecker();
  assert.equal(r.status, 0, `default run must be green, got status=${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
});

test("--inject-unbacked-fixture 注入未声明 goal_ac 的新立案任务 ⇒ exit 非零（负控制）", () => {
  const r = runChecker(["--inject-unbacked-fixture"]);
  assert.notEqual(r.status, 0, `injected run must be red, got status=${r.status}`);
  assert.match(r.stdout, new RegExp(INJECTED_UNBACKED_ID));
});

// ── AC6 单源：写入面判定复用本检测器的判定函数（gap-ac190-goal-ac-rule-not-enforced-at-filing）──────
// AC-190 的规则有两个生效时刻——goal 层每轮事后跑（本文件），提交那一刻的写入面（precommit-guard
// 的 ③）。两处必须是【同一个判定】：判据在此处，写入面只许 import，⛔ 不许出现第二份字符串比较
// （硬规则 1：用机件、不手搓；硬规则 5b：修一处不等于只有一处）。本测试钉住那条 import 行本身——
// 「单源」在记录上必须可分辨，否则两份实现会在下一次改动时分叉。

test("AC6 — precommit-guard.ts 的写入面判定 import 本检测器的 isDeliveryCritical/hasGoalAc（⛔ 不是第二份字符串比较）", () => {
  const guardSrc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts"), "utf8");
  const importMatch = guardSrc.match(
    /import\s*\{([^}]*)\}\s*from\s*["'][^"']*long-term-guarantee-goal-backed-check\.ts["']/,
  );
  assert.ok(importMatch, "precommit-guard.ts must import from long-term-guarantee-goal-backed-check.ts");
  const imported = importMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of ["isDeliveryCritical", "hasGoalAc", "filedAfterCutoff", "activationLineMs"]) {
    assert.ok(imported.includes(name), `the write surface must reuse ${name} (imported: ${imported.join(", ")})`);
  }
  // AC6's ⛔ half: no SECOND string comparison for the label anywhere in the guard (a mention in a
  // message/comment is fine — the position that matters is the comparison/call).
  assert.ok(
    !/\.includes\(\s*["']delivery-critical["']\s*\)/.test(guardSrc),
    "the guard must not re-implement the delivery-critical label comparison (single source)",
  );
  assert.ok(
    !/labels\s*!==\s*undefined[^\n]*goal_ac/.test(guardSrc),
    "the guard must not hand-roll its own label/goal_ac predicate",
  );
});
