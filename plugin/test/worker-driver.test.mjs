// @test-group lowconc
// worker-driver.test.mjs — worker lifecycle (spawn/kill/timeout/outcome) + mechanical-fan-in result + MCP control plane. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/worker-driver-harness.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import YAML from "yaml";

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
  isFinalState,
  assertFinalState,
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
  newSuiteLogAttemptSuffix,
  pruneTaskSuiteLogs,
  extractFailureSummary,
  combinedOutput,
  mirrorMechanicalFanInSuiteState,
  mechSh,
  appendFanInStepTrace,
  spawnMechanicalFanIn,
  readFanInLockHold,
  dispatchStoreFile,
  readDispatchStore,
  writeDispatchStore,
  upsertDispatchRecord,
  removeDispatchRecord,
  readPidCmdline,
  probePidLiveness,
  resolveWorkerProcessName,
  classifyOrphanDispatch,
  orphanDispatchCandidates,
  computeOrphanFinalizedOutcome,
  computeAdoptedOutcome,
  finalizeOrphanDispatch,
  adoptOrphanWorker,
  WORKER_DISPATCH_REL,
  scopedGateCommandFor,
  resolveScopedGateCommand,
  resolveDocCheckCommand,
  docCheckCommandFor,
  scopedGateKey,
  readScopedGateCache,
  writeScopedGateCache,
  continueRelatednessNote,
  failingTestFilesFromSuiteLog,
  taskTouches,
  taskDeltaFiles,
  computeDeltaPaths,
  directImportRels,
  classifyDeltaRelatedness,
  classifyLoadSensitive,
  relatednessSignalsFor,
  formatRelatednessNote,
  reclaimSupersededWorktrees,
  resolveKernelSrcModule,
  judgeRetryExemption,
  withRecordedSuiteSignatures,
  suiteRedAttemptsInWindow,
  assertionSignaturesFromSuiteLog,
  RETRY_EXEMPTION_WINDOW_MS_DEFAULT,
  resolveTaskMergeTarget,
  resolveTaskMergeTargetDetail,
  untaggedGoalBranchOverlaps,
  findGoalBranchUntaggedOverlap,
  fanInLockFileForMergeTarget,
  // SPEC-goal-branch §4.7：goal→develop 最终 fan-in 的执行侧 + 派生读数（worker-driver 的 re-export 面）。
  runGoalMergeFanIn,
  pendingGoalMerges,
  readGoalMergeResults,
} from "../scripts/worker-driver.ts";
import { recordGoalMergeRequest } from "../../packages/quay/src/goal-merge.ts";
// gap-goal-merge-execution-writes-no-step-trace：判别键从【写手】取（⛔ 不在测试里重打一份字面量——
// 改了写手的取值而测试仍绿，测的就是一个不存在的形态）。
import { GOAL_MERGE_TRACE_KIND } from "../scripts/worker-fan-in.ts";
import { defaultLaneCount } from "../scripts/full-suite-runner.ts";
import { spawnSuiteAndWait } from "../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../scripts/suite-lock-slots.ts";
// gap-worker-driver-retry-cap-not-wired：retryExhausted 集合的生产函数单一真相源（driver-filters.ts），
// 两 driver 共用（⛔ 非平行副本）。AC3 用同一函数身份证 promotion 不回归。
import { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, applyTaskFilters, makeFilterContext } from "../scripts/driver-filters.ts";
import { advanceRetryCap as promoAdvanceRetryCap, markNeedsHuman as promoMarkNeedsHuman, MAX_FIX_RETRIES_DEFAULT } from "../scripts/promotion-driver.ts";
import { bundleEntries } from "../../packages/quay/scripts/build-plugin-dist.mjs";
// gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing: the AC4 e2e drives the REAL
// mechanical fan-in on a third-party-shaped repo, before and after `quay init` establishes the
// landing baseline.
import { ensureBranchModel } from "../../packages/quay/src/branch-model.ts";

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
  rmSafe,
} from "./helpers/worker-driver-harness.mjs";

// gap-arch-worker-fan-in-extract-from-worker-driver：机械 fan-in 区域（fail()/step()/flipTaskDone 的
// reason 机件）的正本已迁 worker-fan-in.ts。worker-driver.ts 经 re-export 保持【import 面】逐字不变，
// 但【读源码的结构判据】必须按代码实际所在处取——否则判据读的是一个不再持有该代码的文件（硬规则 3b 的
// 镜像：读错载体 ≠ 查过）。正臂断言读 FAN_IN；负臂断言（「某坏形态已消失」）对两个文件都查，故强度不降。
const FAN_IN = path.join(path.dirname(DRIVER), "worker-fan-in.ts");

// gap-process-budget-in-use-structurally-zero-never-throttles: defaultLaneCount is now BUDGET-AWARE
// (subtracts in_use via testProcessesInUse()). Pin in_use=0 so the D7 laneCount assertion below stays
// deterministic (mirrorMechanicalFanInSuiteState writes defaultLaneCount(); the assertion re-reads it —
// a shell-out between the two calls could read a different live in_use and flake).
process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";

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

// ▸ gap-worker-outcome-final-state-landed-is-a-dead-value — final_state 词表闸（AC2 方案②：从【写入面】
//   移除死取值 `landed`）。判据必须能取假：只断言「词表内取值不抛」是恒真闸（硬规则 4 推论三），
//   故配一条**负控制**——词表外的取值必须抛，且不得在载体上留痕。
test("final_state 词表闸 — `landed` 不是 final_state（它是 mechanical_fan_in.outcome 的取值）；成功态是 completed", () => {
  // 取值表本身：landed ∉ FINAL_STATES（死取值的「移除」在取值表这一侧的判据）。
  assert.ok(!FINAL_STATES.includes("landed"), "`landed` 不是 final_state 的合法取值");
  assert.ok(FINAL_STATES.includes("completed"), "成功态是 `completed`");

  // 正臂：词表内**全部**取值都通过（枚举，不是抽查——硬规则 3）。
  for (const s of FINAL_STATES) {
    assert.equal(isFinalState(s), true, `${s} 在词表内`);
    assert.doesNotThrow(() => assertFinalState(s, "test"), `${s} 必须被接受`);
  }

  // 负控制：词表外的取值必须抛。`landed` 是**实测**那个死取值（生产载体 1 条，2026-08-28），
  // `red` 是同一 sibling 词表（mechanical_fan_in.outcome）的另一个取值——两者都是这道闸存在的理由。
  for (const bad of ["landed", "red", "Completed", "done", "", "landed ", 42, null, undefined, {}]) {
    assert.equal(isFinalState(bad), false, `${JSON.stringify(bad)} 不在词表内`);
    assert.throws(() => assertFinalState(bad, "test"), /out-of-vocabulary final_state/, `${JSON.stringify(bad)} 必须被拒收`);
  }

  // 报错文本点名陷阱与正确取值（⛔ 不只是一句 "invalid"——读的人要能当场知道该写什么）。
  assert.throws(() => assertFinalState("landed", "appendOutcomeToFile → worker-outcome.jsonl"), /mechanical_fan_in\.outcome/);
  assert.throws(() => assertFinalState("landed", "ctx"), /成功态写 "completed"/);
});

test("appendOutcomeToFile — 词表闸在唯一落盘点拒收，且不留半条记录 / 不建目录", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-finalstate-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, WORKER_OUTCOME_REL);

  // 正臂：一个**真实**构造的 outcome（computeOutcome，落地 ⇒ completed）能落盘。
  const ok = computeOutcome({ task: "gap-gate", selectorReason: "r", exitCode: 0, signal: null, startedAtMs: 0, endedAtMs: 1, workerPid: 1, runId: "x", landed: true });
  appendOutcomeToFile(file, ok);
  assert.equal(readOutcomeLines(root).at(-1).final_state, "completed");

  // 负控制：把同一条记录改成 `landed`（**手工 fan-in 曾经写出的那个取值**）⇒ 必须抛，
  // 且载体**字节不变**、新目录不建（闸在 mkdir/append 之前）。
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => appendOutcomeToFile(file, { ...ok, final_state: "landed" }), /out-of-vocabulary final_state/);
  assert.equal(fs.readFileSync(file, "utf8"), before, "拒收后载体逐字节不变（⛔ 不留半条记录）");
  assert.throws(() => appendOutcomeToFile(path.join(root, "never-created", "worker-outcome.jsonl"), { ...ok, final_state: "landed" }));
  assert.equal(fs.existsSync(path.join(root, "never-created")), false, "拒收时连目录都不建");
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

  // 前置：主检出 doc-only 盘上 status 仍 ready（合法滞后 develop）——但 status 读源已是 develop
  // （gap-driver-filters-readtaskstatus-stale-main-checkout：readTaskStatus 读 develop 非主检出，
  // 同 D5 的「⛔ 不再读主检出 stale status」，只是把 readTaskStatus 自身也改到 develop 侧）。
  assert.match(fs.readFileSync(path.join(root, "tasks", "gap-d5.md"), "utf8"), /^status:\s*ready/m, "precondition: main checkout (doc-only) disk still stale ready");
  assert.equal(readTaskStatus(root, "gap-d5"), "done", "readTaskStatus reads develop (done), not the stale disk");
  const noSha = computeLandingState(root, "gap-d5");
  assert.equal(noSha.state, "verified", "without landedSha, the develop-read fallback still lands (status=done from develop)");

  // 修后：传 landedSha（develop tip）⇒ 从 ff 结果派生（⛔ 不依赖 status 读，verifiedBy 点名 landedSha）⇒ verified。
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

