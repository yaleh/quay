// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { MISMATCH_FULL_ID, MISMATCH_TRUNCATED_ID, analyzeTasks, assert, execFileSync, fourArtifactBody, fs, gitCommit, makeRealGitRepo, makeTruncatedWorktreeFixture, makeWorkspace, notYetFlipped, path, taskWorkLanded, worktreeMatchesTask, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("AC-complete-not-flipped ready task is surfaced; genuinely-pending is not (AC1 union positive control)", (t) => {
  const root = makeWorkspace("ac-complete");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // AC-complete-but-not-flipped: all 4 ACs checked, but NO work-landing evidence — the Touches file
  // does not exist, no resolvable symbols, no git history. taskWorkLanded alone would MISS this
  // (the prose-AC completed shape); the AC-checkbox union signal must surface it.
  writeTask(root, "gap-ac-complete", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never-landed.ts"] }),
  });
  // A genuinely-pending ready task: ACs unchecked, work not landed → stays in the pool.
  writeTask(root, "gap-pending", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/never-landed-2.ts"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  const byId = Object.fromEntries(r.excluded.map((e) => [e.id, e.reasons]));
  assert.ok(
    byId["gap-ac-complete"]?.includes("not-yet-flipped"),
    "AC-complete-but-not-flipped ready task must be surfaced (AC1)",
  );
  assert.equal(r.ready.includes("gap-ac-complete"), false, "AC-complete task NOT in the dispatchable pool");
  assert.equal(r.ready.includes("gap-pending"), true, "genuinely-pending task stays in the pool");
  assert.deepEqual(r.ready, ["gap-pending"]);
});


test("AC-complete signal is a UNION not a replace: partial/zero/non-ready NOT surfaced, landed-unchecked STILL excluded (AC2)", (t) => {
  const root = makeWorkspace("ac-union");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Partial ACs (2/4) + work not landed → NOT not-yet-flipped (the AC signal requires ALL checked).
  const partial = { status: "ready", body: fourArtifactBody({ checkedAc: 2, touches: ["- code/missing.ts"] }) };
  assert.equal(notYetFlipped(partial, root), false, "partial-AC ready task is not a closure candidate (AC2)");

  // Zero AC checkboxes (total 0) → NOT not-yet-flipped (total > 0 guard — 0/0 must not vacuous-true).
  const zeroAc = {
    status: "ready",
    body: "## Acceptance Criteria\nno checkboxes at all\n## Touches\n- code/missing.ts\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(zeroAc, root), false, "zero-checkbox ready task is not a closure candidate (AC2)");

  // Non-ready status (todo) with all ACs checked → NOT not-yet-flipped (status guard).
  const todoChecked = { status: "todo", body: fourArtifactBody({ checkedAc: 4, touches: ["- code/missing.ts"] }) };
  assert.equal(notYetFlipped(todoChecked, root), false, "todo-status task is not the not-yet-flipped state (AC2)");

  // union-not-replace / taskWorkLanded pure: an AC-all-checked + work-NOT-landed task must NOT be
  // judged landed by taskWorkLanded itself (the work-landed signal stays independent of checkbox
  // state) — only the union's AC signal surfaces it.
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  const acCompleteNotLanded = { status: "ready", body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }) };
  assert.equal(taskWorkLanded(acCompleteNotLanded.body, root), false, "taskWorkLanded stays a pure work-landed signal (AC2)");
  assert.equal(notYetFlipped(acCompleteNotLanded, root), true, "union catches it via the AC-complete signal (AC1)");

  // taskWorkLanded stays a pure work-landed signal, but notYetFlipped now AC-gates it
  // (gap-ready-pool-worklanded-traps-stuck-work): a work-landed-but-AC-incomplete ready task is
  // STUCK-WORK → dispatchable (AC2); a work-landed NEAR-COMPLETE ready task is a done-flip → still
  // excluded (AC3).
  const landedUnchecked = {
    status: "ready",
    body: "## Acceptance Criteria\n- [ ] unchecked\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedUnchecked, root), false, "landed-but-AC-incomplete ready task is stuck-work → dispatchable (AC2)");
  const landedDoneFlip = {
    status: "ready",
    body: "## Acceptance Criteria\n- [x] done\n- [x] done\n- [x] done\n- [ ] 全量套件绿（外层 verification-round 验证）（待外部）\n## Touches\n- code/landed.ts (new)\n## Definition of Done\nstandard",
  };
  assert.equal(notYetFlipped(landedDoneFlip, root), true, "landed task whose only remaining box is external verification is a done-flip → excluded (AC3)");

  // Neither signal fires → stays in the pool.
  const pending = { status: "ready", body: fourArtifactBody({ touches: ["- code/never.ts"] }) };
  assert.equal(notYetFlipped(pending, root), false, "neither signal fires → stays in the pool");
});

