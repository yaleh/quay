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
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  docCheckCommandFor,
  resolveScopedGateCommand,
  defaultMechanicalSuiteCommand,
  // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径（suite 委托 loop.test_command）
  // 的 verification-round 入账判定 + 补写（复用 shared writer，⛔ 不新造第三个 writer）。
  suiteRunsOutsideRunner,
  appendDelegatedSuiteRound,
  // AC5 — 项目声明的输出约定（loop.test_output）的读面。
  readLoopTestOutput,
} from "../scripts/worker-driver.ts";
// fan-in 的 delta 判定三态映射（`CLASSIFY_FAILED` 哨兵 + 它到 code_delta 字符串的映射）——从它自己的
// 模块直接取（本文件既有做法：下面的 parseScopedThin/scopedGateVerdict 也走 worker-fan-in.ts 直 import）。
// ⛔ 不在这里另写一份「status === 0 就当没失败」——「不是 CLASSIFY_FAILED」这条断言必须走 fan-in 自己
// 那条路径（硬规则 5b）。
import { CLASSIFY_FAILED, classifyDeltaOutcome } from "../scripts/worker-fan-in.ts";
// scoped 门的输出契约 + 三态取值（gap-scoped-gate-thin-selection-not-same-shape-as-green）。直接 import
// 该模块（本仓库 test 的常规做法——worker-driver.ts 的 re-export 面是为【既有】测试的 import 面冻结的，
// 本任务新增的判据面不与它耦合）。
import { parseScopedThin, scopedGateVerdict, SCOPED_THIN_MARKER } from "../scripts/worker-fan-in.ts";
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
    suiteLog: "/nonexistent/suite.log", worktree: root, // 无 .quay/config.yml ⇒ 无声明（AC5 负控件同样覆盖）
  });
  assert.deepEqual(r1, { ok: true, reason: null, applied: null }, "追加成功（无声明 ⇒ applied=null）");

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
    suiteLog: "/nonexistent/suite.log", worktree: root,
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

// ── AC5（人 2026-09-12 裁定）：出口可配 + 项目【声明】的输出约定，quay 依声明解析 ──────────────────────
// 「只让入口可配而输出解析仍写死，是换了一个位置的同一个病」⇒ 判据必须落在【由真实输出派生的字段】上。
// 本组打印三者对照：配置声明 → 原始输出片段 → 落进记录的值。

