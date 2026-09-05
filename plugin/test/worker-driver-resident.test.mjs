// @test-group engine
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 阶段 4（AC129）常驻驱动 + 自主选任务：选择环 / selector worker / 判停 ─────────────────────────
// (counterNodeE shared helper lives in ./helpers/worker-driver-harness.mjs — used by this file AND
//  worker-driver-fan-in.test.mjs, so it cannot stay local to either.)

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
  // 5000 → 15000：两次完整派发（ready-pool/selector/worker 各 spawn 一个 node 子进程 + 每次派发后
  // 等在飞 worker 落地含 git landing 读）在满载 16 核 full-suite 并发下可 >5s（suite 轮实测 5000 超时
  // flake、picks=1，与同文件 AC1「第二次派发」10000ms 约定同源——gap-worker-driver-resident-loop-intermittent-hang；
  // 补充处置 A 类在 develop 10000 基础上再放宽至 15000）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 15000);
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
  // 5000 → 15000：一次完整派发（ready-pool/selector/worker 各 spawn 一个 node 子进程 + worker 落地含
  // git landing 读）在满载 16 核 full-suite 并发下可 >5s（suite 轮实测 5000 超时 flake、outcomes=0，与同文件
  // AC1 10000ms 约定同源——gap-worker-driver-resident-loop-intermittent-hang；
  // 补充处置 A 类在 develop 10000 基础上再放宽至 15000）。
  await waitFor(() => readOutcomeLines(root).length >= 1, 15000);
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
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
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
  for (let i = 0; i < 1000 && workerPid === null; i++) {
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
  await waitFor(() => readRoundLines(root).length >= 1, 15000);
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
  await waitFor(() => readRoundLines(root).length >= 1 && readOutcomeLines(root).length >= 2, 30000);
  const rounds = readRoundLines(root);
  const livenessCount = fs.existsSync(livenessCnt) ? Number(fs.readFileSync(livenessCnt, "utf8")) : 0;
  // liveness 在每轮【开头】跑（writeRound 之前），结果写进每轮 round 记录。接线证明取两个直接量：
  // ① counter ≥ 1 ⇒ liveness 命令被真实 spawn 过（零调用者 Finding 的根已修）；② 每轮 round 都带
  // 非 null 的 liveness 结果（接线存在）。⛔ 不做 livenessCount ≥ rounds.length / 每轮 checked===true：
  // 满载 scoped suite 并行时 liveness spawn 偶发失败——counter 不增但 round 照写、checked=false 是合法
  // 「没查成」态（硬规则 3b，≠ 没接线）。把「没查成」当「没接线」= 该断言 flaky（3 轮机械 fan-in 全红）。
  assert.ok(livenessCount >= 1, "liveness was called (zero-caller fix): counter is non-zero");
  assert.ok(rounds.length >= 1, "at least one round ran");
  for (const rec of rounds) {
    assert.ok(rec.liveness !== null, `round carries a liveness result (wiring exists): ${JSON.stringify(rec.liveness)}`);
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
  await waitFor(() => drv.events().some((e) => e.event === "worker-spawned"), 15000);
  const closed = new Promise((resolve) => drv.child.stdout.on("close", resolve));
  drv.stop();
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("stdout pipe still open after stop — an orphaned worker held it (group-kill not applied)")), 10000)),
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

// ── gap-continue-cycle-misses-ff-not-fast-forward-redispatch ─────────────────────────────────────
// 机械 fan-in 的 ff 步「not a fast-forward」= develop 前进、分支滞后（⛔ 非代码缺陷）——continue-cycle
// 须把它识别为 transient 续做态（不计重试上限、继续 CONTINUE 重派），而非与真缺陷同形计上限误标
// needs-human（3 次含 2 次 ff 滞后 ⇒ 静置不派，2026-08-30 实况需人手动救回）。

