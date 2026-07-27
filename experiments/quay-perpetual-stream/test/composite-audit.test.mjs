// composite-audit.test.mjs — sibling test for composite-audit.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReadOnlyAuditShard, combineShardVerdicts, selftest } from "../scripts/composite-audit.ts";

test("composite-audit.ts embedded selftest() suite passes (includes the negative-control read-only checks)", () => {
  assert.equal(selftest(), true);
});

const makeState = () => ({
  tasks: { "T-0": { status: "ready", checkboxes: { "ac-0": false } } },
  absorbDispositions: {},
  dashboardEntries: [],
  milestoneCounter: 41,
});

test("a well-behaved shard reads state and returns a result — no violation", () => {
  const state = makeState();
  const outcome = runReadOnlyAuditShard(state, (view) => (view.tasks["T-0"].status === "ready" ? "PASS" : "REFUTED"));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result, "PASS");
});

test("NEGATIVE CONTROL: a shard attempting to flip task status is blocked and real state is untouched", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.tasks["T-0"].status = "done";
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before, "the real state object must be byte-identical after a hostile mutation attempt");
});

test("NEGATIVE CONTROL: a shard attempting to write an absorb disposition is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.absorbDispositions["T-0"] = "forged";
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("NEGATIVE CONTROL: a shard attempting to push a dashboard entry is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.dashboardEntries.push("forged entry");
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("NEGATIVE CONTROL: a shard attempting to bump the milestone counter is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.milestoneCounter = 999;
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("the shard function receives an isolated clone, never a reference to the real state object", () => {
  const state = makeState();
  let captured = null;
  runReadOnlyAuditShard(state, (view) => {
    captured = view;
    return null;
  });
  assert.notEqual(captured, state);
});

test("combineShardVerdicts: any REFUTED verdict anywhere makes the bundle REFUTED", () => {
  const shardResults = [
    { shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }] },
    { shardId: "s1", shardVerdict: "REFUTED", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap" }] },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-1");
  assert.equal(bundle.bundleVerdict, "REFUTED");
});

test("combineShardVerdicts: all-PASS shards produce a PASS bundle", () => {
  const shardResults = [
    { shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }] },
    { shardId: "s1", shardVerdict: "PASS", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }] },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-2");
  assert.equal(bundle.bundleVerdict, "PASS");
});

test("one audit shard may cover several homogeneous tasks with distinct per-task verdicts", () => {
  const shardResults = [
    {
      shardId: "s-homogeneous",
      shardVerdict: "PASS",
      verdicts: [
        { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
        { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" },
        { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
      ],
    },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-3");
  assert.equal(bundle.shardResults[0].verdicts.length, 3);
});
