// @test-group governance
// inner-wakeup-heartbeat-check.test.mjs — inner 兜底心跳产物检查器（外层读）
// (tasks/gap-inner-wakeup-heartbeat-invisible)
//
// The defect: ScheduleWakeup reschedule (inner's FALLBACK heartbeat) lived only inside the inner
// transcript — a 15.3h-dead heartbeat (last 2026-08-09T15:17:27Z) was invisible until a human asked
// a third time and the manager grepped the transcript for ScheduleWakeup tool_use timestamps.
// C17 (rules need PRODUCTS, not visibility): "the last ScheduleWakeup moment" needs a
// mechanically-readable, checkable product. Fix: inner writes `.quay/inner-wakeup-heartbeat.json`
// ({ts, delaySeconds, reason}) every time it reschedules ScheduleWakeup (same shape as
// suite-chain-heartbeat.json, the A2 heartbeat precedent); the OUTER tick reads it and judges
// freshness (age > 3 tick periods ⇒ "inner 兜底心跳断" + escalate).
//
// This file pins BOTH:
//   (a) the checker's LOGIC (plugin/scripts/inner-wakeup-heartbeat-check.ts) — hermetic pure-function
//       tests + CLI exit-code tests (fresh ⇒ 0, stale/missing/malformed/fields-missing ⇒ 1);
//   (b) the DOC-CONTRACT wiring — fast-mode-tick-core.md B3 + fast-mode-loop-tick.md step 6 must carry
//       the WRITE instruction (inner writes the product on every reschedule), and
//       orchestrator-tick-core.md A 段 must carry the READ+judge invocation.
//
// Field-contract extension (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract): since
// 2026-08-11 the checker ALSO enforces the minimal field contract (AC2) — a FRESH heartbeat must carry
// the structured keys ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds; missing
// key ⇒ "心跳字段缺失" + exit 1. reason prose may supplement but never replace the structured fields
// (AC3). The CLI fixtures therefore use the FULL structured shape (fullHeartbeat) for ALIVE cases, and
// the shrunk 3-key shape is the RED case — it is the exact defect this task fixes.
//
// Run:
//   scripts/test.sh plugin/test/inner-wakeup-heartbeat-check.test.mjs

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

