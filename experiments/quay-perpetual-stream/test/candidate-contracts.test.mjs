// @test-group engine
// candidate-contracts.test.mjs — sibling test for candidate-contracts.ts (ADR-001 Decision clause 2:
// load-bearing method-infra, imported by coupling-graph.ts/candidate-synthesis.ts/
// select-preflight.ts, MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh enforces
// this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/candidate-contracts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { CONTRACT_VERSION, PROHIBITING_KINDS, SUPPORTING_KINDS, isProhibiting, isSupporting, isExploreTask, makeSingletonCandidate, normalizeLegacyCall, selftest, } = await import("../scripts/candidate-contracts.ts");

test("candidate-contracts.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("CONTRACT_VERSION is 1", () => {
  assert.equal(CONTRACT_VERSION, 1);
});

test("PROHIBITING_KINDS and SUPPORTING_KINDS are disjoint and cover the 9 documented kinds", () => {
  const all = new Set([...PROHIBITING_KINDS, ...SUPPORTING_KINDS]);
  assert.equal(all.size, 9);
  for (const k of PROHIBITING_KINDS) assert.ok(!SUPPORTING_KINDS.has(k), `${k} must not be both`);
});

test("isProhibiting/isSupporting classify every documented kind correctly", () => {
  for (const k of PROHIBITING_KINDS) {
    assert.equal(isProhibiting(k), true, k);
    assert.equal(isSupporting(k), false, k);
  }
  for (const k of SUPPORTING_KINDS) {
    assert.equal(isSupporting(k), true, k);
    assert.equal(isProhibiting(k), false, k);
  }
});

test("makeSingletonCandidate reproduces compatibility invariant #1: score === estimatedValue, zero coordination/atomic-failure cost", () => {
  const tc = {
    version: 1,
    id: "T-1",
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 17,
    deliverySurface: [],
    touches: ["a.ts"],
    semanticResources: [],
    dependsOn: [],
    verificationBoundary: "scripts/test.sh",
    acCount: 2,
    lineEstimate: 40,
    sourceHash: "h",
  };
  const c = makeSingletonCandidate(tc);
  assert.deepEqual(c.taskIds, ["T-1"]);
  assert.equal(c.score, 17);
  assert.equal(c.coordinationCost, 0);
  assert.equal(c.atomicFailureCost, 0);
  assert.equal(c.fixedCostSaving, 0);
  assert.deepEqual(c.sourceHashes, { "T-1": "h" });
});

test("normalizeLegacyCall: compatibility invariant #2 — legacy {taskId,...} normalizes to taskIds:[taskId]", () => {
  const n = normalizeLegacyCall({ taskId: "DIR-1", charterFile: "c.md", absorbEntryFile: "a.md" });
  assert.deepEqual(n.taskIds, ["DIR-1"]);
  assert.equal(n.charterFile, "c.md");
  assert.equal(n.absorbEntryFile, "a.md");
});

test("normalizeLegacyCall: an empty/missing taskId throws rather than silently producing an empty array", () => {
  assert.throws(() => normalizeLegacyCall({ taskId: "" }));
  assert.throws(() => normalizeLegacyCall({}));
});

// ── isExploreTask (M188/DIR-119-A AC5 follow-up: cadence input) ────────────────────────────────────
test("isExploreTask: matches an id containing 'explore', the arch-audit-explore pattern, or label:explore", () => {
  assert.equal(isExploreTask({ id: "exp5-M-EXPLORE-FOO", labels: [] }), true);
  assert.equal(isExploreTask({ id: "exp5-M-ARCH-AUDIT-M133-EXPLORE", labels: [] }), true);
  assert.equal(isExploreTask({ id: "DIR-999", labels: ["explore"] }), true);
});

test("isExploreTask: false for an ordinary task with no explore signal", () => {
  assert.equal(isExploreTask({ id: "DIR-119-A", labels: ["milestone-candidate"] }), false);
});

