// Shared harness for the worker-driver-fan-in shards (split of worker-driver-fan-in.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../worker-driver-fan-in.test.mjs", import.meta.url).href;
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
  classifyQuickDeathCause,
  parseRateLimitResetAtMs,
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
  // gap-worker-quick-death-environment-fatal-halts-driver：环境级（environment-fatal）分类的四件套
  // ——签名表（含机器可读正反例）/ 富分类结果 / 签名指纹 / 停机写盘。
  ENVIRONMENT_FATAL_SIGNATURES,
  classifyQuickDeathEvidence,
  quickDeathSignature,
  haltForEnvironmentFatal,
  environmentFatalHaltReason,
  ENVIRONMENT_FATAL_HALTED_BY,
  WORKER_STDERR_TAIL_MAX_BYTES,
  ENV_FATAL_FANOUT_WINDOW_MS,
} from "../../scripts/worker-driver.ts";
// gap-worker-quick-death-environment-fatal-halts-driver AC3：`quay driver start --kind worker` 的启动冒烟
// 单一真相源在 driver-runtime.ts（与上面的分类器共用同一份签名表，⛔ 两份清单 = 漂移）。
import { runEnvironmentSmoke, ENVIRONMENT_SMOKE_PROMPT } from "../../scripts/driver-runtime.ts";
import { defaultLaneCount, SUITE_LOG_NOT_RUN_PREFIX } from "../../scripts/full-suite-runner.ts";
import { spawnSuiteAndWait } from "../../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../../scripts/suite-lock-slots.ts";
// gap-worker-driver-retry-cap-not-wired：retryExhausted 集合的生产函数单一真相源（driver-filters.ts），
// 两 driver 共用（⛔ 非平行副本）。AC3 用同一函数身份证 promotion 不回归。
import { advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, applyTaskFilters, makeFilterContext } from "../../scripts/driver-filters.ts";
import { advanceRetryCap as promoAdvanceRetryCap, markNeedsHuman as promoMarkNeedsHuman, MAX_FIX_RETRIES_DEFAULT } from "../../scripts/promotion-driver.ts";

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
} from ".././helpers/worker-driver-harness.mjs";


// 结构面（能取假）：本文件 after 钩子里的删除必须走 rmSafe（⛔ 裸 fs.rmSync）——一次抛错会跳过该测试
// 剩余的全部 after 钩子（含 drv.stop()）⇒ 驱动泄漏 ⇒ 套件静默。判据读【本文件源码】按钩子切窗；
// 窗口数不足视为【没解析到】而非【都合格】（硬规则 3b）。两个针由片段拼出，避免自匹配（硬规则 2）。

// ── 文件级兜底（同 worker-driver-resident.test.mjs）：常驻驱动是本文件 spawn 的 detached 子进程，
// 它持着本文件进程的子进程句柄 ⇒ 文件进程永不退出 ⇒ 套件在本文件上静默 ⇒ 静默看门狗杀整个套件。
// 测试级 after 钩子会被【前一个抛错的钩子】整体跳过，文件级 after 钩子不会 ⇒ 无论哪个测试怎么炸，
// 本文件绝不留下活驱动。
after(async () => { await stopAllResidentDrivers(); });

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
//
// `suiteSignatures` 与生产写入面同形（`withRecordedSuiteSignatures`，gap-unrelated-suite-red-exemption-
// unreachable）：签名在**写入时**从该 basename 指向的日志抽出并随记录留存，复发扫描此后只读记录、
// ⛔ 不再事后读日志（那些日志落地即被 pruneTaskSuiteLogs 删掉）。夹具必须造出**同一个**形状，否则它
// 测的就不是生产形态——旧夹具只写日志不写签名，等于在测一个生产上不存在的记录形态。
// 日志不在盘上 ⇒ `suiteSignatures: null`（如实记「没留下」，⛔ 不伪造空数组）。
function appendOtherSuiteRed(root, taskId, ts, suiteLogBasename) {
  const logPath = path.join(root, ".quay", suiteLogBasename);
  let suiteSignatures = null;
  try {
    suiteSignatures = assertionSignaturesFromSuiteLog(fs.readFileSync(logPath, "utf8"));
  } catch { /* 日志不在盘上 ⇒ null（没留下证据） */ }
  fs.appendFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ ts, task: taskId, final_state: "exited-not-landed", run_id: "r", session_id: "s", mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: suiteLogBasename, suiteSignatures } }) + "\n", "utf8");
}

// 第一手样本的逐字 selector_reason（quay-fleet 生产载体原文；任务体 DoD 要求保留）。
const RATE_LIMIT_REASON =
  'selector worker returned no valid pick (exit 1, got "You\'ve hit your session limit · resets 11:30am (UTC)"); fallback to first shuffled candidate';

// 同一条限流但【不含】重置时刻 ⇒ 回落指数退避（AC3 第二臂）。
const RATE_LIMIT_NO_RESET_REASON =
  'selector worker returned no valid pick (exit 1, got "You\'ve hit your session limit"); fallback to first shuffled candidate';

// 反例输入（⛔ 不命中任何限流签名）。
const ORDINARY_REASON = "worker exited with code 1";

const SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");

// P2 (gap-execution-loop-productization-p2-p4): the ff 持锁段 is a TS module now — the hermetic
// makeMechRepo worktree has no packages/, so pin the seam to the REAL repo copy (a plain path;
// worker-driver pathToFileURL()s it). Same pin as fan-in-driver-mechanical-orchestration.test.mjs.
const FF_MERGE_MODULE = path.join(REPO_ROOT, "packages", "quay", "src", "fan-in", "ff-merge.ts");

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

