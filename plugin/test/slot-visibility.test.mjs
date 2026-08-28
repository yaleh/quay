// @test-group engine
// slot-visibility.test.mjs — gap-telemetry-brackets-vs-subagents-no-slot-visibility.
// Telemetry in-flight brackets do NOT reflect real concurrency: the --task-start/--task-end pair
// was not being called in the dispatch path, so telemetry degraded to a historical archive, and the
// state self-check ① (in-flight ≤ cap) read raw brackets — a VACUOUS check (5 stale red-window
// brackets ≠ 1 real subagent). This file pins the mechanical fixes:
//   AC1  --report --json carries reconcile-aware `reconcilable` + `realInFlight` (raw brackets are
//        unchanged — existing tests keep their meaning; the NEW fields reflect real concurrency).
//   AC2  --slots --cap N is the machine-readable slot signal (real-in-flight / slots-remaining),
//        so the outer no longer depends on inner hand-written narrative markdown.
//   AC3  5 stale brackets + 1 real agent ⇒ realInFlight=1, slotsRemaining=2 (not "full", not "empty").
//   AC5  regression control: the above shape reads as slots-idle, not saturated.
//   AC8  over-90m is reconcile-aware: a task whose branch was MERGED (work landed, even after
//        `git branch -d`) does NOT fire a false over-90m; a genuine slow task with a live worktree
//        DOES.
//   AC9  --escalate-stale auto-archives a consumed-by-nobody block older than the threshold
//        (wait duration into telemetry + escalation log + block removed); a fresh block is untouched.
//
// Run:
//   scripts/test.sh plugin/test/slot-visibility.test.mjs
//   node --test plugin/test/slot-visibility.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const PLUGIN_SCRIPTS = path.join(REPO_ROOT, "plugin", "scripts");
const CLI = path.join(PLUGIN_SCRIPTS, "fast-mode-telemetry.ts");
const BLOCKED_CLI = path.join(PLUGIN_SCRIPTS, "inner-blocked-signal.ts");

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "slot-vis-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
    // Deterministic slot arithmetic: --slots scans the LIVE machine for non-task subagent processes
    // (gap-telemetry-underreport-nontask-subagents-not-counted-in-slots). Pin the count to 0 so the
    // exact slotsRemaining/realInFlight assertions never depend on a subagent running during the suite.
    env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: process.env.QUAY_TELEMETRY_SUBAGENTS ?? "0" },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runBlockedCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", BLOCKED_CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function gitCmd(tmpRoot, ...args) {
  const res = spawnSync("git", ["-C", tmpRoot, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importCli() {
  return import(CLI);
}

async function importBlocked() {
  return import(BLOCKED_CLI);
}

function seedGitWorkspace(tmp) {
  // A real git repo so the reconcile probes (worktree/branch/merge) can observe real structure.
  fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n", "utf8");
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
  gitCmd(tmp, "init", "-q");
  gitCmd(tmp, "config", "user.email", "test@example.com");
  gitCmd(tmp, "config", "user.name", "test");
  fs.writeFileSync(path.join(tmp, "tasks", "seed.md"), "---\nid: seed\n---\n", "utf8");
  assert.equal(gitCmd(tmp, "add", "-A").status, 0);
  assert.equal(gitCmd(tmp, "commit", "-m", "seed").status, 0);
}


test("AC1 — --report --json carries reconcile-aware reconcilable[] + realInFlight", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    // A start with no end in a NON-git tmp: no worktree/branch/process ⇒ reconcilable (would close).
    cli.writeEvent(cli.buildStartEvent({ taskId: "stale-1", runId: cli.generateRunId("stale-1") }), tmp);
    cli.writeEvent(cli.buildStartEvent({ taskId: "stale-2", runId: cli.generateRunId("stale-2") }), tmp);
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const obj = JSON.parse(rep.stdout);
    assert.equal(obj.inProgress.length, 2, "raw brackets unchanged (start without end)");
    assert.equal(Array.isArray(obj.reconcilable), true, "report must carry reconcilable[]");
    assert.equal(typeof obj.realInFlight, "number", "report must carry realInFlight");
    // No observable executor anywhere ⇒ every bracket would be reconciled ⇒ realInFlight 0.
    assert.equal(obj.reconcilable.length, 2, "both stale brackets are reconcilable (executor observably gone)");
    assert.equal(obj.realInFlight, 0, "real in-flight is 0 when every bracket's executor is gone");
  } finally {
    cleanup(tmp);
  }
});

