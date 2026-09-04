// @test-group product
// lifecycle-a2-complete-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runComplete throws on a missing task. The test
// body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { tmpLog } from "./lifecycle-helpers.mjs";

test("A2: runComplete throws on a missing task", async () => {
  const logPath = tmpLog("complete-missing");
  const client = { taskGet: async () => null };
  await assert.rejects(() => runComplete({ client, id: "MISSING", logPath }), /no such task: MISSING/);
});
