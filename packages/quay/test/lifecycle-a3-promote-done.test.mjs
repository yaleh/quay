// @test-group product
// lifecycle-a3-promote-done.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runPromote on a done task throws illegal
// transition (done cannot forward). The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog } from "./lifecycle-helpers.mjs";

test("A3: runPromote on a done task throws illegal transition (done cannot forward)", async () => {
  const logPath = tmpLog("promote-done");
  const client = stubClient({ id: "T-7", status: "done", extra: {} });
  await assert.rejects(() => runPromote({ client, id: "T-7", logPath }), /illegal transition: done cannot forward/);
});
