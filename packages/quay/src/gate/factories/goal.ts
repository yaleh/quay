// `makeGoalGate` — goal-as-criterion enforcement gate factory (SPEC §3).
//
// The goal store's criterion execution REUSES the task acceptance-runner shape
// (gate/acceptance-runner.ts runAcceptance) — NOT document `contracts` (in-process
// grep/not-grep over the doc's own body). A goal record's `criterion` is a runnable
// shell command; the gate runs it and maps the real child-process outcome to a verdict.
//
// Fails closed exactly like makeDocumentContractGate's principle ("an unenforceable
// document must never silently PASS"): a MISSING record, or a record with no (or empty)
// `criterion`, returns ok:false — an AC that cannot be mechanically judged must never
// silently go green (SPEC §2.4 / §3: AC28 was non-mechanically-judgeable and must red).
//
// The gate reads the record at GATE-RUN time (not module-load time), so an edit to the
// record's `criterion` takes effect without a process restart — same shape as makeAdrGate.

import path from "node:path";
import type { GateFn } from "../registry.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { resolveRunnerOptions } from "../config/utils.ts";
import { createGoalStore } from "../../goal-store.ts";
import type { Task } from "../../abi.ts";

/**
 * @param {string} goalId the goal record id (PHASE-NNN or AC-NNN)
 * @param {string} goalDir absolute path to the goal directory
 */
export function makeGoalGate(goalId: string, goalDir: string): GateFn {
  return async (_task: Task) => {
    const store = createGoalStore(goalDir);
    const goal = store.get(goalId);
    if (!goal) {
      return { ok: false, reason: `no such goal: ${goalId}` };
    }
    const criterion = (goal as unknown as Record<string, unknown>).criterion;
    if (typeof criterion !== "string" || criterion.trim() === "") {
      return {
        ok: false,
        reason: `${goalId} has no criterion defined (fail-closed — an unenforceable AC must never silently pass)`,
      };
    }
    // `criterion:` commands are workspace-relative (e.g. "git rev-list --count
    // integration..develop"), so they must run with cwd = workspaceRoot (goalDir's parent).
    const { cwd, timeoutMs } = resolveRunnerOptions({ cwd: path.dirname(goalDir) });
    const { ok, reason } = runAcceptance({ command: criterion, cwd, timeoutMs });
    return { ok, reason };
  };
}
