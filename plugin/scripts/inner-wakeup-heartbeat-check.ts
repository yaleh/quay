#!/usr/bin/env node
// inner-wakeup-heartbeat-check.ts — inner 兜底心跳的可读产物检查器（外层读）
// (tasks/gap-inner-wakeup-heartbeat-invisible)
//
// Defect family: the ScheduleWakeup reschedule (inner's FALLBACK heartbeat) lived only inside the
// inner transcript — a 15.3h-dead heartbeat (last 2026-08-09T15:17:27Z) was invisible until a human
// asked a third time and the manager grepped the transcript for ScheduleWakeup tool_use timestamps.
// Per C17 (rules need PRODUCTS, not visibility): "the last ScheduleWakeup moment" needs a
// mechanically-readable, checkable product, or a dead self-schedule stays invisible.
//
// Fix: inner writes `<root>/.quay/inner-wakeup-heartbeat.json` ({ts, delaySeconds, reason}) EVERY
// time it reschedules ScheduleWakeup (same shape as suite-chain-heartbeat.json, the A2 heartbeat
// precedent). This script is the OUTER checker that reads that product and judges freshness:
// age = now − ts > 3 tick periods (default 5400s = 3 × 1800s, the task Contract band) ⇒ reports
// "inner 兜底心跳断" and exits 1 (escalate). File missing = never written = same dead verdict
// (fail-closed — the product's ABSENCE is the failure, not a "not checked" state).
//
// Pure functions exported for hermetic tests; the CLI wires file read + freshness judgment.
//
// Usage:
//   node --experimental-strip-types inner-wakeup-heartbeat-check.ts [--root <dir>] \
//        [--max-age-secs <N>] [--in-flight <id1,id2>] [--json]
//
// Exit: 0 = ALIVE (heartbeat fresh) / NOT-EVALUATED (end-invariant unevaluable without --in-flight) ·
//       1 = DEAD (missing / malformed / stale / contracts / invariant-violated) · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDirectEntry } from "./gate-script-base.ts";
// AC53 判据① gate (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13 ruling): the
// end-invariant MUST be judged on the MACHINE's fresh slot-refill output, never the heartbeat's
// self-reported fields. analyzeSlotRefill is the pure machine decision; FIXED_DISPATCH_CAP is the
// default cap the tick's dispatch decision uses (A10).
import { analyzeSlotRefill, FIXED_DISPATCH_CAP } from "./slot-refill.ts";
// readCheckerCost: the fail-open ledger reader for .quay/checker-cost.jsonl (pure-append
// zero-judgment store where ready-pool-check self-records every run AND — once slot-refill is
// wrapped the same way — the slot-refill call record lives). I1 read-product criterion consumes it.
import { readCheckerCost } from "./checker-cost.ts";

/** Heartbeat file name under `<root>/.quay/` — append-only jsonl (AC53 AC3: 可回看 — every
 *  reschedule appends a line, so the history is reviewable, not a single-slot snapshot). */
export const HEARTBEAT_FILE = "inner-wakeup-heartbeat.jsonl";

/** Legacy single-JSON snapshot (the pre-AC53 format). Still read as a fallback when the jsonl is
 *  absent, and still mirrored by the writer so legacy readers keep working (e.g. the semantic-observer
 *  judge, whose default heartbeat path is `<root>/.quay/<layer>-wakeup-heartbeat.json`). */
export const LEGACY_HEARTBEAT_FILE = "inner-wakeup-heartbeat.json";

/** AC53-gate 判据4 side-carrier (tasks/gap-ac53-gate-not-wired-to-running-set AC4): when the writer's
 *  END-invariant gate REFUSES a heartbeat write, it appends a `{written:false, refuse_reason}` record
 *  HERE — NOT into the heartbeat jsonl (which must stay append-only for SUCCESSFUL writes so the reader
 *  keeps parsing a valid last line). The refusal trace makes a REFUSED round distinguishable from
 *  "inner didn't run the assessment" (a refused write previously left ZERO rows on the carrier —
 *  structurally identical to the assessment never running — the carrier-level cause of the 3-hour
 *  misdiagnosis). 判据4 negative control: before the fix the `written:false` row count is 0; after, a
 *  refused round immediately produces one. */
export const REFUSAL_FILE = "inner-wakeup-heartbeat-refusals.jsonl";

/** Default dead threshold: 3 tick periods × 1800s (task Contract band `inner_wakeup_heartbeat_age <= 5400`). */
export const DEFAULT_MAX_AGE_SECS = 5400;

// ── I1 read-product criterion (tasks/gap-inner-assessment-steps-no-product-reader) ───────────────────
//
// Defect family (manager 2026-08-14 12:2xZ, I1 / SPEC-tick-quality R6): during 07:41–12:2x the inner
// STOPPED running the dispatch-evaluation steps — slot-refill last 09:39:12 (2.7h), ready-pool-check
// last 08:08:35 (4.2h), heartbeat write last 07:41:43 (4.7h) — while ScheduleWakeup kept firing 62
// times. No layer detected it because NOTHING read the three steps' products every round (R6:
// "凡 X 的执行留有产物，必须每轮读该产物"). Root cause: the ScheduleWakeup prompt was switched to the
// sentinel `<<autonomous-loop-dynamic>>` at 07:41:46 (8 seconds after the heartbeat stopped) — the
// write-heartbeat/run-assessment step was not carried onto the new drive path.
//
// 判据1 (this criterion): three freshness signals — heartbeat jsonl ts, slot-refill call record,
// ready-pool call record. Any stale ⇒ "inner 派发评估未跑" (the dispatch-evaluation did not run).
// 判据2 (能取假): the 07:41–12:2x absence window is the replay sample — all three stale ⇒ RED.
// 判据3 (approach): the FIX is comparing the two drive paths' STEP SETS (concrete-prompt path vs the
// sentinel path) — NOT grepping logs for missed runs (hundreds of lines, no step-set answer). The
// read-product criterion is the mechanical guard that makes a future step-set drop VISIBLE.
export const CHECKER_COST_FILE = "checker-cost.jsonl";

/** Reason string when an assessment-step call record (ready-pool/slot-refill) is stale — the
 *  dispatch-evaluation steps did not run (I1). Human phrase: "inner 派发评估未跑". */
export const ASSESSMENT_NOT_RUN_REASON = "inner-assessment-steps-not-run";

/** Sentinel for a file that exists but does not parse / lacks a valid `ts`. */
export const MALFORMED = Object.freeze({ __malformed__: true });

// ── Minimal field contract (tasks/gap-inner-heartbeat-fields-shrunk-no-minimal-contract) ────────────
//
// Defect family: 2026-08-11 05:20 the heartbeat shrank to 3 keys ({ts, delaySeconds, reason}) — the
// runIds/blocked/budgetHit/effectiveCap/agentDispatches fields all vanished. Manager A3's premise is
// that THIS product is the only thing answering "what does inner need" — without blocked[] the outer
// cannot tell whether inner is stuck (hard rule 6: absent key = not-checked, ≠ no-block). The shrink
// was a silent regression of the structured shape into a one-line prose blob.
//
// Contract band `heartbeat_field_count >= 7` names ts/runIds/blocked/budgetHit/effectiveCap/
// agentDispatches/delaySeconds. reason prose may SUPPLEMENT but never REPLACE these (AC3) — the
// contract check looks ONLY at the structured keys, so a prose-only heartbeat is RED.
export const REQUIRED_HEARTBEAT_FIELDS = [
  "ts",
  "runIds",
  "blocked",
  "budgetHit",
  "effectiveCap",
  "agentDispatches",
  "delaySeconds",
];

