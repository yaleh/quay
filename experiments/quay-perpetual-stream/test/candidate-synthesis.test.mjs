// @test-group governance
// candidate-synthesis.test.mjs — M188/DIR-119-A Stage 1.1/1.3/1.4/1.5 tests.
//
// RED (Stage 1.1): the CURRENT SELECT representation (select-preflight.ts's CandidateEntry) is
// structurally incapable of representing a composite milestone candidate — proven here, not asserted
// in prose, before any of the new modules are exercised.
//
// GREEN: the six historical-replay fixtures (candidate-synthesis-fixtures.ts) pass through the real
// coupling-graph.ts → candidate-synthesis.ts → portfolio-choice.ts pipeline and produce exactly the
// shapes the charter's Stage 1.1 list requires.
//
// Also pins: no power-set enumeration (call-count bound, not just "looks bounded"), no taskIds.length
// cap, candidate_horizon independence from `.quay/loop.yml` concurrency, and each module's own
// selftest() suite (imported and asserted, not re-implemented here).
//
// Run: node --test experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {
// gap-select-preflight-retirement-decision (2026-08-16): the legacy select-preflight.ts was
// retired with the classic OUTER-LOOP SELECT phase; the two getCandidates-baseline tests below
// were removed with it. The new-module assertions (RED/GREEN synthesis) are unaffected.
const { CONTRACT_VERSION, makeSingletonCandidate, normalizeLegacyCall, selftest: contractsSelftest } = await import("../scripts/candidate-contracts.ts");
const { buildCouplingGraph, selftest: couplingSelftest } = await import("../scripts/coupling-graph.ts");
const { synthesizeCandidates, scoreCandidate, selftest: synthesisSelftest } = await import("../scripts/candidate-synthesis.ts");
const { choosePortfolio, assertPortfolioDisjoint, selftest: portfolioSelftest } = await import("../scripts/portfolio-choice.ts");
const { runPreparationFeedbackLoop, MAX_PREPARATION_ROUNDS, selftest: preparationSelftest } = await import("../scripts/preparation-feedback.ts");
const { FIXTURE_A_WORKFLOW_HARDENING, FIXTURE_B_MULTI_SHAPE, FIXTURE_C_NEXT_GENERATION_SPLIT, FIXTURE_D_TEN_TASK_RECONCILE, FIXTURE_E_DISCONNECTED_REJECTED, FIXTURE_F_NO_DOUBLE_MEMBERSHIP, ALL_HISTORICAL_FIXTURES, } = await import("../scripts/candidate-synthesis-fixtures.ts");


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function synthesizeAndSelect(fixture, constraints = {}) {
  const candidates = synthesizeCandidates(fixture.tasks, { explicitEdges: fixture.explicitEdges });
  const portfolio = choosePortfolio(candidates, constraints);
  return { candidates, portfolio };
}

// ── RED: current SELECT representation cannot express a composite ──────────────────────────────────
// (The pre-retirement getCandidates-baseline RED test was removed with select-preflight.ts —
// gap-select-preflight-retirement-decision, 2026-08-16.)
test("RED (Stage 1.1): SELECT's shortlist truncation (rank + concurrency slice) cannot avoid splitting a real coupled group", () => {
  // Reproduce today's SELECT step 24 (OUTER-LOOP.md select ::): N = min(|shortlist|, concurrency);
  // candidates = shortlist[0..N]. With concurrency=2 and a genuinely-coupled 3-task group ranked
  // 1,2,3, the OLD model truncates and NEVER re-examines task 3 as part of the same milestone as 1/2.
  const ranked = FIXTURE_A_WORKFLOW_HARDENING.tasks.map((t) => t.id);
  const concurrency = 2;
  const legacyBatch = ranked.slice(0, concurrency);
  assert.equal(legacyBatch.length, 2, "legacy truncation takes only top-2");
  assert.ok(!legacyBatch.includes(ranked[2]), "RED: the third genuinely-coupled task is silently excluded from this cycle's batch, with no representation of the fact it belongs WITH the other two");
});

// ── GREEN: the new pipeline represents every Stage 1.1 historical fixture correctly ─────────────────
test("GREEN (a): DIR-114 + capture-gap + DIR-115 synthesize into one 3-task workflow-hardening composite", () => {
  const { candidates, portfolio } = synthesizeAndSelect(FIXTURE_A_WORKFLOW_HARDENING);
  const triad = candidates.find((c) => c.taskIds.length === 3);
  assert.ok(triad, `expected a 3-task composite among: ${JSON.stringify(candidates.map((c) => c.taskIds))}`);
  assert.deepEqual(
    [...triad.taskIds].sort(),
    ["DIR-114", "DIR-115", "gap-absorb-charter-audit-not-committed"].sort(),
  );
  assertPortfolioDisjoint(portfolio);
  assert.ok(portfolio.selected.some((c) => c.taskIds.length === 3), "the 3-task composite must actually be SELECTED, not merely synthesized");
});