// gap-goal-branch-landing-judged-against-develop-not-merge-target：落地判定的基准分支 = 本任务的合并
// 目标（resolveTaskMergeTarget），⛔ 不是硬编码 develop。落 goal/<id> 的任务其落地提交按设计不在 develop
// 上，拿 develop 判祖先会把成功落地记成 exited-not-landed（生产 4/4 次真实 goal 落地都读到）。
test("gap-goal-branch-landing-judged-against-develop-not-merge-target — computeLandingState 基准分支由参数给出，缺省 develop 行为不变", (t) => {
  const root = makeGitRoot("goal-land");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 建 develop（= 初始提交）与 goal/GOAL-901（带一个只在它上面的落地提交）。
  runGit(root, ["branch", "develop"]);
  runGit(root, ["checkout", "-q", "-b", "goal/GOAL-901"]);
  fs.writeFileSync(path.join(root, "landed.txt"), "landed on goal/GOAL-901\n");
  runGit(root, ["add", "landed.txt"]);
  runGit(root, ["commit", "-q", "-m", "land on goal/GOAL-901"]);
  const landedSha = runGit(root, ["rev-parse", "goal/GOAL-901"]).trim();
  // 前置：落地提交【不在】develop 上——否则本用例测不到目标分支的差别（能取假）。
  assert.notEqual(
    spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", landedSha, "develop"]).status,
    0,
    "precondition: the landing commit is NOT on develop",
  );

  // ① 以 goal/GOAL-901 为目标 ⇒ verified（落地提交是该分支 tip ∧ 无残留 worktree）。
  const goalTarget = computeLandingState(root, "gap-goal-land", landedSha, "goal/GOAL-901");
  assert.equal(goalTarget.state, "verified", "goal target: landing commit is goal/GOAL-901 tip ⇒ verified (⛔ not exited-not-landed)");
  assert.match(goalTarget.verifiedBy, /goal\/GOAL-901/, "verified 文案点名实际目标分支");

  // ② 缺省（develop）判同一提交 ⇒ failed，文案含 develop（既有行为逐字不变）。
  const devTarget = computeLandingState(root, "gap-goal-land", landedSha);
  assert.equal(devTarget.state, "failed", "develop target: the same commit is not on develop ⇒ failed");
  assert.match(devTarget.reason, /not develop tip\/ancestor/, "缺省文案仍点名 develop");

  // ③ 落地提交两条分支上都没有 ⇒ 两种目标下都 failed，文案点名【所用的】分支。
  const bogus = runGit(root, ["commit-tree", `${landedSha}^{tree}`, "-m", "bogus on neither branch"]).trim();
  const bogusDev = computeLandingState(root, "gap-goal-land", bogus);
  assert.equal(bogusDev.state, "failed", "bogus commit ⇒ develop target failed");
  assert.match(bogusDev.reason, /not develop tip\/ancestor/, "文案点名 develop");
  const bogusGoal = computeLandingState(root, "gap-goal-land", bogus, "goal/GOAL-901");
  assert.equal(bogusGoal.state, "failed", "bogus commit ⇒ goal target failed");
  assert.match(bogusGoal.reason, /not goal\/GOAL-901 tip\/ancestor/, "文案点名所用的目标分支 goal/GOAL-901");
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
  const fanSrc = fs.readFileSync(FAN_IN, "utf8");
  assert.match(fanSrc, /verdict: \{ step, verdict: "failed", exitCode, summary, logFile \}/, "D6: verdictOf produces the structured per-step verdict");
  assert.match(fanSrc, /reason: summary/, "D6: reason is the summary projection (⛔ not the raw stream)");
  // 负臂对【两个文件】都查（坏形态在任何一处重现都算红）——⛔ 不因代码搬家而把负臂收窄成只查新文件。
  for (const s of [fs.readFileSync(DRIVER, "utf8"), fanSrc]) {
    assert.doesNotMatch(s, /\(a\.stderr \|\| a\.stdout \|\| ""\)\.trim\(\)/, "D6: the raw (stderr||stdout).trim() dump is gone");
  }
  assert.match(fanSrc, /extractFailureSummary\(combined\)/, "D6: summary extracted via the noise-stripping pure fn");
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

// ── gap-step-trace-reason-captures-gate-stdout ──────────────────────────────────────────────────────
// step-trace（A1 过程日志 .quay/fan-in-<task>-<runId>.log）的失败步 reason 现用 (r.stderr||r.stdout).trim()
// ——stderr 优先 || 短路，MODULE_TYPELESS 噪声恒占 stderr ⇒ reason 只留噪声，真判词（ac-gate 的 checked
// X/Y / anti-drift 的 violation）没进载体。与 gap-scoped-gate-reason-stderr-drops-stdout 同族，但这是
// step-trace 载体（不是 fail() 的 reason 构造）。AC1（能取假）：失败步 reason 含 stdout 判词
// （checked/violation），⛔ 纯 MODULE 警告 ⇒ 假。AC2（能取假，单测）：断言「失败步 reason 含 stdout 判词」。

test("AC1 (gap-step-trace-reason-captures-gate-stdout) — ac-gate/anti-drift 失败时 step-trace reason 含 stdout 判词（checked/violation），⛔ 纯 MODULE 警告", () => {
  const stderrNoise = [
    "(node:941011) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///x.ts is not specified...",
    "Reparsing as ES module because module syntax was detected. This incurs a performance overhead.",
  ].join("\n");

  // ac-gate fail（exit 1）——判词在「checked X/Y」行，⛔ FAIL 行匹配 isSignal 会把它尾截掉（signals-first）。
  const acGateFail = [
    "fan-in-ac-completion-gate: AC 未全勾（checked 3/5，剩余未勾 2 含非待外部项）——未翻 done",
    "fan-in-ac-completion-gate: FAIL (exit 1) — flip refused",
  ].join("\n");
  const acSummary = extractFailureSummary(combinedOutput(acGateFail, stderrNoise));
  assert.match(acSummary, /checked 3\/5/, "AC1: ac-gate 判词（checked X/Y）进 reason");
  assert.doesNotMatch(acSummary, /MODULE_TYPELESS/, "AC1: reason ⛔ 纯 MODULE 警告");

  // anti-drift HARD FAIL（exit 1）——判词在 violation 列表（HARD FAIL 头 + 违规明细）。
  const antiDriftFail = [
    "ANTI-DRIFT HARD FAIL: task gap-x — 2 violation(s)",
    "  out-of-declared: task wrote plugin/scripts/foo.ts (matches no declared Touches glob)",
  ].join("\n");
  const antiSummary = extractFailureSummary(combinedOutput(antiDriftFail, stderrNoise));
  assert.match(antiSummary, /violation\(s\)/, "AC1: anti-drift 判词（violation）进 reason");
  assert.doesNotMatch(antiSummary, /MODULE_TYPELESS/, "AC1: reason ⛔ 纯 MODULE 警告");
});

test("AC2 (gap-step-trace-reason-captures-gate-stdout) — step() 包层 trace reason 用 extractFailureSummary(combinedOutput)，⛔ 不再 (r.stderr||r.stdout).trim()", () => {
  const fanSrc = fs.readFileSync(FAN_IN, "utf8");
  for (const s of [fs.readFileSync(DRIVER, "utf8"), fanSrc]) {
    assert.doesNotMatch(s, /reason: \(r\.stderr \|\| r\.stdout \|\| ""\)\.trim\(\)/, "AC2: step() trace 的 stderr 优先裸流已移除");
  }
  assert.match(fanSrc, /extractFailureSummary\(combinedOutput\(r\.stdout, r\.stderr\)\)/, "AC2: step() trace reason 走同一去噪机件（与 fail() 共用）");
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
  const fanSrc = fs.readFileSync(FAN_IN, "utf8");
  for (const s of [fs.readFileSync(DRIVER, "utf8"), fanSrc]) {
    assert.doesNotMatch(s, /a\.stderr \|\| `exit/, "flip 的 git add/commit 失败 reason 不再 stderr-only");
  }
  assert.match(fanSrc, /combinedOutput\(a\.stdout, a\.stderr\)/, "flip reason 用 combinedOutput 合并 stdout+stderr");
  assert.match(fanSrc, /export function combinedOutput/, "combinedOutput 是单一共享机件（fail() 与 flip 共用）");
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

// ── gap-fan-in-red-bucket-run-not-recorded AC1/AC2 — 机械 fan-in 的 suite 步缺省命令 ───────────────
// 机械路径此前跑平行 `bash scripts/test.sh --buckets`（绕开 verification-round.jsonl 唯一 writer，
// 红桶轮次零记录——硬规则 3b「没跑过」与「跑了但红」同形）。现在缺省命令统一到 full-suite-runner.ts
// --buckets：green+red 桶轮次都在 suite 退出时入账，/tests 趋势账本看到完整真相。

test("AC2 — the mechanical fan-in default suite command is full-suite-runner.ts --buckets（本仓库形态：显式声明 suite_runner: quay-buckets）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "mech-suite-quay-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, ".quay"), { recursive: true });
  // gap-repo-shape-inferred-from-test-sh-existence / AC-316：走 bucket runner 的判据是这份【声明】，
  // ⛔ 不再是「目录里有没有 scripts/test.sh」（照旧铺出该文件，以证明它已不参与判定）。
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.writeFileSync(path.join(wt, ".quay", "config.yml"), "loop:\n  suite_runner: quay-buckets\n", "utf8");
  const cmd = defaultMechanicalSuiteCommand({
    task: "gap-mech-red-bucket",
    worktree: wt,
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite-gap-mech-red-bucket.log",
    runId: "mfi-gap-mech-red-bucket-1788022868-abc123",
  });
  assert.ok(cmd.some((a) => a.endsWith("full-suite-runner.ts")), "the default suite command must be full-suite-runner.ts");
  assert.ok(cmd.includes("--buckets") && cmd.includes("gap-mech-red-bucket"), "must pass --buckets <task>");
  assert.ok(cmd.includes("--root") && cmd.includes(wt), "must pass --root <worktree> (the tested checkout)");
  assert.ok(cmd.includes("--state-dir") && cmd.includes("/tmp/root/.quay"), "must pass --state-dir <root>/.quay (the shared checkout ledger)");
  assert.ok(cmd.includes("--runner") && cmd.includes("inner"), "must pass --runner inner (explicit layer identity)");
  assert.ok(cmd.includes("--log-file") && cmd.includes("/tmp/fan-in-suite-gap-mech-red-bucket.log"), "must pass --log-file <suiteLogFile> (the silence-watchdog tee)");
  // gap-mechanical-fan-in-per-suite-runid-unified — the per-suite runId is passed to the runner so the
  // suite-load-<runId>.jsonl key + full-suite-state runId + verification-round record runId share ONE key.
  assert.ok(cmd.includes("--run-id") && cmd.includes("mfi-gap-mech-red-bucket-1788022868-abc123"), "must pass --run-id <per-suite runId> to the runner");
  assert.ok(!cmd.some((a) => a.includes("scripts/test.sh")), "must NOT run a parallel `bash scripts/test.sh` harness");
});

// gap-driver-fanin-hardcoded-test-sh-third-party 范围扩展：第三方项目（无 scripts/test.sh）的 suite 步
// ⛔ 不再调用 full-suite-runner（本仓库专属基建，内部锚点假设本仓库结构）——直接委托 loop.test_command。
test("defaultMechanicalSuiteCommand — 第三方项目（无 scripts/test.sh，有 loop.test_command）⇒ 委托 test_command，⛔ 不调用 full-suite-runner", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "mech-suite-third-party-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(wt, ".quay", "config.yml"), "loop:\n  test_command: node --test\n", "utf8");
  const cmd = defaultMechanicalSuiteCommand({
    task: "gap-mech-red-bucket",
    worktree: wt,
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite.log",
    runId: "mfi-gap-mech-red-bucket-1788022868-abc123",
  });
  assert.deepEqual(cmd, ["bash", "-c", `cd '${wt}' && node --test`],
    "third-party suite 退化为全量 test_command（cd 进 worktree 再跑）");
  assert.ok(!cmd.some((a) => a.includes("full-suite-runner")), "⛔ 不得调用 full-suite-runner（本仓库专属基建）");
});

test("defaultMechanicalSuiteCommand — 第三方项目（scripts/test.sh 与 test_command 皆无）⇒ fail-closed 可区分取值", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "mech-suite-no-tooling-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  const cmd = defaultMechanicalSuiteCommand({
    task: "gap-mech-red-bucket",
    worktree: wt,
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite.log",
    runId: "mfi-gap-mech-red-bucket-1788022868-abc123",
  });
  assert.equal(cmd[0], "bash");
  assert.match(cmd[2], /no-suite-tooling/, "无测试能力 ⇒ 可区分取值（⛔ 不与「suite 跑了且失败」同形）");
  // gap-ac227-third-party-capability-degradation — 「能力不存在」不再以 exit 127（command-not-found）
  // 形态出现（GOAL-012 退出条件②）；fail-closed 仍保持非零退出（suite 判 red ⇒ 拒翻 done）。
  assert.ok(!cmd[2].includes("exit 127"), "⛔ 不得以 exit 127 形态出现（能力不存在 ≠ 命令不存在）");
  assert.match(cmd[2], /exit\s+[1-9][0-9]*/, "仍 fail-closed（非零退出 ⇒ suite 判 red）");
});

test("gap-mechanical-fan-in-per-suite-runid-unified AC2 — newMechanicalSuiteRunId is per-suite unique (two tasks ⇒ two ids, one per fan-in)", () => {
  const a = newMechanicalSuiteRunId("gap-task-a");
  const b = newMechanicalSuiteRunId("gap-task-b");
  assert.notEqual(a, b, "two different tasks produce two DIFFERENT per-suite runIds");
  assert.ok(a.startsWith("mfi-gap-task-a-") && b.startsWith("mfi-gap-task-b-"), "the id carries the mfi-<task>- prefix (suite identity, not the shared wk-prod round id)");
  assert.ok(!a.startsWith("wk-prod"), "the per-suite id is NOT the shared wk-prod driver round id");
});

// ── gap-fan-in-suite-log-same-runid-overwrite（AC1/AC3 单元面）────────────────────────────────
// suite 日志文件名带 attempt 唯一后缀（同一 runId 内多次 suite 不覆盖）+ 轮转前缀用 `~` 分隔符
// （任务 id kebab-case 前缀碰撞 300+ 对——裸 `-` 分隔会误删兄弟任务日志）。

test("suiteLogFileName — 同一 runId 不同 attempt ⇒ 两个不同 basename（⛔ 相同 ⇒ 假）", () => {
  const a = suiteLogFileName("gap-dashboard-taskcard-multistatus-minitable", "wk-prod-1788275557", "1756700000000-abc123");
  const b = suiteLogFileName("gap-dashboard-taskcard-multistatus-minitable", "wk-prod-1788275557", "1756700000001-def456");
  assert.notEqual(a, b, "different attempt suffixes ⇒ different basenames");
  assert.ok(a.includes("wk-prod-1788275557") && a.includes("1756700000000-abc123"), "basename carries runId + attempt");
  // task/runId sanitize + `~` 分隔符：非法字符 → _，`~` 只作分隔符。
  assert.equal(
    suiteLogFileName("gap/a", "wk/prod 123", "1"),
    "fan-in-suite-gap_a~wk_prod_123~1.log",
    "task + runId sanitized to [A-Za-z0-9_.-]; `~` is the reserved delimiter",
  );
});

test("newSuiteLogAttemptSuffix — 每次新（epoch-ms + rand 双唯一）", () => {
  const a = newSuiteLogAttemptSuffix();
  const b = newSuiteLogAttemptSuffix();
  assert.notEqual(a, b, "two calls ⇒ two different suffixes");
  assert.match(a, /^\d+-[0-9a-f]{6}$/, "shape = <epoch-ms>-<6 hex rand>");
});

test("pruneTaskSuiteLogs — 只删本任务（`~` 边界），兄弟任务 `<task>-<suffix>` 日志保留（⛔ 误删 ⇒ 假）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "suite-prune-"));
  try {
    const q = path.join(root, ".quay");
    fs.mkdirSync(q, { recursive: true });
    const write = (name) => fs.writeFileSync(path.join(q, name), "x", "utf8");
    // 本任务 DIR-035 的 3 份历史 attempt + 1 份兄弟任务 DIR-035-A + 1 份无关文件。
    write(suiteLogFileName("DIR-035", "run-1", "1"));
    write(suiteLogFileName("DIR-035", "run-1", "2"));
    write(suiteLogFileName("DIR-035", "run-2", "3"));
    write(suiteLogFileName("DIR-035-A", "run-1", "1"));
    write("fan-in-suite-unrelated.log");
    const removed = pruneTaskSuiteLogs(root, "DIR-035");
    assert.equal(removed, 3, "removed exactly the 3 DIR-035 attempt logs");
    assert.ok(!fs.existsSync(path.join(q, suiteLogFileName("DIR-035", "run-1", "1"))), "DIR-035 attempt removed");
    assert.ok(fs.existsSync(path.join(q, suiteLogFileName("DIR-035-A", "run-1", "1"))), "sibling DIR-035-A log retained (⛔ `-` boundary would误删)");
    assert.ok(fs.existsSync(path.join(q, "fan-in-suite-unrelated.log")), "unrelated file retained");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pruneTaskSuiteLogs — 无 .quay 目录 / 无匹配 ⇒ 返回 0 不抛（best-effort）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "suite-prune-empty-"));
  try {
    assert.equal(pruneTaskSuiteLogs(root, "gap-none"), 0, "no .quay dir ⇒ 0 removed, no throw");
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    assert.equal(pruneTaskSuiteLogs(root, "gap-none"), 0, "no matching files ⇒ 0 removed, no throw");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — the mechanical fan-in default suite command, run against a red bucket suite, records state=red into verification-round.jsonl", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mech-red-bucket-"));
  try {
    // A fake red bucket scripts/test.sh (the runner spawns `bash scripts/test.sh --buckets <task>` in cwd=root).
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n" + [
      'echo "__BUCKETS__ buckets=M files=3 full=0"',
      'echo "# tests 5"',
      'echo "# pass 3"',
      'echo "# fail 2"',
      'echo "# cancelled 0"',
      "exit 1",
    ].join("\n") + "\n", { mode: 0o755 });
    // The default suite command resolves full-suite-runner.ts from the WORKTREE's plugin tree (the
    // mechanical fan-in contract — the worktree carries the tested plugin code). Symlink the REAL plugin
    // tree so the runner resolves in the temp "worktree" (same pattern as fan-in-execute-paths.test.mjs
    // symlinkRuntimeTrees — untracked ⇒ never in any delta).
    // gap-repo-shape-inferred-from-test-sh-existence / AC-316: 走 bucket runner 的判据是这份声明。
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), "loop:\n  suite_runner: quay-buckets\n", "utf8");
    fs.symlinkSync(path.join(REPO_ROOT, "plugin"), path.join(root, "plugin"), "dir");
    const suiteLog = path.join(root, "fan-in-suite.log");
    const perSuiteRunId = "mfi-gap-mech-red-bucket-1788022868-abc123";
    const cmd = defaultMechanicalSuiteCommand({ task: "gap-mech-red-bucket", worktree: root, root, suiteLogFile: suiteLog, runId: perSuiteRunId });
    // Hermetic seams (same family as full-suite-runner.test.mjs runRunner): skip the REAL resource gate
    // + single-flight + systemd scope so a temp-repo fake suite is deterministic.
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: root,
      env: { ...process.env, QUAY_TEST_SKIP_RESOURCE_GATE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 1, `the runner exits 1 on a red bucket round, got ${code} (stderr tail: ${stderr.slice(-400)})`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written into --state-dir");
    const lines = fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim());
    // gap-verification-round-single-writer AC1 — 恰一条记录（⛔ 无 writeRedSuiteRecord 平行双写 ⇒ round 号虚增）。
    assert.equal(lines.length, 1, "a red mechanical bucket round lands EXACTLY ONE record (no parallel red double-write)");
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.state, "red", "a red mechanical bucket round records state=red (not green, not absent)");
    assert.equal(rec.fail, 2, "the fail count rides the record");
    assert.equal(rec.buckets, "M", "the __BUCKETS__ marker is parsed into the buckets field");
    assert.equal(rec.bucket_files, 3, "the __BUCKETS__ file count rides the record");
    assert.equal(rec.runner, "inner", "explicit --runner inner is recorded");
    assert.equal(rec.preverified, undefined, "the runner-shape record carries NO preverified field (single writer)");
    // gap-mechanical-fan-in-per-suite-runid-unified AC1 — the record runId == the --run-id passed to the
    // runner (the SAME key the suite-load-<runId>.jsonl file + full-suite-state carry).
    assert.equal(rec.runId, perSuiteRunId, "the verification-round record carries the per-suite runId (record ↔ telemetry join key)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 (integration) — re-dispatching the same task N times writes N distinct session_ids", (t) => {
  const root = makeGitRoot("session-pin");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTaskFile(root, "gap-sid", "done"); // status=done ⇒ an exit-0 worker "lands" (completed)
  // 合并同形 driver spawn（gap-worker-driver-test-merge-driver-tests）：同任务 3 次派发折叠进一次
  // driver（--task ×3），3 个 worker 各生成独立 session_id。真 spawn 3→1，⛔ 不删断言换时间。
  runDriver(root, ["--task", "gap-sid", "--task", "gap-sid", "--task", "gap-sid", "--reason", "session-pin", "--worker-cmd-exact", "node -e process.exit(0)"]);
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
  // gap-promotion-driver-ready-pool-check-path-third-party：脚本锚在本 kernel 安装位置（dev tree =
  // 本仓库 plugin/scripts/dispatch-worktree-setup.sh），⛔ 非 /r/plugin/scripts/（第三方项目无 plugin/）。
  assert.match(prompt, /plugin\/scripts\/dispatch-worktree-setup\.sh/, "AC1: setup script resolves to a kernel plugin/scripts path");
  assert.doesNotMatch(prompt, /\/r\/plugin\/scripts\/dispatch-worktree-setup\.sh/, "AC1: ⛔ not anchored at the task root");
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

// gap-worker-prompt-guards-file-tools-not-bash（AC1/AC2）：旧 CRITICAL 段只护 file tools
// （Read/Edit/Write 的 file_path），对 Bash 只字未提 ⇒ 一个在 Bash 脚本里硬编码主检出根作为写入目标的
// 命令「逐字符合护栏」（2026-09-30 实证：worker 在 `cat > "$WT/x.mjs"` 的脚本体内写
// `const T = "${root}/…"` + writeFileSync，把 17 个文件写进共享检出）。本测试对【两个】builder 各自
// 独立断言（硬规则 5b：兄弟实例同文件），且按位置判——命中必须在 ⚠️ CRITICAL 段【内】，
// ⛔ 不是文件别处的偶然命中。任一处漏改 ⇒ 对应 arm 独立转红（AC4 反例：删掉子句即红）。
test("AC1/AC2 (能取假) — 两个 prompt builder 的 CRITICAL 段都把路径护栏从 file tools 扩到 Bash 写入目标", () => {
  const root = "/main-root";
  const cases = [
    ["buildWorkerPrompt", buildWorkerPrompt("gap-x", root)],
    [
      "buildContinueWorkerPrompt",
      buildContinueWorkerPrompt("gap-x", root, {
        worktreePath: "/wt",
        branchCommits: 3,
        branchHeadSubject: "x",
        acChecked: 0,
        acTotal: 3,
        failureReason: "r",
      }),
    ],
  ];
  for (const [label, prompt] of cases) {
    const start = prompt.indexOf("⚠️ CRITICAL");
    const end = prompt.indexOf("This rule does NOT cover the task file", start);
    assert.ok(start !== -1 && end > start, `${label}: the ⚠️ CRITICAL guard sentence is present and delimited`);
    const guard = prompt.slice(start, end);
    // (a) 显式点名 Bash / shell 脚本 —— 按位置判：在护栏句【内】，非全文别处。
    assert.match(guard, /Bash/, `${label}: guard sentence names Bash (in-guard, by position)`);
    assert.match(guard, /shell script/, `${label}: guard sentence names shell scripts`);
    // (b) 逐字含「不得把主检出根 <root> 作为写入目标」义，且把具体根字面量钉在护栏里。
    assert.ok(
      guard.includes(`never hardcode the main-checkout root \`${root}\` as a write target`),
      `${label}: guard forbids the main-checkout root as a write target, verbatim`,
    );
    assert.ok(guard.includes(`\`${root}\``), `${label}: guard pins the concrete main-checkout root`);
  }
  // 单一真相源（fork 检测）：两个 builder 共用同一段 Bash 护栏字面；若将来被 fork 成两份、其中一份丢失
  // 该标记，此处失败。注意这是弱断言——**实质测量是上面的 per-builder 护栏断言**，本行只防 fork。
  const marker = "THIS GUARD ALSO COVERS BASH";
  assert.ok(cases[0][1].includes(marker), "create prompt carries the shared Bash-guard marker");
  assert.ok(cases[1][1].includes(marker), "continue prompt carries the SAME Bash-guard marker (not a forked copy)");
});

// gap-promotion-driver-ready-pool-check-path-third-party AC2 负控制：kernel dist 布局（无
// plugin/scripts/*.ts，只有 shipped dist/*.js + loose scripts/*.sh）时，worker prompt 的
// scoped-gate-cache 写入入口须解析到 shipped dist/worker-driver.js（stripTypes=false，⛔ 不带
// --experimental-strip-types），dispatch-worktree-setup.sh 须解析到 kernel scripts/（⛔ 非 task root）。
// gap-driver-fanin-hardcoded-test-sh-third-party：preMergeNote 的 scoped-gate 分支现在按 worktree 是否
// 有 scripts/test.sh 分叉——本负控制给 root 铺 scripts/test.sh（本仓库形态），使 cache-write 指令仍在
// 「跑 scoped 门」分支内，仅验证 kernel 解析面（dist 布局）而非第三方退化面。
test("gap-promotion-driver-ready-pool-check-path-third-party — kernel dist 布局 + worktree 有 scripts/test.sh：buildWorkerPrompt 解析到 shipped dist/worker-driver.js 与 kernel scripts/*.sh", () => {
  const shipped = fs.mkdtempSync(path.join(os.tmpdir(), "worker-shipped-"));
  const quayRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worker-quay-root-"));
  try {
    // 仿 shipped kernel 布局：scripts/dist/worker-driver.js（bundled，无 raw .ts）+ scripts/*.sh（loose）。
    const dist = path.join(shipped, "scripts", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "worker-driver.js"), "// bundled\n", "utf8");
    fs.writeFileSync(path.join(shipped, "scripts", "dispatch-worktree-setup.sh"), "#!/usr/bin/env bash\n", "utf8");
    fs.writeFileSync(path.join(shipped, "scripts", "suite-slot-lib.sh"), "#!/usr/bin/env bash\n", "utf8");
    // 本仓库形态 worktree root（.quay/config.yml 声明了 scoped_command ⇒ preMergeNote 走「跑 scoped 门」
    // 分支，含 cache-write 指令）。gap-repo-shape-inferred-from-test-sh-existence / AC-316：判据是声明。
    fs.mkdirSync(path.join(quayRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(quayRoot, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
    fs.mkdirSync(path.join(quayRoot, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(quayRoot, ".quay", "config.yml"),
      "loop:\n  suite_runner: quay-buckets\n" +
      '  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n' +
      '  doc_check_command: ["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]\n', "utf8");
    const saved = process.env.QUAY_PLUGIN_ROOT;
    process.env.QUAY_PLUGIN_ROOT = shipped; // resolveKernelScriptsDir() = <shipped>/scripts，<shipped>/scripts/*.ts 不存在
    try {
      const prompt = buildWorkerPrompt("gap-x", quayRoot);
      // scoped-gate-cache 写入入口：node <shipped>/scripts/dist/worker-driver.js（⛔ 无 --experimental-strip-types）。
      assert.ok(prompt.includes(`node ${path.join(shipped, "scripts", "dist", "worker-driver.js")} --write-scoped-gate-cache`),
        "cache-write entry resolves to shipped dist/worker-driver.js");
      assert.ok(prompt.includes("--write-scoped-gate-cache"), "cache-write flag present");
      assert.doesNotMatch(prompt, /--experimental-strip-types[^\n]*worker-driver\.ts/, "⛔ no strip-types + .ts form");
      assert.ok(!prompt.includes(`${quayRoot}/plugin/scripts/worker-driver.ts`), "⛔ not anchored at task root .ts");
      // dispatch-worktree-setup.sh 锚在 kernel scripts/（⛔ 非 task root/plugin/scripts/）。
      assert.ok(prompt.includes(`bash ${path.join(shipped, "scripts", "dispatch-worktree-setup.sh")}`),
        "dispatch setup resolves to kernel scripts/*.sh");
      assert.ok(!prompt.includes(`${quayRoot}/plugin/scripts/dispatch-worktree-setup.sh`), "⛔ not anchored at task root .sh");
    } finally {
      if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
      else process.env.QUAY_PLUGIN_ROOT = saved;
    }
  } finally {
    fs.rmSync(shipped, { recursive: true, force: true });
    fs.rmSync(quayRoot, { recursive: true, force: true });
  }
});

test("AC_A1 (能取假) — buildWorkerPrompt 经 Provider ABI 记录 AC：点名 task_check + task_write，⛔ 不含手改复选框字面 (gap-worker-prompt-ac-check-via-abi-not-hand-edit)", () => {
  const prompt = buildWorkerPrompt("gap-x", "/r");
  // 按位置判定（prompt 字面含勾 AC 指令，非注释里提到）：点名 AC 段 + 勾选复选框 + 逐条验证 + ABI 记录机制。
  assert.match(prompt, /## Acceptance Criteria/, "names the task body AC section");
  assert.match(prompt, /- \[x\]/, "instructs checking off the checkbox (- [x])");
  assert.match(prompt, /one-by-one/, "instructs per-criterion (逐条) verification");
  assert.match(prompt, /task_check/, "instructs confirming AC state via task_check");
  assert.match(prompt, /task_write/, "instructs recording AC state via task_write");
  assert.match(prompt, /do NOT hand-edit/, "explicitly forbids hand-editing the checkbox characters");
  assert.doesNotMatch(prompt, /turn `- \[ \]` into `- \[x\]`/, "negative control: the old hand-edit literal is gone");
  assert.doesNotMatch(prompt, /committing these AC checkbox updates together with your implementation/, "negative control: no hand-commit-of-checkbox-text instruction");
});

test("gap-worker-prompt-ac-check-via-abi-not-hand-edit — buildContinueWorkerPrompt 同 seam 也经 ABI 记录 AC (续做轮同样勾选，否则 ac-precheck 0/3 再烧一轮)", () => {
  const cont = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "x",
    acChecked: 0,
    acTotal: 3,
    failureReason: "ac-precheck 0/3",
  });
  assert.match(cont, /- \[x\]/, "continue prompt instructs checking off - [x]");
  assert.match(cont, /## Acceptance Criteria/, "continue prompt names the AC section");
  assert.match(cont, /task_check/, "continue prompt instructs task_check");
  assert.match(cont, /task_write/, "continue prompt instructs task_write");
  assert.doesNotMatch(cont, /turn `- \[ \]` into `- \[x\]`/, "continue prompt has no old hand-edit literal");
});

test("gap-worker-prompt-ac-check-via-abi-not-hand-edit — 单一真相源：两个 prompt 共用 acCheckNote 的同一段字面，未被 fork 成两份", () => {
  // Plan 步骤 4 回归断言：acCheckNote 是单一真相源，两处调用点（buildWorkerPrompt / buildContinueWorkerPrompt）
  // 必须产出同一段「经 ABI 记录、⛔ 手改」指令——若未来把续做 prompt 的指令 fork 成另一份文案，这段共享
  // 字面会从其中一个消失 ⇒ 此处断言失败（能取假，非恒真）。
  const create = buildWorkerPrompt("gap-x", "/r");
  const cont = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "x",
    acChecked: 0,
    acTotal: 3,
    failureReason: "ac-precheck 0/3",
  });
  const sharedMarker = "record the AC state through the Provider ABI";
  assert.ok(create.includes(sharedMarker), "create prompt carries the shared acCheckNote marker");
  assert.ok(cont.includes(sharedMarker), "continue prompt carries the SAME acCheckNote marker (not a forked copy)");
});

// ── gap-continue-prompt-delta-relatedness-note — 续做 prompt 两条结构性信号 ─────────────────────────

// 写一个带 ## Touches 的任务文件（非 git makeRoot，delta = Touches）。
function writeRelatednessTask(root, task, touches) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const bullets = touches.map((t) => `- ${t}`).join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${task}.md`),
    `---\nid: ${task}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n${bullets}\n`, "utf8");
}

// 写一个测试文件（可选 @load-sensitive 头）。
function writeRelatednessTest(root, rel, { loadSensitive = false } = {}) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const header = loadSensitive ? "// @load-sensitive wall-clock\n" : "// @test-group product\n";
  fs.writeFileSync(abs, `${header}import { test } from "node:test";\n`, "utf8");
}

test("AC1 (能取假) — classifyDeltaRelatedness 区分「失败测试在 delta 内=related」与「不在且一跳导入不相交=unrelated」", () => {
  const inDelta = classifyDeltaRelatedness("packages/quay/test/foo.test.mjs",
    ["packages/quay/test/foo.test.mjs"], []);
  assert.equal(inDelta.verdict, "related", "failing test itself in delta ⇒ related");

  const viaImport = classifyDeltaRelatedness("packages/quay/test/obs.test.mjs",
    ["packages/quay/src/observation.ts"],
    ["packages/quay/src/observation.ts", "packages/quay/src/serve-handlers.ts"]);
  assert.equal(viaImport.verdict, "related", "one-hop import intersects delta ⇒ related");

  const unrelated = classifyDeltaRelatedness("packages/quay/test/obs.test.mjs",
    ["packages/quay/src/serve-dashboard.ts"],
    ["packages/quay/src/observation.ts", "packages/quay/src/serve-handlers.ts"]);
  assert.equal(unrelated.verdict, "unrelated", "not in delta + one-hop imports disjoint ⇒ unrelated");

  // 两个判断能互相区分（⛔ 恒定输出同一结论 ⇒ 假）。
  assert.notEqual(inDelta.verdict, unrelated.verdict, "related vs unrelated distinguishable");
});

test("AC2 (能取假) — classifyLoadSensitive 命中真实 @load-sensitive 标注、未标注不命中", (t) => {
  const root = makeRoot("rel-ls");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeRelatednessTest(root, "plugin/test/annotated.test.mjs", { loadSensitive: true });
  writeRelatednessTest(root, "plugin/test/plain.test.mjs", { loadSensitive: false });
  assert.equal(classifyLoadSensitive(root, "plugin/test/annotated.test.mjs"), "load-sensitive", "annotated ⇒ hit");
  assert.equal(classifyLoadSensitive(root, "plugin/test/plain.test.mjs"), "not-annotated", "unannotated ⇒ miss");
});

test("AC3 (能取假) — 读不懂有独立取值 unknown，不与 unrelated/not-annotated 同形", (t) => {
  const root = makeRoot("rel-unknown");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Touches 解析失败（delta null）⇒ signal1 unknown。
  const noDelta = classifyDeltaRelatedness("packages/quay/test/foo.test.mjs", null, []);
  assert.equal(noDelta.verdict, "unknown", "delta null ⇒ unknown (Touches unreadable)");
  assert.notEqual(noDelta.verdict, "unrelated", "unknown ≠ unrelated");

  // 依赖查询失败（import 解析 null 且不在 delta）⇒ signal1 unknown。
  const noImports = classifyDeltaRelatedness("packages/quay/test/foo.test.mjs", ["packages/quay/src/a.ts"], null);
  assert.equal(noImports.verdict, "unknown", "imports null (dependency query failed) ⇒ unknown");
  assert.notEqual(noImports.verdict, "unrelated", "unknown ≠ unrelated");

  // 注册表读取失败（文件缺失）⇒ signal2 unknown。
  assert.equal(classifyLoadSensitive(root, "plugin/test/missing.test.mjs"), "unknown", "missing file ⇒ unknown");
  assert.notEqual(classifyLoadSensitive(root, "plugin/test/missing.test.mjs"), "not-annotated", "unknown ≠ not-annotated");
});

test("AC4 (能取假) — 措辞含「不是结论/重跑验证」，⛔ 不含可误读为自动放行的「跳过/无需检查」", () => {
  const note = formatRelatednessNote([{
    signal: "delta-relatedness", failingTest: "packages/quay/test/obs.test.mjs", verdict: "unrelated", reason: "r",
  }]);
  assert.match(note, /not a verdict|not a conclusion/, "names 'not a verdict/conclusion'");
  assert.match(note, /[Rr]e-run the suite once to verify/, "instructs re-run to verify");
  assert.doesNotMatch(note, /\bskip\b|无需检查|可以跳过/, "no auto-skip wording (skip / 无需检查 / 可以跳过)");
});

test("AC5 (能取假) — buildContinueWorkerPrompt 在 suite 红时拼入 continueRelatednessNote 输出", (t) => {
  const root = makeRoot("rel-wired");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeRelatednessTask(root, "gap-x", ["packages/quay/src/serve-dashboard.ts"]);
  writeRelatednessTest(root, "packages/quay/test/obs.test.mjs", { loadSensitive: false });
  const suiteLog = path.join(root, ".quay", "fan-in-suite-gap-x.log");
  fs.mkdirSync(path.dirname(suiteLog), { recursive: true });
  fs.writeFileSync(suiteLog, "__PERFILE__ duration_ms=10 packages/quay/test/obs.test.mjs passed=false end_ms=1\n", "utf8");

  const withRed = buildContinueWorkerPrompt("gap-x", root, {
    worktreePath: "/wt", branchCommits: 1, branchHeadSubject: "x", acChecked: 1, acTotal: 2,
    failureReason: "suite red",
    attempts: [{ ts: "2026-09-01T00:00:00.000Z", runId: "r", sessionId: "s", step: "suite", reason: "suite red", fanInLog: null, suiteLog }],
  });
  assert.match(withRed, /delta-relatedness check/, "suite-red continue prompt carries the relatedness note");
  assert.match(withRed, /packages\/quay\/test\/obs\.test\.mjs/, "note names the failing test");

  // 负控制：无 suite 红（attempts 无 suiteLog）⇒ 不注入。
  const withoutRed = buildContinueWorkerPrompt("gap-x", root, {
    worktreePath: "/wt", branchCommits: 1, branchHeadSubject: "x", acChecked: 1, acTotal: 2, failureReason: "r",
    attempts: [],
  });
  assert.doesNotMatch(withoutRed, /delta-relatedness check/, "no suite-red ⇒ no relatedness note");
});

test("AC6 (能取假) — 真实案例回放：observation.test.mjs 判 unrelated + 未标注（⛔ 只在合成 fixture 上验证 ⇒ 假）", () => {
  // 用真实仓库文件（REPO_ROOT）：真实任务 Touches + 真实 observation.test.mjs 的 import 结构。
  const failing = "packages/quay/test/observation.test.mjs";
  const delta = computeDeltaPaths(REPO_ROOT, "gap-dashboard-taskcard-multistatus-minitable");
  const imports = directImportRels(REPO_ROOT, failing);
  const d = classifyDeltaRelatedness(failing, delta, imports);
  assert.equal(d.verdict, "unrelated", "real observation.test.mjs is not in the minitable task's delta and its one-hop imports don't intersect it");
  assert.equal(classifyLoadSensitive(REPO_ROOT, failing), "not-annotated", "real observation.test.mjs is @test-group product, not @load-sensitive — must say not-annotated (not a false hit)");

  // 回放 suite 日志的失败提取（真实 __PERFILE__ passed=false 行形）。
  const extracted = failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=93810 packages/quay/test/observation.test.mjs passed=false end_ms=1788282318478\n");
  assert.deepEqual(extracted, [failing], "real __PERFILE__ passed=false line extracts the real failing test");
});

// ── gap-worker-premerge-scoped-gate-cache — worker 退出前 pre-merge + scoped-gate 缓存 ─────────────

test("AC1 (gap-worker-premerge-scoped-gate-cache) — buildWorkerPrompt 含「退出前 merge develop + 跑 scoped 门」指令，且命令与 resolveScopedGateCommand 单一真相源一致（本仓库形态：声明了 scoped_command）", (t) => {
  const root = makeRoot("prompt-scg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"),
      "loop:\n  suite_runner: quay-buckets\n" +
      '  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n' +
      '  doc_check_command: ["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]\n', "utf8");
  const prompt = buildWorkerPrompt("gap-x", root);
  const resolution = resolveScopedGateCommand("gap-x", root, "<the worktree path you created in step 1>");
  assert.equal(resolution.kind, "run", "声明了 scoped_command ⇒ run");
  const scopedCmd = resolution.argv.join(" ");
  assert.ok(prompt.includes(scopedCmd), "prompt carries the exact resolveScopedGateCommand command string (single source, ⛔ 两套标准)");
  assert.match(prompt, /--for-task gap-x --allow-thin/, "command tail matches the fan-in scopedCmd form");
  assert.match(prompt, /merge --no-edit develop/, "instructs the pre-merge of develop");
  assert.match(prompt, /--write-scoped-gate-cache/, "instructs the mechanical cache write");
});

test("AC2 (gap-worker-premerge-scoped-gate-cache) — buildContinueWorkerPrompt 同样携带该步骤（本仓库形态，独立断言，⛔ 不靠共用文本含糊）", (t) => {
  const root = makeRoot("prompt-scg-cont");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"),
      "loop:\n  suite_runner: quay-buckets\n" +
      '  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n' +
      '  doc_check_command: ["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]\n', "utf8");
  const cont = buildContinueWorkerPrompt("gap-x", root, {
    worktreePath: "/wt", branchCommits: 3, branchHeadSubject: "x", acChecked: 2, acTotal: 5, failureReason: "r",
  });
  const resolution = resolveScopedGateCommand("gap-x", root, "/wt");
  assert.equal(resolution.kind, "run", "声明了 scoped_command ⇒ run");
  const scopedCmd = resolution.argv.join(" ");
  assert.ok(cont.includes(scopedCmd), "continue prompt carries the exact resolveScopedGateCommand command (real worktree path)");
  assert.match(cont, /merge --no-edit develop/, "continue prompt instructs the pre-merge");
  assert.match(cont, /--write-scoped-gate-cache/, "continue prompt instructs the cache write");
});

test("AC3 (gap-worker-premerge-scoped-gate-cache) — scoped-gate 缓存读写三分支：tip 一致命中；develop 前进未命中；缺失/损坏 fail-closed", (t) => {
  const root = makeRoot("scg-cache");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheFile = path.join(root, ".quay", "scoped-gate-cache.json");
  const k1 = scopedGateKey("gap-x", "sha-1");
  const k2 = scopedGateKey("gap-x", "sha-2"); // develop 前进 ⇒ 不同键

  assert.equal(readScopedGateCache(cacheFile, k1), null, "absent cache ⇒ null (fail-closed, 不得默认命中)");
  writeScopedGateCache(cacheFile, k1);
  assert.equal(readScopedGateCache(cacheFile, k1), true, "develop tip 完全一致 ⇒ 命中");
  assert.equal(readScopedGateCache(cacheFile, k2), null, "develop 已前进 ⇒ 未命中照跑");

  fs.writeFileSync(cacheFile, "{not json");
  assert.equal(readScopedGateCache(cacheFile, k1), null, "内容损坏 ⇒ null (fail-closed)");

  fs.writeFileSync(cacheFile, JSON.stringify({ key: k1, ok: false }));
  assert.equal(readScopedGateCache(cacheFile, k1), null, "非绿 (ok!=true) 永不命中");
});

// ── gap-driver-fanin-hardcoded-test-sh-third-party — doc-check / scoped-gate 不再硬编码
//    <worktree>/scripts/test.sh：第三方项目（无 scripts/test.sh）doc-check 跳过、scoped-gate 退化到
//    loop.test_command，两者皆无 ⇒ 直接进全量 suite。 ─────────────────────────────────────────────────

test("AC2 (gap-driver-fanin-hardcoded-test-sh-third-party) — 第三方（只声明 loop.test_command）⇒ scoped-gate/doc-check 都「未提供」、suite 委托 test_command", (t) => {
  const root = makeRoot("tp-tc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "loop:\n  test_command: node --test\n", "utf8");

  // gap-repo-shape-inferred-from-test-sh-existence：判据是【声明】而非文件存在。未声明 scoped_command ⇒
  // 该项目没有 scoped 能力 ⇒ skip（可区分取值），⛔ 不再退化为「拿全量 test_command 冒充 scoped 门」。
  assert.equal(scopedGateCommandFor("gap-x", root), null, "未声明 scoped_command ⇒ scoped-gate 跳过（null）");
  assert.equal(docCheckCommandFor(root), null, "未声明 doc_check_command ⇒ doc-check 跳过（null，可区分取值）");
  const r = resolveScopedGateCommand("gap-x", root, root);
  assert.equal(r.kind, "skip");
  assert.equal(r.reason, "no-scoped-command-declared");
  // suite 仍委托 test_command（未声明 suite_runner ⇒ delegated 当且仅当 test_command 有声明）。
  assert.deepEqual(defaultMechanicalSuiteCommand({ task: "gap-x", worktree: root, root: "/tmp/r", suiteLogFile: "/tmp/f.log", runId: "r1" }),
    ["bash", "-c", `cd '${root}' && node --test`], "suite 仍委托 loop.test_command");
});

test("AC2 (gap-driver-fanin-hardcoded-test-sh-third-party) — 第三方（scripts/test.sh 与 test_command 皆无）⇒ scoped-gate/doc-check 都跳过", (t) => {
  const root = makeRoot("tp-none");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(scopedGateCommandFor("gap-x", root), null, "无 test.sh、无 test_command ⇒ scoped-gate 跳过（null）");
  assert.equal(docCheckCommandFor(root), null, "doc-check 跳过（null）");
  const r = resolveScopedGateCommand("gap-x", root, root);
  assert.equal(r.kind, "skip");
  assert.equal(r.reason, "no-scoped-command-declared");
});

test("AC2 (gap-driver-fanin-hardcoded-test-sh-third-party) — 本仓库（显式声明契约）⇒ scoped-gate/doc-check 与修改前逐字一致", (t) => {
  const root = makeRoot("this-repo");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  // 本仓库形态的判据现在是【这份声明】（goals/AC-316）：文件存在不再参与判定，声明才参与。
  fs.writeFileSync(path.join(root, ".quay", "config.yml"),
    "loop:\n  suite_runner: quay-buckets\n" +
    `  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n` +
    `  doc_check_command: ["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]\n`, "utf8");

  assert.deepEqual(scopedGateCommandFor("gap-x", root),
    ["bash", path.join(root, "scripts", "test.sh"), "--for-task", "gap-x", "--allow-thin"],
    "scoped 门命令与修改前逐字一致");
  assert.deepEqual(docCheckCommandFor(root),
    ["bash", path.join(root, "scripts", "test.sh"), "--static-checks-doc"],
    "doc-check 命令与修改前逐字一致");
});

test("AC-316 负控 — 声明形状读不懂 ⇒ fail-closed，⛔ 不静默跳过（硬规则 3b：invalid ≠ absent）", (t) => {
  const root = makeRoot("tp-invalid");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 声明了但是【字符串】而不是 argv 列表 ⇒ 第三态 invalid ⇒ fail，⛔ 不与「未提供」同形。
  fs.writeFileSync(path.join(root, ".quay", "config.yml"),
    'loop:\n  scoped_command: "bash scripts/test.sh --for-task x"\n  doc_check_command: []\n', "utf8");

  const scoped = resolveScopedGateCommand("gap-x", root, root);
  assert.equal(scoped.kind, "fail", "字符串声明 ⇒ fail（非 skip）");
  assert.match(scoped.reason, /scoped-command-declaration-unreadable/);
  const doc = resolveDocCheckCommand(root, root);
  assert.equal(doc.kind, "fail", "空列表声明 ⇒ fail（非 skip）");
  assert.match(doc.reason, /doc-check-command-declaration-unreadable/);
  // 三态在读写面都可分：absent ⇒ skip、invalid ⇒ fail。
  const bare = makeRoot("tp-bare");
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  assert.equal(resolveScopedGateCommand("gap-x", bare, bare).kind, "skip", "未声明 ⇒ skip（与 invalid 可分）");
});

// AC4 — runMechanicalFanIn 锁内 merge-develop 之后、scoped-gate 之前接入缓存判定（命中跳过，未命中照跑）。
const SCRIPTS_DIR = path.dirname(DRIVER);
const FF_MERGE_MODULE = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const SLOT_LIB = path.join(SCRIPTS_DIR, "suite-slot-lib.sh");
const SCG_TASK = "gap-scg-cache";

function scgTaskBody() {
  return [
    "---",
    `id: ${SCG_TASK}`,
    "title: scoped-gate cache test",
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
    `- tasks/${SCG_TASK}.md`,
    "## Acceptance Criteria",
    "- [x] AC1 landed",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n");
}

/** hermetic 仓库 + task worktree（同 fan-in-driver-mechanical-orchestration.test.mjs 的 makeRepoWithWorktree）：
 *  develop 上有 task 文件（Touches + AC 全勾），worktree 分支 task/<id> 上一个 docs-only 实现提交。 */
function makeScopedCacheRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wd-scg-"));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "scg-test"]);
  runGit(repo, ["config", "user.email", "scg@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", `${SCG_TASK}.md`), scgTaskBody(), "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "base"]);
  runGit(repo, ["worktree", "add", worktree, "-b", `task/${SCG_TASK}`]);
  // develop 脱离主检出 ⇒ ff 退化为纯 ref 更新（git push . HEAD:develop）。
  runGit(repo, ["checkout", "-q", "-b", "develop-work"]);
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "feature.md"), "# feature\n", "utf8");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "implement feature"]);
  return { base, repo, worktree };
}

