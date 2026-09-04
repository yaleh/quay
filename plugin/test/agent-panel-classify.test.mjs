// @test-group engine
// agent-panel-classify.test.mjs — 面板行分类纯函数迁移测试
// (tasks/gap-retire-inner-hygiene-delete-session-face).
//
// 原 inner-panel-stale-check.ts 的 CLI 壳（--pane/--target/tmux capture 读盘）是②类会话卫生面，
// step2 已删。纯函数迁到 plugin/scripts/agent-panel-classify.ts，本文件钉住「迁移后行为不变」——
// 只保留原测试里的纯函数用例，CLI 壳用例（AC3 exit 码 / --json / fail-closed）与 SKILL.md 引用
// 用例（AC4 wiring）随壳一并删除。
//
//   AC1 — bracket cross-reference: 括号已关任务的面板行标记 ENDED（不与 live 行视觉相同）。
//   AC2 — frozen-timer: 两次采样计时未推进 ⇒ FROZEN（脚本做两次采样，无需人跨时间采样）。
//
// Run:
//   scripts/test.sh plugin/test/agent-panel-classify.test.mjs
//   node --test plugin/test/agent-panel-classify.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseTimerSec,
  extractAgentLines,
  matchTaskIds,
  runStaleCheck,
  collectKnownTaskIds,
} from "../scripts/agent-panel-classify.ts";

// The exact defect shape from the task: observer-registry ran 3h5m32s, bracket closed at 03:22
// (needs-human, d3fb2839), but the panel line is still present with a frozen timer.
const FROZEN_PANE = `  Committing observer-registry task work 3h 5m 32s
  Execute live-task task 1h 6m 3s
  Waiting for full suite run #3 to complete
`;
const FROZEN_PANE_AFTER = `  Committing observer-registry task work 3h 5m 32s
  Execute live-task task 1h 6m 37s
  Waiting for full suite run #3 to complete
`;

// Telemetry: observer-registry is a completed task (bracket CLOSED), live-task is still inProgress.
const REPORT = {
  tasks: [{ taskId: "observer-registry", minutes: 185.5, outcome: "needs-human" }],
  inProgress: [{ taskId: "live-task", runId: "r2" }],
  orphaned: [],
  reconciled: [],
  unreliable: [],
  reconcilable: [],
};

// ── parsing helpers (pure) ──────────────────────────────────────────────────────────────────────────

test("parseTimerSec — handles the repo's real timer formats", () => {
  assert.equal(parseTimerSec("3h 5m 32s"), 3 * 3600 + 5 * 60 + 32);
  assert.equal(parseTimerSec("1h6m3s"), 3600 + 6 * 60 + 3);
  assert.equal(parseTimerSec("26m51s"), 26 * 60 + 51);
  assert.equal(parseTimerSec("4m5s"), 4 * 60 + 5);
  assert.equal(parseTimerSec("Waiting for full suite run #3 to complete"), null);
  assert.equal(parseTimerSec(""), null);
});

test("extractAgentLines — pulls lines carrying a state verb + keeps the timer", () => {
  const lines = extractAgentLines(FROZEN_PANE);
  assert.equal(lines.length, 3, "three agent lines in the fixture");
  assert.ok(lines.some((l) => l.verb === "Committing" && l.timerSec === 3 * 3600 + 5 * 60 + 32));
  assert.ok(lines.some((l) => l.verb === "Execute" && l.timerSec === 3600 + 6 * 60 + 3));
  // A line with a verb but no timer is still an agent line (Waiting line above).
  assert.ok(lines.some((l) => l.verb === "Waiting" && l.timerSec === null));
});

