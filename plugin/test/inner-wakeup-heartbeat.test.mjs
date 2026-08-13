// @test-group governance
// inner-wakeup-heartbeat.test.mjs — inner 兜底心跳写入方（结构化字段）
// (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract)
//
// The defect: 2026-08-11 05:20 the heartbeat shrank to 3 keys ({ts, delaySeconds, reason}) because the
// writer was an inline python one-liner in the tick-core docs that silently drifted. Manager A3's
// premise is that `.quay/inner-wakeup-heartbeat.json` is the ONLY product answering "what does inner
// need" — without blocked[] the outer cannot tell whether inner is stuck (hard rule 6: absent key =
// not-checked, ≠ no-block). This task replaces the prose writer with a REAL SCRIPT
// (plugin/scripts/inner-wakeup-heartbeat.ts) that writes the FULL structured field set, FAIL-CLOSED:
// it refuses to write a heartbeat missing the checker's required fields, so a shrunk write is
// impossible by construction.
//
// This file pins the WRITER's logic:
//   (a) buildHeartbeat — pure object construction from structured fields;
//   (b) fail-closed write — missing blocked[]/runIds/etc ⇒ exit 1, NOTHING written;
//   (c) write→check round-trip — a file the writer writes satisfies the CHECKER's minimal field
//       contract (inner-wakeup-heartbeat-check.ts) and exits 0.
//
// Run:
//   scripts/test.sh plugin/test/inner-wakeup-heartbeat.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
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

test("buildHeartbeat — builds the full structured shape with ts = nowSec", () => {
  const hb = buildHeartbeat({
    nowSec: 1000,
    blocked: [],
    runIds: ["run-1"],
    effectiveCap: 3,
    agentDispatches: 1,
    budgetHit: false,
  });
  assert.equal(hb.ts, 1000);
  assert.deepEqual(hb.blocked, []);
  assert.deepEqual(hb.runIds, ["run-1"]);
  assert.equal(hb.effectiveCap, 3);
  assert.equal(hb.agentDispatches, 1);
  assert.equal(hb.budgetHit, false);
  assert.equal(hb.delaySeconds, 1500, "delaySeconds defaults to 1500");
  assert.equal(hb.reason, "tick heartbeat", "reason defaults");
  for (const f of REQUIRED_HEARTBEAT_FIELDS) {
    assert.ok(f in hb, `required field ${f} must be present`);
  }
});

test("buildHeartbeat — carries supplemental fields (agentLimit/budgetCritical/reason) when provided", () => {
  const hb = buildHeartbeat({
    nowSec: 1,
    blocked: [],
    runIds: [],
    effectiveCap: 3,
    agentDispatches: 0,
    budgetHit: false,
    agentLimit: 200,
    budgetCritical: true,
    reason: "BUDGET HIT — awaiting outer /clear",
  });
  assert.equal(hb.agentLimit, 200);
  assert.equal(hb.budgetCritical, true);
  assert.equal(hb.reason, "BUDGET HIT — awaiting outer /clear");
});

test("buildHeartbeat — omitting a required field leaves it ABSENT (so the contract check can flag it)", () => {
  const hb = buildHeartbeat({
    nowSec: 1,
    blocked: undefined,
    runIds: [],
    effectiveCap: 3,
    agentDispatches: 0,
    budgetHit: false,
  });
  assert.ok(!("blocked" in hb), "blocked must be absent when not provided");
});

test("AC53 AC1 — buildHeartbeat carries the five dispatch-state keys when provided", () => {
  const hb = buildHeartbeat({
    nowSec: 1,
    blocked: [],
    runIds: [],
    effectiveCap: 3,
    agentDispatches: 1,
    budgetHit: false,
    slotsFree: 5,
    dispatchableDisjoint: 5,
    pool: 16,
    shouldRefill: true,
    noRefillReason: null,
  });
  assert.equal(hb.slots_free, 5);
  assert.equal(hb.dispatchable_disjoint, 5);
  assert.equal(hb.pool, 16);
  assert.equal(hb.should_refill, true);
  assert.equal(hb.no_refill_reason, null);
});

// ── pure: parseJsonArg ───────────────────────────────────────────────────────────────────────────────

test("parseJsonArg — parses JSON arrays/numbers/booleans", () => {
  assert.deepEqual(parseJsonArg("[]", "--blocked"), []);
  assert.deepEqual(parseJsonArg('["a","b"]', "--run-ids"), ["a", "b"]);
  assert.equal(parseJsonArg("3", "--effective-cap"), 3);
  assert.equal(parseJsonArg("true", "--budget-hit"), true);
});

test("parseJsonArg — rejects malformed JSON", () => {
  assert.throws(() => parseJsonArg("not-json", "--blocked"), /must be valid JSON/);
  assert.throws(() => parseJsonArg("", "--blocked"), /requires a value/);
});

// ── CLI: write + fail-closed ─────────────────────────────────────────────────────────────────────────

function runWriter(root, args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", WRITER, "--root", root, ...args], { encoding: "utf8" });
}

