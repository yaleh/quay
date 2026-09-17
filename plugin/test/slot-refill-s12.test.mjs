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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, applyPromotions, assert, dispatchableBody, execFileSync, fannedInBody, fs, inFlightTask, makeFannedInWorkspace, makeWorkspace, path, writeRounds, writeState, writeTask } from "./helpers/slot-refill-harness.mjs";

test("DELIVERY-CRITICAL — end-to-end: a delivery-critical task promoted (todo→ready) enters the next refill WITHOUT a mechanical rank boost (AC2 promote-time semantics, DC axis retired)", (t) => {
  const root = makeWorkspace("ac36-e2e");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ac36-aaa is READY unlabeled; ac36-e2e is a TODO carrying the delivery-critical label. The promote
  // gate flips it to ready WITH the label ("标签与 ready 同现") — the label still exists when the task
  // enters the ready pool (selector-semantic input), but it is no longer a mechanical sort axis.
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  // dispatchableBody's stock AC item is 36 non-whitespace chars — BELOW the author→ready gate's 40-char
  // MIN_SECTION_CHARS. The todo task must pass the four-artifacts gate to be promoted, so give it an
  // AC section that clears the threshold (a real ready-pool candidate would carry a full AC item).
  const todoBody = dispatchableBody(["- code/e2e.ts (new)"]).replace(
    "- [ ] an AC item that is long enough",
    "- [ ] a sufficiently long acceptance criterion item that clears the four-artifact author gate",
  );
  writeTask(root, "ac36-e2e", { status: "todo", labels: ["gap", "delivery-critical"], goal_ac: "AC-190", body: todoBody });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // AC115: --in-flight-count 0 = the driver's measured zero, so the exact recommended window is
  // hermetic without any telemetry/process scan.
  const run = () => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "3", "--json", "--in-flight-count", "0"],
    { encoding: "utf8" },
  ));

  // Before promotion the task is TODO — not in the ready pool / recommended at all.
  const before = run();
  assert.deepEqual(before.recommended, ["ac36-aaa"], "a TODO task is not in recommended (not in the ready pool)");

  // Promote ac36-e2e todo→ready, carrying the label (the promote gate's --apply write).
  const promoted = applyPromotions({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(promoted.should_apply, true);
  assert.equal(promoted.applied_promotions[0].deliveryCritical, true, "the promote record exposes the delivery-critical determination");
  const raw = fs.readFileSync(path.join(root, "tasks", "ac36-e2e.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status landed on disk");
  assert.match(raw, /delivery-critical/, "the label co-occurs with ready in the frontmatter");

  // The next refill: the promoted delivery-critical task enters the set; recommended stays de-ordered
  // and the ranking stays id-ordered (no mechanical DC axis — delivery-critical is selector-semantic).
  const after = run();
  assert.deepEqual(after.recommended, ["ac36-aaa", "ac36-e2e"], "recommended is de-ordered (lexicographic)");
  const afterRank = after.ranking.find((e) => e.id === "ac36-e2e").rank;
  assert.equal(afterRank, 1, "no mechanical DC axis ⇒ id order: ac36-aaa (rank 0) before ac36-e2e (rank 1)");
});


test("DELIVERY-CRITICAL — negative control: a post-dispatch label is NOT recorded as AC36 triggered; the in-flight DC task surfaces in delivery_critical_in_flight (AC2/AC3)", (t) => {
  const root = makeWorkspace("ac36-inflight-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The exact defect timing: the task is READY and DISPATCHED (in-flight) BEFORE the label lands.
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  // AC115: the CLI --in-flight flag is retired; the touches-disjointness self-exclusion is exercised
  // via the pure analyzeSlotRefill (the in-flight task's file is read AFTER the label lands — the
  // post-dispatch-label timing the negative control models).
  const run = (inFlightId) => {
    const tasksDir = path.join(root, "tasks");
    const inFlight = inFlightId
      ? [{ id: inFlightId, body: fs.readFileSync(path.join(tasksDir, `${inFlightId}.md`), "utf8") }]
      : [];
    return analyzeSlotRefill({ tasksDir, root, cap: 3, inFlight });
  };

  // Before dispatch: both ready, id order (no label yet).
  const before = run("");
  assert.deepEqual(before.recommended, ["ac36-aaa", "ac36-e2e"], "id order before the label");

  // Dispatch ac36-e2e (in-flight), THEN apply the delivery-critical label (post-dispatch).
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  const after = run("ac36-e2e");
  // The in-flight DC task is legitimately ABSENT from recommended (touches-overlap-in-flight
  // self-exclusion — AC2: 已在飞任务不要求出现在 recommended).
  assert.ok(!after.recommended.includes("ac36-e2e"), "in-flight DC task is NOT recommended (self-excluded)");
  assert.deepEqual(after.recommended, ["ac36-aaa"], "only the dispatchable non-DC task is recommended");
  // The post-dispatch label did NOT move the task into the ranking — the negative control is
  // mechanically visible in delivery_critical_in_flight (in-flight, NOT ranked ⇒ NOT AC36 triggered).
  assert.ok(Array.isArray(after.delivery_critical_in_flight), "delivery_critical_in_flight field is exposed");
  assert.ok(after.delivery_critical_in_flight.includes("ac36-e2e"), "the post-dispatch-labeled in-flight task is surfaced as in-flight, not ranked");
  assert.equal(after.ranking.length, 1, "ranking holds only the dispatchable task — no false AC36 trigger for the in-flight task");
});


test("DELIVERY-CRITICAL — pure: a delivery-critical in-flight task is excluded from recommended AND named in delivery_critical_in_flight (AC2/AC3)", (t) => {
  const root = makeWorkspace("ac36-inflight-pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  // The inner tick's authoritative path: inFlight is passed as the running-subagent set (the dispatch
  // already happened — the label landed AFTER the task was picked).
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    inFlight: [inFlightTask("ac36-e2e", ["- code/e2e.ts (new)"])],
  });
  assert.ok(!r.recommended.includes("ac36-e2e"), "in-flight DC task is not recommended (self-excluded)");
  assert.deepEqual(r.delivery_critical_in_flight, ["ac36-e2e"], "the in-flight DC task is surfaced, NOT ranked — the negative control");
  assert.ok(!r.ranking.some((e) => e.id === "ac36-e2e"), "the in-flight DC task has no ranking entry — not a false AC36 trigger");

  // Negative control: NO in-flight DC task ⇒ the field is empty.
  const r2 = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.deepEqual(r2.delivery_critical_in_flight, [], "no in-flight DC task ⇒ empty");
  assert.deepEqual(r2.recommended, ["ac36-aaa", "ac36-e2e"], "recommended is de-ordered (lexicographic)");
  assert.equal(r2.ranking[0].id, "ac36-aaa", "no mechanical DC axis ⇒ ranking is id-ordered (ac36-aaa first)");
});

// ── RANKING EXPOSURE (tasks/gap-ac36-recommended-exposes-sort-key AC2) ───────────────────────────────
// The `recommended` STRING array is the dispatch-facing set — since AC56 (去锚) it is de-ordered
// (lexicographic) + annotated; every consumer above reads ids, never a priority order. The parallel
// `ranking` array exposes each recommended id's suite-blocking axis ({id, suiteBlocking, rank}) in
// PRIORITY order. The deliveryCritical field this array used to carry was RETIRED
// (gap-delivery-critical-mechanical-axis-orphaned-needs-ruling, 人 2026-09-07 裁定). rank = position
// within the priority-ordered ranking, NOT the de-ordered recommended array's position.


test("RANKING — the priority-ordered diagnostic carries {id, suiteBlocking, rank} for every recommended id (AC2 + AC56)", (t) => {
  const root = makeWorkspace("ranking-expose");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.deepEqual(r.recommended, ["ac36-a", "ac36-b"], "recommended is de-ordered (lexicographic)");
  assert.ok(/order meaningless/.test(r.recommended_order), "the de-ordered output is explicitly annotated");
  assert.ok(Array.isArray(r.ranking), "--json exposes the ranking array");
  assert.equal(r.ranking.length, r.recommended.length, "ranking holds one entry per recommended id");
  assert.deepEqual(r.ranking.map((e) => e.id), ["ac36-a", "ac36-b"], "ranking is id-ordered (no mechanical DC axis) — the AC36 diagnostic is retired");
  const b = r.ranking.find((e) => e.id === "ac36-b");
  assert.ok(!("deliveryCritical" in b), "ranking entries no longer expose a deliveryCritical field (AC36 axis retired)");
  assert.equal(b.suiteBlocking, false);
  assert.equal(b.rank, 1, "rank = position within the priority-ordered ranking");
  const a = r.ranking.find((e) => e.id === "ac36-a");
  assert.equal(a.rank, 0);
});


test("RANKING — a suite-blocker's ranking entry carries suiteBlocking:true (blocking_suite axis exposed) (AC2)", (t) => {
  const root = makeWorkspace("ranking-sb");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  writeTask(root, "ac36-critical", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/crit.ts (new)"]) });
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 400 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);

  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 2 });
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.recommended, ["ac36-critical", "ac36-watchdog"], "recommended is de-ordered (lexicographic) — the dispatch array does NOT encode blocking_suite priority (AC56)");
  const wd = r.ranking.find((e) => e.id === "ac36-watchdog");
  assert.equal(wd.suiteBlocking, true, "suiteBlocking axis exposed for the suite-blocker");
  assert.equal(wd.rank, 0, "suite-blocker ranks first in the ranking (blocking_suite is the sole top axis)");
  const crit = r.ranking.find((e) => e.id === "ac36-critical");
  assert.equal(crit.suiteBlocking, false);
  assert.equal(crit.rank, 1);
});

