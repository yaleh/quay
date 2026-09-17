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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 17/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, countAcCheckboxes, countCompletionCheckboxes, dir014SuffixedBody, dispatchableBody, fs, hasFanInMerge, hasLandedImplementation, isBodyLanded, isLandedCodeComplete, isNotYetFlippedSkip, landedAllCheckedBody, landedNoCheckboxBody, landedStuckWorkBody, makeLandedWorkspace, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("LANDED-IMPLEMENTATION — isLandedCodeComplete: all-checked true, open implementation items false (stuck-work), (待外部)-only true", () => {
  assert.equal(isLandedCodeComplete(landedAllCheckedBody()), true, "all ACs checked (shape-aware ## AC) ⇒ code-complete");
  assert.equal(isLandedCodeComplete(landedStuckWorkBody(2, 5)), false, "open implementation ACs ⇒ NOT code-complete (stuck-work)");
  assert.equal(isLandedCodeComplete(landedNoCheckboxBody()), true, "no completion boxes ⇒ the landing is its closeout (code-complete)");
  assert.equal(isLandedCodeComplete(dispatchableBody(["- code/x.ts (new)"])), false, "an in-progress ready task with an open AC is not code-complete");
  // awaiting-verification: every open item annotated （待外部）
  const ext = landedStuckWorkBody(2, 3).replace(
    "- [ ] AC3: a long enough acceptance criterion item number 3",
    "- [ ] AC3: await external verification （待外部）",
  );
  assert.equal(isLandedCodeComplete(ext), true, "every remaining item （待外部） ⇒ code-complete (awaiting verification)");
});



test("AC47 — SHAPE_SECTIONS registration: the DIR-014 suffixed AC/DoD headings ARE recognized and its 5 unchecked boxes are counted (AC3)", () => {
  const cb = countCompletionCheckboxes(dir014SuffixedBody());
  assert.equal(cb.sectionFound, true, "registered suffixed headings are recognized (sectionFound:true)");
  assert.equal(cb.total, 5, "the 5 unchecked boxes under the suffixed AC heading are COUNTED (AC3)");
  assert.equal(cb.checked, 0);
  assert.equal(cb.unchecked, 5);
});


