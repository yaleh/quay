// @test-group product
// lifecycle-a3-promote-todo.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runPromote todo→ready runs the dod gate then
// writes ready + logs a promote event. The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A3: runPromote todo→ready runs the dod gate then writes ready + logs a promote event", async () => {
  resetExit();
  const logPath = tmpLog("promote-todo");
  // todo => stub taskCheck ok:true, so the dod gate passes.
  const client = stubClient({ id: "T-5", status: "todo", extra: {} });
  const r = await runPromote({ client, id: "T-5", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  const gates = queryGateEvents(logPath, { pipeline_id: "T-5" }).map((e) => e.gate);
  assert.deepEqual(gates, ["dod", "promote"]);
  resetExit();
});