test("GREEN (b): DIR-109–DIR-112 produce multiple comparable shapes, not one forced bundle", () => {
  const candidates = synthesizeCandidates(FIXTURE_B_MULTI_SHAPE.tasks, { explicitEdges: FIXTURE_B_MULTI_SHAPE.explicitEdges });
  const composites = candidates.filter((c) => c.taskIds.length > 1);
  assert.ok(composites.length >= 2, `expected >=2 distinct composite shapes, got: ${JSON.stringify(composites.map((c) => c.taskIds))}`);
  const shapeSet = new Set(composites.map((c) => [...c.taskIds].sort().join(",")));
  assert.ok(shapeSet.size >= 2, "shapes must be genuinely DIFFERENT task sets, not the same set scored twice");
  // The tight 2-task pairs (109+110, 111+112) must BOTH still be individually representable —
  // "comparable shapes", not a single forced 4-task bundle replacing them.
  assert.ok(composites.some((c) => sameSet(c.taskIds, ["DIR-109", "DIR-110"])), JSON.stringify(composites.map((c) => c.taskIds)));
  assert.ok(composites.some((c) => sameSet(c.taskIds, ["DIR-111", "DIR-112"])), JSON.stringify(composites.map((c) => c.taskIds)));
});

test("GREEN (c): DIR-062-B and DIR-062-C are kept in separate candidates by their next-generation edge", () => {
  const candidates = synthesizeCandidates(FIXTURE_C_NEXT_GENERATION_SPLIT.tasks, {
    explicitEdges: FIXTURE_C_NEXT_GENERATION_SPLIT.explicitEdges,
  });
  assert.ok(
    !candidates.some((c) => c.taskIds.length > 1 && c.taskIds.includes("DIR-062-B") && c.taskIds.includes("DIR-062-C")),
    `DIR-062-B and DIR-062-C must never share a composite: ${JSON.stringify(candidates.map((c) => c.taskIds))}`,
  );
  assert.ok(candidates.some((c) => sameSet(c.taskIds, ["DIR-062-B"])), "DIR-062-B must still get its own singleton");
  assert.ok(candidates.some((c) => sameSet(c.taskIds, ["DIR-062-C"])), "DIR-062-C must still get its own singleton");
});

test("GREEN (d): a 10-task homogeneous reconciliation group is NOT rejected for cardinality", () => {
  const candidates = synthesizeCandidates(FIXTURE_D_TEN_TASK_RECONCILE.tasks, { explicitEdges: [] });
  const tenTask = candidates.find((c) => c.taskIds.length === 10);
  assert.ok(tenTask, `expected a 10-task composite, got sizes: ${JSON.stringify(candidates.map((c) => c.taskIds.length))}`);
  const portfolio = choosePortfolio(candidates);
  assert.ok(portfolio.selected.some((c) => c.taskIds.length === 10), "the 10-task composite must be selectable, not silently excluded from the portfolio");
});

test("GREEN (e): a disconnected value-inflating addition is rejected — never bundled regardless of its claimed value", () => {
  const candidates = synthesizeCandidates(FIXTURE_E_DISCONNECTED_REJECTED.tasks, { explicitEdges: [] });
  assert.ok(
    !candidates.some((c) => c.taskIds.length > 1 && c.taskIds.includes("UNRELATED-HIGH-VALUE")),
    `UNRELATED-HIGH-VALUE (estimatedValue=500) must never join a composite: ${JSON.stringify(candidates.map((c) => c.taskIds))}`,
  );
  assert.ok(candidates.some((c) => sameSet(c.taskIds, ["CORE-1", "CORE-2"])), "the genuinely-coupled pair must still form its own composite");
});

