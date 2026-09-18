// @test-group engine
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
    // Round-trip consistency: the writer recorded an empty in-flight set (FULL_ARGS' --in-flight ""),
    // so the checker is given that same set to keep the END invariant judgeable (no in-flight ⇒
    // NOT-EVALUATED per gap-inner-heartbeat-check-not-evaluated-when-no-inflight AC1).
    const c = runChecker(tmp, ["--in-flight", ""]);
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

test("A13 (乙) — a refused END-invariant write ALSO updates the legacy .json snapshot (written:false + refuse_reason), jsonl stays pure", () => {
  const root = makeDispatchableWorkspace("iwuh-a13w-");
  try {
    const direct = runDirectSlotRefill({ root, inFlightIds: [], cap: 3 });
    assert.equal(direct.ok, true, "direct slot-refill must succeed");
    assert.equal(direct.refill.should_refill, true, `fixture must be dispatchable:\n${JSON.stringify(direct.refill)}`);
    const violatingArgs = [...FULL_ARGS];
    const idxShould = FULL_ARGS.indexOf("--should-refill");
    violatingArgs[idxShould + 1] = "true";
    const idxReason = FULL_ARGS.indexOf("--no-refill-reason");
    violatingArgs[idxReason + 1] = "null";
    const w = runWriter(root, violatingArgs);
    assert.equal(w.status, 1, `writer must REFUSE:\n${w.stdout}\n${w.stderr}`);
    assert.match(w.stderr, /结束不变式违例/, "the refusal must name 结束不变式违例");
    // The legacy .json snapshot now carries the refusal — the main product shows "active but refused".
    const legacyPath = path.join(root, ".quay", LEGACY_HEARTBEAT_FILE);
    assert.ok(fs.existsSync(legacyPath), `the legacy .json must be updated on refusal (${legacyPath})`);
    const snap = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    assert.equal(snap.written, false, "the snapshot must carry written:false");
    assert.equal(snap.refuse_reason, "inner-round-ended-with-dispatchable-work", "the snapshot must carry refuse_reason");
    assert.ok(typeof snap.ts === "number", "the snapshot must carry a ts");
    assert.ok(Math.abs(snap.ts - Math.floor(Date.now() / 1000)) < 60, `the snapshot ts must be the refusal time (fresh), got ${snap.ts}`);
    // The full structured heartbeat fields are preserved so legacy readers see a complete record.
    for (const f of REQUIRED_HEARTBEAT_FIELDS) {
      assert.ok(f in snap, `structured field ${f} must be present in the refusal snapshot`);
    }
    // The jsonl stays pure: NO write on refusal (only the side-carrier + legacy snapshot).
    assert.ok(!fs.existsSync(path.join(root, ".quay", "inner-wakeup-heartbeat.jsonl")), "the heartbeat jsonl must have NO write on refusal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("A13 (乙) — the --in-flight-omitted refusal ALSO updates the legacy .json snapshot", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-a13w2-"));
  try {
    const idx = FULL_ARGS.indexOf("--in-flight");
    const args = FULL_ARGS.filter((_, i) => i < idx || i >= idx + 2);
    const r = runWriter(tmp, args);
    assert.equal(r.status, 1, `missing --in-flight must be refused:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--in-flight 必填/, "the refusal must name --in-flight 必填");
    const legacyPath = path.join(tmp, ".quay", LEGACY_HEARTBEAT_FILE);
    assert.ok(fs.existsSync(legacyPath), "the legacy .json must be updated on refusal");
    const snap = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    assert.equal(snap.written, false, "the snapshot must carry written:false");
    assert.equal(snap.refuse_reason, "end-invariant-gate-requires-in-flight", "the refusal reason must be recorded");
    assert.ok(typeof snap.ts === "number", "the snapshot must carry a fresh ts");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