test("judgeHeartbeat — fresh heartbeat is ALIVE (AC3: 判新鲜)", () => {
  const v = judgeHeartbeat(1000, { ts: 900 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, true);
  assert.equal(v.status, "alive");
  assert.equal(v.ageSecs, 100);
  assert.equal(v.reason, "heartbeat-fresh");
});

test("judgeHeartbeat — exactly at the boundary (age == max) is still ALIVE", () => {
  const v = judgeHeartbeat(5400, { ts: 0 }, 5400);
  assert.equal(v.alive, true, "age == max-age must not trip the dead verdict");
  assert.equal(v.ageSecs, 5400);
});

test("judgeHeartbeat — age > 3 tick periods (5400s) ⇒ DEAD / inner 兜底心跳断 (AC3)", () => {
  const v = judgeHeartbeat(5401, { ts: 0 }, 5400);
  assert.equal(v.alive, false);
  assert.equal(v.status, "stale");
  assert.equal(v.ageSecs, 5401);
  assert.equal(v.reason, "inner-wakeup-heartbeat-dead");
});

test("judgeHeartbeat — future ts (clock skew) clamps to 0 = ALIVE, not a false dead", () => {
  const v = judgeHeartbeat(100, { ts: 200 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, true);
  assert.equal(v.ageSecs, 0);
});

test("judgeHeartbeat — missing heartbeat ⇒ DEAD (fail-closed, product absence IS the failure) (AC3)", () => {
  const v = judgeHeartbeat(1000, null, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, false);
  assert.equal(v.status, "missing");
  assert.equal(v.reason, "inner-wakeup-heartbeat-missing");
});

test("judgeHeartbeat — malformed heartbeat (no valid ts) ⇒ DEAD (AC3 fail-closed)", () => {
  assert.equal(judgeHeartbeat(1000, MALFORMED, DEFAULT_MAX_AGE_SECS).alive, false);
  assert.equal(judgeHeartbeat(1000, MALFORMED, DEFAULT_MAX_AGE_SECS).status, "malformed");
  // Direct call with a non-conforming object is treated as malformed too.
  const v = judgeHeartbeat(1000, { delaySeconds: 1500 }, DEFAULT_MAX_AGE_SECS);
  assert.equal(v.alive, false);
  assert.equal(v.status, "malformed");
});

test("parseHeartbeat — parses the documented {ts, delaySeconds, reason} shape (AC2 schema)", () => {
  const v = parseHeartbeat('{"ts":1786349702,"delaySeconds":1500,"reason":"tick heartbeat"}');
  assert.deepEqual(v, { ts: 1786349702, delaySeconds: 1500, reason: "tick heartbeat" });
  assert.equal(parseHeartbeat(null), null, "missing text → null");
  assert.equal(parseHeartbeat(""), null, "empty text → null");
  assert.equal(parseHeartbeat("{ not json"), MALFORMED, "unparsable → MALFORMED");
  assert.equal(parseHeartbeat('{"delaySeconds":1500}'), MALFORMED, "missing ts → MALFORMED");
});

test("DEFAULT_MAX_AGE_SECS = 3 tick periods × 1800s (Contract band `<= 5400`)", () => {
  assert.equal(DEFAULT_MAX_AGE_SECS, 3 * 1800);
});

// ── A13 (gap-a13-heartbeat-refusal-write-invisible, 甲) — judge 判新鲜取 max(主 json ts, refusals) ─
// The AC53 END-INVARIANT gate refuses a write when dispatchable work waits — a refusal is liveness
// evidence (inner tried to END the round and the gate pushed it back to dispatch). The judge reads the
// refusals side-carrier and takes the max ts so an active-but-refused inner is never misread as DEAD.

test("A13 (甲) — latestRefusalTs parses the refusals jsonl text and returns the LATEST valid ts", () => {
  const text = [
    JSON.stringify({ written: false, ts: 1000, refuse_reason: "x" }),
    "not json", // malformed line skipped (hard rule 6: not a recorded time)
    JSON.stringify({ written: false, ts: 2000, refuse_reason: "y" }),
  ].join("\n");
  assert.equal(latestRefusalTs(text), 2000, "the latest valid ts must win");
  assert.equal(latestRefusalTs(null), null);
  assert.equal(latestRefusalTs(""), null);
  assert.equal(latestRefusalTs('{"written":true}'), null, "no ts ⇒ null");
  assert.equal(latestRefusalTs("not json"), null, "all-malformed ⇒ null");
});

test("A13 (甲) — readLatestRefusalTs reads the side-carrier file (null when absent)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iwuh-rts-"));
  try {
    assert.equal(readLatestRefusalTs(tmp), null, "no carrier ⇒ null");
    const quay = path.join(tmp, ".quay");
    fs.mkdirSync(quay, { recursive: true });
    fs.writeFileSync(path.join(quay, REFUSAL_FILE), `${JSON.stringify({ written: false, ts: 500, refuse_reason: "x" })}\n`, "utf8");
    assert.equal(readLatestRefusalTs(tmp), 500);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("A13 (甲) — maxFreshnessTs = max(heartbeat ts, latest refusal ts)", () => {
  assert.equal(maxFreshnessTs({ ts: 100 }, 200), 200, "refusal newer ⇒ refusal ts wins");
  assert.equal(maxFreshnessTs({ ts: 300 }, 200), 300, "heartbeat newer ⇒ heartbeat ts wins");
  assert.equal(maxFreshnessTs({ ts: 100 }, null), 100, "no refusals ⇒ heartbeat ts");
  assert.equal(maxFreshnessTs(null, 200), 200, "no heartbeat ⇒ refusal ts");
  assert.equal(maxFreshnessTs(null, null), null, "neither ⇒ null");
  assert.equal(maxFreshnessTs(MALFORMED, 200), 200, "malformed heartbeat ⇒ refusal ts still counts");
  assert.equal(maxFreshnessTs({}, null), null, "heartbeat without ts + no refusals ⇒ null");
});

test("A13 (甲) — judgeHeartbeatWithRefusal: a recent refusal keeps a stale main heartbeat ALIVE (freshnessSource=refusal)", () => {
  // The A13 negative-control ratio (task Proposal 实证 2026-08-16 21:30:10Z): main heartbeat 3h old
  // (age 10800 > 5400 ⇒ DEAD alone), latest refusal 79min ago (age 4740 < 5400 ⇒ ALIVE with refusal).
  const now = 10000;
  const v = judgeHeartbeatWithRefusal(now, { ts: now - 10800 }, now - 4740, 5400);
  assert.equal(v.alive, true, `recent refusal must keep it ALIVE:\n${JSON.stringify(v)}`);
  assert.equal(v.status, "alive");
  assert.equal(v.ageSecs, 4740);
  assert.equal(v.freshnessSource, "refusal", "the freshness must be attributed to the refusal");
});

test("A13 (甲) — judgeHeartbeatWithRefusal: no refusals + stale heartbeat ⇒ DEAD (unchanged)", () => {
  const v = judgeHeartbeatWithRefusal(10000, { ts: 0 }, null, 5400);
  assert.equal(v.alive, false);
  assert.equal(v.status, "stale");
  assert.equal(v.reason, "inner-wakeup-heartbeat-dead");
});

test("A13 (甲) — judgeHeartbeatWithRefusal: fresh heartbeat + older refusal ⇒ ALIVE (freshnessSource=heartbeat)", () => {
  const now = 10000;
  const v = judgeHeartbeatWithRefusal(now, { ts: now - 60 }, now - 5000, 5400);
  assert.equal(v.alive, true);
  assert.equal(v.status, "alive");
  assert.equal(v.freshnessSource, "heartbeat");
});

test("A13 (甲) — judgeHeartbeatWithRefusal: BOTH stale ⇒ DEAD (a stale refusal is not liveness)", () => {
  const now = 10000;
  const v = judgeHeartbeatWithRefusal(now, { ts: 0 }, 100, 5400);
  assert.equal(v.alive, false);
  assert.equal(v.status, "stale");
});

test("A13 (甲) — judgeHeartbeatWithRefusal: missing heartbeat + recent refusal ⇒ ALIVE (a refused write IS a write attempt)", () => {
  const now = 10000;
  const v = judgeHeartbeatWithRefusal(now, null, now - 60, 5400);
  assert.equal(v.alive, true, `a fresh refusal alone proves liveness:\n${JSON.stringify(v)}`);
  assert.equal(v.status, "alive");
  assert.equal(v.freshnessSource, "refusal");
});

// ── minimal field contract (AC2/AC3 — tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract) ─

test("AC2 — REQUIRED_HEARTBEAT_FIELDS = the Contract's 7 structured keys (heartbeat_field_count >= 7)", () => {
  assert.deepEqual(REQUIRED_HEARTBEAT_FIELDS, [
    "ts", "runIds", "blocked", "budgetHit", "effectiveCap", "agentDispatches", "delaySeconds",
  ]);
  assert.equal(REQUIRED_HEARTBEAT_FIELDS.length, 7);
});

test("AC2 — checkFieldContract passes a full-shape heartbeat (all 7 required keys present)", () => {
  const c = checkFieldContract(fullHeartbeat());
  assert.equal(c.ok, true, `full shape must satisfy the contract:\n${JSON.stringify(c)}`);
  assert.equal(c.requiredPresent, 7);
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.wrongType, []);
  assert.ok(c.fieldCount >= 7, `fieldCount ${c.fieldCount} must be >= 7`);
});

test("AC2 — checkFieldContract flags a heartbeat missing blocked[] (A3 判卡住的前提)", () => {
  const { blocked, ...withoutBlocked } = fullHeartbeat(); // omit the key entirely (undefined ≠ missing)
  const c = checkFieldContract(withoutBlocked);
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("blocked"), `blocked must be reported missing:\n${JSON.stringify(c.missing)}`);
  assert.equal(c.requiredPresent, 6);
});

test("AC2 — checkFieldContract flags missing runIds + effectiveCap together", () => {
  const { runIds, effectiveCap, ...without } = fullHeartbeat();
  const c = checkFieldContract(without);
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("runIds"), "runIds must be reported missing");
  assert.ok(c.missing.includes("effectiveCap"), "effectiveCap must be reported missing");
});

test("AC3 — prose does NOT replace the structured fields: a {ts, delaySeconds, reason} heartbeat is RED", () => {
  // The exact 2026-08-11 05:20 shrink — fresh (ts present) but missing every structured key.
  const c = checkFieldContract({ ts: 1786349702, delaySeconds: 1500, reason: "tick heartbeat" });
  assert.equal(c.ok, false, "reason prose must not substitute for structured fields");
  for (const f of ["runIds", "blocked", "budgetHit", "effectiveCap", "agentDispatches"]) {
    assert.ok(c.missing.includes(f), `${f} must be missing`);
  }
  assert.equal(c.requiredPresent, 2, "only ts + delaySeconds are present");
});

