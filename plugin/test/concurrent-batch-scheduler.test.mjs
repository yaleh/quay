// @test-group engine
// concurrent-batch-scheduler.test.mjs — in-flight worktree detection + batch assembly
// (the parseCandidate label-exposure tests were removed with the AC36 mechanical sort axis
// retirement — gap-delivery-critical-mechanical-axis-orphaned-needs-ruling, 人 2026-09-07 裁定).
//
// Run: scripts/test.sh plugin/test/concurrent-batch-scheduler.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  // IN-FLIGHT WORKTREE DIRECT QUANTITY (tasks/gap-scheduler-inflight-detection-misses-fan-in-
  // worktree AC1): the pure open-worktree → {id, touches} resolver whose in-flight detection must
  // include a fan-in workflow / just-dispatched worktree via the `git worktree list` direct quantity
  // (not only the telemetry-bracket snapshot).
  resolveInFlightWorktrees,
  computeInFlightWorktreeTouches,
  // IN-FLIGHT WORKTREE LIVENESS (gap-compute-inflight-worktree-touches-no-liveness-check): the
  // staleness threshold the dead-worktree predicate compares against (injected `staleMs`/`nowMs`
  // in the pure tests, so the constant itself is the single source).
  INFLIGHT_WORKTREE_STALE_MS,
} from "../scripts/concurrent-batch-scheduler.ts";

// ── IN-FLIGHT WORKTREE DETECTION (gap-scheduler-inflight-detection-misses-fan-in-worktree) ─────────
// AC1: the in-flight detection must include a fan-in workflow / just-dispatched worktree via the
// `git worktree list` DIRECT quantity — the snapshot (telemetry brackets / historical in-flight id
// list) misses both. resolveInFlightWorktrees is the pure core; computeInFlightWorktreeTouches is its
// production wiring (listWorktrees + taskIdFromBranch).

function touchSectionBody(touches) {
  return [
    "**type:** execution",
    "## Proposal",
    "A proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Touches",
    ...touches,
    "## Acceptance Criteria",
    "- [ ] an acceptance criterion long enough to count",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

function makeWorktreeTasks(tag, taskDefs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cbs-wt-${tag}-`));
  const tasksDir = path.join(dir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [id, touches] of Object.entries(taskDefs)) {
    fs.writeFileSync(path.join(tasksDir, `${id}.md`), touchSectionBody(touches));
  }
  return { dir, tasksDir };
}

test("resolveInFlightWorktrees: a fan-in worktree (task/<id> branch) resolves to its task id + touches (AC1)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("fanin", {
    "gap-fanin": ["- code/shared.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      { path: dir, branch: "refs/heads/develop" }, // main checkout
      { path: path.join(dir, "..", "quay-worktrees", "gap-fanin"), branch: "refs/heads/task/gap-fanin" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 1, "exactly one in-flight worktree (the main checkout is excluded)");
  assert.equal(out[0].id, "gap-fanin");
  assert.deepEqual(out[0].touches.globs, ["code/shared.ts"]);
});

test("resolveInFlightWorktrees: non-task branches + missing task file + no Touches are excluded (fail-soft)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("excl", {
    "gap-task": ["- code/a.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      // integration / detached / non-task branches ⇒ not a task worktree
      { path: path.join(dir, "..", "wt-integration"), branch: "refs/heads/integration" },
      { path: path.join(dir, "..", "wt-detached"), branch: null },
      { path: path.join(dir, "..", "wt-feat"), branch: "refs/heads/feat/thing" },
      // task branch but the task file does not exist ⇒ blocks nothing
      { path: path.join(dir, "..", "wt-missing"), branch: "refs/heads/task/gap-ghost" },
      // task branch whose task declares no ## Touches ⇒ no usable conflict surface
      { path: path.join(dir, "..", "wt-notouch"), branch: "refs/heads/task/gap-notouch" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 0, "none of the excluded shapes are in-flight task worktrees");
  // A task file WITHOUT a ## Touches section must not resolve (no declared conflict surface).
  fs.writeFileSync(path.join(tasksDir, "gap-notouch.md"), "**type:** execution\n## Proposal\nno touches declared\n");
  const out2 = resolveInFlightWorktrees(
    [{ path: path.join(dir, "..", "wt-notouch"), branch: "refs/heads/task/gap-notouch" }],
    { root: dir, tasksDir },
  );
  assert.equal(out2.length, 0, "a task worktree with no declared Touches blocks nothing");
});

test("resolveInFlightWorktrees: duplicate task/<id> worktrees dedup to one entry", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("dedup", {
    "gap-dup": ["- code/x.ts"],
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = resolveInFlightWorktrees(
    [
      { path: path.join(dir, "..", "wt-a"), branch: "refs/heads/task/gap-dup" },
      { path: path.join(dir, "..", "wt-b"), branch: "refs/heads/task/gap-dup" },
    ],
    { root: dir, tasksDir },
  );
  assert.equal(out.length, 1, "one task id ⇒ one in-flight entry");
  assert.equal(out[0].id, "gap-dup");
});

test("computeInFlightWorktreeTouches: a non-git root yields [] (fail-soft, never a fabricated block)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("nogit", { "gap-nogit": ["- code/a.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(computeInFlightWorktreeTouches(dir, tasksDir), []);
});

// ── IN-FLIGHT WORKTREE LIVENESS (gap-compute-inflight-worktree-touches-no-liveness-check) ────────
// AC1/AC2/AC3: a worktree must be counted as in-flight ONLY while it shows direct-quantity liveness
// (a live process under it, or a commit on its branch within INFLIGHT_WORKTREE_STALE_MS). A DEAD
// worktree (zero live processes + stale commit) must NOT occupy its declared ## Touches — else a
// single dead worktree locks out every overlapping candidate (pool=31 blocked by one dead worktree).
// The pure core (resolveInFlightWorktrees) is tested with INJECTED liveness (hermetic, no /proc/git);
// the production wiring (computeInFlightWorktreeTouches) is tested against a REAL git worktree.

// A minimal real git repo with a tasks/ dir, for the production-wiring tests.
function makeRealGitRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cbs-git-${tag}-`));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  const tasksDir = path.join(dir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  return { dir, tasksDir };
}

// Commit everything, optionally pinning the author+committer dates (GIT_COMMITTER_DATE is what
// `git log --format=%ct` reads, so pinning it makes a worktree's last-commit-time deterministic).
function gitCommit(dir, message, date) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: dir,
    env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env,
  });
}

