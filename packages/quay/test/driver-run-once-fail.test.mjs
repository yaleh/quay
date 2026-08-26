// @test-group product
// driver-run-once-fail.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runOnce fail-path: meter fails, ok=false, reason
// surfaced, task stays ready. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnce } from "../src/gate/driver.ts";
import { stubClient, tmpLog, resetExit } from "./driver-helpers.mjs";

test("A2: runOnce fail-path — meter fails, ok=false, reason surfaced, task stays ready", async () => {
  resetExit();
  const logPath = tmpLog("once-fail");
  const client = stubClient([{ id: "R-1", status: "ready", extra: { acceptance: "false" } }]);
  const r = await runOnce({ client, logPath });
  assert.equal(r.processed, "R-1");
  assert.equal(r.ok, false);
  assert.equal(client._state.get("R-1").status, "ready", "status unchanged on meter fail");
  // --once has no `seen`: a re-run picks the SAME failing task again (by design).
  const r2 = await runOnce({ client, logPath });
  assert.equal(r2.processed, "R-1");
  assert.equal(r2.ok, false);
  resetExit();
});
