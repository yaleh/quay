// @test-group governance
// worker-driver.test.mjs — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2（AC116）+ 阶段 3（AC117）: the
// mechanical worker driver spawns claude -p workers with N-concurrency (in-flight = the driver's OWN spawned
// child-process count, 硬规则 4b), a wall-clock timeout that SIGTERMs the worker (preserving the
// worktree), and a main-checkout observation that never stashes others' uncommitted changes
// (gap-worker-driver-stashifdirty-stashes-others-uncommitted). 阶段 1（AC115）AC1/AC2/AC3 保留：
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

import {
  computeOutcome,
  readLockMetricsForRun,
  newSessionId,
  appendOutcomeToFile,
  computeWorkerRoundRecord,
  splitArgs,
  launchArgv,
  buildWorkerPrompt,
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
  worktreePathsForTask,
  cleanupOrphanWorktree,
  computeLandingState,
  EXITED_NOT_LANDED_EXIT,
  WORKER_OUTCOME_REL,
  WORKER_ROUND_REL,
  FINAL_STATES,
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
  enumerateColdStartInflight,
  enumerateTaskWorktreeTasks,
  enumerateLiveWorkerCmdlines,
  hasLiveWorkerForTask,
  WORKER_PROCESS_NAME,
  parseIntervalMs,
  RESIDENT_INTERVAL_MS_DEFAULT,
  parseReconcileIntervalSecs,
  RECONCILE_INTERVAL_SECS_DEFAULT,
  workerPromptForTask,
  buildContinueWorkerPrompt,
  continueStateForTask,
  readAcCheckState,
  countBranchCommits,
  branchHeadSubject,
  lastExitedNotLandedReason,
  worktreePresentForTaskAsync,
  worktreePathsForTaskAsync,
  countBranchCommitsAsync,
  branchHeadSubjectAsync,
  continueStateForTaskAsync,
  workerPromptForTaskAsync,
  workerArgvForTaskAsync,
  taskBranchHasCommits,
  isSigtermExitCode,
  parseMaxRetries,
  isQuickDeath,
  backoffDelayMs,
  newQuickDeathBackoffState,
  isBackedOff,
  recordQuickDeathBackoff,
  QUICK_DEATH_BACKOFF_DEFAULT,
  parseQuickDeathMs,
  parseBackoffBaseMs,
  parseBackoffMaxMs,
  parseBackoffThreshold,
  acquireFanInWorkflowLock,
  fanInWorkflowLockFile,
  extractFailureSummary,
  combinedOutput,
  mirrorMechanicalFanInSuiteState,
  mechSh,
  appendFanInStepTrace,
  runMechanicalFanIn,
  spawnMechanicalFanIn,
  readWorkflowLockHold,
} from "../scripts/worker-driver.ts";
import { defaultLaneCount } from "../scripts/full-suite-runner.ts";
import { spawnSuiteAndWait } from "../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../scripts/suite-lock-slots.ts";
// gap-worker-driver-retry-cap-not-wired：retryExhausted 集合的生产函数单一真相源（driver-filters.ts），
// 两 driver 共用（⛔ 非平行副本）。AC3 用同一函数身份证 promotion 不回归。
import { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, applyTaskFilters, makeFilterContext } from "../scripts/driver-filters.ts";
import { advanceRetryCap as promoAdvanceRetryCap, markNeedsHuman as promoMarkNeedsHuman, MAX_FIX_RETRIES_DEFAULT } from "../scripts/promotion-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "worker-driver.ts");

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `worker-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

// A REAL git repo root (for main-checkout observation / clean-main-checkout / worktree-preservation tests).
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

// L3 后 launchArgv 经 L2 policy 需要 `.quay/profiles.yml` + `.claude/launch.settings.json` 两个载体。
// 给 temp root 铺一份最小载体（缺省 launcher=claude / model=test-model），供默认 argv 路径的测试用。
function writeProfileCarrier(root, { launcher = "claude", model = "test-model" } = {}) {
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"),
    "version: 1\n" +
    "profiles:\n  w:\n    launcher: " + launcher + "\n    model: " + model + "\n    bare: false\n    auth: key\n" +
    "roles:\n  task-worker:\n    profile: w\n    name: quay-test-worker\n" +
    "  selector:\n    profile: w\n    name: quay-selector\n" +
    "  fix-worker:\n    profile: w\n    name: quay-fix-worker\n");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "launch.settings.json"),
    JSON.stringify({ $schema: "x", permissions: {}, env: {} }));
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

// 常驻驱动（无 --task）现在【不退出】——瞬时 WAIT（resource-gate / pool-empty）轮询而非 latch
// （gap-worker-driver-stopreason-latch-permanent-stop）。故常驻测试不能再用 execFileSync 等退出码：
// spawn 收集 stdout JSON 事件 + 显式 stop（SIGKILL）。--json 由本 helper 恒追加（events() 依赖它）。
function spawnResident(root, args) {
  // detached:true ⇒ driver 是独立进程组组长。stop() 杀整个组（driver + worker + counter 子进程一起死），
  // ⛔ 只杀 driver 会留孤儿：孤儿 worker（stdio:"inherit"）持 stdout pipe 写端 ⇒ node --test 等不到 EOF
  // 挂死；孤儿 counter 子进程写 root/*.cnt ⇒ 与 after 钩 rmSync 竞态 ENOTEMPTY。二者都是本文件的
  // 间歇挂起根因（gap-worker-driver-resident-loop-intermittent-hang）。
  const child = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args, "--json",
  ], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; });
  const events = () => buf.trim().split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  // stop() 返回在【驱动真退出】后 resolve 的 promise（⛔ 只发 SIGKILL 就返回 ⇒ after 钩里的 rmSync
  // 会在驱动还在写 round/cnt 时跑 ⇒ ENOTEMPTY）。idempotent：多次调用复用同一 promise。inline 调用
  // （测试体末）fire-and-forget，after 钩里 `await drv.stop()` 会等它。
  let stopPromise = null;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise((resolve) => {
      let timer = null;
      const finish = () => { if (timer) clearTimeout(timer); resolve(); };
      if (child.exitCode !== null) { finish(); return; }
      child.once("exit", finish);
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
      timer = setTimeout(finish, 2000); // 兜底：SIGKILL 后驱动应在 ms 级死；2s 上限防 after 钩永挂
    });
    return stopPromise;
  };
  return { child, events, stop, pid: child.pid };
}

// 轮询谓词直到真值或超时（返回最后一次谓词值）。断言写在 waitFor 之后，超时 ⇒ 断言取假 ⇒ 测试干净失败。
// timeoutMs 留足驱动冷启动余量（node --experimental-strip-types 起步 + /proc 冷启动枚举在满载 16 核机上可 >1s）。
async function waitFor(fn, timeoutMs = 10000, stepMs = 20) {
  const deadline = Date.now() + timeoutMs;
  let v;
  while (Date.now() < deadline) {
    v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return v;
}

// A real task file committed with a given frontmatter status. Used to make an exit-0 worker "land"
// (status=done + no leftover worktree) under the real landing check — the git repo IS the seam.
function writeTaskFile(root, taskId, status = "done") {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${status}\n---\n\n## Proposal\n\nbody\n`);
  runGit(root, ["add", `tasks/${taskId}.md`]);
  runGit(root, ["commit", "-q", "-m", `task ${taskId} ${status}`]);
}

// A committed task file carrying a `## Touches` section (gap-launch-script-worker-cap-broken AC3):
// the resident loop's filterTouchesDisjoint reads each task's ## Touches from disk. The file is
// COMMITTED (clean) so the driver's main-checkout observation (stash-decision, gap-worker-driver-
// stashifdirty-stashes-others-uncommitted) and the landing check see a clean tree — the test's own
// task-file write must not count as a foreign uncommitted change. status=done so an exit-0 worker
// "lands" (completed, driver exit 0), not exited-not-landed.
function writeTouchedTask(root, taskId, touchesLine) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: done\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- ${touchesLine}\n`,
    "utf8",
  );
  runGit(root, ["add", `tasks/${taskId}.md`]);
  runGit(root, ["commit", "-q", "-m", `task ${taskId} touched`]);
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

test("computeLandingState — DriverResult 三态：verified = status=done ∧ 无 worktree；failed = 证伪；not-evaluated = 读不到（AC153）", (t) => {
  const root = makeGitRoot("land");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 无任务文件 ⇒ status null ⇒ not-evaluated（⛔ 不是 failed——读不到输入与「没落地」分离，AC153/硬规则 3b）。
  assert.equal(readTaskStatus(root, "gap-x"), null);
  const missing = computeLandingState(root, "gap-x");
  assert.equal(missing.state, "not-evaluated", "missing task file ⇒ not-evaluated（⛔ 不伪造成 failed）");
  assert.match(missing.reason, /status unreadable/);

  // status=done + 无 worktree ⇒ verified（独立判据证实落地）。
  writeTaskFile(root, "gap-x", "done");
  assert.equal(readTaskStatus(root, "gap-x"), "done");
  const landed = computeLandingState(root, "gap-x");
  assert.equal(landed.state, "verified", "status=done + no worktree ⇒ verified");
  assert.equal(landed.value.status, "done", "verified 证据：status=done");
  assert.equal(landed.value.worktreePresent, false, "verified 证据：无残留 worktree");
  assert.match(landed.verifiedBy, /status=done/);

  // status=ready ⇒ failed（即使无 worktree）——独立判据【证伪】落地。
  writeTaskFile(root, "gap-y", "ready");
  const ready = computeLandingState(root, "gap-y");
  assert.equal(ready.state, "failed", "status=ready ⇒ failed（独立判据证伪落地）");
  assert.match(ready.reason, /status=ready/);

  // status=done + 残留 worktree ⇒ failed（独立判据证伪落地）。
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-x", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-x"), true, "a real task/<id> worktree is detected");
  const leftover = computeLandingState(root, "gap-x");
  assert.equal(leftover.state, "failed", "status=done + leftover worktree ⇒ failed");
  assert.match(leftover.reason, /leftover worktree/);
  runGit(root, ["worktree", "remove", "--force", wtPath]);

  // 非 git 仓库 ⇒ worktree 读不懂（null）⇒ not-evaluated。先手写一个 status=done 的任务文件（无 git），
  // 使 status 可读但 worktree 读失败——精准命中「worktree 读不到」分支（硬规则 3b：读不懂 ≠ 无残留 ≠ 没落地）。
  const nonGit = makeRoot("land-nogit");
  fs.writeFileSync(path.join(nonGit, "tasks", "gap-x.md"), "---\nid: gap-x\nstatus: done\n---\n\n## Proposal\n\nbody\n", "utf8");
  assert.equal(readTaskStatus(nonGit, "gap-x"), "done", "task file written without git is still readable");
  assert.equal(worktreePresentForTask(nonGit, "gap-x"), null, "non-git root ⇒ worktree state unreadable (null, not false)");
  const ng = computeLandingState(nonGit, "gap-x");
  assert.equal(ng.state, "not-evaluated", "unreadable worktree state ⇒ not-evaluated（⛔ 不伪造成 failed）");
  assert.match(ng.reason, /worktree state unreadable/);

  // 证伪优先：status=ready 可读但 worktree 读不懂（非 git）⇒ failed（status≠done 单独证伪落地），
  // ⛔ 不因 worktree 读不懂降为 not-evaluated（任一独立量证伪即可，不需读全另一量）。
  fs.writeFileSync(path.join(nonGit, "tasks", "gap-y.md"), "---\nid: gap-y\nstatus: ready\n---\n\n## Proposal\n\nbody\n", "utf8");
  const refuted = computeLandingState(nonGit, "gap-y");
  assert.equal(refuted.state, "failed", "status=ready 可读 ⇒ 证伪（⛔ 不因 worktree 读不懂降为 not-evaluated）");
  assert.match(refuted.reason, /status=ready/);
  fs.rmSync(nonGit, { recursive: true, force: true });
});

// ── gap-mechanical-fan-in-result-single-authoritative-structured：D5/D6/D7 ───────────────────────────
// runMechanicalFanIn 结果成为「这次 fan-in 发生了什么」的单一权威结构化记录：final_state（D5）/ reason
// （D6）/ suite 状态（D7）三处下游全部从它派生，⛔ 不再投影到有损/陈旧的 ad-hoc 载体。

test("D5 — computeLandingState(root, task, landedSha) derives landing from ff result (⛔ not stale main-checkout status)", (t) => {
  const root = makeGitRoot("d5");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // develop 上 task 已 done（机械 fan-in 已 flip+ff）……
  writeTaskFile(root, "gap-d5", "done");
  runGit(root, ["branch", "develop"]);
  const landedSha = runGit(root, ["rev-parse", "develop"]).trim();
  // ……而主检出停在 doc-only 工作分支、status 仍 ready（合法滞后 develop，⛔ 不 sync）。
  runGit(root, ["checkout", "-q", "-b", "doc-only"]);
  fs.writeFileSync(path.join(root, "tasks", "gap-d5.md"), "---\nid: gap-d5\nstatus: ready\n---\n\n## Proposal\n\nbody\n", "utf8");
  runGit(root, ["add", "tasks/gap-d5.md"]);
  runGit(root, ["commit", "-q", "-m", "doc-only stale ready"]);

  // 前置：读主检出 status = ready ⇒ 旧判据据此判 exited-not-landed（这正是 D5 的假负例）。
  assert.equal(readTaskStatus(root, "gap-d5"), "ready", "precondition: main checkout (doc-only) still stale ready");
  const old = computeLandingState(root, "gap-d5");
  assert.equal(old.state, "failed", "precondition: without landedSha, the stale status ⇒ failed (the D5 bug)");

  // 修后：传 landedSha（develop tip）⇒ 从 ff 结果派生，⛔ 不再读主检出 stale status ⇒ verified。
  const derived = computeLandingState(root, "gap-d5", landedSha);
  assert.equal(derived.state, "verified", "D5: landedSha is develop tip + no leftover worktree ⇒ verified (⛔ not exited-not-landed)");
  assert.match(derived.verifiedBy, /landedSha/, "D5: verified reason names the ff-result-derived judge");

  // 负控制 1：landedSha 是【有效】提交但不在 develop 历史 ⇒ failed（证伪，⛔ 不因读不懂降 not-evaluated）。
  const bogus = runGit(root, ["commit-tree", `${landedSha}^{tree}`, "-m", "bogus not-on-develop"]).trim();
  const notAncestor = computeLandingState(root, "gap-d5", bogus);
  assert.equal(notAncestor.state, "failed", "D5: landedSha not develop tip/ancestor ⇒ failed");
  assert.match(notAncestor.reason, /not develop tip\/ancestor/);

  // 负控制 2：landedSha 是祖先但仍残留 worktree ⇒ failed。
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-d5", wtPath]);
  const leftover = computeLandingState(root, "gap-d5", landedSha);
  assert.equal(leftover.state, "failed", "D5: landedSha ancestor but leftover worktree ⇒ failed");
  assert.match(leftover.reason, /leftover worktree/);
  runGit(root, ["worktree", "remove", "--force", wtPath]);
});

test("D6 — extractFailureSummary strips MODULE_TYPELESS noise + keeps the failing test name (⛔ raw stream dump)", () => {
  const noisy = [
    "refresh-worktree-quay: copied 499 file(s) from /x/.quay",
    "(node:1978230) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///x.ts is not specified...",
    "Reparsing as ES module because module syntax was detected. This incurs a performance overhead.",
    'To eliminate this warning, add "type": "module" to /x/package.json.',
    "(Use `node --trace-warnings ...` to show where the warning was created)",
    "not ok 1 - my-flaky-test",
    "  ---",
    "  expected: 'a'",
    "  actual:   'b'",
    "# fail 1",
  ].join("\n");
  const summary = extractFailureSummary(noisy);
  assert.doesNotMatch(summary, /MODULE_TYPELESS/, "D6: summary must NOT carry MODULE_TYPELESS noise");
  assert.match(summary, /not ok 1 - my-flaky-test/, "D6: summary keeps the failing test name (能定位「哪个测试失败」)");
  assert.match(summary, /expected: 'a'/, "D6: summary keeps the assertion diff (定位失败)");
  // 纯噪声 / 空输入 ⇒ 空串（调用方回退 `exit <code>`，⛔ 不伪造）。
  assert.equal(extractFailureSummary(""), "");
  assert.equal(extractFailureSummary("(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: x\nReparsing as ES module..."), "");
});

test("D6 — fail 产出结构化 verdict（step/verdict/exitCode/summary/logFile），⛔ 不再 (stderr||stdout).trim() 裸流", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.match(src, /verdict: \{ step, verdict: "failed", exitCode, summary, logFile \}/, "D6: verdictOf produces the structured per-step verdict");
  assert.match(src, /reason: summary/, "D6: reason is the summary projection (⛔ not the raw stream)");
  assert.doesNotMatch(src, /\(a\.stderr \|\| a\.stdout \|\| ""\)\.trim\(\)/, "D6: the raw (stderr||stdout).trim() dump is gone");
  assert.match(src, /extractFailureSummary\(combined\)/, "D6: summary extracted via the noise-stripping pure fn");
});

// ── gap-scoped-gate-reason-stderr-drops-stdout ─────────────────────────────────────────────────────
// scoped 门红时 reason 载体失真：旧 (stderr||stdout).trim() 用 || 短路，stderr 恒非空恒良性（refresh
// 成功行 + MODULE_TYPELESS 噪声）⇒ 整个 stdout 真失败（esbuild Could not resolve / node:test not ok）
// 被丢弃。D6 已改 stdout+stderr 拼接，但 esbuild 的 Could not resolve 未进 isSignal ⇒ 与 TAP not ok
// 并存时被 slice(-60) 尾截掉。AC1：真失败签名必须进 reason（⛔ 只剩 stderr 良性 preamble 无失败签名 ⇒ 假）。

test("AC1 (gap-scoped-gate-reason-stderr-drops-stdout) — scoped-gate red reason 含 stdout 失败签名（Could not resolve / not ok），⛔ 只剩 stderr 良性 preamble", () => {
  // scoped 门（bash scripts/test.sh --for-task <task> --allow-thin）的 stderr 恒非空且恒良性，
  // 真失败在 stdout（esbuild 构建崩 + node:test TAP 失败）——与 ABI 任务实测的失败同形。
  const benignStderr = [
    "refresh-worktree-quay: copied 499 file(s) from /x/.quay",
    "(node:1978230) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///x.ts is not specified...",
    "Reparsing as ES module because module syntax was detected. This incurs a performance overhead.",
  ].join("\n");

  // ① esbuild 构建崩（build-plugin-dist 跨包 import Core src，独立打包不可解析）——stdout 只有 Could not resolve。
  const buildCrash = '✘ [ERROR] Could not resolve "../../packages/quay/src/abi.ts"\n    imported by "plugin/scripts/abi.ts"\n';
  assert.match(extractFailureSummary(buildCrash + "\n" + benignStderr), /Could not resolve/, "AC1: 构建失败签名进 reason（⛔ 只剩 stderr 良性 preamble）");

  // ② node:test TAP 失败——stdout not ok / expected / actual。
  const tapFail = "not ok 1 - unrecognized-status-unknown\n  ---\n  expected: 'author'\n  actual:   'unknown'\n  ...\n# fail 1\n";
  assert.match(extractFailureSummary(tapFail + "\n" + benignStderr), /not ok 1 - unrecognized-status-unknown/, "AC1: TAP 失败签名进 reason");

  // ③ 并存：构建崩 + TAP 失败——两签名都进 reason（⛔ Could not resolve 不再被 TAP 挤掉，isSignal 已收录）。
  const both = buildCrash + tapFail + "\n" + benignStderr;
  assert.match(extractFailureSummary(both), /Could not resolve/, "AC1: 构建失败签名与 TAP 并存仍保留");
  assert.match(extractFailureSummary(both), /not ok 1 - unrecognized-status-unknown/, "AC1: TAP 失败签名与构建失败并存仍保留");
});

// ── gap-worker-driver-complete-logging-doc ───────────────────────────────────────────────────────────
// 机制层防 reason 载体失真再犯：worker-driver 每步完整记录 stdout+stderr（⛔ 不 stderr 优先/丢弃），
// 单一机件 combinedOutput 供 fail() 与 flip 共用。AC1（能取假，失败必记全）：某步失败时 reason 含
// stdout 失败签名（⛔ 只含 stderr 良性 preamble ⇒ 假）。

test("AC1 (gap-worker-driver-complete-logging-doc) — combinedOutput 合并 stdout+stderr（⛔ 不 stderr 优先丢弃 stdout）", () => {
  // 两流皆有签名 ⇒ 都保留（stdout 先、stderr 后）。
  assert.equal(combinedOutput("stdout-sig", "stderr-sig"), "stdout-sig\nstderr-sig");
  // stdout 有真失败签名、stderr 恒非空恒良性 ⇒ stdout 签名【不丢】（⛔ 旧 a.stderr||a.stdout 短路会丢它）。
  const combined = combinedOutput("Could not resolve foo", "(node:1) Warning: benign preamble");
  assert.match(combined, /Could not resolve/, "stdout 失败签名保留（stderr 良性时不被丢弃）");
  // 只 stdout / 只 stderr ⇒ 单流保留。
  assert.equal(combinedOutput("only-stdout", ""), "only-stdout");
  assert.equal(combinedOutput("", "only-stderr"), "only-stderr");
  // 两流皆空/全空白 ⇒ 空串（调用方回退 `exit <code>`，⛔ 不伪造）。
  assert.equal(combinedOutput("", ""), "");
  assert.equal(combinedOutput("  \n", ""), "");
});

test("AC1 (gap-worker-driver-complete-logging-doc) — flip 的 git add/commit 失败 reason 用 combinedOutput（⛔ 不再 a.stderr||exit 丢弃 stdout）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.doesNotMatch(src, /a\.stderr \|\| `exit/, "flip 的 git add/commit 失败 reason 不再 stderr-only");
  assert.match(src, /combinedOutput\(a\.stdout, a\.stderr\)/, "flip reason 用 combinedOutput 合并 stdout+stderr");
  assert.match(src, /export function combinedOutput/, "combinedOutput 是单一共享机件（fail() 与 flip 共用）");
});