/** Per-field type guard for the required fields. PURE. */
export const HEARTBEAT_FIELD_TYPES = {
  ts: (v) => typeof v === "number" && Number.isFinite(v),
  runIds: Array.isArray,
  blocked: Array.isArray,
  budgetHit: (v) => typeof v === "boolean",
  effectiveCap: (v) => typeof v === "number" && Number.isFinite(v),
  agentDispatches: (v) => typeof v === "number" && Number.isFinite(v),
  delaySeconds: (v) => typeof v === "number" && Number.isFinite(v),
};

// ── AC53 dispatch-state contract (tasks/gap-inner-self-wake-sleep-empty-slots-not-dispatch) ───────────
//
// RETIRED (AC76 C24-3, 人 2026-08-14 09:1xZ「在飞不应当靠任务记录,而应当查 inner 任务 subagent」):
// the IN-FLIGHT INPUT to slots_free / should_refill / dispatchable_disjoint carried by this heartbeat
// is RETIRED as an in-flight READ (a heartbeat's own in-flight fields stop updating when the inner
// stops — they cannot distinguish "done" from "ready", 2026-08-14 实测). 在飞的唯一读法 = inner 任务
// subagent (<session>/subagents/agent-*.jsonl, cap-counts-subagents-check.ts 判据2); 任务状态只走
// tasks/*.md status. The AC53 END-INVARIANT judgment below (should_refill ∧ slots_free>0 ∧
// dispatchable_disjoint>0 ∧ no_refill_reason empty) is UNCHANGED — it consumes slot-refill's own
// fresh output (analyzeSlotRefill), never the heartbeat's stale self-report; the heartbeat fields
// remain a WRITE-side record of what the inner decided, not the judge's in-flight source.
// AC1: the heartbeat must record, at the moment delaySeconds is chosen, the five dispatch-state keys —
// slots_free / dispatchable_disjoint / pool / should_refill / no_refill_reason. Before AC53 these five
// were ALL absent ⇒ the record structurally could not distinguish "nothing dispatchable" from
// "dispatchable but didn't dispatch" (the inner 满池自选长睡 defect: 0 in-flight + 5 slots free + 5
// dispatchable + should_refill=true + no_refill_reason=null, yet the round went to sleep for 25 min).
// AC2: the end-invariant — a tick must NOT end while `should_refill ∧ slots_free>0 ∧
// dispatchable_disjoint>0 ∧ no_refill_reason empty`; it either keeps dispatching until one is false or
// writes a no_refill_reason. judgeEndInvariant is the mechanical form; the negative control (AC4)
// replays the real 04:02:52Z / 04:22Z heartbeats and must report RED.
export const REQUIRED_DISPATCH_STATE_FIELDS = [
  "slots_free",
  "dispatchable_disjoint",
  "pool",
  "should_refill",
  "no_refill_reason",
];

/** Per-field type guard for the AC53 dispatch-state fields. PURE. `no_refill_reason` is string|null
 *  (null = none written — the "有货不派" shape the invariant flags). */
export const DISPATCH_STATE_FIELD_TYPES = {
  slots_free: (v) => typeof v === "number" && Number.isFinite(v),
  dispatchable_disjoint: (v) => typeof v === "number" && Number.isFinite(v),
  pool: (v) => typeof v === "number" && Number.isFinite(v),
  should_refill: (v) => typeof v === "boolean",
  no_refill_reason: (v) => v === null || typeof v === "string",
};

/**
 * Check a heartbeat against the minimal field contract. PURE.
 * `reason` prose is deliberately NOT a substitute for any structured key (AC3): the check
 * inspects only REQUIRED_HEARTBEAT_FIELDS — a `{ts, delaySeconds, reason}` heartbeat is RED.
 * @param {object|null|MALFORMED} heartbeat parseHeartbeat output
 * @returns {{ok:boolean, missing:string[], wrongType:string[], fieldCount:number, requiredPresent:number}}
 */
export function checkFieldContract(heartbeat) {
  const missing = [];
  const wrongType = [];
  const fieldCount = heartbeat && typeof heartbeat === "object" ? Object.keys(heartbeat).length : 0;
  let requiredPresent = 0;
  if (heartbeat && typeof heartbeat === "object") {
    for (const f of REQUIRED_HEARTBEAT_FIELDS) {
      if (!(f in heartbeat)) { missing.push(f); continue; }
      if (HEARTBEAT_FIELD_TYPES[f] && !HEARTBEAT_FIELD_TYPES[f](heartbeat[f])) { wrongType.push(f); continue; }
      requiredPresent++;
    }
  } else {
    missing.push(...REQUIRED_HEARTBEAT_FIELDS);
  }
  return {
    ok: missing.length === 0 && wrongType.length === 0,
    missing,
    wrongType,
    fieldCount,
    requiredPresent,
  };
}

/**
 * Check the AC53 dispatch-state contract (the five keys AC1 requires at the moment delaySeconds is
 * chosen). PURE. Absent keys are "not-checked" (hard rule 6) — the caller reports them as missing,
 * never as "no dispatchable work".
 * @param {object|null|MALFORMED} heartbeat parseHeartbeat output
 * @returns {{ok:boolean, missing:string[], wrongType:string[]}}
 */
export function checkDispatchStateContract(heartbeat) {
  const missing = [];
  const wrongType = [];
  if (heartbeat && typeof heartbeat === "object") {
    for (const f of REQUIRED_DISPATCH_STATE_FIELDS) {
      if (!(f in heartbeat)) { missing.push(f); continue; }
      if (DISPATCH_STATE_FIELD_TYPES[f] && !DISPATCH_STATE_FIELD_TYPES[f](heartbeat[f])) { wrongType.push(f); continue; }
    }
  } else {
    missing.push(...REQUIRED_DISPATCH_STATE_FIELDS);
  }
  return { ok: missing.length === 0 && wrongType.length === 0, missing, wrongType };
}

/** Reason string when a fresh heartbeat shows the round ENDED while dispatchable work remained (AC2
 *  violation — the 04:02:52Z real shape: should_refill=true / slots_free=5 / dispatchable_disjoint=5 /
 *  no_refill_reason=null). */
export const INVARIANT_VIOLATED_REASON = "inner-round-ended-with-dispatchable-work";

/** Reason string when the MACHINE's fresh slot-refill cannot be produced at all (subprocess/task-store
 *  failure) — the checker cannot verify the end-invariant ⇒ fail-closed RED (cannot verify ⇒ cannot
 *  pass; hard rule 6 缺值=未查). */
export const MACHINE_UNVERIFIABLE_REASON = "end-invariant-unverifiable";

/** Reason string when the checker is run WITHOUT --in-flight (no in-flight set provided) — the
 *  touches-overlap-in-flight step cannot be judged ⇒ the END invariant is UNEVALUABLE (hard rule 3b:
 *  读不懂 ≠ 合格, ≠ 不合格). The verdict is NOT-EVALUATED — an INDEPENDENT value carrying
 *  `evaluated:false` and a NON-escalating exit 0 — NEVER the DEAD verdict. DEAD stays reserved for
 *  real violations (in-flight set provided AND the four-part invariant actually holds). */
export const END_INVARIANT_NOT_EVALUATED_REASON = "end-invariant-not-evaluated-no-inflight";