function scgFanInArgs({ repo, worktree, base, runId, scopedGateCommand }) {
  return {
    task: SCG_TASK, worktree, root: repo, runId, mergeTarget: "develop", forceSuite: true,
    scriptsDir: SCRIPTS_DIR, ffMergeModule: FF_MERGE_MODULE,
    slotBase: path.join(base, "full-suite.lock"), slotLib: SLOT_LIB,
    silenceMs: 5000, suiteCapture: path.join(base, "suite.env"),
    suiteLogFile: path.join(base, "suite.log"),
    suiteCommand: ["bash", "-c", "exit 0"],
    scopedGateCommand,
    docCheckCommand: ["true"],
  };
}

function readScopedGateTraceLine(repo, runId) {
  const fanInLog = path.join(repo, ".quay", `fan-in-${SCG_TASK}-${runId}.log`);
  const lines = fs.readFileSync(fanInLog, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  return lines.find((e) => e.step === "scoped-gate") ?? null;
}

test("AC4 (gap-worker-premerge-scoped-gate-cache) — 缓存命中 ⇒ 跳过 scoped-gate（marker 未写 + reason=cache-hit + wall_ms<5000）", async (t) => {
  const { base, repo, worktree } = makeScopedCacheRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const developSha = runGit(repo, ["rev-parse", "develop"]).trim();
  writeScopedGateCache(path.join(repo, ".quay", "scoped-gate-cache.json"), scopedGateKey(SCG_TASK, developSha));
  const marker = path.join(base, "scoped-ran");
  const r = await runMechanicalFanIn(scgFanInArgs({
    repo, worktree, base, runId: "scg-hit-1",
    scopedGateCommand: ["bash", "-c", `touch ${marker}; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `cache-hit fan-in must land, got ${r.outcome} step=${r.step} reason=${r.reason}`);
  assert.equal(fs.existsSync(marker), false, "cache-hit must SKIP the scoped gate (marker never written)");
  const line = readScopedGateTraceLine(repo, "scg-hit-1");
  assert.ok(line, "scoped-gate trace line present");
  assert.match(line.reason ?? "", /cache-hit/, "hit trace reason contains cache-hit");
  assert.ok(line.wall_ms < 5000, `hit wall_ms < 5000 (got ${line.wall_ms})`);
});

test("AC4 (gap-worker-premerge-scoped-gate-cache) — 缓存未命中 ⇒ 照跑 scoped-gate（marker 写入 + trace 无 reason，回归）", async (t) => {
  const { base, repo, worktree } = makeScopedCacheRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const marker = path.join(base, "scoped-ran");
  const r = await runMechanicalFanIn(scgFanInArgs({
    repo, worktree, base, runId: "scg-miss-1",
    scopedGateCommand: ["bash", "-c", `touch ${marker}; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `cache-miss fan-in must land, got ${r.outcome} step=${r.step} reason=${r.reason}`);
  assert.equal(fs.existsSync(marker), true, "miss must RUN the scoped gate (marker written)");
  const line = readScopedGateTraceLine(repo, "scg-miss-1");
  assert.ok(line, "scoped-gate trace line present");
  assert.equal(line.reason, undefined, "miss trace has NO reason (byte-identical to today's step() trace)");
});

// ── gap-driver-fanin-hardcoded-test-sh-third-party — 第三方项目（无 scripts/test.sh）fan-in 全链路 ───
// doc-check / scoped-gate / suite 三步都退化为「跳过 / 委托 loop.test_command」，⛔ 不再调用本仓库专属
// 脚本（scripts/test.sh、full-suite-runner.ts）。

/** 第三方项目 hermetic 仓库 + worktree：无 scripts/test.sh，有 loop.test_command（写 marker 验证
 *  「scoped-gate / suite 实际执行 test_command」）。 */
function makeThirdPartyRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wd-tp-"));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  const marker = path.join(base, "test-command-ran");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "tp-test"]);
  runGit(repo, ["config", "user.email", "tp@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", `${SCG_TASK}.md`), scgTaskBody(), "utf8");
  fs.mkdirSync(path.join(repo, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".quay", "config.yml"),
    `loop:\n  test_command: ${JSON.stringify(`echo ran >> ${marker}`)}\n`, "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "base"]);
  runGit(repo, ["worktree", "add", worktree, "-b", `task/${SCG_TASK}`]);
  runGit(repo, ["checkout", "-q", "-b", "develop-work"]);
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "docs", "feature.md"), "# feature\n", "utf8");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "implement feature"]);
  return { base, repo, worktree, marker };
}