test("D7 — mirrorMechanicalFanInSuiteState writes full-suite-state.json (finishedAt == suiteFinishedEpoch, scope=worktree, taskId)", (t) => {
  const root = makeRoot("d7");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, ".quay", "full-suite-state.json");
  const finishedAt = "2026-08-29T06:00:00.000Z";

  mirrorMechanicalFanInSuiteState({
    task: "gap-d7", runId: "mf-run-d7", commit: "0".repeat(40),
    startedAt: "2026-08-29T05:59:00.000Z", finishedAt, durationMs: 60000,
    stateFile,
  });
  const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(st.state, "green");
  assert.equal(st.finishedAt, Math.floor(Date.parse(finishedAt) / 1000), "D7: finishedAt is epoch of sr.finishedAt (=== mfi.suiteFinishedEpoch, ⛔ not 28h stale)");
  assert.equal(st.scope, "worktree", "D7: bucket run scope=worktree (⛔ not full-run scope=main)");
  assert.equal(st.taskId, "gap-d7", "D7: taskId set — bucket-run traceability (⛔ not a full-run fabrication)");
  assert.equal(st.runId, "mf-run-d7");
  assert.equal(st.runner, "inner");
  assert.equal(st.laneCount, defaultLaneCount(), "D7: laneCount is nproc-derived (defaultLaneCount) — ⛔ not the literal 1 (concurrency-literal-check P4 violation)");

  // in-flight guard：权威载体停在 running（finishedAt null）⇒ 不覆盖（shouldSkipMirrorWrite）。
  fs.writeFileSync(stateFile, JSON.stringify({ state: "running", finishedAt: null }), "utf8");
  mirrorMechanicalFanInSuiteState({
    task: "gap-d7", runId: "mf-run-d7", commit: "0".repeat(40),
    startedAt: "2026-08-29T05:59:00.000Z", finishedAt, durationMs: 60000,
    stateFile,
  });
  const still = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(still.state, "running", "D7: in-flight full-suite state (finishedAt null) is NOT clobbered");
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

// ── gap-worker-task-transcript-access-webui AC1（能取假）：session_id 持久化 + 每次派发新 UUID ────────

test("AC1 (unit) — computeOutcome writes session_id; newSessionId returns fresh UUIDs", () => {
  const sid = "066a1382-fde0-410b-bee1-78a4b5886132";
  const withSid = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: true, sessionId: sid });
  assert.equal(withSid.session_id, sid, "session_id is written to the outcome record (⛔ 仍无 session_id ⇒ 假)");
  const noSid = computeOutcome({ task: "g", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: true });
  assert.equal(noSid.session_id, null, "session_id defaults null when omitted (honest, never fabricated)");

  const a = newSessionId();
  const b = newSessionId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "newSessionId yields a UUID");
  assert.notEqual(a, b, "two dispatches get DIFFERENT session ids (⛔ 重派同 session_id ⇒ 假)");
});

test("gap-suite-lock-starvation AC2 — computeOutcome carries lock_wait_ms/lock_hold_ms when present (缺键 when null)", () => {
  const withLocks = computeOutcome({
    task: "g", selectorReason: "r", exitCode: 0, signal: null,
    startedAtMs: 0, endedAtMs: 1000, workerPid: 1, runId: "x", landed: true,
    lockWaitMs: 12345, lockHoldMs: 67890,
  });
  assert.equal(withLocks.lock_wait_ms, 12345, "lock_wait_ms rides the outcome when the suite took the lock");
  assert.equal(withLocks.lock_hold_ms, 67890, "lock_hold_ms rides the outcome — distinguishes「长时间持锁」from「worker 慢」");

  const noLocks = computeOutcome({
    task: "g", selectorReason: "r", exitCode: 0, signal: null,
    startedAtMs: 0, endedAtMs: 1000, workerPid: 1, runId: "x", landed: true,
  });
  assert.equal(noLocks.lock_wait_ms, undefined, "no lock metrics → lock_wait_ms absent (缺键, not a fabricated 0)");
  assert.equal(noLocks.lock_hold_ms, undefined, "no lock metrics → lock_hold_ms absent (缺键, not a fabricated 0)");
});

test("gap-suite-lock-starvation AC2 — readLockMetricsForRun reads lock_wait_ms/lock_hold_ms from the verification-round ledger (matched by runId+taskId; null on miss)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-lockmetrics-"));
  try {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    const ledger = path.join(root, ".quay", "verification-round.jsonl");
    fs.writeFileSync(ledger, [
      JSON.stringify({ round: 1, taskId: "gap-a", runId: "run-a", lock_wait_ms: 100, lock_hold_ms: 200 }),
      JSON.stringify({ round: 2, taskId: "gap-b", runId: "run-b", lock_wait_ms: 300 }), // no lock_hold_ms
      JSON.stringify({ round: 3, taskId: "gap-c", runId: "run-c" }), // neither field
      // same task/run, LATER record wins (runId-reuse re-dispatch: the latest attempt's metrics)
      JSON.stringify({ round: 4, taskId: "gap-a", runId: "run-a", lock_wait_ms: 500, lock_hold_ms: 600 }),
      "not-json", // a bad line is skipped, never throws
    ].join("\n") + "\n", "utf8");

    const a = readLockMetricsForRun(root, "run-a", "gap-a");
    assert.equal(a.lockWaitMs, 500, "last matching record wins (runId reuse → the current attempt's metrics)");
    assert.equal(a.lockHoldMs, 600, "lock_hold_ms ← the last matching record");
    const b = readLockMetricsForRun(root, "run-b", "gap-b");
    assert.equal(b.lockWaitMs, 300, "a record with only lock_wait_ms → lock_wait_ms present");
    assert.equal(b.lockHoldMs, null, "missing lock_hold_ms → null (缺键, not 0)");
    const c = readLockMetricsForRun(root, "run-c", "gap-c");
    assert.equal(c.lockWaitMs, null, "record without lock fields → null");
    assert.equal(c.lockHoldMs, null, "record without lock fields → null");
    const miss = readLockMetricsForRun(root, "run-zzz", "gap-a");
    assert.equal(miss.lockWaitMs, null, "no matching runId → null");
    assert.equal(miss.lockHoldMs, null, "no matching runId → null");
    // taskId guard: a matching runId but a DIFFERENT task → miss.
    const wrongTask = readLockMetricsForRun(root, "run-a", "gap-zzz");
    assert.equal(wrongTask.lockWaitMs, null, "runId match + taskId mismatch → null");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 (integration) — re-dispatching the same task N times writes N distinct session_ids", (t) => {
  const root = makeGitRoot("session-pin");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-sid", "done"); // status=done ⇒ an exit-0 worker "lands" (completed)
  for (let i = 0; i < 3; i++) {
    runDriver(root, ["--task", "gap-sid", "--reason", "session-pin", "--worker-cmd-exact", "node -e process.exit(0)"]);
  }
  const records = readOutcomeLines(root).filter((r) => r.task === "gap-sid");
  assert.equal(records.length, 3, "three dispatches ⇒ three outcome records");
  const sids = records.map((r) => r.session_id);
  for (const sid of sids) {
    assert.match(sid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "every outcome record carries a session_id");
  }
  assert.equal(new Set(sids).size, 3, "same task re-dispatched 3× ⇒ 3 DIFFERENT session_ids (⛔ 重派同 session_id ⇒ 假)");
});

test("resolveRun / splitArgs / defaultWorkerArgv / signalExitCode / parseTimeoutMs / resolveConcurrency", () => {
  assert.deepEqual(splitArgs("node -e process.exit(7)"), ["node", "-e", "process.exit(7)"]);
  assert.deepEqual(splitArgs("  sleep 100  "), ["sleep", "100"]);
  const defWorker = defaultWorkerArgv("gap-x", REPO_ROOT);
  assert.equal(defWorker[0], "claude-fjdac", "AC140-1/L3: default worker resolves via policy to the profile launcher (not bare claude)");
  assert.equal(defWorker[defWorker.indexOf("-n") + 1], "quay-task-worker");
  assert.match(defWorker[defWorker.length - 1], /gap-x/, "the task prompt is the argv payload");
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

  // 并发上限：显式 N 优先 → 声明式配置 cap（driver-config 单一真相源，AC155）→ 任务数（无字面量）。
  assert.equal(resolveConcurrency(3, 5, 7), 3, "explicit wins");
  assert.equal(resolveConcurrency(undefined, 5, undefined), 5, "no explicit + no config ⇒ task count");
  assert.equal(resolveConcurrency(undefined, 2, 4), 4, "config cap (drivers.yml) wins");
  assert.equal(resolveConcurrency(0, 2, 7), 7, "non-positive explicit is ignored ⇒ config cap");
});

test("gap-fan-in-driver-mechanical-orchestration — buildWorkerPrompt is implement-only: worker exits, driver takes over mechanical fan-in (⛔ no suite / no workflow call)", () => {
  const prompt = buildWorkerPrompt("gap-x", "/r");
  // worker 只实现、实现后退出；driver 接手 worktree 机械跑 fan-in（取代旧「worker 跑 suite + 以
  // scriptPath 调 fan-in-execute workflow」全链式 prompt）。
  assert.match(prompt, /implement the task per its Proposal\/Plan\/AC\/DoD/, "worker implements the task");
  assert.match(prompt, /exit — the worker-driver takes over/, "driver takes over fan-in (worker exits, not runs fan-in)");
  assert.match(prompt, /mechanically runs fan-in/, "names the mechanical fan-in");
  assert.match(prompt, /You do NOT run the suite/, "worker must NOT run the suite (driver does)");
  assert.match(prompt, /do NOT call the fan-in workflow/, "worker must NOT call the fan-in workflow (retired as the worker path)");
});

test("gap-fan-in-driver-mechanical-orchestration — buildWorkerPrompt drops the old fan-in workflow signature (⛔ no fan-in-execute.js / generateRunId / scriptPath)", () => {
  const prompt = buildWorkerPrompt("gap-x", "/r");
  // 旧「worker 以 scriptPath 调 fan-in-execute workflow」的正本拷贝指令已退役——worker 不再自己
  // 派发 workflow，故 prompt 不含 workflow 路径 / generateRunId 取法 / scriptPath。
  assert.doesNotMatch(prompt, /fan-in-execute\.js/, "⛔ no fan-in-execute.js path (workflow no longer the worker path)");
  assert.doesNotMatch(prompt, /generateRunId/, "⛔ no generateRunId (worker no longer dispatches the workflow)");
  assert.doesNotMatch(prompt, /scriptPath/, "⛔ no scriptPath placeholder");
});

test("AC1 (能取假) — buildWorkerPrompt wires dispatch-worktree-setup.sh after worktree create (机制接管 bootstrap)", () => {
  const prompt = buildWorkerPrompt("gap-x", "/r");
  // 结构针：grep 到调用 + 位置在 worktree 创建之后。
  assert.match(prompt, /dispatch-worktree-setup\.sh/, "AC1: create prompt names the setup script");
  assert.match(prompt, /\/r\/plugin\/scripts\/dispatch-worktree-setup\.sh/, "AC1: setup script is the real absolute path under root");
  const createIdx = prompt.indexOf("create an isolated git worktree");
  const setupIdx = prompt.indexOf("dispatch-worktree-setup.sh");
  assert.ok(createIdx !== -1, "create instruction present");
  assert.ok(setupIdx > createIdx, "AC1: setup call is positioned AFTER worktree creation");
});

test("AC2 (能取假，负控制) — prompt no longer leaves bootstrap to agent-remembering (⛔ no hand-rolled ln -s / cp config.yml instruction)", () => {
  const create = buildWorkerPrompt("gap-x", "/r");
  assert.doesNotMatch(create, /ln -s/, "AC2: create prompt must not instruct a hand-rolled node_modules symlink");
  assert.doesNotMatch(create, /cp config\.yml/, "AC2: create prompt must not instruct a hand-rolled config.yml copy");
  const cont = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "r",
  });
  assert.doesNotMatch(cont, /ln -s/, "AC2: continue prompt must not instruct a hand-rolled node_modules symlink");
  assert.doesNotMatch(cont, /cp config\.yml/, "AC2: continue prompt must not instruct a hand-rolled config.yml copy");
});

test("stashIfDirty — non-git ⇒ no-op; clean ⇒ files=[]; dirty ⇒ observe but NEVER stash others' changes (归属区分)", () => {
  // non-git dir (the phase-1 makeRoot shape) ⇒ graceful no-op.
  const nonGit = makeRoot("nogit");
  const r1 = stashIfDirty(nonGit);
  assert.equal(r1.stashed, false);
  assert.equal(r1.error, null);
  fs.rmSync(nonGit, { recursive: true, force: true });

  // clean git repo ⇒ no-op (stashed=false, files=[] — the "nothing to see" shape).
  const clean = makeGitRoot("clean");
  fs.writeFileSync(path.join(clean, "a.txt"), "x\n");
  runGit(clean, ["add", "a.txt"]);
  runGit(clean, ["commit", "-q", "-m", "init"]);
  const r2 = stashIfDirty(clean);
  assert.equal(r2.stashed, false);
  assert.equal(r2.files.length, 0);
  fs.rmSync(clean, { recursive: true, force: true });

  // dirty git repo ⇒ the driver OBSERVES the dirty files but does NOT stash them (they are foreign).
  // stashed=false + files non-empty is the falsifiable "declined" signal (distinct from clean files=[]).
  const dirty = makeGitRoot("dirty");
  fs.writeFileSync(path.join(dirty, "a.txt"), "clean\n");
  runGit(dirty, ["add", "a.txt"]);
  runGit(dirty, ["commit", "-q", "-m", "init"]);
  fs.writeFileSync(path.join(dirty, "a.txt"), "dirty\n");
  const r3 = stashIfDirty(dirty);
  assert.equal(r3.stashed, false, "driver must NOT stash the shared main checkout");
  assert.equal(r3.error, null);
  assert.ok(r3.files.length >= 1, "the dirty files are still reported (observed, not stashed)");
  // the dirty change SURVIVES on disk (not stashed away) — and nothing lands in the stash list.
  assert.match(fs.readFileSync(path.join(dirty, "a.txt"), "utf8"), /dirty/, "the foreign uncommitted change survives");
  assert.equal(runGit(dirty, ["stash", "list"]).trim(), "", "no stash entry — the driver never stashed others' work");
  assert.notEqual(runGit(dirty, ["status", "--porcelain"]).trim(), "", "main checkout still dirty (untouched)");
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

  // AC1: 主检出 git status --porcelain 恒空（驱动只在干净的主检出上 spawn worker；此测试起跑即干净，
  // 驱动不 stash 也不写入主检出 ⇒ 结束后仍干净）。
  assert.equal(runGit(root, ["status", "--porcelain"]).trim(), "", "main checkout clean after N concurrent workers");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 3, "exactly three outcome records (one per worker)");
  assert.deepEqual(records.map((r) => r.final_state), ["completed", "completed", "completed"]);
});

// ── AC2 (能取假, 三文件负控制): 主检出他人未提交改动 ⇒ 驱动【不】stash，三个全存活 ────────────────

