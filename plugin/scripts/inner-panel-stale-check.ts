#!/usr/bin/env node
// inner-panel-stale-check.ts — 面板观测机制（状态转换表达）
// (tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close)
//
// Defect family: the observation view cannot distinguish two semantically opposite states. Earlier
// it was "stuck vs running"; here it is "ended vs running". After a bracket closes (--task-end),
// the inner Claude TUI panel may keep showing the task's agent line (e.g.
// "Committing observer-registry task work 3h 5m 32s") until the panel self-cleans. In that window
// the frozen dead line is visually INDISTINGUISHABLE from a live line without cross-time sampling
// (does the timer advance?). This script is the MECHANICAL observer that expresses the state
// transition:
//   1. bracket cross-reference (AC1/AC3, single sample): a line whose task id is NOT in telemetry
//      `inProgress` (bracket closed) but is still present on the panel ⇒ ENDED — marked, so it is
//      no longer visually identical to a live line.
//   2. frozen-timer (AC2): two panel samples N seconds apart; a line whose timer did NOT advance
//      ⇒ FROZEN — the "计时 N 秒未动" marker, no human cross-time sampling needed (the script does
//      the two samples).
//
// Pure functions (no side effects) are exported for hermetic tests; the CLI wires pane capture +
// telemetry reading. Output is a per-line state machine: live / ended / frozen / unknown.
//
// Usage:
//   node --experimental-strip-types inner-panel-stale-check.ts --pane <file> [--after <file>] \
//        --report <report.json> [--json]
//   node --experimental-strip-types inner-panel-stale-check.ts --target <tmux-target> \
//        [--after-target <t>] --root <workspace-root> [--json]
//
// Exit: 0 = no ended/frozen lines (CLEAN); 1 = stale lines found (ended ∪ frozen); 2 = usage/IO error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

/** The panel's agent state verbs (the Contract measure's grep surface). */
export const STATE_VERBS = Object.freeze([
  "Committing", "Running", "Waiting", "Execute", "Checking", "Monitoring", "Verifying",
]);

const VERB_ALT = STATE_VERBS.join("|");
const AGENT_LINE_RE = new RegExp(`\\b(${VERB_ALT})\\b`);

/** Duration token scan — any `N[hms]` run in the line (handles "3h 5m 32s", "1h46m21s", "26m51s"). */
const DURATION_TOKEN_RE = /[0-9]+\s*[hms]/g;

/** Default frozen-timer threshold: a line whose timer did not advance across two samples. */
export const DEFAULT_FROZEN_THRESHOLD_SECS = 30;

// ── Pure parsing ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a line's elapsed-timer into seconds. Returns null when the line carries no `N[hms]` token.
 * PURE.
 */
export function parseTimerSec(text) {
  const tokens = text.match(DURATION_TOKEN_RE);
  if (!tokens || tokens.length === 0) return null;
  let total = 0;
  for (const tok of tokens) {
    const n = parseInt(tok, 10);
    if (/h/.test(tok)) total += n * 3600;
    else if (/m/.test(tok)) total += n * 60;
    else if (/s/.test(tok)) total += n;
  }
  return total;
}

/** Strip `N[hms]` tokens from a line (line identity without the moving timer). PURE. */
export function stripTimer(text) {
  return text.replace(DURATION_TOKEN_RE, "").replace(/\s+/g, " ").trim();
}

/**
 * Extract agent lines from a pane text: lines that contain one of STATE_VERBS, annotated with the
 * line's timer in seconds. PURE.
 * @param {string} paneText
 * @returns {Array<{raw:string, verb:string, timerSec:number|null}>}
 */
export function extractAgentLines(paneText) {
  const out = [];
  for (const rawLine of paneText.split("\n")) {
    const m = rawLine.match(AGENT_LINE_RE);
    if (!m) continue;
    out.push({ raw: rawLine.trim(), verb: m[1], timerSec: parseTimerSec(rawLine) });
  }
  return out;
}

/** Escape a string for use in a RegExp literal. PURE. */
export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a line against a set of known task ids using a strict token boundary (the id is bounded by
 * non-[A-Za-z0-9._-] on both sides, so `gap` cannot match inside `gap-something`). Returns the
 * matching ids, longest first. PURE.
 */
export function matchTaskIds(raw, knownTaskIds) {
  const hits = [];
  for (const id of knownTaskIds ?? []) {
    const re = new RegExp(`(?<![A-Za-z0-9._-])${escapeRe(id)}(?![A-Za-z0-9._-])`);
    if (re.test(raw)) hits.push(id);
  }
  return hits.sort((a, b) => b.length - a.length);
}

