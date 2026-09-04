// @test-group product
// lifecycle-a3-promote-ready.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runPromote ready→done delegates to runComplete
// (acceptance-guarded path to done). The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { queryGateEvents } from "../src/gate/gate-event-store.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("A3: runPromote ready→done delegates to runComplete (acceptance-guarded path to done)", async () => {
  resetExit();
  const logPath = tmpLog("promote-ready");
  const client = stubClient({ id: "T-6", status: "ready", extra: { acceptance: "true" } });
  const r = await runPromote({ client, id: "T-6", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "done");
  assert.equal(client._state.status, "done");
  const gates = queryGateEvents(logPath, { pipeline_id: "T-6" }).map((e) => e.gate);
  assert.deepEqual(gates, ["acceptance", "complete"]);
  resetExit();
});