test("AC2 (能取假，三文件负控制) — tracked/untracked/ignored foreign changes all survive a driver run (driver does NOT stash others)", (t) => {
  const root = makeGitRoot("stash");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // tracked file, committed clean
  fs.writeFileSync(path.join(root, "a.txt"), "clean\n");
  runGit(root, ["add", "a.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);
  writeTaskFile(root, "gap-s", "done");

  // three foreign uncommitted shapes at the SAME time:
  // ① tracked uncommitted change (a.txt modified)
  fs.writeFileSync(path.join(root, "a.txt"), "dirty\n");
  // ② untracked non-ignored new file (b.txt)
  fs.writeFileSync(path.join(root, "b.txt"), "untracked\n");
  // ③ ignored file (under .quay/, already gitignored by makeGitRoot)
  fs.writeFileSync(path.join(root, ".quay", "keep.txt"), "ignored\n");
  assert.notEqual(runGit(root, ["status", "--porcelain"]).trim(), "", "precondition: main checkout IS dirty");

  const out = runDriver(root, ["--task", "gap-s", "--worker-cmd-exact", "node -e process.exit(0)", "--json"]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const stashEvent = events.find((e) => e.event === "stash");
  assert.ok(stashEvent, "the driver still EMITS the stash-decision event (⛔ not silently removed — hard rule 3b distinguishability)");
  assert.equal(stashEvent.stashed, false, "driver must NOT stash the shared main checkout");
  assert.equal(stashEvent.error, null);
  // ① + ② are OBSERVED (porcelain-visible, listed in files) but not stashed; ③ is ignored ⇒ invisible.
  assert.ok(stashEvent.files.some((f) => f.includes("a.txt")), "tracked dirty file observed in stash-decision files");
  assert.ok(stashEvent.files.some((f) => f.includes("b.txt")), "untracked non-ignored file observed in stash-decision files");
  assert.ok(!stashEvent.files.some((f) => f.includes("keep.txt")), "ignored file is invisible to porcelain (not in files)");

  // ⛔ 三文件对照：修好后三个全存活（前两个曾会被 --include-untracked 卷走，ignored 从不被卷）。
  assert.match(fs.readFileSync(path.join(root, "a.txt"), "utf8"), /dirty/, "① tracked uncommitted change SURVIVES");
  assert.match(fs.readFileSync(path.join(root, "b.txt"), "utf8"), /untracked/, "② untracked non-ignored file SURVIVES");
  assert.match(fs.readFileSync(path.join(root, ".quay", "keep.txt"), "utf8"), /ignored/, "③ ignored file SURVIVES");
  // nothing was ever stashed (no stash entry at all — not just "stashed then popped").
  assert.equal(runGit(root, ["stash", "list"]).trim(), "", "no stash entry — others' work was never stashed");
});

// ── AC3 (阶段 2): 超时 ⇒ 墙钟超时 SIGTERM、worktree 保留（gap-worker-print-bg-wait-ceiling-600s）──────

test("AC3 — stuck worker + --timeout ⇒ wall-clock SIGTERM, final_state=timed-out, worktree preserved (SPEC §1 设计点3)", async (t) => {
  const root = makeGitRoot("timeout");
  const wtPath = path.join(root, "..", "w1");
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, "k.txt"), "x\n");
  runGit(root, ["add", "k.txt"]);
  runGit(root, ["commit", "-q", "-m", "init"]);
  // a real worktree on the TASK's branch — timeout SIGTERMs the worker but PRESERVES the worktree
  // (SPEC §1 设计点3「超时即杀 worker 会话，但保留 worktree」；gap-worker-print-bg-wait-ceiling-600s AC3),
  // ⛔ not cleaned up (unlike failed/killed/exited-not-landed — gap-worker-driver-no-record-on-abnormal-death AC2).
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-t", wtPath]);
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

  // worktree 保留（超时 ⇒ SIGTERM 但保留 worktree；⛔ 误删 ⇒ 假）。
  assert.equal(rec.worktree_preserved, true, "AC3: timed-out records worktree_preserved=true");
  assert.equal(rec.worktree_cleaned, undefined, "AC3: timed-out does NOT clean the orphan worktree (no worktree_cleaned field)");
  assert.ok(fs.existsSync(wtPath), "worktree preserved after timeout (⛔ not removed)");
  assert.equal(worktreePresentForTask(root, "gap-t"), true, "git worktree list still shows task/gap-t");
});

// ── gap-worker-driver-no-record-on-abnormal-death：worker 异常死亡 ⇒ 终态记录 + orphan worktree 清理 ──
// AC1：worker 非正常退出（被杀 / suite 失败后自尽）⇒ worker-outcome.jsonl 有对应记录且 final_state ∉
// {completed}（零记录 ⇒ 假）。AC2（能取假）：异常死亡后 driver 下一轮能对同一 task 成功
// `git worktree add`（stale worktree 仍挡 ⇒ 假）。

test("AC2 (能取假) — worker abnormal death (exit non-zero) ⇒ orphan worktree cleaned; driver next round can git worktree add the same task", (t) => {
  const root = makeGitRoot("orphan");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-or", "ready"); // ready ⇒ not done ⇒ the worker did not land
  runGit(root, ["branch", "develop"]); // 基准分支 = develop（生产一致）；git log develop..task/<id> 判产出需要它存在
  // simulate the orphan worktree left by a prior abnormal death (same task, same branch)
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-or", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-or"), true, "precondition: orphan worktree present");

  let code = 0;
  try {
    runDriver(root, ["--task", "gap-or", "--worker-cmd-exact", "node -e process.exit(7)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 7, "driver propagates the worker's non-zero exit");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "AC1: abnormal death still produces EXACTLY ONE outcome record (no zero-record)");
  assert.equal(records[0].final_state, "failed", "AC1: final_state ∉ {completed}");
  assert.equal(records[0].worktree_cleaned, true, "AC2: orphan worktree cleaned on abnormal death");
  assert.equal(records[0].worktree_cleanup_error, null, "cleanup reported no error");

  // AC2 的取假半面：worktree 已清 ⇒ 同一 task 能成功重派（git worktree add 不需人工 remove）。
  assert.equal(worktreePresentForTask(root, "gap-or"), false, "orphan worktree gone after abnormal death");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-or", wtPath]);
  assert.ok(fs.existsSync(wtPath), "driver next round can git worktree add the same task (no manual remove)");
  runGit(root, ["worktree", "remove", "--force", wtPath]);
});

// ── gap-worker-needs-human-destroys-branch-worktree ────────────────────────────────────────────────
// AC1（能取假，保留）：worker exit 0 跑到 fan-in 底但没落地（final_state=exited-not-landed，含
// needs-human 闸拒绝 = 套件绿 + 实现完成）⇒ 分支 task/<id> 与 worktree 目录【仍存在】且 worktree 是
// 有效 git 仓库。⛔ 分支消失 / 空壳 ⇒ 假（39min 完成实现永久丢失的第 2 次同形）。
// AC2（能取假，仍清崩溃）：worker 异常死亡（failed/killed）仍删分支+worktree——上面的
// "worker abnormal death (exit non-zero)" 用例已钉死，本组只补 needs-human 保留面。

test("AC1 — worker exit 0 + status=ready (needs-human gate rejection) ⇒ branch + worktree PRESERVED, valid git repo", (t) => {
  const root = makeGitRoot("nh");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-nh"]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-nh", "ready"); // ready ⇒ not done ⇒ the worker did not land
  // the worker's own worktree on its task branch — the implementation lives here
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-nh", wtPath]);
  assert.ok(fs.existsSync(wtPath), "precondition: worktree exists before the run");
  assert.match(runGit(root, ["branch", "--list", "task/gap-nh"]), /gap-nh/, "precondition: branch task/gap-nh exists");

  let code = 0;
  try {
    runDriver(root, ["--task", "gap-nh", "--worker-cmd-exact", "node -e process.exit(0)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "exit 0 but status≠done ⇒ driver exit non-zero (3), not 0");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "exactly one outcome record");
  assert.equal(records[0].final_state, "exited-not-landed", "needs-human gate rejection ⇒ exited-not-landed (⛔ not completed)");
  assert.ok(records[0].worktree_cleaned !== true, "AC1: exited-not-landed is NOT cleaned — the branch/worktree must be preserved (no worktree_cleaned=true)");

  // AC1 取假半面：分支仍在 + worktree 目录仍在 + worktree 是有效 git 仓库（git -C <wt> rev-parse 成功）。
  assert.match(runGit(root, ["branch", "--list", "task/gap-nh"]), /gap-nh/, "AC1: branch task/gap-nh still exists (⛔ branch gone ⇒ 假)");
  assert.ok(fs.existsSync(wtPath), "AC1: worktree directory still exists (⛔ empty shell ⇒ 假)");
  assert.equal(worktreePresentForTask(root, "gap-nh"), true, "AC1: git worktree list still shows task/gap-nh");
  const gitDir = runGit(wtPath, ["rev-parse", "--git-dir"]);
  assert.match(gitDir, /\.git/, "AC1: worktree is still a valid git repo (rev-parse --git-dir succeeds)");
});

test("cleanupOrphanWorktree / worktreePathsForTask — find + remove orphan worktree + delete branch; idempotent", (t) => {
  const root = makeGitRoot("cleanup");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-c", "ready");
  runGit(root, ["branch", "develop"]); // 基准分支 = develop（生产一致）；git log develop..task/<id> 判产出需要它存在
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-c", wtPath]);

  const found = worktreePathsForTask(root, "gap-c");
  assert.equal(found.length, 1, "exactly one worktree path located for the task");
  assert.equal(found[0], wtPath, "worktree path resolved via the porcelain branch line");
  assert.deepEqual(worktreePathsForTask(root, "gap-nope"), [], "no worktree for a different task");

  const res = cleanupOrphanWorktree(root, "gap-c");
  assert.equal(res.removed, true);
  assert.equal(res.worktreePath, wtPath);
  assert.equal(res.branchDeleted, true, "task/<id> branch deleted so a fresh git worktree add -b succeeds");
  assert.equal(res.error, null);
  assert.equal(worktreePresentForTask(root, "gap-c"), false, "worktree gone after cleanup");

  // 幂等：无 worktree 可清 ⇒ no-op（不是错误）。
  const again = cleanupOrphanWorktree(root, "gap-c");
  assert.equal(again.removed, false);
  assert.equal(again.error, null);
});

// ── gap-worker-cleanup-judgment-precision：清理前 git log 判产出 + failed 按信号区分 ──────────────────
// AC1（能取假）：清理前查 `git log develop..task/<id>`——零提交 ⇒ 无产出可清、有提交 ⇒ 有实现保留
//  （⛔ 纯终态字符串布尔判断、不看提交 ⇒ 假）。AC2（能取假）：failed 桶按信号区分，exit_code=143
//  （SIGTERM，外部杀）有提交者保留（⛔ SIGTERM 有提交仍被清 ⇒ 假）。taskBranchHasCommits 是直接量
//  （三态：true 有提交 / false 零提交 / null 读不懂）。

test("isSigtermExitCode — 143 ⇒ external SIGTERM; 其它非零 ⇒ self-crash; null ⇒ false", () => {
  assert.equal(isSigtermExitCode(143), true, "143 = 128+SIGTERM(15) ⇒ external kill");
  assert.equal(isSigtermExitCode(130), false, "130 = 128+SIGINT ⇒ not SIGTERM");
  assert.equal(isSigtermExitCode(1), false, "exit 1 = self-crash, not SIGTERM");
  assert.equal(isSigtermExitCode(null), false, "no exit code ⇒ not SIGTERM");
});

test("taskBranchHasCommits — tri-state: has commits / zero commits / unreadable (⛔ null ≠ false)", (t) => {
  const root = makeGitRoot("tbch");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-tb", "ready");
  // 无 develop / 无 task/<id> 分支 ⇒ 读不懂 ⇒ null（⛔ 不是 false「零提交」）。
  assert.equal(taskBranchHasCommits(root, "gap-tb"), null, "no develop + no task branch ⇒ unreadable (null)");

  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-tb", wtPath]);
  assert.equal(taskBranchHasCommits(root, "gap-tb"), false, "zero commits beyond develop ⇒ false");

  fs.writeFileSync(path.join(wtPath, "impl.txt"), "wip\n");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "wip impl"]);
  assert.equal(taskBranchHasCommits(root, "gap-tb"), true, "one commit beyond develop ⇒ true");
});

test("AC1 (cleanup-judgment) — zero-commit failed worktree IS cleaned (git log develop..task/<id> empty ⇒ no output)", (t) => {
  const root = makeGitRoot("cj-ac1");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac1`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cj-a", "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cj-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cj-a"), true, "precondition: worktree present");
  assert.equal(taskBranchHasCommits(root, "gap-cj-a"), false, "precondition: zero commits on the task branch");

  // failed（自崩 exit_code=1）+ 零提交 ⇒ 清（无产出可清）。
  const res = cleanupOrphanWorktree(root, "gap-cj-a", null, { finalState: "failed", exitCode: 1 });
  assert.equal(res.removed, true, "AC1: zero-commit failed worktree IS cleaned");
  assert.equal(res.hasCommits, false, "git log reading recorded: zero commits");
  assert.equal(res.preservedForCommits, false, "not preserved — nothing to preserve");
  assert.equal(res.sigtermExternal, false, "exit_code=1 is self-crash, not SIGTERM");
  assert.equal(worktreePresentForTask(root, "gap-cj-a"), false, "worktree gone after cleanup");
});

test("AC2 (cleanup-judgment) — SIGTERM (exit_code=143) failed worktree WITH commits IS preserved", (t) => {
  const root = makeGitRoot("cj-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cj-b", "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cj-b", wtPath]);
  // worker 在 worktree 里提交过一个实现（模拟 SIGTERM 打断前已产出）。
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "partial implementation\n");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "wip implementation"]);
  assert.equal(taskBranchHasCommits(root, "gap-cj-b"), true, "precondition: task branch has commits beyond develop");

  // failed + exit_code=143（外部 SIGTERM 杀）+ 有提交 ⇒ 保留（⛔ SIGTERM 有提交仍被清 ⇒ 假）。
  const res = cleanupOrphanWorktree(root, "gap-cj-b", null, { finalState: "failed", exitCode: 143 });
  assert.equal(res.removed, false, "AC2: SIGTERM-with-commits worktree is NOT cleaned");
  assert.equal(res.hasCommits, true, "git log reading recorded: has commits");
  assert.equal(res.preservedForCommits, true, "preserved BECAUSE the branch has commits");
  assert.equal(res.sigtermExternal, true, "exit_code=143 classified as external SIGTERM");
  assert.equal(worktreePresentForTask(root, "gap-cj-b"), true, "worktree survives");
  assert.match(runGit(root, ["branch", "--list", "task/gap-cj-b"]), /gap-cj-b/, "branch survives");
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

test("AC142 AC1 — selector spawn captures stderr; fallback reason carries it (spawn 失败不再零诊断)", async () => {
  const candidates = ["gap-a", "gap-b"];
  // parseSelectorOutput: stderr 可选传入，兜底 reason 带 stderr 截断。
  const bad = parseSelectorOutput("", candidates, 1, "AUTH-ERROR: no credentials");
  assert.equal(bad.task, "gap-a");
  assert.match(bad.reason, /stderr="AUTH-ERROR/);

  // runSelectorWorker: 真实 spawn 写 stderr + exit 非零 ⇒ 兜底 reason 带 stderr（⛔ 不再 ignore）。
  // 异步版（gap-worker-driver-async-selector-readypool AC1）：runSelectorWorker 已改 async。
  const r = await runSelectorWorker(
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

test("AC3 (gap-launch-script-worker-cap-broken) — resident loop never dispatches the Touches-overlapping pair concurrently", async (t) => {
  const root = makeGitRoot("ac3-integr");
  writeTouchedTask(root, "gap-a", "plugin/scripts/foo.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/foo.ts"); // overlaps gap-a
  writeTouchedTask(root, "gap-c", "plugin/scripts/bar.ts"); // disjoint
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b','gap-c']:[],pool:n<=1?3:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':n===1?'gap-b\\x20wants-b':'gap-a\\x20unused'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "3",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 5000);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  // gap-a picked first (touches foo.ts); while it is in-flight, gap-b (also foo.ts) must be filtered
  // out of the selector's candidate set — the selector asked for gap-b on its 2nd call but was only
  // offered the disjoint gap-c, so it fell back to gap-c. gap-b is never dispatched concurrently.
  assert.ok(!picks.some((p) => p.task === "gap-b"), "AC3: the overlapping gap-b is never dispatched (would collide with in-flight gap-a)");
  assert.deepEqual(picks.map((p) => p.task), ["gap-a", "gap-c"], "only the disjoint pair is dispatched");
  assert.match(picks[1].selector_reason, /fallback/, `the selector asked for gap-b but was only offered the disjoint gap-c: ${picks[1].selector_reason}`);
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
  const sel = defaultSelectorArgv(["gap-a", "gap-b"], REPO_ROOT);
  assert.equal(sel[0], "claude-fjdac", "AC140-1/L3: default selector resolves via policy to the profile launcher (not bare claude)");
  assert.equal(sel[sel.indexOf("-n") + 1], "quay-selector");
  assert.match(sel[sel.length - 1], /gap-a, gap-b/, "candidate ids are inlined into the selector prompt");
  const rpc = defaultReadyPoolArgv("/r", ["gap-a"], 3);
  assert.equal(rpc[0], "node");
  assert.deepEqual(rpc.slice(1, 5), ["--experimental-strip-types", "/r/plugin/scripts/ready-pool-check.ts", "--root", "/r"]);
  assert.ok(rpc.includes("--in-flight"), "in-flight ids are passed to ready-pool-check");
  assert.ok(rpc.includes("gap-a"));
});

test("AC2 — no --task ⇒ selection loop runs and selector_reason lands the selector's real reason (not 'explicit --task selection')", async (t) => {
  const root = makeGitRoot("ac2");
  writeTaskFile(root, "gap-a", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-a','gap-b']:[],pool:n===0?2:0})"),
    "--selector-cmd", "node -e console.log('gap-a\\x20blocks-the-suite')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readOutcomeLines(root).length >= 1, 5000);
  const picked = drv.events().find((e) => e.event === "selector-picked");
  assert.ok(picked, "the selection loop emitted a selector-picked event (AC2 chain is wired)");
  assert.equal(picked.task, "gap-a");
  assert.equal(picked.selector_reason, "blocks-the-suite");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "one worker dispatched; pool drains on the next loop");
  assert.equal(records[0].task, "gap-a");
  assert.equal(records[0].selector_reason, "blocks-the-suite", "AC2: selector_reason is the selector's own reason");
  assert.notEqual(records[0].selector_reason, "explicit --task selection", "AC2: no longer the constant explicit reason");
});

test("AC1 — resident loop does not exit after one worker; keeps dispatching while pool non-empty (in-memory in-flight subtraction)", async (t) => {
  const root = makeGitRoot("ac1");
  // gap-launch-script-worker-cap-broken AC3: the resident loop now reads each task's ## Touches to
  // filter Touches-overlapping candidates — so these fake ids need DISJOINT, COMMITTED Touches task
  // files (the loop's main-checkout observation must see a clean tree; a Touches-less file ⇒ conservative
  // serialize ⇒ gap-b dropped and the two-selection assertion fails).
  writeTouchedTask(root, "gap-a", "plugin/scripts/a.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/b.ts");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  // ready-pool returns BOTH candidates on calls 0 and 1 (it does NOT know gap-a went in-flight);
  // the DRIVER's in-memory subtraction is what makes the second fill pick gap-b. Call 2 ⇒ empty.
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 5000 → 10000：两次完整派发+落地循环（ready-pool/selector/worker 各 spawn 一个 node 子进程 + landing
  // 读 git）在满载 16 核 full-suite 并发下可 >5s（suite 轮实测 5000 超时 flake、picks=1）；与同文件
  // 「第二次派发」的既有约定（gap-b 等 10000ms）一致。
  await waitFor(() => readOutcomeLines(root).length >= 2, 10000);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC1: two sequential selections — the resident loop kept going after the first");
  assert.deepEqual(picks.map((p) => p.task), ["gap-a", "gap-b"], "in-memory subtraction: second fill skipped the in-flight gap-a");
  assert.deepEqual(picks.map((p) => p.selector_reason), ["first-pick", "second-pick"]);
  assert.deepEqual(picks.map((p) => p.in_flight_count), [1, 2], "in-flight reached the concurrency cap (direct child count)");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "two outcome records (one per worker, no exit-after-one)");
  assert.deepEqual(records.map((r) => r.final_state), ["completed", "completed"]);
});

test("AC3 — resource-gate WAIT ⇒ resident loop stops starting workers (zero spawned; WAIT is transient, not a latch)", async (t) => {
  const root = makeRoot("ac3-rg");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(1)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 1, 5000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC3: no worker spawned while resource-gate reports WAIT");
  assert.equal(readOutcomeLines(root).length, 0, "zero outcome records — nothing was dispatched");
  const stop = readRoundLines(root).find((r) => r.action === "stop");
  assert.ok(stop, "the stop round is recorded (not silent)");
  assert.match(stop.stop_reason, /resource-gate-wait/);
  assert.equal(drv.child.exitCode, null, "WAIT is transient — the driver does NOT exit (no permanent latch)");
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
    coldStartInflight: ["gap-cs-a"],
  });
  assert.equal(rec.ts, "2026-08-23T12:00:00.000Z");
  assert.equal(rec.round, 1);
  assert.equal(rec.run_id, "wk-prod-x");
  assert.equal(rec.action, "stop");
  assert.equal(rec.in_flight, 0);
  assert.equal(rec.pool, 0);
  assert.match(rec.stop_reason, /pool-empty/);
  assert.deepEqual(rec.cold_start_inflight, ["gap-cs-a"], "cold-start observation lands in the round record (production-visible carrier)");
  // ts 首字段：JSON.stringify 后 `"ts":"…"` 是记录的第一个键（supervisor 的 grep 依赖该形状）。
  const json = JSON.stringify(rec);
  assert.ok(json.startsWith('{"ts":"'), `ts is the first JSON field: ${json.slice(0, 20)}…`);
});

test("AC138-3 — pool-empty round still writes a round heartbeat (⛔ outcome stays absent; round is the liveness carrier)", async (t) => {
  const root = makeRoot("ac138-round");
  // ready-pool returns empty ⇒ resident loop records a stop round then polls (no worker spawned; it no
  // longer exits on pool-empty — pool-empty is transient, promotion-driver keeps filling it).
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 1, 5000);
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

test("defaultLivenessCheckArgv — reuse the TS kernel liveness subcommand; kind from file identity", () => {
  // AC151：supervisor 港进 TS 后，liveness 子命令 = `node … driver-runtime.ts liveness --kind … --root …`。
  const argv = defaultLivenessCheckArgv("/r", "worker");
  assert.equal(argv[0], process.execPath, "spawn the node binary (⛔ not bash — kernel is TS)");
  assert.equal(argv[1], "--experimental-strip-types");
  assert.ok(argv[2].endsWith("driver-runtime.ts"), `kernel path = driver-runtime.ts, got ${argv[2]}`);
  assert.equal(argv[3], "liveness");
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

test("liveness wiring — resident loop calls the liveness checker each round (Finding AC2 no-caller fix)", async (t) => {
  // 用 git root + done 任务（镜像 AC1 resident-loop 测试），worker 落地 → 驱动继续轮询（池空不退出）。
  const root = makeGitRoot("liveness-wire");
  writeTaskFile(root, "gap-a", "done");
  writeTaskFile(root, "gap-b", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const livenessCnt = path.join(root, "liveness.cnt");
  // ready-pool 返回 2 个候选 → 选择环起 2 个 worker → 每轮一个 liveness 检查。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--liveness-cmd", counterNodeE(livenessCnt, "JSON.stringify({kind:'worker',deaths:'none',running:true})"),
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 1 && readOutcomeLines(root).length >= 2, 60000);
  const rounds = readRoundLines(root);
  const livenessCount = Number(fs.readFileSync(livenessCnt, "utf8"));
  // liveness 在每轮【开头】跑（writeRound 之前）⇒ livenessCount ≥ rounds.length 恒成立；≥1 证明
  // 零调用者（Finding 的根）已修。⛔ 不做精确相等——停杀可能落在「liveness 已跑、round 未写」的窗口。
  assert.ok(livenessCount >= 1, "liveness was called (zero-caller fix): counter is non-zero");
  assert.ok(rounds.length >= 1, "at least one round ran");
  assert.ok(livenessCount >= rounds.length, `liveness checked at least once per round (${rounds.length} rounds ⇒ ${livenessCount} checks)`);
  for (const rec of rounds) {
    assert.equal(rec.liveness.checked, true, `round carries liveness.checked=true: ${JSON.stringify(rec.liveness)}`);
    assert.equal(rec.liveness.deaths, null, "healthy check ⇒ deaths=null");
  }
});

// ── gap-worker-driver-resident-loop-intermittent-hang：挂起复现负控制 ───────────────────────────────
// 根因（实测 RUN 8 ENOTEMPTY）：常驻测试 after 钩按注册序 FIFO 运行，`fs.rmSync(root)` 先注册先运行、
// 此刻驱动仍活（每轮写 root/.quay/worker-round.jsonl）⇒ rmSync ENOTEMPTY ⇒ 抛错跳过后续 `drv.stop()`
// ⇒ 驱动泄漏（spinning、持 stdout pipe）⇒ node --test 等不到 EOF 挂死。修法 = ① spawnResident 用
// detached:true 让驱动成进程组组长、stop() 杀整组（⛔ 只杀驱动会留孤儿 worker 持 pipe + 孤儿 counter
// 子进程与 rmSync 竞态）；② 常驻测试统一「先 drv.stop 再 rmSync」的 after 钩顺序（或 body 末 inline
// drv.stop）。本负控制只验①：长命 worker（sleep 100，stdio:"inherit"）在 stop 后【不得】持 pipe——
// stop 杀整组 ⇒ 孤儿 worker 一起死 ⇒ stdout pipe 界内关闭；旧只杀驱动 ⇒ 孤儿 worker 持 pipe 到 100s。
test("negative control — drv.stop kills the whole process group: a long-lived worker does NOT hold the stdout pipe open", async (t) => {
  const root = makeGitRoot("group-kill");
  writeTaskFile(root, "gap-gk", "done");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-gk'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-gk\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "sleep 100", // 长命 worker：若 stop 不杀整组，孤儿 worker 持 stdout pipe 写端
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 5000);
  const closed = new Promise((resolve) => drv.child.stdout.on("close", resolve));
  drv.stop();
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("stdout pipe still open after stop — an orphaned worker held it (group-kill not applied)")), 3000)),
  ]);
});

// ── AC140（可配 wrapper + model + 按 role；单一真相源；覆盖语义统一）+ L3（driver 消费 policy）─────
// 驱动的 LLM spawn 不再硬编码 `["claude","-p",prompt]`——单一构造 launchArgv 现在【经 L2 policy
// （profile-policy.ts loadProfiles + resolveRole）解析语义 kind → profile】后直接出 argv（L3
// gap-driver-binding-semantic-kind-to-profile），⛔ 不再 `bash quay-launch.sh <role>` 把解析交给 bash 里
// 的第二份实现。wrapper/model/--bare 由 .quay/profiles.yml 的 profiles/roles 承载（AC154 profile 抽层）。
// 取假靠读【启动语义】字段（launcher / --model），⛔ 不靠 argv0（claude-fjdac 末行 exec claude 使
// argv0 恒为 claude）。quay-launch.sh 保留给非驱动路径（manager/outer/inner），AC140-2 仍经它 dry-run。

const QUAY_LAUNCH = path.resolve(__dirname, "..", "scripts", "quay-launch.sh");
const PROFILES = path.resolve(__dirname, "..", "..", ".quay", "profiles.yml");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// profiles.yml 是 YAML；launcher 经 python3+yaml 消费，本测试用同一手法转 JSON 后断言结构。
function readProfiles() {
  const out = execFileSync("python3", ["-c", "import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", PROFILES], { encoding: "utf8" });
  return JSON.parse(out);
}

function dryRunLaunch(role, ...extra) {
  return execFileSync("bash", [QUAY_LAUNCH, role, "--dry-run", ...extra], { encoding: "utf8" }).trim();
}

test("AC140-1 — single constructor: launchArgv resolves kind → profile via policy (launcher from profile, ⛔ not bash quay-launch.sh)", () => {
  const tw = launchArgv("task-worker", "WPROMPT", REPO_ROOT);
  assert.equal(tw[0], "claude-fjdac", "launcher resolved from profile (⛔ bash quay-launch.sh)");
  assert.equal(tw[1], "--settings");
  assert.equal(tw[tw.indexOf("--model") + 1], "deepseek-v4-pro-anthropic");
  assert.equal(tw[tw.indexOf("-n") + 1], "quay-task-worker");
  assert.equal(tw[tw.length - 1], "WPROMPT", "prompt is the last argv payload");
  assert.ok(!tw.includes("quay-launch.sh"), "no bash quay-launch.sh in the spawn argv (⛔ bash 第二份实现)");

  const sel = launchArgv("selector", "SPROMPT", REPO_ROOT);
  assert.equal(sel[0], "claude-fjdac");
  assert.equal(sel[sel.indexOf("-n") + 1], "quay-selector");

  const fix = launchArgv("fix-worker", "FPROMPT", REPO_ROOT);
  assert.equal(fix[0], "claude-fjdac");
  assert.equal(fix[fix.indexOf("-n") + 1], "quay-fix-worker");

  // 单一真相源：default* 都经同一构造（argv[0] = profile launcher，调用点只传语义 kind）。
  assert.equal(defaultWorkerArgv("gap-x", REPO_ROOT)[0], "claude-fjdac");
  assert.equal(defaultSelectorArgv(["a"], REPO_ROOT)[0], "claude-fjdac");
});

test("AC140-1b — L3 由 policy 解析（能取假）：合成 profile 的 launcher/model 流进 argv（⛔ 非硬编码）", (t) => {
  const root = makeRoot("profile");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 合成 profiles.yml：launcher=claude（⛔ 非 claude-fjdac）+ model=synth-model——若 launchArgv 硬编码
  // claude-fjdac/deepseek-v4-pro 或绕过 policy，这些字段不会照合成值流进 argv ⇒ 取假。
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"),
    "version: 1\n" +
    "profiles:\n  w:\n    launcher: claude\n    model: synth-model\n    bare: false\n    auth: key\n" +
    "roles:\n  task-worker:\n    profile: w\n    name: quay-synth\n");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const settingsPath = path.join(root, ".claude", "launch.settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ $schema: "x", permissions: {}, env: { KEEP: "1" } }));

  const a = launchArgv("task-worker", "P", root);
  assert.equal(a[0], "claude", "launcher from the SYNTHETIC profile (⛔ hardcoded claude-fjdac)");
  assert.equal(a[a.indexOf("--model") + 1], "synth-model", "model from the SYNTHETIC profile");
  assert.equal(a[a.indexOf("-n") + 1], "quay-synth", "name from the SYNTHETIC profile");
  assert.equal(a[a.length - 1], "P");
  // 无 unset / 无 role env ⇒ --settings 直接是文件路径（非合并 JSON）。
  assert.equal(a[a.indexOf("--settings") + 1], settingsPath);
});

test("AC140-2 — configurable: worker roles carry wrapper+model via shared profile (falsifiable vs manager)", () => {
  const p = readProfiles();
  const roles = p.roles;
  const profileOf = (role) => p.profiles[roles[role].profile];
  // 正控制：新 worker 角色照 outer/inner 抄（⛔ 不照 manager 的裸 claude + model null）；AC154 后三者共享同一 profile。
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    assert.equal(profileOf(role).launcher, "claude-fjdac", `${role} profile launcher must be the wrapper (not bare claude)`);
    assert.ok(profileOf(role).model, `${role} profile model must be configured (not null)`);
    assert.ok(roles[role].name && roles[role].name.startsWith("quay-") && roles[role].name !== "quay-inner",
      `${role} needs a distinct -n name (concurrent-worker ListAgents collision)`);
  }
  // 负控制：manager 仍裸 claude + model null（照它抄就是错——quay-launch.sh 只查非空不查取值，无任何机件报错）。
  assert.equal(profileOf("manager").launcher, "claude");
  assert.equal(profileOf("manager").model, null);

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

  // 缺省 ⇒ launchArgv("task-worker", prompt)：经 policy 解析，argv[0] 是 profile launcher。
  const def = workerArgvForTask("gap-x", REPO_ROOT);
  assert.equal(def[0], "claude-fjdac", "default worker resolves via policy (⛔ bash quay-launch.sh)");
  assert.match(def[def.length - 1], /gap-x/, "the task prompt is the last argv payload");
});

// ── gap-worker-worktree-continue-reuse ───────────────────────────────────────────────────────────
// destroy-path 修复后 exited-not-landed 的 worktree 被【保留】但没人接着做：派发 prompt 仍是「create」
// ⇒ 重派 worker 一上来 `git worktree add` 撞已存在对象 fatal。AC1（复用不撞死）：保留 worktree 在 ⇒
// 续做 prompt（复用，⛔ 不含 create）。AC2（续做不重做）：续做 prompt 携带前一轮状态（分支提交 / AC
// 勾选 / 失败原因）。

test("AC1 (能取假) — workerPromptForTask / continueStateForTask: preserved worktree ⇒ continue prompt (reuse, ⛔ create); no worktree ⇒ create prompt", (t) => {
  const root = makeGitRoot("continue");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-cr"]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cr", "ready");

  // 无 worktree ⇒ 创建 prompt（旧行为）。
  const createPrompt = workerPromptForTask("gap-cr", root);
  assert.match(createPrompt, /create an isolated git worktree/, "no worktree ⇒ create prompt");
  assert.doesNotMatch(createPrompt, /CONTINUE \(reuse/, "create prompt does not say reuse");
  assert.equal(continueStateForTask(root, "gap-cr"), null, "no worktree ⇒ no continue state (create path)");

  // 模拟 exited-not-landed 保留的 worktree ⇒ 续做 prompt。
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cr", wtPath]);
  const contPrompt = workerPromptForTask("gap-cr", root);
  assert.match(contPrompt, /CONTINUE \(reuse/, "preserved worktree ⇒ continue prompt");
  assert.doesNotMatch(contPrompt, /create an isolated git worktree/, "AC1: continue prompt must NOT say create (create ⇒ git worktree add fatal)");
  assert.match(contPrompt, /do NOT run `git worktree add`/, "AC1: reuse not create");
  assert.ok(continueStateForTask(root, "gap-cr") != null, "worktree present ⇒ continue state gathered");
});

test("AC2 (能取假) — buildContinueWorkerPrompt carries prior-round state (branch commits / AC check / failure reason)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  assert.match(p, /3 commits/, "AC2: branch commit count carried");
  assert.match(p, /head: "implement gap-x"/, "AC2: branch head subject carried");
  assert.match(p, /checked 2\/5/, "AC2: AC check state carried (checked X/Y)");
  assert.match(p, /because: worker exited 0 but task did not land/, "AC2: failure reason carried");
  assert.doesNotMatch(p, /create an isolated git worktree/, "AC1: continue prompt never says create");
});

test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC1: buildContinueWorkerPrompt is mechanical too (worker exits, driver takes over; ⛔ no fan-in-execute.js / generateRunId / scriptPath)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  // 续做 prompt 与创建 prompt 同源 driverFanInNote：worker 实现后退出、driver 接手机械跑 fan-in，
  // ⛔ 不再写旧 workflow 兜底签名（fan-in-execute.js / generateRunId / scriptPath）。
  assert.match(p, /exit — the worker-driver takes over/, "AC1: continue prompt also lets the driver take over fan-in");
  assert.match(p, /mechanically runs fan-in/, "AC1: names the mechanical fan-in");
  assert.match(p, /do NOT call the fan-in workflow/, "AC1: worker never calls the workflow (driver decision)");
  assert.doesNotMatch(p, /fan-in-execute\.js/, "⛔ no fan-in-execute.js path (workflow retired from the worker prompt)");
  assert.doesNotMatch(p, /generateRunId/, "⛔ no generateRunId (worker no longer dispatches the workflow)");
  assert.doesNotMatch(p, /scriptPath/, "⛔ no scriptPath placeholder");
  assert.match(p, /\/wt/, "continue prompt still embeds the concrete worktree path (reuse, not a placeholder)");
});

test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC2: cold-start orphan (worktree present, no mechanical_fan_in record) routes to mechanical fan-in, ⛔ not the workflow", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 0,
    branchHeadSubject: null,
    acChecked: null,
    acTotal: null,
    failureReason: null, // 冷启动孤儿：worker-outcome 对该 task 无 exited-not-landed 记录 ⇒ 无 mechanical_fan_in
  });
  assert.match(p, /\(unknown\)/, "cold-start orphan: no prior failure record ⇒ (unknown)");
  assert.match(p, /exit — the worker-driver takes over/, "AC2: still mechanical (driver re-runs fan-in), ⛔ not the workflow");
  assert.doesNotMatch(p, /fan-in-execute\.js/, "AC2: no workflow mis-routing");
});

test("gap-fan-in-continue-prompt-not-migrated-to-mechanical — AC3: workflow fallback is the driver's decision, never written into the worker prompt (both create and continue)", () => {
  // 语义兜底归 driver（runMechanicalFanIn 返回 red 时按 step 唤起语义会话），⛔ 不把「调 workflow」
  // 写进 worker prompt——创建与续做两条 prompt 都不含调 workflow 的指令。
  const create = buildWorkerPrompt("gap-x", "/r");
  const cont = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at typecheck",
  });
  for (const [label, p] of [["create", create], ["continue", cont]]) {
    assert.doesNotMatch(p, /Workflow tool/, `AC3: ${label} prompt never says to call the Workflow tool`);
    assert.doesNotMatch(p, /fan-in-execute\.js/, `AC3: ${label} prompt has no workflow script path`);
    assert.match(p, /do NOT call the fan-in workflow/, `AC3: ${label} prompt explicitly forbids calling the workflow`);
  }
});

test("AC1 (能取假) — buildContinueWorkerPrompt wires dispatch-worktree-setup.sh on the reused worktree (idempotent re-provision)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "worker exited 0 but task did not land",
  });
  assert.match(p, /dispatch-worktree-setup\.sh/, "AC1: continue prompt names the setup script");
  assert.match(p, /dispatch-worktree-setup\.sh \/wt/, "AC1: continue prompt re-provisions the concrete worktree path");
  assert.doesNotMatch(p, /create an isolated git worktree/, "AC1: continue prompt never says create");
});

test("AC2 — continueStateForTask gathers real state (own branch commits / AC checkboxes / last exited-not-landed reason)", (t) => {
  const root = makeGitRoot("continue-state");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-cs2"]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });

  // task file with an AC section: 2 checked / 3 total.
  const body = `---\nid: gap-cs2\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n- [x] AC3 done\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-cs2.md"), body);
  runGit(root, ["add", "tasks/gap-cs2.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-cs2"]);

  // prior round's own commit on the task branch (HEAD..task/<id> must count exactly this, not the whole history).
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs2", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-cs2"]);

  // prior round's outcome record (exited-not-landed with a reason).
  fs.appendFileSync(
    path.join(root, WORKER_OUTCOME_REL),
    JSON.stringify({ ts: new Date().toISOString(), task: "gap-cs2", final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)" }) + "\n",
    "utf8",
  );

  assert.equal(readAcCheckState(root, "gap-cs2").checked, 2, "AC checkboxes: 2 checked");
  assert.equal(readAcCheckState(root, "gap-cs2").total, 3, "AC checkboxes: 3 total");
  assert.equal(countBranchCommits(root, "gap-cs2"), 1, "own commits only (HEAD..task/<id> = 1, ⛔ not whole history)");
  assert.equal(branchHeadSubject(root, "gap-cs2"), "implement gap-cs2", "branch head subject = the prior round's own commit");
  assert.match(lastExitedNotLandedReason(root, "gap-cs2"), /did not land/, "last exited-not-landed reason read from outcome");

  const st = continueStateForTask(root, "gap-cs2");
  assert.ok(st != null, "continue state gathered for preserved worktree");
  assert.equal(st.worktreePath, wtPath, "state carries the worktree path");
  assert.equal(st.branchCommits, 1, "state carries own commit count");
  assert.equal(st.acChecked, 2, "state carries AC checked");
  assert.equal(st.acTotal, 3, "state carries AC total");
  assert.match(st.failureReason, /did not land/, "state carries failure reason");
});

test("AC1 (integration, 复现) — re-dispatch of an exited-not-landed task passes the CONTINUE prompt to the worker (reuse, ⛔ create)", (t) => {
  const root = makeGitRoot("continue-e2e");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  const capOut = path.join(root, "..", `captured-prompt-${path.basename(root)}.txt`);
  const capScript = path.join(root, "..", `capture-prompt-${path.basename(root)}.sh`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-ce"]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
    fs.rmSync(capOut, { force: true });
    fs.rmSync(capScript, { force: true });
  });

  // task file with an AC section (1 checked / 2 total).
  const body = `---\nid: gap-ce\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-ce.md"), body);
  runGit(root, ["add", "tasks/gap-ce.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-ce"]);

  // prior exited-not-landed round: worktree + branch + one own commit + an outcome record.
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-ce", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-ce"]);
  fs.appendFileSync(
    path.join(root, WORKER_OUTCOME_REL),
    JSON.stringify({ ts: new Date().toISOString(), task: "gap-ce", final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)" }) + "\n",
    "utf8",
  );

  // capture the prompt the driver actually passes to the worker (--worker-cmd prefix appends it as the last arg).
  fs.writeFileSync(capScript, `#!/bin/sh\nprintf '%s' "$1" > "${capOut}"\nexit 0\n`);
  fs.chmodSync(capScript, 0o755);

  let code = 0;
  try {
    runDriver(root, ["--task", "gap-ce", "--worker-cmd", `bash ${capScript}`]);
  } catch (e) {
    code = e.status;
  }

  // worker exit 0 + status≠done ⇒ exited-not-landed (the exact re-dispatch scenario; worktree preserved).
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "exit 0 + status≠done ⇒ driver exit 3 (exited-not-landed, worktree preserved)");

  const prompt = fs.readFileSync(capOut, "utf8");
  assert.match(prompt, /CONTINUE \(reuse/, "AC1: the re-dispatched worker got the CONTINUE prompt");
  assert.doesNotMatch(prompt, /create an isolated git worktree/, "AC1: ⛔ continue prompt must not say create (create ⇒ git worktree add fatal)");
  assert.match(prompt, /1 commits/, "AC2: carries branch commit count");
  assert.match(prompt, /checked 1\/2/, "AC2: carries AC check state");
  assert.match(prompt, /exited-not-landed because: worker exited 0 but task did not land/, "AC2: carries failure reason");
  assert.equal(worktreePresentForTask(root, "gap-ce"), true, "worktree still preserved after re-dispatch (⛔ not cleaned)");
});

