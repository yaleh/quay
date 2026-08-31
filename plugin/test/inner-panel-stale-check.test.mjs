// @test-group engine
// inner-panel-stale-check.test.mjs — 面板观测机制（状态转换表达）
// (tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close).
//
// The inner Claude TUI panel shows a FROZEN stale agent line after the bracket closed — a
// MISLEADING WINDOW before the panel self-cleans. In that window the frozen dead line is visually
// INDISTINGUISHABLE from a live agent without cross-time sampling (timer advance), so anyone
// glancing reads "agent ran 3h unfinished". Same family as the recurring "instrument can't
// distinguish opposite states" (stuck-vs-running → ended-vs-running).
//
// This file pins the mechanical observer (plugin/scripts/inner-panel-stale-check.ts) that expresses
// the state transition:
//   AC1 — bracket cross-reference: a line whose task is NOT in telemetry `inProgress` (bracket
//         closed) but still present ⇒ ENDED (marked, no longer identical to a live line).
//   AC2 — frozen-timer: two pane samples; a line whose timer did NOT advance ⇒ FROZEN (no human
//         cross-time sampling — the script does the two samples).
//   AC3 — negative control: construct "bracket closed, panel line remains" ⇒ the observer MUST
//         report the line as ended/frozen (exit 1), and a live advancing line must NOT be stale.
//   AC4 — the observer is wired as the panel observation mechanism (state-transition expression).
//
// Run:
//   scripts/test.sh plugin/test/inner-panel-stale-check.test.mjs
//   node --test plugin/test/inner-panel-stale-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  parseTimerSec,
  extractAgentLines,
  matchTaskIds,
  classifyLines,
  detectFrozen,
  runStaleCheck,
  collectKnownTaskIds,
} from "../scripts/inner-panel-stale-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "inner-panel-stale-check.ts");

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

function runCli(pane, after, report, extra = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ipsc-"));
  try {
    const panePath = path.join(tmp, "pane.txt");
    fs.writeFileSync(panePath, pane, "utf8");
    const reportPath = path.join(tmp, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report), "utf8");
    const args = ["--no-warnings", "--experimental-strip-types", CLI, "--pane", panePath];
    if (after != null) {
      const afterPath = path.join(tmp, "after.txt");
      fs.writeFileSync(afterPath, after, "utf8");
      args.push("--after", afterPath);
    }
    args.push("--report", reportPath, ...extra);
    return spawnSync("node", args, { encoding: "utf8" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

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

// ── AC3 — negative control: construct "bracket closed, panel line remains" ⇒ mechanically detected ──

test("AC3 — CLI exit 1 when the frozen/ended line is present (single sample)", () => {
  const r = runCli(FROZEN_PANE, null, REPORT);
  assert.equal(r.status, 1, `bracket-closed line must make the check exit 1:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /observer-registry/, "the stale line must be named");
  assert.match(r.stdout, /STALE/, "the verdict must be STALE");
});

test("AC3 — CLI exit 0 for a clean panel (all live, advancing)", () => {
  const before = "  Execute live-task task 1h 6m 3s\n";
  const after = "  Execute live-task task 1h 6m 37s\n";
  const r = runCli(before, after, REPORT);
  assert.equal(r.status, 0, `clean panel must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /CLEAN/, "the verdict must be CLEAN");
});

test("AC3 — CLI JSON output carries the per-line state machine (live/ended/frozen/stale)", () => {
  const r = runCli(FROZEN_PANE, FROZEN_PANE_AFTER, REPORT, ["--json"]);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.verdict, "STALE");
  assert.ok(j.ended.includes("Committing observer-registry task work 3h 5m 32s"));
  assert.ok(j.frozen.includes("Committing observer-registry task work 3h 5m 32s"));
  assert.ok(j.live.includes("Execute live-task task 1h 6m 3s"));
  const ob = j.agentLines.find((l) => l.taskId === "observer-registry");
  assert.equal(ob.state, "ended");
});

test("AC3 — fail-closed on bad inputs (no pane, no report)", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI], { encoding: "utf8" });
  assert.equal(r.status, 2, "no pane/report must exit 2 (usage)");
});

// ── AC4 — wiring: the observer is the panel observation mechanism (state-transition expression) ────

test("AC4 — the stale-check observer is referenced as the panel observation mechanism", () => {
  const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "loop-driver", "SKILL.md"), "utf8");
  assert.match(skill, /inner-panel-stale-check|面板观测机制|状态转换/, "the loop-driver skill must reference the panel observation mechanism");
});

test("AC4 — collectKnownTaskIds unions every lifecycle section", () => {
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
