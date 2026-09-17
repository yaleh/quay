// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s09.test.mjs by gap-suite-split-15-over-30s-test-files — shard 15 (1 test: 上条同一机制的负控制 —— 4 个 suite 决策步无 begin，配对读法与 durationMs 读法相反). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, makeMechRepo, mechOpts, pairedEndCount, readSharedTrace, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

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
