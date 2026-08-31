// @test-group lowconc
// worker-driver.test.mjs — worker lifecycle (spawn/kill/timeout/outcome) + mechanical-fan-in result + MCP control plane. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/worker-driver-harness.mjs.
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
} from "./helpers/worker-driver-harness.mjs";

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
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.doesNotMatch(src, /reason: \(r\.stderr \|\| r\.stdout \|\| ""\)\.trim\(\)/, "AC2: step() trace 的 stderr 优先裸流已移除");
  assert.match(src, /extractFailureSummary\(combinedOutput\(r\.stdout, r\.stderr\)\)/, "AC2: step() trace reason 走同一去噪机件（与 fail() 共用）");
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

// ── gap-fan-in-red-bucket-run-not-recorded AC1/AC2 — 机械 fan-in 的 suite 步缺省命令 ───────────────
// 机械路径此前跑平行 `bash scripts/test.sh --buckets`（绕开 verification-round.jsonl 唯一 writer，
// 红桶轮次零记录——硬规则 3b「没跑过」与「跑了但红」同形）。现在缺省命令统一到 full-suite-runner.ts
// --buckets：green+red 桶轮次都在 suite 退出时入账，/tests 趋势账本看到完整真相。

test("AC2 — the mechanical fan-in default suite command is full-suite-runner.ts --buckets (not a parallel test.sh harness)", () => {
  const cmd = defaultMechanicalSuiteCommand({
    task: "gap-mech-red-bucket",
    worktree: "/tmp/wt",
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite-gap-mech-red-bucket.log",
    runId: "mfi-gap-mech-red-bucket-1788022868-abc123",
  });
  assert.ok(cmd.some((a) => a.endsWith("full-suite-runner.ts")), "the default suite command must be full-suite-runner.ts");
  assert.ok(cmd.includes("--buckets") && cmd.includes("gap-mech-red-bucket"), "must pass --buckets <task>");
  assert.ok(cmd.includes("--root") && cmd.includes("/tmp/wt"), "must pass --root <worktree> (the tested checkout)");
  assert.ok(cmd.includes("--state-dir") && cmd.includes("/tmp/root/.quay"), "must pass --state-dir <root>/.quay (the shared checkout ledger)");
  assert.ok(cmd.includes("--runner") && cmd.includes("inner"), "must pass --runner inner (explicit layer identity)");
  assert.ok(cmd.includes("--log-file") && cmd.includes("/tmp/fan-in-suite-gap-mech-red-bucket.log"), "must pass --log-file <suiteLogFile> (the silence-watchdog tee)");
  // gap-mechanical-fan-in-per-suite-runid-unified — the per-suite runId is passed to the runner so the
  // suite-load-<runId>.jsonl key + full-suite-state runId + verification-round record runId share ONE key.
  assert.ok(cmd.includes("--run-id") && cmd.includes("mfi-gap-mech-red-bucket-1788022868-abc123"), "must pass --run-id <per-suite runId> to the runner");
  assert.ok(!cmd.some((a) => a.includes("scripts/test.sh")), "must NOT run a parallel `bash scripts/test.sh` harness");
});

test("gap-mechanical-fan-in-per-suite-runid-unified AC2 — newMechanicalSuiteRunId is per-suite unique (two tasks ⇒ two ids, one per fan-in)", () => {
  const a = newMechanicalSuiteRunId("gap-task-a");
  const b = newMechanicalSuiteRunId("gap-task-b");
  assert.notEqual(a, b, "two different tasks produce two DIFFERENT per-suite runIds");
  assert.ok(a.startsWith("mfi-gap-task-a-") && b.startsWith("mfi-gap-task-b-"), "the id carries the mfi-<task>- prefix (suite identity, not the shared wk-prod round id)");
  assert.ok(!a.startsWith("wk-prod"), "the per-suite id is NOT the shared wk-prod driver round id");
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

