// drain-scheduler.ts — DIR-071: the trigger logic for the loop-driver DRAIN step. Pure,
// testable, and shipped WITH the plugin (${CLAUDE_PLUGIN_ROOT}/scripts/) so a consumer
// workspace can evaluate drain triggers without repo-local scripts.
//
// Reads a JSON array of directive tasks (as fetched by `quay task list --label directive --json`),
// filters to those with `extra.dirStatus: pending`, classifies each as autonomous or human-steered,
// and outputs the DUE list. It NEVER dispatches or executes — the workflow does that; this only
// answers "which directives are due for DRAIN?".
//
// Mirror routine-scheduler.ts code shape: parseDisposition, classifyDirective, dueDirectives, main.
//
// Classification:
//   - extra.missionRedirection: true OR label:human-steered → human-steered (still creates a candidate)
//   - Otherwise → autonomous (default — the directive IS the candidate)
//
// Usage:
//   node drain-scheduler.ts --json <directives.json>
//   node drain-scheduler.ts --json < <directives.json>   (stdin)
//
// Exit codes: 0 = directives due (prints JSON array), 3 = none due (no-op signal), 2 = usage/parse error.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── parseDisposition ───────────────────────────────────────────────────────────────────────────────
// Validates a directive task object has the required shape for DRAIN processing.
// Returns { id, title, extra, labels } for valid pending directives; null for non-pending (skip).
// Throws on malformed.
export function parseDisposition(task) {
  if (!task || typeof task !== "object") throw new Error("drain-scheduler: task must be an object");
  if (!task.id || typeof task.id !== "string") throw new Error("drain-scheduler: task missing id");
  if (!task.title && typeof task.title !== "string") throw new Error(`drain-scheduler: ${task.id} missing title`);
  const extra = task.extra || {};
  const dirStatus = extra.dirStatus;
  if (dirStatus !== "pending") {
    return null; // not pending — skip silently, not an error
  }
  return { id: task.id, title: task.title || "", extra, labels: task.labels || [] };
}

// ── classifyDirective ──────────────────────────────────────────────────────────────────────────────
// Classify a pending directive's disposition.
//   - extra.missionRedirection: true OR label:human-steered → human-steered
//   - Otherwise → autonomous
// Both still become milestone-candidates; the classification is informational.
export function classifyDirective(directive) {
  const labels = Array.isArray(directive.labels) ? directive.labels : [];
  const isMissionRedirect = directive.extra?.missionRedirection === true;
  const isHumanSteered = labels.some((l) => String(l).toLowerCase() === "human-steered");
  if (isMissionRedirect || isHumanSteered) {
    return "human-steered";
  }
  return "autonomous";
}

// ── dueDirectives ──────────────────────────────────────────────────────────────────────────────────
// Given an array of raw directive task objects (from `quay task list --label directive --json`),
// returns the DUE list: those with extra.dirStatus: pending, classified.
// Each result: { id, title, classification: "autonomous"|"human-steered" }
// Non-pending directives are silently skipped.
// Never throws on non-array input — returns empty array (fail-closed: unknown input = nothing due).
export function dueDirectives(tasks) {
  if (!Array.isArray(tasks)) return [];
  const results = [];
  for (const task of tasks) {
    try {
      const d = parseDisposition(task);
      if (d === null) continue; // not pending — skip
      const classification = classifyDirective(d);
      results.push({ id: d.id, title: d.title, classification });
    } catch (_e) {
      // Malformed task entry — skip it (fail-closed per directive, not per DRAIN)
    }
  }
  return results;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
// Reads a JSON array of directive tasks from a file argument or stdin, prints the DUE list as JSON.
// Exit 0 if any due (and prints them), 3 if none due, 2 on usage/parse error.
function usage() {
  process.stderr.write("Usage: drain-scheduler.ts --json [<directives.json>]\n");
}

export async function main(argv) {
  const args = argv.slice(2);
  if (args.length < 1) { usage(); return 2; }

  let jsonFlag = false;
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") { jsonFlag = true; continue; }
    if (args[i] === "--help" || args[i] === "-h") { usage(); return 2; }
    filePath = args[i];
  }

  if (!jsonFlag) { usage(); return 2; }

  let raw;
  try {
    if (filePath) {
      if (!fs.existsSync(filePath)) {
        process.stderr.write(`ERROR: not found: ${filePath}\n`);
        return 2;
      }
      raw = fs.readFileSync(filePath, "utf8");
    } else {
      // Read from stdin
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString("utf8");
    }
  } catch (e) {
    process.stderr.write(`ERROR: cannot read input: ${e.message}\n`);
    return 2;
  }

  let tasks;
  try {
    tasks = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`ERROR: not valid JSON: ${e.message}\n`);
    return 2;
  }

  let due;
  try {
    due = dueDirectives(tasks);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    return 2;
  }

  if (due.length === 0) {
    process.stdout.write("{}\n"); // empty object = no directives due
    return 3;
  }

  // DIR-071: output as JSON array
  process.stdout.write(JSON.stringify(due) + "\n");
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) { main(process.argv).then((c) => process.exit(c)); }
