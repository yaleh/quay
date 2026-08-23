// @test-group governance
// worker-driver.test.mjs — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2（AC116）+ 阶段 3（AC117）: the
// mechanical worker driver spawns claude -p workers with N-concurrency (in-flight = the driver's OWN spawned
// child-process count, 硬规则 4b), a wall-clock timeout that SIGTERMs the worker (preserving the
// worktree), and a stash-before-checkout that never discards. 阶段 1（AC115）AC1/AC2/AC3 保留：
// 在飞 = 驱动子进程数（直接量）、worker 退出码 + outcome 字段齐全（SPEC §4③）、杀 worker ⇒ 察觉并记录。
// 阶段 3（AC117）MCP 控制面：halt 语义（停止新派发、不杀在飞，AC1）、调用方身份显式传且可核（AC2，
// header Mcp-Caller-Id 或 tool 参数 caller，非 Mcp-Session-Id）、无身份调用 ⇒ 拒（AC3 能取假）。
// The worker command is injectable (--worker-cmd-exact = whole replacement) so the tests never spawn a
// real claude — they drive
// `node -e process.exit(…)` and `sleep`, exactly the kill/timeout seams. The control plane is tested
// over a real Streamable HTTP MCP connection (serveControlPlane on port 0 + SDK client).
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
  computeWorkerRoundRecord,
  splitArgs,
  launchArgv,
  workerArgvForTask,
  defaultWorkerArgv,
  defaultSelectorArgv,
  defaultReadyPoolArgv,
  shuffle,
  parseSelectorOutput,
  runSelectorWorker,
  readyPoolCheck,
  resourceGateCheck,
  resolveRun,
  resolveConcurrency,
  parseTimeoutMs,
  stashIfDirty,
  signalExitCode,
  readTaskStatus,
  worktreePresentForTask,
  computeLandingState,
  EXITED_NOT_LANDED_EXIT,
  WORKER_OUTCOME_REL,
  WORKER_ROUND_REL,
  FINAL_STATES,
  DEFAULT_STASH_MESSAGE,
  defaultControlState,
  readControlState,
  writeControlState,
  isHalted,
  applyHalt,
  applyPreference,
  applyForceDispatch,
  resolveCaller,
  knownCallers,
  headerValue,
  computeHaltedOutcome,
  CONTROL_STATE_REL,
  CONTROL_CALLERS_ENV,
  CONTROL_HEADER,
  serveControlPlane,
  defaultLivenessCheckArgv,
  runLivenessCheck,
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

function readRoundLines(root) {
  const file = path.join(root, WORKER_ROUND_REL);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// A real task file committed with a given frontmatter status. Used to make an exit-0 worker "land"
// (status=done + no leftover worktree) under the real landing check — the git repo IS the seam.
function writeTaskFile(root, taskId, status = "done") {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${status}\n---\n\n## Proposal\n\nbody\n`);
  runGit(root, ["add", `tasks/${taskId}.md`]);
  runGit(root, ["commit", "-q", "-m", `task ${taskId} ${status}`]);
}

// ── pure functions ─────────────────────────────────────────────────────────────────────────────────

test("computeOutcome — SPEC §4③ field completeness + phase-2 timed_out flag", () => {
  const o = computeOutcome({
    task: "gap-x", selectorReason: "why", exitCode: 0, signal: null,
    startedAtMs: 1000, endedAtMs: 2500, workerPid: 42, runId: "fm-r",
    landed: true,
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

test("computeOutcome — exit 0 + landed=true ⇒ completed; landed=false ⇒ exited-not-landed; landed=null ⇒ fail-closed (gap-worker-driver-fake-completion-exit-0)", () => {
  assert.ok(FINAL_STATES.includes("exited-not-landed"), "exited-not-landed is a terminal state (hard rule 3b independent value)");

  const landed = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: true });
  assert.equal(landed.final_state, "completed", "landed=true ⇒ completed");
  assert.equal(landed.failure_reason, null);

  const notLanded = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: false });
  assert.equal(notLanded.final_state, "exited-not-landed", "landed=false ⇒ exited-not-landed (exit 0 ≠ 落地)");
  assert.match(notLanded.failure_reason, /did not land/);

  const notVerified = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x" });
  assert.equal(notVerified.final_state, "exited-not-landed", "landed omitted/unknown ⇒ fail-closed exited-not-landed (读不懂 ≠ completed)");
  assert.match(notVerified.failure_reason, /not verified/);

  const detailed = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: false, landReason: "status=ready (not done)" });
  assert.equal(detailed.final_state, "exited-not-landed");
  assert.equal(detailed.failure_reason, "status=ready (not done)", "landReason is threaded into failure_reason");

  // 终态分支优先于 landed：exit 非零即使 landed=true 仍是 failed（landed 只覆盖 exit 0 路径）。
  const failed = computeOutcome({ task: "g", selectorReason: "r", exitCode: 7, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: true });
  assert.equal(failed.final_state, "failed", "non-zero exit wins over landed");
});

