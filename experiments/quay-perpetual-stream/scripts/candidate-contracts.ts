// candidate-contracts.ts — M188/DIR-119-A Stage 1.2: versioned data contracts for SELECT-integrated
// composite milestone candidates (plan doc `docs/plans/adaptive-composite-milestone-select-and-
// execution.md` §3). Pure types + tiny constructor helpers — NO I/O, NO scoring policy (that lives in
// candidate-synthesis.ts / portfolio-choice.ts). This is the ONE definition of these shapes (ADR-004
// single-source); coupling-graph.ts, candidate-synthesis.ts, portfolio-choice.ts, and
// preparation-feedback.ts all import from here rather than redeclaring the fields.
//
// Compatibility invariant #1 (plan doc §2): a one-task MilestoneCandidate reproduces today's
// single-task path — see makeSingletonCandidate below, the ONLY constructor legacy call sites need.

// ── Versioning ──────────────────────────────────────────────────────────────────────────────────────
// Bump CONTRACT_VERSION (and the `version` literal fields) on any breaking shape change; readers
// should fail closed on an unrecognized version rather than guess.
export const CONTRACT_VERSION = 1 as const;

// ── CouplingKind (plan doc §3.2) ────────────────────────────────────────────────────────────────────
export type CouplingKind =
  | "same-deliverable"
  | "shared-implementation"
  | "shared-semantic-resource"
  | "internal-order"
  | "proof-after-land"
  | "next-generation"
  | "result-dependent"
  | "learning-feedback"
  | "conflicts";

// Edges that PROHIBIT combining two tasks into one same-milestone candidate (plan doc invariant #7).
// Cyclic requirement is handled separately (topology, not a kind) in candidate-synthesis.ts.
export const PROHIBITING_KINDS: ReadonlySet<CouplingKind> = new Set([
  "proof-after-land",
  "next-generation",
  "result-dependent",
  "learning-feedback",
  "conflicts",
]);

// Edges that SUPPORT aggregation — a candidate whose only cross-task edges are these MAY combine.
export const SUPPORTING_KINDS: ReadonlySet<CouplingKind> = new Set([
  "same-deliverable",
  "shared-implementation",
  "shared-semantic-resource",
  "internal-order",
]);

export function isProhibiting(kind: CouplingKind): boolean {
  return PROHIBITING_KINDS.has(kind);
}

export function isSupporting(kind: CouplingKind): boolean {
  return SUPPORTING_KINDS.has(kind);
}

// ── TaskCandidate (plan doc §3.1) ──────────────────────────────────────────────────────────────────
export interface TaskCandidate {
  version: typeof CONTRACT_VERSION;
  id: string;
  status: string;
  labels: string[];
  valueType: string;
  eligible: boolean;
  estimatedValue: number;
  deliverySurface: string[];
  /** Declared or checked `## Touches` globs (repo-relative). */
  touches: string[];
  semanticResources: string[];
  /** Task IDs this task's Plan/body names as a hard dependency (parent, blocking, "after X"). */
  dependsOn: string[];
  verificationBoundary: string;
  acCount: number;
  lineEstimate: number;
  /** Provenance: hash/identity of the source this fact set was derived from. */
  sourceHash: string;
}

export function isEligibleFact(tc: Pick<TaskCandidate, "eligible">): boolean {
  return tc.eligible === true;
}

// ── isExploreTask (M188/DIR-119-A AC5 follow-up: cadence input) ───────────────────────────────────
// Single-source recognizer for "this task counts as an explore slot for cadence purposes" — matches
// explore-exploit-cadence.ts's OWN heuristic (task-id contains "explore", or the mandatory
// architecture-audit-explore pattern) plus an explicit `label:explore`, so candidate-synthesis.ts /
// portfolio-choice.ts and their tests share ONE definition rather than re-deriving the pattern.
export function isExploreTask(tc: Pick<TaskCandidate, "id" | "labels">): boolean {
  const id = tc.id ?? "";
  if (id.toLowerCase().includes("explore")) return true;
  if (/arch.*audit.*explore/i.test(id)) return true;
  return Array.isArray(tc.labels) && tc.labels.some((l) => typeof l === "string" && l.toLowerCase() === "explore");
}

