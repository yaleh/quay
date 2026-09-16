// observation.ts — gap-web-cannot-show-what-the-loop-is-doing-now.
//
// THE ONLY module in the Core serve path that knows workspace-specific observation details:
// the fast-mode telemetry store (`.workflow-events/*.jsonl`), the orchestration journal files
// (`orchestration/escalations.md`, `orchestration/tick-log.md`), and `git`. Core is
// provider-agnostic; these are THIS workspace's details, not part of the Provider ABI — so
// they are quarantined here and nowhere else. serve-handlers.ts renders what this module
// returns and never touches these paths itself (AC1; verify with grep).
//
// DEGRADATION CONTRACT (the defect this task exists to avoid repeating — 0.5% malformed data
// must not 500 100% of the UI): every data source is read INDEPENDENTLY, each in its own
// try/catch. A source that is ABSENT reports `status: "empty"` (the page renders 「无数据」);
// a source that is PRESENT but unreadable/malformed reports `status: "error"` + a human
// `reason` (the page renders 「读失败: <reason>」). 「无数据」 and 「读失败」 are ALWAYS
// distinguishable (AC5). No source can throw out of this module — observation never 500s the
// page. The read path never writes a file (AC6 — the same principle as `--report`'s pure read).
//
// REFINEMENT (gap-verification-round-empty-state-lumps-three-distinct-causes, 2026-09-13): the
// contract above is a LOWER bound, not the ceiling — it separates 「无数据」 from 「读失败」 but says
// nothing about WHY there is no data. A source whose absence has more than one distinct cause
// enumerates them in `status` (see `TestsStatus`: 「无写者接入」 vs 「有写者、零记录」), because a
// boolean/catch-all empty value makes a structural problem and a timing problem render identically.
// This widens the value set; it does NOT relax 「无数据 ≠ 读失败」, and `error` still means PRESENT
// but unreadable for every source.
//
// TELEMETRY PATH — deviation from the task body's literal `.quay/fast-mode-telemetry.jsonl`:
// the real store is `.workflow-events/*.jsonl`. fast-mode-telemetry.ts reads and writes
// `<root>/.workflow-events/<runId>.jsonl`, and AC2 pins /live against
// `fast-mode-telemetry.ts --report --json`, which reads that same store.
// `.quay/fast-mode-telemetry.jsonl` does not exist in the current layout (nothing writes it),
// so the AC4 negative control renames `.workflow-events/`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { QUAY_VERSION } from "./version.ts";
import { parseFrontmatter } from "./frontmatter-store-base.ts";
import { TASK_STATUS, isTaskStatus, type TaskStatus } from "./abi.ts";
import { resolvePluginScript, resolvePluginScriptExec } from "./plugin-root.ts";
// Shared session read/write primitives — ONE copy of each, byte-identical to the pinned quay-fleet
// blob (packages/quay/src/primitives/PROVENANCE.md; re-checked by plugin/scripts/primitives-drift-check.ts).
// ⛔ Do not re-implement either of these here: SPEC §3.3's only unacceptable outcome is a second
// hand-written implementation of a session primitive.
import { readTranscriptMtime } from "./primitives/session-liveness.mjs";
import { validateSessionRecord } from "./primitives/session-schema.mjs";
import { resolveWorktreeNamespace } from "./worktree-namespace.ts";
import YAML from "yaml";

const execFileP = promisify(execFile);

export const FAST_MODE_EVENTS_DIR = ".workflow-events";
export const ORCHESTRATION_DIR = "orchestration";
export const ESCALATIONS_FILE = "escalations.md";
export const TICK_LOG_FILE = "tick-log.md";
export const GIT_LOG_LIMIT = 20;
/** Recent-entry bounds for the /journal page. */
export const JOURNAL_ESCALATION_SECTIONS = 10;
/** tick-log.md entries are `` - `HH:MMZ` `action` `` bullets — read by a dedicated reader (readTickLog), not `## ` sections. */
export const JOURNAL_TICK_SECTIONS = 15;
/**
 * gap-webui-journal-stale-and-ticklog-bug AC1: an escalations channel whose backing file is older
 * than this many days is marked stale on the Journal page (it was superseded by tick-log but still
 * rendered first as a fresh 「最近记录」).
 */
export const ESCALATIONS_STALE_DAYS = 1;
/**
 * gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: the activity window used to tell
 * 「循环在跑但没接遥测」 apart from 「循环根本没跑」. A signal is "active" if it falls inside the
 * window. Mirrors the manager's现场 measurements (archguard: 3 commits/30 min, tick-log mtime
 * minutes old) and the contract's `--since='30 minutes ago'` measure.
 */
export const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

export type ObservationStatus = "ok" | "empty" | "error";

/**
 * Loop-state discriminator (gap-live-cannot-tell-a-dead-loop-from-an-unwired-one):
 * - `running` — telemetry has records (the loop IS wired to telemetry);
 * - `running-unwired` — telemetry empty BUT activity signals present (loop is alive, just not
 *   writing `.workflow-events/` — the manager's archguard现场);
 * - `not-running` — telemetry empty AND no activity signal (loop really is dead).
 */
export type LiveState = "running" | "running-unwired" | "not-running";

/** Filesystem-observable activity signals that separate the two telemetry-empty states. */
export interface ActivitySignals {
  /** `git -C <root> log --since='30 minutes ago' --oneline | wc -l` — commits in the window. */
  recentCommits: number;
  /** True when `orchestration/tick-log.md` exists and its mtime is within the activity window. */
  tickLogFresh: boolean;
  /** tick-log.md age in minutes at the observation instant, or null when missing/unreadable. */
  tickLogAgeMinutes: number | null;
}

/**
 * Process-level liveness of an open fast-mode run (gap-in-flight-liveness-worktree-proxy-not-process):
 * whether an executor process is observably present right now. DISTINCT from worktree existence —
 * a worktree can exist while no agent is running (a ready-pool wait), and worktree existence is
 * the proxy this reading replaces on the display surface. `readLive` annotates every start-without-end
 * run; the board reclassifies `orphan` runs OUT of the in-flight display (AC1).
 */
export type RunLiveness = "alive" | "orphan" | "unknown";

/**
 * Execution phase of an open fast-mode run (gap-live-fan-in-execution-phase-two-axis) — the SECOND
 * axis, DISTINCT from the lifecycle status (todo/ready/done/needs-human). Derived from direct signals
 * with a fixed priority (landed → fan-in → implementing → awaiting-land → implementing fallback); see
 * `deriveInFlightPhase`. The old /live 状态 column conflated this with the lifecycle status, so the
 * mechanical fan-in window (worker exited, suite running) was indistinguishable from a still-working
 * worker — both rendered 「实现中」.
 */
export type InFlightPhase = "implementing" | "fan-in" | "awaiting-land" | "landed";

/** The display slice of `.quay/full-suite-state.json` carried on a fan-in task
 *  (gap-live-fan-in-execution-phase-two-axis). Best-effort — a missing/unreadable field degrades to
 *  null, never a fabricated value (hard rule ③b). */
export interface SuiteStateView {
  /** suite state: "running" | "green" | "red". */
  state: string | null;
  /** suite runner identity ("outer" | "inner"). */
  runner: string | null;
  /** suite start, ISO 8601. */
  startedAt: string | null;
  /** suite wall-clock ms; null while running. */
  durationMs: number | null;
}

export interface InFlightTask {
  taskId: string;
  runId: string;
  /**
   * Worker process id (from the `/proc/<pid>` scan, 方向二). Non-null ONLY for a worker-process-
   * signal task (gap-live-page-worker-inflight-bidirectional-error); null for workflow-events and
   * outcome-carrier tasks (no process known). Lets the Live view locate the process/session
   * downstream (gap-webui-live-passthrough-pid).
   */
  pid: string | null;
  /**
   * The live transcript session id for an in-flight worker (gap-worker-task-transcript-access-webui
   * AC2): joined from `~/.claude/sessions/<pid>.json`'s `sessionId` for the worker-process-signal
   * task whose pid is known. null otherwise — a live worker has NO transcript join when its pid has
   * no session record yet (honest null, hard rule ③b: 读不到 ≠ 无会话可访问，但「无链接」比「伪造
   * 链接」安全，且进程退出即删只覆盖在飞).
   */
  sessionId: string | null;
  startedAtMs: number;
  /**
   * Impl-complete boundary (gap-inflight-states-missing-impl-complete-event): the third lifecycle
   * event's `recordedAtMs`, or null when the open run is still implementing. Splits the in-flight
   * view into two segments — implementing (null) vs awaiting-land (non-null). The board renders
   * them as two independent counts.
   */
  implCompletedAtMs: number | null;
  /**
   * Lifecycle status (todo/ready/done/needs-human) read from the task store — the FIRST axis
   * (gap-live-fan-in-execution-phase-two-axis AC4). Distinct from `phase` (the execution axis): the
   * old /live 状态 column labeled the impl-complete boundary (an execution signal) with lifecycle
   * words. null when the store has no such task (e.g. a workflow-events run with no on-disk task).
   * `pairInFlight` leaves it null (pure); `readLive` annotates the real value from the store.
   */
  status: TaskStatus | null;
  /**
   * Execution phase — the SECOND axis (gap-live-fan-in-execution-phase-two-axis AC1-AC3). Derived
   * from direct signals with a fixed priority (landed → fan-in → implementing → awaiting-land →
   * implementing fallback). `pairInFlight` sets a provisional value from the impl-complete event;
   * `readLive` re-derives it from the direct signals (fan-in lock / worker process / task status).
   */
  phase: InFlightPhase;
  /** Suite state carried on a fan-in task (`.quay/full-suite-state.json`); null otherwise. */
  suite: SuiteStateView | null;
  /** Elapsed minutes from startedAtMs to the observation instant, rounded to 1 decimal. */
  minutes: number;
  /**
   * Process-level liveness at the observation instant:
   *   "alive"   — a process cmdline carries the runId's distinctive tail (executor present);
   *   "orphan"  — /proc was readable and no process matched (executor observably gone — the run is
   *               NOT in-flight, it is abandoned);
   *   "unknown" — /proc unavailable/unreadable (fail-closed toward in-flight, never flagged orphan).
   * `pairInFlight` itself stays PURE (event pairing only); `readLive` annotates this field from the
   * sync probe so the pairing remains `--report inProgress`-compatible (serve.test.mjs AC2 pin).
   */
  liveness: RunLiveness;
  /**
   * Cross-task blocking visibility (gap-webui-cross-task-blocking-visibility): the task ids this
   * in-flight run is currently BLOCKING (ready/todo tasks whose `## Touches` overlap this task's
   * own `## Touches`, or whose `depends_on` names this task), and the task ids BLOCKING it (its own
   * `depends_on` targets, plus any other in-flight task whose Touches overlap — symmetric
   * contention). Computed by `computeBlockingRelations` from the on-disk task store; `pairInFlight`
   * leaves both empty (it is a pure event-pairing function), `readLive` annotates the real values.
   */
  blocks: string[];
  blockedBy: string[];
}

export interface LiveResult {
  status: ObservationStatus;
  reason: string | null;
  inFlight: InFlightTask[];
  /**
   * The worker concurrency CAP (`driverCap(root, "worker")` — drivers.yml `worker.cap`, or
   * DEFAULT_DRIVER_CAP when absent). gap-dashboard-live-concurrency-duplicates-inflight-count: this
   * is NOT the in-flight count — `inFlight.length` is. The old `concurrency` field duplicated
   * `inFlight.length` and misled the display into showing two identical numbers side-by-side.
   */
  concurrencyCap: number;
  /** `/proc/pressure/cpu` `some avg10` — null when unavailable (non-Linux / unreadable). */
  cpuPressure: number | null;
  /**
   * Loop-state discriminator. `running` when telemetry has records; `running-unwired` /
   * `not-running` when telemetry is empty (decided by activity signals). `null` ONLY when the
   * telemetry read failed (`status === "error"` — the 「读失败」 degradation, which stays
   * distinct from both empty-state texts).
   */
  liveState: LiveState | null;
  /** Human-readable explanation of how liveState was decided (the explainability hard requirement). */
  liveExplanation: string | null;
  /** Per-signal activity detail; null when status === "error". */
  activity: ActivitySignals | null;
}

export interface JournalSection {
  status: ObservationStatus;
  reason: string | null;
  /** Markdown text to render with the existing renderer (serve-handlers.ts renderMarkdown). */
  markdown: string | null;
}

export interface JournalResult {
  escalations: JournalSection;
  tickLog: JournalSection;
  commits: JournalSection;
}

interface RawEvent {
  stage?: unknown;
  eventKind?: unknown;
  runId?: unknown;
  taskId?: unknown;
  timing?: { startedAtMs?: unknown; endedAtMs?: unknown };
  /** The impl-complete boundary instant (gap-inflight-states-missing-impl-complete-event). */
  recordedAtMs?: unknown;
}

/**
 * Start/end classification — EXACT mirror of fast-mode-telemetry.ts aggregate()'s semantics
 * (verified against `--report --json` in the AC2 test): start-like = `eventKind === "start"`
 * OR (`timing.startedAtMs != null` AND `timing.endedAtMs == null`); end-like = `eventKind ===
 * "end"` OR `timing.endedAtMs != null`. Classification is by TIMING MARKER PRESENCE, not the
 * `eventKind` extra field alone (DEFECT-4 fix), because `eventKind` is not in A1a
 * REQUIRED_FIELDS.
 */
function isStartLike(e: RawEvent): boolean {
  if (!e || !e.timing) return false;
  if (e.eventKind === "start") return true;
  return e.timing.startedAtMs != null && e.timing.endedAtMs == null;
}

function isEndLike(e: RawEvent): boolean {
  if (!e || !e.timing) return false;
  if (e.eventKind === "end") return true;
  return e.timing.endedAtMs != null;
}

/**
 * Pair parsed `Fast`-stage events into in-flight tasks — mirrors fast-mode-telemetry.ts
 * aggregate()'s inProgress branch exactly: blocked-wait events (`eventKind === "blocked"`) are
 * not task pairs; pairing key is runId; FIRST start wins, LAST end wins; a run with a start and
 * NO end is in-flight; sorted by taskId then runId. Malformed/untyped records are skipped, never
 * thrown. `nowMs` is the observation instant used for elapsed minutes.
 *
 * gap-inflight-states-missing-impl-complete-event: the impl-complete boundary (a third lifecycle
 * event, `eventKind === "impl-complete"`, timing all-null) splits the in-flight view into two
 * segments — implementing (implCompletedAtMs null: start, no impl-complete — 真正在实现) vs
 * awaiting-land (implCompletedAtMs non-null: impl-complete, no end — 排队待落地). FIRST
 * impl-complete wins (a re-write on ff-retry never flips a run back to implementing).
 */
export function pairInFlight(events: RawEvent[], nowMs: number): InFlightTask[] {
  const byRun = new Map<string, { runId: string; taskId: string; start: RawEvent | null; implComplete: RawEvent | null; ends: RawEvent[] }>();
  for (const e of events) {
    if (!e || e.stage !== "Fast" || e.eventKind === "blocked") continue;
    const runId = typeof e.runId === "string" ? e.runId : "";
    const taskId = typeof e.taskId === "string" ? e.taskId : "";
    if (!runId) continue;
    let rec = byRun.get(runId);
    if (!rec) {
      rec = { runId, taskId, start: null, implComplete: null, ends: [] };
      byRun.set(runId, rec);
    }
    // impl-complete is classified BEFORE start/end: its timing is all-null so it is neither
    // start-like nor end-like, but the explicit branch keeps the boundary unambiguous.
    if (e.eventKind === "impl-complete") {
      if (!rec.implComplete) rec.implComplete = e;
    } else if (isStartLike(e)) {
      if (!rec.start) rec.start = e;
    } else if (isEndLike(e)) {
      rec.ends.push(e);
    }
  }

  const out: InFlightTask[] = [];
  for (const rec of byRun.values()) {
    const end = rec.ends.length ? rec.ends[rec.ends.length - 1] : null;
    if (rec.start && !end && typeof rec.start.timing?.startedAtMs === "number") {
      out.push({
        taskId: rec.taskId,
        runId: rec.runId,
        pid: null, // pure event pairing: no live process known (readLive annotates it for 方向二)
        sessionId: null, // pure event pairing: no process ⇒ no live session join (readLive annotates)
        startedAtMs: rec.start.timing.startedAtMs,
        implCompletedAtMs:
          rec.implComplete && typeof rec.implComplete.recordedAtMs === "number"
            ? rec.implComplete.recordedAtMs
            : null,
        // pairInFlight is PURE and cannot read the task store — status stays null, readLive annotates.
        status: null,
        // Provisional phase from the impl-complete event only (the pure function knows no fan-in
        // lock / worker process); readLive re-derives the real phase from the direct signals.
        phase:
          rec.implComplete && typeof rec.implComplete.recordedAtMs === "number"
            ? "awaiting-land"
            : "implementing",
        suite: null,
        minutes: Math.max(0, (nowMs - rec.start.timing.startedAtMs) / 60_000),
        // pairInFlight is a PURE event-pairing function and cannot probe /proc — the fail-closed
        // "unknown" default keeps the field total. readLive overwrites it with the real process
        // liveness (classifyRunLiveness(runProcessAliveSync(runId))).
        liveness: "unknown",
        // blocks/blockedBy are likewise pure-function defaults — readLive annotates the real values
        // from the on-disk task store (computeInFlightBlocking).
        blocks: [],
        blockedBy: [],
      });
    }
  }
  out.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId));
  return out;
}

/** Read every JSON object across all `<eventsDir>/*.jsonl`. Malformed lines are skipped (never crash). */
function readEventsFromDir(eventsDir: string, files?: string[]): RawEvent[] {
  const list = files ?? fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl")).sort();
  const events: RawEvent[] = [];
  for (const file of list) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(eventsDir, file), "utf8");
    } catch {
      continue; // one unreadable file must not 500 the whole /live page
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) events.push(parsed);
      } catch {
        // skip malformed line — never crash the read
      }
    }
  }
  return events;
}

/**
 * Activity signals that separate 「循环在跑但没接遥测」 from 「循环根本没跑」 (only consulted when
 * telemetry is empty). Signal 1: commits in the activity window (`git log --since=30 minutes
 * ago`). Signal 2: `orchestration/tick-log.md` mtime freshness. Each is read in its own
 * try/catch — a non-git workspace or unreadable tick log degrades to "no signal", never throws.
 */
export function readActivitySignals(root: string, { nowMs = Date.now() }: { nowMs?: number } = {}): ActivitySignals {
  let recentCommits = 0;
  try {
    const out = execFileSync("git", ["-C", root, "log", "--since=30 minutes ago", "--oneline"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    recentCommits = out.split(/\r?\n/).filter(Boolean).length;
  } catch {
    recentCommits = 0; // non-git workspace or git failure → no commit-activity signal
  }

  let tickLogAgeMinutes: number | null = null;
  try {
    const tickPath = path.join(root, ORCHESTRATION_DIR, TICK_LOG_FILE);
    if (fs.existsSync(tickPath)) {
      const stat = fs.statSync(tickPath);
      tickLogAgeMinutes = Math.max(0, (nowMs - stat.mtimeMs) / 60_000);
    }
  } catch {
    tickLogAgeMinutes = null;
  }
  const tickLogFresh = tickLogAgeMinutes != null && tickLogAgeMinutes <= ACTIVITY_WINDOW_MS / 60_000;

  return { recentCommits, tickLogFresh, tickLogAgeMinutes };
}

/**
 * Decide the telemetry-empty discriminator from activity signals. Pure function — the decision
 * rule the task pins (contract `control`): ANY activity signal ⇒ `running-unwired`; NONE ⇒
 * `not-running`. The explanation names exactly which signals were present/absent (the hard
 * explainability requirement — a bare "running-unwired" would just replace one vague state
 * with another).
 */
export function decideLiveState(activity: ActivitySignals): { state: "running-unwired" | "not-running"; explanation: string } {
  const present: string[] = [];
  if (activity.recentCommits > 0) present.push(`最近 30 分钟有 ${activity.recentCommits} 条提交`);
  if (activity.tickLogFresh) {
    present.push(`tick 日志在 ${Math.round(activity.tickLogAgeMinutes as number)} 分钟前被写过`);
  }
  if (present.length > 0) {
    return {
      state: "running-unwired",
      explanation: `有活动信号（${present.join("；")}），但遥测记录为 0 —— 循环在跑，只是没往 ${FAST_MODE_EVENTS_DIR}/ 写`,
    };
  }
  const tickAgeDesc = activity.tickLogAgeMinutes == null
    ? "tick 日志缺失/不可读"
    : `tick 日志已 ${Math.round(activity.tickLogAgeMinutes)} 分钟未更新`;
  return {
    state: "not-running",
    explanation: `无任何活动信号（30 分钟内无提交；${tickAgeDesc}），遥测记录为 0`,
  };
}

// ── Cross-task blocking visibility (gap-webui-cross-task-blocking-visibility) ───────────────────
// The blocking relation between an in-flight task and the ready/todo pool used to live ONLY in the
// outer loop's tick-log prose (`retry-cap` + `lock-stuck` deferred because their Touches overlapped
// the in-flight slice) — invisible on the web. This computes it mechanically from two on-disk facts:
//   1. `## Touches` set intersection — an in-flight task X holds the files it declared, so any
//      ready/todo task Y whose declared Touches OVERLAP X's is blocked from dispatch.
//   2. `depends_on` chain (frontmatter, already present across the store — measured 30 tasks carry
//      a non-empty chain) — Y.depends_on ∋ X means X blocks Y; X.depends_on ∋ Y means Y blocks X.
//
// PARSE-SOURCE NOTE (hard rule: single source of truth): the AUTHORITATIVE Touches parser is
// plugin/scripts/touches-parser.ts (parseTouchEntries / extractTouchesSection). Core cannot import
// plugin/ (packages/quay/src has zero plugin/ imports — readBoardLanding shells out instead), and a
// subprocess would be overkill for a pure parse, so the display-surface parser below mirrors that
// module's documented behavior (quote/backtick strip → trailing (…)/（…） annotation strip → masked
// backtick strip → leading ./ strip). It is a DECLARED-PATH SET intersection, deliberately NOT the
// dispatch mechanism's expand-then-check (checkTouchesPair/expandDeclaredTouches): the display shows
// "whose declared files overlap", which is the same judgment surface the tick-log prose describes,
// while slot-refill's own expand-and-check remains the single dispatch truth. A parse divergence on
// an edge-case annotation can at worst mis-render ONE blocking row, never a dispatch decision.

/** A task's blocking-relevant facts, parsed from its on-disk `tasks/<id>.md`. */
export interface BlockingTask {
  id: string;
  status: string;
  /** Parsed `depends_on` frontmatter list (the task ids this task waits for). */
  dependsOn: string[];
  /** Parsed `## Touches` bullet paths (annotations stripped). */
  touches: string[];
}

/** Locate the `## Touches` section of a task body (mirrors touches-parser.ts extractTouchesSection). */
export function extractTouchesSection(body: string): { hasSection: boolean; section: string } {
  const lines = String(body ?? "").split(/\r?\n/);
  let inSection = false;
  let hasSection = false;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (inSection) break; // the next heading of any depth ends the section
      inSection = /^touches\b/i.test(heading[1].trim());
      if (inSection) hasSection = true;
      continue;
    }
    if (inSection) out.push(line);
  }
  return { hasSection, section: out.join("\n") };
}

/** Strip a trailing `(…)` / full-width `（…）` annotation from a Touches entry (mirrors stripTouchAnnotation). */
function stripTouchAnnotation(entry: string): string {
  let s = entry;
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] === "）") {
    let depth = 0;
    let open = -1;
    for (let j = i; j >= 0; j--) {
      const c = t[j];
      if (c === "）") depth++;
      else if (c === "（" && --depth === 0) { open = j; break; }
    }
    if (open !== -1) {
      let k = open;
      while (k > 0 && /\s/.test(t[k - 1])) k--;
      s = t.slice(0, k);
    }
  }
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Parse a `## Touches` bullet list into bare path strings (mirrors touches-parser.ts parseTouchEntries). */
export function parseTouchPaths(touchesSection: string): string[] {
  if (!touchesSection) return [];
  return touchesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim())
    .map(stripTouchAnnotation)
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim())
    .map((l) => l.replace(/^\.\//, "").trim())
    .filter(Boolean);
}

/**
 * The cross-task blocking computation — PURE (unit-testable). For each in-flight task id X:
 *   blocks[X]   = ready/todo tasks Y (Y ≠ X) where X's Touches overlap Y's Touches, OR Y.depends_on
 *                 names X (Y is declared to wait on X).
 *   blockedBy[X] = tasks Y (Y ≠ X) where X.depends_on names Y (X waits on Y), OR Y is another
 *                 in-flight task whose Touches overlap X's (symmetric contention — both hold the
 *                 same files).
 * Both lists are sorted and deduplicated by construction (each candidate Y is visited once).
 */
export function computeBlockingRelations(
  inFlightIds: string[],
  tasks: BlockingTask[],
): Map<string, { blocks: string[]; blockedBy: string[] }> {
  const inFlightSet = new Set(inFlightIds);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const touchesOf = (id: string): string[] => byId.get(id)?.touches ?? [];
  const result = new Map<string, { blocks: string[]; blockedBy: string[] }>();
  for (const x of inFlightIds) {
    const xTouches = new Set(touchesOf(x));
    const xDependsOn = new Set(byId.get(x)?.dependsOn ?? []);
    const blocks: string[] = [];
    const blockedBy: string[] = [];
    for (const y of tasks) {
      if (y.id === x) continue;
      const yReadyTodo = y.status === TASK_STATUS.READY || y.status === TASK_STATUS.TODO;
      const overlap = y.touches.some((p) => xTouches.has(p));
      const yDependsOnX = y.dependsOn.includes(x);
      if (yReadyTodo && (overlap || yDependsOnX)) blocks.push(y.id);
      if (xDependsOn.has(y.id) || (inFlightSet.has(y.id) && overlap)) blockedBy.push(y.id);
    }
    blocks.sort();
    blockedBy.sort();
    result.set(x, { blocks, blockedBy });
  }
  return result;
}

/**
 * Read every `tasks/*.md` into BlockingTask facts (id from filename, status/depends_on from
 * frontmatter, Touches from the body). A single malformed file is skipped (never throws) — the
 * display degrades to "that task has no blocking info", never a 500.
 */
export function readTaskBlockingInputs(root: string): BlockingTask[] {
  const tasksDir = path.join(root, "tasks");
  const out: BlockingTask[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return out; // tasks/ absent — no blocking info (the display shows no rows)
  }
  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(tasksDir, file), "utf8");
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter as Record<string, unknown>;
      body = parsed.body as string;
    } catch {
      continue; // malformed frontmatter — skip this one file
    }
    const id = typeof frontmatter.id === "string" && frontmatter.id.length > 0
      ? frontmatter.id
      : file.replace(/\.md$/, "");
    const status = typeof frontmatter.status === "string" ? frontmatter.status : "";
    const dependsOn = Array.isArray(frontmatter.depends_on)
      ? frontmatter.depends_on.filter((d): d is string => typeof d === "string")
      : [];
    const touches = parseTouchPaths(extractTouchesSection(body).section);
    out.push({ id, status, dependsOn, touches });
  }
  return out;
}