/**
 * The AC2 end-invariant: a tick must NOT end while `should_refill ∧ slots_free>0 ∧
 * dispatchable_disjoint>0 ∧ no_refill_reason empty`. PURE — operates on ANY object carrying the AC53
 * dispatch-state five keys. Only meaningful when the dispatch-state contract is present (a missing key
 * is not a violation — the caller reports dispatch-state-missing separately). This is the mechanical
 * form the AC4 negative control replays: the real 04:02:52Z / 04:22Z shapes both carry the violating
 * shape and MUST return violated=true (they never lit red before — the record couldn't even express
 * the question).
 * AC53 判据① (outer 2026-08-13 ruling): the CHECKER now passes the MACHINE's fresh slot-refill output
 * (judgeEndInvariantAgainstMachine is the wrapper that keeps the heartbeat's recorded fields
 * display-only), never the heartbeat's self-report — a prose no_refill_reason written by the judged
 * party must not make noReason=false (hard rule 4b).
 * @param {object} hb an object carrying the AC53 dispatch-state fields (the caller decides whether
 *   that is the machine result or a recorded heartbeat)
 * @returns {{ok:boolean, violated:boolean, reason:string|null, evidence:object}}
 */
export function judgeEndInvariant(hb) {
  const shouldRefill = hb.should_refill === true;
  const slotsFree = typeof hb.slots_free === "number" ? hb.slots_free : 0;
  const dd = typeof hb.dispatchable_disjoint === "number" ? hb.dispatchable_disjoint : 0;
  const noReason = hb.no_refill_reason == null || hb.no_refill_reason === "";
  const violated = shouldRefill && slotsFree > 0 && dd > 0 && noReason;
  return {
    ok: !violated,
    violated,
    reason: violated ? INVARIANT_VIOLATED_REASON : null,
    evidence: {
      should_refill: hb.should_refill,
      slots_free: slotsFree,
      dispatchable_disjoint: dd,
      pool: typeof hb.pool === "number" ? hb.pool : null,
      no_refill_reason: hb.no_refill_reason ?? null,
    },
  };
}

/**
 * The AC53 判据① gate (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13 ruling):
 * judge the end-invariant on the MACHINE's fresh slot-refill output, NEVER on the heartbeat's
 * self-reported fields. The heartbeat's recorded no_refill_reason is what the judged party (inner)
 * writes — judging it let a prose reason ("ac51 subagent in flight…") make noReason=false ⇒ the old
 * checker passed while the machine said no_refill_reason=None and dispatchable work waited (hard rule
 * 4b: a self-produced quantity cannot judge its producer). The invariant therefore reads the machine's
 * five dispatch-state keys; the heartbeat's recorded dispatch-state is carried in evidence as
 * DISPLAY-ONLY (recorded_no_refill_reason / recorded_should_refill), never a factor in the verdict.
 * @param {object|null} heartbeat the FILE's recorded heartbeat (display-only for the verdict)
 * @param {object} machineRefill the MACHINE's fresh analyzeSlotRefill result (the judge)
 * @returns {{ok:boolean, violated:boolean, reason:string|null, judgedFrom:"machine-slot-refill", evidence:object}}
 */
export function judgeEndInvariantAgainstMachine(heartbeat, machineRefill) {
  const inv = judgeEndInvariant(machineRefill);
  const hb = heartbeat && typeof heartbeat === "object" ? heartbeat : {};
  return {
    ...inv,
    judgedFrom: "machine-slot-refill",
    evidence: {
      ...inv.evidence,
      // Display-only: what the heartbeat RECORDED (the judged party's self-report). Never the judge.
      recorded_no_refill_reason: hb.no_refill_reason ?? null,
      recorded_should_refill: hb.should_refill ?? null,
    },
  };
}

/** Reason string for a fresh-but-field-shrunk heartbeat (AC2: missing keys ⇒ checker reports). */
export const FIELDS_MISSING_REASON = "inner-wakeup-heartbeat-fields-missing";

/**
 * Parse the heartbeat file text. PURE.
 * @param {string|null|undefined} text
 * @returns {object|null|MALFORMED} parsed object · null when missing/empty · MALFORMED when unparsable.
 */
export function parseHeartbeat(text) {
  if (text == null || String(text).trim() === "") return null;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && typeof v.ts === "number" && Number.isFinite(v.ts)) return v;
    return MALFORMED;
  } catch {
    return MALFORMED;
  }
}

/**
 * Judge heartbeat freshness. PURE.
 * @param {number} nowSec epoch-seconds "now"
 * @param {object|null|MALFORMED} heartbeat parseHeartbeat output
 * @param {number} [maxAgeSecs]
 * @returns {{alive:boolean, status:"alive"|"stale"|"missing"|"malformed", ageSecs:number|null, reason:string}}
 */
export function judgeHeartbeat(nowSec, heartbeat, maxAgeSecs = DEFAULT_MAX_AGE_SECS) {
  if (heartbeat === MALFORMED) {
    return { alive: false, status: "malformed", ageSecs: null, reason: "inner-wakeup-heartbeat-malformed" };
  }
  if (heartbeat == null) {
    return { alive: false, status: "missing", ageSecs: null, reason: "inner-wakeup-heartbeat-missing" };
  }
  // parseHeartbeat already validated ts; guard again for direct calls.
  const ts = heartbeat.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return { alive: false, status: "malformed", ageSecs: null, reason: "inner-wakeup-heartbeat-malformed" };
  }
  const ageSecs = Math.max(0, nowSec - ts); // future ts (clock skew) clamps to 0 = fresh
  if (ageSecs > maxAgeSecs) {
    return { alive: false, status: "stale", ageSecs, reason: "inner-wakeup-heartbeat-dead" };
  }
  return { alive: true, status: "alive", ageSecs, reason: "heartbeat-fresh" };
}

// ── A13 (gap-a13-heartbeat-refusal-write-invisible, 甲) — the freshness verdict reads the refusals ────
// Defect: when the writer's AC53 END-INVARIANT gate REFUSES a write (dispatchable work waits), the
// refusal is recorded ONLY in the side-carrier ${REFUSAL_FILE} — the main heartbeat jsonl/.json stays
// pure (append-only for SUCCESSFUL writes). The judge read ONLY the main product ⇒ a busy inner that
// kept being refused (refusal = "wanted to sleep but the gate pushed it back to dispatch" = liveness)
// showed a stale main heartbeat ⇒ A13 reported DEAD. Fix (甲): the freshness verdict takes
// max(主 json ts, refusals 最新 ts). (乙) on the writer side mirrors the refusal onto the legacy .json.

/** Parse a refusals jsonl TEXT (one JSON record per line — {written:false, ts, refuse_reason}) and
 *  return the LATEST valid `ts`. PURE. Malformed lines are skipped (a malformed refusal row is not a
 *  recorded time — hard rule 6). Returns null when the text is absent or carries no valid ts row. */
export function latestRefusalTs(text) {
  if (text == null) return null;
  let latest = null;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r && typeof r === "object" && typeof r.ts === "number" && Number.isFinite(r.ts)) {
        if (latest == null || r.ts > latest) latest = r.ts;
      }
    } catch {
      // skip a malformed line — it is not a recorded time
    }
  }
  return latest;
}

/** Read the refusals side-carrier under `<root>/.quay/${REFUSAL_FILE}` and return the latest refusal
 *  ts (epoch seconds), or null when the carrier is absent or carries no valid ts row. */
export function readLatestRefusalTs(root) {
  const file = path.join(root || ".", ".quay", REFUSAL_FILE);
  if (!fs.existsSync(file)) return null;
  return latestRefusalTs(fs.readFileSync(file, "utf8"));
}