test("AC2/AC3/AC5 — --slots: 5 stale brackets + 1 live worktree ⇒ real-in-flight 1, slots-remaining 2 (cap 3)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    seedGitWorkspace(tmp);
    // 5 stale brackets: taskIds with NO branch, NO worktree, NO process ⇒ executor observably gone.
    for (let i = 1; i <= 5; i++) {
      const id = `stale-${i}`;
      cli.writeEvent(cli.buildStartEvent({ taskId: id, runId: cli.generateRunId(id) }), tmp);
    }
    // 1 live bracket: branch checked out in an OPEN worktree ⇒ executor present ⇒ real in-flight.
    const live = "live-task";
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", `task/${live}`, path.join(tmp, "wt-live")).status, 0);
    cli.writeEvent(cli.buildStartEvent({ taskId: live, runId: cli.generateRunId(live) }), tmp);

    const slots = runCli(tmp, "--slots", "--cap", "3", "--json");
    assert.equal(slots.status, 0, slots.stderr);
    const out = JSON.parse(slots.stdout);
    assert.equal(out.bracketsInFlight, 6, "6 raw brackets (5 stale + 1 live)");
    assert.equal(out.reconcilable, 5, "5 stale brackets are reconcilable");
    assert.equal(out.realInFlight, 1, "real in-flight is exactly the 1 live executor — not 6, not 0");
    assert.equal(out.slotsTotal, 3, "cap supplied as 3");
    assert.equal(out.slotsRemaining, 2, "2 slots remaining (cap 3 − 1 real in-flight) — AC5: visible idle, not 'full'");

    // The same shape must be readable from --report --json's realInFlight field (Contract measure).
    const rep = runCli(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const repObj = JSON.parse(rep.stdout);
    assert.equal(repObj.inProgress.length, 6, "raw bracket count unchanged in --report");
    assert.equal(repObj.realInFlight, 1, "--report realInFlight reflects the 1 real in-flight");
    assert.equal(repObj.reconcilable.length, 5, "--report reconcilable names the 5 stale brackets");
  } finally {
    cleanup(tmp);
  }
});

test("AC8 — over-90m is reconcile-aware: a merged (work-landed) bracket does NOT fire; a live worktree does", async () => {
  const cli = await importCli();
  const { detectTaskOver90m } = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    seedGitWorkspace(tmp);
    const old = Date.now() - 91 * 60_000;

    // merged-done: work LANDED (branch merged into master, then branch deleted like fan-in cleanup).
    assert.equal(gitCmd(tmp, "checkout", "-b", "task/merged-done").status, 0);
    fs.appendFileSync(path.join(tmp, "tasks", "seed.md"), "merged work\n");
    assert.equal(gitCmd(tmp, "add", "-A").status, 0);
    assert.equal(gitCmd(tmp, "commit", "-m", "merged work landed").status, 0);
    assert.equal(gitCmd(tmp, "checkout", "master").status, 0);
    assert.equal(gitCmd(tmp, "merge", "--no-ff", "task/merged-done", "-m", "Merge branch 'task/merged-done'").status, 0);
    assert.equal(gitCmd(tmp, "branch", "-d", "task/merged-done").status, 0, "branch deleted like fan-in cleanup");

    // live-slow: branch checked out in an OPEN worktree ⇒ executor present ⇒ genuine slow.
    // Give it a work commit NOT reachable from master, so isBranchMerged does NOT treat it as merged
    // (a freshly-created worktree branch points at HEAD and would falsely read as an ancestor).
    assert.equal(gitCmd(tmp, "worktree", "add", "-b", "task/live-slow", path.join(tmp, "wt-slow")).status, 0);
    const wtSlow = path.join(tmp, "wt-slow");
    fs.appendFileSync(path.join(wtSlow, "tasks", "seed.md"), "slow work in progress\n");
    const wtCommit = spawnSync("git", ["-C", wtSlow, "add", "-A"], { encoding: "utf8" });
    assert.equal(wtCommit.status, 0, wtCommit.stderr);
    const wtCommit2 = spawnSync("git", ["-C", wtSlow, "commit", "-m", "slow work in progress"], { encoding: "utf8" });
    assert.equal(wtCommit2.status, 0, wtCommit2.stderr);

    cli.writeEvent(cli.buildStartEvent({ taskId: "merged-done", runId: cli.generateRunId("merged-done"), recordedAtMs: old }), tmp);
    cli.writeEvent(cli.buildStartEvent({ taskId: "live-slow", runId: cli.generateRunId("live-slow"), recordedAtMs: old }), tmp);

    const cond = await detectTaskOver90m(tmp);
    assert.ok(cond, "over-90m must fire for the genuine slow task");
    assert.equal(cond.taskId, "live-slow", "only the live-slow bracket fires over-90m — the merged-done bracket (work landed) must NOT");
    assert.notEqual(cond.taskId, "merged-done", "a merged task must not fire a false over-90m (AC8)");
  } finally {
    cleanup(tmp);
  }
});

