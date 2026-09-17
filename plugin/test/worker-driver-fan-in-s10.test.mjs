// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 10/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).
// FURTHER SPLIT by gap-suite-split-15-over-30s-test-files — shards s11 (verification-round 台账/第三方形态), s12 (看门狗 SIGKILL 轮台账), s13 (landed 后 prune attempt 日志) carved out; this file keeps the needs-human reason-extraction + suite-refusal clusters.

import { test } from "node:test";
import { SUITE_LOG_NOT_RUN_PREFIX, assert, extractSuiteNotRunLine, fanInLogFileName, fs, makeMechRepo, markNeedsHuman, mechOpts, path, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

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