test("AC2 (能取假) — isFfNotFastForwardFailure: step=ff + 'not a fast-forward' ⇒ transient continue（不计重试上限）；改 step 或 reason 任一 ⇒ 红", () => {
  const ffOutcome = {
    final_state: "exited-not-landed",
    mechanical_fan_in: {
      outcome: "red",
      step: "ff",
      reason: "fan-in-ff-merge: FF FAILED — To .; not a fast-forward. Retry record written (attempt 1).",
    },
  };
  assert.equal(
    isFfNotFastForwardFailure(ffOutcome),
    true,
    "step=ff + 'not a fast-forward' ⇒ transient（识别为续做，⛔ 不计重试上限）",
  );

  // 改 step（suite red）⇒ 不再是 transient（真缺陷，计上限）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", mechanical_fan_in: { outcome: "red", step: "suite", reason: "suite red" } }),
    false,
    "step=suite ⇒ 真缺陷（计上限）",
  );

  // 改 reason（ff 步但防活锁 escalation）⇒ 不再是 transient（真缺陷，计上限）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", mechanical_fan_in: { outcome: "red", step: "ff", reason: "fan-in-ff-merge: FF FAILED (attempt 3 >= 3) — ANTI-LIVELOCK … Do NOT auto-retry" } }),
    false,
    "step=ff + 防活锁 escalation ⇒ 真缺陷（计上限）",
  );

  // 无 mechanical_fan_in（非机械 fan-in 失败）/ 读不懂 ⇒ fail-closed false（计上限，⛔ 不漏判真缺陷）。
  assert.equal(
    isFfNotFastForwardFailure({ final_state: "exited-not-landed", failure_reason: "worker exited 0 but task did not land" }),
    false,
    "无 mechanical_fan_in ⇒ fail-closed 计上限",
  );
  assert.equal(isFfNotFastForwardFailure(null), false, "null ⇒ false");
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

// ── gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward ──────────────────────────────
// 冲突消解协议（gap-continue-prompt-conflict-resolution-protocol）只教 outline/code 两型；三型新暴露
// （硬规则 5b：修好一个 ≠ 没有别的）——dual-copy 文件冲突（.claude/workflows/* ↔ plugin/workflows/*
// 须字节一致，⛔ 语义并集会发散两副本）、ff-not-fast-forward（suite 长跑期间 develop 又进新落地 ⇒
// 任务分支落后 develop）、modify/delete（一侧删一侧改）。AC1/AC2/AC4 钉住 prompt 里三型消解指令，
// 删掉任一条 ⇒ 测试红（AC3 能取假）。

test("gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward — AC1/AC2/AC3/AC4 (能取假): buildContinueWorkerPrompt teaches dual-copy byte-identical sync / ff re-merge / modify-delete deletion-side", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at step=ff: CONFLICT (content): Merge conflict in .claude/workflows/fan-in-execute.js",
  });
  // AC1 (dual-copy): 冲突时两副本同步字节一致，⛔ 不语义并集（并集让两副本发散）。
  assert.match(p, /dual-copy/, "AC1: prompt names the dual-copy file type (.claude/workflows/* ↔ plugin/workflows/*)");
  assert.match(p, /byte-identical/, "AC1: dual-copy conflict ⇒ re-sync BOTH copies byte-identical");
  assert.match(p, /do NOT take a semantic union/, "AC1: dual-copy conflict ⇒ ⛔ not semantic union (would diverge the two copies)");
  // AC2 (ff): ff-not-fast-forward 时先 merge develop 再 ff，⛔ 不重实现。
  assert.match(p, /not fast-forward/, "AC2: prompt names the ff-not-fast-forward failure");
  assert.match(p, /merge develop again/, "AC2: ff-not-fast-forward ⇒ merge develop again before the driver re-runs ff");
  assert.match(p, /do NOT re-implement/, "AC2: ff-not-fast-forward ⇒ ⛔ no re-implementation (branch-lag, not a code defect)");
  // AC4 (modify/delete): 判删除侧——分支删（有替代实现）⇒ 接受删除 git rm；develop 删 ⇒ 接受删除 git rm。
  assert.match(p, /modify\/delete/, "AC4: prompt names the modify/delete conflict type");
  assert.match(p, /judge WHICH side deleted/, "AC4: modify/delete ⇒ judge which side deleted");
  assert.match(p, /git rm/, "AC4: modify/delete ⇒ accept the deletion with git rm");
  assert.match(p, /never silently restore the deleted file/, "AC4: ⛔ never revive the deleted file");
});

test("gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward — 结构面 (能取假): worker-driver.ts 三型消解指令无残留/无遗漏", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 三型各自的关键指令都在（改掉任一 ⇒ 红）。
  assert.match(src, /byte-identical/, "dual-copy sync instruction present in source");
  assert.match(src, /not fast-forward/, "ff-not-fast-forward instruction present in source");
  assert.match(src, /modify\/delete/, "modify/delete instruction present in source");
  assert.match(src, /judge WHICH side deleted/, "modify/delete deletion-side judgment present in source");
});

