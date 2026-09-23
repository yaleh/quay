// @test-group engine
// third-party-capability-degradation.test.mjs — gap-ac227-third-party-capability-degradation（AC-227 判据
// 的机器判定面）。GOAL-012 退出条件②④：fan-in 的 doc-check / scoped-gate / suite 三步在【未声明能力的项目面】
// 必须各产一个「能力不存在」的独立取值（可区分的 skipped/capability-absent），且不以 exit 127 形态出现；
// 反向【声明了契约的项目面】三步仍真跑、命令与迁移前逐字一致、降级不回流污染。
//
// ⚠️ 2026-09-23 更新（gap-repo-shape-inferred-from-test-sh-existence / AC-316 / GOAL-027）：「是不是本
// 仓库形态」的判据从【有没有 scripts/test.sh】改为【.quay/config.yml loop: 里声明了什么】。上面
// 「第三方面 / 本仓库面」现在分别由「未声明 / 声明了三个契约键」表达。⛔ 一个【带自己 scripts/test.sh
// 但没声明契约】的项目属于「未声明能力的项目面」——这正是本任务要修的现场（AC-316 正向用例）。
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
  // AC5 — 项目声明的输出约定（loop.test_output）的读面。
  readLoopTestOutput,
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

  // ② scoped-gate —— 未声明 loop.scoped_command ⇒ scoped 能力「未提供」⇒ skip（独立取值，⛔ 非 run）。
  // gap-repo-shape-inferred-from-test-sh-existence / AC-316：判据是【声明】。全量 test_command 不是
  // scoped 门——拿它冒充，会让「这个项目没有 scoped 能力」与「scoped 门跑了且绿」不可分（硬规则 3b）。
  const scoped = resolveScopedGateCommand("gap-cap-deg", wt, wt);
  assert.equal(scoped.kind, "skip", "未声明 scoped_command ⇒ skip（独立取值），⛔ 不是 run");
  assert.equal(scoped.reason, "no-scoped-command-declared");

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

  // suite argv 不含 exit 127（GOAL-012 退出条件②：能力不存在 ≠ 命令不存在）。
  assert.ok(suiteCmd.every((a) => !a.includes("exit 127")), "suite argv 不含 exit 127");
});

// ── 反向：本仓库面（有 scripts/test.sh）—— 降级不回流污染 ─────────────────────────────────────────────

