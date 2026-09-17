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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, analyzeTasks, assert, computeArbitratedCap, computeFfFailureCounts, computeFfStarvationCap, computeFfStarvationRelief, computeUnresolvedEscalationTaskIds, dispatchableBody, execFileSync, fs, inFlightTask, makeWorkspace, path, writeRounds, writeState, writeTask } from "./helpers/slot-refill-harness.mjs";

test("AC5 — runningSubagentCount splits Consumer B (slots) from Consumer A (touches): two denominators may differ (判据 ⊢)", (t) => {
  const root = makeWorkspace("ac5-split");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // 5 WIDE un-landed tasks (the real 2026-08-14 in-flight set).
  const wide = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of wide) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const inFlight = wide.map((id) => inFlightTask(id, [`- code/${id}.ts (new)`]));
  const base = { tasksDir, root, cap: 5 };

  // Consumer B narrow: only 3 of the 5 are ACTUALLY-RUNNING subagents (ac63 + in-flight-resolve impl
  // + workflows-dual-copy — the 2026-08-14 empirical split: 5 worktrees, 3 live subagents).
  const narrow = analyzeSlotRefill({ ...base, inFlight, runningSubagentCount: 3 });
  assert.equal(narrow.in_flight_count, 5, "Consumer A denominator stays WIDE (all un-landed tasks)");
  assert.equal(narrow.running_subagent_count, 3, "Consumer B denominator is the NARROW running-subagent count");
  assert.equal(narrow.slot_denominator_source, "running-subagents");
  assert.equal(narrow.slots_free, 2, "true slots_free = cap 5 − 3 running subagents = 2");

  // Backward compat: no runningSubagentCount ⇒ Consumer B falls back to the wide set.
  const fallback = analyzeSlotRefill({ ...base, inFlight });
  assert.equal(fallback.running_subagent_count, 5, "fallback Consumer B = wide set");
  assert.equal(fallback.slot_denominator_source, "in-flight-fallback");
  assert.equal(fallback.slots_free, 0, "fallback slots_free = cap 5 − 5 wide = 0 (the old shared-denominator shape)");

  // ⊢ 判据: the two denominators are allowed to differ — 5 (wide, Consumer A) vs 3 (narrow, Consumer B).
  assert.notEqual(narrow.in_flight_count, narrow.running_subagent_count,
    "判据: dispatchable_disjoint 分母 (5) 与 slots_free 分母 (3) 允许不等");
  assert.equal(narrow.dispatchable_disjoint, fallback.dispatchable_disjoint,
    "Consumer A (dispatchable_disjoint) is UNCHANGED by the Consumer-B split");
});


test("AC5/AC115 — CLI --in-flight-count: the driver's DIRECT child count feeds Consumer B (slots) via driver-count provenance", (t) => {
  const root = makeWorkspace("ac5-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of ids) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = (args) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "5", "--json", ...args],
    { encoding: "utf8" },
  ));

  // AC115: in-flight = 驱动子进程数（直接量）——the driver passes its own child count as a NUMBER.
  // 3 running workers ⇒ Consumer B = 3 ⇒ slots_free = 5 − 3 = 2.
  const withCount = run(["--in-flight-count", "3"]);
  assert.equal(withCount.measurement_source, "driver-count", "the in-flight count is the driver's direct child count");
  assert.equal(withCount.running_subagent_count, 3, "Consumer B denominator = the direct count");
  assert.equal(withCount.slots_free, 2, "true slots_free = 5 − 3 = 2");

  // Zero is a MEASURED zero (not "absent"): --in-flight-count 0 ⇒ 5 free slots.
  const zeroCount = run(["--in-flight-count", "0"]);
  assert.equal(zeroCount.slots_free, 5, "0 is a measured zero ⇒ all 5 slots free");
  assert.equal(zeroCount.measurement_source, "driver-count");
});


