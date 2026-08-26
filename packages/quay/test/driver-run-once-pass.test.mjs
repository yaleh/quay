// @test-group product
// driver-run-once-pass.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runOnce pass-path: lowest actionable id processed,
// status=done, acceptance+complete events recorded. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnce } from "../src/gate/driver.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./driver-helpers.mjs";

test("A2: runOnce pass-path — lowest actionable id, processed=id, ok=true, status=done", async () => {
  resetExit();
  const logPath = tmpLog("once-pass");
  const client = stubClient([
    { id: "R-2", status: "ready", extra: { acceptance: "true" } },
    { id: "R-1", status: "ready", extra: { acceptance: "true" } },
  ]);
  const r = await runOnce({ client, logPath });
  assert.deepEqual({ processed: r.processed, ok: r.ok }, { processed: "R-1", ok: true }); // lowest id
  assert.equal(client._state.get("R-1").status, "done");
  assert.equal(client._state.get("R-2").status, "ready", "only ONE task processed");
  const events = queryGateEvents(logPath, { pipeline_id: "R-1" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  resetExit();
});
