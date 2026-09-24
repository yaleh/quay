// @test-group engine
// portfolio-choice.test.mjs — sibling test for portfolio-choice.ts (ADR-001 Decision clause 2:
// load-bearing method-infra, imported by select-preflight.ts, MUST carry a `<name>.test.mjs`
// sibling — loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { choosePortfolio, assertPortfolioDisjoint, findUnmetDependency, selftest } = await import("../scripts/portfolio-choice.ts");

function mkC(id, taskIds, score, resourceUse = 10) {
  return {
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
  };
}

test("portfolio-choice.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("choosePortfolio selects all disjoint candidates and rejects nothing", () => {
  const p = choosePortfolio([mkC("a", ["1"], 10), mkC("b", ["2"], 5)]);
  assert.equal(p.selected.length, 2);
  assert.equal(p.rejected.length, 0);
});

test("choosePortfolio: overlapping candidates — higher score wins, loser rejected with an explicit overlap reason", () => {
  const p = choosePortfolio([mkC("low", ["X"], 1), mkC("high", ["X", "Y"], 10)]);
  assert.equal(p.selected.length, 1);
  assert.equal(p.selected[0].candidateId, "high");
  assert.equal(p.rejected.length, 1);
  assert.match(p.rejected[0].reason, /overlaps/);
});

test("choosePortfolio: maxSelected budget stops selection and records an explicit budget-exhausted reason", () => {
  const p = choosePortfolio([mkC("a", ["1"], 3), mkC("b", ["2"], 2), mkC("c", ["3"], 1)], { maxSelected: 2 });
  assert.equal(p.selected.length, 2);
  assert.equal(p.rejected.length, 1);
  assert.match(p.rejected[0].reason, /budget exhausted/);
});

test("choosePortfolio: maxTotalResourceUse budget rejects a candidate that would exceed it", () => {
  const p = choosePortfolio([mkC("a", ["1"], 10, 60), mkC("b", ["2"], 9, 60)], { maxTotalResourceUse: 100 });
  assert.equal(p.selected.length, 1);
  assert.equal(p.selected[0].candidateId, "a");
});

test("assertPortfolioDisjoint: passes silently on a valid portfolio, throws with the concrete task+candidates on a broken one", () => {
  const good = choosePortfolio([mkC("a", ["1"], 5), mkC("b", ["2"], 5)]);
  assert.doesNotThrow(() => assertPortfolioDisjoint(good));

  const broken = { version: 1, selected: [mkC("dup1", ["Z"], 10), mkC("dup2", ["Z"], 9)], rejected: [], generatedAt: "x", round: 0 };
  assert.throws(() => assertPortfolioDisjoint(broken), /Z.*dup1.*dup2|dup1.*dup2.*Z/s);
});

test("choosePortfolio: sort order is deterministic (score desc, then fewer tasks, then candidateId)", () => {
  const p1 = choosePortfolio([mkC("z", ["A"], 5), mkC("a", ["B"], 5)]);
  const p2 = choosePortfolio([mkC("a", ["B"], 5), mkC("z", ["A"], 5)]);
  assert.deepEqual(
    p1.selected.map((c) => c.candidateId),
    p2.selected.map((c) => c.candidateId),
  );
});

// ── cadence constraint (M188/DIR-119-A AC5 follow-up) ──────────────────────────────────────────────
test("choosePortfolio: cadence EXPLORE-DUE force-selects a low-scoring explore candidate ahead of a higher-scoring unrelated one", () => {
  const p = choosePortfolio([mkC("explore-low", ["EXP"], 1), mkC("other-high", ["OTHER"], 100)], {
    cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP"] },
  });
  assert.equal(p.selected.length, 2);
  assert.ok(p.selected.some((c) => c.candidateId === "explore-low"));
});

test("choosePortfolio: cadence verdict OK never forces anything (pure score-order packing)", () => {
  const p = choosePortfolio([mkC("explore-low", ["EXP"], 1), mkC("other-high", ["OTHER"], 100)], {
    cadence: { verdict: "OK", exploreTaskIds: ["EXP"] },
  });
  assert.deepEqual(p.selected.map((c) => c.candidateId), ["other-high", "explore-low"]);
});

test("choosePortfolio: cadence EXPLORE-DUE with no candidate carrying the explore slot is a no-op", () => {
  const p = choosePortfolio([mkC("a", ["A"], 5), mkC("b", ["B"], 3)], {
    cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["NOT-PRESENT"] },
  });
  assert.equal(p.selected.length, 2);
});

test("choosePortfolio: cadence forced pick genuinely takes priority over a higher score under a tight maxSelected budget", () => {
  const p = choosePortfolio([mkC("explore-low", ["EXP"], 1), mkC("other-high", ["OTHER"], 100)], {
    maxSelected: 1,
    cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP"] },
  });
  assert.equal(p.selected.length, 1);
  assert.equal(p.selected[0].candidateId, "explore-low");
  assert.match(p.rejected[0].reason, /budget exhausted/);
});

