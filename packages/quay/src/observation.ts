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
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { QUAY_VERSION } from "./version.ts";
import { parseFrontmatter } from "./frontmatter-store-base.ts";

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

export interface InFlightTask {
  taskId: string;
  runId: string;
  startedAtMs: number;
  /**
   * Impl-complete boundary (gap-inflight-states-missing-impl-complete-event): the third lifecycle
   * event's `recordedAtMs`, or null when the open run is still implementing. Splits the in-flight
   * view into two segments — implementing (null) vs awaiting-land (non-null). The board renders
   * them as two independent counts.
   */
  implCompletedAtMs: number | null;
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
  concurrency: number;
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
        startedAtMs: rec.start.timing.startedAtMs,
        implCompletedAtMs:
          rec.implComplete && typeof rec.implComplete.recordedAtMs === "number"
            ? rec.implComplete.recordedAtMs
            : null,
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
      const yReadyTodo = y.status === "ready" || y.status === "todo";
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
export function readLive(root: string, { nowMs = Date.now() }: { nowMs?: number } = {}): LiveResult {
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

  // Cross-task blocking (gap-webui-cross-task-blocking-visibility): annotate every in-flight task
  // with the ready/todo tasks it blocks and the tasks blocking it, from the on-disk task store.
  // Additive — a store read failure leaves blocks/blockedBy empty, never 500s the page.
  inFlight = computeInFlightBlocking(root, inFlight);

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

  return { status, reason, inFlight, concurrency: inFlight.length, cpuPressure, liveState, liveExplanation, activity };
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

/** Relative path from THIS module (packages/quay/src/observation.ts) to the drift checker. */
export const DRIFT_CHECKER_REL = "../../../plugin/scripts/task-status-drift-check.ts";

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
  try {
    if (opts.checkerPath) {
      // Test seam: a caller-provided checker path (e.g. a fake that hangs) skips the dev/dist
      // fallback and derives strip-types from its extension.
      scriptPath = opts.checkerPath;
      stripTypes = scriptPath.endsWith(".ts");
    } else {
      scriptPath = fileURLToPath(new URL(DRIFT_CHECKER_REL, import.meta.url));
      stripTypes = true;
      // gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact: the shipped
      // artifact carries the plugin .ts as bundled dist/*.js executables (no raw .ts), so the
      // drift checker resolves to plugin/scripts/dist/task-status-drift-check.js there — run
      // without --experimental-strip-types (a plain ESM .js).
      if (!fs.existsSync(scriptPath)) {
        const bundled = fileURLToPath(
          new URL("../../../plugin/scripts/dist/task-status-drift-check.js", import.meta.url)
        );
        if (fs.existsSync(bundled)) {
          scriptPath = bundled;
          stripTypes = false;
        }
      }
    }
  } catch {
    return { status: "error", reason: "landing 判断源解析失败（plugin 路径不可用）", flags: new Map(), scanned: 0 };
  }
  if (!fs.existsSync(scriptPath)) {
    return {
      status: "empty",
      reason: "landing 判断源缺失（plugin/scripts/task-status-drift-check.ts/dist bundle 不存在 — 产品安装无 methodology 层）",
      flags: new Map(),
      scanned: 0,
    };
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
 * Whether a task's fast-mode worktree is currently open — the DIRECT measurement (the worktree
 * namespace on disk, not the event stream) that cross-validates readLive's in-flight pairing.
 * The namespace is `<parent-of-main>/quay-worktrees` and a task's worktree lives at
 * `<namespace>/<taskId>` (checked out on `task/<taskId>` — the same convention
 * fast-mode-telemetry.ts `worktreeExists` / `isQuayWorktreePath` pin; CLAUDE.md inner-brief:104).
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
  const namespace = path.join(path.dirname(path.resolve(root)), "quay-worktrees");
  try {
    if (!fs.existsSync(namespace)) return null;
    return fs.existsSync(path.join(namespace, taskId));
  } catch {
    return null;
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

/** Max commits the /git-history chart reads (bounded SVG size, ~31 lanes in this repo's last 500). */
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
  /** Local branch this commit was reached from (`--source`), e.g. "integration". */
  ref: string;
  /** Number of parents. > 1 → a merge commit (the fan-in landing event). */
  parents: number;
  /** Full parent hashes — the DAG edges the vertical graph's fork/merge lines are drawn from. */
  parentHashes: string[];
  subject: string;
}

export interface GitHistoryResult {
  status: ObservationStatus;
  reason: string | null;
  commits: GitHistoryCommit[];
  /** HEAD commit hash — the vertical graph's trunk root. null when the repo has no resolvable HEAD. */
  head: string | null;
  /** Active branch name → tip commit hash (the branch topology, not the `--source` attribution). */
  heads: Record<string, string>;
}

/**
 * Read the commit-landing timeline from the ACTIVE local branches only (gap-git-history-counts-stale-branches):
 * `git log --branches --source` counted EVERY local branch as a lane, so a leftover merged branch
 * (e.g. a fan-in source that was never deleted) kept polluting the lane count long after it was dead.
 * Instead: enumerate branch tips + their tip commit time, keep the branches with a commit in the
 * active window (plus the mainline refs develop/master unconditionally — never dropped for
 * staleness), then ONE `git log <active…> --source` pass, each line `%H %ct %S %P %s`
 * (hash / commit-time / source-ref / parents / subject). A stale branch's commits are already
 * reachable from the mainline, so they still appear (relabeled to the mainline) — not dropped.
 *
 * gap-git-history-branch-summary-wrong-numbers: `--source` labels a commit with whichever ref the
 * traversal first REACHED it from, and the walk starts at the newest tip — so a task branch whose
 * tip is newer than develop gets every shared ancestor (the whole reachable history) attributed to
 * it (observed: a 6-commit branch showed 481 commits / 111 merges / a first-commit at repo birth).
 * A commit reachable from ANY mainline ref therefore belongs to the mainline, NOT to a task branch;
 * after the log pass every such commit is re-attributed to the primary mainline ref, so each branch
 * lane carries exactly its own (exclusive) commits — `git log develop..<branch>`. A non-git
 * workspace degrades to empty; a git failure degrades to error; never throws.
 */
export function readGitHistory(root: string, { limit = GIT_HISTORY_LIMIT, nowMs = Date.now() }: { limit?: number; nowMs?: number } = {}): GitHistoryResult {
  try {
    const sinceSec = Math.floor(nowMs / 1000) - GIT_HISTORY_ACTIVE_WINDOW_SEC;
    // Enumerate local branches with their tip hash + tip commit time. `%09` emits a TAB, which git
    // forbids in ref names (a control char), so it is a safe field separator. (`%x1f` is a
    // `--pretty`-only escape — `for-each-ref --format` emits it literally.) The tip hash is the
    // branch TOPOLOGY (which commit the ref points at) — the vertical graph needs it, because the
    // `--source` attribution in the log below is only "which ref the traversal reached the commit
    // through", NOT "which branch this commit belongs to".
    const refsOut = execFileSync(
      "git",
      ["-C", root, "for-each-ref", "refs/heads", "--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)"],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const activeRefs: string[] = [];
    const heads: Record<string, string> = {};
    let sawAnyRef = false;
    for (const line of refsOut.split(/\r?\n/)) {
      if (!line) continue;
      sawAnyRef = true;
      const [name, tipHash, tipTsRaw] = line.split("\t");
      const tipTs = Number(tipTsRaw ?? "");
      // Keep a branch if its tip is inside the active window, OR it is a mainline ref
      // (develop/master are always kept regardless of tip age — their tips advance only at
      // merge boundaries, which can be >24h apart; a mainline lane must never drop out).
      if (name && tipHash && Number.isFinite(tipTs) && (tipTs >= sinceSec || GIT_HISTORY_MAINLINE_REFS.has(name))) {
        activeRefs.push(name);
        heads[name] = tipHash;
      }
    }
    if (activeRefs.length === 0) {
      // No active branch: a fresh repo with no commits, or every branch is stale with no mainline.
      return {
        status: "empty",
        reason: sawAnyRef ? `无活跃分支（最近 ${GIT_HISTORY_ACTIVE_WINDOW_SEC / 86400} 天无提交且无 develop/master）` : "git 仓库无提交记录",
        commits: [],
        head: null,
        heads: {},
      };
    }
    const out = execFileSync(
      "git",
      ["-C", root, "log", ...activeRefs, "--source", "--date=unix", `-n ${limit}`, "--pretty=format:%H%x1f%ct%x1f%S%x1f%P%x1f%s"],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const commits: GitHistoryCommit[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line) continue;
      const [hash, t, ref, parents, ...subjectParts] = line.split("\x1f");
      if (!hash || !t || !ref) continue;
      const parentHashes = (parents ?? "").split(/\s+/).filter(Boolean);
      commits.push({
        hash,
        t: Number(t),
        ref,
        parents: parentHashes.length,
        parentHashes,
        subject: subjectParts.join("\x1f"),
      });
    }
    // gap-git-history-branch-summary-wrong-numbers: `--source` labels a shared ancestor with the
    // newest tip's ref, so a task branch whose tip is newer than develop absorbs the whole reachable
    // history. A commit reachable from ANY mainline ref is the mainline's — re-attribute it to the
    // primary mainline ref (develop sorts before master in for-each-ref, so it wins when both exist)
    // so each branch lane carries exactly its own commits (`git log develop..<branch>`). Branch
    // EXCLUSIVE commits are reachable from only that branch, so `--source` already labels them right.
    const mainlineRefs = activeRefs.filter((r) => GIT_HISTORY_MAINLINE_REFS.has(r));
    if (mainlineRefs.length > 0 && commits.length > 0) {
      const mainlineHashes = new Set(
        execFileSync("git", ["-C", root, "rev-list", ...mainlineRefs], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] })
          .split(/\s+/)
          .filter(Boolean),
      );
      const primary = mainlineRefs[0];
      for (const c of commits) {
        if (mainlineHashes.has(c.hash) && !GIT_HISTORY_MAINLINE_REFS.has(c.ref)) c.ref = primary;
      }
    }
    if (commits.length === 0) {
      return { status: "empty", reason: "git 仓库无提交记录", commits: [], head: null, heads: {} };
    }
    let head: string | null = null;
    try {
      const headOut = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
      });
      head = headOut.trim().split(/\r?\n/)[0] || null;
    } catch {
      head = null; // unborn HEAD / detached — the renderer falls back to the newest commit as trunk root.
    }
    return { status: "ok", reason: null, commits, head, heads };
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
    if (stderr.includes("not a git repository")) {
      return { status: "empty", reason: "工作区不是 git 仓库（无提交记录）", commits: [], head: null, heads: {} };
    }
    return {
      status: "error",
      reason: `git log 失败：${err instanceof Error ? err.message : String(err)}`,
      commits: [],
      head: null,
      heads: {},
    };
  }
}

