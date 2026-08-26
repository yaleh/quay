// @test-group product
// lifecycle-a2b-loop-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2b — runCompleteLoop throws on a missing task. The
// test body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runCompleteLoop } from "../src/gate/lifecycle.ts";
import { tmpLog } from "./lifecycle-helpers.mjs";

test("A2b: runCompleteLoop throws on a missing task", async () => {
  const logPath = tmpLog("complete-loop-missing");
  const client = { taskGet: async () => null };
  await assert.rejects(() => runCompleteLoop({ client, id: "MISSING", logPath }), /no such task: MISSING/);
});
