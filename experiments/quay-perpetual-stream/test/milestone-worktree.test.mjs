// @test-group engine
// milestone-worktree.test.mjs — DIR-123: unit tests for the per-milestone git-worktree isolation
// primitive (scripts/milestone-worktree.ts) plus the SAME-FILE-CONFLICT pre-dispatch decision
// (concurrent-batch-scheduler.ts's worktreeDispatchEligibility, which reuses touches-orthogonality-
// check.ts's checkTouchesPair — never a second checker).
//
// Pure decision functions are tested with no git needed. The real git operations (addWorktree /
// mergeWorktree / removeWorktree) and the Land lock are tested against THROWAWAY git repos created in
// os.tmpdir() — REAL `git worktree add` / `git merge --no-ff` / `git worktree remove` / `git branch -d`
// and real atomic file-lock contention, asserted on real resulting git/filesystem state. The
// milestone-root derivation is pinned against gate-script-lib.sh's shell single-source so the TS mirror
// cannot silently drift.
//
// Run:
//   node --experimental-strip-types --test experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import {
  parseMilestoneNum, milestoneRootRel, worktreeRelPath, worktreeBranch, computeIsolationPlan,
  addWorktree, mergeWorktree, removeWorktree, cleanStaleWorktree, acquireLandLock, releaseLandLock, LAND_LOCK_STALENESS_MS, _internal,
} from "../scripts/milestone-worktree.ts";
import { worktreeDispatchEligibility, parseCandidate } from "../scripts/concurrent-batch-scheduler.ts";
import { parseTouches, expandGlobs } from "../scripts/touches-orthogonality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GATE_LIB = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "gate-script-lib.sh");

// ── pure decision functions (no git) ──────────────────────────────────────────────────────────────
test("parseMilestoneNum extracts the number from every charter-derived shape", () => {
  assert.equal(parseMilestoneNum("M191"), 191);
  assert.equal(parseMilestoneNum("191"), 191);
  assert.equal(parseMilestoneNum("M191-some-slug"), 191);
  assert.equal(parseMilestoneNum("milestones/M191/M191-charter.md"), 191);
  assert.equal(parseMilestoneNum("<extracted-from-charter>"), null);
  assert.equal(parseMilestoneNum(""), null);
  assert.equal(parseMilestoneNum(null), null);
});

test("milestoneRootRel agrees with the shell '>= 130' boundary", () => {
  assert.equal(milestoneRootRel(191), "milestones/M191");
  assert.equal(milestoneRootRel(130), "milestones/M130");
  assert.equal(milestoneRootRel(129), "experiments/quay-perpetual-stream/milestones/M129");
  assert.equal(milestoneRootRel(99), "experiments/quay-perpetual-stream/milestones/M99");
  assert.equal(milestoneRootRel(NaN), null);
});

test("milestoneRootRel matches gate-script-lib.sh's gate_resolve_milestone_root (no TS/shell drift)", () => {
  for (const n of [1, 99, 129, 130, 131, 191, 250]) {
    const shell = execFileSync("bash", ["-c", `source "${GATE_LIB}" && gate_resolve_milestone_root ${n}`], { encoding: "utf8" }).trim();
    assert.equal(milestoneRootRel(n), shell, `TS/shell milestone-root drift at M${n}`);
  }
});

test("worktreeRelPath / worktreeBranch are deterministic and milestone-scoped (collision-resistant)", () => {
  assert.equal(worktreeRelPath(191), "milestones/M191/worktrees/iteration-0");
  assert.equal(worktreeBranch(191), "milestone/M191/iteration-0");
  assert.equal(worktreeRelPath(99), "experiments/quay-perpetual-stream/milestones/M99/worktrees/iteration-0");
  // Two different milestones NEVER share a path or branch.
  assert.notEqual(worktreeRelPath(191), worktreeRelPath(192));
  assert.notEqual(worktreeBranch(191), worktreeBranch(192));
  assert.equal(worktreeRelPath(NaN), null);
});

