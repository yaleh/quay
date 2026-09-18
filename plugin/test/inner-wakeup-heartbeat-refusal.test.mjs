// @test-group engine

// inner-wakeup-heartbeat-refusal.test.mjs — the AC53 end-invariant WRITER-REFUSAL half, split out of
// inner-wakeup-heartbeat.test.mjs by FUNCTIONAL BOUNDARY
// (gap-ac281-develop-ci-test-job-wallclock-under-30s).
//
// WHY SPLIT: `node --test` parallelises only ACROSS files — inside one file every test() is serial, so a
// file is the smallest schedulable unit and therefore the suite's floor. The parent file measured 49.0 s
// locally / 29.0 s on the real develop CI run (run 35289055403 `__PERFILE__`), which alone exceeds the
// AC-281 target band. Raising concurrency cannot help (LPT simulation: makespan == longest file at
// 64/128/256/512 alike).
//
// ⛔ SPLIT BY BOUNDARY, NOT BY HALVING A TEST: this shard holds exactly the tests whose subject is the
// writer's REFUSAL semantics (the shapes that must NOT be allowed to write and go back to sleep). It
// shares NO mutable state with the shards it was split from — every test builds its own tmp fixture and
// spawns its own writer process — so parallel and serial runs give byte-identical verdicts.
//
// Run:
//   node --test plugin/test/inner-wakeup-heartbeat-refusal.test.mjs

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

