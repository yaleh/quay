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
// WORK-CLOCK SEPARATION (gap-over90-clock-measures-queue-time-not-work-time): the OVER90 90-minute
// budget must measure ACTUAL WORK time, not queue/defer time. A touches-overlap defer opens the
// bracket (`--task-start`) BEFORE real work begins — the bracket's startedAtMs is the QUEUE-clock
// start. `--work-start` records the moment the agent actually starts running (same runId, eventKind
// "work-start", timing.startedAtMs = work start). aggregate() exposes `workStartedAtMs` on
// inProgress records (the LATEST work-start for the runId, falling back to the bracket's startedAtMs
// for a never-deferred task — byte-identical behavior). OVER90 in inner-blocked-signal.ts's
// detectTaskOver90m reads ONLY `workStartedAtMs`, so a task that queues 80min then works 20min
// (100min bracket, 20min work) does NOT trigger OVER90.
//
// Run:
//   node --experimental-strip-types fast-mode-telemetry.ts --task-start --taskId <id> [--root <dir>]
//   node --experimental-strip-types fast-mode-telemetry.ts --work-start --taskId <id> --runId <r> [--root <dir>]  (record actual-work start on an open bracket)
//   node --experimental-strip-types fast-mode-telemetry.ts --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned> [--root <dir>]
//   node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]   (PURE READ)
//   node --experimental-strip-types fast-mode-telemetry.ts --snapshot [--since <iso>] [--json] [--root <dir>] (explicit persist)
//   node --experimental-strip-types fast-mode-telemetry.ts --reconcile [--json] [--root <dir>] (close in-flight records whose executor is observably gone)
//
// RECONCILE (gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-
// documented-backwards): a crash kills the executor and `--task-end` never comes — the record sits
// in `inProgress` forever (phantom), and the ONLY signal that eventually fires about it (OVER90,
// 90-minute budget) is indistinguishable from a genuinely slow task. `--reconcile` closes an
// in-flight record ONLY when the executor is OBSERVABLY gone (branch merged / worktree gone /
// process gone — never age), writing an end event (outcome "abandoned" + reconcileReason) so it
// leaves `inProgress`; records whose executor is still present are KEPT (fail-closed). The report
// routes reconcile-closed pairs to `reconciled[]` (never `tasks[]`) so they cannot pollute
// throughput, and marks backfilled starts (`startedAtMs` later than the task's first known commit)
// `startedAtMsUnreliable`, excluded from the throughput numerator and denominator (AC7).
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

// ── Reconcile observable probes ───────────────────────────────────────────────────────────────────────
// `--reconcile` closes an in-flight record ONLY when the executor is OBSERVABLY gone (gap-a-crash-
// leaves-phantom-in-flight-tasks...). The criteria are structural facts — a merged branch, an absent
// worktree, an absent process — NEVER wall-clock age (age alone is exactly the "phantom vs genuinely
// slow" confusion this feature exists to fix). Fail-closed toward KEEP: any positive presence signal
// (process alive, worktree checked out) keeps the record in `inProgress` (AC3 negative control).

/**
 * Best-effort check for a live process whose command line references the runId. Linux `/proc`
 * scan; any failure → false (never a positive "alive" signal from an unavailable source).
 *
 * Matches only the runId's DISTINCTIVE TAIL (`<ts>-<rand>`, the last two dash-segments), NOT the
 * full runId: a runId embeds the taskId, and the taskId can appear in any diagnostic command's
 * cmdline (the `pgrep -f` self-match trap CLAUDE.md documents) — that would falsely keep a phantom.
 * The random tail is unique to the run and appears only in a process that was actually passed the
 * runId. The fast-mode executor's cmdline does NOT normally carry the runId, so this is a weak KEEP
 * signal by design — the worktree/branch checks carry the close/keep weight.
 * @param {string} runId
 * @returns {boolean}
 */
export function processAlive(runId) {
  if (!runId || String(runId).length < 4) return false;
  const parts = String(runId).split("-");
  const needle = parts.length >= 2 ? parts.slice(-2).join("-") : String(runId);
  if (needle.length < 4) return false;
  try {
    const procs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of procs) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        if (cmd.includes(needle)) return true;
      } catch (_) { /* pid exited mid-scan; skip */ }
    }
  } catch (_) { /* /proc unavailable (non-Linux, sandbox) → no positive signal */ }
  return false;
}

/**
 * Whether the fast-mode branch `task/<taskId>` exists AND is merged into HEAD. A merged branch is
 * the strongest "executor is done" observable: the task's work landed, so nothing is still building
 * it. A missing branch is NOT merged (returns false) — absence of a branch is not itself evidence.
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean}
 */
export function isBranchMerged(root, taskId) {
  const branch = `task/${taskId}`;
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      stdio: "ignore", timeout: 5_000,
    });
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", branch, "HEAD"], {
      stdio: "ignore", timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the fast-mode branch `task/<taskId>` is checked out in an open worktree
 * (`git worktree list --porcelain`). An open worktree is a positive "executor may be mid-flight"
 * presence signal — the record is kept. Any git failure → false.
 * @param {string} root
 * @param {string} taskId
 * @returns {boolean}
 */
export function worktreeExists(root, taskId) {
  const branch = `refs/heads/task/${taskId}`;
  try {
    const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").some((l) => l.trim() === `branch ${branch}`);
  } catch {
    return false;
  }
}

/**
 * The task's earliest KNOWN WORK commit (ms epoch) — the reference a `--task-start` must PREDATE to
 * be trustworthy (AC7). A start whose startedAtMs is LATER than this is a backfilled/distorted
 * record: the work was already known to have begun/landed, so the start was written after the fact
 * (a real dispatch always brackets its work — start BEFORE the first work commit). Returns null when
 * no reliable reference exists — such a record is NOT treated as unreliable (never over-flag a
 * normal dispatch, whose start is always later than the task file's creation).
 *
 * Resolution order (only commits that EVIDENCE the task's WORK count; a branch pointing at an
 * ancestor of HEAD with no own commits is freshly dispatched, not merged):
 *   1. Earliest commit on the task's own branch `task/<taskId>` NOT reachable from master
 *      (`branch ^master`) — the work began at the first task-specific commit.
 *   2. The merge commit that landed the branch into master (`Merge branch 'task/<taskId>'`) — a
 *      start AFTER the merge is a backfill (the work was already known done); a start BEFORE it is
 *      real. This is the reference for the crash-recovery backfill scenario (code landed, then a
 *      restarted session backfilled `--task-start`).
 * @param {string} root
 * @param {string} taskId
 * @returns {number|null}
 */