// ── gap-continue-prompt-conflict-resolution-protocol ────────────────────────────────────────────────
// 机械 fan-in 的 merge develop 步在 CONTINUE 轮撞冲突时，旧 prompt 只带失败原因、不含消解指令 ⇒
// 消冲突靠 worker 自行发挥（运气）。AC1（指令存在）/ AC2（outline 冲突取 develop 版）/ AC3（code 语义
// 并集 + git commit --no-edit）钉住 prompt 里三类消解指令，删掉任一条 ⇒ 测试红（AC4 能取假）。

test("AC1/AC2/AC3 (能取假) — buildContinueWorkerPrompt encodes the merge-conflict resolution protocol (outline take-develop / code semantic-union / commit --no-edit)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT in docs/proposals/quay-product-outline.md)",
  });
  // AC1 (指令存在): prompt names the conflict state (unmerged paths / CONFLICT) and the resolve action.
  assert.match(p, /(unmerged|CONFLICT)/, "AC1: prompt names the merge-conflict state (unmerged paths / CONFLICT)");
  assert.match(p, /resolve/, "AC1: prompt instructs the worker to resolve the conflict");
  assert.match(p, /never exit while unmerged paths remain/, "AC1: prompt forbids exiting with unmerged paths (next fan-in merge step would fail again)");
  // AC2 (outline 冲突取 develop 版): outline inventory conflict ⇒ take the develop version (git checkout develop), ⛔ no --write-inventory.
  assert.match(p, /git checkout develop/, "AC2: outline-doc conflict ⇒ take the develop version (git checkout develop)");
  assert.match(p, /take the develop version/, "AC2: outline-doc conflict ⇒ take the develop version (⛔ no recompute)");
  assert.doesNotMatch(p, /write-inventory/, "AC2: ⛔ no longer re-run the retired --write-inventory");
  assert.match(p, /do NOT hand-merge the counts/, "AC2: outline-doc conflict ⇒ ⛔ hand-merge the counts");
  // AC3 (code 并集 + commit): code conflict ⇒ semantic union + git commit --no-edit.
  assert.match(p, /semantic union/, "AC3: code-file conflict ⇒ take the semantic union of both sides");
  assert.match(p, /git commit --no-edit/, "AC3: complete the merge with git commit --no-edit");
});

