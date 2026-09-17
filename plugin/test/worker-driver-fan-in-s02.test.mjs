// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/6 (17 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { EXEMPT_TEST, MAX_FIX_RETRIES_DEFAULT, RETRY_CAP_DEFAULT, RETRY_EXEMPTION_WINDOW_MS_DEFAULT, advanceRetryCap, after, appendOtherSuiteRed, applyTaskFilters, assert, assertionSignaturesFromSuiteLog, branchHeadSubjectAsync, computeWorkerRoundRecord, continueStateForTask, continueStateForTaskAsync, countBranchCommitsAsync, counterNodeE, failingTestFilesFromSuiteLog, fs, judgeRetryExemption, makeFilterContext, makeGitRoot, makeRoot, markNeedsHuman, parseMaxRetries, path, promoAdvanceRetryCap, promoMarkNeedsHuman, readOutcomeLines, readRoundLines, readTaskStatus, rmSafe, runGit, spawn, spawnResident, waitFor, workerArgvForTaskAsync, workerPromptForTaskAsync, worktreePresentForTaskAsync, writeExemptionTask, writeFailingTest, writeProfileCarrier, writeSuiteRedLog, writeTaskFile, writeTouchedTask } from "./helpers/worker-driver-fan-in-harness.mjs";

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
