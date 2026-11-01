// @test-group serial
// worker-fan-in-spec-attribution.test.mjs — gap-fanin-rerun-attribution-blind-to-spec-reporter
//
// WHAT IS UNDER TEST: the SECOND consumer of node spec-reporter failure logs — fan-in's in-round
// rerun attribution (`readFailedTestFiles` → `parseSuiteLogFailures`). The first consumer
// (`parseFailureSignatures`, baseline A/B) was already fixed by
// gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red; this task reuses
// that pairing logic as a shared leaf and wires it into the failure-FILE attribution path.
//
// THE DEFECT (quay-fleet, 2026-11-01): a spec-reporter suite log names the failing file as
// `test at <file>:<line>:<col>` + a following `✖ <test name> (<ms>)`, but `parseSuiteLogFailures`
// only matched `^not ok` (TAP) and `passed=false` (__PERFILE__) lines. So every spec-reporter red
// point was read as `no-failing-lines-in-suite-log` → `rerun-not-evaluated` → after 2 rounds the
// task was parked needs-human as unattributable, regardless of the task's own implementation.
//
// FALSIFIABILITY: the negative controls below are the "能取假" halves — a standalone `✖`/`ℹ fail N`
// summary and an unpaired `test at` must all stay unattributed; TAP/__PERFILE__ fixtures must keep
// their byte-identical results (AC2(d)). Removing the spec branch in `parseSuiteLogFailures` makes
// AC1 red while every negative control stays green (AC2(e), verified by the mutation run recorded
// in docs/evidence/2026-11-01-fanin-rerun-spec-attribution.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import {
  readFailedTestFiles,
  parseSuiteLogFailures,
  parseFailureSignatures,
} from "../scripts/worker-fan-in.ts";
import {
  makeMechRepo,
  mechOpts,
  runMechanicalFanIn,
  rmSafe,
  REPO_ROOT,
} from "./helpers/worker-driver-fan-in-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BDA3E2_FIXTURE = path.join(HERE, "fixtures", "spec-reporter-suite-log-bda3e2.txt");

// ── AC1 正控夹具：quay-fleet 两轮生产 suite 日志的【逐字】`test at` + `✖` 摘录 ──────────────────
// Round 259（notification-pipeline-resolution-gate）与 Round 260（dogfood-p0）各一对；`:line` 与
// 耗时都是易变量，⛔ 不入身份，但这两行本身逐字取自生产载体（见 Proposal 的现场读数）。
const AC1_SPEC_EXCERPT = [
  "✖ failing tests:",
  "",
  "test at test/notification-pipeline-resolution-gate.test.mjs:645:1",
  "✖ AC-064(1) DoD: on the REAL persistent home, the closed ones leave the sendable set — recomputed read-only (603.98359ms)",
  "",
  "test at test/dogfood-p0.test.mjs:344:1",
  "✖ AC-012's criterion pipeline runs verbatim through sh -c against the real checkout and exits 0 (13462.952177ms)",
  "",
].join("\n");

// ── AC1 正控：readFailedTestFiles 把两条 spec 失败点都点名到文件 ─────────────────────────────────
test("AC1 (positive control) — the verbatim production spec-reporter excerpt attributes both failing files", () => {
  const reading = readFailedTestFiles(AC1_SPEC_EXCERPT, "/wt/repo");
  assert.deepEqual(reading, {
    evaluated: true,
    files: [
      "test/notification-pipeline-resolution-gate.test.mjs",
      "test/dogfood-p0.test.mjs",
    ],
  }, `spec blocks must attribute both files, got ${JSON.stringify(reading)}`);

  // 同一份摘录走 parseSuiteLogFailures：两条失败行，两个文件，零未归类。
  const parsed = parseSuiteLogFailures(AC1_SPEC_EXCERPT, "/wt/repo");
  assert.equal(parsed.failingLines, 2, "two paired spec blocks = two failing lines");
  assert.deepEqual(parsed.files, [
    "test/notification-pipeline-resolution-gate.test.mjs",
    "test/dogfood-p0.test.mjs",
  ]);
  assert.deepEqual(parsed.unclassified, [], "no unresolved identity in a relative-path excerpt");
});