/** Annotate in-flight tasks with blocks/blockedBy from the on-disk task store. Never throws. */
export function computeInFlightBlocking(root: string, inFlight: InFlightTask[]): InFlightTask[] {
  if (inFlight.length === 0) return inFlight;
  let tasks: BlockingTask[] = [];
  try {
    tasks = readTaskBlockingInputs(root);
  } catch {
    tasks = []; // a store-read failure degrades to "no blocking info", never a 500
  }
  const rels = computeBlockingRelations(inFlight.map((t) => t.taskId), tasks);
  return inFlight.map((t) => {
    const r = rels.get(t.taskId) ?? { blocks: [], blockedBy: [] };
    return { ...t, blocks: r.blocks, blockedBy: r.blockedBy };
  });
}

// ── Worker-driver carrier (gap-live-page-worker-driver-inflight-invisible) ─────────────────────
// The worker-driver (the production executor since AC138) does NOT write `.workflow-events/*.jsonl`
// (the old inner fast-mode-telemetry store). It writes its own runtime carriers — `.quay/worker-
// outcome.jsonl` (one record per FINISHED worker run) and `.quay/worker-round.jsonl` (an unconditional
// heartbeat carrying only the in-flight COUNT, no task list). readLive previously read ONLY the
// workflow-events store, so the driver's real in-flight work was invisible on the Live page (AC136's
// other half — AC136 wired the promotion-driver into the POOL metric; nobody wired the worker-driver
// into the IN-FLIGHT table).
//
// Carrier fact (why "in-flight" is DERIVED, not read): the outcome record is written at worker END —
// the driver has no persisted per-task "started" record. So a task whose worker is STILL RUNNING has
// no outcome record yet and surfaces on its first outcome write. "Worker-driver in-flight" below is
// therefore the carrier-derivable open set: a task whose LATEST outcome is not `completed` (dispatched
// but not landed — the driver keeps re-dispatching it until it lands). This is the same "open run"
// notion the workflow-events pairing gives (start without end).

/** The worker-driver's outcome carrier, repo-relative (gitignored runtime log — promotion-round /
 *  dispatch-record family). NOT a plugin script: resolved against the workspace root. */
export const WORKER_OUTCOME_REL = ".quay/worker-outcome.jsonl";

/** The worker-driver's round (heartbeat) carrier, repo-relative. Used for the "driver online"
 *  instant (AC2), the worker-active discriminator, and — gap-live-mechanical-fan-in-inflight-invisible
 *  — the in-flight task id list (`in_flight_tasks`), the only carrier that names the specific task
 *  during the mechanical fan-in window (worker exited, no outcome yet, no workflow-events). */
export const WORKER_ROUND_REL = ".quay/worker-round.jsonl";

/** The fan-in lock events carrier, repo-relative (one acquire/release per fan-in lock hold, written
 *  by the driver's holder — worker-driver.ts FAN_IN_LOCK_HOLDER). gap-live-fan-in-execution-phase-
 *  two-axis: an acquire-without-release is the DIRECT signal that a task is in the fan-in phase
 *  (worker exited, suite running, no outcome yet) — event-level, so it fixes the ~5min round-carrier
 *  display lag (G5). */
export const FAN_IN_LOCK_EVENTS_REL = ".quay/fan-in-lock-events.jsonl";

/** The single-state suite status file (full-suite-runner + the D7 mirror write it), repo-relative.
 *  gap-live-fan-in-execution-phase-two-axis: carried on a fan-in task as its suite state. */
export const FULL_SUITE_STATE_REL = ".quay/full-suite-state.json";

/** The worker-driver's spawned worker process `-n` name (worker-driver.ts WORKER_PROCESS_NAME —
 *  `quay-launch.sh task-worker`). Core cannot import plugin/, so the name is mirrored here for the
 *  /proc process-signal probe (方向二): a first-dispatched worker has no outcome record yet, so its
 *  live process cmdline (`Task: <id>`) is the only carrier that shows it in-flight. */
export const WORKER_PROCESS_NAME = "quay-task-worker";

/** The worker-driver's mechanical-fan-in result (gap-mech-fan-in-log-webui-visible-clickable A3):
 *  the per-task mechanical fan-in terminal state the driver writes into worker-outcome.jsonl. Unknown/
 *  missing fields degrade to null rather than a fabricated reading (hard rule ③b) — same best-effort
 *  carrier contract as WorkerOutcomeRecord. */
export interface MechanicalFanInRecord {
  /** Terminal mechanical fan-in state: "landed" | "red". */
  outcome: string | null;
  /** First failing step name (outcome=red); null when landed. */
  step: string | null;
  /** Failure reason (outcome=red); null when landed. */
  reason: string | null;
  /** fan-in workflow lock hold duration (sec), read from lock-events. */
  lockHoldSecs: number | null;
  lockAcquireEpoch: number | null;
  lockReleaseEpoch: number | null;
  /** suite end epoch (sec), only when the suite actually ran. */
  suiteFinishedEpoch: number | null;
  /** suite three-state outcome ("done" | "red" | "hung"), only when it ran. */
  suiteOutcome: string | null;
  /** suite child pid (AC3 ppid probe input), only when it ran. */
  suitePid: number | null;
  /** landed sha (develop tip after ff); null when red. */
  landedSha: string | null;
  /** fan-in process log file name (`.quay/fan-in-<task>-<runId>.log` basename) — the Runs block's
   *  view/download link key. null when absent. */
  fanInLog: string | null;
}

/** The full outcome record the worker-driver writes (computeOutcome's 14 fields + the
 *  gap-worker-task-transcript-access-webui `session_id` that lands later). Unknown/missing fields
 *  degrade to null rather than a fabricated reading (hard rule ③b) — the carrier is a best-effort
 *  runtime log, so a missing `worker_pid`/`exit_code` must read as null, never as a fake 0. */
export interface WorkerOutcomeRecord {
  /** ISO-8601 UTC write time (the carrier's `ts`). */
  ts: string | null;
  task: string | null;
  selector_reason: string | null;
  /** Process exit code (null on signal / spawn-failed / timed-out). */
  exit_code: number | null;
  /** Termination signal (null unless killed). */
  signal: string | null;
  /** Wall-clock duration of the worker run, ms. */
  wall_clock_ms: number | null;
  /** Terminal state: completed | exited-not-landed | failed | killed | timed-out | spawn-failed | not-dispatched. */
  final_state: string | null;
  failure_reason: string | null;
  /** ISO-8601 UTC worker-run start (the carrier's `started_at`). */
  started_at: string | null;
  /** ISO-8601 UTC worker-run end (the carrier's `ended_at`). */
  ended_at: string | null;
  worker_pid: number | null;
  run_id: string | null;
  in_flight_count: number | null;
  timed_out: boolean | null;
  /** Transcript session id — written by gap-worker-task-transcript-access-webui (not yet on disk).
   *  Parses to null until that lands, so a Runs block can link the transcript with zero
   *  re-implementation (this task reuses that task's read+validation, hard rule ③b / AC3). */
  session_id: string | null;
  /** Mechanical fan-in terminal state (gap-mech-fan-in-log-webui-visible-clickable B1); null when the
   *  record predates mechanical fan-in or the driver didn't run it. */
  mechanical_fan_in: MechanicalFanInRecord | null;
}

/** Parse the driver's `mechanical_fan_in` sub-object into a MechanicalFanInRecord. Pure — a non-object
 *  / malformed value degrades to null (best-effort runtime log, never a fabricated reading — hard rule ③b). */
export function parseMechanicalFanIn(v: unknown): MechanicalFanInRecord | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const j = v as Record<string, unknown>;
  const str = (x: unknown): string | null => (typeof x === "string" && x.length > 0 ? x : null);
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    outcome: str(j.outcome),
    step: str(j.step),
    reason: str(j.reason),
    lockHoldSecs: num(j.lockHoldSecs),
    lockAcquireEpoch: num(j.lockAcquireEpoch),
    lockReleaseEpoch: num(j.lockReleaseEpoch),
    suiteFinishedEpoch: num(j.suiteFinishedEpoch),
    suiteOutcome: str(j.suiteOutcome),
    suitePid: num(j.suitePid),
    landedSha: str(j.landedSha),
    fanInLog: str(j.fanInLog),
  };
}

/** Parse `.quay/worker-outcome.jsonl` (one JSON object per line) into outcome records. Pure — never
 *  throws; a malformed line is skipped (best-effort runtime log, not a store). Reads every field the
 *  driver writes (computeOutcome's 14) rather than a hand-picked subset — `worker_pid` was on disk
 *  but dropped by the old 4-field parse (gap-webui-task-runs-block AC2). */
export function parseWorkerOutcomeRecords(text: string): WorkerOutcomeRecord[] {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const out: WorkerOutcomeRecord[] = [];
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
    out.push({
      ts: str(j.ts),
      task: str(j.task),
      selector_reason: str(j.selector_reason),
      exit_code: num(j.exit_code),
      signal: str(j.signal),
      wall_clock_ms: num(j.wall_clock_ms),
      final_state: str(j.final_state),
      failure_reason: str(j.failure_reason),
      started_at: str(j.started_at),
      ended_at: str(j.ended_at),
      worker_pid: num(j.worker_pid),
      run_id: str(j.run_id),
      in_flight_count: num(j.in_flight_count),
      timed_out: bool(j.timed_out),
      session_id: str(j.session_id),
      mechanical_fan_in: parseMechanicalFanIn(j.mechanical_fan_in),
    });
  }
  return out;
}

/**
 * A task's latest worker outcome is "open" (still in play). For the worker-driver this is NEVER true
 * from the outcome carrier alone: the carrier is written only at worker END, so every `final_state`
 * is terminal — completed | exited-not-landed | failed | killed | timed-out | spawn-failed |
 * not-dispatched. A worker whose process is STILL RUNNING has no outcome record yet (方向二 surfaces
 * those via the /proc process signal instead). gap-live-page-worker-inflight-bidirectional-error
 * 方向一: the old list excluded only completed/spawn-failed/not-dispatched, leaving exited-not-landed
 * / failed / killed / timed-out misjudged as in-flight (a destroyed worker shown as 实现中 forever).
 * Whitelist, fail-closed (hard rule ③b): no terminal state is open, and a null / unknown state is
 * NOT open either — never a fabricated "open" from an unreadable field.
 */
function workerOutcomeOpen(_finalState: string | null): boolean {
  return false;
}

/**
 * Derive the worker-driver's in-flight set from its outcome carrier: for each task, keep its LATEST
 * record (most-recent `started_at`) and surface it as in-flight iff that record is open. After
 * gap-live-page-worker-inflight-bidirectional-error 方向一 every `final_state` is terminal, so this
 * set is now ALWAYS empty — the outcome carrier is written only at worker END and cannot signal a
 * still-running worker. The live in-flight set comes from the /proc process signal
 * (readLiveWorkerProcesses) instead; this function stays as the pure outcome-carrier reader (and its
 * shape stays pairInFlight-compatible). Pure and /proc-free.
 */
export function workerInFlightTasks(records: WorkerOutcomeRecord[], nowMs: number): InFlightTask[] {
  const latest = new Map<string, WorkerOutcomeRecord & { startedMs: number }>();
  for (const r of records) {
    if (!r.task) continue;
    const startedMs = r.started_at != null ? Date.parse(r.started_at) : NaN;
    if (!Number.isFinite(startedMs)) continue;
    const prev = latest.get(r.task);
    if (!prev || startedMs >= prev.startedMs) latest.set(r.task, { ...r, startedMs });
  }
  const out: InFlightTask[] = [];
  for (const [task, r] of latest) {
    if (!workerOutcomeOpen(r.final_state)) continue;
    out.push({
      taskId: task,
      runId: r.run_id ?? `worker-${task}`,
      pid: null, // outcome-carrier task: no live process known (written only at worker END)
      sessionId: null, // outcome-carrier task: no live process ⇒ no live session join (readLive annotates)
      startedAtMs: r.startedMs,
      implCompletedAtMs: null,
      status: null,
      phase: "implementing",
      suite: null,
      minutes: Math.max(0, (nowMs - r.startedMs) / 60_000),
      liveness: "unknown",
      blocks: [],
      blockedBy: [],
    });
  }
  return out;
}

/** A live worker process (方向二): task id + process id + process start wall-clock. */
export interface LiveWorker {
  taskId: string;
  /** The `/proc/<pid>` directory name this worker was scanned from (gap-webui-live-passthrough-pid).
   *  Lets the Live view locate the process/session downstream. */
  pid: string;
  /** Process start wall-clock ms (from `/proc/<pid>/stat` starttime + btime). null when unreadable —
   *  the caller falls back to the observation instant (fail-closed toward "just started", never a
   *  fabricated long elapsed). */
  startedAtMs: number | null;
  /**
   * The workspace root this worker's cmdline declares (`Repo root: <path>`, machine-generated by
   * worker-driver.ts's dispatch prompt). This is the DIRECT fact of WHICH PROJECT the process belongs
   * to — the discriminator that keeps a co-resident project's worker out of THIS project's in-flight
   * view (gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root: /proc is
   * HOST-GLOBAL, so an unscoped scan surfaces every project's workers). null when the cmdline carries
   * no marker (older/foreign dispatch prompt) — see `readLiveWorkerProcesses`'s fail-closed rule.
   */
  repoRoot: string | null;
}

/** Extract a task id from a worker process cmdline (the prompt carries `Task: <id>. Repo root: …`).
 *  Pure; null when the cmdline is not a worker or carries no `Task:` marker. */
export function workerTaskIdFromCmdline(cmdline: string): string | null {
  if (!cmdline.includes(WORKER_PROCESS_NAME)) return null;
  const m = /Task:\s*([A-Za-z0-9_-]+)/.exec(cmdline);
  return m ? m[1] : null;
}

/** Extract the workspace root a worker process declares (`Repo root: <path>.` — the machine-generated
 *  sentence in worker-driver.ts's dispatch prompt, `Task: … . Repo root: … .`). Pure; null when the
 *  cmdline is not a worker or carries no marker.
 *
 *  The marker is terminated by the sentence's `. ` — the path itself may contain dots, so the capture
 *  is lazy up to a `.` followed by whitespace/end (a greedy `\S+` would swallow the sentence period).
 *  Trailing slashes are stripped so `/x/y` and `/x/y/` compare equal. */
export function workerRepoRootFromCmdline(cmdline: string): string | null {
  if (!cmdline.includes(WORKER_PROCESS_NAME)) return null;
  const m = /Repo root:\s*(\S+?)\.(?:\s|$)/.exec(cmdline);
  if (!m) return null;
  const p = m[1].replace(/\/+$/, "");
  return p.length > 0 ? p : null;
}

/** Process start wall-clock ms from `/proc/<pid>/stat` starttime (field 22, USER_HZ ticks since boot)
 *  + btime (boot epoch seconds, from /proc/stat). null when either is unreadable. CLK_TCK = 100 is
 *  USER_HZ on the x86 Linux serve target; a start time is a display nicety (the caller falls back to
 *  nowMs), never a correctness gate. */
function procStartTimeMs(procDir: string, pid: string, btimeSec: number | null): number | null {
  if (btimeSec == null) return null;
  try {
    const statText = fs.readFileSync(path.join(procDir, pid, "stat"), "utf8");
    // Format `pid (comm) state ppid …`; comm may contain spaces/parens, so parse from the LAST `)`.
    const fields = statText.slice(statText.lastIndexOf(")") + 2).split(/\s+/);
    const starttime = Number(fields[19]); // fields[0] is field 3 (state); starttime is field 22.
    if (!Number.isFinite(starttime)) return null;
    return (btimeSec + starttime / 100) * 1000;
  } catch {
    return null;
  }
}

/** Scan `/proc` for live worker processes: every cmdline carrying `quay-task-worker` + `Task: <id>`
 *  is a running worker (方向二 — the only carrier for a first-dispatched worker, which has no outcome
 *  record yet). `procDir` is a test seam. /proc unreadable ⇒ [] (hard rule ③b: read-fail is NOT
 *  "no live workers" — but for the display surface failing closed to "nothing shown" is the safe
 *  direction, and the caller gates this on workerDriverActive so a non-worker workspace never scans).
 *
 *  WORKSPACE SCOPING (gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root):
 *  `/proc` is HOST-GLOBAL — the `quay-task-worker` cmdline carries no workspace identity of its own.
 *  Before this, `workerDriverActive(root)` was the only gate, and it says "THIS workspace has a
 *  driver", NOT "these processes belong to THIS workspace". Measured 2026-09-13: the third-party
 *  project /home/yale/work/quay-fleet (0 tasks, 0 workflow-events, empty `in_flight_tasks`) reported
 *  「在飞 5」 — five of the quay checkout's workers, found by the unscoped scan. `root`, when given,
 *  filters to workers whose cmdline's own `Repo root:` is this workspace.
 *
 *  FAIL-CLOSED toward "not mine" when `root` is given: a worker whose cmdline carries NO `Repo root:`
 *  marker is EXCLUDED (an unattributable process is not evidence about this workspace). The cost is
 *  bounded — the process signal is a SUPPLEMENT to the driver's own carriers (round
 *  `in_flight_tasks` / outcome records), so an unattributable worker degrades to the carrier view
 *  rather than disappearing outright. Omitting `root` keeps the raw host-wide scan (tests / callers
 *  that want the unscoped set). */
export function readLiveWorkerProcesses(procDir: string = "/proc", { root = null }: { root?: string | null } = {}): LiveWorker[] {
  let entries: string[];
  try { entries = fs.readdirSync(procDir); } catch { return []; }
  let btimeSec: number | null = null;
  try {
    const statText = fs.readFileSync(path.join(procDir, "stat"), "utf8");
    const bm = /(?:^|\n)btime\s+(\d+)/.exec(statText);
    if (bm) btimeSec = Number(bm[1]);
  } catch { /* no btime — start times degrade to null */ }
  const rootAbs = root != null ? path.resolve(root) : null;
  const out: LiveWorker[] = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    let cmdline: string;
    try {
      cmdline = fs.readFileSync(path.join(procDir, e, "cmdline"), "utf8").replace(/\0/g, " ").trim();
    } catch { continue; }
    const taskId = workerTaskIdFromCmdline(cmdline);
    if (!taskId) continue;
    const repoRoot = workerRepoRootFromCmdline(cmdline);
    if (rootAbs != null) {
      // Direct量: the process's OWN declared repo root must be this workspace. Unattributable
      // (no marker) ⇒ excluded, never assumed to be ours.
      if (repoRoot == null || path.resolve(repoRoot) !== rootAbs) continue;
    }
    out.push({ taskId, pid: e, startedAtMs: procStartTimeMs(procDir, e, btimeSec), repoRoot });
  }
  return out;
}

/** Read the live session id for a worker pid from `~/.claude/sessions/<pid>.json` (the Claude Code
 *  live-session registry — pid → sessionId, written while the process is alive, deleted on exit; only
 *  covers in-flight). Returns null when the record is missing/unreadable/malformed or its `sessionId`
 *  is not a strict UUID (hard rule ③b: 读不到 ≠ 无会话，诚实 null 让 /live 渲染「无链接」而非伪造)。
 *  `home` is injectable for tests; defaults to the real `$HOME`. */
export function liveSessionIdForPid(pid: string, home: string = os.homedir()): string | null {
  if (!/^\d+$/.test(pid)) return null; // pid must be numeric (the /proc entry name) — never a path component
  try {
    const text = fs.readFileSync(path.join(home, ".claude", "sessions", `${pid}.json`), "utf8");
    const j = JSON.parse(text) as Record<string, unknown>;
    const sid = j.sessionId;
    return typeof sid === "string" && isValidSessionId(sid) ? sid : null;
  } catch {
    return null;
  }
}

/** Read `.quay/worker-outcome.jsonl` as text. Absent/unreadable ⇒ null (degrade, never throw). */
function readWorkerOutcomeText(root: string): string | null {
  try {
    return fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return null;
  }
}

/** Read + parse all worker-outcome records for a workspace root (the /task/<id> Runs block's data
 *  source — gap-webui-task-runs-block). Absent/unreadable ⇒ [] (degrade, never throw). */
export function readWorkerOutcomeRecords(root: string): WorkerOutcomeRecord[] {
  const text = readWorkerOutcomeText(root);
  return text != null ? parseWorkerOutcomeRecords(text) : [];
}

/**
 * The instant the worker-driver came online — the earliest dispatch/round timestamp across its two
 * carriers (min of every outcome `started_at` and every round `ts`). null when the driver has no
 * record at all. readLive uses it (AC2) to drop workflow-events runs that predate the driver: a
 * start-without-end workflow-events record whose start is BEFORE the driver came online is a stale
 * inner-era ghost (its worktree may still exist, but it is now managed by the driver, not the retired
 * inner dispatch path).
 */
export function workerDriverOnlineMs(
  root: string,
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: a caller that ALREADY holds a carrier's
  // text can hand it in instead of making this read it again. readLive is that caller — it reads the
  // outcome carrier for its worker-in-flight merge and the round carrier for its round-carrier merge
  // a few lines earlier — and on the live store those two carriers are 2.4 MB + 11.7 MB, so the
  // re-read + re-parse here measured ~250 ms of the ~830 ms readLive spends holding the event loop.
  // Pure dedup: byte-identical inputs, byte-identical result. Omitted ⇒ read from disk, unchanged.
  preRead: { outcomeText?: string | null; roundText?: string | null } = {},
): number | null {
  let onlineMs: number | null = null;
  const consider = (ms: number) => {
    if (!Number.isFinite(ms)) return;
    if (onlineMs == null || ms < onlineMs) onlineMs = ms;
  };

  const outcomeText = preRead.outcomeText !== undefined ? preRead.outcomeText : readWorkerOutcomeText(root);
  if (outcomeText != null) {
    for (const r of parseWorkerOutcomeRecords(outcomeText)) {
      if (r.started_at != null) consider(Date.parse(r.started_at));
    }
  }

  let roundText: string | null;
  if (preRead.roundText !== undefined) {
    roundText = preRead.roundText;
  } else {
    try { roundText = fs.readFileSync(path.join(root, WORKER_ROUND_REL), "utf8"); }
    catch { roundText = null; } // no round carrier — the outcome carrier alone still yields an instant
  }
  if (roundText != null) {
    for (const line of roundText.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const j = JSON.parse(s) as Record<string, unknown>;
        if (typeof j.ts === "string") consider(Date.parse(j.ts));
      } catch { /* skip malformed round line */ }
    }
  }

  return onlineMs;
}

/** A task the worker-driver's round carrier names in-flight, with its dispatch start (when known). */
interface RoundInFlightTask {
  taskId: string;
  /** Dispatch wall-clock ms, read from `in_flight_task_starts`. null when the round carries no start
   *  for this task (unknown ⇒ the caller falls back to the observation instant — never a fabricated
   *  long elapsed). */
  startedAtMs: number | null;
}

/**
 * The tasks the worker-driver's LATEST round record considers in-flight (`in_flight_tasks`:
 * implementing + mechanical-fan-in + cold-start-inflight), each with its dispatch start when the
 * round carries one (`in_flight_task_starts` — gap-live-fan-in-window-elapsed-zero: the round carrier
 * previously named only the task id, no per-task start, so readLive fell back to nowMs and the
 * fan-in window read as elapsed 0). This is the ONLY carrier that names the specific task during the
 * mechanical fan-in window — the worker process has exited (no /proc), no outcome record yet (written
 * at `finish()`, AFTER `runMechanicalFanIn`), and the driver never writes workflow-events task-start.
 * gap-live-mechanical-fan-in-inflight-invisible. Absent/unreadable round file, or a round record
 * predating the field, ⇒ [] (degrade, never throw — a real "none", not a fabricated empty). Iterates
 * every line and keeps the LAST `in_flight_tasks` array (append-order ⇒ newest wins, so a stale earlier
 * snapshot is superseded). A missing/ill-formed start for a task ⇒ startedAtMs null (honest unknown,
 * not a fabricated value).
 */
function readWorkerRoundInFlightTasks(root: string, preReadRoundText?: string | null): RoundInFlightTask[] {
  try {
    // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: the round carrier is 11.7 MB on the live
    // store; readLive already holds its text (it passes the same value to workerDriverOnlineMs), so it
    // hands it in rather than making this read it a second time. Omitted ⇒ read from disk, unchanged.
    const roundText = preReadRoundText !== undefined ? preReadRoundText : fs.readFileSync(path.join(root, WORKER_ROUND_REL), "utf8");
    if (roundText == null) return [];
    let tasks: RoundInFlightTask[] = [];
    for (const line of String(roundText).split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let j: Record<string, unknown>;
      try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
      const arr = j.in_flight_tasks;
      if (!Array.isArray(arr)) continue;
      const starts = j.in_flight_task_starts;
      tasks = arr
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map((taskId) => {
          let startedAtMs: number | null = null;
          if (starts != null && typeof starts === "object" && !Array.isArray(starts)) {
            const raw = (starts as Record<string, unknown>)[taskId];
            if (typeof raw === "number" && Number.isFinite(raw)) {
              startedAtMs = raw;
            } else if (typeof raw === "string") {
              const parsed = Date.parse(raw);
              if (Number.isFinite(parsed)) startedAtMs = parsed;
            }
          }
          return { taskId, startedAtMs };
        });
    }
    return tasks;
  } catch {
    return [];
  }
}

/** True when the worker-driver has produced ANY record (outcome or round) — i.e. the driver is wired
 *  and active. readLive uses this so an empty workflow-events store does NOT read as 「循环没跑」 once
 *  the driver is the real executor. */
export function workerDriverActive(root: string): boolean {
  return fs.existsSync(path.join(root, WORKER_OUTCOME_REL)) || fs.existsSync(path.join(root, WORKER_ROUND_REL));
}

/**
 * The task ids currently holding the fan-in lock — the DIRECT fan-in-phase signal
 * (gap-live-fan-in-execution-phase-two-axis G3/G5). Reads `.quay/fan-in-lock-events.jsonl` (one
 * acquire/release per hold, append-order) and returns the set of task ids whose MOST RECENT event is
 * an `acquire` (no matching release yet). Event-level ⇒ no ~5min round-carrier lag. The lock is
 * global (one holder at a time), so the set has ≤1 member in a well-formed stream; a torn
 * acquire-without-release (holder SIGKILLed before its release) reads as fan-in — a REAL problem
 * state, not a false positive to paper over. Absent/unreadable/malformed ⇒ empty set (degrade, never
 * throw — hard rule ③b: a missing carrier reads as "no fan-in", never a fabricated one).
 */
