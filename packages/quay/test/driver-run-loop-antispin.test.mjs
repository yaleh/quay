// @test-group product
// driver-run-loop-antispin.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runLoop anti-spin: a failing-meter task is
// attempted ONCE then fixpoint (NOT cap). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLoop } from "../src/gate/driver.ts";
import { stubClient, tmpLog, tmpWorkspace, resetExit } from "./driver-helpers.mjs";

test("A3: runLoop anti-spin — a failing-meter task is attempted ONCE then fixpoint (NOT cap)", async () => {
  resetExit();
  const logPath = tmpLog("loop-antispin");
  const { workspaceRoot } = tmpWorkspace("loop-antispin");
  // One failing task + one passing task: the passing one completes, the failing
  // one is attempted once (stays ready) then subtracted via `seen` -> fixpoint.
  const client = stubClient([
    { id: "L-FAIL", status: "ready", extra: { acceptance: "false" } },
    { id: "L-PASS", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runLoop({ client, cfg: { workspaceRoot }, logPath });
  assert.equal(r.stopped, "fixpoint", "must reach fixpoint, NOT cap");
  assert.deepEqual(r.completed, ["L-PASS"]);
  assert.equal(r.iterations, 2, "each actionable id attempted exactly once");
  assert.equal(client._state.get("L-FAIL").status, "ready", "failing task left ready");
  assert.equal(client._state.get("L-PASS").status, "done");
  resetExit();
});