test("AC5 正向 — 声明的输出约定驱动台账字段（配置声明 + 原始输出 + 记录值三者一致）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-out-third-party-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-out-root-"));
  t.after(() => { fs.rmSync(wt, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const DECL = `
loop:
  test_command: npx vitest run
  test_output:
    pass: 'Tests\\s+.*?(\\d+) passed'
    fail: 'Tests\\s+.*?(\\d+) failed'
`;
  writeFile(path.join(wt, ".quay", "config.yml"), DECL);
  // 项目【自己的】输出形状（vitest），⛔ 不是 quay 自己的 node:test `ℹ pass N` 形状——带 ANSI 着色
  // （真实管道输出常带色；归一化缺了它声明就会「读到了却解析不出」，正是 AC5 要挡的假绿）。
  const ESC = String.fromCharCode(27);
  const RAW = `${ESC}[32m      Tests${ESC}[39m  ${ESC}[31m2 failed${ESC}[39m | ${ESC}[32m345 passed${ESC}[39m (347)`;
  const log = path.join(wt, "suite.log");
  fs.writeFileSync(log, RAW + "\n", "utf8");

  // ① 配置声明被读成什么
  const declared = readLoopTestOutput(wt);
  assert.deepEqual(
    declared,
    { pass: String.raw`Tests\s+.*?(\d+) passed`, fail: String.raw`Tests\s+.*?(\d+) failed` },
    "loop.test_output 声明被读成字段→正则",
  );
  // ② + ③ 落进记录的值
  const r = appendDelegatedSuiteRound({
    task: "TASK-88", runId: "mfi-TASK-88-test-output", root, commit: "b".repeat(40),
    startedAt: "2026-09-12T10:56:38.000Z", durationMs: 271332, state: "green",
    suiteLog: log, worktree: wt,
  });
  assert.equal(r.ok, true, `append ok (${r.reason})`);
  assert.deepEqual(r.applied, { pass: 345, fail: 2, tests: 347 }, "回报实际应用到的派生字段");
  const rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").trim());
  assert.equal(rec.pass, 345, "记录 pass = 原始输出里的 345 passed（由声明派生，⛔ 非默认值）");
  assert.equal(rec.fail, 2, "记录 fail = 原始输出里的 2 failed");
  assert.equal(rec.tests, 347, "记录 tests = pass+fail（与 full-suite-runner 同口径）");
});

test("AC5 负控制 — 无声明 ⇒ 内建形状解析（vitest 输出解析不出 ⇒ 字段缺席，⛔ 不写 0）；声明不匹配同样缺席", (t) => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-out-bare-"));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  writeFile(path.join(bare, ".quay", "config.yml"), "loop:\n  test_command: npx vitest run\n");
  assert.equal(readLoopTestOutput(bare), null, "未声明 ⇒ null（调用方退回内建解析）");
  // 声明的形状校验：非字符串 / 空串 / 非对象 ⇒ 不算有效声明
  writeFile(path.join(bare, ".quay", "config.yml"), "loop:\n  test_output:\n    pass: ''\n    fail: 3\n");
  assert.equal(readLoopTestOutput(bare), null, "空串/非字符串值 ⇒ 无有效声明（⛔ 不当成「配了」）");
  writeFile(path.join(bare, ".quay", "config.yml"), "loop:\n  test_output: vitest\n");
  assert.equal(readLoopTestOutput(bare), null, "非对象声明 ⇒ null");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-out-root2-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ESC = String.fromCharCode(27);
  const log = path.join(bare, "suite.log");
  fs.writeFileSync(log, `${ESC}[32m      Tests${ESC}[39m 2 failed | 345 passed (347)\n`, "utf8");

  // 无声明：内建（node:test 形状）解析在 vitest 输出上解析不出 ⇒ 三个计数字段【缺席】（⛔ 不是 0）
  const r1 = appendDelegatedSuiteRound({
    task: "T1", runId: "r1", root, commit: "c".repeat(40), startedAt: "2026-09-12T10:00:00.000Z",
    durationMs: 1000, state: "green", suiteLog: log, worktree: bare,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.applied, null, "无声明 ⇒ applied=null（走内建解析，可区分于「声明了没匹配」）");
  let rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").trim());
  for (const f of ["pass", "fail", "tests"]) {
    assert.equal(rec[f], undefined, `无声明时 ${f} 缺席（⛔ 不伪造 0——「没测到」与「测得 0」不可同形）`);
  }
  // 声明有效但一条都没匹配上：同样缺席，但 applied={} 让「声明了没匹配」与「没声明」在记录上可分
  writeFile(path.join(bare, ".quay", "config.yml"), "loop:\n  test_output:\n    pass: 'NOTHING(\\\\d+)'\n");
  const r2 = appendDelegatedSuiteRound({
    task: "T1", runId: "r2", root, commit: "c".repeat(40), startedAt: "2026-09-12T10:05:00.000Z",
    durationMs: 1000, state: "green", suiteLog: log, worktree: bare,
  });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.applied, {}, "声明了但没匹配 ⇒ applied={}（与 null 可分，硬规则 3b）");
  const lines = fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").trim().split("\n");
  rec = JSON.parse(lines[1]);
  assert.equal(rec.pass, undefined, "声明没匹配 ⇒ 字段仍缺席（⛔ 不退回伪造/默认值）");
  assert.equal(rec.state, "green", "轮次本身照常入账（观测字段缺失不阻塞台账）");
});

