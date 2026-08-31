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
import { readGitHistory, parseVerificationRound, readLive, taskWorktreeOpen, readJournal, parseWorkerOutcomeRecords, workerInFlightTasks, workerDriverOnlineMs, workerTaskIdFromCmdline, readLiveWorkerProcesses, WORKER_PROCESS_NAME, WORKER_OUTCOME_REL, WORKER_ROUND_REL, isValidSessionId, sessionTranscriptPath, projectSlug, transcriptContentBlocks, parseTranscript, readTranscript, readTranscriptTail, readSession, parseClaudeAgentsJson, readTaskStatusAtRef, readTaskAtRefMeta, readTaskTitleMapAtRef, readTaskCommitTimesAtRef, readTaskCommitTimeAtRef, clearTaskStatusRefCache } from "../src/observation.ts";
import { renderSessionPage } from "../src/serve-handlers.ts";
import { taskRunsBlock } from "../src/serve-task.ts";

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

test("readGitHistory degrades to 「无活跃分支」 when every branch is stale and there is no mainline", () => {
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
    // Rename away from the mainline: a stale non-mainline-only repo must still degrade (the
    // mainline refs develop/master are ALWAYS kept, so "every branch stale" only fires without one).
    execFileSync("git", ["branch", "-m", "verify/stale"], { cwd: ws });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "empty");
    assert.match(hist.reason || "", /无活跃分支/, "reason says no active branch, not 「无提交记录」");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("readGitHistory always keeps master (and develop) even when their tip is >24h stale", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-mainline-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    // master's ONLY commit is 30 days old — far outside the 7-day active window, but a mainline
    // lane must never drop out (gap-git-history-clickable-branches-window: the 24h window used to
    // exclude master entirely).
    const oldSec = Math.floor(Date.now() / 1000) - 30 * 86400;
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(oldSec * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(oldSec * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "old"], { cwd: ws, env });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    const refs = new Set(hist.commits.map((c) => c.ref));
    assert.ok(refs.has("master"), `stale master is still a lane (lanes: ${[...refs].join(", ")})`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("gap-git-history-branch-summary-wrong-numbers: a branch whose tip is newer than the mainline shows only its OWN commits, not the shared ancestry", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-gh-excl-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: ws });

    const nowSec = Math.floor(Date.now() / 1000);
    // Mainline: init + two commits, tip at nowSec-400.
    commitAt(ws, "main one", nowSec - 500);
    commitAt(ws, "main two", nowSec - 400);
    // A task branch forked from the mainline, with a tip NEWER than the mainline tip (nowSec-200).
    execFileSync("git", ["checkout", "-q", "-b", "task/gap-x"], { cwd: ws });
    commitAt(ws, "branch one", nowSec - 300, "branch.txt");
    commitAt(ws, "branch two", nowSec - 200, "branch.txt");
    execFileSync("git", ["checkout", "-q", "master"], { cwd: ws });

    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    const branchCommits = hist.commits.filter((c) => c.ref === "task/gap-x");
    assert.deepEqual(
      branchCommits.map((c) => c.subject).sort(),
      ["branch one", "branch two"],
      `the branch lane carries only its own commits (got: ${branchCommits.map((c) => c.subject).join(", ")})`,
    );
    // The shared mainline ancestry must NOT be attributed to the branch (the 481/111 symptom).
    const branchSubjects = new Set(branchCommits.map((c) => c.subject));
    assert.ok(!branchSubjects.has("init"), "the repo's first commit is the mainline's, not the branch's");
    assert.ok(!branchSubjects.has("main one") && !branchSubjects.has("main two"), "mainline commits stay on the mainline");
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

test("gap-test-detail-timeline: parseVerificationRound extracts perFile timestamps ({endedAtMs,startedAtMs}) and tolerates their absence (legacy perFile entries)", () => {
  // full-suite-runner now lands perFile entries carrying endedAtMs (reporter test:complete time) and
  // startedAtMs (back-computed end − duration). The /tests reader must surface them AND keep the
  // absent-field contract: a legacy perFile entry without timestamps omits both (never a fabricated 0).
  const withTimes = parseVerificationRound(JSON.stringify({
    round: 242, startedAt: "2026-08-23T01:00:00.000Z", durationMs: 500000,
    state: "green", pass: 2, fail: 0, cancelled: 0, tests: 2,
    runner: "outer", scope: "worktree",
    perFile: [
      { file: "packages/quay/test/slow.test.mjs", durationMs: 210.5, passed: true, endedAtMs: 1724374800000, startedAtMs: 1724374800000 - 210.5 },
      { file: "packages/quay/test/fast.test.mjs", durationMs: 12.25, passed: true },
    ],
  }));
  assert.ok(Array.isArray(withTimes.perFile), "perFile is an array");
  assert.equal(withTimes.perFile[0].endedAtMs, 1724374800000, "endedAtMs extracted");
  assert.equal(withTimes.perFile[0].startedAtMs, 1724374800000 - 210.5, "startedAtMs extracted");
  // Legacy perFile entry (no timestamps) ⇒ both fields absent, never a fabricated 0.
  assert.equal(withTimes.perFile[1].endedAtMs, undefined, "legacy entry omits endedAtMs");
  assert.equal(withTimes.perFile[1].startedAtMs, undefined, "legacy entry omits startedAtMs");
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

// ── gap-live-page-worker-driver-inflight-invisible ─────────────────────────────────────────────
// readLive previously read ONLY `.workflow-events/*.jsonl` — the worker-driver (production executor)
// writes `.quay/worker-outcome.jsonl` / `.quay/worker-round.jsonl`, so its real in-flight work was
// invisible on the Live page (and a stale workflow-events start-no-end record from before the driver
// came online showed as a ghost). AC1 = readLive merges the worker carrier's open set; AC2 = a
// workflow-events run that started BEFORE the driver came online is dropped as a ghost.

/** Build a temp workspace with a `.quay/` dir (the worker carriers live there). */
function workerWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  return ws;
}

/** Write one worker-outcome record per entry into `<root>/.quay/worker-outcome.jsonl`. */
function writeWorkerOutcome(root, records) {
  const file = path.join(root, WORKER_OUTCOME_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = records.map((r) => JSON.stringify({
    task: r.task,
    run_id: r.run_id ?? `wk-${r.task}`,
    started_at: r.started_at,
    ended_at: r.ended_at ?? new Date(Date.parse(r.started_at) + 60_000).toISOString(),
    final_state: r.final_state,
  }) + "\n");
  fs.writeFileSync(file, lines.join(""));
}

// gap-live-page-worker-inflight-bidirectional-error 方向一: the outcome carrier is written only at
// worker END, so every final_state is terminal. The old workerOutcomeOpen excluded only
// completed/spawn-failed/not-dispatched, so a destroyed worker (exited-not-landed) — and the abnormal-
// death states failed/killed/timed-out — showed as 实现中 forever. All terminal states must be NOT
// in-flight; a first-dispatched worker (no outcome record yet) is surfaced by 方向二 instead.
test("方向一: a terminal worker outcome (exited-not-landed / failed / killed / timed-out) is NOT in-flight", () => {
  const ws = workerWorkspace("worker-terminal");
  try {
    writeWorkerOutcome(ws, [
      { task: "gap-exited", started_at: "2026-08-24T07:00:00.000Z", final_state: "exited-not-landed" },
      { task: "gap-failed", started_at: "2026-08-24T07:01:00.000Z", final_state: "failed" },
      { task: "gap-killed", started_at: "2026-08-24T07:02:00.000Z", final_state: "killed" },
      { task: "gap-timedout", started_at: "2026-08-24T07:03:00.000Z", final_state: "timed-out" },
    ]);
    const live = readLive(ws, { nowMs: Date.parse("2026-08-24T08:00:00.000Z"), liveWorkers: [] });
    const ids = live.inFlight.map((t) => t.taskId);
    assert.ok(!ids.includes("gap-exited"), "方向一: exited-not-landed (destroyed worker) is NOT in-flight");
    assert.ok(!ids.includes("gap-failed"), "方向一: failed (non-zero exit) is NOT in-flight");
    assert.ok(!ids.includes("gap-killed"), "方向一: killed (signal death) is NOT in-flight");
    assert.ok(!ids.includes("gap-timedout"), "方向一: timed-out is NOT in-flight");
    assert.equal(live.status, "ok", "方向一: the worker carrier is still the telemetry (driver wired)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: completed / spawn-failed / not-dispatched worker outcomes are NOT in-flight (negative control)", () => {
  const ws = workerWorkspace("worker-closed");
  try {
    writeWorkerOutcome(ws, [
      { task: "gap-done-a", started_at: "2026-08-24T07:00:00.000Z", final_state: "completed" },
      { task: "gap-never-a", started_at: "2026-08-24T07:00:00.000Z", final_state: "spawn-failed" },
      { task: "gap-halted-a", started_at: "2026-08-24T07:00:00.000Z", final_state: "not-dispatched" },
    ]);
    const live = readLive(ws, { nowMs: Date.parse("2026-08-24T08:00:00.000Z"), liveWorkers: [] });
    const ids = live.inFlight.map((t) => t.taskId);
    assert.ok(!ids.includes("gap-done-a"), "AC1: completed (landed) is not in-flight");
    assert.ok(!ids.includes("gap-never-a"), "AC1: spawn-failed (never ran) is not in-flight");
    assert.ok(!ids.includes("gap-halted-a"), "AC1: not-dispatched (never ran) is not in-flight");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1: a live worker process whose task status is already done is NOT in-flight (done-skip holds for 方向二)", () => {
  const ws = workerWorkspace("worker-done-live");
  try {
    fs.writeFileSync(path.join(ws, "tasks", "gap-reflog.md"),
      "---\nid: gap-reflog\ntitle: fixture\nstatus: done\n---\n\n**type:** execution\n");
    const live = readLive(ws, {
      nowMs: Date.parse("2026-08-24T08:00:00.000Z"),
      liveWorkers: [{ taskId: "gap-reflog", pid: "100", startedAtMs: Date.parse("2026-08-24T07:00:00.000Z") }],
    });
    assert.ok(!live.inFlight.some((t) => t.taskId === "gap-reflog"),
      "AC1: status=done ⇒ a running worker process for it is still NOT in-flight (done has landed)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: a workflow-events start-no-end run that predates the driver is dropped (the 9h ghost)", () => {
  const { parent, root, namespace } = ghostWorkspace("worker-ghost");
  try {
    // The driver came online at 07:16Z (outcome carrier).
    writeWorkerOutcome(root, [
      { task: "gap-some-other", started_at: "2026-08-24T07:16:00.000Z", final_state: "exited-not-landed" },
    ]);
    // A stale workflow-events run started 3h BEFORE the driver, worktree STILL present (so the
    // existing worktree-released filter does NOT remove it — the new online-time filter must).
    fs.mkdirSync(namespace, { recursive: true });
    fs.mkdirSync(path.join(namespace, "GHOST-9H"), { recursive: true });
    writeStartEvent(root, "GHOST-9H", Date.parse("2026-08-24T04:14:26.000Z"));
    const live = readLive(root, { nowMs: Date.parse("2026-08-24T08:00:00.000Z"), liveWorkers: [] });
    assert.ok(!live.inFlight.some((t) => t.taskId === "GHOST-9H"),
      "AC2: a start-no-end run that predates the driver is a ghost, removed even though its worktree is present");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("AC2 negative control: a workflow-events run that started AFTER the driver came online stays in-flight", () => {
  const { parent, root, namespace } = ghostWorkspace("worker-kept");
  try {
    writeWorkerOutcome(root, [
      { task: "gap-some-other", started_at: "2026-08-24T07:16:00.000Z", final_state: "exited-not-landed" },
    ]);
    fs.mkdirSync(namespace, { recursive: true });
    fs.mkdirSync(path.join(namespace, "KEEP-POST"), { recursive: true });
    writeStartEvent(root, "KEEP-POST", Date.parse("2026-08-24T07:30:00.000Z"));
    const live = readLive(root, { nowMs: Date.parse("2026-08-24T08:00:00.000Z"), liveWorkers: [] });
    assert.ok(live.inFlight.some((t) => t.taskId === "KEEP-POST"),
      "AC2 negative control: a post-driver workflow-events run is not dropped by the online-time filter");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ── gap-live-page-worker-inflight-bidirectional-error 方向二 ─────────────────────────────────────
// The outcome carrier is written only at worker END, so a first-dispatched worker (no outcome record
// yet) has no carrier record — workerInFlightTasks cannot see it. The /live in-flight set now ALSO
// reads the live-process signal (a /proc cmdline carrying `quay-task-worker` + `Task: <id>`), so a
// first-dispatched worker shows in-flight. The `liveWorkers` option is the test seam.

test("方向二: a first-dispatched worker (no outcome record) is in-flight via the process signal", () => {
  const ws = workerWorkspace("worker-first");
  try {
    const startedAtMs = Date.parse("2026-08-24T07:30:00.000Z");
    const live = readLive(ws, {
      nowMs: Date.parse("2026-08-24T08:00:00.000Z"),
      liveWorkers: [{ taskId: "gap-first", pid: "100", startedAtMs }],
    });
    const t = live.inFlight.find((x) => x.taskId === "gap-first");
    assert.ok(t, "方向二: a worker with no outcome record surfaces in-flight via the process signal");
    assert.equal(t.liveness, "alive", "方向二: the process-signal worker is observably alive");
    assert.equal(t.implCompletedAtMs, null, "方向二: a running worker is still 实现中 (not awaiting-land)");
    assert.equal(t.pid, "100", "方向二: the process-signal worker carries its /proc pid through readLive (gap-webui-live-passthrough-pid)");
    assert.ok(Math.abs(t.minutes - 30) < 0.001, "方向二: elapsed minutes from the process start (~30m, got " + t.minutes + ")");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("workerTaskIdFromCmdline: extracts the task id from a worker cmdline, null otherwise (pure)", () => {
  const cmd = `node /x/quay-launch.sh ${WORKER_PROCESS_NAME} -p Task: gap-live-page-worker-inflight-bidirectional-error. Repo root: /home/yale/work/quay. …`;
  assert.equal(workerTaskIdFromCmdline(cmd), "gap-live-page-worker-inflight-bidirectional-error",
    "extracts the Task: id from a worker cmdline");
  assert.equal(workerTaskIdFromCmdline("node some-other-process --flag"), null,
    "a non-worker cmdline (no quay-task-worker) is null");
  assert.equal(workerTaskIdFromCmdline(`node ${WORKER_PROCESS_NAME} -p No task marker here`), null,
    "a worker cmdline with no Task: marker is null");
  assert.equal(workerTaskIdFromCmdline(`node ${WORKER_PROCESS_NAME} -p Task: gap-t. Repo root: /tmp/ws.`), "gap-t",
    "a short id stops at the full stop (word-boundary — no over-match onto a longer id)");
});

test("readLiveWorkerProcesses: scans a fake /proc for worker cmdlines + start times (方向二)", () => {
  const procDir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-proc-"));
  try {
    const btimeSec = 1724486400;
    fs.writeFileSync(path.join(procDir, "stat"), `cpu  0 0 0\nbtime ${btimeSec}\n`);
    // /proc/<pid>/stat: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt
    // cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime …
    // starttime is field 22 (the 20th token after "(comm) ", index 19 in the after-comm slice).
    const statPid = (pid, starttime) =>
      `${pid} (node) S 1 ${pid} ${pid} 0 -1 4194560 10 0 0 0 0 0 0 0 20 0 1 0 ${starttime} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
    fs.mkdirSync(path.join(procDir, "100"));
    fs.writeFileSync(path.join(procDir, "100", "cmdline"),
      `node /x/quay-launch.sh ${WORKER_PROCESS_NAME} -p Task: gap-first. Repo root: /tmp/ws. … `);
    fs.writeFileSync(path.join(procDir, "100", "stat"), statPid(100, 10000));
    fs.mkdirSync(path.join(procDir, "101"));
    fs.writeFileSync(path.join(procDir, "101", "cmdline"), "node not-a-worker \n");
    fs.writeFileSync(path.join(procDir, "101", "stat"), statPid(101, 20000));

    const workers = readLiveWorkerProcesses(procDir);
    assert.equal(workers.length, 1, "only the quay-task-worker process is a live worker");
    assert.equal(workers[0].taskId, "gap-first", "task id extracted from the worker cmdline");
    assert.equal(workers[0].pid, "100", "pid = the /proc/<pid> directory name the worker was scanned from");
    assert.equal(workers[0].startedAtMs, (btimeSec + 100) * 1000,
      "startedAtMs = btime + starttime/100 ticks (got " + workers[0].startedAtMs + ")");
  } finally {
    fs.rmSync(procDir, { recursive: true, force: true });
  }
});

test("readLiveWorkerProcesses: unreadable /proc ⇒ [] (fail-closed, never throws)", () => {
  assert.deepEqual(readLiveWorkerProcesses("/nonexistent-proc-dir"), [], "no /proc ⇒ no live workers");
});

// gap-webui-live-passthrough-pid AC1: pid must be present on EVERY live entry (⛔ pid 缺失 ⇒ 假).
// The field is a pass-through from readLiveWorkerProcesses to the /live response — a workflow-events
// entry (pairInFlight) has no process (null), a worker-process entry (方向二) carries its /proc pid.
test("AC1: every readLive in-flight entry carries a pid field (null for workflow-events, non-null for worker process)", () => {
  const { parent, root } = ghostWorkspace("pid-passthrough");
  try {
    writeStartEvent(root, "EV-1", Date.parse("2026-08-24T07:00:00.000Z"));
    const live = readLive(root, {
      nowMs: Date.parse("2026-08-24T08:00:00.000Z"),
      liveWorkers: [{ taskId: "WK-1", pid: "100", startedAtMs: Date.parse("2026-08-24T07:30:00.000Z") }],
    });
    assert.ok(live.inFlight.length >= 2,
      "both entries surface in-flight (got " + live.inFlight.map((t) => t.taskId).join(",") + ")");
    for (const t of live.inFlight) {
      assert.ok(Object.prototype.hasOwnProperty.call(t, "pid"),
        `AC1: every live entry carries a pid field — ${t.taskId} is missing it`);
    }
    const ev = live.inFlight.find((t) => t.taskId === "EV-1");
    const wk = live.inFlight.find((t) => t.taskId === "WK-1");
    assert.equal(ev.pid, null, "AC1: a workflow-events entry has pid=null (no process known)");
    assert.equal(wk.pid, "100", "AC1: a worker-process entry carries its /proc pid through readLive");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("parseWorkerOutcomeRecords: parses the carrier, skips malformed lines, never throws", () => {
  const recs = parseWorkerOutcomeRecords(
    '{"task":"a","run_id":"r1","started_at":"2026-08-24T07:00:00.000Z","final_state":"completed"}\n' +
    'not-json\n' +
    '{"task":"b","run_id":"r2","started_at":"2026-08-24T07:01:00.000Z","final_state":"failed"}\n'
  );
  assert.equal(recs.length, 2, "skips the malformed (non-JSON) line");
  assert.equal(recs[0].task, "a");
  assert.equal(recs[1].final_state, "failed");
  assert.equal(recs[1].started_at, "2026-08-24T07:01:00.000Z");
});

test("workerDriverOnlineMs: min across outcome started_at and round ts; null when the driver never ran", () => {
  const ws = workerWorkspace("worker-online");
  try {
    writeWorkerOutcome(ws, [
      { task: "a", started_at: "2026-08-24T07:16:00.000Z", final_state: "completed" },
    ]);
    fs.writeFileSync(path.join(ws, WORKER_ROUND_REL),
      '{"ts":"2026-08-24T07:15:00.000Z","round":1,"action":"start"}\n' +
      '{"ts":"2026-08-24T07:17:00.000Z","round":2,"action":"idle"}\n');
    assert.equal(workerDriverOnlineMs(ws), Date.parse("2026-08-24T07:15:00.000Z"),
      "online instant = earliest round ts (07:15 < outcome 07:16)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  const empty = workerWorkspace("worker-online-empty");
  try {
    assert.equal(workerDriverOnlineMs(empty), null, "no carrier ⇒ null (driver never ran)");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

// ── gap-webui-journal-stale-and-ticklog-bug ─────────────────────────────────────────────────────
// readJournal had two defects: (1) escalations.md — superseded by tick-log but still rendered first
// as a fresh 「最近记录」 9 days after its last write; (2) tick-log.md — read by the SAME `## `-
// boundary function as escalations, which found zero `## ` boundaries (the real file is
// `` - `HH:MMZ` `action` `` bullets) and fell through to a raw-tail fallback that mixed days-old
// stale entries with today's, with no date. AC1 = stale annotation; AC2 = dedicated bullet-prefix
// reader (no raw-tail fallback); AC3 = date-stamped entries.

const JOURNAL_NOW = Date.UTC(2026, 7, 23, 12, 0, 0); // 2026-08-23T12:00:00Z

/** Build a temp workspace with an orchestration/ dir; return its root. */
function journalWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
  return ws;
}

/** Set a file's atime+mtime to a fixed instant (controls both the stale banner and date anchor). */
function setMtime(abs, ms) {
  const d = new Date(ms);
  fs.utimesSync(abs, d, d);
}

test("AC1: readJournal marks a superseded escalations.md stale, and does NOT mark a fresh one (negative control)", () => {
  const ws = journalWorkspace("journal-stale");
  try {
    const esc = path.join(ws, "orchestration", "escalations.md");
    fs.writeFileSync(esc, "# 升级项\n\n## 3. 测试升级项\n\n这是一条测试升级项。\n");
    setMtime(esc, JOURNAL_NOW - 9 * 86_400_000); // 9 days stale

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.escalations.status, "ok", "AC1: a stale-but-readable escalations.md is still ok");
    assert.match(journal.escalations.markdown || "", /陈旧记录/, "AC1: the stale banner appears");
    assert.match(journal.escalations.markdown || "", /约 9 天前/, "AC1: the banner names the age in days");
    assert.match(journal.escalations.markdown || "", /2026-08-14/, "AC1: the banner names the last-write date");

    // Negative control — a fresh escalations.md carries no banner.
    setMtime(esc, JOURNAL_NOW - 3600_000); // 1 hour ago
    const fresh = readJournal(ws, JOURNAL_NOW);
    assert.equal(fresh.escalations.status, "ok");
    assert.doesNotMatch(fresh.escalations.markdown || "", /陈旧记录/,
      "AC1 negative control: a fresh escalations.md is not marked stale (the banner is real, not vacuous)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: readTickLog segments by `- `HH:MMZ`` bullets and drops a days-old entry the raw-tail fallback would have kept", () => {
  const ws = journalWorkspace("journal-bullets");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    // 20 entries; entry 1 is the sentinel the old `lines.slice(-60)` fallback would have shown.
    const entries = ["- `00:00Z` `no-action` — STALE-SENTINEL-ENTRY"];
    for (let i = 1; i < 20; i++) {
      const hh = String(Math.floor(i / 4)).padStart(2, "0");
      const mm = String((i * 7) % 60).padStart(2, "0");
      entries.push(`- \`${hh}:${mm}Z\` \`no-action\` — recent entry ${i}`);
    }
    fs.writeFileSync(tlog, entries.join("\n") + "\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "ok", "AC2: a bulleted tick-log is ok");
    assert.doesNotMatch(journal.tickLog.markdown || "", /STALE-SENTINEL-ENTRY/,
      "AC2: the days-old entry is NOT mixed into the recent view (entry-count cap, not a raw line tail)");
    assert.match(journal.tickLog.markdown || "", /recent entry 19/,
      "AC2: the true most-recent entry is present");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2 negative control: a tick-log with NEITHER bullets nor `## ` sections reports 「无数据」, never a raw tail", () => {
  const ws = journalWorkspace("journal-nofmt");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    fs.writeFileSync(tlog, "# tick\n\njust some prose\nno tick entries here\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "empty",
      "AC2: an unrecognized tick-log is 「无数据」 (the dedicated reader has no raw-tail fallback)");
    assert.equal(journal.tickLog.markdown, null, "AC2: no markdown is fabricated from the tail");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: readTickLog stamps each entry with its inferred date across a midnight rollover", () => {
  const ws = journalWorkspace("journal-dates");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    // Newest last: 23:59Z is the previous day; 00:01Z / 00:15Z are the mtime date.
    fs.writeFileSync(
      tlog,
      "- `23:59Z` `no-action` — 前一天\n" +
      "- `00:01Z` `unblock` — 今天凌晨\n" +
      "- `00:15Z` `no-action` — 今天最新\n"
    );
    setMtime(tlog, Date.UTC(2026, 7, 23, 4, 0, 0)); // 2026-08-23T04:00:00Z

    const journal = readJournal(ws, JOURNAL_NOW);
    const md = journal.tickLog.markdown || "";
    assert.match(md, /`2026-08-23 00:15Z`/, "AC3: newest entry carries its mtime date");
    assert.match(md, /`2026-08-23 00:01Z`/, "AC3: same-day entry carries the same date");
    assert.match(md, /`2026-08-22 23:59Z`/, "AC3: the pre-midnight entry rolls back one day");
    assert.doesNotMatch(md, /- `\d{2}:\d{2}Z` /, "AC3: no entry is left with a bare HH:MMZ (all stamped)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("back-compat: a legacy `## `-sectioned tick-log still reads ok (serve.test.mjs pins this shape)", () => {
  const ws = journalWorkspace("journal-legacy");
  try {
    const tlog = path.join(ws, "orchestration", "tick-log.md");
    fs.writeFileSync(tlog, "# 外层 tick 记录\n\n## 2026-08-03 05:45Z\n\n`correct` — 测试条目。\n");
    setMtime(tlog, JOURNAL_NOW);

    const journal = readJournal(ws, JOURNAL_NOW);
    assert.equal(journal.tickLog.status, "ok", "a `## `-sectioned tick-log is still ok");
    assert.match(journal.tickLog.markdown || "", /2026-08-03 05:45Z/,
      "the `## ` timestamp heading still renders (dual-format back-compat)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-webui-session-detail-view: single-session view (sessionId addressing + dual-schema parse + path-traversal guard) ──

const SESSION_VIEW_UUID = "01234567-89ab-cdef-89ab-cdef01234567";

test("AC3: isValidSessionId accepts a strict UUID and rejects path/pid/task-id shapes", () => {
  assert.equal(isValidSessionId(SESSION_VIEW_UUID), true);
  assert.equal(isValidSessionId("01234567-89AB-CDEF-89AB-CDEF01234567"), true, "case-insensitive");
  assert.equal(isValidSessionId("../etc/passwd"), false, "relative traversal");
  assert.equal(isValidSessionId("/etc/passwd"), false, "absolute path");
  assert.equal(isValidSessionId("..%2f..%2fetc"), false, "encoded traversal");
  assert.equal(isValidSessionId("3266379"), false, "pid");
  assert.equal(isValidSessionId("gap-webui-session-detail-view"), false, "task id");
  assert.equal(isValidSessionId("/home/yale/.claude/x.jsonl"), false, "transcript path");
  assert.equal(isValidSessionId(""), false);
});

test("AC3: sessionTranscriptPath is pure — traversal/path/pid/task-id inputs return null, never a path", () => {
  const home = "/tmp/home-x";
  assert.equal(sessionTranscriptPath("/home/yale/work/quay", "../etc/passwd", home), null);
  assert.equal(sessionTranscriptPath("/home/yale/work/quay", "/etc/passwd", home), null);
  assert.equal(sessionTranscriptPath("/home/yale/work/quay", "3266379", home), null);
  assert.equal(sessionTranscriptPath("/home/yale/work/quay", "gap-webui-session-detail-view", home), null);
  assert.equal(sessionTranscriptPath("/home/yale/work/quay", "", home), null);
});

test("AC1: sessionTranscriptPath derives the transcript from the sessionId (the addressing key), not pid/task/path", () => {
  const home = "/tmp/home-x";
  const p = sessionTranscriptPath("/home/yale/work/quay", SESSION_VIEW_UUID, home);
  assert.equal(p, "/tmp/home-x/.claude/projects/-home-yale-work-quay/01234567-89ab-cdef-89ab-cdef01234567.jsonl");
});

test("AC1: projectSlug matches session-liveness.sh's tr '/' '-' transform", () => {
  assert.equal(projectSlug("/home/yale/work/quay"), "-home-yale-work-quay");
  assert.equal(projectSlug("/tmp/ws"), "-tmp-ws");
});

test("AC2: transcriptContentBlocks normalizes both string content and block-array content", () => {
  assert.deepEqual(transcriptContentBlocks("hello"), [{ kind: "text", text: "hello" }]);
  const blocks = transcriptContentBlocks([
    { type: "thinking", thinking: "plan" },
    { type: "text", text: "running" },
    { type: "tool_use", id: "call_1", name: "Bash", input: { command: "echo hi" } },
  ]);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { kind: "thinking", text: "plan" });
  assert.deepEqual(blocks[1], { kind: "text", text: "running" });
  assert.equal(blocks[2].kind, "tool_use");
  assert.equal(blocks[2].name, "Bash");
  assert.equal(blocks[2].input, '{\n  "command": "echo hi"\n}');
});

test("AC2: parseTranscript renders both -p and interactive transcripts (one shared schema family)", () => {
  // A `-p`/headless record set (SPEC §7.4: user/assistant + thinking/text/tool_use/tool_result blocks).
  const pRecords = [
    { type: "user", timestamp: "2026-08-24T00:00:00Z", message: { role: "user", content: "do the thing" } },
    { type: "assistant", timestamp: "2026-08-24T00:00:01Z", message: { role: "assistant", content: [
      { type: "thinking", thinking: "let me think" },
      { type: "text", text: "running a command" },
      { type: "tool_use", id: "call_1", name: "Bash", input: { command: "echo hi" } },
    ] } },
    { type: "user", timestamp: "2026-08-24T00:00:02Z", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "call_1", content: "hi\n", is_error: false },
    ] } },
  ].map((o) => JSON.stringify(o)).join("\n");
  const p = parseTranscript(pRecords);
  assert.equal(p.length, 3);
  assert.equal(p[0].role, "user");
  assert.equal(p[0].blocks[0].kind, "text");
  assert.equal(p[1].blocks.length, 3);
  assert.equal(p[1].blocks[0].kind, "thinking");
  assert.equal(p[1].blocks[2].kind, "tool_use");
  assert.equal(p[1].blocks[2].name, "Bash");
  assert.equal(p[2].blocks[0].kind, "tool_result");
  assert.equal(p[2].blocks[0].toolUseId, "call_1");
  assert.equal(p[2].blocks[0].isError, false);

  // An interactive transcript is a superset (SPEC §7.4): extra system/mode record types that carry no
  // `message` are skipped, the user/assistant records parse on the same path.
  const interactiveRecords = [
    { type: "system", timestamp: "2026-08-24T00:00:00Z", subtype: "init" },
    { type: "user", timestamp: "2026-08-24T00:00:01Z", message: { role: "user", content: "hi" } },
    { type: "assistant", timestamp: "2026-08-24T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
  ].map((o) => JSON.stringify(o)).join("\n");
  const i = parseTranscript(interactiveRecords);
  assert.equal(i.length, 2, "system records (no message) are skipped");
  assert.equal(i[0].role, "user");
  assert.equal(i[1].blocks[0].kind, "text");
  assert.equal(i[1].blocks[0].text, "hello");
});

test("AC2: readTranscript reads the tail and parses structured blocks (not the 3-message preview)", () => {
  const p = path.join(os.tmpdir(), `obs-tx-${process.pid}.jsonl`);
  try {
    fs.writeFileSync(p, [
      JSON.stringify({ type: "user", timestamp: "2026-08-24T00:00:00Z", message: { role: "user", content: "go" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-24T00:00:01Z", message: { role: "assistant", content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "call_9", name: "Read", input: { file_path: "/x" } },
      ] } }),
    ].join("\n"));
    const r = readTranscript(p);
    assert.equal(r.status, "ok");
    assert.equal(r.turns.length, 2);
    assert.equal(r.turns[1].blocks[1].kind, "tool_use");
    assert.equal(r.turns[1].blocks[1].input, '{\n  "file_path": "/x"\n}');
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test("AC1/AC3: readSession resolves by sessionId (home-injected) and refuses non-UUID inputs", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "obs-sess-home-"));
  const root = "/home/yale/work/quay";
  const tp = path.join(home, ".claude", "projects", projectSlug(root), `${SESSION_VIEW_UUID}.jsonl`);
  fs.mkdirSync(path.dirname(tp), { recursive: true });
  fs.writeFileSync(tp, [
    JSON.stringify({ type: "user", timestamp: "2026-08-24T00:00:00Z", message: { role: "user", content: "hello" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-08-24T00:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
  ].join("\n"));
  try {
    const ok = readSession(root, SESSION_VIEW_UUID, home);
    assert.equal(ok.status, "ok");
    assert.equal(ok.turns.length, 2);
    assert.equal(ok.sessionId, SESSION_VIEW_UUID);

    const bad = readSession(root, "../etc/passwd", home);
    assert.equal(bad.status, "empty");
    assert.equal(bad.transcriptPath, null);
    assert.match(bad.reason || "", /非法/, "traversal input is rejected before any disk read");

    const missing = readSession(root, "00000000-0000-0000-0000-000000000000", home);
    assert.equal(missing.status, "empty");
    assert.match(missing.reason || "", /缺失/, "valid UUID with no transcript is an honest empty state");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("AC2: renderSessionPage renders structured blocks — tool_use/tool_result paired + thinking marked, never a flat dump", () => {
  const turns = parseTranscript([
    { type: "user", timestamp: "2026-08-24T00:00:00Z", message: { role: "user", content: "run it" } },
    { type: "assistant", timestamp: "2026-08-24T00:00:01Z", message: { role: "assistant", content: [
      { type: "thinking", thinking: "THINKING-MARKER" },
      { type: "tool_use", id: "call_1", name: "Bash", input: { command: "INPUT-MARKER" } },
    ] } },
    { type: "user", timestamp: "2026-08-24T00:00:02Z", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "call_1", content: "RESULT-MARKER", is_error: false },
    ] } },
  ].map((o) => JSON.stringify(o)).join("\n"));

  const html = renderSessionPage({
    status: "ok",
    reason: null,
    sessionId: SESSION_VIEW_UUID,
    transcriptPath: "/tmp/x.jsonl",
    turns,
  });

  // Structured, collapsible blocks — not a flat text dump.
  assert.ok(html.includes("<details"), "renders <details> collapse units");
  assert.ok(html.includes("tx-tool-pair"), "tool_use renders as a marked pair block");
  assert.ok(html.includes("tx-thinking"), "thinking renders as a distinguishable block");

  // tool_use and its tool_result are PAIRED: the result lives INSIDE the pair's <details>, exactly once.
  assert.equal(html.split("RESULT-MARKER").length, 2, "result appears exactly once (absorbed into the pair, not duplicated)");
  const pairStart = html.indexOf("tx-tool-pair");
  const pairEnd = html.indexOf("</details>", pairStart);
  const pairBody = html.slice(pairStart, pairEnd);
  assert.ok(pairBody.includes("INPUT-MARKER"), "pair body carries the tool_use input");
  assert.ok(pairBody.includes("RESULT-MARKER"), "pair body carries the tool_result (paired, not a separate block)");
  assert.ok(pairBody.includes("tool_use · Bash"), "pair summary labels the tool");

  // thinking is distinguishable by its own marked block (not flattened into text).
  const thinkStart = html.indexOf("tx-thinking");
  const thinkEnd = html.indexOf("</details>", thinkStart);
  assert.ok(html.slice(thinkStart, thinkEnd).includes("THINKING-MARKER"), "thinking block carries the thinking text");
});

// ── gap-webui-session-discovery-claude-agents-json ────────────────────────────────────────────────
// `claude agents --json` replaces the three-role tmux guessing as the /sessions discovery source. The
// registry covers interactive AND `-p`/headless sessions equally (SPEC §2.2 更正段); the parser must
// not fabricate a `status` for a worker that omits it (absence ≠ idle, hard rule ③b).

test("parseClaudeAgentsJson parses a real registry shape: interactive rows carry status, -p worker rows carry status=null", () => {
  const text = JSON.stringify([
    { pid: 4190941, cwd: "/home/yale/work/quay", kind: "interactive", startedAt: 1787554133207, sessionId: "b02622c8-4cb7-4c2b-91c3-2a6c67fcc7a1", name: "quay-91", status: "idle" },
    { pid: 1830917, cwd: "/home/yale/work/quay", kind: "interactive", startedAt: 1787603007803, sessionId: "5a06c41c-4909-4bb4-a7f9-52891dcffb3a", name: "quay-task-worker" },
  ]);
  const rows = parseClaudeAgentsJson(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pid, 4190941);
  assert.equal(rows[0].name, "quay-91");
  assert.equal(rows[0].sessionId, "b02622c8-4cb7-4c2b-91c3-2a6c67fcc7a1");
  assert.equal(rows[0].status, "idle");
  // A `-p`/headless worker omits `status` — must parse as null, NOT a fabricated "idle" (AC1: -p
  // sessions are registered just like interactive ones; absence is a missing field, not a value).
  assert.equal(rows[1].name, "quay-task-worker");
  assert.equal(rows[1].status, null);
});

test("parseClaudeAgentsJson degrades to [] on malformed / non-array input (never throws)", () => {
  assert.deepEqual(parseClaudeAgentsJson("not json"), []);
  assert.deepEqual(parseClaudeAgentsJson(""), []);
  assert.deepEqual(parseClaudeAgentsJson("{}"), []);
  assert.deepEqual(parseClaudeAgentsJson("[1, \"x\", null]"), []);
  // A missing optional field (pid) parses as null, never a fabricated 0.
  assert.deepEqual(parseClaudeAgentsJson(JSON.stringify([{ sessionId: "b02622c8-4cb7-4c2b-91c3-2a6c67fcc7a1", name: "quay-91" }]))[0].pid, null);
});

// ── gap-webui-task-runs-block ───────────────────────────────────────────────────────────────────────
// The old parseWorkerOutcomeRecords read only 4 of the 14 fields computeOutcome writes — `worker_pid`
// was on disk but dropped. AC2: the parse takes EVERY on-disk field (14) + the forward-compatible
// session_id; a missing field degrades to null (hard rule ③b), never a fabricated 0/""/false.

test("parseWorkerOutcomeRecords reads all 14 on-disk fields incl. worker_pid (AC2)", () => {
  const line = JSON.stringify({
    ts: "2026-08-25T01:00:00.000Z",
    task: "gap-webui-task-runs-block",
    selector_reason: "ready",
    exit_code: 0,
    signal: null,
    wall_clock_ms: 123456,
    final_state: "completed",
    failure_reason: null,
    started_at: "2026-08-25T00:58:00.000Z",
    ended_at: "2026-08-25T01:00:00.000Z",
    worker_pid: 4242,
    run_id: "run-abc",
    in_flight_count: 1,
    timed_out: false,
  });
  const [r] = parseWorkerOutcomeRecords(line);
  assert.equal(r.task, "gap-webui-task-runs-block");
  assert.equal(r.ts, "2026-08-25T01:00:00.000Z");
  assert.equal(r.selector_reason, "ready");
  assert.equal(r.exit_code, 0);
  assert.equal(r.signal, null);
  assert.equal(r.wall_clock_ms, 123456);
  assert.equal(r.final_state, "completed");
  assert.equal(r.failure_reason, null);
  assert.equal(r.started_at, "2026-08-25T00:58:00.000Z");
  assert.equal(r.ended_at, "2026-08-25T01:00:00.000Z");
  // The field the old 4-field parse dropped: worker_pid must survive (AC2 negative control).
  assert.equal(r.worker_pid, 4242);
  assert.equal(r.run_id, "run-abc");
  assert.equal(r.in_flight_count, 1);
  assert.equal(r.timed_out, false);
  // Forward-compatible: not on disk yet, parses to null until gap-worker-task-transcript-access-webui.
  assert.equal(r.session_id, null);
});

test("parseWorkerOutcomeRecords reads a killed record (signal set, exit_code null) and degrades missing fields to null", () => {
  const killed = JSON.stringify({
    task: "gap-webui-task-runs-block",
    exit_code: null,
    signal: "SIGTERM",
    wall_clock_ms: 5000,
    final_state: "killed",
    failure_reason: "worker killed by SIGTERM",
    started_at: "2026-08-25T00:57:00.000Z",
    ended_at: "2026-08-25T00:57:05.000Z",
    worker_pid: 4343,
    run_id: "run-def",
    in_flight_count: 1,
    timed_out: false,
  });
  // A minimal record with only `task` — every other field must degrade to null, never a fabricated 0.
  const sparse = JSON.stringify({ task: "gap-webui-task-runs-block" });
  const recs = parseWorkerOutcomeRecords(`${killed}\n${sparse}\nnot json\n`);
  assert.equal(recs.length, 2); // the malformed "not json" line is skipped
  const [k, s] = recs;
  assert.equal(k.signal, "SIGTERM");
  assert.equal(k.exit_code, null); // killed ⇒ no exit code, must stay null (not 0)
  assert.equal(k.worker_pid, 4343);
  assert.equal(k.final_state, "killed");
  assert.equal(k.failure_reason, "worker killed by SIGTERM");
  assert.equal(k.session_id, null);
  // Sparse record: worker_pid / exit_code / run_id must be null, never fabricated (hard rule ③b).
  assert.equal(s.task, "gap-webui-task-runs-block");
  assert.equal(s.worker_pid, null);
  assert.equal(s.exit_code, null);
  assert.equal(s.run_id, null);
  assert.equal(s.final_state, null);
  assert.equal(s.timed_out, null);
});

// ── gap-webui-task-runs-block AC1/AC3 — taskRunsBlock ──────────────────────────────────────────────
// The Runs block renders one row per worker-outcome attempt for THIS task only, and links the
// transcript via the existing /session endpoint (reusing isValidSessionId, never a second
// read/validation implementation).

test("taskRunsBlock renders one row per attempt for THIS task only + an honest empty state", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-runs-"));
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    const line = (task, worker_pid, run_id) => JSON.stringify({
      task, worker_pid, run_id,
      started_at: "2026-08-25T00:58:00.000Z",
      ended_at: "2026-08-25T01:00:00.000Z",
      final_state: "completed",
      exit_code: 0,
      wall_clock_ms: 120000,
      signal: null,
      failure_reason: null,
      ts: "2026-08-25T01:00:00.000Z",
      selector_reason: "ready",
      in_flight_count: 1,
      timed_out: false,
    });
    fs.writeFileSync(path.join(ws, ".quay", "worker-outcome.jsonl"), [
      line("gap-webui-task-runs-block", 4242, "run-a"),
      line("gap-webui-task-runs-block", 4343, "run-b"),
      line("some-other-task", 9999, "run-c"),
    ].join("\n"));

    const html = taskRunsBlock(ws, "gap-webui-task-runs-block");
    assert.ok(html.includes("<h2>Runs</h2>"), "AC1: the Runs block header renders");
    assert.ok(html.includes("4242") && html.includes("4343"), "AC1/AC2: worker_pid renders per row");
    assert.ok(html.includes("run-a") && html.includes("run-b"), "AC1: each attempt's run_id renders");
    assert.ok(!html.includes("run-c") && !html.includes("9999"), "AC1: another task's attempts are NOT rendered");

    const empty = taskRunsBlock(ws, "no-such-task");
    assert.ok(empty.includes("<h2>Runs</h2>"), "empty state still renders the Runs block (never a bare page)");
    assert.ok(empty.includes("无 worker 运行记录"), "empty state is an honest 无记录, not a fabricated row");

    const absent = taskRunsBlock(path.join(ws, "does-not-exist"), "gap-webui-task-runs-block");
    assert.ok(absent.includes("无 worker 运行记录"), "absent outcome carrier degrades to the empty state, never throws");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("taskRunsBlock links the transcript only for a VALID session_id (AC3 reuse of isValidSessionId)", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "obs-runs-sess-"));
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    const uuid = "b02622c8-4cb7-4c2b-91c3-2a6c67fcc7a1";
    const line = (session_id) => JSON.stringify({
      task: "gap-webui-task-runs-block",
      worker_pid: 4242,
      run_id: "run-a",
      started_at: "2026-08-25T00:58:00.000Z",
      final_state: "completed",
      exit_code: 0,
      wall_clock_ms: 120000,
      signal: null,
      failure_reason: null,
      ts: "2026-08-25T01:00:00.000Z",
      selector_reason: "ready",
      ended_at: "2026-08-25T01:00:00.000Z",
      in_flight_count: 1,
      timed_out: false,
      ...(session_id != null ? { session_id } : {}),
    });
    fs.writeFileSync(path.join(ws, ".quay", "worker-outcome.jsonl"), [
      line(uuid),                  // valid UUID → link
      line("not-a-uuid"),          // non-UUID → no link (validation reused, not a second impl)
      line(null),                  // absent → no link
    ].join("\n"));

    const html = taskRunsBlock(ws, "gap-webui-task-runs-block");
    assert.ok(html.includes(`href="/session/${uuid}"`), "AC3: a valid session_id links the existing /session endpoint");
    assert.ok(!html.includes('href="/session/not-a-uuid"'), "AC3: a non-UUID session_id is NOT linked (isValidSessionId gate)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-web-session-drops-queue-operation-records ───────────────────────────────────────────────
// The /session/<id> rendering pipeline silently dropped the two native record types that carry no
// `.message` field: `queue-operation` (a message queued because the receiver was busy, then absorbed
// mid-turn — never materializing as its own `type:"user"` record) and `attachment` `queued_command`.
// The fix renders them as a distinguishable `external` marker (AC1), leaves idle-arrival `type:"user"`
// messages alone (AC2 negative control), and never fabricates a `.message.content` record (AC3).

const absorbedLine = JSON.stringify({ type: "queue-operation", operation: "remove", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x", content: "<cross-session-message from=\"uds:/x\" from-name=\"quay-inner\" from-mode=\"bypass\">hello absorbed</cross-session-message>", reason: "absorbed_mid_turn" });
const enqueueLine = JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x", content: "hello queued" });
const dequeueLine = JSON.stringify({ type: "queue-operation", operation: "dequeue", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x" });
const attachmentLine = JSON.stringify({ type: "attachment", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x", attachment: { type: "queued_command", prompt: "<cross-session-message from=\"uds:/x\" from-name=\"quay-a8\" from-mode=\"bypass\">hello attachment</cross-session-message>" }, origin: {} });
const skillListingLine = JSON.stringify({ type: "attachment", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x", attachment: { type: "skill_listing", content: "- some-skill" } });
const userLine = JSON.stringify({ type: "user", timestamp: "2026-08-26T18:36:37.230Z", sessionId: "x", message: { role: "user", content: "hello direct" } });

function sessionViewFor(turns) {
  return { status: "ok", reason: null, sessionId: "11111111-1111-4111-8111-111111111111", transcriptPath: "/x.jsonl", turns, truncated: false };
}

test("AC1: an absorbed_mid_turn queue-operation is visible on /session/<id> as an external marker", () => {
  const turns = parseTranscript(absorbedLine);
  assert.equal(turns.length, 1, "the absorbed event produces exactly one turn");
  assert.equal(turns[0].role, "external");
  assert.equal(turns[0].blocks.length, 1);
  assert.equal(turns[0].blocks[0].kind, "external");
  assert.equal(turns[0].blocks[0].label, "外部消息被吸收进当前回合（未开新回合）");
  assert.ok(turns[0].blocks[0].text.includes("hello absorbed"), "the absorbed content is carried through");

  const html = renderSessionPage(sessionViewFor(turns));
  assert.ok(html.includes("外部消息被吸收进当前回合（未开新回合）"), "AC1: the distinguishable marker is rendered");
  assert.ok(html.includes("hello absorbed"), "AC1: the absorbed message body is visible on the page");
});

test("AC1: an enqueue queue-operation and a queued_command attachment render as external markers", () => {
  const turns = parseTranscript([enqueueLine, attachmentLine].join("\n"));
  assert.equal(turns.length, 2);
  assert.equal(turns[0].blocks[0].kind, "external");
  assert.ok(turns[0].blocks[0].label.includes("入队"), "enqueue carries the queued label");
  assert.ok(turns[0].blocks[0].text.includes("hello queued"));
  assert.equal(turns[1].blocks[0].kind, "external");
  assert.equal(turns[1].blocks[0].label, "外部消息附件（queued_command，未开新回合）");
  assert.ok(turns[1].blocks[0].text.includes("hello attachment"));

  const html = renderSessionPage(sessionViewFor(turns));
  assert.ok(html.includes("hello queued"), "enqueue content visible");
  assert.ok(html.includes("hello attachment"), "attachment content visible");
});

test("AC2 negative control: an idle-arrival type:\"user\" message still renders as a normal bubble", () => {
  const turns = parseTranscript(userLine);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[0].blocks[0].kind, "text");
  assert.equal(turns[0].blocks[0].text, "hello direct");

  const html = renderSessionPage(sessionViewFor(turns));
  assert.ok(html.includes("hello direct"), "AC2: the direct message still renders");
  assert.ok(!html.includes("tx-external"), "AC2: no external marker for a normal user message");
});

test("AC3: queue-operation/attachment never fabricate a user turn (no .message forgery)", () => {
  const turns = parseTranscript([absorbedLine, attachmentLine, userLine].join("\n"));
  assert.equal(turns.length, 3);
  assert.equal(turns[0].role, "external");
  assert.equal(turns[0].blocks[0].kind, "external");
  assert.equal(turns[1].role, "external");
  assert.equal(turns[1].blocks[0].kind, "external");
  assert.equal(turns[2].role, "user");
  assert.equal(turns[2].blocks[0].kind, "text");
  const userTurns = turns.filter((t) => t.role === "user");
  assert.equal(userTurns.length, 1, "AC3: exactly one user turn (the real type:\"user\"), none forged from queue/attachment records");
});

test("dequeue (no content) and non-queued_command attachments are not rendered", () => {
  assert.equal(parseTranscript(dequeueLine).length, 0, "dequeue carries no content — nothing to render");
  assert.equal(parseTranscript(skillListingLine).length, 0, "skill_listing is an internal notice, not a cross-session message");
});

test("readTranscriptTail surfaces queue-operation as an external preview entry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-ext-"));
  const p = path.join(dir, "s.jsonl");
  try {
    fs.writeFileSync(p, `${absorbedLine}\n`);
    const r = readTranscriptTail(p);
    assert.equal(r.status, "ok");
    assert.equal(r.messages.length, 1);
    assert.equal(r.messages[0].role, "external");
    assert.ok(r.messages[0].text.includes("外部消息被吸收进当前回合"), "list preview carries the label");
    assert.ok(r.messages[0].text.includes("hello absorbed"), "list preview carries the content");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — readLive drops a task landed on develop (done) whose stale disk still says ready", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-stale-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const writeTask = (id, status) => fs.writeFileSync(path.join(tasksDir, `${id}.md`), `---\nid: ${id}\nstatus: ${status}\n---\nbody\n`);
    git("init", "-b", "develop", "-q", ".");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeTask("gap-stale", "done");
    writeTask("gap-fresh", "ready");
    git("add", ".");
    git("commit", "-q", "-m", "develop: gap-stale done, gap-fresh ready");
    git("checkout", "-q", "-b", "manager-stale");
    writeTask("gap-stale", "ready"); // stale branch rewrites it back to ready
    git("add", ".");
    git("commit", "-q", "-m", "manager-stale: reset gap-stale to ready");

    // Orphan START events (no END) for both — both pair as in-flight BEFORE the status filter, so
    // the drop of gap-stale must come from the develop-read (done), not from any other filter.
    const eventsDir = path.join(root, ".workflow-events");
    fs.mkdirSync(eventsDir, { recursive: true });
    const nowMs = Date.now();
    const start = (runId, taskId) => ({
      schemaVersion: "1", agentLabel: "fast-mode", attempt: 0, stage: "Fast", eventKind: "start",
      runId, taskId, commandIdentity: "fast-mode-telemetry:task-start", recordedAtMs: nowMs,
      timing: { queuedAtMs: null, startedAtMs: nowMs - 120_000, endedAtMs: null },
    });
    fs.writeFileSync(path.join(eventsDir, "fm-stale-1.jsonl"), JSON.stringify(start("fm-STALE-1", "gap-stale")) + "\n");
    fs.writeFileSync(path.join(eventsDir, "fm-fresh-1.jsonl"), JSON.stringify(start("fm-FRESH-1", "gap-fresh")) + "\n");

    // Falsifiability: the develop ref says done, the working tree says ready.
    assert.equal(readTaskStatusAtRef(root, "develop", "gap-stale"), "done", "develop ref carries done");
    assert.match(fs.readFileSync(path.join(tasksDir, "gap-stale.md"), "utf8"), /^status:\s*ready/m, "working tree carries ready");

    const live = readLive(root, { nowMs, liveWorkers: [] });
    const ids = new Set(live.inFlight.map((t) => t.taskId));
    assert.ok(!ids.has("gap-stale"), "AC1: develop=done drops gap-stale even though disk=ready (⛔ 仍显示在飞 ⇒ 假)");
    assert.ok(ids.has("gap-fresh"), "AC2: gap-fresh (ready in both) stays in-flight");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-dispatch-reads-stale-main-checkout-task-status (AC2/AC3) — the develop commit-time and
// title read faces. `readTaskCommitTimesAtRef` is the updated-at source (develop last-commit time,
// NOT disk mtime — a disk write after a develop flip must not move the display); `readTaskTitleMapAtRef`
// + `readTaskAtRefMeta` are the title half of the divergence marker. All object-store reads (git log /
// ls-tree / cat-file / show), never a checkout.

/** Commit helper with pinned author/committer dates so last-commit-time assertions are deterministic. */
function commitAtPinned(root, msg, iso) {
  const env = { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso };
  execFileSync("git", ["-C", root, "add", "-A"], { env });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", msg], { env });
}

test("readTaskCommitTimesAtRef — one git-log pass returns each task's develop last-commit time (AC2 updated source)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obs-ct-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "develop", "."], { cwd: root });
    execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", root, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(tasksDir, "gap-a.md"), "---\nid: gap-a\nstatus: ready\n---\nbody\n");
    fs.writeFileSync(path.join(tasksDir, "gap-b.md"), "---\nid: gap-b\nstatus: done\n---\nbody\n");
    commitAtPinned(root, "init", "2026-08-30T05:00:00+00:00");
    // Only gap-a is rewritten (flip to done) at a LATER pinned time.
    fs.writeFileSync(path.join(tasksDir, "gap-a.md"), "---\nid: gap-a\nstatus: done\n---\nbody\n");
    commitAtPinned(root, "gap-a flip", "2026-08-30T05:12:41+00:00");
    clearTaskStatusRefCache();

    const times = readTaskCommitTimesAtRef(root, "develop");
    assert.equal(times.size, 2, "both tasks present at develop");
    assert.equal(times.get("gap-a"), Date.parse("2026-08-30T05:12:41+00:00"), "gap-a last commit = the flip commit, not the init");
    assert.equal(times.get("gap-b"), Date.parse("2026-08-30T05:00:00+00:00"), "gap-b last commit = init");
    // The single-task read (detail page) agrees with the batched read (list page).
    assert.equal(readTaskCommitTimeAtRef(root, "develop", "gap-a"), Date.parse("2026-08-30T05:12:41+00:00"));
    assert.equal(readTaskCommitTimeAtRef(root, "develop", "gap-b"), Date.parse("2026-08-30T05:00:00+00:00"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readTaskTitleMapAtRef / readTaskAtRefMeta — develop title is the divergence-marker source (AC3)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obs-title-"));
  try {
    const tasksDir = path.join(root, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "develop", "."], { cwd: root });
    execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", root, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(tasksDir, "gap-a.md"), "---\nid: gap-a\ntitle: develop title a\nstatus: ready\n---\nbody\n");
    commitAtPinned(root, "init", "2026-08-30T05:00:00+00:00");
    // Uncommitted disk title edit (the 05:02 range-rewrite shape) — develop keeps the old title.
    fs.writeFileSync(path.join(tasksDir, "gap-a.md"), "---\nid: gap-a\ntitle: disk title a\nstatus: ready\n---\nbody\n");

    assert.equal(readTaskTitleMapAtRef(root, "develop").get("gap-a"), "develop title a", "batch title read returns the develop title, not the uncommitted disk title");
    const meta = readTaskAtRefMeta(root, "develop", "gap-a");
    assert.equal(meta.title, "develop title a", "single-task meta read returns the develop title");
    assert.equal(meta.status, "ready", "single-task meta read returns the develop status");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
