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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, classifyFfPerpetrator, classifyNonLandingCause, computeFfStarvationRelief, dispatchableBody, fs, makeWorkspace, path, readSuiteRed, writeFfRetries, writeRounds, writeState, writeTask } from "./helpers/slot-refill-harness.mjs";

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


test("ARBITRATION — k=2 narrows to 2 and still recommends up to the narrowed cap (AC2/AC4 throttle-not-stop)", (t) => {
  const root = makeWorkspace("ff-starve-k2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-live", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/live.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });
  writeFfRetries(root, [{ taskId: "gap-live", attempt: 2, developHead: "abc", ts: "2026-08-26T00:00:00Z", epoch: 100, runId: "r1" }]);
  const liveBody = dispatchableBody(["- code/live.ts (new)"]);
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, inFlight: [{ id: "gap-live", body: liveBody }] });
  assert.equal(r.effective_cap, 2, "k=2 ⇒ narrowed to 2 (not 1)");
  assert.equal(r.slots_free, 1, "cap 2 − 1 in-flight = 1 free slot");
  assert.deepEqual(r.recommended, ["gap-other"], "still dispatches the non-colliding candidate — throttle, not a stop");
});


test("ARBITRATION — no starved LIVE task ⇒ cap unchanged even with a retry record for a non-live task (AC3 negative control)", (t) => {
  const root = makeWorkspace("ff-nostarve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeFfRetries(root, [{ taskId: "gap-stale", attempt: 8, epoch: 100, runId: "r1" }]);
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, inFlight: [{ id: "gap-a", body: dispatchableBody(["- code/a.ts (new)"]) }] });
  assert.equal(r.effective_cap, 5, "a historical failure for a NON-live task never narrows the cap");
  assert.equal(r.ff_starvation.active, false);
  assert.equal(r.ff_starvation.narrowed_cap, null);
  assert.deepEqual(r.ff_starvation.starved_task_ids, []);
});


test("ARBITRATION — the relief self-restores to baseCap once the live task's retry record disappears (AC8)", (t) => {
  const root = makeWorkspace("ff-restore");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-live", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/live.ts (new)"]) });
  writeFfRetries(root, [{ taskId: "gap-live", attempt: 3, epoch: 100, runId: "r1" }]);
  const liveBody = dispatchableBody(["- code/live.ts (new)"]);
  const opts = { tasksDir: path.join(root, "tasks"), root, inFlight: [{ id: "gap-live", body: liveBody }] };
  assert.equal(analyzeSlotRefill(opts).effective_cap, 1, "starved ⇒ narrowed");
  // the trigger disappears (task landed, retry ledger reset) ⇒ the SAME pure function returns baseCap —
  // no stored state, no separate "un-narrow" action.
  writeFfRetries(root, []);
  assert.equal(analyzeSlotRefill(opts).effective_cap, 5, "trigger gone ⇒ baseCap restored (stateless self-recovery)");
});


test("readSuiteRed — state red ⇒ true; green/running/absent/unparseable ⇒ false (A11 parity)", (t) => {
  const root = makeWorkspace("suitered");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readSuiteRed(root), false, "absent state file ⇒ proceed, not red-blocked");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green" }));
  assert.equal(readSuiteRed(root), false);
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "running" }));
  assert.equal(readSuiteRed(root), false, "running is not red-blocked");
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "red" }));
  assert.equal(readSuiteRed(root), true);
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), "not json");
  assert.equal(readSuiteRed(root), false, "unparseable ⇒ fail-safe proceed");
});


test("ARBITRATION — red window ALONE narrows the cap even with backlog below the old threshold (AC1 regression)", (t) => {
  const root = makeWorkspace("arb-redwindow");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // 3 consecutive red rounds ⇒ window ACTIVE. Backlog 10 is BELOW the retired 50 threshold — the
  // measured defect: under `suite_red && backlog > 50` the cap stayed 5 during a red round at
  // backlog 10. Now the red window ALONE triggers the narrowing.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 240 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/a.ts", line: "x" }] })));
  writeState(root, [{ file: "code/a.ts" }]);
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 10 });
  assert.equal(r.base_cap, 5, "base cap is the fixed 5");
  assert.equal(r.effective_cap, 2, "red window active + backlog 10 < 50 ⇒ narrowed to redBacklogCap (regression: old trigger needed backlog > 50)");
  assert.equal(r.cap, 2, "the consumed cap is the effective (arbitrated) cap");
  assert.equal(r.arbitration.cap_narrowed, true);
  assert.equal(r.arbitration.red_window_active, true);
  assert.equal(r.arbitration.suite_red, true);
  assert.equal(r.arbitration.integration_backlog, 10);
  assert.equal(r.arbitration.red_backlog_cap, 2);
  assert.equal(r.slots_free, 2, "dispatch capped at the narrowed cap");
});


test("ARBITRATION — recommended is capped at the NARROWED cap, not the base cap (AC2/AC3)", (t) => {
  const root = makeWorkspace("arb-cap-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4", "gap-r5"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  }
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 250 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/r1.ts", line: "x" }] })));
  writeState(root, [{ file: "code/r1.ts" }]); // state red
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(r.effective_cap, 2);
  assert.equal(r.slots_free, 2);
  assert.equal(r.recommended.length, 2, "5 dispatchable candidates but the narrowed cap admits only 2 — WIP not added behind the red gate");
});