// ── NOT-YET-FLIPPED SKIP (tasks/gap-slot-refill-repeats-done-eligible-recommendations) ──────────────
// slot-refill's candidate loop at :243 used to iterate pool.ready + 3 step-4 checks and NEVER looked
// at the not-yet-flipped signal (grep not-yet-flipped|excluded = 0 hits). A task whose work LANDED
// (fan-in merged into the two-line model's integration line — invisible to the master-only git-history
// signal) but whose status is still `ready` was re-recommended every round, re-dispatching a subagent
// to re-verify already-landed work (25 re-dispatch commits self-described on 2026-08-10). AC2: the 4th
// step-4 check skips not-yet-flipped tasks; AC4: it never touches AC5's strictness (the task still
// waits for the green round to flip done, it is just not re-dispatched).


test("NOT-YET-FLIPPED — a fanned-in (merged) task with >50% ACs is NOT recommended; an unfanned ready task still is (AC2/nyf_task_not_recommended/unfanned_ready_still_recommended)", (t) => {
  const root = makeFannedInWorkspace("canonical");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-fanned: work fanned in (merge record), 4/5 ACs ⇒ "已 fan-in 待翻 done" — must NOT be re-dispatched.
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(4, 5) });
  // gap-unfanned: no merge record, real work ⇒ must still be recommended.
  writeTask(root, "gap-unfanned", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/unfanned.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-unfanned"), "unfanned ready task is still recommended (unfanned_ready_still_recommended)");
  assert.ok(!r.recommended.includes("gap-fanned"), "fanned-in ready task (4/5 ACs) is not re-dispatched (nyf_task_not_recommended)");
});