export function firstKnownCommitMs(root, taskId) {
  const branch = `task/${taskId}`;
  try {
    const out = execFileSync("git", ["-C", root, "log", "--reverse", "--format=%ct", branch, "^master"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n")[0];
    if (line && /^\d+$/.test(line)) return Number(line) * 1000;
  } catch (_) { /* branch absent or git failure — fall through to the merge reference */ }
  try {
    const out = execFileSync("git", ["-C", root, "log", "--all", "--format=%ct", "--merges", "--grep", branch], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n")[0];
    if (line && /^\d+$/.test(line)) return Number(line) * 1000;
  } catch (_) { /* no merge found */ }
  return null;
}

/**
 * Memoized `firstKnownCommitMs` factory for the aggregate/reconcile paths: one git lookup per
 * distinct taskId, never per record.
 * @param {string} root
 * @returns {(taskId: string) => number|null}
 */
export function makeFirstKnownCommitMsByTask(root) {
  const cache = new Map();
  return (taskId) => {
    if (cache.has(taskId)) return cache.get(taskId);
    const v = firstKnownCommitMs(root, taskId);
    cache.set(taskId, v);
    return v;
  };
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
 * Build the schema-valid `Fast` work-start event (eventKind 'work-start'). Records the moment the
 * agent ACTUALLY starts running, keyed to the SAME runId as the bracket's `--task-start` — so the
 * QUEUE clock (bracket open → work start) is separated from the WORK clock (work start → end).
 * The dispatch loop calls this when it actually hands the task to a subagent (after any defer /
 * touches-overlap wait), not when the bracket opens. aggregate() treats it as a work-clock marker,
 * NOT a start/end pair (never an orphan/in-progress of its own); OVER90 reads ONLY the work clock.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.runId — the runId --task-start printed; the work-start pairs to that bracket
 * @param {string} [opts.executionCwd]
 * @param {string|null} [opts.baseCommit]
 * @param {number} [opts.recordedAtMs]
 * @returns {object} — a plain object that A1a validateEvent accepts
 */
export function buildWorkStartEvent({ taskId, runId, executionCwd, baseCommit = null, recordedAtMs = Date.now() }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    candidateId: String(taskId),
    taskId: String(taskId),
    stage: FAST_MODE_STAGE,
    attempt: 0,
    timing: { queuedAtMs: null, startedAtMs: recordedAtMs, endedAtMs: null },
    agentLabel: FAST_MODE_AGENT_LABEL,
    commandIdentity: "fast-mode-telemetry:work-start",
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
    eventKind: "work-start",
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
 * @param {string|null} [opts.reconcileReason] — when set, marks this end event as written by
 *   `--reconcile` closing a phantom in-flight record (executor observably gone). aggregate() routes
 *   such pairs to `reconciled[]` (never `tasks[]`), so a reconcile-close can never pollute
 *   throughput. An A1a extra field — forward-compat allowed, VALID_OUTCOMES unchanged.
 * @returns {object} — a plain object that A1a validateEvent accepts
 */
export function buildEndEvent({ taskId, runId, outcome, executionCwd, baseCommit = null, recordedAtMs = Date.now(), reconcileReason = null }) {
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
    reconcileReason,
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
 * @param {{sinceMs?: number|null, nowMs?: number|null, haltEvents?: Array<{event:"start"|"end", atMs:number}>|null, firstKnownCommitMsByTask?: ((taskId:string)=>number|null)|null}} [opts]
 *   sinceMs     — window start when given (AC2); else the earliest startedAtMs in the data.
 *   nowMs       — the observation instant. windowEnd = max(latest endedAtMs, nowMs). A live report
 *                 passes nowMs = Date.now() (window extends to now); a historical analysis passes
 *                 null or a past instant (window ends at the latest endedAtMs) — "活报告用 now，
 *                 历史窗口用最晚 end".
 *   haltEvents  — the append-only halt log lines (AC1/AC2). Closed halt intervals overlapping the
 *                 window are subtracted from windowHours; open/orphan lines subtract nothing
 *                 (conservative). Absent/null ⇒ haltedHours = 0 (byte-identical to pre-fix).
 *   firstKnownCommitMsByTask — AC7 annotation probe (taskId → the task's earliest known WORK
 *                 commit, ms epoch — the branch's first own commit or its merge into master). When
 *                 given, a record whose startedAtMs is LATER than this is marked
 *                 `startedAtMsUnreliable` (a backfilled/distorted start) and EXCLUDED from the
 *                 throughput numerator AND denominator. Absent/null ⇒ no annotation (byte-identical
 *                 to pre-fix behavior).
 * @returns {{tasks: Array<{taskId:string,runId:string,minutes:number,outcome:string|null}>, orphaned: Array<{taskId:string,runId:string,outcome:string|null}>, inProgress: Array<{taskId:string,runId:string,startedAtMs:number,workStartedAtMs:number|null,startedAtMsUnreliable:boolean}>, reconciled: Array<{taskId:string,runId:string,minutes:number,outcome:string|null,reconcileReason:string,startedAtMsUnreliable:boolean}>, unreliable: Array<{taskId:string,runId:string,minutes:number,outcome:string|null,startedAtMsUnreliable:boolean,startedAtMs:number}>, meanMinutes:number, medianMinutes:number, tasksPerHour:number, serialEquivalentPerHour:number, windowStart:string|null, windowEnd:string|null, windowHours:number, haltedHours:number, halted:Array<{startMs:number,endMs:number}>, blocked: Array<{taskId:string,reason:string|null,sinceMs:number|null,clearedAtMs:number|null,durationMs:number}>, totalBlockedMs:number, longestBlockedMs:number}}
 */
export function aggregate(events, { sinceMs = null, nowMs = null, haltEvents = null, firstKnownCommitMsByTask = null } = {}) {
  const fastEvents = events.filter((e) => e && e.stage === FAST_MODE_STAGE);
  // Blocked-wait events are NOT task start/end pairs — separate them before the byRun pairing.
  const blockedEvents = fastEvents.filter((e) => e.eventKind === "blocked");
  // WORK-CLOCK (gap-over90-clock-measures-queue-time-not-work-time): `--work-start` markers are NOT
  // task start/end pairs either — they record when the agent ACTUALLY began running on an open
  // bracket. Separated like blocked events so they can never pollute orphaned/inProgress, and their
  // latest timing.startedAtMs per runId becomes the record's workStartedAtMs (the WORK clock that
  // OVER90 reads). A never-deferred task (no work-start) falls back to the bracket's startedAtMs.
  const workStartEvents = fastEvents.filter((e) => e.eventKind === "work-start");
  const taskEvents = fastEvents.filter((e) => e.eventKind !== "blocked" && e.eventKind !== "work-start");
  const workStartByRun = new Map();
  for (const e of workStartEvents) {
    if (e.timing?.startedAtMs != null) {
      const cur = workStartByRun.get(e.runId);
      if (cur == null || e.timing.startedAtMs > cur) workStartByRun.set(e.runId, e.timing.startedAtMs);
    }
  }

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
  /** @type {Array<{taskId:string,runId:string,startedAtMs:number,startedAtMsUnreliable:boolean}>} */
  const inProgress = [];
  /** @type {Array<{taskId:string,runId:string,minutes:number,outcome:string|null,reconcileReason:string,startedAtMsUnreliable:boolean}>} */
  const reconciled = [];
  /** @type {Array<{taskId:string,runId:string,minutes:number,outcome:string|null,startedAtMsUnreliable:boolean,startedAtMs:number}>} */
  const unreliable = [];
  // Wall-clock window bounds (AC2/AC3): earliest start across all task events; latest end across
  // completed pairs. These feed tasksPerHour = count / windowHours below.
  // Reconcile-closed pairs (phantom starts) and `startedAtMsUnreliable` records (backfilled starts)
  // are EXCLUDED from both bounds — they must never enter the throughput numerator OR denominator
  // (AC7 / the phantom fix).
  let earliestStartMs = null;
  let latestEndMs = null;

  for (const rec of byRun.values()) {
    const end = rec.ends.length ? rec.ends[rec.ends.length - 1] : null; // last end wins
    const reconcileReason = end?.reconcileReason ?? null;
    const startedAtMs = rec.start?.timing?.startedAtMs ?? null;
    const firstCommitMs = firstKnownCommitMsByTask ? firstKnownCommitMsByTask(rec.taskId) : null;
    const startedAtMsUnreliable =
      firstCommitMs != null && startedAtMs != null && startedAtMs > firstCommitMs;
    if (startedAtMs != null && !reconcileReason && !startedAtMsUnreliable) {
      earliestStartMs = earliestStartMs == null ? startedAtMs : Math.min(earliestStartMs, startedAtMs);
    }
    if (rec.start && end) {
      // Completed pair — window filter on the END time (pair level).
      if (sinceMs != null && end.timing.endedAtMs < sinceMs) continue;
      const raw = startedAtMs != null ? (end.timing.endedAtMs - startedAtMs) / 60_000 : 0;
      const minutes = raw > 0 ? raw : 0;
      if (end.timing.endedAtMs != null && !reconcileReason && !startedAtMsUnreliable) {
        latestEndMs = latestEndMs == null ? end.timing.endedAtMs : Math.max(latestEndMs, end.timing.endedAtMs);
      }
      if (reconcileReason != null) {
        // `--reconcile` wrote this end event closing a phantom in-flight record. It pairs with the
        // original start (both real events — never deleted), but it is NOT a completed task: it
        // must never contribute to throughput. Surfaced in `reconciled[]` for the audit trail.
        reconciled.push({ taskId: rec.taskId, runId: rec.runId, minutes, outcome: end.outcome, reconcileReason, startedAtMsUnreliable });
      } else if (startedAtMsUnreliable) {
        // A completed pair whose start is backfilled (startedAtMs later than the task's first known
        // commit) asserts a wall-clock that did not happen — excluded from throughput (AC7).
        unreliable.push({ taskId: rec.taskId, runId: rec.runId, minutes, outcome: end.outcome, startedAtMsUnreliable: true, startedAtMs });
      } else {
        // runId carried on completed pairs so the reverse-direction slot detector
        // (gap-closed-bracket-leaves-live-agent-consuming-slots) can probe the executor process.
        tasks.push({ taskId: rec.taskId, runId: rec.runId, minutes, outcome: end.outcome });
      }
    } else if (end && !rec.start) {
      if (sinceMs != null && end.recordedAtMs < sinceMs) continue;
      orphaned.push({ taskId: rec.taskId, runId: rec.runId, outcome: end.outcome });
    } else if (rec.start && !end) {
      if (sinceMs != null && rec.start.recordedAtMs < sinceMs) continue;
      // WORK-CLOCK (gap-over90-clock-measures-queue-time-not-work-time): workStartedAtMs = the latest
      // `--work-start` marker for this runId, else the bracket's startedAtMs (never-deferred tasks
      // are byte-identical to pre-fix). startedAtMs stays the QUEUE-clock start (bracket open).
      // GUARD: a work-start marker that precedes the bracket start is a misordered call (work cannot
      // begin before the bracket opened) — fall back to startedAtMs rather than let the work clock
      // inflate past the bracket age.
      const ws = workStartByRun.get(rec.runId);
      const workStartedAtMs = startedAtMs != null && ws != null && ws >= startedAtMs ? ws : startedAtMs;
      inProgress.push({ taskId: rec.taskId, runId: rec.runId, startedAtMs, workStartedAtMs, startedAtMsUnreliable });
    }
  }

  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
  orphaned.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  inProgress.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  reconciled.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  unreliable.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));

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
    reconciled, unreliable,
  };
}

// ── Reconcile (gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards) ──
//
// `--reconcile` closes in-flight records whose executor is OBSERVABLY gone — a crash left them in
// `inProgress` forever and the only signal that fired about them (OVER90 after 90 minutes) was
// documented backwards. The decision is a pure function over observable probes so it is testable
// without faking processes/git state; the CLI wires real probes (processAlive / isBranchMerged /
// worktreeExists). Fail-closed toward KEEP: no positive evidence of absence ⇒ the record stays in
// `inProgress` (AC3 negative control — never trade the phantom problem for a blindness problem).

/**
 * Decide, for each in-flight record, whether to close it (executor observably gone) or keep it.
 * PURE: all observable facts arrive via the `executorGone` probe — this function itself never runs
 * git/ps, so tests inject deterministic verdicts.
 *
 * AC7: a record whose startedAtMs is LATER than the task's earliest known WORK commit (the branch's
 * first own commit or its merge into master — see `firstKnownCommitMs`) is a backfilled/distorted
 * `--task-start` — marked `startedAtMsUnreliable` in both the closed and kept outputs; such records
 * never enter throughput stats (see aggregate's `firstKnownCommitMsByTask` handling).
 *
 * @param {Array<{taskId:string, runId:string, startedAtMs:number}>} inProgress — from aggregate()
 * @param {object} [opts]
 * @param {(rec: {taskId:string, runId:string, startedAtMs:number}) => {gone:boolean, reason?:string|null}} [opts.executorGone]
 *   — observable-executor probe. Default: { gone:false, reason:"no-executor-probe" } — never close
 *   without evidence.
 * @param {(taskId:string) => number|null} [opts.firstKnownCommitMs] — AC7 annotation probe.
 * @returns {{closed: Array<{taskId:string, runId:string, startedAtMs:number, startedAtMsUnreliable:boolean, outcome:string, reconcileReason:string}>, kept: Array<{taskId:string, runId:string, startedAtMs:number, startedAtMsUnreliable:boolean, keepReason:string|null}>}}
 */
export function reconcileInFlight(inProgress, { executorGone, firstKnownCommitMs = null } = {}) {
  const closed = [];
  const kept = [];
  for (const rec of inProgress ?? []) {
    const firstCommit = firstKnownCommitMs ? firstKnownCommitMs(rec.taskId) : null;
    const startedAtMsUnreliable =
      firstCommit != null && typeof rec.startedAtMs === "number" && rec.startedAtMs > firstCommit;
    const verdict = executorGone ? executorGone(rec) : { gone: false, reason: "no-executor-probe" };
    // WORK-CLOCK (gap-over90-clock-measures-queue-time-not-work-time): carry workStartedAtMs through
    // the reconcile verdict so detectTaskOver90m (which reads the KEPT records) still sees the work
    // clock, not the queue clock. Absent ⇒ fall back to startedAtMs (byte-identical for pre-fix data).
    const base = {
      taskId: rec.taskId,
      runId: rec.runId,
      startedAtMs: rec.startedAtMs,
      workStartedAtMs: rec.workStartedAtMs ?? rec.startedAtMs ?? null,
      startedAtMsUnreliable,
    };
    if (verdict.gone) {
      closed.push({ ...base, outcome: "abandoned", reconcileReason: verdict.reason ?? "executor-gone" });
    } else {
      kept.push({ ...base, keepReason: verdict.reason ?? null });
    }
  }
  closed.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  kept.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  return { closed, kept };
}

/**
 * The production observable-executor probe wired by `--reconcile`. Checks in priority order:
 *   1. process alive   → KEEP (strongest presence signal; never close a live executor)
 *   2. worktree open   → KEEP (mid-flight dispatch environment still present — uncertain, and the
 *                        branch may legitimately point at an ancestor of HEAD with no commits yet)
 *   3. branch merged   → CLOSE (work landed; the executor that was building it is done)
 *   4. none of the above → CLOSE (no process, no worktree, branch not merged ⇒ dispatch gone)
 * Presence (process / open worktree) ALWAYS trumps absence — never close a record whose dispatch
 * environment is still observable. Never consults wall-clock age — see the file-header note.
 * @param {string} root
 * @returns {(rec: {taskId:string, runId:string}) => {gone:boolean, reason:string}}
 */
export function makeDefaultExecutorGone(root) {
  return (rec) => {
    if (processAlive(rec.runId)) return { gone: false, reason: "process-alive" };
    if (worktreeExists(root, rec.taskId)) return { gone: false, reason: "worktree-present" };
    if (isBranchMerged(root, rec.taskId)) return { gone: true, reason: "branch-merged" };
    return { gone: true, reason: "worktree-gone-and-no-process" };
  };
}

// ── Closed-bracket-but-live executor detection (gap-closed-bracket-leaves-live-agent-consuming-slots) ──
//
// REVERSE-direction bracket-lifecycle defect. The known four bracket defects are "bracket should
// close but didn't" (a `--task-end` never written leaves a stale `inProgress` entry — handled by
// `--reconcile`, which closes a bracket only when the executor is observably gone). THIS direction is
// the OPPOSITE: the bracket CLOSED (`--task-end` written, the record left `inProgress`) but the
// executor PROCESS is still observably present (open worktree / live process) — the agent is still
// running (or not yet reaped) while slot accounting already reads the slot as free. Bracket-close ≠
// agent-exit; the two are independent. A closed-bracket-but-live agent consumes a concurrency slot
// INVISIBLY — a new dispatch could land in a slot that is actually busy.
//
// The detector scans CLOSED brackets (completed start+end pairs) with the SAME observable-presence
// signals `--reconcile` uses on OPEN brackets (worktree open / process alive). Any closed-bracket
// task whose executor is still observably present is a "closed bracket but live agent" — its slot is
// NOT free and must be counted as occupied (AC2/AC3).

/**
 * Detect closed-bracket-but-live agents: completed (start+end) telemetry records whose executor is
 * STILL observably present. PURE: all observable facts arrive via the injected `executorPresent`
 * probe — this function never runs git/ps, so tests inject deterministic verdicts.
 * @param {Array<{taskId:string, runId?:string|null}>} completed — closed-bracket records (the
 *   report's tasks + reconciled + unreliable arrays — start+end pairs that left `inProgress`).
 * @param {object} [opts]
 * @param {(rec: {taskId:string, runId?:string|null}) => {present:boolean, reason?:string|null}} [opts.executorPresent]
 *   — observable-executor presence probe. Default: { present:false, reason:"no-executor-present-probe" }
 *   — never flag a closed bracket as occupied without evidence (fail-closed toward free only on
 *   verified absence).
 * @returns {Array<{taskId:string, runId:string|null, reason:string}>}
 */
export function detectClosedButLive(completed, { executorPresent } = {}) {
  const out = [];
  for (const rec of completed ?? []) {
    if (!rec || !rec.taskId) continue;
    const verdict = executorPresent ? executorPresent(rec) : { present: false, reason: "no-executor-present-probe" };
    if (verdict.present) {
      out.push({ taskId: rec.taskId, runId: rec.runId ?? null, reason: verdict.reason ?? "executor-present" });
    }
  }
  out.sort((a, b) => a.taskId.localeCompare(b.taskId) || (a.runId ?? "").localeCompare(b.runId ?? ""));
  return out;
}

/**
 * The production observable-presence probe for closed-bracket detection (wired by the
 * `--slot-status` / `--slots` / `--report` CLIs). Same presence signals `--reconcile` uses on OPEN
 * brackets, applied to CLOSED brackets:
 *   1. worktree open   → PRESENT (dispatch environment still on disk — the agent is still working or
 *                        not yet reaped; the slot must NOT be treated as free)
 *   2. process alive   → PRESENT (a live process still carries this runId)
 *   3. neither         → not present (bracket closed AND dispatch environment gone ⇒ slot genuinely
 *                        free)
 * Absence of a positive signal is NEVER treated as "present" — fail-closed toward reporting the slot
 * as busy while any evidence of occupancy remains.
 * @param {string} root
 * @returns {(rec: {taskId:string, runId?:string|null}) => {present:boolean, reason:string}}
 */
export function makeDefaultExecutorPresent(root) {
  return (rec) => {
    if (rec.taskId && worktreeExists(root, rec.taskId)) return { present: true, reason: "worktree-present" };
    if (rec.runId && processAlive(rec.runId)) return { present: true, reason: "process-alive" };
    return { present: false, reason: "no-present-signal" };
  };
}

// ── Non-task subagent in-flight count (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots) ──
//
// The UNDER-REPORT direction of the brackets-vs-subagents defect. The slot view above counts brackets
// whose executor is observably present — but an INVESTIGATION-type subagent (a `general-purpose` /
// `Explore` / `Plan` dispatch with no --task-start bracket) never enters the bracket store at all, so
// `real_in_flight` reads 0 while an actual subagent burns CPU. The inner's state self-check ① read
// `realInFlight ≤ cap` and judged free slots that were not free (real concurrency was brackets + the
// running investigation subagent).
//
// The fix does NOT put investigation subagents into task brackets (wrong semantics — they are not
// tasks). Instead `--slots`/`--slot-status` report a separate `subagentsInFlight` count of non-task
// subagent PROCESSES, and the REAL concurrency is `realInFlight + subagentsInFlight` — which is what
// the state self-check ① must compare against the cap. The classification follows the Contract's
// measure: `pgrep -af "general-purpose|Explore|Plan" | grep -v pgrep | grep -v "bash -c" | wc -l`.

/** A process cmdline that identifies a non-task subagent (Contract measure pattern). Case-sensitive: a lowercase "plan" in a path must not match. */
export const SUBAGENT_CMDLINE_RE = /general-purpose|Explore|Plan/;

/**
 * Marker substrings in the telemetry CLI's own cmdline that must never be counted as a subagent
 * (the `pgrep -f` self-match trap CLAUDE.md documents). The meter must not count itself as measured.
 */
export const TELEMETRY_SELF_CMDLINE_MARKERS = ["fast-mode-telemetry.ts", "--slots", "--slot-status"];

/**
 * Count non-task subagent processes from a list of process cmdlines. PURE: takes the process list,
 * so tests inject deterministic payloads instead of scanning the live machine.
 *
 * Exclusions mirror the Contract's pipeline:
 *   - `pgrep`-matching lines and `bash -c` wrapper lines are skipped (the `grep -v` legs);
 *   - the telemetry CLI's own processes are skipped (never count the meter as the measured);
 *   - any cmdline carrying a subagent role token (general-purpose / Explore / Plan) counts.
 *
 * @param {Array<string>} cmdlines — each process's cmdline (NUL-joined /proc/<pid>/cmdline, or
 *   pgrep -af output lines). Absent/null ⇒ 0.
 * @returns {number}
 */
export function countNonTaskSubagents(cmdlines) {
  let n = 0;
  for (const cmd of cmdlines ?? []) {
    if (typeof cmd !== "string" || cmd === "") continue;
    if (cmd.includes("pgrep") || cmd.includes("bash -c")) continue;
    if (TELEMETRY_SELF_CMDLINE_MARKERS.some((m) => cmd.includes(m))) continue;
    if (SUBAGENT_CMDLINE_RE.test(cmd)) n++;
  }
  return n;
}

/**
 * Scan /proc for live non-task subagent processes. Best-effort: a per-pid read failure is skipped;
 * /proc unavailable (non-Linux, sandbox) → 0 (never a positive count from an unavailable source).
 * @returns {number}
 */
export function scanNonTaskSubagents() {
  const cmdlines = [];
  try {
    const procs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of procs) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        cmdlines.push(cmd);
      } catch (_) { /* pid exited mid-scan; skip */ }
    }
  } catch (_) { /* /proc unavailable (non-Linux, sandbox) → no count */ }
  return countNonTaskSubagents(cmdlines);
}

/**
 * The subagent in-flight count the --slots/--slot-status CLIs report. `QUAY_TELEMETRY_SUBAGENTS`
 * (a non-negative integer) OVERRIDES the live /proc scan — the deterministic injection the scoped
 * tests use so slot arithmetic never depends on what else happens to be running on the machine at
 * test time. Unset ⇒ real scan.
 * @returns {number}
 */
export function readSubagentsInFlight() {
  const envVal = process.env.QUAY_TELEMETRY_SUBAGENTS;
  if (envVal !== undefined && envVal !== "") {
    const n = Number(envVal);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return scanNonTaskSubagents();
}

// ── Slot status (gap-telemetry-brackets-vs-subagents-no-slot-visibility) ─────────────────────────────
//
// `--slot-status` exposes the CONCURRENCY-SLOT view of the telemetry store as a PURE READ (like
// `--report`, it never writes a file, so a poll cannot dirty the tree and deadlock
// restart-readiness-check.sh). The slot view is the fix for "telemetry brackets ≠ real subagents":
// the raw `inProgress[]` counts brackets (a `--task-start` written, `--task-end` not yet), which
// includes red-window leftovers — phantoms whose executor is observably gone (crash killed the
// subagent and `--task-end` never came). A 5-bracket store with 1 live agent reads as "5 in flight"
// in `--report`, which is what made the state self-check item ① vacuous (`5 ≤ cap 3` false-RED a
// healthy 1-agent state, and `0` always-true when the store only ever holds phantoms).
//
// The slot view applies the SAME observable-executor probe `--reconcile` uses (process alive /
// worktree open → KEEP; branch merged / nothing → CLOSE) as a DRY RUN — nothing is written — and
// reports:
//   in_progress_total  — raw bracket count (`--report` inProgress.length).
//   stale_brackets     — brackets whose executor is observably gone (`--reconcile` would close them).
//   real_in_flight     — brackets whose executor is still present (the REAL concurrency).
//   slots_free         — max(0, cap − real_in_flight): the "how many slots are idle" number that was
//                        previously invisible to both layers.
//   brackets_reflect_subagents — invariant: in_progress_total === real_in_flight. false ⇒ stale
//                        brackets exist (reconcile them) or the --task-start/--task-end pair was not
//                        called in the dispatch path (AC4).
//
// AC5 regression shape: 5 red-window leftover brackets + 1 real agent with cap 3 ⇒ stale_brackets 5,
// real_in_flight 1, slots_free 2 — visible as "2 slots idle", NOT "full" (raw 6 > cap) and NOT
// "empty" (0 in flight).
//
// cap is an INPUT (--cap, the effective_cap from cap-from-gate.sh at the dispatch decision point).
// The default mirrors ready-pool-check.ts CONCURRENCY_CAP_DEFAULT=3 and is only a degraded fallback
// for a caller that does not pass one.

/** Degraded fallback cap for --slot-status when no --cap is passed (mirrors ready-pool-check). */
export const SLOT_STATUS_CAP_DEFAULT = 3;

/**
 * Compute the slot view of an in-flight set. PURE: all observable facts arrive via the injected
 * `executorGone` probe (default: no-executor-probe, keep everything) so tests can inject
 * deterministic verdicts without faking processes/git. Reuses `reconcileInFlight` — the same
 * classification `--reconcile` would write, but computed without writing anything.
 *
 * REVERSE-DIRECTION DIMENSION (gap-closed-bracket-leaves-live-agent-consuming-slots): the forward
 * reconcile pass (`executorGone`) only sees OPEN brackets. A CLOSED bracket (`--task-end` written)
 * whose executor is still observably present is invisible to it — the slot would read free while a
 * live agent burns CPU. `completed` + `executorPresent` close that gap: every closed-bracket record
 * whose executor is still present counts toward `occupied_slots`, so `slots_free` never offers a
 * slot that an actually-busy process still holds (AC3 negative control). With no `completed` array
 * the reverse dimension is a no-op (byte-identical to the pre-fix forward-only view).
 *
 * @param {Array<{taskId:string, runId:string, startedAtMs:number}>} inProgress — from aggregate()
 * @param {object} [opts]
 * @param {number} [opts.cap] — concurrency cap (effective_cap from cap-from-gate.sh); default
 *   SLOT_STATUS_CAP_DEFAULT.
 * @param {(rec: {taskId:string, runId:string, startedAtMs:number}) => {gone:boolean, reason?:string|null}} [opts.executorGone]
 *   — observable-executor probe, same contract as reconcileInFlight (FORWARD: open brackets).
 * @param {Array<{taskId:string, runId?:string|null}>} [opts.completed] — closed-bracket records
 *   (report tasks + reconciled + unreliable — start+end pairs that left inProgress). Absent/empty ⇒
 *   the reverse dimension contributes nothing (pre-fix behavior).
 * @param {(rec: {taskId:string, runId?:string|null}) => {present:boolean, reason?:string|null}} [opts.executorPresent]
 *   — closed-bracket executor-presence probe (REVERSE). Default: no-executor-present-probe — never
 *   flag a closed bracket as occupied without evidence.
 * @param {(taskId:string) => number|null} [opts.firstKnownCommitMs] — AC7 annotation probe.
 * @param {number} [opts.subagentsInFlight] — non-task subagent PROCESSES in flight (no bracket —
 *   investigation-type subagents, gap-telemetry-underreport-nontask-subagents-not-counted-in-slots).
 *   Default 0. These are NOT brackets and are counted on top of real_in_flight: real concurrency =
 *   real_in_flight + subagents_in_flight, and they occupy slots (slots_free must never offer a slot
 *   an actually-busy investigation subagent holds).
 * @returns {{cap:number, in_progress_total:number, stale_brackets:number, real_in_flight:number,
 *   subagents_in_flight:number, real_concurrency:number, closed_but_live_agents:Array<object>,
 *   occupied_slots:number, slots_free:number, slot_state:"free"|"full",
 *   brackets_reflect_subagents:boolean, closed_brackets_reflect_processes:boolean,
 *   closed:Array<object>, kept:Array<object>}}
 */
export function analyzeSlotStatus(inProgress, { cap = SLOT_STATUS_CAP_DEFAULT, executorGone, completed = [], executorPresent, firstKnownCommitMs = null, subagentsInFlight = 0 } = {}) {
  const { closed, kept } = reconcileInFlight(inProgress ?? [], { executorGone, firstKnownCommitMs });
  const realInFlight = kept.length;
  const closedButLive = detectClosedButLive(completed, { executorPresent });
  const nonTaskSubagents = Number.isFinite(subagentsInFlight) && subagentsInFlight > 0 ? Math.floor(subagentsInFlight) : 0;
  const realConcurrency = realInFlight + nonTaskSubagents;
  const occupiedSlots = realConcurrency + closedButLive.length;
  const slotsFree = Math.max(0, cap - occupiedSlots);
  return {
    cap,
    in_progress_total: (inProgress ?? []).length,
    stale_brackets: closed.length,
    real_in_flight: realInFlight,
    subagents_in_flight: nonTaskSubagents,
    real_concurrency: realConcurrency,
    closed_but_live_agents: closedButLive,
    occupied_slots: occupiedSlots,
    slots_free: slotsFree,
    slot_state: slotsFree > 0 ? "free" : "full",
    brackets_reflect_subagents: (inProgress ?? []).length === realInFlight,
    closed_brackets_reflect_processes: closedButLive.length === 0,
    closed,
    kept,
  };
}

/**
 * Human-readable slot-status lines for --slot-status (without --json).
 */
function printHumanSlotStatus(slot) {
  console.log(`slot status (generated ${new Date().toISOString()})`);
  console.log(`  cap: ${slot.cap}`);
  console.log(`  in-progress brackets (raw --report inProgress): ${slot.in_progress_total}`);
  console.log(`  stale brackets (reconcile would close, executor observably gone): ${slot.stale_brackets}`);
  console.log(`  real in-flight (open-bracket executor still present): ${slot.real_in_flight}`);
  console.log(`  non-task subagents in-flight (no bracket — investigation subagents, Contract pgrep): ${slot.subagents_in_flight}`);
  console.log(`  real concurrency (real in-flight + non-task subagents): ${slot.real_concurrency}`);
  console.log(`  closed-bracket-but-live agents (bracket closed, executor still present): ${slot.closed_but_live_agents.length}`);
  for (const c of slot.closed_but_live_agents) {
    console.log(`    ${c.taskId} (${c.reason})`);
  }
  console.log(`  occupied slots (real concurrency + closed-but-live): ${slot.occupied_slots}`);
  console.log(`  slots free: ${slot.slots_free} (slot_state ${slot.slot_state})`);
  console.log(`  brackets reflect subagents: ${slot.brackets_reflect_subagents ? "YES" : "NO (stale brackets or missing --task-end)"}`);
  if (slot.closed_but_live_agents.length > 0) {
    console.log(`  closed brackets reflect processes: NO — ${slot.closed_but_live_agents.length} closed-bracket agent(s) still present (bracket-close ≠ agent-exit); their slots are NOT free`);
  }
  if (!slot.brackets_reflect_subagents) {
    console.log(`  run '--reconcile' to close the ${slot.stale_brackets} stale bracket(s); if a real in-flight task has NO bracket, its --task-start was never called (AC4)`);
  }
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
    for (const p of report.inProgress) {
      const unrel = p.startedAtMsUnreliable ? " [startedAtMs-unreliable]" : "";
      // WORK-CLOCK (gap-over90-clock-measures-queue-time-not-work-time): when the work clock started
      // later than the bracket (a defer/queue segment existed), surface it — that is the clock OVER90
      // reads. A never-deferred task (workStartedAtMs == startedAtMs) shows no suffix.
      const work = p.workStartedAtMs != null && p.workStartedAtMs !== p.startedAtMs
        ? ` (work clock since ${new Date(p.workStartedAtMs).toISOString()})`
        : "";
      console.log(`  ${p.taskId} (runId ${p.runId})${unrel}${work}`);
    }
  }
  // Reconcile-aware real in-flight (gap-telemetry-brackets-vs-subagents-no-slot-visibility):
  // the raw bracket count does NOT reflect real concurrency (stale red-window brackets); realInFlight
  // = brackets whose executor is observably present. This is the number the state self-check ① reads.
  console.log(`real in-flight (reconcile-aware, executor present): ${report.realInFlight ?? report.inProgress.length} of ${report.inProgress.length} brackets`);
  // Closed-bracket-but-live agents (gap-closed-bracket-leaves-live-agent-consuming-slots): a CLOSED
  // bracket whose executor is still observably present (worktree open / process alive) occupies a
  // slot invisibly — bracket-close ≠ agent-exit. These are the reverse-direction phantom: the slot
  // view must NOT read them as free.
  if ((report.closedButLive ?? []).length) {
    console.log(`closed-bracket-but-live agents (bracket closed, executor still present): ${report.closedButLive.length}`);
    for (const c of report.closedButLive) console.log(`  ${c.taskId} (runId ${c.runId ?? "?"}, ${c.reason})`);
  }
  if (typeof report.occupiedSlots === "number") {
    console.log(`occupied slots (real in-flight + closed-but-live): ${report.occupiedSlots}`);
  }
  // Reconcile-closed phantom records (gap-a-crash-leaves-phantom-in-flight-tasks...): real events
  // preserved, but never counted as completed tasks.
  if ((report.reconciled ?? []).length) {
    console.log(`reconciled (phantom, executor observably gone): ${report.reconciled.length}`);
    for (const r of report.reconciled) console.log(`  ${r.taskId} (runId ${r.runId}, ${r.reconcileReason})`);
  }
  // Backfilled/distorted starts (AC7): excluded from throughput numerator and denominator.
  if ((report.unreliable ?? []).length) {
    console.log(`unreliable (startedAtMs-unreliable, excluded from throughput): ${report.unreliable.length}`);
    for (const u of report.unreliable) console.log(`  ${u.taskId} (runId ${u.runId})`);
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
  node --experimental-strip-types fast-mode-telemetry.ts --work-start --taskId <id> --runId <r> [--root <dir>]  (record actual-work start on an open bracket; OVER90 reads only this clock)
  node --experimental-strip-types fast-mode-telemetry.ts --task-end --taskId <id> --runId <r> --outcome <done|needs-human|abandoned> [--root <dir>]
  node --experimental-strip-types fast-mode-telemetry.ts --halt-start [--atMs <iso>] [--reason <str>] [--root <dir>]   (record a .halt placement)
  node --experimental-strip-types fast-mode-telemetry.ts --halt-end   [--atMs <iso>] [--root <dir>]                    (record a .halt removal)
  node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]   (PURE READ — never writes)
  node --experimental-strip-types fast-mode-telemetry.ts --slot-status [--cap <n>] [--json] [--root <dir>] (PURE READ — slot view: real in-flight + non-task subagents vs stale brackets vs closed-but-live agents vs slots free)
  node --experimental-strip-types fast-mode-telemetry.ts --report [--since <iso>] [--json] [--root <dir>]   (PURE READ — never writes; carries reconcilable/realInFlight/closedButLive/occupiedSlots)
  node --experimental-strip-types fast-mode-telemetry.ts --snapshot [--since <iso>] [--json] [--root <dir>] (writes the committed aggregate)
  node --experimental-strip-types fast-mode-telemetry.ts --slots [--cap N] [--json] [--root <dir>]          (PURE READ slot visibility: brackets vs real in-flight + non-task subagents vs closed-but-live)
  node --experimental-strip-types fast-mode-telemetry.ts --reconcile [--json] [--root <dir>]  (close in-flight records whose executor is observably gone — WRTES an end event per close)`;

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
  // AC7 (gap-a-crash-leaves-phantom-in-flight-tasks...): the report annotates backfilled starts
  // (startedAtMs later than the task's first known commit) as `startedAtMsUnreliable` and excludes
  // them from throughput — the same probe --reconcile uses. Best-effort; no git → no annotation.
  const firstKnownCommitMsByTask = makeFirstKnownCommitMsByTask(root);
  // nowMs = Date.now(): a live report's window extends to the current instant (AC1's window end).
  const report = aggregate(events, { sinceMs, nowMs: Date.now(), haltEvents, firstKnownCommitMsByTask });
  // Reconcile-aware slot visibility (gap-telemetry-brackets-vs-subagents-no-slot-visibility).
  // `--report` is PURE READ, so this is a DRY-RUN verdict: which inProgress brackets WOULD be closed
  // by `--reconcile` (executor observably gone — process dead / worktree gone / branch merged),
  // WITHOUT writing end events. `realInFlight` = brackets whose executor is still present — the
  // number that reflects REAL concurrency, as opposed to the raw bracket count that made the state
  // self-check ① a vacuous `≤ cap` check (5 stale red-window brackets ≠ 1 real subagent). Fail-closed:
  // a probe failure leaves realInFlight = raw count (never understate in-flight).
  let reconcilable = [];
  let realInFlight = report.inProgress.length;
  try {
    const { closed } = reconcileInFlight(report.inProgress, {
      executorGone: makeDefaultExecutorGone(root),
      firstKnownCommitMs: (taskId) => firstKnownCommitMsByTask(taskId),
    });
    reconcilable = closed;
    realInFlight = report.inProgress.length - closed.length;
  } catch (_) {
    reconcilable = [];
    realInFlight = report.inProgress.length;
  }
  // REVERSE-DIRECTION DIMENSION (gap-closed-bracket-leaves-live-agent-consuming-slots): CLOSED
  // brackets (completed start+end pairs) whose executor is STILL observably present are invisible to
  // the forward reconcile pass above (which only sees OPEN brackets). They still occupy a slot — a
  // closed bracket does NOT mean the agent process exited. Fail-closed: a probe failure leaves the
  // reverse dimension empty (the report degrades to the forward-only view, never a false occupied).
  let closedButLive = [];
  try {
    const completed = [
      ...(report.tasks ?? []),
      ...(report.reconciled ?? []),
      ...(report.unreliable ?? []),
    ];
    closedButLive = detectClosedButLive(completed, { executorPresent: makeDefaultExecutorPresent(root) });
  } catch (_) {
    closedButLive = [];
  }
  return {
    report: {
      generatedAt: new Date().toISOString(),
      since: sinceArg ?? null,
      ...report,
      reconcilable,
      realInFlight,
      closedButLive,
      occupiedSlots: realInFlight + closedButLive.length,
    },
  };
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

  // --work-start (gap-over90-clock-measures-queue-time-not-work-time): record the moment the agent
  // ACTUALLY started running on an already-open bracket. The dispatch loop calls this when it hands
  // the task to a subagent (AFTER any touches-overlap defer / queue wait), passing the runId that
  // --task-start printed — so the QUEUE segment (bracket open → work start) is excluded from the
  // work clock that OVER90 reads. Same schema-valid A1a event shape as --task-start but with
  // eventKind "work-start"; aggregate() treats it as a work-clock marker, never a start/end pair.
  if (args.includes("--work-start")) {
    const taskId = getArgValue(args, "--taskId");
    const runId = getArgValue(args, "--runId");
    if (!taskId || !runId) {
      console.error("fast-mode-telemetry: --work-start requires --taskId <id> --runId <r> (the runId --task-start printed)");
      return 1;
    }
    const event = buildWorkStartEvent({
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
    console.log(`fast-mode-telemetry: work-start recorded for ${taskId} (runId ${runId})`);
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

  // --slot-status — PURE READ (gap-telemetry-brackets-vs-subagents-no-slot-visibility). The slot
  // view of the telemetry store: applies the SAME observable-executor probe --reconcile uses as a
  // DRY RUN (no writes — never dirties the tree) and reports real_in_flight (brackets whose executor
  // is still present) vs stale_brackets (would-be-closed phantoms) vs slots_free (max(0, cap −
  // real_in_flight)). This is the "how many concurrency slots are idle" number both layers were blind
  // to (AC2): the raw --report inProgress counts brackets, which includes red-window leftovers and
  // made the state self-check item ① vacuous. cap is an INPUT (--cap, effective_cap from
  // cap-from-gate.sh); default SLOT_STATUS_CAP_DEFAULT.
  if (args.includes("--slot-status")) {
    const capArg = getArgValue(args, "--cap");
    const cap = capArg !== undefined ? Number(capArg) : SLOT_STATUS_CAP_DEFAULT;
    if (capArg !== undefined && (!Number.isFinite(cap) || cap < 0)) {
      console.error(`fast-mode-telemetry: invalid --cap "${capArg}" (expected a non-negative integer)`);
      return 1;
    }
    let reportWithMeta;
    try {
      ({ report: reportWithMeta } = await loadAndAggregate(root, null));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    const firstKnownCommitMsByTask = makeFirstKnownCommitMsByTask(root);
    // Non-task subagent in-flight (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots):
    // investigation-type subagents carry no bracket, so the bracket-based real_in_flight alone
    // UNDER-reports real concurrency (0/3 slots while a general-purpose subagent burns CPU). The
    // real count adds the live non-task subagent PROCESSES; real_concurrency = real_in_flight +
    // subagents_in_flight is what the state self-check ① must compare against the cap.
    const slot = analyzeSlotStatus(reportWithMeta.inProgress, {
      cap,
      executorGone: makeDefaultExecutorGone(root),
      completed: [
        ...(reportWithMeta.tasks ?? []),
        ...(reportWithMeta.reconciled ?? []),
        ...(reportWithMeta.unreliable ?? []),
      ],
      executorPresent: makeDefaultExecutorPresent(root),
      firstKnownCommitMs: (taskId) => firstKnownCommitMsByTask(taskId),
      subagentsInFlight: readSubagentsInFlight(),
    });
    if (args.includes("--json")) {
      console.log(JSON.stringify(slot, null, 2));
    } else {
      printHumanSlotStatus(slot);
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

  // --slots (gap-telemetry-brackets-vs-subagents-no-slot-visibility, AC2/AC5): machine-readable
  // slot visibility — how many real concurrency slots are in flight vs remaining. PURE READ (never
  // writes). `bracketsInFlight` is the raw start-without-end count; `reconcilable` is the subset
  // whose executor is OBSERVABLY gone (would be closed by --reconcile); `realInFlight` = brackets
  // whose executor is still present. `subagentsInFlight` = non-task subagent PROCESSES (no bracket —
  // investigation-type subagents, gap-telemetry-underreport-nontask-subagents-not-counted-in-slots);
  // `realConcurrency` = realInFlight + subagentsInFlight is the REAL concurrency signal the state
  // self-check ① must read instead of the raw bracket count (a bare investigation subagent read as
  // 0/3 empty slots is exactly the UNDER-report this fixes). `--cap` supplies the concurrency cap
  // (the tick passes its `effective_cap` from cap-from-gate.sh); when omitted, slotsTotal/
  // slotsRemaining are null.
  if (args.includes("--slots")) {
    const capArg = getArgValue(args, "--cap");
    let cap = null;
    if (capArg !== undefined) {
      cap = Number(capArg);
      if (!Number.isFinite(cap) || cap < 0) {
        console.error(`fast-mode-telemetry: invalid --cap "${capArg}" (expected a non-negative number)`);
        return 1;
      }
    }
    let reportWithMeta;
    try {
      ({ report: reportWithMeta } = await loadAndAggregate(root, null));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    const slotsTotal = cap != null ? cap : null;
    // Reverse-direction dimension (gap-closed-bracket-leaves-live-agent-consuming-slots): a CLOSED
    // bracket whose executor is still observably present (worktree open / process alive) occupies a
    // slot even though it is not in `inProgress`. Plus the UNDER-report direction: non-task
    // subagent processes occupy slots even though they carry NO bracket. `occupiedSlots` = real
    // in-flight (open brackets with a live executor) + non-task subagents + closed-but-live agents
    // — the number `slots-remaining` must subtract from the cap so a new dispatch is never
    // recommended into an actually-busy slot (AC3).
    const subagentsInFlight = readSubagentsInFlight();
    const realConcurrency = reportWithMeta.realInFlight + subagentsInFlight;
    const closedButLive = reportWithMeta.closedButLive ?? [];
    const occupiedSlots = realConcurrency + closedButLive.length;
    const slotsRemaining = cap != null ? Math.max(0, cap - occupiedSlots) : null;
    const out = {
      bracketsInFlight: reportWithMeta.inProgress.length,
      reconcilable: reportWithMeta.reconcilable.length,
      realInFlight: reportWithMeta.realInFlight,
      subagentsInFlight,
      realConcurrency,
      closedButLive,
      occupiedSlots,
      slotsTotal,
      slotsRemaining,
    };
    if (args.includes("--json")) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      const capPart = cap != null ? `, slots-total ${out.slotsTotal}, slots-remaining ${out.slotsRemaining}` : "";
      const closedPart = out.closedButLive.length > 0 ? `, closed-but-live ${out.closedButLive.map((c) => c.taskId).join(",")}` : "";
      const subPart = out.subagentsInFlight > 0 ? `, non-task subagents ${out.subagentsInFlight}` : "";
      console.log(
        `slot visibility: brackets-in-flight ${out.bracketsInFlight}, reconcilable ${out.reconcilable}, real-in-flight ${out.realInFlight}, real-concurrency ${out.realConcurrency}${subPart}${closedPart}, occupied ${out.occupiedSlots}${capPart}`,
      );
    }
    return 0;
  }

  // --reconcile (gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-
  // documented-backwards): close in-flight records whose executor is OBSERVABLY gone (branch
  // merged / worktree gone / process gone — NEVER wall-clock age). Writes one schema-valid end event
  // per close (outcome "abandoned" + reconcileReason extra field) so the record leaves `inProgress`;
  // raw events are never deleted. Records whose executor is still present (process alive / open
  // worktree) are KEPT — fail-closed toward not making the phantom problem into a blindness problem
  // (AC3). Prints { closed, kept, inProgress } as JSON (or human lines).
  if (args.includes("--reconcile")) {
    let reportWithMeta;
    try {
      ({ report: reportWithMeta } = await loadAndAggregate(root, null));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    const firstKnownCommitMsByTask = makeFirstKnownCommitMsByTask(root);
    const { closed, kept } = reconcileInFlight(reportWithMeta.inProgress, {
      executorGone: makeDefaultExecutorGone(root),
      firstKnownCommitMs: (taskId) => firstKnownCommitMsByTask(taskId),
    });
    let writeFailed = false;
    for (const c of closed) {
      const ev = buildEndEvent({
        taskId: c.taskId,
        runId: c.runId,
        outcome: c.outcome,
        reconcileReason: c.reconcileReason,
        executionCwd: process.cwd(),
        baseCommit: getBaseCommit(root),
        recordedAtMs: Date.now(),
      });
      try {
        writeEvent(ev, root);
      } catch (e) {
        console.error(`fast-mode-telemetry: failed to write reconcile end for ${c.taskId} (${c.runId}): ${e.message}`);
        writeFailed = true;
      }
    }
    if (writeFailed) return 1;
    // Re-read to reflect the written end events in the final inProgress.
    let finalReport;
    try {
      ({ report: finalReport } = await loadAndAggregate(root, null));
    } catch (e) {
      console.error(`fast-mode-telemetry: ${e.message}`);
      return 1;
    }
    const out = { closed, kept, inProgress: finalReport.inProgress };
    if (args.includes("--json")) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(`reconcile: ${closed.length} closed, ${kept.length} kept, ${finalReport.inProgress.length} still in-progress`);
      for (const c of closed) console.log(`  closed: ${c.taskId} (runId ${c.runId}, ${c.reconcileReason}${c.startedAtMsUnreliable ? ", startedAtMs-unreliable" : ""})`);
      for (const k of kept) console.log(`  kept:   ${k.taskId} (runId ${k.runId}, ${k.keepReason ?? "no-evidence-of-gone"}${k.startedAtMsUnreliable ? ", startedAtMs-unreliable" : ""})`);
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