test("AC8 — over-90m still fires for a genuine slow task in a non-git store (fail-closed, no regression)", async () => {
  const cli = await importCli();
  const { detectTaskOver90m } = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    const old = Date.now() - 91 * 60_000;
    cli.writeEvent(cli.buildStartEvent({ taskId: "gap-over", runId: cli.generateRunId("gap-over"), recordedAtMs: old }), tmp);
    const cond = await detectTaskOver90m(tmp);
    assert.ok(cond && cond.taskId === "gap-over", `over-90m must fire without git evidence: ${JSON.stringify(cond)}`);
  } finally {
    cleanup(tmp);
  }
});

test("AC9 — --escalate-stale archives a consumed-by-nobody stale block (telemetry + escalation log + removed)", async () => {
  const mod = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    const sinceMs = Date.now() - 31 * 60_000; // 31 min old > 30 min threshold
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "gap-t", reason: "task-over-90m", question: "abort?", sinceMs, source: "auto",
    }));
    assert.ok(fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "block present before escalate");

    const res = runBlockedCli(tmp, "--escalate-stale", "--max-age-ms", String(30 * 60_000));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ESCALATED/, `must report escalation, got: ${res.stdout}`);

    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "stale block removed (no infinite freeze)");
    const escPath = path.join(tmp, ".quay", "blocked-escalations.jsonl");
    assert.ok(fs.existsSync(escPath), "escalation log written");
    const esc = JSON.parse(fs.readFileSync(escPath, "utf8").trim().split("\n").pop());
    assert.equal(esc.taskId, "gap-t");
    assert.equal(esc.reason, "task-over-90m");
    assert.ok(esc.durationMs >= 31 * 60_000, "wait duration recorded");
    // The wait duration also landed in the telemetry store (blocked event).
    const eventsDir = path.join(tmp, ".workflow-events");
    assert.ok(fs.existsSync(eventsDir), "telemetry event store exists");
    const blockedFiles = fs.readdirSync(eventsDir).filter((f) => f.startsWith("blk-"));
    assert.equal(blockedFiles.length, 1, "one blocked-wait telemetry event recorded on escalation");
  } finally {
    cleanup(tmp);
  }
});

test("AC9 — --escalate-stale leaves a fresh block untouched", async () => {
  const mod = await importBlocked();
  const tmp = makeTmpWorkspace();
  try {
    mod.writeBlockedRecord(tmp, mod.buildBlockedRecord({
      taskId: "gap-t", reason: "ruling-required", question: "rule?", source: "auto",
    }));
    const res = runBlockedCli(tmp, "--escalate-stale", "--max-age-ms", String(30 * 60_000));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /not stale yet/, `fresh block must NOT escalate, got: ${res.stdout}`);
    assert.ok(fs.existsSync(path.join(tmp, ".quay", "inner-blocked.json")), "fresh block remains in place");
    assert.ok(!fs.existsSync(path.join(tmp, ".quay", "blocked-escalations.jsonl")), "no escalation log for a fresh block");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 doc — the state self-check ① in fast-mode-loop-tick.md reads realInFlight, not raw brackets", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  const row = doc.split("\n").find((l) => l.includes("| ① |"));
  assert.ok(row, "self-check item ① must exist");
  assert.match(row, /realInFlight|real-in-flight/, "item ① must read the reconcile-aware real in-flight signal");
  assert.doesNotMatch(row, /\|\s*遥测 `inProgress\[\]` 长度 ≤ `effective_cap`\s*\|/, "item ① must NOT be the vacuous raw-bracket check");
});

test("AC2 doc — the slot signal is machine-readable from --slots in both tick docs", () => {
  const inner = fs.readFileSync(path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  const outer = fs.readFileSync(path.join(REPO_ROOT, "plugin", "loop", "orchestrator-loop-tick.md"), "utf8");
  assert.match(inner, /--slots/, "inner tick must reference the --slots slot signal");
  assert.match(outer, /--slots/, "outer tick must reference the --slots slot signal");
});

