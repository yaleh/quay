// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { EXEMPT_TEST, MAX_FIX_RETRIES_DEFAULT, RETRY_CAP_DEFAULT, advanceRetryCap, after, appendOtherSuiteRed, applyTaskFilters, assert, computeWorkerRoundRecord, fs, judgeRetryExemption, makeFilterContext, makeGitRoot, makeRoot, markNeedsHuman, parseMaxRetries, path, promoAdvanceRetryCap, promoMarkNeedsHuman, readOutcomeLines, readRoundLines, readTaskStatus, rmSafe, spawn, spawnResident, waitFor, writeExemptionTask, writeFailingTest, writeSuiteRedLog, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

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
