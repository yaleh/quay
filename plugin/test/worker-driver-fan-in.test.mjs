// @test-group engine
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
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
  isFfNotFastForwardFailure,
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
  acquireFanInLock,
  fanInLockFile,
  runMechanicalFanIn,
  fanInLogFileName,
  appendFanInTrace,
  defaultMechanicalSuiteCommand,
  newMechanicalSuiteRunId,
  suiteLogFileName,
  pruneTaskSuiteLogs,
  extractFailureSummary,
  extractFirstFailureLine,
  combinedOutput,
  mirrorMechanicalFanInSuiteState,
  mechSh,
  appendFanInStepTrace,
  spawnMechanicalFanIn,
  readFanInLockHold,
  readPreviousGreenSuiteCommit,
  acShortCircuitVerdict,
  appendCompleteGateEvent,
  failingTestFilesFromSuiteLog,
  assertionSignaturesFromSuiteLog,
  judgeRetryExemption,
  RETRY_EXEMPTION_WINDOW_MS_DEFAULT,
} from "../scripts/worker-driver.ts";
import { defaultLaneCount } from "../scripts/full-suite-runner.ts";
import { spawnSuiteAndWait } from "../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../scripts/suite-lock-slots.ts";
// gap-worker-driver-retry-cap-not-wired：retryExhausted 集合的生产函数单一真相源（driver-filters.ts），
// 两 driver 共用（⛔ 非平行副本）。AC3 用同一函数身份证 promotion 不回归。
import { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, applyTaskFilters, makeFilterContext } from "../scripts/driver-filters.ts";
import { advanceRetryCap as promoAdvanceRetryCap, markNeedsHuman as promoMarkNeedsHuman, MAX_FIX_RETRIES_DEFAULT } from "../scripts/promotion-driver.ts";

import {
  DRIVER,
  REPO_ROOT,
  makeRoot,
  makeGitRoot,
  runGit,
  writeProfileCarrier,
  runDriver,
  readOutcomeLines,
  readRoundLines,
  spawnResident,
  waitFor,
  writeTaskFile,
  writeTouchedTask,
  counterNodeE,
} from "./helpers/worker-driver-harness.mjs";

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
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
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
  await waitFor(() => readOutcomeLines(root).length >= 1, 15000);
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
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 15000);
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
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
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
  await waitFor(() => drv.events().some((e) => e.event === "cold-start-inflight"), 15000);
  const cs = drv.events().find((e) => e.event === "cold-start-inflight");
  assert.ok(cs, "the cold-start enumeration is observed (recorded)");
  assert.deepEqual(cs.tasks, ["gap-cs-a"], "the survivor is the enumerated in-flight task");
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC2 phase 1: survivor not re-dispatched while its worker is alive");

  // Phase 2: 幸存 worker 退出 + worktree 消失（模拟其 fan-in 落地）⇒ 现观测使 task 离开排除集 ⇒
  //   同一 driver 进程内重新可派。⛔ 冻结快照（旧缺陷）下此步恒不派 ⇒ 假。
  try { fakeWorker.kill("SIGKILL"); } catch { /* already gone */ }
  try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
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

// ── gap-fan-in-remove-archguard-gate：archguard 结构闸已从机械 fan-in 移除（降级为按需命令）──────
// 源面负控制见 archguard-structural-gate-fan-in.test.mjs（engine 组）；本文件只保证 runMechanicalFanIn
// 的 step 序列里不再有 archguard-structure（⛔ 不在此重复 worker-driver.ts 的接点断言）。

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
  await waitFor(() => drv.events().some((e) => e.event === "selector-picked" && e.task === "gap-a"), 15000);
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
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "gate WAIT ⇒ no dispatch yet");
  assert.equal(drv.child.exitCode, null, "transient WAIT did not exit the driver");

  // Phase 2: release the gate — the SAME process must recover and dispatch (stopReason 不复位即恒不派 ⇒ 假).
  fs.writeFileSync(goFile, "go\n");
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
  const spawned = drv.events().filter((e) => e.event === "worker-spawned");
  assert.equal(spawned.length, 1, "AC1: gate-open recovered dispatch in the SAME driver process (no restart)");
  assert.equal(spawned[0].task, "gap-ac1");
  await waitFor(() => readOutcomeLines(root).length >= 1, 15000);
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
  await waitFor(() => readRoundLines(root).length >= 3, 15000);
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
  await waitFor(() => readRoundLines(root).length >= 3, 15000);
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
  // ⛔ 满载下 2 次 worker spawn + 落地判定的等待窗放宽到 30s（60s→30s 收紧，同 5045b9ab9 的 liveness 窗）——
  // 全量 suite concurrency=16 时驱动冷启动 + node spawn 可 >8s，8s 窗把「慢而正确」误判为「只派 1 次」。
  await waitFor(() => readOutcomeLines(root).length >= 2, 30000);
  const records = readOutcomeLines(root);
  assert.deepEqual(records.map((r) => r.final_state), ["exited-not-landed", "exited-not-landed"],
    "AC2: both attempts exited-not-landed (exit 0 but status=ready not done)");

  // 达上限 ⇒ 标 needs-human（ready→needs-human）+ ## Needs-Human 审计记录。
  await waitFor(() => readTaskStatus(root, "gap-cap") === "needs-human", 30000);
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "AC2: task marked needs-human after N exited-not-landed");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-cap.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC2: ## Needs-Human audit record written");

  // 负控制：给驱动一个「可能第 3 次派发」的窗口，再断言仍只有 N=2 次派发（⛔ 无限重派）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 30000);
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

// ── gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky：重试上限豁免判定 ────────────────────
// 根因：RETRY_CAP_DEFAULT=3 的 markNeedsHuman 机械翻转不看 suite red 命中失败测试文件是否落在任务
// `## Touches` 范围——任务自身缺陷与无关既有 flaky 消耗同一份重试预算。本段测 judgeRetryExemption 的
// 三态纯判定（unrelated-flaky-exempt / own-defect-counted / insufficient-data-fallback）。

const EXEMPT_TEST = "plugin/test/obs.test.mjs";

