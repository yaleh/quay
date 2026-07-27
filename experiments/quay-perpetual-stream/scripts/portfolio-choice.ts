// portfolio-choice.ts — M188/DIR-119-A Stage 1.4: choose a non-overlapping MilestonePortfolio from
// the candidate shapes candidate-synthesis.ts produced. Deterministic weighted set-packing (greedy by
// score, per the plan doc's "initial implementation may use deterministic weighted set-
// packing/beam search" allowance) — NOT an attempt at an optimal packing, but reproducible and it
// emits a durable decision record (selected AND rejected shapes, each with a reason — plan doc
// Stage 1.4 / Done-when #2).
//
// Invariant enforced here (plan doc §2 invariant #4): each task appears in AT MOST ONE selected
// candidate. candidate-synthesis.ts may (and does, by design — Stage 1.1 fixture b) hand this module
// several OVERLAPPING alternative shapes for the same tasks; disjointness among the SELECTED set is
// this module's job, not synthesis's.

import type { MilestoneCandidate, RejectedShape, MilestonePortfolio } from "./candidate-contracts.ts";
import { CONTRACT_VERSION } from "./candidate-contracts.ts";

export interface PortfolioConstraints {
  /** Maximum number of candidates the portfolio may select in one pass — this is the ONLY place
   * `.quay/loop.yml` concurrency is meant to enter the pipeline (as a portfolio-size BUDGET, never a
   * synthesis-time shape-size cap — candidate_horizon in candidate-synthesis.ts is independent of it). */
  maxSelected?: number;
  /** Optional global resourceUse (line-estimate) budget across the WHOLE selected portfolio. */
  maxTotalResourceUse?: number;
}

function overlaps(a: MilestoneCandidate, taken: Set<string>): boolean {
  return a.taskIds.some((id) => taken.has(id));
}

// ── choosePortfolio ───────────────────────────────────────────────────────────────────────────────
// Greedy weighted set-packing: sort candidates by score descending (ties broken by fewer tasks first,
// then candidateId for full determinism), then walk the list once, taking a candidate iff it is
// task-disjoint from everything already selected, under budget, and the selected count is still under
// `maxSelected`. Every candidate NOT selected is recorded with a concrete reason — never silently
// dropped.
export function choosePortfolio(
  candidates: MilestoneCandidate[],
  constraints: PortfolioConstraints = {},
  opts: { generatedAt?: string; round?: number } = {},
): MilestonePortfolio {
  const maxSelected = constraints.maxSelected ?? Infinity;
  const maxTotalResourceUse = constraints.maxTotalResourceUse ?? Infinity;

  const sorted = [...candidates].sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.taskIds.length !== y.taskIds.length) return x.taskIds.length - y.taskIds.length;
    return x.candidateId.localeCompare(y.candidateId);
  });

  const selected: MilestoneCandidate[] = [];
  const rejected: RejectedShape[] = [];
  const taken = new Set<string>();
  let totalResourceUse = 0;

  for (const c of sorted) {
    if (selected.length >= maxSelected) {
      rejected.push({ taskIds: c.taskIds, reason: `portfolio budget exhausted: maxSelected=${maxSelected} already reached` });
      continue;
    }
    if (overlaps(c, taken)) {
      const conflicting = selected.filter((s) => s.taskIds.some((id) => c.taskIds.includes(id)));
      rejected.push({
        taskIds: c.taskIds,
        reason: `overlaps already-selected candidate(s): ${conflicting.map((s) => s.candidateId).join(", ")}`,
      });
      continue;
    }
    if (totalResourceUse + c.resourceUse > maxTotalResourceUse) {
      rejected.push({
        taskIds: c.taskIds,
        reason: `exceeds global resourceUse budget: ${totalResourceUse} + ${c.resourceUse} > ${maxTotalResourceUse}`,
      });
      continue;
    }
    selected.push(c);
    for (const id of c.taskIds) taken.add(id);
    totalResourceUse += c.resourceUse;
  }

  return {
    version: CONTRACT_VERSION,
    selected,
    rejected,
    generatedAt: opts.generatedAt ?? new Date(0).toISOString(),
    round: opts.round ?? 0,
  };
}

