// observation/liveness.ts — the LIVENESS seam (split out of observation.ts, task
// gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module).
//
// Responsibility: answer "is it ALIVE right now?" for every object the loop page renders —
//   · the loop itself    — activity signals + the telemetry-empty discriminator (readActivitySignals,
//                          decideLiveState);
//   · a fast-mode run    — the /proc runId probe (runProcessAliveSync / classifyRunLiveness);
//   · a worker process   — the scoped /proc cmdline scan (readLiveWorkerProcesses);
//   · the worker-driver  — online instant, active discriminator, round/lock/suite carriers;
//   · an in-flight task  — the execution-phase derivation (deriveInFlightPhase).
//
// ⛔ It only READS. The merge/annotation of these readings into the in-flight view is readLive's job
// and stays in observation.ts (it also needs the task store, which this seam must not touch).
// The record PARSERS this seam consumes live in ./records.ts — the direction is one-way
// (liveness → records → model), so no cycle.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readProcCmdlineText } from "../kernel/proc-identity.ts";
import { TASK_STATUS } from "../core/types.ts";
import {
  FAST_MODE_EVENTS_DIR,
  ORCHESTRATION_DIR,
  TICK_LOG_FILE,
  WORKER_OUTCOME_REL,
  WORKER_ROUND_REL,
  FAN_IN_LOCK_EVENTS_REL,
  FULL_SUITE_STATE_REL,
  WORKER_PROCESS_NAME,
} from "./model.ts";
import type { InFlightPhase, InFlightTask, RunLiveness, SuiteStateView } from "./model.ts";
import { parseWorkerOutcomeRecords, readCarrierText } from "./records.ts";

/**
 * gap-live-cannot-tell-a-dead-loop-from-an-unwired-one: the activity window used to tell
 * 「循环在跑但没接遥测」 apart from 「循环根本没跑」. A signal is "active" if it falls inside the
 * window. Mirrors the manager's现场 measurements (archguard: 3 commits/30 min, tick-log mtime
 * minutes old) and the contract's `--since='30 minutes ago'` measure.
 */
export const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

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
    // 读 /proc/<pid>/cmdline 由 kernel leaf 单点实现（同文件 runProcessAliveSync 下方的迁移）。
    // ⛔ 读不成 ⇒ null ⇒ continue（与迁移前 catch 同路），不折成空串。
    const text = readProcCmdlineText(e, procDir);
    if (text === null) continue;
    const cmdline = text.trim();
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
      // 读 /proc/<pid>/cmdline 由 kernel leaf 单点实现（本文件原有第二份手搓副本 —
      // gap-judgment-rewrites-route-through-proc-identity-leaf）。用 Text 形而非 argv 形是刻意的：
      // 本函数比的是【空格 join 后的整串】，且「读到了但空」与「读不成」在这里都不命中、都计入
      // readable —— Text 形对两者分别给出 "" / null，落到同一个 continue-后-else 分支上，与迁移前逐字一致。
      const cmd = readProcCmdlineText(pid);
      if (cmd === null) continue; // pid exited mid-scan — not a match
      readable++;
      if (cmd.includes(needle)) return true;
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

  const outcomeText = preRead.outcomeText !== undefined ? preRead.outcomeText : readCarrierText(root, WORKER_OUTCOME_REL).text;
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
