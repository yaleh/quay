// @test-group product
// lifecycle-a2-complete-fail.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runComplete fail-path (acceptance fails) — status
// stays ready, one acceptance fail event, exit 1. The test body is byte-identical to the original;
// only its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A2: runComplete fail-path (acceptance fails) — status stays ready, one acceptance fail event, exit 1", async () => {
  resetExit();
  const logPath = tmpLog("complete-fail");
  const client = stubClient({ id: "T-2", status: "ready", extra: { acceptance: "false" } });
  const r = await runComplete({ client, id: "T-2", logPath });
  assert.equal(r.ok, false);
  assert.equal(process.exitCode, 1);
  assert.equal(client._state.status, "ready", "status unchanged on gate fail");
  const events = queryGateEvents(logPath, { pipeline_id: "T-2" });
  assert.equal(events.length, 1, "exactly one (acceptance) event on fail");
  assert.equal(events[0].gate, "acceptance");
  assert.equal(events[0].verdict, "fail");
  resetExit();
});