test("computeLandingState — landed = status=done ∧ no leftover worktree; read failures fail-closed to not-landed", (t) => {
  const root = makeGitRoot("land");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 无任务文件 ⇒ status null ⇒ not landed。
  assert.equal(readTaskStatus(root, "gap-x"), null);
  const missing = computeLandingState(root, "gap-x");
  assert.equal(missing.landed, false, "missing task file ⇒ not landed");
  assert.equal(missing.worktreePresent, false, "no task worktree in a fresh repo");

  // status=done + 无 worktree ⇒ landed。
  writeTaskFile(root, "gap-x", "done");
  assert.equal(readTaskStatus(root, "gap-x"), "done");
  const landed = computeLandingState(root, "gap-x");
  assert.equal(landed.landed, true, "status=done + no worktree ⇒ landed");
  assert.match(landed.reason, /landed/);

  // status=ready ⇒ not landed（即使无 worktree）。
  writeTaskFile(root, "gap-y", "ready");
  const ready = computeLandingState(root, "gap-y");
  assert.equal(ready.landed, false, "status=ready ⇒ not landed");
  assert.match(ready.reason, /status=ready/);

  // status=done + 残留 worktree ⇒ not landed。
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-x", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-x"), true, "a real task/<id> worktree is detected");
  const leftover = computeLandingState(root, "gap-x");
  assert.equal(leftover.landed, false, "status=done + leftover worktree ⇒ not landed");
  assert.match(leftover.reason, /leftover worktree/);
  runGit(root, ["worktree", "remove", "--force", wtPath]);

  // 非 git 仓库 ⇒ worktree 读不懂（null）⇒ fail-closed not landed（硬规则 3b）。
  const nonGit = makeRoot("land-nogit");
  const ng = computeLandingState(nonGit, "gap-x");
  assert.equal(ng.worktreePresent, null, "non-git root ⇒ worktree state unreadable (null, not false)");
  assert.equal(ng.landed, false, "unreadable worktree state ⇒ fail-closed not landed");
  fs.rmSync(nonGit, { recursive: true, force: true });
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
  const defWorker = defaultWorkerArgv("gap-x", "/r");
  assert.equal(defWorker[0], "bash", "AC140-1: default worker routes through quay-launch.sh (not bare claude)");
  assert.equal(defWorker[1], "/r/plugin/scripts/quay-launch.sh");
  assert.equal(defWorker[2], "task-worker");
  assert.equal(defWorker[3], "-p");
  assert.match(defWorker[4], /gap-x/, "the task prompt is the argv payload");
  assert.equal(signalExitCode("SIGKILL"), 9);
  assert.equal(signalExitCode("SIGTERM"), 15);

  // phase-2 多任务 resolveRun（tasks 数组）。
  const noTask = resolveRun({ tasks: [], reason: undefined, workerCmd: undefined, workerCmdExact: undefined, root: "/r", runId: undefined, nowMs: 1 });
  assert.ok(noTask.error, "explicit-mode resolveRun with no tasks ⇒ error (resident selection loop is a separate path)");
  const ok = resolveRun({ tasks: [" gap-x ", " gap-y "], reason: "  why  ", workerCmdExact: "node -e process.exit(0)", root: "/r", runId: "run", nowMs: 1 });
  assert.deepEqual(ok.taskIds, ["gap-x", "gap-y"]);
  assert.equal(ok.selectorReason, "why");
  assert.deepEqual(ok.workerCmdOpts, { prefix: null, exact: "node -e process.exit(0)" });
  const noCmd = resolveRun({ tasks: ["gap-x"], reason: undefined, workerCmd: undefined, workerCmdExact: undefined, root: "/r", runId: undefined, nowMs: 1 });
  assert.deepEqual(noCmd.workerCmdOpts, { prefix: null, exact: null }, "no --worker-cmd ⇒ per-task default argv (quay-launch.sh task-worker)");

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
  const root = makeGitRoot("ok");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-a", "done");
  const out = runDriver(root, ["--task", "gap-a", "--reason", "explicit", "--worker-cmd-exact", "node -e process.exit(0)", "--json"]);
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
    runDriver(root, ["--task", "gap-b", "--reason", "explicit", "--worker-cmd-exact", "node -e process.exit(7)"]);
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
    "--task", "gap-z", "--reason", "kill-test", "--worker-cmd-exact", "sleep 100", "--pid-file", pidFile,
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
    runDriver(root, ["--task", "gap-c", "--worker-cmd-exact", "definitely-no-such-binary-xyz"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2, "spawn-failed ⇒ driver exit 2");
  const records = readOutcomeLines(root);
  assert.equal(records[0].final_state, "spawn-failed");
  assert.ok(records[0].failure_reason, "spawn failure reason recorded");
});

// ── AC1 (gap-worker-driver-fake-completion-exit-0): exit 0 ≠ 落地 ──────────────────────────────
// worker 进程 exit 0 只说明「进程正常退出」，⛔ 不说明「任务落地」。驱动写终态前读任务侧直接量
// （status=done ∧ 无残留 worktree）；没落地 ⇒ final_state=exited-not-landed + 驱动非零退出。

test("AC1 — worker exit 0 but status=ready (not done) ⇒ exited-not-landed + driver exits non-zero", (t) => {
  const root = makeGitRoot("notland");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-nl", "ready");
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-nl", "--worker-cmd-exact", "node -e process.exit(0)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "exited-not-landed ⇒ driver exit non-zero (3), not 0");
  const records = readOutcomeLines(root);
  assert.equal(records[0].final_state, "exited-not-landed", "exit 0 but status≠done ⇒ exited-not-landed (⛔ not completed)");
  assert.match(records[0].failure_reason, /status=ready/);
});

test("AC1 — status=done but leftover worktree ⇒ exited-not-landed (leftover worktree blocks completed)", (t) => {
  const root = makeGitRoot("leftover");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-wt", "done");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-wt", wtPath]);
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-wt", "--worker-cmd-exact", "node -e process.exit(0)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "leftover worktree ⇒ exited-not-landed ⇒ driver exit non-zero");
  const records = readOutcomeLines(root);
  assert.equal(records[0].final_state, "exited-not-landed", "status=done but leftover worktree ⇒ exited-not-landed");
  assert.match(records[0].failure_reason, /leftover worktree/);
});

// ── AC1 (阶段 2): N 并发 + 主检出恒空 ────────────────────────────────────────────────────────────────

