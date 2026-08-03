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
//   node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]   (PURE READ)
//   node --experimental-strip-types fast-mode-telemetry.ts --snapshot [--since <iso>] [--json] [--root <dir>] (explicit persist)
//
// BLOCKED-WAIT METRICS (gap-no-explicit-blocked-signal-from-inner-layer, AC7): --report/--snapshot
// also aggregate blocked-wait periods. The inner layer's inner-blocked-signal.ts --clear emits a
// `Fast`-stage event with eventKind "blocked" (timing.startedAtMs = block since, endedAtMs = clear
// time); aggregate() pulls those out before task pairing and reports `blocked[]` plus
// totalBlockedMs (cumulative dead time) and longestBlockedMs (single longest wait) — the dead-time
// number that "does not exist today". SCHEMA_VERSION stays "1".
//
// THROUGHPUT SEMANTICS (gap-tasksperhour-measures-mean-duration-not-throughput, AC1-AC5):
// `tasksPerHour` used to be `count*60/totalMinutes` ≡ `60/mean` — a per-task SPEED metric that
// penalizes concurrency (two 60-min tasks finishing in the same wall-clock hour reported 1.0, not
// the real 2.0). It is now `count / windowHours` where windowHours is wall-clock: windowStart =
// `--since` (AC2) or the earliest startedAtMs; windowEnd = max(latest endedAtMs, now) — the live
// CLI report passes now = Date.now() (window extends to the present), a historical analysis omits
// it (window ends at the latest endedAtMs). The report also carries windowStart/windowEnd/windowHours
// (AC3) so any consumer can see which span a rate covers. The OLD definition is kept RENAMED as
// `serialEquivalentPerHour` with an explicit "unrelated to concurrency" annotation (AC5); it is a
// deterministic transform of meanMinutes.
//
// HALT-TIME DENOMINATOR FIX (gap-tasksperhour-counts-halted-time-as-slow-work, AC1-AC8): the
// throughput denominator is wall-clock window hours, so a `.halt` pause freezes the numerator while
// the denominator keeps growing — a deliberate stop reads identically to working slowly, and the
// pause §0d uses for cross-project resource arbitration becomes a throughput penalty that rewards
// picking light tasks. The fix subtracts RECORDED halt intervals from the denominator. The numerator
// (completed-task count) is UNCHANGED and never weighted by task size (AC6) — "修的是仪器，不是去挑任务".
//
// DATA SOURCE (AC1): the authoritative source is an append-only halt event log at
// <root>/.workflow-events/halt-events.jsonl, written by this CLI's `--halt-start` / `--halt-end`
// subcommands (the actor that places/removes the `.halt` sentinel calls them). The `.halt` GIT
// HISTORY was measured and rejected: this task's own halt shows the file content self-reporting
// placement at 09:33:12Z while the commit landed at 09:55:08Z (22 min late), and the removal at
// 10:32Z was not yet committed at measurement time — git-history intervals are systematically SHORT
// and may miss the removal entirely. Do NOT default to git history as authoritative.
//
// CONSERVATIVE MISSED-RECORD SEMANTICS: only CLOSED intervals (a `start` followed by an `end`)
// subtract anything. A `start` with no matching `end` (halt still active OR its end line lost) and an
// `end` with no preceding `start` subtract NOTHING — the window keeps that halt time, degrading to
// the pre-fix behavior. This can only UNDERSTATE throughput, never overstate it ("漏写 ⇒ 偏保守").
//
// REPORT SURFACE (AC2): both windowHours (already reduced) and haltedHours (the subtracted amount)
// appear in the report, plus the halted[] intervals. windowStart/windowEnd are already there, so a
// reader can recompute elapsed = windowEnd - windowStart and verify elapsed - windowHours ==
// haltedHours independently.
//
// Storage: raw events append to <root>/.workflow-events/<runId>.jsonl (gitignored). The committed
// roll-up under <root>/milestones/fast-mode-telemetry/<YYYY-MM-DD>.json is written ONLY by the
// explicit --snapshot subcommand (task end / Land / day-end moments). --report is PURE READ — it
// must never write a file, so an observation poll (outer Monitor, every 60s) cannot dirty the
// working tree and deadlock restart-readiness-check.sh. The roll-up is the only persistent
// per-task-duration history, so it stays git-tracked (gap-telemetry-report-writes-and-deadlocks-readiness).

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

