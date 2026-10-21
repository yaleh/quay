// observation/model.ts — the shared VOCABULARY of the observation layer: the in-flight view-model
// (InFlightTask + its two axes) and the workspace-relative runtime CARRIER PATHS every seam resolves.
//
// It is a LEAF: its only import is the ABI's `TaskStatus` TYPE (erased at runtime), so it has no
// runtime edge to any seam. events/liveness/blocking/records all depend on it, and observation.ts
// re-exports it as the barrel — a leaf cannot take part in a cycle, so the seam modules stay a DAG
// no matter how they are wired together.
//
// Why these two things share a module: both are what the seams must AGREE on. A seam that declared
// its own InFlightTask shape would be a second definition of the same view-model (硬规则 5b), and a
// seam that spelled `.quay/worker-outcome.jsonl` itself would be a second carrier path (the exact
// "the writer and the reader name the same file differently" drift the carrier constants prevent).

import type { TaskStatus } from "../abi.ts";

export const FAST_MODE_EVENTS_DIR = ".workflow-events";
export const ORCHESTRATION_DIR = "orchestration";
export const ESCALATIONS_FILE = "escalations.md";
export const TICK_LOG_FILE = "tick-log.md";

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