// ── gap-fan-in-merge-develop-derived-recompute-and-reason（B；A 已退役）─────────────────────────────
// 机械 fan-in step 2 `git merge develop` 冲突的【具体文件】没传回下一轮 worker——CONTINUE prompt 的 reason
// 读通用 failure_reason（「task status=ready not done」），⛔ 不含冲突文件 ⇒ worker 无从精准 resolve。
// 修法（原 B）：lastExitedNotLandedReason 改读 mechanical_fan_in（step + reason 拼接「step=merge-develop:
// CONFLICT in <file>」）。原 A（driver 对 derived 文件机械重算）已退役：outline §6 DELIVERY-INVENTORY 快照被
// gap-delivery-inventory-check-time-computation 删除（计数改 check-time 计算），无 derived 文件可重算。

test("B (能取假) — lastExitedNotLandedReason reads mechanical_fan_in (step + reason) ⛔ not generic failure_reason", () => {
  const root = makeRoot("mech-reason");
  const mech = { outcome: "red", step: "merge-develop", reason: "CONFLICT (content): Merge conflict in plugin/scripts/worker-driver.ts" };
  fs.appendFileSync(path.join(root, WORKER_OUTCOME_REL), JSON.stringify({
    ts: new Date().toISOString(), task: "gap-dv", final_state: "exited-not-landed",
    failure_reason: "task status=ready not done", mechanical_fan_in: mech,
  }) + "\n", "utf8");
  const reason = lastExitedNotLandedReason(root, "gap-dv");
  assert.match(reason, /step=merge-develop/, "B: reason leads with the mechanical_fan_in step");
  assert.match(reason, /CONFLICT/, "B: reason carries the conflict marker");
  assert.match(reason, /plugin\/scripts\/worker-driver\.ts/, "B: reason carries the specific conflicting file");
  assert.doesNotMatch(reason, /status=ready not done/, "B: ⛔ not the generic failure_reason");
  // fallback：无 mechanical_fan_in ⇒ 回退 failure_reason（旧行为保留）。
  fs.writeFileSync(path.join(root, WORKER_OUTCOME_REL), JSON.stringify({
    ts: new Date().toISOString(), task: "gap-dv", final_state: "exited-not-landed",
    failure_reason: "worker exited 0 but task did not land (status≠done or leftover worktree)",
  }) + "\n", "utf8");
  assert.match(lastExitedNotLandedReason(root, "gap-dv"), /did not land/, "B: no mechanical_fan_in ⇒ fall back to failure_reason");
});

test("B (能取假, 结构面) — worker-driver.ts reason 读 mechanical_fan_in；A 的 derived 重算逻辑无残留", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.match(src, /formatExitedNotLandedReason/, "B: reason formatting reads mechanical_fan_in");
  assert.match(src, /mechanical_fan_in/, "B: lastExitedNotLandedReason reads the mechanical_fan_in field");
  // A 已退役（superseded by gap-delivery-inventory-check-time-computation）：⛔ 不残留 derived 重算逻辑
  // （OUTLINE_DOC_REL 常量 / resolveDerivedMergeConflict / DERIVED_CONFLICT_FILES 会引用已删除的 §6 快照 + 退役 flag）。
  assert.doesNotMatch(src, /OUTLINE_DOC_REL/, "A retired: no OUTLINE_DOC_REL import");
  assert.doesNotMatch(src, /resolveDerivedMergeConflict/, "A retired: no derived-recompute resolver");
  assert.doesNotMatch(src, /DERIVED_CONFLICT_FILES/, "A retired: no derived file set");
});

// ── AC150-3 (falsifiable): 资源门/halt 判定抽到 driver-shared.ts，worker-driver 只是 re-export ──

test("AC150-3 — worker-driver re-exports the SAME resourceGateCheck / isHalted as driver-shared (单份实现)", async () => {
  const shared = await import("../scripts/driver-shared.ts");
  // worker-driver.test.mjs 顶部从 worker-driver.ts import 了 resourceGateCheck / isHalted（re-export 面）。
  assert.equal(resourceGateCheck, shared.resourceGateCheck, "resourceGateCheck 同一份实现（worker re-export = shared）");
  assert.equal(isHalted, shared.isHalted, "isHalted 同一份实现（worker re-export = shared）");
});

// ── 派发前 depends_on 过滤（gap-worker-driver-dispatch-pre-filter-missing AC1）───────────────────────
// worker-driver 把 ready-pool-check 的 ready 列表直接派发、不二次过滤 depends_on ⇒ 依赖未满的任务
// 仍被派发（ac138 白烧一轮：代码已 land、依赖链未满、翻 done 会重造 DEP-DONE-IFF-DEPS 违例）。修法 =
// 派发前对候选做 depends_on 过滤（AC152 起经 driver-filters.ts 的 depsSatisfied 谓词，纯函数测试见
// driver-filters.test.mjs）。

test("AC1 — depends_on gate in the resident loop: a candidate whose dep is not done is NOT dispatched (ac138 白烧一轮防)", async (t) => {
  const root = makeGitRoot("ac1-deps");
  // gap-prereq（ready，未 done）+ gap-dep（depends_on gap-prereq），都写进 tasks/ 并提交。
  fs.writeFileSync(path.join(root, "tasks", "gap-prereq.md"), "---\nid: gap-prereq\nstatus: ready\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-prereq.md"]);
  runGit(root, ["commit", "-q", "-m", "prereq ready"]);
  fs.writeFileSync(path.join(root, "tasks", "gap-dep.md"), "---\nid: gap-dep\nstatus: ready\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-dep.md"]);
  runGit(root, ["commit", "-q", "-m", "dep ready"]);

  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-dep'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-dep\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 1, 5000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC1: dep-not-done candidate is never dispatched");
  assert.equal(readOutcomeLines(root).length, 0, "zero workers dispatched");
  // 负控制（⛔ 不能是「池空才不派」）：round 记录 pool=1 证明 ready-pool 确实给了 gap-dep 候选——
  // 是 depends_on 过滤把它滤掉的（不是 selector 没选、也不是池空）。与 Touches 互斥同属非终态过滤
  // （依赖由别的任务落地，非本驱动等待可解）⇒ 无在飞 worker 可等 ⇒ 轮询等依赖落地。
  const rounds = readRoundLines(root);
  assert.equal(rounds[rounds.length - 1].pool, 1, "ready-pool reported pool=1 (gap-dep), yet nothing dispatched — the filter is the cause");
  assert.equal(rounds[rounds.length - 1].in_flight, 0, "nothing in flight");
  await drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（node:test after 钩按注册序 FIFO：rmSync 先注册会先于 drv.stop 运行 ⇒ 驱动仍在写 round/cnt ⇒ ENOTEMPTY；stop 现 await 'exit'）
});

test("AC1 对照 — dep done ⇒ the candidate IS dispatched (the filter is the difference, not a blanket stop)", async (t) => {
  const root = makeGitRoot("ac1-deps-ok");
  writeTaskFile(root, "gap-prereq", "done");
  fs.writeFileSync(path.join(root, "tasks", "gap-dep.md"), "---\nid: gap-dep\nstatus: done\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  runGit(root, ["add", "tasks/gap-dep.md"]);
  runGit(root, ["commit", "-q", "-m", "dep done"]);
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-dep']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-dep\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readOutcomeLines(root).length >= 1, 5000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC1 对照: dep-done candidate IS dispatched (exactly once)");
  assert.equal(spawned[0].task, "gap-dep");
  assert.equal(readOutcomeLines(root)[0].final_state, "completed", "the dep-done candidate lands cleanly");
  await drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（node:test after 钩按注册序 FIFO：rmSync 先注册会先于 drv.stop 运行 ⇒ 驱动仍在写 round/cnt ⇒ ENOTEMPTY；stop 现 await 'exit'）
});

// ── gap-worker-driver-cold-start-inflight-blind：冷启动在飞盲区 ───────────────────────────────────
// restart / supervisor 崩溃自动 respawn 后，新驱动的 running 是纯内存数组、从空集起，不认得重启前
// 就存活的 worker ⇒ 重复派发（撞同一 worktree），重复者被杀后 failed 终态又触发
// cleanupOrphanWorktree 误删原 worker 仍在用的共享 worktree+分支。修法 = 冷启动枚举「worktree 在 ∧
// 存活 worker 在」的 task 进排除集 + cleanupOrphanWorktree 存活校验。

test("cold-start pure — enumerateColdStartInflight / hasLiveWorkerForTask: worktree ∧ live worker ⇒ in-flight; worktree-only ⇒ orphan", (t) => {
  const root = makeRoot("coldstart-pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = "claude-fjdac --settings x --model m -n quay-task-worker -p '... Task: gap-cs-a ...'";

  // worktree + live worker ⇒ in-flight；只有 worktree 无进程 ⇒ orphan（不排除）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: ["gap-cs-a", "gap-cs-b"], workerCmdlines: [live] })].sort(),
    ["gap-cs-a"],
    "only the task with BOTH a worktree and a live worker is in-flight (gap-cs-b is an orphan worktree)",
  );
  // worktree 但无存活 worker ⇒ 空（orphan 可重派、可清——正是交叉核对的意义）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: ["gap-cs-a"], workerCmdlines: [] })],
    [],
    "a worktree without a live worker is an orphan — NOT excluded from dispatch",
  );
  // 无 task worktree ⇒ 空（⛔ 短路，不白扫 /proc）。
  assert.deepEqual(
    [...enumerateColdStartInflight(root, { worktreeTasks: [], workerCmdlines: [live] })],
    [],
    "no task worktree ⇒ nothing in-flight",
  );

  // hasLiveWorkerForTask 纯谓词：cmdline 须同时含 quay-task-worker 与 task id。
  assert.equal(hasLiveWorkerForTask("gap-cs-a", [live]), true);
  assert.equal(hasLiveWorkerForTask("gap-cs-a", ["node -e x quay-task-worker gap-zzz"]), false, "wrong task id ⇒ not a live worker for this task");
  assert.equal(hasLiveWorkerForTask("gap-cs-a", ["node -e x gap-cs-a"]), false, "no quay-task-worker name ⇒ not a worker");

  // ⛔ 词边界回归（2026-08-24 实测假阳性）：短 id `gap-t` 不得作为前缀命中 `gap-test-…` 的存活 worker。
  const gapTestWorker = "claude -n quay-task-worker -p '... Task: gap-test-fixture-pollutes-bash-history ...'";
  assert.equal(hasLiveWorkerForTask("gap-t", [gapTestWorker]), false, "gap-t must NOT match gap-test-… (word boundary, not substring)");
  assert.equal(hasLiveWorkerForTask("gap-test-fixture-pollutes-bash-history", [gapTestWorker]), true, "the full id matches its own worker");
});

test("enumerateTaskWorktreeTasks — lists task/<id> branches, skips the main checkout + non-task branches", (t) => {
  const root = makeGitRoot("coldstart-enum");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-enum`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-enum-a", "ready");
  assert.deepEqual(enumerateTaskWorktreeTasks(root), [], "no task worktree yet (main checkout's branch is not a task branch)");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-enum-a", wtPath]);
  assert.deepEqual(enumerateTaskWorktreeTasks(root), ["gap-enum-a"], "the task/<id> worktree is enumerated");
});

test("enumerateLiveWorkerCmdlines — real /proc scan finds a spawned fake worker (fail-soft otherwise)", async (t) => {
  const fake = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-proc-scan"], { stdio: "ignore" });
  t.after(() => { try { fake.kill("SIGKILL"); } catch { /* already gone */ } });
  await new Promise((r) => setTimeout(r, 50));
  const cmdlines = enumerateLiveWorkerCmdlines();
  assert.ok(
    cmdlines.some((c) => c.includes(WORKER_PROCESS_NAME) && c.includes("gap-proc-scan")),
    "the spawned fake worker's cmdline is found by the /proc scan",
  );
  // fail-soft：非 /proc 目录 ⇒ []（硬规则 3b：读不懂 ≠ 无存活，但绝不抛）。
  assert.deepEqual(enumerateLiveWorkerCmdlines("/nonexistent-proc-dir"), []);
});

test("AC1 (cold-start) — surviving worker + its worktree ⇒ resident loop does NOT re-dispatch that task", async (t) => {
  const root = makeGitRoot("coldstart-ac1");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-cs`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });

  // 幸存 worker 的 worktree（branch task/gap-cs-a）——旧 driver 已 fork、新 driver 冷启动前就在。
  writeTaskFile(root, "gap-cs-a", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-a"), true, "precondition: survivor worktree present");

  // 存活 worker 进程（cmdline 同时含 quay-task-worker 与 task id——/proc 扫描靠它识别）。
  const fakeWorker = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-cs-a"], { stdio: "ignore" });
  t.after(() => { try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ } });

  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cs-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cs-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 5000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC1: surviving worker's task is NOT re-dispatched");
  const cs = drv.events().find((e) => e.event === "cold-start-inflight");
  assert.ok(cs, "the cold-start in-flight enumeration is recorded (not silent)");
  assert.deepEqual(cs.tasks, ["gap-cs-a"], "the survivor is the enumerated in-flight task");
  assert.equal(readOutcomeLines(root).length, 0, "zero outcomes — nothing dispatched");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（同 dep-done 对照：rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});

