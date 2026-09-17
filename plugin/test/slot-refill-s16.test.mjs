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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 16/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, bodyLandedOuterUncheckedBody, dispatchableBody, fs, hasLandedImplementation, isBodyLanded, isImplementationClassFile, isLandedCodeComplete, isOuterVerificationItem, landedNoCheckboxBody, makeLandedNoIdWorkspace, makeLandedWorkspace, makeSidecarCommitWorkspace, makeTaskOnlyCommitWorkspace, path, writeTask } from "./helpers/slot-refill-harness.mjs";

test("PHANTOM-KILLER FALSE NEGATIVE — a landed task whose implementation commits never carry the id (superseded-modeled shape) is NOT recommended (AC1/AC2/AC3)", (t) => {
  const root = makeLandedNoIdWorkspace("body", "gap-superseded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pure-git: NO develop commit names the id ⇒ hasLandedImplementation is false — the false negative.
  assert.equal(hasLandedImplementation(root, "gap-superseded"), false, "git-grep misses the id-less implementation (the false negative)");
  // Body-side: ACs 全勾 + the ONLY unchecked item is the outer full-suite verification ⇒ landed.
  const body = bodyLandedOuterUncheckedBody();
  assert.equal(isOuterVerificationItem("全量套件绿（`fail 0`）——外层 verification-round 验证"), true, "the outer full-suite item is recognized as outer-verification (AC2)");
  assert.equal(isBodyLanded(body), true, "ACs 全勾 + 唯一未勾是外层验证 ⇒ body-side landed (AC2)");
  assert.equal(isLandedCodeComplete(body), true, "the completion gate also recognizes the outer family (AC2)");
  // End-to-end: the landed-but-id-less task is deferred, NOT recommended; a genuinely-new peer still is.
  writeTask(root, "gap-superseded", { status: "ready", labels: ["gap"], body });
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/fresh.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-superseded"), "id-less landed task is NOT recommended (AC2)");
  const reasons = (r.deferred || []).filter((d) => d.id === "gap-superseded").map((d) => d.reason);
  assert.ok(reasons.includes("landed-implementation"), `deferred landed-implementation, got: ${reasons.join(",")}`);
  assert.ok(r.recommended.includes("gap-fresh"), "a genuinely-new ready task is still recommended (AC3 negative control)");
  assert.equal(r.phantom_killer_false_negative_caught, 1, "the body-side catch of a git-missed task is counted (AC1)");
});


test("PHANTOM-KILLER FALSE NEGATIVE — a genuinely-new task (lanes-nproc/two-peer class, id in task-creation commit only) judges NOT landed (AC3 negative control)", (t) => {
  const root = makeTaskOnlyCommitWorkspace("neg", "gap-lanes-nproc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The id matches only the task-creation commit (tasks/<id>.md) — not implementation-class ⇒ git
  // signal false; the body is a genuinely-new dispatchable body with OPEN implementation ACs ⇒
  // body-side signal false. Judge NOT landed.
  const body = dispatchableBody(["- code/lanes.ts (new)"]);
  assert.equal(hasLandedImplementation(root, "gap-lanes-nproc"), false, "task-creation-only commit is not landed implementation (AC3)");
  assert.equal(isBodyLanded(body), false, "a genuinely-new task with open ACs is NOT body-side landed (AC3)");
  writeTask(root, "gap-lanes-nproc", { status: "ready", labels: ["gap"], body });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-lanes-nproc"), "a genuinely-new ready task is still recommended (AC3)");
  assert.equal(r.phantom_killer_false_negative_caught, 0, "no false-negative catch for a genuinely-new task (AC1)");
});


test("PHANTOM-KILLER FALSE NEGATIVE — isBodyLanded pure: no-checkbox body NOT landed from body alone; （待外部）-annotated body landed (AC2 fail-safe)", () => {
  assert.equal(isBodyLanded(landedNoCheckboxBody()), false, "a no-checkbox task is NOT judged landed from body alone (would be a false positive)");
  assert.equal(isBodyLanded(dispatchableBody(["- code/x.ts (new)"])), false, "an open-AC dispatchable body is not landed");
  const annotated = bodyLandedOuterUncheckedBody().replace(
    "- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证",
    "- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）（待外部）",
  );
  assert.equal(isBodyLanded(annotated), true, "（待外部）-annotated outer item ⇒ body-side landed (reuses the pool's single-source predicate)");
  assert.equal(isOuterVerificationItem("AC1: a long enough acceptance criterion item number 1"), false, "an implementation AC is NOT outer-verification (fail-closed)");
});

// ── IMPLEMENTATION-CLASS FILE CLASS (gap-slot-refill-landed-detection-implementation-file-classes) ──
// The phantom-killer fix: hasLandedImplementation used to count ANY non-tasks/ file as landed-
// implementation evidence — a task-creation/analysis commit that incidentally touched a doc or
// telemetry sidecar (streaming-red 51699289 touched milestones/fast-mode-telemetry/*.json;
// worktree-node-modules 1f99e276 touched docs/analysis/*.md) judged the task "landed" with AC 0/10,
// no fan-in — real work suppressed by the killer. The evidence file must be IMPLEMENTATION-CLASS:
// packages/ · plugin/scripts/ · plugin/test/ · scripts/ · src/ (AC1 whitelist); docs/milestones/
// .quay/ telemetry sidecars never count (AC2 negative controls); a real landed task still judges true
// (AC3 positive control).


test("LANDED-IMPLEMENTATION — AC1: isImplementationClassFile whitelist — implementation landing points true, docs/milestones/.quay/telemetry sidecars false", () => {
  for (const p of [
    "packages/quay/src/gate/engine.js",
    "plugin/scripts/slot-refill.ts",
    "plugin/test/slot-refill.test.mjs",
    "scripts/test.sh",
    "src/main.ts",
  ]) {
    assert.equal(isImplementationClassFile(p), true, `${p} is an implementation-class landing point`);
  }
  for (const p of [
    "tasks/gap-x.md",
    "docs/analysis/batch2-queue-state.md",
    "milestones/fast-mode-telemetry/2026-08-13.json",
    ".quay/config.yml",
    "adr/ADR-001.md",
    "orchestration/manager-tick-core.md",
    "CLAUDE.md",
    "orchestration/manager-obligation-ledger.jsonl",
  ]) {
    assert.equal(isImplementationClassFile(p), false, `${p} is a sidecar / doc / telemetry path, NOT implementation-class`);
  }
});


test("LANDED-IMPLEMENTATION — AC2 NEGATIVE CONTROLS: a commit touching only tasks/ + a doc/telemetry sidecar is NOT landed (streaming-red 51699289 shape / worktree-node-modules 1f99e276 shape)", (t) => {
  // streaming-red shape: the task-creation commit 51699289 incidentally touched
  // milestones/fast-mode-telemetry/2026-08-13.json (+ tasks/*.md) ⇒ must judge FALSE (AC 0/10, no fan-in).
  const streaming = makeSidecarCommitWorkspace(
    "neg-streaming",
    "gap-streaming-red-cascade-amplifies-failures-array",
    "milestones/fast-mode-telemetry/2026-08-13.json",
  );
  t.after(() => fs.rmSync(streaming, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(streaming, "gap-streaming-red-cascade-amplifies-failures-array"), false,
    "streaming-red (milestones/ telemetry sidecar) is NOT landed implementation — real work not suppressed (AC2)");

  // worktree-node-modules shape: the analysis commit 1f99e276 incidentally touched
  // docs/analysis/batch2-queue-state.md (+ tasks/*.md) ⇒ must judge FALSE (AC 0/10, no fan-in).
  const wtnm = makeSidecarCommitWorkspace(
    "neg-wtnm",
    "gap-worktree-node-modules-inconsistent-self-verify",
    "docs/analysis/batch2-queue-state.md",
  );
  t.after(() => fs.rmSync(wtnm, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(wtnm, "gap-worktree-node-modules-inconsistent-self-verify"), false,
    "worktree-node-modules (docs/ sidecar) is NOT landed implementation — real work not suppressed (AC2)");
});


test("LANDED-IMPLEMENTATION — AC3 POSITIVE CONTROL: a real landed task (implementation-class file changed, id in the merge message) still judges TRUE", (t) => {
  // The runner-spawn code commit 1f2326e2 changed plugin/scripts/full-suite-runner.ts +
  // plugin/test/full-suite-runner.test.mjs — but its message does NOT name the task id, so the
  // grep-based predicate cannot see it. The representative real landed task whose develop merge DOES
  // name the id AND changed an implementation-class file is the predecessor of this very predicate:
  // gap-slot-refill-recommends-landed-code-complete-tasks (fan-in c6fc14a7 changed plugin/scripts/
  // ready-pool-check.ts + plugin/scripts/slot-refill.ts + plugin/test/slot-refill.test.mjs). The
  // fixture rebuilds that exact shape (merge message names the id; first-parent diff changed
  // plugin/scripts/impl.ts — an implementation-class landing point).
  const root = makeLandedWorkspace("pos-real", "gap-slot-refill-recommends-landed-code-complete-tasks");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(hasLandedImplementation(root, "gap-slot-refill-recommends-landed-code-complete-tasks"), true,
    "a real landed task (implementation-class file changed, id in the merge message) still judges TRUE (AC3 positive control)");
});
