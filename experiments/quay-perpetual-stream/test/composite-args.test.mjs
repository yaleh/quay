// @test-group engine
// composite-args.test.mjs — sibling test for composite-args.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-args.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExecuteArgs, ExecuteArgsError, selftest } from "../scripts/composite-args.ts";

test("composite-args.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("legacy {taskId,...} normalizes to taskIds:[taskId], isComposite:false", () => {
  const n = normalizeExecuteArgs({ taskId: "DIR-1", charterFile: "c.md", absorbEntryFile: "a.md" });
  assert.deepEqual(n.taskIds, ["DIR-1"]);
  assert.equal(n.charterFile, "c.md");
  assert.equal(n.absorbEntryFile, "a.md");
  assert.equal(n.isComposite, false);
});

test("new milestoneCandidate shape never rejects on width — 1, 3, 5, 10, 50 all accepted", () => {
  for (const n of [1, 3, 5, 10, 50]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const result = normalizeExecuteArgs({ milestoneCandidate: { candidateId: "c", taskIds } });
    assert.equal(result.taskIds.length, n);
    assert.equal(result.isComposite, true);
  }
});

test("duplicate task ids are rejected", () => {
  assert.throws(
    () => normalizeExecuteArgs({ milestoneCandidate: { taskIds: ["A", "B", "A"] } }),
    (err) => err instanceof ExecuteArgsError && err.code === "duplicate-task-id",
  );
});

test("invalid (empty-string) task id is rejected", () => {
  assert.throws(
    () => normalizeExecuteArgs({ milestoneCandidate: { taskIds: ["A", ""] } }),
    (err) => err instanceof ExecuteArgsError && err.code === "invalid-task-id",
  );
});

test("empty task array is rejected as an identity problem, not a length-floor rejection", () => {
  assert.throws(
    () => normalizeExecuteArgs({ milestoneCandidate: { taskIds: [] } }),
    (err) => err instanceof ExecuteArgsError && err.code === "empty-task-array",
  );
});

test("missing task identity entirely is rejected", () => {
  assert.throws(
    () => normalizeExecuteArgs({ charterFile: "c.md" }),
    (err) => err instanceof ExecuteArgsError && err.code === "missing-task-identity",
  );
});

test("conflicting legacy taskId and new milestoneCandidate.taskIds (disagreeing) is rejected", () => {
  assert.throws(
    () => normalizeExecuteArgs({ taskId: "DIR-1", milestoneCandidate: { taskIds: ["DIR-2", "DIR-3"] } }),
    (err) => err instanceof ExecuteArgsError && err.code === "conflicting-legacy-and-new-args",
  );
});

test("legacy taskId that merely restates the sole candidate task is accepted, not a conflict", () => {
  const n = normalizeExecuteArgs({ taskId: "DIR-1", milestoneCandidate: { taskIds: ["DIR-1"] } });
  assert.deepEqual(n.taskIds, ["DIR-1"]);
});

test("stale source hash is rejected when currentSourceHashes disagrees", () => {
  assert.throws(
    () =>
      normalizeExecuteArgs(
        { milestoneCandidate: { taskIds: ["A"], sourceHashes: { A: "old" } } },
        { currentSourceHashes: { A: "new" } },
      ),
    (err) => err instanceof ExecuteArgsError && err.code === "stale-hash",
  );
});

test("matching source hash is accepted", () => {
  const n = normalizeExecuteArgs(
    { milestoneCandidate: { taskIds: ["A"], sourceHashes: { A: "same" } } },
    { currentSourceHashes: { A: "same" } },
  );
  assert.deepEqual(n.taskIds, ["A"]);
});

test("compositeManifestFile passes through untouched on the new shape", () => {
  const n = normalizeExecuteArgs({ milestoneCandidate: { taskIds: ["A", "B"] }, compositeManifestFile: "manifest.json" });
  assert.equal(n.compositeManifestFile, "manifest.json");
});