// ── AC95: six new views (dashboard · system · manager · tests · sessions · architecture) ───────────
// Each new view reads the MECHANISM that produces its numbers (AC2):
//   system       → resource-gate.sh + process-budget.sh (text output)
//   manager      → loop-driver-check.sh + session-liveness.sh + observer-registry.conf + ready-pool-check.ts
//   tests        → .quay/verification-round.jsonl + .quay/full-suite-state.json (the suite-state writer)
//   sessions     → session-liveness.sh --once + resolved session transcripts
//   architecture → git log per packages/* path + git worktree list (filesystem/git facts)
//   dashboard    → the same sources via the specific views above, plus client.taskList (in the handler)
// Everything degrades per the header contract: absent → 「未接入/无数据」, unreadable → 「读失败」,
// never a 500. AC2's hard rule: NONE of this parses the manager's narrative tick/phase-goal prose
// docs — the AC2 mechanical grep (the two narrative doc names over packages/quay/src) must hit 0.
// Those are prose, not the producing mechanism.

/** Resolve a plugin script relative to THIS module, mirroring readBoardLanding's dev/dist fallback. */
function resolvePluginScript(rel: string): string | null {
  try {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(p)) return p;
    if (rel.endsWith(".ts")) {
      const bundled = fileURLToPath(new URL(rel.replace(/\.ts$/, ".js"), import.meta.url));
      if (fs.existsSync(bundled)) return bundled;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run a plugin script with a HARD deadline and a process-group kill — the robust path for bash
 * scripts that may fork background children (session-liveness.sh spawns `sleep` children and defers
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

export const RESOURCE_GATE_REL = "../../../plugin/scripts/resource-gate.sh";
export const PROCESS_BUDGET_REL = "../../../plugin/scripts/process-budget.sh";

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

export interface ManagerResult {
  status: ObservationStatus;
  reason: string | null;
  loopDriver: LoopDriverReading;
  liveness: SessionLivenessReading;
  observers: { status: ObservationStatus; reason: string | null; rows: ObserverRow[] };
  pool: { status: ObservationStatus; reason: string | null; pool: number | null; floor: number | null; deficit: number | null; cap: number | null; lastPromoted: string[] };
  version: string | null;
  developLead: number | null;
}

export const LOOP_DRIVER_CHECK_REL = "../../../plugin/scripts/loop-driver-check.sh";
export const SESSION_LIVENESS_REL = "../../../plugin/scripts/session-liveness.sh";
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

/** Parse session-liveness.sh --once --json's { sessions: [...] } document into rows. Pure.
 *  (AC99 — the Manager view's machine-readable interface.) */
export function parseSessionLivenessJson(text: string): Array<{ name: string; alive: boolean; pid: number | null; halted: boolean }> {
  const out: Array<{ name: string; alive: boolean; pid: number | null; halted: boolean }> = [];
  let j: { sessions?: Array<{ name?: unknown; alive?: unknown; pid?: unknown; halted?: unknown }> } = {};
  try { j = JSON.parse(text) as typeof j; } catch { /* invalid JSON → no rows */ }
  for (const s of j.sessions ?? []) {
    const name = typeof s?.name === "string" ? s.name : "";
    if (!name) continue;
    out.push({
      name,
      alive: s.alive === true,
      pid: typeof s.pid === "number" && Number.isFinite(s.pid) ? s.pid : null,
      halted: s.halted === true,
    });
  }
  return out;
}

/**
 * Parse session-liveness.sh --once's `SESSION-STATUS <name> alive=… [pid=…] halted=…` rows. Pure.
 *
 * pid is OPTIONAL: the seam emits `alive=0 halted=0` (no `pid=` field) when the target's session
 * is gone — a dead layer must still surface as a GONE card, never be silently dropped.
 */
export function parseSessionLivenessOutput(text: string): Array<{ name: string; alive: boolean; pid: number | null; halted: boolean }> {
  const out: Array<{ name: string; alive: boolean; pid: number | null; halted: boolean }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^SESSION-STATUS\s+(\S+)\s+alive=(\d+)(?:\s+pid=(\d+))?\s+halted=(\d+)/.exec(line);
    if (m) {
      out.push({
        name: m[1],
        alive: m[2] === "1",
        pid: m[3] == null || m[3] === "0" ? null : Number.parseInt(m[3], 10),
        halted: m[4] === "1",
      });
    }
  }
  return out;
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

/**
 * Build explicit SESSION_TARGETS for the manager page's session-liveness probe: two named targets
 * (`outer → <session>:outer`, `inner → <session>:inner`) derived from the workspace's
 * orchestration/session-liveness.env SESSION_TMUX_SESSION.
 *
 * The env override is scoped to THIS probe (readManager) — it never mutates the shared
 * orchestration/session-liveness.env, so the outer/inner liveness mounts that source that file
 * keep their existing single target (AC3: existing mounts must not be disturbed).
 *
 * Returns null when the session name is unavailable (no env file / no SESSION_TMUX_SESSION) — the
 * caller then falls back to the script's own resolution (its env-file SESSION_TARGETS), preserving
 * the pre-existing display rather than inventing targets. An invented target would be a fake
 * reading (hard rule ④ — it can never be false), so we fail-closed to "no override".
 */
export function buildManagerSessionTargets(root: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "orchestration", "session-liveness.env"), "utf8");
  } catch {
    return null;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const m = /^SESSION_TMUX_SESSION=(.*)$/.exec(rawLine.trim());
    if (!m) continue;
    let session = m[1].trim().replace(/^["']|["']$/g, "");
    session = session.split(":")[0]; // strip any window/pane suffix → base session name
    if (!session) continue;
    return `outer ${root} ${session}:outer\ninner ${root} ${session}:inner`;
  }
  return null;
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

/** session-liveness.sh --once --json → per-target liveness rows (--once is REQUIRED: without it
 *  the script MOUNTS and polls forever — the serve path must never block the event loop on it).
 *  The manager page is three-layer (Outer / Inner); the shared orchestration/session-liveness.env
 *  only carries the OUTER's single inner target (管理者多目标配置已外移到 ~/.quay-global), so we
 *  pass an explicit SESSION_TARGETS override registering outer + inner — scoped to this probe,
 *  never mutating the env file the outer/inner mounts source (AC3). AC99: the --json output is
 *  requested (the Manager view's machine-readable interface). One of readManager's four CONCURRENT
 *  probes. */
async function runLivenessProbe(root: string, targets: string | null): Promise<SessionLivenessReading> {
  const r = await runPluginScript(root, SESSION_LIVENESS_REL, ["--once", "--json"], 20_000, targets ? { SESSION_TARGETS: targets } : undefined);
  const rows = r.stdout == null ? [] : parseSessionLivenessJson(r.stdout);
  if (r.stdout == null) return { status: "empty", reason: r.reason, sessions: [] };
  if (rows.length === 0) return { status: "empty", reason: "session-liveness 无 SESSION-STATUS 行（无观测目标）", sessions: [] };
  return { status: "ok", reason: null, sessions: rows };
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
 * optimization AC1): loop-driver + session-liveness ONLY, WITHOUT the pool probe.
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
  const targets = buildManagerSessionTargets(root);
  const [loopDriver, liveness] = await Promise.all([
    runLoopDriverProbe(root),
    runLivenessProbe(root, targets),
  ]);

  const version: string | null = QUAY_VERSION || null;

  const degraded = loopDriver.status === "empty" && liveness.status === "empty";
  return {
    status: degraded ? "empty" : "ok",
    reason: degraded ? "manager 观测机制脚本缺失" : null,
    loopDriver,
    liveness,
    observers: { status: "empty", reason: "dashboard 轻量探针不含 observers（/manager 详情页才含）", rows: [] },
    pool: { status: "empty", reason: "dashboard 轻量探针不含 pool（/manager 详情页才含）", pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] },
    version,
    developLead: null,
  };
}

/** Manager view: loop-driver + session-liveness + observer registry + promotion-driver pool metrics. */
export async function readManager(root: string): Promise<ManagerResult> {
  // AC1 (gap-webui-dashboard-manager-slow-parallelize): the four async probes are independent — run
  // them CONCURRENTLY. readPoolMetrics (AC136) reads the promotion-driver's round carrier — a small
  // sync file read, no subprocess — so the ~9s slot-refill cold-call floor is gone from the manager
  // path too. buildManagerSessionTargets is a tiny synchronous file read needed for the liveness
  // probe's SESSION_TARGETS override, so it runs first; observers registry + version are small sync
  // reads kept inline.
  const targets = buildManagerSessionTargets(root);

  const [loopDriver, liveness, pool, developLead] = await Promise.all([
    runLoopDriverProbe(root),
    runLivenessProbe(root, targets),
    readPoolMetrics(root),
    readDevelopLead(root),
  ]);

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

  const degraded = loopDriver.status === "empty" && liveness.status === "empty" && pool.status === "empty";
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

// ── Tests view (verification-round.jsonl + full-suite-state.json) ──────────────────────────────────

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
}

export interface TestsResult {
  status: ObservationStatus;
  reason: string | null;
  runs: TestRunRecord[];
  /** Current `.quay/full-suite-state.json` `state` (running|green|red|absent), null when absent. */
  currentState: string | null;
}

export const VERIFICATION_ROUND_REL = "../../../.quay/verification-round.jsonl";
export const FULL_SUITE_STATE_REL = "../../../.quay/full-suite-state.json";

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
    };
  } catch {
    return null;
  }
}

