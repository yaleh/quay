// @test-group governance
// fan-in-runid-check.test.mjs — gap-task-telemetry-6-percent-join: the fan-in merge commit must
// carry a `runId:` so the telemetry taskId → git branch join is traceable (the 6%-join defect).
//
// Covers:
//   AC2  — fan-in commits carry `(runId: fm-...)` (measure fanin_runid_present=true)
//   AC3  — telemetry taskId mechanically resolves to the fan-in commit (telemetry_traceable=1)
//   + the fast-mode-telemetry side of the fix: --task-end --fanInCommit records the sha
//     (candidateCommit), --report carries fanInCommit, --run-id-for reads the open bracket's runId
//     (the A6 merge-message input).
//
// Run:
//   node --test plugin/test/fan-in-runid-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK_CLI = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-runid-check.ts");
const TELEMETRY_CLI = path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-runid-"));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function gitCmd(dir, ...args) {
  const res = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return res;
}

function initGitRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "fan-in-runid-test");
  gitCmd(dir, "config", "user.email", "fir@example.com");
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

function runCheck(dir, ...args) {
  return spawnSync("node", ["--experimental-strip-types", CHECK_CLI, "--root", dir, ...args], {
    encoding: "utf8",
  });
}

function runTelemetry(dir, ...args) {
  return spawnSync("node", ["--experimental-strip-types", TELEMETRY_CLI, "--root", dir, ...args], {
    encoding: "utf8",
  });
}

// git commits with a 2030 committer/author date: `firstKnownCommitMs` compares the task's first
// known WORK commit (second-precision committer time) against the telemetry start (ms-precision).
// In a fast test the work lands in the SAME second as `--task-start`, so the ms start appears to
// PREDATE the commit and the record is flagged `startedAtMsUnreliable` (excluded from tasks[]).
// Pinning the git dates to 2030 makes the commit strictly AFTER any real start — deterministic.
function gitCmd2030(dir, ...args) {
  return spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2030-01-01T00:00:00Z" },
  });
}

/**
 * Create a tmp git repo with one task branch `task/<id>` merged back to the base branch with a
 * fan-in merge whose message is `merge: fan-in task/<id> (runId: <runId>)` (or the given subject).
 * Returns { dir, sha } where sha is the fan-in merge commit's sha.
 */
function makeFanInRepo(id, { subject, runId } = {}) {
  const dir = makeTmp();
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "checkout", "-q", "-b", `task/${id}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  commitAll(dir, `work for ${id}`);
  gitCmd(dir, "checkout", "-q", "-");
  const msg = subject ?? `merge: fan-in task/${id} (runId: ${runId})`;
  const merge = gitCmd(dir, "merge", "--no-ff", `task/${id}`, "-m", msg, "-q");
  assert.equal(merge.status, 0, `fan-in merge failed: ${merge.stderr}`);
  const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  return { dir, sha };
}

// ── AC2: fan-in commits carry a runId ─────────────────────────────────────────────────────────────────

test("AC2 — a fan-in commit with (runId: fm-…) PASSES the checker (--commit mode)", () => {
  const runId = "fm-gap-x-123456-ab12cd";
  const { dir, sha } = makeFanInRepo("gap-x", { runId });
  try {
    const res = runCheck(dir, "--commit", sha);
    assert.equal(res.status, 0, `checker should pass a runId-bearing fan-in commit: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /fanin_runid_present=true/);
    assert.match(res.stdout, new RegExp(runId));
  } finally {
    cleanup(dir);
  }
});

test("AC2 (negative control) — a fan-in commit WITHOUT a runId FAILS the checker", () => {
  const { dir, sha } = makeFanInRepo("gap-x", { subject: "merge: fan-in task/gap-x" });
  try {
    const res = runCheck(dir, "--commit", sha);
    assert.notEqual(res.status, 0, "a fan-in commit without runId must fail the checker");
    assert.match(res.stdout, /fanin_runid_present=false/);
  } finally {
    cleanup(dir);
  }
});

test("AC2 — default scan mode finds the LATEST fan-in commit on HEAD and checks its runId", () => {
  const runId = "fm-gap-y-654321-zyxwvu";
  const { dir } = makeFanInRepo("gap-y", { runId });
  try {
    const res = runCheck(dir);
    assert.equal(res.status, 0, `default scan should find the runId-bearing fan-in commit: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /fanin_runid_present=true/);
  } finally {
    cleanup(dir);
  }
});

test("AC2 — --run-id <expected> requires the fan-in commit's runId to match", () => {
  const runId = "fm-gap-z-111111-aaaaaa";
  const { dir, sha } = makeFanInRepo("gap-z", { runId });
  try {
    const ok = runCheck(dir, "--commit", sha, "--run-id", runId);
    assert.equal(ok.status, 0, "matching expected runId passes");
    const bad = runCheck(dir, "--commit", sha, "--run-id", "fm-other-999999-zzzzzz");
    assert.notEqual(bad.status, 0, "a mismatched expected runId fails");
  } finally {
    cleanup(dir);
  }
});

test("checker --help exits 2 with usage (no business side-effect)", () => {
  const dir = makeTmp();
  try {
    const res = runCheck(dir, "--help");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /fan-in-runid-check.ts/);
  } finally {
    cleanup(dir);
  }
});

// ── AC3: telemetry taskId → fan-in commit traceability ────────────────────────────────────────────────

test("AC3 — telemetry_traceable=1: the fan-in commit's runId resolves to a telemetry record for the taskId", () => {
  const dir = makeTmp();
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    // Dispatch bracket: --task-start records a runId under .workflow-events/<runId>.jsonl.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-trace");
    assert.equal(start.status, 0, `--task-start failed: ${start.stderr}`);
    const runId = start.stdout.trim();
    assert.match(runId, /^fm-gap-trace-/);

    // Fan-in merge carries THAT runId.
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-trace");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "work for gap-trace");
    gitCmd(dir, "checkout", "-q", "-");
    const msg = `merge: fan-in task/gap-trace (runId: ${runId})`;
    assert.equal(gitCmd(dir, "merge", "--no-ff", "task/gap-trace", "-m", msg, "-q").status, 0);
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();

    // Checker with --taskId: the runId → telemetry direction AND the taskId → runId direction.
    const res = runCheck(dir, "--commit", sha, "--taskId", "gap-trace");
    assert.equal(res.status, 0, `traceable fan-in should pass: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /telemetry_traceable=true/);
  } finally {
    cleanup(dir);
  }
});

