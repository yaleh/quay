// @test-group product
// lifecycle-a2b-loop-nometer.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2b — runCompleteLoop on a meterless ready task — status
// done + ONE complete pass event carrying verifiedBy. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runCompleteLoop } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A2b: runCompleteLoop on a meterless ready task — status done + ONE complete pass event carrying verifiedBy", async () => {
  resetExit();
  const logPath = tmpLog("complete-loop-nometer");
  const client = stubClient({ id: "T-L1", status: "ready", extra: {} });
  const r = await runCompleteLoop({ client, id: "T-L1", logPath, verifiedBy: "verification-round-3 green + AC/DoD checked" });
  assert.equal(r.ok, true);
  assert.equal(process.exitCode, 0);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-L1" });
  assert.equal(events.length, 1, "meterless loop completion writes exactly one (complete) event — the loop's meter is the verification-round, not extra.acceptance");
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].actor, "quay-loop");
  assert.deepEqual(events[0].payload, { from: "ready", to: "done", verifiedBy: "verification-round-3 green + AC/DoD checked" });
  resetExit();
});
