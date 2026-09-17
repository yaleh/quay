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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/12 (10 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, dispatchableBody, execFileSync, fannedInBody, fs, hasFanInMerge, hasLandedImplementation, isBodyLanded, isLandedCodeComplete, isNotYetFlippedSkip, landedAllCheckedBody, landedNoCheckboxBody, landedStuckWorkBody, legacyAllRefsHasFanInMerge, makeLandedWorkspace, makePreFanInMergeWorkspace, makeTaskOnlyCommitWorkspace, makeWorkspace, os, path, runGit, writeTask } from "./helpers/slot-refill-harness.mjs";

test("FAN-IN REACHABILITY AC4 — 双向控制：形态 B（分支已 ff 进 develop）改前改后均返回 true，真 fan-in 未被一并判否", (t) => {
  const { dir, id } = makePreFanInMergeWorkspace("ac4", { landed: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(legacyAllRefsHasFanInMerge(dir, id), true, "改前读法对形态 B 返回 true（控制：形态 B 本来就是真 fan-in）");
  assert.equal(hasFanInMerge(dir, id), true, "修后 hasFanInMerge 对形态 B 仍返回 true — 没有把真 fan-in 一并判否 (AC4)");
  // The ONE difference between A and B is the landing: the same merge commit flips from
  // not-reachable to reachable. Assert that directly so AC4 is not a fixture-identity claim.
  const reachable = execFileSync("git", ["-C", dir, "log", "develop", "--format=%s", "--merges", "--grep", id], { encoding: "utf8" }).trim();
  assert.equal(reachable, `Merge branch 'develop' into task/${id}`, "the pre-fan-in merge IS an ancestor of develop after the ff landing");
});


test("FAN-IN REACHABILITY AC2 — 集成分支由参数传入（非 develop 的集成分支可显式指定）：默认只认 develop", (t) => {
  // A repo whose integration line is named `trunk` (NOT develop): the merge is reachable from trunk
  // only. The DEFAULT call must not count it (the default resolves the develop line — behaviourally,
  // not by asserting the constant's own value), and the explicit ref must.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-intref-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const d of ["tasks", "code", ".quay"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  runGit(dir, "init", "-q");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "base");
  runGit(dir, "branch", "-M", "develop");
  const id = "gap-otherline";
  runGit(dir, "checkout", "-qb", `task/${id}`);
  runGit(dir, "checkout", "-q", "develop");
  fs.writeFileSync(path.join(dir, "code", "elsewhere.ts"), "// develop work\n");
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "develop work");
  runGit(dir, "checkout", "-q", `task/${id}`);
  runGit(dir, "merge", "--no-ff", "develop", "-m", `Merge branch 'develop' into task/${id}`);
  // the OTHER integration line: a ff-only landing on `trunk`, leaving develop behind.
  runGit(dir, "checkout", "-q", "develop");
  runGit(dir, "branch", "trunk");
  runGit(dir, "checkout", "-q", "trunk");
  runGit(dir, "merge", "--ff-only", `task/${id}`);
  runGit(dir, "checkout", "-q", "develop");

  assert.equal(hasFanInMerge(dir, id), false, "默认（develop）不把只落在别的集成分支上的 merge 算作 fan-in (AC2)");
  assert.equal(hasFanInMerge(dir, id, "trunk"), true, "显式传入集成分支 ⇒ 该线上的 merge 被认作 fan-in (AC2)");
  // The default is the develop line specifically — the two calls above differ ONLY by the ref, which
  // is why the parameter (not a second hardcoded literal) is the mechanism.
  assert.equal(isNotYetFlippedSkip({ id, body: fannedInBody(4, 5), root: dir, excludedNyfIds: new Set() }), false,
    "isNotYetFlippedSkip 默认读 develop ⇒ 形态（只落在 trunk）不判 not-yet-flipped");
  assert.equal(isNotYetFlippedSkip({ id, body: fannedInBody(4, 5), root: dir, excludedNyfIds: new Set(), integrationRef: "trunk" }), true,
    "isNotYetFlippedSkip 接受同一个参数并透传 ⇒ trunk 上的落地被认作已 fan-in (AC2/AC5 参数链)");
});


test("FAN-IN REACHABILITY AC5 — isNotYetFlippedSkip 对形态 A 返回 false、对形态 B（AC 全勾）返回 true", (t) => {
  const a = makePreFanInMergeWorkspace("ac5a");
  const b = makePreFanInMergeWorkspace("ac5b", { landed: true });
  t.after(() => { fs.rmSync(a.dir, { recursive: true, force: true }); fs.rmSync(b.dir, { recursive: true, force: true }); });
  // 形態 A: 7/8 ACs (>50%) — under the pre-fix read this was `true` (deferred forever, the strand).
  assert.equal(isNotYetFlippedSkip({ id: a.id, body: fannedInBody(7, 8), root: a.dir, excludedNyfIds: new Set() }), false,
    "形态 A（merge 不可达 develop）⇒ 不判 not-yet-flipped ⇒ 可派发 (AC5)");
  // 形态 B: all ACs checked, work really landed ⇒ deferred (not re-dispatched).
  assert.equal(isNotYetFlippedSkip({ id: b.id, body: fannedInBody(3, 3), root: b.dir, excludedNyfIds: new Set() }), true,
    "形态 B（已 ff 进 develop）⇒ 判 not-yet-flipped ⇒ 不重复派发 (AC5)");
  // Same fixture family, AC-completeness arm unchanged (the fix touches reachability only).
  assert.equal(isNotYetFlippedSkip({ id: b.id, body: fannedInBody(1, 3), root: b.dir, excludedNyfIds: new Set() }), false,
    "形态 B 但 AC 仅 1/3 ⇒ 仍是 stuck-work，可派发（AC 闸未被本次修法改动）");
});


test("FAN-IN REACHABILITY AC5-consumer — 端到端：形态 A 的任务重新进入 recommended（不再被 step-4 判 not-yet-flipped）", (t) => {
  const { dir, id } = makePreFanInMergeWorkspace("consumer");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTask(dir, id, { status: "ready", labels: ["gap"], body: fannedInBody(7, 8) });
  const r = analyzeSlotRefill({ tasksDir: path.join(dir, "tasks"), root: dir, cap: 3 });
  const nyf = r.deferred.filter((d) => d.id === id && d.reason === "not-yet-flipped");
  assert.deepEqual(nyf, [], "形态 A 的任务不再被 deferred as not-yet-flipped（AC3 在消费者层的读数）");
  assert.ok(r.recommended.includes(id), "形态 A 的任务重新进入 recommended ⇒ 结构性搁浅解除 (AC5)");
});

// ── LANDED-IMPLEMENTATION (tasks/gap-slot-refill-recommends-landed-code-complete-tasks) ──────────────
// slot-refill's recommended used to PERMANENTLY include tasks whose IMPLEMENTATION is already in the
// tree — a develop commit whose message contains the task id AND changed files outside tasks/ — but
// whose status is still `ready` awaiting the closure batch (the "landed-but-not-flipped" shape;
// observed 4-6 times/day: ac53-end-invariant / src-n-anchor / precommit-guard / npm-pack / catalog /
// runner-grouping, all "代码已合进 develop、ACs 全勾、只差绿轮验证后的 closure"). step-4 checked only
// DECLARATIONS (touches / deps / C8 self-touch), never TREE FACTS — the B9 force-dispatch chain
// pointed at code-complete work. AC1: the new step-4 check excludes landed tasks from recommended;
// AC2: negative control (a genuinely-new task / nonexistent id is NOT excluded); AC3: the MERGE-landing
// shape is recognized (-m --first-parent — without it a merge shows 0 files, measured 7418c615);
// AC4: a commit that only touches tasks/<id>.md is NOT "implementation" (files must be outside tasks/).

/** A ready body with ALL ACs checked under the `## AC` heading (NOT `## Acceptance Criteria`) — the
 *  realistic phantom-task shape ("ACs 全勾"). Touches the MERGED implementation file `code/impl.ts`
 *  WITHOUT (new) so it resolves against the tree (not majority-missing). NOTE: an all-checked ready
 *  task is ALSO excluded by ready-pool-check's notYetFlipped (`allChecked` arm) at the pool level — so
 *  the AC1 outcome holds for this shape via the pool exclusion (defense-in-depth layering), while the
 *  NEW step-4 check fires on the shape that ready-pool-check's declared-touches signals MISS (see
 *  landedNoCheckboxBody below). */

/** A ready body with NO completion checkboxes (total=0 — the landing is its closeout, per the
 *  isLandedCodeComplete gate) whose Touches declare a `(new)` file that does NOT exist on disk —
 *  so ready-pool-check's workLanded signals do NOT fire (no git-history on the declared touches, no
 *  landed (new) touch, no resolvable AC symbol) AND the commit-trace arm does NOT fire (the fixture's
 *  merge message is neutral — see makeLandedWorkspace's mergeMessage). The task therefore STAYS in
 *  pool.ready and REACHES slot-refill's new landed-implementation step-4 check — the exact
 *  defense-in-depth case the predicate adds: the id is in develop history but the declared-touches
 *  signals missed it. */

/** A ready body with open IMPLEMENTATION ACs (2/5) that touches the MERGED file `code/impl.ts` — the
 *  stuck-work shape: the code is in the tree but the task body declares real remaining implementation,
 *  so the completion gate must keep it dispatchable (gap-ready-pool-worklanded-traps-stuck-work). */

/** Build a REAL temp git repo where the task's implementation LANDED on develop — a MERGE whose
 *  message contains the task id AND whose first-parent diff changed an IMPLEMENTATION-CLASS file
 *  (`plugin/scripts/impl.ts`) — the exact "实现已在树" shape (AC3's "-m --first-parent" visibility
 *  case: plain `git show --name-only` prints 0 files for a merge; and the 2026-08-13 narrowing: the
 *  file must be implementation-class, not just any non-tasks/ sidecar). `mergeMessage` defaults to the
 *  canonical `fan-in: task/<id>` (the realistic landing); tests that need the NEW step-4 check to fire
 *  pass a NEUTRAL message (`merge: <id> — landing`) so ready-pool-check's commit-trace arm does NOT
 *  also fire (a traced task is excluded at the pool level before the candidate loop runs). The task's
 *  own tasks/<id>.md is written by the caller AFTER (in the working tree, uncommitted — develop
 *  history carries only the implementation). */

/** Build a REAL temp git repo where develop has a commit whose message contains the task id BUT the
 *  commit changed ONLY `tasks/<taskId>.md` plus ONE sidecar file (a doc / telemetry path like
 *  docs/… or milestones/…). The predicate must NOT fire — the sidecar is not implementation-class
 *  (gap-slot-refill-landed-detection-implementation-file-classes: the phantom-killer false positives
 *  51699289 / 1f99e276 — a task-creation/analysis commit that incidentally touched a sidecar). */

/** Build a REAL temp git repo where develop has a commit whose message contains the task id BUT the
 *  commit changed ONLY `tasks/<id>.md` (a task-creation / body-edit commit) — NOT implementation.
 *  The predicate must NOT fire (AC4: the implementation evidence must be a file OUTSIDE tasks/). */

/** Build a REAL temp git repo where the task's implementation LANDED on develop but NO commit
 *  message carries the task id — the exact phantom-killer FALSE-NEGATIVE shape
 *  (gap-phantom-killer-false-negative-id-not-in-commits): hasLandedImplementation's `git log develop
 *  --grep <id>` misses EVERY commit (the empirical gap-superseded-modeled case — deba6463/8a8fc8f6/
 *  f12863a8/8bf44f9f/2d3caab0/23c8fee3 all ancestor on develop but their messages say "VALID_STATUSES
 *  加 superseded", never the id), so the pure-git signal returns false and the task is ONLY caught by
 *  the OR-in body-side signal (isBodyLanded). */

/** The superseded-modeled task-body SHAPE that reproduced the phantom-killer false negative
 *  (gap-superseded-modeled-as-task-lifecycle-terminal at the empirical moment): ACs 全勾 (5/5) + the
 *  ONLY unchecked completion item is the outer full-suite verification — annotated `——外层 verification-
 *  round 验证`, NOT `（待外部）` (the exact form the fail-closed isExternalVerificationItem misses). */


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
