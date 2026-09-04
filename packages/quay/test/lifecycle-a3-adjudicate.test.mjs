// @test-group product
// lifecycle-a3-adjudicate.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runAdjudicate logs an `audit` GateEvent, never
// writes, exit 0 (fail verdict recorded, not enforced). The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runAdjudicate } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A3: runAdjudicate logs an `audit` GateEvent, never writes, exit 0 (fail verdict recorded, not enforced)", async () => {
  resetExit();
  const logPath = tmpLog("adjudicate");
  // ready => stub taskCheck returns ok:false, but adjudicate is record-only.
  const client = stubClient({ id: "T-4", status: "ready", extra: {} });
  const r = await runAdjudicate({ client, id: "T-4", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 0, "adjudicate is exit 0 regardless of verdict");
  assert.equal(client._state.status, "ready", "adjudicate never writes status");
  const events = queryGateEvents(logPath, { pipeline_id: "T-4" });
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "audit");
  assert.equal(events[0].verdict, "fail");
  assert.equal(events[0].payload.observed_status, "ready");
  assert.equal(events[0].payload.reason, "stub");
  resetExit();
});