// ── assertPortfolioDisjoint ───────────────────────────────────────────────────────────────────────
// Mechanical proof helper (not just "claimed absent") — walks the selected set and throws with the
// concrete duplicate task ID + candidate pair if invariant #4 is ever violated. Callers/tests import
// this rather than hand-rolling a Set-based check that could silently pass on an off-by-one bug.
export function assertPortfolioDisjoint(portfolio: MilestonePortfolio): void {
  const seenBy = new Map<string, string>();
  for (const c of portfolio.selected) {
    for (const id of c.taskIds) {
      const prior = seenBy.get(id);
      if (prior) {
        throw new Error(`portfolio invariant violated: task ${id} appears in both ${prior} and ${c.candidateId}`);
      }
      seenBy.set(id, c.candidateId);
    }
  }
}

// ── selftest ──────────────────────────────────────────────────────────────────────────────────────
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

  const mkC = (id: string, taskIds: string[], score: number, resourceUse = 10): MilestoneCandidate => ({
    version: 1,
    candidateId: id,
    taskIds,
    deliveryHypothesis: id,
    unionValue: score,
    fixedCostSaving: 0,
    criticalPath: 0,
    coordinationCost: 0,
    resourceUse,
    atomicFailureCost: 0,
    score,
    sourceHashes: {},
  });

  // Two disjoint candidates both selected.
  const c1 = mkC("c1", ["A"], 10);
  const c2 = mkC("c2", ["B"], 8);
  const p1 = choosePortfolio([c1, c2]);
  check("disjoint-candidates-both-selected", p1.selected.length === 2, JSON.stringify(p1.selected.map((c) => c.candidateId)));
  check("rejected-empty-when-all-fit", p1.rejected.length === 0, JSON.stringify(p1.rejected));

  // Overlapping candidates: higher score wins, loser rejected with a concrete overlap reason.
  const c3 = mkC("high", ["X", "Y"], 20);
  const c4 = mkC("low", ["Y"], 5);
  const p2 = choosePortfolio([c4, c3]); // input order shouldn't matter — sorted by score internally
  check("higher-score-wins-on-overlap", p2.selected.length === 1 && p2.selected[0].candidateId === "high", JSON.stringify(p2.selected));
  check(
    "loser-rejected-with-overlap-reason",
    p2.rejected.length === 1 && p2.rejected[0].taskIds[0] === "Y" && /overlaps/.test(p2.rejected[0].reason),
    JSON.stringify(p2.rejected),
  );

  // No task appears in two selected candidates — assertPortfolioDisjoint passes silently.
  let threwOnGood = false;
  try {
    assertPortfolioDisjoint(p2);
  } catch {
    threwOnGood = true;
  }
  check("assertPortfolioDisjoint-passes-on-valid-portfolio", threwOnGood === false, "no throw expected");

  // A deliberately-broken portfolio (simulating a hypothetical future bug) IS caught.
  const brokenPortfolio: MilestonePortfolio = {
    version: 1,
    selected: [mkC("dup1", ["Z"], 10), mkC("dup2", ["Z"], 9)],
    rejected: [],
    generatedAt: "x",
    round: 0,
  };
  let threwOnBroken = false;
  try {
    assertPortfolioDisjoint(brokenPortfolio);
  } catch {
    threwOnBroken = true;
  }
  check("assertPortfolioDisjoint-catches-real-duplicate", threwOnBroken === true, "must throw on duplicate task membership");

  // maxSelected budget: only the top-N candidates (by score) are selected; the rest rejected with a
  // budget reason, even though they're mutually disjoint and would otherwise all fit.
  const c5 = mkC("s1", ["P1"], 30);
  const c6 = mkC("s2", ["P2"], 20);
  const c7 = mkC("s3", ["P3"], 10);
  const p3 = choosePortfolio([c5, c6, c7], { maxSelected: 2 });
  check("maxSelected-budget-enforced", p3.selected.length === 2, JSON.stringify(p3.selected.map((c) => c.candidateId)));
  check(
    "maxSelected-rejection-reason-explicit",
    p3.rejected.length === 1 && /budget exhausted/.test(p3.rejected[0].reason),
    JSON.stringify(p3.rejected),
  );

  // resourceUse budget.
  const c8 = mkC("r1", ["Q1"], 10, 60);
  const c9 = mkC("r2", ["Q2"], 9, 60);
  const p4 = choosePortfolio([c8, c9], { maxTotalResourceUse: 100 });
  check("resourceUse-budget-enforced", p4.selected.length === 1 && p4.selected[0].candidateId === "r1", JSON.stringify(p4.selected));

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("portfolio-choice.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
