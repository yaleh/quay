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

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 12/12 (9 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { analyzeSlotRefill, assert, computeExitedNotLandedContinueIds, dispatchableBody, fs, inFlightTask, judgeEndInvariant, makeGitWorkspace, makeWorkspace, os, parseTouches, path, readTaskStatusAtRef, runGit, writeTask } from "./helpers/slot-refill-harness.mjs";

test("IN-FLIGHT WORKTREE (AC2) — a hold candidate overlapping a fan-in worktree is deferred ⇒ no_refill_reason non-empty and the AC53 gate accepts", (t) => {
  const root = makeWorkspace("inflight-worktree");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // In-flight fan-in worktree A declares X (the same file the hold candidate B will declare).
  const faninTouches = parseTouches(dispatchableBody(["- code/shared.ts (new)"]));
  // Hold candidate B — the ONLY ready task — declares the SAME X (and, via C8, its own self-file).
  writeTask(root, "gap-hold", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });

  // The snapshot in-flight set is EMPTY (the fan-in worktree is invisible to it — its subagent is a
  // workflow). Only the injected direct-quantity worktree entry carries it.
  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight: [],
    inFlightWorktrees: [{ id: "gap-fanin", touches: faninTouches }],
  });

  assert.equal(r.should_refill, false, "the only candidate overlaps the fan-in worktree ⇒ not dispatchable");
  assert.equal(r.recommended.length, 0, "recommended must be empty (B is deferred)");
  assert.ok(r.no_refill_reason, `no_refill_reason must be non-empty, got ${JSON.stringify(r.no_refill_reason)}`);
  const deferredB = (r.deferred || []).filter((d) => d.id === "gap-hold");
  assert.equal(deferredB.length, 1, "the hold candidate is deferred");
  assert.match(deferredB[0].reason, /touches-overlap-in-flight/, "deferred with the in-flight overlap reason");

  // The AC53 gate accepts: judgeEndInvariant on the machine's fresh output must NOT be violated.
  const inv = judgeEndInvariant(r);
  assert.equal(inv.violated, false, "the AC53 gate must accept (no false refusal)");
});


test("IN-FLIGHT WORKTREE (AC2) — negative control: a disjoint candidate is still recommended despite the fan-in worktree", (t) => {
  const root = makeWorkspace("inflight-worktree-disjoint");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const faninTouches = parseTouches(dispatchableBody(["- code/shared.ts (new)"]));
  writeTask(root, "gap-free", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/free.ts (new)"]) });

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight: [],
    inFlightWorktrees: [{ id: "gap-fanin", touches: faninTouches }],
  });

  assert.ok(r.recommended.includes("gap-free"), "a disjoint candidate is still recommended (the worktree only blocks its own conflict surface)");
});


test("IN-FLIGHT WORKTREE (AC2) — the default (no injection) reads the live worktree list and is a no-op in a non-git workspace", (t) => {
  const root = makeWorkspace("inflight-worktree-live");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  // A non-git temp workspace has no `git worktree list` ⇒ computeInFlightWorktreeTouches returns []
  // (fail-soft) ⇒ behavior is byte-identical to the pre-fix path.
  const r = analyzeSlotRefill({ tasksDir: path.join(root, "tasks"), root, cap: 5, inFlight: [] });
  assert.ok(r.recommended.includes("gap-a"), "no worktree in flight ⇒ the candidate is recommended as before");
});

// ── EXITED-NOT-LANDED CONTINUE EXEMPTION (gap-slot-refill-continue-touches-overlap-redundant-
// exemption): an exited-not-landed CONTINUE candidate (residual task/<id> worktree + worker-outcome
// final_state=exited-not-landed) is already worktree-isolated and its landing serialization is
// enforced by the fan-in lock — so the dispatch-level touches-overlap defer is redundant and must be
// SKIPPED (AC1); a fresh candidate (no worktree) keeps the defer (AC2 regression); the exemption must
// NOT mask any other step-4 gate. ──────────────────────────────────────────────────────────────────


