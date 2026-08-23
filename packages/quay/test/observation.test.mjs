// @test-group product
// gap-git-history-counts-stale-branches — readGitHistory must count only ACTIVE local branches as
// chart lanes. The old `git log --branches --source` counted every local branch, so a merged-but-
// never-deleted leftover branch (a fan-in source left dangling) kept polluting the lane count long
// after it was dead. The fix enumerates branch tips + their commit time and traverses only the
// branches with a commit inside GIT_HISTORY_ACTIVE_WINDOW_SEC; the stale branch's commits are
// already reachable from the mainline, so they are relabeled (not dropped).
//
// /git-history is a user-visible web contract ⇒ `product` group. New file ⇒ node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readGitHistory, parseVerificationRound, readLive, taskWorktreeOpen } from "../src/observation.ts";

/** Commit helper with a fixed clock (committer date = author date = `t`), per-branch file. */
function commitAt(ws, msg, t, file = "log.txt") {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(t * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(t * 1000).toISOString(),
  };
  fs.appendFileSync(path.join(ws, file), `${msg}\n`);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws, env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: ws, env });
}

test("readGitHistory excludes a merged-but-stale branch from the lanes (negative control)", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: ws });

    const nowSec = Math.floor(Date.now() / 1000);
    // The exact pollution shape the finding names: a fan-in leftover whose work was merged into the
    // mainline but whose branch ref was never deleted — tip is 30 days old (stale).
    execFileSync("git", ["checkout", "-q", "-b", "verify/stale"], { cwd: ws });
    commitAt(ws, "stale work", nowSec - 30 * 86400, "stale.txt");
    execFileSync("git", ["checkout", "-q", "master"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-ff", "verify/stale", "-m", "merge verify/stale"], { cwd: ws });
    commitAt(ws, "main recent", nowSec - 60);

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    const refs = new Set(hist.commits.map((c) => c.ref));
    assert.ok(!refs.has("verify/stale"), `stale branch must not be a lane (lanes: ${[...refs].join(", ")})`);
    assert.ok(refs.has("master"), "the active mainline branch is still a lane");
    assert.ok(hist.commits.some((c) => c.subject === "stale work"), "the stale branch's merged commit is still shown (relabeled to the mainline, not dropped)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readGitHistory degrades to 「无活跃分支」 when every branch is stale", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-old-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    // The ONLY commit is 30 days old → no branch has a commit in the active window.
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400;
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(oldSec * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(oldSec * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "old"], { cwd: ws, env });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "empty");
    assert.match(hist.reason || "", /无活跃分支/, "reason says no active branch, not 「无提交记录」");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC127: parseVerificationRound extracts the bucket-execution fields (buckets/bucket_files/bucket_duration_ms) and tolerates their absence on legacy rows (never a fabricated \"full\")", () => {
  // gap-ac127-suite-bucket-web-tests-page-visible — AC126 landed these three fields on bucket-mode
  // rounds (full-suite-runner.ts:4027-4029); the /tests reader must surface `buckets` and tolerate
  // legacy rows that carry none of them (absence → undefined, NOT a fabricated "full").
  const bucketRow = parseVerificationRound(JSON.stringify({
    round: 240, startedAt: "2026-08-22T00:00:00.000Z", durationMs: 366000,
    state: "green", pass: 500, fail: 0, cancelled: 0, tests: 500, reason: null,
    commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f", scope: "bucket", runner: "outer",
    buckets: "M", bucket_files: 12, bucket_duration_ms: 366000,
  }));
  assert.equal(bucketRow.buckets, "M", "buckets label renders");
  assert.equal(bucketRow.bucket_files, 12, "bucket_files renders the selected test-file count");
  assert.equal(bucketRow.bucket_duration_ms, 366000, "bucket_duration_ms renders the round's own durationMs");

  // Legacy row (no bucket fields — the default full suite / pre-fix shape) ⇒ undefined, never "full".
  const legacy = parseVerificationRound(JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
  }));
  assert.equal(legacy.buckets, undefined, "a legacy row has no buckets field (absent-field contract)");
  assert.equal(legacy.bucket_files, undefined, "a legacy row has no bucket_files field");
  assert.equal(legacy.bucket_duration_ms, undefined, "a legacy row has no bucket_duration_ms field");
});