// ── CouplingEdge (plan doc §3.2) ───────────────────────────────────────────────────────────────────
export interface CouplingEdge {
  a: string;
  b: string;
  kind: CouplingKind;
  evidence: string;
  /** Optional internal-order direction; only meaningful for kind:"internal-order". */
  requiresOrder?: "a-before-b" | "b-before-a";
}

export function edgeSupportsAggregation(e: Pick<CouplingEdge, "kind">): boolean {
  return isSupporting(e.kind);
}

export function edgeProhibitsAggregation(e: Pick<CouplingEdge, "kind">): boolean {
  return isProhibiting(e.kind);
}

// ── MilestoneCandidate (plan doc §3.3) ─────────────────────────────────────────────────────────────
export interface MilestoneCandidate {
  version: typeof CONTRACT_VERSION;
  candidateId: string;
  /** Non-empty; length 1 = singleton (compatibility invariant #1). NO maximum enforced anywhere. */
  taskIds: string[];
  deliveryHypothesis: string;
  unionValue: number;
  fixedCostSaving: number;
  criticalPath: number;
  coordinationCost: number;
  resourceUse: number;
  atomicFailureCost: number;
  /** Net score = unionValue + fixedCostSaving − coordinationCost − atomicFailureCost. `criticalPath`
   *  and `resourceUse` are recorded separately as SCHEDULING facts (line/critical-path budgets checked
   *  by portfolio-choice.ts against capacity constraints) rather than subtracted into the value score
   *  directly — they are a different unit (lines/time) from value, and subtracting them would make a
   *  singleton's score depend on its line estimate, breaking compatibility invariant #1 (a singleton's
   *  score must equal its own estimatedValue, unconditionally). Computed by candidate-synthesis.ts /
   *  portfolio-choice.ts, stored on the record for audit. */
  score: number;
  sourceHashes: Record<string, string>;
}

// ── makeSingletonCandidate ─────────────────────────────────────────────────────────────────────────
// The ONLY constructor legacy single-task call sites need — reproduces today's single-task path
// exactly (compatibility invariant #1): taskIds:[taskId], zero coordination/critical-path/fixed-cost
// terms (nothing to save/coordinate/order with only one task), score === unionValue.
export function makeSingletonCandidate(tc: TaskCandidate): MilestoneCandidate {
  return {
    version: CONTRACT_VERSION,
    candidateId: `singleton:${tc.id}`,
    taskIds: [tc.id],
    deliveryHypothesis: `single-task delivery of ${tc.id}`,
    unionValue: tc.estimatedValue,
    fixedCostSaving: 0,
    criticalPath: tc.lineEstimate,
    coordinationCost: 0,
    resourceUse: tc.lineEstimate,
    atomicFailureCost: 0,
    score: tc.estimatedValue,
    sourceHashes: { [tc.id]: tc.sourceHash },
  };
}

// ── normalizeLegacyCall (plan doc §2 invariant #2) ────────────────────────────────────────────────
// Existing `{taskId, charterFile, absorbEntryFile}` workflow calls must keep working, normalized to
// `taskIds:[taskId]`. This is the single normalization point — callers (select-preflight.ts, the
// workflow wrapper) import this instead of hand-rolling `[taskId]` in N places.
export interface LegacyWorkflowArgs {
  taskId: string;
  charterFile?: string;
  absorbEntryFile?: string;
}

export interface NormalizedWorkflowArgs {
  taskIds: string[];
  charterFile?: string;
  absorbEntryFile?: string;
}

export function normalizeLegacyCall(args: LegacyWorkflowArgs): NormalizedWorkflowArgs {
  if (!args || typeof args.taskId !== "string" || args.taskId.length === 0) {
    throw new Error("normalizeLegacyCall: args.taskId must be a non-empty string");
  }
  return {
    taskIds: [args.taskId],
    charterFile: args.charterFile,
    absorbEntryFile: args.absorbEntryFile,
  };
}