// 写一个含 ## Touches 的任务体（⛔ 不 git 提交——taskDeltaFiles 在非 git 根返回 null，delta=Touches）。
function writeExemptionTask(root, taskId, touches) {
  const bullets = touches.map((t) => `- ${t}`).join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n${bullets}\n`, "utf8");
}

// 写一个失败测试文件（无相对 import ⇒ directImportRels=[] ⇒ 不在 delta 即 unrelated）。
function writeFailingTest(root, rel) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), 'import { test } from "node:test";\n', "utf8");
}

// 写一条 suite 日志（相对路径 __PERFILE__ passed=false + 一条 AssertionError 断言签名）。
function writeSuiteRedLog(root, basename, failingRel, assertion) {
  const p = path.join(root, ".quay", basename);
  fs.writeFileSync(p, `__PERFILE__ duration_ms=10 ${failingRel} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: ${assertion}\n`, "utf8");
  return p;
}

// 追加一条【其它】任务的 suite-red outcome（worker-outcome.jsonl，供跨任务签名复发扫描）。
function appendOtherSuiteRed(root, taskId, ts, suiteLogBasename) {
  fs.appendFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ ts, task: taskId, final_state: "exited-not-landed", run_id: "r", session_id: "s", mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: suiteLogBasename } }) + "\n", "utf8");
}

test("AC1 (能取假) — judgeRetryExemption：失败测试文件不在 Touches ∧ 断言签名跨 ≥2 不同任务复发 ⇒ unrelated-flaky-exempt（第 3 次不计入重试）", (t) => {
  const root = makeRoot("exempt-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]); // 与失败测试无关
  writeFailingTest(root, EXEMPT_TEST);
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, "probe must be alive");
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 两个其它任务在窗口内命中同一签名（≥2 不同任务 ⇒ 复发）。
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, "probe must be alive");
  writeSuiteRedLog(root, "fan-in-suite-gap-c.log", EXEMPT_TEST, "probe must be alive");
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");
  appendOtherSuiteRed(root, "gap-c", new Date(nowMs - 7200_000).toISOString(), "fan-in-suite-gap-c.log");

  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "unrelated-flaky-exempt", "unrelated failing test + recurring signature ⇒ exempt");
  assert.deepEqual(j.failingTestFiles, [EXEMPT_TEST], "failing test file extracted");
  assert.ok(j.recurredTasks.includes("gap-b") && j.recurredTasks.includes("gap-c"), "other distinct tasks that recurred the signature are named");
});

test("AC1 负控制 — 签名只在本任务出现（未达 ≥2 不同任务阈值）⇒ own-defect-counted（照常机械翻转）", (t) => {
  const root = makeRoot("exempt-ac1-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, "probe must be alive");
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 无其它任务命中该签名（窗口内只有 gap-a 自己 ⇒ 复发计数 = 1 任务 < 2）。
  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "own-defect-counted", "signature appeared only once ⇒ NOT exempt (count normally)");
  assert.deepEqual(j.recurredTasks, [], "no other task recurred the signature");
});

test("AC2 (防滥用负控制) — 失败测试文件落在任务自身 Touches ⇒ own-defect-counted（即便签名此前已复发）", (t) => {
  const root = makeRoot("exempt-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeExemptionTask(root, "gap-a", [EXEMPT_TEST]); // 失败测试文件自身在 Touches 内
  writeFailingTest(root, EXEMPT_TEST);
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, "probe must be alive");
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, "probe must be alive");
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");

  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "own-defect-counted", "failing test in own Touches ⇒ count regardless of signature recurrence");
  assert.match(j.reason, /in this task's Touches\/diff/, "reason names the own-defect attribution");
});

test("AC5 (三态可区分) — insufficient-data-fallback ≠ unrelated-flaky-exempt；round 记录三态载体（⛔ 只在 json 事件里 ⇒ 假）", (t) => {
  const root = makeRoot("exempt-ac5");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ③ insufficient-data-fallback：无 mechanical_fan_in。
  const noMfi = judgeRetryExemption(root, "gap-a", { final_state: "exited-not-landed" });
  assert.equal(noMfi.verdict, "insufficient-data-fallback", "no mechanical_fan_in ⇒ insufficient-data-fallback");
  assert.notEqual(noMfi.verdict, "unrelated-flaky-exempt", "判不出 ≠ 判为无关");
  // ③b：suite log 缺失 ⇒ insufficient-data-fallback。
  const noSuiteLog = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: null } });
  assert.equal(noSuiteLog.verdict, "insufficient-data-fallback", "no suite log ⇒ insufficient-data-fallback");
  assert.notEqual(noSuiteLog.verdict, "own-defect-counted", "判不出 ≠ 判为自身缺陷");

  // round 记录携带三态 verdict（生产载体，⛔ 只在 json 事件里 ⇒ 假）。
  const rec = computeWorkerRoundRecord({
    round: 1, runId: "r", pid: 1, at: "t", action: "idle", inFlight: 0, pool: 0, stopReason: null, coldStartInflight: [],
    retryExemptions: [{ task: "gap-a", verdict: "unrelated-flaky-exempt", reason: "r", failingTestFiles: [EXEMPT_TEST], recurredTasks: ["gap-b"] }],
  });
  assert.equal(rec.retry_exemptions[0].verdict, "unrelated-flaky-exempt", "round record carries the three-state verdict (production carrier)");
  assert.deepEqual(rec.retry_exemptions[0].recurredTasks, ["gap-b"], "round record carries the recurred tasks");
});

test("failingTestFilesFromSuiteLog — 绝对路径 __PERFILE__ 行也提取 repo-relative 失败测试（⛔ 只匹配相对路径 ⇒ 恒空）", () => {
  const abs = failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=10 /home/yale/work/quay-worktrees/gap-x/plugin/test/obs.test.mjs passed=false end_ms=1\n");
  assert.deepEqual(abs, [EXEMPT_TEST], "absolute-path __PERFILE__ line extracts the repo-relative path");
  const rel = failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=10 plugin/test/obs.test.mjs passed=false end_ms=1\n");
  assert.deepEqual(rel, [EXEMPT_TEST], "relative __PERFILE__ line still extracts (no regression)");
});

test("assertionSignaturesFromSuiteLog — 提取并归一化 AssertionError 签名（[ERR_ASSERTION] 变体 + 空白折叠去重）", () => {
  const sigs = assertionSignaturesFromSuiteLog("  AssertionError [ERR_ASSERTION]: probe must be alive\n  AssertionError: probe   must   be   alive\n");
  assert.deepEqual(sigs, ["probe must be alive"], "normalized assertion signature extracted + deduped");
});

test("RETRY_EXEMPTION_WINDOW_MS_DEFAULT — 48h 窗口缺省（与提案 48h 复盘同窗）", () => {
  assert.equal(RETRY_EXEMPTION_WINDOW_MS_DEFAULT, 48 * 3600 * 1000, "48h default window");
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
  await waitFor(() => drv.events().filter((e) => e.event === "worker-backoff").length >= 1, 30000);
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
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").map((e) => e.task).includes("gap-b"), 30000);
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
  await waitFor(() => readTaskStatus(root, "gap-cap") === "needs-human", 30000);
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
// fan-in 锁的持锁者由「分离 holder + flag 释放协议」（fan-in-ff-merge.sh --acquire/--release-
// fan-in-lock 的 setsid & disown）收进 driver：worker-driver.ts 经非分离直接子进程持锁，锁的生死 =
// 工作的进程生死。本测试负控制：spawn 一个「driver」子进程经 acquireFanInLock 持锁 → 独立
// flock -n 竞争者确认被挡 → SIGKILL driver → 内核关 stdin 写端 ⇒ holder 写 release + flock -u 退出 ⇒
// 锁自动释放（flock -n 成功 + holder 进程死、无 PPID=1 持锁孤儿）→ 新 driver 可再 acquire 同一锁。

test("AC1/AC5 (gap-adr034-fan-in-lock-holder-supervised) — driver 死（SIGKILL）→ flock 自动释放；无孤儿 holder 挡排队 acquire", async () => {
  const root = makeGitRoot("adr034-lock");
  const task = "gap-adr034-holder";
  const lockFile = fanInLockFile(root);
  const holdScript = `
import { acquireFanInLock } from ${JSON.stringify(pathToFileURL(DRIVER).href)};
const lock = await acquireFanInLock({ root: ${JSON.stringify(root)}, task: ${JSON.stringify(task)}, runId: "r1" });
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
    const lock2 = await acquireFanInLock({ root, task: "gap-adr034-holder", runId: "r2" });
    assert.ok(Number.isInteger(lock2.holderPid) && lock2.holderPid > 0, "a fresh acquire after restart must succeed (no orphan holder blocking)");
    await lock2.release();
  } finally {
    try { driver.kill("SIGKILL"); } catch { /* already dead */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-mech-fan-in-log-webui-visible-clickable（AC1）— 机械 fan-in 过程日志 ───────────────────
// 机械 fan-in 的每一步 trace 持久化到 .quay/fan-in-<task>-<runId>.log（gitignored 运行时日志），
// 每行 {ts, step, exit, wall_ms, ok}、失败步附 reason。runId 唯一后缀 ⇒ 跨 relaunch 不复用
// （同 gap-fan-in-suite-log-cross-relaunch-reuse 防护：旧轮内容不残留、新 runId 写新文件）。

test("AC1 (unit) — fanInLogFileName sanitizes runId; appendFanInTrace appends one {ts,step,exit,wall_ms,ok} JSON line per call", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-trace-unit-"));
  try {
    const file = path.join(dir, fanInLogFileName("gap-trace-ac1", "wk/prod 123"));
    assert.equal(path.basename(file), "fan-in-gap-trace-ac1-wk_prod_123.log", "runId sanitized to [A-Za-z0-9_.-] (slash/space → _)");
    appendFanInTrace(file, { step: "merge-develop", exit: 128, wall_ms: 12, ok: false, reason: "boom" });
    appendFanInTrace(file, { step: "acquire-fan-in-lock", exit: 0, wall_ms: 3, ok: true });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, "one JSON line per call (append, not overwrite)");
    for (const ln of lines) {
      assert.ok("ts" in ln && "step" in ln && "exit" in ln && "wall_ms" in ln && "ok" in ln, `line carries {ts, step, exit, wall_ms, ok} (got ${JSON.stringify(ln)})`);
    }
    assert.equal(lines[0].step, "merge-develop");
    assert.equal(lines[0].exit, 128);
    assert.equal(lines[0].wall_ms, 12);
    assert.equal(lines[0].ok, false);
    assert.equal(lines[0].reason, "boom");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 (integration) — runMechanicalFanIn writes a per-step trace covering the steps up to the first failure; a new runId writes a NEW file (old one untouched)", async () => {
  const root = makeGitRoot("fanin-trace");
  const task = "gap-trace-ac1";
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-wt-"));
  try {
    const r1 = await runMechanicalFanIn({ task, worktree, root, runId: "r1" });
    assert.equal(r1.outcome, "red", "non-git worktree merge fails → red");
    assert.equal(r1.step, "merge-develop", "first failing step is merge-develop");
    assert.equal(r1.fanInLog, `fan-in-${task}-r1.log`, "outcome carries the fan-in log file name (A3)");

    const log1 = path.join(root, ".quay", `fan-in-${task}-r1.log`);
    assert.ok(fs.existsSync(log1), "fan-in trace log exists after a real run");
    const lines1 = fs.readFileSync(log1, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines1.length >= 2, "trace covers acquire + at least the failing merge step");
    for (const ln of lines1) {
      assert.ok("step" in ln && "exit" in ln && "wall_ms" in ln && "ok" in ln, `each line carries {step, exit, wall_ms, ok} (got ${JSON.stringify(ln)})`);
      assert.ok(typeof ln.wall_ms === "number", "wall_ms is a number");
    }
    const steps1 = lines1.map((l) => l.step);
    assert.ok(steps1.includes("acquire-fan-in-lock"), "acquire step traced");
    assert.ok(steps1.includes("merge-develop"), "merge step traced");
    const mergeLine = lines1.find((l) => l.step === "merge-develop");
    assert.equal(mergeLine.ok, false, "failing merge step is marked ok=false");
    assert.ok(typeof mergeLine.reason === "string" && mergeLine.reason.length > 0, "failing step carries a reason");

    // 跨 relaunch：新 runId 写新文件、旧文件不被覆盖。
    const before = fs.readFileSync(log1, "utf8");
    const r2 = await runMechanicalFanIn({ task, worktree, root, runId: "r2" });
    assert.equal(r2.fanInLog, `fan-in-${task}-r2.log`, "second run's outcome carries a distinct file name");
    const log2 = path.join(root, ".quay", `fan-in-${task}-r2.log`);
    assert.ok(fs.existsSync(log2), "second run writes a NEW file");
    assert.notEqual(path.join(root, ".quay", r1.fanInLog), path.join(root, ".quay", r2.fanInLog), "distinct files per runId");
    assert.equal(fs.readFileSync(log1, "utf8"), before, "old run's file is NOT overwritten by the new runId");
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-fan-in-token-gate-version-mismatch-self-lock：每任务新进程（版本错位类级修法）──────────────
// 机械 fan-in 不再在守护进程 in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载
// ⇒ 版本错位），改为每任务 spawn 一个 fresh node 进程加载 worker-driver.ts（entry = 主检出 opts.root，
// ⛔ 非 worktree——gap-fan-in-spawn-stale-worktree-executor-missing-argv）--mechanical-fan-in。
// 锁半（acquireFanInLock，ADR-034）与编排半（fan-in-ff-merge.sh）同源（仍在 worktree）。
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
// A+B 任务机械 fan-in 持 fan-in.lock 53min 挂死：mechSh 各步有超时、suite 有 silence
// watchdog，仍 53min 无恢复 ⇒ 超时/看门狗有盲区（孙进程持管道 ⇒ close 不触发；suite 未起等槽锁）。
// 修法三件套：AC1 每步 begin/end trace（挂起定位）、AC2 mechSh 进程组 kill + 显式 resolve（超时必达）、
// AC3 suite 看门狗显式 resolve 不依赖 close（等槽锁零输出也 kill）、AC4 挂起 ⇒ 锁必释放（finally）。

const SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");
// P2 (gap-execution-loop-productization-p2-p4): the ff 持锁段 is a TS module now — the hermetic
// makeMechRepo worktree has no packages/, so pin the seam to the REAL repo copy (a plain path;
// worker-driver pathToFileURL()s it). Same pin as fan-in-driver-mechanical-orchestration.test.mjs.
const FF_MERGE_MODULE = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");

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
    ffMergeModule: FF_MERGE_MODULE,
    suiteCapture: m.capture,
    suiteLogFile: path.join(m.base, "suite.log"),
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
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

test("AC1 (gap-fan-in-subprocess-hang-timeout-recovery / gap-mech-fan-in-log-webui-visible-clickable) — runMechanicalFanIn 每步都有 begin/end（挂起定位）+ A1 过程日志 trace", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // mechSh 步经 step() 包层——包层内 appendFanInStepTrace begin/end（挂起 = begin 无 end）+ A1 一行。
  // ⛔ ff 不在其中：P2 (gap-execution-loop-productization-p2-p4) 把 ff 持锁段 TS 模块化（worker-driver
  // import packages/quay/src/fan-in/ff-merge.ts，⛔ 不再 shell-out 到 bash fan-in-ff-merge.sh）——ff 是
  // 直接函数调用非 mechSh 子进程，改走「自定义步 A1 trace」路径（下方第二循环）。
  for (const step of ["merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check", "anti-drift-land", "ac-gate"]) {
    assert.ok(src.includes(`step("${step}"`), `step ${step} must go through the step() wrapper (begin/end + A1 trace)`);
  }
  // 自定义步（delta / flip-done / cleanup / ff）写 A1 过程日志 trace。
  for (const step of ["delta", "flip-done", "cleanup", "ff"]) {
    assert.ok(src.includes(`step: "${step}"`), `custom step ${step} must write an A1 trace`);
  }
  // suite 决策事件（ac-precheck / suite-start / suite-end / suite-skip）走 traceSuiteEvent 两路 trace
  // （per-run 过程日志 + 共享 fan-in-step-trace.jsonl——gap-fan-in-step-trace-suite-step-stopped-writing，
  // ⛔ 只写一路 ⇒ 共享读者永久看不到这批步骤）。
  for (const step of ["ac-precheck", "suite-start", "suite-end", "suite-skip"]) {
    assert.ok(src.includes(`traceSuiteEvent("${step}"`), `suite decision ${step} must write via traceSuiteEvent (both carriers)`);
  }
  // step() 包层内 begin/end 两路都写（挂起定位：begin 无 end 可区分）。
  assert.ok(src.includes('appendFanInStepTrace(root, task, runId, name, "begin")'), "step() emits a begin trace");
  assert.ok(src.includes('appendFanInStepTrace(root, task, runId, name, "end"'), "step() emits an end trace");
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
  }, 15000);
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
  }, 15000);
  const t0 = Date.now();
  const r = await spawnSuiteAndWait({ slotBase, slotLib: SLOT_LIB, suiteCommand: ["bash", "-c", "echo never-run"], logFile: null, silenceMs: 400 });
  assert.ok(Date.now() - t0 < 5000, `spawnSuiteAndWait must return in finite time (⛔ 53min hang), took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "hung", "suite stuck waiting for the slot ⇒ hung (independent value)");
  assert.equal(r.hungByWatchdog, true);
});

test("AC4 (gap-fan-in-subprocess-hang-timeout-recovery) — 任一 fan-in 子进程挂起 ⇒ 有限时间 red + 释放 fan-in.lock（finally 必达）", async (t) => {
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
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "hang ⇒ lock released (finally) — clean acquire+release pair");
});

// ── gap-mechanical-fan-in-red-lock-times-null ──────────────────────────────────────────────────────
// 病根：失败路径（fail/verdictOf/failSuite/catch failClean）硬编码 lockHoldSecs/lockAcquireEpoch/
// lockReleaseEpoch = null，而数据已落盘（acquire/release 事件文件）。修法 = 失败结果在 finally
// release 之后读真实锁时间（同成功路径时机）。两个陷阱：① 早读（release 事件未落盘 ⇒ lockHoldSecs
// 恒 null）；② 事后补读（后续重试追加更新的 acquire/release ⇒ readFanInLockHold 取最后一组 ⇒ 张冠李戴）。

test("AC2 (gap-mechanical-fan-in-red-lock-times-null) — 同一 taskId+runId 已有多组 acquire/release：失败结果拿到【本次尝试自己的】区间，不是文件里既有的组（防事后补读）", async (t) => {
  const m = makeMechRepo("lock-times-ac2");
  const runId = "mf-run-lock-times-ac2";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  // fixture：同一 taskId+runId 的两组 acquire/release（模拟「先失败(1000-1020) → 重试成功(2000-2271)」）。
  // 哨兵 epoch 远早于真实时间——若修法读错组（取第一组/取文件里最后一组既有组），会拿到这些哨兵值。
  const eventsFile = path.join(m.repo, ".quay", "fan-in-lock-events.jsonl");
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  const ev = (event, epoch) => JSON.stringify({ event, ts: "1970-01-01T00:00:00Z", epoch, taskId: "gap-mfh", pid: 1, runId, agentId: null }) + "\n";
  fs.writeFileSync(eventsFile,
    ev("acquire", 1000) + ev("release", 1020) + // 先失败（第一组）
    ev("acquire", 2000) + ev("release", 2271)   // 重试成功（最后一组）
  );
  // 驱动一次真实失败（suite 红）——本次尝试会向同一文件【追加第三组】真实 acquire/release。
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.ok(typeof r.lockAcquireEpoch === "number" && r.lockAcquireEpoch > 10000, `本次尝试真实 acquire（got ${r.lockAcquireEpoch}，⛔ 哨兵 1000/2000）`);
  assert.ok(typeof r.lockReleaseEpoch === "number" && r.lockReleaseEpoch > 10000, `本次尝试真实 release（got ${r.lockReleaseEpoch}，⛔ 哨兵 1020/2271）`);
  assert.notEqual(r.lockAcquireEpoch, 1000, "⛔ 拿到第一组(先失败)的哨兵 acquire");
  assert.notEqual(r.lockAcquireEpoch, 2000, "⛔ 拿到最后一组(重试成功)的哨兵 acquire");
  // 与事件文件里【最后一组】（本次尝试自己追加的）一致——证明修法在写入时序上读的是本次区间，
  // 不是事后补读（事后补读会因文件里已有多组而张冠李戴）。
  const last = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.equal(r.lockAcquireEpoch, last.lockAcquireEpoch, "失败结果 acquire 与本次尝试追加的事件一致");
  assert.equal(r.lockReleaseEpoch, last.lockReleaseEpoch, "失败结果 release 与本次尝试追加的事件一致");
});

test("AC3 (gap-mechanical-fan-in-red-lock-times-null) — 真实失败步骤(suite 红)的结果带非 null 锁时间，且与测试自建事件文件一致", async (t) => {
  const m = makeMechRepo("lock-times-ac3");
  const runId = "mf-run-lock-times-ac3";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  // 锁被真实持有 ⇒ 失败结果不再是 null，而是具体数值。
  assert.ok(typeof r.lockAcquireEpoch === "number" && r.lockAcquireEpoch > 0, `失败结果 lockAcquireEpoch 非 null（got ${r.lockAcquireEpoch}）`);
  assert.ok(typeof r.lockReleaseEpoch === "number" && r.lockReleaseEpoch > 0, `失败结果 lockReleaseEpoch 非 null（got ${r.lockReleaseEpoch}）`);
  // 与该测试自己驱动产生的 fan-in-lock-events.jsonl 里对应 acquire/release 一致（⛔ 不改动生产 .quay/ 历史记录）。
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.equal(r.lockAcquireEpoch, lock.lockAcquireEpoch, "失败结果 acquire 与事件文件一致");
  assert.equal(r.lockReleaseEpoch, lock.lockReleaseEpoch, "失败结果 release 与事件文件一致");
  assert.equal(r.lockHoldSecs, lock.lockHoldSecs, "失败结果 lockHoldSecs 与事件文件一致");
});

// ── gap-fan-in-ac-precheck-before-suite ─────────────────────────────────────────────────────────────
// 机械 fan-in 在 suite 前加 AC 全勾 fail-fast 预检（未全勾 ⇒ step=ac-precheck 拒翻 + 跳过 suite，省注定
// 无效的 9-11min/cycle；gap-execution-loop 08-30 两次 ac-gate 拒各耗 542s/684s 的注定无效 suite）。AC1
// 取假（未全勾 ⇒ 无 suite 运行记录）；AC2 负控制（全勾 ⇒ 正常进 suite）；AC3 单测钉死两半边。

test("AC3 (gap-fan-in-ac-precheck-before-suite) — AC 未全勾 ⇒ suite 前 fail-fast 拒翻（step=ac-precheck，无 suite 运行记录）", async (t) => {
  const m = makeMechRepo("acpre-fail");
  const runId = "mf-run-acpre-fail";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  // 改写任务体：AC 未全勾（- [ ] AC2 todo 无标注 ⇒ 待本任务）⇒ 预检应拒翻跳过 suite。
  fs.writeFileSync(path.join(m.worktree, "tasks", "gap-mfh.md"), [
    "---", "id: gap-mfh", "title: mechanical fan-in ac-precheck", "status: ready",
    "labels: []", "extra: {}", "---",
    "## Proposal", "test", "## Plan", "test",
    "## Touches", "- docs/feature.md", "- tasks/gap-mfh.md",
    "## Acceptance Criteria", "- [x] AC1 landed", "- [ ] AC2 todo",
    "## Definition of Done", "- [x] landed", "",
  ].join("\n"), "utf8");
  const suiteMarker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c", `echo ran > "${suiteMarker}"; exit 0`],
  }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "ac-precheck");
  assert.match(r.reason ?? "", /AC 未全勾/);
  assert.match(r.reason ?? "", /2\/3/, "reason carries checked/total (2/3 = AC1✓ + DoD✓ / AC2✗)");
  assert.equal(fs.existsSync(suiteMarker), false, "suite must NOT run (fail-fast before suite)");
  // 无 suite 运行记录：suiteFinishedEpoch / suiteOutcome 保持 null（⛔ 仍跑 suite 再拒 ⇒ 假）。
  assert.equal(r.suiteFinishedEpoch, null);
  assert.equal(r.suiteOutcome, null);
  // 锁仍释放（finally 必达）。
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "precheck red ⇒ lock released (finally)");
});

test("AC3 (gap-fan-in-ac-precheck-before-suite) — AC 全勾 ⇒ 预检不误挡，正常进 suite 并 landed（负控制 AC2）", async (t) => {
  const m = makeMechRepo("acpre-pass");
  const runId = "mf-run-acpre-pass";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `all-checked must pass the precheck and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, "done", "the suite must have run (precheck did not falsely block)");
  // 预检通过步应记录在过程日志（suite 前）。
  const log = path.join(m.repo, ".quay", `fan-in-gap-mfh-${runId}.log`);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const pre = lines.find((l) => l.step === "ac-precheck");
  assert.ok(pre, "ac-precheck pass must be traced");
  assert.equal(pre.ok, true);
});

