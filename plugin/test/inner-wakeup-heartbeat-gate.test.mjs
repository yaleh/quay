// @test-group engine

// inner-wakeup-heartbeat-gate.test.mjs — the AC53 end-invariant GATE half (AC1 direct measurement, the
// running-set gate 判据1/判据4, judgeEndInvariant writer/checker consistency), split out of
// inner-wakeup-heartbeat.test.mjs by FUNCTIONAL BOUNDARY
// (gap-ac281-develop-ci-test-job-wallclock-under-30s).
//
// WHY SPLIT: same reason as the refusal shard — see inner-wakeup-heartbeat-refusal.test.mjs's header.
// The parent file's single-file floor is the suite's floor (node --test parallelises only across files).
//
// ⛔ No test body was edited; the blocks are moved verbatim.
//
// Run:
//   node --test plugin/test/inner-wakeup-heartbeat-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  REFUSAL_FILE,
  LEGACY_HEARTBEAT_FILE,
  REQUIRED_HEARTBEAT_FIELDS,
  judgeEndInvariant,
} from "../scripts/inner-wakeup-heartbeat-check.ts";
import { buildHeartbeat, parseJsonArg, runDirectSlotRefill } from "../scripts/inner-wakeup-heartbeat.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WRITER = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat.ts");
const CHECKER = path.join(repoRoot, "plugin", "scripts", "inner-wakeup-heartbeat-check.ts");

// ── fixture helpers (mirror slot-refill.test.mjs — a REAL workspace so the writer's DIRECT
//    slot-refill re-run sees a dispatchable pool) ────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), tag));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, body, selfTouch = true } = {}) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    "extra:",
    "  schema: v1",
    "---",
  ].filter((x) => x !== null).join("\n");
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

/** A workspace with ONE dispatchable ready task + an empty in-flight set — the 7th-same-shape
 *  precondition (should_refill=true, free slots, dispatchable work, empty reason). */
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

// ── pure: buildHeartbeat ──────────────────────────────────────────────────────────────────────────────



// ── CLI: write + fail-closed ─────────────────────────────────────────────────────────────────────────

function runWriter(root, args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", WRITER, "--root", root, ...args], { encoding: "utf8" });
}

function runChecker(root, extraArgs = []) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...extraArgs], { encoding: "utf8" });
}

const FULL_ARGS = [
  "--blocked", "[]",
  "--run-ids", '["run-1"]',
  "--effective-cap", "3",
  "--agent-dispatches", "1",
  "--budget-hit", "false",
  // AC53 AC1 (gap-ac53-end-invariant-gate): the session's in-flight set is REQUIRED. The bare temp
  // dirs below have no tasks/ store ⇒ the writer's DIRECT slot-refill re-run reads an empty pool ⇒
  // should_refill=false ⇒ the end-invariant gate passes (no dispatchable work) and the write proceeds.
  "--in-flight", "",
  "--delay-seconds", "1500",
  // AC53 AC1: the five dispatch-state keys (should_refill=false ⇒ the round-trip checker verdict is
  // ALIVE — no AC2 end-invariant violation).
  "--slots-free", "3",
  "--dispatchable-disjoint", "2",
  "--pool", "12",
  "--should-refill", "false",
  "--no-refill-reason", "no dispatchable candidate passes step-4 checks",
  "--reason", "tick heartbeat",
];

