// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in-s09.test.mjs by gap-suite-split-15-over-30s-test-files — shard 16 (1 test: suite 决策步同时写共享载体与 per-run 日志). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { assert, fanInLogFileName, fs, makeMechRepo, mechOpts, path, rmSafe, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC2/AC3 (gap-fan-in-step-trace-suite-step-stopped-writing) — suite 决策步骤同时写共享 fan-in-step-trace.jsonl 与 per-run 日志（同 runId 两载体条目数一致且都 > 0）", async (t) => {
  const m = makeMechRepo("step-trace-suite");
  const runId = "mf-run-step-trace-suite";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  // 共享载体：同一 runId 下 suite 决策步骤各出现一次（AC2）。
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const suiteSteps = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.ok(suiteSteps.some((l) => l.step === "ac-precheck"), "shared carrier must have ac-precheck");
  assert.ok(suiteSteps.some((l) => l.step === "suite-start"), "shared carrier must have suite-start");
  assert.ok(suiteSteps.some((l) => l.step === "suite-end"), "shared carrier must have suite-end");
  assert.equal(suiteSteps.some((l) => l.step === "suite-skip"), false, "needSuite path must NOT write suite-skip");
  assert.equal(suiteSteps.length, 3, "needSuite path ⇒ ac-precheck + suite-start + suite-end = 3 shared suite entries");
  // per-run 载体：suite 决策条目数与共享一致（AC3 两载体对照）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, suiteSteps.length, "per-run and shared carriers carry the same count of suite decision entries (AC3)");
});
