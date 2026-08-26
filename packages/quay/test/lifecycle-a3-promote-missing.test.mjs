// @test-group product
// lifecycle-a3-promote-missing.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runPromote throws on a missing task. The test body
// is byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { tmpLog } from "./lifecycle-helpers.mjs";

test("A3: runPromote throws on a missing task", async () => {
  const client = { taskGet: async () => null };
  await assert.rejects(() => runPromote({ client, id: "MISSING", logPath: tmpLog("prom-missing") }), /no such task/);
});
