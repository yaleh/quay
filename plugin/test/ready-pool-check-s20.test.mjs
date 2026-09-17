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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 20/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { INFLIGHT_WORKTREE_STALE_MS, analyzeTasks, applyRevaluations, assert, computeMergeWorktreeSurfaces, fourArtifactBody, fs, makeConflictedMergeWorktree, makeWorkspace, path, resolveMergeWorktreeSurfaces, retreatReadyToTodo, unmergedConflictPaths, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("AC2: revaluation detector — a clean ready pool revaluates to zero (negative control, no silent stay)", (t) => {
  const root = makeWorkspace("reval-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  // Two clean ready tasks (self-touch present + touches resolve + four artifacts).
  writeTask(root, "gap-ready-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-a.md"] }) });
  writeTask(root, "gap-ready-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-b.md"] }) });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.revaluation_count, 0, "clean ready pool ⇒ zero decayed tasks");
  assert.deepEqual(r.revaluation, [], "clean ready pool ⇒ empty revaluation array");
});


test("AC2: revaluation detector — a decayed ready task (superseded marker) is reported with reason + destination todo", (t) => {
  const root = makeWorkspace("reval-decay");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-ready-superseded", { status: "ready", labels: ["gap"], body: "> **SUPERSEDED / 作废** premise deleted.\n\n" + fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-superseded.md"] }) });
  writeTask(root, "gap-ready-clean", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-clean.md"] }) });
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.revaluation_count, 1, "one decayed ready task");
  const entry = r.revaluation.find((x) => x.id === "gap-ready-superseded");
  assert.ok(entry, "the superseded ready task is in revaluation");
  assert.ok(entry.reasons.includes("superseded"), "reason carries 'superseded'");
  assert.equal(entry.destination, "todo", "destination is the legal ready.back=todo");
  assert.ok(!r.revaluation.some((x) => x.id === "gap-ready-clean"), "the clean ready task is NOT revalued");
});