// ── gap-mechanical-fan-in-writes-no-complete-gateevent ─────────────────────────────────────────────
// 机械 fan-in 翻 done 此前绕过 gate 引擎、零 complete GateEvent（stale-ready-audit 的 bypassComplete 每轮
// 报 9 条真阳性被当噪声）。现在 flip→ff 成功后经既有 gate-event-store 补写 complete pass 事件（AC2）。
// AC2/AC3 取真：landed fan-in ⇒ .quay/gate-events.jsonl 有该 task 的 complete pass 事件。

test("AC2/AC3 (gap-mechanical-fan-in-writes-no-complete-gateevent) — landed mechanical fan-in writes a complete pass GateEvent via the gate-event-store", async (t) => {
  const m = makeMechRepo("complete-event");
  const runId = "mf-run-complete-event";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  const gateLog = path.join(m.repo, ".quay", "gate-events.jsonl");
  assert.ok(fs.existsSync(gateLog), "landed fan-in must create .quay/gate-events.jsonl");
  const events = fs.readFileSync(gateLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const complete = events.filter((e) => e.gate === "complete" && e.verdict === "pass" && e.pipeline_id === "gap-mfh");
  assert.equal(complete.length, 1, `exactly one complete pass event for the task; got ${events.length} total events`);
  assert.equal(complete[0].actor, "quay-driver", "mechanical fan-in actor is quay-driver (distinct from quay-cli/outer)");
  assert.deepEqual(complete[0].payload, { from: "ready", to: "done" }, "payload matches the CLI runComplete shape");
});

test("AC4 negative control (gap-mechanical-fan-in-writes-no-complete-gateevent) — appendCompleteGateEvent is the sole source; removing the write leaves no event", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ge-neg-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const w = await appendCompleteGateEvent(base, "gap-x");
  assert.equal(w.ok, true, "appendCompleteGateEvent succeeds against a scratch root (module resolves via repo-root.ts)");
  const gateLog = path.join(base, ".quay", "gate-events.jsonl");
  const events = fs.readFileSync(gateLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.length, 1, "exactly one event written");
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "gap-x");
  // 负控制：删掉该事件（= 关闭写事件的那一行）⇒ 载体里再无 complete 事件 ⇒ bypassComplete 可重报。
  fs.writeFileSync(gateLog, "", "utf8");
  assert.equal(fs.readFileSync(gateLog, "utf8").trim(), "", "removing the write leaves no complete event (the instrument can re-report)");
});

