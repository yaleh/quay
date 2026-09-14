// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
import { test, after } from "node:test";
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
  resolveWorkerProcessName,
  upsertDispatchRecord,
  dispatchStoreFile,
  readDispatchStore,
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
  extractSuiteNotRunLine,
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
  normalizeAssertionSignature,
  judgeRetryExemption,
  RETRY_EXEMPTION_WINDOW_MS_DEFAULT,
} from "../scripts/worker-driver.ts";
import { defaultLaneCount, SUITE_LOG_NOT_RUN_PREFIX } from "../scripts/full-suite-runner.ts";
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
  rmSafe,
  stopAllResidentDrivers,
  waitFor,
  writeTaskFile,
  writeTouchedTask,
  counterNodeE,
} from "./helpers/worker-driver-harness.mjs";

// ── 文件级兜底（同 worker-driver-resident.test.mjs）：常驻驱动是本文件 spawn 的 detached 子进程，
// 它持着本文件进程的子进程句柄 ⇒ 文件进程永不退出 ⇒ 套件在本文件上静默 ⇒ 静默看门狗杀整个套件。
// 测试级 after 钩子会被【前一个抛错的钩子】整体跳过，文件级 after 钩子不会 ⇒ 无论哪个测试怎么炸，
// 本文件绝不留下活驱动。
after(async () => { await stopAllResidentDrivers(); });

// 结构面（能取假）：本文件 after 钩子里的删除必须走 rmSafe（⛔ 裸 fs.rmSync）——一次抛错会跳过该测试
// 剩余的全部 after 钩子（含 drv.stop()）⇒ 驱动泄漏 ⇒ 套件静默。判据读【本文件源码】按钩子切窗；
// 窗口数不足视为【没解析到】而非【都合格】（硬规则 3b）。两个针由片段拼出，避免自匹配（硬规则 2）。
test("结构面（能取假）— after 钩子里的删除一律走 rmSafe（裸 fs.rmSync 抛错会跳过后续 drv.stop()）", () => {
  const HOOK = "t." + "after(";
  const RAW_RM = "fs." + "rmSync(";
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const hooks = src.split(HOOK).slice(1);
  const offenders = [];
  hooks.forEach((h, i) => {
    const end = h.includes("\n  });") ? h.indexOf("\n  });") + 7 : h.indexOf("\n") + 1;
    const win = h.slice(0, end > 0 ? end : h.length);
    if (win.includes(RAW_RM)) offenders.push(`hook#${i + 1}`);
  });
  assert.ok(hooks.length >= 10, `解析到 ${hooks.length} 个 after 钩子 —— 少于 10 说明判据没看到它们（空转，⛔ 不是"都合格"）`);
  assert.deepEqual(offenders, [], `after 钩子仍用裸 fs.rmSync（改用 rmSafe）：${offenders.join(", ")}`);
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
    rmSafe(root);
    rmSafe(wtPath);
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
    rmSafe(root);
    rmSafe(wtPath);
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
    rmSafe(root);
    rmSafe(wtPath);
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
    rmSafe(root);
    rmSafe(wtPath);
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
    rmSafe(root);
    rmSafe(wtPath);
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));

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
    rmSafe(root);
    rmSafe(wtPath);
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
  t.after(() => rmSafe(root));

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
  t.after(() => rmSafe(root));

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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));

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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(root));
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

// ── gap-retry-exemption-signature-keeps-volatile-values：签名归一化必须折易变量 ⛔ 不折身份 ──────────
// 根因：归一化只折叠空白 ⇒ pid / 毫秒 / 路径 / 哈希留在签名里 ⇒ 同一缺陷每次运行给出**新**签名 ⇒
// 「≥2 个不同任务命中同一签名」结构上永不成立 ⇒ 专为「不相关 flaky 不压垮受害任务」而造的豁免恒空。
// 本段是**双向控制**：①同一缺陷（易变量各异）跨 2 任务 ⇒ 必须豁免；②两个**不同**缺陷（易变量各异）
// ⇒ 必须仍计数。②是①的取假器——把归一化写过头的实现（例如抹掉整个签名）会让②立刻翻红。

test("AC3 (反向控制) — 两个【不同】缺陷（易变量各异）跨 2 任务 ⇒ 仍 own-defect-counted（⛔ 归一化过头即红）", (t) => {
  const root = makeRoot("exempt-volatile-ac3");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 缺陷 A 与缺陷 B：措辞不同（缺陷身份不同），但**都**带 pid/路径易变量——若归一化把量抹成恒等占位
  // 甚至抹掉整条签名，两条会并成同一签名 ⇒ 本条从 own-defect-counted 翻成 unrelated-flaky-exempt ⇒ 红。
  const defectA = "probe must be alive: pid=1234 at /home/yale/work/quay-worktrees/gap-a/plugin/test/obs.test.mjs";
  const defectB = "queue depth exceeded: pid=9999 at /home/yale/work/quay-worktrees/gap-b/plugin/test/obs.test.mjs";
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, defectA);
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, defectB);
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");

  assert.notEqual(
    normalizeAssertionSignature(defectA), normalizeAssertionSignature(defectB),
    "AC3 取假器：两个不同缺陷归一化后必须仍不同（相同 ⇒ 归一化把「不同」变成了「同一」）",
  );
  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "own-defect-counted", "different defect ⇒ NOT exempt (count normally)");
  assert.deepEqual(j.recurredTasks, [], "no other task recurred this defect's signature");
});

test("AC2 (正控制) — 同一缺陷的易变量（pid/ms/路径）各异跨 2 任务 ⇒ unrelated-flaky-exempt（⛔ 改前 own-defect-counted）", (t) => {
  const root = makeRoot("exempt-volatile-ac2");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 同一缺陷（driver-runtime AC4「未确认存活」）的两次运行：pid / 耗时 / 工作树路径全不同。
  // 这两条逐字取自 2026-09-13 现场 suite 日志（见任务体 AC1 读数），此处只换 worktree 路径段。
  const run1 = "未确认存活 ⇒ 非零退出：started: supervisor pid=955396 kind=promotion run_id=dr-ac4-short driver pid=955909 confirmed_ms=1044";
  const run2 = "未确认存活 ⇒ 非零退出：started: supervisor pid=2765126 kind=promotion run_id=dr-ac4-short driver pid=2765880 confirmed_ms=1045";
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, run1);
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, run2);
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");

  // 生产缺陷（driver-runtime AC4）在两次运行里逐字不同 ⇒ 改前这两条签名不相等（AC1 能取假读数）。
  assert.notEqual(run1, run2, "AC1 取假：同一缺陷的两次运行逐字不同");
  assert.equal(
    normalizeAssertionSignature(run1), normalizeAssertionSignature(run2),
    "AC2：同一缺陷的易变量折叠后必须相等",
  );
  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "unrelated-flaky-exempt", "same defect (volatile values differ) across ≥2 tasks ⇒ exempt");
  assert.deepEqual(j.recurredTasks, ["gap-b"], "the other task that recurred the signature is named");
});