// ── gap-scoped-gate-thin-selection-not-same-shape-as-green — scoped 命令的【输出契约】+ 三态取值 ──────
// 缺陷：scoped 命令取零个测试文件时 exit 0（生产实例 claudecodeui `scripts/test.sh:114`
// `no scoped test files for <id> (thin)` + exit 0），fan-in 把它记成与「真评了 ≥1 个文件且全绿」
// 【同形】的 ok:true。契约面是双向的：命令侧打 `SCOPED-THIN selected=<n>`（第三方遵循的接口），
// fan-in 侧读它并记 `not-evaluated`——⛔ 不记 green，也⛔ 不当失败。两者按同一处判定（本文件的
// 读面就是 fan-in 的读面，⛔ 测试里不另写一个解析器假装读者）。

test("AC1 (gap-scoped-gate-thin…) — thin 标记按【位置】判定：行首命中 ⇒ thin；正文里提到（非行首）⇒ 不算", () => {
  assert.equal(SCOPED_THIN_MARKER, "SCOPED-THIN", "契约标记逐字（第三方照此实现）");
  // ① 契约形（第三方会照抄的那一行）⇒ thin，并取出 selected
  assert.deepEqual(parseScopedThin("SCOPED-THIN selected=0\n"), { thin: true, selected: 0, detail: "selected=0" });
  // 前导空白、前后其它输出行都不影响（trim 后【行首】命中即算——契约与噪声并存时仍可读）
  assert.equal(parseScopedThin("some noise\n  SCOPED-THIN selected=0  \n").thin, true);
  // ② 只打标记、没写计数 ⇒ selected=null（⛔ 不伪造成 0：「没写计数」与「评了 0 个」不同形）
  assert.equal(parseScopedThin("SCOPED-THIN\n").thin, true);
  assert.equal(parseScopedThin("SCOPED-THIN\n").selected, null);
  // ③ 负控制（按位置判定，硬规则 2）：标记只出现在行【中间】（正文/日志提到它）⇒ 不算命中
  assert.equal(parseScopedThin("note: SCOPED-THIN is a quay contract\n").thin, false);
  // 第三方【自造】措辞不构成契约命中——⛔ 不去猜别人的自由文本（那会让判定依赖措辞而不是接口）
  assert.equal(parseScopedThin("no scoped test files for X (thin)\n").thin, false);
  // 无输出 / 普通成功输出 ⇒ 不 thin（⇒ 与修复前的「真评了」同形，本任务不改变这条路径）
  assert.equal(parseScopedThin("").thin, false);
  assert.equal(parseScopedThin("# pass 3\n# fail 0\n").thin, false);
});

test("AC2 (gap-scoped-gate-thin…) — scopedGateVerdict 三态两两不同形；not-evaluated 的两条来源各带出处", () => {
  // not-evaluated 的两条来源（thin / 未声明该能力）各自带可区分的出处
  assert.deepEqual(scopedGateVerdict({ state: "run", ok: true, output: "SCOPED-THIN selected=0\n" }),
    { verdict: "not-evaluated", reason: "scoped-thin(selected=0)" });
  assert.deepEqual(scopedGateVerdict({ state: "skip", skipReason: "third-party-no-scoped-tooling" }),
    { verdict: "not-evaluated", reason: "third-party-no-scoped-tooling" });
  // green / red —— 真评了才有这两个取值
  assert.deepEqual(scopedGateVerdict({ state: "run", ok: true, output: "# pass 3\n" }), { verdict: "green", reason: null });
  assert.deepEqual(scopedGateVerdict({ state: "run", ok: false, output: "# fail 1\n" }), { verdict: "red", reason: null });
  // 缓存命中 ⇒ green（worker 已对着【同一 develop tip】评过绿），出处写在 reason 里（⛔ 不是「没评」）
  assert.deepEqual(scopedGateVerdict({ state: "cache-hit" }), { verdict: "green", reason: "cache-hit(worker-premerge)" });

  // 三态两两不同形（硬规则 3b：第三态不得与「合格」共用取值）
  const thin = scopedGateVerdict({ state: "run", ok: true, output: "SCOPED-THIN selected=0\n" });
  const green = scopedGateVerdict({ state: "run", ok: true, output: "" });
  const red = scopedGateVerdict({ state: "run", ok: false, output: "" });
  assert.deepEqual([thin.verdict, green.verdict, red.verdict], ["not-evaluated", "green", "red"]);
  assert.equal(new Set([thin.verdict, green.verdict, red.verdict]).size, 3, "三态两两不同形");
  assert.notDeepEqual(thin, green, "「没评成」与「评了且全绿」不同形（⛔ 修复前二者在记录上同形）");
  assert.notEqual(thin.reason, null, "not-evaluated 恒带出处");
  assert.equal(green.reason, null, "green 无 reason（与修复前逐字同形，⛔ 不给通过步加噪声）");
  // 非零退出 + thin 标记 ⇒ red（fail-closed：真失败的命令就是真失败，⛔ 不让「它说自己没评」洗白它）
  assert.equal(scopedGateVerdict({ state: "run", ok: false, output: "SCOPED-THIN selected=0\n" }).verdict, "red");
});

