// @test-group product
// driver-run-loop-sentinel.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runLoop sentinel: pre-created .quay/.stop =>
// iterations:0, stopped:sentinel (no work). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLoop } from "../src/gate/driver.ts";
import { stubClient, tmpLog, tmpWorkspace, resetExit } from "./driver-helpers.mjs";

test("A3: runLoop sentinel — pre-created .quay/.stop => iterations:0, stopped:sentinel (no work)", async () => {
  resetExit();
  const logPath = tmpLog("loop-sentinel");
  const { workspaceRoot } = tmpWorkspace("loop-sentinel", { stop: true });
  const client = stubClient([{ id: "L-1", status: "ready", extra: { acceptance: "true" } }]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "sentinel");
  assert.equal(r.iterations, 0);
  assert.deepEqual(r.completed, []);
  assert.equal(client._state.get("L-1").status, "ready", "sentinel stops BEFORE any work");
  resetExit();
});
