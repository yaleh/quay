// @test-group product
// lifecycle-a3-retreat-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runRetreat throws on a missing task. The test body
// is byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { tmpLog } from "./lifecycle-helpers.mjs";

test("A3: runRetreat throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(
    () => runRetreat({ client, id: "MISSING", reason: "x", logPath: tmpLog("ret-missing") }),
    /no such task/
  );
});
