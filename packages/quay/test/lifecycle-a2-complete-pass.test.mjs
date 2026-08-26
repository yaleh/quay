// @test-group product
// lifecycle-a2-complete-pass.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A2 — runComplete pass-path — status=done, exactly two
// events (acceptance then complete), exit 0. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runComplete } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A2: runComplete pass-path — status=done, exactly two events (acceptance then complete), exit 0", async () => {
  resetExit();
  const logPath = tmpLog("complete-pass");
  const client = stubClient({ id: "T-3", status: "ready", extra: { acceptance: "true" } });
  const r = await runComplete({ client, id: "T-3", logPath });
  assert.equal(r.ok, true);
  assert.equal(process.exitCode, 0);
  assert.equal(client._state.status, "done");
  const events = queryGateEvents(logPath, { pipeline_id: "T-3" });
  assert.deepEqual(events.map((e) => e.gate), ["acceptance", "complete"]);
  assert.equal(events[1].verdict, "pass");
  assert.deepEqual(events[1].payload, { from: "ready", to: "done" });
  resetExit();
});