test("resolveInFlightWorktrees: a DEAD worktree (zero processes + stale commit) is excluded (AC1)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("dead-pure", { "gap-dead": ["- code/shared.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000; // arbitrary fixed "now"
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-dead"), branch: "refs/heads/task/gap-dead" };
  const out = resolveInFlightWorktrees([wt], {
    root: dir,
    tasksDir,
    nowMs,
    liveness: () => ({ hasLiveProcess: false, lastCommitMs: nowMs - 2 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 0, "zero live processes + commit older than N ⇒ DEAD ⇒ not in-flight");
});

test("resolveInFlightWorktrees: a LIVE worktree (live process) is kept regardless of commit age (AC3)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("live-pure", { "gap-live": ["- code/shared.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000;
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-live"), branch: "refs/heads/task/gap-live" };
  const out = resolveInFlightWorktrees([wt], {
    root: dir,
    tasksDir,
    nowMs,
    liveness: () => ({ hasLiveProcess: true, lastCommitMs: nowMs - 10 * INFLIGHT_WORKTREE_STALE_MS }),
  });
  assert.equal(out.length, 1, "a live process ⇒ in-flight even with a very old commit");
  assert.equal(out[0].id, "gap-live");
});

test("resolveInFlightWorktrees: a zero-process worktree with a RECENT commit stays in-flight (backstop)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("recent-pure", { "gap-recent": ["- code/a.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000;
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-recent"), branch: "refs/heads/task/gap-recent" };
  const out = resolveInFlightWorktrees([wt], {
    root: dir,
    tasksDir,
    nowMs,
    // commit just INSIDE the window (now - N + 1s) ⇒ NOT dead
    liveness: () => ({ hasLiveProcess: false, lastCommitMs: nowMs - INFLIGHT_WORKTREE_STALE_MS + 1000 }),
  });
  assert.equal(out.length, 1, "a recent commit keeps a zero-process worktree in-flight (just-dispatched backstop)");
});

test("resolveInFlightWorktrees: unknown liveness / unreadable commit time is conservative-alive (not a fabricated block)", (t) => {
  const { dir, tasksDir } = makeWorktreeTasks("unknown-pure", { "gap-unknown": ["- code/a.ts"] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = 1_000_000_000_000;
  const wt = { path: path.join(dir, "..", "quay-worktrees", "gap-unknown"), branch: "refs/heads/task/gap-unknown" };
  // No liveness injected (liveness omitted ⇒ null) ⇒ every worktree is alive (pre-fix behavior).
  const noLiveness = resolveInFlightWorktrees([wt], { root: dir, tasksDir, nowMs });
  assert.equal(noLiveness.length, 1, "no liveness injection ⇒ alive (backward-compatible)");
  // Liveness returns an unreadable commit time (null) ⇒ alive (hard rule 6: 缺值 = 未查).
  const nullCommit = resolveInFlightWorktrees([wt], {
    root: dir,
    tasksDir,
    nowMs,
    liveness: () => ({ hasLiveProcess: false, lastCommitMs: null }),
  });
  assert.equal(nullCommit.length, 1, "an unreadable commit time ⇒ alive (conservative)");
});

test("computeInFlightWorktreeTouches: a DEAD real worktree (old commit + zero processes) is excluded (AC1 wiring / AC2 negative control)", (t) => {
  const { dir, tasksDir } = makeRealGitRepo("dead-wiring");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  fs.writeFileSync(path.join(tasksDir, "gap-dead.md"), touchSectionBody(["- code/shared.ts"]));
  gitCommit(dir, "base + task file", "2026-08-20T00:00:00Z");
  execFileSync("git", ["branch", "task/gap-dead"], { cwd: dir });
  const wtPath = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  execFileSync("git", ["worktree", "add", "-q", wtPath, "task/gap-dead"], { cwd: dir });
  const out = computeInFlightWorktreeTouches(dir, tasksDir);
  assert.equal(out.length, 0, "a DEAD worktree (stale commit + no live process) must not occupy its Touches");
});

test("computeInFlightWorktreeTouches: a JUST-DISPATCHED real worktree (recent commit, no process yet) stays in-flight (AC3 wiring)", (t) => {
  const { dir, tasksDir } = makeRealGitRepo("fresh-wiring");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  fs.writeFileSync(path.join(tasksDir, "gap-fresh.md"), touchSectionBody(["- code/x.ts"]));
  gitCommit(dir, "base + task file"); // no date ⇒ committer time = now
  execFileSync("git", ["branch", "task/gap-fresh"], { cwd: dir });
  const wtPath = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  execFileSync("git", ["worktree", "add", "-q", wtPath, "task/gap-fresh"], { cwd: dir });
  const out = computeInFlightWorktreeTouches(dir, tasksDir);
  assert.equal(out.length, 1, "a recent commit keeps a zero-process worktree in-flight");
  assert.equal(out[0].id, "gap-fresh");
});
