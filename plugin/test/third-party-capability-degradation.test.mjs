// @test-group engine
// third-party-capability-degradation.test.mjs — gap-ac227-third-party-capability-degradation（AC-227 判据
// 的机器判定面）。GOAL-012 退出条件②④：fan-in 的 doc-check / scoped-gate / suite 三步在【第三方面】
// （无 scripts/test.sh）必须各产一个「能力不存在」的独立取值（可区分的 skipped/capability-absent），
// 且不以 exit 127 形态出现；反向【本仓库面】（有 scripts/test.sh）三步仍真跑、命令与迁移前逐字一致、
// 降级不回流污染。
//
// hermetic：自建 mkdtemp 目标 + 直接调用命令构造/降级判定函数，⛔ 不读 .quay/fan-in-step-trace.jsonl
// 等生产载体、⛔ 不 spawn 真实 fan-in（真实世界证明归 GOAL-009 AC-207，周期复证归例行监控——人
// 2026-09-10 裁定②两轨）。
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/third-party-capability-degradation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  docCheckCommandFor,
  resolveScopedGateCommand,
  defaultMechanicalSuiteCommand,
  // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径（suite 委托 loop.test_command）
  // 的 verification-round 入账判定 + 补写（复用 shared writer，⛔ 不新造第三个 writer）。
  suiteRunsOutsideRunner,
  appendDelegatedSuiteRound,
} from "../scripts/worker-driver.ts";
// /tests 页自己的读者（同一载体 verification-round.jsonl 的读面）——「web 面能看到这一轮」的机器判定面，
// 与写面同源、⛔ 不在测试里另写一个 JSON.parse 假装读者（硬规则 5b：写面修了读面也要走同一实现的判据）。
import { readTests } from "../../packages/quay/src/observation.ts";

/** 写文件（mkdir -p 父目录）。 */
function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

// ── 正向：第三方面（无 scripts/test.sh、只有 loop.test_command）───────────────────────────────────────

test("正向 hermetic — 第三方面三步各产「能力不存在」独立取值，且 argv 不含 exit 127", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-third-party-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  // 自建一致性目标：只有 .quay/config.yml 的 loop.test_command，⛔ 无 scripts/test.sh。
  writeFile(path.join(wt, ".quay", "config.yml"), "loop:\n  test_command: node --test\n");

  // ① doc-check —— 能力不存在 ⇒ null（skip，可区分独立取值，⛔ 不与「doc 检查跑了且失败」同形）。
  const docCmd = docCheckCommandFor(wt);
  assert.equal(docCmd, null, "doc-check 能力不存在 ⇒ null（skip 独立取值）");

  // ② scoped-gate —— scoped 能力不存在 ⇒ 委托 loop.test_command（⛔ 非 scripts/test.sh）。
  const scoped = resolveScopedGateCommand("gap-cap-deg", wt, wt);
  assert.equal(scoped.kind, "run", "有 test_command ⇒ 委托（run），⛔ 不是 skip");
  assert.deepEqual(
    scoped.argv,
    ["bash", "-c", `cd '${wt}' && node --test`],
    "scoped-gate 委托 test_command（cd 进 worktree），⛔ 非 scripts/test.sh",
  );
  assert.ok(!scoped.argv.some((a) => a.includes("scripts/test.sh")), "⛔ 不得引用 scripts/test.sh");

  // ③ suite —— suite 能力不存在 ⇒ 委托 loop.test_command（⛔ 非 full-suite-runner）。
  const suiteCmd = defaultMechanicalSuiteCommand({
    task: "gap-cap-deg",
    worktree: wt,
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite.log",
    runId: "mfi-gap-cap-deg-1788022868-abc123",
  });
  assert.deepEqual(
    suiteCmd,
    ["bash", "-c", `cd '${wt}' && node --test`],
    "suite 委托 test_command（cd 进 worktree），⛔ 非 full-suite-runner",
  );
  assert.ok(!suiteCmd.some((a) => a.includes("full-suite-runner")), "⛔ 不得调用 full-suite-runner");

  // 三步 argv 均不含 exit 127（GOAL-012 退出条件②：能力不存在 ≠ 命令不存在）。
  assert.ok(
    scoped.argv.every((a) => !a.includes("exit 127")) && suiteCmd.every((a) => !a.includes("exit 127")),
    "scoped-gate/suite argv 不含 exit 127",
  );
});