test("AC2 — checkFieldContract flags a wrong-typed blocked (string instead of array)", () => {
  const c = checkFieldContract(fullHeartbeat({ blocked: "not-an-array" }));
  assert.equal(c.ok, false);
  assert.ok(c.wrongType.includes("blocked"), `blocked must be wrongType:\n${JSON.stringify(c.wrongType)}`);
});

test("AC2 — checkFieldContract on null/missing heartbeat reports ALL required fields missing", () => {
  const c = checkFieldContract(null);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, REQUIRED_HEARTBEAT_FIELDS);
  assert.equal(c.fieldCount, 0);
});

// ── AC53 dispatch-state contract + end-invariant (gap-inner-self-wake-sleep-empty-slots-not-dispatch) ─

test("AC53 AC1 — REQUIRED_DISPATCH_STATE_FIELDS = the five dispatch-state keys", () => {
  assert.deepEqual(REQUIRED_DISPATCH_STATE_FIELDS, [
    "slots_free", "dispatchable_disjoint", "pool", "should_refill", "no_refill_reason",
  ]);
});

test("AC53 AC1 — checkDispatchStateContract passes a full-shape heartbeat (all five present)", () => {
  const c = checkDispatchStateContract(fullHeartbeat());
  assert.equal(c.ok, true, `full shape must satisfy the dispatch-state contract:\n${JSON.stringify(c)}`);
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.wrongType, []);
});

test("AC53 AC1 — checkDispatchStateContract flags a heartbeat missing slots_free", () => {
  const { slots_free, ...without } = fullHeartbeat();
  const c = checkDispatchStateContract(without);
  assert.equal(c.ok, false);
  assert.ok(c.missing.includes("slots_free"), `slots_free must be missing:\n${JSON.stringify(c.missing)}`);
});

test("AC53 AC1 — checkDispatchStateContract flags a wrong-typed should_refill (string instead of boolean)", () => {
  const c = checkDispatchStateContract(fullHeartbeat({ should_refill: "true" }));
  assert.equal(c.ok, false);
  assert.ok(c.wrongType.includes("should_refill"), `should_refill must be wrongType:\n${JSON.stringify(c.wrongType)}`);
});

test("AC53 AC2 — judgeEndInvariant: the 04:02:52Z negative-control shape MUST violate (AC4 sample 1)", () => {
  // The real 04:02:52Z reading (task Proposal): should_refill=true, slots_free=5,
  // dispatchable_disjoint=5, pool=16, in_flight=0, no_refill_reason=null — a round that ended with
  // dispatchable work remaining (the inner 满池自选长睡). This shape NEVER lit red before; the
  // record couldn't even express the question. It must now report RED.
  const v = judgeEndInvariant(fullHeartbeat({
    slots_free: 5,
    dispatchable_disjoint: 5,
    pool: 16,
    should_refill: true,
    no_refill_reason: null,
  }));
  assert.equal(v.violated, true, `04:02:52Z shape must violate:\n${JSON.stringify(v)}`);
  assert.equal(v.reason, "inner-round-ended-with-dispatchable-work");
  assert.equal(v.evidence.slots_free, 5);
});

test("AC53 AC2 — judgeEndInvariant: the 04:22Z negative-control shape MUST violate (AC4 sample 2)", () => {
  // The second real sample (inner idle 19min / should_refill=true / slots_free=5 / in-flight=0 /
  // pool=20=floor). Pairs with sample 1 so "修后不再复现" has a control.
  const v = judgeEndInvariant(fullHeartbeat({
    slots_free: 5,
    dispatchable_disjoint: 5,
    pool: 20,
    should_refill: true,
    no_refill_reason: null,
  }));
  assert.equal(v.violated, true, `04:22Z shape must violate:\n${JSON.stringify(v)}`);
});

test("AC53 AC2 — judgeEndInvariant: the 07:13 fifth negative-control shape MUST violate (AC4 sample 5, outer 裁定 2026-08-13)", () => {
  // Fifth sample (outer 裁定, 定性=延迟派发): inner heartbeat 07:13:42 fresh, runIds still 1, no new
  // worktree; re-run with --in-flight: should_refill=True · slots_free=4 · dispatchable=10 ·
  // recommended=4 · no_refill_reason=None — awake, looking at these numbers, no reason, dispatched 0
  // at the time (07:21-22 finally dispatched 2 ⇒ delayed dispatch). The first four samples each had a
  // WRONG reason recorded / the fourth's reason was blocked; THIS one shows even an explicit outer
  // prompt-drive didn't work — only structural enforcement (dispatch loop) remains.
  const v = judgeEndInvariant(fullHeartbeat({
    slots_free: 4,
    dispatchable_disjoint: 10,
    pool: 0,
    should_refill: true,
    no_refill_reason: null,
  }));
  assert.equal(v.violated, true, `07:13 shape must violate:\n${JSON.stringify(v)}`);
  assert.equal(v.reason, "inner-round-ended-with-dispatchable-work");
  assert.equal(v.evidence.dispatchable_disjoint, 10);
});

test("AC53 AC2 — judgeEndInvariant: the 07:13 sixth-sample negative-control shape MUST violate (AC4 sample 6, manager 提供 2026-08-13)", () => {
  // Sixth sample (manager 提供, fan-in 前加, "刚派完 2 条、仍有 2 空槽 2 推荐、然后睡 1500s"):
  // should_refill=True · slots_free=2 · in_flight=3 · dispatchable=10 · recommended=2 ·
  // no_refill_reason=None. Excludes "它不知道有货" (recommended explicitly lists 2) AND excludes "需要
  // 解释" (just dispatched 2, leaving 2 free slots + work + no reason = invariant binary violation).
  // 判据① is red AT THIS MOMENT (ending a round still leaving free slots + work + no reason) — the only
  // sample that needs no explanation to see the violation and excludes unawareness.
  const v = judgeEndInvariant(fullHeartbeat({
    slots_free: 2,
    dispatchable_disjoint: 10,
    pool: 0,
    should_refill: true,
    no_refill_reason: null,
  }));
  assert.equal(v.violated, true, `sixth-sample shape must violate:\n${JSON.stringify(v)}`);
  assert.equal(v.reason, "inner-round-ended-with-dispatchable-work");
  assert.equal(v.evidence.slots_free, 2);
  assert.equal(v.evidence.dispatchable_disjoint, 10);
});

