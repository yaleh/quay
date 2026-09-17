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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, dispatchableBody, fs, inFlightTask, makeWorkspace, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("closedButLive absent ⇒ byte-compatible forward-only slot arithmetic", (t) => {
  const root = makeWorkspace("cbl-absent");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const inFlight = [inFlightTask("gap-run", ["- code/run.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2, inFlight });
  assert.equal(r.closed_but_live_count, 0);
  assert.equal(r.occupied_slots, 1);
  assert.equal(r.slots_free, 1);
  assert.equal(r.should_refill, true);
});


test("a candidate colliding with a closedButLive agent's touches is not recommended (concurrency eligibility)", (t) => {
  const root = makeWorkspace("cbl-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ghost.ts (new)"]) });
  const closedButLive = [inFlightTask("gap-ghost", ["- code/ghost.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2, closedButLive });
  assert.equal(r.slots_free, 1, "cap 2 − 1 closed-but-live = 1");
  assert.ok(r.recommended.includes("gap-free"), "disjoint-from-closed-but-live candidate recommended");
  assert.ok(!r.recommended.includes("gap-blocked"), "candidate colliding with a closed-but-live agent's touches is NOT recommended");
});

// (AC115 retirement: the `--closed-but-live` CLI flag is retired — the pure-function closedButLive
// tests above remain the single source for the closed-but-live slot arithmetic.)

// ── AC4: negative control — no dispatchable candidate ⇒ no refill ──────────────────────────────────


test("empty ready pool ⇒ should_refill=false with a named reason (AC4)", (t) => {
  const root = makeWorkspace("neg-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 0);
  assert.equal(r.slots_free, 3);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
  assert.deepEqual(r.recommended, []);
});


test("only a majority-missing-touches candidate ⇒ should_refill=false (step-4 touches-resolve applied)", (t) => {
  const root = makeWorkspace("neg-missing");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Touches point at ABSENT files WITHOUT the (new) tag → majority-missing → not dispatchable.
  writeTask(root, "gap-missing", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "the candidate is in the ready pool…");
  assert.equal(r.should_refill, false, "…but fails the step-4 touches-resolve check ⇒ no refill");
  assert.deepEqual(r.recommended, []);
});


test("ready candidate whose parent is not done ⇒ not recommended (deps-ready filter)", (t) => {
  const root = makeWorkspace("neg-deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-orphan", { status: "todo", labels: ["gap"], body: dispatchableBody(["- code/orphan.ts (new)"]) });
  writeTask(root, "gap-child", {
    status: "ready",
    labels: ["gap"],
    parent: "gap-ghost-parent", // parent file missing ⇒ fail-closed, deps not ready
    body: dispatchableBody(["- code/child.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "gap-child is ready and in the pool");
  assert.deepEqual(r.recommended, [], "undone-parent ready candidate is not dispatchable");
  assert.equal(r.should_refill, false);
});

// ── COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2 + invariants) ────────────
// (1) compound_parent_not_dispatchable: a `role: compound` parent is an AGGREGATE (done ⇔ all children
//     done) — never leaf work — so it must NEVER be recommended and must be deferred with the explicit
//     reason `compound-not-dispatchable`, NOT `self-touch-missing-c8` (its Touches delegate to children
//     by convention — no_self_touch_false_negative).
// (2) a READY child of a compound parent is deps-ready (the compound-parent edge is skipped) ⇒ it IS
//     recommended — the deadlock direction broken on the dispatch path too.


test("COMPOUND: a ready compound parent is never recommended; deferred compound-not-dispatchable, not self-touch-missing", (t) => {
  const root = makeWorkspace("compound-norec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Ready compound parent with NO self-file (its Touches delegate to children by convention).
  writeTask(root, "gap-compound", {
    status: "ready", labels: ["gap"], role: "compound", selfTouch: false,
    body: dispatchableBody(["- code/comp.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 1, "compound parent is ready and in the pool");
  assert.deepEqual(r.recommended, [], "compound parent must NEVER be recommended (aggregate, not leaf work)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-compound").map((d) => d.reason);
  assert.ok(reasons.includes("compound-not-dispatchable"), "compound deferred with the explicit compound reason");
  assert.ok(!reasons.includes("self-touch-missing-c8"), "compound must NOT be deferred as self-touch-missing (no false negative)");
  assert.equal(r.should_refill, false);
});


test("COMPOUND: a READY child of a compound parent is recommended (compound-parent edge skipped)", (t) => {
  const root = makeWorkspace("compound-child");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Compound parent (ready, not done) + a READY child naming it. Pre-fix the child would be deferred
  // deps-not-ready (parent not done) — the deadlock. Post-fix the compound-parent edge is skipped.
  writeTask(root, "gap-compound", {
    status: "ready", labels: ["gap"], role: "compound", selfTouch: false,
    body: dispatchableBody(["- code/comp.ts (new)"]),
  });
  writeTask(root, "gap-compound-child", {
    status: "ready", labels: ["gap"], parent: "gap-compound", selfTouch: true,
    body: dispatchableBody(["- code/child.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 2, "both compound parent and child are ready and in the pool");
  assert.ok(r.recommended.includes("gap-compound-child"), "a child of a compound parent IS deps-ready and recommended (deadlock broken)");
  assert.ok(!r.recommended.includes("gap-compound"), "the compound parent itself is still not recommended");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-compound").map((d) => d.reason);
  assert.ok(reasons.includes("compound-not-dispatchable"), "compound parent deferred with the explicit compound reason");
});

// ── DEPENDS_ON DEPENDENCY GATE (tasks/gap-slot-refill-depsreadyfor-ignores-depends-on) ──────────────
// slot-refill's depsReadyFor previously read ONLY task.parent and never depends_on — so a depends_on
// edge (the machine-readable prerequisite home, gap-prerequisite-gates-prose-invisible-to-mechanisms)
// was a DEAD field for worker dispatch: ready-pool-check deferred such a task but slot-refill
// dispatched it anyway (the "以为闸上了、其实没有" hazard). These tests pin the fix: depsReadyFor reads
// parent AND depends_on (mirroring ready-pool-check's depsReadyFor), and a depends_on predecessor that
// has not landed ⇒ deps-not-ready.


test("DEPENDS_ON (AC1) — a ready task whose depends_on predecessor is not done is deferred deps-not-ready, not recommended", (t) => {
  const root = makeWorkspace("depends-on-defer");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Upstream predecessor: ready (NOT done) — the thing the child must wait on.
  writeTask(root, "gap-upstream", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/upstream.ts (new)"]) });
  // Child carries a depends_on edge to the not-done upstream.
  writeTask(root, "gap-child", {
    status: "ready", labels: ["gap"], dependsOn: ["gap-upstream"],
    body: dispatchableBody(["- code/child.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.pool, 2, "both upstream and child are ready and in the pool");
  assert.ok(r.recommended.includes("gap-upstream"), "the upstream (no deps) IS recommended");
  assert.ok(!r.recommended.includes("gap-child"), "the child with an unlanded depends_on is NOT recommended");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-child").map((d) => d.reason);
  assert.ok(reasons.includes("deps-not-ready"), "the depends_on-gated child is deferred deps-not-ready");
});


test("DEPENDS_ON (AC2) — negative control: the same task WITHOUT depends_on is recommended, and a DONE depends_on does not block", (t) => {
  const root = makeWorkspace("depends-on-control");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // (a) WITHOUT the depends_on edge ⇒ recommended (the defer above is the edge, not another cause).
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  // (b) depends_on → DONE predecessor ⇒ deps-ready ⇒ recommended (a satisfied edge does not block).
  writeTask(root, "gap-done-upstream", { status: "done", labels: ["gap"], body: dispatchableBody(["- code/done-upstream.ts (new)"]) });
  writeTask(root, "gap-satisfied", {
    status: "ready", labels: ["gap"], dependsOn: ["gap-done-upstream"],
    body: dispatchableBody(["- code/satisfied.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-free"), "no depends_on ⇒ recommended (negative control: the defer is the edge)");
  assert.ok(r.recommended.includes("gap-satisfied"), "depends_on → done predecessor ⇒ deps-ready ⇒ recommended");
  assert.ok(!(r.deferred || []).some((d) => d.id === "gap-satisfied"), "a satisfied depends_on must NOT be deferred");
});

// ── AC3: recommended is production-disjoint (no two colliding candidates) ───────────────────────────


test("recommended never contains two colliding candidates (assembleBatch disjointness)", (t) => {
  const root = makeWorkspace("disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-shared-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-shared-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.slots_free, 3);
  assert.equal(r.recommended.length, 2, "one of the colliding pair + gap-other");
  // The two colliding tasks must never BOTH be recommended.
  const hasA = r.recommended.includes("gap-shared-a");
  const hasB = r.recommended.includes("gap-shared-b");
  assert.ok(!(hasA && hasB), "colliding candidates must not be recommended together");
  assert.ok(r.recommended.includes("gap-other"));
});
