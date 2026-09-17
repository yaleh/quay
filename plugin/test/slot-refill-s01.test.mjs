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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, assert, computeSlotsFree, dispatchableBody, execFileSync, fs, inFlightTask, makeWorkspace, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("computeSlotsFree = max(0, cap − in_flight), never negative (AC1)", () => {
  assert.equal(computeSlotsFree(3, 0), 3);
  assert.equal(computeSlotsFree(3, 1), 2);
  assert.equal(computeSlotsFree(3, 2), 1);
  assert.equal(computeSlotsFree(3, 3), 0);
  assert.equal(computeSlotsFree(3, 5), 0, "never negative under overload");
  assert.equal(computeSlotsFree(1, 0), 1);
});

// ── FIXED-CAP RETIREMENT (gap-fixed-cap-5-dynamic-cap-retired AC3) ─────────────────────────────────
// The dynamic cap is retired (human ruling 2026-08-09): `--cap` NOT passed ⇒ the default is the fixed
// constant 5, so slot-refill and its derived floor (5 × floor_mult = 20) are stable regardless of
// load/suite state. This is the Contract's `slot_refill_default_5` invariant.

test("FIXED-CAP — --cap not passed ⇒ default 5, floor = 5 × 4 = 20 (AC3, slot_refill_default_5)", (t) => {
  const root = makeWorkspace("fixed-cap");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });

  // analyzeSlotRefill without a cap: default resolves to 5.
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.cap, 5, "default cap is the fixed 5");
  assert.equal(r.floor_mult, 4, "floor_mult default is 4");
  assert.equal(r.floor, 20, "floor = 5 × 4 = 20 (the Contract's floor=20)");
  assert.equal(r.slots_free, 5, "0 in-flight ⇒ 5 free slots at the fixed cap");

  // CLI without --cap: JSON carries cap=5 and floor=20. AC115: the in-flight count is now the driver's
  // DIRECT child-process count — pass --in-flight-count 0 (a measured zero) so slots_free=5 is exact
  // without any ambient telemetry/process scan.
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--in-flight-count", "0"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.cap, 5, "CLI --cap default is 5");
  assert.equal(parsed.floor, 20, "CLI floor = 20");
  assert.equal(parsed.slots_free, 5);
});


test("FIXED-CAP — an explicit --cap still overrides the fixed default (manual/test runs)", (t) => {
  const root = makeWorkspace("cap-override");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r3 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r3.cap, 3, "explicit cap wins");
  assert.equal(r3.slots_free, 3);
});

// ── AC2/AC3: positive — free slot + dispatchable candidate ⇒ should_refill, capped recommended ──────


test("should_refill=true with a free slot and a dispatchable candidate (AC2/AC3)", (t) => {
  const root = makeWorkspace("pos");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.equal(r.slots_free, 3);
  assert.equal(r.pool, 2);
  assert.equal(r.should_refill, true);
  assert.equal(r.no_refill_reason, null);
  assert.equal(r.recommended.length, 2, "both disjoint candidates recommended (capped at slots_free=3)");
  assert.ok(r.recommended.includes("gap-a"));
  assert.ok(r.recommended.includes("gap-b"));
});

// ── B9 空槽强制派发 (tasks/gap-outer-tick-core-b9-coverage-blind-spot) ──────────────────────────────
// The outer tick-core B9 branch: should_refill=true AND recommended non-empty ⇒ the tick MUST
// force-dispatch 1-2 from recommended (queue-empty is no longer the only trigger — the 2026-08-10
// 05:00–06:44 blind spot was a NON-empty queue with in_flight=0 and should_refill=true yet zero
// dispatch). These tests pin the PROBE side of that force-dispatch chain.


