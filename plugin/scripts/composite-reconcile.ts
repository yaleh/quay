// composite-reconcile.ts — M189/DIR-119-B Stage 2.5: deterministic reconcile + gates.
//
// Reconcile is the ONLY module in this milestone's set that produces mutations — read-only
// audit (composite-audit.ts) never does (that boundary is enforced there). `reconcile()` only
// returns non-empty `mutations` after: (1) audit hash/generation identity checks out, (2) the
// bundle verdict is PASS, (3) EVERY member task has >=1 verdict and all are PASS, (4) every
// member task has run its task-scoped gate(s) and all passed, (5) the milestone-scoped gate(s)
// ran (at least once) and all passed. Any single failure anywhere returns `{ok:false,
// mutations:[]}` — atomic, no partial task-lifecycle mutation ever reaches the caller.

import type { BundleAuditResult } from "./composite-audit.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface TaskGateResult {
  taskId: string;
  gate: string;
  ok: boolean;
  detail?: string;
}

export interface MilestoneGateResult {
  gate: string;
  ok: boolean;
  detail?: string;
}

export interface ReconcileInput {
  bundleAudit: BundleAuditResult;
  /** If set, `bundleAudit.generationId` must match exactly. */
  requiredGenerationId?: string;
  /** Every member task must appear here at least once, and every appearance must be ok. */
  taskGates: TaskGateResult[];
  /** Must be non-empty and all-ok; runs ONCE for the whole bundle, not per task. */
  milestoneGates: MilestoneGateResult[];
  /** Full composite membership — the completeness check surface. */
  taskIds: string[];
}

export interface TaskMutation {
  taskId: string;
  checkboxes: string[];
  absorbDisposition: string;
}

export interface ReconcileResult {
  ok: boolean;
  reason?: string;
  mutations: TaskMutation[];
  bundleDisposition?: string;
}

// ── reconcile ──────────────────────────────────────────────────────────────────────────────────────