test("AC1 — N concurrent workers; in-flight = driver's own child count (reaches N); main checkout stays clean", (t) => {
  const root = makeGitRoot("conc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "keep.txt"), "x\n");
  runGit(root, ["add", "keep.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);
  writeTaskFile(root, "gap-1", "done");
  writeTaskFile(root, "gap-2", "done");
  writeTaskFile(root, "gap-3", "done");

  const out = runDriver(root, [
    "--task", "gap-1", "--task", "gap-2", "--task", "gap-3",
    "--concurrency", "3",
    "--worker-cmd-exact", "node -e setTimeout(process.exit,400)",
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
  writeTaskFile(root, "gap-s", "done");
  // leave an uncommitted tracked change
  fs.writeFileSync(path.join(root, "a.txt"), "dirty\n");
  assert.notEqual(runGit(root, ["status", "--porcelain"]).trim(), "", "precondition: main checkout IS dirty");

  runDriver(root, ["--task", "gap-s", "--worker-cmd-exact", "node -e process.exit(0)", "--json"]);

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
    "--task", "gap-t", "--worker-cmd-exact", "sleep 100", "--timeout", "600", "--pid-file", pidFile,
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

// ── 阶段 3（AC117）MCP 控制面：控制态 + 身份（AC2/AC3 纯函数）──────────────────────────────────────

test("AC2/AC3 — resolveCaller: explicit + verifiable; no identity ⇒ reject; unknown ⇒ reject; no default identity", () => {
  // AC3（能取假）：不带身份 ⇒ 拒，⛔ 不得按默认身份放行。
  const none = resolveCaller({});
  assert.equal(none.ok, false);
  assert.equal(none.code, "no-caller");
  assert.match(none.reason, /no caller identity/);

  // 空字符串 / 纯空白 同样视为「无身份」。
  assert.equal(resolveCaller({ toolArg: "  " }).ok, false);
  assert.equal(resolveCaller({ header: "" }).ok, false);

  // AC2 可核：未知身份（不在 knownCallers）⇒ 拒（不是「默认放行」，也不是「无身份」）。
  const unknown = resolveCaller({ toolArg: "evil" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "unknown-caller");
  assert.match(unknown.reason, /unknown caller "evil"/);

  // 已知身份（tool 参数 / header 两种形态）⇒ ok。
  assert.deepEqual(resolveCaller({ toolArg: "outer" }), { ok: true, caller: "outer" });
  assert.deepEqual(resolveCaller({ header: "manager" }), { ok: true, caller: "manager" });

  // tool 参数优先于 header。
  assert.deepEqual(resolveCaller({ toolArg: "outer", header: "manager" }), { ok: true, caller: "outer" });

  // 可核集合可配置（QUAY_CONTROL_CALLERS），缺省 outer,manager。
  assert.deepEqual([...knownCallers({})].sort(), ["manager", "outer"]);
  assert.deepEqual([...knownCallers({ [CONTROL_CALLERS_ENV]: "alice,bob" })].sort(), ["alice", "bob"]);
  assert.equal(resolveCaller({ toolArg: "alice", env: { [CONTROL_CALLERS_ENV]: "alice,bob" } }).ok, true);

  // headerValue 兼容 string / string[] / Headers.get 三种形态（AC2 的 header 通道取到值）。
  assert.equal(headerValue({ [CONTROL_HEADER]: "outer" }, CONTROL_HEADER), "outer");
  assert.equal(headerValue({ [CONTROL_HEADER]: ["manager", "x"] }, CONTROL_HEADER), "manager");
  assert.equal(headerValue({ get: (n) => (n === CONTROL_HEADER ? "outer" : null) }, CONTROL_HEADER), "outer");
  assert.equal(headerValue(undefined, CONTROL_HEADER), null);
});

test("control state — default / merge / halt / preference / forceDispatch / fail-closed read", () => {
  const d = defaultControlState();
  assert.equal(d.halted, false);
  assert.equal(d.schemaVersion, 1);
  assert.deepEqual(d.preference, {});
  assert.deepEqual(d.forced, []);

  const h = applyHalt(d, "outer", true, "2026-01-01T00:00:00.000Z");
  assert.equal(h.halted, true);
  assert.equal(h.halted_by, "outer");
  assert.equal(h.halted_at, "2026-01-01T00:00:00.000Z");
  // resume（halted=false）清 halted_by / halted_at。
  const resumed = applyHalt(h, "outer", false);
  assert.equal(resumed.halted, false);
  assert.equal(resumed.halted_by, null);
  assert.equal(resumed.halted_at, null);

  const p = applyPreference(d, "cost", "low");
  assert.deepEqual(p.preference, { cost: "low" });

  const f = applyForceDispatch(d, "gap-x", "hot", "manager", "2026-01-01T00:00:00.000Z");
  assert.equal(f.forced.length, 1);
  assert.equal(f.forced[0].task, "gap-x");
  assert.equal(f.forced[0].caller, "manager");

  // fail-closed：解析失败 ⇒ halted=true（硬规则 3b：读不懂 ≠ 合格）。
  const root = makeRoot("ctrl-state");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  writeControlState(root, h);
  assert.equal(readControlState(root).state.halted, true, "roundtrip: written halted state read back");
  assert.equal(readControlState(root).parseError, null);

  fs.writeFileSync(path.join(root, CONTROL_STATE_REL), "{ not json");
  const bad = readControlState(root);
  assert.equal(bad.state.halted, true, "unparseable control state ⇒ fail-closed halted=true");
  assert.ok(bad.parseError, "parse error reported, not silently swallowed");
  assert.equal(isHalted(root), true);

  // 缺失 ⇒ 缺省（未 halt）。
  const empty = makeRoot("ctrl-missing");
  assert.equal(readControlState(empty).state.halted, false);
  assert.equal(readControlState(empty).parseError, null);
});

test("computeHaltedOutcome — final_state=not-dispatched + FINAL_STATES contains it", () => {
  assert.ok(FINAL_STATES.includes("not-dispatched"), "not-dispatched is a terminal state");
  const o = computeHaltedOutcome({ task: "gap-y", selectorReason: "r", runId: "run", nowMs: 1234, inFlightCount: 2 });
  assert.equal(o.final_state, "not-dispatched");
  assert.equal(o.exit_code, null);
  assert.equal(o.worker_pid, null);
  assert.equal(o.in_flight_count, 2);
  assert.match(o.failure_reason, /halted/);
  assert.equal(o.task, "gap-y");
});

// ── AC1（阶段 3）: halt = 停止新派发、不杀在飞 ───────────────────────────────────────────────────────

test("AC1 — pre-halted control state ⇒ driver dispatches ZERO workers and records not-dispatched", (t) => {
  const root = makeRoot("halt-pre");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeControlState(root, applyHalt(defaultControlState(), "outer", true));

  const out = runDriver(root, ["--task", "gap-h", "--reason", "r", "--worker-cmd-exact", "node -e process.exit(0)", "--json"]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.some((e) => e.event === "worker-spawned"), false, "no worker spawned while halted");
  assert.equal(events.some((e) => e.event === "worker-skipped"), true, "the skip is recorded, not silent");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "exactly one outcome record (the halted skip — no silent loss)");
  assert.equal(records[0].final_state, "not-dispatched");
  assert.equal(records[0].worker_pid, null);
});

test("AC1 — halt mid-run stops NEW dispatch only; the in-flight worker completes (never killed)", async (t) => {
  const root = makeGitRoot("halt-mid");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-slow", "done");
  writeTaskFile(root, "gap-fast", "done");
  writeControlState(root, defaultControlState());

  const pidFile = path.join(root, "w.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--task", "gap-slow", "--task", "gap-fast", "--reason", "r", "--concurrency", "1",
    "--worker-cmd-exact", "sleep 2", "--pid-file", pidFile, "--json",
  ], { stdio: ["ignore", "pipe", "ignore"] });

  let buf = "";
  driver.stdout.on("data", (d) => { buf += d; });
  let firstPid = null;
  for (let i = 0; i < 200 && firstPid === null; i++) {
    if (fs.existsSync(pidFile)) firstPid = Number(fs.readFileSync(pidFile, "utf8").trim().split("\n")[0]);
    else await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(firstPid, "the first (in-flight) worker spawned and wrote its pid");

  // flip halt while gap-slow is in-flight
  writeControlState(root, applyHalt(defaultControlState(), "outer", true));

  const exitCode = await new Promise((resolve) => { driver.on("close", (c) => resolve(c)); });
  assert.equal(exitCode, 0, "halted-skip is a clean stop, not a driver failure");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "two outcome records: one in-flight completed + one skipped");
  const slow = records.find((r) => r.task === "gap-slow");
  const fast = records.find((r) => r.task === "gap-fast");
  assert.equal(slow.final_state, "completed", "AC1: the in-flight worker was NOT killed — it completed");
  assert.equal(fast.final_state, "not-dispatched", "AC1: the NEW dispatch was stopped after halt");
});

// ── AC2/AC3（阶段 3, HTTP 层能取假）: 不带身份 ⇒ 拒；header/tool 参数 ⇒ 可核放行 ───────────────────

test("AC3 (HTTP) — control-plane call without identity ⇒ rejected; with caller (arg or header) ⇒ ok", async (t) => {
  const root = makeRoot("ctrl-http");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  const handle = await serveControlPlane({ root, port: 0, env: {} });
  t.after(() => handle.close());

  const callHalt = async (headers, args) => {
    const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: headers ? { headers } : undefined,
    });
    const client = new Client({ name: "worker-driver-test", version: "0.0.1" });
    await client.connect(transport);
    const res = await client.callTool({ name: "halt", arguments: args });
    await client.close();
    return res;
  };

  // AC3（能取假）：不带身份调用 ⇒ 拒（isError:true），⛔ 不得按默认身份放行。
  const noIdentity = await callHalt(undefined, { halted: true });
  assert.equal(noIdentity.isError, true, "no-identity call is rejected");
  assert.match(noIdentity.content[0].text, /no caller identity/);

  // 未知身份 ⇒ 拒（可核的另一半）。
  const unknown = await callHalt(undefined, { halted: true, caller: "evil" });
  assert.equal(unknown.isError, true, "unknown caller is rejected");
  assert.match(unknown.content[0].text, /unknown caller "evil"/);

  // AC2（tool 参数通道）：caller=outer ⇒ 放行，控制态落盘 halted_by=outer。
  const byArg = await callHalt(undefined, { halted: true, caller: "outer" });
  assert.equal(byArg.isError, undefined, "caller via tool arg is accepted");
  assert.match(byArg.content[0].text, /"halted_by": "outer"/);

  // AC2（header 通道）：Mcp-Caller-Id: manager ⇒ 放行（证明 header 显式传且可核，非 Mcp-Session-Id）。
  const byHeader = await callHalt({ "Mcp-Caller-Id": "manager" }, { halted: true });
  assert.equal(byHeader.isError, undefined, "caller via Mcp-Caller-Id header is accepted");
  assert.match(byHeader.content[0].text, /"halted_by": "manager"/);

  // 控制态文件（单一真相源）落盘了最后那次 halt。
  const state = readControlState(root).state;
  assert.equal(state.halted, true);
  assert.equal(state.halted_by, "manager");
});

// ── 阶段 4（AC129）常驻驱动 + 自主选任务：选择环 / selector worker / 判停 ─────────────────────────
// The driver shells out to THREE injectable commands in resident mode (no --task):
//   --ready-pool-cmd (must emit ready-pool-check analyzeTasks JSON), --selector-cmd (must emit
//   `<task-id> <one-line reason>`), --resource-gate-cmd (exit 0=GO / non-0=WAIT). All three are
//   split by splitArgs (whitespace) — so the `node -e` script bodies are SPACE-FREE, and a runtime
//   space in the selector output is emitted via the `\x20` string escape. The counterNodeE helper
//   builds a space-free counter command whose output depends on how many times it has run (n).

function counterNodeE(counterFile, logExpr) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log(${logExpr})`;
}

test("AC129 pure — parseSelectorOutput: valid pick, invalid-pick fallback, empty fallback", () => {
  const candidates = ["gap-a", "gap-b"];
  const ok = parseSelectorOutput("gap-a because it blocks the suite\n", candidates, 0);
  assert.equal(ok.task, "gap-a");
  assert.equal(ok.reason, "because it blocks the suite");

  // invalid pick (task not in candidates) ⇒ fail-closed fallback to the first candidate.
  const bad = parseSelectorOutput("gap-zzz not-a-candidate", candidates, 0);
  assert.equal(bad.task, "gap-a");
  assert.match(bad.reason, /fallback to first shuffled candidate/);

  // empty output + non-zero exit ⇒ fallback too.
  const empty = parseSelectorOutput("", candidates, 1);
  assert.equal(empty.task, "gap-a");
  assert.match(empty.reason, /exit 1/);

  // no candidates ⇒ null.
  assert.equal(parseSelectorOutput("gap-a x", [], 0), null);
});

test("AC142 AC1 — selector spawn captures stderr; fallback reason carries it (spawn 失败不再零诊断)", () => {
  const candidates = ["gap-a", "gap-b"];
  // parseSelectorOutput: stderr 可选传入，兜底 reason 带 stderr 截断。
  const bad = parseSelectorOutput("", candidates, 1, "AUTH-ERROR: no credentials");
  assert.equal(bad.task, "gap-a");
  assert.match(bad.reason, /stderr="AUTH-ERROR/);

  // runSelectorWorker: 真实 spawn 写 stderr + exit 非零 ⇒ 兜底 reason 带 stderr（⛔ 不再 ignore）。
  const r = runSelectorWorker(
    candidates,
    ["node", "-e", "process.stderr.write('AUTH-ERROR: no credentials');process.exit(1)"],
    "/r",
  );
  assert.equal(r.task, "gap-a");
  assert.match(r.reason, /stderr="AUTH-ERROR/, `selector_reason carries stderr: ${r.reason}`);
});

test("AC129 pure — shuffle returns a permutation of its input", () => {
  const src = ["gap-a", "gap-b", "gap-c", "gap-d"];
  const got = shuffle(src);
  assert.equal(got.length, src.length);
  assert.deepEqual([...got].sort(), [...src].sort(), "shuffle preserves the multiset");
  assert.deepEqual(src, ["gap-a", "gap-b", "gap-c", "gap-d"], "shuffle does not mutate its input");
});

test("AC129 pure — resourceGateCheck: exit 0 ⇒ GO; exit 1 ⇒ WAIT (fail-closed)", () => {
  assert.equal(resourceGateCheck("/r", ["node", "-e", "process.exit(0)"]).go, true);
  const wait = resourceGateCheck("/r", ["node", "-e", "process.exit(1)"]);
  assert.equal(wait.go, false, "non-zero exit ⇒ WAIT");
  assert.match(wait.reason, /WAIT/);
  const missing = resourceGateCheck("/r", ["definitely-no-such-binary-xyz"]);
  assert.equal(missing.go, false, "spawn failure ⇒ fail-closed WAIT");
});

test("AC129 pure — defaultSelectorArgv / defaultReadyPoolArgv are launch / node argv", () => {
  const sel = defaultSelectorArgv(["gap-a", "gap-b"], "/r");
  assert.equal(sel[0], "bash", "AC140-1: default selector routes through quay-launch.sh (not bare claude)");
  assert.equal(sel[1], "/r/plugin/scripts/quay-launch.sh");
  assert.equal(sel[2], "selector");
  assert.equal(sel[3], "-p");
  assert.match(sel[4], /gap-a, gap-b/, "candidate ids are inlined into the selector prompt");
  const rpc = defaultReadyPoolArgv("/r", ["gap-a"], 3);
  assert.equal(rpc[0], "node");
  assert.deepEqual(rpc.slice(1, 5), ["--experimental-strip-types", "/r/plugin/scripts/ready-pool-check.ts", "--root", "/r"]);
  assert.ok(rpc.includes("--in-flight"), "in-flight ids are passed to ready-pool-check");
  assert.ok(rpc.includes("gap-a"));
});

test("AC2 — no --task ⇒ selection loop runs and selector_reason lands the selector's real reason (not 'explicit --task selection')", (t) => {
  const root = makeGitRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-a", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const out = runDriver(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-a','gap-b']:[],pool:n===0?2:0})"),
    "--selector-cmd", "node -e console.log('gap-a\\x20blocks-the-suite')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const picked = events.find((e) => e.event === "selector-picked");
  assert.ok(picked, "the selection loop emitted a selector-picked event (AC2 chain is wired)");
  assert.equal(picked.task, "gap-a");
  assert.equal(picked.selector_reason, "blocks-the-suite");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "one worker dispatched; pool drains on the next loop");
  assert.equal(records[0].task, "gap-a");
  assert.equal(records[0].selector_reason, "blocks-the-suite", "AC2: selector_reason is the selector's own reason");
  assert.notEqual(records[0].selector_reason, "explicit --task selection", "AC2: no longer the constant explicit reason");
});

test("AC1 — resident loop does not exit after one worker; keeps dispatching while pool non-empty (in-memory in-flight subtraction)", (t) => {
  const root = makeGitRoot("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-a", "done");
  writeTaskFile(root, "gap-b", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  // ready-pool returns BOTH candidates on calls 0 and 1 (it does NOT know gap-a went in-flight);
  // the DRIVER's in-memory subtraction is what makes the second fill pick gap-b. Call 2 ⇒ empty.
  const out = runDriver(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const picks = events.filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC1: two sequential selections — the resident loop kept going after the first");
  assert.deepEqual(picks.map((p) => p.task), ["gap-a", "gap-b"], "in-memory subtraction: second fill skipped the in-flight gap-a");
  assert.deepEqual(picks.map((p) => p.selector_reason), ["first-pick", "second-pick"]);
  assert.deepEqual(picks.map((p) => p.in_flight_count), [1, 2], "in-flight reached the concurrency cap (direct child count)");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "two outcome records (one per worker, no exit-after-one)");
  assert.deepEqual(records.map((r) => r.final_state), ["completed", "completed"]);
});

test("AC3 — resource-gate WAIT ⇒ resident loop stops starting workers (zero spawned)", (t) => {
  const root = makeRoot("ac3-rg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(1)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.some((e) => e.event === "worker-spawned"), false, "AC3: no worker spawned while resource-gate reports WAIT");
  const stop = events.find((e) => e.event === "resident-stop");
  assert.ok(stop, "the stop is recorded (not silent)");
  assert.match(stop.reason, /resource-gate-wait/);
  assert.equal(readOutcomeLines(root).length, 0, "zero outcome records — nothing was dispatched");
});

test("AC3 — MCP halt mid-run stops NEW dispatch only; the in-flight worker completes (never killed)", async (t) => {
  const root = makeGitRoot("ac3-halt");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-slow", "done");
  writeTaskFile(root, "gap-fast", "done");
  writeControlState(root, defaultControlState());
  const rpcFile = path.join(root, "rpc.cnt");
  const pidFile = path.join(root, "w.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-slow','gap-fast']:n===1?['gap-fast']:[],pool:2})"),
    "--selector-cmd", "node -e console.log('gap-slow\\x20slow-worker')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "sleep 2",
    "--concurrency", "1",
    "--pid-file", pidFile,
    "--json",
  ], { stdio: ["ignore", "pipe", "ignore"] });

  let buf = "";
  driver.stdout.on("data", (d) => { buf += d; });
  let workerPid = null;
  for (let i = 0; i < 200 && workerPid === null; i++) {
    if (fs.existsSync(pidFile)) workerPid = Number(fs.readFileSync(pidFile, "utf8").trim().split("\n")[0]);
    else await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(workerPid, "the in-flight worker spawned and wrote its pid");

  // flip halt while gap-slow (sleep 2) is in-flight
  writeControlState(root, applyHalt(defaultControlState(), "outer", true));

  const exitCode = await new Promise((resolve) => { driver.on("close", (c) => resolve(c)); });
  assert.equal(exitCode, 0, "a halted resident stop is a clean exit, not a failure");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "AC3: exactly ONE worker (the in-flight); gap-fast was available but NOT dispatched after halt");
  assert.equal(records[0].task, "gap-slow");
  assert.equal(records[0].final_state, "completed", "AC3: the in-flight worker was NOT killed — it completed");
  const events = buf.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "worker-spawned").length, 1, "only the one in-flight worker was ever spawned");
});

// ── AC138-3（round 等价物：无条件心跳）──────────────────────────────────────────────────────────────
// worker-outcome 只在任务真完成时写；池空时 outcome 停更会被 supervisor status 的 last_record_ts
// 误读为「死亡」。round 每轮循环无条件写一条（含池空/判停轮）作 liveness 直接量。⛔ 取假：池空轮
// 不写 round 心跳（round.jsonl 停更）⇒ 假。

test("AC138-3 pure — computeWorkerRoundRecord: ts is the first field (supervisor _carrier_stats greps \"ts\")", () => {
  const rec = computeWorkerRoundRecord({
    round: 1, runId: "wk-prod-x", pid: 42, at: "2026-08-23T12:00:00.000Z",
    action: "stop", inFlight: 0, pool: 0, stopReason: "pool-empty (no dispatchable candidate in the ready pool)",
  });
  assert.equal(rec.ts, "2026-08-23T12:00:00.000Z");
  assert.equal(rec.round, 1);
  assert.equal(rec.run_id, "wk-prod-x");
  assert.equal(rec.action, "stop");
  assert.equal(rec.in_flight, 0);
  assert.equal(rec.pool, 0);
  assert.match(rec.stop_reason, /pool-empty/);
  // ts 首字段：JSON.stringify 后 `"ts":"…"` 是记录的第一个键（supervisor 的 grep 依赖该形状）。
  const json = JSON.stringify(rec);
  assert.ok(json.startsWith('{"ts":"'), `ts is the first JSON field: ${json.slice(0, 20)}…`);
});

test("AC138-3 — pool-empty round still writes a round heartbeat (⛔ outcome stays absent; round is the liveness carrier)", (t) => {
  const root = makeRoot("ac138-round");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ready-pool returns empty immediately ⇒ resident loop records ONE round then stops (no worker spawned).
  runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--json",
  ]);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 1, "at least one round record written even when the pool is empty");
  const last = rounds[rounds.length - 1];
  assert.equal(last.action, "stop", "pool-empty round is recorded as stop (not dispatch)");
  assert.match(last.stop_reason, /pool-empty/);
  assert.equal(last.in_flight, 0);
  assert.ok(last.ts, "round record carries a ts field (the supervisor's last_record_ts reads it)");
  // ⛔ 取假对照组：outcome 在池空轮【不写】——正是 round 存在的理由（outcome 停更 ≠ 死亡）。
  assert.equal(readOutcomeLines(root).length, 0, "no outcome on a pool-empty round; round is the unconditional carrier");
});

// ── liveness 接线（gap-resident-driver-stable-carrier-liveness Finding：liveness 子命令零调用者）──
// AC2 承诺「driver/supervisor 死时有机件在窗口内检测并报告」，但此前没有任何东西调 liveness 子命令
// （log 13h 无更新）。修法 = driver 自身 round 循环每轮顺手调一次。本组验证：①defaultLivenessCheckArgv
// 复用 launch 脚本 liveness 子命令（⛔ 不重写存活判定）、②runLivenessCheck 的 checked/deaths 语义
// （checked=false = 未查成，⛔ 不是健康）、③resident loop 每轮真调它（counter 缝）。

test("defaultLivenessCheckArgv — reuse the launch script liveness subcommand; kind from file identity", () => {
  const argv = defaultLivenessCheckArgv("/r", "worker");
  assert.equal(argv[0], "bash");
  assert.equal(argv[1], "/r/plugin/scripts/promotion-driver-launch.sh");
  assert.equal(argv[2], "liveness");
  assert.deepEqual(argv.slice(argv.indexOf("--kind"), argv.indexOf("--kind") + 2), ["--kind", "worker"]);
  assert.deepEqual(argv.slice(argv.indexOf("--root"), argv.indexOf("--root") + 2), ["--root", "/r"]);
  assert.ok(argv.includes("--json"), "machine-readable verdict (the driver parses deaths/running)");
  // 同一函数传不同 kind（promotion-driver.ts 传 promotion）。
  const promo = defaultLivenessCheckArgv("/r", "promotion");
  assert.deepEqual(promo.slice(promo.indexOf("--kind"), promo.indexOf("--kind") + 2), ["--kind", "promotion"]);
});

test("runLivenessCheck — checked/deaths/running semantics (checked=false = NOT evaluated, ⛔ not healthy)", () => {
  // 健康：deaths=none ⇒ deaths 归一为 null + checked=true。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'none',running:true}))"]),
    { checked: true, deaths: null, running: true },
  );
  // 检出死亡：deaths 非空 ⇒ 原样带上（supervisor_dead 是 AC3 的真实告警）。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'supervisor_dead,driver_orphaned',running:false}))"]),
    { checked: true, deaths: "supervisor_dead,driver_orphaned", running: false },
  );
  // 退出 1（liveness 子命令检出死亡的退出码）仍算「查过」——stdout 有 deaths JSON。
  const exit1 = runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'driver_dead',running:false}));process.exit(1)"]);
  assert.deepEqual(exit1, { checked: true, deaths: "driver_dead", running: false });
  // 脚本缺失 ⇒ checked=false（未查成），⛔ 不是「健康」（硬规则 3b：无法评估 ≠ 合格）。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["bash", "/nonexistent/promotion-driver-launch.sh", "liveness"]),
    { checked: false, deaths: null, running: false },
  );
});

test("liveness wiring — resident loop calls the liveness checker each round (Finding AC2 no-caller fix)", (t) => {
  // 用 git root + done 任务（镜像 AC1 resident-loop 测试），worker 落地 → 驱动干净退出 0，
  // 免得 exit 3（exited-not-landed）盖住本测试真正要验的 liveness 接线。
  const root = makeGitRoot("liveness-wire");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-a", "done");
  writeTaskFile(root, "gap-b", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const livenessCnt = path.join(root, "liveness.cnt");
  // ready-pool 返回 2 个候选 → 选择环起 2 个 worker → 每轮一个 liveness 检查。
  runDriver(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--liveness-cmd", counterNodeE(livenessCnt, "JSON.stringify({kind:'worker',deaths:'none',running:true})"),
    "--json",
  ]);
  const rounds = readRoundLines(root);
  const livenessCount = Number(fs.readFileSync(livenessCnt, "utf8"));
  assert.equal(livenessCount, rounds.length, `liveness checked once per round (${rounds.length} rounds ⇒ ${livenessCount} checks)`);
  assert.ok(rounds.length >= 1, "at least one round ran");
  for (const rec of rounds) {
    assert.equal(rec.liveness.checked, true, `round carries liveness.checked=true: ${JSON.stringify(rec.liveness)}`);
    assert.equal(rec.liveness.deaths, null, "healthy check ⇒ deaths=null");
  }
});

// ── AC140（可配 wrapper + model + 按 role；单一真相源；覆盖语义统一）──────────────────────────────
// 驱动的 LLM spawn 不再硬编码 `["claude","-p",prompt]`——单一构造 launchArgv 走
// `quay-launch.sh <role> -p <prompt>`，wrapper/model/--bare 由 .claude/launch.settings.json 的
// _launchSpec.roles 承载。取假靠 dry-run 读【启动语义】字段（launcher / --model），⛔ 不靠 argv0
// （claude-fjdac 末行 exec claude 使 argv0 恒为 claude）。

const QUAY_LAUNCH = path.resolve(__dirname, "..", "scripts", "quay-launch.sh");
const LAUNCH_SETTINGS = path.resolve(__dirname, "..", "..", ".claude", "launch.settings.json");

function dryRunLaunch(role, ...extra) {
  return execFileSync("bash", [QUAY_LAUNCH, role, "--dry-run", ...extra], { encoding: "utf8" }).trim();
}

test("AC140-1 — single constructor: launchArgv produces bash+quay-launch.sh+<role>+-p+prompt for every role", () => {
  assert.deepEqual(launchArgv("task-worker", "WPROMPT", "/r"), ["bash", "/r/plugin/scripts/quay-launch.sh", "task-worker", "-p", "WPROMPT"]);
  assert.deepEqual(launchArgv("selector", "SPROMPT", "/r"), ["bash", "/r/plugin/scripts/quay-launch.sh", "selector", "-p", "SPROMPT"]);
  assert.deepEqual(launchArgv("fix-worker", "FPROMPT", "/r"), ["bash", "/r/plugin/scripts/quay-launch.sh", "fix-worker", "-p", "FPROMPT"]);
  // 单一真相源：default* 都经同一构造（argv[0..3] = bash + quay-launch.sh + role + -p）。
  assert.deepEqual(defaultWorkerArgv("gap-x", "/r").slice(0, 4), ["bash", "/r/plugin/scripts/quay-launch.sh", "task-worker", "-p"]);
  assert.deepEqual(defaultSelectorArgv(["a"], "/r").slice(0, 4), ["bash", "/r/plugin/scripts/quay-launch.sh", "selector", "-p"]);
});

test("AC140-2 — configurable: worker roles carry wrapper+model in _launchSpec.roles (falsifiable vs manager)", () => {
  const settings = JSON.parse(fs.readFileSync(LAUNCH_SETTINGS, "utf8"));
  const roles = settings._launchSpec.roles;
  // 正控制：新 worker 角色照 outer/inner 抄（⛔ 不照 manager 的裸 claude + model null）。
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    assert.equal(roles[role].launcher, "claude-fjdac", `${role}.launcher must be the wrapper (not bare claude)`);
    assert.ok(roles[role].model, `${role}.model must be configured (not null)`);
    assert.ok(roles[role].name && roles[role].name.startsWith("quay-") && roles[role].name !== "quay-inner",
      `${role} needs a distinct -n name (concurrent-worker ListAgents collision)`);
  }
  // 负控制：manager 仍裸 claude + model null（照它抄就是错——quay-launch.sh:80 只查非空不查取值，无任何机件报错）。
  assert.equal(roles.manager.launcher, "claude");
  assert.equal(roles.manager.model, null);

  // dry-run 实测：wrapper/model 确实出现在 spawn 命令行（launcher=claude-fjdac ⇒ wrapper 在链 ⇒ ANTHROPIC_BASE_URL 注入）。
  const taskWorker = dryRunLaunch("task-worker", "-p", "TEST");
  assert.match(taskWorker, /^claude-fjdac /, `task-worker launcher is the wrapper: ${taskWorker}`);
  assert.match(taskWorker, /--model \S+/, `task-worker carries --model <m>: ${taskWorker}`);
  assert.match(taskWorker, /-n quay-task-worker/, "task-worker has its own -n name");
  assert.doesNotMatch(taskWorker, / --bare( |$)/, "task-worker (long chain) does NOT use --bare");

  const selector = dryRunLaunch("selector", "-p", "TEST");
  assert.match(selector, /^claude-fjdac /, `selector launcher is the wrapper: ${selector}`);
  // AC142 根因：selector/fix-worker 曾设 bare=true ⇒ claude --bare 不读 ANTHROPIC_AUTH_TOKEN 而
  // wrapper 置空 ANTHROPIC_API_KEY ⇒ 认证失败 exit 1（生产 13/13 全败）。修法 = 三者均 bare=false。
  assert.doesNotMatch(selector, / --bare( |$)/, "selector does NOT use --bare (AC142: --bare 不读 AUTH_TOKEN ⇒ 认证失败)");

  const fixWorker = dryRunLaunch("fix-worker", "-p", "TEST");
  assert.match(fixWorker, /^claude-fjdac /, `fix-worker launcher is the wrapper: ${fixWorker}`);
  assert.doesNotMatch(fixWorker, / --bare( |$)/, "fix-worker does NOT use --bare (AC142: --bare 不读 AUTH_TOKEN ⇒ 认证失败)");

  // 取假对照：manager（launcher=claude，无 wrapper）⇒ 无 --model，argv0 是裸 claude（wrapper 不在链）。
  const manager = dryRunLaunch("manager");
  assert.match(manager, /^claude /, `manager is bare claude: ${manager}`);
  assert.doesNotMatch(manager, /--model/, "manager has no --model (wrapper not in chain ⇒ no ANTHROPIC_BASE_URL)");
});

test("AC140-3 — override semantics unified: --worker-cmd is prefix, --worker-cmd-exact is whole-replacement", () => {
  // exact（整体替换，测试专用）：prompt 不进 argv。
  assert.deepEqual(workerArgvForTask("gap-x", "/r", { prefix: null, exact: "node -e capture" }),
    ["node", "-e", "capture"], "--worker-cmd-exact replaces the whole command (no prompt)");

  // prefix（前缀 + prompt）：prompt 作为末参数追加（wrapper/测试前缀可用）。
  const prefix = workerArgvForTask("gap-x", "/r", { prefix: "claude-fjdac --model deepseek-v4-pro", exact: null });
  assert.deepEqual(prefix.slice(0, 3), ["claude-fjdac", "--model", "deepseek-v4-pro"]);
  assert.match(prefix[prefix.length - 1], /gap-x/,
    "prefix semantics: the task prompt is appended as the last arg (exact would drop it ⇒ falsifiable)");

  // 缺省 ⇒ launchArgv("task-worker", prompt)。
  assert.deepEqual(workerArgvForTask("gap-x", "/r").slice(0, 4),
    ["bash", "/r/plugin/scripts/quay-launch.sh", "task-worker", "-p"]);
});

// ── AC150-3 (falsifiable): 资源门/halt 判定抽到 driver-shared.ts，worker-driver 只是 re-export ──

test("AC150-3 — worker-driver re-exports the SAME resourceGateCheck / isHalted as driver-shared (单份实现)", async () => {
  const shared = await import("../scripts/driver-shared.ts");
  // worker-driver.test.mjs 顶部从 worker-driver.ts import 了 resourceGateCheck / isHalted（re-export 面）。
  assert.equal(resourceGateCheck, shared.resourceGateCheck, "resourceGateCheck 同一份实现（worker re-export = shared）");
  assert.equal(isHalted, shared.isHalted, "isHalted 同一份实现（worker re-export = shared）");
});
