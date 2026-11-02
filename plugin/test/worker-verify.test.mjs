// @test-group lowconc
// worker-verify.test.mjs — worker 会话内验证入口 (gap-worker-verify-condenser): --verify-run 的失败文件
// 解析 + baseline A/B 分类（复用 worker-fan-in.ts 的 readFailedTestFiles / parseFailureSignatures /
// compareFailureSignatures / resolveRerunCommand），以及 --verify-rerun 的 argv 与三态回退。纯分类夹具
// 不 spawn；AC2 的 argv 断言经一个 exit-0 的 stub test.sh 走真实 runVerify（快速，无全量套件）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  classifyVerifyFailures,
  readFailedTestFiles,
  parseFailureSignatures,
  resolveRerunCommand,
  scopedGateCommandFor,
  runVerify,
  runVerifyRerun,
  workerDriverSelfInvocation,
} from "../scripts/worker-driver.ts";
import { makeRoot } from "./helpers/worker-driver-harness.mjs";

// 一份最小 loop 契约（本仓库形态：scoped_command + rerun_command）。
function writeLoopConfig(root, { rerun = true } = {}) {
  fs.writeFileSync(path.join(root, ".quay", "config.yml"),
    "loop:\n  suite_runner: quay-buckets\n" +
    '  scoped_command: ["bash", "{worktree}/scripts/test.sh", "--for-task", "{task}", "--allow-thin"]\n' +
    (rerun ? '  rerun_command: ["bash", "{worktree}/scripts/test.sh", "{files}"]\n' : ""), "utf8");
}