export function reconcile(input: ReconcileInput): ReconcileResult {
  const fail = (reason: string): ReconcileResult => ({ ok: false, reason, mutations: [] });

  // 1. Generation identity (protects against stale/forged audit receipts).
  if (input.requiredGenerationId != null && input.bundleAudit.generationId !== input.requiredGenerationId) {
    return fail(`generation-identity-mismatch: expected ${input.requiredGenerationId}, got ${input.bundleAudit.generationId ?? "<none>"}`);
  }

  // 2. Bundle verdict must PASS.
  if (input.bundleAudit.bundleVerdict !== "PASS") {
    return fail(`bundle-verdict-not-pass: ${input.bundleAudit.bundleVerdict}`);
  }

  const allVerdicts = input.bundleAudit.shardResults.flatMap((s) => s.verdicts);

  // 3. Every member task has >=1 verdict, all PASS.
  for (const taskId of input.taskIds) {
    const taskVerdicts = allVerdicts.filter((v) => v.taskId === taskId);
    if (taskVerdicts.length === 0) return fail(`no-verdict-for-task: ${taskId}`);
    if (taskVerdicts.some((v) => v.verdict !== "PASS")) return fail(`task-verdict-not-pass: ${taskId}`);
  }

  // 4. Every member task ran its task-scoped gate(s), all ok.
  for (const taskId of input.taskIds) {
    const gatesForTask = input.taskGates.filter((g) => g.taskId === taskId);
    if (gatesForTask.length === 0) return fail(`no-gate-for-task: ${taskId}`);
    if (gatesForTask.some((g) => !g.ok)) return fail(`task-gate-failed: ${taskId}`);
  }

  // 5. Milestone-scoped gate(s) ran once, all ok.
  if (input.milestoneGates.length === 0) return fail("no-milestone-gates-run");
  const failedMilestoneGate = input.milestoneGates.find((g) => !g.ok);
  if (failedMilestoneGate) return fail(`milestone-gate-failed: ${failedMilestoneGate.gate}`);

  // Every check passed — compute mutations for ALL member tasks at once (atomic: this function
  // never returns a mutation list covering a strict subset of `input.taskIds`).
  const mutations: TaskMutation[] = input.taskIds.map((taskId) => ({
    taskId,
    checkboxes: allVerdicts.filter((v) => v.taskId === taskId).map((v) => `ac-${v.acIndex}`),
    absorbDisposition: `composite-land: ${taskId} — bundle verdict PASS (candidate ${input.bundleAudit.candidateId})`,
  }));

  return {
    ok: true,
    mutations,
    bundleDisposition: `composite bundle PASS for [${input.taskIds.join(", ")}] (candidate ${input.bundleAudit.candidateId})`,
  };
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

  const passingBundle = (taskIds: string[]): BundleAuditResult => ({
    candidateId: "c-1",
    generationId: "gen-1",
    bundleVerdict: "PASS",
    shardResults: [
      {
        shardId: "s0",
        shardVerdict: "PASS",
        verdicts: taskIds.map((t) => ({ taskId: t, acIndex: 0, verdict: "PASS" as const, detail: "" })),
      },
    ],
  });

  const goodInput = (taskIds: string[]): ReconcileInput => ({
    bundleAudit: passingBundle(taskIds),
    requiredGenerationId: "gen-1",
    taskGates: taskIds.map((t) => ({ taskId: t, gate: "dod-check", ok: true })),
    milestoneGates: [{ gate: "milestone-dod", ok: true }],
    taskIds,
  });

  // Happy path at widths 1, 3, 5, 10: mutations cover EVERY member task.
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const result = reconcile(goodInput(taskIds));
    check(`happy-path-width-${n}-ok`, result.ok === true, JSON.stringify(result));
    check(`happy-path-width-${n}-mutations-cover-all-tasks`, result.mutations.length === n, `${result.mutations.length} vs ${n}`);
  }

  // Bundle verdict REFUTED → zero mutations.
  {
    const input = goodInput(["T-0", "T-1"]);
    input.bundleAudit = { ...input.bundleAudit, bundleVerdict: "REFUTED" };
    const result = reconcile(input);
    check("refuted-bundle-blocks-all-mutations", result.ok === false && result.mutations.length === 0, JSON.stringify(result));
  }

  // ONE task's verdict is REFUTED among 3 → NO partial mutation for the other 2 (atomic).
  {
    const taskIds = ["T-0", "T-1", "T-2"];
    const input = goodInput(taskIds);
    input.bundleAudit = {
      ...input.bundleAudit,
      shardResults: [
        {
          shardId: "s0",
          shardVerdict: "REFUTED",
          verdicts: [
            { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
            { taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap found" },
            { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
          ],
        },
      ],
      bundleVerdict: "REFUTED",
    };
    const result = reconcile(input);
    check("single-task-refutation-blocks-entire-bundle-atomically", result.ok === false && result.mutations.length === 0, JSON.stringify(result));
  }

  // Missing verdict for one member task → fail closed.
  {
    const taskIds = ["T-0", "T-1"];
    const input = goodInput(taskIds);
    input.bundleAudit = passingBundle(["T-0"]); // T-1 never got a verdict
    const result = reconcile(input);
    check("missing-verdict-for-member-fails-closed", result.ok === false && result.reason === "no-verdict-for-task: T-1", JSON.stringify(result));
  }

  // A failed task-scoped gate blocks the whole bundle (no partial land for the others).
  {
    const taskIds = ["T-0", "T-1"];
    const input = goodInput(taskIds);
    input.taskGates = [
      { taskId: "T-0", gate: "dod-check", ok: true },
      { taskId: "T-1", gate: "dod-check", ok: false, detail: "line budget exceeded" },
    ];
    const result = reconcile(input);
    check("failed-task-gate-blocks-atomically", result.ok === false && result.mutations.length === 0, JSON.stringify(result));
  }

  // Missing milestone-scoped gate entirely fails closed.
  {
    const input = goodInput(["T-0"]);
    input.milestoneGates = [];
    const result = reconcile(input);
    check("missing-milestone-gate-fails-closed", result.ok === false && result.reason === "no-milestone-gates-run", JSON.stringify(result));
  }

  // Failed milestone-scoped gate fails closed.
  {
    const input = goodInput(["T-0", "T-1", "T-2"]);
    input.milestoneGates = [{ gate: "milestone-dod", ok: false, detail: "counter mismatch" }];
    const result = reconcile(input);
    check("failed-milestone-gate-fails-closed", result.ok === false && result.reason?.startsWith("milestone-gate-failed"), JSON.stringify(result));
  }

  // Stale generation identity fails closed.
  {
    const input = goodInput(["T-0"]);
    input.bundleAudit = { ...input.bundleAudit, generationId: "gen-STALE" };
    const result = reconcile(input);
    check("stale-generation-identity-fails-closed", result.ok === false && result.reason?.startsWith("generation-identity-mismatch"), JSON.stringify(result));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-reconcile.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