test("CONTINUE EXEMPTION (AC1) — an exited-not-landed continue candidate overlapping an in-flight peer is NOT deferred ⇒ enters recommended", (t) => {
  const root = makeWorkspace("continue-exempt");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The continue candidate declares the SAME file as the in-flight peer (a genuine overlap).
  writeTask(root, "gap-cont", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  const inFlight = [inFlightTask("gap-other", ["- code/shared.ts (new)"])];

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight,
    continueExemptIds: ["gap-cont"],
  });

  assert.ok(r.recommended.includes("gap-cont"), "the continue candidate is recommended (exempt from touches-overlap defer)");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-cont");
  assert.equal(deferred.length, 0, `gap-cont must NOT be deferred, got: ${JSON.stringify(deferred)}`);
});


test("CONTINUE EXEMPTION (AC2) — regression: a fresh candidate (NOT exempt) with the same overlap is still deferred", (t) => {
  const root = makeWorkspace("continue-fresh");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-fresh", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/shared.ts (new)"]) });
  const inFlight = [inFlightTask("gap-other", ["- code/shared.ts (new)"])];

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight,
    continueExemptIds: [], // fresh (no worktree) ⇒ not exempt
  });

  assert.ok(!r.recommended.includes("gap-fresh"), "the fresh candidate stays deferred");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-fresh");
  assert.equal(deferred.length, 1, "the fresh candidate is deferred");
  assert.match(deferred[0].reason, /touches-overlap-in-flight/, "deferred with the touches-overlap-in-flight reason");
});


test("CONTINUE EXEMPTION — the exemption skips ONLY the overlap defer; other gates still apply (deps-not-ready)", (t) => {
  const root = makeWorkspace("continue-gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A continue-exempt candidate whose PARENT is not done must still be deferred (deps-not-ready) —
  // the exemption must not mask a genuine defect.
  writeTask(root, "gap-cont", { status: "ready", labels: ["gap"], parent: "gap-never-done", body: dispatchableBody(["- code/shared.ts (new)"]) });
  const inFlight = [inFlightTask("gap-other", ["- code/shared.ts (new)"])];

  const r = analyzeSlotRefill({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 5,
    inFlight,
    continueExemptIds: ["gap-cont"],
  });

  assert.ok(!r.recommended.includes("gap-cont"), "a continue candidate with an unmet dep is still deferred");
  const deferred = (r.deferred || []).filter((d) => d.id === "gap-cont");
  assert.equal(deferred.length, 1, "deferred once");
  assert.match(deferred[0].reason, /deps-not-ready/, "deferred with deps-not-ready (not the skipped overlap reason)");
});


test("CONTINUE EXEMPTION — computeExitedNotLandedContinueIds: exited-not-landed record + residual task/<id> worktree ⇒ id present", (t) => {
  const root = makeGitWorkspace("continue-live", 0);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A real residual task/<id> worktree (the worktree-isolated half).
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), "slot-refill-cont-wt-"));
  t.after(() => fs.rmSync(wtDir, { recursive: true, force: true }));
  runGit(root, "worktree", "add", "-b", "task/gap-cont", wtDir, "develop");
  // worker-outcome final_state=exited-not-landed (the other half).
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), JSON.stringify({ task: "gap-cont", final_state: "exited-not-landed" }) + "\n");

  const ids = computeExitedNotLandedContinueIds(root);
  assert.ok(ids.has("gap-cont"), `exited-not-landed + residual worktree ⇒ continue-exempt, got ${JSON.stringify([...ids])}`);
});