// ── AC1 的第二半：同一摘录走真实 in-round rerun 路径 ⇒ rerun-green，⛔ 不落 rerun-not-evaluated ───
test("AC1+DoD (in-round rerun path) — a spec-reporter suite log is attributed and reruns green end-to-end", async (t) => {
  const m = makeMechRepo("spec-attrib-rerun");
  t.after(() => rmSafe(m.base));
  const named = "test/dogfood-p0.test.mjs";
  // suite 命令把一份 spec 格式的红日志写到 suite log（真 stdout，经 slot-holder 持久化到 suiteLogFile）。
  const specLogFile = path.join(m.base, "spec-suite.log");
  fs.writeFileSync(specLogFile, [
    "✖ failing tests:",
    "",
    "test at test/dogfood-p0.test.mjs:344:1",
    "✖ AC-012's criterion pipeline runs verbatim through sh -c against the real checkout and exits 0 (13462.952177ms)",
    "  AssertionError [ERR_ASSERTION]: criterion command exited 1",
    "",
  ].join("\n"), "utf8");
  // 项目侧声明重跑命令（⛔ 不走 `rerunCommand` 测试直传缝——那条缝是最终 argv，不做 `{files}` 整元素
  // splice；这里走真实解析路径 `<worktree>/.quay/config.yml` 的 `loop.rerun_command`，与 s07 同源）。
  const record = path.join(m.base, "rerun-args.txt");
  fs.mkdirSync(path.join(m.worktree, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(m.worktree, ".quay", "config.yml"),
    `loop:\n  rerun_command: ${JSON.stringify(["bash", "-c", `printf '%s\\n' "$@" > "${record}"; exit 0`, "rerun", "{files}"])}\n`,
    "utf8",
  );
  const r = await runMechanicalFanIn(mechOpts(m, "mf-run-spec-attrib", {
    suiteCommand: ["bash", "-c", `cat "${specLogFile}"; exit 1`],
  }));
  assert.equal(r.outcome, "landed", `spec log must attribute + rerun green + land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.rerun.state, "rerun-green", "in-round rerun must actually run, not stay rerun-not-evaluated");
  assert.deepEqual(r.failedTestFiles, { evaluated: true, files: [named] }, "outcome 记录点名失败文件");
  assert.deepEqual(r.rerun.files, [named], "rerun 点名文件 = 日志点名的失败文件");
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), [named], "{files} → 逐个 argv 元素");
});

// ── AC2(a)：只有 `✖` 块头 / 独立 `✖ name`、没有任何 `test at` ⇒ 仍 no-failing-lines-in-suite-log ──
test("AC2(a) (negative control) — a spec-shaped log with only `✖` lines and no `test at` stays unattributed", () => {
  const reading = readFailedTestFiles("✖ failing tests:\n\n✖ some failing name (12.5ms)\n", "/wt/repo");
  assert.deepEqual(reading, { evaluated: false, reason: "no-failing-lines-in-suite-log" },
    "a standalone ✖ carries no file identity ⇒ not attributed");
});

// ── AC2(b)：只有 `ℹ fail N` 摘要行 ⇒ 仍不归因 ────────────────────────────────────────────────────
test("AC2(b) (negative control) — a `ℹ fail N` summary line alone stays unattributed", () => {
  const reading = readFailedTestFiles("ℹ tests 2141\nℹ pass 2139\nℹ fail 1\nℹ duration_ms 37155.508319\n", "/wt/repo");
  assert.deepEqual(reading, { evaluated: false, reason: "no-failing-lines-in-suite-log" },
    "a summary `ℹ fail N` line carries no test identity ⇒ not attributed");
});

// ── AC2(c)：`test at` 后没有配对的 `✖` ⇒ 不归因 ──────────────────────────────────────────────────
test("AC2(c) (negative control) — a `test at` line with no paired `✖` is not attributed", () => {
  const reading = readFailedTestFiles("test at test/dogfood-p0.test.mjs:344:1\n  some stray error text\n", "/wt/repo");
  assert.equal(reading.evaluated, false, "unpaired test at is not a failure block");
  assert.deepEqual(parseSuiteLogFailures("test at test/dogfood-p0.test.mjs:344:1\n  some stray error text\n", "/wt/repo").files, [],
    "no file is fabricated from an unpaired test at");
});

// ── AC2(d)：既有 TAP / `__PERFILE__` 夹具解析结果逐字不变（spec 分支是并列通路，⛔ 不碰旧两支）──
test("AC2(d) (negative control) — the existing TAP/__PERFILE__ fixtures give byte-identical results", () => {
  // `__PERFILE__ … passed=false`（文件级标记）。
  assert.deepEqual(
    parseSuiteLogFailures("__PERFILE__ duration_ms=10 plugin/test/x.test.mjs passed=false end_ms=1\n", "/wt/repo"),
    { files: ["plugin/test/x.test.mjs"], failingLines: 1, pseudoStages: [], unclassified: [] },
  );
  // `not ok - <file>: <detail>`（TAP）。
  assert.deepEqual(
    parseSuiteLogFailures("not ok 1 - plugin/test/b.test.mjs: b is broken\nnot ok 2 - plugin/test/c.test.mjs: c is broken\n", "/wt/repo"),
    { files: ["plugin/test/b.test.mjs", "plugin/test/c.test.mjs"], failingLines: 2, pseudoStages: [], unclassified: [] },
  );
  // 伪阶段名仍走独立取值（⛔ 不把 `lint` 混进失败测试集）。
  assert.deepEqual(
    parseSuiteLogFailures("__PERFILE__ duration_ms=1 lint passed=false end_ms=2", "/wt/repo"),
    { files: [], failingLines: 1, pseudoStages: ["lint"], unclassified: [] },
  );
  // parseFailureSignatures 的 TAP/__PERFILE__ 夹具同样逐字不变（spec 配对被抽成共用叶函数，⛔ 改签名）。
  assert.deepEqual(
    parseFailureSignatures("__PERFILE__ duration_ms=1 plugin/test/a.test.mjs passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: a is broken\n", "/wt/repo").signatures,
    [{ file: "plugin/test/a.test.mjs", text: "a is broken" }],
  );
  assert.deepEqual(
    parseFailureSignatures("not ok 1 - plugin/test/b.test.mjs: b is broken\n", "/wt/repo").signatures,
    [{ file: "plugin/test/b.test.mjs", text: "b is broken" }],
  );
});

// ── AC3 真实重放：quay-fleet 生产 suite 日志（bda3e2）只读拷贝为 fixture，归因到 dogfood-p0 ─────
test("AC3 (real replay) — the byte-copied quay-fleet suite log fixture attributes test/dogfood-p0.test.mjs", () => {
  const log = fs.readFileSync(BDA3E2_FIXTURE, "utf8");
  // 逐字节副本的自证（⛔ 不是手写的仿真样本）。
  assert.equal(
    crypto.createHash("md5").update(log).digest("hex"),
    "0387353af971e669e7c544ff895d6b8c",
    "fixture 是 quay-fleet 生产日志失败块的逐字节副本",
  );
  const verdict = readFailedTestFiles(log, "/wt/repo");
  assert.deepEqual(verdict, { evaluated: true, files: ["test/dogfood-p0.test.mjs"] },
    `real log must attribute the failing file, got ${JSON.stringify(verdict)}`);
  const parsed = parseSuiteLogFailures(log, "/wt/repo");
  assert.equal(parsed.failingLines, 1, "exactly one paired spec failure block in the fixture");
  assert.deepEqual(parsed.files, ["test/dogfood-p0.test.mjs"]);
});

// ── 结构不变量：spec 配对只有一份正则/叶函数，两个消费者共用（⛔ 写第二份正则 = 漂移）──────────
test("Plan-2 (single source) — spec pairing lives in one shared leaf, consumed by both parsers", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-fan-in.ts"), "utf8");
  const count = (re) => (src.match(re) || []).length;
  // 三个 spec 正则各只定义一次（⛔ 不写第二份），配对叶函数也只定义一次。
  assert.equal(count(/SIG_TEST_AT_RE\s*=\s*\//g), 1, "test-at regex defined exactly once");
  assert.equal(count(/SIG_SPEC_FAIL_RE\s*=\s*\//g), 1, "spec-✖ regex defined exactly once");
  assert.equal(count(/function specFailurePair\(/g), 1, "spec pairing leaf defined exactly once");
  // 一次定义 + 两个消费者（parseFailureSignatures / parseSuiteLogFailures）——⛔ 各自内联一份。
  assert.equal(count(/specFailurePair\(/g), 3, "one definition + exactly two consumers of the shared pairing leaf");
});
