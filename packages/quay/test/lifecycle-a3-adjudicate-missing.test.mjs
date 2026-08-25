// @test-group product
// lifecycle-a3-adjudicate-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runAdjudicate throws on a missing task. The test
// body is byte-identical to the original; only its file placement changed so node:test's
// file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAdjudicate } from "../src/gate/lifecycle.ts";
import { tmpLog } from "./lifecycle-helpers.mjs";

test("A3: runAdjudicate throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(() => runAdjudicate({ client, id: "MISSING", logPath: tmpLog("adj-missing") }), /no such task/);
});