test("computeIsolationPlan: opt-in only; fail-closed on unusable; legacy otherwise", () => {
  assert.deepEqual(computeIsolationPlan({ milestone: "M191" }), { isolated: false });            // omitted
  assert.deepEqual(computeIsolationPlan({ milestone: "M191", isolationMode: "" }), { isolated: false }); // empty
  assert.deepEqual(computeIsolationPlan({ milestone: "M191", isolationMode: "worktree" }),
    { isolated: true, milestoneNum: 191, worktreeRel: "milestones/M191/worktrees/iteration-0", branch: "milestone/M191/iteration-0" });
  assert.deepEqual(computeIsolationPlan({ milestone: "M191", isolationMode: "bogus" }),
    { isolated: false, error: "unknown-isolation-mode: bogus" });
  assert.deepEqual(computeIsolationPlan({ milestone: "<extracted>", isolationMode: "worktree" }),
    { isolated: false, error: "worktree-needs-numeric-milestone" });
});

// ── real git operations (throwaway repos) ─────────────────────────────────────────────────────────
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dir123-mw-"));
  const g = (a, cwd = dir) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim();
  g(["init", "-q", "-b", "master", "."]);
  g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  g(["add", "-A"]); g(["commit", "-qm", "base"]);
  return { dir, g };
}