test("AC53 AC2 (gap-ac53-end-invariant-gate) — the 7th-same-shape replay: WRITER REFUSES (exit 1) an END heartbeat while dispatchable work waits, writes NOTHING", () => {
  // The 7th-same-shape (task Proposal): should_refill=true ∧ slots_free=5 ∧ dispatchable>0 ∧
  // no_refill_reason=null — the tick "记录 reason 然后睡" shape. Recording a reason never stopped the
  // sleep; the structural gate must refuse the WRITE itself (exit non-zero), so the caller has NO
  // LEGAL EXIT to reschedule sleep.
  const root = makeDispatchableWorkspace("iwuh-viol-");
  try {
    // Direct re-run MUST see a dispatchable candidate (should_refill=true) — the precondition that
    // makes this a true negative-control replay.
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(direct.refill)}`);
    const violatingArgs = [...FULL_ARGS];
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    violatingArgs[idxShould + 1] = "true";
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    violatingArgs[idxReason + 1] = "null";
    // --in-flight '' (the fixture's empty in-flight set) is already in FULL_ARGS.
    const w = runWriter(root, violatingArgs);
    assert.equal(w.status, 1, `writer must REFUSE the violating end heartbeat:\n${w.stdout}\n${w.stderr}`);
    assert.match(w.stderr, /结束不变式违例/, "the refusal must name 结束不变式违例");
    assert.match(w.stderr, /inner-round-ended-with-dispatchable-work/, "the refusal reason must be end-invariant-violated");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "NOTHING must be written on refusal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 AC2 (gap-ac53-end-invariant-gate) — NEGATIVE CONTROL: a prose --no-refill-reason self-report CANNOT shield a writer refusal when the machine says no mechanism reason", () => {
  // Outer 2026-08-13 ruling (AC53 判据① bypass): the heartbeat's recorded no_refill_reason is
  // SELF-REPORT — the judged party (inner) writes it, so a prose reason could always be written to make
  // the OLD gate's noReason=false. The writer judges the DIRECT machine slot-refill (runDirectSlotRefill
  // with --in-flight), NEVER the args' --no-refill-reason prose: a dispatchable workspace + empty
  // in-flight ⇒ machine says should_refill=true + no_refill_reason=null ⇒ the writer REFUSES regardless
  // of the prose passed — the direct measurement's five keys overwrite the args and nothing is written.
  const root = makeDispatchableWorkspace("iwuh-negprose-");
  try {
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(direct.refill)}`);
    assert.equal(direct.refill.no_refill_reason, null, "the machine must say no mechanism reason");
    const proseArgs = [...FULL_ARGS];
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    proseArgs[idxReason + 1] = "ac51 subagent in flight, next dispatch after they land"; // prose SELF-REPORT
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    proseArgs[idxShould + 1] = "true";
    const w = runWriter(root, proseArgs);
    assert.equal(w.status, 1, `writer must REFUSE despite the prose reason:\n${w.stdout}\n${w.stderr}`);
    assert.match(w.stderr, /结束不变式违例/, "the refusal must name 结束不变式违例");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "NOTHING must be written on refusal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 EXIT:0 捕获（manager 2026-08-13 裁定）— 构造一次拒绝 ⇒ 调用方（spawnSync）看到写入方的非零退出码，未被吞掉", () => {
  // The writer's non-zero exit IS the structural enforcement (gap-ac53-end-invariant-gate): a refusal
  // must be OBSERVABLE by the caller, or the tick could swallow it (`|| true` / pipe / set +e) and
  // sleep anyway. This negative control constructs a rejection (dispatchable work waiting → the
  // end-invariant is violated) and asserts the CALLER sees the child's ACTUAL exit — non-zero, and
  // exactly 1 (the writer's refusal code), with the refusal reason on stderr. The paired control
  // proves the harness distinguishes: the same spawn sees 0 for a legitimate write.
  const root = makeDispatchableWorkspace("iwuh-exit-");
  try {
    // Precondition: the direct slot-refill must see dispatchable work (should_refill=true) so this
    // is a true refusal, not a trivial write.
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 5 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(direct.refill)}`);
    // Construct the rejection: an END heartbeat while dispatchable work waits, with an empty
    // no_refill_reason (the exact 有货不派 shape the AC2 end-invariant flags).
    const violatingArgs = [...FULL_ARGS];
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    violatingArgs[idxShould + 1] = "true";
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    violatingArgs[idxReason + 1] = "null";
    const w = runWriter(root, violatingArgs);
    // THE ASSERTION THE RULING ASKS FOR: the caller sees a NON-ZERO exit — not 0, not swallowed.
    assert.notEqual(w.status, 0, `the caller must observe a non-zero exit on a writer refusal:\n${w.stdout}\n${w.stderr}`);
    assert.equal(w.status, 1, `the refusal exit must be exactly 1 (the writer's refusal code):\n${w.stdout}\n${w.stderr}`);
    assert.match(w.stderr, /结束不变式违例/, "the caller must also see the refusal reason on stderr");
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "NOTHING must be written on refusal");
    // CONTROL (proves the harness is not forcing non-zero): the SAME spawn sees 0 for a legitimate
    // write (bare temp dir → no dispatchable work → should_refill=false → the write proceeds).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-exitctl-"));
    try {
      const ok = runWriter(tmp, FULL_ARGS);
      assert.equal(ok.status, 0, `the same harness must see 0 for a legitimate write:\n${ok.stdout}\n${ok.stderr}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC53 AC2 (gap-ac53-end-invariant-gate) — a legitimately-ending tick (full in-flight, no free slots) WRITES exit 0", () => {
  // Negative control: should_refill=false (no free slots — all 5 slots held by in-flight) is a
  // legitimate end condition; the writer must WRITE (exit 0) with the DIRECT measurement's keys.
  const root = makeWorkspace("iwuh-full-");
  try {
    const inflight = [];
    for (let i = 1; i <= 5; i++) {
      const id = `gap-fixture-inflight-${i}`;
      writeTask(root, id, { status: "ready", body: dispatchableBody([`- tasks/${id}.md`, `- code/f${i}.ts (new)`]) });
      inflight.push(id);
    }
    const args = [...FULL_ARGS];
    const idxInf = args.indexOf("--in-flight");
    args[idxInf + 1] = inflight.join(",");
    const idxSlots = args.indexOf("--slots-free");
    args[idxSlots + 1] = "0";
    const idxShould = args.indexOf("--should-refill");
    args[idxShould + 1] = "false";
    const w = runWriter(root, args);
    assert.equal(w.status, 0, `writer must write a legitimately-ending heartbeat:\n${w.stdout}\n${w.stderr}`);
    const hb = JSON.parse(fs.readFileSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl"), "utf8"));
    assert.equal(hb.should_refill, false, "written dispatch-state must be the DIRECT measurement (should_refill=false)");
    assert.equal(hb.slots_free, 0, "written slots_free must be the DIRECT measurement (0 — all slots held)");
    assert.match(hb.no_refill_reason, /no free slots/, "the written reason must be the mechanism's no-free-slots reason");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
