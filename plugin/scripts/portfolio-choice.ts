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
import { createSelftest } from "./gate-script-base.ts";
// 依赖边判定（done / superseded / blocking 的三值判定）单一真相源在 driver-filters.ts —— 本模块
// 只消费它，⛔ 不再自己写一份 `=== "done"` 的状态比较（gap-superseded-dependency-blocks-dispatch-
// forever 的 5b 姊妹实例：同一条原则的两处实现曾经分叉，一处修了另一处没修）。
import { judgeDepStatus } from "./driver-filters.ts";

// ── CadenceConstraint (M188/DIR-119-A AC5 follow-up) ─────────────────────────────────────────────────
// Wires explore-exploit-cadence.ts's verdict into portfolio choice: when an EXPLORE milestone is DUE,
// bundling logic must never be allowed to silently starve the mandatory explore slot by scoring a
// non-explore composite higher. `verdict`/`exploreTaskIds` are computed by the CALLER (select-
// preflight.ts, from the live CadenceResult + candidate-contracts.ts's isExploreTask) — this module
// only consumes the decision, it does not re-derive cadence logic (single source, ADR-004).
export interface CadenceConstraint {
  verdict: "EXPLORE-DUE" | "OK";
  /** Task IDs recognized as the explore slot for this decision. May be empty (nothing eligible to
   * force this round) — the forced pass is then a no-op and choosePortfolio behaves as if no
   * cadence constraint were given at all. */
  exploreTaskIds: string[];
}

// ── DependencyConstraint (M188/DIR-119-A AC5 follow-up / plan doc §3.4 "inter-candidate dependency
// order") ─────────────────────────────────────────────────────────────────────────────────────────
// A task's hard dependency (TaskCandidate.dependsOn) that points OUTSIDE its own candidate (internal
// dependencies are already closed by candidate-synthesis.ts's required-closure) must be resolved by
// EITHER already being done, OR being selected in some OTHER candidate of the SAME portfolio round —
// otherwise this candidate cannot be selected on its own (its prerequisite would not actually land).
// A dependency target absent from BOTH maps is outside this SELECT cycle's known fact set entirely
// (matches coupling-graph.ts's own "outside fact set" tolerance) and is treated as already resolved —
// this module never fabricates a block on data it cannot see.
export interface DependencyConstraint {
  dependsOnById: Map<string, string[]>;
  statusById: Map<string, string>;
}

export interface PortfolioConstraints {
  /** Maximum number of candidates the portfolio may select in one pass — this is the ONLY place
   * `.quay/loop.yml` concurrency is meant to enter the pipeline (as a portfolio-size BUDGET, never a
   * synthesis-time shape-size cap — candidate_horizon in candidate-synthesis.ts is independent of it). */
  maxSelected?: number;
  /** Optional global resourceUse (line-estimate) budget across the WHOLE selected portfolio. */
  maxTotalResourceUse?: number;
  /** See CadenceConstraint. Optional; omitted = no cadence pressure applied (today's pure
   * disjoint/budget packing, unchanged). */
  cadence?: CadenceConstraint;
  /** See DependencyConstraint. Optional; omitted = no cross-candidate dependency validation. */
  dependency?: DependencyConstraint;
}

function overlaps(a: MilestoneCandidate, taken: Set<string>): boolean {
  return a.taskIds.some((id) => taken.has(id));
}

