// fast-mode-telemetry.ts — gap-fast-mode-no-telemetry: thin metering CLI for fast-mode (direct,
// non-workflow) execution. The ≤1-hour-per-task target is unmeasurable today because fast mode
// runs neither prepare-milestone.js nor execute-milestone.js, so A1b's `_emitStageEvent` call
// sites never fire. This module is the meter: three modes wired onto the EXISTING A1a schema.
//
// Byte-identical mirror: experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
// (symlink → ../../../plugin/scripts/fast-mode-telemetry.ts).
//
// THE HARD CONSTRAINT (task body): reuse the existing A1a `workflow-event-schema.mjs`
// (SCHEMA_VERSION, VALID_STAGES, VALID_OUTCOMES, validateEvent, emitEvent, parseEventStream,
// --emit-event CLI). Do NOT invent a second event format. Zero new schema logic lives here.
//
// STAGE-VOCABULARY DECISION (AC9):
//   EXTEND VALID_STAGES additively with a single "Fast" stage (fast-mode direct execution), and
//   VALID_OUTCOMES additively with "abandoned" (a task that never reached --task-end with a
//   terminal outcome). Purely additive — SCHEMA_VERSION stays "1" (M207 additive-growth
//   precedent; no re-write of existing events). NOT a map-onto-existing choice: mapping
//   fast-mode onto e.g. "Build"/"Gate" would pollute the workflow phase metrics this schema
//   also feeds. Start vs end is distinguished by the A1b `eventKind` extra field
//   ('start'/'end') — the same convention execute-milestone.js `_emitStageEvent` already uses —
//   NOT by separate stage values.
//
// FAIL-CLOSED DIVERGENCE from A1a's --emit-event CLI: A1a is fire-and-forget (exit 0 even on
// validation failure) because a workflow must not crash on observability. This CLI instead exits
// nonzero on bad input / failed writes — a meter that silently drops is the exact defect this
// task exists to fix ("the 1-task/hour target has no meter").
//
// Run:
//   node --experimental-strip-types fast-mode-telemetry.ts --task-start --taskId <id> [--root <dir>]
//   node --experimental-strip-types fast-mode-telemetry.ts --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned> [--root <dir>]
//   node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]
//
// Storage: raw events append to <root>/.workflow-events/<runId>.jsonl (gitignored). --report
// additionally writes a committed snapshot to <root>/milestones/fast-mode-telemetry/<YYYY-MM-DD>.json
// so the roll-up the target is judged against survives the raw-events gitignore.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import {
  SCHEMA_VERSION,
  VALID_STAGES,
  VALID_OUTCOMES,
  validateEvent,
  emitEvent,
  parseEventStream,
} from "./workflow-event-schema.mjs";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** Fast-mode's single stage value (added additively to VALID_STAGES; see header decision). */
export const FAST_MODE_STAGE = "Fast";
/** agentLabel carried by fast-mode events. */
export const FAST_MODE_AGENT_LABEL = "fast-mode";

// ── Repo-root detection ──────────────────────────────────────────────────────────────────────────────

/**
 * Find the workspace root by walking up from the script location (or CWD fallback via git).
 * @param {string} [startDir]
 * @returns {string}
 */
export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Best-effort current commit for provenance; null when not a git repo (fail-soft).
 * @param {string} root
 * @returns {string | null}
 */
