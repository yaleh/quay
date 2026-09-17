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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 11/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, assert, dispatchableBody, execFileSync, fs, makeGitWorkspace, makeWorkspace, path, writeRounds, writeState, writeTask } from "./helpers/slot-refill-harness.mjs";

test("ARBITRATION — no red window keeps full cap even with high backlog; red state alone is not the trigger; absent state proceeds (AC2 invariants)", (t) => {
  const root = makeWorkspace("arb-green");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // green window + high backlog ⇒ cap stays full (backlog is NO LONGER part of the trigger)
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 260 + i, state: "green", reason: "pass", fail: 0 })));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const green = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(green.effective_cap, 5, "green window ⇒ cap stays full (backlog 80 is irrelevant — not a trigger)");
  assert.equal(green.arbitration.cap_narrowed, false);
  assert.equal(green.arbitration.red_window_active, false);
  // red STATE file but green ROUNDS (no consecutive-red window) ⇒ no narrowing — the state alone is
  // not the trigger, the WINDOW is
  writeState(root, [{ file: "code/a.ts" }]);
  const redNoWindow = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(redNoWindow.effective_cap, 5, "suite state red but no consecutive-red window ⇒ no narrowing");
  assert.equal(redNoWindow.arbitration.cap_narrowed, false);
  assert.equal(redNoWindow.arbitration.red_window_active, false);
  assert.equal(redNoWindow.arbitration.suite_red, true, "suite_red is still reported as a diagnostic");
  // absent state + no rounds ⇒ not red-blocked ⇒ proceed
  fs.rmSync(path.join(root, ".quay", "full-suite-state.json"));
  fs.rmSync(path.join(root, ".quay", "per-task-suite-records.jsonl"));
  const noState = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, integrationBacklog: 80 });
  assert.equal(noState.effective_cap, 5, "absent suite state + no window ⇒ no narrowing");
});


test("ARBITRATION — CLI with a real git repo: a red window narrows the cap; green window restores (AC4)", (t) => {
  const root = makeGitWorkspace("redbacklog", 55);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 270 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/a.ts", line: "x" }] })));
  writeState(root, [{ file: "code/a.ts" }]); // state red
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // AC115: --in-flight-count 0 = the driver's measured zero, so the exact slots_free/effective_cap
  // assertions are hermetic without any telemetry/process scan.
  const redOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json", "--in-flight-count", "0"],
    { encoding: "utf8" },
  ));
  assert.equal(redOut.arbitration.integration_backlog, 55, "git-read backlog (develop..integration) still reported as a diagnostic");
  assert.equal(redOut.arbitration.red_window_active, true);
  assert.equal(redOut.arbitration.cap_narrowed, true);
  assert.equal(redOut.effective_cap, 2, "red window (3 consecutive red rounds) ⇒ narrowed to redBacklogCap");
  assert.equal(redOut.slots_free, 2);
  // green window ⇒ cap restores to full
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 273 + i, state: "green", reason: "pass", fail: 0 })));
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", fail: 0 }));
  const greenOut = JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--json", "--in-flight-count", "0"],
    { encoding: "utf8" },
  ));
  assert.equal(greenOut.arbitration.cap_narrowed, false);
  assert.equal(greenOut.effective_cap, 5, "green window ⇒ effective cap restored");
});


test("ARBITRATION — default (no red window/backlog) is byte-forward-compatible: cap stays the base cap (AC5 no-regress)", (t) => {
  const root = makeWorkspace("arb-default");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.cap, 5, "no red window + no git backlog ⇒ fixed cap unchanged");
  assert.equal(r.effective_cap, 5);
  assert.equal(r.arbitration.cap_narrowed, false);
  assert.equal(r.arbitration.red_window_active, false);
  assert.equal(r.arbitration.integration_backlog, 0, "non-git temp root fails safe to 0");
  assert.equal(r.slots_free, 5);
});

// ── DELIVERY-CRITICAL MECHANICAL AXIS — RETIRED (gap-delivery-critical-mechanical-axis-orphaned-
// needs-ruling, 人 2026-09-07 裁定) ────────────────────────────────────────────────────────────────
// The AC36 mechanical sort axis (blocking_suite, delivery_critical, id) is RETIRED: candidates.sort
// is back to (blocking_suite, id), and `ranking` no longer carries a `deliveryCritical` field.
// delivery-critical priority is now carried ENTIRELY by the selector's semantic judgment
// (orchestration/dispatch-preference.md). The tests below assert the NEW shape: labeling a task
// delivery-critical does NOT reorder the ranking, and the `delivery_critical_in_flight` negative
// control (gap-delivery-critical-label-at-promote-not-after-dispatch, a DIFFERENT task's product)
// is unchanged.