test("addWorktree → mergeWorktree → removeWorktree: real git lifecycle, primary clean until merge", () => {
  const { dir, g } = makeRepo();
  try {
    const add = addWorktree({ workspace: dir, milestone: "M191" });
    assert.equal(add.outcome, "added");
    assert.ok(fs.existsSync(add.worktreeAbs), "worktree dir really created");
    assert.match(g(["worktree", "list"]), /iteration-0/);

    // Real edit + commit INSIDE the worktree branch.
    fs.writeFileSync(path.join(add.worktreeAbs, "feature.txt"), "x\n");
    execFileSync("git", ["-C", add.worktreeAbs, "add", "-A"]);
    execFileSync("git", ["-C", add.worktreeAbs, "commit", "-qm", "feat"]);

    // Primary checkout has NO tracked modifications before the merge.
    assert.equal(g(["diff", "HEAD", "--name-only"]), "");
    assert.equal(fs.existsSync(path.join(dir, "feature.txt")), false, "feature not in primary pre-merge");

    // add is fail-closed on a pre-existing path (same-milestone double-dispatch collides, never reuses).
    assert.equal(addWorktree({ workspace: dir, milestone: "M191" }).outcome, "error");
    assert.equal(addWorktree({ workspace: dir, milestone: "M191" }).code, "worktree-path-exists");

    const merge = mergeWorktree({ workspace: dir, milestone: "M191" });
    assert.equal(merge.outcome, "merged");
    assert.match(merge.mergeCommit, /^[0-9a-f]{40}$/);
    assert.equal(fs.existsSync(path.join(dir, "feature.txt")), true, "feature merged into primary");
    // A real merge commit (--no-ff) has two parents.
    assert.equal(g(["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length, 3);

    const rm = removeWorktree({ workspace: dir, milestone: "M191" });
    assert.equal(rm.outcome, "removed");
    assert.equal(g(["worktree", "list"]).split("\n").length, 1, "worktree removed");
    assert.equal(g(["branch", "--list", "milestone/M191/iteration-0"]), "", "branch deleted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeWorktree on a real conflict auto-aborts, leaving the primary clean (defined Land handling)", () => {
  const { dir, g } = makeRepo();
  try {
    addWorktree({ workspace: dir, milestone: "M192" });
    const wt = path.join(dir, worktreeRelPath(192));
    fs.writeFileSync(path.join(wt, "README.md"), "WT\n");
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "wt"]);
    fs.writeFileSync(path.join(dir, "README.md"), "MASTER\n");
    g(["add", "-A"]); g(["commit", "-qm", "master"]);
    const merge = mergeWorktree({ workspace: dir, milestone: "M192" });
    assert.equal(merge.outcome, "conflict");
    assert.deepEqual(merge.files, ["README.md"]);
    assert.equal(g(["diff", "HEAD", "--name-only"]), "", "merge --abort leaves primary clean");
    assert.equal(fs.readFileSync(path.join(dir, "README.md"), "utf8").trim(), "MASTER");
    // Branch still exists (not deleted) so a human can resolve — removeWorktree's `branch -d` would refuse it.
    assert.match(g(["branch", "--list", "milestone/M192/iteration-0"]), /iteration-0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeWorktree's `branch -d` refuses to delete an UNMERGED branch (backstop)", () => {
  const { dir } = makeRepo();
  try {
    addWorktree({ workspace: dir, milestone: "M193" });
    const wt = path.join(dir, worktreeRelPath(193));
    fs.writeFileSync(path.join(wt, "unmerged.txt"), "x\n");
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "unmerged"]);
    // Do NOT merge. removeWorktree removes the worktree dir but `branch -d` must REFUSE the unmerged branch.
    const rm = removeWorktree({ workspace: dir, milestone: "M193" });
    assert.equal(rm.outcome, "error");
    assert.equal(rm.code, "git-branch-delete-failed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Land lock: single-flight serialization of concurrent Lands on the shared checkout ─────────────
test("Land lock: single-flight, owner-fenced release, stale reclaim (no permanent lockout)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dir123-lock-"));
  try {
    const A = acquireLandLock({ workspace: dir, ownerExecutionId: "sess-A", now: 1000 });
    assert.equal(A.outcome, "acquired");
    assert.equal(A.reclaimed, false);
    // A second concurrent Land is refused while A holds a non-expired lock.
    const B = acquireLandLock({ workspace: dir, ownerExecutionId: "sess-B", now: 2000 });
    assert.equal(B.outcome, "land-already-running");
    assert.equal(B.owner.ownerExecutionId, "sess-A");
    // Release is owner-fenced: B cannot release A's lock.
    assert.equal(releaseLandLock({ workspace: dir, ownerExecutionId: "sess-B", now: 3000 }).outcome, "error");
    assert.equal(releaseLandLock({ workspace: dir, ownerExecutionId: "sess-A", now: 3000 }).outcome, "released");
    assert.ok(!fs.existsSync(_internal.landLockPath(dir)), "lock file removed on release");
    // Stale reclaim: a crashed A (never released) is recovered by B once the lease expires — no lockout.
    acquireLandLock({ workspace: dir, ownerExecutionId: "sess-A", now: 10000 });
    const stale = acquireLandLock({ workspace: dir, ownerExecutionId: "sess-B", now: 10000 + LAND_LOCK_STALENESS_MS + 1 });
    assert.equal(stale.outcome, "acquired");
    assert.equal(stale.reclaimed, true);
    // An audit trail records the reclaim (never a silent unlock).
    assert.match(fs.readFileSync(_internal.landLockAuditPath(dir), "utf8"), /stale-reclaim/);
    // missing session id / missing now fail closed.
    assert.equal(acquireLandLock({ workspace: dir, ownerExecutionId: null, now: 1 }).outcome, "error");
    assert.equal(acquireLandLock({ workspace: dir, ownerExecutionId: "x", now: NaN }).outcome, "error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Obstacle 3: crashed-dispatch recovery (cleanStaleWorktree) ─────────────────────────────────────
test("cleanStaleWorktree: cleans a stranded 0-ahead worktree (crash recovery) but REFUSES a branch with real work", () => {
  const { dir, g } = makeRepo();
  try {
    // Fresh repo → nothing to clean.
    assert.equal(cleanStaleWorktree({ workspace: dir, milestone: "M191" }).outcome, "nothing-to-clean");
    // Strand a worktree whose branch has ZERO commits ahead of master (a crash before any build commit).
    assert.equal(addWorktree({ workspace: dir, milestone: "M191" }).outcome, "added");
    const cleaned = cleanStaleWorktree({ workspace: dir, milestone: "M191" });
    assert.equal(cleaned.outcome, "cleaned", JSON.stringify(cleaned));
    assert.equal(g(["branch", "--list", "milestone/M191/iteration-0"]), "", "0-ahead branch removed");
    assert.equal(fs.existsSync(path.join(dir, worktreeRelPath(191))), false, "worktree dir removed");
    // A retry --add now succeeds — recovered from the stranded state (no permanent fail-closed).
    assert.equal(addWorktree({ workspace: dir, milestone: "M191" }).outcome, "added");
    // Put REAL work on the branch (a commit ahead of master) → clean must REFUSE (never discard real work).
    const wt = path.join(dir, worktreeRelPath(191));
    fs.writeFileSync(path.join(wt, "real.txt"), "real work\n");
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "real"]);
    const refused = cleanStaleWorktree({ workspace: dir, milestone: "M191" });
    assert.equal(refused.outcome, "has-commits", JSON.stringify(refused));
    assert.ok(refused.aheadCount >= 1, "must report the commits-ahead count");
    // The real work is preserved (branch + worktree still exist).
    assert.match(g(["branch", "--list", "milestone/M191/iteration-0"]), /iteration-0/);
    assert.ok(fs.existsSync(path.join(wt, "real.txt")), "real work must NOT be discarded");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion (2026-08-03) ───────────────────────────
// The OLD `merged-then-reverted` criterion compared a two-dot tree diff `master..<branch>`. For a
// branch merged days ago, master has advanced hundreds of commits, so the two-dot diff is ALWAYS
// non-empty — the criterion false-flagged every genuinely-merged branch (all 21, once master moved on).
// The FIX: ask directly "are all branch commits in master" (`merge-base --is-ancestor`) and "do the
// files the branch created still exist on master" (two-dot `--diff-filter=A`). These tests pin the
// false-positive fix (AC1) AND that the true positive (revert-of-merge, the M243 shape) is still caught
// (AC2), plus the worktree-cleanliness gate (AC3) and the removal of `--force` (AC4).

test("cleanStaleWorktree: a merged branch whose master has since advanced is CLEANED, not false-flagged merged-then-reverted (AC1)", () => {
  const { dir, g } = makeRepo();
  try {
    // Full milestone lifecycle: add → commit work in the worktree → merge back (branch now an ancestor).
    assert.equal(addWorktree({ workspace: dir, milestone: "M200" }).outcome, "added");
    const wt = path.join(dir, worktreeRelPath(200));
    fs.writeFileSync(path.join(wt, "feature.txt"), "x\n");
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "feat"]);
    assert.equal(mergeWorktree({ workspace: dir, milestone: "M200" }).outcome, "merged");
    // Master ADVANCES with an unrelated commit. Under the OLD two-dot-diff criterion this made
    // `git diff master..branch` non-empty → the merged branch was locked as merged-then-reverted
    // forever (the exact 21-worktree/1.1G failure). The branch's own content is still on master.
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "master moved on\n");
    g(["add", "-A"]); g(["commit", "-qm", "master advance"]);
    const cleaned = cleanStaleWorktree({ workspace: dir, milestone: "M200" });
    assert.equal(cleaned.outcome, "cleaned", JSON.stringify(cleaned));
    assert.equal(g(["branch", "--list", "milestone/M200/iteration-0"]), "", "merged branch removed");
    assert.ok(!fs.existsSync(path.join(dir, worktreeRelPath(200))), "clean merged worktree removed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanStaleWorktree: a revert-of-merge IS still reported merged-then-reverted — branch-created files missing from master (AC2, M243 shape)", () => {
  const { dir, g } = makeRepo();
  try {
    assert.equal(addWorktree({ workspace: dir, milestone: "M200" }).outcome, "added");
    const wt = path.join(dir, worktreeRelPath(200));
    fs.writeFileSync(path.join(wt, "replay-fixture.json"), '{"k":"v"}\n');
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "add fixture"]);
    assert.equal(mergeWorktree({ workspace: dir, milestone: "M200" }).outcome, "merged");
    // Revert the merge ON master: the merge commit stays in history (branch remains an ancestor) but
    // the branch-created file disappears from master's tree — the exact M243 revert-of-merge shape
    // (83 workflow-replay files missing at 88e17bf2). `-m 1` is required to revert a merge commit.
    g(["revert", "--no-edit", "-m", "1", "HEAD"]);
    assert.equal(fs.existsSync(path.join(dir, "replay-fixture.json")), false, "revert removed the file from master");
    assert.ok(fs.existsSync(path.join(wt, "replay-fixture.json")), "the file still exists in the branch worktree");
    const res = cleanStaleWorktree({ workspace: dir, milestone: "M200" });
    assert.equal(res.outcome, "merged-then-reverted", JSON.stringify(res));
    assert.match(res.detail, /replay-fixture\.json/);
    // Real work is NOT discarded: branch and worktree survive the refusal.
    assert.match(g(["branch", "--list", "milestone/M200/iteration-0"]), /iteration-0/);
    assert.ok(fs.existsSync(path.join(wt, "replay-fixture.json")), "worktree file must survive");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanStaleWorktree: a MERGED branch whose WORKTREE is dirty is refused (has-uncommitted) and the worktree survives (AC3)", () => {
  const { dir, g } = makeRepo();
  try {
    assert.equal(addWorktree({ workspace: dir, milestone: "M200" }).outcome, "added");
    const wt = path.join(dir, worktreeRelPath(200));
    fs.writeFileSync(path.join(wt, "feature.txt"), "x\n");
    execFileSync("git", ["-C", wt, "add", "-A"]); execFileSync("git", ["-C", wt, "commit", "-qm", "feat"]);
    assert.equal(mergeWorktree({ workspace: dir, milestone: "M200" }).outcome, "merged");
    // Dirty the WORKTREE with an uncommitted edit — a clean branch does NOT imply a clean worktree.
    fs.writeFileSync(path.join(wt, "feature.txt"), "x\nuncommitted\n");
    const res = cleanStaleWorktree({ workspace: dir, milestone: "M200" });
    assert.equal(res.outcome, "has-uncommitted", JSON.stringify(res));
    assert.match(res.detail, /feature\.txt/);
    // The dirty worktree is PRESERVED (git-status gate, never --force past it).
    assert.ok(fs.existsSync(path.join(wt, "feature.txt")));
    assert.ok(fs.existsSync(path.join(dir, worktreeRelPath(200))), "worktree dir must survive");
    assert.match(g(["branch", "--list", "milestone/M200/iteration-0"]), /iteration-0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("removeWorktree no longer uses --force: git's own dirty-worktree refusal is the last gate (AC4)", () => {
  const { dir, g } = makeRepo();
  try {
    assert.equal(addWorktree({ workspace: dir, milestone: "M200" }).outcome, "added");
    const wt = path.join(dir, worktreeRelPath(200));
    // Untracked non-ignored file in the worktree, nothing committed. `git worktree remove` WITHOUT
    // --force refuses with git's built-in "contains modified or untracked files" gate — the protection
    // the old code explicitly bypassed with --force.
    fs.writeFileSync(path.join(wt, "dirty.txt"), "uncommitted\n");
    const res = removeWorktree({ workspace: dir, milestone: "M200" });
    assert.equal(res.outcome, "error");
    assert.equal(res.code, "git-worktree-remove-failed");
    assert.match(g(["worktree", "list"]), /iteration-0/, "worktree must survive git's refusal");
    assert.ok(fs.existsSync(path.join(wt, "dirty.txt")), "uncommitted file must survive");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Obstacle 4: the Land lock's mutual exclusion is REAL — deterministic env-gated overlap test ─────
// Mirrors proposal-convergence.ts's QUAY_EPOCH_LOCK_TEST_HOLD_MS regression test (a broken lock
// surfaced only ~57% of the time relying on scheduling luck). QUAY_LAND_LOCK_TEST_HOLD_MS widens the
// holder's critical section so a concurrent acquirer is DETERMINISTICALLY refused while the holder
// holds — a real two-process overlap, not an injected-`now` simulation.
test("Land lock mutual exclusion is REAL: a concurrent acquirer is deterministically refused while a holder process holds (env-gated hold-delay)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dir123-lockrace-"));
  let holder;
  try {
    const HOLD_MS = 800;
    const wtScript = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "milestone-worktree.ts");
    // Holder subprocess: acquires the lock, then sleeps HOLD_MS AFTER acquiring and BEFORE returning
    // (the env-gated widened critical section) — so it genuinely HOLDS across the window below.
    holder = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", wtScript, "--land-lock-acquire", "--workspace", dir], {
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: "sess-holder", QUAY_LAND_LOCK_TEST_HOLD_MS: String(HOLD_MS) },
    });
    // Wait until the holder has actually acquired (it writes the lock file BEFORE its hold-sleep), so
    // the overlap below is deterministic regardless of node/strip-types startup latency.
    const lockFile = _internal.landLockPath(dir);
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(lockFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fs.existsSync(lockFile), "holder must acquire the lock (create the lock file) within 8s");
    // The holder is now inside its guaranteed HOLD_MS critical section. A concurrent acquirer must be
    // REFUSED — the decisive mutual-exclusion assertion, independent of scheduling luck.
    const second = acquireLandLock({ workspace: dir, ownerExecutionId: "sess-second", now: Date.now() });
    assert.equal(second.outcome, "land-already-running", `concurrent acquirer must be refused while the holder holds: ${JSON.stringify(second)}`);
    assert.equal(second.owner.ownerExecutionId, "sess-holder");
    // The holder's CLI is acquire-only (it never releases), so the lock stays held until released —
    // release as the holder, then a fresh acquire succeeds (no permanent lockout / re-acquirable).
    const rel = releaseLandLock({ workspace: dir, ownerExecutionId: "sess-holder", now: Date.now() });
    assert.equal(rel.outcome, "released");
    const third = acquireLandLock({ workspace: dir, ownerExecutionId: "sess-second", now: Date.now() });
    assert.equal(third.outcome, "acquired");
  } finally {
    try { holder.kill(); } catch { /* already exited */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── SAME-FILE-CONFLICT pre-dispatch decision (Requested-action #5/#7): reject via orthogonality ────
// Reuses touches-orthogonality-check.ts's checkTouchesPair (through assembleBatch) — NOT a second
// checker. Two worktree-isolated Builds touching the SAME file are rejected PRE-DISPATCH (the later one
// deferred to a serial round, tagged sameFileConflict:true), not admitted to collide at Land.
test("worktreeDispatchEligibility: disjoint candidates batch; same-file candidates are rejected pre-dispatch", () => {
  // A temp file tree so the real glob expander resolves concrete files.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dir123-elig-"));
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "mod"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "composite-build.ts"), "");
    fs.writeFileSync(path.join(root, "src", "composite-audit.ts"), "");
    fs.writeFileSync(path.join(root, "src", "shared.ts"), "");
    fs.writeFileSync(path.join(root, "src", "mod", "shared2.ts"), "");
    fs.writeFileSync(path.join(root, "src", "mod", "other.ts"), "");
    const expand = (globs) => expandGlobs(globs, root);
    const charter = (touches) => `**type:** execution\n\n**Value type:** capability-growth\n\n## Touches\n${touches.map((t) => `- ${t}`).join("\n")}\n`;
    const mk = (id, touches) => parseCandidate(id, charter(touches));

    // Genuinely file-disjoint (the DIR-119-D2 vs D3 shape) → BOTH eligible for concurrent worktree dispatch.
    const disjoint = worktreeDispatchEligibility([mk("D2", ["src/composite-build.ts"]), mk("D3", ["src/composite-audit.ts"])], { expand });
    assert.deepEqual(disjoint.eligible, ["D2", "D3"]);
    assert.equal(disjoint.mustSerialize.length, 0);

    // SAME file → the second is rejected pre-dispatch, tagged sameFileConflict:true.
    const conflict = worktreeDispatchEligibility([mk("A", ["src/shared.ts"]), mk("B", ["src/shared.ts"])], { expand });
    assert.deepEqual(conflict.eligible, ["A"]);
    assert.equal(conflict.mustSerialize.length, 1);
    assert.equal(conflict.mustSerialize[0].id, "B");
    assert.equal(conflict.mustSerialize[0].sameFileConflict, true, "the serialize reason must be a concrete same-file overlap");
    assert.match(conflict.mustSerialize[0].reason, /overlapping file-sets/);

    // A ≥2-segment-anchored glob that concretely overlaps a file the other touches exactly → also a
    // same-file conflict. (A 1-segment glob like `src/*.ts` is OVERBROAD per isOverbroadDeclaration and
    // is rejected for a CONSERVATIVE reason instead — still serialized, just not tagged sameFileConflict.)
    const globOverlap = worktreeDispatchEligibility([mk("A", ["src/mod/shared2.ts"]), mk("B", ["src/mod/*.ts"])], { expand });
    assert.deepEqual(globOverlap.eligible, ["A"]);
    assert.equal(globOverlap.mustSerialize[0].sameFileConflict, true);
    assert.match(globOverlap.mustSerialize[0].reason, /overlapping file-sets/);
    // And an overbroad glob is still serialized (conservative), demonstrating it is NOT mislabeled a conflict.
    const overbroad = worktreeDispatchEligibility([mk("A", ["src/shared.ts"]), mk("B", ["src/*.ts"])], { expand });
    assert.deepEqual(overbroad.eligible, ["A"]);
    assert.equal(overbroad.mustSerialize[0].sameFileConflict, false);
    assert.match(overbroad.mustSerialize[0].reason, /conservative/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// parseTouches round-trips through the same single-source parser the eligibility check consumes.
test("worktreeDispatchEligibility consumes touches-orthogonality-check.ts's parseTouches (single source)", () => {
  const parsed = parseTouches("## Touches\n- src/a.ts\n- `src/b.ts`\n");
  assert.deepEqual(parsed.globs, ["src/a.ts", "src/b.ts"]);
  assert.equal(parsed.hasSection, true);
});
