// @test-group product
// lifecycle-a2b-loop-passmeter.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2b — runCompleteLoop on a ready task WITH a passing
// meter — CLI-consistent acceptance + complete events. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runCompleteLoop } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A2b: runCompleteLoop on a ready task WITH a passing meter — CLI-consistent acceptance + complete events", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-passmeter");
  const client = stubClient({ id: "T-L2", status: "ready", extra: { acceptance: "true" } });
  const r = await runCompleteLoop({ client, id: "T-L2", logPath });
  assert.equal(r.ok, true);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L2" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  assert.equal(events[1].verdict, "pass");
  assert.deepEqual(events[1].payload, { from: "ready", to: "done" });
  resetExit();
});
