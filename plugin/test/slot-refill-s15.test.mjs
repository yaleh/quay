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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 15/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, dispatchableBody, fs, hasLandedImplementation, isBodyLanded, landedAllCheckedBody, landedNoCheckboxBody, landedStuckWorkBody, makeLandedWorkspace, makeTaskOnlyCommitWorkspace, makeWorkspace, path, runGit, writeTask } from "./helpers/slot-refill-harness.mjs";

test("LANDED-IMPLEMENTATION — a ready task whose implementation is merged into develop (declared-touches signals missed it) is NOT recommended; deferred landed-implementation (AC1/AC2/AC3)", (t) => {
  const root = makeLandedWorkspace("pos", "gap-landed", { mergeMessage: "merge: gap-landed — landing" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-landed: implementation merged into develop (code/impl.ts, id in the merge message), but the
  // task's Touches declare a (new) file that does NOT exist and it has no completion checkboxes — so
  // ready-pool-check's workLanded/commit-trace/notYetFlipped all miss it and it stays in pool.ready.
  // The NEW pure-git + shape-aware step-4 check is the one that catches it.
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedNoCheckboxBody() });
  // gap-fresh: genuinely-new (no develop implementation commit) — must still be recommended.
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.pool >= 2, "both candidates are in the ready pool");
  assert.ok(!r.recommended.includes("gap-landed"), "implementation-in-tree ready task is not re-recommended (AC1)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-landed").map((d) => d.reason);
  assert.ok(reasons.includes("landed-implementation"), `landed task deferred with the explicit landed-implementation reason, got: ${reasons.join(",")}`);
  assert.ok(r.recommended.includes("gap-fresh"), "a genuinely-new ready task is still recommended (AC2 negative control)");
});


test("LANDED-IMPLEMENTATION — an all-checked landed task (the realistic phantom shape) is NOT in recommended (AC1, pool-level layering)", (t) => {
  const root = makeLandedWorkspace("layered", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-landed: implementation merged (code/impl.ts) AND all ACs checked under `## AC`. The AC1
  // outcome (recommended excludes it) holds via ready-pool-check's notYetFlipped allChecked arm at the
  // pool level — the new step-4 check is the defense-in-depth for the case that signal misses.
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedAllCheckedBody() });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-landed"), "all-checked landed task is excluded from recommended (AC1)");
});


test("LANDED-IMPLEMENTATION — a landed task with open implementation ACs (stuck-work) stays dispatchable (gap-ready-pool-worklanded-traps-stuck-work parity)", (t) => {
  const root = makeLandedWorkspace("stuck", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Implementation merged into develop, but the task body has 2/5 open implementation ACs — the pure
  // git signal alone would trap it as "landed"; the completion gate keeps it dispatchable (stuck-work).
  writeTask(root, "gap-landed", { status: "ready", labels: ["gap"], body: landedStuckWorkBody(2, 5) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-landed"), "an AC-incomplete landed task is stuck-work — stays dispatchable");
});


test("LANDED-IMPLEMENTATION — a commit that only touches tasks/<id>.md is NOT 'implementation' (AC4)", (t) => {
  const root = makeTaskOnlyCommitWorkspace("doc", "gap-doconly");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pure predicate: the develop commit names the id but changed only tasks/ files ⇒ false.
  assert.equal(hasLandedImplementation(root, "gap-doconly"), false, "task-file-only commit is not landed implementation (AC4)");
  // End-to-end: overwrite the stub with a real ready body; still recommended.
  writeTask(root, "gap-doconly", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/doc.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-doconly"), "a task with only tasks-file commits is still dispatchable (AC4)");
});


test("LANDED-IMPLEMENTATION — AC3: the merge's file list is INVISIBLE without `-m --first-parent` and visible with it (measured 7418c615)", (t) => {
  const root = makeLandedWorkspace("ac3", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mergeSha = runGit(root, "log", "--merges", "--format=%H", "-1", "develop").trim();
  // Plain `git show --name-only` on a MERGE prints ZERO files (the default combined diff is empty) —
  // the false-negative pitfall the predicate exists to avoid.
  const withoutM = runGit(root, "show", "--name-only", "--format=", mergeSha);
  assert.equal(withoutM.trim(), "", "without -m a merge shows 0 files (AC3 pitfall)");
  // `-m --first-parent` diffs against the first parent → the merged implementation file is visible.
  const withM = runGit(root, "show", "-m", "--first-parent", "--name-only", "--format=", mergeSha);
  assert.ok(withM.includes("plugin/scripts/impl.ts"), `-m --first-parent reveals the merged files, got: ${withM}`);
  // The predicate consumes exactly that shape.
  assert.equal(hasLandedImplementation(root, "gap-landed"), true, "the merge landing is recognized (AC3)");
});


test("LANDED-IMPLEMENTATION — hasLandedImplementation pure: nonexistent id false, non-git root false (AC2 negative control)", (t) => {
  const root = makeLandedWorkspace("unit", "gap-landed");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(root, "gap-does-not-exist-xyz"), false, "nonexistent id ⇒ false (AC2 negative control)");
  const nonGit = makeWorkspace("nongit");
  t.after(() => fs.rmSync(nonGit, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(nonGit, "gap-anything"), false, "non-git root ⇒ fail-safe false (no false positive from an unavailable source)");
});

// ── PHANTOM-KILLER FALSE NEGATIVE (tasks/gap-phantom-killer-false-negative-id-not-in-commits) ───────
// hasLandedImplementation reads `git log develop --grep <taskId>` — when the implementation commits
// never carry the task id (the empirical case: gap-superseded-modeled-as-task-lifecycle-terminal, impl
// deba6463 etc. on develop, ACs 8/9 with the ONLY unchecked item the outer full-suite verification,
// status ready → still recommended) the grep misses and a LANDED task is still recommended. The fix
// ORs in a task-body-side landed signal (isBodyLanded — ACs 全勾 + every remaining unchecked item is
// outer-verification （待外部）/「外层全量验证」⇒ 视同 landed, AC2). Negative control: a genuinely-new task
// (lanes-nproc/two-peer class — id matches only task-creation/frame commits) judges NOT landed (AC3).
// AC1: the incidence observation point — phantom_killer_false_negative_caught counts body-caught /
// git-missed tasks.