// ── 反向：本仓库面（有 scripts/test.sh）—— 降级不回流污染 ─────────────────────────────────────────────

test("反向负控制 — 本仓库面三步与迁移前逐字一致（真跑，⛔ 降级不回流）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-quay-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  const testSh = path.join(wt, "scripts", "test.sh");

  // ① doc-check —— 真跑，逐字一致（bash <dir>/scripts/test.sh --static-checks-doc）。
  assert.deepEqual(
    docCheckCommandFor(wt),
    ["bash", testSh, "--static-checks-doc"],
    "doc-check 与迁移前逐字一致（⛔ 不降级为 null skip）",
  );

  // ② scoped-gate —— 真跑，逐字一致（bash <dir>/scripts/test.sh --for-task <task> --allow-thin）。
  const scoped = resolveScopedGateCommand("gap-cap-deg", wt, wt);
  assert.equal(scoped.kind, "run", "本仓库形态 ⇒ 真跑（⛔ 不降级 skip）");
  assert.deepEqual(
    scoped.argv,
    ["bash", testSh, "--for-task", "gap-cap-deg", "--allow-thin"],
    "scoped-gate 与迁移前逐字一致（⛔ 不委托 test_command）",
  );

  // ③ suite —— 真跑 full-suite-runner（⛔ 不降级到 test_command）。
  const suiteCmd = defaultMechanicalSuiteCommand({
    task: "gap-cap-deg",
    worktree: wt,
    root: "/tmp/root",
    suiteLogFile: "/tmp/fan-in-suite-gap-cap-deg.log",
    runId: "mfi-gap-cap-deg-1788022868-abc123",
  });
  assert.equal(suiteCmd[0], "node", "suite 是 node 入口");
  assert.ok(suiteCmd.includes("--no-warnings"), "suite 带 --no-warnings");
  assert.ok(
    suiteCmd.some((a) => a.endsWith("full-suite-runner.ts") || a.endsWith("full-suite-runner.js")),
    "suite 是 full-suite-runner（⛔ 不降级）",
  );
  assert.ok(suiteCmd.includes("--buckets") && suiteCmd.includes("gap-cap-deg"), "suite 带 --buckets <task>");
  assert.ok(suiteCmd.includes("--root") && suiteCmd.includes(wt), "suite 带 --root <worktree>");
  assert.ok(suiteCmd.includes("--state-dir") && suiteCmd.includes(path.join("/tmp/root", ".quay")), "suite 带 --state-dir <root>/.quay");
  assert.ok(suiteCmd.includes("--runner") && suiteCmd.includes("inner"), "suite 带 --runner inner");
  assert.ok(suiteCmd.includes("--log-file") && suiteCmd.includes("/tmp/fan-in-suite-gap-cap-deg.log"), "suite 带 --log-file <suiteLogFile>");
  assert.ok(suiteCmd.includes("--run-id") && suiteCmd.includes("mfi-gap-cap-deg-1788022868-abc123"), "suite 带 --run-id <runId>");
  assert.ok(!suiteCmd.some((a) => a.includes("scripts/test.sh")), "⛔ 不得平行跑 scripts/test.sh harness");
});

// ── gap-verification-round-bound-to-quay-shaped-suite-entry ──────────────────────────────────────────
// 台账写入与「suite 由谁跑」解耦：第三方项目（suite 由自己的 loop.test_command 跑 ⇒ 不经
// full-suite-runner）也必须产生 verification-round 行，否则 /tests 卡片恒显示「未接入」（质量门生效、
// 可观测面失效）。判据与写面【同源】：suiteRunsOutsideRunner（hasTestSh + readLoopTestCommand，与
// defaultMechanicalSuiteCommand / resolveScopedGateCommand 同一对谓词）。

test("正向 — 第三方路径判据：suite 不经 full-suite-runner ⇒ 台账须由本层补写（半初始化形态可区分）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-vr-third-party-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  writeFile(path.join(wt, ".quay", "config.yml"), "loop:\n  test_command: node --test\n");
  assert.equal(suiteRunsOutsideRunner(wt), true, "无 scripts/test.sh + 有 loop.test_command ⇒ 本层负责入账");

  // 半初始化（两者皆无）：没有 suite 可跑（命令是 fail-closed 的「无测试能力」exit 2）⇒ 没有「一轮
  // suite」可入账（⛔ 不与「第三方路径」同形，硬规则 3b 三态可分）。
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-vr-bare-"));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  assert.equal(suiteRunsOutsideRunner(bare), false, "两者皆无 ⇒ 无 suite 可跑，无轮可入账");
});

