// @test-group engine
// fan-in-ff-merge.test.mjs — AC62 持锁段: the merge lock that wraps ONLY the ff. DUAL-MODE
// (gap-fan-in-ff-ref-update-detach-develop):
//   merge mode (develop still checked out) → `git merge --ff-only` (clean tree required).
//   push mode  (develop detached)          → `git push .` (a pure ref update, no clean tree needed).
// (plugin/scripts/fan-in-ff-merge.sh, tasks/gap-ac62-fan-in-ff-merge-lock-protocol).
//
// The fan-in protocol (SPEC-fan-in-ff-merge-lock-2026-08-14) splits the landing into a 无锁段
// (merge develop + full suite + doc check, in the task worktree — NOT this script) and a 持锁段
// (THIS script: acquire merge lock → ff → release, success or failure). This test covers the 持锁段
// mechanics in BOTH modes:
//   * ff success — develop fast-forwards to the task tip, lock-hold events written, NO retry record
//   * ff failure (develop advanced — the ONLY ff failure reason) — exit 1, retry record written
//     (task id / attempt 第几次 / develop head / timestamp), lock events still paired, ref unchanged
//   * attempt increments across repeated failures (the anti-livelock data, §7)
//   * fail-closed guards (suite running / missing task branch / merge-mode dirty tree) exit 2
//     and write NO retry record (they are environment errors, not ff failures)
//   * push mode — a dirty tree does NOT block (the ref update never touches the working tree, AC1)
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
// P2 (gap-execution-loop-productization-p2-p4): the 持锁段 is a TS module now — fan-in-ff-merge.sh
// is retired; drive packages/quay/src/fan-in/ff-merge.ts directly.
const MERGE_SCRIPT = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");
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

/** Init a temp git repo on branch `develop`; `.quay/` is gitignored (the runtime-state family). */
function initRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "faninff-test");
  gitCmd(dir, "config", "user.email", "fif@example.com");
  gitCmd(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "chore: gitignore");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
}

/** Create `task/<id>` with one commit on top of develop, then return to develop. Returns the task tip. */
function makeTaskBranch(dir, taskId) {
  gitCmd(dir, "checkout", "-q", "-b", `task/${taskId}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "task work");
  const tip = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  gitCmd(dir, "checkout", "-q", "develop");
  return tip;
}

// gap-fan-in-ff-ref-update-detach-develop DUAL-MODE: the ff degenerates to a PURE REF UPDATE (git push .)
// only AFTER develop is detached from the main checkout. Leave the checkout on a doc-only work branch to
// exercise the push mode (the merge mode — develop still checked out — is the default of makeTaskBranch).
function detachMergeTarget(dir) {
  gitCmd(dir, "checkout", "-q", "-b", "work/docs");
}

/** Task-file body (frontmatter + a ## Proposal section) — the promotion-driver status-flip target. */
function taskFileBody(taskId, status) {
  return `---\nid: ${taskId}\ntitle: test ${taskId}\nstatus: ${status}\nlabels:\n  - gap\n---\n\n## Proposal\n\nproposal body for ${taskId}\n`;
}

/** Commit `tasks/<id>.md` (status=<status>) on the current branch. Returns the path relative to dir. */
function writeTaskFile(dir, taskId, status) {
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), taskFileBody(taskId, status), "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", `add ${taskId}`);
  return path.join("tasks", `${taskId}.md`);
}

/** Flip ONLY the frontmatter `status:` field of `tasks/<id>.md` in the working tree (no commit). */
function flipStatusOnDisk(dir, taskId, to) {
  const p = path.join(dir, "tasks", `${taskId}.md`);
  const body = fs.readFileSync(p, "utf8");
  const flipped = body.replace(/^status: .*$/m, `status: ${to}`);
  fs.writeFileSync(p, flipped, "utf8");
}

