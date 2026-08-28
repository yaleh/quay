// @test-group product
// driver-run-loop-fixpoint.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runLoop fixpoint: two passing tasks both completed,
// stopped=fixpoint. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLoop } from "../src/gate/driver.ts";
import { stubClient, tmpLog, tmpWorkspace, resetExit } from "./driver-helpers.mjs";

test("A3: runLoop fixpoint — two passing tasks both completed, stopped=fixpoint", async () => {
  resetExit();
  const logPath = tmpLog("loop-fixpoint");
  const { workspaceRoot } = tmpWorkspace("loop-fixpoint");
  const client = stubClient([
    { id: "L-1", status: "ready", extra: { acceptance: "true" } },
    { id: "L-2", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "fixpoint");
  assert.deepEqual(r.completed, ["L-1", "L-2"]);
  assert.equal(r.iterations, 2);
  assert.equal(client._state.get("L-1").status, "done");
  assert.equal(client._state.get("L-2").status, "done");
  resetExit();
});