function readFanInTraceLine(repo, runId, step) {
  const fanInLog = path.join(repo, ".quay", `fan-in-${SCG_TASK}-${runId}.log`);
  const lines = fs.readFileSync(fanInLog, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  return lines.find((e) => e.step === step) ?? null;
}

test("AC-316 / AC2 (gap-driver-fanin-hardcoded-test-sh-third-party) — 第三方 fan-in 全链路：doc-check 与 scoped-gate 都「未提供」（可区分取值）、suite 执行 test_command、landed", async (t) => {
  const { base, repo, worktree, marker } = makeThirdPartyRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const r = await runMechanicalFanIn({
    task: SCG_TASK, worktree, root: repo, runId: "tp-fanin-1", mergeTarget: "develop", forceSuite: true,
    scriptsDir: SCRIPTS_DIR, ffMergeModule: FF_MERGE_MODULE,
    slotBase: path.join(base, "full-suite.lock"), slotLib: SLOT_LIB,
    silenceMs: 5000, suiteCapture: path.join(base, "suite.env"),
    suiteLogFile: path.join(base, "suite.log"),
    // ⛔ 不传 scopedGateCommand / docCheckCommand / suiteCommand ⇒ 走缺省（第三方退化路径）。
  });
  assert.equal(r.outcome, "landed", `third-party fan-in must land, got ${r.outcome} step=${r.step} reason=${r.reason}`);

  const docLine = readFanInTraceLine(repo, "tp-fanin-1", "doc-check");
  assert.ok(docLine, "doc-check trace line present");
  assert.equal(docLine.ok, true, "doc-check skipped ⇒ ok:true");
  assert.equal(docLine.reason ?? "", "no-doc-check-command-declared", "doc-check 未声明 ⇒ 可区分取值（⛔ 与「doc 检查跑了且失败」同形）");

  // gap-repo-shape-inferred-from-test-sh-existence：未声明 scoped_command ⇒ 该项目没有 scoped 能力 ⇒
  // 该步 skip（可区分取值），⛔ 不再拿全量 test_command 冒充 scoped 门（那正是本缺陷：把「没有这个能力」
  // 与「跑过了」变成不可分）。
  const scopedLine = readFanInTraceLine(repo, "tp-fanin-1", "scoped-gate");
  assert.ok(scopedLine, "scoped-gate trace line present");
  assert.equal(scopedLine.ok, true, "scoped-gate skipped ⇒ ok:true");
  assert.equal(scopedLine.reason ?? "", "no-scoped-command-declared", "scoped-gate 未声明 ⇒ 可区分取值");

  // 只有 suite 执行一次 test_command（scoped-gate 已 skip）⇒ marker 被追加一行。
  const ran = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").split("\n").filter((l) => l.trim()).length : 0;
  assert.equal(ran, 1, `scoped-gate 跳过 + suite 执行一次 test_command ⇒ marker 1 行（got ${ran}）`);
});

// ── gap-scoped-gate-thin-selection-not-same-shape-as-green — scoped 门取值三态 ──────────────────────
// 缺陷：scoped 命令【取零个测试文件】时 exit 0（claudecodeui `scripts/test.sh:114`
// `no scoped test files for <id> (thin)` + exit 0），fan-in 把这一跑记成与「真评了 ≥1 个文件且全绿」
// 【同形】的 ok:true —— 硬规则 3b 的假绿。修法 = 输出契约：没有可评对象时打一行 `SCOPED-THIN
// selected=<n>`，fan-in 据此记 `not-evaluated`（⛔ 不记 green，也⛔ 不当失败：全量 suite 照跑）。
// 三态（not-evaluated / green / red）必须在【同一用例文件内】两两不同形。

/** 第三方夹具的 scoped 命令：真文件、真 spawn、真跑 node --test。$1 = 这一跑是 thin / green / red。
 *  thin  ⇒ 打契约标记 + exit 0（= 缺陷现场，修复前 fan-in 记 ok:true）
 *  green ⇒ 真执行 1 个测试文件，全绿（stdout 落 <base>/scoped-fixture/green.out 作「真跑了」的可核证据）
 *  red   ⇒ 真执行 1 个会失败的测试文件（exit 非零）
 *  ⛔ 不铺 scripts/test.sh：本用例走【第三方】scoped 路径（本仓库形态的那条由既有 AC2 用例覆盖）。 */
function writeThirdPartyScopedGate(base) {
  const fixture = path.join(base, "scoped-fixture");
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "one.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("one", () => assert.equal(1, 1));\n', "utf8");
  fs.writeFileSync(path.join(fixture, "failing.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("failing", () => assert.equal(1, 2));\n', "utf8");
  const script = path.join(base, "scoped-gate.sh");
  fs.writeFileSync(script, [
    "#!/usr/bin/env bash",
    "# third-party scoped-gate fixture (gap-scoped-gate-thin-selection-not-same-shape-as-green)",
    'mode="${1:-thin}"',
    'fixture="${2:?fixture dir}"',
    'case "${mode}" in',
    '  thin)  echo "SCOPED-THIN selected=0"; exit 0 ;;',
    // `env -u NODE_TEST_CONTEXT`：本夹具自己跑在本仓库的 `node --test` 里，继承的 test-context 会让
    // 嵌套的 node --test 直接「skipping running files」（测出来的是嵌套限制，不是判据）⇒ 显式摘掉。
    '  green) env -u NODE_TEST_CONTEXT node --test "${fixture}/one.test.mjs" > "${fixture}/green.out" 2>&1; exit $? ;;',
    '  red)   env -u NODE_TEST_CONTEXT node --test "${fixture}/failing.test.mjs" > "${fixture}/red.out" 2>&1; exit $? ;;',
    '  *) echo "unknown fixture mode: ${mode}" >&2; exit 2 ;;',
    "esac",
    "",
  ].join("\n"), "utf8");
  return { script, fixture };
}

/** 读【共享】步骤 trace 载体（.quay/fan-in-step-trace.jsonl，跨任务聚合读者）里本任务 + runId 的
 *  最后一条 step-end —— AC1 的「step trace 记录中可读出该取值」就落在这个载体上。 */
function readSharedStepTrace(repo, runId, step) {
  const file = path.join(repo, ".quay", "fan-in-step-trace.jsonl");
  const lines = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  const hits = lines.filter((e) => e.step === step && e.runId === runId && e.event === "step-end");
  return hits.length > 0 ? hits[hits.length - 1] : null;
}

function thirdPartyFanInArgs({ repo, worktree, base, runId, scopedGateCommand }) {
  return {
    task: SCG_TASK, worktree, root: repo, runId, mergeTarget: "develop", forceSuite: true,
    scriptsDir: SCRIPTS_DIR, ffMergeModule: FF_MERGE_MODULE,
    slotBase: path.join(base, "full-suite.lock"), slotLib: SLOT_LIB,
    silenceMs: 5000, suiteCapture: path.join(base, "suite.env"),
    suiteLogFile: path.join(base, "suite.log"),
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand,
    docCheckCommand: ["true"],
  };
}

test("AC1/AC2 (gap-scoped-gate-thin-selection-not-same-shape-as-green) — scoped 门三态：thin ⇒ not-evaluated（⛔ 非 green、⛔ 非失败）/ 真绿 ⇒ green / 真红 ⇒ red，且两两不同形", async (t) => {
  // ⚠️ 每条臂用【独立夹具】：landed 的那条臂会被 ff 落地并清掉 worktree（复用同一夹具 ⇒ 第二条臂
  // 死在 merge-develop 的「目录不存在」，测出来的是夹具复用而不是判据）。
  const arm = async (mode, runId) => {
    const { base, repo, worktree } = makeThirdPartyRepo();
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const { script, fixture } = writeThirdPartyScopedGate(base);
    const r = await runMechanicalFanIn(thirdPartyFanInArgs({
      repo, worktree, base, runId, scopedGateCommand: ["bash", script, mode, fixture],
    }));
    return { r, repo, fixture };
  };

  // ① thin（契约标记 + exit 0）⇒ not-evaluated，且【不是失败】——fan-in 照常走到 suite 并 landed。
  const thinArm = await arm("thin", "scoped-thin-1");
  assert.equal(thinArm.r.outcome, "landed", `thin 不是失败：全量 suite 照跑（got ${thinArm.r.outcome} step=${thinArm.r.step} reason=${thinArm.r.reason}）`);
  const thinShared = readSharedStepTrace(thinArm.repo, "scoped-thin-1", "scoped-gate");
  assert.ok(thinShared, "共享 step trace 有 scoped-gate 记录");
  assert.equal(thinShared.verdict, "not-evaluated", "thin ⇒ 取值 not-evaluated（⛔ 不记 green）");
  assert.match(thinShared.reason ?? "", /scoped-thin\(selected=0\)/, "取值附出处（可读出「为什么是 not-evaluated」）");
  // 两路载体一致（per-run 过程日志同取值——⛔ 不给两个读者两套说法）。
  const thinPerRun = readFanInTraceLine(thinArm.repo, "scoped-thin-1", "scoped-gate");
  assert.equal(thinPerRun.verdict, "not-evaluated", "per-run 过程日志同取值");

  // ② green（真执行 1 个测试文件、全绿）⇒ green。可核证据：node --test 的真实输出里 pass ≥1。
  const greenArm = await arm("green", "scoped-green-1");
  assert.equal(greenArm.r.outcome, "landed", `green arm must land（got ${greenArm.r.outcome} step=${greenArm.r.step} reason=${greenArm.r.reason}）`);
  const greenOut = fs.readFileSync(path.join(greenArm.fixture, "green.out"), "utf8");
  assert.match(greenOut, /(?:#|\u2139) pass 1\b/, "scoped 命令真的执行了 ≥1 个测试文件（node --test 的真实计数）");
  const greenShared = readSharedStepTrace(greenArm.repo, "scoped-green-1", "scoped-gate");
  assert.equal(greenShared.verdict, "green", "真评了且全绿 ⇒ green");
  assert.equal(greenShared.reason, undefined, "green 无 reason（与修复前逐字同形，⛔ 不给通过步加噪声）");
  assert.equal(greenShared.selected, undefined, "green 不带 selected（契约标记只在 thin 时打）");

  // ③ red（真执行、有红）⇒ red，且 fan-in 的失败步就是 scoped-gate（判词仍走既有失败摘要路径）。
  const redArm = await arm("red", "scoped-red-1");
  assert.equal(redArm.r.outcome, "red", "真红 ⇒ fan-in red");
  assert.equal(redArm.r.step, "scoped-gate", "失败步 = scoped-gate");
  assert.match(fs.readFileSync(path.join(redArm.fixture, "red.out"), "utf8"), /(?:#|\u2139) fail 1\b/, "red arm 真的跑了一个失败测试");
  const redShared = readSharedStepTrace(redArm.repo, "scoped-red-1", "scoped-gate");
  assert.equal(redShared.verdict, "red", "真评了且有红 ⇒ red");
  assert.equal(redShared.ok, false, "red 仍是控制流失败（verdict 是取值，ok 是控制流）");

  // 三态两两不同形（同一用例文件内断言，硬规则 3b）：三个取值互不相同，且 not-evaluated 不是 ok 的别名。
  const verdicts = [thinShared.verdict, greenShared.verdict, redShared.verdict];
  assert.deepEqual(verdicts, ["not-evaluated", "green", "red"], "三态取值逐字");
  assert.equal(new Set(verdicts).size, 3, `三态两两不同形（got ${JSON.stringify(verdicts)}）`);
  assert.equal(thinShared.ok, true, "thin 的 ok:true 是【控制流】字段（不失败），取值由 verdict 承载");
  assert.notDeepEqual(
    { verdict: thinShared.verdict, ok: thinShared.ok },
    { verdict: greenShared.verdict, ok: greenShared.ok },
    "「没评成」与「评了且全绿」在记录上不同形（⛔ 修复前两者都是 {ok:true}）",
  );
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

test("AC1 — worker exit 0 but not landed (status=ready / leftover worktree) ⇒ exited-not-landed + driver exits non-zero", (t) => {
  const root = makeGitRoot("notland");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  // 合并同形 driver spawn（gap-worker-driver-test-merge-driver-tests）：exit-0-not-landed 家族两断言面
  // 折叠进一次 driver——① status=ready（gap-nl，无 worktree）② status=done + 残留 worktree（gap-wt）。
  // 2 次真 spawn → 1 次，⛔ 不删断言换时间。
  writeTaskFile(root, "gap-nl", "ready"); // ready ⇒ 证伪落地（无 worktree）
  // gap-wt: status=done + 残留 worktree ⇒ 证伪落地。⛔ 任务体须带全勾 AC/DoD——gap-worker-ac-check-
  // shortcircuit 后 finishAsync 在 spawn 机械 fan-in 前查 AC；缺段（writeTaskFile 只写 Proposal）⇒ 短路
  // exited-not-landed（「AC 未全勾」），到不了残留 worktree 落地判定。全勾 ⇒ 不短路，落地判定照常证伪
  // 「leftover worktree」。⛔ 不改 writeTaskFile（共享 helper，其契约是「最小任务体 + 给定 status」）。
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tasks", "gap-wt.md"),
    "---\nid: gap-wt\nstatus: done\n---\n\n## Proposal\n\nbody\n\n## Acceptance Criteria\n\n- [x] AC1 landed\n\n## Definition of Done\n\n- [x] DoD1 landed\n",
    "utf8",
  );
  runGit(root, ["add", "tasks/gap-wt.md"]);
  runGit(root, ["commit", "-q", "-m", "task gap-wt done"]);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-wt", wtPath]);
  let code = 0;
  try {
    runDriver(root, ["--task", "gap-nl", "--task", "gap-wt", "--worker-cmd-exact", "node -e process.exit(0)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, EXITED_NOT_LANDED_EXIT, "exited-not-landed ⇒ driver exit non-zero (3), not 0");
  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "two landing-failure shapes each produce an outcome record (no silent loss)");
  const gapNl = records.find((r) => r.task === "gap-nl");
  const gapWt = records.find((r) => r.task === "gap-wt");
  assert.equal(gapNl.final_state, "exited-not-landed", "exit 0 but status≠done ⇒ exited-not-landed (⛔ not completed)");
  assert.match(gapNl.failure_reason, /status=ready/);
  assert.equal(gapWt.final_state, "exited-not-landed", "status=done but leftover worktree ⇒ exited-not-landed");
  assert.match(gapWt.failure_reason, /leftover worktree/);
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

test("AC2 (能取假) — worker abnormal death (exit 7) ⇒ failed outcome + orphan worktree cleaned; driver next round can git worktree add the same task", (t) => {
  const root = makeGitRoot("orphan");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  // 合并同形 driver spawn（gap-worker-driver-test-merge-driver-tests）：exit-7 家族两断言面折叠进一次
  // driver——① 基本失败 outcome（gap-b，done，无 worktree）② 异常死亡清理（gap-or，ready + orphan
  // worktree）。2 次真 spawn → 1 次，⛔ 不删断言换时间。
  writeTaskFile(root, "gap-b", "done"); // 基本失败面：exit 7 ⇒ failed（非零退出优先于落地）
  writeTaskFile(root, "gap-or", "ready"); // ready ⇒ not done ⇒ the worker did not land
  runGit(root, ["branch", "develop"]); // 基准分支 = develop（生产一致）；git log develop..task/<id> 判产出需要它存在
  // simulate the orphan worktree left by a prior abnormal death (same task, same branch)
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-or", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-or"), true, "precondition: orphan worktree present");

  let code = 0;
  try {
    runDriver(root, ["--task", "gap-b", "--task", "gap-or", "--worker-cmd-exact", "node -e process.exit(7)"]);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 7, "driver propagates the worker's non-zero exit");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "AC1: basic-failed + orphan-cleanup each produce an outcome record (no zero-record)");
  const gapB = records.find((r) => r.task === "gap-b");
  const gapOr = records.find((r) => r.task === "gap-or");
  assert.equal(gapB.exit_code, 7, "basic failed face: exit_code 7 rides the outcome");
  assert.equal(gapB.final_state, "failed", "basic failed face: final_state=failed");
  assert.equal(gapB.failure_reason, "worker exited with code 7", "basic failed face: failure_reason recorded");
  assert.equal(gapOr.final_state, "failed", "AC1: final_state ∉ {completed}");
  assert.equal(gapOr.worktree_cleaned, true, "AC2: orphan worktree cleaned on abnormal death");
  assert.equal(gapOr.worktree_cleanup_error, null, "cleanup reported no error");

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

// ── gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind ──
// The residual-worktree read sites (worktreePresentForTask / worktreePathsForTask + async) converge
// on the shape-aware helper. AC3 negative control (能取假): a worktree whose branch is a bare <id>
// (NO task/ prefix) must be listed — the pre-fix regex `refs/heads/task/<id>` could not see it.

test("worktreePresentForTask / worktreePathsForTask — a bare-<id> branch worktree (no task/ prefix) is detected (AC3)", (t) => {
  const root = makeGitRoot("bareid");
  const wtPath = path.join(root, "..", `wt-bare-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-bare-id", "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", "gap-bare-id", wtPath]); // ⛔ no task/ prefix

  assert.equal(worktreePresentForTask(root, "gap-bare-id"), true, "bare-<id> branch must be detected as present");
  assert.deepEqual(worktreePathsForTask(root, "gap-bare-id"), [wtPath], "bare-<id> branch worktree path must be listed");
  assert.deepEqual(worktreePathsForTask(root, "gap-other"), [], "an unrelated task has no worktree");
});

test("worktreePresentForTaskAsync / worktreePathsForTaskAsync — bare-<id> branch worktree detected (async parity)", async (t) => {
  const root = makeGitRoot("bareidasync");
  const wtPath = path.join(root, "..", `wt-bareasync-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-bare-async", "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", "gap-bare-async", wtPath]);

  assert.equal(await worktreePresentForTaskAsync(root, "gap-bare-async"), true, "async: bare-<id> branch present");
  assert.deepEqual(await worktreePathsForTaskAsync(root, "gap-bare-async"), [wtPath], "async: bare-<id> branch path listed");
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

// ── gap-superseded-task-residual-worktree-never-reclaimed：superseded 残留 worktree 回收 + 双闸 ──────
// AC1（能取假）：status=superseded、零活进程 ⇒ reclaimed:true 且真跑了 `git worktree remove --force`。
// AC2（负控制）：status=ready（exited-not-landed 残留）⇒ 跳过、不移除——保护待续做的实现。
// AC3（负控制，双闸①）：注入命中该 task 的 workerCmdlines ⇒ skippedLiveWorker:true 且不移除；同一输入
//   去掉 cmdline ⇒ 转为可回收（同一函数两次调用相反结果 ⇒ 闸真在判、非恒真）。
// AC4（能取假）：移除前调 reaper（断言调用序：reaper 先于 remove），且移除后 `git rev-parse --verify
//   task/<id>` 仍 exit 0——分支保留。
// AC5（硬规则 3b）：任务文件缺失/status 读不懂 ⇒ status="unreadable"，且该取值 !== 可回收（superseded）、
//   !== 跳过（ready），三者两两不等，且不移除。
// 双闸②（计划第 2 条）：cwd 在 worktree 内的活进程（非 zombie）⇒ skippedLiveProcess:true 且不移除。

test("AC1 (superseded-reclaim) — superseded worktree with zero live processes IS reclaimed (git worktree remove runs; branch preserved)", async (t) => {
  const root = makeGitRoot("sup-ac1");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-a", "superseded");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-a", wtPath]);
  assert.equal(worktreePresentForTask(root, "gap-sup-a"), true, "precondition: worktree present");

  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-a"],
    statusOf: () => "superseded",
    workerCmdlines: [],
    procs: [],
    reaperCmd: () => ["node", "-e", "process.exit(0)"],
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-a");
  assert.equal(res.candidateCount, 1, "one superseded candidate");
  assert.equal(entry.reclaimed, true, "AC1: superseded + zero live process IS reclaimed");
  assert.deepEqual(res.reclaimed, ["gap-sup-a"]);
  assert.equal(worktreePresentForTask(root, "gap-sup-a"), false, "git worktree remove --force actually ran");
  assert.match(runGit(root, ["branch", "--list", "task/gap-sup-a"]), /gap-sup-a/, "branch preserved (⛔ never git branch -D)");
});

test("AC2 (superseded-reclaim) — ready residue (exited-not-landed) is NOT reclaimed", async (t) => {
  const root = makeGitRoot("sup-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-b", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-b", wtPath]);

  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-b"],
    statusOf: () => "ready",
    workerCmdlines: [],
    procs: [],
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-b");
  assert.equal(entry.status, "ready");
  assert.equal(entry.reclaimed, false, "AC2: ready residue NOT removed (protect pending implementation)");
  assert.equal(res.candidateCount, 0, "ready is not a superseded candidate");
  assert.equal(worktreePresentForTask(root, "gap-sup-b"), true, "worktree survives");
});

test("AC3 (superseded-reclaim) — live worker cmdline ⇒ skippedLiveWorker; same input minus cmdline ⇒ reclaimable", async (t) => {
  const root = makeGitRoot("sup-ac3");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-c", "superseded");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-c", wtPath]);

  const withWorker = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-c"],
    statusOf: () => "superseded",
    workerCmdlines: ["node quay-task-worker --task gap-sup-c"],
    procs: [],
  });
  const skipEntry = withWorker.perTask.find((p) => p.taskId === "gap-sup-c");
  assert.equal(skipEntry.skippedLiveWorker, true, "AC3: matching worker cmdline ⇒ skippedLiveWorker (gate ①)");
  assert.equal(skipEntry.reclaimed, false);
  assert.deepEqual(withWorker.skipped, ["gap-sup-c"]);
  assert.equal(worktreePresentForTask(root, "gap-sup-c"), true, "NOT removed while worker cmdline matches");

  const withoutWorker = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-c"],
    statusOf: () => "superseded",
    workerCmdlines: [],
    procs: [],
    reaperCmd: () => ["node", "-e", "process.exit(0)"],
  });
  const reclaimEntry = withoutWorker.perTask.find((p) => p.taskId === "gap-sup-c");
  assert.equal(reclaimEntry.reclaimed, true, "AC3: same input minus cmdline ⇒ reclaimable (gate actually judges, ⛔ not constant)");
  assert.equal(worktreePresentForTask(root, "gap-sup-c"), false);
});

test("AC4 (superseded-reclaim) — reaper runs BEFORE remove (genuine order); branch preserved after remove", async (t) => {
  const root = makeGitRoot("sup-ac4");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  const orderLog = path.join(root, "reaper-order.log");
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-d", "superseded");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-d", wtPath]);

  // 假 reaper：运行时检查 worktree 是否仍存在——若 remove 先于 reaper 则路径已消失 ⇒ "after-remove"。
  const reaperCmd = (p) => ["node", "-e",
    `require('fs').writeFileSync(${JSON.stringify(orderLog)}, require('fs').existsSync(${JSON.stringify(p)}) ? 'before-remove' : 'after-remove')`];
  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-d"],
    statusOf: () => "superseded",
    workerCmdlines: [],
    procs: [],
    reaperCmd,
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-d");
  assert.equal(entry.reclaimed, true);
  assert.equal(fs.readFileSync(orderLog, "utf8"), "before-remove", "AC4: reaper ran while the worktree still existed ⇒ BEFORE remove");
  assert.equal(entry.branchPreserved, true, "AC4: git rev-parse --verify task/<id> exit 0 after remove (branch preserved)");
  assert.match(runGit(root, ["branch", "--list", "task/gap-sup-d"]), /gap-sup-d/, "branch still exists");
});

test("AC5 (superseded-reclaim) — unreadable status is a DISTINCT value and never removed", async (t) => {
  const root = makeGitRoot("sup-ac5");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-e", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-e", wtPath]);

  // 任务文件缺失 / status 读不懂 ⇒ statusOf 返回 null。
  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-e"],
    statusOf: () => null,
    workerCmdlines: [],
    procs: [],
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-e");
  assert.equal(entry.status, "unreadable", "AC5: read-not-understood ⇒ independent value \"unreadable\"");
  assert.equal(entry.reclaimed, false, "AC5: unreadable ⇒ never removed");
  // 三者两两不等（硬规则 3b）：unreadable / 可回收（superseded）/ 跳过（ready）。
  assert.notEqual(entry.status, "superseded");
  assert.notEqual(entry.status, "ready");
  assert.notEqual("superseded", "ready");
  assert.equal(worktreePresentForTask(root, "gap-sup-e"), true, "worktree survives");
});

// ── AC3, name mismatch (gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption) ─────────
// The reclaim path read the WORKTREE/BRANCH NAME as the task id and queried the real store with it. A
// truncated name (the measured 2026-09-15 shape) found nothing ⇒ `status: "unreadable"` — "queried
// with a wrong string" wearing the face of "could not read". The resolution binds the name back to the
// real task first, and a name that binds to nothing gets its OWN value instead of borrowing that face.

const RECLAIM_TRUNCATED_FULL_ID = "gap-sup-mm-as-fast-death-and-parks-task-needs-human";
const RECLAIM_TRUNCATED_NAME = "gap-sup-mm"; // the full id minus a real suffix

test("AC3 (name mismatch) — a truncated worktree name resolves to the real task; perTask is never `unreadable` (both directions)", async (t) => {
  const root = makeGitRoot("sup-mm");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  const orphanWt = path.join(root, "..", `wt-${path.basename(root)}-orphan`, "gap-nobody-knows-this-one");
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    try { runGit(root, ["worktree", "remove", "--force", orphanWt]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
    fs.rmSync(path.dirname(orphanWt), { recursive: true, force: true });
  });
  // The store holds the FULL id; the worktree (path basename AND branch) carries the TRUNCATED one.
  writeTaskFile(root, RECLAIM_TRUNCATED_FULL_ID, "ready");
  runGit(root, ["worktree", "add", "-q", "-b", `task/${RECLAIM_TRUNCATED_NAME}`, wtPath]);
  fs.mkdirSync(path.dirname(orphanWt), { recursive: true });
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-nobody-knows-this-one", orphanWt]);

  // No worktreeTasks seam and no statusOf seam: the REAL enumeration + the REAL store are under test.
  const res = await reclaimSupersededWorktrees(root, { workerCmdlines: [], procs: [] });
  const byId = new Map(res.perTask.map((p) => [p.taskId, p]));

  const resolved = byId.get(RECLAIM_TRUNCATED_FULL_ID);
  assert.ok(resolved, `the truncated worktree is enumerated under its REAL task id: ${JSON.stringify(res.perTask)}`);
  assert.equal(resolved.status, "ready", "AC3: the real task's status is read — ⛔ NOT `unreadable` (the old disguise for «queried with a name the store never had»)");
  assert.equal(byId.has(RECLAIM_TRUNCATED_NAME), false, "the truncated name is not reported as if it were a task id");
  assert.equal(resolved.worktreePath, wtPath, "AC3: the worktree PATH is found through the resolved id (reclaim can actually reach it)");

  const unmatched = byId.get("gap-nobody-knows-this-one");
  assert.ok(unmatched, "the unresolvable worktree is still ENUMERATED (⛔ never dropped — a dropped entry reads as «no such worktree»)");
  assert.equal(unmatched.status, "worktree-name-unmatched",
    "AC3: a name binding to nothing gets its OWN value — distinct from `unreadable` AND from every real status (hard rule 3b)");
  assert.notEqual(unmatched.status, "unreadable");
  assert.notEqual(unmatched.status, "superseded");
  assert.deepEqual(res.mismatchedWorktreeNames, ["gap-nobody-knows-this-one"], "AC2/AC3: the diagnostic carrier names it, independently of `candidateCount`");

  // Negative control (bidirectional): the AC5 shape still yields `unreadable` when the store really
  // cannot be read — the new value must not have swallowed the old one.
  const unreadable = await reclaimSupersededWorktrees(root, { worktreeTasks: ["gap-sup-mm"], statusOf: () => null, workerCmdlines: [], procs: [] });
  assert.equal(unreadable.perTask[0].status, "unreadable", "negative control: an unreadable STATUS is still `unreadable` (⛔ not conflated with a name mismatch)");
  assert.deepEqual(unreadable.mismatchedWorktreeNames, [], "…and it is not reported as a name mismatch");
});

test("dual-gate ② (superseded-reclaim) — live process anchored in the worktree ⇒ skippedLiveProcess (never removed)", async (t) => {
  const root = makeGitRoot("sup-ac6");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-f", "superseded");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-f", wtPath]);

  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-f"],
    statusOf: () => "superseded",
    workerCmdlines: [],
    // 非 zombie（state="S"）活进程、cwd 在该 worktree 内 ⇒ 门②跳过。
    procs: [{ pid: 4242, cwd: wtPath, cwdDeleted: false, argv0: "claude", state: "S", ppid: 1, openFiles: [] }],
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-f");
  assert.equal(entry.skippedLiveProcess, true, "gate ②: live process cwd-under-worktree ⇒ skippedLiveProcess");
  assert.equal(entry.reclaimed, false);
  assert.deepEqual(res.skipped, ["gap-sup-f"]);
  assert.equal(worktreePresentForTask(root, "gap-sup-f"), true, "worktree survives");
});

// ── gap-superseded-mid-flight-live-worker-not-stopped：superseded 活 worker 发 SIGTERM ──────────────
// AC1（能取假，直接信号）：superseded + 门①命中 ⇒ 注入的 sendSignal 以正确 pid + SIGTERM 调用；旧行为仅
//   skip（从不发信号）⇒ 该 AC 假。AC2（负控制）：needs-human + 命中 ⇒ 不发信号（skip-only 保留）。AC3（负
//   控制）：ready（非终态、不在候选集）⇒ 不发信号。AC4（硬规则 3b，字段可区分）：liveWorkerSignaled 在
//   已信号 / 未信号两场景取不同值（同一字段两次不同值 ⇒ 真在判，⛔ 恒定）。

test("AC1 (superseded-mid-flight) — live worker on a superseded task ⇒ sendSignal(pid, 'SIGTERM') is called; same round still skips disk reclaim", async (t) => {
  const root = makeGitRoot("sup-mf-ac1");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-mf-a", "superseded");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-mf-a", wtPath]);

  const calls = [];
  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-mf-a"],
    statusOf: () => "superseded",
    workerCmdlines: ["node quay-task-worker --task gap-sup-mf-a"],
    procs: [],
    pidOf: () => 4242,
    sendSignal: (pid, signal) => { calls.push({ pid, signal }); },
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-mf-a");
  assert.deepEqual(calls, [{ pid: 4242, signal: "SIGTERM" }], "AC1: sendSignal called once with the resolved pid + SIGTERM (⛔ not skip-only)");
  assert.equal(entry.skippedLiveWorker, true, "still skipped for disk reclaim this round");
  assert.equal(entry.liveWorkerSignaled, true, "AC1: liveWorkerSignaled true (signal actually sent)");
  assert.equal(worktreePresentForTask(root, "gap-sup-mf-a"), true, "NOT reclaimed in the same round (worker exit is async; next round reclaims)");
});

test("AC2 (superseded-mid-flight) — needs-human task with a live worker ⇒ sendSignal NOT called (skip-only preserved)", async (t) => {
  const root = makeGitRoot("sup-mf-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-mf-b", "needs-human");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-mf-b", wtPath]);

  const calls = [];
  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-mf-b"],
    statusOf: () => "needs-human",
    workerCmdlines: ["node quay-task-worker --task gap-sup-mf-b"],
    procs: [],
    pidOf: () => 4242,
    sendSignal: (pid, signal) => { calls.push({ pid, signal }); },
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-mf-b");
  assert.equal(entry.status, "needs-human");
  assert.deepEqual(calls, [], "AC2: sendSignal never called for needs-human (skip-only preserved)");
  assert.equal(entry.liveWorkerSignaled, false, "AC2: needs-human ⇒ liveWorkerSignaled false");
});

test("AC3 (superseded-mid-flight) — ready task (non-terminal, not in candidate set) ⇒ sendSignal NOT called", async (t) => {
  const root = makeGitRoot("sup-mf-ac3");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-mf-c", "ready");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-mf-c", wtPath]);

  const calls = [];
  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-mf-c"],
    statusOf: () => "ready",
    workerCmdlines: ["node quay-task-worker --task gap-sup-mf-c"],
    procs: [],
    pidOf: () => 4242,
    sendSignal: (pid, signal) => { calls.push({ pid, signal }); },
  });
  const entry = res.perTask.find((p) => p.taskId === "gap-sup-mf-c");
  assert.equal(entry.status, "ready");
  assert.deepEqual(calls, [], "AC3: sendSignal never called for ready (not a candidate)");
  assert.equal(entry.liveWorkerSignaled, false, "AC3: ready ⇒ liveWorkerSignaled false");
});

test("AC4 (superseded-mid-flight) — liveWorkerSignaled takes DIFFERENT values across signaled vs not-signaled scenarios (⛔ not constant)", async (t) => {
  const root = makeGitRoot("sup-mf-ac4");
  const wtD = path.join(root, "..", `wt-${path.basename(root)}-d`);
  const wtE = path.join(root, "..", `wt-${path.basename(root)}-e`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtD]); } catch { /* best-effort */ }
    try { runGit(root, ["worktree", "remove", "--force", wtE]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtD, { recursive: true, force: true });
    fs.rmSync(wtE, { recursive: true, force: true });
  });
  writeTaskFile(root, "gap-sup-mf-d", "superseded");
  writeTaskFile(root, "gap-sup-mf-e", "needs-human");
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-mf-d", wtD]);
  runGit(root, ["worktree", "add", "-q", "-b", "task/gap-sup-mf-e", wtE]);

  const res = await reclaimSupersededWorktrees(root, {
    worktreeTasks: ["gap-sup-mf-d", "gap-sup-mf-e"],
    statusOf: (id) => (id === "gap-sup-mf-d" ? "superseded" : "needs-human"),
    workerCmdlines: ["node quay-task-worker --task gap-sup-mf-d", "node quay-task-worker --task gap-sup-mf-e"],
    procs: [],
    pidOf: () => 4242,
    sendSignal: () => { /* 计数非本 AC 关注点，AC1 已验 */ },
  });
  const signaled = res.perTask.find((p) => p.taskId === "gap-sup-mf-d");
  const notSignaled = res.perTask.find((p) => p.taskId === "gap-sup-mf-e");
  assert.equal(signaled.liveWorkerSignaled, true, "superseded scenario: liveWorkerSignaled true");
  assert.equal(notSignaled.liveWorkerSignaled, false, "needs-human scenario: liveWorkerSignaled false");
  assert.notEqual(signaled.liveWorkerSignaled, notSignaled.liveWorkerSignaled, "AC4: same field takes two different values (genuinely judging, ⛔ not constant)");
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


// ── gap-worker-driver-restart-orphan-no-outcome-no-timeout：driver 重启孤儿化在飞 worker ─────────────
// 旧 driver 把 spawn 的 dispatch 元数据持久化到 .quay/worker-dispatch.json，在终态被正常计算时清除。
// driver 重启死掉 ⇒ 内存 running 整体丢失，但持久影子存活 ⇒ 新 driver 的 reconcile 读到后 adopt（纳入
// 超时监管、沿用原始 timeoutDeadlineMs）或 finalize（已死补终态 + 清 orphan worktree）。AC1（持久化写/清）
// + AC2（pid 已死 finalize）+ AC3（pid 存活 adopt 且超时不重置）逐条取假。

test("AC1 (能取假) — dispatch 持久记录：spawn 后即写、worker 正常结束即清（含 runId/workerPid/selectorReason/startedAtMs/timeoutDeadlineMs）", async (t) => {
  const root = makeGitRoot("orphan-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskId = "gap-orphan-ac1";
  writeTaskFile(root, taskId, "done"); // 落地判定 status=done ⇒ exit-0 worker 记 completed

  const child = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER,
    "--root", root, "--task", taskId, "--reason", "ac1 selector reason",
    "--worker-cmd-exact", "node -e setTimeout(()=>process.exit(0),3000)",
    "--run-id", "fm-ac1", "--timeout", "5000",
  ], { stdio: ["ignore", "ignore", "ignore"], detached: true });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } });
  const exited = new Promise((r) => child.once("exit", r));

  // Phase A: spawn 后 record 已写（worker 仍活，3s 窗口内断言）。
  await waitFor(() => readDispatchStore(dispatchStoreFile(root))[taskId] != null, 15000);
  const rec = readDispatchStore(dispatchStoreFile(root))[taskId];
  assert.ok(rec, "spawn 后持久化文件里存在该 task 的记录（⛔ 缺失 ⇒ 假）");
  for (const k of ["runId", "workerPid", "selectorReason", "startedAtMs", "timeoutDeadlineMs"]) {
    assert.ok(k in rec, `record field ${k} present`);
  }
  assert.equal(rec.taskId, taskId);
  assert.equal(rec.runId, "fm-ac1");
  assert.equal(rec.selectorReason, "ac1 selector reason");
  assert.equal(rec.timeoutDeadlineMs, rec.startedAtMs + 5000, "timeoutDeadlineMs = startedAtMs + timeoutMs（原始超时截止时刻）");
  assert.equal(rec.cmdlineFingerprint, "node -e setTimeout(()=>process.exit(0),3000)", "cmdlineFingerprint = spawn 归一化 cmdline");

  // Phase B: worker 正常结束 ⇒ 记录被清 + completed 终态。
  await exited;
  await waitFor(() => readDispatchStore(dispatchStoreFile(root))[taskId] == null, 15000);
  assert.equal(readDispatchStore(dispatchStoreFile(root))[taskId], undefined, "worker 正常结束后该记录被清除（⛔ 残留 ⇒ 假）");
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task === taskId && o.final_state === "completed"), "exit-0 + status=done ⇒ completed（对照：不是 killed/failed）");
});