export function getBaseCommit(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// ── runId ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Generate a filename-safe, collision-resistant runId for one fast-mode task execution.
 * `--task-start` prints this; the caller holds it and passes it to `--task-end`, so the two
 * events append to the same `.workflow-events/<runId>.jsonl`.
 * @param {string} taskId
 * @returns {string}
 */
export function generateRunId(taskId) {
  const safe = String(taskId).replace(/[^A-Za-z0-9._-]/g, "-");
  return `fm-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Event builders (A1a schema-shaped; pass validateEvent) ───────────────────────────────────────────

/**
 * Build the schema-valid `Fast` start event (eventKind 'start').
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.runId
 * @param {string} [opts.executionCwd]
 * @param {string|null} [opts.baseCommit]
 * @param {number} [opts.recordedAtMs]
 * @returns {object} — a plain object that A1a validateEvent accepts
 */
export function buildStartEvent({ taskId, runId, executionCwd, baseCommit = null, recordedAtMs = Date.now() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    candidateId: String(taskId),
    taskId: String(taskId),
    stage: FAST_MODE_STAGE,
    attempt: 0,
    timing: { queuedAtMs: null, startedAtMs: recordedAtMs, endedAtMs: null },
    agentLabel: FAST_MODE_AGENT_LABEL,
    commandIdentity: "fast-mode-telemetry:task-start",
    executionCwd: executionCwd ?? process.cwd(),
    worktreePath: null,
    baseCommit,
    candidateCommit: null,
    outcome: null,
    waitReason: null,
    resourceClaim: null,
    observedWrites: [],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs,
    eventKind: "start",
  };
}

/**
 * Build the schema-valid `Fast` end event (eventKind 'end') carrying the terminal outcome.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.runId
 * @param {string} opts.outcome — one of VALID_OUTCOMES (done|needs-human|skipped|error|abandoned)
 * @param {string} [opts.executionCwd]
 * @param {string|null} [opts.baseCommit]
 * @param {number} [opts.recordedAtMs]
 * @returns {object} — a plain object that A1a validateEvent accepts
 */
export function buildEndEvent({ taskId, runId, outcome, executionCwd, baseCommit = null, recordedAtMs = Date.now() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    candidateId: String(taskId),
    taskId: String(taskId),
    stage: FAST_MODE_STAGE,
    attempt: 0,
    timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: recordedAtMs },
    agentLabel: FAST_MODE_AGENT_LABEL,
    commandIdentity: "fast-mode-telemetry:task-end",
    executionCwd: executionCwd ?? process.cwd(),
    worktreePath: null,
    baseCommit,
    candidateCommit: null,
    outcome,
    waitReason: null,
    resourceClaim: null,
    observedWrites: [],
    isolationMode: null,
    dispatchMode: "serial",
    recordedAtMs,
    eventKind: "end",
  };
}

// ── Write / read ──────────────────────────────────────────────────────────────────────────────────────

/** runId is used verbatim as a `.workflow-events/<runId>.jsonl` path component — must be filename-safe. */
const RUN_ID_SAFE_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate (A1a) and append one event to `<root>/.workflow-events/<runId>.jsonl`.
 * Throws on validation failure (fail-closed — see header).
 *
 * Also rejects a runId that is not filename-safe (DEFECT-1 fix: a caller-supplied `--runId`
 * like `../../escape` must never escape `.workflow-events/`). `generateRunId` already produces
 * safe ids; this is the single persistence choke point that defends all callers.
 * @param {object} event
 * @param {string} root
 * @returns {string} — the log path written
 */
export function writeEvent(event, root) {
  const validation = validateEvent(event);
  if (!validation.ok) {
    throw new Error(`event failed A1a validation: ${validation.error}`);
  }
  const runId = validation.event.runId;
  if (typeof runId !== "string" || !RUN_ID_SAFE_RE.test(runId)) {
    throw new Error(`refusing to write event: runId "${runId}" is not filename-safe (must match ${RUN_ID_SAFE_RE})`);
  }
  const eventsDir = path.join(root, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const logPath = path.join(eventsDir, `${runId}.jsonl`);
  fs.appendFileSync(logPath, emitEvent(validation.event) + "\n", "utf8");
  return logPath;
}

/**
 * Async-generate every schema-valid event across all `.workflow-events/*.jsonl` files.
 * Malformed lines are skipped by parseEventStream (never crash the report).
 * @param {string} root
 * @returns {AsyncGenerator<object>}
 */
export async function* readAllEvents(root) {
  const eventsDir = path.join(root, ".workflow-events");
  if (!fs.existsSync(eventsDir)) return;
  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl")).sort();
  for (const file of files) {
    for await (const result of parseEventStream(path.join(eventsDir, file))) {
      if (result.ok) yield result.event;
    }
  }
}

// ── Aggregate ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Median of a numeric array (0 for empty). @param {number[]} values @returns {number}
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Start/end classification is by TIMING MARKER PRESENCE, not the `eventKind` extra field alone
 * (DEFECT-4 fix): `eventKind` is not in A1a REQUIRED_FIELDS and validateEvent allows unknown
 * extra fields, so a hand-edited Fast event may lack it. A start-like event carries startedAtMs
 * and no endedAtMs; an end-like event carries endedAtMs.
 */
function isStartLike(e) {
  if (!e || !e.timing) return false;
  if (e.eventKind === "start") return true;
  return e.timing.startedAtMs != null && e.timing.endedAtMs == null;
}
function isEndLike(e) {
  if (!e || !e.timing) return false;
  if (e.eventKind === "end") return true;
  return e.timing.endedAtMs != null;
}

/**
 * Aggregate `Fast` stage events into the report shape AC5 requires.
 *
 * Pairing key is runId (one fast-mode execution instance). A start+end pair → a completed task
 * (wall-clock = end.timing.endedAtMs − start.timing.startedAtMs). An end with NO matching start
 * → `orphaned` (AC10: never silently dropped). A start with no end → `inProgress` (the
 * abandoned-mid-flight signal). Mean/median/tasksPerHour are computed over completed tasks only.
 *
 * `--since` is applied at PAIR level, never per-event (DEFECT-2 fix): a completed task is
 * included when its END falls at/after sinceMs, so a task straddling the window boundary is not
 * mislabelled as orphaned. Negative wall-clock (clock skew / mispaired runId) is clamped to 0
 * (DEFECT-3 fix) so a corrupt record cannot drag mean/median negative.
 *
 * @param {object[]} events — schema-valid StageEvents (any stage; only "Fast" is consumed)
 * @param {{sinceMs?: number|null}} [opts]
 * @returns {{tasks: Array<{taskId:string,minutes:number,outcome:string|null}>, orphaned: Array<{taskId:string,runId:string,outcome:string|null}>, inProgress: Array<{taskId:string,runId:string,startedAtMs:number}>, meanMinutes:number, medianMinutes:number, tasksPerHour:number}}
 */
export function aggregate(events, { sinceMs = null } = {}) {
  const fastEvents = events.filter((e) => e && e.stage === FAST_MODE_STAGE);

  const byRun = new Map();
  for (const e of fastEvents) {
    if (!byRun.has(e.runId)) {
      byRun.set(e.runId, { runId: e.runId, taskId: e.taskId, start: null, ends: [] });
    }
    const rec = byRun.get(e.runId);
    if (isStartLike(e)) {
      if (!rec.start) rec.start = e;
    } else if (isEndLike(e)) {
      rec.ends.push(e);
    }
    // A Fast event that is neither start-like nor end-like (no timing markers, no eventKind)
    // is ignored by the pairing — it cannot contribute a wall-clock or an orphan.
  }

  /** @type {Array<{taskId:string,minutes:number,outcome:string|null}>} */
  const tasks = [];
  /** @type {Array<{taskId:string,runId:string,outcome:string|null}>} */
  const orphaned = [];
  /** @type {Array<{taskId:string,runId:string,startedAtMs:number}>} */
  const inProgress = [];

  for (const rec of byRun.values()) {
    const end = rec.ends.length ? rec.ends[rec.ends.length - 1] : null; // last end wins
    if (rec.start && end) {
      // Completed pair — window filter on the END time (pair level).
      if (sinceMs != null && end.timing.endedAtMs < sinceMs) continue;
      const raw = (end.timing.endedAtMs - rec.start.timing.startedAtMs) / 60_000;
      const minutes = raw > 0 ? raw : 0;
      tasks.push({ taskId: rec.taskId, minutes, outcome: end.outcome });
    } else if (end && !rec.start) {
      if (sinceMs != null && end.recordedAtMs < sinceMs) continue;
      orphaned.push({ taskId: rec.taskId, runId: rec.runId, outcome: end.outcome });
    } else if (rec.start && !end) {
      if (sinceMs != null && rec.start.recordedAtMs < sinceMs) continue;
      inProgress.push({ taskId: rec.taskId, runId: rec.runId, startedAtMs: rec.start.timing.startedAtMs });
    }
  }

  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
  orphaned.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  inProgress.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));

  const minutes = tasks.map((t) => t.minutes);
  const totalMinutes = minutes.reduce((s, m) => s + m, 0);
  const count = minutes.length;
  const meanMinutes = count ? totalMinutes / count : 0;
  const medianMinutes = count ? median(minutes) : 0;
  // tasks per hour = completedCount / totalHours; guard divide-by-zero (all-zero-duration run).
  const tasksPerHour = totalMinutes > 0 ? (count * 60) / totalMinutes : 0;

  return { tasks, orphaned, inProgress, meanMinutes, medianMinutes, tasksPerHour };
}

