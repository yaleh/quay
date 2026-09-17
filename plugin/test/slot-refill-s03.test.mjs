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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, assert, checkTouchesPairInFlight, dispatchableBody, execFileSync, expandGlobs, fs, inFlightTask, makeWorkspace, parseTouches, path, writeTask } from "./helpers/slot-refill-harness.mjs";

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


test("DIR-GLOB LOCK FIX (AC1) — negative: a candidate declaring tasks/*.md collides with an in-flight tasks/*.md declarer (two genuine global writers serialize)", (t) => {
  const root = makeWorkspace("dirglob-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The candidate itself declares the directory glob — it genuinely claims ALL task files, so it is
  // NOT exempt from another tasks/*.md in-flight task (the exemption is self-file-only).
  writeTask(root, "gap-glob-cand", { status: "ready", labels: ["gap"], body: dispatchableBody(["- tasks/*.md"]) });
  const inFlight = [inFlightTask("gap-glob-in", ["- tasks/*.md"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3, inFlight });
  assert.ok(!r.recommended.includes("gap-glob-cand"), "a tasks/*.md candidate is NOT exempt from another tasks/*.md in-flight task");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-glob-cand");
  assert.ok(deferred.length === 1 && /touches-overlap-in-flight/.test(deferred[0].reason),
    `deferred with touches-overlap-in-flight, got: ${JSON.stringify(deferred)}`);
});

// ── DEFER ACCOUNTING (gap-over90-clock-measures-queue-time-not-work-time): slot-refill is a PURE
// recommender (never writes brackets), but it must SURFACE which candidates were deferred and why so
// the tick can mechanically close their open brackets (closure-lag-check.sh --close-task --outcome
// deferred) — the queue segment then never counts toward OVER90. ─────────────────────────────────────


test("DEFER — slot-refill exposes deferred candidates with reasons (touches-overlap / deps / majority-missing / self-touch)", (t) => {
  const root = makeWorkspace("defer");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Recommended: a clean disjoint candidate.
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });
  // Deferred (touches-overlap with in-flight): must be surfaced with the overlap reason.
  writeTask(root, "gap-blocked", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/inflight.ts (new)"]) });
  // Deferred (deps not ready): parent not done.
  writeTask(root, "gap-dep", { status: "ready", labels: ["gap"], parent: "gap-never-done", body: dispatchableBody(["- code/dep.ts (new)"]) });
  // Deferred (majority-missing touches): absent files without (new).
  writeTask(root, "gap-missing", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/absent-1.ts", "- code/absent-2.ts"]) });
  // Deferred (C8 self-touch missing): own task file not in Touches.
  writeTask(root, "gap-selftouch", { status: "ready", labels: ["gap"], selfTouch: false, body: dispatchableBody(["- code/st.ts (new)"]) });
  const inFlight = [inFlightTask("gap-in1", ["- code/inflight.ts (new)"])];
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, inFlight });

  assert.ok(r.recommended.includes("gap-free"), "the disjoint candidate is still recommended");
  const byId = Object.fromEntries(r.deferred.map((d) => [d.id, d.reason]));
  assert.ok(r.deferred.length >= 4, `expected ≥4 deferred candidates, got ${r.deferred.length}`);
  assert.ok(byId["gap-blocked"] && /touches-overlap-in-flight/.test(byId["gap-blocked"]),
    `touches-overlap defer surfaced with reason, got: ${JSON.stringify(byId["gap-blocked"])}`);
  assert.ok(byId["gap-dep"] && /deps-not-ready/.test(byId["gap-dep"]), "deps-not-ready defer surfaced");
  assert.ok(byId["gap-missing"] && /touches-majority-missing/.test(byId["gap-missing"]), "touches-majority-missing defer surfaced");
  assert.ok(byId["gap-selftouch"] && /self-touch-missing-c8/.test(byId["gap-selftouch"]), "self-touch defer surfaced");
  // None of the deferred ids may appear in recommended.
  for (const d of r.deferred) assert.ok(!r.recommended.includes(d.id), `deferred ${d.id} must not be recommended`);
});

// ── ASSEMBLEBATCH-DEFERRED (gap-slot-refill-discards-assemblebatch-deferred): slot-refill only
// destructured assembleBatch's `batch`, DISCARDING its `deferred` — so a candidate that passed all
// step-4 checks yet was serialized by assembleBatch (shared-state / learning-type /
// non-capability-growth) reported `deferred=[]` + the misleading "no dispatchable candidate passes
// step-4" no_refill_reason. AC1: the assembleBatch deferred reasons must be merged into the output's
// `deferred`. AC2: no_refill_reason must report the REAL rejection face (assembleBatch serialization)
// instead of "no dispatchable candidate passes step-4" when candidates DID pass step-4. ───────────────

// AC1 + AC3 negative control: a ready task whose `## Touches` hits SHARED_STATE_PATHS is deferred by
// assembleBatch with a readable "touches shared exp5 state" reason (NOT deferred=[] + misleading
// no_refill_reason). Real CLI output (DoD: 真实输出，非 fixture).