// ── gap-worker-ac-check-shortcircuit ─────────────────────────────────────────────────────────────
// worker exit 0 后、finishAsync spawn 机械 fan-in 前，查 worktree 任务体 AC/DoD 是否全勾（flip 闸同源
// flipAcGateVerdict）。未全勾 ⇒ 短路：不 spawn fan-in（spawn 计数 0）、outcome 原因含「AC 未全勾」。
// AC_B1 取假（未全勾 ⇒ shortCircuit:true + 原因含「AC 未全勾」）；AC_B2 负控制（全勾 ⇒
// shortCircuit:false，照常 spawn——⛔ 全勾也被短路 ⇒ 假）。

/** 写一个带指定 AC/DoD 复选框的任务体到 worktree 的 tasks/<id>.md（自足，非 harness writeTaskFile——
 *  那个只写 Proposal 无 AC 段且固定 status，不适配本判定）。 */
function writeAcTaskBody(worktree, taskId, acLines, dodLines = ["- [x] landed"]) {
  fs.mkdirSync(path.join(worktree, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "tasks", `${taskId}.md`), [
    "---", `id: ${taskId}`, "title: ac-shortcircuit", "status: ready", "labels: []", "extra: {}", "---",
    "## Proposal", "prose", "## Plan", "plan",
    "## Touches", "- docs/feature.md",
    "## Acceptance Criteria", ...acLines,
    "## Definition of Done", ...dodLines, "",
  ].join("\n"), "utf8");
}

