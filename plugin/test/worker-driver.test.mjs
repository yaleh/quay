// @test-group governance
// worker-driver.test.mjs — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2（AC116）: the mechanical
// worker driver spawns claude -p workers with N-concurrency (in-flight = the driver's OWN spawned
// child-process count, 硬规则 4b), a wall-clock timeout that SIGTERMs the worker (preserving the
// worktree), and a stash-before-checkout that never discards. 阶段 1（AC115）AC1/AC2/AC3 保留：
// 在飞 = 驱动子进程数（直接量）、worker 退出码 + outcome 字段齐全（SPEC §4③）、杀 worker ⇒ 察觉并记录。
// The worker command is injectable (--worker-cmd) so the tests never spawn a real claude — they drive
// `node -e process.exit(…)` and `sleep`, exactly the kill/timeout seams.
//
// Run: scripts/test.sh plugin/test/worker-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

import {
  computeOutcome,
  appendOutcomeToFile,
  splitArgs,
  defaultWorkerArgv,
  resolveRun,
  resolveConcurrency,
  parseTimeoutMs,
  stashIfDirty,
  signalExitCode,
  WORKER_OUTCOME_REL,
  FINAL_STATES,
  DEFAULT_STASH_MESSAGE,
} from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "worker-driver.ts");

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `worker-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

// A REAL git repo root (for stash / clean-main-checkout / worktree-preservation tests).
// `.quay/` is gitignored (mirroring the real repo's runtime-state ignore of worker-outcome.jsonl)
// so the driver's own outcome write never dirties the main checkout.
function makeGitRoot(tag) {
  const dir = makeRoot(tag);
  runGit(dir, ["init", "-q"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n");
  runGit(dir, ["add", ".gitignore"]);
  runGit(dir, ["commit", "-q", "-m", "gitignore .quay"]);
  return dir;
}

function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

function readOutcomeLines(root) {
  const file = path.join(root, WORKER_OUTCOME_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── pure functions ─────────────────────────────────────────────────────────────────────────────────

test("computeOutcome — SPEC §4③ field completeness + phase-2 timed_out flag", () => {
  const o = computeOutcome({
    task: "gap-x", selectorReason: "why", exitCode: 0, signal: null,
    startedAtMs: 1000, endedAtMs: 2500, workerPid: 42, runId: "fm-r",
  });
  // SPEC §4③: {task, selector 理由, worker exit code, 墙钟, 终态, 失败原因}.
  assert.equal(o.task, "gap-x");
  assert.equal(o.selector_reason, "why");
  assert.equal(o.exit_code, 0);
  assert.equal(o.wall_clock_ms, 1500);
  assert.equal(o.final_state, "completed");
  assert.equal(o.failure_reason, null);
  assert.equal(o.timed_out, false, "phase-2 timed_out flag defaults false");
  assert.equal(o.in_flight_count, 1);
  assert.equal(o.worker_pid, 42);
  assert.ok(o.started_at && o.ended_at && o.run_id && o.ts, "timestamps/run_id present");
  for (const key of ["task", "selector_reason", "exit_code", "wall_clock_ms", "final_state", "failure_reason"]) {
    assert.ok(key in o, `field ${key} present`);
  }
  assert.ok(FINAL_STATES.includes(o.final_state));
  assert.ok(FINAL_STATES.includes("timed-out"), "phase-2 added the timed-out terminal state");
});

test("computeOutcome — non-zero ⇒ failed; signal ⇒ killed; timedOut ⇒ timed-out (AC3 终态/失败原因)", () => {
  const failed = computeOutcome({ task: "g", selectorReason: "r", exitCode: 7, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x" });
  assert.equal(failed.final_state, "failed");
  assert.equal(failed.exit_code, 7);
  assert.equal(failed.failure_reason, "worker exited with code 7");

  const killed = computeOutcome({ task: "g", selectorReason: "r", exitCode: null, signal: "SIGKILL", startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x" });
  assert.equal(killed.final_state, "killed");
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(killed.failure_reason, "worker killed by SIGKILL");

  // 超时路径（AC3）：timedOut=true 优先于 signal 分支 ⇒ timed-out（不是 killed），signal 仍记 SIGTERM。
  const timedOut = computeOutcome({ task: "g", selectorReason: "r", exitCode: null, signal: "SIGTERM", startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", timedOut: true });
  assert.equal(timedOut.final_state, "timed-out");
  assert.equal(timedOut.signal, "SIGTERM");
  assert.equal(timedOut.timed_out, true);
  assert.match(timedOut.failure_reason, /timed out/);

  const spawnFailed = computeOutcome({ task: "g", selectorReason: "r", exitCode: null, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: null, runId: "x", spawnError: "ENOENT" });
  assert.equal(spawnFailed.final_state, "spawn-failed");
});

test("resolveRun / splitArgs / defaultWorkerArgv / signalExitCode / parseTimeoutMs / resolveConcurrency", () => {
  assert.deepEqual(splitArgs("node -e process.exit(7)"), ["node", "-e", "process.exit(7)"]);
  assert.deepEqual(splitArgs("  sleep 100  "), ["sleep", "100"]);
  assert.equal(defaultWorkerArgv("gap-x", "/r")[0], "claude");
  assert.equal(defaultWorkerArgv("gap-x", "/r")[1], "-p");
  assert.equal(signalExitCode("SIGKILL"), 9);
  assert.equal(signalExitCode("SIGTERM"), 15);

  // phase-2 多任务 resolveRun（tasks 数组）。
  const noTask = resolveRun({ tasks: [], reason: undefined, workerCmd: undefined, root: "/r", runId: undefined, nowMs: 1 });
  assert.ok(noTask.error, "no --task ⇒ error (selector is a later phase)");
  const ok = resolveRun({ tasks: [" gap-x ", " gap-y "], reason: "  why  ", workerCmd: "node -e process.exit(0)", root: "/r", runId: "run", nowMs: 1 });
  assert.deepEqual(ok.taskIds, ["gap-x", "gap-y"]);
  assert.equal(ok.selectorReason, "why");
  assert.deepEqual(ok.workerArgv, ["node", "-e", "process.exit(0)"]);
  const noCmd = resolveRun({ tasks: ["gap-x"], reason: undefined, workerCmd: undefined, root: "/r", runId: undefined, nowMs: 1 });
  assert.equal(noCmd.workerArgv, null, "no --worker-cmd ⇒ per-task default argv (claude -p)");

  // timeout 解析（SPEC §4④：缺省/非法 ⇒ 0 = 无超时）。
  assert.equal(parseTimeoutMs(undefined), 0);
  assert.equal(parseTimeoutMs("600"), 600);
  assert.equal(parseTimeoutMs("abc"), 0);
  assert.equal(parseTimeoutMs("-5"), 0);

  // 并发上限：显式 N 优先 → 定义点 env → 任务数（无字面量）。
  assert.equal(resolveConcurrency(3, 5, {}), 3);
  assert.equal(resolveConcurrency(undefined, 5, {}), 5, "no explicit + no env ⇒ task count");
  assert.equal(resolveConcurrency(undefined, 2, { QUAY_MAX_TASK_SUBAGENTS: "4" }), 4, "env definition point wins");
  assert.equal(resolveConcurrency(0, 2, {}), 2, "non-positive explicit is ignored");
});

test("stashIfDirty — clean repo ⇒ no-op; non-git dir ⇒ no-op; dirty repo ⇒ stash (never discard)", () => {
  // non-git dir (the phase-1 makeRoot shape) ⇒ graceful no-op.
  const nonGit = makeRoot("nogit");
  const r1 = stashIfDirty(nonGit);
  assert.equal(r1.stashed, false);
  assert.equal(r1.error, null);
  fs.rmSync(nonGit, { recursive: true, force: true });

  // clean git repo ⇒ no-op.
  const clean = makeGitRoot("clean");
  fs.writeFileSync(path.join(clean, "a.txt"), "x\n");
  runGit(clean, ["add", "a.txt"]);
  runGit(clean, ["commit", "-q", "-m", "init"]);
  const r2 = stashIfDirty(clean);
  assert.equal(r2.stashed, false);
  assert.equal(r2.files.length, 0);
  fs.rmSync(clean, { recursive: true, force: true });

  // dirty git repo ⇒ stash (stashed=true, files listed, git stash list verifiable).
  const dirty = makeGitRoot("dirty");
  fs.writeFileSync(path.join(dirty, "a.txt"), "clean\n");
  runGit(dirty, ["add", "a.txt"]);
  runGit(dirty, ["commit", "-q", "-m", "init"]);
  fs.writeFileSync(path.join(dirty, "a.txt"), "dirty\n");
  const r3 = stashIfDirty(dirty);
  assert.equal(r3.stashed, true);
  assert.equal(r3.error, null);
  assert.ok(r3.files.length >= 1, "the dirty files are reported");
  assert.match(runGit(dirty, ["stash", "list"]), /worker-driver: stash before checkout/);
  assert.equal(runGit(dirty, ["status", "--porcelain"]).trim(), "", "stash left the main checkout clean");
  assert.match(runGit(dirty, ["stash", "show", "-p", "stash@{0}"]), /dirty/, "the change is IN the stash (recoverable, not discarded)");
  fs.rmSync(dirty, { recursive: true, force: true });
});

// ── AC2 (阶段 1): end-to-end worker exit code + outcome 落盘 ────────────────────────────────────────

test("AC2 — worker exit 0 ⇒ driver exits 0 and records a completed outcome with all §4③ fields", (t) => {
  const root = makeRoot("ok");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = runDriver(root, ["--task", "gap-a", "--reason", "explicit", "--worker-cmd", "node -e process.exit(0)", "--json"]);
  const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const spawned = lines.find((l) => l.event === "worker-spawned");
  assert.equal(spawned.in_flight_count, 1, "AC1: in-flight = the driver's own spawned child count (direct)");
  assert.ok(Number.isInteger(spawned.worker_pid), "worker_pid is the driver's child pid");
  const done = lines.find((l) => l.event === "worker-done");
  assert.equal(done.exit_code, 0);
  assert.equal(done.final_state, "completed");
  assert.equal(done.failure_reason, null);
  assert.equal(done.timed_out, false);
  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "exactly one outcome record");
  for (const key of ["task", "selector_reason", "exit_code", "wall_clock_ms", "final_state", "failure_reason"]) {
    assert.ok(key in records[0], `outcome field ${key} present (AC2 字段齐全)`);
  }
  assert.equal(records[0].selector_reason, "explicit");
});

test("AC2 — worker exit 7 ⇒ driver exits 7 and records a failed outcome (failure_reason non-null)", (t) => {
  const root = makeRoot("fail");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-b", "--reason", "explicit", "--worker-cmd", "node -e process.exit(7)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 7, "the driver propagates the worker's non-zero exit code");
  const records = readOutcomeLines(root);
  assert.equal(records[0].exit_code, 7);
  assert.equal(records[0].final_state, "failed");
  assert.equal(records[0].failure_reason, "worker exited with code 7");
});

// ── AC3 (阶段 1, 能取假): kill worker ⇒ driver notices and records, no silent loss ─────────────────

test("AC3 — kill the worker ⇒ driver records final_state=killed + signal, does NOT silently drop the task", async (t) => {
  const root = makeRoot("kill");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pidFile = path.join(root, "worker.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--task", "gap-z", "--reason", "kill-test", "--worker-cmd", "sleep 100", "--pid-file", pidFile,
  ], { stdio: ["ignore", "pipe", "ignore"] });

  let workerPid = null;
  for (let i = 0; i < 100 && workerPid === null; i++) {
    if (fs.existsSync(pidFile)) workerPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(workerPid, "the driver wrote the worker pid to --pid-file");
  assert.ok(Number.isInteger(workerPid), "worker pid is the driver's own child pid");

  process.kill(workerPid, "SIGKILL");
  const exitCode = await new Promise((resolve) => {
    driver.on("close", (c) => resolve(c));
  });
  assert.notEqual(exitCode, 0, "a killed worker is a non-zero driver exit (128+SIGKILL=137)");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "the killed worker still produces EXACTLY ONE outcome record (no silent loss)");
  const rec = records[0];
  assert.equal(rec.task, "gap-z");
  assert.equal(rec.final_state, "killed", "AC3: the driver noticed the kill");
  assert.equal(rec.signal, "SIGKILL", "the signal is recorded");
  assert.equal(rec.failure_reason, "worker killed by SIGKILL");
});

test("AC2 — spawn-failed worker command ⇒ driver records spawn-failed, not silent (never a lost task)", (t) => {
  const root = makeRoot("spawnfail");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-c", "--worker-cmd", "definitely-no-such-binary-xyz"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2, "spawn-failed ⇒ driver exit 2");
  const records = readOutcomeLines(root);
  assert.equal(records[0].final_state, "spawn-failed");
  assert.ok(records[0].failure_reason, "spawn failure reason recorded");
});

// ── AC1 (阶段 2): N 并发 + 主检出恒空 ────────────────────────────────────────────────────────────────

test("AC1 — N concurrent workers; in-flight = driver's own child count (reaches N); main checkout stays clean", (t) => {
  const root = makeGitRoot("conc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "keep.txt"), "x\n");
  runGit(root, ["add", "keep.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);

  const out = runDriver(root, [
    "--task", "gap-1", "--task", "gap-2", "--task", "gap-3",
    "--concurrency", "3",
    "--worker-cmd", "node -e setTimeout(process.exit,400)",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const spawns = events.filter((e) => e.event === "worker-spawned");
  assert.equal(spawns.length, 3, "three workers spawned");
  const inFlights = spawns.map((e) => e.in_flight_count).sort((a, b) => a - b);
  assert.deepEqual(inFlights, [1, 2, 3], "in-flight reached 3 — three CONCURRENT workers (direct child count, not a proxy)");

  // AC1: 主检出 git status --porcelain 恒空（驱动只在干净/已 stash 的主检出上 spawn worker）。
  assert.equal(runGit(root, ["status", "--porcelain"]).trim(), "", "main checkout clean after N concurrent workers");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 3, "exactly three outcome records (one per worker)");
  assert.deepEqual(records.map((r) => r.final_state), ["completed", "completed", "completed"]);
});

// ── AC2 (阶段 2, 能取假): 留未提交改动 ⇒ 驱动 stash（可核），⛔ 不 discard ─────────────────────────

test("AC2 (能取假) — leave an uncommitted change ⇒ driver stashes it (git stash list verifiable), never discards", (t) => {
  const root = makeGitRoot("stash");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "a.txt"), "clean\n");
  runGit(root, ["add", "a.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);
  // leave an uncommitted tracked change
  fs.writeFileSync(path.join(root, "a.txt"), "dirty\n");
  assert.notEqual(runGit(root, ["status", "--porcelain"]).trim(), "", "precondition: main checkout IS dirty");

  runDriver(root, ["--task", "gap-s", "--worker-cmd", "node -e process.exit(0)", "--json"]);

  // stash list 可核：驱动 stash 了（不是 discard）。
  assert.match(runGit(root, ["stash", "list"]), new RegExp(DEFAULT_STASH_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "stash entry carries the driver's message");
  assert.equal(runGit(root, ["status", "--porcelain"]).trim(), "", "main checkout clean after stash (AC1 同源)");
  // 可逆证据：改动在 stash 里（stash show 含 dirty 内容）⇒ 没有被 discard。
  assert.match(runGit(root, ["stash", "show", "-p", "stash@{0}"]), /dirty/, "the uncommitted change is INSIDE the stash (recoverable, not discarded)");
  // 完整往返：pop 回来 ⇒ 改动恢复，主检出又脏（证明 stash 保留了它，不是销毁）。
  runGit(root, ["stash", "pop", "-q"]);
  assert.match(fs.readFileSync(path.join(root, "a.txt"), "utf8"), /dirty/, "stash pop restores the dirty content");
});

// ── AC3 (阶段 2): 超时 ⇒ 墙钟超时 SIGTERM、worktree 仍在 ────────────────────────────────────────────

test("AC3 — stuck worker + --timeout ⇒ wall-clock SIGTERM, final_state=timed-out, worktree preserved", async (t) => {
  const root = makeGitRoot("timeout");
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", path.join(root, "..", "w1")]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(root, "..", "w1"), { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, "k.txt"), "x\n");
  runGit(root, ["add", "k.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);
  // a real worktree that must survive the timeout (the driver never remove/prune worktrees)
  runGit(root, ["worktree", "add", "-q", "-b", "task/w1", path.join(root, "..", "w1")]);
  const wtPath = path.join(root, "..", "w1");
  assert.ok(fs.existsSync(wtPath), "precondition: worktree exists before the run");

  const pidFile = path.join(root, "worker.pid");
  const start = Date.now();
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--task", "gap-t", "--worker-cmd", "sleep 100", "--timeout", "600", "--pid-file", pidFile,
  ], { stdio: ["ignore", "pipe", "ignore"] });

  const exitCode = await new Promise((resolve) => {
    driver.on("close", (c) => resolve(c));
  });
  const elapsed = Date.now() - start;
  assert.notEqual(exitCode, 0, "timeout ⇒ non-zero driver exit (128+SIGTERM=143)");
  assert.equal(exitCode, 143, "128 + SIGTERM(15) = 143 — the wall-clock timeout SIGTERM'd the worker");
  assert.ok(elapsed < 5000, `wall-clock timeout fired promptly (elapsed ${elapsed}ms, not the full 100s sleep)`);

  const records = readOutcomeLines(root);
  const rec = records[0];
  assert.equal(rec.final_state, "timed-out", "AC3: timeout recorded as final_state=timed-out (distinct from external kill)");
  assert.equal(rec.signal, "SIGTERM", "the worker was SIGTERM'd");
  assert.equal(rec.timed_out, true, "timed_out flag set");
  assert.match(rec.failure_reason, /timed out/, "failure reason names the timeout");
  assert.ok(rec.wall_clock_ms >= 500 && rec.wall_clock_ms < 5000, `wall_clock_ms reflects the timeout (~${rec.wall_clock_ms}ms), not the full run`);

  // worktree 仍在（驱动超时杀 worker 会话，但保留 worktree；从不 remove/prune）。
  assert.ok(fs.existsSync(wtPath), "worktree still exists after timeout (preserved)");
  assert.match(runGit(root, ["worktree", "list"]), /w1/, "git worktree list still shows the worktree");
});