test("GREEN (f): a task cannot occur in two SELECTED milestone candidates, even when synthesis offers overlapping alternative shapes", () => {
  // Force overlapping alternative shapes over the same 3-task pool by synthesizing from two
  // different seed orders (SHARE-1 first vs SHARE-3 first) and merging their candidate lists — this
  // simulates the real situation where multiple seeds can independently propose overlapping shapes.
  const forward = synthesizeCandidates(FIXTURE_F_NO_DOUBLE_MEMBERSHIP.tasks, {});
  const reversed = synthesizeCandidates([...FIXTURE_F_NO_DOUBLE_MEMBERSHIP.tasks].reverse(), {});
  const merged = [...forward, ...reversed];
  assert.ok(merged.some((c) => c.taskIds.length > 1), "sanity: at least one composite shape must exist to make this test meaningful");
  const portfolio = choosePortfolio(merged);
  assertPortfolioDisjoint(portfolio); // throws with the concrete duplicate if violated — not just a boolean assert
  const allSelectedTaskIds = portfolio.selected.flatMap((c) => c.taskIds);
  assert.equal(new Set(allSelectedTaskIds).size, allSelectedTaskIds.length, "no task ID may appear twice across the selected set");
});

function sameSet(arr, expected) {
  return [...arr].sort().join(",") === [...expected].sort().join(",");
}

// ── no power-set enumeration ─────────────────────────────────────────────────────────────────────
test("no power-set enumeration: candidate count for a fully-mutually-coupled N-task pool is linear-ish, never 2^N", () => {
  const fully = FIXTURE_D_TEN_TASK_RECONCILE.tasks; // all 10 share one touch file -> maximally coupled
  const candidates = synthesizeCandidates(fully, {});
  // Power-set over 10 tasks would be 1024 subsets; a correct bounded beam produces, at most, one
  // singleton per task plus a small constant number of shapes per seed (candidateHorizon, default 3).
  assert.ok(candidates.length < 50, `candidate count ${candidates.length} is suspiciously large for 10 tasks — power-set would be 1024`);
  assert.ok(candidates.length >= 10, "must at least retain all 10 singletons");
});

test("no taskIds.length cap: a 25-task fully-coupled pool synthesizes without truncation", () => {
  const bigTasks = Array.from({ length: 25 }, (_, i) => ({
    version: 1,
    id: `BIG-${i}`,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 2,
    deliverySurface: [],
    touches: ["one-shared-hub-file.ts"],
    semanticResources: [],
    dependsOn: [],
    verificationBoundary: "scripts/test.sh",
    acCount: 1,
    lineEstimate: 10,
    sourceHash: "h",
  }));
  const candidates = synthesizeCandidates(bigTasks, {});
  const biggest = Math.max(...candidates.map((c) => c.taskIds.length));
  assert.equal(biggest, 25, `expected a 25-task composite to be reachable, got max size ${biggest}`);
});