// ── LEFTOVER-WORKTREE EXEMPTION (gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption) ──
// The `allChecked` arm (2026-08-08) excluded a ready task purely on self-declared completion, with NO
// landing evidence. A mechanical fan-in FAILURE (suite red / merge-develop conflict) leaves the task
// `ready + all-checked + un-landed` WITH its `task/<id>` worktree still open (ff-merge success is what
// deletes it) — the old arm excluded it forever, so the landing path never ran again (permanent
// stranding, one dead task froze the pool). The fix: an OPEN `task/<id>` worktree is the DIRECT
// "fan-in not yet complete" quantity (same `git worktree list` source as computeInFlightWorktreeTouches)
// — while it exists the allChecked task stays dispatchable so the next dispatch triggers the driver's
// mechanical fan-in retry. No worktree keeps the original exclude (the prose-AC shape).


test("LEFTOVER-WORKTREE — allChecked + leftover task/<id> worktree is NOT not-yet-flipped (AC1); no worktree keeps the exclusion (AC2)", (t) => {
  const root = makeRealGitRepo("nyf-leftover");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-leftover";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });

  // AC2 negative control: allChecked + NO worktree ⇒ still excluded (2026-08-08 behavior unchanged).
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), true,
    "all-checked + no leftover worktree is still not-yet-flipped (AC2)");

  // Create the leftover task/<id> worktree (the fan-in-failed shape).
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  // AC1 positive: allChecked + leftover worktree ⇒ NOT not-yet-flipped ⇒ stays dispatchable.
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), false,
    "all-checked + leftover worktree is NOT not-yet-flipped (AC1)");

  // Removing the worktree restores the exclusion — the exemption is keyed on the open worktree.
  execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtPath]);
  assert.equal(notYetFlipped({ id, status: "ready", body }, root), true,
    "removing the leftover worktree restores the not-yet-flipped exclusion (AC2)");
});


test("LEFTOVER-WORKTREE — analyzeTasks keeps an allChecked + leftover-worktree task in ready, not excluded (AC1/AC3)", (t) => {
  const root = makeRealGitRepo("nyf-leftover-pool");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-leftover";
  writeTask(root, id, {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }),
  });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.ready.includes(id), true, "allChecked + leftover worktree task stays in the ready pool (AC1/AC3)");
  assert.equal(r.excluded.some((e) => e.id === id && e.reasons.includes("not-yet-flipped")), false,
    "no not-yet-flipped exclusion when a leftover worktree is present (AC1/AC3)");
});


test("LEFTOVER-WORKTREE — a single allChecked dead task no longer zeroes the pool (dispatchable_disjoint ≥ 1, AC4)", (t) => {
  const root = makeRealGitRepo("nyf-pool-effect");
  const wtPath = path.join(root, "..", `${path.basename(root)}-leftover`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  gitCommit(root, "seed");

  const id = "gap-nyf-pool";
  writeTask(root, id, {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ checkedAc: 4, touches: ["- code/never.ts"] }),
  });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.pool, 1, "the single allChecked dead task is counted in the pool, not dropped (AC4)");
  assert.equal(r.dispatchable_disjoint, 1, "dispatchable_disjoint ≥ 1 — the dead task is itself dispatchable, no longer zeroed (AC4)");
  assert.equal(r.pool_big_all_colliding, false, "pool_big_all_colliding stays false (AC4)");
});

// ── SUFFIX-TRUNCATED worktree/branch names
// (gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption) ─────────────────────────────
// MEASURED 2026-09-15: task `gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-
// task-needs-human` was implemented in a worktree named (path AND branch) `…-transient-rate-limit` —
// the task id MINUS a real suffix. Exact equality is blind to that, so the leftover-worktree exemption
// never fired: the task fell through to the landed/allChecked arms, was judged a done-flip, and sat
// outside the pool for 30+ hours with NO signal distinguishing it from "work really is done, only the
// status flip is missing" (hard rule 3b). These two tests pin the real shape end-to-end.


/** The measured fixture: a real repo, the FULL id in the task store, a worktree whose path basename
 *  AND branch both carry the TRUNCATED id. Returns { root, wtPath, task }. */


test("AC1 (name mismatch) — a truncated worktree/branch name still suppresses the done-flip arms (⛔ no silent pool exit)", (t) => {
  const { root, wtPath, task } = makeTruncatedWorktreeFixture(t, "nyf-name-mismatch");
  const worktrees = [{ path: wtPath, branch: `refs/heads/task/${MISMATCH_TRUNCATED_ID}` }];
  // NEGATIVE CONTROL — the pre-fix predicate itself (imported, not re-derived), run on the real
  // worktree: exact equality sees NOTHING. On the pre-fix code this is the whole judgment, so the
  // exemption below never fires and the task is silently excluded from the pool.
  assert.equal(worktreeMatchesTask(worktrees[0], MISMATCH_FULL_ID), false, "negative control: the pre-fix exact-equality judgment is blind to the truncated name");
  assert.equal(notYetFlipped(task, root, null, { worktrees, taskIds: new Set() }), true,
    "negative control: with nothing to ground against, the truncated worktree stays invisible ⇒ judged a done-flip (the pre-fix verdict)");
  // AC1 — the fix. `taskIds` is what analyzeTasks threads; the same verdict must also come from the
  // fully-legacy call form (no opts at all), so the fix is not gated on a test-only knob.
  assert.equal(notYetFlipped(task, root, null, { worktrees, taskIds: new Set([MISMATCH_FULL_ID]) }), false,
    "AC1: the truncated name resolves to the real task ⇒ the leftover-worktree exemption fires");
  assert.equal(notYetFlipped(task, root), false,
    "AC1: the no-opts form (worktreeExists reading the store off disk) reaches the same verdict");
  // BIDIRECTIONAL — remove the worktree and the done-flip arm fires again: the exemption, not the
  // fixture, is what changed the verdict (hard rule 4: a量 that cannot take the other value is not a measurement).
  execFileSync("git", ["-C", root, "worktree", "remove", "--force", wtPath]);
  assert.equal(notYetFlipped(task, root), true, "worktree gone ⇒ done-flip again (the exemption is the only difference)");
});


