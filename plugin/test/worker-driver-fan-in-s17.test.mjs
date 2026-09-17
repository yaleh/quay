// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s09.test.mjs by gap-suite-split-15-over-30s-test-files — shard 17 (1 test: 同一 runId 连续两次 suite 红 ⇒ 两份 attempt 日志互不覆盖). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fs, makeMechRepo, mechOpts, path, readSuiteLogUntil, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

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