test("反向负控制 — 本仓库面三步与迁移前逐字一致（真跑，⛔ 降级不回流）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-quay-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  const testSh = path.join(wt, "scripts", "test.sh");
  // gap-repo-shape-inferred-from-test-sh-existence / AC-316：本仓库形态现在由【声明】表达
  // （.quay/config.yml loop.scoped_command / doc_check_command / suite_runner），⛔ 文件存在不再参与判定。
  writeFile(path.join(wt, ".quay", "config.yml"),
    "loop:\n  suite_runner: quay-buckets\n" +
    '  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n' +
    '  doc_check_command: ["bash", "{worktree}/scripts/test.sh", "--static-checks-doc"]\n');

  // ① doc-check —— 真跑，逐字一致（bash <dir>/scripts/test.sh --static-checks-doc）。
  assert.deepEqual(
    docCheckCommandFor(wt),
    ["bash", testSh, "--static-checks-doc"],
    "doc-check 与迁移前逐字一致（⛔ 不降级为 null skip）",
  );

  // ② scoped-gate —— 真跑，逐字一致（bash <dir>/scripts/test.sh --for-task <task> --allow-thin）。
  const scoped = resolveScopedGateCommand("gap-cap-deg", wt, wt);
  assert.equal(scoped.kind, "run", "声明了 scoped_command ⇒ 真跑（⛔ 不降级 skip）");
  assert.deepEqual(
    scoped.argv,
    ["bash", testSh, "--for-task", "gap-cap-deg", "--allow-thin"],
    "scoped-gate 与迁移前逐字一致（⛔ 未委托 test_command）",
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

// ── gap-repo-shape-inferred-from-test-sh-existence / AC-316 ─────────────────────────────────────────
// 本缺陷的现场：一个项目【按 loop.test_command 的约定交付了自己的 scripts/test.sh】，于是旧判据
// （hasTestSh = 文件存在）把它整体当成 quay 仓库——scoped 门被拿 --for-task … --allow-thin 调用、doc-check
// 被拿 --static-checks-doc 调用，而它根本没有这两个能力：每一处对不上都表现为「读不出东西」而不报错
// （硬规则 3b）。新判据下，这个夹具的 scoped 门与 doc-check 都取「未提供」这个【独立取值】。

test("AC-316 正向 — 带自己 scripts/test.sh 但未声明契约的第三方 ⇒ scoped/doc-check 都「未提供」，⛔ 不调用 quay 专属参数", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-self-testsh-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  // 第三方项目【自己】的 scripts/test.sh（不是 quay 的），且只声明了 test_command。
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  writeFile(path.join(wt, ".quay", "config.yml"), "loop:\n  test_command: bash scripts/test.sh\n");

  // ① doc-check：未声明 ⇒ 独立取值 null（⛔ 不是 bash <wt>/scripts/test.sh --static-checks-doc）。
  assert.equal(docCheckCommandFor(wt), null, "未声明 doc_check_command ⇒ null（能力未提供）");

  // ② scoped 门：未声明 ⇒ skip（独立取值 no-scoped-command-declared）。
  const scoped = resolveScopedGateCommand("gap-cap-deg", wt, wt);
  assert.equal(scoped.kind, "skip", "未声明 scoped_command ⇒ skip（⛔ 不是 run）");
  assert.equal(scoped.reason, "no-scoped-command-declared");

  // ③ 关键否定断言（可证伪：前置证明旧判据【会】命中这个夹具）。旧判据 hasTestSh = 文件存在 ⇒ 会构造
  // 出下面两条把该项目当 quay 仓库的 argv；新判据下它们都没有被产出。
  const oldDocCheck = ["bash", path.join(wt, "scripts", "test.sh"), "--static-checks-doc"];
  const oldScoped = {
    kind: "run",
    argv: ["bash", path.join(wt, "scripts", "test.sh"), "--for-task", "gap-cap-deg", "--allow-thin"],
  };
  assert.equal(fs.existsSync(path.join(wt, "scripts", "test.sh")), true, "前置：scripts/test.sh 确实存在（旧判据会命中它）");
  assert.notDeepEqual(docCheckCommandFor(wt), oldDocCheck, "⛔ 不产出 --static-checks-doc 形态的 argv");
  assert.notDeepEqual(scoped, oldScoped, "⛔ 不产出 --for-task … --allow-thin 形态的 argv");
  assert.equal(scoped.kind === "run" ? scoped.argv : null, null, "skip ⇒ 没有任何 argv 可被 fan-in 执行");
  // ④ suite 仍走该项目自己声明的 test_command（能力对齐：全量测试是它【声明】有的）。
  assert.deepEqual(
    defaultMechanicalSuiteCommand({ task: "gap-cap-deg", worktree: wt, root: "/tmp/root", suiteLogFile: "/tmp/f.log", runId: "r1" }),
    ["bash", "-c", `cd '${wt}' && bash scripts/test.sh`],
    "suite 用项目自己声明的 loop.test_command",
  );
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

test("反向负控制 — 声明 suite_runner: quay-buckets ⇒ 新增写入者不在该路径上（runner 是唯一 writer）", (t) => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "capdeg-vr-quay-"));
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(wt, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  // 即使同时带 test_command，声明 suite_runner: quay-buckets ⇒ suite 走 full-suite-runner
  // （defaultMechanicalSuiteCommand 的同一份声明）⇒ 台账由 runner 写，本层不得再写。
  writeFile(path.join(wt, ".quay", "config.yml"), "loop:\n  suite_runner: quay-buckets\n  test_command: node --test\n");
  assert.equal(suiteRunsOutsideRunner(wt), false, "声明 quay-buckets ⇒ 本层不补写（⛔ 不双写）");
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
