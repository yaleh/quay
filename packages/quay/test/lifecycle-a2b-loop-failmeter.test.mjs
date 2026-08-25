// @test-group product
// lifecycle-a2b-loop-failmeter.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2b — runCompleteLoop on a ready task WITH a FAILING
// meter — status stays ready, ONE acceptance fail event, exit 1. The test body is byte-identical
// to the original; only its file placement changed so node:test's file-level concurrency can
// parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runCompleteLoop } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A2b: runCompleteLoop on a ready task WITH a FAILING meter — status stays ready, ONE acceptance fail event, exit 1", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-failmeter");
  const client = stubClient({ id: "T-L3", status: "ready", extra: { acceptance: "false" } });
  const r = await runCompleteLoop({ client, id: "T-L3", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "ready", "status unchanged on meter fail — the loop must not bypass a present meter");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L3" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "acceptance");
  assert.equal(events[0].verdict, "fail");
  resetExit();
});