test("AC2 (能取假) — reconcile 对 pid 已死的孤儿：立刻补终态（非 completed、reason 可区分）+ 清 orphan worktree", (t) => {
  const root = makeGitRoot("orphan-ac2");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-ac2`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  const taskId = "gap-orphan-ac2";
  writeTaskFile(root, taskId, "ready");
  runGit(root, ["branch", "develop"]); // taskBranchHasCommits 的 git log develop..task/<id> 判产出需 develop 存在
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);
  assert.equal(worktreePresentForTask(root, taskId), true, "precondition: orphan worktree present");

  const record = {
    taskId, runId: "fm-ac2", workerPid: 999999999, selectorReason: "ac2 selector reason",
    startedAtMs: Date.now() - 60000, timeoutDeadlineMs: Date.now() - 1000,
    cmdlineFingerprint: "claude -n quay-task-worker -p '... Task: gap-orphan-ac2 ...'",
  };
  upsertDispatchRecord(dispatchStoreFile(root), record);
  assert.equal(classifyOrphanDispatch(record), "finalize", "pid 已死（/proc 读不到）⇒ finalize");

  const { outcome, cleanup } = finalizeOrphanDispatch({ root, outcomeFile: path.join(root, WORKER_OUTCOME_REL), record });

  assert.notEqual(outcome.final_state, "completed", "final_state ≠ completed");
  assert.equal(outcome.final_state, "failed");
  assert.match(outcome.failure_reason, /orphaned worker finalized by reconcile/, "reason 点名「driver 重启期间孤儿化、reconcile 发现已退出」");
  assert.doesNotMatch(outcome.failure_reason, /exited with code|killed by/, "⛔ 与存活 driver 亲眼观察到的异常死亡（exited with code N / killed by SIGx）不同形");
  assert.equal(outcome.exit_code, null, "exit code 不可观测 ⇒ 诚实 null");

  const outcomes = readOutcomeLines(root);
  assert.equal(outcomes.filter((o) => o.task === taskId).length, 1, "worker-outcome.jsonl 新增一条该 task 的记录");
  assert.equal(readDispatchStore(dispatchStoreFile(root))[taskId], undefined, "finalize 后 dispatch 记录被清");
  assert.equal(cleanup.removed, true, "orphan worktree cleaned（复用 no-record-on-abnormal-death 归宿）");
  assert.equal(worktreePresentForTask(root, taskId), false, "orphan worktree removed");
});

test("AC3 (能取假) — reconcile 对 pid 存活的孤儿（原始截止已过期）：SIGTERM 且终态 timed-out（⛔ 靠 adopt 重置新窗口）", async (t) => {
  const root = makeRoot("orphan-ac3");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskId = "gap-orphan-ac3";

  // 一个「仍在跑」的孤儿 worker（存活、cmdline 含 quay-task-worker + task id——hasLiveWorkerForTask 命中）。
  const orphan = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  t.after(() => { try { orphan.kill("SIGKILL"); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 100)); // 让 /proc/<pid>/cmdline 可读

  const record = {
    taskId, runId: "fm-ac3", workerPid: orphan.pid, selectorReason: "ac3 selector reason",
    startedAtMs: Date.now() - 60000, timeoutDeadlineMs: Date.now() - 500, // 已过期（adopt 发生前）
    cmdlineFingerprint: readPidCmdline(orphan.pid) ?? "",
  };
  assert.equal(classifyOrphanDispatch(record), "adopt", "pid 存活且 cmdline 吻合 ⇒ adopt");

  const exitedSignal = new Promise((r) => orphan.once("exit", (code, signal) => r(signal)));
  const r = await adoptOrphanWorker({ taskId, rootDir: root, outcomeFile: path.join(root, WORKER_OUTCOME_REL), record, inFlightCount: 1 });

  assert.equal(r.outcome.final_state, "timed-out", "已过期的原始截止时刻 ⇒ timed-out（⛔ 不是靠 adopt 重置新窗口）");
  assert.equal(r.outcome.timed_out, true);
  assert.equal(r.outcome.worker_pid, orphan.pid);
  assert.equal(await exitedSignal, "SIGTERM", "孤儿 pid 被 SIGTERM（⛔ 自然退出 / SIGKILL）");

  assert.equal(readDispatchStore(dispatchStoreFile(root))[taskId], undefined, "adopt 终态后 dispatch 记录被清");
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task === taskId && o.final_state === "timed-out"), "worker-outcome.jsonl 新增 timed-out 记录");
});

// ── gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task ─────────────────
// 缺陷：computeOrphanFinalizedOutcome「无条件」写 `worker pid N already exited` —— 那是断言不是测量
// （硬规则 4）。实测代价（quay-fleet 2026-09-13）：仍在飞的 pid 3653433 被写成 already exited，同任务
// 随即被派第二个 worker，两个 worker 共用一份 git 检出。修法 = 先实测 /proc，三取值互不同形。
// ⚠️ 这两条断言的是【同一函数的双向对照】：两个输入除存活外逐字相同，输出必须不同。

test("AC1 (双向对照) — computeOrphanFinalizedOutcome 实测 /proc：存活 pid ⇒ 不含 already exited；确已退出 ⇒ 含且取值可区分", async (t) => {
  const root = makeRoot("orphan-liveness-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskId = "gap-orphan-liveness-ac1";
  const base = { task: taskId, selectorReason: "ac1 selector reason", runId: "fm-ac1", startedAtMs: Date.now() - 1000 };

  // ARM 1 — 当前【存活】的 pid（且它确实是本任务的 worker：cmdline 含 worker 名 + task id）。
  const alive = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  t.after(() => { try { alive.kill("SIGKILL"); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 100)); // 让 /proc/<pid>/cmdline 可读
  assert.equal(probePidLiveness(alive.pid), "alive", "precondition: the witness is measurable as alive via /proc");

  const liveOutcome = computeOrphanFinalizedOutcome({ ...base, workerPid: alive.pid, endedAtMs: Date.now() });
  assert.equal(liveOutcome.orphan_pid_liveness, "alive", "AC1 arm1: the /proc measurement records 'alive'");
  assert.doesNotMatch(liveOutcome.failure_reason, /already exited/,
    "AC1 arm1 承重：a LIVE pid must NOT be reported as 'already exited'（这正是本缺陷）");

  // ARM 2 — 一个【确已退出】的 pid。⛔ 不是编一个大数：真 spawn、真等它退出、真等 /proc 条目消失
  //   （「确已退出」本身也要是测量出来的，否则这条对照的右臂同样是断言）。
  const dead = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise((r) => dead.once("exit", r));
  await waitFor(() => probePidLiveness(dead.pid) !== "alive", 15000);
  const deadPid = dead.pid;
  assert.equal(probePidLiveness(deadPid), "exited", "precondition: the exited witness is measurably absent from /proc");

  const deadOutcome = computeOrphanFinalizedOutcome({ ...base, workerPid: deadPid, endedAtMs: Date.now() });
  assert.equal(deadOutcome.orphan_pid_liveness, "exited", "AC1 arm2: the /proc measurement records 'exited'");
  assert.match(deadOutcome.failure_reason, /already exited/,
    "AC1 arm2: a MEASURED-exited pid keeps the original wording (既有下游按它判读，⛔ 不改)");

  // 双向：两个输入（只差存活）必须给出【不同】输出。
  assert.notEqual(liveOutcome.failure_reason, deadOutcome.failure_reason, "AC1: 两臂输出必须不同（否则这个对照什么也没测）");
  assert.equal(liveOutcome.final_state, "failed", "both arms stay non-completed");
});

test("AC2 (三值互不同形) — /proc 读不到（空 procDir）⇒ 独立取值，既不是已退出也不是存活，且不含 already exited", async (t) => {
  const root = makeRoot("orphan-liveness-ac2");
  const emptyProc = fs.mkdtempSync(path.join(os.tmpdir(), "empty-proc-"));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(emptyProc, { recursive: true, force: true }); });
  const taskId = "gap-orphan-liveness-ac2";
  const base = { task: taskId, selectorReason: "ac2 selector reason", runId: "fm-ac2v", workerPid: 999999999, startedAtMs: Date.now() - 1000 };

  // ① 空 procDir：看不到进程表 ⇒ 没查成。⛔ 若与 "exited" 同形，就等于「读不懂 ⇒ 伪装成查过」（硬规则 3b）。
  assert.equal(probePidLiveness(999999999, emptyProc), "unknown", "an empty procDir yields 'unknown' (no process table seen)");
  const unknownOutcome = computeOrphanFinalizedOutcome({ ...base, endedAtMs: Date.now(), procDir: emptyProc });
  assert.equal(unknownOutcome.orphan_pid_liveness, "unknown", "AC2: the outcome carries the third value");
  assert.doesNotMatch(unknownOutcome.failure_reason, /already exited/, "AC2 承重：无法判定 ⇒ ⛔ 不得声称已退出");

  // ② 读不到（目录不存在）：同样是「没查成」，与 ① 同取值（都与"已退出"不同形）。
  assert.equal(probePidLiveness(999999999, "/nonexistent-proc-dir"), "unknown", "unreadable procDir ⇒ 'unknown'");

  // ③ 一个真 procfs：同一个 pid ⇒ 测到「不在」= "exited"（与 ①② 取值不同）。
  assert.equal(probePidLiveness(999999999), "exited", "a real procfs that lacks the pid ⇒ measured 'exited'");

  // 三取值两两不同形（硬规则 3）：把三条 reason 摆在一起比。
  const three = [
    computeOrphanFinalizedOutcome({ ...base, endedAtMs: Date.now(), procDir: emptyProc }).failure_reason,
    computeOrphanFinalizedOutcome({ ...base, endedAtMs: Date.now() }).failure_reason,
  ];
  assert.notEqual(three[0], three[1], "unknown 与 exited 的措辞必须不同（⛔ 不得合并成同一取值）");
  assert.ok(three.every((r) => typeof r === "string" && r.length > 0), "both reasons are non-empty strings");
});

test("AC1/AC3 (存活闸) — finalizeOrphanDispatch 对【仍是本任务活 worker】的 pid 拒绝 finalize：⛔ 不写终态、⛔ 不清 worktree、⛔ 不清记录", async (t) => {
  const root = makeGitRoot("orphan-refuse-live");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-refuse`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  const taskId = "gap-orphan-refuse-live";
  writeTaskFile(root, taskId, "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);
  assert.equal(worktreePresentForTask(root, taskId), true, "precondition: worktree present");

  // 活 worker 见证进程：cmdline 含本 workspace 的 worker 名 + task id ⇒ classifyOrphanDispatch 判 adopt。
  // root 无 .quay/profiles.yml ⇒ resolveWorkerProcessName 回落到 WORKER_PROCESS_NAME。
  const live = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  t.after(() => { try { live.kill("SIGKILL"); } catch { /* gone */ } });

  const record = {
    taskId, runId: "fm-refuse", workerPid: live.pid, selectorReason: "s",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0,
    cmdlineFingerprint: `claude -n ${WORKER_PROCESS_NAME} -p '... Task: ${taskId} ...'`,
  };
  upsertDispatchRecord(dispatchStoreFile(root), record);
  const outcomeFile = path.join(root, WORKER_OUTCOME_REL);

  const res = finalizeOrphanDispatch({ root, outcomeFile, record });
  assert.equal(res.refusedLiveWorker, true, "AC1 存活闸：仍是本任务活 worker ⇒ 拒绝 finalize");
  assert.equal(res.cleanup, null, "⛔ 不做 worktree 清理（活 worker 可能正在里面写）");
  assert.equal(fs.existsSync(outcomeFile) ? readOutcomeLines(root).length : 0, 0,
    "⛔ 不写假终态记录（这正是本缺陷产出的那条假记录）");
  assert.ok(readDispatchStore(dispatchStoreFile(root))[taskId], "⛔ 不清 dispatch 记录（下一轮还要用它 adopt）");
  assert.equal(worktreePresentForTask(root, taskId), true, "⛔ 不清 worktree");

  // 对照：worker 真的退出后，同一构造必须能 finalize（⛔ 不是永远拒绝 ⇒ 记录永久占位）。
  try { live.kill("SIGKILL"); } catch { /* gone */ }
  const r = await new Promise((resolve) => {
    const poll = () => {
      if (probePidLiveness(record.workerPid) === "alive") return setTimeout(poll, 20);
      resolve(finalizeOrphanDispatch({ root, outcomeFile, record }));
    };
    poll();
  });
  assert.equal(r.refusedLiveWorker, false, "对照：worker 退出后不再拒绝");
  assert.equal(readOutcomeLines(root).filter((o) => o.task === taskId).length, 1, "对照：worker 退出后写入恰好一条终态");
  assert.equal(readDispatchStore(dispatchStoreFile(root))[taskId], undefined, "对照：记录被清（任务不再被孤儿记录永久占位）");
});

test("AC1/AC3 (存活闸, 名字解析失败形态) — worker 名解析错（quay-fleet 形）时闸仍拦住：⛔ 不写假终态、⛔ 不删在飞 worker 的 worktree", async (t) => {
  // 这是【生产事故的逐字形态】：载体把 task-worker 命名成 quay-test-worker，而 worker 进程实际带着
  // 别的名字跑（改名 / 解析失败）⇒ classifyOrphanDispatch 认不出它 ⇒ 判 finalize。
  // ⛔ 此时若闸依赖 classifyOrphanDispatch（也要名字），它就是空的；闸必须用【名字无关】的 /proc 存在性。
  const root = makeGitRoot("orphan-refuse-namemiss");
  const wtPath = path.join(root, "..", `wt-${path.basename(root)}-namemiss`);
  t.after(() => {
    try { runGit(root, ["worktree", "remove", "--force", wtPath]); } catch { /* best-effort */ }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wtPath, { recursive: true, force: true });
  });
  writeProfileCarrier(root); // 解析出的 worker 名 = quay-test-worker
  assert.equal(resolveWorkerProcessName(root), "quay-test-worker", "precondition: 名字来自载体");
  const taskId = "gap-orphan-refuse-namemiss";
  writeTaskFile(root, taskId, "ready");
  runGit(root, ["branch", "develop"]);
  runGit(root, ["worktree", "add", "-q", "-b", `task/${taskId}`, wtPath]);

  // 活 worker，但 cmdline 带的是【另一个】名字 ⇒ 名字相关的探测认不出它（正是本缺陷的成因）。
  const live = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", WORKER_PROCESS_NAME, taskId], { stdio: "ignore" });
  t.after(() => { try { live.kill("SIGKILL"); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 100));
  const record = {
    taskId, runId: "fm-namemiss", workerPid: live.pid, selectorReason: "s",
    startedAtMs: Date.now() - 1000, timeoutDeadlineMs: 0, cmdlineFingerprint: "x",
  };
  // 前置：名字相关的分类确实认不出它 ⇒ 走的正是 finalize 分支（因此闸是唯一防线）。
  assert.equal(classifyOrphanDispatch(record, "/proc", resolveWorkerProcessName(root)), "finalize",
    "precondition: 名字解析错 ⇒ 分类判 finalize（本缺陷的入口）");

  const outcomeFile = path.join(root, WORKER_OUTCOME_REL);
  const res = finalizeOrphanDispatch({ root, outcomeFile, record });
  assert.equal(res.refusedLiveWorker, true, "AC1/AC3: 名字无关的 /proc 存活闸仍然拦住（⛔ 依赖名字的闸在这里是空的）");
  assert.equal(res.outcome.orphan_pid_liveness, "alive", "the refusal carries the measured value");
  assert.equal(fs.existsSync(outcomeFile) ? readOutcomeLines(root).length : 0, 0, "⛔ 不写假终态（本缺陷写的就是这条）");
  assert.equal(worktreePresentForTask(root, taskId), true, "⛔ 不删在飞 worker 正在写的 worktree");
});

test("AC3 (名字解析, 承重对照) — worker 名解析自 .quay/profiles.yml：同一 argv 只改角色名，存活探测给出相反取值", async (t) => {
  // 这是本缺陷在第三方项目上的【根因】：探测此前写死 `quay-task-worker`，而 quay-fleet 的 roles.
  // task-worker 名叫 `fleet-task-worker` ⇒ hasLiveWorkerForTask 对【每一个真实 worker】恒 false，
  // 于是 reconcile 把在飞 worker 判为已退出 + 冷启动排除集恒空 ⇒ 假记录 + 同任务双派。
  // 两臂只差一个名字，输出必须相反（⛔ 不是「碰巧没命中」——argv 由真实 workerArgvForTask 构造）。
  const root = makeGitRoot("worker-name-resolve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskId = "gap-worker-name-resolve";
  writeTaskFile(root, taskId, "ready");
  // 载体把 task-worker 命名为 `quay-test-worker`（⛔ 刻意不是 quay-task-worker）。
  writeProfileCarrier(root);
  const resolved = resolveWorkerProcessName(root);
  assert.equal(resolved, "quay-test-worker", "AC3: the worker name is resolved from the workspace config, not hardcoded");

  const argv = await workerArgvForTaskAsync(taskId, root, { prefix: null, exact: null });
  const cmdline = argv.join(" ");
  assert.ok(cmdline.includes("quay-test-worker"), "the real worker argv carries the CONFIGURED -n name");
  assert.ok(cmdline.includes(taskId), "the real worker argv carries the task id (prompt)");

  assert.equal(hasLiveWorkerForTask(taskId, [cmdline], resolved), true,
    "AC3 arm1: with the name resolved from config, a genuine worker argv IS recognized as live");
  assert.equal(hasLiveWorkerForTask(taskId, [cmdline], WORKER_PROCESS_NAME), false,
    "AC3 arm2 (the pre-fix behaviour): with the hardcoded literal, the SAME argv is invisible ⇒ 'already exited' + double dispatch");

  // 三处探测统一消费解析出的名字（⛔ 不是只修一处：硬规则 5b）。
  const cold = enumerateColdStartInflight(root, { worktreeTasks: [taskId], workerCmdlines: [cmdline] });
  assert.deepEqual([...cold], [taskId], "cold-start in-flight exclusion honors the resolved name (⛔ empty set ⇒ double dispatch)");
  // AC3 的另一臂（派发计数 = 1 的那一臂）：存活 worker 不在 ⇒ 排除集为空 ⇒ 该任务可派。
  // （「派发计数 = 0 / = 1」的端到端两臂由 worker-driver-fan-in 的 cold-start AC1 + 其对照承担。）
  assert.deepEqual([...enumerateColdStartInflight(root, { worktreeTasks: [taskId], workerCmdlines: [] })], [],
    "AC3 对照臂: 无存活 worker ⇒ 排除集为空 ⇒ 该任务进入可派集");
});

test("④ (记录缺失不越权) — orphanDispatchCandidates：无记录 ⇒ 不纳入（手工起的 worker 不被接管）；running 中的在飞 ⇒ 跳过", () => {
  const rec = { taskId: "gap-x", runId: "r", workerPid: 1, selectorReason: "s", startedAtMs: 0, timeoutDeadlineMs: 0, cmdlineFingerprint: "c" };
  // 记录缺失（空 store / 无该 task 记录）⇒ 无待处理项——即使该 task 有 worktree + 活 worker（手工起的），
  // reconcile 只读 dispatch store，⛔ 不越权接管非本机制派发的进程。
  assert.deepEqual(orphanDispatchCandidates({}, []), []);
  assert.deepEqual(orphanDispatchCandidates({}, ["gap-x"]), [], "记录缺失 ⇒ 不越权（有 running task 也无记录可处理）");
  // 有记录且不在 running ⇒ 待处理（adopt/finalize 的输入）。
  assert.deepEqual(orphanDispatchCandidates({ "gap-x": rec }, []), [{ taskId: "gap-x", record: rec }]);
  // 有记录但在 running（本驱动自己的在飞 dispatch）⇒ 跳过（runOneWorker 管理，⛔ 不重复 adopt/finalize）。
  assert.deepEqual(orphanDispatchCandidates({ "gap-x": rec }, ["gap-x"]), []);
});

// ── gap-fanin-gate-event-store-path-shipped-unsafe ────────────────────────────────────────────────
// appendCompleteGateEvent 与 ffMergeModule 的 packages/quay/src 布局锚点原为仓库布局硬编码，shipped
// npm 包（把 packages/quay/ 打平到包根）下 MODULE_NOT_FOUND 被 best-effort catch 静默吞 ⇒
// gate-events.jsonl 永不写。改为 resolveKernelSrcModule：源树上下文逐字不变，shipped 打平布局退 <包根>/src。
test("AC1/AC3 (源树双向不变) — resolveKernelSrcModule 源树上下文返回 packages/quay/src 布局（两锚点逐字不变）", () => {
  const gate = resolveKernelSrcModule(REPO_ROOT, "gate/gate-event-store.ts");
  assert.equal(gate, path.join(REPO_ROOT, "packages", "quay", "src", "gate", "gate-event-store.ts"),
    "源树：gate-event-store.ts 解析到 packages/quay/src（逐字不变）");
  assert.ok(fs.existsSync(gate), "源树 gate-event-store.ts 存在");

  const ff = resolveKernelSrcModule(REPO_ROOT, "fan-in/ff-merge.ts");
  assert.equal(ff, path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts"),
    "源树：ff-merge.ts 解析到 packages/quay/src（逐字不变）");
  assert.ok(fs.existsSync(ff), "源树 ff-merge.ts 存在");
});

test("AC2 (shipped 负控制) — 包根打平布局（无 packages/quay/src）：resolveKernelSrcModule 退 <包根>/src，动态 import gate-event-store.ts 成功并可写 gate-events.jsonl", async (t) => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "shipped-src-"));
  const consumer = path.join(pkg, "consumer-wt"); // 第三方项目 worktree：无 packages/quay/src
  fs.mkdirSync(path.join(pkg, "src", "gate"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "plugin"), { recursive: true });
  // 打平布局：包根 src/gate/gate-event-store.ts（⛔ 无 packages/quay/ 前缀）。
  fs.copyFileSync(
    path.join(REPO_ROOT, "packages", "quay", "src", "gate", "gate-event-store.ts"),
    path.join(pkg, "src", "gate", "gate-event-store.ts"),
  );
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = path.join(pkg, "plugin"); // resolveKernelPluginRoot()=<pkg>/plugin ⇒ dirname=<pkg>
  t.after(() => {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
    fs.rmSync(pkg, { recursive: true, force: true });
  });

  const resolved = resolveKernelSrcModule(consumer, "gate/gate-event-store.ts");
  assert.equal(resolved, path.join(pkg, "src", "gate", "gate-event-store.ts"),
    "打平布局：解析到 <包根>/src/gate/gate-event-store.ts（⛔ 无 packages/quay 前缀）");

  const ff = resolveKernelSrcModule(consumer, "fan-in/ff-merge.ts");
  assert.equal(ff, path.join(pkg, "src", "fan-in", "ff-merge.ts"),
    "打平布局：ff-merge.ts 同样退 <包根>/src");

  const { appendGateEvent } = await import(pathToFileURL(resolved).href);
  const log = path.join(consumer, ".quay", "gate-events.jsonl");
  appendGateEvent(log, { id: "e1", item_id: "gap-x", pipeline_id: "gap-x", gate: "complete", actor: "quay-driver", verdict: "pass", timestamp: new Date().toISOString(), payload: { from: "ready", to: "done" } });
  assert.ok(fs.existsSync(log), "打平布局下 appendGateEvent 成功写 gate-events.jsonl");
  const events = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");
});

