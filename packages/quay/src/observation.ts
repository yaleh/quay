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
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const FAST_MODE_EVENTS_DIR = ".workflow-events";
export const ORCHESTRATION_DIR = "orchestration";
export const ESCALATIONS_FILE = "escalations.md";
export const TICK_LOG_FILE = "tick-log.md";
export const GIT_LOG_LIMIT = 20;
/** Recent-entry bounds for the /journal page. */
export const JOURNAL_ESCALATION_SECTIONS = 10;
export const JOURNAL_TICK_ROWS = 15;
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

export interface InFlightTask {
  taskId: string;
  runId: string;
  startedAtMs: number;
  /** Elapsed minutes from startedAtMs to the observation instant, rounded to 1 decimal. */
  minutes: number;
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
 */
export function pairInFlight(events: RawEvent[], nowMs: number): InFlightTask[] {
  const byRun = new Map<string, { runId: string; taskId: string; start: RawEvent | null; ends: RawEvent[] }>();
  for (const e of events) {
    if (!e || e.stage !== "Fast" || e.eventKind === "blocked") continue;
    const runId = typeof e.runId === "string" ? e.runId : "";
    const taskId = typeof e.taskId === "string" ? e.taskId : "";
    if (!runId) continue;
    let rec = byRun.get(runId);
    if (!rec) {
      rec = { runId, taskId, start: null, ends: [] };
      byRun.set(runId, rec);
    }
    if (isStartLike(e)) {
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
        minutes: Math.max(0, (nowMs - rec.start.timing.startedAtMs) / 60_000),
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

/**
 * Live loop view: in-flight fast-mode tasks + elapsed minutes + concurrency + CPU pressure +
 * the loop-state discriminator. Degrades per the header contract; never throws.
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
        inFlight = pairInFlight(readEventsFromDir(eventsDir, files), nowMs);
      }
    }
  } catch (err) {
    status = "error";
    reason = `读取遥测失败：${err instanceof Error ? err.message : String(err)}`;
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

/**
 * Read a markdown table file and keep the header + separator + the most recent `max` data rows.
 * Newest-first tables (tick-log.md) put recent rows right after the header, so the first `max`
 * `|`-rows after the separator are the recent ones; a trailing summary/tally table is excluded
 * because it sits at the END of the `|`-row sequence.
 */
function readRecentTableRows(root: string, relFile: string, max: number): JournalSection {
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
  const tableLines = text.split(/\r?\n/).filter((ln) => ln.trim().startsWith("|"));
  if (tableLines.length < 2) {
    return { status: "ok", reason: null, markdown: tableLines.join("\n") };
  }
  const markdown = [tableLines[0], tableLines[1], ...tableLines.slice(2, 2 + max)].join("\n");
  return { status: "ok", reason: null, markdown };
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

/** Journal view: recent escalations + tick log + commits. Degrades per the header contract; never throws. */
export function readJournal(root: string): JournalResult {
  return {
    escalations: readRecentSections(path.join(root, ORCHESTRATION_DIR), ESCALATIONS_FILE, JOURNAL_ESCALATION_SECTIONS),
    tickLog: readRecentTableRows(path.join(root, ORCHESTRATION_DIR), TICK_LOG_FILE, JOURNAL_TICK_ROWS),
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
}

export interface BoardExecution {
  status: ObservationStatus;
  reason: string | null;
  /** taskId → Set of execution flags: "in-flight-timeout" | "orphan". */
  flags: Map<string, Set<string>>;
  /** In-flight run detail for the page (runId + elapsed minutes). */
  inFlight: InFlightTask[];
}

/**
 * Reuse the drift checker as the single authoritative landing judgment. Runs
 * `plugin/scripts/task-status-drift-check.ts --json` (resolved relative to THIS module, with
 * cwd = the served workspace root so findRepoRoot finds the served store) and maps its output:
 *   suspects  → "landed-not-closed"  (已落地但未收尾: code in tree, status not closed)
 *   reverse   → "done-unlanded"      (done 但未落地: done, code never landed)
 * Fail-closed: script absent → 「无数据」; run/parse failure → 「读失败」. Never throws (AC6).
 */
export async function readBoardLanding(root: string): Promise<BoardLanding> {
  let scriptPath: string;
  let stripTypes = true;
  try {
    scriptPath = fileURLToPath(new URL(DRIFT_CHECKER_REL, import.meta.url));
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
    const { stdout } = await execFileP("node", argv, {
      cwd: root,
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    const parsed = JSON.parse(stdout);
    const flags = new Map<string, string>();
    for (const s of parsed.suspects ?? []) flags.set(s.taskId, "landed-not-closed");
    for (const r of parsed.reverse ?? []) flags.set(r.taskId, "done-unlanded");
    return { status: "ok", reason: null, flags, scanned: parsed.scanned ?? 0 };
  } catch (err) {
    return {
      status: "error",
      reason: `landing 判断源读失败：${err instanceof Error ? err.message : String(err)}`,
      flags: new Map(),
      scanned: 0,
    };
  }
}

/**
 * Best-effort process-liveness probe for a fast-mode runId, mirroring fast-mode-telemetry.ts's
 * processAlive (scan /proc cmdlines for the runId's distinctive tail). Returns:
 *   true  — a live process cmdline contains the runId tail (executor alive → NOT orphan)
 *   false — /proc was readable and no process matched (executor observably gone → orphan)
 *   null  — /proc unavailable or unreadable (unknown → fail-closed: NOT flagged orphan)
 * This is a small NEW probe (not a reimplementation of the drift judgment), documented to mirror
 * the telemetry module so the board's orphan signal agrees with --reconcile's process probe.
 */
export async function isRunProcessAlive(runId: string): Promise<boolean | null> {
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
 * Execution column (遥测 start/end). Reuses readLive's in-flight pairing (start without end) and
 * adds the two execution-only flags:
 *   in-flight-timeout — started > IN_FLIGHT_TIMEOUT_MINUTES ago with no end (在飞超时)
 *   orphan            — started with no end AND the runId's process is observably gone (孤儿)
 * Degrades like readLive: telemetry absent → 「无数据」; unreadable → 「读失败」. Never throws.
 */
export async function readBoardExecution(root: string, { nowMs = Date.now() } = {}): Promise<BoardExecution> {
  const live = readLive(root, { nowMs });
  if (live.status === "error") {
    return { status: "error", reason: live.reason, flags: new Map(), inFlight: [] };
  }
  const flags = new Map<string, Set<string>>();
  for (const t of live.inFlight) {
    const set = new Set<string>();
    if (t.minutes > IN_FLIGHT_TIMEOUT_MINUTES) set.add("in-flight-timeout");
    const alive = await isRunProcessAlive(t.runId);
    if (alive === false) set.add("orphan");
    if (set.size) flags.set(t.taskId, set);
  }
  return { status: live.status, reason: live.reason, flags, inFlight: live.inFlight };
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

export interface GitHistoryCommit {
  /** Full commit hash. */
  hash: string;
  /** Commit timestamp (unix seconds) — the "landing time" the chart's x-axis maps to. */
  t: number;
  /** Local branch this commit was reached from (`--source`), e.g. "integration". */
  ref: string;
  /** Number of parents. > 1 → a merge commit (the fan-in landing event). */
  parents: number;
  subject: string;
}

export interface GitHistoryResult {
  status: ObservationStatus;
  reason: string | null;
  commits: GitHistoryCommit[];
}

/**
 * Read the commit-landing timeline: ONE `git log --branches --source` pass, each line
 * `%H %ct %S %P %s` (hash / commit-time / source-ref / parents / subject). A non-git
 * workspace degrades to empty; a git failure degrades to error; never throws.
 */
export function readGitHistory(root: string, { limit = GIT_HISTORY_LIMIT }: { limit?: number } = {}): GitHistoryResult {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "log", "--branches", "--source", "--date=unix", `-n ${limit}`, "--pretty=format:%H%x1f%ct%x1f%S%x1f%P%x1f%s"],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const commits: GitHistoryCommit[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line) continue;
      const [hash, t, ref, parents, ...subjectParts] = line.split("\x1f");
      if (!hash || !t || !ref) continue;
      commits.push({
        hash,
        t: Number(t),
        ref,
        parents: (parents ?? "").split(/\s+/).filter(Boolean).length,
        subject: subjectParts.join("\x1f"),
      });
    }
    if (commits.length === 0) {
      return { status: "empty", reason: "git 仓库无提交记录", commits: [] };
    }
    return { status: "ok", reason: null, commits };
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? "");
    if (stderr.includes("not a git repository")) {
      return { status: "empty", reason: "工作区不是 git 仓库（无提交记录）", commits: [] };
    }
    return {
      status: "error",
      reason: `git log 失败：${err instanceof Error ? err.message : String(err)}`,
      commits: [],
    };
  }
}