test("AC_B1 (gap-worker-ac-check-shortcircuit) — AC 未全勾 ⇒ shortCircuit:true + 原因含「AC 未全勾」（⛔ 仍 spawn fan-in ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b1-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [ ] AC2 todo"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "unchecked impl item must short-circuit (⛔ spawn fan-in ⇒ false)");
  assert.match(v.reason, /AC 未全勾/);
  assert.match(v.reason, /2\/3/, "reason carries checked/total (2/3 = AC1✓ + DoD✓ / AC2✗)");
});

test("AC_B1b (gap-worker-ac-check-shortcircuit) — AC/DoD 段缺失 ⇒ fail-closed shortCircuit:true（硬规则 3b 无法评估 ≠ 合格）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b1b-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wt = path.join(base, "wt");
  fs.mkdirSync(path.join(wt, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(wt, "tasks", "gap-x.md"), "---\nid: gap-x\nstatus: ready\n---\n\n## Proposal\n\nbody\n", "utf8");
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "missing AC/DoD section must fail-closed short-circuit (⛔ 无法评估当合格 ⇒ 假)");
  assert.match(v.reason, /AC 未全勾/);
});

test("AC_B2 (gap-worker-ac-check-shortcircuit) — AC 全勾 ⇒ shortCircuit:false 照常 spawn fan-in（负控制，⛔ 全勾也被短路 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [x] AC2 done"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, false, "all checked must NOT short-circuit (⛔ false block ⇒ 假)");
  assert.equal(v.reason, null);
});

test("AC_B2b (gap-worker-ac-check-shortcircuit) — 剩余未勾均为（待外部）⇒ shortCircuit:false（awaiting-verification 形态，⛔ 误挡 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2b-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const wt = path.join(base, "wt");
  // 剩余唯一未勾项标注（待外部）= 合法交给 fan-in 外部验证（suite 绿等），worker 退出手法正确——
  // ⛔ 与「漏勾」区分：漏勾是非待外部项，这才短路。
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [ ] AC2 全量套件绿（待外部）"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, false, "all-remaining-（待外部）must NOT short-circuit (⛔ 误挡 external-verification 形态 ⇒ 假)");
  assert.equal(v.reason, null);
});

test("AC_B1 接线 (gap-worker-ac-check-shortcircuit) — finishAsync 在 spawn 前查 acShortCircuitVerdict，短路时不 spawn fan-in（spawn 计数 0）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 短路判定在 spawnMechanicalFanIn 之前调用，短路 ⇒ 走 shortCircuitReason 分支（不 spawn）。
  assert.match(src, /const sc = acShortCircuitVerdict\(paths\[0\], taskId\);/, "finishAsync calls acShortCircuitVerdict before spawning fan-in");
  assert.match(src, /if \(sc\.shortCircuit\) \{\s*\n\s*shortCircuitReason = sc\.reason;/, "short-circuit sets shortCircuitReason instead of spawning");
  // spawnMechanicalFanIn 只在 else 分支（shortCircuit:false）调用 ⇒ 短路时 spawn 计数 0。
  assert.match(src, /mechResult = await spawnMechanicalFanIn\(\{ task: taskId, worktree: paths\[0\], root: rootDir, runId \}\)/, "fan-in spawns only when not short-circuited");
  // 短路原因线程进 finish → computeOutcome（landed:false + landReason 含「AC 未全勾」）。
  assert.match(src, /landed: shortCircuitReason != null \? false/, "short-circuit forces landed=false (exited-not-landed)");
  assert.match(src, /landReason: shortCircuitReason != null \? shortCircuitReason/, "short-circuit reason is threaded as landReason (failure_reason)");
});

// ── gap-write-suite-capture-non-blocking AC1 ──────────────────────────────────────────────────────────
// writeSuiteCapture 写失败（观测写）不得弄死 fan-in（人 2026-08-30「观测不得阻塞主执行」）。capture 是
// suite 结果的派生观测载体；写失败 fail-open（WARN 不抛），ff 闸回退读权威源 full-suite-state.json
// （同一轮 mirrorMechanicalFanInSuiteState 已写 state=green + commit=suite_head + taskId）⇒ 绿 suite 落地。

test("AC1 (gap-write-suite-capture-non-blocking) — capture 写失败（父目录是文件）⇒ fan-in fail-open 落地（⛔ 不因观测写失败弄红）", async (t) => {
  const m = makeMechRepo("capfail");
  const runId = "mf-run-capfail";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  // capture 路径的父目录是一个【文件】⇒ writeSuiteCapture 的 mkdirSync 失败（真实构造，非 mock）。
  // ⛔ fan-in 不得因此 fail：capture 缺失 ⇒ ff 闸回退读权威源 full-suite-state.json。
  const blocker = path.join(m.base, "capture-blocker");
  fs.writeFileSync(blocker, "not a dir", "utf8");
  const badCapture = path.join(blocker, "suite.env");
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCapture: badCapture }));
  assert.equal(r.outcome, "landed", `capture write failure must fail-open (fan-in lands, ⛔ not red) — step=${r.step} reason=${r.reason}`);
  assert.equal(r.suiteOutcome, "done", "the suite itself must still be green");
  assert.ok(!fs.existsSync(badCapture), "the capture path is genuinely unwritable (no capture file written)");
});

// ── gap-worker-driver-resident-loop-intermittent-hang：驻留环错误边界 ────────────────────────────────
// 根因：runResidentLoop 循环体无 try/catch——任何一步瞬时抛错（负载下偶发 fs/git/spawn 异常）⇒ 未处理
// rejection ⇒ 驱动静默死掉，.quay/ 只剩 liveness log、round/outcome 停写（与「一切正常」同形，硬规则
// 3b/4b）。修法：循环体每步记 step + try/catch，抛错 ⇒ 写 action=error 的 round 记录（error_step +
// stop_reason 指到步骤，AC1 定位）+ resident-error 事件 + sleep 后继续（瞬时错误自愈，⛔ 不静默停摆）。
// AC3 生产 round 无停写窗口 = error round 仍写 worker-round.jsonl（与正常 round 同载体）。

test("computeWorkerRoundRecord action=error carries error/error_step（AC1 定位 + 记录形状，⛔ 与「无错」混淆）", () => {
  const rec = computeWorkerRoundRecord({
    round: 7,
    runId: "r",
    pid: 123,
    at: "2026-09-01T00:00:00.000Z",
    action: "error",
    inFlight: 0,
    pool: 1,
    stopReason: "error (step=ready-pool): boom",
    error: "boom",
    errorStep: "ready-pool",
    liveness: { checked: true, deaths: null, running: true },
    coldStartInflight: [],
  });
  assert.equal(rec.action, "error");
  assert.equal(rec.error, "boom");
  assert.equal(rec.error_step, "ready-pool");
  assert.match(rec.stop_reason, /step=ready-pool/);
  // 正常 round 无 error 字段 ⇒ null（⛔ 缺键与 null 可区分——error round 有该字段且非 null）。
  const normal = computeWorkerRoundRecord({
    round: 8, runId: "r", pid: 123, at: "t",
    action: "idle", inFlight: 0, pool: 0, stopReason: null, coldStartInflight: [],
  });
  assert.equal(normal.action, "idle");
  assert.equal(normal.error, null);
  assert.equal(normal.error_step, null);
});

test("AC1 (能取假) — 驻留环错误边界在源：循环体有 step-trace + try/catch + writeErrorRound（⛔ 无边界 ⇒ 抛错静默死）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 错误边界：catch 写 error round + resident-error 事件。
  assert.match(src, /catch \(err\)\s*\{/, "the loop body has a catch boundary");
  assert.match(src, /writeErrorRound\(round, step, message, stack, liveness, poolSeen, running\.length\)/, "the catch writes an error round");
  assert.match(src, /event: "resident-error"/, "the catch emits a resident-error JSON event");
  // step-trace：每步记 step（AC1 定位——error_step 指到具体步骤，⛔ 只报「挂起」不指位置 ⇒ 假）。
  for (const step of ["cold-start-inflight", "liveness", "reap", "reconcile", "dispatch-loop", "ready-pool", "apply-filters", "selector", "spawn-worker", "write-round", "sleep", "wait-in-flight"]) {
    assert.match(src, new RegExp(`step = "${step}"`), `step-trace marks ${step}`);
  }
});

