// composite-build.test.mjs — sibling test for composite-build.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-build.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPhaseExecution, mapEvidenceToTasks, selftest } from "../scripts/composite-build.ts";

test("composite-build.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

const mkPhases = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, taskIds: [`T-${i}`], requires: [], auditShardIds: [] }));

test("serialize mode: agentCount is always 1 regardless of width (1, 3, 5, 10)", () => {
  for (const n of [1, 3, 5, 10]) {
    const plan = planPhaseExecution(mkPhases(n), { mode: "serialize" });
    assert.equal(plan.agentCount, 1);
    assert.equal(plan.batches.flat().length, n);
  }
});

test("a shared phase covering many tasks gets exactly ONE owner, not one per task", () => {
  const sharedPhase = { id: "shared", taskIds: ["T-0", "T-1", "T-2", "T-3", "T-4"], requires: [], auditShardIds: [] };
  const plan = planPhaseExecution([sharedPhase], { mode: "parallel" });
  assert.equal(plan.agentCount, 1);
  assert.equal(new Set(Object.values(plan.owners)).size, 1);
});

test("parallel mode caps agent count independently of task/phase count", () => {
  const plan = planPhaseExecution(mkPhases(5), { mode: "parallel", maxParallelAgents: 2 });
  assert.ok(plan.agentCount <= 2, `agentCount=${plan.agentCount}`);
  assert.equal(plan.batches.flat().length, 5);
});

test("phase dependency ordering is respected: dependency's batch precedes dependent's batch", () => {
  const phases = [
    { id: "A", taskIds: ["T-0"], requires: [], auditShardIds: [] },
    { id: "B", taskIds: ["T-1"], requires: ["A"], auditShardIds: [] },
  ];
  const plan = planPhaseExecution(phases, { mode: "parallel" });
  const batchOf = (id) => plan.batches.findIndex((b) => b.includes(id));
  assert.ok(batchOf("A") < batchOf("B"));
});

test("evidence from a shared phase fans out to every task it covers", () => {
  const phases = [{ id: "shared", taskIds: ["T-0", "T-1", "T-2"], requires: [], auditShardIds: [] }];
  const evidence = [{ phaseId: "shared", files: ["a.ts"], commits: ["abc123"], tests: ["a.test.mjs"] }];
  const reports = mapEvidenceToTasks(phases, evidence);
  assert.equal(reports.length, 3);
  assert.ok(reports.every((r) => r.files.includes("a.ts") && r.commits.includes("abc123") && r.tests.includes("a.test.mjs")));
});

test("evidence across two phases touching the same task is deduped and phaseIds accumulate", () => {
  const phases = [
    { id: "p0", taskIds: ["T-0"], requires: [], auditShardIds: [] },
    { id: "p1", taskIds: ["T-0"], requires: ["p0"], auditShardIds: [] },
  ];
  const evidence = [
    { phaseId: "p0", files: ["a.ts"], commits: ["c1"], tests: [] },
    { phaseId: "p1", files: ["a.ts", "b.ts"], commits: ["c2"], tests: [] },
  ];
  const reports = mapEvidenceToTasks(phases, evidence);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].files.sort(), ["a.ts", "b.ts"]);
  assert.deepEqual(reports[0].phaseIds, ["p0", "p1"]);
});

test("a phase with no matching evidence entry is silently skipped, never throws", () => {
  const phases = [{ id: "p0", taskIds: ["T-0"], requires: [], auditShardIds: [] }];
  const reports = mapEvidenceToTasks(phases, []);
  assert.deepEqual(reports, []);
});