/**
 * Classify agent lines against a telemetry report:
 *   state "live"   — task id resolves AND is in inProgress (bracket open).
 *   state "ended"  — task id resolves but is NOT in inProgress (bracket closed) yet the line is
 *                    still present — the defect shape, marked (AC1).
 *   state "unknown" — no known task id resolves (cannot bracket cross-ref; frozen detection still
 *                    applies).
 * PURE.
 * @param {Array<{raw:string, verb:string, timerSec:number|null}>} lines
 * @param {{inProgress: Array<{taskId:string}>, tasks?: Array<{taskId:string}>,
 *          orphaned?: Array<{taskId:string}>, reconciled?: Array<{taskId:string}>,
 *          unreliable?: Array<{taskId:string}>, reconcilable?: Array<{taskId:string}>}} report
 * @returns {Array<{raw:string, verb:string, timerSec:number|null, taskId:string|null, state:"live"|"ended"|"unknown"}>}
 */
export function classifyLines(lines, report) {
  const inProgressIds = new Set((report?.inProgress ?? []).map((t) => t.taskId));
  const knownTaskIds = collectKnownTaskIds(report);
  return lines.map((l) => {
    const ids = matchTaskIds(l.raw, knownTaskIds);
    if (ids.length === 0) return { ...l, taskId: null, state: "unknown" };
    const taskId = ids[0];
    return { ...l, taskId, state: inProgressIds.has(taskId) ? "live" : "ended" };
  });
}

/** Collect the union of task ids the report knows about (any lifecycle section). PURE. */
export function collectKnownTaskIds(report) {
  const seen = new Set();
  for (const key of ["inProgress", "tasks", "orphaned", "reconciled", "unreliable", "reconcilable"]) {
    for (const rec of report?.[key] ?? []) {
      if (rec?.taskId) seen.add(rec.taskId);
    }
  }
  return [...seen];
}

/**
 * Frozen-timer detection across two pane samples. A line in the FIRST sample is FROZEN when the
 * same line (same verb + same task id, or same timer-stripped text when no task id) is present in
 * the SECOND sample and its timer did not advance (`timerSec` unchanged). PURE.
 * @param {Array<{raw:string, verb:string, timerSec:number|null, taskId?:string|null}>} first
 * @param {Array<{raw:string, verb:string, timerSec:number|null}>} second
 * @returns {Array<{raw:string, verb:string, timerSec:number|null, taskId?:string|null}>}
 */
export function detectFrozen(first, second) {
  const frozen = [];
  for (const a of first) {
    if (a.timerSec == null) continue;
    const b = second.find(
      (bl) =>
        bl.verb === a.verb &&
        bl.timerSec != null &&
        (a.taskId ? bl.raw.includes(a.taskId) : stripTimer(bl.raw) === stripTimer(a.raw)) &&
        bl.timerSec === a.timerSec,
    );
    if (b) frozen.push(a);
  }
  return frozen;
}

/**
 * The full observer verdict over one or two pane samples + a telemetry report.
 *   ended  — bracket-closed lines still present (AC1/AC3 signal).
 *   frozen — timer-not-advancing lines (AC2 signal).
 *   stale  — ended ∪ frozen (deduped by raw line).
 *   live   — bracket-open lines (the honest "still running" set).
 * PURE.
 */
export function runStaleCheck(paneText, report, { afterPaneText = null } = {}) {
  const first = classifyLines(extractAgentLines(paneText), report);
  const ended = first.filter((l) => l.state === "ended");
  const live = first.filter((l) => l.state === "live");
  let frozen = [];
  if (afterPaneText) {
    frozen = detectFrozen(first, extractAgentLines(afterPaneText));
  }
  const staleSeen = new Set();
  const stale = [];
  for (const l of [...ended, ...frozen]) {
    if (!staleSeen.has(l.raw)) { staleSeen.add(l.raw); stale.push(l); }
  }
  return { first, ended, frozen, live, stale, verdict: stale.length > 0 ? "STALE" : "CLEAN" };
}

// ── CLI wiring (side-effectful: tmux capture / telemetry read) ───────────────────────────────────────