// ── gap-fan-in-continue-doc-only-advance-reuse-suite ───────────────────────────────────────────────
// develop 在长 suite 期间被 doc/inert 前进 ⇒ ff not-fast-forward ⇒ CONTINUE 重跑。suite 是
// (develop HEAD × delta) 的纯函数；若上一轮 green bucket suite（full-suite-state.json 的 mirror 记录）
// 之后、当前 HEAD 只触及 doc/inert 面（develop 前进面），则复用上一 green 判定、不重跑 suite。AC1 取假
// （doc/inert-only 前进 ⇒ 无 suite 运行记录）；AC2 负控制（code 前进 ⇒ 照常重跑）；AC4 单测钉死读面。

/** 建一个「上一轮 green suite 后 develop 被 doc 或 code 前进」的 hermetic repo：develop 上 base 提交 +
 *  tasks/gap-reuse.md（Touches 声明 code 文件 + AC 全勾），task/gap-reuse 分支上一个 code 提交
 *  （plugin/scripts/foo.mjs）⇒ merge develop 成 M1（上一轮 green 的 suite_head，seed 进 full-suite-state.json）
 *  ⇒ develop 再前进一个 doc 或 code 提交。fan-in 重跑时 step 2 merge 前进面、step 4 判复用。
 *  advanceKind: 'doc' | 'code'。返回 { base, repo, worktree, slotBase, capture, m1 }。 */
