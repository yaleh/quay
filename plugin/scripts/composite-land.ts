// composite-land.ts — M189/DIR-119-B Stage 2.6: atomic Land + legacy compatibility.
//
// Turns a `ReconcileResult` into ONE Land transaction: `milestone_counter` increments exactly
// once regardless of task count, exactly one dashboard entry is written (never one per task),
// and task-completion count is recorded separately from the counter. Land is atomic — a failed
// or incomplete reconcile produces a transaction with `ok:false` and ZERO mutations/counter
// delta/dashboard entries; there is no partial-Land path. `legacySingletonLandShape` gives the
// golden-replay comparison a single-task dispatch through this NEW code path must reproduce.

import type { ReconcileResult } from "./composite-reconcile.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface TaskMark {
  taskId: string;
  status: "done";
}

export interface LandTransaction {
  ok: boolean;
  reason?: string;
  /** Always 0 (failure) or 1 (success) — regardless of `taskIds.length`. */
  counterDelta: number;
  /** Always 0 (failure) or 1 (success) — ONE composite dashboard entry, never one per task. */
  dashboardEntryCount: number;
  /** Recorded separately from `counterDelta` — how many tasks this Land actually completed. */
  taskCompletionCount: number;
  taskMarks: TaskMark[];
}

// ── buildLandTransaction ───────────────────────────────────────────────────────────────────────────

export function buildLandTransaction(taskIds: string[], reconcileResult: ReconcileResult): LandTransaction {
  const noLand = (reason: string): LandTransaction => ({
    ok: false,
    reason,
    counterDelta: 0,
    dashboardEntryCount: 0,
    taskCompletionCount: 0,
    taskMarks: [],
  });

  if (!reconcileResult.ok) {
    return noLand(reconcileResult.reason ?? "reconcile-not-ok");
  }
  // Reconcile is atomic by its own contract (composite-reconcile.ts), but Land re-verifies
  // completeness independently rather than trusting reconcile's internal bookkeeping alone —
  // defense in depth against a caller passing a mismatched (taskIds, reconcileResult) pair.
  const mutatedTaskIds = new Set(reconcileResult.mutations.map((m) => m.taskId));
  const membershipComplete = taskIds.length > 0 && taskIds.every((id) => mutatedTaskIds.has(id)) && mutatedTaskIds.size === taskIds.length;
  if (!membershipComplete) {
    return noLand(`reconcile-mutation-set-does-not-match-membership: expected [${taskIds.join(",")}], got [${[...mutatedTaskIds].join(",")}]`);
  }

  return {
    ok: true,
    counterDelta: 1,
    dashboardEntryCount: 1,
    taskCompletionCount: taskIds.length,
    taskMarks: taskIds.map((taskId) => ({ taskId, status: "done" as const })),
  };
}

// ── legacySingletonLandShape — golden-replay comparison target ───────────────────────────────────────
// The exact shape the PRE-existing single-task Land step produces (one counter increment, one
// dashboard entry, one completed task). A real single-task dispatch through the NEW composite
// code path (`buildLandTransaction([taskId], ...)`) must match this on every shared field.

export function legacySingletonLandShape(): Pick<LandTransaction, "counterDelta" | "dashboardEntryCount" | "taskCompletionCount"> {
  return { counterDelta: 1, dashboardEntryCount: 1, taskCompletionCount: 1 };
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  const okReconcile = (taskIds: string[]): ReconcileResult => ({
    ok: true,
    mutations: taskIds.map((t) => ({ taskId: t, checkboxes: ["ac-0"], absorbDisposition: "PASS" })),
    bundleDisposition: "PASS",
  });

  // Golden replay: a single-task dispatch matches the legacy shape exactly.
  {
    const txn = buildLandTransaction(["DIR-1"], okReconcile(["DIR-1"]));
    const legacy = legacySingletonLandShape();
    check(
      "golden-replay-singleton-matches-legacy-shape",
      txn.ok === true && txn.counterDelta === legacy.counterDelta && txn.dashboardEntryCount === legacy.dashboardEntryCount && txn.taskCompletionCount === legacy.taskCompletionCount,
      JSON.stringify({ txn, legacy }),
    );
  }

  // Atomic Land at widths 1, 3, 5, 10: counter increments exactly once, ONE dashboard entry,
  // regardless of task count — task-completion count recorded separately.
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const txn = buildLandTransaction(taskIds, okReconcile(taskIds));
    check(`atomic-land-width-${n}-single-counter-increment`, txn.counterDelta === 1, `counterDelta=${txn.counterDelta}`);
    check(`atomic-land-width-${n}-single-dashboard-entry`, txn.dashboardEntryCount === 1, `dashboardEntryCount=${txn.dashboardEntryCount}`);
    check(`atomic-land-width-${n}-completion-count-matches-width`, txn.taskCompletionCount === n, `${txn.taskCompletionCount} vs ${n}`);
    check(`atomic-land-width-${n}-all-tasks-marked-done`, txn.taskMarks.length === n && txn.taskMarks.every((m) => m.status === "done"), JSON.stringify(txn.taskMarks));
  }

  // Failed reconcile → NO partial Land: zero counter delta, zero dashboard entries, zero task marks.
  {
    const failedReconcile: ReconcileResult = { ok: false, reason: "bundle-verdict-not-pass: REFUTED", mutations: [] };
    const txn = buildLandTransaction(["T-0", "T-1", "T-2"], failedReconcile);
    check(
      "failed-reconcile-produces-zero-mutation-land",
      txn.ok === false && txn.counterDelta === 0 && txn.dashboardEntryCount === 0 && txn.taskCompletionCount === 0 && txn.taskMarks.length === 0,
      JSON.stringify(txn),
    );
  }

  // Defense in depth: a reconcile claiming ok:true but with an incomplete mutation set (fewer
  // tasks mutated than the membership) is rejected by Land rather than trusted blindly.
  {
    const partialReconcile: ReconcileResult = {
      ok: true,
      mutations: [{ taskId: "T-0", checkboxes: [], absorbDisposition: "PASS" }], // T-1 missing
      bundleDisposition: "PASS",
    };
    const txn = buildLandTransaction(["T-0", "T-1"], partialReconcile);
    check("incomplete-mutation-set-rejected-by-land", txn.ok === false && txn.counterDelta === 0, JSON.stringify(txn));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-land.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