test("normalizeAssertionSignature — 折易变量（数字/哈希/绝对路径）∧ ⛔ 不折词内数字与措辞", () => {
  // 折：pid / 毫秒 / 端口 / 计数（数字 token）、sha、绝对路径。单位文本保留 ⇒ 数量变、签名不变。
  assert.equal(
    normalizeAssertionSignature("pid=955396 confirmed_ms=1044 at /home/yale/work/quay-worktrees/gap-x/plugin/test/obs.test.mjs"),
    "pid=<n> confirmed_ms=<n> at <path>",
  );
  assert.equal(normalizeAssertionSignature("probe 530ms port 34567"), "probe <n>ms port <n>");
  assert.equal(
    normalizeAssertionSignature("head 4f2a9c1b3d5e6f70819a2b3c4d5e6f708192a3b4"),
    "head <hex>",
  );
  // ⛔ 不折词内数字：`dr-ac4-short` 是**稳定**标识符，折掉它会把 ac4 与 ac7 两个不同用例并成同一签名。
  assert.equal(normalizeAssertionSignature("run_id=dr-ac4-short"), "run_id=dr-ac4-short");
  assert.notEqual(normalizeAssertionSignature("run_id=dr-ac4-short"), normalizeAssertionSignature("run_id=dr-ac7-short"));
  // ⛔ 不折普通英文词里恰好由 a–f 组成的字母（`defaced` 不是哈希）。
  assert.equal(normalizeAssertionSignature("defaced artifact"), "defaced artifact");
  // ⛔ 不折措辞：`AC1/AC2/AC3` 的斜杠不在词首，不当作路径。
  assert.equal(normalizeAssertionSignature("AC1/AC2/AC3 covered"), "AC1/AC2/AC3 covered");
});

test("DoD (落点映射·机械) — 签名归一化只有一个正本点：提取点/归一化点各一处，⛔ 不留第二份易变量清单", () => {
  // 把「唯一正本点」做成可执行判据（⛔ 不是散文承诺）：源码里出现第二处签名提取或第二处空白归一化
  // ⇒ 立刻红。这样「后来有人又在别处拼一份签名逻辑」是机械可见的，不靠记得。
  const src = fs.readFileSync(new URL("../scripts/worker-driver.ts", import.meta.url), "utf8");
  const count = (re) => (src.match(re) || []).length;
  assert.equal(count(/AssertionError\(\?:/g), 1, "断言签名的提取点只许有一处");
  assert.equal(count(/export function normalizeAssertionSignature\(/g), 1, "归一化函数只许定义一次");
  assert.equal(count(/\\s\+\/g/g), 1, "空白归一化只许在唯一正本点里做（第二处 = 第二份清单）");
  // 消费者：两个（跨任务复发扫描 + 判定入口），都经 assertionSignaturesFromSuiteLog 拿到已归一化签名。
  assert.equal(count(/assertionSignaturesFromSuiteLog\(/g), 3, "1 处定义 + 2 处消费者，全部经同一提取点");
});

test("AC4 (硬规则 3b) — 判不出（退化签名 / 无断言行 / suite log 读不到）⇒ insufficient-data-fallback，⛔ 不与豁免同形", (t) => {
  const root = makeRoot("exempt-volatile-ac4");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);

  // ① 退化签名：折叠后连一个字母都不剩（`1 !== 2`）⇒ 在不同缺陷间恒等 ⇒ 不得当作身份 ⇒ 判不出。
  writeSuiteRedLog(root, "fan-in-suite-gap-degenerate.log", EXEMPT_TEST, "1 !== 2");
  const degenerate = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-degenerate.log" } });
  assert.equal(degenerate.verdict, "insufficient-data-fallback", "degenerate signature ⇒ insufficient-data-fallback");
  assert.notEqual(degenerate.verdict, "unrelated-flaky-exempt", "判不出 ≠ 判为无关（硬规则 3b）");

  // ② suite 日志里一条 AssertionError 都没有 ⇒ 判不出（⛔ 不伪造成「无复发」）。
  const p = path.join(root, ".quay", "fan-in-suite-gap-noassert.log");
  fs.writeFileSync(p, `__PERFILE__ duration_ms=10 ${EXEMPT_TEST} passed=false end_ms=1\n`, "utf8");
  const noAssert = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-noassert.log" } });
  assert.equal(noAssert.verdict, "insufficient-data-fallback", "no assertion line ⇒ insufficient-data-fallback");
  assert.notEqual(noAssert.verdict, "unrelated-flaky-exempt", "读不懂 ≠ 豁免");

  // ③ suite log 读不到 / outcome 缺字段 ⇒ 判不出。
  assert.equal(
    judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "no-such-log.log" } }).verdict,
    "insufficient-data-fallback", "unreadable suite log ⇒ insufficient-data-fallback");
  assert.equal(
    judgeRetryExemption(root, "gap-a", { final_state: "exited-not-landed" }).verdict,
    "insufficient-data-fallback", "outcome with no mechanical_fan_in ⇒ insufficient-data-fallback");

  // ④ 退化签名与好签名并存 ⇒ 好签名仍起作用（退化只被丢弃，不污染整条日志）。
  const mixedPath = path.join(root, ".quay", "fan-in-suite-gap-mixed.log");
  fs.writeFileSync(mixedPath,
    `__PERFILE__ duration_ms=10 ${EXEMPT_TEST} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: 1 !== 2\n  AssertionError [ERR_ASSERTION]: probe must be alive\n`, "utf8");
  assert.deepEqual(assertionSignaturesFromSuiteLog(fs.readFileSync(mixedPath, "utf8")), ["probe must be alive"],
    "degenerate signature dropped, non-degenerate one kept");
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

// ── gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task（AC4）────────────
// 孤儿 finalize 的 outcome 带 orphan_pid_liveness（/proc 实测取值）。⛔ 一个【没测量出来的】死亡不得
// 烧重试预算：unknown（/proc 读不到）与 alive（其实还活着）都不算快速死亡，也不打断已测量的连续序列。

test("AC4 (三值分流) — isQuickDeath/recordQuickDeathBackoff：只有实测 'exited' 才算死亡；'unknown'/'alive' 不计入连续计数", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 5000 };

  // ① 纯函数面：同一 (finalState, wallClock) 下三个取值给出不同判定。
  assert.equal(isQuickDeath("failed", 5000, cfg, "exited"), true, "measured exit ⇒ quick death (既有语义不变)");
  assert.equal(isQuickDeath("failed", 5000, cfg, "unknown"), false, "⛔ 没测成的死亡不是死亡");
  assert.equal(isQuickDeath("failed", 5000, cfg, "alive"), false, "⛔ 还活着当然不是死亡");
  assert.equal(isQuickDeath("failed", 5000, cfg, undefined), true, "缺字段（普通 worker 终态）⇒ 既有语义不变");

  // ② AC4 左臂：N 次「无法判定」（N > backoffMaxRetries）⇒ 永远不 needs-human，且状态【不动】。
  const unknownState = newQuickDeathBackoffState();
  for (let i = 0; i < 5; i++) {
    const r = recordQuickDeathBackoff(unknownState, "gap-unk", "failed", 5000, 100_000 + i, 3, cfg, "unknown");
    assert.equal(r.quickDeath, false, `AC4: unknown #${i + 1} is not a quick death`);
    assert.equal(r.newlyNeedsHuman, false, `AC4: unknown #${i + 1} never parks the task needs-human`);
  }
  assert.equal(unknownState.counts.get("gap-unk"), undefined, "AC4: unknown 不计数（⛔ 不烧重试预算）");
  assert.equal(unknownState.backoffUntil.get("gap-unk"), undefined, "AC4: unknown 也不产生退避（没有死亡可退避）");

  // ③ AC4 右臂（同构对照）：同样 N 次，换成「确认已退出」⇒ 到上限即 needs-human。
  const exitedState = newQuickDeathBackoffState();
  let parked = false;
  for (let i = 0; i < 5; i++) {
    parked = recordQuickDeathBackoff(exitedState, "gap-exi", "failed", 5000, 100_000 + i, 3, cfg, "exited").newlyNeedsHuman || parked;
  }
  assert.equal(parked, true, "AC4 对照：5 次【实测】快速死亡 ⇒ 到 maxRetries 标 needs-human");
  assert.ok(exitedState.counts.get("gap-exi") >= 3, "AC4 对照：连续计数已达 maxRetries=3");
  assert.notEqual(unknownState.counts.get("gap-unk"), exitedState.counts.get("gap-exi"),
    "AC4 承重：同一构造下 unknown 与 exited 必须给出【不同】计数结果（否则这条判据什么也没测）");

  // ④ unknown 不打断【已测量】的连续死亡序列（⛔ 与「非快速死亡 ⇒ 复位」刻意不同形，硬规则 3）。
  const mixed = newQuickDeathBackoffState();
  recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_000, 3, cfg, "exited");
  assert.equal(mixed.counts.get("gap-mix"), 1, "one measured quick death");
  recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_001, 3, cfg, "unknown");
  assert.equal(mixed.counts.get("gap-mix"), 1, "unknown 后计数保持 1（⛔ 不复位——否则交错注入 unknown 可洗白真实 streak）");
  const third = recordQuickDeathBackoff(mixed, "gap-mix", "failed", 5000, 100_002, 3, cfg, "exited");
  assert.equal(mixed.counts.get("gap-mix"), 2, "the measured streak continues past an unknown");
  assert.equal(third.newlyNeedsHuman, false, "2 < maxRetries ⇒ not yet parked");
});

