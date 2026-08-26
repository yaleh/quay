// @test-group product
// lifecycle-a3-retreat-done.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runRetreat done→ready writes ready + logs a
// retreat event carrying the reason. The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A3: runRetreat done→ready writes ready + logs a retreat event carrying the reason", async () => {
  resetExit();
  const logPath = tmpLog("retreat-done");
  const client = stubClient({ id: "T-8", status: "done", extra: {} });
  const r = await runRetreat({ client, id: "T-8", reason: "rework needed", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  const events = queryGateEvents(logPath, { pipeline_id: "T-8" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "retreat");
  assert.deepEqual(events[0].payload, { from: "done", to: "ready", reason: "rework needed" });
  resetExit();
});