test("DELIVERY-CRITICAL — RETIRED: a delivery-critical label does NOT reorder the ranking (no mechanical axis) while recommended stays de-ordered", (t) => {
  const root = makeWorkspace("ac36-rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3 };

  const before = analyzeSlotRefill(opts);
  assert.deepEqual(before.recommended, ["ac36-a", "ac36-b"], "no label ⇒ de-ordered (lexicographic)");
  assert.equal(before.ranking[0].id, "ac36-a", "no label ⇒ id tie-break order in the ranking");

  // After the axis retirement the label is NOT a mechanical axis: the ranking stays id-ordered.
  writeTask(root, "ac36-b", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const after = analyzeSlotRefill(opts);
  assert.deepEqual(after.recommended, ["ac36-a", "ac36-b"], "recommended stays de-ordered (lexicographic)");
  assert.deepEqual(after.ranking.map((e) => e.id), ["ac36-a", "ac36-b"], "no mechanical DC axis ⇒ ranking stays id-ordered (the label does NOT reorder)");
  assert.ok(!("deliveryCritical" in after.ranking[0]), "ranking entries no longer expose a deliveryCritical field (AC36 axis retired)");
  assert.match(after.recommended_order, /order meaningless/, "the de-ordered output is explicitly annotated");
});


test("blocking_suite axis stays the TOP ranking axis (invariant, DC axis retired)", (t) => {
  const root = makeWorkspace("ac36-suite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-watchdog", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wd.ts (new)"]) });
  writeTask(root, "ac36-critical", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/crit.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // 3 consecutive red rounds implicating the watchdog task's Touches ⇒ watchdog is a suite-blocker.
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 300 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] })));
  writeState(root, [{ file: "code/wd.ts", line: "x" }]);
  const r = analyzeSlotRefill(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.deepEqual(r.recommended, ["ac36-critical", "ac36-watchdog"], "recommended is de-ordered (lexicographic: critical < watchdog) — the dispatch array does NOT encode blocking_suite priority");
  assert.equal(r.ranking[0].id, "ac36-watchdog", "in the ranking the suite-blocker ranks above plain id order (blocking_suite is the sole top axis)");
  assert.equal(r.ranking[1].id, "ac36-critical", "non-suite-blocker ranks second by id order");
});


test("a false-positive dir-glob suite-blocker does NOT demote an id-first task (AC4 — gap-suite-blocking-directory-glob-overbroad)", (t) => {
  const root = makeWorkspace("glob-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The crystallization shape: Touches carry concrete scripts AND the `plugin/test/` directory glob.
  writeTask(root, "gap-crystal-dir", { status: "ready", labels: ["gap"], body: dispatchableBody(["- plugin/test/", "- plugin/scripts/capability-catalog.sh (new)"]) });
  // ac37-dc must rank #1 when nothing is a true suite-blocker (id order puts it before gap-crystal-dir).
  writeTask(root, "ac37-dc", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/dc.ts (new)"]) });
  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 2 };

  // 3 consecutive red rounds whose ONLY failing file is under plugin/test/ — the dir glob must NOT
  // implicate gap-crystal-dir, so ac37-dc keeps the top of the ranking (before the fix, the dir
  // glob made gap-crystal-dir a false suite-blocker and pushed it to #1).
  writeRounds(root, Array.from({ length: 3 }, (_, i) => ({ round: 310 + i, state: "red", reason: "failed", fail: 1, failures: [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }] })));
  writeState(root, [{ file: "plugin/test/checker-cost.test.mjs", line: "x" }]);
  const r = analyzeSlotRefill(opts);
  assert.equal(r.suite_blocking.window_active, true);
  assert.ok(!r.suite_blocking.tasks.includes("gap-crystal-dir"), "the dir-glob task is NOT a suite-blocker (AC2 negative control)");
  assert.equal(r.ranking[0].id, "ac37-dc", "no suite-blocker ⇒ id order puts ac37-dc first in the ranking");
  assert.ok(r.recommended.includes("gap-crystal-dir"), "the dir-glob task is still dispatchable");
  assert.deepEqual(r.recommended, ["ac37-dc", "gap-crystal-dir"], "recommended is de-ordered (lexicographic: ac37-dc < gap-crystal-dir)");
});
