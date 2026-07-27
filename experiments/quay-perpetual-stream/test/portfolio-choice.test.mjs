// portfolio-choice.test.mjs — sibling test for portfolio-choice.ts (ADR-001 Decision clause 2:
// load-bearing method-infra, imported by select-preflight.ts, MUST carry a `<name>.test.mjs`
// sibling — loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePortfolio, assertPortfolioDisjoint, selftest } from "../scripts/portfolio-choice.ts";

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