// ── findUnmetDependency ───────────────────────────────────────────────────────────────────────────
// Returns a concrete reason string if `candidate` has an external (cross-candidate) dependency that
// is neither SETTLED (done / retired-superseded) nor covered by `allSelectedTaskIds`; null if every
// dependency is resolved.
export function findUnmetDependency(
  candidate: MilestoneCandidate,
  allSelectedTaskIds: ReadonlySet<string>,
  dep: DependencyConstraint,
): string | null {
  for (const taskId of candidate.taskIds) {
    const deps = dep.dependsOnById.get(taskId) || [];
    for (const target of deps) {
      if (candidate.taskIds.includes(target)) continue; // internal — already closed by synthesis
      const known = dep.dependsOnById.has(target) || dep.statusById.has(target);
      if (!known) continue; // outside this SELECT cycle's fact set — fail-open, never fabricate a block
      // SETTLED-DEPENDENCY JUDGMENT (gap-superseded-dependency-blocks-dispatch-forever, 硬规则 5b 姊妹实例):
      // `done`（已落地）与 `superseded`（**被人裁定退役** —— 前提被删除，其继任者承载真依赖）都是
      // 【等待已结束】。⛔ 修前这一行只认 `done`，于是一条【永远不会有未来事件把它翻成 done】的
      // 退役依赖会落到下一行，被判成「open but not selected」——候选被**永久**拒绝，而理由读起来
      // 与「前置还没做」**同形**（与 driver-filters' allDepsDone 修前完全同形）。
      // 判定本身单一真相源在 driver-filters.ts 的 judgeDepStatus（⛔ 不在此处再拼一遍
      // `=== "done" || === "superseded"`）。
      // ⛔ todo / ready / needs-human / 读不出（statusById 无此键 ⇒ undefined）仍走 blocking ⇒
      // fail-closed（落到下面那行报 unresolved）。
      if (judgeDepStatus(dep.statusById.get(target)) !== "blocking") continue; // done or retired
      if (allSelectedTaskIds.has(target)) continue; // will land in the same portfolio round
      return `unresolved dependency: ${taskId} depends on ${target}, which is open but not selected in this portfolio round`;
    }
  }
  return null;
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
  const cadence = constraints.cadence;

  const sorted = [...candidates].sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.taskIds.length !== y.taskIds.length) return x.taskIds.length - y.taskIds.length;
    return x.candidateId.localeCompare(y.candidateId);
  });

  const selected: MilestoneCandidate[] = [];
  const rejected: RejectedShape[] = [];
  const taken = new Set<string>();
  const forcedIds = new Set<string>();
  let totalResourceUse = 0;

  // Cadence forced pass (M188/DIR-119-A AC5 follow-up): when an explore milestone is DUE, bundling's
  // greedy-by-score walk below must not be allowed to silently starve the mandatory explore slot just
  // because some other, unrelated composite scores higher. Try the explore-containing shapes in score
  // order (best first) and force-select the FIRST one that actually fits the budget — smaller shapes
  // (e.g. the explore task's own singleton) are tried if a bigger one doesn't fit, rather than giving
  // up on cadence entirely. A no-op when verdict is "OK", or when nothing eligible carries the explore
  // slot this round (nothing to force).
  if (cadence?.verdict === "EXPLORE-DUE" && cadence.exploreTaskIds.length > 0) {
    const exploreCandidates = sorted.filter((c) => c.taskIds.some((id) => cadence.exploreTaskIds.includes(id)));
    for (const c of exploreCandidates) {
      if (selected.length >= maxSelected) break;
      if (overlaps(c, taken)) continue;
      if (totalResourceUse + c.resourceUse > maxTotalResourceUse) continue;
      selected.push(c);
      forcedIds.add(c.candidateId);
      for (const id of c.taskIds) taken.add(id);
      totalResourceUse += c.resourceUse;
      break; // one qualifying shape satisfies the cadence requirement for this round
    }
  }

  for (const c of sorted) {
    if (forcedIds.has(c.candidateId)) continue; // already accepted by the cadence forced pass above
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

  // Dependency validation pass (M188/DIR-119-A AC5 follow-up / plan doc §3.4 "inter-candidate
  // dependency order"): a selected candidate whose external dependency is neither done nor covered by
  // another selected candidate this round cannot actually proceed on its own — demote it to rejected
  // with a concrete reason and re-check the (now smaller) selected set to a fixed point, since
  // removing one candidate can never satisfy another's dependency (removal only shrinks
  // `allSelectedTaskIds`), so a single linear sweep per removal is sufficient — bounded by
  // `selected.length` removals, never unbounded.
  if (constraints.dependency) {
    let changed = true;
    while (changed) {
      changed = false;
      const allSelectedTaskIds = new Set(selected.flatMap((c) => c.taskIds));
      for (let i = 0; i < selected.length; i++) {
        const reason = findUnmetDependency(selected[i], allSelectedTaskIds, constraints.dependency);
        if (reason) {
          const [demoted] = selected.splice(i, 1);
          rejected.push({ taskIds: demoted.taskIds, reason });
          changed = true;
          break;
        }
      }
    }
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
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

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

  // ── cadence constraint (M188/DIR-119-A AC5) ────────────────────────────────────────────────────
  // A low-scoring explore-flagged candidate is force-selected ahead of a higher-scoring, unrelated
  // one when the cadence verdict is EXPLORE-DUE.
  const cLowExplore = mkC("explore-low", ["EXP"], 1);
  const cHighOther = mkC("other-high", ["OTHER"], 100);
  const p5 = choosePortfolio([cLowExplore, cHighOther], { cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP"] } });
  check(
    "cadence-forces-low-scoring-explore-candidate-in",
    p5.selected.some((c) => c.candidateId === "explore-low") && p5.selected.some((c) => c.candidateId === "other-high"),
    JSON.stringify(p5.selected.map((c) => c.candidateId)),
  );

  // Cadence verdict OK is a no-op: pure score-order packing, unaffected — the higher-scoring
  // candidate is processed (and thus selected) FIRST, exactly as with no cadence constraint at all.
  const p6 = choosePortfolio([cLowExplore, cHighOther], { cadence: { verdict: "OK", exploreTaskIds: ["EXP"] } });
  check(
    "cadence-ok-verdict-is-a-no-op",
    JSON.stringify(p6.selected.map((c) => c.candidateId)) === JSON.stringify(["other-high", "explore-low"]),
    JSON.stringify(p6.selected.map((c) => c.candidateId)),
  );

  // No candidate carries the explore slot this round: cadence is a no-op (nothing to force).
  const p7 = choosePortfolio([cLowExplore, cHighOther], { cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["NOT-PRESENT"] } });
  check(
    "cadence-no-op-when-nothing-carries-explore-slot",
    p7.selected.length === 2,
    JSON.stringify(p7.selected.map((c) => c.candidateId)),
  );

  // maxSelected=1 forces cadence to consume the ONLY slot, rejecting the higher-scoring non-explore
  // candidate instead — proves the forced pick genuinely takes priority, not just "also gets in".
  const p8 = choosePortfolio([cLowExplore, cHighOther], { maxSelected: 1, cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP"] } });
  check(
    "cadence-forced-pick-takes-the-only-budget-slot",
    p8.selected.length === 1 && p8.selected[0].candidateId === "explore-low",
    JSON.stringify(p8.selected.map((c) => c.candidateId)),
  );
  check(
    "cadence-forced-pick-rejects-the-higher-score-candidate-with-a-budget-reason",
    p8.rejected.length === 1 && p8.rejected[0].taskIds[0] === "OTHER" && /budget exhausted/.test(p8.rejected[0].reason),
    JSON.stringify(p8.rejected),
  );

  // Budget too small for the top-scoring explore shape: cadence tries the NEXT explore-carrying shape
  // (score order) that actually fits, rather than giving up on cadence entirely.
  const cExploreBig = mkC("explore-big", ["EXP2"], 50, 200);
  const cExploreSmall = mkC("explore-small", ["EXP2-solo"], 5, 10);
  const p9 = choosePortfolio([cExploreBig, cExploreSmall], {
    maxTotalResourceUse: 50,
    cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP2", "EXP2-solo"] },
  });
  check(
    "cadence-falls-back-to-smaller-explore-shape-when-bigger-one-exceeds-budget",
    p9.selected.some((c) => c.candidateId === "explore-small"),
    JSON.stringify(p9.selected.map((c) => c.candidateId)),
  );

  // ── dependency constraint (M188/DIR-119-A AC5 / plan doc §3.4) ─────────────────────────────────
  // A candidate depending on a still-open, not-selected task is demoted to rejected even though it
  // would otherwise fit cleanly (disjoint, under budget).
  const cDependent = mkC("dependent", ["DEP-B"], 50);
  const dependencyCtx = {
    dependsOnById: new Map([["DEP-B", ["DEP-A"]]]),
    statusById: new Map([["DEP-A", "todo"]]), // DEP-A is open but NOT part of any candidate here
  };
  const p10 = choosePortfolio([cDependent], {}, {});
  const p10dep = choosePortfolio([cDependent], { dependency: dependencyCtx });
  check("dependency-omitted-selects-normally", p10.selected.length === 1, JSON.stringify(p10.selected));
  check(
    "dependency-constraint-demotes-candidate-with-unresolved-external-dependency",
    p10dep.selected.length === 0 && p10dep.rejected.length === 1 && /unresolved dependency/.test(p10dep.rejected[0].reason),
    JSON.stringify(p10dep),
  );

  // The SAME dependency is satisfied when DEP-A is selected in another candidate this round.
  const cDependencyProvider = mkC("provider", ["DEP-A"], 10);
  const p11 = choosePortfolio([cDependent, cDependencyProvider], { dependency: dependencyCtx });
  check(
    "dependency-satisfied-by-another-selected-candidate-same-round",
    p11.selected.some((c) => c.candidateId === "dependent") && p11.selected.some((c) => c.candidateId === "provider"),
    JSON.stringify(p11.selected.map((c) => c.candidateId)),
  );

  // The SAME dependency is satisfied when DEP-A is already done (not part of this round at all).
  const dependencyCtxDone = {
    dependsOnById: new Map([["DEP-B", ["DEP-A"]]]),
    statusById: new Map([["DEP-A", "done"]]),
  };
  const p12 = choosePortfolio([cDependent], { dependency: dependencyCtxDone });
  check("dependency-satisfied-when-target-already-done", p12.selected.length === 1, JSON.stringify(p12.selected));

  // A dependency target totally unknown to this fact set (not in either map) fails OPEN — never
  // fabricates a block on data this module cannot see.
  const dependencyCtxUnknown = {
    dependsOnById: new Map([["DEP-B", ["OUTSIDE-EVERYTHING"]]]),
    statusById: new Map<string, string>(),
  };
  const p13 = choosePortfolio([cDependent], { dependency: dependencyCtxUnknown });
  check("dependency-fails-open-on-unknown-target", p13.selected.length === 1, JSON.stringify(p13.selected));
  return st.report();
}

if (process.argv[1] != null && process.argv[1].endsWith("portfolio-choice.ts") && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