/** Tests view: the suite-state writer's own round sequence + current state. */
export function readTests(root: string): TestsResult {
  const roundsPath = path.join(root, ".quay", "verification-round.jsonl");
  const runs: TestRunRecord[] = [];
  let statePathStatus: ObservationStatus = "ok";
  let reason: string | null = null;
  try {
    if (!fs.existsSync(roundsPath)) {
      statePathStatus = "empty";
      reason = ".quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）";
    } else {
      const text = fs.readFileSync(roundsPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const rec = parseVerificationRound(line);
        if (rec) runs.push(rec);
      }
      if (runs.length === 0) {
        statePathStatus = "empty";
        reason = "verification-round.jsonl 存在但无有效记录";
      } else {
        // The suite writer appends oldest→newest; the page shows 最新在前, so present newest-first.
        runs.reverse();
      }
    }
  } catch (err) {
    statePathStatus = "error";
    reason = `verification-round.jsonl 读失败：${err instanceof Error ? err.message : String(err)}`;
  }

  let currentState: string | null = null;
  try {
    const statePath = path.join(root, ".quay", "full-suite-state.json");
    if (fs.existsSync(statePath)) {
      const j = JSON.parse(fs.readFileSync(statePath, "utf8"));
      currentState = typeof j.state === "string" ? j.state : null;
    }
  } catch { currentState = null; }

  return { status: statePathStatus, reason, runs, currentState };
}

