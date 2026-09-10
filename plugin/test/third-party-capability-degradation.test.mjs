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
} from "../scripts/worker-driver.ts";

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
