// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/6 (17 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { SUITE_LOG_NOT_RUN_PREFIX, after, assert, assertionSignaturesFromSuiteLog, extractFailureSummary, extractFirstFailureLine, extractSuiteNotRunLine, fanInLogFileName, fs, makeMechRepo, markNeedsHuman, mechOpts, pairedEndCount, path, readSharedTrace, readSuiteLogUntil, rmSafe, runMechanicalFanIn, suiteLogFileName, waitFor } from "./helpers/worker-driver-fan-in-harness.mjs";

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
