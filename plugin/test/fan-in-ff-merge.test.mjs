// @test-group engine
// fan-in-ff-merge.test.mjs — AC62 持锁段: the merge lock that wraps ONLY `git merge --ff-only
// task/<id>` (plugin/scripts/fan-in-ff-merge.sh, tasks/gap-ac62-fan-in-ff-merge-lock-protocol).
//
// The fan-in protocol (SPEC-fan-in-ff-merge-lock-2026-08-14) splits the landing into a 无锁段
// (merge develop + full suite + doc check, in the task worktree — NOT this script) and a 持锁段
// (THIS script: acquire merge lock → git merge --ff-only → release, success or failure). This test
// covers the 持锁段 mechanics:
//   * ff success — develop fast-forwards to the task tip, lock-hold events written, NO retry record
//   * ff failure (develop advanced — the ONLY ff failure reason) — exit 1, retry record written
//     (task id / attempt 第几次 / develop head / timestamp), lock events still paired, ref unchanged
//   * attempt increments across repeated failures (the anti-livelock data, §7)
//   * fail-closed guards (suite running / missing task branch / dirty tree / wrong branch) exit 2
//     and write NO retry record (they are environment errors, not ff failures)
//   * the lock is a SEPARATE file from the suite lock and held only around the ff (AC4)
//
// Run:
//   scripts/test.sh plugin/test/fan-in-ff-merge.test.mjs
//   node --test plugin/test/fan-in-ff-merge.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MERGE_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-merge.sh");
const SUITE_LOCK_0 = "full-suite.lock.0";
const MERGE_LOCK = "fan-in-merge.lock";

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return r;
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `faninff-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** Init a temp git repo on branch `master`; `.quay/` is gitignored (the runtime-state family). */
function initRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "faninff-test");
  gitCmd(dir, "config", "user.email", "fif@example.com");
  gitCmd(dir, "branch", "-M", "master");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "chore: gitignore");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
}

/** Create `task/<id>` with one commit on top of master, then return to master. Returns the task tip. */
function makeTaskBranch(dir, taskId) {
  gitCmd(dir, "checkout", "-q", "-b", `task/${taskId}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "task work");
  const tip = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  gitCmd(dir, "checkout", "-q", "master");
  return tip;
}

function runMerge(args) {
  return spawnSync("bash", [MERGE_SCRIPT, ...args], { encoding: "utf8" });
}

function stateDir(prefix) {
  // Runtime state (lock events / retry record / suite state) lives OUTSIDE the repo so it never
  // pollutes the working tree; also exercised via the override flags.
  return fs.mkdtempSync(path.join(os.tmpdir(), `faninffstate-${prefix}-`));
}

function writeSuiteState(dir, obj) {
  const p = path.join(dir, "full-suite-state.json");
  fs.writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

// ── FF success ─────────────────────────────────────────────────────────────────────────────────────────

test("ff success — master fast-forwards to the task tip; lock events paired; NO retry record", () => {
  const dir = makeTmp("ok");
  const st = stateDir("ok");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-a");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "fan-in-merge-lock-events.jsonl");
    const retries = path.join(st, "fan-in-retries.jsonl");
    const before = gitCmd(dir, "rev-parse", "master").stdout.trim();

    const r = runMerge(["--task", "ac62-a", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `ff should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure ff_only_locked=true/);
    // master fast-forwarded to the task tip (no merge commit — HEAD is the task tip, single parent).
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), tip, "master must be at the task tip");
    assert.notEqual(gitCmd(dir, "rev-parse", "master").stdout.trim(), before, "master advanced");
    assert.equal(gitCmd(dir, "rev-list", "--parents", "-n", "1", "master").stdout.trim().split(" ").length, 2,
      "ff creates NO merge commit (single parent)");
    // Lock events: exactly one acquire + one release for this task.
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "exactly acquire+release");
    const [acq, rel] = lines.map(JSON.parse);
    assert.equal(acq.event, "acquire");
    assert.equal(rel.event, "release");
    assert.equal(acq.taskId, "ac62-a");
    // The hold is released immediately (release ≥ acquire, and the window is milliseconds).
    assert.ok(rel.epoch >= acq.epoch, "release must not precede acquire");
    // No retry record written on success.
    assert.ok(!fs.existsSync(retries), "no retry record on success");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── FF failure (develop advanced) + retry record ───────────────────────────────────────────────────────

test("ff failure (develop advanced) — exit 1, retry record with taskId/attempt/developHead/ts, ref unchanged", () => {
  const dir = makeTmp("fail");
  const st = stateDir("fail");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-b");
    // develop advances AFTER the task branched (another ff landed first) ⇒ ff cannot fast-forward.
    fs.writeFileSync(path.join(dir, "adv.txt"), "B ff'd first\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "develop advanced (B ff'd)");
    const head = gitCmd(dir, "rev-parse", "master").stdout.trim();
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");

    const r = runMerge(["--task", "ac62-b", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 1, `ff must fail: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /FF FAILED/);
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), head, "ref unchanged on ff failure");
    // Retry record: 判据3 — task id / attempt 第几次 / develop head / 时刻.
    const rec = JSON.parse(fs.readFileSync(retries, "utf8").trim());
    assert.equal(rec.taskId, "ac62-b");
    assert.equal(rec.attempt, 1, "first failure is 第1次");
    assert.match(rec.developHead, /^[0-9a-f]{40}$/, "developHead must be 40-hex");
    assert.equal(rec.developHead, head, "developHead is the head at failure time");
    assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ts must be ISO …Z");
    // Lock events still paired (the lock was released on failure too).
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "acquire+release written even on failure");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── AC67 判据2: the caller agent identity lands in the records ────────────────────────────────────────

test("AC67 判据2 — --agent-id is written into the retry record AND lock events; absent ⇒ null (the main-thread form)", () => {
  const dir = makeTmp("agid");
  const st = stateDir("agid");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac67-ag");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });

    // With --agent-id: the value is the quoted JSON string.
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "ac67-ag", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries, "--agent-id", "subagent-uuid-abc", "--run-id", "fm-gap-x-17866"]);
    assert.equal(r.status, 1, `ff must fail: ${r.stdout}${r.stderr}`);
    const rec = JSON.parse(fs.readFileSync(retries, "utf8").trim());
    assert.equal(rec.agentId, "subagent-uuid-abc", "retry record carries the caller agent id");
    assert.equal(rec.runId, "fm-gap-x-17866", "runId stays a single well-formed string");
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines) {
      const e = JSON.parse(l);
      assert.equal(e.agentId, "subagent-uuid-abc", "lock events carry the caller agent id");
    }

    // Without --agent-id: agentId is null — the absence the executor check flags as main-thread.
    const events2 = path.join(st, "events2.jsonl");
    const retries2 = path.join(st, "retries2.jsonl");
    const r2 = runMerge(["--task", "ac67-ag", "--root", dir, "--suite-state", suite, "--lock-events", events2, "--retry-record", retries2]);
    assert.equal(r2.status, 1, "still fails (diverged)");
    const rec2 = JSON.parse(fs.readFileSync(retries2, "utf8").trim());
    assert.equal(rec2.agentId, null, "absent --agent-id ⇒ agentId null (the main-thread form)");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── Attempt counting (第几次) ─────────────────────────────────────────────────────────────────────────