function usage() {
  console.error(`inner-panel-stale-check.ts — 面板观测机制（状态转换表达）

Usage:
  --pane <file>            pane text file (first sample)
  --target <tmux-target>   live pane target instead of --pane (e.g. quay-0:inner)
  --after <file>           second pane sample (frozen-timer detection, AC2)
  --after-target <target>  live second sample instead of --after
  --report <json>          telemetry --report --json output
  --root <dir>             workspace root (runs fast-mode-telemetry --report --json itself)
  --json                   JSON output (default human-readable)

Exit: 0 CLEAN · 1 STALE (ended ∪ frozen lines) · 2 usage/IO error`);
}

function readPane(fileOrTarget) {
  if (fileOrTarget === null || fileOrTarget === undefined) return null;
  if (fs.existsSync(fileOrTarget)) {
    return fs.readFileSync(fileOrTarget, "utf8");
  }
  // Not a file → treat as a tmux target.
  const r = spawnSync("tmux", ["capture-pane", "-p", "-t", fileOrTarget], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`cannot capture pane "${fileOrTarget}" (not a file, tmux failed): ${r.stderr?.trim() ?? ""}`);
  }
  return r.stdout ?? "";
}

function readReport(reportFile, root) {
  if (reportFile) {
    if (!fs.existsSync(reportFile)) throw new Error(`--report file not found: ${reportFile}`);
    return JSON.parse(fs.readFileSync(reportFile, "utf8"));
  }
  if (!root) throw new Error("need --report <json> or --root <dir> (to run fast-mode-telemetry --report --json)");
  const telemetry = path.join(root, "plugin", "scripts", "fast-mode-telemetry.ts");
  if (!fs.existsSync(telemetry)) throw new Error(`telemetry script not found under --root: ${telemetry}`);
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", telemetry, "--root", root, "--report", "--json"], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`fast-mode-telemetry --report failed: ${r.stderr?.trim() ?? ""}`);
  return JSON.parse(r.stdout);
}

/**
 * CLI entry. @param {string[]} argv @returns {Promise<number>}
 */
export async function main(argv) {
  const args = argv.slice(2);
  const flagVal = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node inner-panel-stale-check.ts [--pane <file>] [--target <target>] [--after <file>] [--after-target <target>] [--report <json>] [--root <dir>] [--json]");
  const paneFile = flagVal("--pane");
  const target = flagVal("--target");
  const afterFile = flagVal("--after");
  const afterTarget = flagVal("--after-target");
  const reportFile = flagVal("--report");
  const root = flagVal("--root");
  const jsonOut = args.includes("--json");

  let paneText;
  try {
    paneText = readPane(paneFile ?? target);
  } catch (e) {
    console.error(`inner-panel-stale-check: ${e.message}`);
    return 2;
  }
  if (paneText == null) { usage(); return 2; }

  let afterPaneText = null;
  if (afterFile || afterTarget) {
    try { afterPaneText = readPane(afterFile ?? afterTarget); }
    catch (e) { console.error(`inner-panel-stale-check: ${e.message}`); return 2; }
  }

  let report;
  try { report = readReport(reportFile, root); }
  catch (e) { console.error(`inner-panel-stale-check: ${e.message}`); return 2; }

  const v = runStaleCheck(paneText, report, { afterPaneText });

  if (jsonOut) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      verdict: v.verdict,
      agentLines: v.first.map((l) => ({
        verb: l.verb, taskId: l.taskId, state: l.state,
        timerSec: l.timerSec, raw: l.raw,
      })),
      live: v.live.map((l) => l.raw),
      ended: v.ended.map((l) => l.raw),
      frozen: v.frozen.map((l) => l.raw),
      stale: v.stale.map((l) => l.raw),
      knownTaskIds: collectKnownTaskIds(report).length,
    }, null, 2));
  } else {
    console.log(`inner panel stale-check: ${v.verdict}`);
    console.log(`  agent lines: ${v.first.length}  live: ${v.live.length}  ended: ${v.ended.length}  frozen: ${v.frozen.length}  stale: ${v.stale.length}`);
    for (const l of v.first) {
      console.log(`  [${l.state.padEnd(7)}] ${l.taskId ? l.taskId.padEnd(32) : "(no-task)".padEnd(32)} ${l.verb} ${l.timerSec ?? "-"}s  ${l.raw.slice(0, 80)}`);
    }
    if (v.stale.length) {
      console.log("  STALE lines (bracket closed but line present / timer frozen):");
      for (const l of v.stale) console.log(`    ${l.raw}`);
    }
  }
  return v.stale.length > 0 ? 1 : 0;
}

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