// ── Committed aggregate ──────────────────────────────────────────────────────────────────────────────

/**
 * Write the committed roll-up snapshot under `<root>/milestones/fast-mode-telemetry/<date>.json`.
 * @param {object} report
 * @param {string} root
 * @param {string} [dateStr] — YYYY-MM-DD; defaults to today's UTC date
 * @returns {string} — the file path written
 */
export function writeAggregateReport(report, root, dateStr = new Date().toISOString().slice(0, 10)) {
  const dir = path.join(root, "milestones", "fast-mode-telemetry");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${dateStr}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n", "utf8");
  return file;
}

// ── Human-readable report ────────────────────────────────────────────────────────────────────────────

function printHumanReport(report, aggFile) {
  console.log(`fast-mode telemetry report (generated ${report.generatedAt})`);
  if (report.since) console.log(`since: ${report.since}`);
  console.log(`completed tasks: ${report.tasks.length}`);
  for (const t of report.tasks) {
    console.log(`  ${String(t.taskId).padEnd(40)} ${t.minutes.toFixed(1).padStart(8)}m  ${t.outcome ?? "null"}`);
  }
  console.log(`mean minutes/task: ${report.meanMinutes.toFixed(2)}`);
  console.log(`median minutes/task: ${report.medianMinutes.toFixed(2)}`);
  console.log(`tasks per hour: ${report.tasksPerHour.toFixed(2)}`);
  if (report.orphaned.length) {
    console.log(`orphaned (end without start): ${report.orphaned.length}`);
    for (const o of report.orphaned) console.log(`  ${o.taskId} (runId ${o.runId}, outcome ${o.outcome})`);
  }
  if (report.inProgress.length) {
    console.log(`in-progress (start without end): ${report.inProgress.length}`);
    for (const p of report.inProgress) console.log(`  ${p.taskId} (runId ${p.runId})`);
  }
  console.log(`aggregate written: ${aggFile}`);
}