// ── gap-resolve-kernel-src-module-strip-types-node-modules ──────────────────────────────────────────
// 上一条 AC2（59f42b79e）只把模块放到 <tmp>/…/src/（非 node_modules）再 import——没穿过「Node ≥23.7
// 拒剥 node_modules 下 .ts」这层 ⇒ 真 shipped 布局的 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING 漏网。
// 本条用真 bundle（worker-driver.js）放到 node_modules 下真 import：ff-merge + gate-event-store 已被
// coreSrcAliasPlugin 内联（自包含），import 成功且 appendCompleteGateEvent 真能写 complete GateEvent。
test("shipped 自包含 — bundle worker-driver.js 放 node_modules 下真 import：ff-merge + gate-event-store 内联，appendCompleteGateEvent ok:true", async (t) => {
  // 1. stage 真实 shipped 布局：plugin/scripts 整树拷到 <stage>/node_modules/quay/plugin/scripts（模块位于
  //    node_modules 下），且 <stage>/node_modules/quay/ 无 packages/quay 平级 ⇒ dev-tree
  //    ../../packages/quay/src 无法按文件系统解析 ⇒ 强制走 coreSrcAliasPlugin（证 filter 的子目录扩展）。
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wd-shipped-"));
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  const quayPkg = path.join(stage, "node_modules", "quay");
  const pluginStage = path.join(quayPkg, "plugin");
  const scriptsStage = path.join(pluginStage, "scripts");
  fs.cpSync(SCRIPTS_DIR, scriptsStage, { recursive: true, filter: (src) => !/\/dist(\/|$)/.test(src) });
  // 依赖解析：esbuild 从 entry 向上找 node_modules——给 <stage>/node_modules/quay/node_modules 建 symlink
  // 到真 node_modules（driver-shared.ts 的 zod/@modelcontextprotocol、driver-config.ts 的 yaml 才能解析）。
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(quayPkg, "node_modules"), "dir");

  // 2. bundle worker-driver.ts（同 package.sh 的 bundleEntries 路径，输出落在 scripts/dist/）。
  const outfiles = await bundleEntries(pluginStage, ["scripts/worker-driver.ts"]);
  assert.equal(outfiles.length, 1, "worker-driver.ts 必须成功 bundle");
  const bundlePath = outfiles[0];
  assert.ok(bundlePath.startsWith(scriptsStage), `bundle 应落在 node_modules 下（actual=${bundlePath}）`);
  assert.ok(bundlePath.endsWith(".js"), "bundle 是 .js（node_modules 下 .js 才可 import）");

  // 3. 真 import——这正是 59f42b79e 的 AC2 漏掉的动作：模块位于 node_modules 下，import 必须成功。
  const mod = await import(pathToFileURL(bundlePath).href);
  assert.equal(typeof mod.appendCompleteGateEvent, "function", "appendCompleteGateEvent 可导出");
  assert.equal(typeof mod.runMechanicalFanIn, "function", "runMechanicalFanIn 可导出");

  // 4. gate-event-store 内联后运行时可用：appendCompleteGateEvent 真写 complete GateEvent（非只判路径）。
  //    隔离 cwd：OLD 实现靠 repoRoot()→git rev-parse 回退找源树，测试进程 cwd 是 quay 源树会让 OLD 也
  //    「假通过」——chdir 到非 git scratch 目录 ⇒ OLD 的 repoRoot() 落到无 packages/quay/src 的 scratch
  //    ⇒ 退 shipped <包根>/src（node_modules 下 .ts）⇒ import 必挂。NEW（内联）不依赖 cwd。
  const consumer = path.join(stage, "consumer");
  fs.mkdirSync(path.join(consumer, ".quay"), { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(consumer);
  try {
    const r = await mod.appendCompleteGateEvent(consumer, "gap-x");
    assert.equal(r.ok, true, `appendCompleteGateEvent ok:true（actual reason=${r.reason}）`);
  } finally {
    process.chdir(prevCwd);
  }
  const events = fs.readFileSync(path.join(consumer, ".quay", "gate-events.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");

  // 5. 自包含判据（判别器）：OLD 实现的 runtime pathToFileURL(resolveKernelSrcModule(...)) 调用必须消失，
  //    ff-merge 符号已内联，无 dev-tree 相对路径 import 残留。
  const text = fs.readFileSync(bundlePath, "utf8");
  assert.ok(text.includes("ffMerge"), "ff-merge 内联（ffMerge 符号在 bundle 中）");
  assert.ok(!/pathToFileURL\(resolveKernelSrcModule\(/.test(text), "OLD 运行时 pathToFileURL(resolveKernelSrcModule(...)) 调用已消除");
  assert.ok(!/import\([^)]*packages\/quay\/src/.test(text), "无 runtime dev-tree packages/quay/src 动态 import");
  assert.ok(!text.includes('"../../packages/quay/src'), "无 dev-tree 相对路径 import 残留");

  // 6. shipped 全链路（AC3）：第三方 hermetic 仓库上跑【bundled】runMechanicalFanIn，⛔ 不传 ffMergeModule
  //    ⇒ ff 步走内联的 ff-merge、append-complete 走内联的 gate-event-store，与 shipped 布局同形（无任何
  //    runtime node_modules 下 .ts import）。ff 步 ok:true + flip done + gate-events 有 complete。
  const { base, repo, worktree } = makeThirdPartyRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const r = await mod.runMechanicalFanIn({
    task: SCG_TASK, worktree, root: repo, runId: "shipped-fanin-1", mergeTarget: "develop", forceSuite: true,
    scriptsDir: SCRIPTS_DIR, // gate 编排脚本用源树（非本缺陷范围）；ff-merge + gate-event-store 走内联
    slotBase: path.join(base, "full-suite.lock"), slotLib: SLOT_LIB,
    silenceMs: 5000, suiteCapture: path.join(base, "suite.env"),
    suiteLogFile: path.join(base, "suite.log"),
  });
  assert.equal(r.outcome, "landed", `shipped bundle fan-in must land, got ${r.outcome} step=${r.step} reason=${r.reason}`);
  const ffLine = readFanInTraceLine(repo, "shipped-fanin-1", "ff");
  assert.ok(ffLine, "ff trace line present");
  assert.equal(ffLine.ok, true, "ff 步 ok:true（shipped 内联 ff-merge 执行成功）");
  const gateEvents = fs.readFileSync(path.join(repo, ".quay", "gate-events.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(gateEvents.some((e) => e.gate === "complete" && e.verdict === "pass"), "gate-events.jsonl 有 complete 记录");
});

// ── landing-baseline e2e (gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing) ──
// The AC-239 failure reproduced and then FIXED through the real driver path: a third-party project
// whose own `develop` is an ancient fork of `main`, and a task that is IMPLEMENTED CORRECTLY.
// Before the fix the mechanical fan-in reports the baseline's shape as the task's drift; after
// `quay init` establishes the landing baseline, the same task LANDS.
const TP3_TASK = "gap-3p-baseline";

function tpTaskBody() {
  return [
    "---",
    `id: ${TP3_TASK}`,
    "title: third-party landing-baseline e2e",
    "status: ready",
    "labels: []",
    "extra: {}",
    "---",
    "## Proposal",
    "test",
    "## Plan",
    "test",
    "## Touches",
    "- src/feature.txt",
    `- tasks/${TP3_TASK}.md`,
    "## Acceptance Criteria",
    "- [x] AC1 landed",
    "## Definition of Done",
    "- [x] landed",
    "",
  ].join("\n");
}

/** mainline `main` + a `develop` forked 3 commits back that was never merged forward. */
function makeThirdPartyFanInRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wd-3p-"));
  const repo = path.join(base, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  runGit(repo, ["init", "-q", "-b", "main"]);
  runGit(repo, ["config", "user.name", "3p-test"]);
  runGit(repo, ["config", "user.email", "3p@example.com"]);
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(repo, `src/m${i}.txt`), `${i}\n`);
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["commit", "-q", "-m", `mainline ${i}`]);
  }
  runGit(repo, ["checkout", "-q", "-b", "develop", "main~3"]);
  fs.writeFileSync(path.join(repo, "src/legacy.txt"), "ancient\n");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "ancient develop work (2025)"]);
  runGit(repo, ["checkout", "-q", "main"]);
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", `${TP3_TASK}.md`), tpTaskBody(), "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", `task file: ${TP3_TASK}`]);
  return { base, repo, worktree: path.join(base, "wt") };
}

function tpFanInArgs({ repo, worktree, base, runId }) {
  return {
    task: TP3_TASK, worktree, root: repo, runId, mergeTarget: "develop", forceSuite: true,
    scriptsDir: SCRIPTS_DIR, ffMergeModule: FF_MERGE_MODULE,
    slotBase: path.join(base, "full-suite.lock"), slotLib: SLOT_LIB,
    silenceMs: 5000, suiteCapture: path.join(base, "suite.env"),
    suiteLogFile: path.join(base, "suite.log"),
    suiteCommand: ["bash", "-c", "exit 0"],
    scopedGateCommand: ["bash", "-c", "exit 0"],
    docCheckCommand: ["true"],
  };
}

/** Fork the task worktree from `fromRef` and implement ONE declared file — a correct task. */
function addCorrectTaskCommit(repo, worktree, fromRef) {
  runGit(repo, ["worktree", "add", worktree, "-b", `task/${TP3_TASK}`, fromRef]);
  fs.writeFileSync(path.join(worktree, "src", "feature.txt"), "feature\n");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "implement feature"]);
}

test("AC1 (取假): a FOREIGN develop makes a CORRECT task fail anti-drift — and the cause is the baseline", async (t) => {
  const { base, repo, worktree } = makeThirdPartyFanInRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  // no branch-model provisioning: fork from main, i.e. the only usable line (the AC-239 shape)
  addCorrectTaskCommit(repo, worktree, "main");

  const r = await runMechanicalFanIn(tpFanInArgs({ repo, worktree, base, runId: "3p-red-1" }));
  assert.equal(r.outcome, "red", `expected red, got landed=${r.landedSha}`);
  assert.equal(r.step, "anti-drift");
  assert.match(r.reason, /BASELINE-MISMATCH/, "the cause must be the BASELINE, not the task's Touches");
  assert.match(r.reason, /not a continuation of the project's default branch/);
  // The old reading blamed the task with an unattributable count ("1566 violation(s)"). The count
  // must be GONE, not merely accompanied.
  assert.doesNotMatch(r.reason, /violation\(s\)/, "the misleading violation count must not survive a baseline defect");
});

test("AC4 (端到端负控制): after `quay init` establishes the baseline, the SAME task LANDS", async (t) => {
  const { base, repo, worktree } = makeThirdPartyFanInRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  // the fix: quay init establishes quay's branch model in the target project
  const report = ensureBranchModel(repo, { adopt: true });
  assert.equal(report.ok, true);
  assert.equal(report.entries.find((e) => e.role === "landing-baseline").action, "adopted");
  // re-dispatch: the task now forks the NEW develop (which continues the mainline)
  addCorrectTaskCommit(repo, worktree, "develop");

  const r = await runMechanicalFanIn(tpFanInArgs({ repo, worktree, base, runId: "3p-green-1" }));
  assert.equal(r.outcome, "landed", `expected landed, got red step=${r.step} reason=${r.reason}`);
  assert.ok(r.landedSha, "landedSha recorded");
  const landed = runGit(repo, ["show", `develop:tasks/${TP3_TASK}.md`]);
  assert.match(landed, /status: done/, "the task really landed on the branch the mechanism reads");
  // and the pre-quay tip is preserved rather than destroyed
  assert.ok(runGit(repo, ["branch", "--list", "develop-pre-quay-init-*"]).trim().length > 0, "old develop preserved");
});

// ── instrument availability probe in the mechanical fan-in (gap-fan-in-instrument-availability-self-check) ──
// AC2 has THREE obligations, and the third is the one a one-sided test would miss: the probe must run
// BEFORE the suite (trace order), its reading must land in the run's result (`instruments`, carried
// into the outcome record as `mechanical_fan_in.instruments`), and — the NEGATIVE CONTROL — a probe
// that reads `evaluated:false` must NOT stop the suite. Without that control, "the suite ran" would
// also be produced by a probe that never ran at all.
//
// The fixture is deliberately registry-free in its WORKTREE (`makeScopedCacheRepo` writes a
// `scripts/test.sh`, but the classifier's registry is `runner-static-gate.ts`, which it does not
// carry), so the classifier reading for the probed root is `evaluated:false` — a real not-evaluated
// reading rather than a simulated one. `scriptsDir` is the repo's own plugin/scripts, so the reaper
// reads `evaluated:true`: the two readings differ in the same run, which is what makes "the field is
// just echoed" impossible.

/** The per-run trace log's step names, in write order. */
function readFanInTraceSteps(repo, runId) {
  const fanInLog = path.join(repo, ".quay", `fan-in-${SCG_TASK}-${runId}.log`);
  return fs.readFileSync(fanInLog, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l).step);
}

test("AC2 (gap-fan-in-instrument-availability-self-check) — the probe runs BEFORE the suite, its reading lands in the result, and evaluated=false does NOT intercept the suite", async (t) => {
  const { base, repo, worktree } = makeScopedCacheRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const suiteMarker = path.join(base, "suite-ran");
  const r = await runMechanicalFanIn({
    ...scgFanInArgs({ repo, worktree, base, runId: "instr-1", scopedGateCommand: ["true"] }),
    // The suite writes a marker: "the suite ran" must be an OBSERVED act, not an inferred one.
    suiteCommand: ["bash", "-c", `touch ${suiteMarker}; exit 0`],
  });
  assert.equal(r.outcome, "landed", `fan-in must land, got ${r.outcome} step=${r.step} reason=${r.reason}`);

  // (1) trace order — the probe is a step of its own, strictly BEFORE the suite's own steps.
  const steps = readFanInTraceSteps(repo, "instr-1");
  const iProbe = steps.indexOf("instrument-probe");
  assert.notEqual(iProbe, -1, `instrument-probe trace line present (saw ${steps.join(",")})`);
  assert.ok(iProbe < steps.indexOf("suite-start"), "the probe runs BEFORE suite-start");
  assert.ok(iProbe < steps.indexOf("ac-precheck"), "the probe runs BEFORE the suite's ac-precheck");

  // (2) the reading is in the RESULT — the same object the driver embeds as `mechanical_fan_in`.
  assert.ok(r.instruments, `the run carries an instruments reading: ${JSON.stringify(r.instruments)}`);
  assert.strictEqual(r.instruments.classifier.evaluated, false,
    `the fixture worktree carries no runner-static-gate.ts ⇒ not-evaluated: ${JSON.stringify(r.instruments.classifier)}`);
  assert.match(r.instruments.classifier.detail, /runner-static-gate\.ts/, "the reading names what it looked for");
  assert.strictEqual(r.instruments.reaper.evaluated, true,
    `the repo's own plugin/scripts carries the reaper ⇒ available: ${JSON.stringify(r.instruments.reaper)}`);
  // ⛔ The two readings differ IN THE SAME RUN — so neither is a constant the test merely echoes.
  assert.notEqual(r.instruments.classifier.evaluated, r.instruments.reaper.evaluated,
    "one instrument unavailable + one available in the same run (⛔ not a fixed value)");
  // The outcome record is JSON on disk (`mechanical_fan_in` rides verbatim inside it) — assert the
  // field survives that exact transformation rather than only existing on the in-memory object.
  const landed = JSON.parse(JSON.stringify(r));
  assert.strictEqual(landed.instruments.classifier.evaluated, false, "the reading survives the outcome record's JSON round-trip");
  assert.strictEqual(landed.instruments.reaper.evaluated, true, "…for both instruments");

  // (3) NEGATIVE CONTROL — no interception: the suite RAN despite evaluated=false.
  assert.ok(fs.existsSync(suiteMarker), "the suite still executed with the classifier UNavailable (record only, never intercept)");
});

test("AC2 (gap-fan-in-instrument-availability-self-check) — a fan-in that fails BEFORE the probe carries instruments:null (未评估, ⛔ not a fabricated reading)", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wd-instr-early-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "instr-test"]);
  runGit(repo, ["config", "user.email", "instr@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  // No task file ⇒ the anti-drift step (step 3, BEFORE the probe) fails ⇒ the run must be red with an
  // UNEVALUATED instruments reading — distinguishable from "probed, could not judge" (hard rule 3b).
  runGit(repo, ["commit", "-q", "--allow-empty", "-m", "base"]);
  runGit(repo, ["worktree", "add", worktree, "-b", `task/${SCG_TASK}`]);
  const r = await runMechanicalFanIn(scgFanInArgs({
    repo, worktree, base, runId: "instr-early-1",
    scopedGateCommand: ["true"],
  }));
  assert.equal(r.outcome, "red", `expected a pre-probe failure, got ${r.outcome}`);
  assert.notEqual(r.step, "instrument-probe", "the failure is BEFORE the probe step");
  assert.strictEqual(r.instruments, null, "⛔ the probe never ran ⇒ null (未评估), never a reading shaped like 'checked'");
});

// ── `quay driver status --kind worker` reports the instrument readings (AC3) ──────────────────────────
// The reading is a FACT, so the exit code must NOT move when it reads not-evaluated — and that claim is
// only falsifiable next to a case where the reading is the OTHER value: a probe-driven exit code would
// have to differ between the two. Hence the pair below (registry-free ⇒ evaluated=0; a workspace that
// carries the registry ⇒ evaluated=1), both required to exit 0.
test("AC3 (gap-fan-in-instrument-availability-self-check) — `quay driver status --kind worker` prints both instrument readings; a NOT-evaluated probe leaves the exit code at 0", async (t) => {
  const { base, repo } = makeThirdPartyRepo();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const QUAY_CLI = path.join(REPO_ROOT, "packages", "quay", "bin", "quay.ts");
  const runStatus = (extra = []) =>
    spawnSync("node", ["--experimental-strip-types", QUAY_CLI, "driver", "status", "--kind", "worker", "--root", repo, ...extra],
      { encoding: "utf8", cwd: path.dirname(path.dirname(QUAY_CLI)) });

  // (a) a workspace with no registry: the classifier cannot judge ⇒ evaluated=0, reaper resolves ⇒ 1.
  const a = runStatus();
  assert.equal(a.status, 0, `driver status must still exit 0 — a NOT-evaluated probe is a reading, not a failure:\n${a.stdout}${a.stderr}`);
  assert.match(a.stdout, /instruments: classifier evaluated=0/, `the classifier reading is printed:\n${a.stdout}`);
  assert.match(a.stdout, /instruments: reaper evaluated=1/, `the reaper reading is printed:\n${a.stdout}`);
  // The not-evaluated arm must say WHY (and what it looked for) — a bare 0 would send the reader hunting.
  assert.match(a.stdout, /runner-static-gate\.ts/, "the reading names the registry candidate it looked for");
  assert.ok(!/instruments: classifier evaluated=0 —\s*$/.test(a.stdout), "⛔ not-evaluated never prints without its detail");

  // (b) the SAME workspace once it carries a registry ⇒ evaluated=1, same exit code 0.
  fs.mkdirSync(path.join(repo, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "plugin", "scripts", "runner-static-gate.ts"), "# empty registry\n", "utf8");
  const b = runStatus();
  assert.equal(b.status, 0, "the available arm also exits 0");
  assert.match(b.stdout, /instruments: classifier evaluated=1/, `a reachable registry reads available:\n${b.stdout}`);
  assert.notEqual(a.stdout, b.stdout, "the reading really follows its input (⛔ not a constant string)");

  // (c) `--json` carries the SAME reading as one object (⛔ not the text lines appended to a JSON body).
  const c = runStatus(["--json"]);
  assert.equal(c.status, 0, "the JSON arm keeps the same exit code");
  const parsed = JSON.parse(c.stdout.trim());
  assert.ok(parsed.instruments, `the JSON arm carries an instruments key: ${c.stdout}`);
  assert.strictEqual(parsed.instruments.classifier.evaluated, true, "JSON classifier reading");
  assert.strictEqual(parsed.instruments.reaper.evaluated, true, "JSON reaper reading");
  assert.equal(parsed.kind, "worker", "…without disturbing the pre-existing fields");
});

// ── gap-unrelated-suite-red-exemption-unreachable：判词不得取决于无关第三方任务日志的存亡 ─────────────
// 实测缺陷（本机，同一 commit，同一任务、同一份 suite 日志，只差窗口内容）：其它任务的 suite 日志
// 还在盘上 ⇒ `unrelated-flaky-exempt`；那两条日志没了 ⇒ `own-defect-counted`（同一个不相关的红被记到
// 任务自己头上）。根因 = 复发判定**事后** `readFileSync` 其它任务的日志，而日志是易失的：任务落地时
// `runMechanicalFanIn` 第 9.5 步（`worker-fan-in.ts:1628`）调 `pruneTaskSuiteLogs` 把该任务名下全部
// `fan-in-suite-<task>~*.log` 删掉。修法 = 签名在**写记录那一刻**落进 append-only 的
// `worker-outcome.jsonl`，复发判定只读记录、⛔ 不再事后读任何日志。
//
// 夹具形态**逐字对齐生产**：第三方记录经 `withRecordedSuiteSignatures`（生产写入面调用的**同一个**
// 函数）构造 ⇒ 这里测的是生产真的会写出的记录形态，⛔ 不是手搓一个生产上不存在的输入。
const AC_UNRELATED_TEST = "plugin/test/obs-unrelated.test.mjs";
const AC_UNRELATED_SIG = "probe must be alive";

