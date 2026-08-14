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
//        [--max-age-secs <N>] [--json]
//
// Exit: 0 = ALIVE (heartbeat fresh) · 1 = DEAD (missing / malformed / stale) · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDirectEntry } from "./gate-script-base.ts";
// AC53 判据① gate (gap-inner-self-wake-sleep-empty-slots-not-dispatch, outer 2026-08-13 ruling): the
// end-invariant MUST be judged on the MACHINE's fresh slot-refill output, never the heartbeat's
// self-reported fields. analyzeSlotRefill is the pure machine decision; FIXED_DISPATCH_CAP is the
// default cap the tick's dispatch decision uses (A10).
import { analyzeSlotRefill, FIXED_DISPATCH_CAP } from "./slot-refill.ts";

/** Heartbeat file name under `<root>/.quay/` — append-only jsonl (AC53 AC3: 可回看 — every
 *  reschedule appends a line, so the history is reviewable, not a single-slot snapshot). */
export const HEARTBEAT_FILE = "inner-wakeup-heartbeat.jsonl";

/** Legacy single-JSON snapshot (the pre-AC53 format). Still read as a fallback when the jsonl is
 *  absent, and still mirrored by the writer so legacy readers keep working (e.g. the semantic-observer
 *  judge, whose default heartbeat path is `<root>/.quay/<layer>-wakeup-heartbeat.json`). */
export const LEGACY_HEARTBEAT_FILE = "inner-wakeup-heartbeat.json";

/** Default dead threshold: 3 tick periods × 1800s (task Contract band `inner_wakeup_heartbeat_age <= 5400`). */
export const DEFAULT_MAX_AGE_SECS = 5400;

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

/**
 * Run a FRESH slot-refill — the AC53 判据① MACHINE measurement (gap-inner-self-wake-sleep-empty-slots-
 * not-dispatch, outer 2026-08-13 ruling). The checker's end-invariant gate judges THIS result, never
 * the heartbeat's recorded no_refill_reason (hard rule 4b: the judged party must not judge itself).
 * @param {object} o
 * @param {string} o.root workspace root (the <root>/tasks store)
 * @param {string[]} [o.inFlightIds] the session's in-flight task ids. The checker is run by OUTER, who
 *   may not know inner's in-flight set: pass `--in-flight` when the caller knows it; DEFAULT EMPTY
 *   otherwise — the invariant is then computed against the WIDEST free-slot view, which is FAIL-CLOSED
 *   (any dispatchable work + any free slot ⇒ RED; a false RED escalates, a false PASS hides the
 *   defect). This is the documented fail-closed trade of a checker that refuses to trust self-report.
 * @param {number} [o.cap] dispatch cap — the tick's effective cap (heartbeat.effectiveCap), default
 *   FIXED_DISPATCH_CAP (5).
 * @returns {{ok:true, refill:object}|{ok:false, error:string}} fail-closed: a slot-refill error ⇒
 *   {ok:false} — the checker cannot verify ⇒ cannot pass.
 */
export function runMachineSlotRefill({ root, inFlightIds = [], cap = FIXED_DISPATCH_CAP }) {
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
  (a) freshness — age = now − ts > max-age (default ${DEFAULT_MAX_AGE_SECS}s = 3 tick periods × 1800s)
      ⇒ "inner 兜底心跳断" + exit 1 (escalate); missing / malformed file = same dead verdict (fail-closed);
  (b) minimal field contract — a FRESH heartbeat must carry the ${REQUIRED_HEARTBEAT_FIELDS.length} structured
      keys ${REQUIRED_HEARTBEAT_FIELDS.join("/")} (Contract band heartbeat_field_count >= 7; blocked[] +
      runIds are the A3 "inner 卡住" premise). Missing key / wrong type ⇒ "心跳字段缺失" + exit 1.
      reason prose may supplement but NEVER replace the structured fields (AC3).
  (c) AC53 dispatch-state contract (AC1) — a FRESH heartbeat must carry the five keys
      ${REQUIRED_DISPATCH_STATE_FIELDS.join("/")} so the record distinguishes "nothing dispatchable"
      from "dispatchable but didn't dispatch". Missing ⇒ "派发状态五键缺失" + exit 1.
  (d) AC53 end-invariant (AC2, outer 2026-08-13 ruling) — the invariant is judged on the MACHINE's
      FRESH slot-refill output (a re-run of analyzeSlotRefill against <root>/tasks with the --in-flight
      set), NEVER on the heartbeat's recorded no_refill_reason (self-report — the judged party must not
      judge itself, hard rule 4b). Machine says should_refill=true ∧ slots_free>0 ∧
      dispatchable_disjoint>0 ∧ no_refill_reason empty ⇒ "结束不变式违例" + exit 1 — a prose self-report
      in the heartbeat can NEVER make this pass (the AC53 bypass: "ac51 subagent in flight…" shielded a
      null machine reason). Heartbeat's recorded dispatch-state is display-only evidence
      (recorded_no_refill_reason). Machine unverifiable ⇒ "结束不变式无法验证" + exit 1 (fail-closed).