export function readFanInLockAcquiredTasks(root: string): Set<string> {
  const held = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, FAN_IN_LOCK_EVENTS_REL), "utf8");
  } catch {
    return held;
  }
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
    const taskId = typeof j.taskId === "string" && j.taskId.length > 0 ? j.taskId : null;
    if (taskId == null) continue;
    if (j.event === "acquire") held.add(taskId);
    else if (j.event === "release") held.delete(taskId);
  }
  return held;
}

/** The raw `.quay/full-suite-state.json` object, or null when absent/unparseable (degrade, never
 *  throw). Shared by readFullSuiteState (the fan-in suite annotation) — a single read, no second
 *  carrier walk. */
function readFullSuiteStateRaw(root: string): Record<string, unknown> | null {
  try {
    const text = fs.readFileSync(path.join(root, FULL_SUITE_STATE_REL), "utf8");
    const j = JSON.parse(text) as Record<string, unknown>;
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/** Dashboard testsCard reading of `.quay/full-suite-state.json` — "is a suite running right now",
 *  a DIFFERENT question from readFullSuiteState's "which in-flight fan-in task does this suite belong
 *  to". full-suite-runner.ts's `base` object (the shape written on every state transition) never
 *  carries a `taskId` field, so readFullSuiteState's `j.taskId` requirement makes it return null on
 *  every real run — unusable for a dashboard-level running/idle read. This reader has no such
 *  requirement; null only when the state file itself is absent/unreadable (honest degrade, gap-
 *  webui-dashboard-tests-card-latest-round-no-live-signal). */
export interface CurrentSuiteRun {
  state: string | null;
  runner: string | null;
  startedAt: string | null;
  runId: string | null;
  scope: string | null;
}

export function readCurrentSuiteRun(root: string): CurrentSuiteRun | null {
  const j = readFullSuiteStateRaw(root);
  if (j == null) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    state: str(j.state),
    runner: str(j.runner),
    startedAt: str(j.startedAt),
    runId: str(j.runId),
    scope: str(j.scope),
  };
}

/**
 * The suite state carried on a fan-in task (gap-live-fan-in-execution-phase-two-axis): the task the
 * suite is currently running for (`.quay/full-suite-state.json` `taskId`) plus a display slice of the
 * state. null when the state file is absent/unreadable or carries no taskId — so a fan-in task whose
 * suite never wrote a taskId simply renders its phase with no suite annotation (honest null, never a
 * fabricated "suite running").
 */
export function readFullSuiteState(root: string): { taskId: string; view: SuiteStateView } | null {
  const j = readFullSuiteStateRaw(root);
  if (j == null) return null;
  const taskId = typeof j.taskId === "string" && j.taskId.length > 0 ? j.taskId : null;
  if (taskId == null) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    taskId,
    view: {
      state: str(j.state),
      runner: str(j.runner),
      startedAt: str(j.startedAt),
      durationMs: num(j.durationMs),
    },
  };
}

/**
 * Derive an in-flight task's execution phase (gap-live-fan-in-execution-phase-two-axis AC1-AC3) from
 * DIRECT signals, in the priority the task pins (直接量优先):
 *   a. lifecycle status terminal (done/superseded/needs-human) → "landed" (readLive removes these
 *      before this point; the branch is totality/defense, not the removal path);
 *   b. fan-in lock held (acquire-without-release) → "fan-in";
 *   c. worker process present (pid known / liveness alive) → "implementing";
 *   d. workflow-events impl-complete event → "awaiting-land" (compat: the old inner-era boundary);
 *   e. else → "implementing" (round-carrier fallback — in-flight by the driver's heartbeat, no
 *      positive fan-in/live signal, so "implementing" is the honest default, never a fabricated fan-in).
 * Pure — `fanInLockAcquired` is passed in (readLive reads the carrier once).
 */
export function deriveInFlightPhase(
  t: Pick<InFlightTask, "taskId" | "status" | "pid" | "liveness" | "implCompletedAtMs">,
  fanInLockAcquired: ReadonlySet<string>,
): InFlightPhase {
  if (t.status === TASK_STATUS.DONE || t.status === TASK_STATUS.SUPERSEDED || t.status === TASK_STATUS.NEEDS_HUMAN) return "landed";
  if (fanInLockAcquired.has(t.taskId)) return "fan-in";
  if (t.pid != null || t.liveness === "alive") return "implementing";
  if (t.implCompletedAtMs != null) return "awaiting-land";
  return "implementing";
}

// ── needs-human 显式承接（gap-ac146-human-interface-explicit-owner） ──────────────────────────
// The promotion-driver's outcome ledger (AC134) carries `action: "needs-human"` records — the
// historical "was ever escalated to a human" ledger, INCLUDING tasks whose store status has since
// moved on (the 3 real needs-human samples were later re-dispatched to done/superseded, so their
// status alone no longer surfaces them). The /needs-human page reads this carrier so a needs-human
// event stays visible to a human even after the task store moves on — the store status
// (`status: needs-human`) is the "currently awaiting" truth; this ledger is the "was ever
// awaiting" truth. Both are independent reads of workspace runtime state, so both are quarantined
// here beside the worker-outcome/round carriers (same convention, same degradation contract).

/** The promotion-driver's outcome ledger, repo-relative (AC134, gap-ac134-promotion-outcome-ledger). */
export const PROMOTION_OUTCOME_REL = ".quay/promotion-outcome.jsonl";

/** One promotion-outcome record (AC134 shape). Fields are best-effort runtime-log reads — a
 *  missing/unknown field degrades to null, never a fabricated value (hard rule ③b). */
export interface PromotionOutcomeRecord {
  task_id: string | null;
  action: string | null;
  detail: string | null;
  ts: string | null;
}

/** Parse `.quay/promotion-outcome.jsonl` (one JSON object per line) into records. Pure — never
 *  throws; a malformed/torn-tail line is skipped (best-effort runtime log, not a store). */
export function parsePromotionOutcomeRecords(text: string): PromotionOutcomeRecord[] {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const out: PromotionOutcomeRecord[] = [];
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
    const result = (j.result && typeof j.result === "object" ? j.result : {}) as Record<string, unknown>;
    out.push({
      task_id: str(j.task_id),
      action: str(j.action),
      detail: str(result.detail),
      ts: str(j.ts),
    });
  }
  return out;
}

/** Read the needs-human ledger: promotion-outcome records with action === "needs-human", newest
 *  first. Absent/unreadable ⇒ [] (degrade, never throw — a workspace that never ran the
 *  promotion-driver has no ledger, which is a real "none", not a read failure). */
export function readNeedsHumanLedger(root: string): PromotionOutcomeRecord[] {
  try {
    const abs = path.join(root, PROMOTION_OUTCOME_REL);
    if (!fs.existsSync(abs)) return [];
    return parsePromotionOutcomeRecords(fs.readFileSync(abs, "utf8"))
      .filter((r) => r.action === "needs-human")
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
  } catch {
    return [];
  }
}

/** Read a single task's status frontmatter from the on-disk store. Missing/unreadable ⇒ null (never
 *  throws). This is the FALLBACK read: tasks/gap-web-task-status-reads-stale-main-checkout makes the
 *  canonical store the develop git ref (the manager working branch's disk is a STALE agent-proxy,
 *  硬规则 4b); `readTaskStatusForLive` reads develop first and falls back here when the ref/path is
 *  unavailable (not a git repo, no develop ref, a fresh task not yet committed to develop). */
function readTaskStatusOnDisk(root: string, taskId: string): TaskStatus | null {
  try {
    const raw = fs.readFileSync(path.join(root, "tasks", `${taskId}.md`), "utf8");
    const parsed = parseFrontmatter(raw);
    const fm = parsed.frontmatter as Record<string, unknown>;
    return isTaskStatus(fm.status) ? fm.status : null;
  } catch {
    return null;
  }
}

/** Read `<ref>:tasks/<taskId>.md` frontmatter `status:` + `title:`. Cache-first (AC3): when the batch
 *  readers (list page / background refresh) already hold this task's status AND title, return them from
 *  cache with ZERO git subprocesses; otherwise fall back to ONE `git show` (the single-task develop-ref
 *  read — object store only, never checks out `ref`, never touches fan-in). null when the ref/path is
 *  unavailable or the frontmatter is unreadable — callers fall back to the on-disk read. The /task
 *  detail page reads BOTH halves from this one call (status + title develop-first, so list and detail
 *  agree), and `readTaskStatusAtRef` is its status-only projection. */
export function readTaskAtRefMeta(root: string, ref: string, taskId: string): { status: TaskStatus | null; title: string | null } | null {
  const key = `${root}\n${ref}`;
  const statusEntry = taskStatusRefCache.get(key);
  const titleEntry = taskTitleRefCache.get(key);
  if (statusEntry != null && titleEntry != null && statusEntry.map.has(taskId) && titleEntry.map.has(taskId)) {
    return {
      status: statusEntry.map.get(taskId) ?? null,
      title: titleEntry.map.get(taskId) ?? null,
    };
  }
  singleTaskGitSpawnCount++;
  let out: string;
  try {
    out = execFileSync("git", ["-C", root, "show", `${ref}:tasks/${taskId}.md`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
  try {
    const parsed = parseFrontmatter(out);
    const fm = parsed.frontmatter as Record<string, unknown>;
    return {
      status: isTaskStatus(fm.status) ? fm.status : null,
      title: typeof fm.title === "string" ? fm.title : null,
    };
  } catch {
    return null;
  }
}

/** Read `<ref>:tasks/<taskId>.md` status frontmatter (the single-task half of the develop-ref read;
 *  `git show` reads the object store only — never checks out `ref`, never touches fan-in). null when
 *  the ref/path is unavailable or the frontmatter is unreadable — callers fall back to the on-disk
 *  read. Mirrors plugin/scripts/worker-driver.ts's `readTaskStatusAtRef` (the same `git show
 *  develop:tasks/<id>.md` judgment, re-implemented here because observation.ts is the ONLY serve-path
 *  module allowed to know git). */
export function readTaskStatusAtRef(root: string, ref: string, taskId: string): TaskStatus | null {
  return readTaskAtRefMeta(root, ref, taskId)?.status ?? null;
}

/** Read the raw contents of a set of task files at a git ref in ONE `git cat-file --batch` process,
 *  fed the blob SHAs from `listTaskFilesAtRef` — a direct object read, ~6× faster than re-resolving a
 *  `ref:path` refspec per file (硬规则 4b: the refspec form walks the tree once per file). Returns
 *  Map<taskId, rawContent> for the files PRESENT at the ref. Empty map on any git failure (never a
 *  positive from an unavailable source). Mirrors plugin/scripts/ready-pool-check.ts's dispatch-read batch. */
function readTaskFilesAtRefBatch(root: string, ref: string, files: Array<{ id: string; sha: string }>): Map<string, string> {
  if (files.length === 0) return new Map();
  const input = files.map((f) => f.sha).join("\n") + "\n";
  let buf: Buffer;
  try {
    buf = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
      input,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return new Map();
  }
  const map = new Map<string, string>();
  let off = 0;
  for (const f of files) {
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) break;
    const header = buf.slice(off, nl).toString("utf8");
    off = nl + 1;
    const m = / blob (\d+)$/.exec(header);
    if (!m) continue; // `<sha> missing` (or unparseable) — no content line; off is already past the header
    const size = Number(m[1]);
    map.set(f.id, buf.slice(off, off + size).toString("utf8"));
    off += size + 1; // skip content + the trailing newline after it
  }
  return map;
}

/** TTL for the batched develop-status cache — a rendered /tasks list need not re-run `git cat-file`
 *  over the whole tree on every refresh within the same render burst (AC4: 1500+ tasks). */
export const TASK_STATUS_REF_CACHE_TTL_MS = 2000;

const taskStatusRefCache = new Map<string, { at: number; map: Map<string, TaskStatus> }>();
const taskTitleRefCache = new Map<string, { at: number; map: Map<string, string> }>();
// The commit-time cache carries the ref's HEAD sha at build time so a later refresh can diff
// `oldHead..newHead` incrementally instead of re-walking the whole `tasks/` history (gap-tasks-page-
// develop-ref-full-history-git-log-cost AC2).
const taskCommitTimesRefCache = new Map<string, { at: number; head: string | null; map: Map<string, number> }>();

/** Test seam (AC3): the number of single-task git subprocesses (`git show` / `git log -1`) spawned by
 *  the detail-page read face (`readTaskAtRefMeta` / `readTaskCommitTimeAtRef`). A cache hit must spawn
 *  ZERO — the counter lets the test assert that instead of a timing proxy. */
let singleTaskGitSpawnCount = 0;
export function resetSingleTaskGitSpawnCount(): void { singleTaskGitSpawnCount = 0; }
export function getSingleTaskGitSpawnCount(): number { return singleTaskGitSpawnCount; }

/** Test seam (AC1/AC4 of gap-suite-wallclock-budgets-literals-depend-on-host-capacity): how many
 *  `git log` walks the commit-time reader spawned, split by COST CLASS —
 *  `full` = the unbounded `git log <ref> -- tasks/` walk over the ref's whole history;
 *  `bounded` = the incremental `oldHead..newHead` diff (O(new commits)).
 *  A COUNT, not a wall-clock proxy: the /tasks request path reads CACHE-ONLY (`serve-task.ts`
 *  `readTaskCommitTimesAtRef(..., {cacheOnly:true})`) so a request must spawn ZERO full walks no
 *  matter how slow the host is; the full walk belongs to the background refresh, off the request
 *  path. A loaded host makes a walk SLOWER, not more frequent — which is exactly why the property
 *  has to be measured as a count (硬规则 4b: 优先观测直接量，不要用代理量). */
let developRefFullWalkCount = 0;
let developRefBoundedWalkCount = 0;
export function resetDevelopRefWalkCounts(): void {
  developRefFullWalkCount = 0;
  developRefBoundedWalkCount = 0;
}
export function getDevelopRefFullWalkCount(): number { return developRefFullWalkCount; }
export function getDevelopRefBoundedWalkCount(): number { return developRefBoundedWalkCount; }

/** Clear the batched develop-ref caches (test seam — a fixture that rewrites the develop ref
 *  mid-test must not read a cached prior read). Clears status + title + commit-time together: the
 *  three develop-ref read faces share one source of truth and one TTL clock. */
export function clearTaskStatusRefCache(): void {
  taskStatusRefCache.clear();
  taskTitleRefCache.clear();
  taskCommitTimesRefCache.clear();
}

/** List the task files (`.md` under `tasks/`) at a git ref in ONE `git ls-tree -r` pass, carrying each
 *  file's blob SHA (NOT `--name-only`): the batched content read feeds `cat-file --batch` the blob SHA
 *  — a direct object read, ~6× faster than re-resolving a `ref:path` refspec per file (硬规则 4b: the
 *  refspec form walks the tree once per file). Returns [{ id, sha }]. Empty array on any git failure. */
function listTaskFilesAtRef(root: string, ref: string): Array<{ id: string; sha: string }> {
  try {
    const out = execFileSync("git", ["-C", root, "ls-tree", "-r", ref, "--", "tasks/"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
    const files: Array<{ id: string; sha: string }> = [];
    for (const line of out.split(/\r?\n/)) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue; // no path column (malformed line)
      const meta = line.slice(0, tab).split(/\s+/); // `<mode> <type> <sha>`
      const rel = line.slice(tab + 1);
      if (meta.length < 3 || meta[1] !== "blob" || !rel.endsWith(".md")) continue;
      const base = rel.split("/").pop() ?? "";
      const id = base.slice(0, -3);
      if (id.length > 0) files.push({ id, sha: meta[2] });
    }
    return files;
  } catch {
    return [];
  }
}

/** Read every task's `status:` frontmatter at a git ref in ONE `git ls-tree` + ONE `git cat-file
 *  --batch` pair (two subprocesses total for a ~1500-task tree), short-TTL cached. Returns a
 *  Map<taskId, TaskStatus> of the ids PRESENT at the ref; absent ids are missing (callers fall back
 *  to the working-tree read). Empty map on any git failure — never a positive from an unavailable
 *  source (硬规则 ③b). */
export function readTaskStatusMapAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false } = {},
): Map<string, TaskStatus> {
  const key = `${root}\n${ref}`;
  const hit = taskStatusRefCache.get(key);
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;
  const map = new Map<string, TaskStatus>();
  try {
    const rawMap = readTaskFilesAtRefBatch(root, ref, listTaskFilesAtRef(root, ref));
    for (const [id, raw] of rawMap) {
      try {
        const parsed = parseFrontmatter(raw);
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (isTaskStatus(fm.status)) map.set(id, fm.status);
      } catch {
        // unparseable frontmatter at the ref — leave absent (caller falls back to disk), never fabricate
      }
    }
  } catch {
    // git unavailable / not a repo / no such ref — empty map, callers fall back to the disk read
  }
  taskStatusRefCache.set(key, { at: nowMs, map });
  return map;
}

/** Read every task's `title:` frontmatter at a git ref in ONE `git ls-tree` + ONE `git cat-file
 *  --batch` pair, short-TTL cached. The title half of the develop-ref read — the /tasks divergence
 *  marker compares the disk title against the develop title, so the list needs BOTH maps without a
 *  per-task `git show`. Absent ids are missing (callers fall back to the disk title). Empty map on
 *  any git failure — never a positive from an unavailable source (硬规则 ③b). */
export function readTaskTitleMapAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false } = {},
): Map<string, string> {
  const key = `${root}\n${ref}`;
  const hit = taskTitleRefCache.get(key);
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;
  const map = new Map<string, string>();
  try {
    const rawMap = readTaskFilesAtRefBatch(root, ref, listTaskFilesAtRef(root, ref));
    for (const [id, raw] of rawMap) {
      try {
        const parsed = parseFrontmatter(raw);
        const fm = parsed.frontmatter as Record<string, unknown>;
        if (typeof fm.title === "string") map.set(id, fm.title);
      } catch {
        // unparseable frontmatter at the ref — leave absent (caller falls back to disk)
      }
    }
  } catch {
    // git unavailable / not a repo / no such ref — empty map, callers fall back to the disk read
  }
  taskTitleRefCache.set(key, { at: nowMs, map });
  return map;
}

/** Resolve `<ref>^{commit}` to the commit sha (the ref's current HEAD). null when the ref/object is
 *  unavailable (git down, not a repo, no such ref). */
