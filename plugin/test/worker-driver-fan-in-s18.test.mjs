// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s09.test.mjs by gap-suite-split-15-over-30s-test-files — shard 18 (1 test: 真实多次-suite-red runId 回放). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, makeMechRepo, mechOpts, path, readSuiteLogUntil, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC4 — 真实多次-suite-red runId 回放（gap-dashboard-taskcard-multistatus-minitable / wk-prod-1788275557）⇒ 两份日志各自独立、都可读", async (t) => {
  const m = makeMechRepo("ac4-real-replay", "gap-dashboard-taskcard-multistatus-minitable");
  const runId = "wk-prod-1788275557"; // 实测同 runId 下 2 次独立 suite red 的真实 runId。
  t.after(() => rmSafe(m.base));
  const opts = (marker) => mechOpts(m, runId, {
    task: "gap-dashboard-taskcard-multistatus-minitable",
    suiteLogFile: null,
    suiteCommand: ["bash", "-c", `echo red-attempt-${marker}; exit 1`],
  });
  const r1 = await runMechanicalFanIn(opts("first"));
  const r2 = await runMechanicalFanIn(opts("second"));
  assert.equal(r1.outcome, "red"); assert.equal(r1.step, "suite");
  assert.equal(r2.outcome, "red"); assert.equal(r2.step, "suite");
  assert.notEqual(r1.suiteLog, r2.suiteLog, "same runId, two suite attempts ⇒ two distinct logs（⛔ 仍共享 ⇒ 假）");
  const f1 = path.join(m.repo, ".quay", r1.suiteLog);
  const f2 = path.join(m.repo, ".quay", r2.suiteLog);
  assert.match(await readSuiteLogUntil(f1, "red-attempt-first") ?? "", /red-attempt-first/, "first attempt readable");
  assert.match(await readSuiteLogUntil(f2, "red-attempt-second") ?? "", /red-attempt-second/, "second attempt readable (its own content, ⛔ 被覆盖则读不到)");
});