function makeReuseRepo(tag, advanceKind) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `fanin-reuse-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "fanin-reuse-test"]);
  runGit(repo, ["config", "user.email", "reuse@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  // classify-delta 读 registry 的单一真相源 plugin/scripts/runner-static-gate.ts（空 registry ⇒ doc 面才判
  // doc、其余 fail-closed 到 code）。⛔ 无此文件 classify 直接 exit 2 ⇒ codeDelta=__CLASSIFY_FAILED__。
  fs.mkdirSync(path.join(repo, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "plugin", "scripts", "runner-static-gate.ts"), "// hermetic registry stub — empty registry\n", "utf8");
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", "gap-reuse.md"), [
    "---", "id: gap-reuse", "title: develop advance suite reuse test", "status: ready",
    "labels: []", "extra: {}", "---",
    "## Proposal", "test", "## Plan", "test",
    "## Touches", "- plugin/scripts/foo.mjs",
    "## Acceptance Criteria", "- [x] AC1 landed",
    "## Definition of Done", "- [x] landed", "",
  ].join("\n"), "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "base"]);
  runGit(repo, ["worktree", "add", "-q", worktree, "-b", "task/gap-reuse"]);
  // develop 脱离主检出（同 makeMechRepo：ff 退化纯 ref 更新，⛔ 不撞 checked-out branch）。
  runGit(repo, ["checkout", "-q", "-b", "develop-work"]);
  // task 分支上的 code 提交（任务自身 delta = code ⇒ 正常 needSuite）。
  fs.mkdirSync(path.join(worktree, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "plugin", "scripts", "foo.mjs"), "export const foo = 1;\n", "utf8");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "implement code change"]);
  // develop 前进一个 doc 提交（上一轮 suite 会 merge 的 develop HEAD）。
  runGit(repo, ["checkout", "-q", "develop"]);
  fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "docs", "adv1.md"), "# advance 1\n", "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "develop advance 1 (doc)"]);
  runGit(repo, ["checkout", "-q", "develop-work"]);
  // task 分支 merge develop ⇒ M1（上一轮 green suite 的 suite_head）。
  runGit(worktree, ["merge", "-q", "--no-edit", "develop"]);
  const m1 = runGit(worktree, ["rev-parse", "HEAD"]).trim();
  // develop 再前进（doc 或 code）——这一轮 fan-in 的 step 2 把它 merge 进 M1 成 M2。
  runGit(repo, ["checkout", "-q", "develop"]);
  if (advanceKind === "code") {
    fs.mkdirSync(path.join(repo, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, "plugin", "scripts", "bar.mjs"), "export const bar = 2;\n", "utf8");
  } else {
    fs.writeFileSync(path.join(repo, "docs", "adv2.md"), "# advance 2\n", "utf8");
  }
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", `develop advance 2 (${advanceKind})`]);
  runGit(repo, ["checkout", "-q", "develop-work"]);
  // seed 权威源 full-suite-state.json（mirror 记录：state=green + taskId=gap-reuse + commit=m1）。⛔ 必须在
  // 最后一次 git checkout 之后写——hermetic repo 无 .gitignore，先写再 `git add -A`+`checkout` 会把
  // .quay/ 提交进 develop 再被 checkout develop-work 删除（ENOENT ⇒ 读不到 ⇒ 假 no-reuse）。
  fs.mkdirSync(path.join(repo, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", taskId: "gap-reuse", commit: m1 }), "utf8");
  const slotBase = path.join(base, "full-suite.lock");
  const capture = path.join(base, "suite.env");
  return { base, repo, worktree, slotBase, capture, m1 };
}

test("AC4 (gap-fan-in-continue-doc-only-advance-reuse-suite) — readPreviousGreenSuiteCommit：green+taskId+40-hex commit ⇒ sha；red / 异 task / 非法 commit / 缺文件 ⇒ null", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-read-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const f = path.join(base, "full-suite-state.json");
  const sha = "a".repeat(40);
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-t", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), sha, "green + taskId + 40-hex commit ⇒ the sha");
  fs.writeFileSync(f, JSON.stringify({ state: "red", taskId: "gap-t", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "red ⇒ null (no green cert)");
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-other", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "different task ⇒ null (⛔ 不冒名)");
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-t", commit: "not-a-sha" }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "non-40-hex commit ⇒ null (读不懂 ≠ 绿)");
  assert.equal(readPreviousGreenSuiteCommit(path.join(base, "missing.json"), "gap-t"), null, "missing file ⇒ null (缺值 = 未查)");
});

test("AC1 (gap-fan-in-continue-doc-only-advance-reuse-suite) — develop 仅 doc 前进 ⇒ 复用上一 green、不重跑 suite（无 suite step + skip_reason=reuse + landed）", async (t) => {
  const m = makeReuseRepo("doc", "doc");
  const runId = "mf-run-reuse-doc";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const marker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-reuse",
    forceSuite: false,
    suiteCommand: ["bash", "-c", `echo ran > "${marker}"; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `doc-only develop advance must reuse prev green and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, null, "suite must NOT run (reused prev green — ⛔ 仍跑 suite 再判则假)");
  assert.equal(fs.existsSync(marker), false, "suite command must NOT execute (doc-only develop advance ⇒ reuse)");
  const capture = fs.readFileSync(m.capture, "utf8");
  assert.match(capture, /full_suite_ran=false/);
  assert.match(capture, /skip_reason=develop-advance-doc-only-reuse/);
  // 过程日志：无 suite-start/suite-end，只有 suite-skip（reuse reason）——AC1「该轮无 suite step」。
  const log = path.join(m.repo, ".quay", `fan-in-gap-reuse-${runId}.log`);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.some((l) => l.step === "suite-start" || l.step === "suite-end"), false, "no suite step in the trace (AC1)");
  const skip = lines.find((l) => l.step === "suite-skip");
  assert.ok(skip && /develop-advance-doc-only-reuse/.test(skip.reason ?? ""), "suite-skip trace carries the reuse reason");
});

test("AC2 (gap-fan-in-continue-doc-only-advance-reuse-suite) — develop code 前进 ⇒ 照常重跑 suite（不削弱合并验证）", async (t) => {
  const m = makeReuseRepo("code", "code");
  const runId = "mf-run-reuse-code";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const marker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-reuse",
    forceSuite: false,
    suiteCommand: ["bash", "-c", `echo ran > "${marker}"; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `code develop advance must re-run suite and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, "done", "suite must RUN (code advance ⇒ no reuse)");
  assert.equal(fs.existsSync(marker), true, "suite command must execute (code develop advance ⇒ re-run)");
});

// ── gap-fan-in-step-trace-suite-step-stopped-writing ───────────────────────────────────────────
// 病根：a5a301e03（gap-mech-fan-in-log-webui-visible-clickable）把 suite 决策步骤（ac-precheck /
// suite-start / suite-end / suite-skip）的 trace 目标从共享 .quay/fan-in-step-trace.jsonl 改指向
// per-run .quay/fan-in-<task>-<runId>.log，没同步保留共享写 ⇒ 依赖共享文件做跨任务/跨时间聚合的
// 读者（伴生对照停写检测、gap-archguard-p5-instrument-decay-standing-guard）从此看不到这批步骤。
// 修法：traceSuiteEvent 两路都写（共享 + per-run）；两载体 suite 决策条目数一致。

test("AC2/AC3 (gap-fan-in-step-trace-suite-step-stopped-writing) — suite 决策步骤同时写共享 fan-in-step-trace.jsonl 与 per-run 日志（同 runId 两载体条目数一致且都 > 0）", async (t) => {
  const m = makeMechRepo("step-trace-suite");
  const runId = "mf-run-step-trace-suite";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  // 共享载体：同一 runId 下 suite 决策步骤各出现一次（AC2）。
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const suiteSteps = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.ok(suiteSteps.some((l) => l.step === "ac-precheck"), "shared carrier must have ac-precheck");
  assert.ok(suiteSteps.some((l) => l.step === "suite-start"), "shared carrier must have suite-start");
  assert.ok(suiteSteps.some((l) => l.step === "suite-end"), "shared carrier must have suite-end");
  assert.equal(suiteSteps.some((l) => l.step === "suite-skip"), false, "needSuite path must NOT write suite-skip");
  assert.equal(suiteSteps.length, 3, "needSuite path ⇒ ac-precheck + suite-start + suite-end = 3 shared suite entries");
  // per-run 载体：suite 决策条目数与共享一致（AC3 两载体对照）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, suiteSteps.length, "per-run and shared carriers carry the same count of suite decision entries (AC3)");
});

test("AC2/AC3 (跳过路径) — doc-only develop 前进 ⇒ suite-skip 也两路都写", async (t) => {
  const m = makeReuseRepo("step-trace-skip", "doc");
  const runId = "mf-run-step-trace-skip";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { task: "gap-reuse", forceSuite: false }));
  assert.equal(r.outcome, "landed", `doc-only develop advance must reuse prev green and land (step=${r.step} reason=${r.reason})`);
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const sharedSkip = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(sharedSkip.length, 1, "skip path ⇒ exactly one suite decision entry in shared carrier (suite-skip)");
  assert.equal(sharedSkip[0].step, "suite-skip");
  assert.match(sharedSkip[0].reason ?? "", /develop-advance-doc-only-reuse/, "shared suite-skip carries the reuse reason");
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-reuse", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, 1, "per-run carrier must match (suite-skip only)");
});

// ── gap-worker-execution-history-index-not-reachable-from-task（A：suiteLog 记录）──────────────────
// A 缺口的病根：机械 fan-in 的 suite 步失败时 verdict.logFile 一路 null（183KB 真因文件只能靠命名约定猜，
// 硬规则 4c「穿不过中间层的量」）。修法：suite 红 ⇒ mechanical_fan_in.suiteLog（basename）+ verdict.logFile
// 指向 .quay/fan-in-suite-*.log 绝对路径；非 suite 红 ⇒ suiteLog null（负控制）。

test("A (能取假) — suite 红 ⇒ suiteLog 非 null + verdict.logFile 指向 suite 日志（⛔ 仍 null ⇒ 假）", async (t) => {
  const m = makeMechRepo("suite-log");
  const runId = "mf-run-suitelog";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "echo suite-failing; exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.equal(r.suiteLog, "suite.log", "suite 红 ⇒ suiteLog 落 basename（⛔ null ⇒ 假）");
  assert.equal(r.verdict.logFile, path.join(m.base, "suite.log"), "verdict.logFile 指向 suite 日志绝对路径（⛔ null ⇒ 假）");
  assert.ok(fs.existsSync(path.join(m.base, "suite.log")), "suite 日志文件在盘上（续做/needs-human 可到达）");
});

test("A (负控制) — 非 suite 红（scoped-gate）⇒ suiteLog null（⛔ 别的步误设 suiteLog ⇒ 假）", async (t) => {
  const m = makeMechRepo("suite-log-neg");
  const runId = "mf-run-suitelog-neg";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { scopedGateCommand: ["false"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "scoped-gate");
  assert.equal(r.suiteLog, null, "非 suite 红 ⇒ suiteLog null（只有 suite 步记 suite 真因日志）");
});

// ── gap-fan-in-suite-log-same-runid-overwrite（AC1/AC2/AC4）───────────────────────────────────
// 病根：suite 日志只按 (task, runId) 命名、无 attempt 后缀 ⇒ 同一 runId 内多次 suite 后一次覆盖前一次。
// 修法：缺省命名带 attempt 唯一后缀（epoch-ms+rand）；verdict.logFile/suiteLog 指向本次尝试自己的文件。

/** 轮询读日志直到含 needle（suite 子进程 stdout 经 WriteStream 落盘有微小异步，⛔ 不等即读会 flaky）。 */
async function readSuiteLogUntil(file, needle, timeoutMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const txt = fs.readFileSync(file, "utf8");
      if (txt.includes(needle)) return txt;
    } catch { /* not yet written */ }
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("AC1/AC2 — 同一 runId 连续两次 suite 红 ⇒ 两份日志各自独立、互不覆盖 + verdict.logFile/suiteLog 指向各自本次", async (t) => {
  const m = makeMechRepo("same-runid-suite");
  const runId = "wk-prod-same-runid";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  // ⛔ 不注入 suiteLogFile（走缺省命名——被测的 attempt 唯一后缀逻辑）；两次不同 marker 命令以区分内容。
  const opts = (marker) => mechOpts(m, runId, {
    suiteLogFile: null,
    suiteCommand: ["bash", "-c", `echo attempt-${marker}; exit 1`],
  });
  const r1 = await runMechanicalFanIn(opts("one"));
  const r2 = await runMechanicalFanIn(opts("two"));
  assert.equal(r1.outcome, "red"); assert.equal(r1.step, "suite");
  assert.equal(r2.outcome, "red"); assert.equal(r2.step, "suite");
  assert.ok(r1.suiteLog && r2.suiteLog, "both red suite attempts carry a suiteLog basename");
  assert.notEqual(r1.suiteLog, r2.suiteLog, "two attempts ⇒ two DISTINCT suiteLog basenames（⛔ 相同 ⇒ 假）");
  const f1 = path.join(m.repo, ".quay", r1.suiteLog);
  const f2 = path.join(m.repo, ".quay", r2.suiteLog);
  assert.notEqual(f1, f2, "two distinct absolute paths（同一路径 ⇒ 后写覆盖先写 = 假）");
  assert.ok(fs.existsSync(f1) && fs.existsSync(f2), "both logs on disk");
  // 指针正确性（AC2）：verdict.logFile 指向本次尝试自己的文件（⛔ 指向共享/被覆盖路径 ⇒ 假）。
  assert.equal(r1.verdict.logFile, f1, "attempt-1 verdict.logFile points at its own file");
  assert.equal(r2.verdict.logFile, f2, "attempt-2 verdict.logFile points at its own file");
  // 内容独立（AC1 互不覆盖）：第一份仍可读到自己的 marker，第二份只有自己的 marker。
  assert.match(await readSuiteLogUntil(f1, "attempt-one") ?? "", /attempt-one/, "attempt-1 log readable with its own content");
  assert.doesNotMatch(await readSuiteLogUntil(f2, "attempt-two") ?? "", /attempt-one/, "attempt-2 log NOT polluted by attempt-1 content");
});

test("AC4 — 真实多次-suite-red runId 回放（gap-dashboard-taskcard-multistatus-minitable / wk-prod-1788275557）⇒ 两份日志各自独立、都可读", async (t) => {
  const m = makeMechRepo("ac4-real-replay", "gap-dashboard-taskcard-multistatus-minitable");
  const runId = "wk-prod-1788275557"; // 实测同 runId 下 2 次独立 suite red 的真实 runId。
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const opts = (marker) => mechOpts(m, runId, {
    task: "gap-dashboard-taskcard-multistatus-minitable",
    suiteLogFile: null,
    suiteCommand: ["bash", "-c", `echo red-attempt-${marker}; exit 1`],
  });
  const r1 = await runMechanicalFanIn(opts("first"));
  const r2 = await runMechanicalFanIn(opts("second"));
  assert.equal(r1.outcome, "red"); assert.equal(r1.step, "suite");
  assert.equal(r2.outcome, "red"); assert.equal(r2.step, "suite");
  assert.notEqual(r1.suiteLog, r2.suiteLog, "same runId, two suite attempts ⇒ two distinct logs（⛔ 仍共享 ⇒ 假）");
  const f1 = path.join(m.repo, ".quay", r1.suiteLog);
  const f2 = path.join(m.repo, ".quay", r2.suiteLog);
  assert.match(await readSuiteLogUntil(f1, "red-attempt-first") ?? "", /red-attempt-first/, "first attempt readable");
  assert.match(await readSuiteLogUntil(f2, "red-attempt-second") ?? "", /red-attempt-second/, "second attempt readable (its own content, ⛔ 被覆盖则读不到)");
});

// ── gap-needs-human-note-missing-real-error-line ────────────────────────────────────────────────
// suite 红 needs-human 的「失败步/判词」恒为 step=suite: suite red（failSuite 只拼 sr.error，而 sr.error 对
// red 恒 null）⇒ 人每次要开 500KB-1MB 的 suite log 手动 grep 才拿得到真实报错行。修法：suite 判红处复用
// extractFailureSummary 同源信号正则（extractFirstFailureLine），把 suite 日志第一条真实断言/报错行塞进
// mechanical_fan_in.reason。AC1 取假（记录含真实错误原文）；AC2 负控制（无信号 ⇒ 回退通用文案）。

test("extractFirstFailureLine — 取第一条真实失败信号行；无信号/纯噪声 ⇒ 空串（⛔ 不回退 meaningful）", () => {
  assert.equal(extractFirstFailureLine(""), "");
  assert.equal(
    extractFirstFailureLine("benign line\nAssertionError [ERR_ASSERTION]: probe must be alive\nmore noise"),
    "AssertionError [ERR_ASSERTION]: probe must be alive",
    "returns the first real assertion line",
  );
  // 无信号 ⇒ 空串（extractFailureSummary 会回退 meaningful，本函数必须仍为空——AC2「无匹配行 ⇒ 回退通用文案」）。
  assert.equal(extractFirstFailureLine("benign line only\nanother benign"), "");
  // 噪声行被跳过，取第一个真实信号。
  assert.equal(
    extractFirstFailureLine("(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: x\nnot ok 1 - my-test"),
    "not ok 1 - my-test",
    "MODULE_TYPELESS noise is skipped, first real signal is returned",
  );
});

test("extractFirstFailureLine — 标题行/静态检查良性判词/✔通过测试排在真实失败前 ⇒ 取真实断言（⛔ 归因错位到 split-or-commit 标题）", () => {
  const log = [
    "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==",
    "checker-mechanical-spine-check — 115 checker(s), 0 violation(s), 0 exempted",
    "PASS: 1711 task(s) checked — no split-or-commit violations",
    "✔ assertionSignaturesFromSuiteLog — 提取并归一化 AssertionError 签名（[ERR_ASSERTION] 变体）",
    "✖ AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发 (in-flight worktree set changes every round)",
    "  AssertionError [ERR_ASSERTION]: worktree add wt-2 failed: cannot change to session-liveness repo",
    "__PERFILE__ duration_ms=18921 plugin/test/session-liveness-scd-inflight-changing.test.mjs passed=false end_ms=1",
  ].join("\n");
  const line = extractFirstFailureLine(log);
  assert.match(line, /AssertionError \[ERR_ASSERTION\]: worktree add wt-2 failed/, "取真实断言原文");
  assert.doesNotMatch(line, /split-or-commit whole-store check/, "⛔ 标题行被当失败摘要");
  assert.doesNotMatch(line, /0 violation\(s\)/, "⛔ 静态检查良性判词被当失败摘要");
});

test("AC1 (能取假) — suite 红 needs-human 记录「失败步/判词」含真实 AssertionError 原文（⛔ 恒定 suite red ⇒ 假）", async (t) => {
  const m = makeMechRepo("nh-real-error");
  const runId = "wk-prod-nh-real-error";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c", "echo 'AssertionError [ERR_ASSERTION]: probe must be alive'; exit 1"],
  }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  // 核心：reason 携带真实断言原文，⛔ 恒定的「suite red」。
  assert.match(r.reason ?? "", /probe must be alive/, "suite red reason carries the real assertion text");
  assert.doesNotMatch(r.reason ?? "", /^suite red$/, "reason is no longer the constant 'suite red'");
  // 全链：机械 fan-in 的 reason → worker-outcome.jsonl → markNeedsHuman 注记「失败步/判词」行。
  fs.mkdirSync(path.join(m.repo, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(m.repo, ".quay", "worker-outcome.jsonl"), JSON.stringify({
    ts: "2026-09-03T00:00:00.000Z", task: "gap-mfh", final_state: "exited-not-landed",
    run_id: runId, session_id: "sess-nh",
    mechanical_fan_in: { outcome: "red", step: "suite", reason: r.reason, suiteLog: r.suiteLog, fanInLog: r.fanInLog },
  }) + "\n", "utf8");
  const nh = markNeedsHuman(m.repo, "gap-mfh", "worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）");
  assert.equal(nh.ok, true);
  const body = fs.readFileSync(path.join(m.repo, "tasks", "gap-mfh.md"), "utf8");
  assert.match(body, /失败步\/判词：[^\n]*AssertionError[^\n]*probe must be alive/, "needs-human 注记「失败步/判词」行含真实断言原文");
  assert.doesNotMatch(body, /失败步\/判词：[^\n]*suite red/, "注记不再是恒定的 suite red");
});

test("AC1（真实形）— suite 日志含标题行/静态检查良性判词 + 真实 AssertionError ⇒ reason 取真实断言，⛔ 标题行", async (t) => {
  const m = makeMechRepo("nh-real-error-shaped");
  const runId = "wk-prod-nh-real-error-shaped";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c",
      "echo '== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =='; " +
      "echo 'checker-mechanical-spine-check — 115 checker(s), 0 violation(s), 0 exempted'; " +
      "echo 'AssertionError [ERR_ASSERTION]: probe must be alive'; exit 1"],
  }));
  assert.equal(r.outcome, "red");
  assert.match(r.reason ?? "", /probe must be alive/, "reason 携带真实断言原文（⛔ 标题行）");
  assert.doesNotMatch(r.reason ?? "", /split-or-commit whole-store check/, "reason ⛔ 标题行");
});

test("AC2 (负控制) — suite 输出无可提取信号 ⇒ reason 回退通用文案「suite red」（⛔ 伪造/截断出误导内容 ⇒ 假）", async (t) => {
  // ① 零输出、仅非零退出码。
  const m = makeMechRepo("nh-no-signal");
  const runId = "wk-prod-nh-no-signal";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r1 = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r1.outcome, "red");
  assert.equal(r1.reason, "suite red", "zero output ⇒ fallback to generic 'suite red'");

  // ② 有输出但无信号行（benign 非断言行）——⛔ extractFailureSummary 会回退 meaningful，本路径必须仍回退通用文案。
  const m2 = makeMechRepo("nh-benign");
  t.after(() => fs.rmSync(m2.base, { recursive: true, force: true }));
  const r2 = await runMechanicalFanIn(mechOpts(m2, runId, { suiteCommand: ["bash", "-c", "echo 'refresh-worktree-quay: copied 499 file(s)'; exit 1"] }));
  assert.equal(r2.outcome, "red");
  assert.equal(r2.reason, "suite red", "benign non-signal output ⇒ fallback (⛔ not the benign line)");
});

test("AC3 (负控制) — split-or-commit 真失败 ⇒ reason 仍携带其真实 violation（⛔ 改提取逻辑后丢真失败）", async (t) => {
  const m = makeMechRepo("nh-soc-real-fail");
  const runId = "wk-prod-nh-soc-real-fail";
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c",
      "echo '== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =='; " +
      "echo 'FAIL: 2 split-or-commit violation(s) found:'; " +
      "echo 'violation: PARENT-DONE-IFF-CHILDREN: task \"parent\" is done but has 1 non-done child'; exit 1"],
  }));
  assert.equal(r.outcome, "red");
  assert.match(r.reason ?? "", /split-or-commit violation/, "负控制：真 split-or-commit 失败仍携带其真实 violation");
  assert.doesNotMatch(r.reason ?? "", /^== split-or-commit whole-store check/, "reason ⛔ 标题行");
});

test("AC3 — landed 后清理该任务名下全部历史 attempt 日志；兄弟任务 `<task>-<suffix>` 日志保留（⛔ 只增不减/误删 ⇒ 假）", async (t) => {
  const m = makeMechRepo("prune-on-land");
  t.after(() => fs.rmSync(m.base, { recursive: true, force: true }));
  const q = path.join(m.repo, ".quay");
  fs.mkdirSync(q, { recursive: true });
  // 预埋：本任务 gap-mfh 两份历史红 attempt 日志（跨 runId）+ 兄弟任务 gap-mfh-A 一份（⛔ 不得被误删）。
  const h1 = suiteLogFileName("gap-mfh", "wk-prod-old-1", "1");
  const h2 = suiteLogFileName("gap-mfh", "wk-prod-old-2", "1");
  const sibling = suiteLogFileName("gap-mfh-A", "wk-prod-old-1", "1");
  fs.writeFileSync(path.join(q, h1), "old-red-1", "utf8");
  fs.writeFileSync(path.join(q, h2), "old-red-2", "utf8");
  fs.writeFileSync(path.join(q, sibling), "sibling", "utf8");
  // 落地一次（mechOpts 缺省 suite 绿 ⇒ landed → cleanup 触发 prune）。
  const r = await runMechanicalFanIn(mechOpts(m, "wk-prod-land"));
  assert.equal(r.outcome, "landed", `must land (step=${r.step} reason=${r.reason})`);
  assert.ok(!fs.existsSync(path.join(q, h1)) && !fs.existsSync(path.join(q, h2)), "historical attempt logs pruned after landing");
  assert.ok(fs.existsSync(path.join(q, sibling)), "sibling task log retained（⛔ `-` boundary 误删 ⇒ 假）");
});
