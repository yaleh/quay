// Driver (QENG-4) — the `quay run` autonomous loop AS CODE. The CAPSTONE that
// composes QENG-1/2/3 without restating them: it scans the board for actionable
// `ready` tasks, drives each through QENG-3 `runComplete` (which runs the QENG-2
// acceptance gate + appends a QENG-1 GateEvent + writes the status), and stops at
// a fixpoint or a stop sentinel. This is what would eventually replace a
// hand-run prose outer-loop driver — the loop calls one command instead of
// interpreting prose.
//
// Adds NO new gate logic and touches NO Provider ABI beyond `taskList` (scan) +
// whatever `runComplete` / the acceptance gate already use (`taskWrite`,
// `taskCheck`). Confirmed against quay-native/store.js: `taskList` returns FULL
// task objects incl. `status` + `extra` (list→get→toViewModel), so the meter is
// read directly off the scan result — the driver does NOT `taskGet` each
// candidate.

import fs from "node:fs";
import path from "node:path";
import { runComplete } from "./lifecycle.ts";
import { TASK_STATUS, type Task } from "../abi.ts";

interface DriverClient {
  // `includeBody` is part of the ABI's task_list surface (the frontmatter-only projection every
  // render-only consumer uses) — declared here because scanActionable asks for it.
  taskList: (filter: { status: string; includeBody?: boolean }) => Promise<{ tasks: Task[]; malformed: Array<{ file: string; error: string }> }>;
  taskGet: (id: string) => Promise<Task | null>;
  taskWrite: (args: { id: string; status: string; expectedStatus: string }) => Promise<unknown>;
  taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }>;
}

export interface LoopConfig {
  workspaceRoot: string;
}

export interface RunOnceArgs {
  client: DriverClient;
  logPath: string;
  actor?: string;
}

export interface RunLoopArgs {
  client: DriverClient;
  cfg: LoopConfig;
  logPath: string;
  actor?: string;
  maxIterations?: number;
}

export interface RunOnceResult {
  processed: string | null;
  ok: boolean | null;
  reason: string | null;
}

export interface RunLoopResult {
  iterations: number;
  completed: string[];
  stopped: "fixpoint" | "sentinel" | "cap";
}

/**
 * Pure predicate — no I/O, unit-testable in isolation. A task is ACTIONABLE iff
 * it is `status === "ready"` AND carries a non-empty (trimmed) `extra.acceptance`
 * meter string.
 *
 * The load-bearing anti-spin decision (proposal §Scan predicate): the acceptance
 * gate is fail-closed — a `ready` task with no meter returns `{ok:false, "no
 * acceptance command defined"}`, so `runComplete` would exit 1 and leave it
 * `ready`. If the predicate were bare `status==="ready"`, the very next scan
 * would re-select that same un-completable task → the loop spins forever.
 * Requiring a meter makes meterless `ready` tasks NOT actionable → skipped
 * (never selected, never mutated) — the first anti-spin layer.
 */
export function isActionable(task: Task): boolean {
  return task?.status === TASK_STATUS.READY
    && typeof (task?.extra as Record<string, unknown>)?.acceptance === "string"
    && ((task.extra as Record<string, unknown>).acceptance as string).trim() !== "";
}

/**
 * Deterministic scan: fetch `ready` tasks, filter by the actionable predicate,
 * subtract `seen`, and sort ids ascending (driver-owned total order, NOT relying
 * on `taskList` order). Returns the id list (lowest first).
 *
 * `seen` (default empty) removes ids already attempted this run — see `runLoop`:
 * because the scan subtracts `seen`, a failing-meter `ready` task is attempted at
 * most once per run and the scan drains to `[]` → clean fixpoint.
 */
export async function scanActionable(client: DriverClient, seen: Set<string> = new Set()): Promise<string[]> {
  // gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp: this scan reads
  // only `status`, `id` and `extra.acceptance` (isActionable below) — never a body — so
  // it asks the ABI for the frontmatter-only projection. `ready` is a small subset of the
  // store, but the Provider's task_list resolves the filtered set BEFORE it can project,
  // so without `includeBody:false` this driver-internal scan paid for every matching body
  // on every pass. The projection keeps `extra` (only `body` is stripped), which is what
  // isActionable reads.
  const { tasks } = await client.taskList({ status: TASK_STATUS.READY, includeBody: false });
  return tasks
    .filter(isActionable)
    .map((t) => t.id)
    .filter((id) => !seen.has(id))
    .sort();
}

/**
 * Process exactly ONE actionable task via QENG-3 `runComplete`.
 *   pass → task advances to `done` (runComplete writes it)
 *   fail → task stays `ready` + a fail GateEvent is recorded (runComplete)
 * No actionable task → { processed: null } (caller prints "nothing to do").
 *
 * NOTE: `--once` is a SINGLE observation with NO `seen` state. It always picks
 * the lowest actionable id; if that task's meter FAILS it stays `ready` and a
 * subsequent `--once` (a fresh process) picks the SAME task again. That is by
 * design (one process = one deterministic observation), NOT progress on other
 * tasks — forward progress across a failing task is `runLoop`'s job.
 */
export async function runOnce({ client, logPath, actor = "quay-cli" }: RunOnceArgs): Promise<RunOnceResult> {
  const [id] = await scanActionable(client);
  if (!id) return { processed: null, ok: null, reason: null };
  const { ok, reason } = await runComplete({ client, id, logPath, actor });
  return { processed: id, ok, reason };
}

/**
 * Bounded loop until fixpoint OR stop sentinel. Each iteration scans MINUS the
 * `seen` set and processes the lowest remaining actionable id.
 *
 * Three independent stops:
 *   sentinel — <cfg.workspaceRoot>/.quay/.stop, checked at the TOP of each
 *              iteration (clean boundary, never mid-write).
 *   fixpoint — scanActionable(client, seen) returns [] (the normal exit).
 *   cap      — maxIterations (default 1000), a hard ceiling so it cannot hang;
 *              the ONLY nonzero-mapped outcome.
 *
 * Anti-spin (load-bearing correction): a task is added to `seen` AFTER it is
 * attempted (pass OR fail). A pass leaves the board (status→done, no longer
 * `ready`); a fail leaves it `ready`, so `seen` is what stops it being re-picked.
 * Because `scanActionable` subtracts `seen`, once every actionable id has been
 * attempted the scan returns [] → clean fixpoint (not cap), while OTHER ready
 * tasks still make forward progress.
 */
export async function runLoop({ client, cfg, logPath, actor = "quay-cli", maxIterations = 1000 }: RunLoopArgs): Promise<RunLoopResult> {
  const seen = new Set<string>();
  const completed: string[] = [];
  const stopFile = path.join(cfg.workspaceRoot, ".quay", ".stop");
  let iterations = 0;
  while (true) {
    if (fs.existsSync(stopFile)) return { iterations, completed, stopped: "sentinel" };
    if (iterations >= maxIterations) return { iterations, completed, stopped: "cap" };
    const [id] = await scanActionable(client, seen);
    if (!id) return { iterations, completed, stopped: "fixpoint" };
    iterations++;
    seen.add(id);
    const { ok } = await runComplete({ client, id, logPath, actor });
    if (ok) completed.push(id);
  }
}