// ── AC5 (读生产载体) — 真解析 + 真 /proc + 真 .quay/worker-outcome.jsonl，经常驻环的 reconcile 步 ──
// ⚠️ 这是【临时 root 的真实驱动跑】而不是 quay 的自然生产样本：实现落地时点之后，主仓/第三方仓的
// 自然样本数为 0（窗口还开着，见任务体的 AC5 记述）。本条证明的是【字段真的经常驻环落进载体】——
// 硬规则 4 推论三点名的失败形态正是「实现了、单测绿了、生产载体一次都没写过」。
// 臂① 孤儿 pid【确已退出】⇒ reconcile 写出一条带 orphan_pid_liveness="exited" 的记录。
// 臂② 孤儿 pid【仍是本任务活 worker】⇒ ⛔ 一条孤儿 finalize 记录都不落（这正是本缺陷写过的那条假记录）。
test("AC5 (生产载体, 双臂) — 常驻环 reconcile：确已退出的孤儿 ⇒ 载体落一条带 liveness 的假阳性可检验记录；活 worker ⇒ ⛔ 不落", async (t) => {
  const root = makeGitRoot("orphan-carrier-ac5");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac5`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    rmSafe(root);
    rmSafe(wtPath);
  });
  writeProfileCarrier(root); // worker 名 = quay-test-worker（⛔ 不是 quay-task-worker）⇒ 顺带压住名字解析
  const workerName = resolveWorkerProcessName(root);
  assert.equal(workerName, "quay-test-worker", "precondition: 名字解析自载体，不是写死的字面量");
  const taskId = "gap-orphan-carrier-ac5";
  const taskDead = "gap-orphan-carrier-ac5-dead";
  writeTaskFile(root, taskId, "ready");
  writeTaskFile(root, taskDead, "ready");
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);
  const outcomeFile = path.join(root, WORKER_OUTCOME_REL);
  const dispatchFile = dispatchStoreFile(root);
  const orphanRecords = () => (fs.existsSync(outcomeFile) ? readOutcomeLines(root) : [])
    .filter((o) => /orphaned worker finalized by reconcile/.test(o.failure_reason ?? ""));

  // 臂②：一个【仍是本任务活 worker】的孤儿（cmdline 含解析出的 worker 名 + task id）。
  const live = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", workerName, taskId], { stdio: "ignore" });
  t.after(() => { try { live.kill("SIGKILL"); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 100));
  upsertDispatchRecord(dispatchFile, {
    taskId, runId: "fm-ac5-live", workerPid: live.pid, selectorReason: "ac5 live arm",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0,
    cmdlineFingerprint: `claude -n ${workerName} -p '... Task: ${taskId} ...'`,
  });

  let drv = null;
  t.after(async () => { if (drv) await drv.stop(); });
  drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-x\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
    // 臂② adopt 了一个长跑孤儿 ⇒ 退出边沿事件不来，循环只在【协调地板】上醒；缺省 300s 会让臂①
    // 等不到下一趟 reconcile（实测：25s 等待超时，唯一的失败就是这个）。地板压到 1s。
    "--reconcile-interval", "1",
  ]);
  // ⚠️ waitFor 超时【不抛】而是返回 falsy ⇒ 必须显式断言，⛔ 不能只 await（那是恒真的空转判据）。
  const adopted = await waitFor(() => drv.events().some((e) => e.event === "orphan-adopted" && e.task === taskId), 20000);
  assert.ok(adopted, "AC5 臂②: 活 worker 被 adopt（⛔ 不是被判死）——这是 reconcile 的正确归宿");
  assert.equal(orphanRecords().length, 0, "AC5 臂②: 活 worker 期间载体里【零】孤儿 finalize 记录（⛔ 这正是本缺陷写过的那条假记录）");
  assert.ok(readDispatchStore(dispatchFile)[taskId], "AC5 臂②: 记录仍在（adopt 中，⛔ 不被判死清掉）");
  // AC3 的派发计数侧（配置名 ≠ 写死名的形态）：存活 worker 在飞 ⇒ 同任务派发计数 = 0。
  assert.equal(drv.events().some((e) => e.event === "worker-spawned" && e.task === taskId), false,
    "AC3: 同一 taskId 已有存活 worker ⇒ ⛔ 不再派第二个（派发计数 = 0）");

  // 臂①：另起一个【确已退出】的孤儿（真 spawn、真等退出、真等 /proc 条目消失）。
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise((r) => dead.once("exit", r));
  const deadPid = dead.pid;
  await waitFor(() => { try { return !fs.existsSync(`/proc/${deadPid}`); } catch { return true; } }, 15000);
  assert.equal(fs.existsSync(`/proc/${deadPid}`), false, "precondition: 「确已退出」本身也是测量出来的（/proc 条目已消失）");
  upsertDispatchRecord(dispatchFile, {
    taskId: taskDead, runId: "fm-ac5-dead", workerPid: deadPid, selectorReason: "ac5 dead arm",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0,
    cmdlineFingerprint: `claude -n ${workerName} -p '... Task: ${taskDead} ...'`,
  });

  const landed = await waitFor(() => orphanRecords().some((o) => o.task === taskDead), 25000);
  assert.ok(landed, "AC5 臂①: reconcile 真的往生产载体写了一条孤儿 finalize 记录（⛔ 不是只写进单测的返回值）");
  const rec5 = orphanRecords().find((o) => o.task === taskDead);
  assert.equal(rec5.final_state, "failed", "AC5 臂①: 非 completed 终态");
  assert.equal(rec5.orphan_pid_liveness, "exited",
    "AC5 承重: 载体记录带【实测】liveness ⇒ 断言从此可被读者取假（⛔ 此前载体里没有这个字段，声称无法被检验）");
  assert.match(rec5.failure_reason, /already exited/, "AC5 臂①: 实测已退出 ⇒ 保留原措辞");
  assert.equal(readDispatchStore(dispatchFile)[taskDead], undefined, "AC5 臂①: 记录被清（孤儿有归宿）");

  // AC5 的判据形式：该载体里此类记录数 ≥1 且【假阳性 = 0】（假阳性 = 声称已退出但实测不是已退出）。
  const all = orphanRecords();
  const falsePositives = all.filter((o) => o.orphan_pid_liveness !== "exited");
  assert.ok(all.length >= 1, `AC5: 该类记录数 ≥1（实测 ${all.length}）`);
  assert.equal(falsePositives.length, 0,
    `AC5: 假阳性 = 0（实测 ${falsePositives.length}；每条都带 orphan_pid_liveness ⇒ 该计数不是自证而是可复核的）`);
  drv.stop();
});

test("AC1 pure — 按 task 隔离：一个 task 退避不影响另一个 task 的退避状态", () => {  const state = newQuickDeathBackoffState();
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
  t.after(() => rmSafe(root));

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
  t.after(() => rmSafe(root));

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
  t.after(() => rmSafe(root));

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
    rmSafe(root);
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
    rmSafe(dir);
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
    rmSafe(worktree);
    rmSafe(root);
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
  assert.match(src, /const entry = kernelSiblingArgv\("worker-driver\.ts"\)/, "spawnMechanicalFanIn anchors the executor at the kernel install location (⛔ opts.root/plugin/scripts/worker-driver.ts — gap-plugin-root-resolution-remaining-callsites-round2)");
  assert.match(src, /process\.execPath, \.\.\.entry,\s*\n\s*"--mechanical-fan-in"/, "the fresh process is node <kernel-sibling>/worker-driver.(ts|js) --mechanical-fan-in");
  assert.match(src, /if \(mechanicalFanIn\) \{\s*\n\s*const task = tasks\[0\]/, "--mechanical-fan-in mode exists in main()");
  assert.match(src, /worktree: mechWorktree,/, "--mechanical-fan-in mode passes the worktree to runMechanicalFanIn");
});

// ── gap-fan-in-spawn-stale-worktree-executor-missing-argv：执行器 entry 用 kernel 安装位置（⛔ worktree）────
// fresh-process fan-in spawn 用 worktree 的 worker-driver.ts 当执行器时，stale worktree（未 merge
// develop）的旧 worker-driver.ts 缺新 argv（--mechanical-fan-in）⇒ fresh 进程报 unknown argument ⇒
// 无 JSON 输出 ⇒ parse-mechanical-fan-in red。修法：entry = kernel 安装位置（resolveKernelSibling，与
// driver 同版；⛔ opts.root/plugin/scripts/worker-driver.ts —— gap-plugin-root-resolution-remaining-
// callsites-round2：第三方项目无 plugin/scripts/），worktree 只提供任务 delta、不提供执行器代码。
// AC2 负控制：kernel entry（有 argv）与 stale worktree entry（无 argv）两个 stub——entry 若指回
// worktree 则 spawn 加载 stale stub ⇒ unknown argument ⇒ red（本测试断言 outcome=landed，改回即红）。

test("AC2 (gap-fan-in-spawn-stale-worktree-executor-missing-argv) — stale worktree 缺 --mechanical-fan-in argv 仍 spawn 成功（entry=kernel 安装位置，⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red）", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stale-exec-"));
  t.after(() => rmSafe(base));
  const root = path.join(base, "root");
  const worktree = path.join(base, "wt");
  const pluginRoot = path.join(base, "plugin"); // kernel 安装位置（QUAY_PLUGIN_ROOT 缝）

  // kernel 安装位置的 worker-driver.ts = 当前版（有 --mechanical-fan-in argv）——最小自足 stub（无
  // import），命中 --mechanical-fan-in 即打一行 JSON result 退出。模拟「与 driver 同版」。
  fs.mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "scripts", "worker-driver.ts"), [
    "// current worker-driver.ts (kernel entry): has --mechanical-fan-in argv",
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
  // 模拟 stale worktree：落后 develop、缺新 argv。entry 现在锚在 kernel 安装位置（QUAY_PLUGIN_ROOT），
  // ⛔ 不读 worktree ⇒ stale stub 不被加载。
  fs.mkdirSync(path.join(worktree, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "plugin", "scripts", "worker-driver.ts"), [
    "// STALE worker-driver.ts: no --mechanical-fan-in argv (any --* flag => unknown argument)",
    "const argv = process.argv.slice(2);",
    'const flag = argv.find((x) => x.startsWith("--"));',
    'console.error("worker-driver: unknown argument: " + (flag ?? ""));',
    "process.exit(2);",
  ].join("\n"), "utf8");

  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try {
    const r = await spawnMechanicalFanIn({ task: "gap-stale", worktree, root, runId: "r1" });
    assert.equal(r.outcome, "landed", "stale worktree must not break spawn — entry=kernel install location has --mechanical-fan-in (⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red)");
    assert.equal(r.step, null, "no failure step when the kernel entry handles --mechanical-fan-in");
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
  }
});

// gap-plugin-root-resolution-remaining-callsites-round2 AC2 负控制：第三方项目（quay-init 布下的面）
// 无 plugin/scripts/*.ts，只有 shipped dist/*.js。spawnMechanicalFanIn 的 worker-driver 自入口经
// kernelSiblingArgv 回退到 dist/worker-driver.js 且不带 --experimental-strip-types（stripTypes=false）。
test("AC2 (gap-plugin-root-resolution-remaining-callsites-round2) — worker-driver 自入口在无 plugin/ 的第三方项目解析到 shipped dist/worker-driver.js（stripTypes=false）", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stale-exec-dist-"));
  t.after(() => rmSafe(base));
  const root = path.join(base, "root");
  const worktree = path.join(base, "wt");
  const pluginRoot = path.join(base, "plugin");

  // kernel 安装位置的 bundled dist/worker-driver.js = 当前版（无 import 自足 stub，命中
  // --mechanical-fan-in 即打一行 JSON result 退出）。scripts/*.ts 不放 ⇒ resolveKernelSibling 回退 .js。
  const dist = path.join(pluginRoot, "scripts", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "worker-driver.js"), [
    "// bundled current worker-driver.js: has --mechanical-fan-in argv",
    "const argv = process.argv.slice(2);",
    'if (argv.includes("--mechanical-fan-in")) {',
    '  process.stdout.write(JSON.stringify({ outcome: "landed", step: null, reason: null, verdict: null }) + "\\n");',
    "  process.exit(0);",
    "}",
    "process.exit(2);",
  ].join("\n"), "utf8");

  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try {
    const r = await spawnMechanicalFanIn({ task: "gap-stale-dist", worktree, root, runId: "r1" });
    assert.equal(r.outcome, "landed", "worker-driver self-entry resolves to shipped dist/worker-driver.js (stripTypes=false, no --experimental-strip-types)");
    assert.equal(r.step, null, "no failure step when the dist entry handles --mechanical-fan-in");
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
  }
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
function makeMechRepo(tag, taskId = "gap-mfh", opts = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mechfanin-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "mechfanin-test"]);
  runGit(repo, ["config", "user.email", "mf@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  // scripts/test.sh（classify-delta 读 registry；空 registry ⇒ tasks/、docs/ 判 doc-only）。
  // opts.thirdParty ⇒ 本仓库形态【缺席】（第三方项目没有 scripts/test.sh，suite 由它自己的
  // loop.test_command 跑）——gap-verification-round-bound-to-quay-shaped-suite-entry 的形态控制。
  if (!opts.thirdParty) {
    fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  }
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
  if (opts.thirdParty) {
    // 第三方形态：worktree 无 scripts/test.sh + 有自己的 suite 入口（.quay/config.yml 的
    // loop.test_command）⇒ suite 委托该命令、不经 full-suite-runner。该文件保持【未跟踪】（第三方
    // 工作区里它就是运行时配置；ff 的 clean-tree 判定对未跟踪的 .quay/ 产物是 BENIGN）。
    // 同时带上 AC5 的输出约定声明（项目【自己】声明怎么从自己的测试输出里取计数——quay 依声明解析，
    // ⛔ 不把输出格式写死成 quay 自己的 node:test 形状）。
    fs.mkdirSync(path.join(worktree, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, ".quay", "config.yml"),
      "loop:\n  test_command: node --test\n  test_output:\n    pass: 'Tests\\s+.*?(\\d+) passed'\n    fail: 'Tests\\s+.*?(\\d+) failed'\n",
      "utf8",
    );
  }
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
  t.after(() => rmSafe(root));
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
  t.after(() => rmSafe(tmp));
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
  t.after(() => rmSafe(tmp));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(base));
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
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [ ] AC2 todo"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "unchecked impl item must short-circuit (⛔ spawn fan-in ⇒ false)");
  assert.match(v.reason, /AC 未全勾/);
  assert.match(v.reason, /2\/3/, "reason carries checked/total (2/3 = AC1✓ + DoD✓ / AC2✗)");
});

test("AC_B1b (gap-worker-ac-check-shortcircuit) — AC/DoD 段缺失 ⇒ fail-closed shortCircuit:true（硬规则 3b 无法评估 ≠ 合格）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b1b-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  fs.mkdirSync(path.join(wt, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(wt, "tasks", "gap-x.md"), "---\nid: gap-x\nstatus: ready\n---\n\n## Proposal\n\nbody\n", "utf8");
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "missing AC/DoD section must fail-closed short-circuit (⛔ 无法评估当合格 ⇒ 假)");
  assert.match(v.reason, /AC 未全勾/);
});

test("AC_B2 (gap-worker-ac-check-shortcircuit) — AC 全勾 ⇒ shortCircuit:false 照常 spawn fan-in（负控制，⛔ 全勾也被短路 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [x] AC2 done"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, false, "all checked must NOT short-circuit (⛔ false block ⇒ 假)");
  assert.equal(v.reason, null);
});

test("AC_B2b (gap-worker-ac-check-shortcircuit) — 剩余未勾均为（待外部）⇒ shortCircuit:false（awaiting-verification 形态，⛔ 误挡 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2b-"));
  t.after(() => rmSafe(base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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

// ── gap-fan-in-step-trace-suite-steps-write-end-without-begin ───────────────────────────────────
// 病根：4 个 suite 决策步（ac-precheck/suite-start/suite-end/suite-skip）在共享载体上只有 `step-end`
// 没有 `step-begin`——它们是【单发决策事件】而非区间。于是「用 begin/end 配对算时长」这个读法对它们
// 恒返回「无数据」，而「无数据」与「这一步不存在」同形（硬规则 3b）；实测一位分析者正是据此得出
// 「suite 结构上不在这个载体里」的错误结论，并把一个基于该结论的「75% 是等待」判断收回。
// 修法（AC2 选项②）：时长改为**每条 `step-end` 自带 `durationMs`**，12 个分组统一，不依赖配对。

function readSharedTrace(root) {
  return fs.readFileSync(path.join(root, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("AC2 — 共享载体每条 step-end 自带 durationMs（12 组统一），suite-end 的读数就是真实墙钟", async (t) => {
  const m = makeMechRepo("step-trace-duration");
  const runId = "mf-run-duration";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    // sleep 1 ⇒ suite-end 的 durationMs 必须落在这个量级；占位 0 / 拿错量的实现都会被下面挡下。
    suiteCommand: ["bash", "-c", "echo suite-running; sleep 1; exit 0"],
  }));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  const ends = readSharedTrace(m.repo).filter((l) => l.event === "step-end" && l.runId === runId);
  // 全 12 组统一：每一条 step-end 都自带数值 durationMs（⛔ 不能只有 suite 那 4 条有）。
  const missing = ends.filter((l) => typeof l.durationMs !== "number" || !Number.isFinite(l.durationMs) || l.durationMs < 0);
  assert.deepEqual(missing.map((l) => l.step), [],
    "every step-end in the shared carrier must carry a numeric durationMs (the uniform duration channel)");
  assert.ok(ends.length >= 11, `a landed run traces ≥11 step-ends (got ${ends.length}: ${ends.map((l) => l.step).join(",")})`);
  // 真读数：suite 里 sleep 1 ⇒ suite-end 的 durationMs ≥ 1000（⛔ 常量 0 / 抄错字段都过不了）。
  const se = ends.find((l) => l.step === "suite-end");
  assert.ok(se, "suite-end must be in the shared carrier");
  assert.ok(se.durationMs >= 1000, `suite-end durationMs must reflect the real suite wall clock, got ${se.durationMs}`);
  // 两载体同一步同一读数：共享 durationMs == per-run wall_ms（同一个 t0，⛔ 不各算一次）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sePerRun = perRun.find((l) => l.step === "suite-end");
  assert.ok(sePerRun, "per-run carrier keeps its own suite-end row");
  assert.equal(se.durationMs, sePerRun.wall_ms, "shared durationMs and per-run wall_ms are the same single reading");
});

test("AC2 负控制 — 4 个 suite 决策步仍只有 end 没有 begin；配对读法对它们恒空，durationMs 读法有值（两法相反）", async (t) => {
  const m = makeMechRepo("step-trace-nobegin");
  const runId = "mf-run-nobegin";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c", "echo suite-running; sleep 1; exit 0"],
  }));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  const rows = readSharedTrace(m.repo).filter((l) => l.runId === runId);
  const began = new Set(rows.filter((l) => l.event === "step-begin").map((l) => l.step));
  const ends = rows.filter((l) => l.event === "step-end");
  for (const s of ["ac-precheck", "suite-start", "suite-end"]) {
    // 一个「写下去就立刻被配掉」的 begin 结构上不可能与 end 分离 ⇒ 那不是挂起检测，是给孤儿率看的样子
    // （硬规则 4：恒等式不是测量）。所以这 4 步**不补** begin，本断言把它钉住（防下一个人顺手补上）。
    assert.equal(began.has(s), false, `${s} is a single-shot decision event — it must NOT grow a synthetic step-begin`);
    const e = ends.find((l) => l.step === s);
    assert.ok(e, `${s} must still be traced (end-only)`);
    assert.equal(typeof e.durationMs, "number", `${s} carries its own durationMs`);
  }
  // 判别性对照（硬规则 4 推论四）：两个读法对同一个 step 给出【相反】结果 —— 只要这个差异消失，
  // 就说明有人把 begin 补上了（指标被刷绿）或把 durationMs 去掉了（时长通道又断）。
  const se = ends.find((l) => l.step === "suite-end");
  assert.equal(pairedEndCount(rows, "suite-end"), 0, "the pairing method yields NOTHING for suite-end (the old blind spot)");
  assert.equal(typeof se.durationMs, "number", "the durationMs method yields a reading for the very same step");
});

/** 配对读法：同 runId 下该 step 有几条能配上 begin 的 end（本次要证明它对 suite 恒 0）。 */
function pairedEndCount(rows, step) {
  const b = rows.filter((r) => r.step === step && r.event === "step-begin").length;
  const e = rows.filter((r) => r.step === step && r.event === "step-end").length;
  return Math.min(b, e);
}

// ── gap-worker-execution-history-index-not-reachable-from-task（A：suiteLog 记录）──────────────────
// A 缺口的病根：机械 fan-in 的 suite 步失败时 verdict.logFile 一路 null（183KB 真因文件只能靠命名约定猜，
// 硬规则 4c「穿不过中间层的量」）。修法：suite 红 ⇒ mechanical_fan_in.suiteLog（basename）+ verdict.logFile
// 指向 .quay/fan-in-suite-*.log 绝对路径；非 suite 红 ⇒ suiteLog null（负控制）。

test("A (能取假) — suite 红 ⇒ suiteLog 非 null + verdict.logFile 指向 suite 日志（⛔ 仍 null ⇒ 假）", async (t) => {
  const m = makeMechRepo("suite-log");
  const runId = "mf-run-suitelog";
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
  const r1 = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r1.outcome, "red");
  assert.equal(r1.reason, "suite red", "zero output ⇒ fallback to generic 'suite red'");

  // ② 有输出但无信号行（benign 非断言行）——⛔ extractFailureSummary 会回退 meaningful，本路径必须仍回退通用文案。
  const m2 = makeMechRepo("nh-benign");
  t.after(() => rmSafe(m2.base));
  const r2 = await runMechanicalFanIn(mechOpts(m2, runId, { suiteCommand: ["bash", "-c", "echo 'refresh-worktree-quay: copied 499 file(s)'; exit 1"] }));
  assert.equal(r2.outcome, "red");
  assert.equal(r2.reason, "suite red", "benign non-signal output ⇒ fallback (⛔ not the benign line)");
});

test("AC3 (负控制) — split-or-commit 真失败 ⇒ reason 仍携带其真实 violation（⛔ 改提取逻辑后丢真失败）", async (t) => {
  const m = makeMechRepo("nh-soc-real-fail");
  const runId = "wk-prod-nh-soc-real-fail";
  t.after(() => rmSafe(m.base));
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
  t.after(() => rmSafe(m.base));
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

// ── gap-verification-round-bound-to-quay-shaped-suite-entry：台账写入与「suite 由谁跑」解耦 ──────────
// 第三方项目（无 scripts/test.sh，suite 由自己的 loop.test_command 跑）不经 full-suite-runner ⇒ 那条
// verification-round 唯一 writer 不在路径上 ⇒ /tests 卡片恒显示「未接入」。本测试是【接线】的证据：
// 跑一轮真 fan-in，绿轮必须产出台账行；本仓库形态（有 scripts/test.sh）必须【不产】（负控制——若判据
// 写反就是双写，正是这次改动唯一的回归风险）。

test("gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方形态 fan-in 真产出台账行（taskId/runId 同轮），quay 形态不产（负控制）", async (t) => {
  const runId = "mfi-vr-tp-1789210598105-e1ddad";
  const m = makeMechRepo("vr-third-party", "gap-vr-tp", { thirdParty: true });
  t.after(() => rmSafe(m.base));
  const ledger = path.join(m.repo, ".quay", "verification-round.jsonl");
  assert.equal(fs.existsSync(ledger), false, "前置：fan-in 前台账载体不存在（正是缺陷现场）");

  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-vr-tp", perSuiteRunId: runId,
    // 项目自己的输出形状（vitest），⛔ 不是 quay 自己的 node:test `ℹ pass N` 形状 —— AC5 要求台账里
    // 由【该输出】派生的字段拿到真实值。
    suiteCommand: ["bash", "-c", "echo '      Tests  0 failed | 345 passed (345)'; exit 0"],
  }));
  assert.equal(r.outcome, "landed", `must land (step=${r.step} reason=${r.reason})`);

  assert.ok(fs.existsSync(ledger), "第三方形态的绿轮必须产出台账行（⛔ 不再「未接入」）");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "一轮一行（⛔ 不双写）");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.taskId, "gap-vr-tp", "台账行的 taskId = 本轮 fan-in 的任务");
  assert.equal(rec.runId, runId, "台账行的 runId = 本轮 fan-in 的 per-suite runId");
  assert.equal(rec.state, "green", "绿轮 state=green");
  assert.equal(rec.preverified, false, "suite 在本轮 fan-in 内真跑（⛔ 非复用 capture）");
  assert.equal(rec.scope, "worktree", "scope=worktree");
  assert.match(String(rec.commit), /^[0-9a-f]{40}$/, "commit 是 suite_head（40-hex sha，非空/非伪造）");
  // AC5 —— 由【项目声明的输出约定】从真实 suite 输出派生的字段（三者对照见 third-party-capability-
  // degradation.test.mjs 的 AC5 正向测；这里是接线证据：声明在真 fan-in 轮上被消费）。
  assert.equal(rec.pass, 345, "pass 由声明的正则从 suite 输出派生（345 passed）");
  assert.equal(rec.fail, 0, "fail 由声明的正则派生（0 failed —— 声明匹配到的真 0，⛔ 非伪造）");
  assert.equal(rec.tests, 345, "tests = pass+fail（同 full-suite-runner 口径）");

  // 负控制：本仓库形态（scripts/test.sh 在场）⇒ 本层不补写（台账由 full-suite-runner 写；此处 suite 是
  // 假命令缝，runner 没跑 ⇒ 台账应当【不存在】——若判据写反，这一行会是 1，正是双写）。
  const mSelf = makeMechRepo("vr-self-shape");
  t.after(() => rmSafe(mSelf.base));
  const rs = await runMechanicalFanIn(mechOpts(mSelf, "mfi-vr-self-shape-1"));
  assert.equal(rs.outcome, "landed", `negative control must land (step=${rs.step} reason=${rs.reason})`);
  assert.equal(
    fs.existsSync(path.join(mSelf.repo, ".quay", "verification-round.jsonl")), false,
    "本仓库形态 ⇒ 新增写入者不在该路径上（⛔ 不双写；runner 才是它的 writer）",
  );

  // 红轮也入账（第二条接线：suite 退出分支的那一处 —— 两条分支各写一份正是硬规则 5b 的形态，故两处
  // 都要有证据）。「跑了且红」必须与「没跑过」可分：红轮的台账行必须真的存在且 state=red。
  const mRed = makeMechRepo("vr-third-party-red", "gap-vr-tp-red", { thirdParty: true });
  t.after(() => rmSafe(mRed.base));
  const rr = await runMechanicalFanIn(mechOpts(mRed, "mfi-vr-tp-red-1", {
    task: "gap-vr-tp-red", perSuiteRunId: "mfi-vr-tp-red-1",
    suiteCommand: ["bash", "-c", "echo 'AssertionError [ERR_ASSERTION]: vr red probe'; exit 1"],
  }));
  assert.equal(rr.outcome, "red", "红 suite ⇒ fan-in red");
  const redLedger = path.join(mRed.repo, ".quay", "verification-round.jsonl");
  assert.ok(fs.existsSync(redLedger), "红轮同样入账（⛔ 不只在绿分支写）");
  const redRec = JSON.parse(fs.readFileSync(redLedger, "utf8").trim().split("\n").filter(Boolean).pop());
  assert.equal(redRec.state, "red", "红轮 state=red");
  assert.equal(redRec.taskId, "gap-vr-tp-red", "红轮行归属本轮任务");
  assert.equal(redRec.runId, "mfi-vr-tp-red-1", "红轮行 runId = 本轮 per-suite runId");
  assert.equal(redRec.reason, "failed", "红轮带 reason（读者可分「跑了且红」与「没跑过」）",
  );
});

// ── gap-watchdog-killed-round-writes-no-verification-round-record ──────────────────────────────────
// 病根（AC2 的真实设计判据）：静默看门狗 SIGKILL 的是【整个进程组】——而「预定的 round 台账 writer」
// 恰在那一组里（quay 形态的 suite 走 full-suite-runner.ts，它是 verification-round.jsonl 的唯一 writer）
// ⇒ runner 与它的 suite 一起死 ⇒ 这一轮【一行都不写】⇒ 任何以该载体为输入的判定器把「没评估」读成
// 「没问题」。既有 recordDelegatedRound 的 `if (!suiteRunsOutsideRunner(worktree)) return` 提前返回正是
// 没能覆盖本子类的根因：它把「谁预定写」当成了「谁写得到」。
// 本测试的两面控制（同一夹具、只换 suite 命令）：
//   ① 绿轮（quay 形态）⇒ 台账必须【不存在】—— runner 是它的 writer，本层补写就是双写（既有负控制）；
//   ② 看门狗杀（quay 形态）⇒ 台账必须【存在】—— 预定 writer 已死，活着的写者只剩 driver 进程。
// ⛔ 可失败控制：把 hung 分支的那次写入去掉 ⇒ ② 立刻红（台账不存在）；把 force 去掉 ⇒ 同样红。
//    把写入改成无条件（去掉 force 的判据）⇒ ① 红。两个方向都被这一条测钉住。
test("AC1/AC2 (gap-watchdog-killed-round-writes-no-verification-round-record) — 看门狗 SIGKILL【整组】后台账仍出现 NOT-EVALUATED 记录；绿轮（quay 形态）仍不补写（双向控制）", async (t) => {
  // ① 负控制：quay 形态的绿轮 —— 预定 writer（runner）在路径上，台账不该由本层补写。
  const mGreen = makeMechRepo("wdk-green", "gap-wdk-green");
  t.after(() => rmSafe(mGreen.base));
  const greenLedger = path.join(mGreen.repo, ".quay", "verification-round.jsonl");
  const rg = await runMechanicalFanIn(mechOpts(mGreen, "mfi-wdk-green-1", {
    task: "gap-wdk-green", perSuiteRunId: "mfi-wdk-green-1",
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
  }));
  assert.equal(rg.outcome, "landed", `绿轮必须落地 (step=${rg.step} reason=${rg.reason})`);
  assert.equal(fs.existsSync(greenLedger), false, "⛔ 绿轮不该由本层补写（runner 才是它的 writer；写了就是双写）");

  // ② 真实证据：quay 形态 + 看门狗 SIGKILL 整组 ⇒ 台账必须出现，且形状是 NOT-EVALUATED。
  const m = makeMechRepo("wdk-hung", "gap-wdk-hung");
  t.after(() => rmSafe(m.base));
  const ledger = path.join(m.repo, ".quay", "verification-round.jsonl");
  assert.equal(fs.existsSync(ledger), false, "前置：fan-in 前台账载体不存在（正是缺陷现场）");
  // suite 命令：起一个【孙进程】并落它的 pid（证「整组被杀」而非只杀直接子进程），随后静默不输出。
  // ⚠️ 经脚本文件而不是内联 `bash -c '<含 $! 的脚本>'`：suiteCommand 的每个元素会被 slotHolderArgv 用
  // JSON.stringify 包成【双引号】串拼进外层 bash，`$!` 会在外层的双引号里先被展开成空 ⇒ 内层收到
  // `echo  > file`（写个空行）——症状是「pid 文件存在但内容不是 pid」，与「孙进程没起来」同形。
  const gpFile = path.join(m.base, "grandchild.pid");
  const probeScript = path.join(m.base, "suite-probe.sh");
  fs.writeFileSync(probeScript, 'sleep 100 &\necho $! > "$1"\necho started\nwait\n', "utf8");
  const suiteCmd = ["bash", probeScript, gpFile];
  const t0 = Date.now();
  const r = await runMechanicalFanIn(mechOpts(m, "mfi-wdk-hung-1", {
    task: "gap-wdk-hung", perSuiteRunId: "mfi-wdk-hung-1",
    suiteCommand: suiteCmd, silenceMs: 400,
  }));
  assert.ok(Date.now() - t0 < 30_000, `watchdog 必须有限时间返回（⛔ 15min 挂死）took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "red", `看门狗杀 ⇒ fan-in red（不是落地）`);
  assert.equal(r.step, "suite", "失败步 = suite");

  // 台账存在（AC2 的核心：被杀的 writer 写不成，记录仍出现 ⇒ 写入点在活着的一侧）。
  assert.ok(fs.existsSync(ledger), "看门狗杀死的这一轮【必须】留下台账行（⛔ 一行都不写 = 本任务的病根）");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "一轮一行（⛔ 不双写：runner 已被杀，不可能也写一条）");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.evaluated, false, "NOT-EVALUATED：⛔ 不与「合格」同形（硬规则 3b）");
  assert.equal(rec.reason, "watchdog-killed", "reason 取独立值");
  assert.notEqual(rec.reason, "failed", "⛔ 「被杀」不是「跑了且红」的结论");
  assert.equal(rec.state, "red", "不是通过");
  assert.equal(rec.failures, undefined, "无失败信号可解析 ⇒ ⛔ 不写空 failures[]");
  assert.equal(rec.taskId, "gap-wdk-hung", "归属本轮任务");
  assert.equal(rec.runId, "mfi-wdk-hung-1", "runId = 本轮 per-suite runId");
  assert.match(String(rec.commit), /^[0-9a-f]{40}$/, "commit = 本轮 suite_head（40-hex）");

  // 「整组杀」这一前提的取证：孙进程必须也死了（⛔ 只杀直接子进程会留孙进程持管道/泄漏）。
  const gp = Number(fs.readFileSync(gpFile, "utf8").trim());
  assert.ok(Number.isInteger(gp) && gp > 0, "孙进程 pid 已落盘");
  await waitFor(() => { try { process.kill(gp, 0); return false; } catch { return true; } }, 15000);
  assert.ok(true, "孙进程被组 kill 收掉 ⇒ 被杀的是整组，而台账仍由【组外】的 driver 写下");
});