// ── fan-in delta 分类在第三方面（gap-fan-in-delta-classify-declared-doc-surfaces）─────────────────────
// 缺陷：fan-in step 4 用 `--classify-delta --root <worktree>` 判「本分支 delta 是否只剩 doc 面 ⇒ 可跳过
// 全量 suite」，而该分类【唯一】的判据曾是 quay 自己的检查注册表（runner-static-gate.ts）。第三方项目
// 不携带它 ⇒ exit 2 ⇒ worker-fan-in 的 CLASSIFY_FAILED ⇒ 每个非空 delta 都跑全量 suite（生产读数：
// claudecodeui 177 次判定里 11 次）。项目自己的「修法」是把 quay 的注册表副本提交进自己的仓库
// （claudecodeui f7604c68）——那不是修复，那是让 quay 的检查器清单去判一个外国仓库的 doc/code 划分。
//
// 修法：分类器读【本项目显式声明】的 `loop.doc_surfaces`；未声明时用与布局无关的保守缺省（只有
// quay 自己会写入的面算 doc）。三态取值：registry / declared / conservative-default。
//
// 这里 spawn【真分类器】（与 fan-in 逐字同一条命令），而不是在测试里重写一份判定（硬规则 5b）；
// `CLASSIFY_FAILED` / `classifyDeltaOutcome` 从 worker-fan-in.ts 直接取——「不是 CLASSIFY_FAILED」这条
// 断言用的是 fan-in 自己的三态映射，⛔ 不是测试里另写的 `status === 0` 假装同义。

const CLASSIFIER = fileURLToPath(new URL("../scripts/select-static-checks-for-touches.ts", import.meta.url));

/** Run the REAL fan-in classification command against `root` for `paths`. */
function classifyDeltaCli(root, paths) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", CLASSIFIER, "--classify-delta", "--root", root, ...paths],
    { encoding: "utf8", timeout: 120_000 },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 一个第三方面夹具：只有 `.quay/config.yml`（第三方项目不携带 quay 的检查注册表）。 */
function makeThirdPartyTree(t, configBody) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-classify-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  writeFile(path.join(wt, ".quay", "config.yml"), configBody);
  // 夹具的【否定前提】：quay 的检查注册表确实不在（旧实现的死因）。这条断言让夹具可证伪——
  // 若某天它被放进来了，下面的用例就不再证明「无注册表也能判」。
  assert.ok(
    !fs.existsSync(path.join(wt, "plugin", "scripts", "runner-static-gate.ts")) &&
      !fs.existsSync(path.join(wt, "scripts", "runner-static-gate.ts")),
    "第三方面夹具不得携带 quay 的检查注册表",
  );
  return wt;
}