function runChecker(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json"], { encoding: "utf8" });
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

test("AC2 CLI — writer writes a full-shape heartbeat (>= 7 keys + AC53 dispatch-state) and exits 0", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-w-"));
  try {
    const r = runWriter(tmp, FULL_ARGS);
    assert.equal(r.status, 0, `writer must exit 0:\n${r.stdout}\n${r.stderr}`);
    const hb = JSON.parse(fs.readFileSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl"), "utf8"));
    assert.ok(Object.keys(hb).length >= 7, `field count ${Object.keys(hb).length} must be >= 7`);
    for (const f of REQUIRED_HEARTBEAT_FIELDS) assert.ok(f in hb, `required field ${f} must be written`);
    for (const f of ["slots_free", "dispatchable_disjoint", "pool", "should_refill", "no_refill_reason"]) {
      assert.ok(f in hb, `AC53 dispatch-state field ${f} must be written`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 CLI — the writer APPENDS: two writes produce two jsonl lines, last line read wins", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-app-"));
  try {
    const r1 = runWriter(tmp, FULL_ARGS);
    assert.equal(r1.status, 0, `first write must exit 0:\n${r1.stdout}\n${r1.stderr}`);
    // Second write with a different delaySeconds — proves append, not overwrite.
    const idxDelay = FULL_ARGS.indexOf("--delay-seconds");
    const secondArgs = [...FULL_ARGS];
    secondArgs[idxDelay + 1] = "1800";
    const r2 = runWriter(tmp, secondArgs);
    assert.equal(r2.status, 0, `second write must exit 0:\n${r2.stdout}\n${r2.stderr}`);
    const lines = fs.readFileSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl"), "utf8")
      .split("\n").filter(Boolean);
    assert.equal(lines.length, 2, `jsonl must have 2 appended lines, got ${lines.length}`);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.delaySeconds, 1800, "the last line must be the second write (append, not overwrite)");
    // Legacy snapshot mirror carries the LAST write too.
    const legacy = JSON.parse(fs.readFileSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.json"), "utf8"));
    assert.equal(legacy.delaySeconds, 1800, "the legacy snapshot mirror must be the last write");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 round-trip — a heartbeat the WRITER writes passes the CHECKER (exit 0 ALIVE)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-rt-"));
  try {
    const w = runWriter(tmp, FULL_ARGS);
    assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
    const c = runChecker(tmp);
    assert.equal(c.status, 0, `checker must accept the writer's output:\n${c.stdout}\n${c.stderr}`);
    const out = JSON.parse(c.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.status, "alive");
    assert.equal(out.fieldContract.ok, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 fail-closed — writer REFUSES (exit 1) a heartbeat missing blocked[], writes NOTHING", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-fc-"));
  try {
    // Drop "--blocked" AND its value (FULL_ARGS[0] / FULL_ARGS[1]).
    const args = FULL_ARGS.filter((_, i) => i !== 0 && i !== 1);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing blocked must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /心跳字段缺失/, "the refusal must name 心跳字段缺失");
    assert.match(r.stderr, /blocked\(缺失\)/, "blocked must be named as missing");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl")), "nothing must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 fail-closed — writer REFUSES a wrong-typed blocked (string), writes NOTHING", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-fc2-"));
  try {
    const args = [...FULL_ARGS];
    args[1] = '"not-an-array"'; // JSON string literal → parseJsonArg yields the string "not-an-array"
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `wrong-typed blocked must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /blocked\(类型错\)/, "blocked must be named as wrong-type");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl")), "nothing must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC53 AC1 fail-closed — writer REFUSES a heartbeat missing the dispatch-state keys, writes NOTHING", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-fc3-"));
  try {
    // Drop "--slots-free" and its value (the 5 dispatch-state flags come after --delay-seconds).
    const idx = FULL_ARGS.indexOf("--slots-free");
    const args = FULL_ARGS.filter((_, i) => i < idx || i >= idx + 10);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing dispatch-state must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /派发状态五键缺失/, "the refusal must name 派发状态五键缺失");
    assert.match(r.stderr, /slots_free\(缺失\)/, "slots_free must be named as missing");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-wakeup-heartbeat.jsonl")), "nothing must be written on refusal");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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

test("AC53 AC2 (gap-ac53-end-invariant-gate) — judgeEndInvariant rejects a heartbeat the writer OVERRIDES away (writer + checker stay consistent)", () => {
  // The writer writes the DIRECT measurement's five keys, so a written heartbeat is checker-ALIVE.
  // On a bare temp dir (no tasks) the DIRECT measurement is should_refill=false — the writer writes
  // it, and the CHECKER must accept it (no false RED).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-rt2-"));
  try {
    const w = runWriter(tmp, FULL_ARGS);
    assert.equal(w.status, 0, `writer must write on a bare temp dir (no dispatchable work):\n${w.stdout}\n${w.stderr}`);
    const c = runChecker(tmp);
    assert.equal(c.status, 0, `checker must accept the writer's DIRECT-measured heartbeat:\n${c.stdout}\n${c.stderr}`);
    const out = JSON.parse(c.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.endInvariant.violated, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