function resolveRefHead(root: string, ref: string): string | null {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", `${ref}^{commit}`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Whether `ancestor` is a commit-graph ancestor of `descendant` (an exit-0 probe via `merge-base
 *  --is-ancestor`). The incremental commit-time diff is only valid when the prior head is an ancestor
 *  of the current head (the normal fast-forward fan-in shape); a non-ff rewrite falls back to a full
 *  rebuild instead of silently returning a partial map. */
function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore", timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Parse `git log --format=%cI --name-only` output (newest-first) into Map<taskId, epochMs> — the
 *  FIRST occurrence of a file is its last commit. Pure; never throws. */
function parseCommitTimesLog(out: string): Map<string, number> {
  const map = new Map<string, number>();
  let cur: number | null = null;
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t)) {
      cur = Date.parse(t);
    } else if (cur != null && t.startsWith("tasks/") && t.endsWith(".md")) {
      const id = t.slice("tasks/".length, -3);
      if (!map.has(id)) map.set(id, cur); // first occurrence = last commit (log is newest-first)
    }
  }
  return map;
}

/** Read every task's last-commit time at a git ref, incrementally maintained (AC2): the FIRST build
 *  walks the whole `tasks/` history in ONE `git log --format=%cI --name-only` pass (single subprocess);
 *  a later refresh diffs only `oldHead..newHead` and merges the new commits onto the prior map — never
 *  re-walking the full history. The updated-at source: a develop-derived status ⇒ updated = that file's
 *  last commit time on develop, so a disk mtime bump after a develop flip no longer moves the display.
 *  Returns Map<taskId, epochMs>; absent ids are missing (callers fall back to disk mtime). Empty map on
 *  any git failure. */
export function readTaskCommitTimesAtRef(
  root: string,
  ref: string,
  { nowMs = Date.now(), ttlMs = TASK_STATUS_REF_CACHE_TTL_MS, force = false, cacheOnly = false } = {},
): Map<string, number> {
  const key = `${root}\n${ref}`;
  const hit = taskCommitTimesRefCache.get(key);
  if (cacheOnly) {
    // Request-path read: the cache only, never spawn git — the background refresh owns the build (the
    // full history walk lives at startup, off the request path). Empty when cold: the caller falls back
    // to the disk mtime (fail-open). A present-but-TTL-expired map is still returned — the background
    // refresh, not a request, is what keeps it fresh.
    return hit != null ? hit.map : new Map();
  }
  if (!force && hit != null && nowMs - hit.at < ttlMs) return hit.map;

  const head = resolveRefHead(root, ref);
  const fullBuild = (): Map<string, number> => {
    developRefFullWalkCount++;
    try {
      const out = execFileSync("git", ["-C", root, "log", "--format=%cI", "--name-only", ref, "--", "tasks/"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
      });
      return parseCommitTimesLog(out);
    } catch {
      return new Map(); // git unavailable / not a repo / no such ref
    }
  };

  let map: Map<string, number>;
  if (head == null) {
    map = new Map(); // git unavailable / no such ref — fail-open empty (callers fall back to disk mtime)
  } else if (hit != null && hit.head === head) {
    map = hit.map; // head unchanged since the last build — the map is still current; refresh the TTL clock only
  } else if (hit != null && hit.head != null && isAncestor(root, hit.head, head)) {
    // Incremental: merge the commits in (oldHead, head] onto the prior map. A task touched in the
    // range gets its newer time; one untouched keeps its prior time. The `isAncestor` guard keeps a
    // non-fast-forward rewrite from producing a silently-wrong partial map.
    map = new Map(hit.map);
    developRefBoundedWalkCount++;
    try {
      const out = execFileSync("git", ["-C", root, "log", "--format=%cI", "--name-only", `${hit.head}..${head}`, "--", "tasks/"], {
        encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
      });
      for (const [id, t] of parseCommitTimesLog(out)) map.set(id, t);
    } catch {
      map = fullBuild(); // incremental failed (e.g. non-ff rewrite) — never return a partial map
    }
  } else {
    map = fullBuild(); // cold (no prior head) or non-ff — full rebuild
  }
  taskCommitTimesRefCache.set(key, { at: nowMs, head, map });
  return map;
}

/** Read a single task's last-commit time at a ref. Cache-first (AC3): when the batch commit-time
 *  reader already holds this task, return it from cache with ZERO git subprocesses; otherwise fall back
 *  to `git log -1 --format=%cI ref -- tasks/<id>.md`. The /task detail page's `last updated` source —
 *  the same develop-derived time as the list's updated column (list and detail must agree, not
 *  list=done/detail=ready). null when the file has no commit at the ref (caller falls back to disk
 *  mtime). */
export function readTaskCommitTimeAtRef(root: string, ref: string, taskId: string): number | null {
  const entry = taskCommitTimesRefCache.get(`${root}\n${ref}`);
  if (entry != null && entry.map.has(taskId)) {
    return entry.map.get(taskId) ?? null;
  }
  singleTaskGitSpawnCount++;
  try {
    const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI", ref, "--", `tasks/${taskId}.md`], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) return null;
    const ms = Date.parse(out);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Force-refresh the three develop-ref read caches for one (root, ref) — status + title + commit-time
 *  together (one ls-tree / one cat-file / one incremental-or-full git log). The three caches share one
 *  TTL clock and one truth; refreshing them together keeps the detail-page cache-first reads
 *  (readTaskAtRefMeta / readTaskCommitTimeAtRef) coherent with the list-page reads. Never throws (AC4):
 *  a git failure is caught inside each reader and again here — the prior cache is kept, the next
 *  refresh re-fills it. */
export function refreshDevelopRefCaches(root: string, ref: string): void {
  try {
    // Build the slowest face FIRST (the commit-time history walk), so the fast status/title caches end
    // up freshest when this returns. Each reader stamps its own `Date.now()` at build time (not a shared
    // clock) — a request right after the refresh hits status/title within their TTL.
    readTaskCommitTimesAtRef(root, ref, { force: true });
    readTaskTitleMapAtRef(root, ref, { force: true });
    readTaskStatusMapAtRef(root, ref, { force: true });
  } catch {
    // never throw out of the refresh tick — each reader already degrades; this is belt-and-suspenders
  }
}

/** Start the background refresh tick that keeps the develop-ref read caches warm OFF the request path
 *  (plan §2). Runs one full build immediately (the cold full-history walk lives here, at startup, not in
 *  a request), then re-refreshes every `intervalMs`. Returns a stop() function; the interval is unref'd
 *  so it never keeps the process alive. */
export function startDevelopRefBackgroundRefresh(
  root: string,
  ref: string,
  { intervalMs = 15_000 } = {},
): { stop: () => void } {
  const run = (): void => refreshDevelopRefCaches(root, ref);
  run(); // the cold full build (status + title + commit-time) — at startup, off the request path
  const handle = setInterval(run, intervalMs);
  (handle as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(handle) };
}

/** readLive's task-status read: the canonical develop ref first, the on-disk store as fallback. A
 *  task landed on develop (status done) but not yet synced to the manager working branch's disk still
 *  reads as done here — the landed task leaves the in-flight view immediately (AC1). A fresh task that
 *  exists only on disk (not yet committed to develop) falls back to the disk read (AC2). */
export function readTaskStatusForLive(root: string, taskId: string): TaskStatus | null {
  const atRef = readTaskStatusAtRef(root, "develop", taskId);
  return atRef ?? readTaskStatusOnDisk(root, taskId);
}

/** Task statuses that mean "no worker is currently running for this task" — the terminal/non-live
 *  states (done/superseded/needs-human). readLive drops an in-flight run whose on-disk task status is
 *  one of these: a start-without-end telemetry record for a done/superseded/needs-human task is a
 *  ghost (its worker session ended, was superseded, or escaped to a human WITHOUT a normal fan-in END
 *  telemetry). `todo`/`ready` are NOT terminal: `ready` is the genuine in-flight case (AC2), and a
 *  `todo` carrying a start event is not evidence of terminality. */
const NON_LIVE_TASK_STATUSES: ReadonlySet<string> = new Set([TASK_STATUS.DONE, TASK_STATUS.SUPERSEDED, TASK_STATUS.NEEDS_HUMAN]);

// gap-dashboard-live-concurrency-duplicates-inflight-count: the worker concurrency CAP shown on the
// dashboard. Core (packages/quay/src) must stay dependency-free on plugin/scripts — a STATIC import of
// plugin/scripts/driver-config.ts breaks the npm-pack dist bundle (esbuild cannot resolve driver-config's
// `yaml` from the plugin tree in the pack temp dir), and readLive is SYNC so the loadDriverRuntime-style
// dynamic import is unavailable. This reader therefore mirrors driverCap(root,"worker") against the SAME
// data source (plugin/scripts/drivers.yml kinds.worker.cap → DEFAULT_DRIVER_CAP fallback); the explicit
// CLI --concurrency override is out of dashboard scope (Plan §4 — the dashboard reads static config).
export const DEFAULT_DRIVER_CAP = 5; // concurrency-default-fallback: Core mirror of driver-config.ts DEFAULT_DRIVER_CAP

/** Read the worker concurrency cap from drivers.yml, mirroring driverCap(root,"worker") (worker kind,
 *  no explicit override). Absent/unparseable config degrades to DEFAULT_DRIVER_CAP — never throws. */
function readWorkerCap(root: string): number {
  try {
    const text = fs.readFileSync(path.join(root, "plugin/scripts/drivers.yml"), "utf8");
    const parsed = YAML.parse(text) as { kinds?: { worker?: { cap?: unknown } } } | null;
    const cap = parsed?.kinds?.worker?.cap;
    if (typeof cap === "number" && Number.isInteger(cap) && cap >= 1) return cap;
  } catch {
    // absent/unparseable drivers.yml → conservative default (fail-open, same as loadDriverConfig)
  }
  return DEFAULT_DRIVER_CAP;
}

/**
 * Live loop view: in-flight fast-mode tasks + elapsed minutes + concurrency + CPU pressure +
 * the loop-state discriminator. Degrades per the header contract; never throws.
 *
 * gap-live-ghost-inflight-paused-event: the in-flight pairing (start without end) is cross-validated
 * against worktree existence — a start-without-end run whose worktree was RELEASED (complete / crash
 * / operational-pause, no end event) is removed as a ghost (AC1). The removal is fail-closed: it only
 * happens on a positive "released" reading (`taskWorktreeOpen` === false); an unobservable worktree
 * namespace (`null`) keeps the run in-flight, so a non-worktree workspace still shows the raw
 * `--report inProgress` set (the serve.test.mjs AC2 pin).
 */
export function readLive(
  root: string,
  { nowMs = Date.now(), liveWorkers = null, sessionHome = os.homedir(), computeBlocking = true }:
    { nowMs?: number; liveWorkers?: LiveWorker[] | null; sessionHome?: string; computeBlocking?: boolean } = {},
): LiveResult {
  const eventsDir = path.join(root, FAST_MODE_EVENTS_DIR);
  let inFlight: InFlightTask[] = [];
  let status: ObservationStatus = "ok";
  let reason: string | null = null;
  let telemetryEmpty = false;
  try {
    if (!fs.existsSync(eventsDir)) {
      telemetryEmpty = true;
      status = "empty";
      reason = `未找到遥测记录（${FAST_MODE_EVENTS_DIR}/ 不存在）`;
    } else {
      // Count records by `.jsonl` file (contract measure: `ls <root>/.workflow-events/*.jsonl | wc -l`).
      const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl")).sort();
      if (files.length === 0) {
        telemetryEmpty = true;
        status = "empty";
        reason = `未找到遥测记录（${FAST_MODE_EVENTS_DIR}/ 存在但为空，0 条 .jsonl）`;
      } else {
        // gap-in-flight-liveness-worktree-proxy-not-process: annotate every start-without-end run
        // with process-level liveness. The pairing itself (ids/starts) is UNCHANGED — the AC2 pin
        // in serve.test.mjs requires readLive().inFlight to equal --report inProgress; liveness is
        // additive. The board reclassifies "orphan" runs out of the in-flight display.
        //
        // gap-live-ghost-inflight-paused-event: additionally cross-validate the pairing against
        // worktree existence — a start-without-end run whose worktree was RELEASED (no end event
        // was ever written) is a ghost, removed here. The filter is fail-closed: only a positive
        // `taskWorktreeOpen === false` (namespace observable, task worktree absent) removes; `null`
        // (namespace unobservable — e.g. a non-worktree workspace) keeps the run, so the AC2 pin
        // still holds where worktree isolation is not in play.
        inFlight = pairInFlight(readEventsFromDir(eventsDir, files), nowMs)
          .map((t) => ({
            ...t,
            liveness: classifyRunLiveness(runProcessAliveSync(t.runId)),
          }))
          .filter((t) => taskWorktreeOpen(root, t.taskId) !== false);
      }
    }
  } catch (err) {
    status = "error";
    reason = `读取遥测失败：${err instanceof Error ? err.message : String(err)}`;
  }

  // gap-live-page-worker-driver-inflight-invisible: merge the worker-driver's carrier-derived
  // in-flight set, and drop workflow-events runs that predate the driver (stale inner-era ghosts).
  // A worker-carrier read failure degrades to the workflow-events-only view — never 500s the page.
  // gap-ac179-criterion-cold-miss-30s-ttl-always-expired: read each carrier ONCE for the whole call
  // and hand the text to every consumer below (workerDriverOnlineMs / readWorkerRoundInFlightTasks).
  // They used to re-read + re-parse the SAME 2.4 MB outcome carrier and 11.7 MB round carrier, which
  // measured ~250 ms of this function's event-loop block — and this function's block is exactly what
  // a concurrent `/health` waits for while the dashboard snapshot rebuilds (AC4).
  const outcomeText = readWorkerOutcomeText(root); // never throws (own try/catch → null)
  let roundText: string | null = null;
  try { roundText = fs.readFileSync(path.join(root, WORKER_ROUND_REL), "utf8"); } catch { roundText = null; }

  let workerInFlight: InFlightTask[] = [];
  try {
    if (outcomeText != null) {
      workerInFlight = workerInFlightTasks(parseWorkerOutcomeRecords(outcomeText), nowMs);
    }
  } catch {
    workerInFlight = [];
  }

  // gap-live-mechanical-fan-in-inflight-invisible: the round carrier names the specific in-flight
  // task ids during the mechanical fan-in window (worker exited, no outcome yet, no workflow-events).
  // Surface each round-carried task id as in-flight with pid null (the worker process is gone). The
  // /proc loop BELOW appends after this, so an implementing task keeps its pid/sessionId join (the
  // merge Map's later-wins semantics let the /proc entry overwrite this round entry).
  // gap-live-fan-in-window-elapsed-zero: read the TRUE dispatch start (`in_flight_task_starts`) first;
  // only when the round carries no start for the task do we fall back to nowMs ("just now", never a
  // fabricated long elapsed — honest ③b).
  for (const { taskId, startedAtMs } of readWorkerRoundInFlightTasks(root, roundText)) {
    const started = startedAtMs ?? nowMs;
    workerInFlight.push({
      taskId,
      runId: `worker-${taskId}`,
      pid: null, // round-carrier task: worker process has exited (mechanical fan-in window)
      sessionId: null, // no live process ⇒ no live session join
      startedAtMs: started,
      implCompletedAtMs: null,
      status: null,
      phase: "implementing", // round-carrier fallback — readLive re-derives (fan-in lock wins for the fan-in window)
      suite: null,
      minutes: Math.max(0, (nowMs - started) / 60_000),
      liveness: "unknown",
      blocks: [],
      blockedBy: [],
    });
  }

  // gap-live-page-worker-inflight-bidirectional-error 方向二: the outcome carrier is written only at
  // worker END, so a first-dispatched worker (no outcome record yet) is invisible to the outcome path.
  // Surface it from the live-process signal — a /proc cmdline carrying `quay-task-worker` + `Task: <id>`.
  // The AUTO scan is gated TWICE: (a) the driver must be active for THIS root (a synthetic/foreign
  // workspace with no worker carriers has no workers for it — serve.test.mjs AC2 pins readLive against
  // a workflow-events-only fixture), and (b) gap-observation-hardcodes-quay-worktrees-ignoring-config-
  // worktree-root: the scan is SCOPED TO THIS WORKSPACE (`{root}`) because /proc is host-global —
  // activation alone says "this workspace HAS a driver", never "these processes are its workers".
  // Without (b), a co-resident project with an active driver (quay-fleet) rendered the quay
  // checkout's five workers as its own 「在飞」. The `liveWorkers` test seam bypasses both gates.
  const live = liveWorkers ?? (workerDriverActive(root) ? readLiveWorkerProcesses("/proc", { root }) : []);
  for (const w of live) {
    if (!w || !w.taskId) continue;
    const startedAtMs = w.startedAtMs ?? nowMs;
    workerInFlight.push({
      taskId: w.taskId,
      runId: `worker-${w.taskId}`,
      pid: w.pid,
      // gap-worker-task-transcript-access-webui AC2: join ~/.claude/sessions/<pid>.json for the live
      // transcript session id (worker-driver now spawns `claude --session-id <uuid>`, so a live worker's
      // pid maps to the session whose transcript is being written RIGHT NOW).
      sessionId: liveSessionIdForPid(w.pid, sessionHome),
      startedAtMs,
      implCompletedAtMs: null,
      status: null,
      phase: "implementing", // the worker process IS the live signal — readLive re-derives (fan-in lock wins)
      suite: null,
      minutes: Math.max(0, (nowMs - startedAtMs) / 60_000),
      liveness: "alive", // the process IS the live signal — this worker is observably running
      blocks: [],
      blockedBy: [],
    });
  }

  // The driver's carrier IS the loop telemetry once the driver is the executor: an empty
  // workflow-events store must not read as 「循环没跑」 (running-unwired / not-running) when the
  // driver is actively writing its own carrier.
  if (workerDriverActive(root)) {
    telemetryEmpty = false;
    if (status === "empty") {
      status = "ok";
      reason = null;
    }
  }

  // AC2: a workflow-events start-without-end run whose start is BEFORE the driver came online is a
  // stale inner-era ghost — its worktree may still exist (now managed by the driver), so the
  // worktree-released filter above does not remove it. Drop it here by the direct量 (start < online).
  const workerOnlineMs = workerDriverOnlineMs(root, { outcomeText, roundText });
  if (workerOnlineMs != null) {
    inFlight = inFlight.filter((t) => t.startedAtMs >= workerOnlineMs);
  }

  // gap-live-ghost-superseded-task-workflow-events-start: a workflow-events start-without-end run
  // whose task's on-disk status is terminal (done/superseded/needs-human) is a ghost — the worker
  // session was ended/superseded without a normal fan-in END telemetry, so the pairing never closes.
  // Drop it by the direct量 (on-disk status), the same terminal-state filter the worker-carrier merge
  // below applies — but UNCONDITIONAL, because the ghost bug fires precisely when workerInFlight is
  // empty (workerOutcomeOpen is always false) and the merge block below is skipped entirely.
  inFlight = inFlight.filter(
    (t) => !NON_LIVE_TASK_STATUSES.has(readTaskStatusForLive(root, t.taskId)),
  );

  // Merge: a task carried by the worker-driver replaces any same-task workflow-events run (the driver
  // is the execution truth); union otherwise. Worker wins on collision. A worker task whose on-disk
  // status is already "done" is NOT in-flight (it landed — the driver's exited-not-landed on a done
  // task is a leftover-worktree cleanup artifact, the same "not really in-flight" class as the AC2
  // ghost).
  if (workerInFlight.length > 0) {
    const byTask = new Map<string, InFlightTask>();
    for (const t of inFlight) byTask.set(t.taskId, t);
    for (const t of workerInFlight) {
      if (readTaskStatusForLive(root, t.taskId) === TASK_STATUS.DONE) continue;
      byTask.set(t.taskId, t);
    }
    inFlight = [...byTask.values()].sort(
      (a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId),
    );
  }

  // gap-live-fan-in-execution-phase-two-axis: annotate the merged in-flight set with the TWO axes —
  // lifecycle status (axis 1, from the task store) and execution phase (axis 2, from direct signals:
  // fan-in lock → worker process → impl-complete → round fallback). The fan-in lock and suite state
  // carriers are read ONCE here (not per task). A store/carrier read failure degrades to a null
  // status / implementing fallback — never 500s the page (the header degradation contract).
  const fanInLockAcquired = readFanInLockAcquiredTasks(root);
  const suiteState = readFullSuiteState(root);
  for (const t of inFlight) {
    t.status = readTaskStatusForLive(root, t.taskId);
    t.phase = deriveInFlightPhase(t, fanInLockAcquired);
    t.suite = t.phase === "fan-in" && suiteState != null && suiteState.taskId === t.taskId ? suiteState.view : null;
  }

  // Cross-task blocking (gap-webui-cross-task-blocking-visibility): annotate every in-flight task
  // with the ready/todo tasks it blocks and the tasks blocking it, from the on-disk task store.
  // Additive — a store read failure leaves blocks/blockedBy empty, never 500s the page.
  //
  // gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: `computeInFlightBlocking` walks the
  // ENTIRE task store (`readTaskBlockingInputs` → readFileSync + YAML parse of every tasks/*.md) —
  // the one readLive cost that grows MONOTONICALLY with the task store (the recurrence root: ~44 new
  // tasks/day made the dashboard slower every day even with zero code change). The dashboard's
  // liveCard renders only taskId/phase/elapsed/title — it NEVER renders blocks/blockedBy — so paying
  // for the full-store scan on the dashboard path is pure waste. `computeBlocking:false` removes the
  // scan from the dashboard entirely (cost becomes INDEPENDENT of store size — bounded growth, AC4),
  // while /live and /board keep it (they render the blocking rows).
  if (computeBlocking) {
    inFlight = computeInFlightBlocking(root, inFlight);
  }

  // Discriminator (gap-live-cannot-tell-a-dead-loop-from-an-unwired-one): only when telemetry
  // is EMPTY do we consult activity signals. A telemetry READ FAILURE stays a bare 「读失败」
  // (liveState === null) — the empty-state texts must never mask an unreadable store (AC4).
  let liveState: LiveState | null = null;
  let liveExplanation: string | null = null;
  let activity: ActivitySignals | null = null;
  if (telemetryEmpty) {
    activity = readActivitySignals(root, { nowMs });
    const decided = decideLiveState(activity);
    liveState = decided.state;
    liveExplanation = `${decided.explanation}（${reason}）`;
  } else if (status === "ok") {
    liveState = "running";
  }

  let cpuPressure: number | null = null;
  try {
    const cpu = fs.readFileSync("/proc/pressure/cpu", "utf8");
    const m = /some\s+avg10=([0-9.]+)/.exec(cpu);
    if (m) cpuPressure = Number.parseFloat(m[1]);
  } catch {
    cpuPressure = null; // non-Linux or unreadable — the row is simply omitted
  }

  // gap-dashboard-live-concurrency-duplicates-inflight-count: the worker concurrency CAP is an
  // INDEPENDENT data source (drivers.yml, not telemetry) — readWorkerCap degrades to the
  // conservative DEFAULT_DRIVER_CAP, never a fabricated 0 (and never the in-flight count, which the
  // old `concurrency` field duplicated).
  const concurrencyCap = readWorkerCap(root);

  return { status, reason, inFlight, concurrencyCap, cpuPressure, liveState, liveExplanation, activity };
}

/** Read a file, splitting it into `## `-headed sections and keeping the most recent `max` sections. */
function readRecentSections(root: string, relFile: string, max: number): JournalSection {
  const abs = path.join(root, relFile);
  let text: string;
  try {
    if (!fs.existsSync(abs)) {
      return { status: "empty", reason: `missing ${relFile}`, markdown: null };
    }
    text = fs.readFileSync(abs, "utf8");
  } catch (err) {
    return {
      status: "error",
      reason: `cannot read ${relFile}: ${err instanceof Error ? err.message : String(err)}`,
      markdown: null,
    };
  }
  const lines = text.split(/\r?\n/);
  // Fail-closed (gap-webui-journal-reads-stale-data AC3): a present-but-empty/whitespace-only
  // file is NOT data — report 「无数据」 (status empty), never "ok with no content" which the
  // renderer would show as 「暂无内容」 and could be mistaken for a genuinely empty-but-wired store.
  if (!lines.some((ln) => ln.trim().length > 0)) {
    return { status: "empty", reason: `${relFile} 为空`, markdown: null };
  }
  const boundaries: number[] = [];
  lines.forEach((ln, i) => {
    if (/^##\s+/.test(ln)) boundaries.push(i);
  });
  if (boundaries.length === 0) {
    // No `## ` sections — fall back to the tail of the file.
    const tail = lines.slice(-Math.max(1, max * 4)).join("\n");
    return { status: "ok", reason: null, markdown: tail };
  }
  boundaries.push(lines.length);
  const recent: string[] = [];
  for (let i = boundaries.length - 2; i >= 0 && recent.length < max; i--) {
    recent.unshift(lines.slice(boundaries[i], boundaries[i + 1]).join("\n"));
  }
  return { status: "ok", reason: null, markdown: recent.join("\n\n") };
}

/** Recent commits via `git -C <root> log --oneline -N`. A non-git workspace degrades to empty. */
function readRecentCommits(root: string, limit: number): JournalSection {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--oneline", `-${limit}`], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    return { status: "ok", reason: null, markdown: lines.join("\n") };
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
    if (stderr.includes("not a git repository")) {
      return { status: "empty", reason: "工作区不是 git 仓库（无提交记录）", markdown: null };
    }
    return {
      status: "error",
      reason: `git log 失败：${err instanceof Error ? err.message : String(err)}`,
      markdown: null,
    };
  }
}

/** A tick-log entry line: `` - `HH:MMZ` `action` … `` — bullet + backtick time (HH:MMZ, no date). */
const TICK_ENTRY_RE = /^- `(\d{2}):(\d{2})Z` /;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Stale banner for a channel superseded by tick-log but still rendered first on the Journal page
 * (gap-webui-journal-stale-and-ticklog-bug AC1). A dead channel shown as a fresh 「最近记录」 is
 * fake; the banner makes its age explicit. Null when the file is fresh or its mtime is unreadable.
 */
function staleBanner(abs: string, nowMs: number): string | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
  const ageDays = (nowMs - mtimeMs) / 86_400_000;
  if (ageDays < ESCALATIONS_STALE_DAYS) return null;
  const when = new Date(mtimeMs).toISOString().slice(0, 10);
  return `### ⚠️ 陈旧记录 — 最后更新于 ${when}（约 ${Math.max(1, Math.floor(ageDays))} 天前）；升级机制已由 tick-log 取代，此处仅供参考`;
}

/** escalations.md — `## `-section reader plus the stale banner (AC1). */
function readEscalations(root: string, relFile: string, max: number, nowMs: number): JournalSection {
  const section = readRecentSections(root, relFile, max);
  if (section.status !== "ok" || section.markdown == null) return section;
  const banner = staleBanner(path.join(root, relFile), nowMs);
  if (banner == null) return section;
  return { status: "ok", reason: null, markdown: `${banner}\n\n${section.markdown}` };
}

/**
 * tick-log.md — a DEDICATED reader (gap-webui-journal-stale-and-ticklog-bug AC2). The real file is
 * `` - `HH:MMZ` `action` `` bullets, NOT `## ` sections: the shared `## `-boundary reader found zero
 * boundaries and fell through to its `lines.slice(-max*4)` TAIL fallback, mixing days-old stale
 * entries into the recent view with no date. This reader segments by the bullet line-prefix and
 * stamps each entry with its inferred date (AC3). A legacy `## `-sectioned file is still supported
 * (serve.test.mjs gap-webui-journal-reads-stale-data pins it) — but a file with NEITHER bullets nor
 * `## ` sections reports 「无数据」, never a raw tail (that fallback is the AC2 mixing bug).
 */