test("AC3 (negative control) — a runId whose telemetry references a DIFFERENT taskId is NOT traceable", () => {
  const dir = makeTmp();
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    // The runId's telemetry references gap-other, but the checker is asked to trace gap-x.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-other");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    gitCmd(dir, "checkout", "-q", "-b", "task/gap-x");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "work for gap-x");
    gitCmd(dir, "checkout", "-q", "-");
    const msg = `merge: fan-in task/gap-x (runId: ${runId})`;
    assert.equal(gitCmd(dir, "merge", "--no-ff", "task/gap-x", "-m", msg, "-q").status, 0);
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();

    const res = runCheck(dir, "--commit", sha, "--taskId", "gap-x");
    assert.notEqual(res.status, 0, "taskId↔runId mismatch must fail the traceability check");
    assert.match(res.stdout, /telemetry_traceable=false/);
  } finally {
    cleanup(dir);
  }
});

// ── telemetry side: --fanInCommit records the sha; --report carries fanInCommit; --run-id-for ─────────

test("telemetry — --task-end --fanInCommit records the sha; --report tasks carry fanInCommit", () => {
  const dir = makeTmp();
  try {
    // No git here on purpose: the explicit --fanInCommit path must not depend on a repo, and
    // without git firstKnownCommitMs returns null so no startedAtMsUnreliable distortion.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-fc");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();
    const sha = "a".repeat(40);

    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-fc", "--runId", runId, "--outcome", "done", "--fanInCommit", sha);
    assert.equal(end.status, 0, `--task-end failed: ${end.stderr}`);
    assert.match(end.stdout, /fanInCommit aaaa/);

    const report = runTelemetry(dir, "--report", "--json");
    assert.equal(report.status, 0);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].taskId, "gap-fc");
    assert.equal(parsed.tasks[0].fanInCommit, sha, "--report must carry the recorded fanInCommit");
  } finally {
    cleanup(dir);
  }
});

test("telemetry — --task-end WITHOUT --fanInCommit auto-derives the fan-in commit sha from the runId", () => {
  const dir = makeTmp();
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-auto");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    // 2030 git dates: the fan-in commit's committer time is strictly AFTER the ms start, so the
    // completed pair is NOT flagged startedAtMsUnreliable (would otherwise leave tasks[]).
    gitCmd2030(dir, "checkout", "-q", "-b", "task/gap-auto");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    gitCmd2030(dir, "add", "-A");
    gitCmd2030(dir, "commit", "-q", "-m", "work for gap-auto");
    gitCmd2030(dir, "checkout", "-q", "-");
    assert.equal(gitCmd2030(dir, "merge", "--no-ff", "task/gap-auto", "-m", `merge: fan-in task/gap-auto (runId: ${runId})`, "-q").status, 0);
    const sha = gitCmd2030(dir, "rev-parse", "HEAD").stdout.trim();

    // No --fanInCommit: the CLI must resolve the fan-in commit whose subject carries the runId.
    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-auto", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0, `--task-end failed: ${end.stderr}`);
    assert.match(end.stdout, new RegExp(`fanInCommit ${sha.slice(0, 8)}`), "auto-derived fanInCommit should be logged");

    const report = runTelemetry(dir, "--report", "--json");
    assert.equal(report.status, 0);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.tasks.length, 1, `expected 1 completed task, got ${JSON.stringify(parsed.tasks)}${JSON.stringify(parsed.unreliable)}`);
    assert.equal(parsed.tasks[0].fanInCommit, sha, "auto-derived fanInCommit should appear in the report");
  } finally {
    cleanup(dir);
  }
});

test("telemetry — --run-id-for prints the open bracket's runId (the A6 merge-message input), then empty after close", () => {
  const dir = makeTmp();
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-rid");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    const read = runTelemetry(dir, "--run-id-for", "--taskId", "gap-rid");
    assert.equal(read.status, 0);
    assert.equal(read.stdout.trim(), runId, "--run-id-for should return the open bracket's runId");

    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-rid", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0);

    const after = runTelemetry(dir, "--run-id-for", "--taskId", "gap-rid");
    assert.equal(after.status, 0);
    assert.equal(after.stdout.trim(), "", "after close there is no open bracket → empty");
  } finally {
    cleanup(dir);
  }
});
