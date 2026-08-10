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
import { isDirectEntry } from "./gate-script-base.ts";

/** Heartbeat file name under `<root>/.quay/`. */
export const HEARTBEAT_FILE = "inner-wakeup-heartbeat.json";

/** Default dead threshold: 3 tick periods × 1800s (task Contract band `inner_wakeup_heartbeat_age <= 5400`). */
export const DEFAULT_MAX_AGE_SECS = 5400;

/** Sentinel for a file that exists but does not parse / lacks a valid `ts`. */
export const MALFORMED = Object.freeze({ __malformed__: true });

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

function usage() {
  console.error(`inner-wakeup-heartbeat-check.ts — inner 兜底心跳产物检查器（外层读）

Reads <root>/.quay/${HEARTBEAT_FILE} ({ts, delaySeconds, reason} — written by inner each time it
reschedules ScheduleWakeup, same shape as suite-chain-heartbeat.json) and judges freshness:
age = now − ts > max-age (default ${DEFAULT_MAX_AGE_SECS}s = 3 tick periods × 1800s) ⇒
"inner 兜底心跳断" + exit 1 (escalate). Missing / malformed file = same dead verdict (fail-closed).

Usage:
  --root <dir>         workspace root (default: cwd) — reads <root>/.quay/${HEARTBEAT_FILE}
  --max-age-secs <N>   dead threshold in seconds (default ${DEFAULT_MAX_AGE_SECS})
  --json               JSON output (default human-readable)

Exit: 0 ALIVE · 1 DEAD (missing / malformed / stale) · 2 usage error`);
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
  const v = judgeHeartbeat(nowSec, heartbeat, maxAge);

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
    }, null, 2));
  } else {
    const base = `inner-wakeup-heartbeat: ${v.alive ? "ALIVE" : "DEAD"}`;
    if (v.status === "alive") {
      console.log(`${base} — age ${v.ageSecs}s ≤ ${maxAge}s (heartbeat fresh)`);
    } else if (v.status === "stale") {
      const last = new Date(nowSec * 1000 - v.ageSecs * 1000).toISOString();
      console.log(`${base} — age ${v.ageSecs}s > ${maxAge}s ⇒ inner 兜底心跳断 (last reschedule ${last})`);
    } else if (v.status === "missing") {
      console.log(`${base} — ${filePath} MISSING (never written) ⇒ inner 兜底心跳断`);
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