// ── gap-fan-in-suite-refusal-reports-as-suite-red（AC2 三态可分：被拒轮 ⛔ 不再与真红同形）─────────
// 病：拒绝轮的 reason 由 extractFirstFailureLine("") 回退成裸 "suite red"，与「真跑且真红」措辞不可分。
// 修法：runner 在 suite log 写 SUITE-NOT-RUN 标记行 ⇒ 本层【先判「跑没跑」再判「为什么红」】。

test("extractSuiteNotRunLine — 只认 SUITE-NOT-RUN 标记行；真失败日志 ⇒ null（⛔ 不把真红读成「没跑」）", () => {
  const marker = `${SUITE_LOG_NOT_RUN_PREFIX} branch=single-flight-refusal ts=2026-09-13T08:15:00.000Z reason="another runner is already in flight" — no test was executed by this round`;
  assert.equal(extractSuiteNotRunLine(""), null, "空日志 ⇒ null（缺值 = 未查，⛔ 不伪造成「拒绝了」）");
  assert.equal(extractSuiteNotRunLine(marker), marker, "标记行原样返回（供 reason 携带）");
  assert.equal(
    extractSuiteNotRunLine(`benign\n${marker}\nmore`),
    marker,
    "多行日志里能定位到标记行",
  );
  // 负控制：真失败日志（无标记）⇒ null ⇒ 调用方保持「真失败摘要」路径。
  const realRed = "✖ AC1 — probe failed\n  AssertionError [ERR_ASSERTION]: expected 1 got 2";
  assert.equal(extractSuiteNotRunLine(realRed), null, "真跑且真红 ⇒ 没有拒绝标记");
});

