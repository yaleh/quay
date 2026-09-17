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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12/13 (14 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { INFLIGHT_WORKTREE_STALE_MS, __dirname, analyzeTasks, applyRevaluations, assert, buildTargetedPromotion, computeMergeWorktreeSurfaces, execFileSync, fourArtifactBody, fs, gapTask, makeConflictedMergeWorktree, makeWorkspace, os, parseTask, path, prosePrereqGap, readTaskFileAtRef, readTaskStatusAtRef, resolveMergeWorktreeSurfaces, retreatReadyToTodo, unmergedConflictPaths, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("AC46 marker fix: a candidate DISCUSSING superseded is promotable; a candidate CARRYING the marker is not (both directions)", (t) => {
  const root = makeWorkspace("superseded-marker-fix");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "a.ts"), "export const a = 1;\n");
  writeTask(root, "gap-discusses-superseded", gapTask("gap-discusses-superseded", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-discusses-superseded.md"],
      extra: "\nThe superseded-capability checker runs in the full-suite gate. This task is NOT superseded — it is live work.\n",
    }),
  }));
  writeTask(root, "gap-carries-marker", gapTask("gap-carries-marker", {
    body: fourArtifactBody({
      touches: ["- code/a.ts", "- tasks/gap-carries-marker.md"],
      extra: "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n",
    }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan candidates
  const discusses = r.candidates.find((c) => c.id === "gap-discusses-superseded");
  const carries = r.candidates.find((c) => c.id === "gap-carries-marker");
  assert.ok(discusses, "discuss candidate is scanned");
  assert.equal(discusses.superseded, false, "discussing the word is NOT superseded (before the fix the bare word wrongly blocked it)");
  assert.equal(discusses.eligible, true, "discuss candidate is promotable");
  assert.ok(carries, "marker candidate is scanned");
  assert.equal(carries.superseded, true, "carrying the marker IS superseded");
  assert.equal(carries.eligible, false, "marker candidate is not promotable");
  // The marker candidate is recorded in `intercepted` with the superseded reason (traceable no-promotion).
  assert.ok(r.intercepted.some((i) => i.id === "gap-carries-marker" && i.reason === "superseded"), "superseded intercept recorded");
});


test("AC5 production negative control: the promotion gate rejects compound/self-touch samples and admits the clean three (real task bodies)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tasksDir = path.join(repoRoot, "tasks");
  // reject self-touch sample = DIR-001: a REAL direction-recording task ("仅记录方向", no concrete
  // Touches) that structurally lacks its own tasks/DIR-001.md self-touch and is stable — the previous
  // sample (gap-worktree-node-modules-inconsistent-self-verify) was removed because A22's fix-
  // unqualified legitimately ADDED its self-touch (86dacd51); DIR-127 met the same fate (self-touch
  // added when prepared for dispatch, 2026-08-14) → both became false rejects. DIR-001 is a done
  // direction record (A22 never promotes done → can never gain a self-touch). Pick only tasks that
  // can never gain a self-touch (direction records, not execution candidates); verify with
  // buildTargetedPromotion before swapping.
  const rejectIds = ["gap-quay-has-never-self-hosted-its-own-cold-start", "DIR-001"];
  // gap-spec11 was previously an admit sample but the prose-prereq widen (this task) now sees its
  // "试点 `gap-spec-11-…-pilot` 已 done … 它是停全局轮的唯一前置" paragraph as a prose prereq
  // (pilot is a backtick-cited predecessor with no depends_on edge). Replaced with a genuinely-clean
  // execution candidate (gap-ac120: eligible, prosePrereqGap=[], self-touch present, not compound).
  const admitIds = ["gap-ac120-suite-bucket-attribution-mechanism", "gap-slot-refill-clique-ignores-landed-touches", "gap-landing-target-branch-consistency-check"];
  // Build allTasks from the REAL task files (REAL statuses — a dependency that is done stays done, so
  // the gate's deps check resolves; the negative-control SAMPLES are real, never fabricated).
  const allTasks = new Map();
  for (const f of fs.readdirSync(tasksDir).filter((x) => x.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(tasksDir, f), "utf8");
    const task = parseTask(raw);
    task.id = id;
    task.status = (raw.match(/^status:\s*(\S+)/m) || [])[1] || "";
    allTasks.set(id, task);
  }
  for (const id of rejectIds) {
    assert.ok(allTasks.has(id), `reject sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" }; // the promotion gate evaluates todo→ready
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, false, `${id} must be REJECTED by the gate`);
    if (id === "gap-quay-has-never-self-hosted-its-own-cold-start") {
      assert.equal(tp.checks.compound, true, `${id} is role:compound → rejected for compound`);
    } else {
      assert.equal(tp.checks.selfTouchOk, false, `${id} lacks its own self-touch → rejected for self-touch`);
    }
  }
  for (const id of admitIds) {
    assert.ok(allTasks.has(id), `admit sample ${id} exists in the real store`);
    const task = { ...allTasks.get(id), status: "todo" };
    const tp = buildTargetedPromotion(id, task, repoRoot, allTasks);
    assert.equal(tp.eligible, true, `${id} must be ADMITTED by the gate`);
    assert.equal(tp.checks.superseded, false, `${id} is not superseded (marker-fix direction: discussion ≠ marker)`);
    assert.equal(tp.checks.compound, false, `${id} is not compound`);
    assert.equal(tp.checks.selfTouchOk, true, `${id} has its self-touch`);
  }
});


test("AC1: compound and self-touch-missing todo candidates are rejected at the bulk promotion gate (not deferred after ready)", (t) => {
  const root = makeWorkspace("ac1-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "foo.ts"), "export const foo = 1;\n");
  writeTask(root, "gap-compound-candidate", gapTask("gap-compound-candidate", { role: "compound" }));
  // Bypass gapTask's self-touch injection on purpose: this fixture declares a resolving touch but
  // deliberately OMITS tasks/<id>.md — the C8 self-touch-missing case the gate must reject.
  writeTask(root, "gap-self-touch-missing", {
    status: "todo",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/foo.ts"] }),
  });
  writeTask(root, "gap-clean-candidate", gapTask("gap-clean-candidate", {
    body: fourArtifactBody({ touches: ["- code/foo.ts", "- tasks/gap-clean-candidate.md"] }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 1, floorMult: 1 }); // floor 1, pool 0 → scan
  const compound = r.candidates.find((c) => c.id === "gap-compound-candidate");
  const selfTouch = r.candidates.find((c) => c.id === "gap-self-touch-missing");
  const clean = r.candidates.find((c) => c.id === "gap-clean-candidate");
  assert.ok(compound && selfTouch && clean, "all three candidates scanned");
  assert.equal(compound.eligible, false, "compound candidate is not promotable");
  assert.equal(compound.compound, true, "compound candidate carries the compound flag (blocking reason)");
  assert.equal(selfTouch.eligible, false, "self-touch-missing candidate is not promotable");
  assert.equal(selfTouch.selfTouchOk, false, "self-touch-missing candidate carries the selfTouchOk flag (blocking reason)");
  assert.equal(clean.eligible, true, "clean candidate stays promotable");
  // The blocking reasons are recorded in `intercepted` (traceable no-promotion, same discipline as retired).
  assert.ok(r.intercepted.some((i) => i.id === "gap-compound-candidate" && i.reason === "compound-not-dispatchable"), "compound intercept recorded");
  assert.ok(r.intercepted.some((i) => i.id === "gap-self-touch-missing" && i.reason === "self-touch-missing-c8"), "self-touch intercept recorded");
  assert.ok(!r.promotions.some((p) => p.id === "gap-compound-candidate"), "compound candidate never promoted");
  assert.ok(!r.promotions.some((p) => p.id === "gap-self-touch-missing"), "self-touch candidate never promoted");
  assert.ok(r.promotions.some((p) => p.id === "gap-clean-candidate"), "clean candidate is promoted");
});


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


test("computeMergeWorktreeSurfaces: a LIVE mid-merge worktree surface = ONLY unmerged files (AC3 wiring)", (t) => {
  const { dir } = makeConflictedMergeWorktree("live-wiring", new Date().toISOString());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = computeMergeWorktreeSurfaces(dir);
  assert.equal(out.length, 1, "one live mid-merge worktree surface");
  assert.deepEqual(out[0].files.sort(), ["conflict-a.md", "conflict-b.md", "conflict-c.md"], "surface = unmerged conflict paths only (clean.md excluded)");
});

// ── STALE MAIN-CHECKOUT STATUS (tasks/gap-dispatch-reads-stale-main-checkout-task-status, AC1/AC3) ──
// A task landed on develop as `status: done` but the manager working branch's disk still says
// `status: ready` (the main checkout 20-commits-behind shape). Dispatch's status read must come from
// the develop REF, not the stale disk — otherwise the done task is re-dispatched until the retry cap.
// The read source is asserted directly: readTaskStatusAtRef/readTaskFileAtRef read develop (done),
// while the working tree (fs.readFileSync) reads the stale ready.


test("dispatch reads task status from the develop ref, not the stale working tree (AC1/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-stale-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // develop: the task is done (landed + flip-done).
  writeTask(root, "gap-stale-status", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-stale-status: flip done");
  // Stale manager branch: rewrite the same task back to `ready` and STAY on it (disk=ready, develop=done).
  git("checkout", "-q", "-b", "manager-stale");
  writeTask(root, "gap-stale-status", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-stale-status: stale reset to ready");

  // AC3 read-source assertion: the develop ref carries `done`; the stale working tree carries `ready`.
  assert.equal(readTaskStatusAtRef(root, "develop", "gap-stale-status"), "done", "readTaskStatusAtRef reads develop → done");
  assert.match(readTaskFileAtRef(root, "develop", "gap-stale-status"), /^status:\s*done/m, "readTaskFileAtRef reads develop → done");
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-stale-status.md"), "utf8"), /^status:\s*ready/m, "stale working tree carries ready");

  const tasksDir = path.join(root, "tasks");
  // AC1: dispatch read (taskReadRef=develop) judges the task done → NOT in the ready pool.
  const rDev = analyzeTasks({ tasksDir, root, taskReadRef: "develop" });
  assert.equal(rDev.ready.includes("gap-stale-status"), false, "develop-read judges the task done → not dispatchable");
  assert.equal(rDev.pool, 0, "no ready task when the develop ref is the source of truth");

  // Negative control: WITHOUT the develop read (the old disk read), the stale `ready` WOULD be seen.
  const rDisk = analyzeTasks({ tasksDir, root });
  assert.equal(rDisk.ready.includes("gap-stale-status"), true, "the stale working tree alone would still see it ready (the defect)");
});

// ── PROMOTION DECISION READS DEVELOP (tasks/gap-dispatch-reads-stale-main-checkout-task-status, AC6) ──
// The write side (gap-ff-propagate-…, 1e7fb9be4) flips develop to `ready` and RESTORES the manager
// working tree's disk to the pre-promotion `todo`. `ready-pool-check --apply` must therefore JUDGE
// candidates from the develop ref — a disk read re-promotes the same task every tick (duplicate
// same-content commits). This pins the promotion PATH (--apply), not just the dispatch-read path.


test("AC6 — --apply promotion decision reads develop: develop=ready + disk=todo ⇒ no re-promotion", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-ac6-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "develop", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // develop: the task is ALREADY promoted (ready) — the write side flipped it there.
  writeTask(root, "gap-promoted", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "gap-promoted: promoted to ready on develop");
  // Stale disk: the write side restored the working tree to the pre-promotion status (todo, self-touch).
  git("checkout", "-q", "-b", "manager-stale");
  writeTask(root, "gap-promoted", gapTask("gap-promoted"));
  git("add", ".");
  git("commit", "-q", "-m", "gap-promoted: restore todo on disk");

  // Falsifiability: develop carries ready; the stale working tree carries todo.
  assert.equal(readTaskStatusAtRef(root, "develop", "gap-promoted"), "ready", "develop carries ready");
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-promoted.md"), "utf8"), /^status:\s*todo/m, "stale disk carries todo");

  // Negative control: the disk-read analysis (no taskReadRef) sees the stale todo as an eligible
  // candidate — the exact re-promotion defect this AC closes.
  const rDisk = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.equal(rDisk.promotions.some((p) => p.id === "gap-promoted"), true, "negative control: disk-read sees the stale todo as a candidate (the defect)");

  // The promotion path: --apply must judge from develop ⇒ already-ready ⇒ zero promotions, zero writes.
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3", "--floor-mult", "1", "--apply"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.should_apply, false, "AC6: develop=ready ⇒ no promotion recommended (⛔ 仍读盘上、重复晋升 ⇒ 假)");
  assert.equal(parsed.applied_promotions.length, 0, "AC6: zero promotions applied");
  // The disk stays todo — the promotion did NOT re-land.
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-promoted.md"), "utf8"), /^status:\s*todo/m, "AC6: disk stays todo (no duplicate promotion)");
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// BODY-FRESHNESS — the third state for a read source behind the write face
// (tasks/gap-ready-pool-body-still-read-from-stale-main-checkout)
//
// THE DEFECT, REPLAYED. 2026-09-14: the gate read the DEVELOP REF (taskReadRef — that part of the
// read face was already fixed), but a task_write whose fix carried the missing `(new)` annotations
// FAILED to propagate there (`.quay/store-commit-propagation.jsonl`:
// `branchClass:"other" changeKind:"must-propagate" propagated:false`). Rounds 188/189 therefore kept
// reading the PRE-FIX body ⇒ `touchesResolve=false` ⇒ fix worker ⇒ timeout ⇒ 3 retries ⇒ needs-human.
// Replaying both historical bodies through the SAME `checkTaskTouchesResolve` on the SAME root: the
// pre-fix body ⇒ majorityMissing:true, the fixed body ⇒ majorityMissing:false. The fixed body passes
// BY CONSTRUCTION — so the gate did not read it. The read SOURCE was right; the ref was BEHIND THE
// WRITE FACE (the mirror of the disk-lags-develop family, and only the ledger carries that direction).
//
// These fixtures reproduce that shape with the exact mechanism: 3 declared Touches files absent from
// disk (pre-fix) vs the same 3 annotated `(new)` (fixed).

/** The pre-fix / post-fix Touches pair from the 2026-09-14 replay: three NEW files, unannotated
 *  (⇒ mustExist 3, majority missing ⇒ touchesResolve=false) vs annotated `(new)` (⇒ touchesResolve=true). */

/** Append a propagation-ledger record (the shape store.ts's logPropagationOutcome writes). */