function acWriteTouchesTask(root, id, touches) {
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`),
    `---\nid: ${id}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n${touches.map((x) => `- ${x}`).join("\n")}\n`, "utf8");
}
function acWriteSuiteRedLog(root, basename, assertion) {
  const p = path.join(root, ".quay", basename);
  fs.writeFileSync(p, `__PERFILE__ duration_ms=10 ${AC_UNRELATED_TEST} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: ${assertion}\n`, "utf8");
  return p;
}
/** 造一条【其它】任务的 suite-red 记录——**经生产富化函数**，与 driver 写盘时同形。 */
function acAppendThirdParty(root, taskId, tsMs, basename) {
  const mfi = withRecordedSuiteSignatures(root, { outcome: "red", step: "suite", suiteLog: basename });
  fs.appendFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ ts: new Date(tsMs).toISOString(), task: taskId, final_state: "exited-not-landed", run_id: "r", session_id: "s", mechanical_fan_in: mfi }) + "\n", "utf8");
}
/** 造一条**不含签名字段**的旧形态记录（修法之前写下的那些）——用于证明「证据基础」两态可区分。 */
function acAppendLegacyThirdParty(root, taskId, tsMs, basename) {
  fs.appendFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ ts: new Date(tsMs).toISOString(), task: taskId, final_state: "exited-not-landed", run_id: "r", session_id: "s", mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: basename } }) + "\n", "utf8");
}
function acFixture(tag) {
  const root = makeRoot(tag);
  acWriteTouchesTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]); // 与失败测试无关
  fs.mkdirSync(path.join(root, "plugin", "test"), { recursive: true });
  fs.writeFileSync(path.join(root, AC_UNRELATED_TEST), 'import { test } from "node:test";\n', "utf8");
  acWriteSuiteRedLog(root, "fan-in-suite-gap-a.log", AC_UNRELATED_SIG);
  return root;
}
const AC_NOW = Date.parse("2026-09-23T16:00:00.000Z");
const acOwnOutcome = { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } };

test("AC1+AC3 — 同一任务、同一份 suite 日志：两次调用只差【其它任务日志的可读性】⇒ 判词必须【相同】（修前 own-defect-counted vs unrelated-flaky-exempt）", (t) => {
  const root = acFixture("unrelated-suite-red-ac13");
  t.after(() => rmSafe(root));
  const bLog = acWriteSuiteRedLog(root, "fan-in-suite-gap-b.log", AC_UNRELATED_SIG);
  const cLog = acWriteSuiteRedLog(root, "fan-in-suite-gap-c.log", AC_UNRELATED_SIG);
  acAppendThirdParty(root, "gap-b", AC_NOW - 3600_000, "fan-in-suite-gap-b.log");
  acAppendThirdParty(root, "gap-c", AC_NOW - 7200_000, "fan-in-suite-gap-c.log");

  // 窗口②：其它任务日志【可读】。
  const windowReadable = judgeRetryExemption(root, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(fs.existsSync(bLog) && fs.existsSync(cLog), true, "前置：窗口②下两条第三方日志确实在盘上");
  // 窗口①：删掉它们——这是两次调用之间**唯一**的输入差异。
  fs.rmSync(bLog, { force: true });
  fs.rmSync(cLog, { force: true });
  const windowPruned = judgeRetryExemption(root, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(fs.existsSync(bLog) || fs.existsSync(cLog), false, "前置：窗口①下两条第三方日志确实没了");

  // 判词**逐字相同**：verdict + 复发任务集 + 判词正文（⛔ 只比 verdict 会漏掉「同一 verdict 但理由不同」）。
  assert.deepEqual(windowPruned, windowReadable, "判词不再取决于无关第三方任务日志的存亡（修前这两次不同）");
  assert.equal(windowPruned.verdict, "unrelated-flaky-exempt", "无关 delta + 签名跨 ≥2 任务复发（证据在记录里）⇒ 仍豁免");
  assert.deepEqual(windowPruned.recurredTasks, ["gap-b", "gap-c"], "复发证据来自记录内留存签名，与日志在不在盘上无关");
});

test("AC4①（负控制·豁免能力不得因本修法丧失）— 第三方日志**从未在盘上**，签名只存在于记录 ⇒ 仍 unrelated-flaky-exempt", (t) => {
  const root = acFixture("unrelated-suite-red-ac4-pos");
  t.after(() => rmSafe(root));
  // 日志先写、记录后写（生产顺序：suite 跑完 → 写日志 → driver 富化签名 → 追加记录），随后日志被 prune。
  acWriteSuiteRedLog(root, "fan-in-suite-gap-b.log", AC_UNRELATED_SIG);
  acWriteSuiteRedLog(root, "fan-in-suite-gap-c.log", AC_UNRELATED_SIG);
  acAppendThirdParty(root, "gap-b", AC_NOW - 3600_000, "fan-in-suite-gap-b.log");
  acAppendThirdParty(root, "gap-c", AC_NOW - 7200_000, "fan-in-suite-gap-c.log");
  fs.rmSync(path.join(root, ".quay", "fan-in-suite-gap-b.log"), { force: true });
  fs.rmSync(path.join(root, ".quay", "fan-in-suite-gap-c.log"), { force: true });

  const j = judgeRetryExemption(root, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(j.verdict, "unrelated-flaky-exempt", "记录内留存签名足以判定复发 ⇒ 豁免能力保留（⛔ 不是靠放宽阈值换确定性）");
  assert.deepEqual(j.recurredTasks, ["gap-b", "gap-c"], "两个复发任务都被点名");
});

test("AC4②（负控制·真缺陷不得被放行）— 签名只在本任务出现（第三方命中【别的】签名）⇒ 仍 own-defect-counted", (t) => {
  const root = acFixture("unrelated-suite-red-ac4-neg");
  t.after(() => rmSafe(root));
  acWriteSuiteRedLog(root, "fan-in-suite-gap-b.log", "a completely different defect: expected 2 to equal 3");
  acAppendThirdParty(root, "gap-b", AC_NOW - 3600_000, "fan-in-suite-gap-b.log");
  fs.rmSync(path.join(root, ".quay", "fan-in-suite-gap-b.log"), { force: true });

  const j = judgeRetryExemption(root, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(j.verdict, "own-defect-counted", "第三方日志存在但签名不同 ⇒ 不复发 ⇒ 照常计数（⛔ 不因本修法放宽）");
  assert.deepEqual(j.recurredTasks, [], "没有任务复发本签名");
});

test("AC3 证据基础（硬规则 3b）— 窗口内只有【没留下签名】的旧记录 ⇒ 判词如实报「无法判定」，⛔ 不与「查过、没复发」同形", (t) => {
  const root = acFixture("unrelated-suite-red-3b");
  t.after(() => rmSafe(root));
  // 旧形态记录（字段缺失）：日志仍在盘上，但判定⛔不得回头读它——读不回才能保证确定性。
  acWriteSuiteRedLog(root, "fan-in-suite-gap-b.log", AC_UNRELATED_SIG);
  acAppendLegacyThirdParty(root, "gap-b", AC_NOW - 3600_000, "fan-in-suite-gap-b.log");

  const j = judgeRetryExemption(root, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(j.verdict, "own-defect-counted", "无法判定 ⇒ fail-closed 照常计数（动作不变）");
  assert.match(j.reason, /none carried a recorded signature \(legacy\/pre-recording\) — recurrence unevaluable, not evaluated-and-negative/,
    "读数必须可区分「没查成」与「查过没复发」");
  assert.match(j.reason, /1 other suite-red attempt\(s\) in window/, "如实报出窗口内有几条可比记录");

  // 对照：同一条记录**带上**签名（生产新形态）⇒ 判词改说「查过、没匹配」，且 verdict 仍是 own-defect-counted。
  const root2 = acFixture("unrelated-suite-red-3b-ctl");
  t.after(() => rmSafe(root2));
  acWriteSuiteRedLog(root2, "fan-in-suite-gap-b.log", "a completely different defect: expected 2 to equal 3");
  acAppendThirdParty(root2, "gap-b", AC_NOW - 3600_000, "fan-in-suite-gap-b.log");
  const j2 = judgeRetryExemption(root2, "gap-a", acOwnOutcome, { nowMs: AC_NOW });
  assert.equal(j2.verdict, "own-defect-counted", "同样照常计数");
  assert.match(j2.reason, /1 carried recorded signatures and none matched/, "两态判词可区分 ⇒ 3b 成立");
  assert.notEqual(j.reason, j2.reason, "「没查成」与「查过没复发」不得同形");
});

test("withRecordedSuiteSignatures — 三态写入（不适用 / 读不出 / 读出），⛔ 不伪造空数组", (t) => {
  const root = makeRoot("unrelated-suite-red-write");
  t.after(() => rmSafe(root));
  acWriteSuiteRedLog(root, "fan-in-suite-gap-a.log", AC_UNRELATED_SIG);

  // ① 非 suite-red（step≠suite）⇒ 不加字段（不适用，⛔ 不是「读了没有」）。
  const notSuite = withRecordedSuiteSignatures(root, { outcome: "red", step: "merge-develop" });
  assert.equal("suiteSignatures" in notSuite, false, "非 suite 步 ⇒ 不适用，不加字段");
  // ①b 无 suiteLog ⇒ 同样不适用。
  assert.equal("suiteSignatures" in withRecordedSuiteSignatures(root, { outcome: "red", step: "suite", suiteLog: null }), false);
  // ② 日志读不出 ⇒ null（如实记「没留下」）。
  assert.strictEqual(withRecordedSuiteSignatures(root, { outcome: "red", step: "suite", suiteLog: "no-such.log" }).suiteSignatures, null,
    "日志读不出 ⇒ null（⛔ 不是 []）");
  // ③ 读出 ⇒ 数组，且与从同一份日志直接抽取的结果逐字相同。
  const sigs = withRecordedSuiteSignatures(root, { outcome: "red", step: "suite", suiteLog: "fan-in-suite-gap-a.log" }).suiteSignatures;
  assert.deepEqual(sigs, assertionSignaturesFromSuiteLog(fs.readFileSync(path.join(root, ".quay", "fan-in-suite-gap-a.log"), "utf8")),
    "留存签名 = 从日志抽出的签名（同一归一化正本）");
  // ④ 返回值是新对象（⛔ 不改调用方持有的 mfi）。
  const mfi = { outcome: "red", step: "suite", suiteLog: "fan-in-suite-gap-a.log" };
  withRecordedSuiteSignatures(root, mfi);
  assert.equal("suiteSignatures" in mfi, false, "⛔ 不就地改调用方的 mfi");
  // ⑤ suiteRedAttemptsInWindow 的投影三态可区分（记录面，硬规则 3b）。
  acAppendLegacyThirdParty(root, "gap-legacy", AC_NOW - 60_000, "fan-in-suite-gap-a.log");
  acAppendThirdParty(root, "gap-recorded", AC_NOW - 120_000, "fan-in-suite-gap-a.log");
  const attempts = suiteRedAttemptsInWindow(root, RETRY_EXEMPTION_WINDOW_MS_DEFAULT, AC_NOW);
  const legacy = attempts.find((a) => a.taskId === "gap-legacy");
  const recorded = attempts.find((a) => a.taskId === "gap-recorded");
  assert.strictEqual(legacy.suiteSignaturesRecorded, false, "旧记录：没留下签名");
  assert.strictEqual(legacy.suiteSignatures, null);
  assert.strictEqual(recorded.suiteSignaturesRecorded, true, "新记录：签名已留存");
  assert.deepEqual(recorded.suiteSignatures, [AC_UNRELATED_SIG]);
});

// ── gap-goal-branch-dispatch-wiring-and-task-fan-in ──────────────────────────────────────────────
// SPEC-goal-branch-2026-10-03 §4.3/§4.6/§4.9（裁定①③⑥⑧⑰）：派发接线——`resolveTaskMergeTarget` 的
// 单一解析结果同时用于【worktree 分叉点 / fan-in 落点 / fan-in 锁文件】，并产出未标注重叠读数。
// fixtures 用真 git 仓：分支存在性是活的 git 读（§3「分支名是派生量、存在性读 git」），⛔ 不是 stored flag。

const GBR_SCRIPTS_DIR = path.join(REPO_ROOT, "plugin", "scripts");
const GBR_FF_MERGE_MODULE = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const GBR_SLOT_LIB = path.join(GBR_SCRIPTS_DIR, "suite-slot-lib.sh");
const GBR_TASK = "gap-gb-e2e";
const GBR_GOAL = "GOAL-901";
const GBR_AC = "AC-901";

/** 一个带 goals/ 的真 git 仓（可含 `goal/GOAL-901` 分支）。develop 是初始分支。 */
function makeGoalBranchRepo({ withBranch = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goalbranch-"));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const g = (...a) => {
    const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")} failed: ${r.stderr ?? ""}`);
    return (r.stdout ?? "").trim();
  };
  g("init", "-q");
  g("config", "user.email", "gb@test");
  g("config", "user.name", "gb");
  g("symbolic-ref", "HEAD", "refs/heads/develop"); // 钉默认分支，⛔ 不受宿主 init.defaultBranch 影响
  fs.mkdirSync(path.join(repo, "goals"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.writeFileSync(path.join(repo, "README.md"), "# repo\n", "utf8");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  if (withBranch) g("branch", `goal/${GBR_GOAL}`, "develop");
  return { repo, dir, g };
}

/** 写 GOAL/AC/task 三件套：AC.goal → GOAL（active ∧ branch:true），task.goal_ac → AC。 */
function writeGoalBranchRecords(repo, { goalStatus = "active", branch = true, taskTouches = "- docs/feature.md\n- tasks/" + GBR_TASK + ".md" } = {}) {
  fs.writeFileSync(
    path.join(repo, "goals", `${GBR_GOAL}-x.md`),
    `---\nid: ${GBR_GOAL}\ntitle: goal\nstatus: ${goalStatus}\nkind: goal\n${branch ? "branch: true\n" : ""}---\n\n## 背景\n\nbody\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "goals", `${GBR_AC}-x.md`),
    `---\nid: ${GBR_AC}\ntitle: ac\nstatus: active\nkind: criterion\ngoal: ${GBR_GOAL}\n---\n\nbody\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "tasks", `${GBR_TASK}.md`),
    `---\nid: ${GBR_TASK}\ntitle: t\nstatus: ready\ngoal_ac: ${GBR_AC}\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n${taskTouches}\n\n## Acceptance Criteria\n\n- [x] AC1 done\n\n## Definition of Done\n\n- [x] landed\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(repo, "README.md"), "# repo\n", "utf8");
}

test("AC1 — resolveTaskMergeTarget：无 goal_ac / draft goal / branch 不存在 ⇒ develop；全满足 ⇒ goal/<id>", (t) => {
  const { repo, dir } = makeGoalBranchRepo({ withBranch: true });
  t.after(() => rmSafe(dir));

  // ① 无 goal_ac ⇒ develop（opt-in 缺省，路径逐字不变）。
  fs.writeFileSync(path.join(repo, "tasks", "gbr-plain.md"), `---\nid: gbr-plain\nstatus: ready\n---\n\n## Proposal\n\nx\n`, "utf8");
  assert.equal(resolveTaskMergeTarget("gbr-plain", repo), "develop", "无 goal_ac ⇒ develop");

  // ② goal 为 draft ⇒ develop（⛔ 不因 branch:true 就放行）。
  writeGoalBranchRecords(repo, { goalStatus: "draft" });
  assert.equal(resolveTaskMergeTarget(GBR_TASK, repo), "develop", "draft goal ⇒ develop");
  assert.equal(resolveTaskMergeTargetDetail(GBR_TASK, repo).reason, "goal-not-active");

  // ③ active + branch:true 但分支不存在 ⇒ develop（存在性是活的 git 读）。
  writeGoalBranchRecords(repo, { goalStatus: "active", branch: true });
  const noBranch = makeGoalBranchRepo({ withBranch: false });
  fs.mkdirSync(path.join(noBranch.repo, "goals"), { recursive: true });
  writeGoalBranchRecords(noBranch.repo);
  t.after(() => rmSafe(noBranch.dir));
  assert.equal(resolveTaskMergeTarget(GBR_TASK, noBranch.repo), "develop", "branch 不存在 ⇒ develop");
  assert.equal(resolveTaskMergeTargetDetail(GBR_TASK, noBranch.repo).reason, "branch-absent");

  // ④ 全部满足 ⇒ goal/<id>。
  assert.equal(resolveTaskMergeTarget(GBR_TASK, repo), `goal/${GBR_GOAL}`, "active ∧ branch:true ∧ 分支存在 ⇒ goal/<id>");
  const detail = resolveTaskMergeTargetDetail(GBR_TASK, repo);
  assert.equal(detail.reason, "goal-branch");
  assert.equal(detail.goalId, GBR_GOAL);
});

test("AC1b — 非 branch-mode（branch:false）与未声明 branch 均 ⇒ develop", (t) => {
  const a = makeGoalBranchRepo({ withBranch: true });
  t.after(() => rmSafe(a.dir));
  writeGoalBranchRecords(a.repo, { branch: false });
  assert.equal(resolveTaskMergeTarget(GBR_TASK, a.repo), "develop", "branch:false ⇒ develop");
  assert.equal(resolveTaskMergeTargetDetail(GBR_TASK, a.repo).reason, "not-branch-mode");

  const b = makeGoalBranchRepo({ withBranch: true });
  t.after(() => rmSafe(b.dir));
  // GOAL 文件不带 branch 行（缺省 false）。
  fs.mkdirSync(path.join(b.repo, "goals"), { recursive: true });
  fs.writeFileSync(path.join(b.repo, "goals", `${GBR_GOAL}-x.md`), `---\nid: ${GBR_GOAL}\nstatus: active\nkind: goal\n---\n\nbody\n`, "utf8");
  fs.writeFileSync(path.join(b.repo, "goals", `${GBR_AC}-x.md`), `---\nid: ${GBR_AC}\nkind: criterion\ngoal: ${GBR_GOAL}\n---\n\nbody\n`, "utf8");
  fs.writeFileSync(path.join(b.repo, "tasks", `${GBR_TASK}.md`), `---\nid: ${GBR_TASK}\nstatus: ready\ngoal_ac: ${GBR_AC}\n---\n\nprose\n`, "utf8");
  assert.equal(resolveTaskMergeTarget(GBR_TASK, b.repo), "develop", "未声明 branch ⇒ develop");
});

test("AC2 — e2e：goal 分支任务的 worktree 从 goal/<id> 分叉、fan-in 落 goal/<id>、develop 看不到它、锁是 goal 锁", async (t) => {
  const { repo, dir, g } = makeGoalBranchRepo({ withBranch: true });
  t.after(() => rmSafe(dir));
  writeGoalBranchRecords(repo);
  g("add", "-A");
  g("commit", "-q", "-m", "task + goals");
  // goal 分支带上任务记录（从 base 分叉，任务文件在 base 之后的这条提交里 ⇒ 让 goal 分支包含它）。
  g("branch", "-f", `goal/${GBR_GOAL}`, "develop");

  const wt = path.join(dir, "wt");
  g("worktree", "add", "-q", "-b", `task/${GBR_TASK}`, wt, `goal/${GBR_GOAL}`);
  // develop 脱离主检出（ff 退化为纯 ref 更新）。
  g("checkout", "-q", "-b", "develop-work");

  // 派发 prompt 把 base 指名给 worker（§4.3 的 fork 点接线）。
  const prompt = buildWorkerPrompt(GBR_TASK, repo);
  assert.match(prompt, /goal\/GOAL-901/, "创建 prompt 必须指名 goal base");
  assert.match(prompt, /--base goal\/GOAL-901/, "provisioning 签名必须把 goal base 传给 fork-point 自检");

  // 实现提交（doc 面）。
  fs.mkdirSync(path.join(wt, "docs"), { recursive: true });
  fs.writeFileSync(path.join(wt, "docs", "feature.md"), "# feature\n", "utf8");
  const wg = (...a) => {
    const r = spawnSync("git", ["-C", wt, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, `git(wt) ${a.join(" ")}: ${r.stderr ?? ""}`);
  };
  wg("add", "-A");
  wg("commit", "-q", "-m", "implement feature");

  // 解析出的落点 = goal 分支（同一函数三处共用）。
  const mergeTarget = resolveTaskMergeTarget(GBR_TASK, repo);
  assert.equal(mergeTarget, `goal/${GBR_GOAL}`);
  assert.equal(fanInLockFileForMergeTarget(repo, mergeTarget), path.join(repo, ".git", `fan-in.goal-${GBR_GOAL}.lock`));

  const slotBase = path.join(dir, "full-suite.lock");
  const capture = path.join(dir, "suite.env");
  const suiteLog = path.join(dir, "suite.log");
  const runId = "gb-e2e-1";
  const r = await runMechanicalFanIn({
    task: GBR_TASK,
    worktree: wt,
    root: repo,
    runId,
    mergeTarget,
    forceSuite: true,
    scriptsDir: GBR_SCRIPTS_DIR,
    ffMergeModule: GBR_FF_MERGE_MODULE,
    slotBase,
    slotLib: GBR_SLOT_LIB,
    silenceMs: 5000,
    suiteCapture: capture,
    suiteLogFile: suiteLog,
    suiteCommand: ["bash", "-c", "echo suite-running; exit 0"],
    scopedGateCommand: ["true"],
    docCheckCommand: ["true"],
  });
  assert.equal(r.outcome, "landed", `fan-in must land on the goal branch: ${JSON.stringify(r)}`);

  // 落点：goal/<id> 上有实现 + done；develop 上看不到该实现。
  const goalHasImpl = spawnSync("git", ["-C", repo, "cat-file", "-e", `goal/${GBR_GOAL}:docs/feature.md`], { encoding: "utf8" });
  assert.equal(goalHasImpl.status, 0, "goal/<id> 上有该任务的实现");
  assert.match(g("show", `goal/${GBR_GOAL}:tasks/${GBR_TASK}.md`), /^status: done$/m, "done 落在 goal 分支");
  const developHasImpl = spawnSync("git", ["-C", repo, "cat-file", "-e", "develop:docs/feature.md"], { encoding: "utf8" });
  assert.notEqual(developHasImpl.status, 0, "develop 上看不到该任务的实现（隔离）");
  const isAncestor = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", `goal/${GBR_GOAL}`, "develop"], { encoding: "utf8" });
  assert.notEqual(isAncestor.status, 0, "goal 分支尚未并入 develop");

  // develop 的 first-parent 链上没有【机械 fan-in 翻 done】提交（任务分支的落地提交没进 develop）。
  const firstParent = g("log", "--first-parent", "--format=%s", "develop");
  assert.doesNotMatch(firstParent, /driver 机械 fan-in/, "develop first-parent 链上不得有该任务的机械翻 done 提交");

  // 锁域：用的正是 goal 锁。
  const lock = readFanInLockHold(repo, GBR_TASK, runId);
  assert.equal(lock.lock, `fan-in.goal-${GBR_GOAL}.lock`, "fan-in 必须持 goal 分支自己的锁");
});

test("AC3 — 未标注读数：无 goal_ac 且 Touches 与 branch-mode goal 在飞任务重叠 ⇒ goal-branch-untagged-overlap", (t) => {
  const { repo, dir } = makeGoalBranchRepo({ withBranch: true });
  t.after(() => rmSafe(dir));
  writeGoalBranchRecords(repo, { taskTouches: "- plugin/scripts/shared.ts\n- tasks/" + GBR_TASK + ".md" });
  // 一条【已标注】的任务（落 goal 分支）——在飞对端。
  const peer = "gap-gb-peer";
  fs.writeFileSync(
    path.join(repo, "tasks", `${peer}.md`),
    `---\nid: ${peer}\nstatus: ready\ngoal_ac: ${GBR_AC}\n---\n\n## Proposal\n\nx\n\n## Touches\n\n- plugin/scripts/shared.ts\n`,
    "utf8",
  );
  assert.equal(resolveTaskMergeTarget(peer, repo), `goal/${GBR_GOAL}`, "fixture premise：对端确实落 goal 分支");

  // ① 重叠 ⇒ 有读数，token 可 grep。
  const untagged = "gap-gb-untagged";
  fs.writeFileSync(
    path.join(repo, "tasks", `${untagged}.md`),
    `---\nid: ${untagged}\nstatus: ready\n---\n\n## Proposal\n\nx\n\n## Touches\n\n- plugin/scripts/shared.ts\n`,
    "utf8",
  );
  const hits = findGoalBranchUntaggedOverlap(repo, untagged, [untagged, peer]);
  assert.equal(hits.length, 1, "重叠 ⇒ 一条读数");
  assert.equal(hits[0].kind, "goal-branch-untagged-overlap");
  assert.equal(hits[0].goal, GBR_GOAL);
  assert.deepEqual(hits[0].overlap, ["plugin/scripts/shared.ts"]);
  assert.match(JSON.stringify(hits), /goal-branch-untagged-overlap/, "记录含可 grep token");

  // ② 不重叠 ⇒ 不含（记录为空，⛔ 不是「没查」）。
  const disjoint = "gap-gb-disjoint";
  fs.writeFileSync(
    path.join(repo, "tasks", `${disjoint}.md`),
    `---\nid: ${disjoint}\nstatus: ready\n---\n\n## Proposal\n\nx\n\n## Touches\n\n- plugin/scripts/other.ts\n`,
    "utf8",
  );
  assert.deepEqual(findGoalBranchUntaggedOverlap(repo, disjoint, [disjoint, peer]), [], "不重叠 ⇒ 无读数");

  // ③ 已标注的任务不进入本读数域（它有 goal_ac）。
  assert.deepEqual(findGoalBranchUntaggedOverlap(repo, peer, [peer, untagged]), [], "已标注任务不产生未标注读数");

  // ④ 纯核：对端不落 goal 分支 ⇒ 不在域内。
  assert.deepEqual(
    untaggedGoalBranchOverlaps({
      task: "t",
      taskTouches: ["a.ts"],
      peers: [{ id: "p", mergeTarget: "develop", touches: ["a.ts"] }],
    }),
    [],
    "对端落 develop ⇒ 无读数",
  );
});

// ── SPEC-goal-branch-2026-10-03 §4.7 — goal→develop 最终 fan-in 执行侧（裁定⑭⑲⑳）──────────────────
//
// 端到端（临时仓库 + 注入可控 suite 结果）：人在终端 `quay goal merge` 只记录请求；worker-driver 每轮
// 从 ledger 重派生「待执行」并执行 --no-ff 合并 + 验证 + ff + 删分支。⛔ 这些用例断言的是【git ref
// 的实际走向】（合并提交在 develop first-parent 上、develop 被 ff 到它、goal 分支消失）与【失败时 ref
// 不动 + 落 goal-merge-result 事件】——不是返回值自述，因为落地与否的直接量就是 git 本身。
const FF_MERGE_MODULE_ABS = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");
const GM_GOAL = "GOAL-901";
const GM_AC = "AC-901";
const GM_TASK = "TT-901";

/**
 * @param {string} tag
 * @param {{ quayConfig?: string, trackQuayConfig?: boolean }} [opts]
 *   `quayConfig` — when given, `.quay/config.yml` is written into the main checkout BEFORE the base
 *   commit. `trackQuayConfig` — when true, `.quay/` is NOT gitignored and config.yml is COMMITTED at
 *   base (quay's own repo shape: part of `.quay/` tracked); default false = the cantus shape
 *   (`.quay/` gitignored, config.yml present only in the main checkout).
 */
function makeGoalMergeRepo(tag, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `goal-merge-e2e-${tag}-`));
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@example.com"); g("config", "user.name", "T");
  g("branch", "-M", "develop");
  if (!opts.trackQuayConfig) fs.writeFileSync(path.join(root, ".gitignore"), ".quay/\n");
  if (opts.quayConfig !== undefined) {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    // function form: the main-checkout path is knowable only inside this builder (marker files).
    const cfg = typeof opts.quayConfig === "function" ? opts.quayConfig(root) : opts.quayConfig;
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), cfg);
  }
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  // activatedAt 回拨 5 分钟：AC-322/325/327 的判据改写（2026-10-03）后 live_goals() 要求 branch-mode
  // goal 的前置里含 `activatedAt:`，并用它做时间下界（`[ "$ct" -ge "$a" ]`）。夹具必须显式造出这一形态
  // （⛔ 不是放宽判据），且它要早于下面的翻转提交与 goal→develop 合并提交。
  const activatedAt = new Date(Date.now() - 300_000).toISOString();
  fs.writeFileSync(path.join(root, "goals", `${GM_GOAL}-a-goal.md`),
    `---\nid: ${GM_GOAL}\ntitle: a goal\nstatus: active\nkind: directive\nactivatedAt: ${activatedAt}\nbranch: true\n---\n\nbody long enough for the fixture to parse as a goal record yes indeed\n`);
  // AC-327 改写后新增要求：该 goal 的 merge 必须至少有一条【可归因的 via 落地】，否则 exit 3
  // （"zero would be vacuous"）。判据从 worktree 的 `goals/AC-*.md`（`goal:` 行）与 `tasks/*.md`
  // （`goal_ac:` 行）读语料，翻转提交（下面）则在 goal 分支上 —— 故三类文件都建在 base 提交上，
  // 各分支（含 develop-work 主检出）都继承。
  fs.writeFileSync(path.join(root, "goals", `${GM_AC}-a-criterion.md`),
    `---\nid: ${GM_AC}\nstatus: active\nkind: criterion\ngoal: ${GM_GOAL}\nphase: post-merge\ncriterion: "exit 0"\n---\n\nfixture criterion attributable to ${GM_GOAL}\n`);
  fs.writeFileSync(path.join(root, "tasks", `${GM_TASK}.md`),
    `---\nid: ${GM_TASK}\ntitle: fixture task\nstatus: ready\ngoal_ac: ${GM_AC}\n---\n\nfixture task that lands through the goal branch\n`);
  g("add", "-A"); g("commit", "-q", "-m", "base");
  g("checkout", "-q", "-b", `goal/${GM_GOAL}`);
  fs.writeFileSync(path.join(root, "work.txt"), "goal work\n");
  g("add", "-A"); g("commit", "-q", "-m", "goal work");
  // 任务落地：用机械 fan-in 的【逐字】翻转 subject 提交，使这条落地可归因于本 goal 的唯一 merge 提交，
  // 并被 classify() 判为 `via`（在 goal 分支一侧，不在 develop 的 merge 前链上）。
  const taskFile = path.join(root, "tasks", `${GM_TASK}.md`);
  fs.writeFileSync(taskFile, fs.readFileSync(taskFile, "utf8").replace(/^status: ready$/m, "status: done"));
  g("add", "-A"); g("commit", "-q", "-m", `tasks: 翻 ${GM_TASK} done（driver 机械 fan-in）`);
  g("checkout", "-q", "-b", "develop-work"); // develop 脱离主检出 ⇒ ff 退化为纯 ref 更新
  // 请求时间回拨 2 分钟：AC-325 判据把请求事件的毫秒时间戳与合并提交的【秒级】%ct 比较
  // （`Date.parse(ts) < ct*1000`），同秒会误判「无请求」。生产里人请求与 driver 执行相隔数分钟，
  // 夹具把这一形态显式造出来（⛔ 不是放宽判据）。
  recordGoalMergeRequest({ root, goalId: GM_GOAL, reason: "tried it in the preview, mature enough", now: () => new Date(Date.now() - 120_000) });
  return root;
}