test("gap-test-detail-perfile-duration-failed: parseVerificationRound extracts perFile ({file,durationMs,passed}) and tolerates its absence on legacy rows", () => {
  // full-suite-runner lands `perFile` on the round record (reusing measure-suite-reporter's
  // __PERFILE__ stream); the /tests reader must surface it and tolerate legacy rows that carry none.
  const withPerFile = parseVerificationRound(JSON.stringify({
    round: 241, startedAt: "2026-08-23T00:00:00.000Z", durationMs: 500000,
    state: "red", pass: 1, fail: 1, cancelled: 0, tests: 2, reason: "failed",
    runner: "outer", scope: "worktree",
    perFile: [
      { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: false },
      { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true },
    ],
  }));
  assert.ok(Array.isArray(withPerFile.perFile), "perFile is an array");
  assert.equal(withPerFile.perFile.length, 2, "both entries parsed");
  assert.deepEqual(withPerFile.perFile[0], { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: false }, "failed entry (file/durationMs/passed) preserved");
  assert.deepEqual(withPerFile.perFile[1], { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true }, "passed entry preserved");

  // Legacy row (no perFile field) ⇒ undefined, never a fabricated [].
  const legacy = parseVerificationRound(JSON.stringify({
    round: 228, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519,
    state: "green", runner: "outer", scope: "worktree",
    commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9",
  }));
  assert.equal(legacy.perFile, undefined, "a legacy row has no perFile field (absent-field contract)");
});

// ── gap-live-ghost-inflight-paused-event ─────────────────────────────────────────────────────────
// readLive cross-validates the event-stream in-flight pairing (start without end) against worktree
// existence. The fast-mode worktree namespace is `<parent-of-main>/quay-worktrees` — so each fixture
// nests the workspace under a private `parent/` so `dirname(root)/quay-worktrees` is test-private and
// never touches the shared /tmp/quay-worktrees (which other suites must be able to assume is absent).
// A start-no-end run whose worktree was RELEASED (complete / crash / operational-pause, no end event)
// is a ghost and must be removed; the removal must be fail-closed (an unobservable namespace keeps the
// run — never a positive "released" from a source that could not be observed).

/** Build a nested workspace whose `dirname(root)/quay-worktrees` is test-private. */
function ghostWorkspace(prefix) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const root = path.join(parent, "main");
  fs.mkdirSync(root, { recursive: true });
  const namespace = path.join(parent, "quay-worktrees");
  return { parent, root, namespace };
}

/** Write a single Fast start event (no end) for `taskId` into root's .workflow-events/. */
function writeStartEvent(root, taskId, startedAtMs) {
  const eventsDir = path.join(root, ".workflow-events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, `fm-${taskId}.jsonl`),
    JSON.stringify({ stage: "Fast", runId: `fm-${taskId}-1`, taskId, eventKind: "start", timing: { queuedAtMs: null, startedAtMs, endedAtMs: null } }) + "\n"
  );
}

test("AC1: readLive removes a released-worktree ghost (start-no-end + worktree absent in an observable namespace)", () => {
  const { parent, root, namespace } = ghostWorkspace("ghost-released");
  try {
    fs.mkdirSync(namespace, { recursive: true }); // worktree isolation IS in play…
    writeStartEvent(root, "GHOST-1", Date.now() - 3600_000); // …but GHOST-1's slot was released.
    assert.equal(taskWorktreeOpen(root, "GHOST-1"), false,
      "AC1: an observable namespace without the task's worktree is a positive 'released' reading");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(!live.inFlight.some((t) => t.taskId === "GHOST-1"),
      "AC1: the released-worktree ghost is removed from readLive inFlight (not shown as 实现中)");
    assert.equal(live.concurrency, 0, "AC1: the ghost does not inflate the in-flight concurrency count");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1 negative control: a start-no-end run WITH its worktree present stays in-flight (the filter is real, not vacuous)", () => {
  const { parent, root, namespace } = ghostWorkspace("ghost-kept");
  try {
    fs.mkdirSync(namespace, { recursive: true });
    fs.mkdirSync(path.join(namespace, "KEEP-1"), { recursive: true }); // the slot is occupied
    writeStartEvent(root, "KEEP-1", Date.now() - 60_000);
    assert.equal(taskWorktreeOpen(root, "KEEP-1"), true, "AC1: a present worktree is not released");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(live.inFlight.some((t) => t.taskId === "KEEP-1"),
      "AC1: an in-flight run whose worktree is present stays in-flight");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC1 fail-closed: no worktree namespace ⇒ the run stays in-flight (never a positive 'released' from an unobservable source)", () => {
  const { parent, root } = ghostWorkspace("ghost-nons");
  try {
    writeStartEvent(root, "X-1", Date.now() - 60_000);
    assert.equal(taskWorktreeOpen(root, "X-1"), null,
      "AC1: an absent namespace is 'unknown', distinct from 'released' (hard rule ③b)");
    const live = readLive(root, { nowMs: Date.now() });
    assert.ok(live.inFlight.some((t) => t.taskId === "X-1"),
      "AC1: fail-closed — an unobservable worktree state keeps the run in-flight");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
