// composite-audit.ts — M189/DIR-119-B Stage 2.4: read-only audit shards.
//
// A shard audits the FINAL integrated candidate and returns immutable per-task/per-AC verdicts
// plus a bundle verdict. This module enforces the hard architectural boundary the milestone
// requires: "NO auditor ticks boxes, writes absorb dispositions, updates dashboards, or changes
// lifecycle state." `runReadOnlyAuditShard` gives the shard function an ISOLATED, deep-frozen
// snapshot of state — not the real object — so even a shard implementation that tries to mutate
// it (a) throws (ES modules are strict-mode by default; assigning to a frozen property is a
// TypeError) and (b) could not have reached the real state even if it caught that error, because
// the snapshot was structurally cloned before freezing. The negative-control test in this file's
// selftest() exercises exactly that: a hostile shard fn attempts a mutation, and the REAL state
// object passed in is proven byte-identical before/after the call.

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type Verdict = "PASS" | "REFUTED" | "CONCERNS";

export interface TaskAcVerdict {
  taskId: string;
  acIndex: number;
  verdict: Verdict;
  detail: string;
}

export interface AuditShardResult {
  shardId: string;
  verdicts: TaskAcVerdict[];
  shardVerdict: Verdict;
}

export interface BundleAuditResult {
  candidateId: string;
  shardResults: AuditShardResult[];
  bundleVerdict: Verdict;
  generationId?: string;
}

/** The read-only view a shard function is allowed to inspect. Never the real backing store. */
export interface CandidateStateView {
  tasks: Record<string, { status: string; checkboxes: Record<string, boolean> }>;
  absorbDispositions: Record<string, string>;
  dashboardEntries: string[];
  milestoneCounter: number;
}

export type ShardOutcome<T> = { ok: true; result: T } | { ok: false; violation: string };

// ── deepFreeze / deepClone ─────────────────────────────────────────────────────────────────────────

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      const val = (obj as Record<string, unknown>)[name];
      if (val && typeof val === "object") deepFreeze(val);
    }
    Object.freeze(obj);
  }
  return obj;
}

/** Structural clone so a shard function can NEVER reach the caller's real object graph, even via
 *  a reference captured before freezing. `structuredClone` is available globally since Node 17. */
function isolate<T>(value: T): T {
  return structuredClone(value);
}

// ── runReadOnlyAuditShard ──────────────────────────────────────────────────────────────────────────

export function runReadOnlyAuditShard<T>(
  stateView: CandidateStateView,
  shardFn: (frozenView: CandidateStateView) => T,
): ShardOutcome<T> {
  const beforeSnapshot = JSON.stringify(stateView);
  const frozen = deepFreeze(isolate(stateView));
  try {
    const result = shardFn(frozen);
    const afterSnapshot = JSON.stringify(stateView);
    if (beforeSnapshot !== afterSnapshot) {
      // Should be unreachable given isolation above — kept as a belt-and-suspenders hard failure.
      return { ok: false, violation: "read-only-violation: real state object changed despite isolation" };
    }
    return { ok: true, result };
  } catch (err) {
    if (err instanceof TypeError) {
      return { ok: false, violation: `read-only-violation: ${(err as Error).message}` };
    }
    throw err;
  }
}

// ── combineShardVerdicts (Stage 2.4: immutable per-task/per-AC verdicts + one bundle verdict) ───────

export function combineShardVerdicts(shardResults: AuditShardResult[], candidateId: string, generationId?: string): BundleAuditResult {
  const allVerdicts = shardResults.flatMap((s) => s.verdicts);
  const hasRefuted = shardResults.some((s) => s.shardVerdict === "REFUTED") || allVerdicts.some((v) => v.verdict === "REFUTED");
  const hasConcerns = shardResults.some((s) => s.shardVerdict === "CONCERNS") || allVerdicts.some((v) => v.verdict === "CONCERNS");
  const bundleVerdict: Verdict = hasRefuted ? "REFUTED" : hasConcerns ? "CONCERNS" : "PASS";
  return { candidateId, shardResults, bundleVerdict, generationId };
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

  const makeState = (): CandidateStateView => ({
    tasks: { "T-0": { status: "ready", checkboxes: { "ac-0": false } } },
    absorbDispositions: {},
    dashboardEntries: [],
    milestoneCounter: 41,
  });

  // A well-behaved shard reads state and returns verdicts — no violation.
  {
    const state = makeState();
    const outcome = runReadOnlyAuditShard(state, (view) => {
      return view.tasks["T-0"].status === "ready" ? "PASS" : "REFUTED";
    });
    check("well-behaved-shard-succeeds", outcome.ok === true && outcome.result === "PASS", JSON.stringify(outcome));
  }

  // NEGATIVE CONTROL: a hostile shard tries to mutate task status — must throw / be reported as a violation.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view.tasks["T-0"] as { status: string }).status = "done"; // hostile mutation attempt
      return "should-not-reach-here";
    });
    check("hostile-mutation-attempt-reported-as-violation", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-hostile-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical before/after");
  }

  // NEGATIVE CONTROL: a hostile shard tries to write an absorb disposition — blocked.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view.absorbDispositions as Record<string, string>)["T-0"] = "forged-disposition";
      return "unreachable";
    });
    check("hostile-absorb-write-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-absorb-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // NEGATIVE CONTROL: a hostile shard tries to append a dashboard entry (array mutation) — blocked.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      view.dashboardEntries.push("forged entry");
      return "unreachable";
    });
    check("hostile-dashboard-push-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-dashboard-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // NEGATIVE CONTROL: a hostile shard tries to bump the milestone counter — blocked (frozen top-level number field).
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view as { milestoneCounter: number }).milestoneCounter = 999;
      return "unreachable";
    });
    check("hostile-counter-write-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-counter-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // Isolation: mutating the FROZEN VIEW's nested object is what throws; but even a shard function
  // that captures a totally separate closure over `stateView` cannot exist here, because it never
  // receives `stateView` at all — only the frozen clone. Confirm identity difference.
  {
    const state = makeState();
    let capturedView: CandidateStateView | null = null;
    runReadOnlyAuditShard(state, (view) => {
      capturedView = view;
      return null;
    });
    check("shard-receives-isolated-clone-not-real-object", (capturedView as unknown as CandidateStateView) !== state, "must not be reference-equal to the real state");
  }

  // combineShardVerdicts: any REFUTED verdict anywhere makes the bundle REFUTED.
  {
    const shardResults: AuditShardResult[] = [
      { shardId: "s0", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
      { shardId: "s1", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap" }], shardVerdict: "REFUTED" },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-1");
    check("bundle-refuted-if-any-shard-refuted", bundle.bundleVerdict === "REFUTED", bundle.bundleVerdict);
  }

  // combineShardVerdicts: all-PASS shards produce a PASS bundle.
  {
    const shardResults: AuditShardResult[] = [
      { shardId: "s0", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
      { shardId: "s1", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-2");
    check("bundle-pass-if-all-pass", bundle.bundleVerdict === "PASS", bundle.bundleVerdict);
  }

  // One shard covers several homogeneous tasks (Stage 2.4: "one shard may cover several homogeneous tasks").
  {
    const shardResults: AuditShardResult[] = [
      {
        shardId: "s-homogeneous",
        verdicts: [
          { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
        ],
        shardVerdict: "PASS",
      },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-3");
    check("one-shard-covers-multiple-tasks", bundle.shardResults[0].verdicts.length === 3, JSON.stringify(bundle.shardResults[0].verdicts.length));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-audit.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