/** 从 `goals/<AC-NNN>-*.md` 的 criterion 字段取出判据文本并按 `sh -c` 在 `repo` 内执行。 */
function runGoalCriterion(repo, acId) {
  const dir = path.join(REPO_ROOT, "goals");
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`${acId}-`) && f.endsWith(".md"));
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const fm = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]);
  const r = spawnSync("sh", ["-c", fm.criterion], { cwd: repo, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const gmOpts = (root, suiteCommand) => ({
  root, goalId: GM_GOAL, suiteCommand,
  ffMergeModule: FF_MERGE_MODULE_ABS,
  scriptsDir: path.join(REPO_ROOT, "plugin", "scripts"),
});

function gmCleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── gap-goal-merge-execution-writes-no-step-trace — 并入的每一步都要在【共享】步骤 trace 载体上留痕 ────
//
// 直接量是载体本身（`.quay/fan-in-step-trace.jsonl` 里 kind 命中的那些行），⛔ 不是「函数有没有调
// appendFanInStepTrace」。只取带判别键的行：载体的既有记录（任务 fan-in 的步骤）没有 `kind` 字段——
// 那正是判别键存在的意义（以 `task` 为键聚合的读者不会把 GOAL id 当成任务）。
function goalMergeTrace(repo, goalId) {
  const file = path.join(repo, ".quay", "fan-in-step-trace.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === GOAL_MERGE_TRACE_KIND && e.task === goalId);
}

// ── gap-goal-merge-leaks-empty-mkdtemp-parent-dirs — 并入用过的 mkdtemp 父目录必须被删掉 ────────────
//
// 直接量不是「函数有没有调 rmSync」，而是【并入跑完后那个 TMPDIR 里还剩什么】。所以用例给并入一段
// 独占的 TMPDIR：`os.tmpdir()` 在 POSIX 每次调用都重读 `process.env.TMPDIR`（本机 Node 实测），
// 于是 `runGoalMergeFanIn` 内部 `mkdtempSync(os.tmpdir(), "goal-merge-…")` 建出的父目录就落在
// `tmp` 里，`goalMergeEntriesIn(tmp)` 一眼可数。⛔ 夹具仓库根（basename 也是 `goal-merge-e2e-*`）
// 必须由调用方在【进这个函数之前】建好，否则它自己就命中断言谓词。
async function withExclusiveTmpdir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-exclusive-tmpdir-"));
  const prev = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    return await fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prev;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** 独占 TMPDIR 里所有 `goal-merge-*` 条目——并入泄漏 mkdtemp 父目录的直接读数（应为空）。 */
function goalMergeEntriesIn(tmp) {
  return fs.readdirSync(tmp).filter((n) => n.startsWith("goal-merge-"));
}

test("goal-merge e2e — green suite: develop gets exactly ONE goal/GOAL-901 merge commit on its first-parent chain, develop is ff'd to it, the goal branch is deleted", async () => {
  const root = makeGoalMergeRepo("green");
  try {
    await withExclusiveTmpdir(async (tmp) => {
      assert.deepEqual(goalMergeEntriesIn(tmp), [], "独占 TMPDIR 开局是空的（谓词对着已知为真的样本干跑）");
      const pending = pendingGoalMerges(root);
      assert.equal(pending.length, 1, "the recorded request is pending");
      const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: pending[0].request });
      assert.equal(r.outcome, "landed");
      const merges = execFileSync("git", ["-C", root, "log", "develop", "--first-parent", "--merges", "--format=%H %s"], { encoding: "utf8" })
        .trim().split("\n").filter(Boolean);
      assert.equal(merges.length, 1, "exactly one merge commit on develop's first-parent chain");
      assert.match(merges[0], /goal\/GOAL-901/, "the merge subject names the goal branch");
      const devTip = execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
      assert.equal(r.landedSha, devTip, "develop was ff'd to the merge commit");
      assert.equal(merges[0].split(" ")[0], devTip, "the ff'd tip IS the merge commit");
      assert.throws(
        () => execFileSync("git", ["-C", root, "rev-parse", "--verify", "goal/GOAL-901"], { stdio: "ignore" }),
        "the goal branch was deleted",
      );
      assert.equal(pendingGoalMerges(root).length, 0, "a landed merge is no longer pending");
      // 泄漏判据（本任务的核心读数）：并入跑完后 TMPDIR 里一个 goal-merge-* 都不剩。
      assert.deepEqual(goalMergeEntriesIn(tmp), [], "成功并入后独占 TMPDIR 里不得残留任何 goal-merge-* 条目");

      // ── gap-goal-merge-execution-writes-no-step-trace AC1 ────────────────────────────────────────
      // 「并入慢在哪一步」必须是直接量：每个**实际执行**的步骤在共享载体上恰有一对 begin/end，
      // `step-end` 自带数值型 `durationMs`，且每条都带判别键 `kind`。
      const trace = goalMergeTrace(root, GM_GOAL);
      const executed = [
        "acquire-goal-lock", "acquire-develop-lock", "read-develop", "worktree-add",
        "merge", "suite", "ff", "branch-delete",
      ];
      for (const s of executed) {
        const begins = trace.filter((e) => e.step === s && e.event === "step-begin");
        const ends = trace.filter((e) => e.step === s && e.event === "step-end");
        assert.equal(begins.length, 1, `${s}: 恰一条 step-begin（实测 ${begins.length}）`);
        assert.equal(ends.length, 1, `${s}: 恰一条 step-end（实测 ${ends.length}）`);
        assert.equal(typeof ends[0].durationMs, "number", `${s}: step-end 带数值型 durationMs（实测 ${JSON.stringify(ends[0].durationMs)}）`);
        assert.equal(ends[0].ok, true, `${s}: 绿并入里该步 ok:true`);
        assert.equal(begins[0].kind, GOAL_MERGE_TRACE_KIND, `${s}: step-begin 带判别键`);
        assert.equal(ends[0].task, GM_GOAL, `${s}: task 字段是 GOAL id（⛔ 不是某个 task id）`);
      }
      // ⛔ 未接线的可选步（本用例没注入 anti-drift / typecheck 命令）**一条都不写**——「这一步没跑」
      // 不得伪装成一条读数（硬规则 3b）；同理⛔ 不补 `ok:null` 的 end（目标项目健康探针把 ok 非布尔
      // 的行判成 trace-unparseable）。
      assert.deepEqual(trace.filter((e) => e.step === "anti-drift" || e.step === "typecheck"), [],
        "缺省未接线的 anti-drift / typecheck 在轨迹里没有任何条目");
      assert.ok(trace.every((e) => e.kind === GOAL_MERGE_TRACE_KIND), "每条并入记录都带判别键（否则按 task 聚合会把它当成任务）");
    });
  } finally { gmCleanup(root); }
});

test("goal-merge e2e — red suite: all refs unchanged, a goal-merge-result is written, and it retries only after the tip advances", async () => {
  const root = makeGoalMergeRepo("red");
  try {
    await withExclusiveTmpdir(async (tmp) => {
      // 安全断言的前置：TMPDIR 里放一个【不属于并入】的目录。删父目录的那条判据若写成「删 tmpdir
      // 里的一切」或直接删 os.tmpdir()，它就会被误删——本用例两次并入之后它必须原样还在。
      fs.mkdirSync(path.join(tmp, "keep-me"));
      const devBefore = execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
      const tip = execFileSync("git", ["-C", root, "rev-parse", "goal/GOAL-901"], { encoding: "utf8" }).trim();
      const pending = pendingGoalMerges(root);
      const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "echo boom; exit 1"]), request: pending[0].request });
      assert.equal(r.outcome, "red");
      assert.equal(r.step, "suite");
      assert.equal(execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim(), devBefore, "develop unchanged on red");
      assert.equal(execFileSync("git", ["-C", root, "rev-parse", "goal/GOAL-901"], { encoding: "utf8" }).trim(), tip, "goal branch unchanged on red");
      const results = readGoalMergeResults(root);
      assert.equal(results.length, 1);
      assert.equal(results[0].outcome, "red");
      assert.equal(results[0].tipSha, tip, "the result carries the attempted tip");
      // 泄漏判据（红的这一臂）：失败的并入同样必须清掉自己的 mkdtemp 父目录——失败路径正是
      // 2026-10-06 那 584 个空目录里 9 个真实条目的来源。
      assert.deepEqual(goalMergeEntriesIn(tmp), [], "suite 红的并入之后独占 TMPDIR 里不得残留任何 goal-merge-* 条目");

      // gap-goal-merge-execution-writes-no-step-trace AC1（红的一臂）：轨迹里【最后一条】 `step-end`
      // 就是红的那一步（suite）且 `ok:false` —— ⛔ 不必再从 goal-merge-request / goal-merge-result 两个
      // 事件的时间戳反推「红了、红在哪一步」。⛔ finally 里的收尾不写条目（否则它会成为最后一条）。
      const redTrace = goalMergeTrace(root, GM_GOAL);
      const lastEnd = redTrace.filter((e) => e.event === "step-end").pop();
      assert.ok(lastEnd, "suite 红的并入也在共享载体上留了 step-end（实测零条）");
      assert.equal(lastEnd.step, "suite", `最后一条 step-end 是 suite（实测 ${lastEnd.step}）`);
      assert.equal(lastEnd.ok, false, "最后一条 step-end 的 ok:false");
      assert.equal(typeof lastEnd.durationMs, "number", "失败步的 step-end 也自带数值 durationMs");

      // tip 不变 ⇒ 下一轮不重试；tip 前进 ⇒ 重试（裁定⑳：人批准的是业务目标，不是某一棵树）。
      assert.equal(pendingGoalMerges(root).length, 0, "tip unchanged ⇒ not retried");
      const g = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
      g("checkout", "-q", `goal/${GM_GOAL}`);
      fs.writeFileSync(path.join(root, "fix.txt"), "fix\n");
      g("add", "-A"); g("commit", "-q", "-m", "fix the suite");
      g("checkout", "-q", "develop-work");
      const retry = pendingGoalMerges(root);
      assert.equal(retry.length, 1, "tip advanced ⇒ retried");

      const r2 = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: retry[0].request });
      assert.equal(r2.outcome, "landed", "the retry after the fix lands");
      assert.match(execFileSync("git", ["-C", root, "log", "develop", "--first-parent", "--merges", "--format=%s"], { encoding: "utf8" }), /goal\/GOAL-901/);

      // 两次并入（一红一绿）之后：既没有 goal-merge-* 残留，也没有误删不属于它的目录。
      assert.deepEqual(goalMergeEntriesIn(tmp), [], "两次并入之后独占 TMPDIR 里不得残留任何 goal-merge-* 条目");
      assert.equal(fs.existsSync(path.join(tmp, "keep-me")), true, "不属于并入的目录（keep-me）必须原样还在");
    });
  } finally { gmCleanup(root); }
});

// AC3（本任务 gap-goal-branch-human-merge-verb-and-execution）：用成功场景的临时仓库跑 GOAL-028 的
// 真实判据 AC-325 / AC-327，两者都退出 0。⛔ 判据文本从 `goals/AC-*.md` 的 criterion 字段【取出原文】
// 执行（硬规则 4 推论三：读生产载体，不是我在测试里重写一份等价的断言）。
test("goal-merge e2e — GOAL-028's AC-325 and AC-327 criteria pass on the success-scenario repo (the real criterion text, run with sh)", async () => {
  const root = makeGoalMergeRepo("ac-criteria");
  try {
    const pending = pendingGoalMerges(root);
    const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: pending[0].request });
    assert.equal(r.outcome, "landed");
    for (const acId of ["AC-325", "AC-327"]) {
      const res = runGoalCriterion(root, acId);
      assert.equal(res.status, 0, `${acId} must exit 0 — stdout=${res.stdout} stderr=${res.stderr}`);
      assert.match(res.stdout, /^PASS:/, `${acId} prints its PASS line`);
    }
  } finally { gmCleanup(root); }
});

// ── gap-goal-branch-worktrees-lack-node-modules — 并入临时 worktree 的依赖装配 ─────────────────────
//
// GOAL-904 演练逐字读到：`git merge --no-ff` 触发的 `pre-merge-commit` 钩子在 mkdtemp 出的临时
// worktree 里崩于 `Cannot find package 'yaml' … Not committing merge; use 'git commit' to complete the
// merge.`——合并被中止。本用例给夹具装一个「cwd 没有 node_modules 就非 0 退出」的 pre-merge-commit
// 钩子，复刻那次中止的形态：并入执行必须先把主检出的 node_modules 装配进临时 worktree，钩子才放行、
// 合并才落地。⛔ 不是注入 seam——钩子读的是磁盘上的真实目录，正是生产那次失败本身。
test("goal-merge e2e — 临时验证 worktree 被装配依赖：要求 node_modules 的 pre-merge-commit 钩子放行，合并落地", async () => {
  const root = makeGoalMergeRepo("nm-hook");
  try {
    // 主检出有一个 node_modules 目录（装配的源）。空目录即可——钩子只 `[ -d node_modules ]`。
    fs.mkdirSync(path.join(root, "node_modules"));
    // pre-merge-commit 钩子：merge 提交所在的工作树 cwd 没有 node_modules 就非 0 退出（复刻 GOAL-904 的中止）。
    const hook = path.join(root, ".git", "hooks", "pre-merge-commit");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\n# 复刻 GOAL-904：没有依赖就把合并中止\n[ -d node_modules ] || { echo "no node_modules in $PWD" >&2; exit 1; }\n', { mode: 0o755 });

    const pending = pendingGoalMerges(root);
    assert.equal(pending.length, 1, "请求挂起");
    const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: pending[0].request });
    assert.equal(r.outcome, "landed", `依赖装配后钩子放行、合并落地（实测 step=${r.step} reason=${r.reason}）`);
    const merges = execFileSync("git", ["-C", root, "log", "develop", "--first-parent", "--merges", "--format=%s"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    assert.equal(merges.length, 1, "develop 首父链上恰有一个合并提交");
    assert.match(merges[0], /^merge: goal\/GOAL-901 into develop \(request /, `合并 subject 形态（实测 ${merges[0]}）`);
  } finally { gmCleanup(root); }
});

// ── gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling — 并入临时 worktree 的 .quay 快照 ─
//
// cantus 2026-10-06 第一次 `quay goal merge GOAL-003` 红在 step=suite，reason 是 `no-suite-tooling`：
// 裸 `git worktree add` 只带已跟踪的树，gitignored 的 `.quay/config.yml` 不在临时 worktree 里，suite 步
// 经 `readLoopSection(<worktree>/.quay/config.yml)` 判「本项目声明了什么能力」，文件不存在 ⇒ 读成【未声明】
// ⇒ fail-closed。下面两个用例覆盖两种项目形态，直接量是【suite 步真的在临时 worktree 里跑了本项目声明的
// test_command】——它把 `$PWD` 与 `.quay/` 清单写进主检出的标记文件；suite exit 0 本身证明不了它跑在哪个树。

/** 一个 `loop:` 声明：delegated + 一条把读数写进主检出的 test_command。 */
function quayLoopConfig(command) {
  return ["loop:", "  suite_runner: delegated", `  test_command: "${command}"`, ""].join("\n");
}

/** 不注入 suiteCommand 的并入参数（走真实的 resolveMechanicalSuiteCommand：读临时 worktree 的 .quay 声明）。 */
const gmOptsDeclaredSuite = (root) => ({
  root, goalId: GM_GOAL,
  ffMergeModule: FF_MERGE_MODULE_ABS,
  scriptsDir: path.join(REPO_ROOT, "plugin", "scripts"),
});

test("goal-merge e2e — develop 不跟踪 .quay：主检出 .quay 快照铺进临时 worktree，suite 读到本项目声明的 test_command 并真的在那里执行", async () => {
  const pwdMarker = (root) => path.join(root, "suite-pwd.txt");
  const listingMarker = (root) => path.join(root, "suite-quay-listing.txt");
  const root = makeGoalMergeRepo("quay-snapshot-untracked", {
    quayConfig: (r) =>
      quayLoopConfig(`pwd > ${pwdMarker(r)}; ls -a .quay > ${listingMarker(r)}`),
  });
  try {
    // 实例身份文件放进主检出 .quay/：快照【不得】把它们带进临时 worktree（复用预览快照的排除集）。
    for (const f of ["server.json", "server.lock", "server-services.json"]) {
      fs.writeFileSync(path.join(root, ".quay", f), "{}\n");
    }
    const pending = pendingGoalMerges(root);
    assert.equal(pending.length, 1, "请求挂起");
    const r = await runGoalMergeFanIn({ ...gmOptsDeclaredSuite(root), request: pending[0].request });
    // 失败信息里带上 step/reason：本用例的取假臂（临时禁用快照）期望这里出现 no-suite-tooling。
    assert.equal(r.outcome, "landed", `并入必须落地；step=${r.step} reason=${r.reason}`);

    // 直接量①：test_command 在【临时 worktree】里执行的（$PWD 是 mkdtemp 出来的 …/goal-merge-…/wt，
    // ⛔ 不是主检出）——suite exit 0 不能证明这一点，标记文件才能。
    const pwd = fs.readFileSync(pwdMarker(root), "utf8").trim();
    assert.notEqual(pwd, root, "test_command 不是在主检出里跑的空转");
    assert.equal(path.basename(pwd), "wt", `test_command 跑在临时 worktree 的 wt 子目录（实测 ${pwd}）`);
    assert.match(path.basename(path.dirname(pwd)), /^goal-merge-/, "父目录是并入 mkdtemp 出来的 goal-merge-*");

    // 直接量②：临时 worktree 的 `.quay/` 里确实有主检出的 config.yml（快照铺到了）。
    const listing = fs.readFileSync(listingMarker(root), "utf8").split("\n").map((l) => l.trim());
    assert.ok(listing.includes("config.yml"), `临时 worktree 的 .quay/ 含 config.yml（实测 ${JSON.stringify(listing)}）`);

    // AC3：实例身份文件【不在】临时 worktree 的 .quay/ 里（复制它们会让临时 worktree 读到生产的实例注册）。
    for (const f of ["server.json", "server.lock", "server-services.json"]) {
      assert.equal(listing.includes(f), false, `${f} 不得被快照带进临时 worktree（实测 ${JSON.stringify(listing)}）`);
    }
  } finally { gmCleanup(root); }
});

test("goal-merge e2e — develop 跟踪 .quay/config.yml（quay 自己的形态）：快照不覆盖已跟踪条目，并入提交不含快照条目、merge 不因本地改动失败", async () => {
  const statusMarker = (root) => path.join(root, "suite-quay-status.txt");
  const rootConfigRanMarker = (root) => path.join(root, "root-config-ran.txt");
  // 提交在 develop 上的 config：它的 test_command 才是临时 worktree 该跑的那条。
  const committedCommand = (r) => `git status --porcelain -- .quay > ${statusMarker(r)}`;
  const root = makeGoalMergeRepo("quay-snapshot-tracked", {
    trackQuayConfig: true,
    quayConfig: (r) => quayLoopConfig(committedCommand(r)),
  });
  try {
    // 主检出的 config.yml 改成【不同内容】：快照若不跳过已跟踪条目，就会把它覆盖进临时 worktree，
    // 于是 ①工作树的 config.yml 相对合并提交变脏 ②suite 会跑主检出的命令而不是提交里的那条。
    // 两个形态都能被下面的断言抓住（⛔ 内容相同会让这条测试空转，硬规则 4）。
    fs.writeFileSync(
      path.join(root, ".quay", "config.yml"),
      quayLoopConfig(`echo ROOT-CONFIG-RAN > ${rootConfigRanMarker(root)}`),
    );

    const pending = pendingGoalMerges(root);
    assert.equal(pending.length, 1, "请求挂起");
    const r = await runGoalMergeFanIn({ ...gmOptsDeclaredSuite(root), request: pending[0].request });
    assert.equal(r.outcome, "landed", `并入必须落地（merge 不得因本地改动失败）；step=${r.step} reason=${r.reason}`);

    // 直接量①：临时 worktree 跑的是【提交里的】config（它的 test_command 写了 statusMarker），
    // ⛔ 不是主检出那份（改跑主检出那条会写 rootConfigRanMarker）。
    assert.ok(fs.existsSync(statusMarker(root)), "临时 worktree 的 .quay/config.yml 来自合并提交（提交里的 test_command 跑了）");
    assert.equal(fs.existsSync(rootConfigRanMarker(root)), false, "主检出的 config.yml 未被带进临时 worktree（否则会是它跑）");

    // 直接量②：受测树里【没有被写脏的已跟踪文件】——porcelain 只应出现 `??`（快照铺下的未跟踪条目）。
    const status = fs.readFileSync(statusMarker(root), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    assert.ok(
      status.some((l) => l.endsWith(".quay/gate-events.jsonl") && l.startsWith("??")),
      `快照确实铺下了未跟踪条目（否则本断言空转）；实测 ${JSON.stringify(status)}`,
    );
    for (const line of status) {
      assert.ok(line.startsWith("??"), `临时 worktree 里不得有已跟踪文件被改动（实测行：${line}）`);
    }

    // 直接量③：并入提交相对其第一父提交的文件列表不含任何 `.quay/` 快照条目（快照条目是未跟踪/被忽略的
    // 运行时文件，必须留在合并提交之外）。
    const mergeSha = r.mergeCommitSha;
    assert.ok(mergeSha, "landed 结果带回合并提交 sha");
    const changed = execFileSync("git", ["-C", root, "diff", "--name-only", `${mergeSha}^1`, mergeSha], { encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(changed.filter((p) => p.startsWith(".quay/")), [], `并入提交不含任何 .quay/ 快照条目（实测 ${JSON.stringify(changed)}）`);
  } finally { gmCleanup(root); }
});

test("goal-merge e2e — 本项目无测试能力（.quay 无 loop 声明）：red 的 step 是 suite-capability，⛔ 不与「suite 跑了且失败」共用 suite", async () => {
  // ⛔ 不写 `.quay/config.yml`：resolveMechanicalSuiteCommand 读成「无测试能力」⇒ 独立 step 取值
  // （硬规则 3b：读 goal-merge-result 的人不得把项目配置问题当成代码问题）。本任务第 4 小项。
  const root = makeGoalMergeRepo("quay-snapshot-nocap");
  try {
    const devBefore = execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
    const pending = pendingGoalMerges(root);
    assert.equal(pending.length, 1, "请求挂起");
    const r = await runGoalMergeFanIn({ ...gmOptsDeclaredSuite(root), request: pending[0].request });
    assert.equal(r.outcome, "red");
    assert.equal(r.step, "suite-capability", `无测试能力 ⇒ 独立 step 取值（实测 step=${r.step}）`);
    assert.match(String(r.reason), /no-suite-tooling/, `reason 保留成因原文（实测 ${r.reason}）`);
    assert.equal(execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim(), devBefore, "红：develop 不动");
  } finally { gmCleanup(root); }
});

// ── gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries — 并入失败不得同形 ────────────
//
// GOAL-904 演练逐字读到：并入的真因是 pre-merge-commit 钩子因缺依赖崩了（`ERR_MODULE_NOT_FOUND
// … Not committing merge; use 'git commit' to complete the merge.`），却被写成 `step: "merge-conflict"`
// ——读 step 的人（和下游 gap-filing）被引去找根本不存在的冲突（硬规则 3b）。下面两臂把两种成因
// 并排造出来：真实内容冲突仍必须是 `merge-conflict`；钩子失败必须是独立取值且 reason 保留钩子原文。
test("goal-merge e2e — 失败分类两臂：真实内容冲突写 merge-conflict；pre-merge-commit 钩子失败写 merge-failed 且 reason 带钩子原文", async () => {
  // Arm ① — a REAL content conflict: develop and the goal branch both add work.txt with different bytes.
  {
    const root = makeGoalMergeRepo("classify-conflict");
    try {
      const g = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
      g("checkout", "-q", "develop");
      fs.writeFileSync(path.join(root, "work.txt"), "develop version\n");
      g("add", "-A"); g("commit", "-q", "-m", "conflicting develop change");
      g("checkout", "-q", "develop-work");

      const pending = pendingGoalMerges(root);
      assert.equal(pending.length, 1, "请求挂起");
      const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: pending[0].request });
      assert.equal(r.outcome, "red");
      assert.equal(r.step, "merge-conflict", `真实内容冲突必须写 merge-conflict（实测 step=${r.step} reason=${r.reason}）`);
    } finally { gmCleanup(root); }
  }

  // Arm ② — a FAILING pre-merge-commit hook (infrastructure, NOT a conflict). The content merges
  // cleanly; only the hook aborts the commit, so there are NO unmerged paths and `step` must say so.
  {
    const root = makeGoalMergeRepo("classify-hook");
    try {
      const devBefore = execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
      const tipBefore = execFileSync("git", ["-C", root, "rev-parse", "goal/GOAL-901"], { encoding: "utf8" }).trim();
      const hook = path.join(root, ".git", "hooks", "pre-merge-commit");
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho "HOOK-BLEW-UP: simulated missing deps" >&2\nexit 1\n', { mode: 0o755 });

      const pending = pendingGoalMerges(root);
      assert.equal(pending.length, 1, "请求挂起");
      const r = await runGoalMergeFanIn({ ...gmOpts(root, ["bash", "-c", "exit 0"]), request: pending[0].request });
      assert.equal(r.outcome, "red");
      assert.notEqual(r.step, "merge-conflict", `钩子失败不得被标成内容冲突（实测 step=${r.step}）`);
      assert.equal(r.step, "merge-failed", `钩子失败写独立取值（实测 step=${r.step}）`);
      assert.match(String(r.reason), /HOOK-BLEW-UP/, `reason 保留钩子的原始输出（实测 reason=${r.reason}）`);
      assert.equal(execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim(), devBefore, "红：develop 不动");
      assert.equal(execFileSync("git", ["-C", root, "rev-parse", "goal/GOAL-901"], { encoding: "utf8" }).trim(), tipBefore, "红：goal 分支不动");
    } finally { gmCleanup(root); }
  }
});