function writeExitStub(root, { exitCode = 0, stdout = "" } = {}) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\n${stdout ? `printf '%s\\n' '${stdout}'` : ":"}\nexit ${exitCode}\n`, "utf8");
}

// spec reporter 失败块（node spec reporter 的真实形态：`test at <file>:N:C` + 紧随的 `✖ <name> (<ms>)`）。
const specFail = (file, name, code = "ERR_ASSERTION") =>
  `test at ${file}:12:5\n✖ ${name} (3.5ms)\ncode: '${code}'\n`;

test("AC1① — spec-reporter 失败文件解析（复用 parseFailureSignatures / readFailedTestFiles，⛔ 不重写解析器）", () => {
  const log = specFail("packages/quay/test/foo.test.mjs", "fails because x");
  const failed = readFailedTestFiles(log);
  assert.deepEqual(failed, { evaluated: true, files: ["packages/quay/test/foo.test.mjs"] });
  const sigs = parseFailureSignatures(log);
  assert.equal(sigs.evaluated, true);
  assert.equal(sigs.signatures.length, 1);
  assert.equal(sigs.signatures[0].file, "packages/quay/test/foo.test.mjs");
  assert.equal(sigs.signatures[0].name, "fails because x");
});

test("AC1① — TAP 失败文件解析（not ok - <file>: <detail>）", () => {
  const log = "not ok 1 - packages/quay/test/bar.test.mjs: expected 1 to equal 2\n";
  const failed = readFailedTestFiles(log);
  assert.deepEqual(failed, { evaluated: true, files: ["packages/quay/test/bar.test.mjs"] });
  const sigs = parseFailureSignatures(log);
  assert.equal(sigs.evaluated, true);
  assert.equal(sigs.signatures[0].file, "packages/quay/test/bar.test.mjs");
});

test("AC1② — 多文件失败：must-fix 归到全部点名文件（基线不可用 ⇒ 保守）", () => {
  const log = specFail("packages/quay/test/a.test.mjs", "boom a") +
    specFail("packages/quay/test/b.test.mjs", "boom b");
  const failed = readFailedTestFiles(log);
  const classification = classifyVerifyFailures(failed, parseFailureSignatures(log), null);
  assert.equal(classification.baselineAvailable, false);
  assert.equal(classification.classification, "not-evaluated");
  assert.deepEqual(classification.mustFix, ["packages/quay/test/a.test.mjs", "packages/quay/test/b.test.mjs"]);
});

test("AC1③ — 无失败行 ⇒ not-evaluated，⛔ 不得判绿", () => {
  const log = "all tests passed\n# tests 4\n";
  const failed = readFailedTestFiles(log);
  assert.equal(failed.evaluated, false);
  assert.equal(failed.reason, "no-failing-lines-in-suite-log");
  const classification = classifyVerifyFailures(failed, parseFailureSignatures(log), null);
  assert.equal(classification.classification, "not-evaluated");
  assert.deepEqual(classification.mustFix, []);
});

test("AC1④ — 基线树不可用 ⇒ not-evaluated + 全部失败记 must-fix（⛔ 不跳过、不静默判绿）", () => {
  const log = specFail("packages/quay/test/foo.test.mjs", "fails because x");
  const failed = readFailedTestFiles(log);
  const classification = classifyVerifyFailures(failed, parseFailureSignatures(log), null);
  assert.equal(classification.baselineAvailable, false);
  assert.equal(classification.classification, "not-evaluated");
  assert.equal(classification.reason, "baseline-tree-unavailable");
  assert.deepEqual(classification.mustFix, ["packages/quay/test/foo.test.mjs"]);
  assert.deepEqual(classification.baselineRed, []);
});

test("AC1⑤ — 同一文件在基线也红（逐字同签名）⇒ baseline-red，不在 must-fix 列表", () => {
  const log = specFail("packages/quay/test/foo.test.mjs", "fails because x");
  const failed = readFailedTestFiles(log);
  const taskSigs = parseFailureSignatures(log);
  const baselineSigs = parseFailureSignatures(log); // 同一份红日志 = 基线也红
  const classification = classifyVerifyFailures(failed, taskSigs, baselineSigs);
  assert.equal(classification.baselineAvailable, true);
  assert.equal(classification.classification, "baseline-red");
  assert.deepEqual(classification.mustFix, []);
  assert.deepEqual(classification.baselineRed, ["packages/quay/test/foo.test.mjs"]);
});

test("AC1⑤-负控 — 基线对同一批文件全绿 ⇒ must-fix（基线绿 ≠ 基线红）", () => {
  const log = specFail("packages/quay/test/foo.test.mjs", "fails because x");
  const failed = readFailedTestFiles(log);
  const classification = classifyVerifyFailures(failed, parseFailureSignatures(log), { evaluated: true, signatures: [] });
  assert.equal(classification.classification, "must-fix");
  assert.deepEqual(classification.mustFix, ["packages/quay/test/foo.test.mjs"]);
  assert.deepEqual(classification.baselineRed, []);
});

test("AC1⑤-混合 — 一文件 baseline-red + 一文件 must-fix ⇒ 分类 must-fix 且两个集合各自正确", () => {
  const old = specFail("packages/quay/test/old.test.mjs", "pre-existing");
  const newLog = specFail("packages/quay/test/new.test.mjs", "introduced");
  const taskLog = old + newLog;
  const failed = readFailedTestFiles(taskLog);
  const classification = classifyVerifyFailures(failed, parseFailureSignatures(taskLog), parseFailureSignatures(old));
  assert.equal(classification.classification, "must-fix");
  assert.deepEqual(classification.mustFix, ["packages/quay/test/new.test.mjs"]);
  assert.deepEqual(classification.baselineRed, ["packages/quay/test/old.test.mjs"]);
});

test("AC2 — --verify-run 实际执行的 argv 与 scopedGateCommandFor(task, worktree) 逐元素相等（真实 runVerify 绿路径）", async (t) => {
  const root = makeRoot("verify-argv");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLoopConfig(root);
  writeExitStub(root, { exitCode: 0 });
  const reading = await runVerify({ task: "gap-x", worktree: root, root, runBaseline: false });
  assert.equal(reading.classification, "green");
  assert.deepEqual(reading.argv, scopedGateCommandFor("gap-x", root), "argv 必须与 scopedGateCommandFor 逐元素相等");
  assert.deepEqual(reading.argv, ["bash", path.join(root, "scripts", "test.sh"), "--for-task", "gap-x", "--allow-thin"]);
});

test("AC3 — resolveRerunCommand 把 {files} 整元素 splice 成 must-fix 文件列表（⛔ 拼串）", (t) => {
  const root = makeRoot("verify-rerun-argv");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLoopConfig(root);
  const resolved = resolveRerunCommand(root, root, ["packages/quay/test/a.test.mjs", "packages/quay/test/b.test.mjs"]);
  assert.equal(resolved.kind, "run");
  assert.deepEqual(resolved.argv, ["bash", path.join(root, "scripts", "test.sh"), "packages/quay/test/a.test.mjs", "packages/quay/test/b.test.mjs"]);
});

test("AC3 — must-fix 为空 ⇒ nothing-to-rerun（exit 0，⛔ 不 spawn）", async (t) => {
  const root = makeRoot("verify-rerun-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLoopConfig(root);
  fs.writeFileSync(path.join(root, ".quay", "verify-state-gap-x.json"),
    `${JSON.stringify({ task: "gap-x", mustFix: [], baselineRed: [], classification: "baseline-red", writtenAt: new Date().toISOString() })}\n`, "utf8");
  const reading = await runVerifyRerun({ task: "gap-x", worktree: root, root });
  assert.equal(reading.state, "nothing-to-rerun");
  assert.deepEqual(reading.files, []);
  assert.equal(reading.exitCode, 0);
});

test("AC3 — rerun_command 未声明 ⇒ not-evaluated 并退回完整 scoped 门（⛔ 不跳过验证）", async (t) => {
  const root = makeRoot("verify-rerun-nodecl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLoopConfig(root, { rerun: false });
  writeExitStub(root, { exitCode: 0 });
  fs.writeFileSync(path.join(root, ".quay", "verify-state-gap-x.json"),
    `${JSON.stringify({ task: "gap-x", mustFix: ["packages/quay/test/a.test.mjs"], baselineRed: [], classification: "must-fix", writtenAt: new Date().toISOString() })}\n`, "utf8");
  const reading = await runVerifyRerun({ task: "gap-x", worktree: root, root });
  assert.equal(reading.state, "not-evaluated");
  assert.equal(reading.fellBackToScopedGate, true);
  assert.deepEqual(reading.argv, scopedGateCommandFor("gap-x", root), "回退时跑的是完整 scoped 门");
  assert.equal(reading.exitCode, 0);
});

test("AC4 前置 — worker 验证入口与 scoped-gate-cache 写入共用同一 worker-driver 入口（单一真相源）", () => {
  assert.match(workerDriverSelfInvocation(), /worker-driver\.(ts|js)$/, "workerDriverSelfInvocation 指向 worker-driver");
});
