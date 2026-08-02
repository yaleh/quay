// @test-group engine
// composite-contracts.test.mjs — sibling test for composite-contracts.ts (ADR-001 Decision
// clause 2: load-bearing method-infra MUST carry a `<name>.test.mjs` sibling —
// loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-contracts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCompositeContract,
  makeValidCompositeFixture,
  makeSharedPhaseCompositeFixture,
  selftest,
} from "../scripts/composite-contracts.ts";

test("composite-contracts.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("valid 1/3/5/10-task fixtures all pass the contract checker", () => {
  for (const n of [1, 3, 5, 10]) {
    const { manifest, ctx } = makeValidCompositeFixture(n);
    const result = checkCompositeContract(manifest, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  }
});

test("a shared phase with a declared integration invariant passes", () => {
  const { manifest, ctx } = makeSharedPhaseCompositeFixture(3);
  const result = checkCompositeContract(manifest, ctx);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("a shared phase MISSING its integration invariant fails closed", () => {
  const { manifest, ctx } = makeSharedPhaseCompositeFixture(3);
  const broken = { ...manifest, phases: manifest.phases.map((p) => (p.taskIds.length > 1 ? { ...p, integrationInvariant: undefined } : p)) };
  const result = checkCompositeContract(broken, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("shared-phase-missing-integration-invariant")));
});

test("membership mismatch against the candidate fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const badCtx = { ...ctx, candidateTaskIds: [...ctx.candidateTaskIds, "T-EXTRA"] };
  const result = checkCompositeContract(manifest, badCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("membership-mismatch-candidate")));
});

test("membership mismatch against the charter fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const badCtx = { ...ctx, charterTaskIds: ctx.charterTaskIds.slice(0, 2) };
  const result = checkCompositeContract(manifest, badCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("membership-mismatch-charter")));
});

test("an uncovered task AC (no phase covers it) fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const broken = { ...manifest, phases: manifest.phases.filter((p) => !p.taskIds.includes("T-1")) };
  const result = checkCompositeContract(broken, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("no-phase-covers-task-ac: T-1"));
});

test("an uncovered task AC (no audit shard covers it) fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const broken = { ...manifest, auditShards: manifest.auditShards.filter((s) => !s.taskIds.includes("T-1")) };
  const result = checkCompositeContract(broken, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("no-audit-shard-covers-task-ac: T-1"));
});

test("a cyclic phase dependency fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const cyclic = {
    ...manifest,
    phases: manifest.phases.map((p, i) => (i === 0 ? { ...p, requires: [manifest.phases[1].id] } : i === 1 ? { ...p, requires: [manifest.phases[0].id] } : p)),
  };
  const result = checkCompositeContract(cyclic, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("phase-dependency-cycle")));
});

test("a forbidden (prohibiting) temporal coupling edge internalized within membership fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const badCtx = { ...ctx, forbiddenEdges: [{ a: "T-0", b: "T-1", kind: "next-generation" }] };
  const result = checkCompositeContract(manifest, badCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("forbidden-temporal-edge-internalized")));
});

test("a merely-supporting coupling edge among members does NOT fail the check", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const okCtx = { ...ctx, forbiddenEdges: [{ a: "T-0", b: "T-1", kind: "shared-implementation" }] };
  const result = checkCompositeContract(manifest, okCtx);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("over phase-count capacity fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(5);
  const tightCtx = { ...ctx, capacity: { ...ctx.capacity, maxPhases: 2 } };
  const result = checkCompositeContract(manifest, tightCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("phase-count-over-capacity")));
});

test("over audit-shard-count capacity fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(5);
  const tightCtx = { ...ctx, capacity: { ...ctx.capacity, maxAuditShards: 2 } };
  const result = checkCompositeContract(manifest, tightCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("audit-shard-count-over-capacity")));
});

test("over total-line-budget capacity fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(5);
  const lineCtx = {
    ...ctx,
    capacity: { ...ctx.capacity, taskLineEstimates: Object.fromEntries(manifest.taskIds.map((t) => [t, 500])), maxTotalLines: 1000 },
  };
  const result = checkCompositeContract(manifest, lineCtx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("total-line-estimate-over-capacity")));
});

test("non-atomic Land policy fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(1);
  const partial = { ...manifest, landPolicy: "partial" };
  const result = checkCompositeContract(partial, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("land-policy-not-atomic")));
});

test("incomplete union touches fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(2);
  const broken = { ...manifest, touches: manifest.touches.slice(0, 1) };
  const result = checkCompositeContract(broken, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("touches-incomplete")));
});

test("incomplete union semantic resources fails closed", () => {
  const { manifest, ctx } = makeValidCompositeFixture(2);
  const withResources = { ...ctx, taskSemanticResources: { "T-0": ["res-A"], "T-1": ["res-B"] } };
  const result = checkCompositeContract(manifest, withResources);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.startsWith("semantic-resources-incomplete")));
});