test("choosePortfolio: cadence falls back to a smaller explore-carrying shape when the bigger one exceeds budget", () => {
  const p = choosePortfolio([mkC("explore-big", ["EXP2"], 50, 200), mkC("explore-small", ["EXP2-solo"], 5, 10)], {
    maxTotalResourceUse: 50,
    cadence: { verdict: "EXPLORE-DUE", exploreTaskIds: ["EXP2", "EXP2-solo"] },
  });
  assert.ok(p.selected.some((c) => c.candidateId === "explore-small"));
});

// ── dependency constraint (M188/DIR-119-A AC5 / plan doc §3.4 "inter-candidate dependency order") ──
test("findUnmetDependency: reports a concrete reason for an open, not-selected external dependency", () => {
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "todo"]]) };
  const reason = findUnmetDependency(candidate, new Set(["DEP-B"]), dep);
  assert.match(reason, /unresolved dependency.*DEP-B.*DEP-A/);
});

test("findUnmetDependency: null (satisfied) when the dependency target is already selected this round", () => {
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "todo"]]) };
  assert.equal(findUnmetDependency(candidate, new Set(["DEP-B", "DEP-A"]), dep), null);
});

test("findUnmetDependency: null (satisfied) when the dependency target is already done", () => {
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "done"]]) };
  assert.equal(findUnmetDependency(candidate, new Set(["DEP-B"]), dep), null);
});

// ── RETIRED (superseded) dependency — 硬规则 5b 姊妹实例 (gap-superseded-dependency-blocks-──────
// dispatch-forever AC6). `superseded` is TERMINAL: the prerequisite was retired by a human ruling and
// its successor carries the real dependency, so no future event can make it `done`. Pre-fix this
// function only recognized `done`, so a candidate whose external prerequisite had been retired was
// rejected FOREVER with `unresolved dependency: …` — a reason that reads exactly like "the
// prerequisite hasn't happened yet" (same shape as driver-filters' pre-fix allDepsDone). ⛔ The fix
// must not widen the other way either: todo / ready / needs-human / unreadable stay BLOCKING.

test("findUnmetDependency: null (satisfied) when the dependency target was RETIRED (superseded)", () => {
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "superseded"]]) };
  assert.equal(findUnmetDependency(candidate, new Set(["DEP-B"]), dep), null,
    "a retired prerequisite is not an open dependency — blocking here is a permanent rejection");
});

test("findUnmetDependency: negative control — ready/todo/needs-human/unreadable deps still report unresolved", () => {
  for (const status of ["ready", "todo", "needs-human", ""]) {
    const candidate = mkC("dependent", ["DEP-B"], 50);
    const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", status]]) };
    assert.match(findUnmetDependency(candidate, new Set(["DEP-B"]), dep), /unresolved dependency.*DEP-B.*DEP-A/,
      `status ${JSON.stringify(status)} must still block (semantics not widened)`);
  }
  // An EMPTY status map entry is impossible to distinguish from "unknown word" through the Map, so
  // the unreadable arm is pinned by an id present in dependsOnById but carrying no usable status.
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", null]]) };
  assert.match(findUnmetDependency(candidate, new Set(["DEP-B"]), dep), /unresolved dependency/,
    "an unreadable status must still block (fail-closed)");
});

test("choosePortfolio: a candidate whose only external dep was retired IS selected (not rejected forever)", () => {
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "superseded"]]) };
  const p = choosePortfolio([mkC("dependent", ["DEP-B"], 50)], { dependency: dep });
  assert.equal(p.selected.length, 1, "retired prerequisite ⇒ selectable");
  assert.equal(p.selected[0].candidateId, "dependent");
});

test("findUnmetDependency: fails open (null) on a dependency target unknown to this fact set", () => {
  const candidate = mkC("dependent", ["DEP-B"], 50);
  const dep = { dependsOnById: new Map([["DEP-B", ["OUTSIDE-EVERYTHING"]]]), statusById: new Map() };
  assert.equal(findUnmetDependency(candidate, new Set(["DEP-B"]), dep), null);
});

test("choosePortfolio: dependency constraint demotes a candidate with an unresolved external dependency to rejected", () => {
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "todo"]]) };
  const p = choosePortfolio([mkC("dependent", ["DEP-B"], 50)], { dependency: dep });
  assert.equal(p.selected.length, 0);
  assert.equal(p.rejected.length, 1);
  assert.match(p.rejected[0].reason, /unresolved dependency/);
});

test("choosePortfolio: dependency constraint accepts the candidate when its dependency is selected in the same portfolio round", () => {
  const dep = { dependsOnById: new Map([["DEP-B", ["DEP-A"]]]), statusById: new Map([["DEP-A", "todo"]]) };
  const p = choosePortfolio([mkC("dependent", ["DEP-B"], 50), mkC("provider", ["DEP-A"], 10)], { dependency: dep });
  assert.equal(p.selected.length, 2);
});

test("choosePortfolio: omitting the dependency constraint entirely selects normally (backward compatible)", () => {
  const p = choosePortfolio([mkC("dependent", ["DEP-B"], 50)]);
  assert.equal(p.selected.length, 1);
});