test("AC2: applyRevaluations writes ready→todo + a grep-able ## Revaluation body record; retreatReadyToTodo is fail-closed", (t) => {
  const root = makeWorkspace("reval-apply");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-ready-decay", { status: "ready", labels: ["gap"], body: "> **SUPERSEDED / 作废** premise deleted.\n\n" + fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-decay.md"] }) });
  writeTask(root, "gap-ready-clean", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts", "- tasks/gap-ready-clean.md"] }) });

  const r = applyRevaluations({ tasksDir: path.join(root, "tasks"), root });
  assert.equal(r.should_revaluate, true, "decayed tasks present ⇒ should_revaluate");
  assert.equal(r.applied_revaluations.length, 1, "one retreat written");
  const applied = r.applied_revaluations[0];
  assert.equal(applied.id, "gap-ready-decay");
  assert.equal(applied.ok, true);
  assert.equal(applied.from, "ready");
  assert.equal(applied.to, "todo");

  // The retreat is on disk: status flipped AND a ## Revaluation record (grep-able 阻碍原因 + 去向) appended.
  const after = fs.readFileSync(path.join(root, "tasks", "gap-ready-decay.md"), "utf8");
  assert.match(after, /^status:\s*todo\s*$/m, "status flipped ready → todo");
  assert.match(after, /## Revaluation/, "grep-able ## Revaluation record appended");
  assert.match(after, /去向：ready → todo/, "record carries the destination");
  assert.match(after, /阻碍原因：superseded/, "record carries the blocking reason");
  // The clean task is untouched.
  const cleanAfter = fs.readFileSync(path.join(root, "tasks", "gap-ready-clean.md"), "utf8");
  assert.match(cleanAfter, /^status:\s*ready\s*$/m, "clean ready task untouched");

  // retreatReadyToTodo fail-closed: a non-ready task / missing / no-frontmatter never write.
  writeTask(root, "gap-already-todo", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  const nr = retreatReadyToTodo(root, "gap-already-todo", ["x"]);
  assert.equal(nr.ok, false, "already-todo ⇒ fail closed");
  assert.equal(nr.reason, "not-ready");
  const miss = retreatReadyToTodo(root, "does-not-exist", ["x"]);
  assert.equal(miss.ok, false, "missing ⇒ fail closed");
  fs.writeFileSync(path.join(root, "tasks", "gap-no-fm.md"), "no frontmatter here");
  assert.equal(retreatReadyToTodo(root, "gap-no-fm", ["x"]).ok, false, "no-frontmatter ⇒ fail closed");
});

// ── MERGE-WORKTREE LIVENESS + SURFACE NARROWING (gap-merge-worktree-surface-lacks-liveness-overbroad) ──
// AC2/AC3/AC4: a mid-merge worktree must present a merge conflict surface ONLY while it shows
// direct-quantity liveness (a live process under it, or a commit within INFLIGHT_WORKTREE_STALE_MS)
// AND that surface must be ONLY the unmerged (`UU`) conflict paths — not the former full
// `git diff --name-only HEAD` delta that also listed every cleanly-merged change (a dead 3-file
// conflict read as a 121-file surface and locked out the whole dispatch pool, dispatchable_disjoint
// 0). The pure core (resolveMergeWorktreeSurfaces) is tested with INJECTED isMerge/conflictFiles/
// liveness (hermetic, no /proc/git); the production wiring (computeMergeWorktreeSurfaces) and the
// surface enumerator (unmergedConflictPaths) are tested against a REAL conflicted-merge git worktree.





test("resolveMergeWorktreeSurfaces: a DEAD mid-merge worktree (zero processes + stale commit) contributes no surface (AC2)", (t) => {
  const dir = makeWorkspace("merge-dead-pure");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000; // arbitrary fixed "now"
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-dead"), branch: "refs/heads/task/gap-dead" };
  const out = resolveMergeWorktreeSurfaces([wt], {
    root: dir,
    isMerge: () => true,
    conflictFiles: () => ["code/shared.md"],
    nowMs,
    liveness: () => ({ hasLiveProcess: false, lastCommitMs: nowMs - 2 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 0, "zero live processes + commit older than N ⇒ DEAD mid-merge ⇒ no surface");
});


test("resolveMergeWorktreeSurfaces: a LIVE mid-merge worktree (live process) keeps its surface regardless of commit age (AC2)", (t) => {
  const dir = makeWorkspace("merge-live-pure");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000;
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-live"), branch: "refs/heads/task/gap-live" };
  const out = resolveMergeWorktreeSurfaces([wt], {
    root: dir,
    isMerge: () => true,
    conflictFiles: () => ["code/shared.md"],
    nowMs,
    liveness: () => ({ hasLiveProcess: true, lastCommitMs: nowMs - 10 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 1, "a live process ⇒ surface kept even with a very old commit");
  assert.deepEqual(out[0].files, ["code/shared.md"], "the injected conflict surface is carried through");
});


test("resolveMergeWorktreeSurfaces: a non-merge worktree never contributes a surface (negative control)", (t) => {
  const dir = makeWorkspace("merge-nonmerge");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-clean"), branch: "refs/heads/task/gap-clean" };
  const out = resolveMergeWorktreeSurfaces([wt], { root: dir, isMerge: () => false, conflictFiles: () => ["code/shared.md"] });
  assert.equal(out.length, 0, "a worktree with no merge in flight presents no merge surface");
});


test("unmergedConflictPaths: a conflicted merge returns ONLY the unmerged conflict paths, not the cleanly-merged delta (AC3)", (t) => {
  const { dir, wtPath } = makeConflictedMergeWorktree("narrow", new Date().toISOString());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = unmergedConflictPaths(wtPath).sort();
  assert.deepEqual(files, ["conflict-a.md", "conflict-b.md", "conflict-c.md"], "surface = the 3 unmerged paths, clean.md excluded");
});


test("computeMergeWorktreeSurfaces: a DEAD mid-merge worktree (stale commit + zero processes) is excluded from the surface (AC2 wiring)", (t) => {
  const { dir } = makeConflictedMergeWorktree("dead-wiring", "2020-01-01T00:00:00Z");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = computeMergeWorktreeSurfaces(dir);
  assert.equal(out.length, 0, "a dead mid-merge worktree must not present a merge surface");
});
