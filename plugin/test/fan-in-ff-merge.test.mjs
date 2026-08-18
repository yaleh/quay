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

// gap-suite-concurrency-ff-gate-and-slot-ssot AC1 — the ff gate now reads THIS task's suite CAPTURE
// (suite_exit=0 ∧ suite_head == 待 ff 的 HEAD), not any global suite lock. Every ff that should proceed
// must carry a valid capture for its task.
function writeSuiteCapture(stateDir, taskId, tip, overrides = {}) {
  const capture = path.join(stateDir, `capture-${taskId}.env`);
  const lines = [
    "full_suite_ran=true",
    "skip_reason=",
    "cpu_s=null",
    "cpu_source=not-wired",
    `suite_head=${tip}`,
    "suite_exit=0",
  ];
  for (const [k, v] of Object.entries(overrides)) lines.push(`${k}=${v}`);
  fs.writeFileSync(capture, lines.join("\n") + "\n", "utf8");
  return capture;
}

/** Build the `--suite-capture <file>` args for a task whose suite finished green on `tip`. */
function captureArgs(st, taskId, tip, overrides = {}) {
  const capture = writeSuiteCapture(st, taskId, tip, overrides);
  return ["--suite-capture", capture];
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
    // AC1 (gap-suite-concurrency-ff-gate-and-slot-ssot): the ff gate reads THIS task's suite capture —
    // suite_exit=0 ∧ suite_head == the task tip being ff'd.
    const capArgs = captureArgs(st, "ac62-a", tip);

    const r = runMerge(["--task", "ac62-a", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
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
    const tip = makeTaskBranch(dir, "ac62-b");
    // develop advances AFTER the task branched (another ff landed first) ⇒ ff cannot fast-forward.
    fs.writeFileSync(path.join(dir, "adv.txt"), "B ff'd first\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "develop advanced (B ff'd)");
    const head = gitCmd(dir, "rev-parse", "master").stdout.trim();
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    // The task's suite was green on ITS tip (the commit being ff'd) — the ff fails ONLY because
    // develop advanced afterward (not because the suite gate refused).
    const capArgs = captureArgs(st, "ac62-b", tip);

    const r = runMerge(["--task", "ac62-b", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
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
    const tip = makeTaskBranch(dir, "ac67-ag");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const capArgs = captureArgs(st, "ac67-ag", tip);

    // With --agent-id: the value is the quoted JSON string.
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "ac67-ag", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--agent-id", "subagent-uuid-abc", "--run-id", "fm-gap-x-17866"]);
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
    const r2 = runMerge(["--task", "ac67-ag", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events2, "--retry-record", retries2]);
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
    const tip = makeTaskBranch(dir, "ac62-c");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "ac62-c", tip);

    const r1 = runMerge(["--task", "ac62-c", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r1.status, 1, "first ff fails");
    const r2 = runMerge(["--task", "ac62-c", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
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

// ── SPEC §7 anti-livelock trigger (gap-ff-livelock-trigger-no-action, attempt >= 3) ─────────────────
// The retry record IS the anti-livelock data (§7): "同一任务 ff 失败 ≥3 次 才谈防活锁". Attempts 1-2
// stay the plain retry (exit 1). Attempt >= 3 escalates (exit 3 — DISTINCT from 1 and 2), writes a
// DISTINCT escalation record (with the SPEC §7 quiet-window request), and STOPS automatic retry.

test("anti-livelock — attempt 1 and 2 are plain retries (exit 1, NO escalation); attempt 3 escalates (exit 3 + escalation record + quiet-window request)", () => {
  const dir = makeTmp("llock");
  const st = stateDir("llock");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "llock-a");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "llock-a", tip);
    const args = ["--task", "llock-a", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc];

    const r1 = runMerge(args);
    assert.equal(r1.status, 1, "attempt 1 stays a plain retry (exit 1) — the ≤2-failure path is unchanged");
    assert.match(r1.stderr, /FF FAILED/);
    const r2 = runMerge(args);
    assert.equal(r2.status, 1, "attempt 2 stays a plain retry (exit 1)");
    assert.ok(!fs.existsSync(esc), "NO escalation record before the >=3 threshold");

    const r3 = runMerge(args);
    assert.equal(r3.status, 3, "attempt 3 escalates with DISTINCT exit 3 (anti-livelock, not conflated with the retry exit 1)");
    assert.match(r3.stderr, /ANTI-LIVELOCK/);
    const retryLines = fs.readFileSync(retries, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(retryLines.length, 3, "three retry records");
    assert.equal(JSON.parse(retryLines[2]).attempt, 3, "third retry record is attempt 3");
    const esRec = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(esRec.event, "ff-escalation");
    assert.equal(esRec.taskId, "llock-a");
    assert.equal(esRec.attempt, 3);
    assert.equal(esRec.action, "request-quiet-window-and-stop-retry");
    assert.equal(esRec.quietWindow.requested, true, "the escalation carries the SPEC §7 quiet-window request");
    assert.match(esRec.developHead, /^[0-9a-f]{40}$/, "escalation records the develop head at failure time");
    // Lock events are still written on the escalation path (the escalation is a real ff attempt).
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 6, "acquire+release written on all three attempts, including the escalated one");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("anti-livelock — no-auto-retry guard: after escalation, the next failure ALSO escalates (exit 3), never the plain retry exit 1", () => {
  const dir = makeTmp("llockg");
  const st = stateDir("llockg");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "llock-b");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "llock-b", tip);
    const args = ["--task", "llock-b", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc];

    assert.equal(runMerge(args).status, 1, "attempt 1 retry");
    assert.equal(runMerge(args).status, 1, "attempt 2 retry");
    assert.equal(runMerge(args).status, 3, "attempt 3 escalates");
    const r4 = runMerge(args);
    assert.equal(r4.status, 3, "attempt 4 (a caller looping after the escalation) ALSO escalates — automatic retry is stopped, never returns exit 1");
    const escLines = fs.readFileSync(esc, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(escLines.length, 2, "two escalation records (attempt 3 and 4)");
    assert.equal(JSON.parse(escLines[0]).attempt, 3);
    assert.equal(JSON.parse(escLines[1]).attempt, 4);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("anti-livelock — ac63 4 real retry samples replay (11:55/12:39/12:42/13:58): a task with 4 prior ff failures escalates (exit 3)", () => {
  const dir = makeTmp("llock63");
  const st = stateDir("llock63");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "gap-ac63-judgment2-no-carrier");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "gap-ac63-judgment2-no-carrier", tip);
    // The 4 REAL ac63 retry records — captured verbatim from .quay/fan-in-retries.jsonl (D2 不构造).
    const realSamples = [
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 1, developHead: "bd4612e5bc74f8db1a6a5b5cb240f2c587d1a304", ts: "2026-08-14T11:55:47Z", epoch: 1786708547, runId: "fm-gap-ac63-judgment2-no-carrier-1786707748654-tzaml5", agentId: "aac7ae30a0aa05591", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 2, developHead: "17d0492ad1f3018f56efc77f9cbd20044357a504", ts: "2026-08-14T12:39:39Z", epoch: 1786711179, runId: "fm-gap-ac63-judgment2-no-carrier-1786707748654-tzaml5", agentId: "a719b89d2086a4e27", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 3, developHead: "04659638f3a7e7cc6cc932dca846a87967db13da", ts: "2026-08-14T12:42:50Z", epoch: 1786711370, runId: "fm-gap-ac63-judgment2-no-carrier-1786707748654-tzaml5", agentId: "a719b89d2086a4e27", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 4, developHead: "81f72af4907861c6efa3ebf5605c21c4eb7d29d2", ts: "2026-08-14T13:58:15Z", epoch: 1786715895, runId: "fm-gap-ac63-judgment2-no-carrier-1786707748654-tzaml5", agentId: "a285a0091e9605468", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
    ];
    fs.writeFileSync(retries, realSamples.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const esc = path.join(st, "escalations.jsonl");

    const r = runMerge(["--task", "gap-ac63-judgment2-no-carrier", "--root", dir, "--suite-state", suite, ...capArgs, "--retry-record", retries, "--escalations", esc]);
    assert.equal(r.status, 3, "replaying the 4 real ac63 retry records + one more ff failure (attempt 5) must trigger the anti-livelock action (判据2: 现状只升级无动作 ⇒ 红; 触发后动作机械定义)");
    assert.match(r.stderr, /ANTI-LIVELOCK/);
    const esRec = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(esRec.taskId, "gap-ac63-judgment2-no-carrier");
    assert.equal(esRec.attempt, 5, "the escalation records attempt 5 (4 prior real failures + 1)");
    assert.equal(esRec.action, "request-quiet-window-and-stop-retry");
    assert.equal(esRec.quietWindow.requested, true);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("anti-livelock — ac80 2 real retry samples replay: a 3rd ff failure (the gap AC80 hit — 2 failures + 4 develop-advances) escalates (exit 3)", () => {
  const dir = makeTmp("llock80");
  const st = stateDir("llock80");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "gap-ac80-prompt-canonical-and-invariant-checker");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "gap-ac80-prompt-canonical-and-invariant-checker", tip);
    // The 2 REAL ac80 retry records — captured verbatim from .quay/fan-in-retries.jsonl.
    const realSamples = [
      { taskId: "gap-ac80-prompt-canonical-and-invariant-checker", attempt: 1, developHead: "c5d9e7635c43b368fac41b681522c88b7f28caaf", ts: "2026-08-14T17:08:27Z", epoch: 1786727307, runId: "fm-gap-ac80-prompt-canonical-and-invariant-checker-1786720803526-arirtz", agentId: "a6a49c9fd9ee3ecfe", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac80-prompt-canonical-and-invariant-checker", attempt: 2, developHead: "bf23bd1da5b16f822365a56965c11d78a9cdcbda", ts: "2026-08-14T17:10:25Z", epoch: 1786727425, runId: "fm-gap-ac80-prompt-canonical-and-invariant-checker-1786720803526-arirtz", agentId: "a6a49c9fd9ee3ecfe", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
    ];
    fs.writeFileSync(retries, realSamples.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const esc = path.join(st, "escalations.jsonl");

    // AC80 had 2 ff failures and develop kept advancing (4 advances during the workflow) — the gap
    // was that nothing would trigger if it hit the 3rd. Replay the 2 real records + one more failure:
    // the 3rd failure MUST trigger the anti-livelock action (the gap is now closed).
    const r = runMerge(["--task", "gap-ac80-prompt-canonical-and-invariant-checker", "--root", dir, "--suite-state", suite, ...capArgs, "--retry-record", retries, "--escalations", esc]);
    assert.equal(r.status, 3, "the 3rd ff failure (2 real prior failures + 1) escalates — the AC80 gap is closed");
    const esRec = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(esRec.attempt, 3, "escalation records attempt 3 (2 prior + 1)");
    assert.equal(esRec.quietWindow.requested, true);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── AC1 收窄后的 ff 闸 (gap-suite-concurrency-ff-gate-and-slot-ssot) ─────────────────────────────────
// The ff gate reads THIS TASK's suite capture (suite_exit=0 ∧ suite_head == 待 ff 的 HEAD), NOT any
// global suite lock. Missing / non-green / head-mismatch capture ⇒ environment error (exit 2, no lock
// events, no retry record — not an ff failure). A HELD global suite-lock slot is now IRRELEVANT to the
// ff — two fan-ins with their own green suites can both ff (contradiction B / livelock fix).

test("AC1 gate — capture MISSING ⇒ exit 2, no lock events, no retry record (ff 无证可查)", () => {
  const dir = makeTmp("nocap");
  const st = stateDir("nocap");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-nocap");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    // NO --suite-capture passed: the default /tmp/fan-in-suite-<task>.env does not exist ⇒ fail-closed.
    const r = runMerge(["--task", "ac62-nocap", "--root", dir, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 2, "missing capture must refuse (exit 2)");
    assert.match(r.stderr, /suite 证书未满足/, "the refusal names the missing suite certificate");
    assert.ok(!fs.existsSync(events), "no lock events — the lock was never acquired");
    assert.ok(!fs.existsSync(retries), "no retry record — this is an environment guard, not an ff failure");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC1 gate — capture suite_exit != 0 ⇒ exit 2 (ff 不得钉住一份红 suite 证书)", () => {
  const dir = makeTmp("redcap");
  const st = stateDir("redcap");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-redcap");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "ac62-redcap", tip, { suite_exit: "1" }); // red suite
    const r = runMerge(["--task", "ac62-redcap", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 2, "a non-green suite certificate must refuse (exit 2)");
    assert.match(r.stderr, /suite_exit=1/, "the refusal reports the non-green suite_exit");
    assert.ok(!fs.existsSync(events), "no lock events");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC1 gate — capture suite_head != 待 ff HEAD ⇒ exit 2 (证书必须钉住被 ff 的那个 commit)", () => {
  const dir = makeTmp("headmis");
  const st = stateDir("headmis");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-headmis");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    // The suite ran on an OLDER head (develop advanced after the suite, before the ff) — the cert is
    // for a DIFFERENT commit than the one about to be ff'd ⇒ refuse (the caller must re-merge+re-run).
    const staleHead = "0".repeat(40);
    const capArgs = captureArgs(st, "ac62-headmis", staleHead);
    const r = runMerge(["--task", "ac62-headmis", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 2, "a suite_head != 待 ff tip must refuse (exit 2)");
    assert.match(r.stderr, /suite_head/, "the refusal reports the suite_head mismatch");
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), gitCmd(dir, "rev-parse", "master").stdout.trim(), "ref unchanged");
    assert.ok(!fs.existsSync(events), "no lock events");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC5 — contradiction B FIXED: BOTH global suite-lock slots held (S=2, two suites coexisting) do NOT refuse ANOTHER task's ff", () => {
  // The 2026-08-18 livelock: two fan-ins running suites in PARALLEL each saw the other's global
  // full-suite.lock slot ⇒ mutual REFUSE. Under S=2, two coexisting suites hold BOTH slots (.0 + .1).
  // The ff gate is now per-task (reads THIS task's capture), so held slots (other suites mid-run) are
  // IRRELEVANT — task A's ff must proceed with BOTH slots held (the strongest "两 suite 并存" case).
  const dir = makeTmp("ac5");
  const st = stateDir("ac5");
  let holder = null;
  try {
    initRepo(dir);
    const tipA = makeTaskBranch(dir, "ac5-a");
    const tipB = makeTaskBranch(dir, "ac5-b");
    // Task A's suite finished GREEN on ITS tip (the capture is the ff's only certificate).
    const capArgsA = captureArgs(st, "ac5-a", tipA);
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    // Simulate TWO other suites STILL RUNNING: hold BOTH global full-suite.lock slots .0 AND .1
    // (the OLD refusal trigger — the old gate refused when ANY slot was held).
    const slot0 = path.join(dir, ".git", SUITE_LOCK_0);
    const slot1 = path.join(dir, ".git", "full-suite.lock.1");
    fs.mkdirSync(path.dirname(slot0), { recursive: true });
    fs.writeFileSync(slot0, "", "utf8");
    fs.writeFileSync(slot1, "", "utf8");
    const inner =
      `exec 8>"${slot1}"; flock -n 8 || exit 8; ` +
      `exec 9>"${slot0}"; flock -n 9 || exit 9; ` +
      `bash ${MERGE_SCRIPT} ${["--task", "ac5-a", "--root", dir, ...capArgsA, "--lock-events", events, "--retry-record", retries].map((a) => JSON.stringify(a)).join(" ")}; rc=$?; ` +
      `flock -u 8 2>/dev/null; flock -u 9 2>/dev/null; exec 8>&- 2>/dev/null; exec 9>&- 2>/dev/null; exit $rc`;
    const r = spawnSync("bash", ["-c", inner], { encoding: "utf8" });
    // Two suites are "running" (BOTH slots held) yet A's ff MUST land — no mutual REFUSE.
    assert.equal(r.status, 0, `ff must proceed despite BOTH held global slots (contradiction B fixed):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /OK — master fast-forwarded/, `task A's ff must land:\n${r.stdout}`);
    assert.equal(gitCmd(dir, "rev-parse", "master").stdout.trim(), tipA, "master fast-forwarded to task A's tip (B untouched)");
    // tipA/tipB may coincide (identical parent+tree+message ⇒ identical SHA) — the AC5 point is that
    // task A's ff proceeds while B's suite "runs" (a held slot), NOT that the branches differ.
  } finally {
    if (holder) { try { process.kill(-holder.pid, "SIGKILL"); } catch { /* already gone */ } }
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

// ── AC78 判据2(c): --agent-id self-validation (fail-closed against top-level session ids) ───────────

test("AC78 判据2(c) — --agent-id resolving to a TOP-LEVEL session id ⇒ exit 2, NO lock events written", () => {
  const dir = makeTmp("ac78");
  const st = stateDir("ac78");
  let home = null;
  try {
    initRepo(dir);
    // The script derives the Claude project dir from $HOME + the repo-root slug.
    home = fs.mkdtempSync(path.join(os.tmpdir(), "faninffhome-"));
    const slug = dir.split(path.sep).join("-"); // /tmp/... → -tmp-...-...
    const proj = path.join(home, ".claude", "projects", slug);
    fs.mkdirSync(proj, { recursive: true });
    // AC72's real top-level session id (the old main-thread-executor form).
    const sessId = "902b4528-bc95-4ec6-9e10-5c2a0c47c4bb";
    fs.writeFileSync(path.join(proj, `${sessId}.jsonl`), "{}");
    const events = path.join(st, "events.jsonl");
    const suite = writeSuiteState(st, { state: "green" });

    const r = spawnSync("bash", [MERGE_SCRIPT, "--task", "ac62-ac78", "--root", dir, "--suite-state", suite, "--lock-events", events, "--agent-id", sessId], { encoding: "utf8", env: { ...process.env, HOME: home } });
    assert.equal(r.status, 2, `top-level session id must be rejected: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /TOP-LEVEL session id/, "the rejection names the top-level-session cause");
    assert.ok(!fs.existsSync(events), "NO lock events written for a rejected agent-id");
  } finally {
    if (home) cleanup(home);
    cleanup(dir);
    cleanup(st);
  }
});

test("AC78 判据2(c) — --agent-id resolving to a REAL subagent (subagents/agent-<id>.jsonl) is NOT rejected", () => {
  const dir = makeTmp("ac78b");
  const st = stateDir("ac78b");
  let home = null;
  try {
    initRepo(dir);
    home = fs.mkdtempSync(path.join(os.tmpdir(), "faninffhomeb-"));
    const slug = dir.split(path.sep).join("-");
    const proj = path.join(home, ".claude", "projects", slug);
    // AC67's real subagent id lives under a session dir's subagents/.
    fs.mkdirSync(path.join(proj, "some-session", "subagents"), { recursive: true });
    const subId = "aab2d14d10a762ff4";
    fs.writeFileSync(path.join(proj, "some-session", "subagents", `agent-${subId}.jsonl`), "{}");
    const events = path.join(st, "events.jsonl");
    const suite = writeSuiteState(st, { state: "green" });

    const r = spawnSync("bash", [MERGE_SCRIPT, "--task", "ac62-ac78b", "--root", dir, "--suite-state", suite, "--lock-events", events, "--agent-id", subId], { encoding: "utf8", env: { ...process.env, HOME: home } });
    // NOT rejected by the agent-id gate — it proceeds and fails only on the missing task branch.
    assert.doesNotMatch(r.stderr, /TOP-LEVEL session id/, "a real subagent id must pass the agent-id gate");
    assert.equal(r.status, 2, "still exit 2 for the missing task branch (no ff attempted)");
    assert.ok(!fs.existsSync(events), "no lock events (the task-branch gate fired before any ff)");
  } finally {
    if (home) cleanup(home);
    cleanup(dir);
    cleanup(st);
  }
});

test("lock is a SEPARATE file from the suite lock (AC4 — 对象不相干)", () => {
  const dir = makeTmp("locksep");
  const st = stateDir("locksep");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-g");
    const commonDir = gitCmd(dir, "rev-parse", "--git-common-dir").stdout.trim();
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const capArgs = captureArgs(st, "ac62-g", tip);
    const r = runMerge(["--task", "ac62-g", "--root", dir, "--suite-state", suite, ...capArgs]);
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
