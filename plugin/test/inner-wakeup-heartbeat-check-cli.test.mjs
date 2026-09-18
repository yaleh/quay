// @test-group engine
// inner-wakeup-heartbeat-check-cli.test.mjs — the basic checker-CLI verdict group (AC3 freshness / AC2 field contract / A13 甲 refusal freshness), split out of inner-wakeup-heartbeat-check.test.mjs by FUNCTIONAL BOUNDARY
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
//   node --test plugin/test/inner-wakeup-heartbeat-check-cli.test.mjs

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

test("AC3 CLI — fresh full-shape heartbeat exits 0 (ALIVE)", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat());
  try {
    // --in-flight '' (measured zero set) keeps the END invariant judgeable so the fully-evaluated
    // verdict is ALIVE; WITHOUT it the checker reports NOT-EVALUATED (AC1, exit 3).
    const r = runCli(root, ["--in-flight", ""]);
    assert.equal(r.status, 0, `fresh full-shape heartbeat must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /ALIVE/, "stdout must say ALIVE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — stale heartbeat exits 1 and names 兜底心跳断", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 9999 }));
  try {
    const r = runCli(root);
    assert.equal(r.status, 1, `stale heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /inner 兜底心跳断/, "the dead verdict must carry the 兜底心跳断 phrase");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 CLI — missing file exits 1 (fail-closed)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-missing-"));
  try {
    const r = runCli(tmp);
    assert.equal(r.status, 1, `missing heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /MISSING/, "missing verdict must be explicit");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 CLI — custom --max-age-secs makes an old heartbeat ALIVE when under the band", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 10000 }));
  try {
    const r = runCli(root, ["--max-age-secs", "20000", "--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `heartbeat under a wider band must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.maxAgeSecs, 20000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI — --json emits machine-readable verdict", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - 7000 }));
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, "stale → exit 1 even in --json mode");
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "stale");
    assert.equal(out.maxAgeSecs, DEFAULT_MAX_AGE_SECS);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI — fresh but field-shrunk (3 keys, the 2026-08-11 05:20 defect) exits 1 with 心跳字段缺失", () => {
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000),
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root);
    assert.equal(r.status, 1, `field-shrunk fresh heartbeat must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /心跳字段缺失/, "the verdict must name 心跳字段缺失");
    assert.match(r.stdout, /blocked\(缺失\)/, "blocked must be named as missing");
    assert.match(r.stdout, /runIds\(缺失\)/, "runIds must be named as missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI --json — fields-missing carries status + missing list", () => {
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000),
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, "field-shrunk must exit 1 even in --json mode");
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "fields-missing");
    assert.equal(out.reason, FIELDS_MISSING_REASON);
    assert.ok(out.fieldContract.missing.includes("blocked"), "blocked must be in fieldContract.missing");
    assert.ok(out.fieldContract.missing.includes("runIds"), "runIds must be in fieldContract.missing");
    assert.ok(out.fieldContract.fieldCount <= 3, `fieldCount ${out.fieldContract.fieldCount} must be the shrunk 3`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI --json — a full-shape fresh heartbeat is ALIVE with fieldContract.ok true", () => {
  const root = makeRootWithHeartbeat(fullHeartbeat());
  try {
    // --in-flight '' keeps the END invariant judgeable (ALIVE); without it the checker reports
    // NOT-EVALUATED (AC1) — exit 3, but the verdict text differs.
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `full-shape heartbeat must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.status, "alive");
    assert.equal(out.fieldContract.ok, true);
    assert.ok(out.fieldContract.fieldCount >= 7, `fieldCount ${out.fieldContract.fieldCount} must be >= 7`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 CLI — stale heartbeat stays the stale verdict (freshness precedes field contract)", () => {
  // A stale + shrunk heartbeat reports 兜底心跳断 (the dead verdict), not fields-missing.
  const root = makeRootWithHeartbeat({
    ts: Math.floor(Date.now() / 1000) - 9999,
    delaySeconds: 1500,
    reason: "tick heartbeat",
  });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "stale");
    assert.equal(out.reason, "inner-wakeup-heartbeat-dead");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("A13 (甲) CLI --json — the 21:30:10Z negative control: same heartbeat is DEAD without refusals, ALIVE with a recent refusal (AC2 两读数可区分)", () => {
  // The A13 negative-control replay (task Proposal 实证 2026-08-16 21:30:10Z): main heartbeat 3h old
  // (age 10800 > 5400 ⇒ would be DEAD alone), latest refusal 79min ago (age 4740 < 5400 ⇒ ALIVE with
  // the refusal). Relative timestamps keep the test deterministic; the same input (same heartbeat file)
  // gives two distinguishable readings — pre-fix DEAD, post-fix ALIVE.
  const now = Math.floor(Date.now() / 1000);
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: now - 10800 }));
  try {
    // (1) Without the refusals side-carrier — the pre-fix reading — the stale heartbeat is DEAD.
    const r1 = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r1.status, 1, `pre-fix (no refusals) must be DEAD:\n${r1.stdout}\n${r1.stderr}`);
    const out1 = JSON.parse(r1.stdout);
    assert.equal(out1.verdict, "DEAD");
    assert.equal(out1.status, "stale");
    assert.equal(out1.latestRefusalTs, null, "no refusals carrier ⇒ latestRefusalTs null");

    // (2) Now write the refusals side-carrier with a RECENT refusal (79min ago) — the post-fix
    // reading — the same heartbeat is ALIVE via the refusal.
    const quay = path.join(root, ".quay");
    fs.writeFileSync(
      path.join(quay, REFUSAL_FILE),
      `${JSON.stringify({ written: false, ts: now - 4740, refuse_reason: "inner-round-ended-with-dispatchable-work" })}\n`,
      "utf8",
    );
    const r2 = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r2.status, 0, `with a recent refusal the same heartbeat must be ALIVE:\n${r2.stdout}\n${r2.stderr}`);
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.verdict, "ALIVE");
    assert.equal(out2.status, "alive");
    assert.equal(out2.freshnessSource, "refusal", "freshness must be attributed to the refusal");
    assert.equal(out2.latestRefusalTs, now - 4740, "latestRefusalTs must be the refusal row's ts");
    assert.ok(out2.ageSecs >= 4740 && out2.ageSecs < 4800, `age must be ~4740s (got ${out2.ageSecs})`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