test("AC53 AC2 — judgeEndInvariant: the six-moment acceptance replay (04:25/04:48/06:40/07:05/07:13/sixth) — the numeric shapes available today (04:02:52Z/04:22Z/07:13/sixth) all violate", () => {
  // 判据① must be RED all six times — any not-red = invariant written too narrow. The coordinator +
  // manager named the six moments (04:25 / 04:48 / 06:40 / 07:05 / 07:13 / sixth sample); the documented
  // numeric shapes are 04:02:52Z (task Proposal), 04:22Z (task Proposal), 07:13 (outer 裁定) and the
  // sixth sample (manager 提供). Each carries the same violating shape: should_refill=true + free slots
  // + dispatchable disjoint > 0 + empty reason.
  const shapes = [
    { slots_free: 5, dispatchable_disjoint: 5, pool: 16, should_refill: true, no_refill_reason: null },   // 04:02:52Z
    { slots_free: 5, dispatchable_disjoint: 5, pool: 20, should_refill: true, no_refill_reason: null },   // 04:22Z
    { slots_free: 4, dispatchable_disjoint: 10, pool: 0, should_refill: true, no_refill_reason: null },   // 07:13
    { slots_free: 2, dispatchable_disjoint: 10, pool: 0, should_refill: true, no_refill_reason: null },   // sixth (manager)
  ];
  for (const s of shapes) {
    const v = judgeEndInvariant(fullHeartbeat(s));
    assert.equal(v.violated, true, `shape must violate (should_refill=${s.should_refill} slots_free=${s.slots_free} dd=${s.dispatchable_disjoint} reason=${JSON.stringify(s.no_refill_reason)}):\n${JSON.stringify(v)}`);
  }
});

test("AC53 AC2 — judgeEndInvariant: should_refill=false is NOT a violation (nothing dispatchable)", () => {
  const v = judgeEndInvariant(fullHeartbeat({ should_refill: false, slots_free: 5, dispatchable_disjoint: 5, no_refill_reason: null }));
  assert.equal(v.violated, false, "should_refill=false means no go — not a violation");
});

test("AC53 AC2 — judgeEndInvariant: should_refill=true WITH a written no_refill_reason is NOT a violation", () => {
  const v = judgeEndInvariant(fullHeartbeat({
    should_refill: true,
    slots_free: 5,
    dispatchable_disjoint: 5,
    no_refill_reason: ".halt sentinel present",
  }));
  assert.equal(v.violated, false, "a written no_refill_reason satisfies the invariant (either continue OR write a reason)");
});

test("AC53 AC2 — judgeEndInvariant: should_refill=true but slots_free=0 is NOT a violation", () => {
  const v = judgeEndInvariant(fullHeartbeat({ should_refill: true, slots_free: 0, dispatchable_disjoint: 5, no_refill_reason: null }));
  assert.equal(v.violated, false, "no free slot is a legitimate end condition");
});

// ── AC53 判据① gate (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13 ruling) ─────
// The end-invariant MUST be judged on the MACHINE's fresh slot-refill output, never the heartbeat's
// recorded no_refill_reason (the judged party's self-report — a prose reason could always be written
// to make the old gate's noReason=false ⇒ structural bypass, hard rule 4b).

test("AC53 判据① — NEGATIVE CONTROL: machine says no blocking reason (should_refill=true, no_refill_reason=None, slots_free>0, dispatchable>0) + heartbeat carries a prose self-report ⇒ gate MUST refuse (violated)", () => {
  // Manager 2026-08-13 requirement 2. The AC53 bypass live shape: heartbeat recorded
  // "no_refill_reason":"ac51 subagent in flight..." (a prose SELF-REPORT) while the machine's
  // slot-refill said no_refill_reason=None. The OLD checker judged the heartbeat's field ⇒ noReason=
  // false ⇒ passed. The fixed gate judges the MACHINE ⇒ the prose is display-only and cannot make a
  // violating machine state pass.
  const machine = { should_refill: true, slots_free: 5, dispatchable_disjoint: 5, pool: 16, no_refill_reason: null };
  const heartbeat = fullHeartbeat({
    no_refill_reason: "ac51 subagent in flight, next dispatch after they land",
    should_refill: false, // the heartbeat's OWN claim is irrelevant — the MACHINE is the judge
  });
  const v = judgeEndInvariantAgainstMachine(heartbeat, machine);
  assert.equal(v.violated, true, `prose self-report must NOT shield a pass when the machine says no mechanism reason:\n${JSON.stringify(v)}`);
  assert.equal(v.judgedFrom, "machine-slot-refill");
  assert.equal(v.evidence.no_refill_reason, null, "evidence.no_refill_reason is the MACHINE's null");
  assert.equal(v.evidence.recorded_no_refill_reason, "ac51 subagent in flight, next dispatch after they land", "the recorded prose is display-only evidence");
  assert.equal(v.evidence.recorded_should_refill, false, "the recorded should_refill is display-only");
});

test("AC53 判据① — judgeEndInvariantAgainstMachine passes when the MACHINE says a legitimate mechanism reason (the heartbeat's recorded field is irrelevant)", () => {
  // Control: the machine's fresh slot-refill says no free slots (a real mechanism reason) ⇒ NOT a
  // violation — even though the heartbeat's recorded no_refill_reason is null (which under the OLD
  // recorded-shape gate would have been RED). The machine is the authority in BOTH directions.
  const machine = { should_refill: false, slots_free: 0, dispatchable_disjoint: 0, pool: 5, no_refill_reason: "no free slots (in-flight 5 >= cap 5)" };
  const heartbeat = fullHeartbeat({ no_refill_reason: null });
  const v = judgeEndInvariantAgainstMachine(heartbeat, machine);
  assert.equal(v.violated, false, "a machine-stated reason is a legitimate end condition");
  assert.equal(v.ok, true);
  assert.equal(v.evidence.no_refill_reason, "no free slots (in-flight 5 >= cap 5)", "the machine's reason is the judged value");
});

test("AC53 判据① — judgeEndInvariantAgainstMachine REDs a violating MACHINE state even when the heartbeat records a fully compliant self-report", () => {
  // The strongest bypass shape: the heartbeat RECORD claims "should_refill=false + a written reason"
  // (a perfectly compliant record under the OLD gate) while the MACHINE says should_refill=true +
  // no reason. The fixed gate must still refuse — the record's self-consistency proves nothing.
  const machine = { should_refill: true, slots_free: 4, dispatchable_disjoint: 10, pool: 0, no_refill_reason: null };
  const heartbeat = fullHeartbeat(); // compliant default: should_refill=false + a written reason
  const v = judgeEndInvariantAgainstMachine(heartbeat, machine);
  assert.equal(v.violated, true, "a compliant-looking self-report must NOT shield a violating machine state");
});

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
    // verdict is ALIVE; WITHOUT it the checker reports NOT-EVALUATED (AC1, exit 0).
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
    // NOT-EVALUATED (AC1) — still exit 0, but the verdict text differs.
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

// ── AC53 CLI statuses (gap-inner-self-wake-sleep-empty-slots-not-dispatch) ───────────────────────────

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

