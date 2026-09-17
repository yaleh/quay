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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, checkTouchesPairInFlight, dispatchableBody, expandGlobs, fs, inFlightTask, makeWorkspace, parseTouches, path, writeTask } from "./helpers/slot-refill-harness.mjs";

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


test("ready candidate colliding with an in-flight task is not recommended (concurrency eligibility)", (t) => {
  const root = makeWorkspace("inflight-collide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/inflight.ts (new)"]) });
  const inFlight = [inFlightTask("gap-in1", ["- code/inflight.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 2);
  assert.ok(r.recommended.includes("gap-free"), "disjoint-from-in-flight candidate recommended");
  assert.ok(!r.recommended.includes("gap-blocked"), "candidate colliding with in-flight is not recommended");
});

// ── DIRECTORY-GLOB SELF-FILE EXEMPTION (tasks/gap-directory-level-tasks-touch-global-lock AC1) ─────
// A `## Touches` entry declaring a DIRECTORY-LEVEL `tasks/*.md` glob expands to EVERY task file, and
// C8 forces every candidate to self-touch its own `tasks/<id>.md` — so the in-flight glob overlapped
// every candidate's MANDATORY self-file ⇒ a GLOBAL dispatch lock while the declarer was in flight
// (measured: doc-lint 3h40m, occurrence rate 45). Fix option ②: the candidate's OWN self-file is
// excluded from the in-flight overlap when the in-flight side covers it only via a directory glob.
// The task's AC1 negative test: an in-flight `tasks/*.md` declarer + any other ready task ⇒ must still
// be dispatchable. Negative controls: a CONCRETE in-flight entry naming the candidate's file, or a
// candidate declaring `tasks/*.md` itself, still block (genuine multi-task-file writers serialize).


test("DIR-GLOB LOCK FIX (AC1) — an in-flight tasks/*.md declarer no longer locks the queue: normal ready candidates are still recommended (the task's negative test)", (t) => {
  const root = makeWorkspace("dirglob-fix");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-cand", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/cand.ts (new)"]) });
  writeTask(root, "gap-peer", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/peer.ts (new)"]) });
  // The in-flight task declares the directory-level glob (the pre-fix global-lock shape — doc-lint).
  const inFlight = [inFlightTask("gap-glob", ["- tasks/*.md"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.equal(r.slots_free, 2, "cap 3 − 1 in-flight = 2");
  assert.ok(r.recommended.includes("gap-cand"), "a normal candidate is dispatchable despite an in-flight tasks/*.md declarer (self-file excluded)");
  assert.ok(r.recommended.includes("gap-peer"), "a second normal candidate is dispatchable too");
  const candDeferred = (r.deferred || []).filter((d) => d.id === "gap-cand");
  assert.equal(candDeferred.length, 0, "gap-cand is not deferred by the in-flight tasks/*.md glob (option ② non-blocking self-file intersection)");
});


test("DIR-GLOB LOCK FIX (AC1) — checkTouchesPairInFlight pure: glob-driven self-file overlap ⇒ disjoint; concrete overlap / no selfFileRel ⇒ blocked (fail-closed)", (t) => {
  const root = makeWorkspace("dirglob-pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-cand", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/cand.ts (new)"]) });
  const cand = parseTouches(fs.readFileSync(path.join(root, "tasks", "gap-cand.md"), "utf8"));
  const expand = (globs) => expandGlobs(globs, root);

  // (a) in-flight directory glob `tasks/*.md` + candidate self-file ⇒ exempt → disjoint (option ②).
  const inflightGlob = parseTouches(dispatchableBody(["- tasks/*.md"]));
  const r1 = checkTouchesPairInFlight(cand, inflightGlob, expand, "tasks/gap-cand.md");
  assert.equal(r1.disjoint, true, "glob-driven self-file overlap is non-blocking");
  assert.match(r1.reason, /C8 self-file/, "reason names the C8 self-file exclusion");

  // (b) in-flight CONCRETE declaration of the candidate's own file ⇒ NOT exempt → blocked.
  const inflightConcrete = parseTouches(dispatchableBody(["- tasks/gap-cand.md"]));
  const r2 = checkTouchesPairInFlight(cand, inflightConcrete, expand, "tasks/gap-cand.md");
  assert.equal(r2.disjoint, false, "a concrete in-flight entry naming the candidate's file still blocks");

  // (c) no selfFileRel ⇒ base verdict unchanged (blocked) — fail-closed, never invented.
  const r3 = checkTouchesPairInFlight(cand, inflightGlob, expand, null);
  assert.equal(r3.disjoint, false, "no selfFileRel ⇒ no exemption (fail-closed)");

  // (d) conservative side (in-flight no/empty ## Touches) ⇒ base verdict unchanged (blocked).
  const inflightEmpty = parseTouches(dispatchableBody([]));
  const r4 = checkTouchesPairInFlight(cand, inflightEmpty, expand, "tasks/gap-cand.md");
  assert.equal(r4.disjoint, false, "conservative in-flight (no ## Touches) stays blocked");
});


test("DIR-GLOB LOCK FIX (AC1) — negative: in-flight CONCRETELY declaring the candidate's own task file still blocks (self-file exemption does not mask a concrete entry)", (t) => {
  const root = makeWorkspace("dirglob-concrete");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-cand", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/cand.ts (new)"]) });
  writeTask(root, "gap-other", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/other.ts (new)"]) });
  // In-flight CONCRETELY declares the candidate's own task file.
  const inFlight = [inFlightTask("gap-in", ["- tasks/gap-cand.md"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.ok(!r.recommended.includes("gap-cand"), "a concrete in-flight declaration of the candidate's file still blocks");
  assert.ok(r.recommended.includes("gap-other"), "a disjoint candidate is still recommended");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-cand");
  assert.ok(deferred.length === 1 && /touches-overlap-in-flight/.test(deferred[0].reason),
    `gap-cand deferred with touches-overlap-in-flight, got: ${JSON.stringify(deferred)}`);
});