test("CONTINUE EXEMPTION — computeExitedNotLandedContinueIds negative controls: no worktree / completed record / no record ⇒ absent", (t) => {
  // (a) record WITHOUT a residual worktree ⇒ not continue (fresh task keeps the conservative defer).
  {
    const root = makeGitWorkspace("continue-neg-a", 0);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), JSON.stringify({ task: "gap-cont", final_state: "exited-not-landed" }) + "\n");
    assert.equal(computeExitedNotLandedContinueIds(root).has("gap-cont"), false, "record without worktree ⇒ not exempt");
  }
  // (b) a COMPLETED record + residual worktree ⇒ not continue (only exited-not-landed is continue).
  {
    const root = makeGitWorkspace("continue-neg-b", 0);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), "slot-refill-cont-wtb-"));
    t.after(() => fs.rmSync(wtDir, { recursive: true, force: true }));
    runGit(root, "worktree", "add", "-b", "task/gap-done", wtDir, "develop");
    fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), JSON.stringify({ task: "gap-done", final_state: "completed" }) + "\n");
    assert.equal(computeExitedNotLandedContinueIds(root).has("gap-done"), false, "completed record ⇒ not exempt");
  }
  // (c) NO record at all ⇒ empty (fail-soft, the exemption restores the pre-existing conservative defer).
  {
    const root = makeGitWorkspace("continue-neg-c", 0);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(computeExitedNotLandedContinueIds(root).size, 0, "no worker-outcome.jsonl ⇒ empty set");
  }
});

// ── STALE MAIN-CHECKOUT STATUS (tasks/gap-dispatch-reads-stale-main-checkout-task-status, AC1/AC3) ──
// A task landed on develop as `status: done` but the manager working branch's disk still says
// `status: ready` (the main checkout behind-develop shape). analyzeSlotRefill's status read must come
// from the develop REF (default taskReadRef="develop"), not the stale disk — otherwise the done task
// is re-recommended until the retry cap. The read source is asserted directly via readTaskStatusAtRef.


test("analyzeSlotRefill reads status from the develop ref, not the stale working tree (AC1/AC3)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slot-refill-stale-${Date.now()}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  runGit(dir, "init", "-q", "-b", "develop", ".");
  runGit(dir, "config", "user.email", "t@t");
  runGit(dir, "config", "user.name", "t");
  // develop: the task is done (landed + flip-done).
  writeTask(dir, "gap-stale-status", { status: "done", labels: ["gap"], body: dispatchableBody(["- code/stale.ts (new)"]) });
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "gap-stale-status: flip done");
  // Stale manager branch: rewrite the same task back to `ready` and STAY on it (disk=ready, develop=done).
  runGit(dir, "checkout", "-q", "-b", "manager-stale");
  writeTask(dir, "gap-stale-status", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/stale.ts (new)"]) });
  runGit(dir, "add", "-A");
  runGit(dir, "commit", "-qm", "gap-stale-status: stale reset to ready");

  // AC3 read-source assertion: the develop ref carries `done`; the stale working tree carries `ready`.
  assert.equal(readTaskStatusAtRef(dir, "develop", "gap-stale-status"), "done", "readTaskStatusAtRef reads develop → done");
  assert.match(fs.readFileSync(path.join(dir, "tasks", "gap-stale-status.md"), "utf8"), /^status:\s*ready/m, "stale working tree carries ready");

  const tasksDir = path.join(dir, "tasks");
  // AC1: default taskReadRef="develop" ⇒ the done task is judged done → NOT recommended.
  const r = analyzeSlotRefill({ tasksDir, root: dir, cap: 3, runningSubagentCount: 0 });
  assert.equal(r.pool, 0, "develop-read: the stale-ready task is judged done → empty ready pool");
  assert.equal(r.recommended.includes("gap-stale-status"), false, "done task not recommended for dispatch");
  assert.equal(r.should_refill, false, "no dispatchable candidate from the develop source of truth");

  // Negative control: WITHOUT the develop read (taskReadRef=null → the old disk read), the stale
  // `ready` IS seen and the task is recommended — the exact defect this task removes.
  const rDisk = analyzeSlotRefill({ tasksDir, root: dir, cap: 3, runningSubagentCount: 0, taskReadRef: null });
  assert.equal(rDisk.recommended.includes("gap-stale-status"), true, "the stale working tree alone would still recommend it (the defect)");
});
