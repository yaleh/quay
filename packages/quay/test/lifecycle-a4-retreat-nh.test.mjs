// @test-group product
// lifecycle-a4-retreat-nh.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A4 [AC1-AC2] — runRetreat needs-human→todo writes todo
// + logs retreat event carrying the reason. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A4 [AC1-AC2]: runRetreat needs-human→todo writes todo + logs retreat event carrying the reason", async () => {
  resetExit();
  const logPath = tmpLog("retreat-nh");
  const client = stubClient({ id: "T-NH1", status: "needs-human", extra: {} });
  const r = await runRetreat({ client, id: "T-NH1", reason: "dependency installed; re-evaluate", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "todo");
  assert.equal(client._state.status, "todo");
  const events = queryGateEvents(logPath, { pipeline_id: "T-NH1" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "retreat");
  assert.equal(events[0].verdict, "pass");
  assert.deepEqual(events[0].payload, { from: "needs-human", to: "todo", reason: "dependency installed; re-evaluate" });
  resetExit();
});