test("ASSEMBLEBATCH-DEFERRED (AC1/AC3) — a shared-state-touch ready task surfaces the assembleBatch rejection reason in `deferred` and a non-misleading no_refill_reason", (t) => {
  const root = makeWorkspace("batch-defer");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The candidate passes EVERY step-4 check (touches-resolve / deps-ready / disjoint / self-touch C8)
  // but its `## Touches` declares a SHARED_STATE_PATHS path — assembleBatch serializes it.
  writeTask(root, "gap-shared", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- experiments/quay-perpetual-stream/dashboard.md (new)"]),
  });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const r = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "5", "--json", "--in-flight-count", "0"],
    { encoding: "utf8" },
  ));
  // AC1: the assembleBatch rejection reason is visible in the output's `deferred`.
  const d = (r.deferred || []).find((x) => x.id === "gap-shared");
  assert.ok(d, `gap-shared deferred by assembleBatch, got deferred=${JSON.stringify(r.deferred)}`);
  assert.ok(/touches shared exp5 state/.test(d.reason),
    `reason names the shared-state serialization, got: ${d.reason}`);
  // AC2: no_refill_reason reports the REAL rejection face, NOT the misleading step-4 message.
  assert.ok(!/no dispatchable candidate passes step-4/.test(r.no_refill_reason || ""),
    `no_refill_reason must not misreport step-4 emptiness, got: ${r.no_refill_reason}`);
  assert.ok(/assembleBatch/.test(r.no_refill_reason || "") && /touches shared exp5 state/.test(r.no_refill_reason || ""),
    `no_refill_reason names the assembleBatch rejection face, got: ${r.no_refill_reason}`);
  assert.deepEqual(r.recommended, [], "the shared-state candidate is not recommended");
});

// AC1: a `learning`-typed candidate is serialized by assembleBatch — the reason must be visible.

test("ASSEMBLEBATCH-DEFERRED (AC1) — a learning-type candidate surfaces the 'learning-type' rejection reason", (t) => {
  const root = makeWorkspace("batch-learn");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-learn", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/learn.ts (new)"]).replace("**type:** execution", "**type:** learning"),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const d = (r.deferred || []).find((x) => x.id === "gap-learn");
  assert.ok(d, `gap-learn deferred by assembleBatch, got deferred=${JSON.stringify(r.deferred)}`);
  assert.ok(/learning-type/.test(d.reason), `reason names learning-type, got: ${d.reason}`);
  assert.deepEqual(r.recommended, [], "the learning candidate is not recommended");
});

// AC1: a non-capability-growth value-type candidate is serialized by assembleBatch — the reason must
// be visible.

test("ASSEMBLEBATCH-DEFERRED (AC1) — a non-capability-growth candidate surfaces the 'non-capability-growth' rejection reason", (t) => {
  const root = makeWorkspace("batch-value");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-disc", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- code/disc.ts (new)"]).replace("**type:** execution", "**type:** execution\n**Value type:** discovery"),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const d = (r.deferred || []).find((x) => x.id === "gap-disc");
  assert.ok(d, `gap-disc deferred by assembleBatch, got deferred=${JSON.stringify(r.deferred)}`);
  assert.ok(/non-capability-growth/.test(d.reason), `reason names non-capability-growth, got: ${d.reason}`);
  assert.deepEqual(r.recommended, [], "the non-capability-growth candidate is not recommended");
});

// AC2: distinguish the two "empty recommended" shapes. (a) NO candidate passed step-4 ⇒ the original
// "no dispatchable candidate passes step-4" message is kept. (b) candidates PASSED step-4 but
// assembleBatch serialized them ⇒ the real rejection face is reported.

test("ASSEMBLEBATCH-DEFERRED (AC2) — no_refill_reason distinguishes 'step-4 empty' from 'assembleBatch serialized'", (t) => {
  const root = makeWorkspace("batch-emptyshape");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // (a) step-4 empty: a candidate deferred by deps-not-ready (never reaches assembleBatch).
  writeTask(root, "gap-dep", { status: "ready", labels: ["gap"], parent: "gap-never-done", body: dispatchableBody(["- code/dep.ts (new)"]) });
  const rStep4Empty = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.deepEqual(rStep4Empty.recommended, []);
  assert.match(rStep4Empty.no_refill_reason || "", /no dispatchable candidate passes step-4/,
    "step-4-empty keeps the original no_refill_reason");
  // (b) assembleBatch-serialized: a candidate that PASSES step-4 but touches shared state.
  writeTask(root, "gap-shared", {
    status: "ready",
    labels: ["gap"],
    body: dispatchableBody(["- experiments/quay-perpetual-stream/dashboard.md (new)"]),
  });
  const rBatchEmpty = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.deepEqual(rBatchEmpty.recommended, []);
  assert.ok(!/no dispatchable candidate passes step-4/.test(rBatchEmpty.no_refill_reason || ""),
    "assembleBatch-empty must NOT use the step-4 message");
  assert.match(rBatchEmpty.no_refill_reason || "", /passed step-4 but assembleBatch deferred/,
    "assembleBatch-empty names the serialization face");
});