test("AC5 — Consumer A stays WIDE: a candidate colliding with a wide-but-not-running task is still blocked (awaiting-retry worktree occupies files)", (t) => {
  const root = makeWorkspace("ac5-wide");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // 3 WIDE in-flight tasks; only 2 (A, B) are running — C is awaiting-retry (no subagent).
  writeTask(root, "gap-if-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-if-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  writeTask(root, "gap-if-c", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)"]) });
  // A ready candidate X touches the SAME file as awaiting-retry C (wide but NOT running).
  writeTask(root, "gap-cand-x", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/c.ts (new)", "- code/x.ts (new)"]) });
  // A disjoint candidate Y touches a fresh file — should be free to recommend.
  writeTask(root, "gap-cand-y", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/y.ts (new)"]) });
  const inFlight = [
    inFlightTask("gap-if-a", ["- code/a.ts (new)"]),
    inFlightTask("gap-if-b", ["- code/b.ts (new)"]),
    inFlightTask("gap-if-c", ["- code/c.ts (new)"]),
  ];
  const r = analyzeSlotRefill({ tasksDir, root, cap: 5, inFlight, runningSubagentCount: 2 });
  assert.equal(r.running_subagent_count, 2, "Consumer B narrow = 2 running subagents");
  assert.equal(r.slots_free, 3, "true slots_free = 5 − 2 = 3");
  assert.ok(r.recommended.includes("gap-cand-y"), "disjoint candidate Y recommended (slots are free)");
  assert.ok(!r.recommended.includes("gap-cand-x"),
    "X collides with awaiting-retry C (wide Consumer-A set) ⇒ blocked even though C is NOT running (its worktree still occupies code/c.ts)");
  const deferredX = (r.deferred || []).find((d) => d.id === "gap-cand-x");
  assert.ok(deferredX && /touches-overlap-in-flight/.test(deferredX.reason),
    "X deferred with touches-overlap-in-flight — the WIDE Consumer-A denominator still applies");
});

// ── Suite-blocking rank (tasks/gap-ready-relevance-blind-to-suite-blocking-signal AC3) ──────────────
// AC3: a task the consecutive-red-window signal implicates (pool.suite_blocking.tasks, the
// ready-pool-check blocking_suite axis) is ranked FIRST into `recommended` — the inner's slot-refill
// picks the suite-blocker before any other work. Negative control: no red window ⇒ recommended keeps
// the pre-signal (id) ordering.

/** AC84 (gap-ac84-suite-source-starvation-reader-disposition AC2): slot-refill's suite-blocking
 *  (via analyzeTasks) now reads per-task-suite-records.jsonl — the ONLY ongoing suite source after
 *  AC84 (verification-round is NO LONGER a throttling input). This helper writes the per-task-suite-
 *  record shape, converting the round-shaped fixture rows ({round,state,reason,fail,failures}) into
 *  it. Every fixture row is a REAL full-suite result (fullSuiteRan:true) — a green row breaks the
 *  window, a red row counts. */



test("slot-refill recommends the suite-blocking task first; no red window ⇒ unchanged (AC3/negative)", (t) => {
  const root = makeWorkspace("suiteblock");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/plain.ts (new)"]) });
  writeTask(root, "gap-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // AC4 negative control FIRST: no suite history ⇒ recommended keeps the de-ordered (lexicographic) form.
  const before = analyzeSlotRefill(opts);
  assert.equal(before.suite_blocking.window_active, false);
  assert.deepEqual(before.recommended, ["gap-plain-ready", "gap-watchdog"], "no red window ⇒ de-ordered (lexicographic)");
  assert.ok(/order meaningless/.test(before.recommended_order), "the de-ordered output is explicitly annotated");

  // AC3: 3 consecutive red rounds whose failures hit the watchdog task's Touches ⇒ the suite-blocker
  // is picked first BY THE PRIORITY SORT (exposed in `ranking`, the AC36 diagnostic) while the
  // dispatch-facing `recommended` array stays de-ordered (AC56 去锚).
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 220 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
  const after = analyzeSlotRefill(opts);
  assert.equal(after.suite_blocking.window_active, true);
  assert.deepEqual(after.suite_blocking.tasks, ["gap-watchdog"]);
  assert.equal(after.recommended[0], "gap-plain-ready", "recommended is de-ordered (lexicographic) — the suite-blocker is NOT first in the dispatch-facing array");
  assert.equal(after.recommended.length, 2, "both dispatchable candidates still recommended (cap 2)");
  assert.equal(after.ranking[0].id, "gap-watchdog", "the suite-blocker is first in the ranking (the priority-sorted AC36 diagnostic)");

  // negative: last round green clears the window ⇒ recommended stays de-ordered (lexicographic).
  writeRounds(root, [
    ...Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts" }] })),
    { round: 223, state: "green", fail: 0 },
  ]);
  const green = analyzeSlotRefill(opts);
  assert.equal(green.suite_blocking.window_active, false);
  assert.deepEqual(green.recommended, ["gap-plain-ready", "gap-watchdog"], "green round clears the window ⇒ de-ordered (lexicographic)");
  assert.equal(green.ranking[0].id, "gap-plain-ready", "no suite-blocker ⇒ id-tie-break order in the ranking");
});

// ── B3 ①/④ ARBITRATION (gap-b3-arbitration-inflight-vs-backlog) ─────────────────────────────────────
// ① (in_flight<cap ⇒ dispatch) conflicts with ④ (integration ahead + suite green ⇒ batch-merge): ④ is a
// DOWNSTREAM constraint on ①. When the delivery gate is blocked by a red suite AND the integration
// backlog exceeds the threshold, the effective dispatch cap narrows to "just enough to fix red"; the cap
// restores on green; an empty backlog has no effect (AC2/AC4, the Contract's band + invariants).

/** Run a git command in a temp repo. MODULE-LEVEL on purpose: a nested function def between a
 *  mkdtemp and its `return` misdirects test-isolation-check's nearestFuncName association (the
 *  returned dir's funcName resolves to the NESTED fn, whose call sites never capture+clean it), which
 *  would false-flag a mkdtemp-no-cleanup ratchet violation on an otherwise-cleaned helper. */

/** Build a REAL temp git repo where `integration` is `ahead` commits ahead of `develop`, so the
 *  git-read backlog (`git rev-list --count develop..integration`) is exercised, not injected. */


test("computeArbitratedCap — red window active narrows to redBacklogCap; inactive keeps base (AC1 pure)", () => {
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: true }), 2, "red window active ⇒ redBacklogCap (2)");
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: false }), 5, "no red window ⇒ base cap unchanged");
  // custom redBacklogCap honored; an inactive window still keeps base
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: true, redBacklogCap: 3 }), 3);
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: false, redBacklogCap: 3 }), 5);
});

