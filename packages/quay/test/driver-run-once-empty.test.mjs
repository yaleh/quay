// @test-group product
// driver-run-once-empty.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runOnce empty-board: processed=null (caller prints
// 'nothing to do'). The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnce } from "../src/gate/driver.ts";
import { stubClient, tmpLog, resetExit } from "./driver-helpers.mjs";

test("A2: runOnce empty-board — processed=null (caller prints 'nothing to do')", async () => {
  resetExit();
  const client = stubClient([{ id: "R-1", status: "done", extra: { acceptance: "true" } }]);
  const r = await runOnce({ client, logPath: tmpLog("once-empty") });
  assert.deepEqual(r, { processed: null, ok: null, reason: null });
  resetExit();
});
