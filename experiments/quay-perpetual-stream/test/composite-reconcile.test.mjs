// composite-reconcile.test.mjs — sibling test for composite-reconcile.ts (ADR-001 Decision
// clause 2: load-bearing method-infra MUST carry a `<name>.test.mjs` sibling —
// loadbearing-test-gate.sh enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-reconcile.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, selftest } from "../scripts/composite-reconcile.ts";

test("composite-reconcile.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

const passingBundle = (taskIds) => ({
  candidateId: "c-1",
  generationId: "gen-1",
  bundleVerdict: "PASS",
  shardResults: [{ shardId: "s0", shardVerdict: "PASS", verdicts: taskIds.map((t) => ({ taskId: t, acIndex: 0, verdict: "PASS", detail: "" })) }],
});

const goodInput = (taskIds) => ({
  bundleAudit: passingBundle(taskIds),
  requiredGenerationId: "gen-1",
  taskGates: taskIds.map((t) => ({ taskId: t, gate: "dod-check", ok: true })),
  milestoneGates: [{ gate: "milestone-dod", ok: true }],
  taskIds,
});

test("happy path at widths 1, 3, 5, 10: mutations cover EVERY member task", () => {
  for (const n of [1, 3, 5, 10]) {
    const taskIds = Array.from({ length: n }, (_, i) => `T-${i}`);
    const result = reconcile(goodInput(taskIds));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.mutations.length, n);
  }
});

test("a REFUTED bundle verdict blocks ALL mutations", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.bundleAudit = { ...input.bundleAudit, bundleVerdict: "REFUTED" };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("one REFUTED task among three blocks the ENTIRE bundle atomically — no partial mutation for the other two", () => {
  const taskIds = ["T-0", "T-1", "T-2"];
  const input = goodInput(taskIds);
  input.bundleAudit = {
    ...input.bundleAudit,
    bundleVerdict: "REFUTED",
    shardResults: [
      {
        shardId: "s0",
        shardVerdict: "REFUTED",
        verdicts: [
          { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap found" },
          { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
        ],
      },
    ],
  };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("a missing verdict for one member task fails closed by name", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.bundleAudit = passingBundle(["T-0"]);
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-verdict-for-task: T-1");
});

test("a failed task-scoped gate blocks the whole bundle atomically", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.taskGates = [
    { taskId: "T-0", gate: "dod-check", ok: true },
    { taskId: "T-1", gate: "dod-check", ok: false, detail: "line budget exceeded" },
  ];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.mutations.length, 0);
});

test("a missing task-scoped gate for a member task fails closed", () => {
  const input = goodInput(["T-0", "T-1"]);
  input.taskGates = input.taskGates.filter((g) => g.taskId !== "T-1");
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-gate-for-task: T-1");
});

test("zero milestone-scoped gates fails closed", () => {
  const input = goodInput(["T-0"]);
  input.milestoneGates = [];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-milestone-gates-run");
});

test("a failed milestone-scoped gate fails closed even when every task-level check passed", () => {
  const input = goodInput(["T-0", "T-1", "T-2"]);
  input.milestoneGates = [{ gate: "milestone-dod", ok: false, detail: "counter mismatch" }];
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.ok(result.reason.startsWith("milestone-gate-failed"));
});

test("stale generation identity fails closed before any verdict/gate is even consulted", () => {
  const input = goodInput(["T-0"]);
  input.bundleAudit = { ...input.bundleAudit, generationId: "gen-STALE" };
  const result = reconcile(input);
  assert.equal(result.ok, false);
  assert.ok(result.reason.startsWith("generation-identity-mismatch"));
});

test("milestone-scoped gates run exactly ONCE for the whole bundle — not per task", () => {
  const taskIds = ["T-0", "T-1", "T-2", "T-3", "T-4"];
  const input = goodInput(taskIds);
  // Only ONE milestone gate entry regardless of width — reconcile must not require N entries.
  assert.equal(input.milestoneGates.length, 1);
  const result = reconcile(input);
  assert.equal(result.ok, true);
});
