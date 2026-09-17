// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s09.test.mjs by gap-suite-split-15-over-30s-test-files — shard 14 (1 test: 共享载体每条 step-end 自带 durationMs 的统一时长通道). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fanInLogFileName, fs, makeMechRepo, mechOpts, path, readSharedTrace, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

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
