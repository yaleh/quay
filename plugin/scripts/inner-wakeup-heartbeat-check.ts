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

/** Heartbeat file name under `<root>/.quay/`. */
export const HEARTBEAT_FILE = "inner-wakeup-heartbeat.json";

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

/** Read the heartbeat file text under `<root>/.quay/`. Returns null when missing. */
export function readHeartbeatText(root) {
  const p = path.join(root || ".", ".quay", HEARTBEAT_FILE);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
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

Reads <root>/.quay/${HEARTBEAT_FILE} (written by inner each time it reschedules ScheduleWakeup via
plugin/scripts/inner-wakeup-heartbeat.ts) and judges BOTH:
  (a) freshness — age = now − ts > max-age (default ${DEFAULT_MAX_AGE_SECS}s = 3 tick periods × 1800s)
      ⇒ "inner 兜底心跳断" + exit 1 (escalate); missing / malformed file = same dead verdict (fail-closed);
  (b) minimal field contract — a FRESH heartbeat must carry the ${REQUIRED_HEARTBEAT_FIELDS.length} structured
      keys ${REQUIRED_HEARTBEAT_FIELDS.join("/")} (Contract band heartbeat_field_count >= 7; blocked[] +
      runIds are the A3 "inner 卡住" premise). Missing key / wrong type ⇒ "心跳字段缺失" + exit 1.
      reason prose may supplement but NEVER replace the structured fields (AC3).

Usage:
  --root <dir>         workspace root (default: cwd) — reads <root>/.quay/${HEARTBEAT_FILE}
  --max-age-secs <N>   dead threshold in seconds (default ${DEFAULT_MAX_AGE_SECS})
  --json               JSON output (default human-readable)

Exit: 0 ALIVE · 1 DEAD (missing / malformed / stale / fields-missing) · 2 usage error`);
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
    }, null, 2));
  } else {
    const base = `inner-wakeup-heartbeat: ${v.alive ? "ALIVE" : "DEAD"}`;
    if (v.status === "alive") {
      console.log(`${base} — age ${v.ageSecs}s ≤ ${maxAge}s, fields ${fields.fieldCount}/${REQUIRED_HEARTBEAT_FIELDS.length} (heartbeat fresh + contract ok)`);
    } else if (v.status === "stale") {
      const last = new Date(nowSec * 1000 - v.ageSecs * 1000).toISOString();
      console.log(`${base} — age ${v.ageSecs}s > ${maxAge}s ⇒ inner 兜底心跳断 (last reschedule ${last})`);
    } else if (v.status === "missing") {
      console.log(`${base} — ${filePath} MISSING (never written) ⇒ inner 兜底心跳断`);
    } else if (v.status === "fields-missing") {
      const miss = [...(v.missing || []).map((f) => `${f}(缺失)`), ...(v.wrongType || []).map((f) => `${f}(类型错)`)]
        .join(" / ");
      console.log(`${base} — 心跳字段缺失 ⇒ inner 兜底心跳不合规（缺 ${miss}）`);
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