// ── RejectedShape + MilestonePortfolio (plan doc §3.4) ────────────────────────────────────────────
export interface RejectedShape {
  taskIds: string[];
  reason: string;
}

export interface MilestonePortfolio {
  version: typeof CONTRACT_VERSION;
  selected: MilestoneCandidate[];
  rejected: RejectedShape[];
  /** ISO timestamp the portfolio decision record was produced (caller-supplied for determinism in tests). */
  generatedAt: string;
  /** Preparation-feedback round this portfolio was produced in (0 = first pass). */
  round: number;
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

  check("prohibiting-kinds-count", PROHIBITING_KINDS.size === 5, `size=${PROHIBITING_KINDS.size}`);
  check("supporting-kinds-count", SUPPORTING_KINDS.size === 4, `size=${SUPPORTING_KINDS.size}`);
  check(
    "kinds-disjoint",
    [...PROHIBITING_KINDS].every((k) => !SUPPORTING_KINDS.has(k)),
    "no kind is both supporting and prohibiting",
  );
  check("isProhibiting-true", isProhibiting("next-generation") === true, "next-generation prohibits");
  check("isSupporting-true", isSupporting("shared-implementation") === true, "shared-implementation supports");
  check("isProhibiting-false-on-supporting", isProhibiting("same-deliverable") === false, "same-deliverable does not prohibit");

  const tc: TaskCandidate = {
    version: CONTRACT_VERSION,
    id: "DIR-TEST",
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 10,
    deliverySurface: ["method-infra"],
    touches: ["packages/quay/src/a.ts"],
    semanticResources: [],
    dependsOn: [],
    verificationBoundary: "scripts/test.sh",
    acCount: 3,
    lineEstimate: 100,
    sourceHash: "abc123",
  };
  const singleton = makeSingletonCandidate(tc);
  check("singleton-taskIds", singleton.taskIds.length === 1 && singleton.taskIds[0] === "DIR-TEST", JSON.stringify(singleton.taskIds));
  check("singleton-score-equals-value", singleton.score === tc.estimatedValue, `score=${singleton.score}`);
  check("singleton-no-coordination-cost", singleton.coordinationCost === 0, `coordinationCost=${singleton.coordinationCost}`);

  const normalized = normalizeLegacyCall({ taskId: "DIR-042", charterFile: "c.md", absorbEntryFile: "a.md" });
  check(
    "normalize-legacy-call",
    normalized.taskIds.length === 1 && normalized.taskIds[0] === "DIR-042" && normalized.charterFile === "c.md",
    JSON.stringify(normalized),
  );
  let threw = false;
  try {
    normalizeLegacyCall({ taskId: "" });
  } catch {
    threw = true;
  }
  check("normalize-legacy-call-empty-taskid-throws", threw, "empty taskId must throw, never silently produce []");

  check("isExploreTask-matches-explore-in-id", isExploreTask({ id: "exp5-M-EXPLORE-FOO", labels: [] }), "id contains 'explore'");
  check("isExploreTask-matches-arch-audit-explore-id", isExploreTask({ id: "exp5-M-ARCH-AUDIT-M133-EXPLORE", labels: [] }), "arch-audit-explore id pattern");
  check("isExploreTask-matches-explore-label", isExploreTask({ id: "DIR-999", labels: ["explore"] }), "label:explore");
  check("isExploreTask-false-on-ordinary-task", isExploreTask({ id: "DIR-119-A", labels: ["milestone-candidate"] }) === false, "ordinary task is not an explore task");

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

function isDirectEntryFallback(): boolean {
  try {
    // Avoid importing gate-script-base.ts here to keep this module dependency-free (pure contracts).
    return process.argv[1] != null && process.argv[1].endsWith("candidate-contracts.ts");
  } catch {
    return false;
  }
}

if (isDirectEntryFallback() && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
