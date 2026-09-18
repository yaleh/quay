// @test-group engine
// inner-wakeup-heartbeat-check-gate-cli.test.mjs — the AC53-gate checker-CLI group (running-subagents denominator, 能取假 true-sample replay, jsonl-vs-legacy-snapshot precedence), split out of inner-wakeup-heartbeat-check.test.mjs by FUNCTIONAL BOUNDARY
// (gap-ac281-develop-ci-test-job-wallclock-under-30s).
//
// WHY SPLIT: `node --test` parallelises only ACROSS files — inside one file every test() is serial, so a
// file is the smallest schedulable unit and therefore the suite's floor. The parent file measured 49.7 s
// locally / 27.3 s on the real develop CI run (run 35289055403 `__PERFILE__`), which alone exceeds the
// AC-281 target band. Raising concurrency cannot help (LPT simulation: makespan == longest file at
// 64/128/256/512 alike). The cost in this group is real work — nearly every test spawns the checker CLI.
//
// ⛔ SPLIT BY BOUNDARY, NOT BY HALVING A TEST: no test body was edited; the blocks are moved verbatim and
// share NO mutable state (each builds its own tmp fixture and spawns its own process), so parallel and
// serial runs give byte-identical verdicts.
//
// Run:
//   node --test plugin/test/inner-wakeup-heartbeat-check-gate-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_MAX_AGE_SECS,
  FIELDS_MISSING_REASON,
  HEARTBEAT_FILE,
  LEGACY_HEARTBEAT_FILE,
  REFUSAL_FILE,
  MALFORMED,
  MACHINE_UNVERIFIABLE_REASON,
  END_INVARIANT_NOT_EVALUATED_REASON,
  parseHeartbeat,
  judgeHeartbeat,
  readHeartbeatText,
  checkFieldContract,
  REQUIRED_HEARTBEAT_FIELDS,
  REQUIRED_DISPATCH_STATE_FIELDS,
  checkDispatchStateContract,
  judgeEndInvariant,
  judgeEndInvariantAgainstMachine,
  runMachineSlotRefill,
  spawnLimitDetected,
  SPAWN_LIMIT_SIGNAL,
  semanticTriggerHeuristic,
  evaluateTrigger,
  freeTextHash,
  CHECKER_COST_FILE,
  ASSESSMENT_NOT_RUN_REASON,
  parseRecordedAt,
  lastCallRecord,
  judgeAssessmentSteps,
  readLastCallRecord,
  latestRefusalTs,
  readLatestRefusalTs,
  maxFreshnessTs,
  judgeHeartbeatWithRefusal,
} from "../scripts/inner-wakeup-heartbeat-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

// ── CLI integration (spawn the real checker against a temp workspace) ───────────────────────────────

function runCli(root, extra = []) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, ...extra];
  return spawnSync("node", args, { encoding: "utf8" });
}