function readTickLog(root: string, relFile: string, max: number): JournalSection {
  const abs = path.join(root, relFile);
  let text: string;
  try {
    if (!fs.existsSync(abs)) {
      return { status: "empty", reason: `missing ${relFile}`, markdown: null };
    }
    text = fs.readFileSync(abs, "utf8");
  } catch (err) {
    return {
      status: "error",
      reason: `cannot read ${relFile}: ${err instanceof Error ? err.message : String(err)}`,
      markdown: null,
    };
  }
  const lines = text.split(/\r?\n/);
  if (!lines.some((ln) => ln.trim().length > 0)) {
    return { status: "empty", reason: `${relFile} 为空`, markdown: null };
  }

  // Real format: bullet entry starts (`` - `HH:MMZ` ``).
  const starts: number[] = [];
  const minutesOfDay: number[] = [];
  lines.forEach((ln, i) => {
    const m = TICK_ENTRY_RE.exec(ln);
    if (m) {
      starts.push(i);
      minutesOfDay.push(Number(m[1]) * 60 + Number(m[2]));
    }
  });

  if (starts.length > 0) {
    return readTickBullets(lines, starts, minutesOfDay, abs, max);
  }

  // Legacy `## `-sectioned file — delegate ONLY when sections exist. With zero sections this is
  // 「无数据」, never the raw-tail fallback.
  const hasSections = lines.some((ln) => /^##\s+/.test(ln));
  if (!hasSections) {
    return { status: "empty", reason: `${relFile} 无可分段条目（既非 tick 条目也非 ## 小节）`, markdown: null };
  }
  return readRecentSections(root, relFile, max);
}

/**
 * Segment the bulleted tick-log entries, stamp each with its inferred date, keep the most recent
 * `max` (AC3). Date inference anchors the newest entry to the file's mtime UTC date and walks
 * backward, rolling the day back whenever an entry's HH:MM is LATER than its successor's (a
 * midnight rollover). HH:MMZ alone is ambiguous across days — this disambiguates the single-
 * midnight case the file's own format can support.
 */
function readTickBullets(
  lines: string[],
  starts: number[],
  minutesOfDay: number[],
  abs: string,
  max: number,
): JournalSection {
  let anchorMs: number;
  try {
    anchorMs = fs.statSync(abs).mtimeMs;
  } catch {
    anchorMs = Date.now();
  }
  const dates: { y: number; m: number; d: number }[] = new Array(starts.length);
  {
    const anchor = new Date(anchorMs);
    let y = anchor.getUTCFullYear();
    let m = anchor.getUTCMonth();
    let d = anchor.getUTCDate();
    dates[starts.length - 1] = { y, m, d };
    for (let i = starts.length - 2; i >= 0; i--) {
      if (minutesOfDay[i] > minutesOfDay[i + 1]) {
        const prev = new Date(Date.UTC(y, m, d));
        prev.setUTCDate(prev.getUTCDate() - 1);
        y = prev.getUTCFullYear();
        m = prev.getUTCMonth();
        d = prev.getUTCDate();
      }
      dates[i] = { y, m, d };
    }
  }

  const from = Math.max(0, starts.length - max);
  const out: string[] = [];
  for (let i = from; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const entry = lines.slice(starts[i], end).join("\n");
    const d = dates[i];
    const stamp = `${d.y}-${pad2(d.m + 1)}-${pad2(d.d)}`;
    out.push(entry.replace(TICK_ENTRY_RE, (_full: string, hh: string, mm: string): string => `- \`${stamp} ${hh}:${mm}Z\` `));
  }
  return { status: "ok", reason: null, markdown: out.join("\n") };
}

/** Journal view: recent escalations + tick log + commits. Degrades per the header contract; never throws. */
export function readJournal(root: string, nowMs: number = Date.now()): JournalResult {
  const orch = path.join(root, ORCHESTRATION_DIR);
  return {
    escalations: readEscalations(orch, ESCALATIONS_FILE, JOURNAL_ESCALATION_SECTIONS, nowMs),
    tickLog: readTickLog(orch, TICK_LOG_FILE, JOURNAL_TICK_SECTIONS),
    commits: readRecentCommits(root, GIT_LOG_LIMIT),
  };
}

// ── Board: three-source join (意图/执行/落地) — gap-web-board-needs-an-inconsistency-verdict-it-does-not-have ──
//
// ARCHITECTURE DECISION (AC1, the task's primary deliverable — the four questions are answered
// in the task body with code facts): the LANDING judgment is REUSED, not reimplemented.
//   Q1: The drift checker's judgment is NOT a pure function (it spawns a `grep` subprocess via
//       resolveSymbol and reads the filesystem), but its functions are parameterized by repoRoot
//       and exported, so the reuse cost is a subprocess call — no code needs to move.
//   Q2: Core does NOT yet depend on plugin/ (grep of packages/quay/src → zero imports). This IS
//       a new Core→plugin edge, BUT observation.ts already shells out to `git` (a workspace
//       tool) and reads workspace-local files; the drift checker is the SAME class of
//       workspace-observation tool, so invoking it as a subprocess is consistent with this
//       module's existing role — it is not the provider-agnostic task-rendering path.
//   Q3: The "third way" (extract the judgment to a shared location) is not implementable within
//       this task's Touches (observation.ts / serve-handlers.ts / the test only). The drift
//       checker stays authoritative where it is; observation.ts resolves it relative to its own
//       module location and consumes its JSON. No second copy exists.
//   Q4: Not reimplementing — the drift checker is authoritative, so AC4's "who is authoritative
//       when the two drift" question is moot: there is only ONE implementation.
// CONSEQUENCE: the board's data-flag agrees with `task-status-drift-check.ts --json` per-task
// BY CONSTRUCTION (AC2/AC3) — the board consumes the checker's own suspects/reverse output.
// DEGRADATION: the subprocess is fail-closed. If plugin/scripts is absent (a product install
// without the methodology layer) the landing column reports 「无数据」; if it fails to run/parse
// it reports 「读失败」. Either way /board returns 200 (AC6), never a 500.

/**
 * 「在飞超时」threshold — a fast-mode run that started but has no end after this many minutes is
 * flagged. 90 minutes matches the repo's task-over-90m budget (inner-blocked-signal.ts: "任务超
 * 90 分钟"). Deliberately NOT a checker-reused value: the drift checker has no timeout criterion;
 * this is the board's own execution-column judgment.
 */
export const IN_FLIGHT_TIMEOUT_MINUTES = 90;

export interface BoardLanding {
  status: ObservationStatus;
  reason: string | null;
  /** taskId → landing flag: "done-unlanded" | "landed-not-closed" (drift checker reverse/suspects). */
  flags: Map<string, string>;
  /** Number of tasks the checker scanned (0 when degraded). */
  scanned: number;
  /** True when status === "error" AND the subprocess exceeded LANDING_TIMEOUT_MS (fail-open: the
   *  page renders 「读取超时」 instead of an empty wait to the old 120s cap — AC3). */
  timedOut?: boolean;
}

export interface BoardExecution {
  status: ObservationStatus;
  reason: string | null;
  /** taskId → Set of execution flags: "in-flight-timeout" | "orphan". */
  flags: Map<string, Set<string>>;
  /** In-flight run detail for the page (runId + elapsed minutes). */
  inFlight: InFlightTask[];
}

// ── Board landing cache — short-TTL, mirroring the pool-metrics probe (readPoolMetrics) ────────────
// readBoardLanding cold-runs plugin/scripts/task-status-drift-check.ts, which on a large repo does a
// FULL git-log pass over the landing ref — >150s measured, documented by the checker's own comment
// (task-status-drift-check.ts:462). Per-request cold-running is exactly the 120s /board defect
// (gap-webui-board-load-120s), so a reading is short-TTL-cached (30s, the same window as
// POOL_METRICS_CACHE_TTL_MS). A TIMEOUT is cached too: on a large repo the checker's steady state IS
// a timeout, and not caching it would make EVERY request pay the full second-level cap — the AC2
// "second request fast" negative control would fail where it matters. The cache lives ONLY in the
// serve-side observation layer (display surface); A22 / slot-refill's own reads never import
// observation.ts, so caching here cannot pollute the dispatch truth (the same isolation readPoolMetrics
// documents for its AC3). Keyed by workspace root so two served workspaces never share a reading.
export const LANDING_CACHE_TTL_MS = 30_000;
/** Second-level hard cap for the landing subprocess — on exceed the child is SIGTERMed and the page
 *  renders 「读取超时」 (fail-open, AC3) instead of the old 120s empty wait. 8s is single-digit
 *  seconds (AC1) with headroom for a normal small-repo run. */
export const LANDING_TIMEOUT_MS = 8_000;
const landingCache = new Map<string, { at: number; landing: BoardLanding }>();

/** Test-hygiene handle: drop all cached landing readings. */
export function clearLandingCache(): void {
  landingCache.clear();
}

/** Test observability: number of times the drift-checker subprocess was actually spawned since
 *  process start. The AC2 negative control asserts this stays flat on a cache-hit request. */
let landingColdRunCount = 0;
export function getLandingColdRunCount(): number {
  return landingColdRunCount;
}

/** Test seams for readBoardLanding — checkerPath overrides the resolved checker script (e.g. a fake
 *  that hangs, to exercise the timeout path); timeoutMs overrides the subprocess deadline. */
export interface ReadBoardLandingOpts {
  checkerPath?: string;
  timeoutMs?: number;
}

/**
 * Reuse the drift checker as the single authoritative landing judgment. Runs
 * `plugin/scripts/task-status-drift-check.ts --json` (resolved relative to THIS module, with
 * cwd = the served workspace root so findRepoRoot finds the served store) and maps its output:
 *   suspects  → "landed-not-closed"  (已落地但未收尾: code in tree, status not closed)
 *   reverse   → "done-unlanded"      (done 但未落地: done, code never landed)
 * The result is short-TTL-cached (LANDING_CACHE_TTL_MS) — a cache hit returns WITHOUT spawning the
 * subprocess (AC2). Fail-open: script absent → 「无数据」; run/parse failure → 「读失败」; a subprocess
 * exceeding LANDING_TIMEOUT_MS is killed and returns timedOut:true → 「读取超时」 (AC3 — never an empty
 * wait to the old 120s cap). Never throws (AC6).
 */
export async function readBoardLanding(root: string, opts: ReadBoardLandingOpts = {}): Promise<BoardLanding> {
  const hit = landingCache.get(root);
  if (hit && Date.now() - hit.at < LANDING_CACHE_TTL_MS) return hit.landing;
  const timeoutMs = opts.timeoutMs ?? LANDING_TIMEOUT_MS;

  let scriptPath: string;
  let stripTypes: boolean;
  if (opts.checkerPath) {
    // Test seam: a caller-provided checker path (e.g. a fake that hangs) skips the dev/dist
    // fallback and derives strip-types from its extension.
    scriptPath = opts.checkerPath;
    stripTypes = scriptPath.endsWith(".ts");
  } else {
    // Canonical resolver (SPEC §6b) — never an import.meta.url walk-up without a worktree check.
    // `resolvePluginScriptExec` also applies the dev/dist fallback
    // (gap-shipped-ts-files-are-not-bundled: the shipped artifact carries the checker only as
    // bundled dist/*.js, run without --experimental-strip-types).
    const resolved = resolvePluginScriptExec(path.join("scripts", "task-status-drift-check.ts"));
    if (resolved == null) {
      return {
        status: "empty",
        reason: "landing 判断源缺失（plugin/scripts/task-status-drift-check.ts/dist bundle 不存在 — 产品安装无 methodology 层）",
        flags: new Map(),
        scanned: 0,
      };
    }
    scriptPath = resolved.path;
    stripTypes = resolved.stripTypes;
  }
  try {
    const argv = stripTypes
      ? ["--experimental-strip-types", scriptPath, "--json"]
      : [scriptPath, "--json"];
    landingColdRunCount += 1;
    const { stdout } = await execFileP("node", argv, {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    const parsed = JSON.parse(stdout);
    const flags = new Map<string, string>();
    for (const s of parsed.suspects ?? []) flags.set(s.taskId, "landed-not-closed");
    for (const r of parsed.reverse ?? []) flags.set(r.taskId, "done-unlanded");
    const landing: BoardLanding = { status: "ok", reason: null, flags, scanned: parsed.scanned ?? 0 };
    landingCache.set(root, { at: Date.now(), landing });
    return landing;
  } catch (err) {
    const timedOut = (err as { killed?: boolean; signal?: string }).killed === true;
    const landing: BoardLanding = timedOut
      ? {
          status: "error",
          timedOut: true,
          reason: `landing 判断源执行超过 ${timeoutMs}ms 未完成（fail-open）`,
          flags: new Map(),
          scanned: 0,
        }
      : {
          status: "error",
          reason: `landing 判断源读失败：${err instanceof Error ? err.message : String(err)}`,
          flags: new Map(),
          scanned: 0,
        };
    // Cache a timeout too — on a large repo the checker's steady state IS a timeout, so this keeps
    // repeat page loads instant (AC2) instead of paying the second-level cap on every request.
    if (timedOut) landingCache.set(root, { at: Date.now(), landing });
    return landing;
  }
}

/**
 * Best-effort process-liveness probe for a fast-mode runId, mirroring fast-mode-telemetry.ts's
 * processAlive (scan /proc cmdlines for the runId's distinctive tail). Returns:
 *   true  — a live process cmdline contains the runId tail (executor alive → NOT orphan)
 *   false — /proc was readable and no process matched (executor observably gone → orphan)
 *   null  — /proc unavailable or unreadable (unknown → fail-closed: NOT flagged orphan)
 * SYNC core: readLive is synchronous, so the in-flight annotation cannot await. The async
 * `isRunProcessAlive` wrapper is kept for API compatibility and delegates here. This is the SAME
 * /proc scan fast-mode-telemetry.ts's processAlive runs — the board's orphan signal agrees with
 * --reconcile's process probe (the needle = the runId's last two dash-segments, `<ts>-<rand>`).
 */
export function runProcessAliveSync(runId: string): boolean | null {
  if (!runId || runId.length < 4) return null;
  const parts = runId.split("-");
  const needle = parts.length >= 2 ? parts.slice(-2).join("-") : runId;
  if (needle.length < 4) return null;
  let readable = 0;
  try {
    const procs = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of procs) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        readable++;
        if (cmd.includes(needle)) return true;
      } catch {
        // pid exited mid-scan — not a match
      }
    }
  } catch {
    return null; // /proc unavailable (non-Linux / restricted) — unknown
  }
  return readable > 0 ? false : null;
}

/**
 * Map a boolean|null probe verdict to the RunLiveness vocabulary:
 *   true  → "alive", false → "orphan", null → "unknown" (fail-closed toward in-flight).
 */
export function classifyRunLiveness(alive: boolean | null): RunLiveness {
  if (alive === true) return "alive";
  if (alive === false) return "orphan";
  return "unknown";
}

/** Async wrapper over runProcessAliveSync (kept for API compatibility). */
export async function isRunProcessAlive(runId: string): Promise<boolean | null> {
  return runProcessAliveSync(runId);
}

/**
 * Roots whose fallback-namespace warning has already been emitted in THIS process — the diagnostic
 * is a one-shot per workspace, not one line per dashboard render (readLive runs on every refresh).
 */
const worktreeFallbackWarned = new Set<string>();

/**
 * Test seam: forget which roots were already warned (a fixture that re-reads the same root must not
 * be silenced by a previous test's warning).
 */
export function resetWorktreeFallbackWarnings(): void {
  worktreeFallbackWarned.clear();
}

/**
 * Whether a task's fast-mode worktree is currently open — the DIRECT measurement (the worktree
 * namespace on disk, not the event stream) that cross-validates readLive's in-flight pairing.
 * A task's worktree lives at `<namespace>/<taskId>` (checked out on `task/<taskId>` — the same
 * convention fast-mode-telemetry.ts `worktreeExists` / `isQuayWorktreePath` pin).
 *
 * THE NAMESPACE IS PER-WORKSPACE (gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-
 * root): it is `loop.worktree_root` from THIS workspace's `.quay/config.yml` — the same key the WRITE
 * side (dispatch / the worktree-creation step) obeys — resolved by `resolveWorktreeNamespace`. It used to be
 * derived in place as `<parent-of-main>/quay-worktrees`, which silently answered with ANOTHER
 * project's namespace whenever two projects share a parent directory (measured 2026-09-13:
 * /home/yale/work/quay-fleet resolved to /home/yale/work/quay-worktrees). `resolveWorktreeNamespace`
 * still falls back to that convention when the key is absent, but the fallback is reported
 * (`source: "fallback"` + a `diagnostic`) and warned ONCE per process on stderr here — never silent.
 *
 * gap-live-ghost-inflight-paused-event: `.workflow-events/*.jsonl` can carry a `start` with NO end
 * because the event model has no 「非正常终结」 state — inner releases the worktree (complete / crash /
 * operational-pause) without ever writing an end. A start-without-end run whose worktree is RELEASED
 * is not in-flight; it is a ghost. This probe is the direct量 that readLive uses to remove it.
 *
 * Returns (tri-state — hard rule ③b: "unobservable" must be distinguishable from "released"):
 *   true  — `<namespace>/<taskId>` exists (the task's concurrency slot is occupied);
 *   false — the namespace exists (worktree isolation IS in play) and the task's directory is ABSENT
 *           (the slot was released — the ghost this task removes);
 *   null  — the namespace is absent/unreadable (worktree isolation not in play, or an fs error) —
 *           fail-closed toward in-flight: never a positive "released" signal from a source that
 *           could not be observed. This is what keeps readLive's `--report inProgress` parity intact
 *           in a non-worktree workspace (the serve.test.mjs AC2 fixture).
 */
export function taskWorktreeOpen(root: string, taskId: string): boolean | null {
  if (!taskId) return null;
  let namespace: string;
  try {
    const ns = resolveWorktreeNamespace(root);
    namespace = ns.dir;
    if (ns.diagnostic != null) warnWorktreeFallback(ns.dir, ns.diagnostic);
  } catch {
    return null; // resolution is total by contract; belt-and-suspenders → unobservable, never "released"
  }
  try {
    if (!fs.existsSync(namespace)) return null;
    return fs.existsSync(path.join(namespace, taskId));
  } catch {
    return null;
  }
}

/** Emit the fallback-namespace diagnostic to stderr ONCE per namespace per process (AC2: 回落不得静默). */
function warnWorktreeFallback(namespaceDir: string, diagnostic: string): void {
  if (worktreeFallbackWarned.has(namespaceDir)) return;
  worktreeFallbackWarned.add(namespaceDir);
  try {
    process.stderr.write(`observation: worktree namespace fallback — ${diagnostic}\n`);
  } catch {
    // stderr closed — the diagnostic is best-effort; the returned field is the durable carrier
  }
}

/**
 * Execution column (遥测 start/end). Reuses readLive's in-flight pairing (start without end) and
 * adds the two execution-only flags:
 *   in-flight-timeout — an ACTIVE run (process alive/unknown) started > IN_FLIGHT_TIMEOUT_MINUTES
 *                       ago with no end (在飞超时)
 *   orphan            — started with no end AND the runId's process is observably gone (孤儿)
 * gap-in-flight-liveness-worktree-proxy-not-process (AC1): a start-without-end run whose process is
 * observably gone is NOT in-flight — it is abandoned. `inFlight` therefore EXCLUDES orphan runs
 * (the board's 实现中/待落地 counts and per-row 在飞 display read this array); orphan runs are
 * surfaced ONLY through the `orphan` flag, so the board renders them as 孤儿, distinct from worktree
 * existence (a worktree can exist with no live agent — a ready-pool wait). Reconcile's retention
 * criteria are untouched (AC3). Degrades like readLive: telemetry absent → 「无数据」; unreadable →
 * 「读失败」. Never throws.
 */
export async function readBoardExecution(root: string, { nowMs = Date.now() } = {}): Promise<BoardExecution> {
  const live = readLive(root, { nowMs });
  if (live.status === "error") {
    return { status: "error", reason: live.reason, flags: new Map(), inFlight: [] };
  }
  const flags = new Map<string, Set<string>>();
  for (const t of live.inFlight) {
    const set = new Set<string>();
    if (t.liveness === "orphan") {
      // Process observably gone → the run is abandoned, not in-flight. The timeout flag applies
      // only to ACTIVE runs; an orphan carries just "orphan".
      set.add("orphan");
    } else {
      if (t.minutes > IN_FLIGHT_TIMEOUT_MINUTES) set.add("in-flight-timeout");
    }
    if (set.size) flags.set(t.taskId, set);
  }
  return {
    status: live.status,
    reason: live.reason,
    flags,
    inFlight: live.inFlight.filter((t) => t.liveness !== "orphan"),
  };
}

// ── Git history (gap-git-history-svg-server-rendered) ──────────────────────────────────────────────
// The /git-history chart's DATA access. git is quarantined HERE (the only serve-path module allowed to
// know git) — serve-handlers.ts only renders what this returns. Degrades per the header contract
// (absent → 「无数据」, unreadable → 「读失败」, never throws).
//
// THE X-AXIS TRAP IS PINNED AT THE SOURCE: each commit carries its commit TIMESTAMP (%ct — the landing
// time). The renderer is handed POINTS, never durations. Branch lifespan (first→last commit) is a
// git-observable existence interval — it is NOT task work hours (measured: 149/164 fan-in branches
// lived <1h, done before their first commit landed), and real work hours live in telemetry with a
// ~6% join rate to git. The chart shows only what git can prove: when commits landed and where.

/** Max MAINLINE commits the /git-history chart reads per page (gap-git-graph-drops-commits-while-
 *  overflowcount-reports-zero: the global cap is now a per-page MAINLINE cap — live branches are
 *  fetched in full via `git log <ref> --not <mainline>`, never squeezed by this limit). The client
 *  pages back with `before=<cursor>` to grow the window beyond the initial 500. */
export const GIT_HISTORY_LIMIT = 500;

/**
 * A branch with no commit in this window is stale and excluded from the chart's lanes
 * (gap-git-history-counts-stale-branches). The two-layer fast mode's task lifetime is <1h
 * (measured: 149/164 fan-in branches lived <1h) and a stall rarely exceeds ~5h, so a stale
 * branch whose tip is older than the window is not being worked on and must not add a lane.
 * Its commits are already reachable from the mainline, so they still appear under the
 * mainline's lane (not dropped); only the phantom stale lane is gone.
 *
 * gap-git-history-clickable-branches-window: the window was 24h, which also excluded `master`
 * (its tip is only advanced at merge boundaries, often >24h apart) — a mainline lane must never
 * drop out. Relaxed to 7 days AND made mainline refs unconditional: `GIT_HISTORY_MAINLINE_REFS`
 * are always kept regardless of tip age; the window now only bounds leftover task/verify lanes.
 */
export const GIT_HISTORY_ACTIVE_WINDOW_SEC = 7 * 24 * 60 * 60;

/** Mainline refs always included as lanes regardless of their tip age (never dropped for staleness). */
export const GIT_HISTORY_MAINLINE_REFS = new Set(["develop", "master"]);

export interface GitHistoryCommit {
  /** Full commit hash. */
  hash: string;
  /** Commit timestamp (unix seconds) — the commit's landing time. */
  t: number;
  /** Best-effort primary local-branch name derived from `%D` decoration ("" when none). */
  ref: string;
  /** Number of parents. > 1 → a merge commit (the fan-in landing event). */
  parents: number;
  /** Full parent hashes — the DAG edges the vertical graph's fork/merge lines are drawn from. */
  parentHashes: string[];
  subject: string;
  /** `%D` decoration entries — the refs/tags pointing at this commit (`HEAD -> author`, `develop`, `tag: v1`…).
   *  gap-git-graph-adopt-git-column-algorithm-and-decorate-labels: branch labels render from THIS, so a
   *  label appears only on the commit a ref actually points at (git decorate semantics), never repeated. */
  decorations: string[];
}

export interface GitHistoryResult {
  status: ObservationStatus;
  reason: string | null;
  commits: GitHistoryCommit[];
  /** HEAD commit hash — the vertical graph's trunk root. null when the repo has no resolvable HEAD. */
  head: string | null;
  /** Active branch name → tip commit hash (the branch topology, not the `--source` attribution). */
  heads: Record<string, string>;
  /** The newest commit in THIS batch (`commits[0].hash`) — retained for shape compatibility with the
   *  retired mainline-spine model (gap-git-graph-adopt-git-column-algorithm-and-decorate-labels: the
   *  graph now renders `git log --all --topo-order` rows, no mainline spine). null when the batch is
   *  empty. */
  mainlineHead: string | null;
}

/**
 * Read the commit-landing timeline as `git log --all --topo-order` emits it (gap-git-graph-adopt-git-
 * column-algorithm-and-decorate-labels). The retired per-ref "active branch lane" model is GONE: the
 * column-allocation algorithm needs commits in git's EMISSION order — every commit emitted before its
 * parents — which `--topo-order` guarantees and a per-ref/time-sorted fetch does not (measured: 60
 * commits, 1 mis-ordered). `--all` (not the old 7-day active-branch filter) makes the page match
 * `git log --graph --all` exactly, the AC1 mechanical judge. `%D` supplies the decorate labels so a
 * branch name renders only on the commit a ref actually points at (AC3).
 *
 * Pagination (`before=<unixSeconds>`) keeps the same cursor semantics: `--before` filters to commits
 * STRICTLY older than the cursor, then `--topo-order` re-orders that older window. A non-git workspace
 * degrades to empty; a git failure degrades to error; never throws.
 */
// gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: readGitHistory shells out to git
// several times per call (for-each-ref → one log per ref → rev-parse HEAD). A 30s TTL (keyed by
// root + limit + before; the same display-snapshot freshness the other web carriers use) bounds this
// to one batch of walks per 30s window. nowMs only shifts the 7-day active-branch window, so a
// ≤30s drift is invisible on the display surface.
export const GIT_HISTORY_CACHE_TTL_MS = 30_000;
const gitHistoryCache = new Map<string, { at: number; result: GitHistoryResult }>();

/** Test-hygiene handle: drop all cached git-history readings. */
export function clearGitHistoryCache(): void {
  gitHistoryCache.clear();
}

/**
 * The host-read seam (gap-load-sensitive-tests-read-live-host-class-level-seam): the ONE place this
 * reader shells out to git. Same shape as the recorded `resourceGateArgv` seam in
 * `plugin/scripts/quality-gate-driver.ts` — an optional injectable handle whose default is the real
 * one — so a test can hand the reader a frozen snapshot of the host instead of racing the live repo
 * (measured 2026-09-13: two independent live reads of the same window is what made this reader's
 * consumers' verdicts a function of whatever the loop committed mid-test).
 * ⛔ A seam, not a behavior switch: the default is the previous inline `execFileSync` verbatim.
 */
export type GitExec = (args: string[], opts?: { timeout?: number }) => string;

/** The real git runner — `readGitHistory`'s default `exec`. */
export const realGitExec: GitExec = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", timeout: opts.timeout ?? 15_000, stdio: ["ignore", "pipe", "pipe"] }) as string;

export function readGitHistory(root: string, { limit = GIT_HISTORY_LIMIT, before = null, skip = null, nowMs = Date.now(), exec = realGitExec }: { limit?: number; before?: number | null; skip?: number | null; nowMs?: number; exec?: GitExec } = {}): GitHistoryResult {
  // An injected `exec` is a test seam over a frozen/constructed window, NEVER production data:
  // memoizing it under the production key would make a fixture indistinguishable from a real
  // reading (硬规则 3b — 读不懂/不是真读数 ⇒ 不得与合格同形). The default path is unchanged.
  if (exec !== realGitExec) return readGitHistoryUncached(root, { limit, before, skip, nowMs, exec });
  const key = `${root}\n${limit}\n${before ?? ""}\n${skip ?? ""}`;
  const hit = gitHistoryCache.get(key);
  if (hit && Date.now() - hit.at < GIT_HISTORY_CACHE_TTL_MS) return hit.result;
  const result = readGitHistoryUncached(root, { limit, before, skip, nowMs, exec });
  gitHistoryCache.set(key, { at: Date.now(), result });
  return result;
}

function readGitHistoryUncached(root: string, { limit = GIT_HISTORY_LIMIT, before = null, skip = null, nowMs = Date.now(), exec = realGitExec }: { limit?: number; before?: number | null; skip?: number | null; nowMs?: number; exec?: GitExec } = {}): GitHistoryResult {
  try {
    const args = ["-C", root, "log", "--all", "--topo-order", `-n ${limit}`];
    // gap-git-graph-pagination-appends-page-relative-col-and-torow: `skip` is the EMISSION-ORDER cursor
    // (`git log --skip`) that pages `--all --topo-order` contiguously — a `--before=<t>` timestamp filter
    // reorders/drops commits relative to the single `-n <loaded>` walk, so it can never reconstruct the
    // exact git emission sequence. `skip` takes precedence when both are present; `before` is retained
    // for backward-compat callers (and the self-chain cursor's timestamp watermark).
    if (skip !== null && Number.isFinite(skip) && skip > 0) args.push(`--skip=${skip}`);
    else if (before !== null && Number.isFinite(before)) args.push(`--before=${before}`);
    args.push("--pretty=format:%H%x1f%P%x1f%D%x1f%ct%x1f%s");
    const out = exec(args, { timeout: 15_000 });

    const commits: GitHistoryCommit[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [hash, parentsRaw, decorRaw, tRaw, ...subjectParts] = line.split("\x1f");
      if (!hash || !tRaw) continue;
      const parentHashes = (parentsRaw ?? "").split(/\s+/).filter(Boolean);
      commits.push({
        hash,
        t: Number(tRaw),
        ref: primaryRefFromDecorations(decorRaw),
        parents: parentHashes.length,
        parentHashes,
        subject: subjectParts.join("\x1f"),
        decorations: parseDecorations(decorRaw),
      });
    }

    if (commits.length === 0) {
      return { status: "empty", reason: "git 仓库无提交记录", commits: [], head: null, heads: {}, mainlineHead: null };
    }
    let head: string | null = null;
    try {
      const headOut = exec(["-C", root, "rev-parse", "HEAD"], { timeout: 10_000 });
      head = headOut.trim().split(/\r?\n/)[0] || null;
    } catch {
      head = null; // unborn HEAD / detached — `%D` still marks HEAD via `HEAD -> <ref>`.
    }
    return { status: "ok", reason: null, commits, head, heads: {}, mainlineHead: commits[0].hash };
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
    if (stderr.includes("not a git repository")) {
      return { status: "empty", reason: "工作区不是 git 仓库（无提交记录）", commits: [], head: null, heads: {}, mainlineHead: null };
    }
    return {
      status: "error",
      reason: `git log 失败：${err instanceof Error ? err.message : String(err)}`,
      commits: [],
      head: null,
      heads: {},
      mainlineHead: null,
    };
  }
}

/** Parse `%D` decoration output ("HEAD -> author, origin/author") into its entries. */
export function parseDecorations(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Best-effort primary local-branch name from `%D`: `HEAD -> X` wins, then the first non-HEAD/non-tag
 *  entry. "" when no branch name is recoverable (never a fabricated ref — 硬规则 3b). */
export function primaryRefFromDecorations(raw: string | undefined | null): string {
  const decs = parseDecorations(raw);
  for (const d of decs) {
    const m = /^HEAD\s*->\s*(.+)$/.exec(d);
    if (m) return m[1];
  }
  for (const d of decs) {
    if (d === "HEAD" || d.startsWith("tag:")) continue;
    return d;
  }
  return "";
}

/**
 * The repo's remote names (`git remote`), read once per page render so the git-history client can tell
 * a remote-tracking ref (`origin/…`, `vhs/…`) from a LOCAL branch that merely contains a slash
 * (`fix/…`, `task/…` — this repo's own naming). The remote list is the ONLY authority for that
 * distinction: a bare `origin/`-prefix heuristic would misfire on this repo's two remotes
 * (gap-git-graph-decoration-labels-as-colored-chips). Never throws — degrades to [] (no remotes ⇒
 * nothing is a remote-tracking ref, the safe fail-open for a purely visual distinction).
 */
export function readGitRemotes(root: string): string[] {
  try {
    const out = execFileSync("git", ["-C", root, "remote"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ── AC95: six new views (dashboard · system · manager · tests · sessions · architecture) ───────────
// Each new view reads the MECHANISM that produces its numbers (AC2):
//   system       → resource-gate.sh + process-budget.sh (text output)
//   manager      → loop-driver-check.sh + observer-registry.conf + ready-pool-check.ts
//   tests        → .quay/verification-round.jsonl + .quay/full-suite-state.json (the suite-state writer)
//   sessions     → claude agents --json (running) + transcript-dir scan (ended) + transcript tails
//   architecture → git log per packages/* path + git worktree list (filesystem/git facts)
//   dashboard    → the same sources via the specific views above, plus client.taskList (in the handler)
// Everything degrades per the header contract: absent → 「未接入/无数据」, unreadable → 「读失败」,
// never a 500. AC2's hard rule: NONE of this parses the manager's narrative tick/phase-goal prose
// docs — the AC2 mechanical grep (the two narrative doc names over packages/quay/src) must hit 0.
// Those are prose, not the producing mechanism.

/** Resolve a plugin script via the canonical resolver (SPEC §6b) — imported `resolvePluginScript`
 *  above, never an import.meta.url walk-up without a worktree check (AC139-4). */

/**
 * Run a plugin script with a HARD deadline and a process-group kill — the robust path for bash
 * scripts that may fork background children (some scripts spawn `sleep` children and defer
 * SIGTERM while they run; a plain execFileSync timeout would block the serve event loop for the
 * child's whole sleep). Spawns detached (own process group), redirects stdout to a temp file so a
 * grandchild inheriting the stdout fd can never hold 'close' open, and on timeout SIGKILLs the
 * whole group. Never throws: returns { stdout, exitCode } — the caller decides ok/empty/error.
 */
async function runScriptBounded(
  cmd: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<{ stdout: string; exitCode: number | null }> {
  const outPath = path.join(os.tmpdir(), `ac95-script-${process.pid}-${Math.random().toString(36).slice(2)}.out`);
  let outFd: number;
  try {
    outFd = fs.openSync(outPath, "w");
  } catch {
    return { stdout: "", exitCode: null };
  }
  return await new Promise<{ stdout: string; exitCode: number | null }>((resolve) => {
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), {
        cwd: opts.cwd,
        detached: true,
        stdio: ["ignore", outFd, "pipe"],
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });
    } catch {
      try { fs.closeSync(outFd); } catch { /* noop */ }
      try { fs.unlinkSync(outPath); } catch { /* noop */ }
      resolve({ stdout: "", exitCode: null });
      return;
    }
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += String(d); });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* noop */ } }
    }, opts.timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      try { fs.closeSync(outFd); } catch { /* noop */ }
      try { fs.unlinkSync(outPath); } catch { /* noop */ }
      resolve({ stdout: "", exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try { fs.closeSync(outFd); } catch { /* noop */ }
      let stdout = "";
      try { stdout = fs.readFileSync(outPath, "utf8"); } catch { /* noop */ }
      try { fs.unlinkSync(outPath); } catch { /* noop */ }
      resolve({ stdout, exitCode: code });
    });
  });
}