// ── gap-continue-conflict-rule-missing-task-files ─────────────────────────────────────────────
// 冲突消解协议 6 条 + 1 FF 段无一点名 tasks/*.md，相邻 3 条（outline / dual-copy / tick doc）逐字教
// 「取 develop 版」——worker 把任务文件类比成 doc 会静默抹掉自己这一轮勾上的 - [x] AC 与 ## Evidence，
// 且抹掉后与正确解同形（下一轮 ac-precheck 才红，理由误导为「AC 未勾」而非「合并把它抹了」）。
// 修法：新增 (2b) 任务文件规则——per-hunk 取并集（保留 develop 侧 Touches/Needs-Human/status: +
// 分支侧 AC 勾选/Evidence），⛔ 不取 develop 版、⛔ 不手写 status: frontmatter（status: 冲突取 develop
// 值）。删掉该规则 ⇒ 测试红（AC5 能取假）。

test("gap-continue-conflict-rule-missing-task-files — AC1/AC2/AC3 (能取假): buildContinueWorkerPrompt teaches per-hunk union for tasks/<id>.md (⛔ not take-develop, ⛔ not write status:)", () => {
  const p = buildContinueWorkerPrompt("gap-x", "/r", {
    worktreePath: "/wt",
    branchCommits: 3,
    branchHeadSubject: "implement gap-x",
    acChecked: 2,
    acTotal: 5,
    failureReason: "mechanical fan-in red at merge develop (CONFLICT in tasks/gap-x.md)",
  });
  // AC1 (规则落地): prompt 点名任务文件类。
  assert.match(p, /tasks\/<id>\.md/, "AC1: prompt names the task-file type (tasks/<id>.md)");
  // AC2 (并集 + 保留 AC/Evidence + 禁取 develop 版)。
  assert.match(p, /per-hunk union/, "AC2: task-file conflict ⇒ per-hunk union of both sides");
  assert.match(p, /keep your branch's edits/, "AC2: keep the branch's edits (its - [x] AC ticks + ## Evidence additions)");
  assert.match(p, /## Evidence/, "AC2: keep the branch's ## Evidence additions");
  assert.match(p, /do NOT "take the develop version"/, "AC2: ⛔ explicitly forbids take the develop version");
  // AC3 (status: 例外 + 写所有权一致)。
  assert.match(p, /frontmatter yourself/, "AC3: ⛔ do not write status: frontmatter (worker doesn't own frontmatter)");
  assert.match(p, /take develop's value verbatim/, "AC3: status: conflict ⇒ take develop's value (write-ownership separation)");
});

test("gap-continue-conflict-rule-missing-task-files — 结构面 (能取假): worker-driver.ts 任务文件规则无残留/无遗漏", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  assert.match(src, /tasks\/<id>\.md/, "task-file rule present in source (grep tasks/ in function body)");
  assert.match(src, /per-hunk union/, "per-hunk union instruction present in source");
  assert.match(src, /frontmatter yourself/, "status: write-ownership exception present in source");
  assert.match(src, /take develop's value verbatim/, "status: take-develop-value exception present in source");
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

test("B (能取假, 结构面) — reason 读 mechanical_fan_in（已上收 driver-filters.ts）；A 的 derived 重算逻辑无残留", () => {
  // 读法已上收 driver-filters.ts（gap-needs-human-note-carries-step-verdict：markNeedsHuman 注记与 worker
  // 续做 prompt 共用同一读法）。worker-driver.ts 只 re-export，⛔ 不残留第二份实现。
  const src = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "driver-filters.ts"), "utf8");
  assert.match(src, /formatExitedNotLandedReason/, "B: reason formatting reads mechanical_fan_in");
  assert.match(src, /mechanical_fan_in/, "B: lastExitedNotLandedReason reads the mechanical_fan_in field");
  const wsrc = fs.readFileSync(DRIVER, "utf8");
  // A 已退役（superseded by gap-delivery-inventory-check-time-computation）：⛔ 不残留 derived 重算逻辑
  // （OUTLINE_DOC_REL 常量 / resolveDerivedMergeConflict / DERIVED_CONFLICT_FILES 会引用已删除的 §6 快照 + 退役 flag）。
  assert.doesNotMatch(wsrc, /OUTLINE_DOC_REL/, "A retired: no OUTLINE_DOC_REL import");
  assert.doesNotMatch(wsrc, /resolveDerivedMergeConflict/, "A retired: no derived-recompute resolver");
  assert.doesNotMatch(wsrc, /DERIVED_CONFLICT_FILES/, "A retired: no derived file set");
});

// ── gap-worker-execution-history-index-not-reachable-from-task（B：续做历史 + suite 日志路径）──────
// B 缺口的病根：续做 prompt 只带一句 reason（lastExitedNotLandedReason 只取最后一条）⇒ 重跑 worker 看不到
// 前两次栽在哪、也看不到日志路径。修法：exitedNotLandedAttempts 收集全部尝试；buildContinueWorkerPrompt
// 带前 N 次 (ts,step,reason) 清单 + .quay/fan-in-suite- 绝对路径。

test("B (能取假) — exitedNotLandedAttempts 收集全部尝试（⛔ 只取最后一条 ⇒ 假）", () => {
  const root = makeRoot("history-b");
  const suiteLogName = "fan-in-suite-gap-hb-run2.log";
  fs.writeFileSync(path.join(root, ".quay", suiteLogName), "suite true-cause\n", "utf8");
  fs.appendFileSync(path.join(root, WORKER_OUTCOME_REL), [
    JSON.stringify({ ts: "2026-09-01T03:44:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-1", mechanical_fan_in: { outcome: "red", step: "anti-drift", reason: "8 violations", fanInLog: "fan-in-gap-hb-run2.log" } }),
    JSON.stringify({ ts: "2026-09-01T04:21:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-2", mechanical_fan_in: { outcome: "red", step: "ac-precheck", reason: "0/3 fail-fast", fanInLog: "fan-in-gap-hb-run2.log" } }),
    JSON.stringify({ ts: "2026-09-01T04:57:00.000Z", task: "gap-hb", final_state: "exited-not-landed", run_id: "wk-prod-1788218643", session_id: "sess-3", mechanical_fan_in: { outcome: "red", step: "suite", reason: "suite red", fanInLog: "fan-in-gap-hb-run2.log", suiteLog: suiteLogName } }),
  ].join("\n") + "\n", "utf8");

  const attempts = exitedNotLandedAttempts(root, "gap-hb");
  assert.equal(attempts.length, 3, "全部 3 次 exited-not-landed 都在清单里（⛔ 只取最后一条 ⇒ 假）");
  assert.deepEqual(attempts.map((a) => a.step), ["anti-drift", "ac-precheck", "suite"], "三次的失败步都在");
  assert.equal(attempts[2].suiteLog, path.join(root, ".quay", suiteLogName), "suite 日志还原成绝对路径");
  assert.equal(attempts[2].runId, "wk-prod-1788218643", "run_id 读数");
  assert.equal(attempts[2].sessionId, "sess-3", "session_id 读数");
  assert.ok(attempts.slice(0, 2).every((a) => a.suiteLog === null), "非 suite 步 suiteLog null（⛔ 误设 ⇒ 假）");
  assert.equal(attempts[0].fanInLog, path.join(root, ".quay", "fan-in-gap-hb-run2.log"), "fan-in 日志还原成绝对路径");
});

test("B (能取假) — buildContinueWorkerPrompt 带前 N 次 (ts,step,reason) 清单 + .quay/fan-in-suite- 绝对路径（在盘）", () => {
  const root = makeRoot("history-prompt");
  const suiteLogName = "fan-in-suite-gap-hp-r9.log";
  fs.writeFileSync(path.join(root, ".quay", suiteLogName), "true cause\n", "utf8");
  const suiteAbs = path.join(root, ".quay", suiteLogName);
  const attempts = [
    { ts: "2026-09-01T03:44:00.000Z", runId: "r", sessionId: "s1", step: "anti-drift", reason: "step=anti-drift: 8 violations", fanInLog: null, suiteLog: null },
    { ts: "2026-09-01T04:57:00.000Z", runId: "r", sessionId: "s2", step: "suite", reason: "step=suite: suite red", fanInLog: null, suiteLog: suiteAbs },
  ];
  const p = buildContinueWorkerPrompt("gap-hp", root, {
    worktreePath: "/wt",
    branchCommits: 1,
    branchHeadSubject: null,
    acChecked: 0,
    acTotal: 3,
    failureReason: "step=suite: suite red",
    attempts,
  });
  assert.match(p, /step=anti-drift: 8 violations/, "清单含第 1 次 (step,reason)（剥掉重复 step= 前缀）");
  assert.match(p, /step=suite: suite red/, "清单含第 2 次 (step,reason)");
  assert.doesNotMatch(p, /step=anti-drift: step=anti-drift/, "⛔ 清单不重复 step= 前缀");
  assert.match(p, /\.quay\/fan-in-suite-/, "含 .quay/fan-in-suite- 字面路径");
  assert.ok(p.includes(suiteAbs), `含 suite 日志绝对路径 ${suiteAbs}`);
  assert.ok(fs.existsSync(suiteAbs), "该路径在盘上存在（AC2 判据）");
});

