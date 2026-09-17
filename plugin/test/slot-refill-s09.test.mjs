// @test-group engine
// slot-refill.test.mjs — the event-driven dispatch ("slot-refill") decision helper
// (tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release). Dispatch was
// evaluated ONLY at the inner loop's tick boundary; a completed subagent's freed slot was not
// backfilled until the next tick (measured 39/30/18/33/50-min gaps with a healthy pool). This test
// pins the PRODUCT mechanism for the event-driven path: computing "is a slot free + is there a
// dispatchable candidate" at a COMPLETION event.
//
// AC1 slots_free = max(0, cap − in_flight) — the caller passes the running set explicitly (AC6:
//   telemetry brackets ≠ subagents, never read from telemetry) · AC2 should_refill is the
//   event-driven go/no-go, based on the recommended set (step-4 checks applied) · AC3 recommended is
//   capped at slots_free and production-disjoint (assembleBatch) · AC4 negative control: no
//   dispatchable candidate ⇒ should_refill=false; the helper never writes/dispatches (pure) ·
//   AC5 cap semantics: in-flight ≥ cap ⇒ should_refill=false; cap is an input, never hardcoded ·
//   AC7 idempotent: same inputs ⇒ identical output · AC8 node:test + @test-group lowconc
// B9 FORCE-DISPATCH (tasks/gap-outer-tick-core-b9-coverage-blind-spot): the outer tick-core B9 branch
//   consumes should_refill + recommended as the two independently-readable preconditions of
//   "空槽强制派发" — should_refill=true AND recommended non-empty ⇒ the tick MUST dispatch 1-2, even when
//   the dispatch QUEUE is non-empty (the old "queue empty ⇒ refill" trigger was the blind spot). The
//   tests below pin the PROBE side: the exact blind-spot shape (non-empty queue + in_flight=0 + a
//   dispatchable recommendation) must be reported as should_refill=true with a non-empty `recommended`
//   the tick can take 1-2 from; a non-empty queue whose candidates ALL fail step-4 ⇒ recommended empty
//   ⇒ should_refill=false (无此场景不误报).
//
// Run: scripts/test.sh plugin/test/slot-refill.test.mjs

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, classifyFfPerpetrator, classifyNonLandingCause, computeFfFailureCounts, computeFfStarvationRelief, computeUnresolvedEscalationTaskIds, dispatchableBody, fs, makeWorkspace, path, writeFfRetries, writeTask } from "./helpers/slot-refill-harness.mjs";

test("computeUnresolvedEscalationTaskIds — an ff-escalation without a newer resolution = starved k≥3", () => {
  const recs = [
    { taskId: "gap-a", event: "ff-escalation", epoch: 100 },
    { taskId: "gap-b", event: "ff-escalation", epoch: 100 },
    { taskId: "gap-b", event: "ff-escalation-resolved", epoch: 200 },
  ];
  const ids = computeUnresolvedEscalationTaskIds(recs);
  assert.ok(ids.has("gap-a"), "unresolved escalation ⇒ still starved");
  assert.ok(!ids.has("gap-b"), "a newer resolution clears the escalation");
});


test("computeFfStarvationRelief — k=1 no relief, k=2 narrows to 2, k≥3 narrows to 1 (AC1/AC2)", () => {
  const live = ["gap-a"];
  const k1 = computeFfFailureCounts([{ taskId: "gap-a", attempt: 1, epoch: 100 }], live);
  const r1 = computeFfStarvationRelief({ ffCounts: k1 });
  assert.equal(r1.active, false);
  assert.equal(r1.tier, 1);
  assert.equal(r1.narrowedCap, null);
  assert.deepEqual(r1.starvedTaskIds, []);

  const k2 = computeFfFailureCounts([{ taskId: "gap-a", attempt: 2, epoch: 100 }], live);
  const r2 = computeFfStarvationRelief({ ffCounts: k2 });
  assert.equal(r2.active, true);
  assert.equal(r2.tier, 2);
  assert.equal(r2.narrowedCap, 2);

  const k3 = computeFfFailureCounts([{ taskId: "gap-a", attempt: 3, epoch: 100 }], live);
  const r3 = computeFfStarvationRelief({ ffCounts: k3 });
  assert.equal(r3.active, true);
  assert.equal(r3.tier, 3);
  assert.equal(r3.narrowedCap, 1);
  assert.deepEqual(r3.starvedTaskIds, ["gap-a"]);
});


test("computeFfStarvationRelief — an unresolved escalation forces k≥3 even with no retry record", () => {
  const r = computeFfStarvationRelief({ ffCounts: new Map(), unresolvedEscalationIds: new Set(["gap-a"]) });
  assert.equal(r.active, true);
  assert.equal(r.tier, 3);
  assert.equal(r.narrowedCap, 1);
  assert.deepEqual(r.starvedTaskIds, ["gap-a"]);
});


test("classifyFfPerpetrator — layer-commit (delayable) vs task-landing (not delayable) vs mixed (AC7)", () => {
  assert.equal(classifyFfPerpetrator([]), "unknown");
  assert.equal(classifyFfPerpetrator(["tasks: 立案 gap-x"]), "layer-commit");
  assert.equal(classifyFfPerpetrator(["orchestration: tick 记录"]), "layer-commit");
  assert.equal(classifyFfPerpetrator(["fan-in: task/gap-x"]), "task-landing");
  assert.equal(classifyFfPerpetrator(["merge task/gap-x: fan-in"]), "task-landing");
  assert.equal(classifyFfPerpetrator(["tasks: 立案 gap-x", "fan-in: task/gap-y"]), "mixed");
});


test("classifyNonLandingCause — ff-race / suite-red / worker-round-end distinguishable (AC5)", () => {
  assert.equal(classifyNonLandingCause({ hasRetryRecord: true, suiteRed: true, workerFinalState: "timed-out" }), "ff-race", "a retry record is the ff-race-specific carrier");
  assert.equal(classifyNonLandingCause({ suiteRed: true }), "suite-red");
  assert.equal(classifyNonLandingCause({ workerFinalState: "failed" }), "worker-round-end");
  assert.equal(classifyNonLandingCause({}), "unknown", "no positive carrier ⇒ unknown, never a same-shaped guess");
});


test("ARBITRATION — a live task at k≥3 narrows the cap to 1 (AC1/AC3/AC4)", (t) => {
  const root = makeWorkspace("ff-starve-live");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-live", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/live.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });
  writeFfRetries(root, [{ taskId: "gap-live", attempt: 3, developHead: "abc", ts: "2026-08-26T00:00:00Z", epoch: 100, runId: "r1", agentId: "a1", mergeTarget: "develop", error: "not a fast-forward" }]);
  const liveBody = dispatchableBody(["- code/live.ts (new)"]);
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, inFlight: [{ id: "gap-live", body: liveBody }] });
  assert.equal(r.base_cap, 5);
  assert.equal(r.effective_cap, 1, "live task k=3 ⇒ narrowed to 1");
  assert.equal(r.ff_starvation.active, true);
  assert.equal(r.ff_starvation.tier, 3);
  assert.equal(r.ff_starvation.narrowed_cap, 1);
  assert.deepEqual(r.ff_starvation.starved_task_ids, ["gap-live"]);
  assert.equal(r.ff_starvation.cause, "ff-race");
  assert.equal(r.slots_free, 0, "narrowed cap 1 − 1 in-flight = 0 ⇒ no NEW competitor (deterministic landing window)");
});