test("AC2/AC3 (name mismatch) — analyzeTasks reports the unresolvable name AND keeps the resolvable one in the pool", (t) => {
  const { root } = makeTruncatedWorktreeFixture(t, "nyf-name-mismatch-report");
  // A second worktree whose name binds to NOTHING (not even a unique prefix) — the AC2 population.
  const orphanRoot = path.join(root, "..", `${path.basename(root)}-orphan`);
  const orphanWt = path.join(orphanRoot, "gap-nobody-knows-this-one");
  t.after(() => fs.rmSync(orphanRoot, { recursive: true, force: true }));
  fs.mkdirSync(orphanRoot, { recursive: true });
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", "task/gap-nobody-knows-this-one", orphanWt]);

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.ready.includes(MISMATCH_FULL_ID), true, "AC1: the task stays in the ready pool (its truncated worktree was recognized)");
  assert.equal(r.excluded.some((e) => e.id === MISMATCH_FULL_ID), false, "AC1: no not-yet-flipped exclusion — the silent 30 h pool exit is closed");

  assert.equal(r.mismatched_worktrees.evaluated, true, "AC2: the store was readable ⇒ the diagnostic is a real judgment, not a default");
  assert.deepEqual(r.mismatched_worktrees.records.map((x) => x.name), ["gap-nobody-knows-this-one"],
    "AC2: exactly the unresolvable task-worktree name is reported — the resolvable truncated one is not a mismatch");
  assert.equal(r.mismatched_worktrees.count, 1);
  assert.equal(r.mismatched_worktrees.records[0].type, "mismatched-worktree-name",
    "AC2: a TYPED record — structurally distinct from «everything is fine», not a silent no-op");
});

// ── HOISTED leftover-worktree exemption + touch-absent-from-ref veto
// (gap-nyf-doneflipready-arm-bypasses-leftover-worktree-exemption) ───────────────────────────────────
// The leftover-worktree exemption used to gate ONLY the standalone `allChecked` arm, so the
// `doneFlipReady` arm (workLandedReady || commitTraceReady) BYPASSED it: a worktree-open task whose
// taskWorkLanded read true (via symbol-resolution / touch-file existence over the main checkout's DISK
// tree — a proxy that fires on PRE-EXISTING files the task EDITS, hard rule 4b) was judged not-yet-
// flipped and left the pool FOREVER. Two fixes: (1) hoist the worktree exemption ABOVE every arm —
// an open `task/<id>` worktree is the DIRECT "fan-in not yet complete" quantity, so it suppresses ALL
// landed/completion signals; (2) a declared code-root Touches file ABSENT from the landing ref's tree
// vetoes the landed arms (file-existence is zero information; presence in the ref is the direct read).


test("AC1 — open worktree suppresses the workLanded done-flip arm (allChecked + workLanded stays dispatchable)", (t) => {
  const root = makeRealGitRepo("nyf-wl-worktree");
  const wtPath = path.join(root, "..", `${path.basename(root)}-wt`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(wtPath, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.writeFileSync(path.join(root, "code", "seed.ts"), "export const seed = 1;\n");
  // workLanded fires: the (new)-tagged touch EXISTS on disk and is committed (so it is IN the ref —
  // the touch-absent veto is clear, isolating the worktree hoist as the only suppressor).
  fs.writeFileSync(path.join(root, "code", "landed.ts"), "export const landed = 1;\n");
  gitCommit(root, "seed + landed");
  const id = "gap-nyf-wl";
  const body = fourArtifactBody({ checkedAc: 4, touches: ["- code/landed.ts (new)"] });
  writeTask(root, id, { status: "ready", labels: ["gap"], body });
  const task = { id, status: "ready", body };
  // Precondition (RED on the OLD code — doneFlipReady fired regardless of the open-worktree state).
  assert.equal(notYetFlipped(task, root), true, "no worktree + workLanded + allChecked is a done-flip (precondition)");
  execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `task/${id}`, wtPath]);
  assert.equal(notYetFlipped(task, root), false, "open worktree suppresses the workLanded done-flip arm (AC1)");
});