test("AC47 — negative control on DIR-014's suffixed-heading + 5 unchecked boxes: NONE of the 5 consumers reports complete/landed (AC2)", (t) => {
  const body = dir014SuffixedBody();
  const cb = countCompletionCheckboxes(body);
  // 1. slot-refill:373 isLandedCodeComplete (the MAIN fail-open — fed landed judgment): not landed.
  assert.equal(isLandedCodeComplete(body), false, "DIR-014 shape is NOT judged landed (AC2)");
  assert.equal(isBodyLanded(body), false, "the body-side landed OR-in also does NOT fire (AC2)");
  // 2. slot-refill:274 isNotYetFlippedSkip (destructures countAcCheckboxes): not wrongly skipped. Its
  //    literal `## Acceptance Criteria` extractSection cannot see the suffixed heading → section
  //    found=false → fail-closed (not a not-yet-flipped skip).
  const root = makeLandedWorkspace("ac47-nyf", "gap-ac47-ctl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasFanInMerge(root, "gap-ac47-ctl"), true, "precondition: the id's branch was fanned in");
  assert.equal(
    isNotYetFlippedSkip({ id: "gap-ac47-ctl", body, root, excludedNyfIds: new Set() }),
    false,
    "unreadable literal AC section ⇒ NOT a not-yet-flipped skip (AC2)",
  );
  // 3. ready-pool-check:793 allChecked (countCompletionCheckboxes + `total > 0 && checked === total`):
  //    total=5, checked=0 → allChecked false.
  assert.equal(cb.total > 0 && cb.checked === cb.total, false, "not all-checked (AC2)");
  // 4. ready-pool-check:1754 acOpen = cb.unchecked → 5 (not 0) → NOT the "clean backlog" (甲) split.
  assert.equal(cb.unchecked === 0, false, "acOpen=5 ≠ 0 ⇒ NOT mis-split as clean backlog (AC2)");
  // 5. task-status-drift-check:810 closed-without-work guard `acBoxes.total > 0` — it reads the LITERAL
  //    `## Acceptance Criteria` section (extractSection → null for the suffixed heading) → countAcCheckboxes
  //    is fail-closed NaN → NaN > 0 is false → the guard does NOT fire → not flagged "pass" (AC2).
  const literalAc = null; // the suffixed heading is invisible to the literal extractSection
  const acBoxes = countAcCheckboxes(literalAc);
  assert.equal(acBoxes.total > 0 && acBoxes.checked === 0, false, "closed-without-work guard does not fire on an unreadable section (AC2)");
  assert.equal(Number.isNaN(acBoxes.total), true, "the fail-closed NaN shape is what makes old read-patterns structurally unable to pass");
});


test("AC47 — an UNREGISTERED suffixed variant fails CLOSED (sectionFound:false, no consumer can judge complete/landed)", () => {
  // `## Acceptance Criteria for the OLD design` is NOT in SHAPE_SECTIONS — prefix-matching would
  // wrongly swallow it; explicit registration means it is unrecognized → fail-closed.
  const unregistered = [
    "## Contract",
    "measure   x = 1",
    "## Acceptance Criteria for the OLD design",
    "- [ ] a real remaining unchecked box",
    "## Definition of Done",
    "standard",
  ].join("\n");
  const cb = countCompletionCheckboxes(unregistered);
  assert.equal(cb.sectionFound, false, "an unregistered suffixed heading is NOT recognized (AC3)");
  assert.equal(Number.isNaN(cb.total), true, "absent/unrecognized section ⇒ total NaN (fail-closed structural guarantee)");
  assert.equal(cb.total === 0, false, "total is NOT 0 — the old fail-open ({unchecked:0} → complete) is impossible");
  assert.equal(isLandedCodeComplete(unregistered), false, "an unregistered-variant task is NOT judged landed (AC1/AC2)");
  assert.equal(isBodyLanded(unregistered), false, "an unregistered-variant task is NOT judged body-side landed (AC1/AC2)");
});

// ── MUTEX-CLIQUE LANDED-IGNORE (tasks/gap-slot-refill-clique-ignores-landed-touches) ─────────────────
// The phantom-killer's recommendation exclusion (landed && code-complete) did NOT cover the impact of a
// landed-but-NOT-code-complete task's touches on the MUTEX CLIQUE: its implementation is already in the
// tree (it won't/shouldn't be re-dispatched as new work), yet its `## Touches` kept occupying the batch
// clique and crowded out a genuinely-dispatchable task touching the same file — the measured
// phase-overlap → 2-slot exclusion (P1 dropped from recommended AND deferred, in-clique crowding with no
// reading). AC1: the clique computation ignores the touches of hasLandedImplementation=true ready tasks
// (reusing the existing signal, never a new fetch); AC2: a landed-but-not-flipped task + a real new task
// touching the same file ⇒ the new task is NOT crowded out, and the recommendation exclusion for a
// code-complete landed task still holds; AC4: two NON-landed tasks touching the same file remain mutually
// exclusive (the change never relaxes real-overlap serialization).


test("CLIQUE-LANDED — AC1/AC2: a landed-but-not-flipped task's touches leave the mutex clique (phase-overlap shape); the real task touching the same file is recommended; the stuck-work landed task stays dispatchable", (t) => {
  const root = makeLandedWorkspace("clique-pos", "gap-overlap");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The shared file BOTH conflicting tasks touch must EXIST (a non-(new) touch resolves to the tree).
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/bin/sh\necho test\n");
  // gap-overlap: implementation LANDED (plugin/scripts/impl.ts merged into develop — hasLandedImplementation
  // fires) but 2/5 open implementation ACs ⇒ isLandedCodeComplete=false — the exact phase-overlap
  // pre-flip shape (landed-but-not-code-complete, e.g. a DoD meta box not annotated （待外部）). Touches
  // scripts/test.sh (the shared file) — and it is NOT not-yet-flipped (2/5 ≤ 50%), NOT deferred by the
  // recommendation exclusion (not code-complete), so it reaches the candidate list.
  writeTask(root, "gap-overlap", {
    status: "ready", labels: ["gap"],
    body: landedStuckWorkBody(2, 5).replace("- plugin/scripts/impl.ts", "- scripts/test.sh"),
  });
  // gap-p1: a genuinely-dispatchable NEW task touching the SAME file (the measured 2-slot task P1).
  writeTask(root, "gap-p1", {
    status: "ready", labels: ["gap"],
    body: dispatchableBody(["- scripts/test.sh", "- code/p1.ts (new)"]),
  });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  // AC1/AC2 primary: P1 IS recommended — its clique collision with the landed task's touches is ignored
  // (pre-fix the landed task's touches blocked it in the batch: neither recommended nor deferred).
  assert.ok(r.recommended.includes("gap-p1"), "AC2: the real new task is NOT crowded out by the landed task's touches");
  // AC1/stuck-work parity: the landed-but-not-code-complete task stays a candidate and is recommended —
  // it is NOT deferred; only its touches leave the clique (gap-ready-pool-worklanded-traps-stuck-work).
  assert.ok(r.recommended.includes("gap-overlap"), "AC1: the landed stuck-work task stays dispatchable (only its touches are clique-exempt)");
  // AC56 去序: `recommended` is de-ordered (lexicographic) — the batch's internal "real work first,
  // landed re-appended after" priority is no longer an OUTPUT property. The AC1/AC2 guarantee (real
  // work NOT crowded out of the SET — landed touches never displace real work) is the membership
  // assertion above; the dispatch array itself must not encode a priority order.
  assert.deepEqual(
    r.recommended,
    ["gap-overlap", "gap-p1"],
    "recommended is de-ordered (lexicographic: overlap < p1) — the dispatch array no longer encodes the landed-vs-real priority (AC56)",
  );
});


test("CLIQUE-LANDED — AC2 guard: the recommendation exclusion (landed && code-complete) still holds — a code-complete landed task is not re-recommended even in the same fixture", (t) => {
  const root = makeLandedWorkspace("clique-guard", "gap-complete");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // gap-complete: implementation LANDED (merged into develop) AND all completion boxes checked ⇒
  // code-complete. The recommendation exclusion must still keep it out of recommended (AC2: 不重新推荐
  // landed 任务) — it is pool-excluded (allChecked) and/or deferred landed-implementation, never in the
  // batch clique.
  writeTask(root, "gap-complete", { status: "ready", labels: ["gap"], body: landedAllCheckedBody() });
  // gap-fresh: a genuinely-new ready task (no landing record) — must still be recommended.
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-complete"), "AC2: a code-complete landed task is still excluded from recommendation");
  assert.ok(r.recommended.includes("gap-fresh"), "AC2: a genuinely-new ready task is still recommended");
});