test("AC53 AC1 (gap-ac53-end-invariant-gate) — writer REFUSES (exit 1) when --in-flight is omitted (cannot verify the end-invariant)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-noinf-"));
  try {
    // Drop "--in-flight" and its value (the pair right after --budget-hit / before --delay-seconds).
    const idx = FULL_ARGS.indexOf("--in-flight");
    const args = FULL_ARGS.filter((_, i) => i < idx || i >= idx + 2);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing --in-flight must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--in-flight 必填/, "the refusal must name --in-flight 必填");
    assert.match(r.stderr, /end-invariant-gate-requires-in-flight/, "the refusal reason must be end-invariant-gate-requires-in-flight");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl")), "NOTHING must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC53 AC1 (gap-ac53-end-invariant-gate) — runDirectSlotRefill returns the DIRECT measurement from a real workspace", () => {
  const root = makeDispatchableWorkspace("iwuh-direct-");
  try {
    const r = runDirectSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.refill.should_refill, true, "a free-slot + dispatchable fixture must say should_refill=true");
    assert.ok(r.refill.slots_free > 0, `slots_free must be > 0 (got ${r.refill.slots_free})`);
    assert.ok(r.refill.dispatchable_disjoint >= 1, `dispatchable_disjoint must be >= 1 (got ${r.refill.dispatchable_disjoint})`);
    assert.equal(r.refill.no_refill_reason, null, "should_refill=true carries no reason (the mechanism's null)");
    // judgeEndInvariant on the DIRECT result must report the violation.
    const inv = judgeEndInvariant(r.refill);
    assert.equal(inv.violated, true, "the direct result must violate the end-invariant");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate 判据1 — passing --running makes the gate PASS when the real running subagents fill the cap (awaiting-retry no longer occupies slots)", () => {
  const root = makeDispatchableWorkspace("iwuh-fix-");
  try {
    // The direct re-run at the writer's effective cap (3, from FULL_ARGS) must be dispatchable.
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 3 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable at cap 3:\n${JSON.stringify(direct.refill)}`);
    // The violating end-shape: dispatchable work waits + no mechanism reason.
    const violatingArgs = [...FULL_ARGS];
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    violatingArgs[idxShould + 1] = "true";
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    violatingArgs[idxReason + 1] = "null";
    // WITHOUT --running the gate REFUSES (the pre-fix state — Consumer B reads the wide set).
    const w1 = runWriter(root, violatingArgs);
    assert.equal(w1.status, 1, `without --running the gate must REFUSE:\n${w1.stdout}\n${w1.stderr}`);
    assert.match(w1.stderr, /结束不变式违例/, "the refusal must name 结束不变式违例");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "nothing written on refusal");
    // WITH --running (3 real running subagents fill the effective cap 3 ⇒ slots_free=0 ⇒
    // should_refill=false) the gate PASSES — the heartbeat is written (判据2: 传真集放行).
    const passingArgs = [...violatingArgs, "--running", "r-1,r-2,r-3"];
    const w2 = runWriter(root, passingArgs);
    assert.equal(w2.status, 0, `with --running the gate must PASS:\n${w2.stdout}\n${w2.stderr}`);
    const hb = JSON.parse(fs.readFileSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl"), "utf8"));
    assert.equal(hb.should_refill, false, "the written heartbeat carries the DIRECT measurement's should_refill=false");
    assert.equal(hb.slots_free, 0, "the written heartbeat carries slots_free=0 (cap 3 − 3 running)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate 判据4 — a refused write leaves a {written:false, refuse_reason} trace on the side-carrier", () => {
  const root = makeDispatchableWorkspace("iwuh-ac4-");
  try {
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 3 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(direct.refill)}`);
    const violatingArgs = [...FULL_ARGS];
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    violatingArgs[idxShould + 1] = "true";
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    violatingArgs[idxReason + 1] = "null";
    // Negative control (判据4 ⊢): BEFORE the refused write the side-carrier has ZERO rows.
    const refusalPath = path.join(root, ".quay", REFUSAL_FILE);
    assert.ok(!fs.existsSync(refusalPath), "pre-fix: zero written:false rows");
    const w = runWriter(root, violatingArgs);
    assert.equal(w.status, 1, `writer must REFUSE:\n${w.stdout}\n${w.stderr}`);
    assert.match(w.stderr, /结束不变式违例/, "the refusal must name 结束不变式违例");
    // Post-refusal: the side-carrier has exactly ONE {written:false, refuse_reason} row.
    assert.ok(fs.existsSync(refusalPath), "the refusal must leave a trace on the side-carrier");
    const rows = fs.readFileSync(refusalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(rows.length, 1, "exactly one refusal row");
    assert.equal(rows[0].written, false, "the refusal row must carry written:false");
    assert.equal(rows[0].refuse_reason, "inner-round-ended-with-dispatchable-work", "the refusal reason must be recorded");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "the heartbeat jsonl still has NO write (refusal ≠ heartbeat)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53-gate 判据4 — the --in-flight-omitted refusal ALSO leaves a written:false trace (end-invariant-gate-requires-in-flight)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-ac4b-"));
  try {
    const idx = FULL_ARGS.indexOf("--in-flight");
    const args = FULL_ARGS.filter((_, i) => i < idx || i >= idx + 2);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing --in-flight must be refused:\n${r.stdout}\n${r.stderr}`);
    const refusalPath = path.join(tmp, ".quay", REFUSAL_FILE);
    assert.ok(fs.existsSync(refusalPath), "the --in-flight-omitted refusal must also leave a trace");
    const rows = fs.readFileSync(refusalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(rows.length, 1, "exactly one refusal row");
    assert.equal(rows[0].written, false, "the refusal row must carry written:false");
    assert.equal(rows[0].refuse_reason, "end-invariant-gate-requires-in-flight", "the refusal reason must be recorded");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC53 AC2 (gap-ac53-end-invariant-gate) — judgeEndInvariant rejects a heartbeat the writer OVERRIDES away (writer + checker stay consistent)", () => {
  // The writer writes the DIRECT measurement's five keys, so a written heartbeat is checker-ALIVE.
  // On a bare temp dir (no tasks) the DIRECT measurement is should_refill=false — the writer writes
  // it, and the CHECKER must accept it (no false RED).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-rt2-"));
  try {
    const w = runWriter(tmp, FULL_ARGS);
    assert.equal(w.status, 0, `writer must write on a bare temp dir (no dispatchable work):\n${w.stdout}\n${w.stderr}`);
    // Round-trip consistency (AC53 AC2): mirror the writer's empty in-flight set to the checker so the
    // END invariant is judgeable (no in-flight ⇒ NOT-EVALUATED per gap-inner-heartbeat-check-not-evaluated-when-no-inflight AC1).
    const c = runChecker(tmp, ["--in-flight", ""]);
    assert.equal(c.status, 0, `checker must accept the writer's DIRECT-measured heartbeat:\n${c.stdout}\n${c.stderr}`);
    const out = JSON.parse(c.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.endInvariant.violated, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
