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
import { execFileSync } from "node:child_process";

export const FAST_MODE_EVENTS_DIR = ".workflow-events";
export const ORCHESTRATION_DIR = "orchestration";
export const ESCALATIONS_FILE = "escalations.md";
export const TICK_LOG_FILE = "tick-log.md";
export const GIT_LOG_LIMIT = 20;
/** Recent-entry bounds for the /journal page. */
export const JOURNAL_ESCALATION_SECTIONS = 10;
export const JOURNAL_TICK_ROWS = 15;

export type ObservationStatus = "ok" | "empty" | "error";

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
function readEventsFromDir(eventsDir: string): RawEvent[] {
  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl")).sort();
  const events: RawEvent[] = [];
  for (const file of files) {
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
 * Live loop view: in-flight fast-mode tasks + elapsed minutes + concurrency + CPU pressure.
 * Degrades per the header contract; never throws.
 */
export function readLive(root: string, { nowMs = Date.now() }: { nowMs?: number } = {}): LiveResult {
  const eventsDir = path.join(root, FAST_MODE_EVENTS_DIR);
  let inFlight: InFlightTask[] = [];
  let status: ObservationStatus = "ok";
  let reason: string | null = null;
  try {
    if (!fs.existsSync(eventsDir)) {
      status = "empty";
      reason = `未找到遥测记录（${FAST_MODE_EVENTS_DIR}/ 不存在）`;
    } else {
      inFlight = pairInFlight(readEventsFromDir(eventsDir), nowMs);
    }
  } catch (err) {
    status = "error";
    reason = `读取遥测失败：${err instanceof Error ? err.message : String(err)}`;
  }

  let cpuPressure: number | null = null;
  try {
    const cpu = fs.readFileSync("/proc/pressure/cpu", "utf8");
    const m = /some\s+avg10=([0-9.]+)/.exec(cpu);
    if (m) cpuPressure = Number.parseFloat(m[1]);
  } catch {
    cpuPressure = null; // non-Linux or unreadable — the row is simply omitted
  }

  return { status, reason, inFlight, concurrency: inFlight.length, cpuPressure };
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