test("AC1 对照 — orphan worktree (no live worker) ⇒ the task IS re-dispatched (the live-worker cross-check is the difference)", async (t) => {
  const root = makeGitRoot("coldstart-neg");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-neg`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cs-b", "done");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-b", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-b"), true, "precondition: orphan worktree present (no live worker)");

  // 无存活 worker ⇒ 冷启动枚举为空 ⇒ gap-cs-b 不被排除 ⇒ 会被派发（worker-spawned 出现）。
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-cs-b']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-cs-b\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 5000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "orphan worktree alone does NOT block re-dispatch — the task IS dispatched");
  assert.equal(spawned[0].task, "gap-cs-b");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});

test("AC2 (cold-start) — cleanupOrphanWorktree skips a worktree a live worker is using; cleans a true orphan", (t) => {
  const root = makeGitRoot("coldstart-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cs-c", "ready");
  runGit(root, ["branch", "develop"]); // 基准分支 = develop（生产一致）；git log develop..task/<id> 判产出需要它存在
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-c", wtPath]);

  const liveCmdline = "claude -n quay-task-worker -p '... Task: gap-cs-c ...'";
  // 存活 worker 正在用 ⇒ 跳过（skippedLiveWorker=true，removed=false，worktree 仍在）。
  const skipped = cleanupOrphanWorktree(root, "gap-cs-c", [liveCmdline]);
  assert.equal(skipped.removed, false, "AC2: not removed while a live worker uses it");
  assert.equal(skipped.skippedLiveWorker, true, "the skip is reported as skippedLiveWorker (not 'removed', not 'no worktree')");
  assert.equal(skipped.error, null);
  assert.equal(worktreePresentForTask(root, "gap-cs-c"), true, "the shared worktree survives (not deleted)");

  // 无存活 worker（真 orphan）⇒ 清理（对照，证明 skip 是存活校验在起作用，不是永远不清）。
  const cleaned = cleanupOrphanWorktree(root, "gap-cs-c", []);
  assert.equal(cleaned.removed, true, "a true orphan (no live worker) IS cleaned");
  assert.equal(cleaned.skippedLiveWorker, false);
  assert.equal(worktreePresentForTask(root, "gap-cs-c"), false, "orphan worktree removed");
});

// ── gap-worker-driver-cold-start-inflight-refresh：冷启动在飞集合每趟 pass 现观测 ────────────────────
// 原 gap-worker-driver-cold-start-inflight-blind 只修了「冷启动 ⇒ 不重复派发」一个方向：enumerateColdStartInflight
// 在 while(true) 之前 const 冻结一次、全生命周期不刷新 ⇒ 冷启动 worker 结束后其 task 仍永久假在飞、
// 该 driver 余生不可派。修法 = 每趟 pass 现观测（SPEC §5.2 actual=observe()）。AC1（原有方向，保绿）+
// AC2（承重条·原缺的那半）+ AC3（现观测，无循环外 const 快照）逐条取假。

test("AC2 (cold-start-refresh) — survivor finishes ⇒ its task leaves the exclusion set and IS re-dispatched (same driver process)", async (t) => {
  const root = makeGitRoot("coldstart-ac2-refresh");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2r`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-cs-a", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-cs-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-cs-a"), true, "precondition: survivor worktree present");

  // 幸存 worker 进程（旧 driver 所 fork、冷启动前就在）。
  const fakeWorker = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, "gap-cs-a"], { stdio: "ignore" });
  t.after(() => { try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ } });

  // ready-pool 持续给 gap-cs-a 候选、selector 持续选它；冷启动在飞时被排除，worker 结束后重新可派。
  // --concurrency 1 + 派发后的 worker 长跑（不退出）⇒ 只派发一次，无重派循环（spawned.length===1 可断言）。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cs-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cs-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());

  // Phase 1: 冷启动发现幸存 worker ⇒ 不派发（排除集挡住，⛔ 不是池空——round 记录 pool=1 证明候选在）。
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 5000);
  const cs = drv.events().find((e) => e.event === "cold-start-inflight");
  assert.ok(cs, "the cold-start enumeration is observed (recorded)");
  assert.deepEqual(cs.tasks, ["gap-cs-a"], "the survivor is the enumerated in-flight task");
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC2 phase 1: survivor not re-dispatched while its worker is alive");

  // Phase 2: 幸存 worker 退出 + worktree 消失（模拟其 fan-in 落地）⇒ 现观测使 task 离开排除集 ⇒
  //   同一 driver 进程内重新可派。⛔ 冻结快照（旧缺陷）下此步恒不派 ⇒ 假。
  try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ }
  try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 5000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC2: exactly one re-dispatch after the survivor finished (concurrency 1 + long-running worker ⇒ no re-dispatch loop)");
  assert.equal(spawned[0].task, "gap-cs-a", "the re-dispatched task is the former cold-start survivor");
  drv.stop(); // 先停驱动再让 after 钩 rmSync 删目录（rmSync 先注册会先于 drv.stop 运行 ⇒ ENOTEMPTY 跳过 drv.stop ⇒ 驱动泄漏挂死）
});

test("AC3 (cold-start-refresh) — per-pass observation: no one-time `const coldInflight` snapshot outside the loop; reassigned each pass", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.doesNotMatch(src, /const\s+coldInflight\s*=/, "AC3: the one-time `const coldInflight` snapshot is gone (⛔ frozen snapshot ⇒ fake in-flight forever)");
  assert.match(src, /let\s+coldInflight\s*=\s*new Set/, "coldInflight is a mutable per-pass binding, not a frozen snapshot");
  assert.match(src, /coldInflight\s*=\s*await\s+enumerateColdStartInflightAsync\(rootDir\)/, "coldInflight is re-observed via enumerateColdStartInflightAsync each pass (async — 不阻塞地板)");
});

// ── gap-archguard-structural-gate-in-fan-in-driver：archguard 结构闸接进机械 fan-in ──────────────

test("AC1 (gap-archguard-structural-gate-in-fan-in-driver) — runMechanicalFanIn 在 typecheck 后、scoped门 前接 archguard 结构闸（step=archguard-structure），带 archguardCommand 测试缝", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 步骤顺序按位置判定（⛔ 不按关键词）：typecheck（第 5 步）→ archguard（第 5.5 步）→ scoped门（第 6 步）。
  const typecheckIdx = src.indexOf("// 5. ts-typecheck 闸");
  const archguardIdx = src.indexOf("// 5.5 archguard 结构闸");
  const scopedIdx = src.indexOf("// 6. scoped 门 + doc 检查");
  assert.ok(typecheckIdx !== -1 && archguardIdx !== -1 && scopedIdx !== -1, "all three step markers must be present");
  assert.ok(typecheckIdx < archguardIdx && archguardIdx < scopedIdx, `archguard must sit between typecheck and scoped门 (${typecheckIdx} < ${archguardIdx} < ${scopedIdx})`);
  assert.match(src, /archguardCommand\?/, "the archguardCommand test seam is declared on MechanicalFanInOptions");
  assert.match(src, /fail\("archguard-structure"/, "dependency-cycle red returns step=archguard-structure");
  assert.match(src, /archguard-runner\.ts/, "the default archguard command references archguard-runner.ts");
});

// ── gap-worker-driver-stopreason-latch-permanent-stop ──────────────────────────────────────────────
// stopReason 一旦赋值永不复位 ⇒ 瞬时闸拒绝（resource-gate-wait）被永久 latch ⇒ 同一 driver 进程内
// 恢复不可能 ⇒ 1h48m 零派发（234 槽·分钟）。修法：WAIT（瞬时）不 latch、下一轮重读 stopCondition；
// 终态（mcp-halt）才 latch；running.length===0 且瞬时 WAIT 时不退出、等 --interval 重读。AC1-3 逐条取假。

test("parseIntervalMs — default 30000; small value; invalid ⇒ default (fail-closed to the default cadence)", () => {
  assert.equal(RESIDENT_INTERVAL_MS_DEFAULT, 30000);
  assert.equal(parseIntervalMs(undefined), RESIDENT_INTERVAL_MS_DEFAULT);
  assert.equal(parseIntervalMs("25"), 25);
  assert.equal(parseIntervalMs("abc"), RESIDENT_INTERVAL_MS_DEFAULT, "invalid ⇒ default");
  assert.equal(parseIntervalMs("-5"), RESIDENT_INTERVAL_MS_DEFAULT, "negative ⇒ default");
});

// ── gap-worker-driver-reconcile-interval：协调地板（SPEC §5.5）───────────────────────────────────────
// 边沿触发（worker 退出）+ 存储决策 = 1h48m 停摆形态。地板 = 至少每 reconcileMs 协调一次，边沿事件全丢
// 也降级「慢但正确」而非「静默停摆」。AC1（地板触发 + 生产载体）/ AC2（全边沿失效仍派发）逐条取假。

test("parseReconcileIntervalSecs — default 300s (conservative); small; invalid ⇒ default", () => {
  assert.equal(RECONCILE_INTERVAL_SECS_DEFAULT, 300);
  assert.equal(parseReconcileIntervalSecs(undefined), 300_000, "default = 300s → 300000ms");
  assert.equal(parseReconcileIntervalSecs("5"), 5_000, "5s → 5000ms");
  assert.equal(parseReconcileIntervalSecs("abc"), 300_000, "invalid ⇒ default");
  assert.equal(parseReconcileIntervalSecs("-3"), 300_000, "negative ⇒ default");
});

test("AC1 (gap-worker-driver-reconcile-interval) — in-process timer re-coordinates every ≤N s with zero worker-exit edge events (carrier = worker-round.jsonl, ⛔ not --json)", async (t) => {
  const root = makeGitRoot("reconcile-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-r", "done");
  // ⛔ spawn WITHOUT --json: the floor's observable carrier must be .quay/worker-round.jsonl
  // (writeRound → appendRoundToFile 无条件写文件，与 --json 无关——生产 argv 无 --json，硬规则 3b）。
  const child = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-r'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-r\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 挂起：worker 退出这个边沿事件永不发生
    "--concurrency", "1",
    "--reconcile-interval", "1",  // 地板每 1s
    "--interval", "100",          // idle 轮询（在飞时不走这条，无害）
  ], { stdio: ["ignore", "ignore", "ignore"] });
  t.after(() => { if (child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* gone */ } } });

  // 挂起的 worker 只派发一次；之后地板每 ~1s 唤醒循环 ⇒ round 记录持续累积（无 worker 退出边沿事件）。
  await waitFor(() => readRoundLines(root).length >= 3, 10000);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 3, "AC1: floor wrote ≥3 round records with zero worker-exit edge events (production carrier, ⛔ not --json)");
  assert.ok(rounds.some((r) => r.in_flight >= 1), "the round records carry an in-flight worker (the floor is exercised in the in-flight branch, ⛔ not the idle poll)");
  child.kill("SIGKILL");
});

test("AC2 (gap-worker-driver-reconcile-interval) — all edge events lost (worker hangs) ⇒ floor still re-runs ready pool and dispatches within N s", async (t) => {
  const root = makeGitRoot("reconcile-ac2");
  writeTouchedTask(root, "gap-a", "plugin/scripts/aa.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/bb.ts"); // disjoint from gap-a
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    // ready-pool: pass1 的两次调用（派发 gap-a + pool-empty）都只给 gap-a；pass2 地板唤醒才给 gap-b。
    // 用计数器而非 marker 文件——marker 的写入时刻与 pass1 第二次 ready-pool 的 spawn 竞态（gap-b 会提前在 pass1 派发）。
    "--ready-pool-cmd", counterNodeE(rpcFile, "n>=2?JSON.stringify({ready:['gap-a','gap-b'],pool:2}):JSON.stringify({ready:['gap-a'],pool:1})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':'gap-b\\x20second'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 两个 worker 都挂起：worker 退出边沿事件永不发生
    "--concurrency", "2",
    "--reconcile-interval", "1",
    "--interval", "100",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // gap-a 先派发（挂起）。此后无任何 worker 退出边沿事件。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-a"), 5000);
  // 地板（⛔ 不是 worker 退出）唤醒循环 ⇒ 重读 ready 池 ⇒ 派发 gap-b。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-b"), 10000);
  const picks = drv.events().filter((e) => e.event === "selector-picked").map((e) => e.task);
  assert.ok(picks.includes("gap-b"), `AC2: floor re-ran ready pool and dispatched gap-b with zero worker-exit edge events (picks=${picks.join(",")})`);
  await drv.stop();
});

// ── gap-worker-driver-async-selector-readypool：循环体 spawnSync→spawn（selector/readyPool/liveness/git）──
// 常驻循环体里任何 spawnSync 都会冻住协调地板（一个卡住的 selector / git 会连 setTimeout 地板一起冻住，
// SPEC §5.7）。AC1（循环体异步化，能取假 = 源面静态检查 + 慢 selector 下地板仍触发）/ AC2（child exit 唤醒
// 循环 = 异步版在子进程退出后 resolve）/ AC3（协调一趟有界，慢 selector 不冻住地板）逐条取假。

test("AC1 (gap-worker-driver-async-selector-readypool) — loop body's worker-argv construction is async (⛔ sync workerArgvForTask → continueStateForTask spawnSync git freezes the floor)", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // spawnSelected 是 async 且 await 异步 argv 构造（workerArgvForTaskAsync），⛔ 不再是同步 workerArgvForTask。
  assert.match(src, /const spawnSelected = async \(sel: \{ task: string; reason: string \}\): Promise<void>/, "spawnSelected is async");
  assert.match(src, /await workerArgvForTaskAsync\(sel\.task, rootDir, workerCmdOpts\)/, "spawnSelected awaits workerArgvForTaskAsync");
  assert.doesNotMatch(src, /workerArgv: workerArgvForTask\(sel\.task, rootDir, workerCmdOpts\)/, "the sync workerArgvForTask (continueStateForTask spawnSync git) is gone from the loop body");
  // 异步变体齐全，且 git 读走 runAsync（spawn，⛔ 非 spawnSync）。
  for (const name of ["worktreePresentForTaskAsync", "worktreePathsForTaskAsync", "countBranchCommitsAsync", "branchHeadSubjectAsync", "continueStateForTaskAsync", "workerPromptForTaskAsync", "workerArgvForTaskAsync"]) {
    assert.match(src, new RegExp(`export async function ${name}`), `${name} is defined`);
  }
  assert.match(src, /const r = await runAsync\(\["git", "-C", root, "worktree", "list", "--porcelain"\]/, "worktree async variants route through runAsync (spawn), not spawnSync");
  assert.match(src, /await continueStateForTaskAsync\(/, "continueStateForTaskAsync gathers state via async git reads (awaited)");
});

test("AC2 (gap-worker-driver-async-selector-readypool) — async variants resolve on child exit (runAsync close wakes the await); parity with sync continueStateForTask", async (t) => {
  const root = makeGitRoot("async-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["branch", "-D", "task/gap-as2"]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  const body = `---\nid: gap-as2\nstatus: ready\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 done\n- [ ] AC2 todo\n`;
  fs.writeFileSync(path.join(root, "tasks", "gap-as2.md"), body);
  runGit(root, ["add", "tasks/gap-as2.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-as2"]);

  // 无 worktree ⇒ 异步创建路径（`git worktree list` 的 child exit 唤醒 await ⇒ false，不是挂起）。
  assert.equal(await worktreePresentForTaskAsync(root, "gap-as2"), false, "async git worktree list resolves (child exit wakes await)");
  assert.equal((await workerPromptForTaskAsync("gap-as2", root)).includes("create an isolated git worktree"), true, "no worktree ⇒ create prompt (async)");

  // 保留 worktree ⇒ 异步续做路径（git rev-list / log 在 child exit 后 resolve）。
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-as2", wtPath]);
  fs.writeFileSync(path.join(wtPath, "impl.txt"), "implemented");
  runGit(wtPath, ["add", "impl.txt"]);
  runGit(wtPath, ["commit", "-q", "-m", "implement gap-as2"]);

  assert.equal(await countBranchCommitsAsync(root, "gap-as2"), 1, "async rev-list resolves on child exit");
  assert.equal(await branchHeadSubjectAsync(root, "gap-as2"), "implement gap-as2", "async git log resolves on child exit");
  const st = await continueStateForTaskAsync(root, "gap-as2");
  assert.ok(st != null, "async continue state gathered");
  assert.equal(st.branchCommits, 1, "async state carries own commit count (parity with sync continueStateForTask)");
  assert.equal(st.acChecked, 1, "async state carries AC checked");
  const cont = await workerPromptForTaskAsync("gap-as2", root);
  assert.match(cont, /CONTINUE \(reuse/, "async continue prompt reuses the worktree");
  writeProfileCarrier(root); // L3: 默认 argv 经 policy 需要 profiles.yml + settings 载体
  const argv = await workerArgvForTaskAsync("gap-as2", root, { prefix: null, exact: null });
  assert.equal(argv[0], "claude", "async worker argv resolves via policy to the profile launcher (⛔ bash quay-launch.sh)");
  assert.match(argv[argv.length - 1], /CONTINUE \(reuse/, "async continue prompt is the argv payload");
});

test("AC3 (gap-worker-driver-async-selector-readypool) — a slow selector does not freeze the floor (round heartbeat keeps firing while the selector is slow)", async (t) => {
  const root = makeGitRoot("async-ac3");
  writeTouchedTask(root, "gap-a", "plugin/scripts/aa.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/bb.ts");
  // selector 慢（sleep 2s 后才输出 gap-b）。cap=2 + gap-a 在飞（挂起）⇒ selector 在 pass1 跑一次派 gap-b；
  // 之后两个 worker 都挂起（无 worker 退出边沿事件）⇒ 只有地板（--reconcile-interval 1）让循环活着。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a','gap-b'],pool:2}))",
    "--selector-cmd", "node -e setTimeout(()=>console.log('gap-b\\x20slow-pick'),2000)",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e setTimeout(()=>{},60000)", // 两个 worker 都挂起
    "--concurrency", "2",
    "--reconcile-interval", "1",
    "--interval", "100",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 慢 selector 派发 gap-b（约 2s），然后地板在 ~1s 节奏继续写 round 心跳（⛔ 慢 selector 没冻住地板）。
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-b"), 10000);
  await waitFor(() => readRoundLines(root).length >= 3, 10000);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 3, `AC3: the floor kept writing round heartbeats despite the 2s-slow selector (rounds=${rounds.length})`);
  assert.ok(rounds.some((r) => r.in_flight >= 1), "the round records carry in-flight workers (floor exercised in the in-flight branch)");
  await drv.stop();
});

test("AC1 (gap-worker-driver-stopreason-latch-permanent-stop) — gate first WAIT then GO ⇒ the SAME driver process (no restart) recovers dispatch", async (t) => {
  const root = makeGitRoot("stop-latch-ac1");
  writeTaskFile(root, "gap-ac1", "done");
  // gate: WAIT (exit 1) while the go-marker file is absent; GO (exit 0) once the test writes it.
  const goFile = path.join(root, "gate.go");
  const gateCmd = `node -e require('fs').existsSync(${JSON.stringify(goFile)})?process.exit(0):(console.log('{"verdict":"WAIT","reason":"load-high"}'),process.exit(1))`;
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-ac1']:[],pool:n===0?1:0})"),
    "--selector-cmd", "node -e console.log('gap-ac1\\x20pick')",
    "--resource-gate-cmd", gateCmd,
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Phase 1: gate WAIT ⇒ no worker dispatched, and the driver does NOT exit (polls, ⛔ not latch).
  await waitFor(() => readRoundLines(root).length >= 1, 5000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "gate WAIT ⇒ no dispatch yet");
  assert.equal(drv.child.exitCode, null, "transient WAIT did not exit the driver");

  // Phase 2: release the gate — the SAME process must recover and dispatch (stopReason 不复位即恒不派 ⇒ 假).
  fs.writeFileSync(goFile, "go\n");
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 5000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC1: gate-open recovered dispatch in the SAME driver process (no restart)");
  assert.equal(spawned[0].task, "gap-ac1");
  await waitFor(() => readOutcomeLines(root).length >= 1, 5000);
  assert.equal(readOutcomeLines(root)[0].final_state, "completed", "the recovered dispatch lands cleanly");
  await drv.stop();
});

test("AC2 (gap-worker-driver-stopreason-latch-permanent-stop) — adjacent stop rounds re-acquire the resource reading (⛔ not byte-identical)", async (t) => {
  const root = makeRoot("stop-latch-ac2");
  // gate: always WAIT (exit 1) but each call prints an incrementing reading ⇒ stop_reason differs per round.
  const gateCnt = path.join(root, "gate.cnt");
  const f = JSON.stringify(gateCnt);
  const gateCmd = `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log('load='+n);process.exitCode=1`;
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-x\\x20pick')",
    "--resource-gate-cmd", gateCmd,
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 3, 5000);
  const stops = readRoundLines(root).filter((r) => r.action === "stop");
  assert.ok(stops.length >= 2, "at least two stop rounds written (the driver re-reads the gate each poll)");
  assert.match(stops[0].stop_reason, /resource-gate-wait/);
  assert.match(stops[1].stop_reason, /resource-gate-wait/);
  assert.notEqual(stops[0].stop_reason, stops[1].stop_reason, "AC2: adjacent stop readings differ (re-acquired each round, ⛔ not latched byte-identical)");
  await drv.stop();
});

test("AC3 (gap-worker-driver-stopreason-latch-permanent-stop) — pool non-empty + transient WAIT + running.length===0 ⇒ driver does NOT exit directly", async (t) => {
  const root = makeRoot("stop-latch-ac3");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-ac3'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-ac3\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(1)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await waitFor(() => readRoundLines(root).length >= 3, 5000);
  assert.equal(drv.child.exitCode, null, "AC3: pool non-empty + gate WAIT + no in-flight ⇒ driver does NOT exit directly");
  const stops = readRoundLines(root).filter((r) => r.action === "stop");
  assert.ok(stops.length >= 2, "AC3: the driver polled (≥2 stop rounds) — it did not exit after the first WAIT round");
  await drv.stop();
});

// ── gap-worker-driver-retry-cap-not-wired：worker 重试上限接线 ─────────────────────────────────────
// 根因：driver-filters.ts:9 明写「retryCapNotExhausted promotion 有 worker 无」，worker 的
// retryExhausted 恒空集 ⇒ exited-not-landed 任务无限重派（实证 split-long flaky 红 7 次 501 分钟）。
// 修法：worker 从 exited-not-landed 计数派生 retryExhausted（同 promotion 的 RetryState 形态），
// 达上限标 needs-human（ready→needs-human）并停止重派。复用 driver-filters.ts 的 advanceRetryCap /
// markNeedsHuman / retryCapNotExhausted（⛔ 不各写一遍）。

test("AC1 (gap-worker-driver-retry-cap-not-wired) — parseMaxRetries: default 3, explicit N, invalid ⇒ default", () => {
  assert.equal(RETRY_CAP_DEFAULT, 3, "default retry cap = 3 (gap-fan-in-relaunch-retry-cap 同值)");
  assert.equal(parseMaxRetries(undefined), 3, "no --max-retries ⇒ default");
  assert.equal(parseMaxRetries("2"), 2, "explicit N honored");
  assert.equal(parseMaxRetries("0"), 3, "non-positive ⇒ default (fail-to-default, ⛔ 不因 flag 拼写炸循环)");
  assert.equal(parseMaxRetries("1.5"), 3, "non-integer ⇒ default");
  assert.equal(parseMaxRetries("garbage"), 3, "garbage ⇒ default");
});

test("AC1 (gap-worker-driver-retry-cap-not-wired) — retryExhausted 非空派生：advanceRetryCap 填集合 + retryCapNotExhausted 滤掉（能取假）", (t) => {
  const root = makeRoot("retry-derive");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 写两个 ready 候选（filter 只读 frontmatter/status，body 无需满四件套）。
  fs.writeFileSync(path.join(root, "tasks", "gap-a.md"), "---\nid: gap-a\nstatus: ready\n---\n\n## Proposal\n\nprose\n");
  fs.writeFileSync(path.join(root, "tasks", "gap-b.md"), "---\nid: gap-b\nstatus: ready\n---\n\n## Proposal\n\nprose\n");

  const state = { counts: new Map(), needsHuman: new Set() };
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), [], "1st exited-not-landed < N ⇒ not yet needs-human");
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), ["gap-a"], "2nd exited-not-landed ≥ N ⇒ needsHuman 非空");
  assert.ok(state.needsHuman.size === 1 && state.needsHuman.has("gap-a"), "retryExhausted 集合非空派生（⛔ 恒空集 ⇒ 假）");

  // retryExhausted 非空 ⇒ retryCapNotExhausted 把 gap-a 滤掉、gap-b 保留（接线生效，⛔ 不再无限重派）。
  const filtered = applyTaskFilters(["gap-a", "gap-b"], makeFilterContext(root, { retryExhausted: state.needsHuman }));
  assert.deepEqual(filtered, ["gap-b"], "capped gap-a is filtered out; uncapped gap-b passes");
});

