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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 13/20 (6 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, analyzeTasks, assert, dispatchableBody, execFileSync, fannedInBody, fs, hasFanInMerge, hasLandedImplementation, isNotYetFlippedSkip, legacyAllRefsHasFanInMerge, makeFannedInWorkspace, makePreFanInMergeWorkspace, makeWorkspace, os, path, runGit, writeTask } from "./helpers/slot-refill-harness.mjs";

test("NOT-YET-FLIPPED — the adhoc `merge: <id>` fan-in format is also caught (bare-id arm of hasFanInMerge)", (t) => {
  const root = makeFannedInWorkspace("bare", { mergeFormat: "bare" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(4, 5) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-fanned"), "bare-id-format fan-in is also skipped");
});


test("NOT-YET-FLIPPED — a fanned-in task with ACs at/under 50% stays dispatchable (stuck-work not trapped, gap-ready-pool-worklanded-traps-stuck-work parity)", (t) => {
  const root = makeFannedInWorkspace("stuck");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 2/5 = 40% — the merge record fired, but the AC-completeness gate (>50% or all) keeps it dispatchable:
  // an AC-incomplete fan-in is genuinely stuck-work with real remaining implementation, not done-work.
  writeTask(root, "gap-fanned", { status: "ready", labels: ["gap"], body: fannedInBody(2, 5) });
  writeTask(root, "gap-stuck", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/stuck.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(r.recommended.includes("gap-fanned"), "fanned-in but AC-incomplete task stays dispatchable (stuck-work)");
  assert.ok(r.recommended.includes("gap-stuck"));
});


test("NOT-YET-FLIPPED — a task ready-pool-check already excluded as not-yet-flipped is never in recommended (AC2 pool.excluded arm)", (t) => {
  const root = makeWorkspace("excluded-arm");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // All ACs checked ⇒ ready-pool-check's notYetFlipped all_acs_checked branch fires ⇒ pool.excluded.
  writeTask(root, "gap-excluded", { status: "ready", labels: ["gap"], body: fannedInBody(3, 3) });
  writeTask(root, "gap-open", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/open.ts (new)"]) });
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 3 });
  assert.ok(!r.recommended.includes("gap-excluded"), "already-excluded not-yet-flipped task is never recommended");
  assert.ok(r.recommended.includes("gap-open"), "dispatchable sibling still recommended");
});


test("isNotYetFlippedSkip — pure unit: excludedNyfIds arm, merge arm, AC gate, total=0 (AC2)", (t) => {
  const root = makeFannedInWorkspace("unit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body4of5 = fannedInBody(4, 5);
  // (a) excludedNyfIds arm — true regardless of merge/AC state.
  assert.equal(isNotYetFlippedSkip({ id: "gap-any", body: body4of5, root, excludedNyfIds: new Set(["gap-any"]) }), true);
  // (b) no merge record ⇒ false (even with complete ACs — the pool.excluded arm is the only way).
  assert.equal(isNotYetFlippedSkip({ id: "gap-nomerge", body: body4of5, root, excludedNyfIds: new Set() }), false);
  // (c) merge record + 4/5 ACs ⇒ true.
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: body4of5, root, excludedNyfIds: new Set() }), true);
  // (d) merge record + 2/5 ACs ⇒ false (stuck-work stays dispatchable).
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: fannedInBody(2, 5), root, excludedNyfIds: new Set() }), false);
  // (e) merge record + zero AC boxes ⇒ false (total=0 ⇒ no gate).
  assert.equal(isNotYetFlippedSkip({ id: "gap-fanned", body: fannedInBody(0, 0), root, excludedNyfIds: new Set() }), false);
  // (f) hasFanInMerge itself: merge record fires, and a plain (non-merge) commit never does.
  assert.equal(hasFanInMerge(root, "gap-fanned"), true, "the fan-in merge record is durable evidence");
  assert.equal(hasFanInMerge(root, "gap-nonexistent"), false);
});

// ── LEFTOVER-WORKTREE EXEMPTION (gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption) ──
// slot-refill's `excludedNyfIds` is DERIVED from ready-pool-check.analyzeTasks' pool.excluded (reason
// "not-yet-flipped") — single source. Before the fix, an allChecked task whose fan-in FAILED (a leftover
// `task/<id>` worktree, no merge record) was excluded by the allChecked arm ⇒ excludedNyfIds ⇒
// isNotYetFlippedSkip true ⇒ deferred forever. After the fix, the leftover worktree exempts the
// allChecked arm ⇒ the task stays in pool.ready (dispatchable) ⇒ NOT in excludedNyfIds ⇒ not skipped.
// AC5: the slot-refill consumer is correct with NO slot-refill change.


