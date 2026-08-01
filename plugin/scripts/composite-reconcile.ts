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
import { readFileSync } from "node:fs";

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

// ── attributeGateFailures (DIR-119-D4 / M212) ─────────────────────────────────────────────────────
// Partitions the full TYPED gate vector (task-scoped + milestone-scoped) into the specific failing
// member task(s). Identity is the STRUCTURAL `taskId` field — never the `split-or-commit-${tid}`
// label, never positional order. `_primaryTaskId` gets no special treatment: it is reported only if
// it is itself among `failedTaskIds`. Milestone-scoped failures are reported separately (they are
// bundle-level, not attributable to any single member task).

export interface GateAttributionResult {
  /** Member task ids (in `taskIds` membership order) with at least one failed task-scoped gate. */
  failedTaskIds: string[];
  /** Member task ids (in `taskIds` membership order) with at least one task-scoped gate, all ok. */
  passingTaskIds: string[];
  /** Milestone-scoped gates that failed (never attributable to a single member task). */
  milestoneFailures: MilestoneGateResult[];
}

export function attributeGateFailures(
  gates: (TaskGateResult | MilestoneGateResult)[],
  taskIds: string[],
): GateAttributionResult {
  const membership = new Set(taskIds);
  const failed = new Set<string>();
  const passed = new Set<string>();
  const milestoneFailures: MilestoneGateResult[] = [];
  for (const g of gates) {
    if (g == null) continue;
    if ("taskId" in g && typeof g.taskId === "string") {
      if (!membership.has(g.taskId)) continue; // not a declared member — never reported
      if (g.ok) passed.add(g.taskId);
      else failed.add(g.taskId);
    } else if (typeof g.gate === "string" && !g.ok) {
      milestoneFailures.push({ gate: g.gate, ok: g.ok, detail: g.detail });
    }
  }
  return {
    // Deterministic order: follow `taskIds` membership order, never Set insertion order.
    failedTaskIds: taskIds.filter((t) => failed.has(t)),
    passingTaskIds: taskIds.filter((t) => passed.has(t) && !failed.has(t)),
    milestoneFailures,
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

  // ── attributeGateFailures (DIR-119-D4 / M212): typed Gate-failure attribution ──
  // A NON-primary member's gate fails → THAT member is named, not taskIds[0] by default.
  {
    const gates = [
      { scope: "milestone" as const, gate: "vmeta-lag", ok: true },
      { scope: "task" as const, taskId: "T-0", gate: "split-or-commit", ok: true },
      { scope: "task" as const, taskId: "T-1", gate: "split-or-commit", ok: false, detail: "child left open" },
    ];
    const attr = attributeGateFailures(gates, ["T-0", "T-1"]);
    check("attribution-names-non-primary-failing-member", JSON.stringify(attr.failedTaskIds) === JSON.stringify(["T-1"]), JSON.stringify(attr));
    check("attribution-control-passing-set", JSON.stringify(attr.passingTaskIds) === JSON.stringify(["T-0"]), JSON.stringify(attr));
  }
  // The primary is marked ONLY if itself among failedTaskIds; milestone failures reported separately.
  {
    const gates = [
      { scope: "milestone" as const, gate: "vmeta-lag", ok: false, detail: "alarm" },
      { scope: "task" as const, taskId: "T-0", gate: "split-or-commit", ok: false },
      { scope: "task" as const, taskId: "T-1", gate: "split-or-commit", ok: true },
    ];
    const attr = attributeGateFailures(gates, ["T-0", "T-1"]);
    check("attribution-primary-only-if-self-failed", JSON.stringify(attr.failedTaskIds) === JSON.stringify(["T-0"]), JSON.stringify(attr));
    check("attribution-milestone-failures-separate", attr.milestoneFailures.length === 1 && attr.milestoneFailures[0].gate === "vmeta-lag", JSON.stringify(attr.milestoneFailures));
  }
  // Identity is the structural taskId field, never the split-or-commit-${tid} label.
  {
    const gates = [
      { scope: "task" as const, taskId: "T-0", gate: "split-or-commit-T-0", ok: true },
      { scope: "task" as const, taskId: "T-1", gate: "split-or-commit-T-1", ok: false },
    ];
    const attr = attributeGateFailures(gates, ["T-0", "T-1"]);
    check("attribution-identity-is-taskId-not-label", JSON.stringify(attr.failedTaskIds) === JSON.stringify(["T-1"]), JSON.stringify(attr));
  }
  // Membership order is deterministic and unknown ids are excluded.
  {
    const gates = [
      { scope: "task" as const, taskId: "T-1", gate: "split-or-commit", ok: false },
      { scope: "task" as const, taskId: "T-0", gate: "split-or-commit", ok: true },
      { scope: "task" as const, taskId: "STRANGER", gate: "split-or-commit", ok: true },
    ];
    const attr = attributeGateFailures(gates, ["T-0", "T-1"]);
    check("attribution-membership-order-deterministic", JSON.stringify(attr.failedTaskIds) === JSON.stringify(["T-1"]) && JSON.stringify(attr.passingTaskIds) === JSON.stringify(["T-0"]), JSON.stringify(attr));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

// CLI entry (DIR-119-D4 / M212): `--selftest` PLUS two non-selftest PRODUCTION modes with real
// callsites in execute-milestone.js (both mirrors): `--attribute-gates-json` (typed Gate-failure
// attribution for Gate's failure branch) and `--reconcile-json` (the reconcile() wrap consumed by
// the reconcile-apply agent in the Reconcile phase). Input JSON comes from `--in <file>` (the
// production interface the workflow writes to /tmp) or an inline JSON positional arg. Both print
// the result JSON to stdout; `--reconcile-json` exits nonzero fail-closed on a contract violation
// (ok:false) while still emitting the deterministic recovery record on stdout.
if (process.argv[1] != null && process.argv[1].endsWith("composite-reconcile.ts")) {
  const argv = process.argv;
  const argValue = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const readInput = (flag: string): unknown => {
    const inFile = argValue("--in");
    if (inFile) return JSON.parse(readFileSync(inFile, "utf8"));
    const i = argv.indexOf(flag);
    const inline = i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
    if (inline) return JSON.parse(inline);
    throw new Error(`no input JSON for ${flag} (pass --in <file> or an inline JSON arg)`);
  };
  if (argv.includes("--selftest")) {
    process.exitCode = selftest() ? 0 : 1;
  } else if (argv.includes("--attribute-gates-json")) {
    try {
      const input = readInput("--attribute-gates-json") as (TaskGateResult | MilestoneGateResult)[];
      if (!Array.isArray(input)) throw new Error("input JSON must be a typed gate-record array");
      const taskIdsArg = argValue("--task-ids");
      const taskIds: string[] = taskIdsArg
        ? JSON.parse(taskIdsArg) as string[]
        : [...new Set(input.filter((g): g is TaskGateResult => "taskId" in g && typeof g.taskId === "string").map((g) => g.taskId))];
      console.log(JSON.stringify(attributeGateFailures(input, taskIds)));
      process.exitCode = 0;
    } catch (err) {
      console.error(`--attribute-gates-json failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  } else if (argv.includes("--reconcile-json")) {
    try {
      const input = readInput("--reconcile-json") as ReconcileInput;
      if (input == null || typeof input !== "object") throw new Error("input JSON must be a ReconcileInput object");
      const result = reconcile(input);
      // Result JSON ALWAYS goes to stdout (the reconcile-apply agent needs the deterministic recovery
      // record on failure too); the exit code is the fail-closed signal (0 = pass, nonzero = violation).
      console.log(JSON.stringify(result));
      process.exitCode = result.ok ? 0 : 1;
    } catch (err) {
      console.error(`--reconcile-json failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}