test("正向 — appendDelegatedSuiteRound 追加真记录，且 /tests 的读者能看见它（⛔ 不以文件存在为证据）", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-vr-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, ".quay", "verification-round.jsonl");
  // 前置 = 【缺陷现场】：载体不存在 ⇒ 读者报「未接入」。⚠️ 读面 readTests 有 30s TTL 缓存（per root，
  // 见 observation.ts VERIFICATION_ROUND_CACHE_TTL_MS）——所以「读前」不先调它（先调会把 empty 缓存住，
  // 追加后仍读回 empty，测出来的是缓存不是判据）；只断言载体不存在，读面在追加后调用一次。
  assert.equal(fs.existsSync(ledger), false, "前置：载体尚不存在（正是缺陷现场）");

  const commit = "a".repeat(40);
  const r1 = appendDelegatedSuiteRound({
    task: "TASK-88", runId: "mfi-TASK-88-1789210598105-e1ddad", root, commit,
    startedAt: "2026-09-12T10:56:38.000Z", durationMs: 271332, state: "green",
    suiteLog: "/nonexistent/suite.log",
  });
  assert.deepEqual(r1, { ok: true, reason: null }, "追加成功");

  const rec = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
  assert.equal(rec.taskId, "TASK-88", "taskId = 本轮 fan-in 的任务");
  assert.equal(rec.runId, "mfi-TASK-88-1789210598105-e1ddad", "runId = 本轮 fan-in 的 per-suite runId");
  assert.equal(rec.commit, commit, "commit = suite_head");
  assert.equal(rec.state, "green", "state 由调用方按 suite 结果给");
  assert.equal(rec.preverified, false, "preverified=false：suite 确在本轮 fan-in 内真跑（⛔ 非复用 capture）");
  assert.equal(rec.runner, "inner", "runner=inner（与同轮 full-suite-state 镜像同源）");
  assert.equal(rec.scope, "worktree", "scope=worktree");
  assert.equal(rec.cpu_time_s, null, "cpu_time_s 显式 null（第三方路径未测 CPU，⛔ 不写 0 冒充测得）");
  assert.equal(rec.cpu_source, "not-wired", "cpu_source 带出处");
  assert.equal(rec.round, 1, "round 从 1 起");

  // 读面：/tests 的读者（serve-tests.ts 用的同一个 readTests）不再报「未接入」，且拿到这一轮。
  const tests = readTests(root);
  assert.equal(tests.status, "ok", "读者状态 = ok（⛔ 不再 empty/未接入）");
  assert.equal(tests.runs.length, 1, "读者看到 1 轮");
  assert.equal(tests.runs[0].runId, "mfi-TASK-88-1789210598105-e1ddad", "读者看到的是这一轮的 runId");
  assert.equal(tests.runs[0].state, "green", "读者看到绿轮");

  // append-only + 红轮同样入账（「跑了且红」必须与「没跑过」可分）。
  const r2 = appendDelegatedSuiteRound({
    task: "TASK-88", runId: "mfi-TASK-88-1789210999999-ffffff", root, commit,
    startedAt: "2026-09-12T11:00:00.000Z", durationMs: 1000, state: "red",
    suiteLog: "/nonexistent/suite.log",
  });
  assert.equal(r2.ok, true, "红轮同样入账");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "append-only：两轮两行（⛔ 不覆盖）");
  assert.equal(JSON.parse(lines[1]).round, 2, "第二轮 round=2");
  assert.equal(JSON.parse(lines[1]).state, "red", "第二轮 state=red");
});

test("反向负控制 — 本仓库形态（有 scripts/test.sh）⇒ 新增写入者不在该路径上（runner 是唯一 writer）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-vr-quay-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  // 即使 .quay/config.yml 同时带 test_command（本仓库并不带），有 scripts/test.sh ⇒ suite 仍走
  // full-suite-runner（defaultMechanicalSuiteCommand 的分支次序）⇒ 台账由 runner 写，本层不得再写。
  writeFile(path.join(wt, ".quay", "config.yml"), "loop:\n  test_command: node --test\n");
  assert.equal(suiteRunsOutsideRunner(wt), false, "有 scripts/test.sh ⇒ 本层不补写（⛔ 不双写）");
});