Usage:
  --root <dir>         workspace root (default: cwd) — reads <root>/.quay/${HEARTBEAT_FILE}
  --max-age-secs <N>   dead threshold in seconds (default ${DEFAULT_MAX_AGE_SECS})
  --in-flight <id1,id2>  AC53: the session's in-flight task ids for the fresh slot-refill re-run.
                         Outer may not know inner's set — DEFAULT EMPTY is the fail-closed baseline
                         (the invariant is judged against the widest free-slot view).
  --json               JSON output (default human-readable)

Exit: 0 ALIVE · 1 DEAD (missing / malformed / stale / fields-missing / dispatch-state-missing /
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
  // `--in-flight` supplies it when known; DEFAULT EMPTY is the fail-closed baseline (the invariant is
  // then computed against the widest free-slot view ⇒ any dispatchable work + free slot lights RED).
  const inFlightFlag = flagVal("--in-flight");
  const inFlightIds = inFlightFlag !== undefined
    ? String(inFlightFlag).split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (!Number.isFinite(maxAge) || maxAge < 0) {
    console.error("inner-wakeup-heartbeat-check: --max-age-secs must be a non-negative number");
    return 2;
  }

  const text = readHeartbeatText(root);
  const heartbeat = parseHeartbeat(text);
  const nowSec = Math.floor(Date.now() / 1000);
  let v = judgeHeartbeat(nowSec, heartbeat, maxAge);

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
        // its producer). The gate now re-runs slot-refill (--in-flight from the caller, else the
        // fail-closed empty set) and judges the invariant on ITS five dispatch-state keys; the
        // heartbeat's recorded fields are display-only. Machine unavailability ⇒ fail-closed RED.
        const machine = runMachineSlotRefill({
          root,
          inFlightIds,
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
          endInvariant = judgeEndInvariantAgainstMachine(heartbeat, machine.refill);
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

  const filePath = path.join(root, ".quay", HEARTBEAT_FILE);
  if (jsonOut) {
    console.log(JSON.stringify({
      file: filePath,
      generatedAt: new Date().toISOString(),
      nowSec,
      verdict: v.alive ? "ALIVE" : "DEAD",
      status: v.status,
      ageSecs: v.ageSecs,
      maxAgeSecs: maxAge,
      reason: v.reason,
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
          }
        : null,
      machineInFlight: {
        // Outer may not know inner's in-flight set — empty is the fail-closed baseline.
        inFlightIds,
        source: inFlightFlag !== undefined ? "--in-flight" : "none (fail-closed empty)",
      },
      endInvariant: endInvariant
        ? { ok: endInvariant.ok, violated: endInvariant.violated, judgedFrom: endInvariant.judgedFrom ?? null, reason: endInvariant.reason, evidence: endInvariant.evidence }
        : null,
    }, null, 2));
  } else {
    const base = `inner-wakeup-heartbeat: ${v.alive ? "ALIVE" : "DEAD"}`;
    if (v.status === "alive") {
      console.log(`${base} — age ${v.ageSecs}s ≤ ${maxAge}s, fields ${fields.fieldCount}/${REQUIRED_HEARTBEAT_FIELDS.length} + dispatch-state ${dispatchState.ok ? "ok" : "missing"} (heartbeat fresh + contracts ok)`);
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
