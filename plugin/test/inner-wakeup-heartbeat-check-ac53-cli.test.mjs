// @test-group engine
// inner-wakeup-heartbeat-check-ac53-cli.test.mjs — the AC53 checker-CLI group (dispatch-state contract, end-invariant negative controls, --in-flight wiring), split out of inner-wakeup-heartbeat-check.test.mjs by FUNCTIONAL BOUNDARY
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
//   node --test plugin/test/inner-wakeup-heartbeat-check-ac53-cli.test.mjs

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

test("AC53 AC1 CLI --json — a fresh heartbeat MISSING the dispatch-state keys exits 1 (dispatch-state-missing)", () => {
  const { slots_free, dispatchable_disjoint, pool, should_refill, no_refill_reason, ...withoutDs } = fullHeartbeat();
  const root = makeRootWithHeartbeat(withoutDs);
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, `missing dispatch-state must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "dispatch-state-missing");
    assert.equal(out.reason, "inner-wakeup-heartbeat-dispatch-state-missing");
    assert.ok(out.dispatchStateContract.missing.includes("slots_free"), "slots_free must be named missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 AC2 CLI --json — the 04:02:52Z negative-control heartbeat exits 1 (invariant-violated, AC4)", () => {
  // The real 04:02:52Z reading replayed into the CLI — must light RED. The end-invariant is now judged
  // on the MACHINE's fresh slot-refill, so the workspace must contain a dispatchable task (the machine
  // must agree with the recorded 04:02:52Z shape: should_refill=true). This is the honest replay — not
  // the recorded numbers themselves, but the MACHINE state at that moment.
  const root = makeDispatchableWorkspace("iwuh-0402-");
  try {
    const machine = runMachineSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(machine.ok, true, `machine slot-refill must succeed:\n${machine.error || ""}`);
    assert.equal(machine.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(machine.refill)}`);
    writeHeartbeatTo(root, fullHeartbeat({
      slots_free: 5,
      dispatchable_disjoint: 5,
      pool: 16,
      should_refill: true,
      no_refill_reason: null,
    }));
    // The 04:02:52Z shape recorded in_flight=0 — a MEASURED empty set. --in-flight '' (measured zero)
    // makes the invariant judgeable (the recorded zero is the real set); WITHOUT it the checker reports
    // NOT-EVALUATED (gap-inner-heartbeat-check-not-evaluated-when-no-inflight, AC1).
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 1, `the 04:02:52Z replay must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "invariant-violated");
    assert.equal(out.reason, "inner-round-ended-with-dispatchable-work");
    assert.equal(out.endInvariant.violated, true);
    assert.equal(out.endInvariant.judgedFrom, "machine-slot-refill");
    assert.equal(out.endInvariant.evidence.no_refill_reason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 判据① CLI --json — NEGATIVE CONTROL: machine says no blocking reason + heartbeat records a prose self-report ⇒ checker exits 1 (invariant-violated)", () => {
  // The AC53 bypass live shape (outer 2026-08-13 ruling): heartbeat recorded
  // "no_refill_reason":"ac51 subagent in flight..." (a prose SELF-REPORT) while the machine's fresh
  // slot-refill says no_refill_reason=None. The OLD checker read the heartbeat's recorded field ⇒
  // noReason=false ⇒ PASSED (the structural bypass). The fixed checker judges the MACHINE ⇒ must RED
  // (exit 1), with the recorded prose carried as display-only evidence.
  const root = makeDispatchableWorkspace("iwuh-bypass-");
  try {
    // The negative-control precondition: the machine says should_refill=true + no mechanism reason.
    const machine = runMachineSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(machine.ok, true, `machine slot-refill must succeed:\n${machine.error || ""}`);
    assert.equal(machine.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(machine.refill)}`);
    assert.equal(machine.refill.no_refill_reason, null, "the machine must say no mechanism reason");
    // A heartbeat whose RECORD claims everything is fine — the exact self-report that used to pass.
    writeHeartbeatTo(root, fullHeartbeat({
      no_refill_reason: "ac51 subagent in flight, next dispatch after they land",
      should_refill: false, // the record's own claim — ignored by the gate (the MACHINE is the judge)
    }));
    // --in-flight '' = a MEASURED zero in-flight set (the shape's own recorded in_flight). Without it
    // the checker would report NOT-EVALUATED (AC1 — the touches-overlap-in-flight step needs the set).
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 1, `the bypass shape must exit 1 (the gate refuses):\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "invariant-violated");
    assert.equal(out.reason, "inner-round-ended-with-dispatchable-work");
    assert.equal(out.endInvariant.violated, true);
    assert.equal(out.endInvariant.judgedFrom, "machine-slot-refill");
    assert.equal(out.endInvariant.evidence.no_refill_reason, null, "evidence.no_refill_reason is the MACHINE's null");
    assert.equal(
      out.endInvariant.evidence.recorded_no_refill_reason,
      "ac51 subagent in flight, next dispatch after they land",
      "the recorded prose is display-only evidence, never the judge",
    );
    assert.equal(out.machineSlotRefill.should_refill, true, "the machine's fresh slot-refill is surfaced");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI --json — NO --in-flight + healthy inner (dispatchable work visible to an empty in-flight view) ⇒ NOT-EVALUATED, NOT DEAD", () => {
  // The falsifiable shape (AC2 能取假): a workspace with a REAL dispatchable ready task. Under the old
  // default-empty in-flight, the machine refill said should_refill=true + no_refill_reason=null ⇒ the
  // four-part invariant "held" ⇒ the checker reported constant DEAD. Now, without --in-flight, the
  // touches-overlap-in-flight step cannot be judged ⇒ NOT-EVALUATED (exit 3), never DEAD.
  const root = makeDispatchableWorkspace("iwuh-ne1-");
  try {
    writeHeartbeatTo(root, fullHeartbeat());
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 3, `no-in-flight healthy inner must exit 3 (NOT-EVALUATED), not escalate:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "NOT-EVALUATED", `verdict must be NOT-EVALUATED, got ${out.verdict}`);
    assert.equal(out.status, "end-invariant-not-evaluated");
    assert.equal(out.reason, END_INVARIANT_NOT_EVALUATED_REASON);
    assert.equal(out.endInvariant.evaluated, false);
    assert.equal(out.endInvariant.violated, null);
    assert.equal(out.machineInFlight.source, "none (not provided — end-invariant NOT-EVALUATED)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — WITH --in-flight (a real set) + healthy inner ⇒ ALIVE", () => {
  // Same workspace + a REAL in-flight set that genuinely blocks dispatch (the dispatchable task itself
  // is in flight ⇒ its touches overlap its own self-touch ⇒ it is no longer a candidate ⇒
  // should_refill=false) ⇒ the machine refill is judgeable AND not-violated ⇒ ALIVE.
  const root = makeDispatchableWorkspace("iwuh-ne2-");
  try {
    writeHeartbeatTo(root, fullHeartbeat());
    const r = runCli(root, ["--json", "--in-flight", "gap-fixture-dispatchable"]);
    assert.equal(r.status, 0, `with a real in-flight set the healthy inner must be ALIVE:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.status, "alive");
    assert.equal(out.endInvariant.evaluated, true);
    assert.equal(out.endInvariant.violated, false);
    assert.equal(out.machineSlotRefill.should_refill, false, "the real in-flight set blocks the refill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI --json — WITH --in-flight '' (measured zero) + a REAL invariant violation ⇒ DEAD (real positives not weakened)", () => {
  // --in-flight '' is a MEASURED empty in-flight set (real zero) — the invariant IS judgeable and the
  // machine says the four-part invariant holds (dispatchable work + free slot + no mechanism reason)
  // ⇒ the real violation must still be DEAD. AC3: the fix routes ONLY the unevaluable (no-in-flight)
  // case to NOT-EVALUATED; it never swallows a real positive.
  const root = makeDispatchableWorkspace("iwuh-ne3-");
  try {
    writeHeartbeatTo(root, fullHeartbeat({
      slots_free: 5, dispatchable_disjoint: 5, pool: 16, should_refill: true, no_refill_reason: null,
    }));
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 1, `a real invariant violation with a measured in-flight set must still DEAD:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "invariant-violated");
    assert.equal(out.reason, "inner-round-ended-with-dispatchable-work");
    assert.equal(out.endInvariant.evaluated, true);
    assert.equal(out.endInvariant.violated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
