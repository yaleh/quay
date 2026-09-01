// @test-group lowconc
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
  extractFailureSummary,
  combinedOutput,
  mirrorMechanicalFanInSuiteState,
  mechSh,
  appendFanInStepTrace,
  spawnMechanicalFanIn,
  readFanInLockHold,
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
  // 自定义步（delta / suite 起止 / flip-done / cleanup / ff）写 A1 过程日志 trace。
  for (const step of ["delta", "suite-start", "suite-end", "flip-done", "cleanup", "ff"]) {
    assert.ok(src.includes(`step: "${step}"`), `custom step ${step} must write an A1 trace`);
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