test("AC2 (能取假) — suite 被拒 ⇒ reason 指名「未运行（拒绝）+ 哪条分支」，⛔ 不再是裸 `suite red`", async (t) => {
  const m = makeMechRepo("refused");
  const runId = "mf-run-refused";
  t.after(() => rmSafe(m.base));
  // 忠实模拟生产拒绝：runner 在 suite log 写标记行后 exit 1，【一条测试都没跑】。
  const suiteLog = path.join(m.base, "suite.log");
  const script = path.join(m.base, "refusing-suite.sh");
  fs.writeFileSync(
    script,
    `#!/usr/bin/env bash\nprintf '%s\\n' '${SUITE_LOG_NOT_RUN_PREFIX} branch=single-flight-refusal ts=2026-09-13T08:15:00.000Z reason="another runner is already in flight" — no test was executed by this round' >> '${suiteLog}'\nexit 1\n`,
    { mode: 0o755 },
  );
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", script] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.notEqual(r.reason, "suite red", "⛔ 裸 `suite red` 与被拒轮不可分（本条要修的病）");
  assert.match(r.reason, /suite NOT run \(refused\)/, `reason 必须自报「未运行（拒绝）」:\n${r.reason}`);
  assert.match(r.reason, /branch=single-flight-refusal/, "reason 指名【哪条分支】（可归因到拒绝来源）");
  assert.match(r.verdict.summary, /suite NOT run \(refused\)/, "verdict.summary 与 reason 同源（⛔ 两处各说各话）");

  // 过程日志（A1）同一轮也必须自报拒绝，⛔ 不得留下裸 "suite red"（Finding 实证的形态就是 suite-end）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const suiteEnd = perRun.find((l) => l.step === "suite-end");
  assert.ok(suiteEnd, "suite-end 步骤行存在");
  assert.notEqual(suiteEnd.reason, "suite red", "⛔ suite-end 的 reason 不得再是裸 `suite red`");
  assert.match(suiteEnd.reason, /suite not run \(refused\)/, `suite-end 自报拒绝:\n${suiteEnd.reason}`);
  assert.equal(suiteEnd.refused, true, "结构化 refused 位（机器可读，⛔ 只靠措辞）");
});

test("AC2 负控制 — 真跑且真红（无拒绝标记）⇒ reason 仍是真失败摘要，⛔ 不冒称「未运行」", async (t) => {
  const m = makeMechRepo("realred");
  const runId = "mf-run-realred";
  t.after(() => rmSafe(m.base));
  const suiteLog = path.join(m.base, "suite.log");
  const script = path.join(m.base, "real-red-suite.sh");
  fs.writeFileSync(
    script,
    `#!/usr/bin/env bash\nprintf '%s\\n' '✖ AC1 — probe failed' '  AssertionError [ERR_ASSERTION]: expected 1 got 2' >> '${suiteLog}'\nexit 1\n`,
    { mode: 0o755 },
  );
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", script] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.doesNotMatch(r.reason, /NOT run \(refused\)/, "真红 ⛔ 不得被标成「未运行」（反向同形）");
  assert.match(r.reason, /AssertionError/, "真红的 reason 仍是真实失败摘要");
});
