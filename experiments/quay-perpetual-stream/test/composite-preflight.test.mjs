// composite-preflight.test.mjs — sibling test for composite-preflight.ts (ADR-001 Decision
// clause 2: load-bearing method-infra MUST carry a `<name>.test.mjs` sibling —
// loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-preflight.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPreflight, selftest } from "../scripts/composite-preflight.ts";
import { makeValidCompositeFixture, makeSharedPhaseCompositeFixture } from "../scripts/composite-contracts.ts";

test("composite-preflight.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("legacy {taskId,...} call is a vacuous pass — golden replay, no contract check performed", () => {
  const result = runPreflight(JSON.stringify({ taskId: "DIR-1", charterFile: "c.md", absorbEntryFile: "a.md" }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.taskIds, ["DIR-1"]);
  assert.equal(result.isComposite, false);
});

test("new-shape call with no compositeManifestFile is a vacuous pass at any width", () => {
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds } }));
    assert.equal(result.ok, true);
    assert.equal(result.taskIds.length, n);
  }
});

test("a real composite manifest file that satisfies the contract checker passes end-to-end", () => {
  const { manifest, ctx } = makeValidCompositeFixture(3);
  const tmpFile = path.join(os.tmpdir(), `composite-preflight-test-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ manifest, context: ctx }));
  try {
    const result = runPreflight(
      JSON.stringify({ milestoneCandidate: { candidateId: manifest.candidateId, taskIds: manifest.taskIds }, compositeManifestFile: tmpFile }),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.contractViolations, []);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test("a real composite manifest file that VIOLATES the contract checker fails closed end-to-end", () => {
  const { manifest, ctx } = makeSharedPhaseCompositeFixture(3);
  const broken = { ...manifest, phases: manifest.phases.map((p) => (p.taskIds.length > 1 ? { ...p, integrationInvariant: undefined } : p)) };
  const tmpFile = path.join(os.tmpdir(), `composite-preflight-test-broken-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ manifest: broken, context: ctx }));
  try {
    const result = runPreflight(
      JSON.stringify({ milestoneCandidate: { candidateId: broken.candidateId, taskIds: broken.taskIds }, compositeManifestFile: tmpFile }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.contractViolations.some((v) => v.startsWith("shared-phase-missing-integration-invariant")));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test("a missing manifest file is reported, not silently skipped", () => {
  const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds: ["A"] }, compositeManifestFile: "/definitely/not/a/real/path.json" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "manifest-not-found");
});

test("stale-hash rejection is honored through the CLI wrapper when --current-hashes-json is provided", () => {
  const result = runPreflight(
    JSON.stringify({ milestoneCandidate: { taskIds: ["A"], sourceHashes: { A: "old" } } }),
    JSON.stringify({ A: "new" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "stale-hash");
});