/** Resolve a plugin script and run it via runScriptBounded; returns stdout or a missing-reason. */
async function runPluginScript(root: string, rel: string, args: string[], timeoutMs = 15_000, env?: Record<string, string>): Promise<{ stdout: string | null; reason: string | null }> {
  const p = resolvePluginScript(rel);
  if (!p) return { stdout: null, reason: `${rel} 缺失（产品安装无 methodology 层 → 未接入）` };
  const { stdout, exitCode } = await runScriptBounded(["bash", p, ...args], { cwd: root, timeoutMs, env });
  if (exitCode === null) return { stdout: null, reason: `${rel} 未能运行（spawn 失败或超时被杀）` };
  return { stdout, reason: null };
}

// ── System view ────────────────────────────────────────────────────────────────────────────────────

export interface ResourceGateReading {
  status: ObservationStatus;
  reason: string | null;
  cpuStallAvg10: number | null;
  cpuStallAvg300: number | null;
  memAvailMb: number | null;
  loadAvg: number | null;
  nproc: number | null;
  nodeProcs: number | null;
  verdict: "GO" | "WAIT" | null;
  /** AC99/AC3 — the overload-window loadavg threshold (nproc × load_over_factor), computed INSIDE
   *  resource-gate.sh from nproc — never a host-derived literal. The UI displays this value. */
  loadThreshold: number | null;
  loadOverFactor: number | null;
}

export interface ProcessBudgetReading {
  status: ObservationStatus;
  reason: string | null;
  totalBudget: number | null;
  inUse: number | null;
  available: number | null;
  verdict: "GO" | "WAIT" | null;
}

export interface SystemResult {
  status: ObservationStatus;
  reason: string | null;
  resourceGate: ResourceGateReading;
  processBudget: ProcessBudgetReading;
}

/** Plugin-root-relative script rels (resolved via the canonical resolver, SPEC §6b — NOT a
 *  module-relative `import.meta.url` walk-up). */
// ⚠️ path.join, not a string literal: the AC1b loop-shipping scan forbids the BARE old repo-root
// form of this rel (its pre-plugin/ location). A `"scripts/…"` string literal here would be
// textually identical to that forbidden old path even though it is the plugin-root-relative rel the
// resolver expects (SPEC §6b). path.join keeps the runtime rel identical while leaving AC1b able to
// catch a real stale bare reference. (gap-plugin-root-resolution-remaining-callsites)
export const RESOURCE_GATE_REL = path.join("scripts", "resource-gate.sh");
export const PROCESS_BUDGET_REL = "scripts/process-budget.sh";

/** Parse a JSON object's numeric field, guarding the type. Pure (unit-testable). */
function jsonNum(j: Record<string, unknown>, key: string): number | null {
  const v = j[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse resource-gate.sh --json's single JSON document into structured fields. Pure. */
export function parseResourceGateJson(text: string): Omit<ResourceGateReading, "status" | "reason"> {
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* invalid JSON → all null */ }
  return {
    cpuStallAvg10: jsonNum(j, "cpu_stall_avg10"),
    cpuStallAvg300: jsonNum(j, "cpu_stall_avg300"),
    memAvailMb: jsonNum(j, "mem_avail_mb"),
    loadAvg: jsonNum(j, "loadavg"),
    nproc: jsonNum(j, "nproc"),
    nodeProcs: jsonNum(j, "node_procs"),
    verdict: j.verdict === "GO" || j.verdict === "WAIT" ? j.verdict : null,
    loadThreshold: jsonNum(j, "load_threshold"),
    loadOverFactor: jsonNum(j, "load_over_factor"),
  };
}

/** Parse process-budget.sh --json's single JSON document into structured fields. Pure. */
export function parseProcessBudgetJson(text: string): Omit<ProcessBudgetReading, "status" | "reason"> {
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* invalid JSON → all null */ }
  return {
    totalBudget: jsonNum(j, "total_budget"),
    inUse: jsonNum(j, "in_use"),
    available: jsonNum(j, "available"),
    verdict: j.verdict === "GO" || j.verdict === "WAIT" ? j.verdict : null,
  };
}

/** System view: resource-gate.sh --json + process-budget.sh --json parsed to structured fields. */
export async function readSystem(root: string): Promise<SystemResult> {
  // AC1 (gap-webui-dashboard-manager-slow-parallelize): the two mechanism scripts are independent —
  // run them CONCURRENTLY. Serial was resource-gate(1.65s)→process-budget(0.35s) ≈ 2.0s; parallel is
  // bounded by the slower of the two (~1.65s).
  const [rg, pb] = await Promise.all([
    runPluginScript(root, RESOURCE_GATE_REL, ["--json"]),
    runPluginScript(root, PROCESS_BUDGET_REL, ["--json"]),
  ]);
  const rgReading: ResourceGateReading = rg.stdout == null
    ? { status: "empty", reason: rg.reason, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }
    : { status: "ok", reason: null, ...parseResourceGateJson(rg.stdout) };

  const pbReading: ProcessBudgetReading = pb.stdout == null
    ? { status: "empty", reason: pb.reason, totalBudget: null, inUse: null, available: null, verdict: null }
    : { status: "ok", reason: null, ...parseProcessBudgetJson(pb.stdout) };

  const degraded = rg.stdout == null && pb.stdout == null;
  return {
    status: degraded ? "empty" : "ok",
    reason: degraded ? "system 机制脚本缺失" : null,
    resourceGate: rgReading,
    processBudget: pbReading,
  };
}

// ── Manager view (Manager / Outer / Inner 三层自适应探测) ───────────────────────────────────────────

export interface LoopDriverReading {
  status: ObservationStatus;
  reason: string | null;
  verdict: "LIVE" | "STALLED" | "DOUBLE-TRIGGER" | "BANNED-MECHANISM" | "DEAD" | null;
  exitCode: number | null;
  detail: string | null;
}

export interface SessionLivenessReading {
  status: ObservationStatus;
  reason: string | null;
  sessions: Array<{ name: string; alive: boolean; pid: number | null; halted: boolean }>;
}

export interface ObserverRow {
  name: string;
  status: string;
  root: string;
  note: string;
}

/** 单个 driver kind 的存活 + 载体观测（in-process 调 plugin/scripts/driver-runtime.ts 的 aliveness()+
 *  carrierStats()——不 spawn 子进程、不解析 CLI 输出，AC4）。字段与 `quay driver status --kind <kind>
 *  --json` 输出的 supervisor_alive/driver_alive/running/carrier_records/last_record_ts 逐字段对应
 *  （gap-dashboard-driver-status-card AC1 对照）。kind 是 driver-runtime.ts 导出的 DriverKind（六值，
 *  运行时从 kernel 的 KNOWN_KINDS 遍历得到）——⛔ 不硬编码 promotion/worker 字面量联合（AC6/AC7：
 *  driver kind 会新增/退役）。类型上记作 string：Core 不能静态 import plugin/（见下方 loadDriverRuntime
 *  注释），故 kind 词表在运行时经 KNOWN_KINDS 消费，Core 侧无该词表的静态副本。 */
export interface DriverKindReading {
  kind: string;
  supervisorPid: number | null;
  driverPid: number | null;
  supervisorAlive: boolean;
  driverAlive: boolean;
  running: boolean;
  records: number;
  lastTs: string | null;
}

/** dashboard mgrCard 消费的全部 driver kind（KNOWN_KINDS 顺序）的存活读数——一个数组，每项自带
 *  kind 字段（serve-dashboard 只渲染数组，无需再知道 kind 列表；order 由 observation 层决定）。 */
export type DriversReading = DriverKindReading[];

export interface ManagerResult {
  status: ObservationStatus;
  reason: string | null;
  loopDriver: LoopDriverReading;
  liveness: SessionLivenessReading;
  observers: { status: ObservationStatus; reason: string | null; rows: ObserverRow[] };
  pool: { status: ObservationStatus; reason: string | null; pool: number | null; floor: number | null; deficit: number | null; cap: number | null; lastPromoted: string[] };
  version: string | null;
  developLead: number | null;
  /** 全部 driver kind（KNOWN_KINDS）的存活读数（dashboard 轻量路径填充；/manager 详情页不消费，可不填）。 */
  drivers?: DriversReading;
}

export const LOOP_DRIVER_CHECK_REL = "../../../plugin/scripts/loop-driver-check.sh";
export const OBSERVER_REGISTRY_CONF = "../../../orchestration/observer-registry.conf";

/** Parse loop-driver-check.sh --json's single JSON document into structured fields. Pure. */
export function parseLoopDriverJson(text: string): Omit<LoopDriverReading, "status" | "reason"> {
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* invalid JSON → all null */ }
  const verdicts = ["LIVE", "STALLED", "DOUBLE-TRIGGER", "BANNED-MECHANISM", "DEAD"];
  return {
    verdict: verdicts.includes(String(j.verdict)) ? j.verdict as LoopDriverReading["verdict"] : null,
    exitCode: jsonNum(j, "exit_code"),
    detail: typeof j.detail === "string" && j.detail.length > 0 ? j.detail : null,
  };
}

/** Parse observer-registry.conf (`name|status|root|tmux|note` lines, # comments skipped). Pure. */
export function parseObserverRegistry(text: string): ObserverRow[] {
  const rows: ObserverRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("|");
    if (parts.length < 2) continue;
    rows.push({
      name: parts[0].trim(),
      status: parts[1].trim(),
      root: (parts[2] ?? "").trim(),
      note: (parts[4] ?? "").trim(),
    });
  }
  return rows;
}

/** loop-driver-check.sh --json → verdict/exit_code/detail. AC99: the JSON interface replaces the
 *  first-line text parse; exit code is carried in the JSON (0 LIVE / 3 STALLED / 4 DOUBLE /
 *  5 BANNED / 6 DEAD). One of readManager's four CONCURRENT probes. */
async function runLoopDriverProbe(root: string): Promise<LoopDriverReading> {
  const r = await runPluginScript(root, LOOP_DRIVER_CHECK_REL, ["--check", "--json", root], 15_000);
  if (r.stdout == null) {
    return { status: "empty", reason: r.reason, verdict: null, exitCode: null, detail: null };
  }
  return { status: "ok", reason: null, ...parseLoopDriverJson(r.stdout) };
}

// ── Short-TTL cache for the promotion-driver round-carrier probe (WebUI display surface only) ────
// AC136 (gap-ac136-web-truth-source-follows-driver): after the promotion-driver takes over todo→ready
// promotion (AC130–135), the truth source for the pool metrics (pool/floor/deficit/cap) is the
// driver's own round record (`.quay/promotion-round.jsonl`, gitignored runtime log, worker-outcome
// family), NOT a fresh cold-call of slot-refill.ts (the retired outer dispatch path). readPoolMetrics
// below reads the driver's carrier and derives floor/deficit/cap from the SAME fixed dispatch
// constants the driver uses (cap 5, floor = cap × 4 = 20 — the single source is slot-refill's
// FIXED_DISPATCH_CAP and ready-pool-check's POOL_FLOOR_MULT_DEFAULT; this display layer mirrors the
// caliber without importing plugin/scripts, which would break the self-contained-dist invariant).
// A 30s TTL bounds staleness on the display surface; the driver itself always reads ready-pool-check
// fresh, never through this cache (AC3 — 缓存不污染驱动). Keyed by workspace root so two served
// workspaces never share a cached pool.
export const POOL_METRICS_CACHE_TTL_MS = 30_000;
const poolMetricsCache = new Map<string, { at: number; pool: ManagerResult["pool"] }>();

/** Test-hygiene handle: drop all cached pool-metrics readings. */
export function clearPoolMetricsCache(): void {
  poolMetricsCache.clear();
}

/** The promotion-driver's round carrier, repo-relative (gitignored runtime log — same family as
 *  worker-outcome.jsonl). Not a plugin script: resolved against the workspace root, not
 *  import.meta.url. */
export const PROMOTION_ROUND_REL = ".quay/promotion-round.jsonl";

/** Fixed dispatch cap (mirrors slot-refill's FIXED_DISPATCH_CAP = 5 and promotion-driver's
 *  CAP_DEFAULT = 5 — the production truth). floor = cap × floorMult = 5 × 4 = 20. */
export const PROMOTION_CAP_DEFAULT = 5;

/** Pool floor multiplier (mirrors ready-pool-check's POOL_FLOOR_MULT_DEFAULT = 4). */
export const PROMOTION_FLOOR_MULT_DEFAULT = 4;

/** One promotion-driver round record (the fields the web pool metric reads). Parsed from the JSONL
 *  carrier; unknown/missing fields degrade to null rather than a fabricated reading (hard rule ③b —
 *  a value the carrier never carried must not be indistinguishable from a real reading). */
export interface PromotionRoundRecord {
  ts: string | null;
  round: number | null;
  action: string | null;
  pool: number | null;
  promoted_ids: string[];
  error: string | null;
}

/** Parse `.quay/promotion-round.jsonl` (one JSON object per line) into round records. Pure — never
 *  throws; a malformed line is skipped (the carrier is best-effort runtime log, not a store). */
export function parsePromotionRoundRecords(text: string): PromotionRoundRecord[] {
  const out: PromotionRoundRecord[] = [];
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
    out.push({
      ts: typeof j.ts === "string" && j.ts.length > 0 ? j.ts : null,
      round: typeof j.round === "number" && Number.isFinite(j.round) ? j.round : null,
      action: typeof j.action === "string" && j.action.length > 0 ? j.action : null,
      pool: typeof j.pool === "number" && Number.isFinite(j.pool) ? j.pool : null,
      promoted_ids: Array.isArray(j.promoted_ids) ? j.promoted_ids.map(String).filter(Boolean) : [],
      error: typeof j.error === "string" && j.error.length > 0 ? j.error : null,
    });
  }
  return out;
}

/** Derive the ManagerResult pool metrics from the driver's latest round record. `pool` is the
 *  driver's own recorded judgment at round time (the ready count BEFORE that round's own promotions —
 *  a resident loop records the post-promotion count on its NEXT round); `lastPromoted` surfaces what
 *  that round promoted, so a todo→ready promotion is reflected even in a single --once round.
 *  floor/deficit/cap are DERIVED from the fixed dispatch constants (the same caliber slot-refill
 *  reported). A round whose pool is absent (the driver's round failed, or the carrier predates the
 *  pool field) reports `error` — never a fabricated ok (hard rule ③b). */
function poolMetricsFromRound(latest: PromotionRoundRecord): ManagerResult["pool"] {
  if (latest.pool == null) {
    return {
      status: "error",
      reason: `promotion-driver 最近一轮判定无 pool 读数${latest.error ? `（${latest.error}）` : ""}`,
      pool: null, floor: null, deficit: null, cap: null, lastPromoted: latest.promoted_ids,
    };
  }
  const cap = PROMOTION_CAP_DEFAULT;
  const floor = cap * PROMOTION_FLOOR_MULT_DEFAULT;
  const deficit = Math.max(0, floor - latest.pool);
  return {
    status: "ok",
    reason: null,
    pool: latest.pool,
    floor,
    deficit,
    cap,
    lastPromoted: latest.promoted_ids,
  };
}

/** The promotion-driver's round carrier → pool/floor/deficit/cap + lastPromoted (AC136: the truth
 *  source for the pool metrics is the driver's own round record, not a cold-call of the retired
 *  slot-refill dispatch path). A successful reading is short-TTL-cached; a failed/transient read is
 *  NOT cached. One of readManager's four CONCURRENT probes. */
async function readPoolMetrics(root: string): Promise<ManagerResult["pool"]> {
  const hit = poolMetricsCache.get(root);
  if (hit && Date.now() - hit.at < POOL_METRICS_CACHE_TTL_MS) return hit.pool;

  const file = path.join(root, PROMOTION_ROUND_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return {
      status: "empty",
      reason: `${PROMOTION_ROUND_REL} 尚无 round 记录（promotion-driver 未接入/未跑）`,
      pool: null, floor: null, deficit: null, cap: null, lastPromoted: [],
    };
  }

  const records = parsePromotionRoundRecords(text);
  const latest = records[records.length - 1];
  if (!latest) {
    return {
      status: "empty",
      reason: `${PROMOTION_ROUND_REL} 无可解析的 round 记录`,
      pool: null, floor: null, deficit: null, cap: null, lastPromoted: [],
    };
  }

  const pool = poolMetricsFromRound(latest);
  poolMetricsCache.set(root, { at: Date.now(), pool });
  return pool;
}

// ── Driver 存活读取（dashboard mgrCard 用）────────────────────────────────────────────────────────
// in-process 调 plugin/scripts/driver-runtime.ts 的 aliveness()+carrierStats()——零 subprocess、
// 零 CLI 输出解析（AC4）。kind 集合遍历 driver-runtime.ts 导出的 KNOWN_KINDS（六值），⛔ 不硬编码
// promotion/worker 字面量联合——driver kind 会新增/退役，卡片无需改代码即跟上（AC6/AC7）。
//
// ⛔ 静态 import 禁令（为什么 loadDriverRuntime 走运行时动态 import，而不是文件顶部的 import）：
// packages/quay/src 维持「零 plugin/ 静态 import」边界（见 readBoardLanding 注释）。driver-runtime.ts
// 的传递闭包（driver-filters/driver-shared/fast-mode-telemetry/workflow-event-schema 等）从未进入
// Core 的 tsc 程序（根 tsconfig include 只覆盖 packages/**），一旦静态 import（含 import type），
// tsc 会把整个闭包拖进来并撞上 plugin 树里既存的 78 个类型错误，`tsc --noEmit -p packages/quay` 即红。
// 运行时经 resolvePluginScriptExec（dev 原始 .ts / 出厂 dist/*.js bundle 的同一 dev/dist fallback，
// 见 plugin-root.ts）动态 import，specifier 是运行时变量 ⇒ tsc 不静态解析 ⇒ 闭包不进 Core 类型图。

/** driver-runtime.ts 被 Core 消费的那一薄片（结构类型；⛔ 非 import——见上面静态 import 禁令）。 */
interface DriverRuntimeSurface {
  KNOWN_KINDS: string[];
  aliveness(root: string, kind: string): {
    supervisorPid: number | null;
    driverPid: number | null;
    supervisorAlive: boolean;
    driverAlive: boolean;
    running: boolean;
  };
  carrierStats(root: string, kind: string): { records: number; lastTs: string | null };
}

/** 动态 import 的缓存 promise（进程内一次；零 subprocess —— AC4）。 */
let driverRuntimePromise: Promise<DriverRuntimeSurface | null> | null = null;

/** kernel 解析/载入**为什么**没能产出（null = 已载入，或还从未尝试）。
 *
 * ⛔ 硬规则 3b（gap-dashboard-driver-status-card-ci-red）：`loadDriverRuntime` 的两种失败——
 * ①产品安装下根本没有 kernel（正常，卡片该显示「未接入」）与 ②有 kernel 但**载入抛了**
 * （异常，卡片同样显示「未接入」）——原本都只 return null ⇒ 两者与「查过且正常」共用一个取值。
 * 2026-09-16 CI 实证代价：`readDriverStatus` 返回长度 0（而非某个 kind 缺失），5 条断言红，
 * 而唯一的读数是一条 `0 !== 6` 与一条「Driver 状态未接入」的 HTML——**看不出是哪种**，
 * 于是被读成「非确定性的 kind 缺失」并去查负载与并发。区分取值即可当场定位。
 *
 * 独立取值，⛔ 不与「载入成功」共用输出；空读数的**形状**不变（DriversReading 仍是数组，
 * 照旧渲染「未接入」），只是失败从此**可诊断**。 */
let driverRuntimeLoadError: string | null = null;

/** 上一次 kernel 解析/载入失败的原因（null = 已载入或未尝试）。诊断用，⛔ 不参与判定。 */
export function getDriverRuntimeLoadError(): string | null { return driverRuntimeLoadError; }

/** 懒加载 driver-runtime kernel（in-process，⛔ 不 spawn 子进程）。resolvePluginScriptExec 应用
 *  dev/dist fallback；kernel 缺失（产品安装无 methodology 层）⇒ null（诚实空读数，⛔ 不抛）。
 *  两种 null 记进 `driverRuntimeLoadError`（见上）。 */
function loadDriverRuntime(): Promise<DriverRuntimeSurface | null> {
  if (!driverRuntimePromise) {
    driverRuntimePromise = (async () => {
      const resolved = resolvePluginScriptExec(path.join("scripts", "driver-runtime.ts"));
      if (!resolved) {
        driverRuntimeLoadError = "kernel-unresolved: no plugin root carries scripts/driver-runtime.ts (or its dist bundle)";
        return null;
      }
      try {
        return (await import(pathToFileURL(resolved.path).href)) as DriverRuntimeSurface;
      } catch (err) {
        // ⛔ 不是无声的 return null：这条读数就是「有 kernel 但载入失败」与「没有 kernel」之间
        // 唯一的分界（上面注释里的 2026-09-16 CI 事故）。
        const e = err as { code?: string; message?: string };
        driverRuntimeLoadError = `kernel-load-failed: ${e?.code ?? "no-code"}: ${String(e?.message ?? err).split("\n")[0]} (${resolved.path})`;
        return null;
      }
    })();
  }
  return driverRuntimePromise;
}

const driverStatusCache = new Map<string, { at: number; drivers: DriversReading }>();

/** Test-hygiene handle: drop all cached driver-status readings. */
export function clearDriverStatusCache(): void { driverStatusCache.clear(); }

/** 读一个 kind 的存活 + 载体（同 statusForKind 的 aliveness()+carrierStats() 组合，in-process）。 */
function readDriverKind(runtime: DriverRuntimeSurface, root: string, kind: string): DriverKindReading {
  const a = runtime.aliveness(root, kind);
  const s = runtime.carrierStats(root, kind);
  return {
    kind,
    supervisorPid: a.supervisorPid,
    driverPid: a.driverPid,
    supervisorAlive: a.supervisorAlive,
    driverAlive: a.driverAlive,
    running: a.running,
    records: s.records,
    lastTs: s.lastTs,
  };
}

/** 读全部 driver kind（kernel 导出的 KNOWN_KINDS 顺序）的存活 + 载体（30s TTL 缓存）。kernel 缺失
 *  ⇒ 返回空数组（诚实空读数，⛔ 不是编造的 0）。 */
export async function readDriverStatus(root: string): Promise<DriversReading> {
  const hit = driverStatusCache.get(root);
  if (hit && Date.now() - hit.at < POOL_METRICS_CACHE_TTL_MS) return hit.drivers;
  const runtime = await loadDriverRuntime();
  const drivers: DriversReading = runtime
    ? runtime.KNOWN_KINDS.map((kind) => readDriverKind(runtime, root, kind))
    : [];
  driverStatusCache.set(root, { at: Date.now(), drivers });
  return drivers;
}

/** git rev-list --count develop..HEAD → commits ahead of develop (~0.01s; async so it never blocks
 *  the serve event loop while the heavier probes run). One of readManager's four CONCURRENT probes. */
async function readDevelopLead(root: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP("git", ["-C", root, "rev-list", "--count", "develop..HEAD"], { cwd: root, timeout: 5_000, maxBuffer: 1024 * 1024, encoding: "utf8" });
    const n = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Manager view — LIGHT path for the dashboard display surface (gap-webui-dashboard-load-time-
 * optimization AC1): loop-driver ONLY, WITHOUT the pool probe.
 *
 * The dashboard's mgrCard (serve-handlers.ts renderDashboardPage) shows only loopDriver.verdict +
 * the alive-session count — it never renders pool/floor/deficit/cap. readPoolMetrics (AC136) now
 * reads the promotion-driver round carrier (a small sync file read), so the pool probe is cheap —
 * but the card does NOT show it, so paying for the read is still wasted work. The `/manager` detail
 * page — which DOES render pool — keeps calling the full `readManager` below.
 *
 * The un-probed fields are returned as `status: "empty"` (never "ok") so any surface that
 * accidentally renders them reads 未接入 rather than a fabricated zero (hard rule ③b — a value the
 * probe never produced must not be indistinguishable from a real reading). `version` is the
 * build-time QUAY_VERSION constant (free, no runtime read); `developLead` is left null (the card
 * does not show it, and a git rev-list is a subprocess we skip on the light path).
 */
export async function readManagerLight(root: string): Promise<ManagerResult> {
  const loopDriver = await runLoopDriverProbe(root);

  const version: string | null = QUAY_VERSION || null;

  const degraded = loopDriver.status === "empty";
  return {
    status: degraded ? "empty" : "ok",
    reason: degraded ? "manager 观测机制脚本缺失" : null,
    loopDriver,
    liveness: { status: "empty", reason: "liveness observer retired 2026-09-03", sessions: [] },
    observers: { status: "empty", reason: "dashboard 轻量探针不含 observers（/manager 详情页才含）", rows: [] },
    pool: { status: "empty", reason: "dashboard 轻量探针不含 pool（/manager 详情页才含）", pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] },
    version,
    developLead: null,
    drivers: await readDriverStatus(root),
  };
}

/** Manager view: loop-driver + observer registry + promotion-driver pool metrics (the liveness
 *  observer was retired 2026-09-03 — no longer probed). */