test("AC1 (gap-worker-driver-retry-cap-not-wired) — markNeedsHuman flips ready→needs-human（worker 重派的是 ready 任务，非 todo）", (t) => {
  const root = makeRoot("mark-ready");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "tasks", "gap-cap.md"), "---\nid: gap-cap\nstatus: ready\n---\n\n## Proposal\n\nprose\n");

  const res = markNeedsHuman(root, "gap-cap", "worker 连续 N 次 exited-not-landed 未落地");
  assert.equal(res.ok, true, "ready task marked needs-human");
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "status flipped ready → needs-human");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-cap.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "grep-able ## Needs-Human audit record written");
  assert.ok(body.includes("worker 连续 N 次 exited-not-landed 未落地"), "the reason is recorded in the body");

  // needs-human 已是终态 ⇒ 拒写（同 promotion 的 fail-closed，⛔ 双标）。
  const again = markNeedsHuman(root, "gap-cap", "again");
  assert.equal(again.ok, false);
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "status unchanged on refusal");
});

test("AC2 (gap-worker-driver-retry-cap-not-wired) — 反复 exited-not-landed 的任务在 N 次后停（不再无限重派，负控制）", async (t) => {
  const root = makeGitRoot("retry-cap");
  writeTaskFile(root, "gap-cap", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cap'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cap\\x20flaky-red')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--max-retries", "2",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // N=2 次 exited-not-landed（exit 0 但 status=ready 未落地）。
  // ⛔ 满载下 2 次 worker spawn + 落地判定的等待窗放宽到 60s（同 5045b9ab9 的 liveness 窗）——
  // 全量 suite concurrency=16 时驱动冷启动 + node spawn 可 >8s，8s 窗把「慢而正确」误判为「只派 1 次」。
  await waitFor(() => readOutcomeLines(root).length >= 2, 60000);
  const records = readOutcomeLines(root);
  assert.deepEqual(records.map((r) => r.final_state), ["exited-not-landed", "exited-not-landed"],
    "AC2: both attempts exited-not-landed (exit 0 but status=ready not done)");

  // 达上限 ⇒ 标 needs-human（ready→needs-human）+ ## Needs-Human 审计记录。
  await waitFor(() => readTaskStatus(root, "gap-cap") === "needs-human", 60000);
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "AC2: task marked needs-human after N exited-not-landed");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-cap.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC2: ## Needs-Human audit record written");

  // 负控制：给驱动一个「可能第 3 次派发」的窗口，再断言仍只有 N=2 次派发（⛔ 无限重派）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 60000);
  await new Promise((r) => setTimeout(r, 400));
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC2: exactly N=2 dispatches — the capped task is not re-dispatched (⛔ 无限重派)");
  assert.equal(readOutcomeLines(root).length, 2, "AC2: still exactly 2 outcomes — no 3rd attempt wrote a record");
});

test("AC3 (gap-worker-driver-retry-cap-not-wired) — promotion 不回归：同一函数身份 + 缺省同值", () => {
  assert.equal(advanceRetryCap, promoAdvanceRetryCap, "AC3: promotion re-exports the SAME advanceRetryCap (⛔ 非平行副本)");
  assert.equal(markNeedsHuman, promoMarkNeedsHuman, "AC3: promotion re-exports the SAME markNeedsHuman (⛔ 非平行副本)");
  assert.equal(MAX_FIX_RETRIES_DEFAULT, RETRY_CAP_DEFAULT, "AC3: promotion --max-fix-retries 缺省 = 共享 RETRY_CAP_DEFAULT（单一真相源）");
});

// ── gap-worker-driver-selector-api-error-no-backoff：selector API 错误/快速死亡无退避 ───────────────
// 根因：worker-driver 对 selector API 错误 / fallback 失败的【快速死亡】（<60s 墙钟）无退避——17:22–17:56
// 两任务 54 次「worker exited with code 1」全部 <60s 快速重派，纯烧派发预算（subagent spawn 预算 / 会话累计）。
// 修法：worker <quickDeathMs 连续死亡 ≥backoffThreshold 次 ⇒ 对该 task 指数退避（backoffUntil，⛔ 不立即重派），
// 间隔随次数增长、封顶 maxBackoffMs；退避到上限（maxRetries，复用现有重试上限机制）⇒ markNeedsHuman。
// 退避状态按 task 记（⛔ 不全局）。⛔ 不修模型名（a7a507eab 已治「为什么 400」）。

test("AC1 pure (gap-worker-driver-selector-api-error-no-backoff) — isQuickDeath: failed/spawn-failed/killed + <quickDeathMs ⇒ 快速死亡；completed/exited-not-landed/timed-out 不算", () => {
  assert.equal(isQuickDeath("failed", 59_999), true, "failed + <60s ⇒ quick death");
  assert.equal(isQuickDeath("spawn-failed", 0), true, "spawn-failed ⇒ quick death");
  assert.equal(isQuickDeath("killed", 1000), true, "killed ⇒ quick death");
  assert.equal(isQuickDeath("failed", 60_000), false, "wall ≥ quickDeathMs ⇒ not quick death（⛔ 慢速失败不进快速死亡桶）");
  assert.equal(isQuickDeath("completed", 1000), false, "completed is never quick death");
  assert.equal(isQuickDeath("exited-not-landed", 1000), false, "exited-not-landed has its own retry-cap（⛔ 与既有机制重叠计数）");
  assert.equal(isQuickDeath("timed-out", 1000), false, "timed-out has its own semantics");
});

test("AC1 pure — backoffDelayMs 指数增长 + 封顶 maxBackoffMs（⛔ 无限增长 ⇒ 假）", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 30_000, maxBackoffMs: 300_000 };
  assert.equal(backoffDelayMs(1, cfg), 30_000, "consecutive=1 (threshold=1) ⇒ base");
  assert.equal(backoffDelayMs(2, cfg), 60_000, "2nd ⇒ 2×base（随次数增长）");
  assert.equal(backoffDelayMs(3, cfg), 120_000, "3rd ⇒ 4×base");
  assert.equal(backoffDelayMs(4, cfg), 240_000, "4th ⇒ 8×base");
  assert.equal(backoffDelayMs(5, cfg), 300_000, "5th ⇒ capped at maxBackoffMs");
  assert.equal(backoffDelayMs(99, cfg), 300_000, "never grows past maxBackoffMs");
});

test("AC1+AC3 pure — recordQuickDeathBackoff: 退避按 task、间隔随次数增长、到上限转 needsHuman、非快速死亡复位", () => {
  const state = newQuickDeathBackoffState();
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  // 1st quick death → backed off, delay = base（1000ms）。
  const r1 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 100_000, 3, cfg);
  assert.equal(r1.quickDeath, true);
  assert.equal(r1.backedOff, true, "1st quick death (≥threshold=1) ⇒ backed off");
  assert.equal(r1.newlyNeedsHuman, false);
  assert.equal(state.backoffUntil.get("gap-a"), 101_000, "1st backoff until = now + base");
  assert.equal(isBackedOff(state, "gap-a", 100_000), true, "backed off at now");
  assert.equal(isBackedOff(state, "gap-a", 100_999), true, "still backed off just before expiry");
  assert.equal(isBackedOff(state, "gap-a", 101_000), false, "backoff elapsed ⇒ eligible again");
  // 2nd quick death → backoff grows（2×base）。
  const r2 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 200_000, 3, cfg);
  assert.equal(r2.backedOff, true);
  assert.equal(state.backoffUntil.get("gap-a"), 202_000, "2nd backoff = now + 2×base（随次数增长）");
  // 3rd quick death → cap → needsHuman（⛔ 不无限退避）。
  const r3 = recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 300_000, 3, cfg);
  assert.equal(r3.newlyNeedsHuman, true, "3rd quick death ≥ maxRetries ⇒ needsHuman");
  assert.equal(r3.backedOff, false, "needsHuman ⇒ no more backoff（notNeedsHuman 过滤停止重派）");
  assert.equal(state.backoffUntil.get("gap-a"), undefined, "backoff cleared on needsHuman");
  // 非快速死亡复位（「连续」断链）：quick death 后再活过 quickDeathMs ⇒ 计数清零。
  const s2 = newQuickDeathBackoffState();
  recordQuickDeathBackoff(s2, "gap-b", "failed", 5000, 100_000, 3, cfg);
  assert.equal(s2.counts.get("gap-b"), 1, "one quick death counted");
  const reset = recordQuickDeathBackoff(s2, "gap-b", "failed", 70_000, 200_000, 3, cfg); // 70s ≥ 60s ⇒ not quick death
  assert.equal(reset.quickDeath, false);
  assert.equal(s2.counts.get("gap-b"), undefined, "survived run resets the consecutive quick-death count");
  assert.equal(s2.backoffUntil.get("gap-b"), undefined, "backoff cleared on non-quick-death");
});

test("AC1 pure — 按 task 隔离：一个 task 退避不影响另一个 task 的退避状态", () => {
  const state = newQuickDeathBackoffState();
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };
  recordQuickDeathBackoff(state, "gap-a", "failed", 5000, 100_000, 3, cfg);
  assert.equal(isBackedOff(state, "gap-a", 100_000), true, "gap-a backed off");
  assert.equal(isBackedOff(state, "gap-b", 100_000), false, "gap-b unaffected（退避按 task，⛔ 不全局）");
});

test("parse helpers — quick-death-ms/backoff-base-ms/backoff-max-ms/backoff-threshold fail-to-default", () => {
  assert.equal(QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs, 60_000);
  assert.equal(parseQuickDeathMs(undefined), 60_000, "no --quick-death-ms ⇒ default 60s");
  assert.equal(parseQuickDeathMs("120000"), 120_000, "explicit honored");
  assert.equal(parseQuickDeathMs("garbage"), 60_000, "garbage ⇒ default");
  assert.equal(parseBackoffBaseMs(undefined), 30_000);
  assert.equal(parseBackoffBaseMs("100"), 100, "explicit honored");
  assert.equal(parseBackoffBaseMs("0"), 30_000, "non-positive ⇒ default");
  assert.equal(parseBackoffMaxMs(undefined), 300_000);
  assert.equal(parseBackoffMaxMs("1000"), 1000);
  assert.equal(parseBackoffMaxMs("-5"), 300_000, "negative ⇒ default");
  assert.equal(parseBackoffThreshold(undefined), 1, "default threshold = 1");
  assert.equal(parseBackoffThreshold("2"), 2);
  assert.equal(parseBackoffThreshold("0"), 1, "threshold must be ≥1 ⇒ default");
  assert.equal(parseBackoffThreshold("1.5"), 1, "non-integer ⇒ default");
});

test("AC1 (integration) — worker 快速死亡后 driver 退避：不立即重派（worker-backoff 事件 + 无第二次立即派发）", async (t) => {
  const root = makeGitRoot("backoff-ac1");
  writeTaskFile(root, "gap-qd", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-qd'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-qd\\x20quick-death')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "3000",     // 3s 退避 ⇒ 第二次派发至少 3s 后
    "--backoff-threshold", "1",       // 第一次快速死亡即退避
    "--max-retries", "5",             // 高上限，避免标 needs-human 干扰「退避」观测
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 第一次派发 → 快速死亡 → worker-backoff 事件（退避生效的直接量）。
  await waitFor(() => drv.events().filter((e) => e.event === "worker-backoff").length >= 1, 60000);
  const backoffs = drv.events().filter((e) => e.event === "worker-backoff");
  assert.equal(backoffs[0].task, "gap-qd");
  assert.equal(backoffs[0].backed_off, true, "AC1: quick death ⇒ backed_off=true（退避，⛔ 立即重派）");
  assert.equal(backoffs[0].needs_human, false);

  // 负控制：退避窗口（3s）内无第二次派发——给一个 1s 窗口断言仍只有 1 次 selector-picked。
  await new Promise((r) => setTimeout(r, 1000));
  let picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 1, "AC1: 退避期间（<3s）不立即重派——仍只有 1 次派发（⛔ 仍 <60s 立即重派 ⇒ 假）");

  // 退避到期（3s）后第二次派发发生（退避是延迟，⛔ 永久不派）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 20000);
  picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC1: 退避到期后第二次派发发生");
});

test("AC2 (integration) — 一个任务退避时其它任务照常派发（退避按 task，⛔ 不全局）", async (t) => {
  const root = makeGitRoot("backoff-ac2");
  writeTaskFile(root, "gap-a", "ready");
  writeTaskFile(root, "gap-b", "ready");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a','gap-b'],pool:2}))",
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':n===1?'gap-b\\x20second':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "5000",     // gap-a 退避 5s（gap-b 派发发生在退避窗口内）
    "--backoff-threshold", "1",
    "--max-retries", "5",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // gap-a 派发 → 快速死亡 → 退避。gap-a 退避期间 gap-b 仍被派发（退避不拖垮全局）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").map((e) => e.task).includes("gap-b"), 60000);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.deepEqual(picks.map((p) => p.task).slice(0, 2), ["gap-a", "gap-b"],
    "AC2: gap-a 退避期间 gap-b 仍照常派发（退避按 task，⛔ 不全局）");
});