// ── Halt event log (gap-tasksperhour-counts-halted-time-as-slow-work, AC1) ─────────────────────────
// The append-only halt log is the authoritative source of halt intervals. It is a SEPARATE file from
// the runId event stream: its lines are {type:"halt", event:"start"|"end", atMs, reason?}, NOT A1a
// StageEvents. `--halt-start`/`--halt-end` append to it; the telemetry reads it and subtracts the
// closed intervals from the throughput window denominator. The `.halt` git history was measured and
// REJECTED as the source (placement commit landed 22 min after the file's self-reported time; the
// removal commit may not exist at measurement time) — see the header DATA SOURCE note.

/** Fixed filename of the append-only halt event log (sibling of the runId event files, same gitignored dir). */
export const HALT_LOG_FILENAME = "halt-events.jsonl";

/**
 * Append one halt log line to `<root>/.workflow-events/halt-events.jsonl`.
 * Fail-closed (like writeEvent): a structurally invalid halt event throws and writes nothing.
 * @param {{type:"halt", event:"start"|"end", atMs:number, reason?:string|null}} event
 * @param {string} root
 * @returns {string} — the log path written
 */
export function writeHaltEvent(event, root) {
  if (!event || event.type !== "halt" || (event.event !== "start" && event.event !== "end")) {
    throw new Error(`refusing to write halt event: expected {type:"halt", event:"start"|"end"}, got ${JSON.stringify(event)}`);
  }
  if (typeof event.atMs !== "number" || !Number.isFinite(event.atMs)) {
    throw new Error(`refusing to write halt event: atMs must be a finite number, got ${event.atMs}`);
  }
  const eventsDir = path.join(root, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const logPath = path.join(eventsDir, HALT_LOG_FILENAME);
  const line = JSON.stringify({ type: "halt", event: event.event, atMs: event.atMs, reason: event.reason ?? null });
  fs.appendFileSync(logPath, line + "\n", "utf8");
  return logPath;
}

/**
 * Read every halt log line from `<root>/.workflow-events/halt-events.jsonl`, in append order.
 * Malformed lines are skipped silently (never crash the report). Missing file → [].
 * @param {string} root
 * @returns {Array<{type:"halt", event:"start"|"end", atMs:number, reason?:string|null}>}
 */
export function readHaltEvents(root) {
  const logPath = path.join(root, ".workflow-events", HALT_LOG_FILENAME);
  if (!fs.existsSync(logPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e && e.type === "halt" && (e.event === "start" || e.event === "end") && typeof e.atMs === "number" && Number.isFinite(e.atMs)) {
      out.push(e);
    }
  }
  return out;
}

/**
 * Async-generate every schema-valid event across all `.workflow-events/*.jsonl` files.
 * Malformed lines are skipped by parseEventStream (never crash the report). The halt event log
 * (`halt-events.jsonl`) is explicitly EXCLUDED — its lines are not A1a StageEvents and must never
 * pollute the task pairing (orphaned/inProgress/tasks).
 * @param {string} root
 * @returns {AsyncGenerator<object>}
 */
export async function* readAllEvents(root) {
  const eventsDir = path.join(root, ".workflow-events");
  if (!fs.existsSync(eventsDir)) return;
  const files = fs
    .readdirSync(eventsDir)
    .filter((f) => f.endsWith(".jsonl") && f !== HALT_LOG_FILENAME)
    .sort();
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
 * Compute the halt time to subtract from a throughput window (AC2/AC4).
 *
 * Pairing is a LIFO stack over the append-only halt log: each `start` is closed by the NEXT `end`
 * in log order; a `start` with no following `end` (halt still active OR its end line lost) and an
 * `end` with no unmatched `start` subtract NOTHING — conservative, can only understate throughput,
 * never overstate it ("漏写 ⇒ 偏保守", AC1). Each closed interval is intersected with the window
 * before summing, so a halt that straddles the window boundary only subtracts its overlapping part.
 *
 * @param {Array<{event:"start"|"end", atMs:number}>} haltEvents — in append order
 * @param {number|null} windowStartMs
 * @param {number|null} windowEndMs
 * @returns {{haltedMs:number, halted:Array<{startMs:number,endMs:number}>}} — halted[] sorted by startMs
 */
export function computeHaltedMs(haltEvents, windowStartMs, windowEndMs) {
  if (windowStartMs == null || windowEndMs == null) return { haltedMs: 0, halted: [] };
  const starts = [];
  const closed = [];
  for (const e of haltEvents ?? []) {
    if (e.event === "start") {
      starts.push(e.atMs);
    } else if (e.event === "end" && starts.length > 0) {
      closed.push({ startMs: starts.pop(), endMs: e.atMs });
    }
    // An `end` with no unmatched `start` is an orphan — ignored (conservative).
  }
  let haltedMs = 0;
  const halted = [];
  for (const iv of closed) {
    const s = Math.max(iv.startMs, windowStartMs);
    const en = Math.min(iv.endMs, windowEndMs);
    if (en > s) {
      haltedMs += en - s;
      halted.push({ startMs: s, endMs: en });
    }
  }
  halted.sort((a, b) => a.startMs - b.startMs);
  return { haltedMs, halted };
}

/**
 * Aggregate `Fast` stage events into the report shape AC5 requires.
 *
 * Pairing key is runId (one fast-mode execution instance). A start+end pair → a completed task
 * (wall-clock = end.timing.endedAtMs − start.timing.startedAtMs). An end with NO matching start
 * → `orphaned` (AC10: never silently dropped). A start with no end → `inProgress` (the
 * abandoned-mid-flight signal). Mean/median/serialEquivalentPerHour are computed over completed
 * tasks only; tasksPerHour is count / wall-clock window hours (AC1) — see header for the fix.
 *
 * `--since` is applied at PAIR level, never per-event (DEFECT-2 fix): a completed task is
 * included when its END falls at/after sinceMs, so a task straddling the window boundary is not
 * mislabelled as orphaned. Negative wall-clock (clock skew / mispaired runId) is clamped to 0
 * (DEFECT-3 fix) so a corrupt record cannot drag mean/median negative.
 *
 * BLOCKED-WAIT EVENTS (gap-no-explicit-blocked-signal-from-inner-layer, AC7): a `Fast` stage event
 * with `eventKind: "blocked"` is a blocked-wait period emitted by inner-blocked-signal.ts --clear,
 * NOT a task start/end pair. It is pulled out BEFORE pairing so it can never pollute `orphaned` or
 * `inProgress`, and aggregated into a `blocked` section: one entry per wait with durationMs =
 * endedAtMs − startedAtMs (clamped to 0), plus totalBlockedMs (cumulative dead time) and
 * longestBlockedMs (single longest wait) — the number the task body says "does not exist today".
 * `--since` windows blocked events on their CLEAR time (consistent with task pairing windowing on
 * end time).
 *
 * @param {object[]} events — schema-valid StageEvents (any stage; only "Fast" is consumed)
 * @param {{sinceMs?: number|null, nowMs?: number|null, haltEvents?: Array<{event:"start"|"end", atMs:number}>|null}} [opts]
 *   sinceMs     — window start when given (AC2); else the earliest startedAtMs in the data.
 *   nowMs       — the observation instant. windowEnd = max(latest endedAtMs, nowMs). A live report
 *                 passes nowMs = Date.now() (window extends to now); a historical analysis passes
 *                 null or a past instant (window ends at the latest endedAtMs) — "活报告用 now，
 *                 历史窗口用最晚 end".
 *   haltEvents  — the append-only halt log lines (AC1/AC2). Closed halt intervals overlapping the
 *                 window are subtracted from windowHours; open/orphan lines subtract nothing
 *                 (conservative). Absent/null ⇒ haltedHours = 0 (byte-identical to pre-fix).
 * @returns {{tasks: Array<{taskId:string,minutes:number,outcome:string|null}>, orphaned: Array<{taskId:string,runId:string,outcome:string|null}>, inProgress: Array<{taskId:string,runId:string,startedAtMs:number}>, meanMinutes:number, medianMinutes:number, tasksPerHour:number, serialEquivalentPerHour:number, windowStart:string|null, windowEnd:string|null, windowHours:number, haltedHours:number, halted:Array<{startMs:number,endMs:number}>, blocked: Array<{taskId:string,reason:string|null,sinceMs:number|null,clearedAtMs:number|null,durationMs:number}>, totalBlockedMs:number, longestBlockedMs:number}}
 */
export function aggregate(events, { sinceMs = null, nowMs = null, haltEvents = null } = {}) {
  const fastEvents = events.filter((e) => e && e.stage === FAST_MODE_STAGE);
  // Blocked-wait events are NOT task start/end pairs — separate them before the byRun pairing.
  const blockedEvents = fastEvents.filter((e) => e.eventKind === "blocked");
  const taskEvents = fastEvents.filter((e) => e.eventKind !== "blocked");

  const byRun = new Map();
  for (const e of taskEvents) {
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
  // Wall-clock window bounds (AC2/AC3): earliest start across all task events; latest end across
  // completed pairs. These feed tasksPerHour = count / windowHours below.
  let earliestStartMs = null;
  let latestEndMs = null;

  for (const rec of byRun.values()) {
    const end = rec.ends.length ? rec.ends[rec.ends.length - 1] : null; // last end wins
    if (rec.start && rec.start.timing?.startedAtMs != null) {
      const s = rec.start.timing.startedAtMs;
      earliestStartMs = earliestStartMs == null ? s : Math.min(earliestStartMs, s);
    }
    if (rec.start && end) {
      // Completed pair — window filter on the END time (pair level).
      if (sinceMs != null && end.timing.endedAtMs < sinceMs) continue;
      const raw = (end.timing.endedAtMs - rec.start.timing.startedAtMs) / 60_000;
      const minutes = raw > 0 ? raw : 0;
      if (end.timing.endedAtMs != null) {
        latestEndMs = latestEndMs == null ? end.timing.endedAtMs : Math.max(latestEndMs, end.timing.endedAtMs);
      }
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

  // Serial-equivalent rate — the OLD tasksPerHour definition (60 / mean). How fast tasks would
  // complete if they ran back-to-back with zero concurrency. It is a deterministic transform of
  // meanMinutes and is EXPLICITLY unrelated to concurrency (gap-tasksperhour-measures-mean-duration-
  // not-throughput, AC5): two 60-min tasks finishing in the same wall-clock hour report serial-
  // equivalent 1.0 while real throughput is 2.0. Kept renamed (not deleted) so reports can carry
  // both the true throughput and the serial-equivalent baseline.
  const serialEquivalentPerHour = totalMinutes > 0 ? (count * 60) / totalMinutes : 0;

  // THROUGHPUT (AC1): completedCount / window hours. The window is:
  //   windowStart = --since (AC2), else the earliest startedAtMs in the data.
  //   windowEnd   = max(latest endedAtMs, nowMs) — a LIVE report passes nowMs = Date.now() so the
  //                 window extends to the present; a HISTORICAL analysis passes nowMs = null (or a
  //                 past instant) so the window ends at the latest endedAtMs ("活报告用 now，历史窗口
  //                 用最晚 end").
  // HALT-TIME FIX (gap-tasksperhour-counts-halted-time-as-slow-work): windowHours =
  // elapsed − haltedHours, where haltedHours is the overlap of CLOSED halt-log intervals with the
  // window. Both windowHours (already reduced) and haltedHours (the subtracted amount) are exposed,
  // plus the halted[] intervals, so the subtraction is independently verifiable (AC2). The numerator
  // (count) is untouched — never weighted by task size (AC6). A zero-halt window is byte-identical
  // to the pre-fix value (haltedHours = 0). windowHours is clamped >= 0 (DEFECT-3 clock skew; an
  // over-subtracted window clamps to 0 rather than going negative).
  const windowStartMs = sinceMs != null ? sinceMs : earliestStartMs;
  let windowEndMs = null;
  if (windowStartMs != null) {
    windowEndMs = latestEndMs != null ? Math.max(latestEndMs, nowMs ?? 0) : (nowMs ?? null);
  }
  if (windowEndMs != null && windowEndMs < windowStartMs) {
    windowEndMs = windowStartMs;
  }
  const elapsedMs = windowStartMs != null && windowEndMs != null ? windowEndMs - windowStartMs : 0;
  const haltRes = computeHaltedMs(haltEvents, windowStartMs, windowEndMs);
  const haltedHours = haltRes.haltedMs / 3_600_000;
  let windowHours = 0;
  if (windowStartMs != null && windowEndMs != null) {
    windowHours = Math.max(0, elapsedMs / 3_600_000 - haltedHours);
  }
  const tasksPerHour = windowHours > 0 ? count / windowHours : 0;

  // Blocked-wait aggregation (gap-no-explicit-blocked-signal-from-inner-layer, AC7). One entry per
  // blocked period; duration = endedAtMs − startedAtMs (clamped to 0 for skew). Windowed on the
  // CLEAR time (end), consistent with task pairing windowing on end time.
  const blocked = [];
  for (const e of blockedEvents) {
    const sinceMsE = e.timing?.startedAtMs ?? null;
    const clearedAtMs = e.timing?.endedAtMs ?? e.recordedAtMs ?? null;
    const durationMs =
      sinceMsE != null && clearedAtMs != null ? Math.max(0, clearedAtMs - sinceMsE) : 0;
    if (sinceMs != null && (clearedAtMs ?? sinceMsE) < sinceMs) continue;
    blocked.push({
      taskId: e.taskId,
      reason: e.blockedReason ?? null,
      sinceMs: sinceMsE,
      clearedAtMs,
      durationMs,
    });
  }
  blocked.sort((a, b) => a.taskId.localeCompare(b.taskId) || (a.sinceMs ?? 0) - (b.sinceMs ?? 0));
  const totalBlockedMs = blocked.reduce((s, b) => s + b.durationMs, 0);
  const longestBlockedMs = blocked.length ? Math.max(...blocked.map((b) => b.durationMs)) : 0;

  return {
    tasks, orphaned, inProgress, meanMinutes, medianMinutes,
    tasksPerHour, serialEquivalentPerHour,
    windowStart: windowStartMs != null ? new Date(windowStartMs).toISOString() : null,
    windowEnd: windowEndMs != null ? new Date(windowEndMs).toISOString() : null,
    windowHours, haltedHours,
    halted: haltRes.halted,
    blocked, totalBlockedMs, longestBlockedMs,
  };
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

/**
 * Human-readable report. aggFile is only shown when it was actually written (i.e. from
 * --snapshot). --report passes null — it is pure-read and must NOT claim a write.
 */
function printHumanReport(report, aggFile) {
  console.log(`fast-mode telemetry report (generated ${report.generatedAt})`);
  if (report.since) console.log(`since: ${report.since}`);
  console.log(`completed tasks: ${report.tasks.length}`);
  for (const t of report.tasks) {
    console.log(`  ${String(t.taskId).padEnd(40)} ${t.minutes.toFixed(1).padStart(8)}m  ${t.outcome ?? "null"}`);
  }
  console.log(`mean minutes/task: ${report.meanMinutes.toFixed(2)}`);
  console.log(`median minutes/task: ${report.medianMinutes.toFixed(2)}`);
  console.log(`tasks per hour (throughput, count/window-hours): ${report.tasksPerHour.toFixed(2)}`);
  console.log(`serial-equivalent per hour (60/mean; NOT throughput, unrelated to concurrency): ${report.serialEquivalentPerHour.toFixed(2)}`);
  console.log(`window: ${report.windowStart ?? "null"} → ${report.windowEnd ?? "null"} (${report.windowHours.toFixed(2)}h)`);
  console.log(`halted time (subtracted from window, AC2): ${(report.haltedHours ?? 0).toFixed(2)}h`);
  if (report.orphaned.length) {
    console.log(`orphaned (end without start): ${report.orphaned.length}`);
    for (const o of report.orphaned) console.log(`  ${o.taskId} (runId ${o.runId}, outcome ${o.outcome})`);
  }
  if (report.inProgress.length) {
    console.log(`in-progress (start without end): ${report.inProgress.length}`);
    for (const p of report.inProgress) console.log(`  ${p.taskId} (runId ${p.runId})`);
  }
  // Blocked-wait (dead-time) metrics — gap-no-explicit-blocked-signal-from-inner-layer (AC7).
  if ((report.blocked ?? []).length) {
    console.log(`blocked-wait periods: ${report.blocked.length}`);
    for (const b of report.blocked) {
      console.log(`  ${String(b.taskId).padEnd(40)} ${b.reason ?? "null"} ${(b.durationMs / 60_000).toFixed(1).padStart(8)}m`);
    }
  }
  console.log(`cumulative blocked (dead) time: ${((report.totalBlockedMs ?? 0) / 60_000).toFixed(2)} min`);
  console.log(`longest single blocked wait: ${((report.longestBlockedMs ?? 0) / 60_000).toFixed(2)} min`);
  if (aggFile) console.log(`aggregate snapshot written: ${aggFile}`);
}

// ── CLI entry point ──────────────────────────────────────────────────────────────────────────────────

const usage = `fast-mode-telemetry.ts — fast-mode (direct) execution metering (gap-fast-mode-no-telemetry)

Usage:
  node --experimental-strip-types fast-mode-telemetry.ts --task-start --taskId <id> [--root <dir>]
  node --experimental-strip-types fast-mode-telemetry.ts --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned> [--root <dir>]
  node --experimental-strip-types fast-mode-telemetry.ts --halt-start [--atMs <iso>] [--reason <str>] [--root <dir>]   (record a .halt placement)
  node --experimental-strip-types fast-mode-telemetry.ts --halt-end   [--atMs <iso>] [--root <dir>]                    (record a .halt removal)
  node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]   (PURE READ — never writes)
  node --experimental-strip-types fast-mode-telemetry.ts --snapshot [--since <iso>] [--json] [--root <dir>] (writes the committed aggregate)`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * Read every event and build the report-with-meta shape. Shared by --report and --snapshot so
 * both paths compute the SAME object from the SAME events — the persisted snapshot cannot diverge
 * from a same-moment --report (AC4). PURE READ: never writes any file. Throws on a bad --since
 * or an unreadable event store.
 * @param {string} root
 * @param {string|null} sinceArg
 * @returns {Promise<{report: object}>}
 */
async function loadAndAggregate(root, sinceArg) {
  let sinceMs = null;
  if (sinceArg) {
    sinceMs = Date.parse(sinceArg);
    if (Number.isNaN(sinceMs)) throw new Error(`invalid --since "${sinceArg}" (expected an ISO timestamp)`);
  }
  const events = [];
  for await (const e of readAllEvents(root)) events.push(e);
  const haltEvents = readHaltEvents(root);
  // nowMs = Date.now(): a live report's window extends to the current instant (AC1's window end).
  const report = aggregate(events, { sinceMs, nowMs: Date.now(), haltEvents });
  return { report: { generatedAt: new Date().toISOString(), since: sinceArg ?? null, ...report } };
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

  // --halt-start / --halt-end (gap-tasksperhour-counts-halted-time-as-slow-work, AC1): the append-
  // only halt event log. The actor that places/removes the `.halt` sentinel calls these at the same
  // moment, recording the actual halt placement/removal instants (default now; `--atMs` allows a
  // precise backfill). These are the ONLY writers of the halt log. A forgotten call means no halt
  // interval is recorded → haltedHours stays 0 → the window keeps that halt time (the pre-fix,
  // conservative behavior; never an overestimate).
  if (args.includes("--halt-start")) {
    const atMsArg = getArgValue(args, "--atMs");
    const reason = getArgValue(args, "--reason");
    let atMs = Date.now();
    if (atMsArg !== undefined) {
      atMs = Date.parse(atMsArg);
      if (Number.isNaN(atMs)) {
        console.error(`fast-mode-telemetry: invalid --atMs "${atMsArg}" (expected an ISO timestamp)`);
        return 1;
      }
    }
    try {
      writeHaltEvent({ type: "halt", event: "start", atMs, reason: reason ?? null }, root);
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    console.log(`fast-mode-telemetry: halt start recorded at ${new Date(atMs).toISOString()}`);
    return 0;
  }
  if (args.includes("--halt-end")) {
    const atMsArg = getArgValue(args, "--atMs");
    let atMs = Date.now();
    if (atMsArg !== undefined) {
      atMs = Date.parse(atMsArg);
      if (Number.isNaN(atMs)) {
        console.error(`fast-mode-telemetry: invalid --atMs "${atMsArg}" (expected an ISO timestamp)`);
        return 1;
      }
    }
    try {
      writeHaltEvent({ type: "halt", event: "end", atMs }, root);
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    console.log(`fast-mode-telemetry: halt end recorded at ${new Date(atMs).toISOString()}`);
    return 0;
  }

  // --report — PURE READ (gap-telemetry-report-writes-and-deadlocks-readiness). Computes the
  // roll-up from .workflow-events/*.jsonl and prints it. NEVER writes the committed aggregate —
  // persisting is the explicit --snapshot subcommand's job. An observation poll (outer Monitor,
  // every 60s) therefore cannot dirty the working tree and deadlock restart-readiness-check.sh.
  if (args.includes("--report")) {
    const sinceArg = getArgValue(args, "--since");
    let reportWithMeta;
    try {
      ({ report: reportWithMeta } = await loadAndAggregate(root, sinceArg));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    if (args.includes("--json")) {
      console.log(JSON.stringify(reportWithMeta, null, 2));
    } else {
      printHumanReport(reportWithMeta, null);
    }
    return 0;
  }

  // --snapshot — the ONLY path that writes the committed aggregate, called at task end / Land /
  // day-end moments. Computes the SAME report --report would, then persists it to
  // milestones/fast-mode-telemetry/<date>.json and prints it (so --snapshot --json stdout is
  // byte-identical to the file it wrote — AC4's no-divergence guarantee).
  if (args.includes("--snapshot")) {
    const sinceArg = getArgValue(args, "--since");
    let reportWithMeta;
    try {
      ({ report: reportWithMeta } = await loadAndAggregate(root, sinceArg));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
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