/** The effective freshness ts = max(heartbeat ts, latest refusal ts). PURE. A refusal is liveness
 *  evidence (inner tried to END the round and the AC53 gate refused ⇒ inner was active enough to
 *  attempt the write). Returns null when NEITHER the heartbeat nor any refusal provides a valid ts. */
export function maxFreshnessTs(heartbeat, refusalTs) {
  const hbTs = heartbeat && typeof heartbeat === "object" && typeof heartbeat.ts === "number" && Number.isFinite(heartbeat.ts)
    ? heartbeat.ts
    : null;
  const rTs = typeof refusalTs === "number" && Number.isFinite(refusalTs) ? refusalTs : null;
  if (hbTs == null && rTs == null) return null;
  return Math.max(hbTs ?? -Infinity, rTs ?? -Infinity);
}

/**
 * Judge heartbeat freshness, A13-aware (gap-a13-heartbeat-refusal-write-invisible): the effective ts
 * is max(heartbeat ts, latest refusal ts). PURE. Same output vocabulary as judgeHeartbeat plus an added
 * `freshnessSource` ("heartbeat" | "refusal") naming which ts kept the product fresh — a freshness
 * proven by a refusal must be distinguishable from a real heartbeat (hard rule 3b: 读不懂 ≠ 合格,
 * and a refusal-proven liveness is observably different from a fresh heartbeat).
 */
export function judgeHeartbeatWithRefusal(nowSec, heartbeat, refusalTs, maxAgeSecs = DEFAULT_MAX_AGE_SECS) {
  if (heartbeat === MALFORMED) {
    return { alive: false, status: "malformed", ageSecs: null, reason: "inner-wakeup-heartbeat-malformed" };
  }
  const ts = maxFreshnessTs(heartbeat, refusalTs);
  if (ts == null) {
    return heartbeat == null
      ? { alive: false, status: "missing", ageSecs: null, reason: "inner-wakeup-heartbeat-missing" }
      : { alive: false, status: "malformed", ageSecs: null, reason: "inner-wakeup-heartbeat-malformed" };
  }
  const ageSecs = Math.max(0, nowSec - ts); // future ts (clock skew) clamps to 0 = fresh
  if (ageSecs > maxAgeSecs) {
    return { alive: false, status: "stale", ageSecs, reason: "inner-wakeup-heartbeat-dead" };
  }
  const hbTs = heartbeat && typeof heartbeat === "object" && typeof heartbeat.ts === "number" && Number.isFinite(heartbeat.ts)
    ? heartbeat.ts
    : null;
  const refusalIsMax = refusalTs != null && (hbTs == null || refusalTs > hbTs);
  return {
    alive: true,
    status: "alive",
    ageSecs,
    reason: "heartbeat-fresh",
    freshnessSource: refusalIsMax ? "refusal" : "heartbeat",
  };
}

/** Read the heartbeat product under `<root>/.quay/` — the LAST line of the append-only jsonl (AC53
 *  AC3: every reschedule appends a line, so the latest record is the newest and history is reviewable
 *  in the file). Falls back to the legacy single-JSON snapshot when the jsonl is absent (a pre-AC53
 *  heartbeat is still judged). Returns null when neither exists. */
export function readHeartbeatText(root) {
  const quayDir = path.join(root || ".", ".quay");
  const jsonlPath = path.join(quayDir, HEARTBEAT_FILE);
  if (fs.existsSync(jsonlPath)) {
    const lines = fs.readFileSync(jsonlPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) return lines[lines.length - 1];
  }
  const legacyPath = path.join(quayDir, LEGACY_HEARTBEAT_FILE);
  if (fs.existsSync(legacyPath)) return fs.readFileSync(legacyPath, "utf8");
  return null;
}

// ── I1 read-product criterion — the three assessment-step freshness signals ───────────────────────────
//
// The dispatch-evaluation steps all leave products: the heartbeat jsonl (ts), the ready-pool call
// record (checker-cost.jsonl `name:"ready-pool-check"` rows, self-recorded every run) and the
// slot-refill call record (checker-cost.jsonl `name:"slot-refill"` rows). NOTHING read these every
// round during 07:41–12:2x — the criterion below is that every-round reader. Fail-closed philosophy
// is inherited from the heartbeat product: a product whose ABSENCE is the failure reports RED; a
// product that CANNOT be evaluated (hard rule 3b: 读不懂 ≠ 合格) reports a DISTINCT not-recorded
// value and never fakes a pass OR a fail.

/** Parse a checker-cost `at` ISO-8601 timestamp (`2026-08-14T13:01:28.955Z`) into epoch seconds.
 *  PURE. Returns null when the string is absent/unparsable (a malformed row is not a recorded time). */
export function parseRecordedAt(at) {
  if (typeof at !== "string" || at.trim() === "") return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Find the LAST call record for `name` in a checker-cost.jsonl rows array (rows are append-ordered,
 * so the last matching row is the newest call). PURE.
 * @param {Array<{name:string, at?:string}>} rows readCheckerCost output ([] when file absent)
 * @param {string} name e.g. "ready-pool-check" | "slot-refill"
 * @returns {{atEpoch:number|null, atRaw:string}|null} null = no row for this name in the ledger
 */
export function lastCallRecord(rows, name) {
  for (let i = (rows || []).length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.name === name && typeof r.at === "string") {
      return { atEpoch: parseRecordedAt(r.at), atRaw: r.at };
    }
  }
  return null;
}

/**
 * Read the LAST call record for a step under `<root>/.quay/checker-cost.jsonl`. The file is
 * pure-append and fail-open (readCheckerCost skips malformed lines). Returns null when the ledger is
 * absent OR the step has never recorded there — the caller distinguishes "ledger absent" from
 * "step never recorded" by checking fs.existsSync on the ledger when it needs to.
 */
export function readLastCallRecord(root, name) {
  const file = path.join(root || ".", ".quay", CHECKER_COST_FILE);
  const rows = readCheckerCost(file);
  return lastCallRecord(rows, name);
}

/**
 * I1 判据1: judge the three dispatch-evaluation freshness signals. PURE.
 * The RED trigger is the ASSESSMENT STEPS (ready-pool / slot-refill) going stale — the case the
 * existing heartbeat freshness check MISSES (inner awake — heartbeat fresh — but the evaluation
 * steps stopped). The heartbeat signal is REPORTED as the third signal but its staleness is the
 * existing "inner 兜底心跳断" criterion (judgeHeartbeat), so it does not double-fire here.
 * Per hard rule 3b, a not-recorded step (no call record in the ledger) is a DISTINCT value —
 * neither "合格" nor a fake fail; it only fires when the record EXISTS and is stale.
 * @param {number} nowSec epoch-seconds "now"
 * @param {object} signals
 * @param {object|null|MALFORMED} signals.heartbeat parseHeartbeat output (reported, not a trigger)
 * @param {{atEpoch:number|null, atRaw:string}|null} signals.readyPool lastCallRecord output
 * @param {{atEpoch:number|null, atRaw:string}|null} signals.slotRefill lastCallRecord output
 * @param {number} [maxAgeSecs] staleness band (default 3 tick periods)
 * @returns {{ok:boolean, stale:string[], status:string, reason:string|null, signals:object}}
 */