test("B9 FORCE-DISPATCH — non-empty queue + in_flight=0 + recommended non-empty ⇒ should_refill=true, recommended carries 1-2+ dispatchable ids (AC2)", (t) => {
  const root = makeWorkspace("b9-force");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A NON-EMPTY ready queue (3 disjoint dispatchable candidates) — the old B9 "queue empty ⇒ refill"
  // trigger would NOT fire here, which is exactly the blind spot being closed.
  writeTask(root, "gap-b9-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9a.ts (new)"]) });
  writeTask(root, "gap-b9-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9b.ts (new)"]) });
  writeTask(root, "gap-b9-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b9c.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 3, "the queue is NON-empty (3 ready candidates)");
  assert.equal(r.in_flight_count, 0, "in_flight=0 — the queue is non-empty but nothing is running");
  assert.equal(r.slots_free, 5, "empty slots exist");
  assert.equal(r.should_refill, true, "should_refill=true — the blind-spot scenario the old B9 missed");
  assert.equal(r.no_refill_reason, null);
  assert.ok(r.recommended.length >= 1, "recommended is non-empty — the tick can take 1-2 from it");
  assert.ok(r.recommended.includes("gap-b9-a") && r.recommended.includes("gap-b9-b") && r.recommended.includes("gap-b9-c"),
    "all disjoint candidates are recommended (force-dispatch has 1-2+ to pick)");
});


test("B9 FORCE-DISPATCH — negative control: non-empty queue but recommended empty (no step-4 candidate) ⇒ should_refill=false, no false dispatch (control: 无此场景不误报)", (t) => {
  const root = makeWorkspace("b9-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Queue is non-empty, but the ONLY candidate fails the step-4 touches-resolve check (absent files
  // WITHOUT (new)) ⇒ recommended is empty ⇒ the force-dispatch branch must NOT fire.
  writeTask(root, "gap-b9-missing", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 1, "the queue is non-empty (1 candidate)");
  assert.equal(r.slots_free, 5, "slots exist");
  assert.equal(r.recommended.length, 0, "but no dispatchable recommendation passes step-4");
  assert.equal(r.should_refill, false, "recommended empty ⇒ should_refill=false ⇒ no force dispatch (无此场景不误报)");
  assert.match(r.no_refill_reason, /no dispatchable candidate/);
});


test("recommended is capped at slots_free (AC3)", (t) => {
  const root = makeWorkspace("cap-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3", "gap-r4"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  }
  // Only 1 slot free (cap 3, 2 in-flight).
  const inFlight = [inFlightTask("gap-in1", ["- code/in1.ts (new)"]), inFlightTask("gap-in2", ["- code/in2.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 1);
  assert.equal(r.recommended.length, 1, "recommended never exceeds slots_free");
});

// ── AC5: the cap bound — in-flight ≥ cap ⇒ no refill ───────────────────────────────────────────────


test("in-flight ≥ cap ⇒ should_refill=false, no_refill_reason names the bound (AC5)", (t) => {
  const root = makeWorkspace("cap-bound");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const inFlight = [
    inFlightTask("gap-f1", ["- code/f1.ts (new)"]),
    inFlightTask("gap-f2", ["- code/f2.ts (new)"]),
    inFlightTask("gap-f3", ["- code/f3.ts (new)"]),
  ];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 0);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /no free slots/);
  assert.deepEqual(r.recommended, []);
});


test("cap is an INPUT — a smaller cap reduces free slots (AC5 mechanism/strategy separation)", (t) => {
  const root = makeWorkspace("cap-input");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r1 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  const r2 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 1 });
  assert.equal(r1.slots_free, 3);
  assert.equal(r2.slots_free, 1, "a cap of 1 leaves exactly 1 free slot");
  assert.equal(r1.should_refill, true);
  assert.equal(r2.should_refill, true);
});

// ── REVERSE DIRECTION (gap-closed-bracket-leaves-live-agent-consuming-slots): a CLOSED bracket whose
//    executor is still present occupies a slot — slots_free must not read it as free ─────────────────


test("closedButLive occupies a slot: slots_free reduced, can flip should_refill (AC3 reverse)", (t) => {
  const root = makeWorkspace("cbl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // cap 1; 1 running + 1 closed-but-live ⇒ occupied 2 ⇒ 0 free ⇒ no refill into a busy slot.
  const inFlight = [inFlightTask("gap-run", ["- code/run.ts (new)"])];
  const closedButLive = [inFlightTask("gap-ghost", ["- code/ghost.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 1, inFlight, closedButLive });
  assert.equal(r.in_flight_count, 1);
  assert.equal(r.closed_but_live_count, 1);
  assert.equal(r.occupied_slots, 2);
  assert.equal(r.slots_free, 0);
  assert.equal(r.should_refill, false);
  assert.match(r.no_refill_reason, /closed-but-live 1/);
  assert.deepEqual(r.recommended, []);
});
