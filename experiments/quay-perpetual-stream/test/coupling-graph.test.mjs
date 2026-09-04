// @test-group engine
// coupling-graph.test.mjs — sibling test for coupling-graph.ts (ADR-001 Decision clause 2:
// load-bearing method-infra, imported by candidate-synthesis.ts, MUST carry a `<name>.test.mjs`
// sibling — loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/coupling-graph.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildCouplingGraph, deriveSharedImplementationEdges, deriveSharedSemanticResourceEdges, deriveInternalOrderEdges, mergeEdges, hasProhibitingEdge, supportingNeighbors, selftest, } = await import("../scripts/coupling-graph.ts");

function mk(id, touches, deps = [], sem = []) {
  return {
    version: 1,
    id,
    status: "todo",
    labels: [],
    valueType: "capabilityGrowth",
    eligible: true,
    estimatedValue: 5,
    deliverySurface: [],
    touches,
    semanticResources: sem,
    dependsOn: deps,
    verificationBoundary: "scripts/test.sh",
    acCount: 1,
    lineEstimate: 50,
    sourceHash: "h",
  };
}

test("coupling-graph.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("deriveSharedImplementationEdges: overlapping exact touches produce a shared-implementation edge", () => {
  const edges = deriveSharedImplementationEdges([mk("A", ["x.ts"]), mk("B", ["x.ts"]), mk("C", ["y.ts"])]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, "shared-implementation");
});

test("deriveSharedSemanticResourceEdges: shared resource identifiers produce an edge", () => {
  const edges = deriveSharedSemanticResourceEdges([mk("A", [], [], ["res-1"]), mk("B", [], [], ["res-1"])]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, "shared-semantic-resource");
});

test("deriveInternalOrderEdges: dependsOn produces an a-before-b edge; deps outside the fact set are dropped", () => {
  const edges = deriveInternalOrderEdges([mk("A", []), mk("B", [], ["A"]), mk("C", [], ["OUTSIDE"])]);
  assert.equal(edges.length, 1);
  assert.deepEqual([edges[0].a, edges[0].b, edges[0].requiresOrder], ["A", "B", "a-before-b"]);
});

test("mergeEdges: direction-sensitive dedup keeps opposite-direction internal-order edges distinct", () => {
  const forward = [{ a: "P", b: "O", kind: "internal-order", evidence: "x", requiresOrder: "a-before-b" }];
  const backward = [{ a: "O", b: "P", kind: "internal-order", evidence: "y", requiresOrder: "a-before-b" }];
  const merged = mergeEdges([forward, backward]);
  assert.equal(merged.length, 2, "both directions must survive — they encode a real cycle, not a duplicate");
});

test("mergeEdges: identical re-derivation is idempotent", () => {
  const edges = deriveSharedImplementationEdges([mk("A", ["x.ts"]), mk("B", ["x.ts"])]);
  const merged = mergeEdges([edges, edges]);
  assert.equal(merged.length, edges.length);
});

test("buildCouplingGraph: explicit prohibiting edge coexists with a derived supporting edge for the same pair", () => {
  const g = buildCouplingGraph({
    tasks: [mk("H", ["s.ts"]), mk("I", ["s.ts"])],
    explicitEdges: [{ a: "H", b: "I", kind: "next-generation", evidence: "fixture" }],
  });
  assert.ok(g.edges.some((e) => e.kind === "next-generation"));
  assert.ok(g.edges.some((e) => e.kind === "shared-implementation"));
});

test("hasProhibitingEdge finds a prohibiting edge regardless of argument order", () => {
  const g = buildCouplingGraph({
    tasks: [mk("H", []), mk("I", [])],
    explicitEdges: [{ a: "H", b: "I", kind: "conflicts", evidence: "fixture" }],
  });
  assert.ok(hasProhibitingEdge(g, "H", "I"));
  assert.ok(hasProhibitingEdge(g, "I", "H"));
});

test("supportingNeighbors excludes a neighbor when ANY edge between the pair is prohibiting", () => {
  const g = buildCouplingGraph({
    tasks: [mk("H", ["s.ts"]), mk("I", ["s.ts"])],
    explicitEdges: [{ a: "H", b: "I", kind: "next-generation", evidence: "fixture" }],
  });
  assert.deepEqual(supportingNeighbors(g, "H"), []);
});

test("supportingNeighbors includes a clean supporting neighbor", () => {
  const g = buildCouplingGraph({ tasks: [mk("A", ["x.ts"]), mk("B", ["x.ts"])] });
  assert.deepEqual(supportingNeighbors(g, "A"), ["B"]);
});