function runMerge(args, opts = {}) {
  // P2: the ff ENTRY requires the driver-injected token (L1 token gate) — inject one by default so the
  // pre-existing behavior tests exercise the ff, not the token gate. token: false ⇒ omit it (token gate).
  const argv = opts.token === false ? args : [...args, "--token", "test-token"];
  return spawnSync("node", ["--experimental-strip-types", MERGE_SCRIPT, ...argv], { encoding: "utf8" });
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

test("ff success — develop fast-forwards to the task tip; lock events paired; NO retry record", () => {
  const dir = makeTmp("ok");
  const st = stateDir("ok");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-a");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "fan-in-merge-lock-events.jsonl");
    const retries = path.join(st, "fan-in-retries.jsonl");
    const before = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    // AC1 (gap-suite-concurrency-ff-gate-and-slot-ssot): the ff gate reads THIS task's suite capture —
    // suite_exit=0 ∧ suite_head == the task tip being ff'd.
    const capArgs = captureArgs(st, "ac62-a", tip);

    const r = runMerge(["--task", "ac62-a", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `ff should succeed: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /measure ff_only_locked=true/);
    // develop fast-forwarded to the task tip (no merge commit — HEAD is the task tip, single parent).
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip, "develop must be at the task tip");
    assert.notEqual(gitCmd(dir, "rev-parse", "develop").stdout.trim(), before, "develop advanced");
    assert.equal(gitCmd(dir, "rev-list", "--parents", "-n", "1", "develop").stdout.trim().split(" ").length, 2,
      "ff creates NO merge commit (single parent)");
    // Lock events: acquire + release. The release event carries `landedSha` — the persistent fan-in
    // landing ledger (gap-direct-to-develop-check-reflog-to-revlist AC1), same file same append.
    const lines = fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "exactly acquire+release (the ledger is a field on release, ⛔ no new event)");
    const [acq, rel] = lines.map(JSON.parse);
    assert.equal(acq.event, "acquire");
    assert.equal(rel.event, "release");
    assert.equal(acq.taskId, "ac62-a");
    // The hold is released immediately (release ≥ acquire, and the window is milliseconds).
    assert.ok(rel.epoch >= acq.epoch, "release must not precede acquire");
    assert.equal(rel.landedSha, tip, "AC1: release carries the landed commit sha (the task tip)");
    // No retry record written on success.
    assert.ok(!fs.existsSync(retries), "no retry record on success");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── escalation resolution (gap-fan-in-ff-livelock-quiet-window-no-consumer 的兑现半边) ─────────────
// On ff SUCCESS the script appends an `ff-escalation-resolved` record to the escalation file — the
// escalation-resolution signal (kept after the quiet-window request was retired by
// gap-quiet-window-holder-scope-wider-than-consumer). slot-refill's ff-starvation relief reads it to
// clear the task's unresolved-escalation state. Same file, same append.

test("ff success writes an ff-escalation-resolved record to the escalation file", () => {
  const dir = makeTmp("resolved");
  const st = stateDir("resolved");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-res");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "ac62-res", tip);

    const r = runMerge(["--task", "ac62-res", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc, "--run-id", "wk-prod-1786700000", "--agent-id", "sub-uuid"]);
    assert.equal(r.status, 0, `ff should succeed: ${r.stdout}${r.stderr}`);

    // The resolution record is appended (the escalation-resolution signal for ff-starvation relief).
    const resLine = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(resLine.event, "ff-escalation-resolved");
    assert.equal(resLine.taskId, "ac62-res");
    assert.equal(resLine.runId, "wk-prod-1786700000", "resolution carries the caller runId");
    assert.equal(resLine.agentId, "sub-uuid", "resolution carries the caller agentId");
    assert.equal(resLine.mergeTarget, "develop", "resolution names the merge target");
    assert.match(resLine.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ts must be ISO …Z");
    assert.equal(typeof resLine.epoch, "number", "epoch is a numeric timestamp");
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
    const head = gitCmd(dir, "rev-parse", "develop").stdout.trim();
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    // The task's suite was green on ITS tip (the commit being ff'd) — the ff fails ONLY because
    // develop advanced afterward (not because the suite gate refused).
    const capArgs = captureArgs(st, "ac62-b", tip);

    const r = runMerge(["--task", "ac62-b", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 1, `ff must fail: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /FF FAILED/);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), head, "ref unchanged on ff failure");
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
    const r = runMerge(["--task", "ac67-ag", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--agent-id", "subagent-uuid-abc", "--run-id", "wk-prod-1786700001"]);
    assert.equal(r.status, 1, `ff must fail: ${r.stdout}${r.stderr}`);
    const rec = JSON.parse(fs.readFileSync(retries, "utf8").trim());
    assert.equal(rec.agentId, "subagent-uuid-abc", "retry record carries the caller agent id");
    assert.equal(rec.runId, "wk-prod-1786700001", "runId stays a single well-formed string");
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
// DISTINCT escalation record, and STOPS automatic retry.

test("anti-livelock — attempt 1 and 2 are plain retries (exit 1, NO escalation); attempt 3 escalates (exit 3 + escalation record + stop-retry)", () => {
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
    assert.equal(esRec.action, "stop-retry", "the escalation stops automatic retry (no quiet-window request)");
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
    // The 4 REAL ac63 retry records — captured verbatim from .quay/fan-in-retries.jsonl (D2 不构造),
    // runId normalized to the wk-prod-<epoch> production form (developHead/ts/epoch stay verbatim).
    const realSamples = [
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 1, developHead: "bd4612e5bc74f8db1a6a5b5cb240f2c587d1a304", ts: "2026-08-14T11:55:47Z", epoch: 1786708547, runId: "wk-prod-1786707748", agentId: "aac7ae30a0aa05591", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 2, developHead: "17d0492ad1f3018f56efc77f9cbd20044357a504", ts: "2026-08-14T12:39:39Z", epoch: 1786711179, runId: "wk-prod-1786707748", agentId: "a719b89d2086a4e27", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 3, developHead: "04659638f3a7e7cc6cc932dca846a87967db13da", ts: "2026-08-14T12:42:50Z", epoch: 1786711370, runId: "wk-prod-1786707748", agentId: "a719b89d2086a4e27", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac63-judgment2-no-carrier", attempt: 4, developHead: "81f72af4907861c6efa3ebf5605c21c4eb7d29d2", ts: "2026-08-14T13:58:15Z", epoch: 1786715895, runId: "wk-prod-1786707748", agentId: "a285a0091e9605468", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
    ];
    fs.writeFileSync(retries, realSamples.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const esc = path.join(st, "escalations.jsonl");

    // The attempt count keys on attemptKey ?? runId — no --attempt-key passed here, so the runId fallback
    // sees the 4 real records (a different/absent runId would read 0 prior failures).
    const r = runMerge(["--task", "gap-ac63-judgment2-no-carrier", "--root", dir, "--suite-state", suite, ...capArgs, "--retry-record", retries, "--escalations", esc, "--run-id", "wk-prod-1786707748"]);
    assert.equal(r.status, 3, "replaying the 4 real ac63 retry records + one more ff failure (attempt 5) must trigger the anti-livelock action (判据2: 现状只升级无动作 ⇒ 红; 触发后动作机械定义)");
    assert.match(r.stderr, /ANTI-LIVELOCK/);
    const esRec = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(esRec.taskId, "gap-ac63-judgment2-no-carrier");
    assert.equal(esRec.attempt, 5, "the escalation records attempt 5 (4 prior real failures + 1)");
    assert.equal(esRec.action, "stop-retry");
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
    // The 2 REAL ac80 retry records — captured verbatim from .quay/fan-in-retries.jsonl,
    // runId normalized to the wk-prod-<epoch> production form (developHead/ts/epoch stay verbatim).
    const realSamples = [
      { taskId: "gap-ac80-prompt-canonical-and-invariant-checker", attempt: 1, developHead: "c5d9e7635c43b368fac41b681522c88b7f28caaf", ts: "2026-08-14T17:08:27Z", epoch: 1786727307, runId: "wk-prod-1786720803", agentId: "a6a49c9fd9ee3ecfe", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
      { taskId: "gap-ac80-prompt-canonical-and-invariant-checker", attempt: 2, developHead: "bf23bd1da5b16f822365a56965c11d78a9cdcbda", ts: "2026-08-14T17:10:25Z", epoch: 1786727425, runId: "wk-prod-1786720803", agentId: "a6a49c9fd9ee3ecfe", mergeTarget: "develop", error: "hint: Diverging branches can't be fast-forwarded, you need to either:" },
    ];
    fs.writeFileSync(retries, realSamples.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const esc = path.join(st, "escalations.jsonl");

    // AC80 had 2 ff failures and develop kept advancing (4 advances during the workflow) — the gap
    // was that nothing would trigger if it hit the 3rd. Replay the 2 real records + one more failure:
    // the 3rd failure MUST trigger the anti-livelock action (the gap is now closed).
    // The attempt count keys on attemptKey ?? runId — no --attempt-key passed here, so the runId fallback
    // sees the 2 real records (a different/absent runId would read 0 prior failures).
    const r = runMerge(["--task", "gap-ac80-prompt-canonical-and-invariant-checker", "--root", dir, "--suite-state", suite, ...capArgs, "--retry-record", retries, "--escalations", esc, "--run-id", "wk-prod-1786720803"]);
    assert.equal(r.status, 3, "the 3rd ff failure (2 real prior failures + 1) escalates — the AC80 gap is closed");
    const esRec = JSON.parse(fs.readFileSync(esc, "utf8").trim());
    assert.equal(esRec.attempt, 3, "escalation records attempt 3 (2 prior + 1)");
    assert.equal(esRec.action, "stop-retry");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── gap-fan-in-ff-retry-counter-scope (AC1/AC2): attempt count is PER-DISPATCH (per-runId fallback) ────
// The retry record is append-only and accumulates across ALL dispatches. The count key is now the
// per-dispatch attemptKey (gap-ff-retry-counter-runid-no-longer-per-dispatch) with a runId fallback —
// this test exercises the FALLBACK: a DISTINCT runId (e.g. a new driver process after a restart) still
// starts its own 3-attempt budget and does NOT inherit a prior process's failures. (The SAME-runId +
// new-attemptKey reset — the production shape — is covered by the dk test below.) AC1 = a fresh
// dispatch's first failure is attempt 1 (no escalation); AC2 = the fresh dispatch runs its OWN full
// 3-attempt budget.

test("gap-fan-in-ff-retry-counter-scope — a fresh dispatch (new runId) does NOT inherit historical failures: attempts restart at 1 and run the full 3-attempt budget", () => {
  const dir = makeTmp("scope");
  const st = stateDir("scope");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "scope-t");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "scope-t", tip);

    // Seed 2 failures under an OLD driver-process runId (no attemptKey — the runId fallback key).
    const oldRunId = "wk-prod-1111111111111";
    fs.writeFileSync(retries, [
      JSON.stringify({ taskId: "scope-t", attempt: 1, developHead: "0".repeat(40), ts: "2026-08-14T10:00:00Z", epoch: 1786700000, runId: oldRunId, agentId: "a1", mergeTarget: "develop", error: "adv" }),
      JSON.stringify({ taskId: "scope-t", attempt: 2, developHead: "1".repeat(40), ts: "2026-08-14T10:01:00Z", epoch: 1786700060, runId: oldRunId, agentId: "a2", mergeTarget: "develop", error: "adv" }),
    ].join("\n") + "\n");

    // The fresh dispatch carries a NEW driver-process runId (e.g. after a restart) — distinct key ⇒ reset.
    const newRunId = "wk-prod-2222222222222";
    const args = ["--task", "scope-t", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc, "--run-id", newRunId];

    // AC1: the fresh dispatch's FIRST failure is attempt 1 (a plain retry), NOT the inherited attempt 3.
    const r1 = runMerge(args);
    assert.equal(r1.status, 1, "fresh dispatch first failure is attempt 1 (plain retry), not inherited attempt 3");
    assert.ok(!fs.existsSync(esc), "NO escalation on the fresh dispatch's first failure (AC1)");

    // AC2: the fresh dispatch runs its OWN full 3-attempt budget (1-2 retry, 3 escalates).
    assert.equal(runMerge(args).status, 1, "fresh dispatch second failure is attempt 2 (plain retry)");
    const r3 = runMerge(args);
    assert.equal(r3.status, 3, "fresh dispatch third failure escalates — its OWN budget, not the old dispatch's");
    assert.match(r3.stderr, /ANTI-LIVELOCK/);

    // The record now holds 2 historical + 3 fresh lines; the fresh attempts restart at 1 (not 3,4,5).
    const lines = fs.readFileSync(retries, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 5, "2 historical + 3 fresh records");
    const fresh = lines.slice(2).map(JSON.parse);
    assert.deepEqual(fresh.map((r) => r.attempt), [1, 2, 3], "fresh dispatch attempts restart from 1");
    assert.ok(fresh.every((r) => r.runId === newRunId), "fresh records carry the new runId");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── gap-ff-retry-counter-runid-no-longer-per-dispatch (AC1/AC2/AC4) ────────────────────────────────────
// runId's semantics drifted from "one per dispatch" to "one per driver process" (wk-prod-<epoch>), so the
// per-runId counter (gap-fan-in-ff-retry-counter-scope — correct when runId WAS per-dispatch) now latches
// a task's retry budget across independent dispatches. The fix keys the counter on a per-dispatch identity
// (attemptKey — the mechanical fan-in's per-suite runId mfi-<task>-<epoch>-<rand>) and carries it in the
// retry record. AC1 = same runId + NEW attemptKey ⇒ attempts restart at 1; AC2 = the fresh dispatch runs
// its OWN full 3-attempt budget, and reverting to runId keying (no attempt-key) re-latches the first try;
// AC4 = the retry record carries the new count key.

test("gap-ff-retry-counter-runid-no-longer-per-dispatch — same runId + NEW attemptKey restarts at 1 (AC1/AC2); keying on runId re-latches (AC2 negative); record carries attemptKey (AC4)", () => {
  const dir = makeTmp("dk");
  const st = stateDir("dk");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "dk-t");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "dk-t", tip);

    // The driver-process runId (constant across dispatches — the post-drift shape), with 2 historical
    // failures from a PREVIOUS dispatch (which carried its own per-dispatch attemptKey).
    const processRunId = "wk-prod-1788717081";
    const oldAttemptKey = "mfi-dk-t-1111111111111-old";
    fs.writeFileSync(retries, [
      JSON.stringify({ taskId: "dk-t", attempt: 1, developHead: "0".repeat(40), ts: "2026-08-14T10:00:00Z", epoch: 1786700000, runId: processRunId, attemptKey: oldAttemptKey, agentId: "a1", mergeTarget: "develop", error: "adv" }),
      JSON.stringify({ taskId: "dk-t", attempt: 2, developHead: "1".repeat(40), ts: "2026-08-14T10:01:00Z", epoch: 1786700060, runId: processRunId, attemptKey: oldAttemptKey, agentId: "a2", mergeTarget: "develop", error: "adv" }),
    ].join("\n") + "\n");

    // AC1: a fresh dispatch — SAME runId (the driver process), NEW attemptKey (per-dispatch).
    const newAttemptKey = "mfi-dk-t-2222222222222-new";
    const args = ["--task", "dk-t", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc, "--run-id", processRunId, "--attempt-key", newAttemptKey];

    const r1 = runMerge(args);
    assert.equal(r1.status, 1, "fresh dispatch (same runId, new attemptKey) first failure is attempt 1 (plain retry), not the inherited attempt 3");
    assert.ok(!fs.existsSync(esc), "NO escalation on the fresh dispatch's first failure (AC1)");

    // AC4: the retry record carries the NEW count key (the per-dispatch identity).
    const rec = JSON.parse(fs.readFileSync(retries, "utf8").trim().split("\n").filter(Boolean).pop());
    assert.equal(rec.attempt, 1, "fresh dispatch first record is attempt 1");
    assert.equal(rec.attemptKey, newAttemptKey, "AC4: the retry record carries the new count key");
    assert.equal(rec.runId, processRunId, "runId stays the driver-process id (not overwritten by the count key)");

    // AC2: the fresh dispatch runs its OWN full 3-attempt budget.
    assert.equal(runMerge(args).status, 1, "second failure is attempt 2 (plain retry)");
    const r3 = runMerge(args);
    assert.equal(r3.status, 3, "third failure escalates — its OWN budget, not the old dispatch's");
    assert.match(r3.stderr, /ANTI-LIVELOCK/);

    // AC2 negative: revert the count key to runId (NO --attempt-key, records keyed on runId) — the same
    // 2 historical failures latch the FIRST try into escalation (the pre-fix bug).
    const retries2 = path.join(st, "retries2.jsonl");
    const esc2 = path.join(st, "escalations2.jsonl");
    fs.writeFileSync(retries2, [
      JSON.stringify({ taskId: "dk-t", attempt: 1, developHead: "0".repeat(40), ts: "2026-08-14T10:00:00Z", epoch: 1786700000, runId: processRunId, agentId: "a1", mergeTarget: "develop", error: "adv" }),
      JSON.stringify({ taskId: "dk-t", attempt: 2, developHead: "1".repeat(40), ts: "2026-08-14T10:01:00Z", epoch: 1786700060, runId: processRunId, agentId: "a2", mergeTarget: "develop", error: "adv" }),
    ].join("\n") + "\n");
    const rNeg = runMerge(["--task", "dk-t", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries2, "--escalations", esc2, "--run-id", processRunId]);
    assert.equal(rNeg.status, 3, "keyed back on runId (no attempt-key), the 2 historical failures latch the FIRST try into escalation (the pre-fix bug)");
    assert.match(rNeg.stderr, /ANTI-LIVELOCK/);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("gap-ff-retry-counter-runid-no-longer-per-dispatch AC3 — the SAME dispatch (same attemptKey) still escalates on its 3rd ff failure (anti-livelock preserved)", () => {
  const dir = makeTmp("dk3");
  const st = stateDir("dk3");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "dk3-t");
    fs.writeFileSync(path.join(dir, "adv.txt"), "adv\n", "utf8");
    gitCmd(dir, "add", "-A");
    gitCmd(dir, "commit", "-q", "-m", "adv");
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "dk3-t", tip);
    const args = ["--task", "dk3-t", "--root", dir, "--suite-state", suite, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc, "--run-id", "wk-prod-1788717081", "--attempt-key", "mfi-dk3-t-3333333333333"];

    assert.equal(runMerge(args).status, 1, "attempt 1 plain retry");
    assert.equal(runMerge(args).status, 1, "attempt 2 plain retry");
    const r3 = runMerge(args);
    assert.equal(r3.status, 3, "attempt 3 escalates within the SAME dispatch (same attemptKey)");
    assert.match(r3.stderr, /ANTI-LIVELOCK/);
    const lines = fs.readFileSync(retries, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.deepEqual(lines.map((r) => r.attempt), [1, 2, 3], "attempts accumulate 1→2→3 within one dispatch");
    assert.ok(lines.every((r) => r.attemptKey === "mfi-dk3-t-3333333333333"), "all three records share the same attemptKey (one dispatch)");
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
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), gitCmd(dir, "rev-parse", "develop").stdout.trim(), "ref unchanged");
    assert.ok(!fs.existsSync(events), "no lock events");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── gap-write-suite-capture-non-blocking AC2 ──────────────────────────────────────────────────────────
// capture 缺失/不可读时，ff 闸回退读权威源 full-suite-state.json（mirrorMechanicalFanInSuiteState 写的
// state=green + commit=suite_head + taskId）。真实绿 suite 不得因观测 capture 写失败被误拒；⛔ 不伪造
// full-green——只认 taskId 匹配本任务的 state=green，full-run（无 taskId）/别的任务/red/stale 都拒。

test("AC2 (gap-write-suite-capture-non-blocking) — capture MISSING + authoritative source green (taskId match, commit=suite_head) ⇒ ff proceeds (NOT exit 2)", () => {
  const dir = makeTmp("capfallback");
  const st = stateDir("capfallback");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-fallback");
    // 权威源：full-suite-state.json 写 state=green + taskId + commit(=suite_head=tip)。⛔ 不传 capture。
    const suite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "worktree", runner: "inner", taskId: "ac62-fallback", commit: tip });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "ac62-fallback", "--root", dir, "--suite-state", suite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `missing capture + authoritative green must ff (⛔ not mis-reject):\n${r.stdout}${r.stderr}`);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip, "develop fast-forwarded to the task tip");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC2 negative (gap-write-suite-capture-non-blocking) — capture MISSING + authoritative source NOT this task's green (red / wrong taskId / full-run no taskId) ⇒ exit 2", () => {
  const dir = makeTmp("capfallbackneg");
  const st = stateDir("capfallbackneg");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-fbneg");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");

    // ① red state ⇒ 拒（suite 未绿）。
    const redSuite = writeSuiteState(st, { state: "red", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "worktree", runner: "inner", taskId: "ac62-fbneg", commit: tip, reason: "fail" });
    const r1 = runMerge(["--task", "ac62-fbneg", "--root", dir, "--suite-state", redSuite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r1.status, 2, "a red authoritative state must refuse (exit 2)");

    // ② wrong taskId ⇒ 拒（别的任务的 bucket green 不冒充本任务）。
    const wrongSuite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "worktree", runner: "inner", taskId: "some-other-task", commit: tip });
    const r2 = runMerge(["--task", "ac62-fbneg", "--root", dir, "--suite-state", wrongSuite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r2.status, 2, "a green state for a DIFFERENT taskId must refuse (exit 2)");

    // ③ no taskId（full-run 的 green，scope=main）⇒ 拒（⛔ 不伪造 full-green）。
    const fullRunSuite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "main" });
    const r3 = runMerge(["--task", "ac62-fbneg", "--root", dir, "--suite-state", fullRunSuite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r3.status, 2, "a full-run green (no taskId) must refuse (exit 2)");

    assert.ok(!fs.existsSync(events), "no lock events on any of the three refused paths");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC2 negative (gap-write-suite-capture-non-blocking) — capture MISSING + authoritative commit NOT an ancestor (stale suite head) ⇒ exit 2", () => {
  const dir = makeTmp("capfallbackstale");
  const st = stateDir("capfallbackstale");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-fbstale");
    // commit 是 40-hex 但非任务 tip 祖先（陈旧的 suite head）⇒ 回退拿到 suite_head 后仍被祖先检查拒。
    const staleSuite = writeSuiteState(st, { state: "green", startedAt: "2026-08-14T00:00:00Z", finishedAt: 1786660000, scope: "worktree", runner: "inner", taskId: "ac62-fbstale", commit: "0".repeat(40) });
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "ac62-fbstale", "--root", dir, "--suite-state", staleSuite, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 2, "a stale authoritative commit (not an ancestor of the tip) must refuse (exit 2)");
    assert.ok(!fs.existsSync(events), "no lock events");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("stale suite-lock reclaim restored — blocked path (missing certificate) runs the reaper and REAPS a REAL stale holder (gap-wiring-D-worktree-remove-orphans-reclaim-restore)", () => {
  // gap-wiring-D-worktree-remove-orphans-reclaim-restore (硬规则 5b): 9645a4ff silently replaced the
  // reaper's stale-lock reclaim (989ec472's gap-worktree-remove-orphans-probes wiring) with the narrow
  // per-task certificate gate and dropped the reaper call entirely. The certificate gate is CORRECT
  // (it fixed the 2026-08-18 mutual-refuse livelock) — the reaper is a SEPARATE concern and must be
  // restored. This test is the PRODUCTION-CARRIER (AC2): a REAL stale holder (a process whose cwd
  // points at a DELETED dir, holding a suite single-flight lock slot open — the detached-hung-suite
  // orphan shape) is constructed for real (not a fixture/mock), the certificate is missing (the
  // BLOCKED path), and the ff must (a) refuse exit 2 AND (b) have run the reaper — proven by the
  // stale holder's flock being auto-released (the reaper killed it). The normal fast path (green
  // certificate) is untouched — the reaper only runs on the blocked path.
  const dir = makeTmp("reclaimrestore");
  const st = stateDir("reclaimrestore");
  try {
    initRepo(dir);
    makeTaskBranch(dir, "ac62-reclaim");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const slot0 = path.join(dir, ".git", SUITE_LOCK_0);
    fs.mkdirSync(path.dirname(slot0), { recursive: true });
    fs.writeFileSync(slot0, "", "utf8");
    // A REAL stale holder: a background subshell whose cwd is a dir we then DELETE, holding slot .0
    // open via flock (the detached hung suite shape). After `rm -rf`, its cwd becomes
    // "<holderDir> (deleted)" — the ORPHAN signature the reaper's --orphans --stale-lock-holders-only
    // matches (cwdDeleted + holds the lock file open). flock auto-releases when the process dies.
    const holderDir = path.join(dir, "holder-wt");
    fs.mkdirSync(holderDir, { recursive: true });
    const lockMark = path.join(st, "lock-state.txt");
    // NO --suite-capture: the certificate gate FAILS ⇒ the blocked path runs the reaper before the
    // exit-2 refusal. Assert exit 2 AND that the stale holder's lock was released (the reaper ran on a
    // REAL stale lock — the production-carrier).
    const mergeArgs = ["--task", "ac62-reclaim", "--root", dir, "--lock-events", events, "--retry-record", retries];
    const inner =
      `(cd "${holderDir}" && exec 9>"${slot0}" && flock -n 9 && sleep 30) & holder=$!; ` +
      `sleep 0.3; rm -rf "${holderDir}"; ` +
      `node --experimental-strip-types ${MERGE_SCRIPT} ${mergeArgs.map((a) => JSON.stringify(a)).join(" ")} --token test-token; rc=$?; ` +
      `if (flock -n 9 2>/dev/null) 9>"${slot0}"; then echo REAPED > "${lockMark}"; else echo STILL_HELD > "${lockMark}"; fi; ` +
      `kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; exit $rc`;
    const r = spawnSync("bash", ["-c", inner], { encoding: "utf8" });
    assert.equal(r.status, 2, `missing certificate must refuse (exit 2):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /suite 证书未满足/, "the refusal names the missing suite certificate");
    assert.ok(!fs.existsSync(events), "no lock events — the lock was never acquired");
    assert.ok(!fs.existsSync(retries), "no retry record — environment guard, not an ff failure");
    // PRODUCTION-CARRIER (AC2): the stale holder must have been reaped on the blocked path — its flock
    // is auto-released only when the holding process dies (the reaper's kill). A free lock proves the
    // reaper ran in a REAL stale-lock scenario (not a fixture/mock).
    assert.equal(fs.readFileSync(lockMark, "utf8").trim(), "REAPED", "the stale suite-lock holder must be reaped by the reaper on the blocked path (real stale-lock scenario)");
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
      `node --experimental-strip-types ${MERGE_SCRIPT} ${["--task", "ac5-a", "--root", dir, ...capArgsA, "--lock-events", events, "--retry-record", retries].map((a) => JSON.stringify(a)).join(" ")} --token test-token; rc=$?; ` +
      `flock -u 8 2>/dev/null; flock -u 9 2>/dev/null; exec 8>&- 2>/dev/null; exec 9>&- 2>/dev/null; exit $rc`;
    const r = spawnSync("bash", ["-c", inner], { encoding: "utf8" });
    // Two suites are "running" (BOTH slots held) yet A's ff MUST land — no mutual REFUSE.
    assert.equal(r.status, 0, `ff must proceed despite BOTH held global slots (contradiction B fixed):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /OK — develop fast-forwarded/, `task A's ff must land:\n${r.stdout}`);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tipA, "develop fast-forwarded to task A's tip (B untouched)");
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
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), gitCmd(dir, "rev-parse", "develop").stdout.trim());
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

// ── auto-converge (gap-fan-in-clean-tree-auto-converge-promotion-status) ────────────────────────────
// A status-only dirty tree (promotion-driver's todo→ready flip, written to tasks/<id>.md without
// committing) is auto-converged BEFORE the clean-tree refusal: porcelain all tasks/*.md ∧ per-file
// `git diff HEAD` hits ONLY the frontmatter `status:` line ⇒ the script stage+commits those files
// (--no-verify, pathspec-limited) and continues to the ff. Non-status dirty (a body edit, a non-status
// frontmatter field, a non-tasks path) still refuses exit 2 — the protection is NOT widened (AC2).

test("AC1 — status-only dirty (promotion-driver flip) auto-converges and the ff completes (NOT exit 2)", () => {
  const dir = makeTmp("conv");
  const st = stateDir("conv");
  const wt = makeTmp("convwt");
  try {
    initRepo(dir);
    writeTaskFile(dir, "promoted-a", "todo");          // C0: tasks/promoted-a.md status todo
    const tip = makeTaskBranch(dir, "fanin-x");          // task/fanin-x = C0 + work
    gitCmd(dir, "worktree", "add", "-q", wt, "task/fanin-x"); // worktree for the inert-retry path
    flipStatusOnDisk(dir, "promoted-a", "ready");        // dirty: ` M tasks/promoted-a.md` (status-only)
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "fanin-x", tip);

    const r = runMerge(["--task", "fanin-x", "--root", dir, "--worktree", wt, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `status-only dirty must auto-converge and complete the ff:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /not clean/, "the converge must remove the dirty-tree refusal, not report it");
    assert.match(r.stderr, /converged a status-only dirty tree/, "the converge is attributed and observable");
    // develop fast-forwarded to the (post-merge) task tip — the converge advanced develop, the inert-retry
    // re-merged develop into the task branch, and the re-ff completed (full "继续完成 ff").
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), gitCmd(dir, "rev-parse", "refs/heads/task/fanin-x").stdout.trim(), "develop fast-forwarded to the task tip");
    // The converge commit is on develop, attributed, and pathspec-limited to the ONE flipped task file
    // (⛔ never a bare commit sweeping the shared index).
    const convHash = gitCmd(dir, "log", "--format=%H", "--grep=promotion-driver 翻转").stdout.trim().split("\n")[0];
    assert.ok(convHash, "the converge commit landed with the canonical message");
    const convFiles = gitCmd(dir, "show", "--name-only", "--format=", convHash).stdout.trim().split("\n").filter(Boolean);
    assert.deepEqual(convFiles, ["tasks/promoted-a.md"], "the converge commit touches ONLY the status-flipped task file");
    assert.ok(!fs.existsSync(retries), "no retry record — the ff completed, not a retry");
  } finally {
    cleanup(dir);
    cleanup(st);
    cleanup(wt);
  }
});

test("AC2 — a non-status change inside tasks/*.md (body edit) still refuses exit 2, no converge", () => {
  const dir = makeTmp("convneg");
  const st = stateDir("convneg");
  try {
    initRepo(dir);
    writeTaskFile(dir, "promoted-a", "todo");
    makeTaskBranch(dir, "fanin-x");
    // A body edit (non-status-field change) to tasks/promoted-a.md — the converge criterion is
    // content-level, so a body line change is NOT "只命中 status: 字段" and must still be blocked.
    const p = path.join(dir, "tasks", "promoted-a.md");
    fs.appendFileSync(p, "extra body line\n", "utf8");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "fanin-x", "--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 2, `a non-status dirty tree must still refuse exit 2:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /not clean/, "the dirty-tree refusal fires (not silently passed)");
    assert.ok(!fs.existsSync(retries), "no retry record — an environment guard, not an ff failure");
    // No converge commit was made (the content-level check rejected the body edit).
    const convHash = gitCmd(dir, "log", "--format=%H", "--grep=promotion-driver 翻转").stdout.trim();
    assert.equal(convHash, "", "NO converge commit for a non-status-only dirty tree");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

// ── benign runtime dirty (gap-fan-in-ff-merge-benign-runtime-dirty-no-fast-path) ───────────────────
// A SECOND benign dirty shape is auto-passed (仅放行不处置 — NOT committed, NOT gitignored): an
// UNTRACKED runtime file under .quay/ that is OUTSIDE this task's ## Touches (the gitignore-missed
// runtime-state family — serve-send message-receipts.jsonl). The ff proceeds; the file stays untracked.
// The negative controls still refuse: a task's own uncommitted code change (tracked ` M`) and a dirty
// file WITHIN the task's ## Touches (the Touches-intersection is judged by checkBenignRuntimeDirty).

/** Init a temp repo like initRepo but WITHOUT gitignoring .quay/ — the real repo tracks
 *  .quay/config.yml and gitignores only SPECIFIC runtime files, so an untracked runtime file under
 *  .quay/ shows as `?? .quay/<file>` (the live-ghost message-receipts.jsonl shape), not a dir-collapse. */
function initRepoTrackedQuay(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "faninff-test");
  gitCmd(dir, "config", "user.email", "fif@example.com");
  gitCmd(dir, "branch", "-M", "develop");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n", "utf8"); // ⛔ NOT .quay/
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), "provider: native\n", "utf8");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
}

/** Task-file body carrying an explicit `## Touches` section (the benign check's write-surface input). */
function taskFileBodyWithTouches(taskId, status, touches) {
  return `---\nid: ${taskId}\ntitle: test ${taskId}\nstatus: ${status}\nlabels:\n  - gap\n---\n\n## Proposal\n\nproposal body for ${taskId}\n\n## Touches\n${touches.map((t) => `- ${t}`).join("\n")}\n`;
}

/** Commit `tasks/<id>.md` (with `## Touches`) on the current branch. */
function writeTaskFileWithTouches(dir, taskId, status, touches) {
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), taskFileBodyWithTouches(taskId, status, touches), "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", `add ${taskId}`);
}

test("AC1 — an untracked .quay/ runtime file OUTSIDE the task's ## Touches is passed through and the ff completes (NOT exit 2)", () => {
  const dir = makeTmp("benign");
  const st = stateDir("benign");
  try {
    initRepoTrackedQuay(dir);
    writeTaskFileWithTouches(dir, "benign-t", "ready", ["plugin/scripts/fan-in-ff-merge.sh", "plugin/test/", "tasks/benign-t.md"]);
    const tip = makeTaskBranch(dir, "benign-t");
    // The live-ghost shape: an untracked runtime file under .quay/ that the task does NOT touch.
    fs.writeFileSync(path.join(dir, ".quay", "message-receipts.jsonl"), '{"msg":"x"}\n', "utf8");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "benign-t", tip);

    const r = runMerge(["--task", "benign-t", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `benign runtime dirty must be passed through and complete the ff:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /not clean/, "the pass-through must remove the dirty-tree refusal, not report it");
    assert.match(r.stderr, /passed through a benign runtime-dirty tree/, "the pass-through is attributed and observable");
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip, "develop fast-forwarded to the task tip");
    // 仅放行不处置: the runtime file is left untracked, NOT committed / gitignored / deleted.
    assert.match(gitCmd(dir, "status", "--porcelain").stdout, /\?\? \.quay\/message-receipts\.jsonl/, "the runtime file stays untracked");
    assert.ok(!fs.existsSync(retries), "no retry record — the ff completed, not a retry");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC2 — a task's own uncommitted code change (tracked ` M`) still refuses exit 2", () => {
  const dir = makeTmp("benignnegmod");
  const st = stateDir("benignnegmod");
  try {
    initRepoTrackedQuay(dir);
    writeTaskFileWithTouches(dir, "benign-t", "ready", ["plugin/scripts/fan-in-ff-merge.sh", "tasks/benign-t.md"]);
    makeTaskBranch(dir, "benign-t");
    // A TRACKED modification (the task's own uncommitted code edit) — not `??`, so not a runtime file.
    fs.appendFileSync(path.join(dir, "base.txt"), "edited\n", "utf8");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "benign-t", "--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 2, `a tracked modification must still refuse exit 2:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /not clean/, "the dirty-tree refusal fires (not silently passed)");
    assert.ok(!fs.existsSync(retries), "no retry record — an environment guard, not an ff failure");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC2 — a dirty file WITHIN the task's ## Touches (a .quay/ path it declares) still refuses exit 2", () => {
  const dir = makeTmp("benignnegtouch");
  const st = stateDir("benignnegtouch");
  try {
    initRepoTrackedQuay(dir);
    // The task DECLARES .quay/declared-runtime.jsonl in its ## Touches ⇒ an untracked file at that
    // path is the task's own (uncommitted) work, NOT a benign runtime artifact.
    writeTaskFileWithTouches(dir, "benign-t", "ready", [".quay/declared-runtime.jsonl", "tasks/benign-t.md"]);
    makeTaskBranch(dir, "benign-t");
    fs.writeFileSync(path.join(dir, ".quay", "declared-runtime.jsonl"), '{"declared":true}\n', "utf8");
    const retries = path.join(st, "retries.jsonl");
    const r = runMerge(["--task", "benign-t", "--root", dir, "--retry-record", retries]);
    assert.equal(r.status, 2, `a dirty file within the task's ## Touches must still refuse exit 2:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /not clean/, "the dirty-tree refusal fires (the Touches intersection is real dirt)");
    assert.ok(!fs.existsSync(retries), "no retry record — an environment guard, not an ff failure");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("AC3 — production replay: `.quay/message-receipts.jsonl` dirty no longer causes exited-not-landed; it passes pre-flight in one shot", () => {
  const dir = makeTmp("replay");
  const st = stateDir("replay");
  try {
    initRepoTrackedQuay(dir);
    writeTaskFileWithTouches(dir, "replay-t", "ready", ["plugin/scripts/fan-in-ff-merge.sh", "plugin/test/", "tasks/replay-t.md"]);
    const tip = makeTaskBranch(dir, "replay-t");
    // The EXACT live-ghost file name that dirtied the checkout and caused 4 exited-not-landed (105min).
    fs.writeFileSync(path.join(dir, ".quay", "message-receipts.jsonl"), '{"delivered":true}\n', "utf8");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const esc = path.join(st, "escalations.jsonl");
    const capArgs = captureArgs(st, "replay-t", tip);

    const r = runMerge(["--task", "replay-t", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries, "--escalations", esc, "--run-id", "wk-prod-1786000000", "--agent-id", "sub-uuid"]);
    assert.equal(r.status, 0, `the replay must land on the first try (millisecond pre-flight), not exit 2:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /OK — develop fast-forwarded/, "the ff landed");
    assert.ok(!fs.existsSync(retries), "no retry record");
    // The success path always appends an `ff-escalation-resolved` record (the escalation-resolution
    // signal) — but there must be NO `ff-escalation` (anti-livelock) record: it landed on the first try.
    const escLines = fs.existsSync(esc) ? fs.readFileSync(esc, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
    assert.ok(!escLines.some((e) => e.event === "ff-escalation"), "no anti-livelock escalation record — the ff landed on the first try");
    assert.match(gitCmd(dir, "status", "--porcelain").stdout, /\?\? \.quay\/message-receipts\.jsonl/, "the runtime file stays untracked");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("push mode (develop detached) — a dirty main checkout does NOT block the ff (pure ref update, AC1)", () => {
  const dir = makeTmp("pushdirty");
  const st = stateDir("pushdirty");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-push");
    detachMergeTarget(dir); // develop detached → push mode
    // A genuinely dirty tree — BOTH an untracked non-gitignored file AND a tracked modification. Under
    // merge mode (develop checked out) this is exit 2 "not clean"; under push mode the ref update never
    // touches the working tree, so it is structurally irrelevant.
    fs.writeFileSync(path.join(dir, "uncommitted.txt"), "dirty\n", "utf8"); // untracked, not gitignored
    fs.appendFileSync(path.join(dir, "base.txt"), "tracked-dirty\n", "utf8"); // tracked ` M`
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "ac62-push", tip);
    const r = runMerge(["--task", "ac62-push", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `push-mode dirty tree must NOT block the ff:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip, "develop fast-forwarded to the task tip despite the dirty tree");
    assert.ok(!fs.existsSync(retries), "no retry record — the ff landed, not a retry");
    // The dirty files are left untouched (the ref update moves the ref, not the working tree).
    assert.match(gitCmd(dir, "status", "--porcelain").stdout, /\?\? uncommitted\.txt/, "untracked file stays untracked");
    assert.match(gitCmd(dir, "status", "--porcelain").stdout, / M base\.txt/, "tracked modification stays modified");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("push mode (develop detached) — ff success with a clean tree lands via git push .", () => {
  const dir = makeTmp("pushok");
  const st = stateDir("pushok");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-pushok");
    detachMergeTarget(dir);
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "ac62-pushok", tip);
    const r = runMerge(["--task", "ac62-pushok", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries]);
    assert.equal(r.status, 0, `push-mode clean ff must land:\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip, "develop fast-forwarded to the task tip");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});

test("--help exits 0 with usage on stdout (gap-scripts-sprawl convention)", () => {
  const r = runMerge(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-ff-merge/);
});

// ── L1 token gate (gap-fan-in-ff-merge-token-gate-fail-closed, P2 AC1) ────────────────────────────
// The ff ENTRY requires a driver-injected token. A direct/untokenized ff is fail-closed with a
// DISTINGUISHABLE refusal (exit 2 + "missing fan-in token" — ⛔ never the retry exit 1, ⛔ never the
// bare env exit 2). ADR-034 abolished --acquire-workflow-lock; this gate is its mechanical successor.

test("L1 token gate — no token ⇒ exit 2, distinguishable refusal, NO lock events", () => {
  const dir = makeTmp("token");
  const st = stateDir("token");
  try {
    initRepo(dir);
    const tip = makeTaskBranch(dir, "ac62-tok");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const capArgs = captureArgs(st, "ac62-tok", tip);
    const r = runMerge(["--task", "ac62-tok", "--root", dir, ...capArgs, "--lock-events", events, "--retry-record", retries], { token: false });
    assert.equal(r.status, 2, `untokenized ff must fail-closed (exit 2): ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /missing fan-in token/, "the refusal is the distinguishable token-gate message");
    assert.doesNotMatch(r.stderr, /FF FAILED/, "⛔ not the retry exit-1 form");
    assert.ok(!fs.existsSync(events), "no lock events — the token gate fired before the lock");
    assert.ok(!fs.existsSync(retries), "no retry record");
  } finally {
    cleanup(dir);
    cleanup(st);
  }
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

    const r = spawnSync("node", ["--experimental-strip-types", MERGE_SCRIPT, "--task", "ac62-ac78", "--root", dir, "--suite-state", suite, "--lock-events", events, "--agent-id", sessId, "--token", "test-token"], { encoding: "utf8", env: { ...process.env, HOME: home } });
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

    const r = spawnSync("node", ["--experimental-strip-types", MERGE_SCRIPT, "--task", "ac62-ac78b", "--root", dir, "--suite-state", suite, "--lock-events", events, "--agent-id", subId, "--token", "test-token"], { encoding: "utf8", env: { ...process.env, HOME: home } });
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
    assert.equal(gitCmd(dir, "rev-parse", "develop").stdout.trim(), tip);
  } finally {
    cleanup(dir);
    cleanup(st);
  }
});