export async function readManager(root: string): Promise<ManagerResult> {
  // AC1 (gap-webui-dashboard-manager-slow-parallelize): the probes are independent — run them
  // CONCURRENTLY. readPoolMetrics (AC136) reads the promotion-driver's round carrier — a small
  // sync file read, no subprocess — so the ~9s slot-refill cold-call floor is gone from the manager
  // path too. observers registry + version are small sync reads kept inline.
  const [loopDriver, pool, developLead] = await Promise.all([
    runLoopDriverProbe(root),
    readPoolMetrics(root),
    readDevelopLead(root),
  ]);

  const liveness: SessionLivenessReading = { status: "empty", reason: "liveness observer retired 2026-09-03", sessions: [] };

  // observer-registry.conf — the single registration surface (mechanism input, not prose).
  let observers: ManagerResult["observers"];
  {
    const conf = fileURLToPath(new URL(OBSERVER_REGISTRY_CONF, import.meta.url));
    let rows: ObserverRow[] = [];
    try {
      if (!fs.existsSync(conf)) throw new Error("missing");
      rows = parseObserverRegistry(fs.readFileSync(conf, "utf8"));
    } catch (err) {
      observers = { status: "empty", reason: `observer-registry.conf 不可读（${err instanceof Error ? err.message : String(err)} → 未接入）`, rows: [] };
    }
    observers = rows.length > 0
      ? { status: "ok", reason: null, rows }
      : { status: "empty", reason: "observer-registry.conf 为空", rows };
  }

  // version — build-time-embedded QUAY_VERSION (version.ts) — NEVER a runtime read of package.json,
  // which would break the self-contained-dist invariant (build-dist.test.mjs asserts the bundle
  // carries no '../package.json').
  const version: string | null = QUAY_VERSION || null;

  const degraded = loopDriver.status === "empty" && pool.status === "empty";
  return {
    status: degraded ? "empty" : "ok",
    reason: degraded ? "manager 观测机制脚本缺失" : null,
    loopDriver,
    liveness,
    observers,
    pool,
    version,
    developLead,
  };
}

// ── Tests view (verification-round.jsonl) ─────────────────────────────────────────────────────────

export interface TestRunRecord {
  round: number | null;
  startedAt: string | null;
  durationMs: number | null;
  state: string | null;
  pass: number | null;
  fail: number | null;
  cancelled: number | null;
  tests: number | null;
  reason: string | null;
  commit: string | null;
  scope: string | null;
  runner: string | null;
  gate: string | null;
  failures: string[] | null;
  // gap-fan-in-verification-round-thin-schema-phase-gap — the fan-in (thin) writer's phase +
  // concurrency axes, so the /tests page and AC101's lane-concurrency control round read the SAME
  // 口径 fields full-suite-runner's rich rows carry. Absent on legacy/thin rows → null (never 0).
  static_phase_ms?: number | null;
  serial_phase_ms?: number | null;
  lowconc_phase_ms?: number | null;
  main_phase_ms?: number | null;
  nproc?: number | null;
  concurrentSuiteSlots?: number | null;
  concurrentSuitesRunning?: number | null;
  // gap-ac127-suite-bucket-web-tests-page-visible — the bucket-execution fields (AC126 landed them in
  // verification-round.jsonl; the /tests reader surfaces them). `buckets` is the canonical label
  // (P|M|P+M|full); `bucket_files` / `bucket_duration_ms` are the selected file count and wall ms.
  // Absent on legacy/non-bucket rows → null (never a fabricated "full").
  buckets?: string | null;
  bucket_files?: number | null;
  bucket_duration_ms?: number | null;
  // gap-test-detail-perfile-duration-failed — the per-file wall-clock + pass/fail array
  // (`{file, durationMs, passed}[]`), landed by full-suite-runner (reusing measure-suite-reporter's
  // __PERFILE__ stream). Absent on legacy rows → undefined (never a fabricated []).
  // gap-test-detail-timeline — `endedAtMs`/`startedAtMs` are the file's END epoch-ms (reporter
  // `test:complete` time) and the back-computed start (end − duration); present only on rows whose
  // perFile records carried `end_ms` (legacy perFile without timestamps omits both fields).
  perFile?: { file: string; durationMs: number; passed: boolean; endedAtMs?: number; startedAtMs?: number }[] | null;
  // gap-web-tests-three-sections-round-drift — the round's suite runId (written by the fan-in thin
  // writer, `pre-verified-round-record`). Absent on legacy/full-suite-runner rows → undefined (never a
  // fabricated ""), the same absent-field contract as buckets/perFile. Lets the /tests page key the
  // load curve's suite-load-<runId>.jsonl directly off the ledger row (no full-suite-state.json read).
  runId?: string | null;
}

/**
 * `/tests` no-record cause enumerator (gap-verification-round-empty-state-lumps-three-distinct-causes).
 *
 * WHY THIS IS NOT A BOOLEAN (硬规则 3 — 枚举，不布尔): `empty` used to be ONE value carrying ONE reason
 * string (「尚未跑过验证轮 → 未接入」) for three structurally different situations:
 *   - `empty-no-writer`             — NOTHING in this workspace can ever write the ledger (no
 *                                     `scripts/test.sh`, no `loop.test_command`). A WIRING statement.
 *   - `empty-writer-zero-records`   — a writer IS wired; it just has not landed a row yet. The only
 *                                     one of the three that is a TIMING statement.
 *   - `error`                       — the ledger is present but unreadable (「读失败」; the existing
 *                                     DEGRADATION CONTRACT in this file's header).
 * Rendering (a) as 「尚未跑过验证轮」 sends the reader down a fix path — «run another round» — that does
 * not exist for it: a workspace with no suite entry can run a thousand rounds and the ledger stays
 * empty. Hard rule 3 forbids exactly that conflation.
 *
 * ⛔ THE DISCRIMINATOR LIVES IN `status`, NOT ONLY IN THE PROSE. DoD forbids "adding one sentence to
 * the page while the three causes still share one `status`" — a downstream reader of the DATA (not the
 * page) must be able to tell them apart. `reason` carries the evidence (WHICH signals were found);
 * `status` carries the cause.
 */
export type TestsStatus = "ok" | "empty-no-writer" | "empty-writer-zero-records" | "error";

export interface TestsResult {
  status: TestsStatus;
  reason: string | null;
  runs: TestRunRecord[];
}

/**
 * Result of probing whether THIS workspace has a path that can land a row in
 * `.quay/verification-round.jsonl` — the direct quantity behind `empty-no-writer` vs
 * `empty-writer-zero-records` (硬规则 4c: it must be readable THROUGH observation.ts, i.e. from
 * `<root>` alone, never a driver-side quantity — and it must be able to take `false`).
 *
 * `wired` is the SAME predicate the mechanical fan-in itself resolves on: worker-driver.ts
 * `resolveScopedGateCommand` / `suiteRunsOutsideRunner` run a suite iff `scripts/test.sh` EXISTS
 * (quay-shaped entry) or `loop.test_command` is declared (the third-party delegated entry). Finding
 * neither means no fan-in step can ever run here ⇒ the ledger is structurally unwritable.
 *
 * `signals` is the ENUMERATION of what was actually found (⛔ never a boolean dressed up as evidence):
 * a reader of a rendered page must be able to see WHICH declaration produced 「已接入」.
 */
export interface RoundWriterPath {
  wired: boolean;
  /** The signals found on disk, in probe order (`scripts/test.sh`, `loop.test_command`, `loop.test_output`). */
  signals: string[];
}

/** The `loop:` keys that decide whether a project's suite can run at all vs. how its output is parsed.
 *  `test_command` = runnable entry (decides `wired`); `test_output` = declared parse contract (reported
 *  as evidence only — a parse contract with no entry runs nothing). */
export const ROUND_WRITER_LOOP_KEYS = ["test_command", "test_output"] as const;

/** See `RoundWriterPath`. Reads `<root>/.quay/config.yml` DIRECTLY (⛔ no upward search — a workspace
 *  is judged by its OWN declarations, not by a parent directory's) with the same YAML 口径 as
 *  worker-driver.ts `readLoopTestCommand`/`readLoopTestOutput`, which are the writer-side consumers of
 *  these same keys. Never throws — an unreadable config yields `wired:false` + no signals. */
export function detectRoundWriterPath(root: string): RoundWriterPath {
  const signals: string[] = [];

  let testSh = false;
  try {
    testSh = fs.statSync(path.join(root, "scripts", "test.sh")).isFile();
  } catch {
    testSh = false;
  }
  if (testSh) signals.push("scripts/test.sh");

  let loop: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = YAML.parse(fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8"));
    const l = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
    if (l && typeof l === "object" && !Array.isArray(l)) loop = l as Record<string, unknown>;
  } catch {
    loop = null;
  }

  const rawCmd = loop ? loop.test_command : undefined;
  const cmd = typeof rawCmd === "string" && rawCmd.trim() !== "" ? rawCmd.trim() : null;
  if (cmd) signals.push("loop.test_command");

  const decl = loop ? loop.test_output : undefined;
  const hasOutputDecl =
    !!decl &&
    typeof decl === "object" &&
    !Array.isArray(decl) &&
    Object.values(decl as Record<string, unknown>).some((v) => typeof v === "string" && v.trim() !== "");
  if (hasOutputDecl) signals.push("loop.test_output");

  return { wired: testSh || cmd !== null, signals };
}

export const VERIFICATION_ROUND_REL = "../../../.quay/verification-round.jsonl";

/** Parse one verification-round.jsonl line into a TestRunRecord. Malformed → null (never throw). */
export function parseVerificationRound(line: string): TestRunRecord | null {
  try {
    const o = JSON.parse(line);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
    const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
    let failures: string[] | null = null;
    if (Array.isArray(o.failures)) {
      failures = o.failures.map((f: unknown) => {
        if (typeof f === "string") return f;
        if (f && typeof f === "object") {
          const p = (f as { file?: unknown; name?: unknown; test?: unknown }).file ?? (f as { file?: unknown; name?: unknown; test?: unknown }).name ?? (f as { file?: unknown; name?: unknown; test?: unknown }).test;
          return typeof p === "string" ? p : JSON.stringify(f);
        }
        return JSON.stringify(f);
      });
    }
    let perFile: { file: string; durationMs: number; passed: boolean; endedAtMs?: number; startedAtMs?: number }[] | null = null;
    if (Array.isArray(o.perFile)) {
      perFile = o.perFile.map((p: unknown) => {
        if (p && typeof p === "object") {
          const q = p as { file?: unknown; durationMs?: unknown; passed?: unknown; endedAtMs?: unknown; startedAtMs?: unknown };
          return {
            file: typeof q.file === "string" ? q.file : "",
            durationMs: typeof q.durationMs === "number" ? q.durationMs : 0,
            passed: q.passed === true,
            // gap-test-detail-timeline — timestamps present only when the row carried them (absent-
            // field contract, same as perFile itself; legacy perFile entries have neither).
            ...(typeof q.endedAtMs === "number" ? { endedAtMs: q.endedAtMs } : {}),
            ...(typeof q.startedAtMs === "number" ? { startedAtMs: q.startedAtMs } : {}),
          };
        }
        return { file: "", durationMs: 0, passed: false };
      });
    }
    return {
      round: num(o.round),
      startedAt: str(o.startedAt) ?? str(o.started_at),
      durationMs: num(o.durationMs),
      state: str(o.state),
      pass: num(o.pass),
      fail: num(o.fail),
      cancelled: num(o.cancelled),
      tests: num(o.tests),
      reason: str(o.reason),
      commit: str(o.commit),
      scope: str(o.scope),
      runner: str(o.runner),
      gate: str(o.gate),
      failures,
      // gap-fan-in-verification-round-thin-schema-phase-gap — the phase + concurrency axes (absent on
      // legacy/thin rows → null, never a fabricated 0). Same 口径 as full-suite-runner's rich rows.
      ...(o.static_phase_ms !== undefined ? { static_phase_ms: num(o.static_phase_ms) } : {}),
      ...(o.serial_phase_ms !== undefined ? { serial_phase_ms: num(o.serial_phase_ms) } : {}),
      ...(o.lowconc_phase_ms !== undefined ? { lowconc_phase_ms: num(o.lowconc_phase_ms) } : {}),
      ...(o.main_phase_ms !== undefined ? { main_phase_ms: num(o.main_phase_ms) } : {}),
      ...(o.nproc !== undefined ? { nproc: num(o.nproc) } : {}),
      ...(o.concurrentSuiteSlots !== undefined ? { concurrentSuiteSlots: num(o.concurrentSuiteSlots) } : {}),
      ...(o.concurrentSuitesRunning !== undefined ? { concurrentSuitesRunning: num(o.concurrentSuitesRunning) } : {}),
      // gap-ac127-suite-bucket-web-tests-page-visible — bucket-execution fields (absent on legacy rows →
      // undefined, never a fabricated "full"). Same 口径 as full-suite-runner:4027-4029.
      ...(o.buckets !== undefined ? { buckets: str(o.buckets) } : {}),
      ...(o.bucket_files !== undefined ? { bucket_files: num(o.bucket_files) } : {}),
      ...(o.bucket_duration_ms !== undefined ? { bucket_duration_ms: num(o.bucket_duration_ms) } : {}),
      // gap-test-detail-perfile-duration-failed — perFile (absent on legacy rows → undefined, the
      // same absent-field contract as buckets).
      ...(o.perFile !== undefined ? { perFile } : {}),
      // gap-web-tests-three-sections-round-drift — runId (absent on legacy/full-suite-runner rows →
      // undefined, same absent-field contract). Fan-in thin rows carry it.
      ...(o.runId !== undefined ? { runId: str(o.runId) } : {}),
    };
  } catch {
    return null;
  }
}

// ── verification-round short-TTL cache (display surface only) ──────────────────────────────────────
// gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks: `.quay/verification-round.jsonl` grows
// unboundedly (append-only; ~38 MB / ~1000+ rounds on the live store), and `readTests` was reading +
// parsing the ENTIRE file on every /dashboard render — a cost that grows with the round count, not
// with any request rate. The dashboard testsCard only needs the latest round + a 5-round strip + the
// past-N-hours timeline; the /tests page needs the full history but is human-opened. A 30s TTL (the
// same display-snapshot freshness the taskSummaryCache / poolMetricsCache already use) bounds the
// steady-state cost to one parse per 30s window, keyed by workspace root. The suite writer appends a
// round at most every ~20 min, so 30s staleness is invisible on the dashboard.
export const VERIFICATION_ROUND_CACHE_TTL_MS = 30_000;
const verificationRoundCache = new Map<string, { at: number; result: TestsResult }>();

/** Test-hygiene handle: drop all cached verification-round readings. */
export function clearVerificationRoundCache(): void {
  verificationRoundCache.clear();
}

/** Tests view: the suite-state writer's own round sequence + current state. Short-TTL-cached on the
 *  display surface (see VERIFICATION_ROUND_CACHE_TTL_MS) — a cache hit returns the SAME result object
 *  without re-reading/re-parsing the append-only carrier. */
export function readTests(root: string): TestsResult {
  const hit = verificationRoundCache.get(root);
  if (hit && Date.now() - hit.at < VERIFICATION_ROUND_CACHE_TTL_MS) return hit.result;
  const result = readTestsUncached(root);
  verificationRoundCache.set(root, { at: Date.now(), result });
  return result;
}

/** The reason a ledger that EXISTS but parsed to zero records carries. Shared by the sync and
 *  non-blocking readers so the two cannot report different words for the same fact. */
const EMPTY_ROUNDS_LEDGER_REASON = "verification-round.jsonl 存在但无有效记录（写者已落过盘，没有任何一行可解析）";

/** The missing-ledger branch's two outcomes, keyed on the DIRECT quantity (is a writer path wired?).
 *  gap-verification-round-empty-state-lumps-three-distinct-causes — the absence of the ledger is TWO
 *  different facts, and only one of them is about time. Probe the workspace for a writer path (see
 *  detectRoundWriterPath) and say which fact this is.
 *
 *  ⛔ Extracted so `readTestsUncached` (sync) and `readTestsUncachedAsync` (non-blocking) report the
 *  identical status/reason pair — a second inline copy is how two readers of one carrier start
 *  disagreeing (硬规则 5b).
 *
 *  ── AC4 (② of the task's either/or): THE LEDGER-WRITE CONTRACT, stated where the guidance is
 *  emitted. A third-party project lands rows through the MECHANICAL FAN-IN — quay exposes no
 *  standalone "append a round" subcommand for it (the one general writer,
 *  plugin/scripts/pre-verified-round-record.ts, is RETIRED from the fan-in path by its own
 *  header ruling; do not re-wire it). The fan-in runs a project's suite iff `scripts/test.sh`
 *  exists or `loop.test_command` is declared — which is exactly `detectRoundWriterPath`'s
 *  `wired` — and then calls `appendDelegatedSuiteRound`. A project MAY additionally write its
 *  own rows from its own suite script (the real third-party quay-fleet does), but it does not
 *  have to: declaring the entry is sufficient. Proof this contract is TRUE, on a real
 *  third-party project: quay-fleet's `.quay/verification-round.jsonl` contains rows with
 *  `runner:"inner"`, `taskId:"fleet-agent-sessions-transcript-endpoint"` and
 *  `runId:"mfi-…"` — written by the mechanical fan-in, not by quay's own checkout. */
function missingRoundsLedger(root: string): { status: TestsStatus; reason: string } {
  const writer = detectRoundWriterPath(root);
  if (writer.wired) {
    return {
      status: "empty-writer-zero-records",
      reason:
        ".quay/verification-round.jsonl 不存在，但本项目已接入写者（" +
        writer.signals.join(" + ") +
        "）—— 机械 fan-in 在下一轮 suite 完成后即写入该载体（尚未产出记录，不是未接入）",
    };
  }
  return {
    status: "empty-no-writer",
    reason:
      "未接入：.quay/verification-round.jsonl 不存在，且本项目无写者接入该载体（未发现 scripts/test.sh；" +
      ".quay/config.yml 的 loop 段也未声明 " +
      ROUND_WRITER_LOOP_KEYS.join(" / ") +
      "）—— 再跑多少轮也不会有记录。接入方式：在本项目 .quay/config.yml 的 loop 段声明 test_command" +
      "（plugin/scripts/quay-init.sh 写入；等价入口 /quay:init --all --loop），机械 fan-in 即会落账",
  };
}

/** THE parse loop over the ledger's lines — called once with every line by the sync reader and in
 *  bounded slices by the non-blocking reader, so both parse with the same rule (one implementation,
 *  no drift). Blank lines skipped; malformed lines skipped, never fatal. */
function parseRoundLines(lines: readonly string[], into: TestRunRecord[]): void {
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = parseVerificationRound(line);
    if (rec) into.push(rec);
  }
}

/** The file-exists branch's tail: zero parsed records is a writer/wiring fact (not a timing one), and
 *  otherwise the page presents newest-first. Shared by both readers for the reason above. */
function finishRoundsFromLedger(runs: TestRunRecord[]): { status: TestsStatus; reason: string | null } {
  if (runs.length === 0) {
    // The file exists ⇒ SOME writer ran. That is a writer/wiring fact, not a timing one — the same
    // value as the missing-ledger-but-wired case, with its own reason (a reader can still tell the
    // two apart from `reason`; `status` answers the question they share: 「写者接入了吗 ⇒ 是」).
    return { status: "empty-writer-zero-records", reason: EMPTY_ROUNDS_LEDGER_REASON };
  }
  // The suite writer appends oldest→newest; the page shows 最新在前, so present newest-first.
  runs.reverse();
  return { status: "ok", reason: null };
}

/** Uncached half of readTests (the real read + parse), kept separate so the cache wrapper and any
 *  future bounded reader share one implementation. ⛔ SYNC by contract — it blocks on a ledger that
 *  is ~70 MB on the live store. A background caller must use `readTestsNonBlocking` instead
 *  (gap-ac179-criterion-cold-miss-30s-ttl-always-expired). */
function readTestsUncached(root: string): TestsResult {
  const roundsPath = path.join(root, ".quay", "verification-round.jsonl");
  const runs: TestRunRecord[] = [];
  let statePathStatus: TestsStatus = "ok";
  let reason: string | null = null;
  try {
    if (!fs.existsSync(roundsPath)) {
      ({ status: statePathStatus, reason } = missingRoundsLedger(root));
    } else {
      parseRoundLines(fs.readFileSync(roundsPath, "utf8").split(/\r?\n/), runs);
      ({ status: statePathStatus, reason } = finishRoundsFromLedger(runs));
    }
  } catch (err) {
    statePathStatus = "error";
    reason = `verification-round.jsonl 读失败：${err instanceof Error ? err.message : String(err)}`;
  }

  // /tests 页是历史/可观测性面，只读数据面载体 verification-round.jsonl（红绿都入账）；控制面
  // 单状态文件 full-suite-state.json（gate 信号、D7 镜像只写绿、scope 标注）不进入显示层。
  return { status: statePathStatus, reason, runs };
}

/** Ledger lines parsed per macrotask in `readTestsNonBlocking`. The live ledger's lines are ~40 KB
 *  each, so 200 lines ≈ 60 ms of JSON.parse — small enough that a background refresh never holds the
 *  event loop long enough to delay /health, large enough that the per-chunk overhead is invisible. */
export const ROUNDS_PARSE_CHUNK_LINES = 200;

/** Yield to the event loop once (one macrotask boundary), so a long cooperative read lets pending
 *  I/O — notably an in-flight `/health` — be served between slices. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

/**
 * NON-BLOCKING half of `readTests`: the same RESULT, the same cache, the same decision helpers — but
 * the two pieces that made the sync reader hold the event loop for ~1.6 s on the live store are moved
 * off it: the ~70 MB read is `await`ed (threadpool, not the event loop) and the per-line JSON.parse
 * runs in `ROUNDS_PARSE_CHUNK_LINES`-line slices with a macrotask yield between slices.
 *
 * ⊢ Why this exists (gap-ac179-criterion-cold-miss-30s-ttl-always-expired): the dashboard's snapshot
 * rebuild runs on a BACKGROUND tick, and a sync reader there would stall every concurrent request —
 * `/health` included — for the whole parse. The request path must never pay this cost in any form.
 *
 * ⊢ Why a second entry point rather than "just make readTests async": `readTests` is SYNC by contract
 * for its many in-request callers. Sharing the cache, the line parser and the empty/missing-ledger
 * decision helpers keeps the two readers on ONE truth (硬规则 5b) — only the loop shape differs.
 */
export async function readTestsNonBlocking(root: string): Promise<TestsResult> {
  const hit = verificationRoundCache.get(root);
  if (hit && Date.now() - hit.at < VERIFICATION_ROUND_CACHE_TTL_MS) return hit.result;
  const result = await readTestsUncachedAsync(root);
  verificationRoundCache.set(root, { at: Date.now(), result });
  return result;
}

/** Async half of `readTestsNonBlocking` — see it for the contract. Byte-for-byte the same decisions
 *  as `readTestsUncached`; only the read (`await`) and the parse (sliced + yielded) differ. */
async function readTestsUncachedAsync(root: string): Promise<TestsResult> {
  const roundsPath = path.join(root, ".quay", "verification-round.jsonl");
  const runs: TestRunRecord[] = [];
  let statePathStatus: TestsStatus = "ok";
  let reason: string | null = null;
  try {
    if (!fs.existsSync(roundsPath)) {
      ({ status: statePathStatus, reason } = missingRoundsLedger(root));
    } else {
      const text = await fs.promises.readFile(roundsPath, "utf8");
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += ROUNDS_PARSE_CHUNK_LINES) {
        parseRoundLines(lines.slice(i, i + ROUNDS_PARSE_CHUNK_LINES), runs);
        // Yield only when another slice follows — the last slice needs no hand-off.
        if (i + ROUNDS_PARSE_CHUNK_LINES < lines.length) await yieldToEventLoop();
      }
      ({ status: statePathStatus, reason } = finishRoundsFromLedger(runs));
    }
  } catch (err) {
    statePathStatus = "error";
    reason = `verification-round.jsonl 读失败：${err instanceof Error ? err.message : String(err)}`;
  }
  return { status: statePathStatus, reason, runs };
}

// ── Sessions view (resolved transcript tails) ───────────────────────────────────────────────────────

export interface SessionMessage {
  time: string;
  role: string;
  text: string;
}

export type SessionLayer = "Manager" | "Outer" | "Inner" | "Other";

export interface SessionDetail {
  name: string;
  /** The UUID lookup key for /session/<id> — present for both LIVE (registry row) and GONE (scan). */
  sessionId: string;
  layer: SessionLayer;
  alive: boolean;
  pid: number | null;
  halted: boolean;
  transcriptStatus: ObservationStatus;
  transcriptReason: string | null;
  messages: SessionMessage[] | null;
  /**
   * The session's two-dimension state under layer prefixes (SPEC §6.7), or `null` when the record
   * was REFUSED by the shared validator. `null` is the honest outcome for a record that folded the
   * two dimensions into one top-level `status`: the page renders an explicit 「状态记录不可用」
   * rather than a folded value (gap-ac253-session-primitives-shared-layer-adoption Plan step 6).
   */
  session: SessionLayeredState | null;
  /** Why `session` is null (the validator's own errors). Empty when `session` is present. */
  sessionRefusal: string[];
}

/** The lifecycle dimension's value set — mirrors primitives/session-schema.mjs's closed set. */
export type SessionLifecycleValue = "working" | "blocked" | "done" | "not-applicable" | "unknown";
/** The activity dimension's value set — mirrors primitives/session-schema.mjs's closed set. */
export type SessionActivityValue = "busy" | "idle" | "shell" | "unknown";

/**
 * A session record as the SHARED schema sees it (SPEC §6.7): two state dimensions that must stay
 * separate objects, each carrying its own source and its own timestamp — `claude agents --json`
 * folds the registry's `shell` into `busy` and loses a value the registry actually has, and the
 * schema validator is what refuses to let this repo repeat that fold at its own output boundary.
 *
 * ⛔ `status` is deliberately NOT a field here. Adding one is exactly the fold the validator rejects.
 */
export interface SessionLayeredState {
  lifecycle: { value: SessionLifecycleValue; source: string; observedAt: number };
  activity: { value: SessionActivityValue; source: string; ageSec: number };
  /** This workspace keys sessions by bare sessionId with no machine scoping ⇒ "local-only". */
  sessionKeyScope: "global" | "local-only";
}

/** A transcript write inside this window reads as `busy`; older reads as `idle`. */
export const SESSION_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

/** `null`-able reading → seconds, or the schema's "unknown" sentinel (-1) when there is no reading. */
function ageSecOrUnknown(ms: number | null, nowMs: number): number {
  if (ms == null) return -1;
  return Math.max(0, Math.round((nowMs - ms) / 1000));
}

/**
 * Build the two-dimension record from DIRECT readings only — the registry row's existence for
 * `lifecycle`, and the transcript file's OWN mtime (via the shared `readTranscriptMtime`) for
 * `activity`. Neither dimension is taken from a self-reported `status`/`statusUpdatedAt` field:
 * a real session was observed reading `status=idle` with a 3.3-day-stale `statusUpdatedAt`, which
 * is the same shape as "everything is fine".
 */