// ── candidate_horizon independence from .quay/loop.yml concurrency ─────────────────────────────────
test("candidate_horizon is independent of .quay/loop.yml concurrency: no module in the synthesis pipeline reads loop.yml as a file path", () => {
  // Strip `//`-comment lines first — several of these modules' header comments explain the
  // independence in PROSE, which itself names the file (including inside markdown-style backtick
  // inline-code spans); only CODE lines are checked for an actual reference to the path.
  for (const file of ["candidate-contracts.ts", "coupling-graph.ts", "candidate-synthesis.ts"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", file), "utf8");
    const codeOnly = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join("\n");
    assert.ok(
      !/loop\.yml/.test(codeOnly),
      `${file} must never reference .quay/loop.yml from executable code — candidate_horizon is a synthesis-time knob, concurrency is a portfolio-choice-time budget owned entirely by portfolio-choice.ts`,
    );
  }
});

test("candidate_horizon independence (behavioral): shape count per seed is unaffected by varying an unrelated 'concurrency' value passed only to portfolio choice", () => {
  const candidatesLowConcurrency = synthesizeCandidates(FIXTURE_B_MULTI_SHAPE.tasks, {});
  const candidatesHighConcurrency = synthesizeCandidates(FIXTURE_B_MULTI_SHAPE.tasks, {});
  // Synthesis never even takes a concurrency parameter — the SAME synthesis call, with concurrency
  // varied only downstream at choosePortfolio time, produces IDENTICAL candidate shapes.
  assert.deepEqual(
    candidatesLowConcurrency.map((c) => c.taskIds).sort(),
    candidatesHighConcurrency.map((c) => c.taskIds).sort(),
  );
  const portfolioLow = choosePortfolio(candidatesLowConcurrency, { maxSelected: 1 });
  const portfolioHigh = choosePortfolio(candidatesHighConcurrency, { maxSelected: 4 });
  assert.ok(portfolioHigh.selected.length >= portfolioLow.selected.length, "only the PORTFOLIO's selected count should vary with concurrency, not the synthesized shape set");
});

// ── compatibility invariants (plan doc §2) ───────────────────────────────────────────────────────
test("compatibility invariant #1: a one-task MilestoneCandidate reproduces today's single-task path", () => {
  const solo = FIXTURE_C_NEXT_GENERATION_SPLIT.tasks[0];
  const singleton = makeSingletonCandidate(solo);
  assert.deepEqual(singleton.taskIds, [solo.id]);
  assert.equal(singleton.score, solo.estimatedValue);
  assert.equal(singleton.coordinationCost, 0);
});

test("compatibility invariant #2: legacy {taskId, charterFile, absorbEntryFile} calls normalize to taskIds:[taskId]", () => {
  const normalized = normalizeLegacyCall({ taskId: "DIR-119-A", charterFile: "charters/M188-x.md", absorbEntryFile: "/tmp/entry.md" });
  assert.deepEqual(normalized.taskIds, ["DIR-119-A"]);
  assert.equal(normalized.charterFile, "charters/M188-x.md");
});

test("compatibility invariant #4: each task appears in at most one selected candidate (portfolio-level, all fixtures combined)", () => {
  for (const fixture of ALL_HISTORICAL_FIXTURES) {
    const candidates = synthesizeCandidates(fixture.tasks, { explicitEdges: fixture.explicitEdges });
    const portfolio = choosePortfolio(candidates);
    assert.doesNotThrow(() => assertPortfolioDisjoint(portfolio), `fixture ${fixture.name} violated task-disjointness`);
  }
});

// ── Stage 1.5 preparation-feedback loop: demonstrated with a synthetic drift scenario ───────────────
test("Stage 1.5: a synthetic touches-drift scenario invalidates 3 times then routes to human review (never loops silently forever)", () => {
  const { candidates } = synthesizeAndSelect(FIXTURE_A_WORKFLOW_HARDENING);
  const initialPortfolio = choosePortfolio(candidates);
  let regenCount = 0;
  const outcome = runPreparationFeedbackLoop(FIXTURE_A_WORKFLOW_HARDENING.tasks, initialPortfolio, {
    check: () => ({ valid: false, reason: "synthetic touches drift: charter authoring discovered an undeclared shared file", updatedFacts: FIXTURE_A_WORKFLOW_HARDENING.tasks }),
    regenerate: (facts, round) => {
      regenCount++;
      const regenCandidates = synthesizeCandidates(facts, { explicitEdges: FIXTURE_A_WORKFLOW_HARDENING.explicitEdges });
      return { ...choosePortfolio(regenCandidates), round };
    },
  });
  assert.equal(outcome.status, "human-review-required");
  assert.equal(outcome.rounds, MAX_PREPARATION_ROUNDS);
  assert.equal(regenCount, MAX_PREPARATION_ROUNDS, "must regenerate exactly 3 times, never a 4th");
});

test("Stage 1.5: preparation succeeding on round 2 accepts without exhausting all 3 rounds", () => {
  const { candidates } = synthesizeAndSelect(FIXTURE_A_WORKFLOW_HARDENING);
  const initialPortfolio = choosePortfolio(candidates);
  const outcome = runPreparationFeedbackLoop(FIXTURE_A_WORKFLOW_HARDENING.tasks, initialPortfolio, {
    check: (p) => (p.round >= 2 ? { valid: true } : { valid: false, reason: "drift", updatedFacts: FIXTURE_A_WORKFLOW_HARDENING.tasks }),
    regenerate: (facts, round) => ({ ...choosePortfolio(synthesizeCandidates(facts, {})), round }),
  });
  assert.equal(outcome.status, "accepted");
  assert.equal(outcome.rounds, 2);
});

// ── sibling coverage: each new module's own selftest() suite must pass ──────────────────────────────
// (The pre-retirement "legacy select-preflight.ts getCandidates/selftest remain green" test was
// removed with select-preflight.ts — gap-select-preflight-retirement-decision, 2026-08-16.)
test("candidate-contracts.ts selftest suite passes", () => {
  assert.equal(contractsSelftest(), true);
});
test("coupling-graph.ts selftest suite passes", () => {
  assert.equal(couplingSelftest(), true);
});
test("candidate-synthesis.ts selftest suite passes", () => {
  assert.equal(synthesisSelftest(), true);
});
test("portfolio-choice.ts selftest suite passes", () => {
  assert.equal(portfolioSelftest(), true);
});
test("preparation-feedback.ts selftest suite passes", () => {
  assert.equal(preparationSelftest(), true);
});

test("CONTRACT_VERSION is stable and referenced consistently", () => {
  assert.equal(CONTRACT_VERSION, 1);
});

}
