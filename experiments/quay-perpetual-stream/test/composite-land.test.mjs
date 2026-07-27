// composite-land.test.mjs — sibling test for composite-land.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-land.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLandTransaction, legacySingletonLandShape, selftest } from "../scripts/composite-land.ts";

test("composite-land.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

const okReconcile = (taskIds) => ({
  ok: true,
  mutations: taskIds.map((t) => ({ taskId: t, checkboxes: ["ac-0"], absorbDisposition: "PASS" })),
  bundleDisposition: "PASS",
});

test("golden replay: a real single-task dispatch through this new path matches the legacy Land shape exactly", () => {
  const txn = buildLandTransaction(["DIR-1"], okReconcile(["DIR-1"]));
  const legacy = legacySingletonLandShape();
  assert.equal(txn.ok, true);
  assert.equal(txn.counterDelta, legacy.counterDelta);
  assert.equal(txn.dashboardEntryCount, legacy.dashboardEntryCount);
  assert.equal(txn.taskCompletionCount, legacy.taskCompletionCount);
});

test("atomic Land at widths 1, 3, 5, 10: counter increments exactly once, one dashboard entry, task-completion count recorded separately", () => {
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const txn = buildLandTransaction(taskIds, okReconcile(taskIds));
    assert.equal(txn.counterDelta, 1, `width ${n}: counterDelta must be exactly 1`);
    assert.equal(txn.dashboardEntryCount, 1, `width ${n}: exactly ONE dashboard entry, never one per task`);
    assert.equal(txn.taskCompletionCount, n, `width ${n}: completion count tracks width separately from the counter`);
    assert.equal(txn.taskMarks.length, n);
    assert.ok(txn.taskMarks.every((m) => m.status === "done"));
  }
});

test("a failed reconcile produces NO partial Land — zero counter delta, zero dashboard entries, zero task marks", () => {
  const failed = { ok: false, reason: "bundle-verdict-not-pass: REFUTED", mutations: [] };
  const txn = buildLandTransaction(["T-0", "T-1", "T-2"], failed);
  assert.equal(txn.ok, false);
  assert.equal(txn.counterDelta, 0);
  assert.equal(txn.dashboardEntryCount, 0);
  assert.equal(txn.taskCompletionCount, 0);
  assert.deepEqual(txn.taskMarks, []);
});

test("Land independently re-verifies membership completeness rather than trusting reconcile blindly", () => {
  const partial = { ok: true, mutations: [{ taskId: "T-0", checkboxes: [], absorbDisposition: "PASS" }], bundleDisposition: "PASS" };
  const txn = buildLandTransaction(["T-0", "T-1"], partial);
  assert.equal(txn.ok, false);
  assert.equal(txn.counterDelta, 0);
});
