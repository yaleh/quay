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

/**
 * The AC2 end-invariant: a tick must NOT end while `should_refill ∧ slots_free>0 ∧
 * dispatchable_disjoint>0 ∧ no_refill_reason empty`. PURE. Only meaningful when the dispatch-state
 * contract is present (a missing key is not a violation — the caller reports dispatch-state-missing
 * separately). This is the mechanical form the AC4 negative control replays: the real 04:02:52Z /
 * 04:22Z heartbeats both carry the violating shape and MUST return violated=true (they never lit red
 * before — the record couldn't even express the question).
 * @param {object} hb a heartbeat carrying the AC53 dispatch-state fields
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

// ── AC3 trigger wiring (tasks/gap-semantic-observer-judge-stopped-awaiting) ────────────────────────
//
// The semantic judge must NOT run every round (cost). Trigger when the free text changed (hash) OR when
// the structured fields may contradict free text — the exact heuristic is `blocked==[] && agentDispatches
// >= agentLimit` (2026-08-10: blocked=[] said "no block" while reason said "dispatch stopped, awaiting
// outer /clear"). These three are the PURE trigger functions; the judge CLI imports them.

/** AC3 heuristic: `blocked==[] && agentDispatches>=agentLimit`. PURE. */
export function semanticTriggerHeuristic(heartbeat) {
  const blocked = Array.isArray(heartbeat?.blocked) ? heartbeat.blocked : [];
  const atLimit =
    typeof heartbeat?.agentDispatches === "number" &&
    typeof heartbeat?.agentLimit === "number" &&
    heartbeat.agentDispatches >= heartbeat.agentLimit;
  return blocked.length === 0 && atLimit;
}

/** Free-text content hash (sha256, first 16 hex). PURE. */
export function freeTextHash(freeText) {
  return createHash("sha256").update(String(freeText ?? "")).digest("hex").slice(0, 16);
}

/**
 * Evaluate the AC3 trigger. PURE.
 * @param {object|null} heartbeat parsed heartbeat (may be null)
 * @param {string} freeText combined free text (reason + tick report)
 * @param {string|null|undefined} prevHash previous free-text hash (null = no baseline ⇒ hashChanged=false)
 * @returns {{fired:boolean, heuristic:boolean, hashChanged:boolean, hash:string}}
 */
export function evaluateTrigger(heartbeat, freeText, prevHash) {
  const hash = freeTextHash(freeText);
  const heuristic = semanticTriggerHeuristic(heartbeat);
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
  (d) AC53 end-invariant (AC2) — a fresh heartbeat must NOT end a round while
      should_refill=true ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_refill_reason empty. Violation
      ⇒ "结束不变式违例" + exit 1 (the 04:02:52Z / 04:22Z negative-control shapes light RED, AC4).

Usage:
  --root <dir>         workspace root (default: cwd) — reads <root>/.quay/${HEARTBEAT_FILE}
  --max-age-secs <N>   dead threshold in seconds (default ${DEFAULT_MAX_AGE_SECS})
  --json               JSON output (default human-readable)

Exit: 0 ALIVE · 1 DEAD (missing / malformed / stale / fields-missing / dispatch-state-missing /
invariant-violated) · 2 usage error`);
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
        endInvariant = judgeEndInvariant(heartbeat);
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
      endInvariant: endInvariant
        ? { ok: endInvariant.ok, violated: endInvariant.violated, reason: endInvariant.reason, evidence: endInvariant.evidence }
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
      console.log(`${base} — 结束不变式违例 ⇒ 有货可派却结束本轮（should_refill=${e.should_refill} slots_free=${e.slots_free} dispatchable_disjoint=${e.dispatchable_disjoint} no_refill_reason=${JSON.stringify(e.no_refill_reason)}）`);
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