test("NOT-YET-FLIPPED — a leftover task/<id> worktree exempts the allChecked arm ⇒ task NOT in excludedNyfIds ⇒ isNotYetFlippedSkip false (leftover-worktree exemption, AC5)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-leftover-`));
  const wtPath = path.join(dir, "..", `${path.basename(dir)}-leftover`);
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");

  const id = "gap-nyf-leftover";
  // All 3 ACs checked; `code/touched.ts` is an existing (non-(new)) touch ⇒ taskWorkLanded stays false;
  // no merge record ⇒ the ONLY not-yet-flipped candidate signal is the allChecked arm.
  writeTask(dir, id, { status: "ready", labels: ["gap"], body: fannedInBody(3, 3) });
  // The leftover task/<id> worktree (the fan-in-failed shape — branch present, never merged).
  runGit(dir, "worktree", "add", "-q", "-b", `task/${id}`, wtPath);

  // Single source: analyzeTasks keeps the task in ready (not excluded) ⇒ excludedNyfIds is empty.
  const pool = analyzeTasks({ tasksDir: path.join(dir, "tasks"), root: dir });
  const excludedNyfIds = new Set(
    (pool.excluded || []).filter((e) => e.reasons.includes("not-yet-flipped")).map((e) => e.id),
  );
  assert.equal(pool.ready.includes(id), true, "leftover-worktree allChecked task stays in pool.ready — dispatchable (AC5)");
  assert.equal(excludedNyfIds.has(id), false, "leftover-worktree allChecked task is NOT in excludedNyfIds (AC5)");
  assert.equal(isNotYetFlippedSkip({ id, body: fannedInBody(3, 3), root: dir, excludedNyfIds }), false,
    "isNotYetFlippedSkip false — not deferred as not-yet-flipped (AC5)");

  // Negative control: removing the worktree restores the 2026-08-08 allChecked exclusion.
  runGit(dir, "worktree", "remove", "--force", wtPath);
  const pool2 = analyzeTasks({ tasksDir: path.join(dir, "tasks"), root: dir });
  const excludedNyfIds2 = new Set(
    (pool2.excluded || []).filter((e) => e.reasons.includes("not-yet-flipped")).map((e) => e.id),
  );
  assert.equal(excludedNyfIds2.has(id), true, "without the worktree the allChecked task is excluded again (AC5 negative control)");
});

// ── FAN-IN REACHABILITY, NOT EXISTENCE (tasks/gap-hasfaninmerge-all-refs-strands-exited-not-landed-tasks) ──
// `hasFanInMerge` used `git log --all --merges --grep <id>`, which counts the TASK BRANCH ITSELF: every
// worker runs `git merge develop` on its task branch BEFORE fan-in, producing a `Merge branch 'develop'
// into task/<id>` merge whose message carries the task id. So a worker that reached the merge step and
// then FAILED to land (exited-not-landed) looked permanently "fanned in" — isNotYetFlippedSkip deferred
// it as not-yet-flipped forever (its remaining ACs are usually "全量绿" and nothing would ever run them)
// ⇒ structurally stranded at both ends. The predicate that was always meant is REACHABILITY from the
// integration line — the read the sibling `hasLandedImplementation` already used (`git log develop`).
// Measured in this repo 2026-09-11: 7 ready tasks had an id-matching merge, none reachable from develop.

/** The PRE-FIX read, verbatim (`git log --all --merges --grep <id>`), kept as a fixture control: it is
 *  what "改前返回 true" means mechanically, so the AC1 red direction is asserted by EXECUTING the old
 *  command, not by asserting it in prose. Never used by production code. */

/** The REAL stranded shape (形态 A), built with real git — no mocks. `landed:false` ⇒ the task branch
 *  carries a `Merge branch 'develop' into task/<id>` merge (the worker's pre-fan-in develop sync) and
 *  the branch was NEVER merged back ⇒ that merge is reachable only from the task branch itself.
 *  `landed:true` ⇒ the fan-in actually happened as an ff of develop onto the task branch (the
 *  two-line model's landing) ⇒ the SAME merge commit becomes an ancestor of develop. One fixture,
 *  one flag, so A and B differ by exactly the landing event and nothing else (AC4's control). */


test("FAN-IN REACHABILITY AC1 — 形态 A：任务分支上有一条 `Merge branch 'develop' into task/<id>` 且从未合回 develop，该 merge 对 --all 可见（缺陷复现：改前 hasFanInMerge 返回 true）", (t) => {
  const { dir, id } = makePreFanInMergeWorkspace("ac1");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // premise: the merge commit exists and its message carries the task id…
  const merges = execFileSync("git", ["-C", dir, "log", "--all", "--format=%s", "--merges", "--grep", id], { encoding: "utf8" }).trim();
  assert.equal(merges, `Merge branch 'develop' into task/${id}`, "fixture premise: the pre-fan-in develop-sync merge is the ONLY id-matching merge");
  // …and the PRE-FIX read fires on it (this is the red direction AC1 names).
  assert.equal(legacyAllRefsHasFanInMerge(dir, id), true, "改前读法（--all）对形态 A 返回 true — 缺陷复现");
  // …while it is NOT an ancestor of develop (the branch never landed).
  const reachable = execFileSync("git", ["-C", dir, "log", "develop", "--format=%H", "--merges", "--grep", id], { encoding: "utf8" }).trim();
  assert.equal(reachable, "", "fixture premise: no id-matching merge is reachable from develop");
});
