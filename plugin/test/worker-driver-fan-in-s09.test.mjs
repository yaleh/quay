// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { after, assert, assertionSignaturesFromSuiteLog, extractFailureSummary, extractFirstFailureLine, fanInLogFileName, fs, makeMechRepo, makeReuseRepo, mechOpts, pairedEndCount, path, readSharedTrace, readSuiteLogUntil, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

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
