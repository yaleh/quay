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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { RETREATED_MARKER_RE, analyzeSlotRefill, assert, dispatchableBody, fs, isRetreated, makeWorkspace, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("SUPERSEDED FILTER — marker-form only: a ready task CARRYING **SUPERSEDED** is deferred; one DISCUSSING the word is recommended (AC46 marker fix)", (t) => {
  const root = makeWorkspace("superseded-filter");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Marker-form: the outer retreat writes `> **SUPERSEDED / 作废** …` — must be deferred.
  writeTask(root, "gap-marker", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/marker.ts (new)"], "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n") });
  // Discussion-only: the body names the `superseded-capability` checker — before the fix the bare
  // /SUPERSEDED/i regex matched this and wrongly deferred the task (gap-slot-refill-clique-ignores-
  // landed-touches real-world sample). Must stay dispatchable.
  writeTask(root, "gap-discusses", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/discusses.ts (new)"], "\nThe superseded-capability checker runs in the full-suite gate.\n") });
  writeTask(root, "gap-clean", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/clean.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const byId = Object.fromEntries((r.deferred || []).map((d) => [d.id, d.reason]));
  assert.ok(/superseded/.test(byId["gap-marker"] || ""), `marker-carrying task deferred as superseded, got: ${byId["gap-marker"]}`);
  assert.ok(!(byId["gap-discusses"] || "").includes("superseded"), "discussion-only task NOT deferred as superseded");
  assert.ok(r.recommended.includes("gap-discusses"), "discussion-only task is recommended");
  assert.ok(r.recommended.includes("gap-clean"), "clean task is recommended");
  assert.ok(!r.recommended.includes("gap-marker"), "marker-carrying task never recommended");
});

// ── RETREATED / 搁置 FILTER (tasks/gap-retreated-state-not-mechanized) ──────────────────────────────
// A ready task the outer retreated (load-induced red rollback, left `ready` so it stays in the pool)
// carries a line-start bold `**RETREATED` marker and must NOT be recommended for dispatch — "等
// fix-scope gate land 前不重派" is a MECHANICAL signal, not a manual skip (the AC53 heartbeat REFUSED
// root cause: should_refill=true with retreated tasks recommended, then skipped by hand). 解除搁置 =
// removing the marker ⇒ dispatchable again.


test("RETREATED FILTER — a ready task carrying **RETREATED** is deferred and NOT recommended; removing the marker (解除搁置) restores dispatch (AC1/AC2/DoD)", (t) => {
  const root = makeWorkspace("retreated");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Marker-form: the outer retreat leaves `> **RETREATED / 搁置** …` as a body line.
  writeTask(root, "gap-ret", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ret.ts (new)"], "\n> **RETREATED / 搁置** load-induced red — wait for fix-scope gate.\n") });
  writeTask(root, "gap-clean", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/clean.ts (new)"]) });
  const tasksDir = path.join(root, "tasks");

  const r = analyzeSlotRefill({ tasksDir, root, cap: 5 });
  assert.ok(!r.recommended.includes("gap-ret"), "retreated task is NOT recommended (no manual skip)");
  assert.ok(r.recommended.includes("gap-clean"), "a clean disjoint candidate is still recommended");
  const ret = (r.deferred || []).find((d) => d.id === "gap-ret");
  assert.ok(ret && /retreated/.test(ret.reason), `retreated task deferred with reason "retreated", got: ${JSON.stringify(ret)}`);

  // Un-shelve (解除搁置): rewrite the task WITHOUT the marker ⇒ dispatchable again.
  writeTask(root, "gap-ret", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ret.ts (new)"]) });
  const r2 = analyzeSlotRefill({ tasksDir, root, cap: 5 });
  assert.ok(r2.recommended.includes("gap-ret"), "after 解除搁置 (marker removed) the task is recommended again");
});


test("RETREATED FILTER — a retreated-only pool ⇒ should_refill=false with a named reason (AC53 end-invariant no longer trips, AC3)", (t) => {
  const root = makeWorkspace("retreated-only");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The ONLY ready candidate is retreated — before the fix slot-refill recommended it (should_refill
  // true + no_refill_reason null) and the heartbeat refused on manual skip. Now it is deferred, so the
  // end-invariant (should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no reason) is NOT violated.
  writeTask(root, "gap-ret", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/ret.ts (new)"], "\n> **RETREATED / 搁置** load-induced red — wait for fix-scope gate.\n") });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.deepEqual(r.recommended, [], "no dispatchable recommendation (the retreated task is deferred, not skipped)");
  assert.equal(r.should_refill, false, "should_refill=false — the AC53 end-invariant gate no longer trips");
  assert.ok(r.no_refill_reason, "no_refill_reason is non-null (never the should_refill=true + null shape that REFUSED)");
});


test("RETREATED FILTER — position-based (hard-rule ②): a prose mention of 'retreat' is NOT the marker; only the bold line-start form defers (AC1 negative control)", (t) => {
  const root = makeWorkspace("retreated-prose");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Prose mentions "retreat"/"retreated" without the bold line-start marker — must stay dispatchable.
  writeTask(root, "gap-prose", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/prose.ts (new)"], "\nThis task discusses the retreated-state defect but is not itself retreated.\n") });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.ok(r.recommended.includes("gap-prose"), "a prose mention of retreated is NOT excluded (marker-form only)");
  const d = (r.deferred || []).find((x) => x.id === "gap-prose");
  assert.ok(!d || !/retreated/.test(d.reason), `prose-mention task must not defer as retreated, got: ${JSON.stringify(d)}`);
});


test("RETREATED MARKER — pure: bold line-start form matches; inline/prose forms do not (recognition pin, AC1)", () => {
  assert.equal(RETREATED_MARKER_RE.test("> **RETREATED / 搁置** load-induced red"), true, "blockquote line-start marker matches");
  assert.equal(RETREATED_MARKER_RE.test("**RETREATED**"), true, "bare line-start marker matches");
  assert.equal(RETREATED_MARKER_RE.test("a task that was retreated stays ready"), false, "prose 'retreated' is not the marker");
  assert.equal(RETREATED_MARKER_RE.test("note the **RETREATED** inline mention"), false, "inline bold mention is not the marker (line-start only)");
  assert.equal(isRetreated({ body: "> **RETREATED / 搁置**\n" }), true, "isRetreated recognizes the marker");
  assert.equal(isRetreated({ body: "not a marker" }), false, "isRetreated fails on a non-marker body");
});

// ── AC7: idempotence — pure, no writes, same inputs ⇒ identical output ─────────────────────────────


test("analyzeSlotRefill is a pure reader: same inputs ⇒ deep-equal output, no store mutation (AC7)", (t) => {
  const root = makeWorkspace("idem");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const tasksDir = path.join(root, "tasks");
  const before = fs.readFileSync(path.join(tasksDir, "gap-a.md"), "utf8");
  const r1 = analyzeSlotRefill({ tasksDir, root, cap: 3 });
  const r2 = analyzeSlotRefill({ tasksDir, root, cap: 3 });
  assert.deepEqual(r2, r1, "repeated evaluation with the same state is byte-identical");
  const after = fs.readFileSync(path.join(tasksDir, "gap-a.md"), "utf8");
  assert.equal(after, before, "the helper must not mutate the store");
});

// ── CLI smoke ─────────────────────────────────────────────────────────────────────────────────────
