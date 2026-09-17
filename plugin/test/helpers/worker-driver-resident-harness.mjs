// Shared harness for the worker-driver-resident shards (split of worker-driver-resident.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../worker-driver-resident.test.mjs", import.meta.url).href;

// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
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
  exitedNotLandedAttempts,
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
} from "../../scripts/worker-driver.ts";
import { resolveKernelScriptsDir } from "../../scripts/driver-runtime.ts";
import { defaultLaneCount } from "../../scripts/full-suite-runner.ts";
import { spawnSuiteAndWait } from "../../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../../scripts/suite-lock-slots.ts";
// gap-worker-driver-retry-cap-not-wired：retryExhausted 集合的生产函数单一真相源（driver-filters.ts），
// 两 driver 共用（⛔ 非平行副本）。AC3 用同一函数身份证 promotion 不回归。
import { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, applyTaskFilters, makeFilterContext } from "../../scripts/driver-filters.ts";
import { advanceRetryCap as promoAdvanceRetryCap, markNeedsHuman as promoMarkNeedsHuman, MAX_FIX_RETRIES_DEFAULT } from "../../scripts/promotion-driver.ts";

import {
  DRIVER,
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
  WAIT_BASE_MS,
  writeTaskFile,
  writeTouchedTask,
  counterNodeE,
} from ".././helpers/worker-driver-harness.mjs";




// 结构面（能取假）：本文件所有 after 钩子里的删除必须走 rmSafe（⛔ 裸 fs.rmSync）。理由同上——一次
// 抛错会跳过该测试剩余的全部 after 钩子（含 drv.stop()）。判据读【本文件源码】并按钩子切窗；
// 窗口内出现裸 fs.rmSync 即红。窗口数不足视为【没解析到】而非【都合格】（硬规则 3b：不得让
// "读不懂"与"合格"同形）。两个针都由片段拼出，避免判据匹配到它自己（硬规则 2 自匹配）。

const __dirname = path.dirname(fileURLToPath(SRC_URL));

/** All source text of this split family — every `<stem>-sNN` shard under plugin/test plus this harness.
 *  gap-suite-split-15-over-30s-test-files: the monolith's hooks and fixtures now live in the shards AND
 *  here (top-level hooks became installShardHooks), so a whole-file structural criterion must read the
 *  family. Reading one file either goes vacuous (hook count below the non-vacuity guard) or misses the
 *  hooks that moved out of it — both are the "checked nothing" shape. */
const FAMILY_SRC = (() => {
  const here = fileURLToPath(import.meta.url);
  const testDir = path.dirname(path.dirname(here));
  const stem = path.basename(here).replace(/-harness\.mjs$/, "");
  const shards = fs
    .readdirSync(testDir)
    .filter((f) => new RegExp(`^${stem}-s\\d+\\.test\\.mjs$`).test(f))
    .sort()
    .map((f) => path.join(testDir, f));
  return [here, ...shards].map((f) => fs.readFileSync(f, "utf8")).join("\n");
})();

// ── 文件级兜底（fan-in 静默挂死）：常驻驱动是 detached 子进程，node 不会因测试结束而回收它 ——
// 它持着【本文件进程】的 stdout pipe + 子进程句柄，文件进程就永不退出 ⇒ 套件在本文件上静默
// （无 __PERFILE__、无 `ℹ tests`）⇒ 静默看门狗杀掉整个套件（2026-09-12 实测 1229s；2026-09-10
// 那次的文件进程与驱动 51 小时后仍活着）。测试级 after 钩子【在某个钩子抛错时会被整体跳过】，所以
// 单靠每个测试自己 `t.after(() => drv.stop())` 不足；文件级 after 钩子在测试级钩子抛错后【仍会执行】
// （node 24 实测），因此它是最后一道保证：无论哪个测试怎么炸，本文件绝不留下活驱动。
after(async () => { await stopAllResidentDrivers(); });

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

export { CONTROL_CALLERS_ENV, CONTROL_HEADER, CONTROL_STATE_REL, DRIVER, EXITED_NOT_LANDED_EXIT, FINAL_STATES, MAX_FIX_RETRIES_DEFAULT, PROFILES, QUAY_LAUNCH, QUICK_DEATH_BACKOFF_DEFAULT, RECONCILE_INTERVAL_SECS_DEFAULT, REPO_ROOT, RESIDENT_INTERVAL_MS_DEFAULT, RETRY_CAP_DEFAULT, FAMILY_SRC, WAIT_BASE_MS, WORKER_OUTCOME_REL, WORKER_PROCESS_NAME, WORKER_ROUND_REL, __dirname, acquireFanInLock, advanceRetryCap, after, appendFanInStepTrace, appendFanInTrace, appendOutcomeToFile, applyForceDispatch, applyHalt, applyPreference, applyTaskFilters, assert, backoffDelayMs, branchHeadSubject, branchHeadSubjectAsync, buildContinueWorkerPrompt, buildWorkerPrompt, cleanupOrphanWorktree, combinedOutput, computeHaltedOutcome, computeLandingState, computeOutcome, computeWorkerRoundRecord, continueStateForTask, continueStateForTaskAsync, countBranchCommits, countBranchCommitsAsync, counterNodeE, defaultControlState, defaultLaneCount, defaultLivenessCheckArgv, defaultMechanicalSuiteCommand, defaultReadyPoolArgv, defaultSelectorArgv, defaultWorkerArgv, dryRunLaunch, enumerateColdStartInflight, enumerateLiveWorkerCmdlines, enumerateTaskWorktreeTasks, execFileSync, exitedNotLandedAttempts, extractFailureSummary, fanInLockFile, fanInLogFileName, fileURLToPath, fs, hasLiveWorkerForTask, headerValue, isBackedOff, isFfNotFastForwardFailure, isHalted, isQuickDeath, isSigtermExitCode, knownCallers, lastExitedNotLandedReason, launchArgv, makeFilterContext, makeGitRoot, makeRoot, markNeedsHuman, mechSh, mirrorMechanicalFanInSuiteState, newMechanicalSuiteRunId, newQuickDeathBackoffState, newSessionId, os, parseBackoffBaseMs, parseBackoffMaxMs, parseBackoffThreshold, parseIntervalMs, parseMaxRetries, parseQuickDeathMs, parseReconcileIntervalSecs, parseSelectorOutput, parseTimeoutMs, path, pathToFileURL, promoAdvanceRetryCap, promoMarkNeedsHuman, readAcCheckState, readControlState, readFanInLockHold, readLockMetricsForRun, readOutcomeLines, readProfiles, readRoundLines, readTaskStatus, readyPoolCheck, recordQuickDeathBackoff, resolveCaller, resolveConcurrency, resolveKernelScriptsDir, resolveRun, resourceGateCheck, rmSafe, runDriver, runGit, runLivenessCheck, runMechanicalFanIn, runSelectorWorker, serveControlPlane, shuffle, signalExitCode, spawn, spawnMechanicalFanIn, spawnResident, spawnSuiteAndWait, spawnSync, splitArgs, stashIfDirty, stopAllResidentDrivers, suiteLockBase, suiteLockSlotPaths, taskBranchHasCommits, test, waitFor, workerArgvForTask, workerArgvForTaskAsync, workerPromptForTask, workerPromptForTaskAsync, worktreePathsForTask, worktreePathsForTaskAsync, worktreePresentForTask, worktreePresentForTaskAsync, writeControlState, writeProfileCarrier, writeTaskFile, writeTouchedTask };