test("AC1 (gap-fan-in-delta-classify…) — 声明的 loop.doc_surfaces 第三方 worktree：doc 面跳过、code 面重跑，且【不是】CLASSIFY_FAILED", (t) => {
  const wt = makeThirdPartyTree(t, 'loop:\n  doc_surfaces: ["docs/", "tasks/"]\n');

  // ① doc 面：声明的两个前缀 ⇒ code_delta 为空 ⇒ fan-in 跳过全量 suite。
  const docOnly = classifyDeltaCli(wt, ["docs/a.md", "tasks/t.md"]);
  assert.equal(docOnly.status, 0, `无注册表的树必须仍给出结论（exit 0）：${docOnly.stderr}`);
  assert.equal(docOnly.stdout.trim(), "", "声明的 doc 前缀 ⇒ 输出为空（整个 delta 都是 doc）");
  assert.equal(
    classifyDeltaOutcome(docOnly.status === 0, docOnly.stdout),
    "",
    "经 fan-in 的三态映射 ⇒ doc-only（⛔ 不是 CLASSIFY_FAILED 的 fail-closed 重跑）",
  );

  // ② code 面：未声明的路径 ⇒ 判 code ⇒ fan-in 重跑全量 suite（fail-closed 方向不变）。
  const code = classifyDeltaCli(wt, ["server/x.ts"]);
  assert.equal(code.status, 0, `未声明路径同样是【判决】而不是「没判出来」：${code.stderr}`);
  assert.deepEqual(code.stdout.trim().split("\n"), ["server/x.ts"]);
  const mapped = classifyDeltaOutcome(code.status === 0, code.stdout);
  assert.equal(mapped, "server/x.ts", "code_delta 就是该路径本身");
  assert.notEqual(mapped, CLASSIFY_FAILED, "⛔ 分类器给出了结论，不是「没判出来」");
});

test("AC2 负控 (gap-fan-in-delta-classify…) — 未声明 loop.doc_surfaces 的第三方 worktree：保守缺省判 docs/ 为 code，且分类仍有结论", (t) => {
  // 与上一条唯一的不同：没有 doc_surfaces 声明（但 config 存在且有别的 loop 键——第三方项目的常态）。
  const wt = makeThirdPartyTree(t, "loop:\n  test_command: node --test\n");

  const r = classifyDeltaCli(wt, ["docs/a.md", "tasks/t.md", "server/x.ts"]);
  assert.equal(r.status, 0, `保守缺省同样给出结论：${r.stderr}`);
  // 【枚举，不布尔】把整份输出对出来：docs/ 未被声明 ⇒ code（保守缺省）；tasks/ 是 fan-in 自己的任务
  // 文件面，任何模式下都是 doc；server/x.ts 是 code。
  assert.deepEqual(r.stdout.trim().split("\n").sort(), ["docs/a.md", "server/x.ts"]);
  assert.notEqual(
    classifyDeltaOutcome(r.status === 0, r.stdout),
    CLASSIFY_FAILED,
    "「未声明」不是「判不出」——保守缺省是一个判决（⛔ 旧实现在这里 exit 2）",
  );
});

test("负控 (gap-fan-in-delta-classify…) — 本仓库自身（携带注册表）：注册表判定不被声明面取代", (t) => {
  // 反向面：本仓库继续用注册表判定（doc 面的定义是「没有 change/full 检查器读它」），既有分类不回归。
  // 取假样本：orchestration/manager-tick-core.md 被 tick-core-static-check 读（@static-object），必须
  // 仍是 CODE——若声明面把它翻成 doc，一个 (src:N) 违规就能静默跳过全量 suite。
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const r = classifyDeltaCli(repo, [
    "orchestration/manager-tick-core.md",
    "docs/proposals/does-not-need-to-exist.md",
    "tasks/gap-x.md",
  ]);
  assert.equal(r.status, 0, `本仓库自身必须照常分类：${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split("\n"), ["orchestration/manager-tick-core.md"], "检查器读的路径仍是 code，纯文档面仍是 doc");
});
