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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 19/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, dispatchableBody, fs, inFlightTask, judgeEndInvariant, makeWorkspace, parseTouches, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("MEASURED — subagentsInFlight occupies a slot in the pure function (occupied_slots/slots_free)", (t) => {
  const root = makeWorkspace("subagents");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // 1 in-flight + 2 investigation subagents (no task id — count only, never in the disjointness check).
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, subagentsInFlight: 2 });
  assert.equal(r.subagents_in_flight, 2);
  assert.equal(r.occupied_slots, 2, "occupied = 0 in-flight + 2 subagents");
  assert.equal(r.slots_free, 3);
  assert.ok(r.recommended.includes("gap-a"), "subagents don't block the disjointness check (no task id to overlap)");
});

// AC6 / AC115 DUAL-MEASUREMENT NEGATIVE CONTROL (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name,
// 判据5 修法 (a), manager 13:2xZ; AC115 broadened the unmeasured family to include "not-measured"):
// mock measurement_source non-measured ⇒ the measured slot-family fields are null; the SAME call with a
// measured source ⇒ they stay numbers (negative control — the null is keyed to unmeasured, not to
// "empty in-flight").


test("AC6 — unmeasured source nulls in_flight_count/slots_free/subagents_in_flight; measured source keeps numbers (负控制)", (t) => {
  const root = makeWorkspace("ac6-degraded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const base = { tasksDir, root, cap: 5, inFlight: [inFlightTask("gap-a", ["- code/a.ts (new)"])] };

  // 负控制 mock: measurement_error non-empty + degraded source (the 2026-08-14 13:2xZ 现场 shape:
  // spawnSync ETIMEDOUT ⇒ measurement_source='degraded-no-telemetry').
  const degraded = analyzeSlotRefill({ ...base, measurementSource: "degraded-no-telemetry", measurementError: "spawnSync fast-mode-telemetry.ts ETIMEDOUT (load1=18.58)" });
  assert.equal(degraded.measurement_source, "degraded-no-telemetry");
  assert.ok(degraded.measurement_error, "measurement_error is non-empty (the mock)");
  assert.equal(degraded.in_flight_count, null, "degraded → in_flight_count null (never a silent 0)");
  assert.equal(degraded.slots_free, null, "degraded → slots_free null (never a silently-computed '5 empty slots')");
  assert.equal(degraded.subagents_in_flight, null, "degraded → subagents_in_flight null");
  assert.equal(degraded.occupied_slots, null, "degraded → occupied_slots null");
  assert.equal(degraded.running_subagent_count, null, "degraded → running_subagent_count null");
  assert.equal(degraded.should_refill, false, "degraded → fail-closed no-refill");
  assert.ok(degraded.no_refill_reason && /NOT measured/.test(degraded.no_refill_reason),
    "no_refill_reason names the not-measured state, not a fake 'no free slots'");

  // Negative control: the SAME inputs with a HEALTHY source (explicit-input) ⇒ numbers, not null.
  const healthy = analyzeSlotRefill({ ...base, measurementSource: "explicit-input" });
  assert.equal(healthy.in_flight_count, 1, "healthy → in_flight_count stays a number");
  assert.equal(healthy.slots_free, 4, "healthy → slots_free stays a number");
  assert.equal(healthy.occupied_slots, 1, "healthy → occupied_slots stays a number");
  assert.equal(healthy.subagents_in_flight, 0, "healthy → subagents_in_flight stays a number");
});

// ── IN-FLIGHT WORKTREE DIRECT QUANTITY (gap-scheduler-inflight-detection-misses-fan-in-worktree) ────
// AC2: in an overlap scenario (in-flight fan-in worktree A touches X + hold candidate B touches X), the
// worktree A is INVISIBLE to the snapshot in-flight set (its subagent is a workflow, not a standalone
// Agent) — so without the direct quantity, B is recommended and no_refill_reason stays null, and the
// AC53 gate falsely refuses the round end. With the worktree supplement, B must be deferred (reason
// touches-overlap-in-flight) ⇒ recommended empty ⇒ should_refill=false ⇒ no_refill_reason non-empty ⇒
// the gate ACCEPTS (judgeEndInvariant.violated === false).


test("IN-FLIGHT WORKTREE (AC2) — a hold candidate overlapping a fan-in worktree is deferred ⇒ no_refill_reason non-empty and the AC53 gate accepts", (t) => {
  const root = makeWorkspace("inflight-worktree");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // In-flight fan-in worktree A declares X (the same file the hold candidate B will declare).
  const faninTouches = parseTouches(dispatchableBody(["- code/shared.ts (new)"]));
  // Hold candidate B — the ONLY ready task — declares the SAME X (and, via C8, its own self-file).
  writeTask(root, "gap-hold", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });

  // The snapshot in-flight set is EMPTY (the fan-in worktree is invisible to it — its subagent is a
  // workflow). Only the injected direct-quantity worktree entry carries it.
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight: [],
    inFlightWorktrees: [{ id: "gap-fanin", touches: faninTouches }],
  });

  assert.equal(r.should_refill, false, "the only candidate overlaps the fan-in worktree ⇒ not dispatchable");
  assert.equal(r.recommended.length, 0, "recommended must be empty (B is deferred)");
  assert.ok(r.no_refill_reason, `no_refill_reason must be non-empty, got ${JSON.stringify(r.no_refill_reason)}`);
  const deferredB = (r.deferred || []).filter((d) => d.id === "gap-hold");
  assert.equal(deferredB.length, 1, "the hold candidate is deferred");
  assert.match(deferredB[0].reason, /touches-overlap-in-flight/, "deferred with the in-flight overlap reason");

  // The AC53 gate accepts: judgeEndInvariant on the machine's fresh output must NOT be violated.
  const inv = judgeEndInvariant(r);
  assert.equal(inv.violated, false, "the AC53 gate must accept (no false refusal)");
});


