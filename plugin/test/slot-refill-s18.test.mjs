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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 18/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, dispatchableBody, fs, hasLandedImplementation, makeWorkspace, path, runSlotRefillJson, writeTask } from "./helpers/slot-refill-harness.mjs";

test("CLIQUE-LANDED — AC4: two NON-landed tasks touching the same file remain mutually exclusive (the change never relaxes real-overlap serialization)", (t) => {
  const root = makeWorkspace("clique-ac4");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Neither task is landed (makeWorkspace is a non-git temp dir ⇒ hasLandedImplementation fails safe to
  // false) and BOTH touch the same file — the batch clique must still serialize them (AC4).
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const hasA = r.recommended.includes("gap-a");
  const hasB = r.recommended.includes("gap-b");
  assert.ok(!(hasA && hasB), "AC4: two non-landed tasks touching the same file are never both recommended");
  assert.equal(r.recommended.length, 1, "AC4: exactly one of the colliding non-landed pair is recommended");
});

// ── C8 SELF-TOUCH / BACKFILL (tasks/gap-slot-refill-c8-reject-no-backfill) ──────────────────────────
// slot-refill's candidate loop used to apply only its OWN step-4 checks (touches-resolve / deps /
// concurrency / nyf) and NOT the inner dispatch side's C8 self-touch gate. It therefore recommended
// candidates that the inner rejected one-by-one at dispatch (C8: `## Touches` must contain
// `tasks/<id>.md` without `(new)`), with NO backfill from later-in-sort candidates — the measured
// "17 本可派 + 本 tick 无可派" deadlock (22 ready, 5 missing self-touch). AC2: the candidate loop now
// rejects C8-MISSING candidates and BACKFILLS from later-in-sort candidates until cap filled or
// candidates exhausted. AC4: all candidates rejected ⇒如实无可派 (no fabrication). The injected
// `dispatchGate` callback gives the inner a per-candidate gate extension point with the same backfill.


test("C8 BACKFILL — the first 3 id-sorted candidates lack self-touch; the 4th+ have it ⇒ recommended backfills the 4th+ (AC2, c8_rejected_candidate_backfilled)", (t) => {
  const root = makeWorkspace("c8-backfill");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // id-sorted order: c8-a, c8-b, c8-c rank FIRST but are C8-MISSING (selfTouch: false) — the inner
  // would reject each at dispatch. c8-d, c8-e rank LATER and ARE C8-clean — they must backfill.
  writeTask(root, "gap-c8-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-d", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/d.ts (new)"]) });
  writeTask(root, "gap-c8-e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 5, "all 5 are ready and in the pool");
  assert.equal(r.should_refill, true);
  assert.ok(r.recommended.includes("gap-c8-d"), "4th candidate (C8-clean) BACKFILLS into recommended");
  assert.ok(r.recommended.includes("gap-c8-e"), "5th candidate (C8-clean) BACKFILLS into recommended");
  for (const id of ["gap-c8-a", "gap-c8-b", "gap-c8-c"]) {
    assert.ok(!r.recommended.includes(id), `C8-MISSING candidate ${id} is NOT recommended (rejected ⇒ later candidate backfills)`);
  }
});


test("C8 ALL-REJECTED — every candidate lacks self-touch ⇒ recommended empty, should_refill=false, no fabricated dispatch (AC4, all_rejected_no_fake)", (t) => {
  const root = makeWorkspace("c8-all-rejected");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-c8-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/x.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]), selfTouch: false });
  writeTask(root, "gap-c8-z", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/z.ts (new)"]), selfTouch: false });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 3, "3 ready candidates in the pool");
  assert.equal(r.slots_free, 5, "slots exist");
  assert.equal(r.recommended.length, 0, "all C8-MISSING ⇒ nothing recommended — 如实无可派 (no fabrication from backfill)");
  assert.equal(r.should_refill, false, "recommended empty ⇒ should_refill=false");
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
});


test("C8 BACKFILL — injected dispatchGate rejects a mid-rank candidate ⇒ later candidate backfills (AC2, dispatch-gate callback)", (t) => {
  const root = makeWorkspace("c8-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // id-sorted: gate-a, gate-b, gate-c — all C8-clean. The INJECTED gate rejects gate-b (mid-ranked);
  // the loop must skip it and BACKFILL gate-c into recommended (never recommend gate-b).
  writeTask(root, "gap-gate-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ga.ts (new)"]) });
  writeTask(root, "gap-gate-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/gb.ts (new)"]) });
  writeTask(root, "gap-gate-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/gc.ts (new)"]) });
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    dispatchGate: ({ id }) => (id === "gap-gate-b" ? { ok: false, reason: "test gate rejects gap-gate-b" } : { ok: true }),
  });
  assert.ok(r.recommended.includes("gap-gate-a"), "unrejected candidate still recommended");
  assert.ok(r.recommended.includes("gap-gate-c"), "later candidate BACKFILLS the rejected slot");
  assert.ok(!r.recommended.includes("gap-gate-b"), "gate-rejected candidate is not recommended (no fabrication)");
});

// ── DIRECT IN-FLIGHT COUNT (AC115, SPEC-worker-driven-inner-2026-08-16 §5 阶段 1) ────────────────────
// The telemetry-bracket "在飞" measurement (parseImplementingReport / measureImplementingFromTelemetry)
// and the --in-flight/--closed-but-live/--running CLI parameter passing are RETIRED. In-flight is now
// the worker driver's DIRECT child-process count, passed as --in-flight-count <n>. A bare CLI invocation
// (no --in-flight-count) reports measurement_source="not-measured" and NULLS the slot family (fail-closed,
// never a silent 0). The pure analyzeSlotRefill still accepts the inFlight/closedButLive/subagentsInFlight
// arrays for the touches-disjointness + slot arithmetic (the AC53 gate's library consumer path).


/** Run the slot-refill CLI with `--root` + `--cap 5` + extra args, parse the JSON. */


test("AC115 — bare CLI (no --in-flight-count) is NOT a silent 0: measurement_source=not-measured + slot family NULL (fail-closed)", (t) => {
  const root = makeWorkspace("not-meas");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });

  const r = runSlotRefillJson(root);
  assert.equal(r.measurement_source, "not-measured", "bare CLI no longer measures in-flight from telemetry brackets");
  assert.equal(r.in_flight_count, null, "not-measured ⇒ in_flight_count null (never a silent 0)");
  assert.equal(r.slots_free, null, "not-measured ⇒ slots_free null (never a silently-computed '5 empty slots')");
  assert.equal(r.occupied_slots, null, "not-measured ⇒ occupied_slots null");
  assert.equal(r.should_refill, false, "not-measured ⇒ fail-closed: no refill");
  assert.ok(r.no_refill_reason && /NOT measured/.test(r.no_refill_reason), "no_refill_reason names the not-measured state");
});


test("AC115 — --in-flight-count is the driver's DIRECT child count (driver-count provenance), byte-consistent arithmetic", (t) => {
  const root = makeWorkspace("driver-count");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-in", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/in.ts (new)"]) });
  writeTask(root, "gap-out", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/out.ts (new)"]) });

  const r = runSlotRefillJson(root, ["--in-flight-count", "1"]);
  assert.equal(r.measurement_source, "driver-count", "the in-flight count is the driver's direct child count");
  assert.equal(r.in_flight_count, 0, "the wide Consumer-A set is empty in the CLI (the driver does disjointness in memory)");
  assert.equal(r.running_subagent_count, 1, "Consumer B = the direct child count 1");
  assert.equal(r.occupied_slots, 1);
  assert.equal(r.slots_free, 4, "5 − 1 worker = 4 free slots");
});