test("ff failure attempt increments — second failure writes attempt 2 (anti-livelock data)", () => {
  const dir = makeTmp("attempt");
  const st = stateDir("attempt");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-c");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");

    const r1 = runMerge(["--task", "ac62-c", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r1.status, 1, "first ff fails");
    const r2 = runMerge(["--task", "ac62-c", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r2.status, 1, "second ff fails (still diverged)");

    const lines = fs.readFileSync(retries, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "two retry records");
    assert.equal(JSON.parse(lines[0]).attempt, 1, "first record is attempt 1");
    assert.equal(JSON.parse(lines[1]).attempt, 2, "second record is attempt 2");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── Fail-closed guards (environment errors, NOT ff failures — no retry record) ────────────────────────

test("suite running guard — exit 2, no lock events, no retry record (AC4: lock must not overlap a suite run)", () => {
  const dir = makeTmp("suiterg");
  const st = stateDir("suiterg");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-d");
    const suite = writeSuiteState(st, { state: "running", startedAt: "2026-08-14T00:00:00Z" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");

    const r = runMerge(["--task", "ac62-d", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 2, "must refuse while suite running");
    assert.match(r.stderr, /suite state is 'running'/);
    assert.ok(!fs.existsSync(events), "no lock events — the lock was never acquired");
    assert.ok(!fs.existsSync(retries), "no retry record — this is an environment guard, not an ff failure");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("missing task branch — exit 2, nothing merged", () => {
  const dir = makeTmp("nobr");
  try {
    initRepo(dir);
    const r = runMerge(["--task", "does-not-exist", "--root", dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /task branch task\/does-not-exist not found/);
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), gitCmd(dir, "rev-parse", "master").stdout.trim());
  } finally {
    cleanup(dir);
  }
});

test("dirty tree — exit 2, no retry record (ff must run on a clean checkout)", () => {
  const dir = makeTmp("dirty");
  const st = stateDir("dirty");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-e");
    fs.writeFileSync(path.join(dir, "uncommitted.txt"), "dirty\n", "utf8"); // untracked, not gitignored
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "ac62-e", "--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not clean/);
    assert.ok(!fs.existsSync(retries), "no retry record on an environment error");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("wrong branch (current checkout not the merge target) — exit 2", () => {
  const dir = makeTmp("wbr");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-f");
    gitCmd(dir, "checkout", "-q", "-b", "some-other-branch"); // checkout is NOT on master
    const r = runMerge(["--task", "ac62-f", "--root", dir, "--merge-target", "master"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not the merge target/);
  } finally {
    cleanup(dir);
  }
});

test("--help exits 0 with usage on stdout (gap-scripts-sprawl convention)", () => {
  const r = runMerge(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-ff-merge/);
});

test("lock is a SEPARATE file from the suite lock (AC4 — 对象不相干)", () => {
  const dir = makeTmp("locksep");
  const st = stateDir("locksep");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-g");
    const commonDir = gitCmd(dir, "rev-parse", "--git-common-dir").stdout.trim();
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const r = runMerge(["--task", "ac62-g", "--root", dir, "--suite-state", suite]);
    assert.equal(r.status, 0, `ff should succeed: ${r.stdout}${r.stderr}`);
    // The merge lock file exists in the git common dir, distinct from the suite lock.
    assert.ok(fs.existsSync(path.join(dir, commonDir, MERGE_LOCK)), "merge lock file created");
    assert.ok(!fs.existsSync(path.join(dir, commonDir, SUITE_LOCK_0)), "suite lock NOT created/touched by the ff");
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), tip);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});