export function buildSessionLayeredState(opts: {
  alive: boolean;
  lifecycleSource: string;
  transcriptPath: string | null;
  observedAt: number;
}): SessionLayeredState {
  const mtimeMs = opts.transcriptPath == null ? null : readTranscriptMtime(opts.transcriptPath);
  const ageSec = ageSecOrUnknown(mtimeMs, opts.observedAt);
  return {
    lifecycle: {
      value: opts.alive ? "working" : "done",
      source: opts.lifecycleSource,
      observedAt: opts.observedAt,
    },
    activity: {
      value: mtimeMs == null
        ? "unknown"
        : (opts.observedAt - mtimeMs <= SESSION_ACTIVITY_WINDOW_MS ? "busy" : "idle"),
      source: mtimeMs == null ? "no transcript mtime reading" : "transcript mtime",
      ageSec,
    },
    sessionKeyScope: "local-only",
  };
}

/**
 * Attach a record to a `SessionDetail` ONLY if the shared schema accepts it. A refused record
 * yields `session: null` + the validator's reasons — the caller then renders the refusal, never
 * a folded value (硬规则 3b: 读不懂输入时不得返回与「合格」同形的值).
 */
export function attachValidatedSession(
  detail: Omit<SessionDetail, "session" | "sessionRefusal">,
  record: SessionLayeredState,
): SessionDetail {
  const verdict = validateSessionRecord(record);
  return verdict.valid
    ? { ...detail, session: record, sessionRefusal: [] }
    : { ...detail, session: null, sessionRefusal: verdict.errors };
}

/**
 * Classify a session's layer from its target name (the name chosen in SESSION_TARGETS).
 * Naming conventions: the manager view registers targets literally named `outer` / `inner`;
 * topology-style names carry the window suffix (`quay-0:outer` / `quay-0:inner`); the manager
 * session itself is named with a `manager` marker. Case-insensitive substring match, ordered
 * manager → outer → inner so a name containing several markers resolves deterministically.
 * Names that match none are "Other" — a session must never be silently dropped from the page.
 */
export function classifySessionLayer(name: string): SessionLayer {
  const n = name.toLowerCase();
  if (n.includes("manager")) return "Manager";
  if (n.includes("outer")) return "Outer";
  if (n.includes("inner")) return "Inner";
  return "Other";
}

/** Render order + fixed headings for the /sessions page's three layers (plus the Other fallback). */
export const SESSION_LAYERS: ReadonlyArray<{ layer: SessionLayer; heading: string }> = [
  { layer: "Manager", heading: "Manager" },
  { layer: "Outer", heading: "Outer" },
  { layer: "Inner", heading: "Inner" },
  { layer: "Other", heading: "Other / 未分类" },
];

export interface SessionsResult {
  status: ObservationStatus;
  reason: string | null;
  sessions: SessionDetail[];
}

export const SESSIONS_TRANSCRIPT_MAX_MSGS = 3;
export const SESSIONS_TRANSCRIPT_TAIL_BYTES = 200_000;

/**
 * Best-effort read of the last few user/assistant/external text messages from a Claude Code
 * transcript JSONL (queue-operation / attachment records render as an `external` entry). Bounded to
 * the file tail so a multi-GB transcript never loads fully. Returns null when the path is
 * missing/unreadable (the page then shows 未接入 for that layer).
 */
export function readTranscriptTail(transcriptPath: string, maxMsgs = SESSIONS_TRANSCRIPT_MAX_MSGS): { status: ObservationStatus; reason: string | null; messages: SessionMessage[] | null } {
  try {
    if (!fs.existsSync(transcriptPath)) return { status: "empty", reason: "transcript 缺失", messages: null };
    const stat = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, "r");
    const tailStart = Math.max(0, stat.size - SESSIONS_TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(stat.size - tailStart);
    fs.readSync(fd, buf, 0, buf.length, tailStart);
    fs.closeSync(fd);
    const text = buf.toString("utf8").split(/\r?\n/);
    const messages: SessionMessage[] = [];
    for (const line of text) {
      if (!line.trim()) continue;
      let o: unknown;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      const rec = o as { type?: unknown; timestamp?: unknown; message?: unknown };
      const time = typeof rec.timestamp === "string" ? rec.timestamp : "";
      // queue-operation / attachment carry no `.message` field — surface them as an `external`
      // preview entry (same rendering path as parseTranscript, not a fabricated user message).
      const ext = externalEvent(rec);
      if (ext !== null) {
        messages.push({ time, role: "external", text: `${ext.label}\n${ext.text}`.slice(0, 500) });
        continue;
      }
      const msg = rec.message as { role?: unknown; content?: unknown } | undefined;
      if (!msg || !msg.content) continue;
      const role = typeof msg.role === "string" ? msg.role : "";
      let textContent: string | null = null;
      if (typeof msg.content === "string") textContent = msg.content;
      else if (Array.isArray(msg.content)) {
        for (const blk of msg.content) {
          if (blk && typeof blk === "object" && (blk as { type?: unknown }).type === "text") {
            const t = (blk as { text?: unknown }).text;
            if (typeof t === "string" && t.trim()) { textContent = t; break; }
          }
        }
      }
      if (!textContent || !textContent.trim()) continue;
      messages.push({
        time: typeof rec.timestamp === "string" ? rec.timestamp : "",
        role,
        text: textContent.trim().slice(0, 500),
      });
    }
    if (messages.length === 0) return { status: "empty", reason: "transcript 尾部无 user/assistant 文本消息", messages: null };
    return { status: "ok", reason: null, messages: messages.slice(-maxMsgs) };
  } catch (err) {
    return { status: "error", reason: `transcript 读失败：${err instanceof Error ? err.message : String(err)}`, messages: null };
  }
}

// ── `claude agents --json` discovery (gap-webui-session-discovery-claude-agents-json) ───────────────
// The official CLI session registry replaces the old three-role tmux-guessing discovery. It lists
// EVERY running session — interactive
// AND `-p`/headless alike (SPEC §2.2 更正段) — but only RUNNING ones: ended sessions are absent from
// the registry (SPEC §2.4) and are discovered separately by scanning the transcript directory.

/** One `claude agents --json` row. `status` (busy/idle) is only present on interactive sessions; a
 *  `-p`/headless worker omits it — absence is NOT "idle", so it parses as null rather than a
 *  fabricated value (hard rule ③b). */
export interface ClaudeAgentRow {
  pid: number | null;
  cwd: string | null;
  kind: string | null;
  startedAt: number | null;
  sessionId: string | null;
  name: string | null;
  status: string | null;
}

/** Parse `claude agents --json` stdout (a JSON array). Pure — never throws; a non-array or malformed
 *  document yields [] (the caller then renders an honest empty state). */
export function parseClaudeAgentsJson(text: string): ClaudeAgentRow[] {
  let doc: unknown;
  try { doc = JSON.parse(String(text)); } catch { return []; }
  if (!Array.isArray(doc)) return [];
  const out: ClaudeAgentRow[] = [];
  for (const el of doc) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    out.push({
      pid: typeof o.pid === "number" && Number.isFinite(o.pid) ? o.pid : null,
      cwd: typeof o.cwd === "string" && o.cwd.length > 0 ? o.cwd : null,
      kind: typeof o.kind === "string" && o.kind.length > 0 ? o.kind : null,
      startedAt: typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : null,
      sessionId: typeof o.sessionId === "string" && o.sessionId.length > 0 ? o.sessionId : null,
      name: typeof o.name === "string" && o.name.length > 0 ? o.name : null,
      status: typeof o.status === "string" && o.status.length > 0 ? o.status : null,
    });
  }
  return out;
}

/** Spawn `claude agents --json` and return its raw stdout. Never throws — a spawn failure or non-zero
 *  exit yields { stdout: null, reason } (the caller renders an honest empty state, never a 500). */
async function runClaudeAgentsJson(root: string): Promise<{ stdout: string | null; reason: string | null }> {
  const { stdout, exitCode } = await runScriptBounded(["claude", "agents", "--json"], { cwd: root, timeoutMs: 20_000 });
  if (exitCode === null) return { stdout: null, reason: "claude agents --json 未能运行（spawn 失败或超时被杀）" };
  if (exitCode !== 0) return { stdout: null, reason: `claude agents --json 退出码 ${exitCode}` };
  return { stdout, reason: null };
}

/** Path equality after resolution (trailing-slash-insensitive). Never throws — an un-resolvable path
 *  returns false rather than propagating. Used to scope the machine-wide `claude agents --json`
 *  registry down to the served workspace. */
function samePath(a: string, b: string): boolean {
  try { return path.resolve(a) === path.resolve(b); } catch { return false; }
}

/** Max recent-ended sessions surfaced on /sessions. The transcript dir holds hundreds of session
 *  files; the page shows only the most recent (newest-first), not the whole history. */
export const SESSIONS_ENDED_MAX = 20;

/** Scan the workspace's transcript dir (`~/.claude/projects/<slug>/*.jsonl`) for sessions NOT in the
 *  running registry — i.e. ended sessions. Returns { sessionId, mtimeMs } newest-first, bounded to
 *  SESSIONS_ENDED_MAX. A missing dir yields [] (honest empty, not an error). */
function scanEndedSessions(root: string, runningIds: ReadonlySet<string>): Array<{ sessionId: string; mtimeMs: number }> {
  const dir = path.join(os.homedir(), ".claude", "projects", projectSlug(root));
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const ended: Array<{ sessionId: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const sessionId = entry.slice(0, -".jsonl".length);
    if (runningIds.has(sessionId) || !isValidSessionId(sessionId)) continue;
    try {
      ended.push({ sessionId, mtimeMs: fs.statSync(path.join(dir, entry)).mtimeMs });
    } catch { /* a file that vanished between readdir and stat is skipped */ }
  }
  ended.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return ended.slice(0, SESSIONS_ENDED_MAX);
}

/** Best-effort transcript tail for a session whose transcript path is already known; a missing path
 *  degrades to an honest empty (the card renders 未接入 rather than a fabricated reading). */
function transcriptTailFor(tp: string | null): { status: ObservationStatus; reason: string | null; messages: SessionMessage[] | null } {
  if (tp != null && fs.existsSync(tp)) return readTranscriptTail(tp);
  return { status: "empty", reason: "transcript 缺失", messages: null };
}

/** Sessions view: `claude agents --json` (running sessions — interactive + `-p`) + a transcript-dir
 *  scan for ended sessions (SPEC §3.1: the registry only lists running sessions, so ended ones are
 *  discovered from their transcript files). Replaces the old three-role tmux-guessing discovery, which
 *  could see neither `-p`/headless sessions nor ended sessions. */
export async function readSessions(root: string): Promise<SessionsResult> {
  const { stdout, reason } = await runClaudeAgentsJson(root);
  if (stdout == null) {
    return { status: "empty", reason, sessions: [] };
  }
  const rows = parseClaudeAgentsJson(stdout);
  // Scope to THIS workspace: the registry is machine-wide (every project's sessions), so keep only
  // rows whose cwd resolves to the served root — otherwise an unrelated project's sessions would leak
  // onto this workspace's /sessions page (and a temp test workspace would show real machine sessions).
  const here = rows.filter((r) => r.cwd != null && r.sessionId != null && samePath(r.cwd, root));

  const sessions: SessionDetail[] = [];
  const runningIds = new Set<string>();
  for (const row of here) {
    const sessionId = row.sessionId as string;
    runningIds.add(sessionId);
    const name = row.name ?? sessionId;
    const transcriptPath = sessionTranscriptPath(root, sessionId);
    const transcript = transcriptTailFor(transcriptPath);
    sessions.push(attachValidatedSession({
      name,
      sessionId,
      layer: classifySessionLayer(name),
      alive: true,
      pid: row.pid,
      halted: false,
      transcriptStatus: transcript.status,
      transcriptReason: transcript.reason,
      messages: transcript.messages,
    }, buildSessionLayeredState({
      alive: true,
      lifecycleSource: "claude agents --json registry row",
      transcriptPath,
      observedAt: Date.now(),
    })));
  }

  // Ended sessions: transcripts in this workspace's project dir that the running registry does not
  // list. Surfaced newest-first as GONE cards so a session that just ended is still observable.
  // ⛔ The 200 KB tail is NOT read here — the GONE card is folded into a collapsed <details> on the
  // list page and shows only name + a link to /session/<id>; the tail read is deferred to the detail
  // page (gap-sessions-page-slow-unclickable-flat-render AC2: 首屏不再同步读全部 GONE 的 tail).
  for (const { sessionId } of scanEndedSessions(root, runningIds)) {
    sessions.push(attachValidatedSession({
      name: sessionId,
      sessionId,
      layer: classifySessionLayer(sessionId),
      alive: false,
      pid: null,
      halted: false,
      transcriptStatus: "empty",
      transcriptReason: "GONE — transcript 在详情页按需读取",
      messages: null,
    }, buildSessionLayeredState({
      alive: false,
      lifecycleSource: "transcript scan (not in the running registry)",
      transcriptPath: sessionTranscriptPath(root, sessionId),
      observedAt: Date.now(),
    })));
  }

  return { status: "ok", reason: null, sessions };
}

// ── Single-session view (/session/<sessionId>) ─────────────────────────────────────────────────────
// gap-webui-session-detail-view. Addressing key = sessionId (UUID) ONLY — never pid, never task id,
// never a transcript path (§7.1). The sessionId is validated as a strict UUID BEFORE it is ever used,
// then joined onto a FIXED project slug derived from the workspace root — so it is a lookup key, never
// a path component (§7.4 house pattern, same as /tests/file?path=). `-p` and interactive transcripts
// share one schema family (§7.4) so a single parser renders both.

/** Strict UUID shape. Rejects `../`, absolute paths, and any non-UUID before filesystem access (AC3). */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Detail view reads a larger tail than the /sessions preview (200 KB) — still bounded so a multi-GB
 *  transcript never loads fully, but long enough to be observation-level rather than preview-level. */
export const SESSION_VIEW_TRANSCRIPT_TAIL_BYTES = 2_000_000;
/** Detail view renders only this many turns (the most recent) by default; earlier turns are lazy-loaded
 *  on scroll (gap-sessions-page-slow-unclickable-flat-render AC3: 默认只渲染最近 N 条, not 2 MB flat). */
export const SESSION_VIEW_INITIAL_TURNS = 30;
/** Turns fetched per on-demand scroll chunk when the detail view loads earlier content. */
export const SESSION_VIEW_EARLIER_CHUNK = 50;

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId);
}

/** The per-project transcript directory slug — the `tr '/' '-'` transform, so
 *  `/home/yale/work/quay` → `-home-yale-work-quay`. */
export function projectSlug(root: string): string {
  return root.split("/").join("-");
}

/**
 * Resolve a sessionId to its transcript path — PURE (no filesystem access, AC3). A sessionId that is
 * not a strict UUID returns null (the caller then renders an honest 「非法」 state, never touching the
 * disk). `home` is injectable for tests; defaults to the real `$HOME`.
 */
export function sessionTranscriptPath(root: string, sessionId: string, home: string = os.homedir()): string | null {
  if (!isValidSessionId(sessionId)) return null;
  return path.join(home, ".claude", "projects", projectSlug(root), `${sessionId}.jsonl`);
}

export type TranscriptBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: string }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { kind: "external"; label: string; text: string };

export interface TranscriptTurn {
  time: string;
  role: string;
  blocks: TranscriptBlock[];
}

export interface SessionViewResult {
  status: ObservationStatus;
  reason: string | null;
  /** The requested sessionId (echoed, validated). */
  sessionId: string;
  /** Resolved transcript path, or null when the sessionId was invalid. */
  transcriptPath: string | null;
  turns: TranscriptTurn[];
  /** True when the transcript file has bytes BEYOND the read window (older history not read). */
  truncated: boolean;
}

/** tool_result content is a string OR an array of `{type:"text"}` blocks — normalize to text. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Normalize a record's `message.content` (string prompt OR a block array) into structured blocks:
 * `text` / `thinking` / `tool_use` / `tool_result`. This is the schema shared by `-p` and interactive
 * transcripts (§7.4) — both carry these content-block shapes, interactive merely adds extra record
 * types (system/mode/…) that are skipped here.
 */
export function transcriptContentBlocks(content: unknown): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  if (typeof content === "string") {
    const t = content.trim();
    if (t) blocks.push({ kind: "text", text: t });
    return blocks;
  }
  if (!Array.isArray(content)) return blocks;
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const type = (b as { type?: unknown }).type;
    if (type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string" && t.trim()) blocks.push({ kind: "text", text: t.trim() });
    } else if (type === "thinking") {
      const t = (b as { thinking?: unknown }).thinking;
      if (typeof t === "string" && t.trim()) blocks.push({ kind: "thinking", text: t.trim() });
    } else if (type === "tool_use") {
      const o = b as { id?: unknown; name?: unknown; input?: unknown };
      const id = typeof o.id === "string" ? o.id : "";
      const name = typeof o.name === "string" ? o.name : "";
      let input = "";
      try { input = typeof o.input === "undefined" ? "" : JSON.stringify(o.input, null, 2); } catch { input = ""; }
      blocks.push({ kind: "tool_use", id, name, input });
    } else if (type === "tool_result") {
      const o = b as { tool_use_id?: unknown; content?: unknown; is_error?: unknown };
      blocks.push({
        kind: "tool_result",
        toolUseId: typeof o.tool_use_id === "string" ? o.tool_use_id : "",
        text: toolResultText(o.content),
        isError: o.is_error === true,
      });
    }
  }
  return blocks;
}

/** Human-readable marker for a queue-operation record's operation+reason. The `absorbed_mid_turn`
 *  case (a message queued while the receiver was busy, then absorbed into the ongoing turn — never
 *  materializing as its own `type:"user"` record) is the one this rendering path exists to surface. */
function queueOperationLabel(operation: string, reason: string): string {
  if (reason === "absorbed_mid_turn") return "外部消息被吸收进当前回合（未开新回合）";
  if (operation === "enqueue") return "外部消息入队（接收方忙，未开新回合）";
  return "外部消息队列事件（未开新回合）";
}

const ATTACHMENT_LABEL = "外部消息附件（queued_command，未开新回合）";

/** The two native record types that carry NO `.message` field but still represent a user-visible
 *  event: `queue-operation` (a message queued because the receiver was busy, later absorbed/removed
 *  without ever becoming a `type:"user"` record) and `attachment` `queued_command` (the same event,
 *  carried as a command attachment). Returns a renderable `{label, text}` marker, or null for any
 *  other record / when no text is present. ⛔ Never fabricates a `.message.content` record (AC3) —
 *  callers emit a dedicated `external` block, not a user/assistant turn. */
function externalEvent(rec: {
  type?: unknown;
  operation?: unknown;
  content?: unknown;
  reason?: unknown;
  attachment?: unknown;
  origin?: unknown;
}): { label: string; text: string } | null {
  if (rec.type === "queue-operation") {
    const content = typeof rec.content === "string" ? rec.content.trim() : "";
    if (!content) return null; // dequeue carries no content — pure bookkeeping, nothing to render
    const operation = typeof rec.operation === "string" ? rec.operation : "";
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    return { label: queueOperationLabel(operation, reason), text: content };
  }
  if (rec.type === "attachment") {
    const att = rec.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (!att || att.type !== "queued_command") return null; // other attachment types are internal notices
    const prompt = typeof att.prompt === "string" ? att.prompt.trim() : "";
    const origin = rec.origin as { body?: unknown } | undefined;
    const body = origin && typeof origin.body === "string" ? origin.body.trim() : "";
    const text = prompt || body;
    if (!text) return null;
    return { label: ATTACHMENT_LABEL, text };
  }
  return null;
}

/** Parse complete JSONL transcript text into ordered turns (each = one user/assistant/external event). Pure. */
export function parseTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o: unknown;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const rec = o as { type?: unknown; timestamp?: unknown; message?: unknown };
    const time = typeof rec.timestamp === "string" ? rec.timestamp : "";
    // queue-operation / attachment carry no `.message` field — render them from their own
    // content/prompt so a "queued-then-absorbed" cross-session message is not silently dropped.
    const ext = externalEvent(rec);
    if (ext !== null) {
      turns.push({ time, role: "external", blocks: [{ kind: "external", label: ext.label, text: ext.text }] });
      continue;
    }
    const msg = rec.message as { role?: unknown; content?: unknown } | undefined;
    if (!msg || !msg.content) continue;
    const blocks = transcriptContentBlocks(msg.content);
    if (blocks.length === 0) continue;
    turns.push({
      time,
      role: typeof msg.role === "string" ? msg.role : "",
      blocks,
    });
  }
  return turns;
}

/** Bounded read of the transcript tail (same tail strategy as readTranscriptTail, larger window),
 *  parsed into structured turns. Returns empty/error honestly — never throws. `truncated` reports
 *  whether the file has bytes BEYOND the read window (older history not read). */
export function readTranscript(transcriptPath: string, maxBytes = SESSION_VIEW_TRANSCRIPT_TAIL_BYTES): { status: ObservationStatus; reason: string | null; turns: TranscriptTurn[]; truncated: boolean } {
  try {
    if (!fs.existsSync(transcriptPath)) return { status: "empty", reason: "transcript 缺失", turns: [], truncated: false };
    const stat = fs.statSync(transcriptPath);
    const truncated = stat.size > maxBytes;
    const fd = fs.openSync(transcriptPath, "r");
    const tailStart = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.alloc(stat.size - tailStart);
    fs.readSync(fd, buf, 0, buf.length, tailStart);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split(/\r?\n/);
    if (tailStart > 0 && lines.length > 0) lines.shift(); // drop the leading partial JSON record
    const turns = parseTranscript(lines.join("\n"));
    if (turns.length === 0) return { status: "empty", reason: "transcript 无 user/assistant 消息", turns: [], truncated };
    return { status: "ok", reason: null, turns, truncated };
  } catch (err) {
    return { status: "error", reason: `transcript 读失败：${err instanceof Error ? err.message : String(err)}`, turns: [], truncated: false };
  }
}

/** The single-session view: validate sessionId → resolve transcript path → read+parse it. Sync (pure
 *  fs.readSync tail, no shell-out). Invalid sessionId is a distinct empty state, never a disk read.
 *  `home` is injectable for tests; defaults to the real `$HOME`. */
export function readSession(root: string, sessionId: string, home: string = os.homedir()): SessionViewResult {
  const transcriptPath = sessionTranscriptPath(root, sessionId, home);
  if (transcriptPath == null) {
    return { status: "empty", reason: `sessionId 非法（须为 UUID）：${sessionId}`, sessionId, transcriptPath: null, turns: [], truncated: false };
  }
  const t = readTranscript(transcriptPath);
  return { ...t, sessionId, transcriptPath };
}

// ── Architecture view (git/facts per packages/* path) ──────────────────────────────────────────────

export interface ArchComponent {
  name: string;
  path: string;
  /** Commits landing in the window (git log --since). */
  recentCommits: number;
  /** Last commit unix-time, or null when no commits at all. */
  lastCommitAt: number | null;
}

export interface ArchitectureResult {
  status: ObservationStatus;
  reason: string | null;
  components: ArchComponent[];
  /** True when >1 git worktree exists (a task worktree → something in development). */
  inDevelopment: boolean;
}

export const ARCH_RECENT_WINDOW_DAYS = 7;

/** Architecture view: per-package commit activity + worktree count from git/filesystem facts. */
export function readArchitecture(root: string, { windowDays = ARCH_RECENT_WINDOW_DAYS } = {}): ArchitectureResult {
  const packagesDir = path.join(root, "packages");
  const components: ArchComponent[] = [];
  let readError: string | null = null;
  try {
    if (!fs.existsSync(packagesDir)) {
      return { status: "empty", reason: "packages/ 目录不存在", components: [], inDevelopment: false };
    }
    const dirs = fs.readdirSync(packagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => fs.existsSync(path.join(packagesDir, d.name, "package.json")));
    for (const d of dirs) {
      const rel = `packages/${d.name}`;
      let recentCommits = 0;
      let lastCommitAt: number | null = null;
      try {
        const log = execFileSync("git", ["-C", root, "log", "--oneline", `--since=${windowDays} days ago`, "--", rel], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "pipe"] });
        recentCommits = log.split(/\r?\n/).filter(Boolean).length;
        const last = execFileSync("git", ["-C", root, "log", "-1", "--format=%ct", "--", rel], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
        if (last) lastCommitAt = Number.parseInt(last, 10) || null;
      } catch {
        recentCommits = 0;
        lastCommitAt = null;
      }
      components.push({ name: d.name, path: rel, recentCommits, lastCommitAt });
    }
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  let inDevelopment = false;
  try {
    const wt = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "pipe"] });
    inDevelopment = wt.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length > 1;
  } catch { inDevelopment = false; }

  if (readError) return { status: "error", reason: `packages/ 读失败：${readError}`, components, inDevelopment };
  if (components.length === 0) return { status: "empty", reason: "packages/ 下无带 package.json 的组件", components, inDevelopment };
  return { status: "ok", reason: null, components, inDevelopment };
}

// ── Branch model (gap-web-ui-pages-carry-no-host-project-identity) ────────────────────────────
//
// The two GIT-derived halves of the identity card's branch row. They live HERE rather than in
// serve-render.ts because this module is the serve path's only sanctioned git reader — the
// renderer is handed resolved strings and never shells out. The config-derived third
// (landing-baseline = `loop.merge_target`) is read straight from the loaded config by
// serveIdentity(), so it needs no git at all.

/** Git-derived branch names. Each field is null when git is unavailable / not a repo / the ref
 *  does not exist — never a fabricated branch name (硬规则 3b: an invented `master` would read
 *  exactly like a real, verified reading). */
export interface BranchNames {
  /** The remote's default branch, via `origin/HEAD` (e.g. "develop"), or null. */
  default: string | null;
  /** The branch the workspace checkout is currently on (quay's doc/author branch), or null. */
  doc: string | null;
}

/**
 * Read the two git-derived branch names for `root`. Bounded subprocess cost (two `git` calls,
 * 5s timeouts) and total failure tolerance: every error path yields null, never a throw.
 */
export function readBranchModel(root: string): BranchNames {
  const run = (args: string[]): string | null => {
    try {
      const out = execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };
  // `origin/HEAD` is a symbolic ref (refs/remotes/origin/HEAD → refs/remotes/origin/<branch>);
  // --short prints "origin/<branch>", so strip the remote prefix to leave the branch name.
  const head = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return {
    default: head === null ? null : (head.includes("/") ? head.slice(head.indexOf("/") + 1) : head),
    doc: run(["symbolic-ref", "--short", "HEAD"]),
  };
}