// ── CLI entry point ──────────────────────────────────────────────────────────────────────────────────

const usage = `fast-mode-telemetry.ts — fast-mode (direct) execution metering (gap-fast-mode-no-telemetry)

Usage:
  node --experimental-strip-types fast-mode-telemetry.ts --task-start --taskId <id> [--root <dir>]
  node --experimental-strip-types fast-mode-telemetry.ts --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned> [--root <dir>]
  node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * CLI main. @param {string[]} argv — process.argv @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = argv.slice(2);
  const rootArg = getArgValue(args, "--root");
  const root = rootArg ?? findRepoRoot();

  // --task-start
  if (args.includes("--task-start")) {
    const taskId = getArgValue(args, "--taskId");
    if (!taskId) {
      console.error("fast-mode-telemetry: --task-start requires --taskId <id>");
      return 1;
    }
    const runId = generateRunId(taskId);
    const event = buildStartEvent({
      taskId,
      runId,
      executionCwd: process.cwd(),
      baseCommit: getBaseCommit(root),
      recordedAtMs: Date.now(),
    });
    try {
      writeEvent(event, root);
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    // Single line: the runId the caller must hold for --task-end.
    console.log(runId);
    return 0;
  }

  // --task-end
  if (args.includes("--task-end")) {
    const taskId = getArgValue(args, "--taskId");
    const runId = getArgValue(args, "--runId");
    const outcome = getArgValue(args, "--outcome");
    if (!taskId || !runId || !outcome) {
      console.error("fast-mode-telemetry: --task-end requires --taskId <id> --runId <r> --outcome <done|needs-human|abandoned>");
      return 1;
    }
    if (!VALID_OUTCOMES.includes(outcome)) {
      console.error(`fast-mode-telemetry: invalid outcome "${outcome}"; must be one of: ${VALID_OUTCOMES.join(", ")}`);
      return 1;
    }
    const event = buildEndEvent({
      taskId,
      runId,
      outcome,
      executionCwd: process.cwd(),
      baseCommit: getBaseCommit(root),
      recordedAtMs: Date.now(),
    });
    try {
      writeEvent(event, root);
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    console.log(`fast-mode-telemetry: end event written for ${taskId} (runId ${runId}, outcome ${outcome})`);
    return 0;
  }

  // --report
  if (args.includes("--report")) {
    let sinceMs = null;
    const sinceArg = getArgValue(args, "--since");
    if (sinceArg) {
      sinceMs = Date.parse(sinceArg);
      if (Number.isNaN(sinceMs)) {
        console.error(`fast-mode-telemetry: invalid --since "${sinceArg}" (expected an ISO timestamp)`);
        return 1;
      }
    }
    const events = [];
    try {
      for await (const e of readAllEvents(root)) events.push(e);
    } catch (e) {
      console.error(`fast-mode-telemetry: failed to read .workflow-events: ${e.message}`);
      return 1;
    }
    const report = aggregate(events, { sinceMs });
    const reportWithMeta = { generatedAt: new Date().toISOString(), since: sinceArg ?? null, ...report };
    let aggFile;
    try {
      aggFile = writeAggregateReport(reportWithMeta, root);
    } catch (e) {
      console.error(`fast-mode-telemetry: failed to write aggregate: ${e.message}`);
      return 1;
    }
    if (args.includes("--json")) {
      console.log(JSON.stringify(reportWithMeta, null, 2));
    } else {
      printHumanReport(reportWithMeta, aggFile);
    }
    return 0;
  }

  console.log(usage);
  return 0;
}

// ── Direct-entry check ───────────────────────────────────────────────────────────────────────────────

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