// ── NOT-EVALUATED end-invariant (gap-inner-heartbeat-check-not-evaluated-when-no-inflight) ───────────
// AC1 (hard rule 3b): the checker run WITHOUT --in-flight cannot judge the touches-overlap-in-flight
// step ⇒ the END invariant is UNEVALUABLE ⇒ it must report NOT-EVALUATED (an INDEPENDENT value carrying
// evaluated:false, non-escalating exit 0) — NOT the constant false DEAD. DEAD stays reserved for real
// violations (in-flight set provided AND the four-part invariant holds).

test("AC2 CLI --json — NO --in-flight + healthy inner (dispatchable work visible to an empty in-flight view) ⇒ NOT-EVALUATED, NOT DEAD", () => {
  // The falsifiable shape (AC2 能取假): a workspace with a REAL dispatchable ready task. Under the old
  // default-empty in-flight, the machine refill said should_refill=true + no_refill_reason=null ⇒ the
  // four-part invariant "held" ⇒ the checker reported constant DEAD. Now, without --in-flight, the
  // touches-overlap-in-flight step cannot be judged ⇒ NOT-EVALUATED (exit 0), never DEAD.
  const root = makeDispatchableWorkspace("iwuh-ne1-");
  try {
    writeHeartbeatTo(root, fullHeartbeat());
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 0, `no-in-flight healthy inner must NOT escalate:\n${r.stdout}\n${r.stderr}`);
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

// ── AC53-gate running-set wiring (tasks/gap-ac53-gate-not-wired-to-running-set) ───────────────────────
// 判据1: runMachineSlotRefill now accepts a `running` param wired to slot-refill's Consumer B
// (slots_free / should_refill); Consumer A (dispatchable_disjoint) stays on the wide in-flight view.
// 判据2 (能取假): the true-sample replay — the SAME workspace + cap give OPPOSITE gate verdicts when
// the gate passes its observed running set vs when it doesn't (传真集放行 / 不传拒写).
// 判据3 (3b): `running: undefined` (未提供) is DISTINCT from `running: []` (测得真零) — never
// same-shaped.

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

// ── AC77 spawn-limit detection (gap-ac77-spawn-limit-detect-harness-error-only) ─────────────────────
// AC77 判据1: detect the harness's OWN spawn-limit error string in the free text (transcript grep per
// CLAUDE.md:21), NOT a self-maintained agentDispatches/agentLimit count. AC77 判据2: the old count
// criterion is RETIRED (R29). AC77 判据3: report-only — no /clear, no cap-lowering, no restart.
// AC77 判据4 (3b): the real harness string below is the true-sample replay (verbatim from
// tasks/gap-inner-subagent-budget-invisible.md:21, the 2026-08-10T05:13:13 tool_result).

/** The real harness spawn-limit error string (verbatim from gap-inner-subagent-budget-invisible.md:21). */
const SPAWN_LIMIT_SAMPLE =
  "Subagent spawn limit reached (200 of 200 agents spawned). Complete the remaining work directly with your tools instead of spawning more agents.";

test("AC77 判据1 — SPAWN_LIMIT_SIGNAL is the harness's own error string", () => {
  assert.equal(SPAWN_LIMIT_SIGNAL, "Subagent spawn limit reached");
});

test("AC77 判据1 — spawnLimitDetected fires on the real harness spawn-limit string (true-sample replay)", () => {
  assert.equal(spawnLimitDetected(SPAWN_LIMIT_SAMPLE), true, "the real harness string must be detected");
  assert.equal(spawnLimitDetected(SPAWN_LIMIT_SIGNAL), true, "the bare signal string itself must be detected");
  assert.equal(spawnLimitDetected("tick heartbeat — suite running"), false, "a normal tick must not fire");
});

test("AC77 判据1 — spawnLimitDetected is case-insensitive (lowercase transcript grep still matches)", () => {
  assert.equal(spawnLimitDetected("inner transcript: subagent spawn limit reached (200 of 200)"), true);
});

test("AC77 判据2 — the old count criterion is RETIRED: semanticTriggerHeuristic no longer fires on a self-counted agentDispatches>=agentLimit (hard rule 4b)", () => {
  // The old shape that used to trigger (blocked=[] + agentDispatches>=agentLimit) must NOT trigger now —
  // a self-maintained counter cannot judge a harness-managed budget (it stops exactly when the failure
  // occurs ⇒ indistinguishable from "normal"). This is also the negative-control fixture for 判据2.
  assert.equal(
    semanticTriggerHeuristic({ blocked: [], agentDispatches: 201, agentLimit: 200 }),
    false,
    "the retired count criterion must not fire",
  );
  // The permanently-false live shape (agentLimit=undefined — the AC77 现状 red sample):
  assert.equal(
    semanticTriggerHeuristic({ blocked: [], agentDispatches: 15, agentLimit: undefined }),
    false,
    "agentLimit=undefined 恒假判据已退役（现成红样本）",
  );
  assert.equal(semanticTriggerHeuristic({ blocked: ["merge-conflict"], agentDispatches: 201, agentLimit: 200 }), false);
  assert.equal(semanticTriggerHeuristic(null), false);
});

test("AC77 判据1 — semanticTriggerHeuristic fires on the free-text harness string, and reads a heartbeat's reason", () => {
  assert.equal(semanticTriggerHeuristic(SPAWN_LIMIT_SAMPLE), true, "the real harness string in free text must trigger");
  // Heartbeat-object call-site compat: its `reason` is read.
  assert.equal(semanticTriggerHeuristic({ reason: SPAWN_LIMIT_SAMPLE }), true);
  assert.equal(semanticTriggerHeuristic({ reason: "tick heartbeat — suite running" }), false);
});

test("AC77 判据3 — report-only: the trigger is a pure boolean; it never /clears, lowers cap, or restarts", () => {
  // The trigger surface is a PURE function — no side effects, no state mutation, no process control.
  // The post-trip action (handling) is the human's (人 2026-08-14 07:4xZ).
  const before = { blocked: [], agentDispatches: 15, agentLimit: undefined, reason: "tick heartbeat" };
  const r = semanticTriggerHeuristic({ ...before, reason: SPAWN_LIMIT_SAMPLE });
  assert.equal(r, true);
  assert.deepEqual(before, { blocked: [], agentDispatches: 15, agentLimit: undefined, reason: "tick heartbeat" }, "the input is untouched — no action taken");
});

test("AC77 判据1 — evaluateTrigger fires on the spawn-limit string without any hash baseline (trigger is not 'every round')", () => {
  const t = evaluateTrigger({ blocked: [] }, SPAWN_LIMIT_SAMPLE, null);
  assert.equal(t.fired, true);
  assert.equal(t.heuristic, true);
  assert.equal(t.hashChanged, false, "no prev-hash ⇒ hashChanged must be false");
});

test("AC77 判据1 — evaluateTrigger: unchanged hash + no spawn-limit string ⇒ NOT triggered (not every round)", () => {
  const text = "tick heartbeat — suite running";
  const h = freeTextHash(text);
  const t = evaluateTrigger({ blocked: [] }, text, h);
  assert.equal(t.fired, false, "same hash + no spawn-limit ⇒ no trigger");
  assert.equal(t.hashChanged, false);
  assert.equal(t.heuristic, false);
});

// ── I1 read-product criterion (tasks/gap-inner-assessment-steps-no-product-reader) ──────────────────
// 判据1: three dispatch-evaluation freshness signals (heartbeat jsonl ts + slot-refill call record +
// ready-pool call record); a STALE ready-pool/slot-refill call record ⇒ "inner 派发评估未跑".
// 判据2 (能取假): the 07:41–12:2x absence window replays RED (heartbeat 4.7h / ready-pool 4.2h /
// slot-refill 2.7h stale). Hard rule 3b: a step with no call record in an ABSENT ledger reports
// NOT-EVALUATED — a distinct value, never a fake pass or a fake fail.

test("I1 — parseRecordedAt parses the checker-cost `at` ISO timestamp into epoch seconds", () => {
  // 2026-08-14T13:01:28.955Z — one of the real checker-cost.jsonl rows in the main checkout.
  const epoch = parseRecordedAt("2026-08-14T13:01:28.955Z");
  assert.equal(typeof epoch, "number", `must parse to epoch seconds, got ${epoch}`);
  assert.ok(epoch > 1786600000, `must be a 2026 epoch (~17866xxxxxx), got ${epoch}`);
  // The exact back-conversion round-trips.
  assert.equal(new Date(epoch * 1000).toISOString().slice(0, 19), "2026-08-14T13:01:28");
  assert.equal(parseRecordedAt(null), null, "non-string → null");
  assert.equal(parseRecordedAt("not-a-date"), null, "unparsable → null");
  assert.equal(parseRecordedAt(""), null, "empty → null");
});

test("I1 — lastCallRecord returns the LAST (newest) row for a name; null when absent", () => {
  const rows = [
    { name: "ready-pool-check", at: "2026-08-14T08:08:35Z", n: 6 },
    { name: "ready-pool-check", at: "2026-08-14T13:01:28.955Z", n: 6 },
    { name: "slot-refill", at: "2026-08-14T09:39:12Z" },
  ];
  const rp = lastCallRecord(rows, "ready-pool-check");
  assert.equal(rp.atRaw, "2026-08-14T13:01:28.955Z", "the LAST row wins (append-ordered ledger)");
  assert.equal(parseRecordedAt(rp.atRaw), parseRecordedAt("2026-08-14T13:01:28.955Z"));
  const sr = lastCallRecord(rows, "slot-refill");
  assert.equal(sr.atRaw, "2026-08-14T09:39:12Z");
  assert.equal(lastCallRecord(rows, "cap-from-gate"), null, "unknown name → null");
  assert.equal(lastCallRecord([], "ready-pool-check"), null, "empty rows → null");
  // A row without `at` is skipped (malformed row ≠ a recorded time).
  const malformed = [{ name: "ready-pool-check" }, { name: "ready-pool-check", at: "2026-08-14T13:01:00Z" }];
  assert.equal(lastCallRecord(malformed, "ready-pool-check").atRaw, "2026-08-14T13:01:00Z");
});

test("I1 — judgeAssessmentSteps: fresh ready-pool + fresh slot-refill ⇒ ok (assessment ran)", () => {
  const now = 1786716000;
  const a = judgeAssessmentSteps(now, {
    heartbeat: { ts: now - 60 },
    readyPool: { atEpoch: now - 120, atRaw: "x" },
    slotRefill: { atEpoch: now - 90, atRaw: "y" },
  }, DEFAULT_MAX_AGE_SECS);
  assert.equal(a.ok, true, `fresh assessment must pass:\n${JSON.stringify(a)}`);
  assert.deepEqual(a.stale, []);
  assert.equal(a.status, "assessment-steps-ok");
  assert.equal(a.reason, null);
  assert.equal(a.signals.readyPool.status, "fresh");
  assert.equal(a.signals.slotRefill.status, "fresh");
  assert.equal(a.signals.heartbeat.status, "fresh");
});

test("I1 — judgeAssessmentSteps: stale ready-pool call record ⇒ RED (inner 派发评估未跑)", () => {
  const now = 1786716000;
  const a = judgeAssessmentSteps(now, {
    heartbeat: { ts: now - 60 }, // heartbeat FRESH — the case the old checker missed
    readyPool: { atEpoch: now - 4.2 * 3600, atRaw: "2026-08-14T08:08:35Z" },
    slotRefill: { atEpoch: now - 90, atRaw: "y" },
  }, DEFAULT_MAX_AGE_SECS);
  assert.equal(a.ok, false, `stale ready-pool must RED:\n${JSON.stringify(a)}`);
  assert.deepEqual(a.stale, ["ready-pool"]);
  assert.equal(a.status, "assessment-steps-stale");
  assert.equal(a.reason, ASSESSMENT_NOT_RUN_REASON);
  assert.equal(a.signals.readyPool.status, "stale");
  assert.equal(a.signals.slotRefill.status, "fresh");
});

test("I1 — judgeAssessmentSteps: stale slot-refill call record alone ⇒ RED", () => {
  const now = 1786716000;
  const a = judgeAssessmentSteps(now, {
    heartbeat: { ts: now - 60 },
    readyPool: { atEpoch: now - 90, atRaw: "y" },
    slotRefill: { atEpoch: now - 2.7 * 3600, atRaw: "2026-08-14T09:39:12Z" },
  }, DEFAULT_MAX_AGE_SECS);
  assert.equal(a.ok, false);
  assert.deepEqual(a.stale, ["slot-refill"]);
  assert.equal(a.reason, ASSESSMENT_NOT_RUN_REASON);
});

test("I1 — judgeAssessmentSteps: no call records (ledger absent) is NOT-EVALUATED, not a fake fail (hard rule 3b)", () => {
  const now = 1786716000;
  const a = judgeAssessmentSteps(now, {
    heartbeat: { ts: now - 60 },
    readyPool: null,
    slotRefill: null,
  }, DEFAULT_MAX_AGE_SECS);
  assert.equal(a.ok, true, "no ledger to evaluate from must not fake a fail");
  assert.deepEqual(a.stale, [], "not-recorded ≠ stale");
  assert.equal(a.signals.readyPool.status, "not-recorded");
  assert.equal(a.signals.slotRefill.status, "not-recorded");
  assert.equal(a.signals.heartbeat.status, "fresh");
});

test("I1 — judgeAssessmentSteps: the 07:41 absence shape (all three stale) is RED (判据2 replay)", () => {
  // The 07:41–12:2x absence window (I1): heartbeat last 07:41:43 (4.7h), ready-pool last 08:08:35
  // (4.2h), slot-refill last 09:39:12 (2.7h) — now ≈ 12:25. Replayed with relative offsets so the
  // test is deterministic regardless of wall-clock.
  const now = 1786716000;
  const a = judgeAssessmentSteps(now, {
    heartbeat: { ts: now - 4.7 * 3600, atRaw: "" },
    readyPool: { atEpoch: now - 4.2 * 3600, atRaw: "2026-08-14T08:08:35Z" },
    slotRefill: { atEpoch: now - 2.7 * 3600, atRaw: "2026-08-14T09:39:12Z" },
  }, DEFAULT_MAX_AGE_SECS);
  assert.equal(a.ok, false, `07:41 absence shape must RED:\n${JSON.stringify(a)}`);
  assert.ok(a.stale.includes("ready-pool"), "ready-pool 4.2h stale must be named");
  assert.ok(a.stale.includes("slot-refill"), "slot-refill 2.7h stale must be named");
  assert.equal(a.reason, ASSESSMENT_NOT_RUN_REASON);
});

// ── I1 CLI fixtures + integration ───────────────────────────────────────────────────────────────────

/** Write a checker-cost.jsonl ledger (one jsonl line per record) into <root>/.quay/. */
function writeCheckerCostTo(root, records) {
  const quayDir = path.join(root, ".quay");
  fs.mkdirSync(quayDir, { recursive: true });
  fs.writeFileSync(
    path.join(quayDir, CHECKER_COST_FILE),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
}

/** A root with a heartbeat + a checker-cost ledger at the given relative staleness offsets. */
function makeRootWithAssessment({ heartbeatAgeSecs, readyPoolAgeSecs, slotRefillAgeSecs }) {
  const root = makeRootWithHeartbeat(fullHeartbeat({ ts: Math.floor(Date.now() / 1000) - heartbeatAgeSecs }));
  const now = Date.now();
  const iso = (ageSecs) => new Date(now - ageSecs * 1000).toISOString();
  const records = [];
  if (readyPoolAgeSecs != null) {
    records.push({ name: "ready-pool-check", ms: 3007, n: 6, load: 9.01, at: iso(readyPoolAgeSecs) });
  }
  if (slotRefillAgeSecs != null) {
    records.push({ name: "slot-refill", ms: 120, n: 1, load: 9.01, at: iso(slotRefillAgeSecs) });
  }
  if (records.length > 0) writeCheckerCostTo(root, records);
  return root;
}

test("I1 CLI --json — the 07:41 absence replay (all three stale) exits 1 with inner 派发评估未跑 (判据2)", () => {
  // Replay the 07:41–12:2x absence window: heartbeat 4.7h, ready-pool 4.2h, slot-refill 2.7h stale.
  const root = makeRootWithAssessment({ heartbeatAgeSecs: 4.7 * 3600, readyPoolAgeSecs: 4.2 * 3600, slotRefillAgeSecs: 2.7 * 3600 });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, `07:41 absence replay must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "assessment-steps-stale");
    assert.equal(out.reason, ASSESSMENT_NOT_RUN_REASON);
    assert.ok(out.assessmentSteps.stale.includes("ready-pool"), "ready-pool must be in stale");
    assert.ok(out.assessmentSteps.stale.includes("slot-refill"), "slot-refill must be in stale");
    assert.equal(out.assessmentSteps.signals.readyPool.status, "stale");
    assert.equal(out.assessmentSteps.signals.slotRefill.status, "stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("I1 CLI — the 07:41 absence replay names 派发评估未跑 in human output", () => {
  const root = makeRootWithAssessment({ heartbeatAgeSecs: 4.7 * 3600, readyPoolAgeSecs: 4.2 * 3600, slotRefillAgeSecs: 2.7 * 3600 });
  try {
    const r = runCli(root);
    assert.equal(r.status, 1, `human output must exit 1:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /inner 派发评估未跑/, "the human verdict must name 派发评估未跑");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("I1 CLI --json — fresh all three (heartbeat + ready-pool + slot-refill) exits 0 (GREEN)", () => {
  const root = makeRootWithAssessment({ heartbeatAgeSecs: 60, readyPoolAgeSecs: 120, slotRefillAgeSecs: 90 });
  try {
    // --in-flight '' keeps the END invariant judgeable (ALIVE); without it the checker reports
    // NOT-EVALUATED (AC1).
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `fresh assessment must exit 0:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.assessmentSteps.status, "assessment-steps-ok");
    assert.equal(out.assessmentSteps.signals.readyPool.status, "fresh");
    assert.equal(out.assessmentSteps.signals.slotRefill.status, "fresh");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("I1 CLI --json — heartbeat FRESH but ready-pool call record STALE exits 1 (the discriminating case the old checker missed)", () => {
  // The exact shape the existing heartbeat freshness check could NOT see: inner awake (heartbeat
  // fresh) but the ready-pool assessment stopped 4.2h ago.
  const root = makeRootWithAssessment({ heartbeatAgeSecs: 60, readyPoolAgeSecs: 4.2 * 3600, slotRefillAgeSecs: 90 });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, `fresh-heartbeat-but-stale-ready-pool must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "DEAD");
    assert.equal(out.status, "assessment-steps-stale");
    assert.deepEqual(out.assessmentSteps.stale, ["ready-pool"]);
    assert.equal(out.assessmentSteps.signals.heartbeat.status, "fresh");
    assert.equal(out.assessmentSteps.signals.readyPool.status, "stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("I1 CLI --json — a fresh heartbeat with NO checker-cost ledger is GREEN with NOT-EVALUATED signals (3b)", () => {
  // A workspace that only writes the heartbeat (e.g. a fresh checkout) must NOT be RED on the
  // assessment criterion alone — the ledger is absent so the evaluation-steps are NOT-EVALUATED,
  // a distinct value from both "fresh" and "stale".
  const root = makeRootWithHeartbeat(fullHeartbeat());
  try {
    // --in-flight '' keeps the END invariant judgeable (ALIVE); without it the checker reports
    // NOT-EVALUATED (AC1) — the "NOT-EVALUATED" this test asserts is the I1 assessment-step signals.
    const r = runCli(root, ["--json", "--in-flight", ""]);
    assert.equal(r.status, 0, `no ledger must not fake a fail:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, "ALIVE");
    assert.equal(out.assessmentSteps.status, "assessment-steps-ok");
    assert.equal(out.assessmentSteps.signals.readyPool.status, "not-recorded");
    assert.equal(out.assessmentSteps.signals.slotRefill.status, "not-recorded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("I1 CLI --json — an existing ledger with a stale ready-pool but NO slot-refill rows is RED (ready-pool is the 必跑 step)", () => {
  // The real world: checker-cost.jsonl exists (737 ready-pool rows), slot-refill has no rows (it does
  // not self-record yet). ready-pool staleness alone must fire even with slot-refill not-recorded.
  const root = makeRootWithAssessment({ heartbeatAgeSecs: 60, readyPoolAgeSecs: 4.2 * 3600, slotRefillAgeSecs: null });
  try {
    const r = runCli(root, ["--json"]);
    assert.equal(r.status, 1, `stale ready-pool with absent slot-refill rows must exit 1:\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "assessment-steps-stale");
    assert.deepEqual(out.assessmentSteps.stale, ["ready-pool"]);
    assert.equal(out.assessmentSteps.signals.slotRefill.status, "not-recorded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── doc-contract wiring (AC4: inner B3 + outer A 段必读) ───────────────────────────────────────────

test("AC4 wiring — inner execution core B3 (orchestration/fast-mode-tick-core.md) says every reschedule writes the heartbeat product", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  // The B3 重新排程 line must name the product AND the write trigger.
  assert.match(core, /B3\s+重新排程[\s\S]*inner-wakeup-heartbeat\.json/, "B3 must carry the heartbeat product write");
  const b3Section = core.split("\n").filter((l) => l.includes("B3") && l.includes("inner-wakeup-heartbeat"));
  assert.ok(b3Section.length >= 1, "a B3 line must tie ScheduleWakeup reschedule to writing inner-wakeup-heartbeat.json");
  assert.ok(b3Section.some((l) => /每次重排|每次重新排程/.test(l)), "the write must be EVERY reschedule, not optional");
});

test("AC4 wiring — source tick doc step 6 (plugin/loop/fast-mode-loop-tick.md) says every reschedule writes the heartbeat product", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  // Step 6 重新排程 must carry the write instruction with the product name + the ts/delaySeconds/reason schema.
  const lines = doc.split("\n");
  const headingIdx = lines.findIndex((l) => /^### 6\. 重新排程/.test(l));
  assert.ok(headingIdx !== -1, "step 6 heading must exist");
  // The step-6 section runs to the next heading (### / ##) — the heartbeat write must live in it.
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^(###|##) /.test(lines[i])) { end = i; break; }
  }
  const step6Section = lines.slice(headingIdx, end).join("\n");
  assert.match(step6Section, /inner-wakeup-heartbeat\.json/, "step 6 must carry the heartbeat product write");
  assert.match(step6Section, /每次重排/, "the write must be EVERY reschedule, not optional");
  assert.match(step6Section, /delaySeconds|ts|reason/, "the write must name the {ts, delaySeconds, reason} schema");
});

test("AC4 wiring — outer execution core A 段 (orchestration/orchestrator-tick-core.md) must READ+judge the heartbeat product", () => {
  const outer = fs.readFileSync(path.join(repoRoot, "orchestration", "orchestrator-tick-core.md"), "utf8");
  assert.match(outer, /inner-wakeup-heartbeat-check\.ts/, "the outer A 段 must invoke the checker");
  const aSectionLines = outer.split("\n").filter((l) => l.includes("inner-wakeup-heartbeat"));
  assert.ok(aSectionLines.length >= 1, "the outer A 段 must carry the heartbeat product read");
  assert.ok(aSectionLines.some((l) => /3\s*个 tick 周期|3\s*周期|5400/.test(l)), "the freshness band must be 3 tick periods");
  assert.ok(aSectionLines.some((l) => /兜底心跳断/.test(l)), "the escalation phrase 兜底心跳断 must be named");
});

test("AC2/AC4 — cross-reference to the same-family task (gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release)", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  assert.match(doc, /gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release/, "the tick doc must carry the same-family cross-reference");
  const sibling = fs.readFileSync(
    path.join(repoRoot, "tasks", "gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md"),
    "utf8",
  );
  assert.match(sibling, /gap-inner-wakeup-heartbeat-invisible/, "the sibling task must carry the cross-annotation back");
});

// ── field-contract doc wiring (AC2/AC3 — the writer is now a SCRIPT, not an inline python one-liner) ─

test("AC2 wiring — inner execution core B3 names the writer script inner-wakeup-heartbeat.ts (not hand-rolled python)", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  assert.match(core, /B3\s+重新排程[\s\S]*inner-wakeup-heartbeat\.ts/, "B3 must carry the writer script invocation");
  assert.match(core, /不手搓 python/, "B3 must forbid the hand-rolled python one-liner (the drift source)");
});

test("AC2/AC3 wiring — inner execution core B3 carries the minimal field contract (blocked[]/runIds + 心跳字段缺失)", () => {
  const core = fs.readFileSync(path.join(repoRoot, "orchestration", "fast-mode-tick-core.md"), "utf8");
  const b3Section = core.split("\n").filter((l) => l.includes("B3"));
  const b3Text = b3Section.join("\n");
  assert.match(b3Text, /blocked\[\]/, "B3 must name blocked[] (A3 判卡住的前提)");
  assert.match(b3Text, /runIds/, "B3 must name runIds");
  assert.match(b3Text, /心跳字段缺失/, "B3 must name the 心跳字段缺失 red verdict");
  assert.match(b3Text, /reason 散文可补充不可替代/, "B3 must carry the AC3 prose-does-not-replace clause");
});

test("AC2/AC3 wiring — source tick doc step 6 carries the writer script + field contract + prose-does-not-replace", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  const lines = doc.split("\n");
  const headingIdx = lines.findIndex((l) => /^### 6\. 重新排程/.test(l));
  assert.ok(headingIdx !== -1, "step 6 heading must exist");
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^(###|##) /.test(lines[i])) { end = i; break; }
  }
  const step6Section = lines.slice(headingIdx, end).join("\n");
  assert.match(step6Section, /inner-wakeup-heartbeat\.ts/, "step 6 must invoke the writer script");
  assert.match(step6Section, /blocked/, "step 6 must name the blocked[] structured key");
  assert.match(step6Section, /runIds/, "step 6 must name runIds");
  assert.match(step6Section, /心跳字段缺失/, "step 6 must name the 心跳字段缺失 red verdict");
  assert.match(step6Section, /reason 散文可补充但不可替代/, "step 6 must carry the AC3 prose clause");
});
