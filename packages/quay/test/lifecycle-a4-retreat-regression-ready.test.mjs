// @test-group product
// lifecycle-a4-retreat-regression-ready.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A4 [AC6] — runRetreat ready→todo still works (no
// regression on existing retreat paths). The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A4 [AC6]: runRetreat ready→todo still works (no regression on existing retreat paths)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-regression-ready");
  const client = stubClient({ id: "T-NH6", status: "ready", extra: {} });
  const r = await runRetreat({ client, id: "T-NH6", reason: "re-triage", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "todo");
  assert.equal(client._state.status, "todo");
  const events = queryGateEvents(logPath, { pipeline_id: "T-NH6" });
  assert.equal(events[0].gate, "retreat");
  assert.deepEqual(events[0].payload, { from: "ready", to: "todo", reason: "re-triage" });
  resetExit();
});