export function judgeAssessmentSteps(nowSec, { heartbeat, readyPool, slotRefill }, maxAgeSecs = DEFAULT_MAX_AGE_SECS) {
  const toSignal = (lastTs, name) => {
    if (lastTs == null) return { name, status: "not-recorded", ageSecs: null, lastTs: null };
    const age = Math.max(0, nowSec - lastTs); // future ts (clock skew) clamps to 0 = fresh
    return { name, status: age > maxAgeSecs ? "stale" : "fresh", ageSecs: age, lastTs };
  };
  const heartbeatSignal = heartbeat === MALFORMED
    ? { name: "heartbeat", status: "malformed", ageSecs: null, lastTs: null }
    : heartbeat == null
      ? { name: "heartbeat", status: "missing", ageSecs: null, lastTs: null }
      : toSignal(heartbeat.ts, "heartbeat");
  const readyPoolSignal = toSignal(readyPool?.atEpoch ?? null, "ready-pool");
  const slotRefillSignal = toSignal(slotRefill?.atEpoch ?? null, "slot-refill");
  const signals = { heartbeat: heartbeatSignal, readyPool: readyPoolSignal, slotRefill: slotRefillSignal };
  const stale = [readyPoolSignal, slotRefillSignal].filter((s) => s.status === "stale").map((s) => s.name);
  return {
    ok: stale.length === 0,
    stale,
    status: stale.length > 0 ? "assessment-steps-stale" : "assessment-steps-ok",
    reason: stale.length > 0 ? ASSESSMENT_NOT_RUN_REASON : null,
    signals,
  };
}

/**
 * Run a FRESH slot-refill — the AC53 判据① MACHINE measurement (gap-inner-self-wake-sleep-empty-slots-
 * not-dispatch, outer 2026-08-13 ruling). The checker's end-invariant gate judges THIS result, never
 * the heartbeat's recorded no_refill_reason (hard rule 4b: the judged party must not judge itself).
 * @param {object} o
 * @param {string} o.root workspace root (the <root>/tasks store)
 * @param {string[]} [o.inFlightIds] the session's in-flight task ids. The checker is run by OUTER, who
 *   may not know inner's in-flight set: pass `--in-flight` when the caller knows it.
 *   gap-inner-heartbeat-check-not-evaluated-when-no-inflight (AC1, hard rule 3b): ABSENT (undefined)
 *   ⇒ the checker's main() routes the END invariant to NOT-EVALUATED (the touches-overlap-in-flight
 *   step cannot be judged — the empty-in-flight view is exactly what produced the constant false DEAD),
 *   so runMachineSlotRefill is NOT invoked from that branch. When provided (even an EMPTY array `[]` =
 *   a MEASURED zero — `--in-flight ''`), the invariant is judged against that set. This helper itself
 *   defaults `inFlightIds` to `[]` for direct-library/test callers, whose contracts are unchanged.
 * @param {string[]} [o.running] AC53-gate (tasks/gap-ac53-gate-not-wired-to-running-set, 判据1): the
 *   NARROW currently-RUNNING task-subagent set the gate observed THIS round. Passed to slot-refill's
 *   Consumer B (slots_free / should_refill); Consumer A (dispatchable_disjoint) stays on the WIDE set
 *   (inFlight + closedButLive) — an awaiting-retry task's worktree still occupies files a new task
 *   would collide with, but it has NO subagent ⇒ does NOT occupy a concurrency cap slot. `undefined`
 *   (not passed) keeps Consumer B on the wide in-flight fallback (backward compat). 判据3 (3b): an
 *   EMPTY array `[]` is a MEASURED zero (running_subagent_count=0, slot_denominator_source=
 *   "running-subagents") — DISTINCT from `undefined` (未提供, falls back to the wide set) so "没有
 *   在跑" is never same-shaped as "没提供集合".
 * @param {number} [o.cap] dispatch cap — the tick's effective cap (heartbeat.effectiveCap), default
 *   FIXED_DISPATCH_CAP (5).
 * @returns {{ok:true, refill:object}|{ok:false, error:string}} fail-closed: a slot-refill error ⇒
 *   {ok:false} — the checker cannot verify ⇒ cannot pass.
 */