// ── FF-STARVATION RELIEF (gap-ff-starvation-no-dynamic-cap-relief) ───────────────────────────────────
// The second trigger on computeArbitratedCap: a LIVE task that has failed ff repeatedly in its current
// round (develop advanced during its merge→ff window) narrows the dispatch cap so it lands with no NEW
// competitor. Tiered (k=1 no / k=2→2 / k≥3→1), stateless (recomputed every round — AC8), the cause is
// distinguishable from suite-red / worker-round-end (AC5), and the perpetrator is distinguishable as
// layer-commit (delayable) vs task-landing (not delayable) (AC7).




test("computeFfStarvationCap — k=1 no narrow, k=2→2, k≥3→1: three distinguishable tiers (AC2)", () => {
  assert.equal(computeFfStarvationCap(0), null, "no failure ⇒ no intervention");
  assert.equal(computeFfStarvationCap(1), null, "k=1 retry genuinely helps ⇒ no intervention");
  assert.equal(computeFfStarvationCap(2), 2, "k=2 ⇒ mild throttle");
  assert.equal(computeFfStarvationCap(3), 1, "k=3 ⇒ deterministic landing");
  assert.equal(computeFfStarvationCap(8), 1, "k≥3 ⇒ 1");
  assert.equal(computeFfStarvationCap(null), null);
});


test("computeArbitratedCap — ff-starvation second trigger narrows; absent trigger keeps base (AC1/AC8 stateless)", () => {
  assert.equal(computeArbitratedCap({ baseCap: 5, ffStarvationCap: 1 }), 1, "k≥3 ⇒ cap 1");
  assert.equal(computeArbitratedCap({ baseCap: 5, ffStarvationCap: 2 }), 2, "k=2 ⇒ cap 2");
  assert.equal(computeArbitratedCap({ baseCap: 5 }), 5, "no trigger ⇒ base (self-recovery, AC8)");
  assert.equal(computeArbitratedCap({ baseCap: 5, redWindowActive: true, ffStarvationCap: 1 }), 1, "both triggers ⇒ min (the more urgent k≥3 relief wins)");
  assert.equal(computeArbitratedCap({ baseCap: 1, redWindowActive: true }), 1, "never widens — a cap-1 caller stays ≤1 under a red window");
});


test("computeFfFailureCounts — the most recent retry record's attempt is the live task's current-round k", () => {
  const recs = [
    { taskId: "gap-a", attempt: 1, epoch: 100 },
    { taskId: "gap-a", attempt: 2, epoch: 200 },
    { taskId: "gap-b", attempt: 3, epoch: 100 },
    { taskId: "gap-stale", attempt: 8, epoch: 500 }, // not live ⇒ ignored
  ];
  const counts = computeFfFailureCounts(recs, ["gap-a", "gap-b"]);
  assert.equal(counts.get("gap-a"), 2, "latest record (epoch 200) attempt 2");
  assert.equal(counts.get("gap-b"), 3);
  assert.equal(counts.has("gap-stale"), false, "a non-live task's historical failures never count");
});


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