test("IN-FLIGHT WORKTREE (AC2) — negative control: a disjoint candidate is still recommended despite the fan-in worktree", (t) => {
  const root = makeWorkspace("inflight-worktree-disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const faninTouches = parseTouches(dispatchableBody(["- code/shared.ts (new)"]));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight: [],
    inFlightWorktrees: [{ id: "gap-fanin", touches: faninTouches }],
  });

  assert.ok(r.recommended.includes("gap-free"), "a disjoint candidate is still recommended (the worktree only blocks its own conflict surface)");
});


test("IN-FLIGHT WORKTREE (AC2) — the default (no injection) reads the live worktree list and is a no-op in a non-git workspace", (t) => {
  const root = makeWorkspace("inflight-worktree-live");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // A non-git temp workspace has no `git worktree list` ⇒ computeInFlightWorktreeTouches returns []
  // (fail-soft) ⇒ behavior is byte-identical to the pre-fix path.
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, inFlight: [] });
  assert.ok(r.recommended.includes("gap-a"), "no worktree in flight ⇒ the candidate is recommended as before");
});

// ── EXITED-NOT-LANDED CONTINUE EXEMPTION (gap-slot-refill-continue-touches-overlap-redundant-
// exemption): an exited-not-landed CONTINUE candidate (residual task/<id> worktree + worker-outcome
// final_state=exited-not-landed) is already worktree-isolated and its landing serialization is
// enforced by the fan-in lock — so the dispatch-level touches-overlap defer is redundant and must be
// SKIPPED (AC1); a fresh candidate (no worktree) keeps the defer (AC2 regression); the exemption must
// NOT mask any other step-4 gate. ──────────────────────────────────────────────────────────────────


test("CONTINUE EXEMPTION (AC1) — an exited-not-landed continue candidate overlapping an in-flight peer is NOT deferred ⇒ enters recommended", (t) => {
  const root = makeWorkspace("continue-exempt");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The continue candidate declares the SAME file as the in-flight peer (a genuine overlap).
  writeTask(root, "gap-cont", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  const inFlight = [inFlightTask("gap-other", ["- code/shared.ts (new)"])];

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight,
    continueExemptIds: ["gap-cont"],
  });

  assert.ok(r.recommended.includes("gap-cont"), "the continue candidate is recommended (exempt from touches-overlap defer)");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-cont");
  assert.equal(deferred.length, 0, `gap-cont must NOT be deferred, got: ${JSON.stringify(deferred)}`);
});