function readSharedTrace(root) {
  return fs.readFileSync(path.join(root, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function pairedEndCount(rows, step) {
  const b = rows.filter((r) => r.step === step && r.event === "step-begin").length;
  const e = rows.filter((r) => r.step === step && r.event === "step-end").length;
  return Math.min(b, e);
}

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

export { ENVIRONMENT_FATAL_HALTED_BY, ENVIRONMENT_FATAL_SIGNATURES, ENVIRONMENT_SMOKE_PROMPT, ENV_FATAL_FANOUT_WINDOW_MS, WORKER_STDERR_TAIL_MAX_BYTES, classifyQuickDeathEvidence, environmentFatalHaltReason, haltForEnvironmentFatal, quickDeathSignature, runEnvironmentSmoke };
export { FAMILY_SRC, CONTROL_CALLERS_ENV, CONTROL_HEADER, CONTROL_STATE_REL, DRIVER, EXEMPT_TEST, EXITED_NOT_LANDED_EXIT, FF_MERGE_MODULE, FINAL_STATES, MAX_FIX_RETRIES_DEFAULT, ORDINARY_REASON, QUICK_DEATH_BACKOFF_DEFAULT, RATE_LIMIT_NO_RESET_REASON, RATE_LIMIT_REASON, RECONCILE_INTERVAL_SECS_DEFAULT, REPO_ROOT, RESIDENT_INTERVAL_MS_DEFAULT, RETRY_CAP_DEFAULT, RETRY_EXEMPTION_WINDOW_MS_DEFAULT, SLOT_LIB, SUITE_LOG_NOT_RUN_PREFIX, WORKER_OUTCOME_REL, WORKER_PROCESS_NAME, WORKER_ROUND_REL, acShortCircuitVerdict, acquireFanInLock, advanceRetryCap, after, appendCompleteGateEvent, appendFanInStepTrace, appendFanInTrace, appendOtherSuiteRed, appendOutcomeToFile, applyForceDispatch, applyHalt, applyPreference, applyTaskFilters, assert, assertionSignaturesFromSuiteLog, backoffDelayMs, branchHeadSubject, branchHeadSubjectAsync, buildContinueWorkerPrompt, buildWorkerPrompt, classifyQuickDeathCause, cleanupOrphanWorktree, combinedOutput, computeHaltedOutcome, computeLandingState, computeOutcome, computeWorkerRoundRecord, continueStateForTask, continueStateForTaskAsync, countBranchCommits, countBranchCommitsAsync, counterNodeE, defaultControlState, defaultLaneCount, defaultLivenessCheckArgv, defaultMechanicalSuiteCommand, defaultReadyPoolArgv, defaultSelectorArgv, defaultWorkerArgv, dispatchStoreFile, enumerateColdStartInflight, enumerateLiveWorkerCmdlines, enumerateTaskWorktreeTasks, execFileSync, extractFailureSummary, extractFirstFailureLine, extractSuiteNotRunLine, failingTestFilesFromSuiteLog, fanInLockFile, fanInLogFileName, fileURLToPath, fs, hasLiveWorkerForTask, headerValue, isBackedOff, isFfNotFastForwardFailure, isHalted, isQuickDeath, isSigtermExitCode, judgeRetryExemption, knownCallers, lastExitedNotLandedReason, launchArgv, makeFilterContext, makeGitRoot, makeMechRepo, makeReuseRepo, makeRoot, markNeedsHuman, mechOpts, mechSh, mirrorMechanicalFanInSuiteState, newMechanicalSuiteRunId, newQuickDeathBackoffState, newSessionId, normalizeAssertionSignature, os, pairedEndCount, parseBackoffBaseMs, parseBackoffMaxMs, parseBackoffThreshold, parseIntervalMs, parseMaxRetries, parseQuickDeathMs, parseRateLimitResetAtMs, parseReconcileIntervalSecs, parseSelectorOutput, parseTimeoutMs, path, pathToFileURL, promoAdvanceRetryCap, promoMarkNeedsHuman, pruneTaskSuiteLogs, readAcCheckState, readControlState, readDispatchStore, readFanInLockHold, readLockMetricsForRun, readOutcomeLines, readPreviousGreenSuiteCommit, readRoundLines, readSharedTrace, readSuiteLogUntil, readTaskStatus, readyPoolCheck, recordQuickDeathBackoff, resolveCaller, resolveConcurrency, resolveRun, resolveWorkerProcessName, resourceGateCheck, rmSafe, runDriver, runGit, runLivenessCheck, runMechanicalFanIn, runSelectorWorker, serveControlPlane, shuffle, signalExitCode, spawn, spawnMechanicalFanIn, spawnResident, spawnSuiteAndWait, spawnSync, splitArgs, stashIfDirty, stopAllResidentDrivers, suiteLockBase, suiteLockSlotPaths, suiteLogFileName, taskBranchHasCommits, test, upsertDispatchRecord, waitFor, workerArgvForTask, workerArgvForTaskAsync, workerPromptForTask, workerPromptForTaskAsync, worktreePathsForTask, worktreePathsForTaskAsync, worktreePresentForTask, worktreePresentForTaskAsync, writeAcTaskBody, writeControlState, writeExemptionTask, writeFailingTest, writeProfileCarrier, writeSuiteRedLog, writeTaskFile, writeTouchedTask };
