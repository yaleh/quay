// @test-group product
// lifecycle-a3-adjudicate-pass.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runAdjudicate pass verdict on a todo task (stub
// taskCheck ok). The test body is byte-identical to the original; only its file placement changed
// so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAdjudicate } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A3: runAdjudicate pass verdict on a todo task (stub taskCheck ok)", async () => {
  resetExit();
  const logPath = tmpLog("adjudicate-pass");
  const client = stubClient({ id: "T-4b", status: "todo", extra: {} });
  const r = await runAdjudicate({ client, id: "T-4b", logPath });
  assert.equal(r.ok, true);
  assert.equal(queryGateEvents(logPath, { pipeline_id: "T-4b" })[0].verdict, "pass");
  resetExit();
});