// ── Sessions view (session-liveness + resolved transcript tails) ───────────────────────────────────

export interface SessionMessage {
  time: string;
  role: string;
  text: string;
}

export type SessionLayer = "Manager" | "Outer" | "Inner" | "Other";

export interface SessionDetail {
  name: string;
  layer: SessionLayer;
  alive: boolean;
  pid: number | null;
  halted: boolean;
  transcriptStatus: ObservationStatus;
  transcriptReason: string | null;
  messages: SessionMessage[] | null;
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
 * Best-effort read of the last few user/assistant text messages from a Claude Code transcript
 * JSONL. Bounded to the file tail so a multi-GB transcript never loads fully. Returns null when
 * the path is missing/unreadable (the page then shows 未接入 for that layer).
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

/** Sessions view: session-liveness rows + best-effort transcript tails per live session. */
export async function readSessions(root: string): Promise<SessionsResult> {
  const p = resolvePluginScript(SESSION_LIVENESS_REL);
  if (!p) {
    return { status: "empty", reason: `${SESSION_LIVENESS_REL} 缺失（未接入）`, sessions: [] };
  }
  // Register explicit outer+inner targets (same override the Manager view uses) so the sessions
  // resolve to layer-named rows (`outer` / `inner`) instead of whatever single default target the
  // workspace env happens to name — the /sessions page is a three-layer view by design. Fail-closed:
  // when no session name is derivable, buildManagerSessionTargets returns null and we run with the
  // env's own targets (preserving pre-existing display).
  const targets = buildManagerSessionTargets(root);
  const r = await runPluginScript(root, SESSION_LIVENESS_REL, ["--once", "--json"], 20_000, targets ? { SESSION_TARGETS: targets } : undefined);
  if (r.stdout == null) {
    return { status: "empty", reason: r.reason, sessions: [] };
  }
  const rows = parseSessionLivenessJson(r.stdout);
  if (rows.length === 0) {
    return { status: "empty", reason: "session-liveness 无 SESSION-STATUS 行（无观测目标）", sessions: [] };
  }

  const sessions: SessionDetail[] = [];
  for (const row of rows) {
    let transcript: { status: ObservationStatus; reason: string | null; messages: SessionMessage[] | null } =
      { status: "empty", reason: "未解析 transcript 路径（无 pid）", messages: null };
    if (row.alive && row.pid != null) {
      const t = await runScriptBounded(["bash", p, "--resolve-transcript", row.name, root, String(row.pid)], { cwd: root, timeoutMs: 10_000 });
      const tp = t.stdout.trim().split(/\r?\n/).pop() ?? "";
      if (tp && fs.existsSync(tp)) transcript = readTranscriptTail(tp);
      else transcript = { status: "empty", reason: "transcript 路径不可解析", messages: null };
    }
    sessions.push({
      name: row.name,
      layer: classifySessionLayer(row.name),
      alive: row.alive,
      pid: row.pid,
      halted: row.halted,
      transcriptStatus: transcript.status,
      transcriptReason: transcript.reason,
      messages: transcript.messages,
    });
  }

  return { status: "ok", reason: null, sessions };
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