function makeRootWithHeartbeat(heartbeatObjOrText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-"));
  const quayDir = path.join(tmp, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  const p = path.join(quayDir, HEARTBEAT_FILE);
  const text = typeof heartbeatObjOrText === "string" ? heartbeatObjOrText : JSON.stringify(heartbeatObjOrText);
  fs.writeFileSync(p, text, "utf8");
  return tmp;
}

/** Full contract-compliant heartbeat (the shape the writer must produce since 2026-08-11 + the AC53
 *  dispatch-state five keys since 2026-08-13). Defaults to a NON-violating dispatch state
 *  (should_refill=false + a written reason) so ALIVE fixtures stay ALIVE. */
function fullHeartbeat(overrides = {}) {
  return {
    ts: Math.floor(Date.now() / 1000),
    runIds: ["run-1"],
    blocked: [],
    budgetHit: false,
    effectiveCap: 3,
    agentDispatches: 1,
    delaySeconds: 1500,
    reason: "tick heartbeat",
    // AC53 AC1: the five dispatch-state keys (non-violating default).
    slots_free: 3,
    dispatchable_disjoint: 2,
    pool: 12,
    should_refill: false,
    no_refill_reason: "no dispatchable candidate passes step-4 checks",
    ...overrides,
  };
}

// ── AC53 判据① fixtures (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13) ────────
// The end-invariant gate judges a FRESH machine slot-refill. To make the machine say
// should_refill=true (the negative-control precondition) the workspace needs a REAL dispatchable ready
// task — a bare heartbeat-only temp dir would make the machine say "no dispatchable candidate" (nothing
// to judge). These mirror the writer's fixtures (inner-wakeup-heartbeat.test.mjs).

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), tag));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", body, selfTouch = true } = {}) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  if (selfTouch && body.includes("## Touches") && !body.includes(`- tasks/${id}.md`)) {
    body = body.replace(/(## Touches\n)/, `$1- tasks/${id}.md\n`);
  }
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

/** A C8-clean ready task (self-touch present, `(new)` touches on ABSENT files ⇒ stays dispatchable). */
function dispatchableBody(touches) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = slot-refill stdout slots_free",
    "band      slot = >=0",
    "invoke    node plugin/scripts/slot-refill.ts",
    "control   in-flight>=cap => should_refill false",
    "resume    分步提交",
    "## Touches",
    ...touches,
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

/** A workspace with ONE dispatchable ready task + an empty in-flight set — the AC53 判据① negative-
 *  control precondition (the machine says should_refill=true, no_refill_reason=null). */
function makeDispatchableWorkspace(tag) {
  const root = makeWorkspace(tag);
  writeTask(root, "gap-fixture-dispatchable", {
    status: "ready",
    body: dispatchableBody([
      "- tasks/gap-fixture-dispatchable.md",
      "- code/fixture-a.ts (new)",
      "- code/fixture-b.ts (new)",
    ]),
  });
  return root;
}

/** Write a heartbeat record into <root>/.quay/<HEARTBEAT_FILE> (one jsonl line). */
function writeHeartbeatTo(root, hb) {
  const quayDir = path.join(root, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  fs.writeFileSync(path.join(quayDir, HEARTBEAT_FILE), `${JSON.stringify(hb)}\n`, "utf8");
}

test("AC53-gate 判据1 — runMachineSlotRefill wires `running` to Consumer B (running-subagents)", () => {
  const root = makeDispatchableWorkspace("iwuh-run1-");
  try {
    const m = runMachineSlotRefill({ root, running: [], cap: 5 });
    assert.equal(m.ok, true, `machine slot-refill must succeed:\n${m.error || ""}`);
    assert.equal(m.refill.slot_denominator_source, "running-subagents", "Consumer B must use the narrow running set");
    assert.equal(m.refill.running_subagent_count, 0, "empty running array = MEASURED zero");
    assert.equal(m.refill.slots_free, 5, "cap 5 − 0 running = 5 free");
    // Consumer A stays wide — the dispatchable fixture task is still in the disjoint set.
    assert.ok(m.refill.dispatchable_disjoint > 0, "Consumer A keeps the wide set (dispatchable_disjoint unaffected by running)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate 判据3 (3b) — running undefined (未提供) is DISTINCT from running [] (真零): slot_denominator_source differs", () => {
  const root = makeDispatchableWorkspace("iwuh-run3-");
  try {
    const notProvided = runMachineSlotRefill({ root, cap: 5 });
    assert.equal(notProvided.ok, true, `machine slot-refill must succeed:\n${notProvided.error || ""}`);
    assert.equal(notProvided.refill.slot_denominator_source, "in-flight-fallback", "undefined ⇒ Consumer B falls back to the wide in-flight set");
    assert.equal(notProvided.refill.running_subagent_count, 0, "fallback wide set is empty here ⇒ 0");
    const measuredZero = runMachineSlotRefill({ root, running: [], cap: 5 });
    assert.equal(measuredZero.refill.slot_denominator_source, "running-subagents", "[] ⇒ Consumer B uses the narrow running set (true zero)");
    assert.equal(measuredZero.refill.running_subagent_count, 0, "measured zero running subagents");
    // The two are distinguishable even when the numeric count is identical — "没提供" is never
    // same-shaped as "测得为 0" (hard rule 3b).
    assert.notEqual(notProvided.refill.slot_denominator_source, measuredZero.refill.slot_denominator_source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate 判据2 (能取假) — true-sample replay: 传真集放行 / 不传拒写, same workspace + cap, opposite verdicts", () => {
  const root = makeDispatchableWorkspace("iwuh-run2-");
  try {
    // 不传 running: Consumer B falls back to the wide set ⇒ slots_free=5>0 + the dispatchable
    // fixture task is recommended ⇒ should_refill=true ⇒ the gate REFUSES (violated).
    const wide = runMachineSlotRefill({ root, cap: 5 });
    assert.equal(wide.ok, true, `machine slot-refill must succeed:\n${wide.error || ""}`);
    assert.equal(wide.refill.should_refill, true, `不传 running ⇒ should_refill=true:\n${JSON.stringify(wide.refill)}`);
    assert.equal(wide.refill.slot_denominator_source, "in-flight-fallback");
    const wideInv = judgeEndInvariantAgainstMachine(null, wide.refill);
    assert.equal(wideInv.violated, true, "不传 running ⇒ 闸拒写 (RED)");

    // 传真集: 5 running subagents fill cap 5 ⇒ slots_free=0 ⇒ should_refill=false ⇒ the gate PASSES
    // (the round legitimately has no free slot).
    const narrow = runMachineSlotRefill({ root, running: ["r-1", "r-2", "r-3", "r-4", "r-5"], cap: 5 });
    assert.equal(narrow.ok, true, `machine slot-refill must succeed:\n${narrow.error || ""}`);
    assert.equal(narrow.refill.running_subagent_count, 5, "running set is the Consumer-B denominator");
    assert.equal(narrow.refill.slots_free, 0, "cap 5 − 5 running = 0 free");
    assert.equal(narrow.refill.should_refill, false, "传真集 ⇒ should_refill=false");
    assert.equal(narrow.refill.slot_denominator_source, "running-subagents");
    const narrowInv = judgeEndInvariantAgainstMachine(null, narrow.refill);
    assert.equal(narrowInv.violated, false, "传真集 ⇒ 闸放行");

    // Same second, same machine, two opposite conclusions — the 判据2 replay is RED for the current
    // refusing state and flips on the wiring.
    assert.notEqual(wide.refill.should_refill, narrow.refill.should_refill);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate CLI --json — --running '' surfaces slot_denominator_source running-subagents (vs in-flight-fallback without)", () => {
  const root = makeDispatchableWorkspace("iwuh-clirun-");
  try {
    // The violating end-shape (machine agrees: the fixture task is dispatchable).
    writeHeartbeatTo(root, fullHeartbeat({
      slots_free: 5, dispatchable_disjoint: 5, pool: 16, should_refill: true, no_refill_reason: null,
    }));
    // This test is about the --running (Consumer B) wiring, so both runs supply --in-flight '' (a
    // MEASURED zero in-flight set) to keep the END invariant judgeable — without it the checker would
    // report NOT-EVALUATED (gap-inner-heartbeat-check-not-evaluated-when-no-inflight, AC1).
    // Without --running: Consumer B falls back to the wide in-flight set.
    const r1 = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r1.status, 1, `without --running the violating shape must RED:\n${r1.stdout}\n${r1.stderr}`);
    const out1 = JSON.parse(r1.stdout);
    assert.equal(out1.status, "invariant-violated");
    assert.equal(out1.machineSlotRefill.slot_denominator_source, "in-flight-fallback");
    assert.equal(out1.machineInFlight.runningSource, "none (wide in-flight fallback)");
    assert.equal(out1.machineInFlight.runningIds, null);
    // With --running '' (measured zero): Consumer B uses the narrow running set — the violating
    // shape is still RED (slots_free=3>0 at the heartbeat's effectiveCap 3), but the JSON proves the
    // narrow denominator is being used (判据3: --running '' is a TRUE zero, not "not provided").
    const r2 = runCli(root, ["--json", "--running", "", "--in-flight", ""]);
    assert.equal(r2.status, 1, `with --running '' the violating shape still RED:\n${r2.stdout}\n${r2.stderr}`);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.status, "invariant-violated");
    assert.equal(out2.machineSlotRefill.slot_denominator_source, "running-subagents");
    assert.equal(out2.machineSlotRefill.running_subagent_count, 0);
    assert.equal(out2.machineInFlight.runningSource, "--running");
    assert.deepEqual(out2.machineInFlight.runningIds, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 AC3 CLI — a legacy `.json` snapshot (pre-AC53 format) is still read via the fallback", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-legacy-"));
  try {
    const quay = path.join(tmp, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    // Write ONLY the legacy .json (no jsonl) — the checker must fall back to it.
    fs.writeFileSync(path.join(quay, LEGACY_HEARTBEAT_FILE), JSON.stringify(fullHeartbeat(), null, 2), "utf8");
    // --in-flight '' keeps the END invariant judgeable (ALIVE); without it the checker reports
    // NOT-EVALUATED (AC1).
    const r = runCli(tmp, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `legacy .json fallback must be ALIVE:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.dispatchStateContract.ok, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC53 AC3 CLI — when BOTH exist, the jsonl LAST line wins over the legacy snapshot", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-both-"));
  try {
    const quay = path.join(tmp, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    // Legacy snapshot: violating shape (would be RED if read).
    fs.writeFileSync(path.join(quay, LEGACY_HEARTBEAT_FILE), JSON.stringify(fullHeartbeat({
      slots_free: 5, dispatchable_disjoint: 5, pool: 16, should_refill: true, no_refill_reason: null,
    }), null, 2), "utf8");
    // jsonl with a NON-violating last line — the checker must read THIS, not the legacy.
    fs.writeFileSync(path.join(quay, HEARTBEAT_FILE), `${JSON.stringify(fullHeartbeat({ slots_free: 2, should_refill: false }))}\n`, "utf8");
    // --in-flight '' keeps the END invariant judgeable (ALIVE); without it the checker reports
    // NOT-EVALUATED (AC1).
    const r = runCli(tmp, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `jsonl last line must win:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.endInvariant.violated, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