export function runMachineSlotRefill({ root, inFlightIds = [], running, cap = FIXED_DISPATCH_CAP }) {
  const rootDir = root || ".";
  const tasksDir = path.join(rootDir, "tasks");
  const readTasks = (ids) => {
    const out = [];
    for (const id of ids) {
      const file = path.join(tasksDir, `${id}.md`);
      if (!fs.existsSync(file)) continue; // advisory — a vanished id is not a failure
      out.push({ id, body: fs.readFileSync(file, "utf8") });
    }
    return out;
  };
  try {
    const refill = analyzeSlotRefill({
      tasksDir,
      root: rootDir,
      cap,
      inFlight: readTasks(inFlightIds),
      // AC53-gate (tasks/gap-ac53-gate-not-wired-to-running-set, 判据1): the NARROW Consumer-B
      // denominator. `running !== undefined` ⇒ slot-refill's Consumer B counts the truly-running
      // subagent set (an EMPTY array is a MEASURED 0 — 判据3); `undefined` ⇒ Consumer B falls back to
      // the wide in-flight set (backward compat — the pre-fix gate read the wide set and let
      // awaiting-retry tasks occupy slots they have no subagent to fill).
      runningSubagentCount: running !== undefined ? new Set(running).size : null,
      measurementSource: "explicit-input",
    });
    return { ok: true, refill };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── AC3 trigger wiring (tasks/gap-semantic-observer-judge-stopped-awaiting) ────────────────────────
//
// The semantic judge must NOT run every round (cost). Trigger when the free text changed (hash) OR when
// the FREE TEXT carries the harness's OWN spawn-limit error string `Subagent spawn limit reached`
// (AC77 判据1, gap-ac77-spawn-limit-detect-harness-error-only — CLAUDE.md:21 detection method verbatim:
// "目标会话 transcript 里搜 `Subagent spawn limit reached`"). The old heuristic read a self-maintained
// agentDispatches/agentLimit count — RETIRED (AC77 判据2) → orchestration/archive/AC58-retired-clauses.md#R29.
// These three are the PURE trigger functions; the judge CLI imports them.

/** The harness's OWN subagent spawn-limit error string (CLAUDE.md:21 identification verbatim). The
 *  session's CUMULATIVE spawn budget (harness-managed, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`) is
 *  exhausted ⇒ harness silently degrades to main-thread serial. Detecting THIS string — not a
 *  self-maintained count — is the AC77 判据1 criterion (hard rule 4b: the judged party's own counter
 *  stops updating exactly when the failure it counts occurs, so it is indistinguishable from "normal"). */
export const SPAWN_LIMIT_SIGNAL = "Subagent spawn limit reached";

/** True when the free text (heartbeat reason + tick report transcript) carries the harness spawn-limit
 *  error string. PURE. Case-insensitive — the harness writes "Subagent spawn limit reached", a
 *  lowercase transcript grep should still match. */
export function spawnLimitDetected(freeText) {
  return String(freeText ?? "").toLowerCase().includes(SPAWN_LIMIT_SIGNAL.toLowerCase());
}

/** AC3 heuristic (AC77 判据1): fires when the free text carries the harness spawn-limit error string.
 *  PURE. Accepts the free-text string, or a heartbeat object (its `reason` is read) for call-site
 *  compatibility. The old count-based criterion is RETIRED (AC77 判据2) → R29 — a permanently-false
 *  criterion (heartbeat agentLimit came back undefined) is indistinguishable from "everything normal"
 *  (硬规则 4). 判据3 (只报不动): this is a REPORT trigger only — it never /clears, never lowers cap,
 *  never restarts; the post-trip action is the human's (人 2026-08-14 07:4xZ). */
export function semanticTriggerHeuristic(heartbeatOrText) {
  const text = typeof heartbeatOrText === "string"
    ? heartbeatOrText
    : (heartbeatOrText && typeof heartbeatOrText === "object" ? heartbeatOrText.reason : "") ?? "";
  return spawnLimitDetected(text);
}

/** Free-text content hash (sha256, first 16 hex). PURE. */
export function freeTextHash(freeText) {
  return createHash("sha256").update(String(freeText ?? "")).digest("hex").slice(0, 16);
}

/**
 * Evaluate the AC3 trigger. PURE.
 * @param {object|null} heartbeat parsed heartbeat (display-only since AC77 — the heuristic judges the
 *   free text, not a self-counted budget; kept for call-site compatibility)
 * @param {string} freeText combined free text (reason + tick report)
 * @param {string|null|undefined} prevHash previous free-text hash (null = no baseline ⇒ hashChanged=false)
 * @returns {{fired:boolean, heuristic:boolean, hashChanged:boolean, hash:string}}
 */
export function evaluateTrigger(heartbeat, freeText, prevHash) {
  const hash = freeTextHash(freeText);
  const heuristic = semanticTriggerHeuristic(freeText);
  const hashChanged = prevHash != null && hash !== prevHash;
  return { fired: heuristic || hashChanged, heuristic, hashChanged, hash };
}

function usage() {
  console.error(`inner-wakeup-heartbeat-check.ts — inner 兜底心跳产物检查器（外层读）

Reads <root>/.quay/${HEARTBEAT_FILE} (append-only jsonl, last line; falls back to the legacy
<root>/.quay/${LEGACY_HEARTBEAT_FILE} snapshot) — written by inner each time it reschedules
ScheduleWakeup via plugin/scripts/inner-wakeup-heartbeat.ts) and judges:
  (a) freshness — age = now − max(heartbeat ts, latest refusals ts) > max-age (default
      ${DEFAULT_MAX_AGE_SECS}s = 3 tick periods × 1800s) ⇒ "inner 兜底心跳断" + exit 1 (escalate);
      a RECENT refusal (${REFUSAL_FILE} last ts) keeps the verdict ALIVE — a refused write is liveness
      evidence (inner tried to END the round and the AC53 gate pushed it back to dispatch);
      missing / malformed file = same dead verdict (fail-closed);
  (b) minimal field contract — a FRESH heartbeat must carry the ${REQUIRED_HEARTBEAT_FIELDS.length} structured
      keys ${REQUIRED_HEARTBEAT_FIELDS.join("/")} (Contract band heartbeat_field_count >= 7; blocked[] +
      runIds are the A3 "inner 卡住" premise). Missing key / wrong type ⇒ "心跳字段缺失" + exit 1.
      reason prose may supplement but NEVER replace the structured fields (AC3).
  (c) AC53 dispatch-state contract (AC1) — a FRESH heartbeat must carry the five keys
      ${REQUIRED_DISPATCH_STATE_FIELDS.join("/")} so the record distinguishes "nothing dispatchable"
      from "dispatchable but didn't dispatch". Missing ⇒ "派发状态五键缺失" + exit 1.
  (d) AC53 end-invariant (AC2, outer 2026-08-13 ruling) — the invariant is judged on the MACHINE's
      FRESH slot-refill output (a re-run of analyzeSlotRefill against <root>/tasks with the --in-flight
      set AND — when the gate observed it — the --running set as Consumer B), NEVER on the heartbeat's
      recorded no_refill_reason (self-report — the judged party must not judge itself, hard rule 4b).
      Machine says should_refill=true ∧ slots_free>0 ∧
      dispatchable_disjoint>0 ∧ no_refill_reason empty ⇒ "结束不变式违例" + exit 1 — a prose self-report
      in the heartbeat can NEVER make this pass (the AC53 bypass: "ac51 subagent in flight…" shielded a
      null machine reason). Heartbeat's recorded dispatch-state is display-only evidence
      (recorded_no_refill_reason). Machine unverifiable ⇒ "结束不变式无法验证" + exit 1 (fail-closed).
      WITHOUT --in-flight the touches-overlap-in-flight step cannot be judged ⇒ the invariant is
      UNEVALUABLE ⇒ the checker reports NOT-EVALUATED (verdict "NOT-EVALUATED", evaluated:false,
      exit 0) — NEVER a constant false DEAD (hard rule 3b: 读不懂 ≠ 合格, ≠ 不合格).
  (e) I1 read-product criterion (tasks/gap-inner-assessment-steps-no-product-reader) — the dispatch-
      evaluation steps all leave products: heartbeat jsonl ts + slot-refill call record +
      ready-pool call record (checker-cost.jsonl ${CHECKER_COST_FILE} rows). A STALE ready-pool or
      slot-refill call record (age > max-age) ⇒ "inner 派发评估未跑" + exit 1 — the case the heartbeat
      freshness check MISSES (inner awake but the evaluation stopped; the 07:41–12:2x absence window).
      A step with NO call record in an absent ledger reports NOT-EVALUATED (hard rule 3b: 读不懂 ≠ 合格),
      never a fake pass or a fake fail.

Usage:
  --root <dir>         workspace root (default: cwd) — reads <root>/.quay/${HEARTBEAT_FILE}
  --max-age-secs <N>   dead threshold in seconds (default ${DEFAULT_MAX_AGE_SECS})
  --in-flight <id1,id2>  AC53: the session's in-flight task ids for the fresh slot-refill re-run.
                         Outer may not know inner's set — ABSENT means the touches-overlap-in-flight
                         step cannot be judged ⇒ the END invariant is NOT-EVALUATED (verdict
                         "NOT-EVALUATED", evaluated:false, exit 0 — never a constant false DEAD).
                         Provide it (even --in-flight '' = a MEASURED zero) to judge DEAD/ALIVE.
  --running <id1,id2>  AC53-gate 判据1: the NARROW currently-RUNNING task-subagent set the gate observed
                         this round. Consumer B (slots_free / should_refill) counts THIS; an empty value
                         (--running '') is a MEASURED zero (判据3: 真零 ≠ 未提供); ABSENT keeps Consumer B
                         on the wide in-flight fallback (the pre-fix behavior — awaiting-retry tasks
                         occupied slots they have no subagent to fill). dispatchable_disjoint (Consumer A)
                         always stays on the wide in-flight view.
  --json               JSON output (default human-readable)

Exit: 0 ALIVE / NOT-EVALUATED (end-invariant unevaluable without --in-flight) · 1 DEAD (missing /
malformed / stale / assessment-steps-stale / fields-missing / dispatch-state-missing /
end-invariant-unverifiable / invariant-violated) · 2 usage error`);
}

export function main(argv) {
  const args = argv.slice(2);
  const flagVal = (name, def) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  if (args.includes("--help") || args.includes("-h")) { usage(); return 2; }
  const root = flagVal("--root", ".");
  const maxAge = Number(flagVal("--max-age-secs", String(DEFAULT_MAX_AGE_SECS)));
  const jsonOut = args.includes("--json");
  // AC53 判据① (gap-inner-self-wake-sleep-empty-slots-not-dispatch): the checker's end-invariant gate
  // re-runs slot-refill with the session's in-flight set. Outer may not know inner's in-flight set —
  // `--in-flight` supplies it when known.
  // gap-inner-heartbeat-check-not-evaluated-when-no-inflight (AC1, hard rule 3b): `inFlightProvided`
  // distinguishes "NOT provided" (unevaluable ⇒ NOT-EVALUATED) from "provided" (a MEASURED set — even
  // `--in-flight ''` is a real measured zero, so the invariant IS judgeable). `inFlightIds` is
  // `undefined` when absent (the end-invariant branch is NOT entered) and a real array when provided.
  const inFlightFlag = flagVal("--in-flight");
  const inFlightProvided = inFlightFlag !== undefined;
  const inFlightIds = inFlightProvided
    ? String(inFlightFlag).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  // AC53-gate 判据1 (tasks/gap-ac53-gate-not-wired-to-running-set): the NARROW currently-RUNNING
  // task-subagent set — the gate passes what IT observed this round. `--running ''` is a MEASURED zero
  // (true zero — Consumer B sees 0 running subagents); ABSENT (undefined) keeps Consumer B on the wide
  // in-flight fallback (backward compat + 判据3: 未提供 ≠ 真零).
  const runningFlag = flagVal("--running");
  const runningIds = runningFlag !== undefined
    ? String(runningFlag).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  if (!Number.isFinite(maxAge) || maxAge < 0) {
    console.error("inner-wakeup-heartbeat-check: --max-age-secs must be a non-negative number");
    return 2;
  }

  const text = readHeartbeatText(root);
  const heartbeat = parseHeartbeat(text);
  const nowSec = Math.floor(Date.now() / 1000);
  // A13 (gap-a13-heartbeat-refusal-write-invisible) (甲): the freshness verdict takes the max of the
  // main heartbeat ts and the LATEST refusal ts — a recent AC53 refusal proves inner is alive (it tried
  // to END the round and the gate pushed it back to dispatch), so a stale main heartbeat alone must not
  // report DEAD while refusals keep landing.
  const refusalTs = readLatestRefusalTs(root);

  // I1 read-product criterion (tasks/gap-inner-assessment-steps-no-product-reader): read the three
  // dispatch-evaluation freshness signals — heartbeat jsonl ts + slot-refill call record +
  // ready-pool call record. The ASSESSMENT STEPS (ready-pool / slot-refill) going stale is the case
  // the existing heartbeat check MISSES (inner awake but the evaluation stopped); heartbeat staleness
  // is reported as the third signal but judged by the existing "inner 兜底心跳断" criterion below.
  // 判据2: the 07:41–12:2x absence window (all three stale) replays RED here.
  const readyPoolRec = readLastCallRecord(root, "ready-pool-check");
  const slotRefillRec = readLastCallRecord(root, "slot-refill");
  const assessment = judgeAssessmentSteps(nowSec, { heartbeat, readyPool: readyPoolRec, slotRefill: slotRefillRec }, maxAge);

  let v = assessment.stale.length > 0
    ? {
        alive: false,
        status: "assessment-steps-stale",
        ageSecs: null,
        reason: ASSESSMENT_NOT_RUN_REASON,
        assessmentSteps: assessment,
      }
    : judgeHeartbeatWithRefusal(nowSec, heartbeat, refusalTs, maxAge);

  // AC2/AC3: a FRESH heartbeat must also satisfy the minimal field contract. A fresh-but-shrunk
  // heartbeat (e.g. the 2026-08-11 05:20 3-key {ts, delaySeconds, reason}) is RED — reason prose
  // never substitutes for the structured keys.
  let fields = null;
  let dispatchState = null;
  let endInvariant = null;
  let machineRefill = null;
  if (v.status === "alive") {
    fields = checkFieldContract(heartbeat);
    if (!fields.ok) {
      v = {
        alive: false,
        status: "fields-missing",
        ageSecs: v.ageSecs,
        reason: FIELDS_MISSING_REASON,
        missing: fields.missing,
        wrongType: fields.wrongType,
      };
    } else {
      // AC53 AC1/AC2 (gap-inner-self-wake-sleep-empty-slots-not-dispatch): a FRESH heartbeat must
      // carry the five dispatch-state keys (AC1 — else the record cannot distinguish "nothing
      // dispatchable" from "dispatchable but didn't dispatch"), and must NOT end a round while
      // dispatchable work remained (AC2 — the end-invariant, judged mechanically so the negative
      // control replay lights red).
      dispatchState = checkDispatchStateContract(heartbeat);
      if (!dispatchState.ok) {
        v = {
          alive: false,
          status: "dispatch-state-missing",
          ageSecs: v.ageSecs,
          reason: "inner-wakeup-heartbeat-dispatch-state-missing",
          missing: dispatchState.missing,
          wrongType: dispatchState.wrongType,
        };
      } else {
        // AC53 判据① gate (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13
        // ruling): the end-invariant MUST be judged on the MACHINE's fresh slot-refill output — the
        // heartbeat's recorded no_refill_reason is SELF-REPORT (the judged party writes it), and a
        // prose reason could always be written to make noReason=false ⇒ the old checker passed while
        // the machine said no_refill_reason=None (hard rule 4b: a self-produced quantity cannot judge
        // its producer). The gate re-runs slot-refill with the --in-flight set the caller provided and
        // judges the invariant on ITS five dispatch-state keys; the heartbeat's recorded fields are
        // display-only. Machine unavailability ⇒ fail-closed RED.
        // gap-inner-heartbeat-check-not-evaluated-when-no-inflight (AC1, hard rule 3b): WITHOUT
        // --in-flight the touches-overlap-in-flight step cannot be judged — the empty-in-flight
        // machine view is exactly the computation that produced the constant false DEAD. The invariant
        // is then UNEVALUABLE ⇒ the checker reports NOT-EVALUATED (independent value, evaluated:false,
        // exit 0), NEVER the DEAD verdict. DEAD stays reserved for real violations (in-flight set
        // provided AND the four-part invariant holds). runMachineSlotRefill is NOT invoked in the
        // unevaluable branch — re-running it against an empty in-flight set is precisely the misleading
        // shape we refuse to judge.
        if (!inFlightProvided) {
          endInvariant = {
            evaluated: false,
            status: "not-evaluated",
            reason: END_INVARIANT_NOT_EVALUATED_REASON,
            why: "no --in-flight provided — touches-overlap-in-flight cannot be judged",
          };
          v = {
            alive: true,
            verdict: "NOT-EVALUATED",
            status: "end-invariant-not-evaluated",
            ageSecs: v.ageSecs,
            evaluated: false,
            reason: END_INVARIANT_NOT_EVALUATED_REASON,
            endInvariant,
          };
        } else {
          const machine = runMachineSlotRefill({
            root,
            inFlightIds,
            // AC53-gate 判据1: the gate passes the running set it observed this round (Consumer B);
            // dispatchable_disjoint (Consumer A) stays on the wide in-flight view.
            running: runningIds,
            cap: typeof heartbeat.effectiveCap === "number" ? heartbeat.effectiveCap : FIXED_DISPATCH_CAP,
          });
          if (!machine.ok) {
            v = {
              alive: false,
              status: "end-invariant-unverifiable",
              ageSecs: v.ageSecs,
              reason: MACHINE_UNVERIFIABLE_REASON,
              machineError: machine.error,
            };
          } else {
            machineRefill = machine.refill;
            endInvariant = { ...judgeEndInvariantAgainstMachine(heartbeat, machine.refill), evaluated: true };
            if (endInvariant.violated) {
              v = {
                alive: false,
                status: "invariant-violated",
                ageSecs: v.ageSecs,
                reason: INVARIANT_VIOLATED_REASON,
                evidence: endInvariant.evidence,
              };
            }
          }
        }
      }
    }
  }

  const filePath = path.join(root, ".quay", HEARTBEAT_FILE);
  if (jsonOut) {
    console.log(JSON.stringify({
      file: filePath,
      generatedAt: new Date().toISOString(),
      nowSec,
      verdict: v.verdict || (v.alive ? "ALIVE" : "DEAD"),
      status: v.status,
      ageSecs: v.ageSecs,
      maxAgeSecs: maxAge,
      reason: v.reason,
      // A13 (gap-a13-heartbeat-refusal-write-invisible) (甲): which ts kept the product fresh —
      // "heartbeat" (main json/jsonl) or "refusal" (refusals side-carrier). latestRefusalTs is the
      // newest refusal row the verdict considered (null when none exists).
      freshnessSource: v.freshnessSource ?? null,
      latestRefusalTs: refusalTs,
      fieldContract: fields
        ? { ok: fields.ok, required: REQUIRED_HEARTBEAT_FIELDS, fieldCount: fields.fieldCount, missing: fields.missing, wrongType: fields.wrongType }
        : null,
      dispatchStateContract: dispatchState
        ? { ok: dispatchState.ok, required: REQUIRED_DISPATCH_STATE_FIELDS, missing: dispatchState.missing, wrongType: dispatchState.wrongType }
        : null,
      // AC53 判据① (gap-inner-self-wake-sleep-empty-slots-not-dispatch): the MACHINE's fresh slot-refill
      // output — the end-invariant is judged on THIS, never the heartbeat's recorded fields.
      machineSlotRefill: machineRefill
        ? {
            measurement_source: machineRefill.measurement_source,
            should_refill: machineRefill.should_refill,
            no_refill_reason: machineRefill.no_refill_reason,
            slots_free: machineRefill.slots_free,
            dispatchable_disjoint: machineRefill.dispatchable_disjoint,
            pool: machineRefill.pool,
            // AC53-gate (tasks/gap-ac53-gate-not-wired-to-running-set, 判据1): the NARROW Consumer-B
            // denominator + its provenance — "running-subagents" (the caller passed --running) vs
            // "in-flight-fallback" (Consumer B reused the wide set; the pre-fix gate read this).
            running_subagent_count: machineRefill.running_subagent_count,
            slot_denominator_source: machineRefill.slot_denominator_source,
          }
        : null,
      machineInFlight: {
        // Outer may not know inner's in-flight set — ABSENT (undefined) ⇒ the end-invariant is
        // NOT-EVALUATED (never a false DEAD); provided (even `--in-flight ''` = measured zero) ⇒ the
        // invariant is judgeable.
        inFlightIds,
        source: inFlightProvided ? "--in-flight" : "none (not provided — end-invariant NOT-EVALUATED)",
        // AC53-gate 判据3 (3b): `runningIds` null = NOT provided (Consumer B falls back to the wide
        // set) vs `[]` = measured zero (true zero running subagents). Never same-shaped.
        runningIds: runningIds ?? null,
        runningSource: runningFlag !== undefined ? "--running" : "none (wide in-flight fallback)",
      },
      endInvariant: endInvariant
        ? {
            evaluated: endInvariant.evaluated === true,
            status: endInvariant.status ?? (endInvariant.violated ? "violated" : "ok"),
            ok: endInvariant.ok ?? null,
            violated: endInvariant.violated ?? null,
            judgedFrom: endInvariant.judgedFrom ?? null,
            reason: endInvariant.reason ?? null,
            why: endInvariant.why ?? null,
            evidence: endInvariant.evidence ?? null,
          }
        : null,
      // I1 read-product criterion (tasks/gap-inner-assessment-steps-no-product-reader): the three
      // dispatch-evaluation freshness signals. status "assessment-steps-stale" + reason
      // "inner-assessment-steps-not-run" ⇒ "inner 派发评估未跑".
      assessmentSteps: {
        status: assessment.status,
        reason: assessment.reason,
        stale: assessment.stale,
        signals: {
          heartbeat: assessment.signals.heartbeat,
          readyPool: assessment.signals.readyPool,
          slotRefill: assessment.signals.slotRefill,
        },
      },
    }, null, 2));
  } else {
    const base = `inner-wakeup-heartbeat: ${v.verdict || (v.alive ? "ALIVE" : "DEAD")}`;
    if (v.status === "alive") {
      const src = v.freshnessSource === "refusal" ? ", freshness via recent refusal" : "";
      console.log(`${base} — age ${v.ageSecs}s ≤ ${maxAge}s, fields ${fields.fieldCount}/${REQUIRED_HEARTBEAT_FIELDS.length} + dispatch-state ${dispatchState.ok ? "ok" : "missing"} (heartbeat fresh + contracts ok${src})`);
    } else if (v.status === "assessment-steps-stale") {
      const a = v.assessmentSteps || {};
      const part = (s) => {
        if (s.status === "stale") return `${s.name} 陈旧 ${s.ageSecs}s`;
        if (s.status === "not-recorded") return `${s.name} 无记录(NOT-EVALUATED)`;
        if (s.status === "malformed") return `${s.name} 损坏`;
        if (s.status === "missing") return `${s.name} 缺失`;
        return `${s.name} 新鲜`;
      };
      console.log(`${base} — inner 派发评估未跑 ⇒ 评估三步骤陈旧（${[a.signals?.heartbeat, a.signals?.readyPool, a.signals?.slotRefill].filter(Boolean).map(part).join(" / ")}）`);
    } else if (v.status === "stale") {
      const last = new Date(nowSec * 1000 - v.ageSecs * 1000).toISOString();
      console.log(`${base} — age ${v.ageSecs}s > ${maxAge}s ⇒ inner 兜底心跳断 (last reschedule ${last})`);
    } else if (v.status === "missing") {
      console.log(`${base} — ${filePath} MISSING (never written) ⇒ inner 兜底心跳断`);
    } else if (v.status === "fields-missing") {
      const miss = [...(v.missing || []).map((f) => `${f}(缺失)`), ...(v.wrongType || []).map((f) => `${f}(类型错)`)]
        .join(" / ");
      console.log(`${base} — 心跳字段缺失 ⇒ inner 兜底心跳不合规（缺 ${miss}）`);
    } else if (v.status === "dispatch-state-missing") {
      const miss = [...(v.missing || []).map((f) => `${f}(缺失)`), ...(v.wrongType || []).map((f) => `${f}(类型错)`)]
        .join(" / ");
      console.log(`${base} — 派发状态五键缺失 ⇒ 记录分不清「没货可派」与「有货不派」（缺 ${miss}）`);
    } else if (v.status === "invariant-violated") {
      const e = v.evidence || {};
      console.log(`${base} — 结束不变式违例 ⇒ 机件说「有货可派却结束本轮」（should_refill=${e.should_refill} slots_free=${e.slots_free} dispatchable_disjoint=${e.dispatchable_disjoint} no_refill_reason=${JSON.stringify(e.no_refill_reason)}；心跳自述 recorded_no_refill_reason=${JSON.stringify(e.recorded_no_refill_reason ?? null)} 仅展示不参与判据）`);
    } else if (v.status === "end-invariant-unverifiable") {
      console.log(`${base} — 结束不变式无法验证（slot-refill 机件重跑失败：${v.machineError || "unknown"}）⇒ 不能验证就不能放行（fail-closed）`);
    } else if (v.status === "end-invariant-not-evaluated") {
      console.log(`${base} — 结束不变式未评估（未传 --in-flight 在飞集 ⇒ touches-overlap-in-flight 判不出）⇒ 不判 DEAD、也不假报 ALIVE（硬规则 3b：无法评估=独立取值，exit 0 不升级）`);
    } else {
      console.log(`${base} — ${filePath} MALFORMED (no valid ts) ⇒ inner 兜底心跳断`);
    }
  }
  return v.alive ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