test("matchTaskIds — strict token boundary (gap cannot match inside gap-something)", () => {
  assert.deepEqual(matchTaskIds("Committing gap-x task work 1h 2m 3s", ["gap-x"]), ["gap-x"]);
  assert.deepEqual(matchTaskIds("Committing observer-registry task work 1h 2m 3s", ["observer-registry"]), ["observer-registry"]);
  // The "gap" id must NOT match inside "gap-something" (strict boundary).
  assert.deepEqual(matchTaskIds("Committing gap-something task work 1h 2m 3s", ["gap"]), []);
  // Strict boundary also means "manager" must NOT match inside "manager-layer" (the id is bounded
  // by non-id chars on both sides) — only the full id matches.
  assert.deepEqual(
    matchTaskIds("Execute manager-layer task 2h 24m", ["manager", "manager-layer"]),
    ["manager-layer"],
  );
});

// ── AC1 — bracket cross-reference: closed-bracket line is ENDED, live line is LIVE ──────────────────

test("AC1 — a bracket-closed task's panel line is marked ENDED (not identical to a live line)", () => {
  const v = runStaleCheck(FROZEN_PANE, REPORT);
  const ob = v.first.find((l) => l.verb === "Committing");
  assert.equal(ob.taskId, "observer-registry");
  assert.equal(ob.state, "ended", "observer-registry bracket is closed but the line is present → ENDED");
  const live = v.first.find((l) => l.verb === "Execute");
  assert.equal(live.taskId, "live-task");
  assert.equal(live.state, "live", "live-task is in inProgress → LIVE");
  assert.equal(v.verdict, "STALE");
  assert.deepEqual(v.ended.map((l) => l.raw), ["Committing observer-registry task work 3h 5m 32s"]);
  assert.deepEqual(v.live.map((l) => l.raw), ["Execute live-task task 1h 6m 3s"]);
});

test("AC1 — a clean panel (all lines live) is CLEAN", () => {
  const v = runStaleCheck("  Execute live-task task 1h 6m 3s\n", REPORT);
  assert.equal(v.verdict, "CLEAN");
  assert.equal(v.ended.length, 0);
});

// ── AC2 — frozen-timer: a line whose timer did not advance across two samples is FROZEN ─────────────

test("AC2 — a frozen line (timer identical across two samples) is detected without human sampling", () => {
  const v = runStaleCheck(FROZEN_PANE, REPORT, { afterPaneText: FROZEN_PANE_AFTER });
  // observer-registry timer did not advance (3h 5m 32s in both samples) → frozen.
  assert.ok(v.frozen.some((l) => l.taskId === "observer-registry"), "frozen line detected");
  // live-task timer advanced (1h6m3s → 1h6m37s) → NOT frozen.
  assert.ok(!v.frozen.some((l) => l.taskId === "live-task"), "advancing live line is NOT frozen");
});

test("AC2 — a live line whose timer advanced across two samples is never reported frozen", () => {
  const before = "  Execute live-task task 1h 6m 3s\n";
  const after = "  Execute live-task task 1h 6m 37s\n";
  const v = runStaleCheck(before, REPORT, { afterPaneText: after });
  assert.equal(v.verdict, "CLEAN", "an advancing live line must not be stale");
  assert.equal(v.frozen.length, 0);
});

test("AC2 — a no-timer line is not falsely frozen", () => {
  const v = runStaleCheck("  Waiting for full suite run #3 to complete\n", REPORT, {
    afterPaneText: "  Waiting for full suite run #3 to complete\n",
  });
  assert.equal(v.frozen.length, 0, "no-timer line has no timer to compare → not frozen");
});

test("collectKnownTaskIds — unions every lifecycle section", () => {
  const report = {
    tasks: [{ taskId: "a" }],
    inProgress: [{ taskId: "b" }],
    orphaned: [{ taskId: "c" }],
    reconciled: [{ taskId: "d" }],
    unreliable: [{ taskId: "e" }],
    reconcilable: [{ taskId: "f" }],
  };
  const ids = collectKnownTaskIds(report).sort();
  assert.deepEqual(ids, ["a", "b", "c", "d", "e", "f"]);
});