test("AC3 (integration) — 退避到上限转 markNeedsHuman（⛔ 不无限退避）", async (t) => {
  const root = makeGitRoot("backoff-ac3");
  writeTaskFile(root, "gap-cap", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cap'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cap\\x20quick-death')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "100",   // 小退避，让多次快速死亡快速推进到上限
    "--backoff-threshold", "1",
    "--max-retries", "2",         // 2 次快速死亡 ⇒ needs-human
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 2 次快速死亡（每次之间隔 100ms 退避）⇒ 标 needs-human。
  await waitFor(() => readTaskStatus(root, "gap-cap") === "needs-human", 60000);
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "AC3: 退避到上限（max-retries=2）⇒ needs-human");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-cap.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC3: ## Needs-Human audit record written");
  assert.match(body, /快速死亡/, "AC3: reason mentions 快速死亡（退避上限）");

  // 负控制：不再无限重派——恰好 2 次派发。
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC3: exactly 2 dispatches — 退避到上限后不再重派（⛔ 无限退避 ⇒ 假）");
  assert.equal(readOutcomeLines(root).length, 2, "AC3: still exactly 2 outcomes — no 3rd attempt wrote a record");
});

// ── gap-adr034-fan-in-lock-holder-supervised（ADR-034）— driver 死（SIGKILL）→ 锁自动释放 ──────────
// fan-in workflow 锁的持锁者由「分离 holder + flag 释放协议」（fan-in-ff-merge.sh --acquire/--release-
// workflow-lock 的 setsid & disown）收进 driver：worker-driver.ts 经非分离直接子进程持锁，锁的生死 =
// 工作的进程生死。本测试负控制：spawn 一个「driver」子进程经 acquireFanInWorkflowLock 持锁 → 独立
// flock -n 竞争者确认被挡 → SIGKILL driver → 内核关 stdin 写端 ⇒ holder 写 release + flock -u 退出 ⇒
// 锁自动释放（flock -n 成功 + holder 进程死、无 PPID=1 持锁孤儿）→ 新 driver 可再 acquire 同一锁。

test("AC1/AC5 (gap-adr034-fan-in-lock-holder-supervised) — driver 死（SIGKILL）→ flock 自动释放；无孤儿 holder 挡排队 acquire", async () => {
  const root = makeGitRoot("adr034-lock");
  const task = "gap-adr034-holder";
  const lockFile = fanInWorkflowLockFile(root);
  const holdScript = `
import { acquireFanInWorkflowLock } from ${JSON.stringify(pathToFileURL(DRIVER).href)};
const lock = await acquireFanInWorkflowLock({ root: ${JSON.stringify(root)}, task: ${JSON.stringify(task)}, runId: "r1" });
console.log("HELD " + lock.holderPid);
await new Promise(() => {});
`;
  const driver = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", holdScript], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  driver.stdout.on("data", (d) => { out += d; });
  driver.stderr.on("data", (d) => { err += d; });
  try {
    // 等 driver 子进程确认持锁（holder 写出 acquire 事件后打印 HELD <pid>）。
    await waitFor(() => /HELD \d+/.test(out), 15000);
    const holderPid = Number(out.match(/HELD (\d+)/)?.[1]);
    assert.ok(Number.isInteger(holderPid) && holderPid > 0, `driver must report a valid holder pid (out=${JSON.stringify(out)} err=${JSON.stringify(err)})`);

    // 锁正被 holder 持有：独立 flock -n 竞争者应失败（flock -n 拿不到 ⇒ 非零）。
    const heldProbe = spawnSync("bash", ["-c", `exec {fd}>"$1"; flock -n "$fd"`, "probe", lockFile], { encoding: "utf8" });
    assert.notEqual(heldProbe.status, 0, "while the driver holds the lock, an independent flock -n must FAIL (lock is held)");

    // SIGKILL driver（⛔ 不是 graceful release）——内核关 driver 的 stdin 写端 ⇒ holder 读 EOF ⇒ 释放。
    driver.kill("SIGKILL");

    // 锁自动释放：独立 flock -n 竞争者随后成功。
    await waitFor(() => {
      const p = spawnSync("bash", ["-c", `exec {fd}>"$1"; flock -n "$fd"`, "probe", lockFile], { encoding: "utf8" });
      return p.status === 0;
    }, 15000);

    // 无 PPID=1 持锁孤儿：holder 进程随 driver 死退出（kill -0 失败）。
    await waitFor(() => {
      try { process.kill(holderPid, 0); return false; } catch { return true; }
    }, 15000);

    // 新 driver 能再 acquire 同一锁并干净 release（端到端「重启不残留」）。
    const lock2 = await acquireFanInWorkflowLock({ root, task: "gap-adr034-holder", runId: "r2" });
    assert.ok(Number.isInteger(lock2.holderPid) && lock2.holderPid > 0, "a fresh acquire after restart must succeed (no orphan holder blocking)");
    await lock2.release();
  } finally {
    try { driver.kill("SIGKILL"); } catch { /* already dead */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-fan-in-token-gate-version-mismatch-self-lock：每任务新进程（版本错位类级修法）──────────────
// 机械 fan-in 不再在守护进程 in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载
// ⇒ 版本错位），改为每任务 spawn 一个 fresh node 进程加载 worker-driver.ts（entry = 主检出 opts.root，
// ⛔ 非 worktree——gap-fan-in-spawn-stale-worktree-executor-missing-argv）--mechanical-fan-in。
// 锁半（acquireFanInWorkflowLock，ADR-034）与编排半（fan-in-ff-merge.sh）同源（仍在 worktree）。
// ⛔ token 闸（L1）已由 fd902a824 重定范围到 P2 的 TS 模块 ff 入口，本任务不再实现 token 闸。

test("AC1 (gap-fan-in-token-gate-version-mismatch-self-lock) — 每任务新进程：finishAsync 调 spawnMechanicalFanIn 加载当前代码（⛔ 不再 in-process）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.match(src, /mechResult = await spawnMechanicalFanIn\(\{ task: taskId, worktree: paths\[0\], root: rootDir, runId \}\)/, "finishAsync spawns a fresh mechanical fan-in process (⛔ in-process runMechanicalFanIn)");
  assert.match(src, /const entry = path\.join\(opts\.root, "plugin", "scripts", "worker-driver\.ts"\)/, "spawnMechanicalFanIn loads the ROOT checkout's worker-driver.ts (⛔ worktree：stale worktree 缺新 argv ⇒ unknown argument)");
  assert.match(src, /process\.execPath, "--experimental-strip-types", entry,\s*\n\s*"--mechanical-fan-in"/, "the fresh process is node --experimental-strip-types <root>/worker-driver.ts --mechanical-fan-in");
  assert.match(src, /if \(mechanicalFanIn\) \{\s*\n\s*const task = tasks\[0\]/, "--mechanical-fan-in mode exists in main()");
  assert.match(src, /worktree: mechWorktree,/, "--mechanical-fan-in mode passes the worktree to runMechanicalFanIn");
});

// ── gap-fan-in-spawn-stale-worktree-executor-missing-argv：执行器 entry 用主检出（⛔ worktree）────
// fresh-process fan-in spawn 用 worktree 的 worker-driver.ts 当执行器时，stale worktree（未 merge
// develop）的旧 worker-driver.ts 缺新 argv（--mechanical-fan-in）⇒ fresh 进程报 unknown argument ⇒
// 无 JSON 输出 ⇒ parse-mechanical-fan-in red。修法：entry = opts.root/plugin/scripts/worker-driver.ts
// （与 driver 同版），worktree 只提供任务 delta、不提供执行器代码。AC2 负控制：root entry（有 argv）
// 与 stale worktree entry（无 argv）两个 stub——entry 若指回 worktree 则 spawn 加载 stale stub ⇒
// unknown argument ⇒ red（本测试断言 outcome=landed，改回即红）。

test("AC2 (gap-fan-in-spawn-stale-worktree-executor-missing-argv) — stale worktree 缺 --mechanical-fan-in argv 仍 spawn 成功（entry=root，⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red）", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stale-exec-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "root");
  const worktree = path.join(base, "wt");

  // root 的 worker-driver.ts = 当前版（有 --mechanical-fan-in argv）——最小自足 stub（无 import），
  // 命中 --mechanical-fan-in 即打一行 JSON result 退出。模拟「主检出当前版」。
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "worker-driver.ts"), [
    "// current worker-driver.ts (root entry): has --mechanical-fan-in argv",
    "const argv = process.argv.slice(2);",
    'if (argv.includes("--mechanical-fan-in")) {',
    '  process.stdout.write(JSON.stringify({ outcome: "landed", step: null, reason: null, verdict: null }) + "\\n");',
    "  process.exit(0);",
    "}",
    'const flag = argv.find((x) => x.startsWith("--"));',
    'console.error("worker-driver: unknown argument: " + (flag ?? ""));',
    "process.exit(2);",
  ].join("\n"), "utf8");

  // worktree 的 worker-driver.ts = 陈旧版（无 --mechanical-fan-in argv，任何 --* 都 unknown argument）。
  // 模拟 stale worktree：落后 develop、缺新 argv。
  fs.mkdirSync(path.join(worktree, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "plugin", "scripts", "worker-driver.ts"), [
    "// STALE worker-driver.ts: no --mechanical-fan-in argv (any --* flag => unknown argument)",
    "const argv = process.argv.slice(2);",
    'const flag = argv.find((x) => x.startsWith("--"));',
    'console.error("worker-driver: unknown argument: " + (flag ?? ""));',
    "process.exit(2);",
  ].join("\n"), "utf8");

  const r = await spawnMechanicalFanIn({ task: "gap-stale", worktree, root, runId: "r1" });
  assert.equal(r.outcome, "landed", "stale worktree must not break spawn — entry=root has --mechanical-fan-in (⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red)");
  assert.equal(r.step, null, "no failure step when the root entry handles --mechanical-fan-in");
});

// ── gap-fan-in-subprocess-hang-timeout-recovery ────────────────────────────────────────────────
// A+B 任务机械 fan-in 持 fan-in-workflow.lock 53min 挂死：mechSh 各步有超时、suite 有 silence
// watchdog，仍 53min 无恢复 ⇒ 超时/看门狗有盲区（孙进程持管道 ⇒ close 不触发；suite 未起等槽锁）。
// 修法三件套：AC1 每步 begin/end trace（挂起定位）、AC2 mechSh 进程组 kill + 显式 resolve（超时必达）、
// AC3 suite 看门狗显式 resolve 不依赖 close（等槽锁零输出也 kill）、AC4 挂起 ⇒ 锁必释放（finally）。

const SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");

/** 建一个 hermetic git repo + task worktree（机械 fan-in 的输入，与 fan-in-driver-mechanical-
 *  orchestration.test.mjs 的 makeRepoWithWorktree 同形——develop 上 ready 任务、task/<id> 分支上
 *  doc-only 实现提交，使 merge/anti-drift/delta/typecheck/scoped/doc 直放行）。返回
 *  { base, repo, worktree, slotBase, capture }。 */
function makeMechRepo(tag, taskId = "gap-mfh") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mechfanin-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "mechfanin-test"]);
  runGit(repo, ["config", "user.email", "mf@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  // scripts/test.sh（classify-delta 读 registry；空 registry ⇒ tasks/、docs/ 判 doc-only）。
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", `${taskId}.md`), [
    "---",
    `id: ${taskId}`,
    "title: mechanical fan-in hang test",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "test",
    "## Plan",
    "test",
    "## Touches",
    "- docs/feature.md",
    `- tasks/${taskId}.md`,
    "## Acceptance Criteria",
    "- [x] AC1 landed",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n"), "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "base"]);
  runGit(repo, ["worktree", "add", "-q", worktree, "-b", `task/${taskId}`]);
  // develop 脱离主检出（gap-fan-in-ff-ref-update-detach-develop）：主检出停 doc-only 工作分支，ff 退化
  // 纯 ref 更新。
  runGit(repo, ["checkout", "-q", "-b", "develop-work"]);
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "feature.md"), "# feature\n", "utf8");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "implement feature"]);
  const slotBase = path.join(base, "full-suite.lock");
  const capture = path.join(base, "suite.env");
  return { base, repo, worktree, slotBase, capture };
}

/** 一次机械 fan-in 的标准 opts（fake 命令缝，⛔ 不真跑 19+min 套件）。overrides 覆盖 suite/超时等。 */
function mechOpts(m, runId, overrides = {}) {
  return {
    task: "gap-mfh",
    worktree: m.worktree,
    root: m.repo,
    runId,
    mergeTarget: "develop",
    forceSuite: true,
    scriptsDir: path.join(REPO_ROOT, "plugin", "scripts"),
    slotBase: m.slotBase,
    slotLib: SLOT_LIB,
    silenceMs: 500,
    suiteCapture: m.capture,
    suiteLogFile: path.join(m.base, "suite.log"),
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
    archguardCommand: ["true"],
    ...overrides,
  };
}

test("AC1 (gap-fan-in-subprocess-hang-timeout-recovery) — appendFanInStepTrace 写 step-begin/step-end 到 .quay/fan-in-step-trace.jsonl（挂起 = begin 无 end）", (t) => {
  const root = makeRoot("trace-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appendFanInStepTrace(root, "gap-t", "run-1", "merge-develop", "begin");
  appendFanInStepTrace(root, "gap-t", "run-1", "merge-develop", "end", { ok: true });
  appendFanInStepTrace(root, "gap-t", "run-1", "typecheck", "begin"); // 模拟挂起：无 end
  const lines = fs.readFileSync(path.join(root, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, "begin+end+begin = 3 trace lines");
  assert.equal(lines[0].event, "step-begin");
  assert.equal(lines[0].step, "merge-develop");
  assert.equal(lines[1].event, "step-end");
  assert.equal(lines[1].step, "merge-develop");
  assert.equal(lines[1].ok, true);
  assert.equal(lines[2].step, "typecheck");
  // 挂起定位：typecheck 只有 begin 无 end（⛔ 不可把「无 end」读成「没跑过」，硬规则 3b 可区分）。
  assert.equal(lines.filter((l) => l.step === "typecheck" && l.event === "step-end").length, 0, "a hung step has begin without end");
  assert.ok(Number.isInteger(lines[0].epoch) && lines[0].epoch > 0, "epoch is a sortable second-resolution timestamp");
  assert.equal(lines[0].task, "gap-t");
  assert.equal(lines[0].runId, "run-1");
});

test("AC1 (gap-fan-in-subprocess-hang-timeout-recovery) — runMechanicalFanIn 每步都被 begin/end trace 包裹（⛔ 改掉 ⇒ 日志缺失）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  for (const step of ["merge-develop", "anti-drift", "delta-classify", "typecheck", "archguard-structure", "scoped-gate", "doc-check", "suite", "anti-drift-land", "ac-gate", "flip-done", "ff", "cleanup"]) {
    assert.ok(src.includes(`trace("${step}", "begin")`), `step ${step} must have a begin trace`);
    assert.ok(src.includes(`trace("${step}", "end"`), `step ${step} must have an end trace`);
  }
});

test("AC2 (gap-fan-in-subprocess-hang-timeout-recovery) — mechSh timeout 后 resolve（⛔ 依赖 close）+ 组 kill 杀孙进程（孙进程持管道不阻塞返回）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mech-ac2-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const pidFile = path.join(tmp, "grandchild.pid");
  // 直接子进程（bash）spawn 孙进程（node）继承 stdout/stderr 管道并长期存活，bash `wait` 挂起等它。
  // timeout 到期 ⇒ 组 kill（⛔ 只杀直接子进程会留孙进程持管道/锁泄漏）。
  const cmd = `node -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)' & wait`;
  const t0 = Date.now();
  const r = await mechSh(["bash", "-c", cmd], 1000);
  assert.ok(Date.now() - t0 < 5000, `mechSh must resolve at timeout (⛔ hang on close), took ${Date.now() - t0}ms`);
  assert.equal(r.status, null, "SIGKILLed child ⇒ null status");
  assert.match(r.error?.message ?? "", /spawn timeout after 1000ms/, "timeout must carry a 'spawn timeout' error");
  // 孙进程被杀（组 kill）：⛔ 旧 runAsync 只杀直接子进程 ⇒ 孙进程存活持管道（本断言取假）。
  const gp = Number(fs.readFileSync(pidFile, "utf8").trim());
  await waitFor(() => {
    try { process.kill(gp, 0); return false; } catch { return true; }
  }, 5000);
  assert.ok(true, "grandchild holding the pipe must be killed by the process-group kill");
});

test("AC3 (gap-fan-in-subprocess-hang-timeout-recovery) — spawnSuiteAndWait 在 suite 卡等槽锁（零输出）时，silence watchdog 有限时间 kill 并返回 hung", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mech-ac3-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const slotBase = path.join(tmp, "full-suite.lock");
  const slots = suiteLockSlotPaths(slotBase);
  assert.equal(slots.length, 1, "hermetic slot base defaults to S=1");
  // 持住唯一槽：后台 flock holder 让 slot-holder 的 flock -n 失败 ⇒ 卡进无界等槽循环（零输出）。
  const holder = spawn("bash", ["-c", `exec {fd}>"$1"; flock -x "$fd"; sleep 30`, "holder", slots[0]], { stdio: "ignore", detached: true });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch { /* gone */ } });
  await waitFor(() => {
    try { execFileSync("flock", ["-n", slots[0], "true"], { stdio: "ignore" }); return false; } catch { return true; }
  }, 5000);
  const t0 = Date.now();
  const r = await spawnSuiteAndWait({ slotBase, slotLib: SLOT_LIB, suiteCommand: ["bash", "-c", "echo never-run"], logFile: null, silenceMs: 400 });
  assert.ok(Date.now() - t0 < 5000, `spawnSuiteAndWait must return in finite time (⛔ 53min hang), took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "hung", "suite stuck waiting for the slot ⇒ hung (independent value)");
  assert.equal(r.hungByWatchdog, true);
});

test("AC4 (gap-fan-in-subprocess-hang-timeout-recovery) — 任一 fan-in 子进程挂起 ⇒ 有限时间 red + 释放 fan-in-workflow.lock（finally 必达）", async (t) => {
  const m = makeMechRepo("ac4");
  const runId = "mf-run-hang";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const t0 = Date.now();
  // suite 挂起（零输出 ⇒ silence watchdog kill → hung → red at suite），⛔ 不落地、锁仍 release。
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "sleep 100"], silenceMs: 400 }));
  assert.ok(Date.now() - t0 < 20000, `mechanical fan-in must fail in finite time (⛔ 53min hang), took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  // 锁在 finally 释放：事件文件里恰一对 acquire→release（⛔ 挂起残留锁阻塞全仓 fan-in）。
  const lock = readWorkflowLockHold(m.repo, "gap-mfh", runId);
  assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "hang ⇒ lock released (finally) — clean acquire+release pair");
});
