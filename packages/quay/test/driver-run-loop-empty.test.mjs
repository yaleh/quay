// @test-group product
// driver-run-loop-empty.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runLoop empty-board: stopped=fixpoint, zero
// iterations. The test body is byte-identical to the original; only its file placement changed so
// node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLoop } from "../src/gate/driver.ts";
import { stubClient, tmpLog, tmpWorkspace, resetExit } from "./driver-helpers.mjs";

test("A3: runLoop empty-board — stopped=fixpoint, zero iterations", async () => {
  resetExit();
  const logPath = tmpLog("loop-empty");
  const { workspaceRoot } = tmpWorkspace("loop-empty");
  const client = stubClient([{ id: "L-1", status: "done", extra: { acceptance: "true" } }]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.deepEqual({ stopped: r.stopped, iterations: r.iterations, completed: r.completed }, {
    stopped: "fixpoint",
    iterations: 0,
    completed: [],
  });
  resetExit();
});
